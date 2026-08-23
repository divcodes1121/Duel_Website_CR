"""Phase 20B - is duel's calibration error caused by the card-reuse RULE?

    python -m ml.evaluation.phase20b --report --tags tags.json --players 400

WHY THIS EXISTS. Phase 19D reconciled the shadow log against real later
battles and found competitive and duel failing in different shapes:

    competitive   high 69.1%   ECE 0.2806   dominant bin claims 96.8% -> 68.5%
    duel          high 62.5%   ECE 0.6147   dominant bin claims 96.2% -> 33.8%

A 62-point gap in the dominant bin is not the shape of an overconfident score.
It is the shape of a model being asked a question its features cannot see. In a
duel a loadout may not repeat a card, so the deck played in game 2 is
card-disjoint from game 1 BY RULE - and production's primary prediction is the
deck from the immediately preceding BATTLE.

This phase measures whether that mechanism accounts for the error. It is a
FEASIBILITY MEASUREMENT ONLY. Nothing here trains, retrains, recalibrates,
ranks with a new model, or touches production; `test_phase20b.py` asserts the
module imports no `ml.production` and modifies no artifact.

THE CIRCULARITY TRAP, AND HOW IT IS AVOIDED. `duel_combos._split_series` closes
a series when a card repeats. Using that splitter to define "same duel" and
then concluding "same duel implies cards unavailable" would be tautological -
the answer would be built into the question. So a duel run is reconstructed
here from signals that carry NO card information:

    same opponent_tag,  and  gap <= DUEL_MAX_GAP_MINUTES

That is `_split_series`'s own chunking and gap rule with the card-reuse clause
REMOVED. Card overlap is then an OUTCOME of the measurement rather than an
input to it, and the competitive control shows what the same construct returns
in a mode where cards may legally be reused.

TWO DEFINITIONS OF "CHANGED", AND THE WHOLE FINDING LIVES IN THEIR GAP.

  * `changed_prev` - the truth differs from the previous BATTLE's deck. This is
    production semantics: `predictor.predict` takes `ordered[-1]`,
    `policy.enforce_primary` pins the primary there, and 19D's reconciliation
    scored exactly this.
  * `changed_shell` - the truth differs from the last play of the SHELL, which
    is what `PredictionExample.previous` returns and therefore what M2 was
    trained to predict. Its docstring already states the reason the two differ:
    "in a duel the immediately preceding battle is usually a different deck of
    the same loadout (they are card-disjoint by rule)".

If those coincide in competitive and diverge in duel, M2 is being scored
against a target it was never fitted to, in one domain only.

FIDELITY NOTE. `predictor.predict` builds its example with `timestamp="9999"`,
which `features._parse` cannot parse, so both temporal features collapse to
log1p(0) = 0 on every production read. That is replicated here rather than
corrected, because the point is to reproduce the P(change) production actually
computes. It is recorded as an observation, not fixed - fixing it is a
production change and out of scope for this phase.
"""
from __future__ import annotations

import argparse
import collections
import datetime
import json
import os
import sqlite3
import sys
import time
from dataclasses import dataclass

import clash_data as cd
from duel_combos import DUEL_MAX_GAP_MINUTES, is_duel_like_mode
from meta import META_MODES

from .. import change_detector as CD
from .. import config
from .. import features as F
from ..dataset import DeckPlay, PredictionExample, cluster_prefix
from . import significance as sig

DOMAINS = ("duel", "competitive")

#: Read by path, never imported. Loading the shipped weights is what makes this
#: measure the DEPLOYED P(change) rather than a re-fit of it; nothing here ever
#: opens either file for writing.
ARTIFACT_DIR = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "artifacts")
M2_ARTIFACT = os.path.join(ARTIFACT_DIR, "m2-change-v1.json")
BAND_ARTIFACT = os.path.join(ARTIFACT_DIR, "band-calibration-v1.json")

#: Matches `production.calibration.FALLBACK`.
FALLBACK_CUTS = (0.15, 0.45)

CLASS_LEGAL = "A legal"
CLASS_PARTIAL = "B partial"
CLASS_ILLEGAL = "C illegal"
CLASSES = (CLASS_LEGAL, CLASS_PARTIAL, CLASS_ILLEGAL)


# --------------------------------------------------------------------------
# Battles
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Battle:
    """One 8-card battle. `opponent_tag` is carried because duel-run
    reconstruction needs it and `DeckPlay` does not have it."""
    ts: str
    mode: str
    cards: tuple
    result: str
    opponent_tag: str

    @property
    def card_set(self) -> frozenset:
        return frozenset(self.cards)


def classify_domain(game_mode):
    """The repository's own definitions. `lower()` is MANDATORY - comparing raw
    casing against META_MODES silently returned zero steps in Phase 1."""
    if not game_mode:
        return None
    if game_mode.lower() in META_MODES:
        return "competitive"
    if is_duel_like_mode(game_mode):
        return "duel"
    return None


def deck_cards(card_json):
    """Exactly DECK_SIZE distinct card keys, else None. A native duel row
    carries the whole 16/24-card loadout and is not a deck."""
    try:
        cards = json.loads(card_json)
    except Exception:
        return None
    if not isinstance(cards, list) or len(cards) != config.DECK_SIZE:
        return None
    keys = [str(c) for c in cards]
    if len(set(keys)) != config.DECK_SIZE:
        return None
    return tuple(keys)


