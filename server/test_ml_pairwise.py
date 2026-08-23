"""test_ml_pairwise.py — Phase 11 within-event pairwise ranking.

The contract that matters: a training pair must never cross prediction events.

    python server/test_ml_pairwise.py
"""
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import pairwise as PW      # noqa: E402
from ml import ranker as RK        # noqa: E402
from ml.edit_model import Candidate  # noqa: E402

CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]


def ctx(prior=None):
    deck = sorted(CORE + ["knight"])
    view = {"tag": "#A", "domain": "duel", "ts": "20260810T120000.000Z",
            "prev_deck": deck, "cluster_size": 20,
            "cluster_card_counts": dict({c: 20 for c in CORE},
                                        **{"knight": 12, "ice-golem": 6}),
            "last_seen": {c: 0 for c in deck}, "streak": {c: 20 for c in deck},
            "prior_edits": prior if prior is not None else [
                [["knight"], ["ice-golem"]]] * 4}
    return RK.EventContext(view, {0: .5, 1: .4, 2: .1}, {"ice-golem": 1, "tesla": 2})


def cands(n=5):
    pool = ["ice-golem", "tesla", "valkyrie", "wizard", "archers"][:n]
    return [Candidate(("knight",), (c,)) for c in pool]


class FeatureMatrix(unittest.TestCase):
    def test_matrix_has_base_plus_relative_columns(self):
        mat = PW.build_event_matrix(ctx(), cands())
        self.assertEqual(len(mat), 5)
        for row in mat:
            self.assertEqual(len(row), PW.N_FEATURES)
        self.assertEqual(PW.N_FEATURES,
                         len(RK.FEATURE_NAMES) + len(PW.RELATIVE_NAMES))

    def test_relative_ranks_are_normalised(self):
        mat = PW.build_event_matrix(ctx(), cands())
        i = PW.FEATURE_NAMES.index("rel_entry_rank")
        vals = sorted(r[i] for r in mat)
        self.assertAlmostEqual(vals[0], 0.0)
        self.assertAlmostEqual(vals[-1], 1.0)

    def test_exactly_one_candidate_is_top_entry(self):
        mat = PW.build_event_matrix(ctx(), cands())
        i = PW.FEATURE_NAMES.index("rel_is_top_entry")
        self.assertEqual(sum(r[i] for r in mat), 1.0)

    def test_empty_event_is_safe(self):
        self.assertEqual(PW.build_event_matrix(ctx(), []), [])

    def test_relative_features_depend_on_the_event_not_the_candidate(self):
        """The same candidate scores differently in a different field."""
        small = PW.build_event_matrix(ctx(), cands(2))
        large = PW.build_event_matrix(ctx(), cands(5))
        i = PW.FEATURE_NAMES.index("rel_pool_size")
        self.assertNotEqual(small[0][i], large[0][i])


class NegativeSampling(unittest.TestCase):
    def setUp(self):
        self.rng = random.Random(0)

    def test_all_returns_every_other_candidate(self):
        self.assertEqual(len(PW.sample_negatives(10, 3, "all", self.rng)), 9)

    def test_true_index_is_never_a_negative(self):
        for strat in PW.STRATEGIES:
            negs = PW.sample_negatives(20, 7, strat, self.rng, 8)
            self.assertNotIn(7, negs, strat)

    def test_hard_negatives_sit_next_to_the_true_candidate(self):
        negs = PW.sample_negatives(50, 25, "hard", self.rng, 4)
        self.assertTrue(all(abs(i - 25) <= 3 for i in negs), negs)

    def test_mix_contains_hard_and_far_negatives(self):
        negs = PW.sample_negatives(200, 100, "mix", self.rng, 10)
        self.assertTrue(any(abs(i - 100) <= 5 for i in negs))
        self.assertTrue(any(abs(i - 100) > 5 for i in negs))

    def test_single_candidate_yields_no_pairs(self):
        self.assertEqual(PW.sample_negatives(1, 0, "mix", self.rng), [])

    def test_unknown_strategy_is_rejected(self):
        with self.assertRaises(ValueError):
            PW.sample_negatives(5, 0, "nonsense", self.rng)


class WithinEventContract(unittest.TestCase):
    """THE CONTRACT: pairs are formed inside one event, never across events."""

    def test_sampled_indices_address_one_event_only(self):
        rng = random.Random(1)
        for strat in PW.STRATEGIES:
            negs = PW.sample_negatives(6, 2, strat, rng, 4)
            self.assertTrue(all(0 <= i < 6 for i in negs), strat)

    def test_events_without_the_truth_contribute_no_pairs(self):
        mats = [(PW.build_event_matrix(ctx(), cands()), None)]
        model = PW.PairwiseRanker(epochs=1).fit(mats)
        self.assertEqual(model.pairs_seen, 0)

    def test_single_candidate_events_contribute_no_pairs(self):
        mats = [(PW.build_event_matrix(ctx(), cands(1)), 0)]
        model = PW.PairwiseRanker(epochs=1).fit(mats)
        self.assertEqual(model.pairs_seen, 0)

    def test_pair_count_matches_the_strategy(self):
        mats = [(PW.build_event_matrix(ctx(), cands(5)), 0)]
        model = PW.PairwiseRanker(epochs=1, strategy="all").fit(mats)
        self.assertEqual(model.pairs_seen, 4)


class Learning(unittest.TestCase):
    def _separable(self, n_events=40):
        """The true candidate always has the strongest transition support."""
        events = []
        for _ in range(n_events):
            c = ctx()
            mat = PW.build_event_matrix(c, cands())
            i = PW.FEATURE_NAMES.index("rel_transition_share")
            for j, row in enumerate(mat):
                row[i] = 1.0 if j == 0 else 0.1
            events.append((mat, 0))
        return events

    def test_learns_to_rank_the_true_candidate_first(self):
        model = PW.PairwiseRanker(epochs=8, strategy="all").fit(self._separable())
        mat, _t = self._separable(1)[0]
        scores = [model.score_row(r) for r in mat]
        self.assertEqual(max(range(len(scores)), key=lambda i: scores[i]), 0)

    def test_untrained_model_preserves_the_heuristic_order(self):
        model = PW.PairwiseRanker()
        c, cs = ctx(), cands()
        self.assertEqual(model.rank(c, cs), cs)

    def test_training_is_deterministic(self):
        a = PW.PairwiseRanker(epochs=3).fit(self._separable())
        b = PW.PairwiseRanker(epochs=3).fit(self._separable())
        self.assertEqual(a.w, b.w)

    def test_no_bias_term_is_carried(self):
        """A bias cancels in every pairwise difference and would be unidentifiable."""
        self.assertFalse(hasattr(PW.PairwiseRanker(), "b"))

    def test_rank_returns_every_candidate_once(self):
        model = PW.PairwiseRanker(epochs=2).fit(self._separable())
        cs = cands()
        ranked = model.rank(ctx(), cs)
        self.assertEqual(sorted(map(str, ranked)), sorted(map(str, cs)))


if __name__ == "__main__":
    unittest.main(verbosity=1)
