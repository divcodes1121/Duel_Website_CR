"""Phase 15 — the production safety rules, as code rather than intentions.

FOURTEEN PHASES OF EVIDENCE REDUCE TO ONE INVARIANT: Recent is the prediction
and the ML layer may only ADD to it. Every attempt to let a model overrule
Recent lost — Phase 4 (chain), Phase 5 (expected utility), Phase 6 (oracle
gating), Phase 7 (selective policy) — so the production design makes that
outcome unreachable instead of merely unlikely.

The seven rules below are each a function with a test. They are written as
guards that RETURN A SAFE VALUE rather than raise, because an analytics screen
that shows the current deck is correct and useful, while one that 500s is
neither.
"""
from __future__ import annotations

from dataclasses import dataclass, field

#: MEASURED ON THE PRODUCTION STACK (Phase 16C backtest, held-out players),
#: superseding the Phase 14 research figures. The old values were graded on a
#: `next-in-cluster` population; production steps to the NEXT PLAY, and the two
#: are not the same question — see `calibration.py`.
#:
#: Phase 14 said competitive 95.7/68.7/15.5 and duel 87.3/62.7/28.9. What the
#: production stack actually delivers, on held-out players, is below. Duel
#: `low` is 47.3% rather than 28.9% because the thresholds moved with it;
#: competitive `low` is None because it had 3 held-out predictions, which
#: estimates nothing.
BAND_ACCURACY = {
    "competitive": {"high": 0.905, "medium": 0.733, "low": None},
    # PHASE 23, FIX 2: this domain is `practice`, not duel. Phase 20D
    # measured it as 97.8% Friendly/Showdown_Friendly, with every native
    # duel row excluded upstream by the 8-card guard.
    #
    # BOTH ROWS ARE DISPROVED AND ARE DIAGNOSTICS ONLY. Phase 19D measured
    # competitive high at 69.1% against the 90.5% below, and practice does
    # not even order. `BAND_SUPPORTED` decides what may be shown; nothing
    # here may reach a screen.
    "practice": {"high": 0.921, "medium": 0.758, "low": 0.473},
}

MAX_ALTERNATIVES = 3


@dataclass
class PredictionResult:
    """What production hands the Coach. No model internals cross this line.

    The UI never sees a logistic score. It sees a deck, a band, and a sentence
    a reader can check.
    """
    primary_deck: list
    primary_confidence: str
    change_probability: float
    alternatives: list = field(default_factory=list)
    note: str = ""
    basis: str = "recent"
    degraded: bool = False
    reason: str = ""
    #: Which population this read describes. Needed at serialisation time
    #: because whether a confidence band may be SHOWN is a per-domain fact —
    #: see `BAND_SUPPORTED`.
    domain: str = ""

    def as_dict(self) -> dict:
        """The user-facing payload. `opponent-read-v2`.

        PHASE 23, FIX 1. `changeProbability` used to be here. It is a rounded
        logistic score — a model internal — and it is the same score measured
        at ECE 0.2806 (competitive) and 0.6097 (practice), so it was both
        internal AND wrong. It stays inside the process for band assignment and
        the shadow log; it no longer crosses this boundary.

        PHASE 23, FIX 3. A band is only serialised for a domain whose ordering
        has been validated. Practice is suppressed: measured over 11,152
        historical steps its player-macro accuracy runs high 65.4% < medium
        69.7% > low 53.5%, so the label does not rank and must not be shown.
        The alternatives go with it, because `ALTERNATIVE_CAPS` is justified by
        the bands meaning something — an unranked band cannot license a
        2/1/0 split.
        """
        show_band = BAND_SUPPORTED.get(self.domain, True)
        primary = {"cards": list(self.primary_deck), "basis": self.basis}
        if show_band:
            primary["confidence"] = self.primary_confidence
        alternatives = self.alternatives if show_band else []
        return {
            "primary": primary,
            "alternatives": [
                {"cards": list(a["cards"]), "out": list(a["out"]),
                 "in": list(a["in"]), "confidence": a["confidence"],
                 "evidence": list(a["evidence"])}
                for a in alternatives],
            "note": self.note,
            "degraded": self.degraded,
            "bandShown": bool(show_band),
        }