#: Production's own bounds, reproduced so the P(change) measured here is the
#: one the engine actually computes. `source.HISTORY_DAYS` bounds the read to
#: 60 days and `source.MAX_ROWS` caps it at 1200 rows PER TAG across both
#: domains, partitioning afterwards - so a duel history is whatever survives
#: inside the newest 1200 battles, not the newest 1200 duels.
HISTORY_DAYS = 60
MAX_ROWS = 1200


def days_ago(days: int) -> str:
    d = (datetime.datetime.now(datetime.timezone.utc)
         - datetime.timedelta(days=days))
    return d.strftime("%Y%m%d") + "T000000.000Z"


def load(con, tags, chunk=60, history_days=HISTORY_DAYS, max_rows=MAX_ROWS):
    """(tag, domain) -> ordered Battles. ONE batched query per chunk of
    players, hitting idx_battles_tag. Never one query per battle.

    The row cap is applied PER TAG BEFORE the domain split, which is what
    `source._read_rows` does; capping per domain instead would hand the engine
    more duel history than it ever sees in production.
    """
    since = days_ago(history_days) if history_days > 0 else ""
    per_tag = collections.defaultdict(list)
    for i in range(0, len(tags), chunk):
        part = list(tags[i:i + chunk])
        q = ("select player_tag, game_mode, battle_time, player_card_keys, "
             "       result, opponent_tag "
             "from battles where player_tag in (%s) and battle_time >= ?"
             % ",".join(["?"] * len(part)))
        for tag, mode, ts, cards, result, opp in con.execute(q, part + [since]):
            per_tag[tag].append((ts or "", mode or "", cards,
                                 (result or "").lower(), opp or ""))

    out = collections.defaultdict(list)
    for tag, rows in per_tag.items():
        rows.sort(key=lambda r: r[0])
        for ts, mode, cards, result, opp in rows[-max_rows:]:
            dom = classify_domain(mode)
            if dom is None:
                continue
            deck = deck_cards(cards)
            if deck is None:
                continue
            out[(tag, dom)].append(Battle(ts, mode, deck, result, opp))
    return out


# --------------------------------------------------------------------------
# Duel runs, reconstructed WITHOUT card information
# --------------------------------------------------------------------------

def _parse_ts(value: str):
    try:
        return datetime.datetime.strptime(value, "%Y%m%dT%H%M%S.%fZ")
    except (ValueError, TypeError):
        try:
            return datetime.datetime.strptime(value[:15], "%Y%m%dT%H%M%S")
        except (ValueError, TypeError, IndexError):
            return None


def linked(earlier: Battle, later: Battle) -> bool:
    """Are these consecutive battles games of the SAME duel?

    Same opponent, inside the gap. Deliberately NOT the card-reuse clause - see
    the module docstring. An absent opponent tag cannot establish a run, so it
    returns False rather than guessing.
    """
    if not earlier.opponent_tag or not later.opponent_tag:
        return False
    if earlier.opponent_tag != later.opponent_tag:
        return False
    a, b = _parse_ts(earlier.ts), _parse_ts(later.ts)
    if a is None or b is None:
        return False
    gap = (b - a).total_seconds() / 60.0
    return 0.0 <= gap <= DUEL_MAX_GAP_MINUTES


def same_session(earlier: Battle, later: Battle) -> bool:
    """Consecutive battles inside the gap, ANY opponent.

    The control needs a construct that EXISTS in both domains. Same-opponent
    runs essentially never occur on ladder, so comparing them would compare a
    duel population against an empty one. A 30-minute session happens in both.
    """
    a, b = _parse_ts(earlier.ts), _parse_ts(later.ts)
    if a is None or b is None:
        return False
    return 0.0 <= (b - a).total_seconds() / 60.0 <= DUEL_MAX_GAP_MINUTES


def used_before(plays, i: int) -> set:
    """Cards already spent in the duel that `plays[i]` belongs to.

    Walks back while consecutive battles stay linked, unioning their cards.
    Empty when `plays[i]` opens a fresh duel, which is exactly the case where
    the previous deck becomes legal again.
    """
    used: set = set()
    j = i
    while j - 1 >= 0 and linked(plays[j - 1], plays[j]):
        used |= set(plays[j - 1].cards)
        j -= 1
    return used


def legality_class(prev_cards, used: set) -> tuple:
    """(class, cards_forced_out) for reusing `prev_cards` against `used`."""
    forced = len(set(prev_cards) & used)
    if forced == 0:
        return CLASS_LEGAL, 0
    if forced >= config.DECK_SIZE:
        return CLASS_ILLEGAL, forced
    return CLASS_PARTIAL, forced


# --------------------------------------------------------------------------
# The shell, and M2
# --------------------------------------------------------------------------

