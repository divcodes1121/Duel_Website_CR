"""Phase 11 — within-event pairwise ranking.

PHASE 10 DIAGNOSED THE OBJECTIVE, NOT THE MODEL. Pointwise logistic lost to the
frozen heuristic (competitive MRR 0.295 -> 0.103) while simultaneously improving
the deep tail on duel (r@25 43.2% -> 53.8%, median rank 33 -> 10). With
0.18-0.37% positives, log-loss is dominated by ~99.7% negatives, so the model
learns "is this candidate plausible" instead of "is this candidate THE one".
Its learned weights showed it: `exit_prior_exits` and `exit_shell_share` came
out NEGATIVE, contradicting Phase 4's measured editability effect.

So the loss changes, not the capacity:

    pointwise   P(candidate is true)          absolute, across all events
    pairwise    score(true) > score(false)    relative, WITHIN one event

PAIRS NEVER CROSS EVENTS. A candidate from one player's step tells us nothing
about another player's step, and mixing them re-creates the absolute-scale
problem the pairwise loss exists to remove. `test_ml_pairwise.py` asserts every
pair shares a player, timestamp and current deck.

RELATIVE FEATURES ARE THE SECOND HALF OF THE FIX. "This exit was dropped four
times" means different things for a player with 5 prior edits and one with 200.
Phase 10 fed the model absolute counts; here each candidate also carries its
rank and share WITHIN its own event, which is the quantity that is comparable.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from . import ranker as RK

#: Appended to RK.FEATURE_NAMES. Everything here is computed against the other
#: candidates of the SAME event.
RELATIVE_NAMES = (
    "rel_exit_rank",          # position of this exit among the event's exits
    "rel_entry_rank",
    "rel_transition_rank",
    "rel_exit_share",         # this exit's support / the event's best
    "rel_entry_share",
    "rel_transition_share",
    "rel_margin_to_best",     # gap to the strongest candidate on transitions
    "rel_is_top_exit",
    "rel_is_top_entry",
    "rel_pool_size",
)

FEATURE_NAMES = RK.FEATURE_NAMES + RELATIVE_NAMES
N_FEATURES = len(FEATURE_NAMES)

_I_EXIT_PRIOR = RK.FEATURE_NAMES.index("exit_prior_exits")
_I_ENTRY_PLAYER = RK.FEATURE_NAMES.index("entry_player_count")
_I_TRANS = RK.FEATURE_NAMES.index("transition_support")


def _ranks(values: list[float]) -> list[float]:
    """Normalised descending rank in [0, 1]; 0 is strongest."""
    order = sorted(range(len(values)), key=lambda i: -values[i])
    out = [0.0] * len(values)
    n = max(1, len(values) - 1)
    for pos, i in enumerate(order):
        out[i] = pos / n
    return out


def build_event_matrix(ctx: RK.EventContext, cands: list) -> list[list[float]]:
    """Base features for every candidate, plus their within-event relatives.

    Computed once per event: the relative columns need the whole event before
    any single row can be finished, which is exactly why they were missing from
    the pointwise design.
    """
    base = [RK.extract(ctx, c) for c in cands]
    if not base:
        return []

    exit_sup = [b[_I_EXIT_PRIOR] for b in base]
    entry_sup = [b[_I_ENTRY_PLAYER] for b in base]
    trans_sup = [b[_I_TRANS] for b in base]

    r_exit, r_entry, r_trans = _ranks(exit_sup), _ranks(entry_sup), _ranks(trans_sup)
    max_exit = max(exit_sup) or 1.0
    max_entry = max(entry_sup) or 1.0
    max_trans = max(trans_sup) or 1.0
    pool = math.log1p(len(cands))

    out = []
    for i, b in enumerate(base):
        out.append(b + [
            r_exit[i], r_entry[i], r_trans[i],
            exit_sup[i] / max_exit,
            entry_sup[i] / max_entry,
            trans_sup[i] / max_trans,
            (max_trans - trans_sup[i]) / max_trans,
            1.0 if r_exit[i] == 0.0 else 0.0,
            1.0 if r_entry[i] == 0.0 else 0.0,
            pool,
        ])
    return out


# --------------------------------------------------------------------------
# Negative sampling
# --------------------------------------------------------------------------

def sample_negatives(n_cands: int, true_idx: int, strategy: str,
                     rng: random.Random, k: int = 12) -> list[int]:
    """Which false candidates to pair the true one against.

    Phase 10's lesson generalises: a training set dominated by trivially easy
    examples teaches almost nothing. HARD negatives are the ones sitting next to
    the true candidate in the heuristic order — the model has to learn what
    actually separates them.
    """
    others = [i for i in range(n_cands) if i != true_idx]
    if not others:
        return []
    if strategy == "all":
        return others
    if strategy == "topk":
        return others[:k]
    if strategy == "hard":
        return sorted(others, key=lambda i: abs(i - true_idx))[:k]
    if strategy == "mix":
        hard = sorted(others, key=lambda i: abs(i - true_idx))[:k // 2]
        rest = [i for i in others if i not in set(hard)]
        rng.shuffle(rest)
        return hard + rest[:k - len(hard)]
    raise ValueError("unknown strategy %r" % strategy)


STRATEGIES = ("all", "topk", "hard", "mix")


# --------------------------------------------------------------------------
# The ranker
# --------------------------------------------------------------------------

@dataclass
class PairwiseRanker:
    """score(x) = w . x, fitted so score(true) > score(false) within an event.

    No bias term: it cancels in every pairwise difference, so carrying one would
    be an unidentifiable parameter.
    """
    name: str = "P1 pairwise"
    epochs: int = 15
    lr: float = 0.1
    l2: float = 1e-5
    seed: int = 20260819
    strategy: str = "mix"
    negatives: int = 12
    w: list = field(default_factory=list)
    mean: list = field(default_factory=list)
    std: list = field(default_factory=list)
    pairs_seen: int = 0

    def _scale(self, x):
        return [(v - m) / s for v, m, s in zip(x, self.mean, self.std)]

    def _fit_scaler(self, events) -> None:
        d = N_FEATURES
        cols = [[] for _ in range(d)]
        for mat, _t in events:
            for row in mat:
                for j in range(d):
                    cols[j].append(row[j])
        self.mean = [sum(c) / len(c) if c else 0.0 for c in cols]
        self.std = []
        for j, c in enumerate(cols):
            if not c:
                self.std.append(1.0)
                continue
            mu = self.mean[j]
            var = sum((v - mu) ** 2 for v in c) / len(c)
            self.std.append(math.sqrt(var) if var > 1e-12 else 1.0)

    def fit(self, events) -> "PairwiseRanker":
        """`events` is [(feature_matrix, true_index)], true_index may be None."""
        usable = [(m, t) for m, t in events if t is not None and len(m) > 1]
        self._fit_scaler(events)
        d = N_FEATURES
        self.w = [0.0] * d
        rng = random.Random(self.seed)
        self.pairs_seen = 0

        prepared = []
        for mat, t in usable:
            scaled = [self._scale(r) for r in mat]
            negs = sample_negatives(len(mat), t, self.strategy, rng,
                                    self.negatives)
            prepared.append((scaled, t, negs))

        for epoch in range(self.epochs):
            lr = self.lr / (1.0 + epoch)
            rng.shuffle(prepared)
            for scaled, t, negs in prepared:
                pos = scaled[t]
                for i in negs:
                    diff = [a - b for a, b in zip(pos, scaled[i])]
                    margin = sum(wi * di for wi, di in zip(self.w, diff))
                    # dL/dw for log(1 + exp(-margin))
                    g = -1.0 / (1.0 + math.exp(min(35.0, max(-35.0, margin))))
                    for j in range(d):
                        self.w[j] -= lr * (g * diff[j] + self.l2 * self.w[j])
                    if epoch == 0:
                        self.pairs_seen += 1
        return self

    def score_row(self, row: list) -> float:
        if not self.w:
            return 0.0
        z = self._scale(row)
        return sum(wi * zi for wi, zi in zip(self.w, z))

    def rank(self, ctx: RK.EventContext, cands: list) -> list:
        mat = build_event_matrix(ctx, cands)
        scored = [(self.score_row(mat[i]), i, c) for i, c in enumerate(cands)]
        scored.sort(key=lambda t: (-t[0], t[1]))     # ties keep heuristic order
        return [c for _s, _i, c in scored]

    def top_weights(self, k: int = 10):
        if not self.w:
            return []
        return sorted(zip(FEATURE_NAMES, self.w), key=lambda kv: -abs(kv[1]))[:k]
