"""M3 — the conditional substitution model, as an ABLATION LADDER.

THE QUESTION IS NARROWER THAN "what deck next". M2 answers whether an edit is
coming (competitive ROC-AUC 0.932, duel 0.803). It could not be exploited,
because the only alternative available was Modal and Modal gets just 16.3% /
15.1% of change events right. So this module asks the next question down:

    GIVEN that an edit happens, which card ENTERS?

and it is trained and scored on CHANGE EVENTS ONLY. Training on all 331,800
steps would dilute the 13% that are the actual event of interest.

THE LADDER. Each rung adds exactly one source of information, so a gain can be
attributed to that source rather than to "the model got bigger":

    S0  global frequency                      population prior
    S1  + player history                      the Phase 1 baseline
    S2  + outgoing card                       THE KEY EXPERIMENT
    S3  + opponent archetype
    S4  + opponent deck
    S5  + previous result

S2 IS AN ORACLE ON THE EXIT. It conditions on which card actually left, which
production would have to predict separately. That is deliberate and is what
makes it an ablation: it measures whether stable substitution PATTERNS exist at
all. Its score is an upper bound given a perfect exit predictor, and
`ExitRanker` measures how reachable that bound is.

Every rung backs off: a context with too little support falls through to the
rung below rather than inventing a probability from one observation.
"""
from __future__ import annotations

import collections
import math
from typing import Iterable, Sequence

#: A context must be seen this often before it is trusted on its own. Below it
#: the rung contributes proportionally less and the backoff carries the rest.
MIN_SUPPORT = 3.0


def _norm(counter: collections.Counter) -> dict:
    total = sum(counter.values())
    if not total:
        return {}
    return {k: v / total for k, v in counter.items()}


def _blend(layers: Sequence[tuple[dict, float]], pool: Iterable[str]) -> list[str]:
    """Rank `pool` by a weighted sum of distributions, strongest layer first.

    Layers are (distribution, weight). A layer with no mass simply contributes
    nothing, which is how backoff happens without a special case.
    Ties break on the card key so identical evidence always ranks identically.
    """
    score: dict = collections.defaultdict(float)
    for dist, weight in layers:
        if not dist or weight <= 0:
            continue
        for card, p in dist.items():
            score[card] += weight * p
    return sorted(pool, key=lambda c: (-score.get(c, 0.0), c))


def _confidence(n: float) -> float:
    """Support-scaled trust in [0, 1). One observation is never worth much."""
    return n / (n + MIN_SUPPORT)


class GlobalStats:
    """Counts fitted on TRAIN change events only. Never on test."""

    def __init__(self):
        self.incoming: collections.Counter = collections.Counter()
        self.transition: dict = collections.defaultdict(collections.Counter)

    def fit(self, events: Iterable[dict]) -> "GlobalStats":
        for ev in events:
            for card in ev["incoming"]:
                self.incoming[card] += 1
                for out in ev["outgoing"]:
                    self.transition[out][card] += 1
        return self

    @property
    def incoming_dist(self) -> dict:
        return _norm(self.incoming)


# --------------------------------------------------------------------------
# Per-event player evidence, built from the PREFIX carried on the event
# --------------------------------------------------------------------------

def player_card_dist(ev: dict) -> dict:
    """How often this player has fielded each card in this shell.

    This IS the Phase 1 'player-history frequency' baseline, reproduced so the
    ladder's first rung is the number already on record (competitive top-1
    30.2%, duel 27.3%) rather than a near-miss reimplementation.
    """
    return _norm(collections.Counter(ev["cluster_card_counts"]))


def _shrunk(counts: collections.Counter, support: float) -> dict:
    """count / (support + MIN_SUPPORT) — a Dirichlet-style shrunk estimate.

    THIS IS WHY IT IS NOT `count / support`. A single observed transition
    normalises to probability 1.0, which then beats a card the player has
    fielded forty times. The leftover mass is deliberately left UNASSIGNED so
    a thin layer simply contributes little and the layer below carries the
    ranking, rather than being overridden by one data point.
    """
    return {k: v / (support + MIN_SUPPORT) for k, v in counts.items()}


def player_transition_dist(ev: dict, outgoing: Sequence[str]) -> tuple[dict, float]:
    """P(incoming | outgoing) from this player's OWN prior edits, SHRUNK.

    Returns (distribution, support). Support is the number of prior edits that
    shared an outgoing card, so a player with one recorded swap cannot produce
    a confident prediction.
    """
    counts: collections.Counter = collections.Counter()
    support = 0.0
    outs = set(outgoing)
    for prior_out, prior_in in ev["prior_edits"]:
        if outs & set(prior_out):
            for card in prior_in:
                counts[card] += 1
            support += 1
    return _shrunk(counts, support), support