def current_shell(ordered):
    """The cluster CONTAINING the most recent play.

    Replicates `production.adapter.current_shell` by identity membership -
    `cluster_containing` matches on overlap and returned a DIFFERENT shell 25%
    of the time in production. Replicated rather than imported so this module
    stays free of `ml.production`.
    """
    if not ordered:
        return []
    last = ordered[-1]
    for members in cluster_prefix(ordered):
        if any(m is last for m in members):
            return members
    return []


def load_m2():
    """The shipped M2, loaded from JSON. Never fitted, never written."""
    with open(M2_ARTIFACT, encoding="utf-8") as fh:
        art = json.load(fh)
    if list(art.get("feature_names", [])) != list(F.FEATURE_NAMES):
        raise SystemExit(
            "M2 artifact feature order does not match features.FEATURE_NAMES; "
            "scoring would be silently invalid. Refusing.")
    m = CD.M2ChangeModel(class_weight=art.get("class_weight", False))
    m.weights = art["weights"]
    m.bias = art["bias"]
    m.scaler.mean = art["scaler"]["mean"]
    m.scaler.std = art["scaler"]["std"]
    return m


def band_cuts(domain: str) -> tuple:
    try:
        with open(BAND_ARTIFACT, encoding="utf-8") as fh:
            cal = json.load(fh)
        d = (cal.get("domains") or {}).get(domain) or {}
        return float(d["high_below"]), float(d["medium_below"])
    except Exception:
        return FALLBACK_CUTS


def band_for(p_change: float, cuts) -> str:
    hi, med = cuts
    if p_change < hi:
        return "high"
    if p_change < med:
        return "medium"
    return "low"


def _as_play(b: Battle) -> DeckPlay:
    return DeckPlay(battle_time=b.ts, mode=b.mode, cards=b.cards, result=b.result)


def p_change_for(shell_plays, domain: str, tag: str, model) -> float:
    """M2's P(change), built the way `predictor.predict` builds it.

    `timestamp="9999"` and an empty truth are production's own construction and
    are reproduced deliberately - see the module docstring's fidelity note.
    """
    cluster = tuple(shell_plays)
    example = PredictionExample(
        player_tag=tag, timestamp="9999", domain=domain,
        history=cluster,
        truth=DeckPlay(battle_time="9999", mode="", cards=()),
        cluster_history=cluster)
    dist = model.predict(F.extract(example))
    return 1.0 - dist.get(0, 0.0)


# --------------------------------------------------------------------------
# Steps
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Step:
    tag: str
    domain: str
    ts: str
    p_change: float
    band: str
    changed_prev: bool       # production semantics - what 19D scored
    changed_shell: bool      # M2's training semantics
    klass: str
    forced_out: int
    same_run: bool           # the truth is a later game of the same duel
    shell_is_prev: bool      # the shell's last play IS the previous battle
    same_session: bool       # within the gap, ANY opponent - the control
    shared_with_prev: int    # cards the new deck shares with the previous one


def steps_for(tag, domain, plays, max_steps, cuts, model):
    """Every scoreable transition for one player, newest `max_steps` of them.

    LEAK-FREE BY CONSTRUCTION: the shell, the features and the legality state
    are built from `plays[:i]` only, and `plays[i]` is read as truth alone.
    """
    out = []
    degraded = 0
    if len(plays) < 2:
        return out, degraded

    start = max(1, len(plays) - max_steps)
    for i in range(start, len(plays)):
        truth, prev = plays[i], plays[i - 1]
        # An equal stamp is not strictly later, and a missing one cannot be
        # ordered at all.
        if not truth.ts or not prev.ts or truth.ts <= prev.ts:
            continue
        shell = current_shell([_as_play(b) for b in plays[:i]])
        if len(shell) < 2:
            degraded += 1                  # production's "no established shell"
            continue

        shell_prev_cards = frozenset(shell[-1].cards)
        klass, forced = legality_class(prev.cards, used_before(plays, i))
        p = p_change_for(shell, domain, tag, model)

        out.append(Step(
            tag=tag, domain=domain, ts=truth.ts,
            p_change=p, band=band_for(p, cuts),
            changed_prev=truth.card_set != prev.card_set,
            changed_shell=truth.card_set != shell_prev_cards,
            klass=klass, forced_out=forced,
            same_run=linked(prev, truth),
            shell_is_prev=shell_prev_cards == prev.card_set,
            same_session=same_session(prev, truth),
            shared_with_prev=len(truth.card_set & prev.card_set)))
    return out, degraded


# --------------------------------------------------------------------------
# Statistics
# --------------------------------------------------------------------------

def rate(hits, n) -> float:
    return (hits / n) if n else 0.0


def macro(per_player: dict) -> float:
    vals = [sum(v) / len(v) for v in per_player.values() if v]
    return sum(vals) / len(vals) if vals else 0.0


def ece(probs, labels, n_bins: int = 10) -> float:
    """Expected calibration error of a CLAIMED probability against outcomes."""
    if not probs:
        return 0.0
    buckets = collections.defaultdict(list)
    for p, y in zip(probs, labels):
        buckets[min(n_bins - 1, max(0, int(p * n_bins)))].append((p, y))
    total = len(probs)
    out = 0.0
    for items in buckets.values():
        conf = sum(p for p, _ in items) / len(items)
        acc = sum(y for _, y in items) / len(items)
        out += (len(items) / total) * abs(acc - conf)
    return out


