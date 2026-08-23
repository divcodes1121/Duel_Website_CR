"""Phase 15 — the one function production calls.

    predict(tag, domain, plays) -> PredictionResult

WHAT CROSSES THIS BOUNDARY. A deck, a confidence band, up to three
alternatives, and a sentence. No scores, no feature vectors, no model names.
The research package underneath can be rebuilt or replaced entirely and the
Coach does not change.

WHAT NEVER CROSSES IT. Any path where the primary is not the player's most
recent deck. `policy.enforce_primary` is applied last, unconditionally.

NO TRAINING HAPPENS HERE. The change model is loaded from a JSON artifact
exported offline; if the artifact is missing or malformed the engine falls back
to a counting estimate of churn, which needs no fitting at all. Either way
`policy.forbid_training` disables `fit` on anything loaded.
"""
from __future__ import annotations

import json
import os
import threading

from .. import candidates as C
from .. import change_detector as CD
from .. import exit_model as E
from .. import features as F
from .. import shortlist as SL
from .. import substitution as S
from . import adapter, calibration, policy

ARTIFACT = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "artifacts", "m2-change-v1.json")

_lock = threading.Lock()
_model = None
_loaded = False


def _load_change_model():
    """The offline-trained M2, or None. Loaded once, never fitted."""
    global _model, _loaded
    with _lock:
        if _loaded:
            return _model
        _loaded = True
        try:
            with open(ARTIFACT, encoding="utf-8") as fh:
                art = json.load(fh)
            if list(art.get("feature_names", [])) != list(F.FEATURE_NAMES):
                # A feature-order change silently invalidates every weight.
                # Refusing here is the difference between a degraded read and
                # a confidently wrong one.
                _model = None
                return None
            m = CD.M2ChangeModel(class_weight=art.get("class_weight", False))
            m.weights = art["weights"]
            m.bias = art["bias"]
            m.scaler.mean = art["scaler"]["mean"]
            m.scaler.std = art["scaler"]["std"]
            policy.forbid_training(m)
            _model = m
        except Exception:
            _model = None
        return _model


def _change_probability(view: dict, example) -> tuple[float, bool]:
    """(P(change), used_artifact). Falls back to counted churn."""
    model = _load_change_model()
    if model is not None and example is not None:
        try:
            dist = model.predict(F.extract(example))
            return 1.0 - dist.get(0, 0.0), True
        except Exception:
            pass
    edits = view.get("prior_edits", [])
    n = max(1, view.get("cluster_size", 1) - 1)
    return min(1.0, len(edits) / n), False


def predict(tag: str, domain: str, plays, cutoff_ts: str | None = None,
            max_alternatives: int = policy.MAX_ALTERNATIVES):
    """The Coach's single entry point. Never raises."""
    try:
        safe_plays = policy.assert_no_future(plays, cutoff_ts) if cutoff_ts else list(plays)
        if not safe_plays:
            return policy.safe_fallback([], "no plays", domain)

        recent_deck = sorted(sorted(safe_plays, key=lambda p: p.battle_time)[-1].cards)
        view, shell = adapter.build_context(tag, domain, safe_plays, cutoff_ts)
        if view is None:
            return policy.safe_fallback(recent_deck,
                                        "no established shell", domain)

        from ..dataset import PredictionExample, DeckPlay
        # THE SHELL, not the whole history. M2's features (cluster size,
        # variant count, churn) are within-shell quantities; feeding it every
        # play across 49 clusters made every player look maximally volatile.
        cluster_plays = tuple(DeckPlay(battle_time=p.battle_time, mode=p.mode,
                                       cards=p.cards, result=p.result)
                              for p in shell)
        example = PredictionExample(
            player_tag=tag, timestamp="9999", domain=domain,
            history=cluster_plays,
            truth=DeckPlay(battle_time="9999", mode="", cards=()),
            cluster_history=cluster_plays)

        p_change, used_artifact = _change_probability(view, example)

        vocab = adapter.player_vocabulary(safe_plays)
        wide = dict(view, pool_override=vocab)
        gen = C.C1WideOneCard(E.E4Combined(E.PopulationExitStats()),
                              S.S2Transition(S.GlobalStats()),
                              width=8, entry_width=999)
        cands = [c for c in gen.generate(wide) if c.size == 1][:40]

        prior = {}
        for out, inc in view.get("prior_edits", []):
            if len(out) == 1 and len(inc) == 1:
                prior[(out[0], inc[0])] = prior.get((out[0], inc[0]), 0) + 1

        sl = SL.build(view["prev_deck"], p_change, cands,
                      lambda c: prior.get((c.exits[0], c.entries[0]), 0),
                      max_alternatives)

        # PHASE 17A. The band is re-cut against measured production outcomes.
        # `shortlist` grades on the research population; 16C showed that put
        # 91.2% of duel reads in "high" at 70.8% accuracy. The model underneath
        # is untouched — only the cut points move, and per domain.
        primary_band = calibration.band(domain, sl.change_probability)

        result = policy.PredictionResult(
            primary_deck=sl.primary,
            primary_confidence=primary_band,
            change_probability=sl.change_probability,
            alternatives=[{"cards": a.cards, "out": list(a.exits),
                           "in": list(a.entries), "confidence": a.confidence,
                           "evidence": a.evidence} for a in sl.alternatives],
            note=sl.note, basis="recent", domain=domain,
            degraded=not used_artifact,
            reason="" if used_artifact else "change model artifact unavailable")

        result = policy.enforce_primary(result, recent_deck)
        result = policy.drop_alternatives_matching_primary(result)
        return policy.cap_alternatives(result, max_alternatives)
    except Exception as exc:                      # never take a screen down
        try:
            deck = sorted(sorted(plays, key=lambda p: p.battle_time)[-1].cards)
        except Exception:
            deck = []
        return policy.safe_fallback(
            deck, "engine error: %s" % type(exc).__name__, domain)


def predict_for_tag(tag: str, domain: str, record_shadow: bool = False,
                    max_alternatives: int = policy.MAX_ALTERNATIVES):
    """Load a player's history and predict. THE production entry point.

    Serves BOTH domains. Phase 14 measured competitive as the stronger case
    (88.7% shortlist coverage against duel's 61.6%), so a duel-only rollout
    would have shipped the weaker half.
    """
    import time as _t
    from . import source
    started = _t.time()
    try:
        plays = source.load_plays(tag, domain)
    except Exception:
        plays = []
    if not plays:
        return policy.safe_fallback([], "no history for %s" % domain, domain)

    result = predict(tag, domain, plays, max_alternatives=max_alternatives)
    if record_shadow:
        try:
            from . import shadow
            view = adapter.build_view(tag, domain, plays)
            shadow.record(tag, domain, result, len(plays),
                          (view or {}).get("cluster_size", 0),
                          1000.0 * (_t.time() - started),
                          anchor_ts=(view or {}).get("ts", ""))
        except Exception:
            pass
    return result


def status() -> dict:
    """For /api/analytics/status — is the engine live or degraded?"""
    model = _load_change_model()
    return {"artifact": os.path.basename(ARTIFACT),
            "artifactLoaded": model is not None,
            "mode": "full" if model is not None else "counting-fallback"}
