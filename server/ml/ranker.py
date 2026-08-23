"""Phase 10 — ranking 1-card candidates over a FROZEN pool.

PHASE 9 CREATED THE CONDITIONS FOR THIS. With a player-wide vocabulary the true
next deck is in the candidate set 85.8% (competitive) / 88.6% (duel) of the
time, so ranking quality can finally be measured on its own. Through Phases 4-7
a perfect ranker capped near 20% and every ranking result was really a
generation result in disguise.

THE POOL IS FROZEN ACROSS EVERY RUNG. L0, L1 and anything after them order the
IDENTICAL candidate list. If generation were allowed to differ, an improvement
could not be attributed to the ranker — which is the ambiguity that made the
earlier phases so hard to read.

CEILING DECOMPOSITION. Because the pool is fixed, total failure splits cleanly:

    truth absent from the pool      generation failure  (Phase 8/9's problem)
    truth present but ranked low    ranking failure     (this phase's problem)

Both are reported, so no result can hide behind the other.

2-CARD IS EXPLICITLY OUT OF SCOPE. Its recall is 32.2%/45.8% against ceilings of
78.5%/84.4%; ranking it now would repeat exactly the mistake Phase 7 exposed.
"""
from __future__ import annotations

import collections
import math
from dataclasses import dataclass, field

FEATURE_NAMES = (
    # --- the exiting card -------------------------------------------------
    "exit_shell_share",       # how often it is fielded in this shell
    "exit_last_seen",         # outings since it last appeared
    "exit_streak",
    "exit_prior_exits",       # times this player has dropped it before
    "exit_pop_editability",   # population rate of this card being dropped
    # --- the entering card ------------------------------------------------
    "entry_shell_count",      # times fielded in THIS shell (0 if never)
    "entry_player_count",     # times fielded anywhere (the Phase 9 pool)
    "entry_tier",             # 1 shell / 2 player-frequent / 3 rare / 4 global
    "entry_pop_incoming",     # population rate of this card entering
    # --- the pair ---------------------------------------------------------
    "transition_support",     # this player's prior exit->entry observations
    "exact_edit_seen",        # has this player made THIS edit before?
    "entry_in_shell",         # binary: is the entry already a shell card
    # --- context ----------------------------------------------------------
    "p_change",
    "p_one_card",
    "cluster_size",
    "n_variants",
)

N_FEATURES = len(FEATURE_NAMES)
MIN_SUPPORT = 3.0


@dataclass
class EventContext:
    """Everything shared by every candidate at one prediction step.

    Computed once per event rather than once per candidate — with a few hundred
    candidates per step that is the difference between a usable harness and an
    unusable one.
    """
    view: dict
    p_n: dict
    pool: dict
    pop_exit: collections.Counter = field(default_factory=collections.Counter)
    pop_exit_seen: collections.Counter = field(default_factory=collections.Counter)
    pop_incoming: collections.Counter = field(default_factory=collections.Counter)
    pop_edits: int = 0
    player_counts: collections.Counter = field(default_factory=collections.Counter)

    def __post_init__(self):
        v = self.view
        self.n = max(1, v.get("cluster_size", 1))
        self.counts = v.get("cluster_card_counts", {})
        self.last_seen = v.get("last_seen", {})
        self.streak = v.get("streak", {})
        self.prior_exits: collections.Counter = collections.Counter()
        self.transitions: dict = collections.defaultdict(collections.Counter)
        self.exact: collections.Counter = collections.Counter()
        for out, inc in v.get("prior_edits", []):
            for c in out:
                self.prior_exits[c] += 1
            for a in out:
                for b in inc:
                    self.transitions[a][b] += 1
            if len(out) == 1 and len(inc) == 1:
                self.exact[(out[0], inc[0])] += 1


def extract(ctx: EventContext, cand) -> list[float]:
    """Features of ONE candidate. Reads only pre-T evidence."""
    a = cand.exits[0]
    b = cand.entries[0]
    n = ctx.n
    seen = ctx.pop_exit_seen.get(a, 0)
    return [
        ctx.counts.get(a, 0) / n,
        float(min(ctx.last_seen.get(a, 0), 20)),
        float(min(ctx.streak.get(a, 0), 20)),
        math.log1p(ctx.prior_exits.get(a, 0)),
        (ctx.pop_exit.get(a, 0) / (seen + MIN_SUPPORT)) if seen else 0.0,

        math.log1p(ctx.counts.get(b, 0)),
        math.log1p(ctx.player_counts.get(b, 0)),
        float(ctx.pool.get(b, 4)),
        ctx.pop_incoming.get(b, 0) / (ctx.pop_edits + MIN_SUPPORT),

        math.log1p(ctx.transitions.get(a, {}).get(b, 0)),
        math.log1p(ctx.exact.get((a, b), 0)),
        1.0 if b in ctx.counts else 0.0,

        1.0 - ctx.p_n.get(0, 0.0),
        ctx.p_n.get(1, 0.0),
        math.log1p(n),
        math.log1p(max(1, len(ctx.counts))),
    ]