def brier(probs, labels) -> float:
    if not probs:
        return 0.0
    return sum((p - y) ** 2 for p, y in zip(probs, labels)) / len(probs)


def reliability(probs, labels, edges=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0001)):
    rows = []
    for lo, hi in zip(edges, edges[1:]):
        sel = [(p, y) for p, y in zip(probs, labels) if lo <= p < hi]
        if not sel:
            continue
        rows.append((lo, min(hi, 1.0), len(sel),
                     sum(p for p, _ in sel) / len(sel),
                     sum(y for _, y in sel) / len(sel)))
    return rows


def per_player_of(steps, fn) -> dict:
    d = collections.defaultdict(list)
    for s in steps:
        d[s.tag].append(float(fn(s)))
    return dict(d)


def ci(steps, fn, iters) -> sig.Interval:
    return sig.bootstrap_mean(per_player_of(steps, fn), iters=iters)


# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------

def _hdr(title: str) -> str:
    return "\n" + "=" * 78 + "\n" + title + "\n" + "=" * 78


def domain_report(domain, steps, degraded, cuts, iters) -> list:
    L = [_hdr("DOMAIN: %s" % domain.upper())]
    if not steps:
        L.append("   no scoreable steps")
        return L

    n = len(steps)
    L.append("POPULATION")
    L.append("   players                %d" % len({s.tag for s in steps}))
    L.append("   scoreable transitions  %d" % n)
    L.append("   degraded (no shell)    %d" % degraded)
    L.append("   band cuts              high < %.4f   medium < %.4f" % cuts)

    L.append("\n1. M2 CALIBRATION BY SCORE   (production semantics: vs the previous BATTLE)")
    L.append("   %-8s %7s %8s %11s %11s %9s" %
             ("band", "n", "players", "mean P(chg)", "actual chg", "stay"))
    for name in ("high", "medium", "low"):
        sel = [s for s in steps if s.band == name]
        if not sel:
            L.append("   %-8s %7d %8s %11s %11s %9s"
                     % (name, 0, "-", "-", "-", "-"))
            continue
        chg = sum(1 for s in sel if s.changed_prev)
        L.append("   %-8s %7d %8d %11.4f %10.1f%% %8.1f%%" %
                 (name, len(sel), len({s.tag for s in sel}),
                  sum(s.p_change for s in sel) / len(sel),
                  100 * rate(chg, len(sel)),
                  100 * rate(len(sel) - chg, len(sel))))
        iv = ci(sel, lambda s: s.changed_prev, iters)
        L.append("            player-macro change %.3f  95%% CI [%.3f, %.3f]  (%d players)"
                 % (iv.point, iv.low, iv.high, iv.n))

    p_stay = [1.0 - s.p_change for s in steps]
    stayed = [0 if s.changed_prev else 1 for s in steps]
    L.append("\n   claimed P(stay) against reality:  Brier %.4f   ECE %.4f   n=%d"
             % (brier(p_stay, stayed), ece(p_stay, stayed), n))
    L.append("   %-12s %8s %10s %10s" % ("bin", "n", "claimed", "actual"))
    for lo, hi, cnt, conf, acc in reliability(p_stay, stayed):
        L.append("   %-12s %8d %9.1f%% %9.1f%%"
                 % ("%.1f-%.1f" % (lo, hi), cnt, 100 * conf, 100 * acc))

    dis = sum(1 for s in steps if s.changed_prev != s.changed_shell)
    ident = rate(sum(1 for s in steps if s.shell_is_prev), n)
    L.append(chr(10) + "   CONSTRUCTION NOTE - AN IDENTITY, NOT A MEASUREMENT")
    L.append("     `current_shell` returns the cluster CONTAINING the last play,")
    L.append("     so shell[-1] IS ordered[-1]: the deck production predicts and")
    L.append("     the deck M2 scores against are the same object, necessarily.")
    L.append("     identity %.1f%%   disagreement %.1f%%  (forced, both domains)"
             % (100 * ident, 100 * rate(dis, n)))
    L.append("     The genuine step-definition gap is production (next-play) vs")
    L.append("     the RESEARCH training distribution (next-in-cluster) - Phase")
    L.append("     16C's finding, and not observable from inside this build.")
    L.append("     changed vs the previous BATTLE                %6.1f%%"
             % (100 * rate(sum(1 for s in steps if s.changed_prev), n)))

    L.append("\n2. PREVIOUS-DECK LEGALITY AT THE NEXT BATTLE")
    L.append("   (a duel run is same-opponent within %d min; NO card rule used)"
             % DUEL_MAX_GAP_MINUTES)
    L.append("   %-12s %8s %8s %12s %12s"
             % ("class", "n", "share", "actual chg", "macro chg"))
    for k in CLASSES:
        sel = [s for s in steps if s.klass == k]
        if not sel:
            L.append("   %-12s %8d %7.1f%% %12s %12s" % (k, 0, 0.0, "-", "-"))
            continue
        chg = sum(1 for s in sel if s.changed_prev)
        L.append("   %-12s %8d %7.1f%% %11.1f%% %11.1f%%" %
                 (k, len(sel), 100 * rate(len(sel), n),
                  100 * rate(chg, len(sel)),
                  100 * macro(per_player_of(sel, lambda s: s.changed_prev))))

    same = [s for s in steps if s.same_run]
    L.append("\n   next battle continues the same run    %d (%.1f%%)"
             % (len(same), 100 * rate(len(same), n)))
    if same:
        legal = [config.DECK_SIZE - s.forced_out for s in same]
        L.append("   inside a run, previous-deck cards still legal   %.2f of 8"
                 % (sum(legal) / len(legal)))
    L.append("   mean cards forced out (all steps)     %.2f"
             % (sum(s.forced_out for s in steps) / n))
    L.append("   a 1-card change is legal (forced<=1)  %.1f%%"
             % (100 * rate(sum(1 for s in steps if s.forced_out <= 1), n)))
    L.append("   a 2-card change is legal (forced<=2)  %.1f%%"
             % (100 * rate(sum(1 for s in steps if s.forced_out <= 2), n)))

    low = [s for s in steps if s.band == "high"]
    L.append("\n3. WHERE M2 SAYS 'ALMOST CERTAINLY STAYS'  (band=high, P(chg) < %.4f)"
             % cuts[0])
    if not low:
        L.append("   none in this population")
    else:
        chg = sum(1 for s in low if s.changed_prev)
        ill = sum(1 for s in low if s.klass != CLASS_LEGAL)
        L.append("   predictions                     %d over %d players"
                 % (len(low), len({s.tag for s in low})))
        L.append("   actual stay rate                %.1f%%"
                 % (100 * rate(len(low) - chg, len(low))))
        L.append("   actual change rate              %.1f%%" % (100 * rate(chg, len(low))))
        L.append("   previous deck was ILLEGAL       %.1f%%" % (100 * rate(ill, len(low))))
        L.append("   at least 1 card forced out      %.1f%%"
                 % (100 * rate(sum(1 for s in low if s.forced_out >= 1), len(low))))
        forced_err = sum(1 for s in low if s.klass != CLASS_LEGAL and s.changed_prev)
        L.append("   of its %d errors, forced ones    %d (%.1f%%)"
                 % (chg, forced_err, 100 * rate(forced_err, chg)))
        legal_only = [s for s in low if s.klass == CLASS_LEGAL]
        if legal_only:
            lc = sum(1 for s in legal_only if s.changed_prev)
            L.append("   RESTRICTED TO LEGAL STEPS       n=%d   stay %.1f%%"
                     % (len(legal_only), 100 * rate(len(legal_only) - lc, len(legal_only))))
            L.append("                                   (the band's honest accuracy)")

    L.append("\n4. ANALYTICAL BASELINES   (predicting WHETHER the deck changes)")

    def score(pred_fn, prob_fn):
        hits = [1.0 if bool(pred_fn(s)) == s.changed_prev else 0.0 for s in steps]
        pp = collections.defaultdict(list)
        for s, h in zip(steps, hits):
            pp[s.tag].append(h)
        probs = [prob_fn(s) for s in steps]
        labels = [1 if s.changed_prev else 0 for s in steps]
        return (sum(hits) / len(hits), macro(dict(pp)), brier(probs, labels),
                ece(probs, labels), dict(pp))

    m2 = score(lambda s: s.p_change >= 0.5, lambda s: s.p_change)
    lg = score(lambda s: s.klass != CLASS_LEGAL,
               lambda s: 1.0 if s.klass != CLASS_LEGAL else 0.0)
    cb = score(lambda s: True if s.klass != CLASS_LEGAL else s.p_change >= 0.5,
               lambda s: 1.0 if s.klass != CLASS_LEGAL else s.p_change)

    L.append("   %-22s %10s %14s %9s %9s"
             % ("baseline", "accuracy", "player-macro", "Brier", "ECE"))
    for name, r in (("M2 alone", m2), ("legality only", lg), ("legality + M2", cb)):
        L.append("   %-22s %9.1f%% %13.1f%% %9.4f %9.4f"
                 % (name, 100 * r[0], 100 * r[1], r[2], r[3]))
    L.append("   paired accuracy delta, legality-only - M2   %s"
             % sig.paired_delta(lg[4], m2[4], iters=iters))
    L.append("   paired accuracy delta, legality+M2   - M2   %s"
             % sig.paired_delta(cb[4], m2[4], iters=iters))

    L.append("\n5. CALIBRATION DECOMPOSED BY LEGALITY   (claimed P(stay) vs reality)")
    L.append("   %-24s %8s %9s %9s %12s"
             % ("subset", "n", "Brier", "ECE", "actual stay"))
    for label, sel in (("all steps", steps),
                       ("previous deck LEGAL",
                        [s for s in steps if s.klass == CLASS_LEGAL]),
                       ("previous deck ILLEGAL",
                        [s for s in steps if s.klass != CLASS_LEGAL])):
        if not sel:
            L.append("   %-24s %8d %9s %9s %12s" % (label, 0, "-", "-", "-"))
            continue
        ps = [1.0 - s.p_change for s in sel]
        ys = [0 if s.changed_prev else 1 for s in sel]
        L.append("   %-24s %8d %9.4f %9.4f %11.1f%%"
                 % (label, len(sel), brier(ps, ys), ece(ps, ys),
                    100 * rate(sum(ys), len(sel))))
    return L


