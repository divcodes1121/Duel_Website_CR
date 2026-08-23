"""Phase 12 — L0 as prior, P1 as evidence.

PHASE 11 PRODUCED AN UNUSUALLY CLEAN SPLIT. The frozen heuristic wins rank 1
(26.2%/32.8% against P1's 21.8%/22.7%) while the pairwise ranker wins everything
below it (r@10 +7.7/+7.3, r@25 +10.3/+14.7, median rank 38->12 and 23->6). That
is the signature of a strong prior plus a useful but weaker contextual signal —
not of a bad model.

So the learned ranker is not asked to overthrow the heuristic. It is asked a
narrower question:

    is there enough event-specific evidence to override the prior?

L0's first pick keeps its position unless P1 disagrees by a margin. Below rank 1
P1 orders freely, which is what it is demonstrably good at.

NOTHING HERE IS BUILT UNTIL THE DISAGREEMENT MATRIX SAYS IT IS WORTH BUILDING.
If P1 is only rearranging cases L0 had already lost, a hybrid cannot help, and
`disagreement()` is what settles that.
"""
from __future__ import annotations

from dataclasses import dataclass


def _first_correct(ranked, prev_deck, next_deck) -> bool:
    prev = frozenset(prev_deck)
    return bool(ranked) and ranked[0].apply(prev) == frozenset(next_deck)


def disagreement(l0_ranked, p1_ranked, prev_deck, next_deck) -> str:
    """Which of the two got rank 1 right. The Gate A measurement.

    Returns one of: 'both', 'l0_only', 'p1_only', 'neither'.
    """
    a = _first_correct(l0_ranked, prev_deck, next_deck)
    b = _first_correct(p1_ranked, prev_deck, next_deck)
    if a and b:
        return "both"
    if a:
        return "l0_only"
    if b:
        return "p1_only"
    return "neither"


def decompose_pick(cand, prev_deck, next_deck) -> str:
    """Was L0's top pick wrong on the exit, the entry, or both?

    If the exit is usually right and the entry usually wrong, the weak component
    is the ENTRY ranker and a general candidate ranker is the wrong tool.
    """
    if cand is None:
        return "no candidate"
    prev, truth = frozenset(prev_deck), frozenset(next_deck)
    true_out, true_in = prev - truth, truth - prev
    got_out, got_in = frozenset(cand.exits), frozenset(cand.entries)
    ok_out, ok_in = got_out == true_out, got_in == true_in
    if ok_out and ok_in:
        return "both correct"
    if ok_out:
        return "exit correct, entry wrong"
    if ok_in:
        return "entry correct, exit wrong"
    return "both wrong"


# --------------------------------------------------------------------------
# Hybrids
# --------------------------------------------------------------------------

@dataclass
class H1HardAnchor:
    """L0 keeps rank 1 unconditionally; P1 orders everything after it.

    The simplest hybrid, and by construction Recall@1 equals L0's exactly. The
    question it answers is whether the SHORTLIST improves.
    """
    p1: object
    name: str = "H1 anchor"

    def rank(self, ctx, cands):
        if not cands:
            return []
        anchor = cands[0]
        rest = self.p1.rank(ctx, cands[1:])
        return [anchor] + rest


@dataclass
class H2ProtectedAnchor:
    """L0 keeps rank 1 unless P1 prefers another candidate by `margin`.

    The override is deliberately hard to earn: L0 is the strongest rank-1
    predictor measured, so displacing it needs evidence rather than a tie-break.
    """
    p1: object
    margin: float = 1.0
    name: str = "H2 protected"

    def rank(self, ctx, cands):
        if not cands:
            return []
        from . import pairwise as PW
        mat = PW.build_event_matrix(ctx, cands)
        scores = [self.p1.score_row(row) for row in mat]
        anchor_score = scores[0]
        best_i = max(range(len(scores)), key=lambda i: (scores[i], -i))
        order = sorted(range(len(cands)), key=lambda i: (-scores[i], i))
        if best_i != 0 and scores[best_i] - anchor_score >= self.margin:
            return [cands[i] for i in order]
        rest = [i for i in order if i != 0]
        return [cands[0]] + [cands[i] for i in rest]


@dataclass
class H3Blend:
    """A convex blend of the two orderings, on comparable (rank) scales.

    Raw scores are not comparable — L0 has no score at all, only a position — so
    both sides are converted to normalised rank before blending. That is the
    only way the alpha means anything.
    """
    p1: object
    alpha: float = 0.5
    name: str = "H3 blend"

    def rank(self, ctx, cands):
        if not cands:
            return []
        from . import pairwise as PW
        n = max(1, len(cands) - 1)
        l0_rank = {id(c): i / n for i, c in enumerate(cands)}
        mat = PW.build_event_matrix(ctx, cands)
        scores = [self.p1.score_row(row) for row in mat]
        order = sorted(range(len(cands)), key=lambda i: (-scores[i], i))
        p1_rank = {}
        for pos, i in enumerate(order):
            p1_rank[id(cands[i])] = pos / n
        return sorted(cands,
                      key=lambda c: (self.alpha * l0_rank[id(c)]
                                     + (1 - self.alpha) * p1_rank[id(c)]))