# --------------------------------------------------------------------------
# L0 — the frozen Phase 9 ordering
# --------------------------------------------------------------------------

class L0Heuristic:
    """The generator's own order, preserved exactly. The baseline to beat."""
    name = "L0 heuristic"

    def rank(self, ctx: EventContext, cands: list) -> list:
        return list(cands)


# --------------------------------------------------------------------------
# L1 — pointwise logistic
# --------------------------------------------------------------------------

@dataclass
class L1Logistic:
    """P(candidate == truth), scored per candidate and sorted descending.

    Pointwise rather than pairwise on purpose: the gate says stop if this does
    not beat L0, and a simpler model failing is a cheaper and clearer answer
    than a complex one failing.
    """
    name: str = "L1 logistic"
    epochs: int = 12
    lr: float = 0.15
    l2: float = 1e-4
    seed: int = 20260819
    w: list = field(default_factory=list)
    b: float = 0.0
    mean: list = field(default_factory=list)
    std: list = field(default_factory=list)

    def _scale(self, x):
        return [(v - m) / s for v, m, s in zip(x, self.mean, self.std)]

    @staticmethod
    def _sig(v: float) -> float:
        if v < -35:
            return 0.0
        if v > 35:
            return 1.0
        return 1.0 / (1.0 + math.exp(-v))

    def fit(self, rows: list, labels: list) -> "L1Logistic":
        import random
        n, d = len(rows), N_FEATURES
        self.mean = [0.0] * d
        self.std = [1.0] * d
        if n:
            for j in range(d):
                col = [r[j] for r in rows]
                mu = sum(col) / n
                var = sum((v - mu) ** 2 for v in col) / n
                self.mean[j] = mu
                self.std[j] = math.sqrt(var) if var > 1e-12 else 1.0
        scaled = [self._scale(r) for r in rows]
        self.w = [0.0] * d
        self.b = 0.0
        order = list(range(n))
        rng = random.Random(self.seed)
        for epoch in range(self.epochs):
            rng.shuffle(order)
            lr = self.lr / (1.0 + epoch)
            for i in order:
                z = scaled[i]
                p = self._sig(self.b + sum(wi * zi for wi, zi in zip(self.w, z)))
                err = labels[i] - p
                for j in range(d):
                    self.w[j] += lr * (err * z[j] - self.l2 * self.w[j])
                self.b += lr * err
        return self

    def score(self, x: list) -> float:
        if not self.w:
            return 0.0
        z = self._scale(x)
        return self.b + sum(wi * zi for wi, zi in zip(self.w, z))

    def rank(self, ctx: EventContext, cands: list) -> list:
        scored = [(self.score(extract(ctx, c)), i, c) for i, c in enumerate(cands)]
        # Ties break on the ORIGINAL position so the comparison against L0 is
        # never decided by dict or sort instability.
        scored.sort(key=lambda t: (-t[0], t[1]))
        return [c for _s, _i, c in scored]

    def top_weights(self, k: int = 8):
        if not self.w:
            return []
        return sorted(zip(FEATURE_NAMES, self.w), key=lambda kv: -abs(kv[1]))[:k]


# --------------------------------------------------------------------------
# Ranking metrics
# --------------------------------------------------------------------------

def true_rank(ranked: list, prev_deck, next_deck) -> int | None:
    """0-based rank of the candidate that produces the true deck, else None."""
    prev = frozenset(prev_deck)
    truth = frozenset(next_deck)
    for i, c in enumerate(ranked):
        if c.apply(prev) == truth:
            return i
    return None


def rank_summary(ranks: list) -> dict:
    """Recall@k, MRR and the rank distribution Phase 9 asked for."""
    found = [r for r in ranks if r is not None]
    n = len(ranks) or 1
    out = {"n": len(ranks), "found": len(found), "coverage": len(found) / n}
    for k in (1, 3, 5, 10, 25, 50, 100):
        out["r@%d" % k] = sum(1 for r in found if r < k) / n
    out["mrr"] = sum(1.0 / (r + 1) for r in found) / n
    out["ndcg"] = sum(1.0 / math.log2(r + 2) for r in found) / n
    ordered = sorted(found)
    for label, q in (("median", 0.5), ("p90", 0.9), ("p95", 0.95)):
        out[label] = (ordered[min(len(ordered) - 1, int(q * len(ordered)))]
                      if ordered else None)
    return out