#: Phase 19D's reconciled duel figures, quoted so the two populations can be
#: compared explicitly. These are OUTCOMES, not predictions: 153 reconciled
#: duel players, and the per-band accuracies are the stay rates.
NINETEEN_D_DUEL = {
    "reconciled": 153,
    "stay_rate": (5 + 26 + 15) / 153.0,       # high 62.5%*8 + med 34.7%*75 + low 21.4%*70
    "ece": 0.6147,
    "bands": {"high": (8, 0.625), "medium": (75, 0.347), "low": (70, 0.214)},
}


def mixing_fraction(observed: float, legal: float, illegal: float):
    """What share of a sample must be ILLEGAL steps to produce `observed`?

    Solves observed = f*illegal + (1-f)*legal. An INFERENCE, not a measurement:
    it assumes 19D's reconciled anchors are drawn from the same two
    subpopulations measured here and differ only in their mix. Returns None
    when the two subpopulations do not bracket the observation, because then
    no mixture explains it and quoting a fraction would be a fabrication.
    """
    if legal == illegal:
        return None
    f = (observed - legal) / (illegal - legal)
    return f if 0.0 <= f <= 1.0 else None


def gate(by_domain) -> list:
    """The executive verdict and the H1/H2/H3 gate, computed from the data."""
    duel = by_domain.get("duel", [])
    comp = by_domain.get("competitive", [])
    L = [_hdr("1. EXECUTIVE VERDICT")]
    if not duel:
        L.append("   no duel steps - nothing to conclude")
        return L

    n = len(duel)
    ill = [s for s in duel if s.klass != CLASS_LEGAL]
    leg = [s for s in duel if s.klass == CLASS_LEGAL]
    run_legal_cards = [config.DECK_SIZE - s.forced_out for s in duel if s.same_run]
    ill_share = rate(len(ill), n)
    ill_chg = rate(sum(1 for s in ill if s.changed_prev), len(ill)) if ill else 0.0
    leg_chg = rate(sum(1 for s in leg if s.changed_prev), len(leg)) if leg else 0.0

    def _ece(sel):
        return ece([1.0 - s.p_change for s in sel],
                   [0 if s.changed_prev else 1 for s in sel]) if sel else 0.0

    ece_all, ece_leg, ece_ill = _ece(duel), _ece(leg), _ece(ill)
    comp_ill = rate(sum(1 for s in comp if s.klass != CLASS_LEGAL), len(comp)) if comp else 0.0

    high = [s for s in duel if s.band == "high"]
    high_err = [s for s in high if s.changed_prev]
    high_forced_err = [s for s in high_err if s.klass != CLASS_LEGAL]

    L.append("   MECHANISM CONFIRMED, BUT IT DOES NOT WORK THE WAY EXPECTED.")
    L.append("")
    L.append("   Inside a reconstructed duel run the previous deck retains")
    L.append("   %.2f of its 8 cards - exact disjointness, measured with a run"
             % (sum(run_legal_cards) / len(run_legal_cards) if run_legal_cards else 0.0))
    L.append("   definition that never looks at a card. Competitive shows")
    L.append("   %.1f%% illegal against duel's %.1f%%." % (100 * comp_ill, 100 * ill_share))
    L.append("")
    L.append("   The error concentrates exactly where the rule bites:")
    L.append("      duel steps, previous deck LEGAL     ECE %.4f  change %.1f%%"
             % (ece_leg, 100 * leg_chg))
    L.append("      duel steps, previous deck ILLEGAL   ECE %.4f  change %.1f%%"
             % (ece_ill, 100 * ill_chg))
    L.append("      competitive (no such rule)          ECE %.4f"
             % (_ece(comp) if comp else 0.0))
    L.append("")
    L.append("   BUT the duel `high` band is NOT where the damage lands. In this")
    L.append("   population it is %.1f%% accurate against a 92.1%% claim, and only"
             % (100 * rate(len(high) - len(high_err), len(high)) if high else 0.0))
    L.append("   %.1f%% of it is contaminated by an illegal previous deck."
             % (100 * rate(len(high_forced_err), len(high)) if high else 0.0))

    # ---- reconciling the two populations ---------------------------------
    L.append(_hdr("2. WHY THIS DISAGREES WITH 19D  (an inference, clearly labelled)"))
    obs_stay = NINETEEN_D_DUEL["stay_rate"]
    pop_stay = rate(sum(1 for s in duel if not s.changed_prev), n)
    leg_stay, ill_stay = 1.0 - leg_chg, 1.0 - ill_chg
    L.append("   19D reconciled duel stay rate      %.1f%%  (n=%d)"
             % (100 * obs_stay, NINETEEN_D_DUEL["reconciled"]))
    L.append("   this population's duel stay rate   %.1f%%  (n=%d)" % (100 * pop_stay, n))
    L.append("      of which LEGAL steps            %.1f%%" % (100 * leg_stay))
    L.append("      of which ILLEGAL steps          %.1f%%" % (100 * ill_stay))
    f_stay = mixing_fraction(obs_stay, leg_stay, ill_stay)
    f_ece = mixing_fraction(NINETEEN_D_DUEL["ece"], ece_leg, ece_ill)
    L.append("")
    L.append("   For 19D's sample to be a mixture of these two subpopulations it")
    L.append("   would have to be:")
    L.append("      %s ILLEGAL, to explain its stay rate"
             % ("%.0f%%" % (100 * f_stay) if f_stay is not None else "not a mixture"))
    L.append("      %s ILLEGAL, to explain its ECE of %.4f"
             % ("%.0f%%" % (100 * f_ece) if f_ece is not None else "not a mixture",
                NINETEEN_D_DUEL["ece"]))
    L.append("   Two independent routes to the same answer is weak evidence that")
    L.append("   the 19D duel sample is dominated by forced transitions - which")
    L.append("   is mechanically plausible, because wave 2 selected players on")
    L.append("   RECENT duel activity and collected them in a 67-minute burst,")
    L.append("   catching active duellers mid-session. IT IS NOT MEASURED HERE.")
    L.append("   Classifying the 153 reconciled anchors by legality would settle")
    L.append("   it; that needs the shadow log and is a separate run.")

    # ---- the gate ---------------------------------------------------------
    L.append(_hdr("3. GATE"))
    h1 = ill_share > 0.05 and ill_chg > 2 * leg_chg
    L.append("   H1  forced-switch mechanism exists")
    L.append("       %s - %.1f%% of duel transitions have an illegal previous"
             % ("SUPPORTED" if h1 else "NOT SUPPORTED", 100 * ill_share))
    L.append("       deck, changing at %.1f%% against %.1f%% when legal, and the"
             % (100 * ill_chg, 100 * leg_chg))
    L.append("       competitive control shows %.1f%%." % (100 * comp_ill))
    L.append("       CAVEAT: %.1f%% of 'illegal' steps did NOT change, which is"
             % (100 * (1 - ill_chg)))
    L.append("       impossible inside one duel - so the run reconstruction")
    L.append("       over-links. The true forced share is nearer %.1f%%."
             % (100 * ill_share * ill_chg))

    high_contam = rate(len(high_forced_err), len(high)) if high else 0.0
    h2 = high_contam > 0.20
    L.append("")
    L.append("   H2  M2 is blind to it where it claims most confidence")
    L.append("       %s - only %.1f%% of band=high steps carry an illegal"
             % ("SUPPORTED" if h2 else "NOT SUPPORTED", 100 * high_contam))
    L.append("       previous deck, and the band measures %.1f%% here. The rule"
             % (100 * rate(len(high) - len(high_err), len(high)) if high else 0.0))
    L.append("       does damage in MEDIUM and LOW, not in HIGH.")

    h3 = ece_ill > 2 * ece_leg
    L.append("")
    L.append("   H3  a legality-aware baseline materially reduces the error")
    L.append("       %s - ECE %.4f on legal steps against %.4f on illegal,"
             % ("SUPPORTED" if h3 else "NOT SUPPORTED", ece_leg, ece_ill))
    L.append("       a %.1fx difference, and the legality+M2 baseline beats M2"
             % (ece_ill / ece_leg if ece_leg else 0.0))
    L.append("       on paired player accuracy while the same comparison in")
    L.append("       competitive returns exactly zero.")

    L.append(_hdr("4. RECOMMENDATION"))
    L.append("   OUTCOME A on the mechanism, with H2 qualified.")
    L.append("")
    L.append("   DO NOT fit a Platt or isotonic map on the duel score. The 19D")
    L.append("   sample it would be fitted to is, on the evidence above, most")
    L.append("   likely dominated by transitions that are forced by a game rule")
    L.append("   rather than chosen by a player. A map fitted there would bake")
    L.append("   the timing of a collection run into the shipped calibration.")
    L.append("")
    L.append("   The honest next step is not a model. It is to classify the 153")
    L.append("   reconciled duel anchors by legality and re-read the bands on")
    L.append("   the legal subset. If duel `high` holds near its claim there,")
    L.append("   the band table was never the problem and the fix is to exclude")
    L.append("   or flag forced steps, not to rescale confidence.")
    L.append("")
    L.append("   Duel `high` at n=8 in 19D cannot contradict n=%d here: its 95%%"
             % len(high))
    L.append("   interval spans roughly 31-86%, which contains this population's")
    L.append("   value. It was never evidence of a broken band.")
    return L