def player_context_dist(ev: dict, key: str, value) -> tuple[dict, float]:
    """P(incoming | some prior-edit context) — the S3/S4/S5 rungs.

    `key` names a field recorded alongside each prior edit; `value` is what the
    current event has. Matching prior edits vote for their incoming cards.
    """
    counts: collections.Counter = collections.Counter()
    support = 0.0
    for edit in ev["prior_edit_ctx"]:
        if edit.get(key) == value and value not in (None, ""):
            for card in edit["in"]:
                counts[card] += 1
            support += 1
    return _shrunk(counts, support), support


# --------------------------------------------------------------------------
# The ladder
# --------------------------------------------------------------------------

class Ranker:
    """Base: every rung ranks the same candidate pool the same way."""
    name = "ranker"

    def __init__(self, stats: GlobalStats):
        self.stats = stats

    @staticmethod
    def pool(ev: dict) -> list[str]:
        """Candidates = every card the player has fielded in this shell, minus
        the deck they are editing. A card already in the deck cannot enter it.

        The pool is deliberately the PLAYER's vocabulary rather than all 123
        cards: Phase 1 measured that 61.8% (duel) / 77.7% (competitive) of
        incoming cards had been seen before, and that ceiling is a property of
        the task worth keeping visible rather than hiding behind a global pool.
        """
        prev = set(ev["prev_deck"])
        # PHASE 9: an explicit wider vocabulary wins when one is supplied.
        # Phase 8 measured the shell-scoped pool as the binding constraint —
        # it caps 1-card recall at 54.7%/61.2% where a player-wide pool
        # reaches 89.1%/91.3% — so the pool is now an input, not a derivation.
        override = ev.get("pool_override")
        if override:
            return sorted(set(override) - prev)
        return sorted(set(ev["cluster_card_counts"]) - prev)

    def rank(self, ev: dict) -> list[str]:
        raise NotImplementedError


class S0Global(Ranker):
    name = "S0 global"

    def rank(self, ev: dict) -> list[str]:
        return _blend([(self.stats.incoming_dist, 1.0)], self.pool(ev))


class S1Player(Ranker):
    name = "S1 player"

    def rank(self, ev: dict) -> list[str]:
        return _blend([(player_card_dist(ev), 1.0),
                       (self.stats.incoming_dist, 0.01)], self.pool(ev))


class S2Transition(Ranker):
    """THE KEY EXPERIMENT. Oracle on which card left."""
    name = "S2 +outgoing"

    def rank(self, ev: dict) -> list[str]:
        dist, support = player_transition_dist(ev, ev["outgoing"])
        gt = _norm(collections.Counter(
            {c: n for out in ev["outgoing"]
             for c, n in self.stats.transition.get(out, {}).items()}))
        # The transition layer is already shrunk by support, so it needs no
        # extra confidence multiplier — it competes with player frequency on
        # equal footing and wins only once it has the evidence to.
        return _blend([(dist, 1.0),
                       (player_card_dist(ev), 1.0),
                       (gt, 0.15),
                       (self.stats.incoming_dist, 0.01)], self.pool(ev))


class _ContextRanker(S2Transition):
    """S3-S5: one extra conditioning field on top of S2."""
    ctx_key = ""

    def rank(self, ev: dict) -> list[str]:
        base = super().rank(ev)
        value = ev.get(self.ctx_key)
        dist, support = player_context_dist(ev, self.ctx_key, value)
        if not dist:
            return base
        w = _confidence(support)
        ranked = _blend([(dist, 0.8 * w)], self.pool(ev))
        # Merge: context first where it has support, S2 order otherwise.
        order = {c: i for i, c in enumerate(base)}
        return sorted(self.pool(ev),
                      key=lambda c: (-(w * dist.get(c, 0.0)), order.get(c, 1e9), c)) \
            if w > 0 else base


class S3OpponentArchetype(_ContextRanker):
    name = "S3 +opp archetype"
    ctx_key = "opp_wc"


class S4OpponentDeck(_ContextRanker):
    name = "S4 +opp deck"
    ctx_key = "opp_hash"


class S5PreviousResult(_ContextRanker):
    name = "S5 +prev result"
    ctx_key = "result"


LADDER = (S0Global, S1Player, S2Transition,
          S3OpponentArchetype, S4OpponentDeck, S5PreviousResult)


# --------------------------------------------------------------------------
# How reachable is the S2 oracle?
# --------------------------------------------------------------------------

class ExitRanker:
    """Which card LEAVES — ranked by how volatile it has been in this shell.

    S2 is handed the true exit. Production would have to predict it, so this
    measures how much of S2's advantage is actually reachable. A card the
    player almost always fields is unlikely to be the one dropped.
    """
    name = "exit: least-stable-first"

    @staticmethod
    def rank(ev: dict) -> list[str]:
        counts = ev["cluster_card_counts"]
        n = max(1, ev["cluster_size"])
        return sorted(ev["prev_deck"],
                      key=lambda c: (counts.get(c, 0) / n, c))
