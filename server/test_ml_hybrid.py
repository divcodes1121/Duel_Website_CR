"""test_ml_hybrid.py — Phase 12 L0 prior + P1 evidence.

    python server/test_ml_hybrid.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import hybrid as H          # noqa: E402
from ml import pairwise as PW       # noqa: E402
from ml import ranker as RK         # noqa: E402
from ml.edit_model import Candidate   # noqa: E402

CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]
DECK = sorted(CORE + ["knight"])


def ctx():
    view = {"tag": "#A", "domain": "duel", "ts": "20260810T120000.000Z",
            "prev_deck": DECK, "cluster_size": 20,
            "cluster_card_counts": dict({c: 20 for c in CORE},
                                        **{"knight": 12, "ice-golem": 6}),
            "last_seen": {c: 0 for c in DECK}, "streak": {c: 20 for c in DECK},
            "prior_edits": [[["knight"], ["ice-golem"]]] * 4}
    return RK.EventContext(view, {0: .5, 1: .4, 2: .1}, {"ice-golem": 1})


CANDS = [Candidate(("knight",), (c,))
         for c in ("ice-golem", "tesla", "valkyrie", "wizard")]


def truth_for(i):
    return sorted((set(DECK) - {"knight"}) | {CANDS[i].entries[0]})


class Fixed:
    """A P1 stand-in with scores we control."""
    def __init__(self, scores):
        self.scores = scores

    def score_row(self, row):
        return 0.0

    def rank(self, ctx_, cands):
        idx = {id(c): i for i, c in enumerate(CANDS)}
        return sorted(cands, key=lambda c: -self.scores[idx[id(c)]])


class Disagreement(unittest.TestCase):
    def test_four_cells(self):
        a, b = CANDS, list(reversed(CANDS))
        self.assertEqual(H.disagreement(a, a, DECK, truth_for(0)), "both")
        self.assertEqual(H.disagreement(a, b, DECK, truth_for(0)), "l0_only")
        self.assertEqual(H.disagreement(a, b, DECK, truth_for(3)), "p1_only")
        self.assertEqual(H.disagreement(a, b, DECK, truth_for(1)), "neither")

    def test_empty_rankings_are_safe(self):
        self.assertEqual(H.disagreement([], [], DECK, truth_for(0)), "neither")


class Decompose(unittest.TestCase):
    def test_both_correct(self):
        self.assertEqual(H.decompose_pick(CANDS[0], DECK, truth_for(0)),
                         "both correct")

    def test_exit_right_entry_wrong(self):
        self.assertEqual(H.decompose_pick(CANDS[1], DECK, truth_for(0)),
                         "exit correct, entry wrong")

    def test_exit_wrong_entry_right(self):
        truth = sorted((set(DECK) - {"cannon"}) | {"ice-golem"})
        self.assertEqual(H.decompose_pick(CANDS[0], DECK, truth),
                         "entry correct, exit wrong")

    def test_both_wrong(self):
        truth = sorted((set(DECK) - {"cannon"}) | {"tesla"})
        self.assertEqual(H.decompose_pick(CANDS[0], DECK, truth), "both wrong")

    def test_no_candidate(self):
        self.assertEqual(H.decompose_pick(None, DECK, truth_for(0)),
                         "no candidate")


class Hybrids(unittest.TestCase):
    def test_h1_preserves_the_anchor(self):
        h = H.H1HardAnchor(Fixed([0, 9, 8, 7]))
        ranked = h.rank(ctx(), CANDS)
        self.assertEqual(ranked[0], CANDS[0], "L0's pick must keep rank 1")

    def test_h1_reorders_everything_below(self):
        h = H.H1HardAnchor(Fixed([0, 1, 9, 5]))
        ranked = h.rank(ctx(), CANDS)
        self.assertEqual(ranked[1], CANDS[2], "P1 orders the remainder")

    def test_h1_returns_every_candidate_once(self):
        ranked = H.H1HardAnchor(Fixed([0, 1, 2, 3])).rank(ctx(), CANDS)
        self.assertEqual(sorted(map(str, ranked)), sorted(map(str, CANDS)))

    def test_h1_handles_an_empty_pool(self):
        self.assertEqual(H.H1HardAnchor(Fixed([])).rank(ctx(), []), [])

    def test_h2_keeps_anchor_without_a_strong_margin(self):
        class P1:
            def score_row(self, row):
                return 0.0
        ranked = H.H2ProtectedAnchor(P1(), margin=1.0).rank(ctx(), CANDS)
        self.assertEqual(ranked[0], CANDS[0])

    def test_h2_overrides_on_a_large_margin(self):
        seen = {"i": 0}

        class P1:
            def score_row(self, row):
                seen["i"] += 1
                return 10.0 if seen["i"] == 3 else 0.0
        ranked = H.H2ProtectedAnchor(P1(), margin=1.0).rank(ctx(), CANDS)
        self.assertEqual(ranked[0], CANDS[2], "a big margin should displace L0")

    def test_h3_alpha_one_reproduces_l0(self):
        class P1:
            def score_row(self, row):
                return 0.0
        self.assertEqual(H.H3Blend(P1(), alpha=1.0).rank(ctx(), CANDS), CANDS)

    def test_h3_returns_every_candidate_once(self):
        class P1:
            def score_row(self, row):
                return 0.0
        ranked = H.H3Blend(P1(), alpha=0.5).rank(ctx(), CANDS)
        self.assertEqual(sorted(map(str, ranked)), sorted(map(str, CANDS)))


class WithRealRanker(unittest.TestCase):
    def test_hybrids_run_against_an_untrained_pairwise_model(self):
        p1 = PW.PairwiseRanker()
        for h in (H.H1HardAnchor(p1), H.H2ProtectedAnchor(p1),
                  H.H3Blend(p1, 0.5)):
            ranked = h.rank(ctx(), CANDS)
            self.assertEqual(len(ranked), len(CANDS), h.name)


if __name__ == "__main__":
    unittest.main(verbosity=1)