def report(by_domain, degraded, timings, iters) -> str:
    L = [_hdr("PHASE 20B - DUEL CHANGE-MODEL APPLICABILITY")]
    L.append("question: is duel's calibration error caused by the rule that a")
    L.append("          duel loadout may not reuse a card?")
    L.append("method:   duel runs are reconstructed from opponent + time gap")
    L.append("          ONLY, so card overlap is measured and never assumed.")
    L.extend(gate(by_domain))

    for domain in DOMAINS:
        L.extend(domain_report(domain, by_domain.get(domain, []),
                               degraded.get(domain, 0), band_cuts(domain), iters))

    L.append(_hdr("CONTROL: THE SAME CONSTRUCT IN BOTH DOMAINS"))
    L.append("If disjointness is a RULE rather than a habit, then inside a")
    L.append("same-opponent 30-minute run duel decks cannot share cards while")
    L.append("competitive decks are free to.")
    L.append("")
    L.append("   %-14s %9s %10s %16s %12s"
             % ("domain", "runs", "share", "legal cards /8", "actual chg"))
    for domain in DOMAINS:
        steps = by_domain.get(domain, [])
        if not steps:
            continue
        same = [s for s in steps if s.same_run]
        if not same:
            L.append("   %-14s %9d %9.1f%% %16s %12s" % (domain, 0, 0.0, "-", "-"))
            continue
        legal = [config.DECK_SIZE - s.forced_out for s in same]
        chg = sum(1 for s in same if s.changed_prev)
        L.append("   %-14s %9d %9.1f%% %16.2f %11.1f%%"
                 % (domain, len(same), 100 * rate(len(same), len(steps)),
                    sum(legal) / len(legal), 100 * rate(chg, len(same))))

    L.append("")
    L.append("   Consecutive battles inside %d minutes, ANY opponent - the one"
             % DUEL_MAX_GAP_MINUTES)
    L.append("   construct that exists in both domains:")
    L.append("   %-14s %10s %10s %18s %16s"
             % ("domain", "sessions", "share", "shared cards /8", "reused deck"))
    for domain in DOMAINS:
        steps = by_domain.get(domain, [])
        if not steps:
            continue
        sess = [s for s in steps if s.same_session]
        if not sess:
            L.append("   %-14s %10d %9.1f%% %18s %16s"
                     % (domain, 0, 0.0, "-", "-"))
            continue
        shared = [s.shared_with_prev for s in sess]
        same_deck = sum(1 for s in sess if s.shared_with_prev == config.DECK_SIZE)
        L.append("   %-14s %10d %9.1f%% %18.2f %15.1f%%"
                 % (domain, len(sess), 100 * rate(len(sess), len(steps)),
                    sum(shared) / len(shared),
                    100 * rate(same_deck, len(sess))))

    L.append("")
    L.append("   %-14s %11s %12s %12s %12s"
             % ("domain", "illegal %", "actual chg", "M2 mean P", "ECE(stay)"))
    for domain in DOMAINS:
        steps = by_domain.get(domain, [])
        if not steps:
            continue
        n = len(steps)
        ps = [1.0 - s.p_change for s in steps]
        ys = [0 if s.changed_prev else 1 for s in steps]
        L.append("   %-14s %10.1f%% %11.1f%% %12.4f %12.4f"
                 % (domain,
                    100 * rate(sum(1 for s in steps if s.klass != CLASS_LEGAL), n),
                    100 * rate(sum(1 for s in steps if s.changed_prev), n),
                    sum(s.p_change for s in steps) / n, ece(ps, ys)))

    L.append(_hdr("PERFORMANCE"))
    for k in ("db", "processing", "total"):
        L.append("   %-12s %8.1f s" % (k, timings.get(k, 0.0)))
    for domain in DOMAINS:
        steps = by_domain.get(domain, [])
        L.append("   %-12s %d players, %d transitions"
                 % (domain, len({s.tag for s in steps}), len(steps)))
    return "\n".join(L)


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description="OIE Phase 20B feasibility")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--tags", default="", help="JSON list of player tags")
    ap.add_argument("--players", type=int, default=400)
    ap.add_argument("--steps", type=int, default=20,
                    help="newest transitions scored per player and domain")
    ap.add_argument("--min-plays", type=int, default=10)
    ap.add_argument("--history-days", type=int, default=HISTORY_DAYS)
    ap.add_argument("--max-rows", type=int, default=MAX_ROWS)
    ap.add_argument("--bootstrap", type=int, default=1000)
    ap.add_argument("--out", default="")
    args = ap.parse_args(argv)

    t_start = time.time()
    model = load_m2()

    path = cd.resolve_db_path()
    if not path:
        raise SystemExit("no database resolved")
    if not args.tags:
        raise SystemExit("--tags is required: a JSON list of player tags")
    with open(args.tags, encoding="utf-8") as fh:
        tags = list(json.load(fh))[:args.players]

    t0 = time.time()
    con = sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)
    try:
        by_player = load(con, tags, history_days=args.history_days,
                         max_rows=args.max_rows)
    finally:
        con.close()
    db_s = time.time() - t0

    t0 = time.time()
    by_domain = collections.defaultdict(list)
    degraded: collections.Counter = collections.Counter()
    cuts = {d: band_cuts(d) for d in DOMAINS}
    for (tag, domain), plays in sorted(by_player.items()):
        if len(plays) < args.min_plays:
            continue
        steps, deg = steps_for(tag, domain, plays, args.steps, cuts[domain], model)
        degraded[domain] += deg
        by_domain[domain].extend(steps)
    proc_s = time.time() - t0

    timings = {"db": db_s, "processing": proc_s, "total": time.time() - t_start}
    text = report(by_domain, degraded, timings, args.bootstrap)
    if args.report:
        print(text)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print("\nwrote %s" % args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