#: PHASE 23, FIX 3. Whether a domain's confidence band may be DISPLAYED.
#:
#: This is not about whether a band can be computed - it always can - but about
#: whether it has been shown to rank. Competitive's ordering holds on real
#: outcomes (68.2% > 55.0% > 0.0%, Phase 19D); practice's does not (Phase 20D).
#: A band that does not rank is decoration, and the project has removed
#: decoration before rather than shipped it.
BAND_SUPPORTED = {"competitive": True, "practice": False}


def safe_fallback(deck, reason: str, domain: str = "") -> PredictionResult:
    """RULE 2 and RULE 3. Anything goes wrong -> the current deck, stated plainly."""
    return PredictionResult(
        primary_deck=list(deck or []), primary_confidence="high",
        change_probability=0.0, alternatives=[],
        note="Showing the most recent deck.", basis="recent",
        degraded=True, reason=reason, domain=domain)


def enforce_primary(result: PredictionResult, recent_deck) -> PredictionResult:
    """RULE 1. The ML layer may never change the primary.

    Applied AFTER everything else, so no amount of model output can move it.
    """
    recent = list(recent_deck or [])
    if list(result.primary_deck) != recent:
        result.primary_deck = recent
        result.degraded = True
        result.reason = (result.reason + "; " if result.reason else "") + \
            "primary was not Recent and has been reset"
    return result


def drop_alternatives_matching_primary(result: PredictionResult) -> PredictionResult:
    """An 'alternative' identical to the primary is noise, not an option."""
    primary = frozenset(result.primary_deck)
    result.alternatives = [a for a in result.alternatives
                           if frozenset(a["cards"]) != primary]
    return result


#: RULE 4, made monotonic in Phase 19B. Less confidence must never surface MORE
#: alternatives.
#:
#: The previous implementation capped `high` at 2 and left `low` at 3 — the
#: inverse of its own docstring, so the least trustworthy reads showed the
#: longest list.
#:
#: PHASE 23, FIX 5. The RULE is unchanged and still right; the justification
#: that used to sit here was not. It cited "duel high 92.1%, low 47.3%" as
#: measured fact, and Phases 19D/20D disproved both. The rule now rests on
#: ordering alone: a less trustworthy read must never offer more options, and
#: `BAND_SUPPORTED` withholds the caps entirely from a domain whose bands do
#: not rank.
ALTERNATIVE_CAPS = {"high": 2, "medium": 1, "low": 0}


def cap_alternatives(result: PredictionResult,
                     limit: int = MAX_ALTERNATIVES) -> PredictionResult:
    """RULE 4. A low-confidence read shows fewer options, never more."""
    band_cap = ALTERNATIVE_CAPS.get(result.primary_confidence, 0)
    result.alternatives = result.alternatives[:max(0, min(limit, band_cap))]
    return result


def assert_no_future(plays, cutoff_ts: str) -> list:
    """RULES 5 and 6. Nothing at or after the prediction moment may be used.

    Filters rather than raises: a clock skew on one row should degrade the
    read, not take the screen down.
    """
    if not cutoff_ts:
        return list(plays)
    return [p for p in plays if getattr(p, "battle_time", "") < cutoff_ts]


def forbid_training(model) -> None:
    """RULE 7. Production scores; it does not fit.

    Called on every loaded model so a `fit` reaching production is caught at
    load time rather than discovered from a latency graph.
    """
    if getattr(model, "_production_locked", False):
        return
    if hasattr(model, "fit"):
        def _blocked(*_a, **_k):
            raise RuntimeError(
                "training is offline-only; production must load an artifact")
        model.fit = _blocked
    model._production_locked = True
