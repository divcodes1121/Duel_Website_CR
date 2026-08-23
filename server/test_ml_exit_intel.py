"""test_ml_exit_intel.py — Phase 13 exit prediction as its own problem.

    python server/test_ml_exit_intel.py
"""
import collections
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import exit_intel as XI    # noqa: E402

CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]
DECK = sorted(CORE + ["knight"])


def view(counts=None, prior=None, streak=None):
    return {"tag": "#A", "domain": "duel", "ts": "20260810T120000.000Z",
            "prev_deck": DECK, "cluster_size": 20,
            "cluster_card_counts": counts or dict({c: 20 for c in CORE},
                                                  **{"knight": 6}),
            "recent_counts": {str(w): {c: min(w, 20) for c in DECK}
                              for w in (5, 10, 20)},
            "last_seen": {c: 0 for c in DECK},
            "streak": streak or {c: 20 for c in DECK},
            "prior_edits": prior if prior is not None else [
                [["knight"], ["ice-golem"]]] * 4}


def truth(card="knight", into="ice-golem"):
    return sorted((set(DECK) - {card}) | {into})


def example(**kw):
    return XI.build(view(**kw), truth(), 0.5,
                    collections.Counter(), collections.Counter())


class Construction(unittest.TestCase):
    def test_one_feature_row_per_card(self):
        ex = example()
        self.assertEqual(len(ex.features), 8)
        for row in ex.features:
            self.assertEqual(len(row), XI.N_FEATURES)

    def test_truth_index_points_at_the_outgoing_card(self):
        ex = example()
        self.assertEqual(ex.deck[ex.truth_index()], "knight")

    def test_no_edit_returns_none(self):
        self.assertIsNone(XI.build(view(), DECK, 0.5,
                                   collections.Counter(), collections.Counter()))

    def test_two_card_edit_has_no_single_truth_index(self):
        t = sorted((set(DECK) - {"knight", "cannon"}) | {"ice-golem", "tesla"})
        ex = XI.build(view(), t, 0.5, collections.Counter(), collections.Counter())
        self.assertEqual(ex.n_out, 2)
        self.assertIsNone(ex.truth_index())

    def test_features_never_read_the_next_deck(self):
        a = XI.build(view(), truth("knight"), 0.5,
                     collections.Counter(), collections.Counter())
        b = XI.build(view(), truth("cannon"), 0.5,
                     collections.Counter(), collections.Counter())
        self.assertEqual(a.features, b.features,
                         "features must not depend on which card left")


class Diagnostics(unittest.TestCase):
    def test_least_stable_signal_fires_on_the_rare_card(self):
        hits = XI.signal_hits(example())
        self.assertTrue(hits["least stable"])

    def test_dead_recency_features_are_gone(self):
        """PHASE 14. `last_seen` was 0 for every card in the current deck, so
        it carried nothing and its diagnostic read 0.0%. `rel_recency_rank`
        was worse: derived from that constant column, its tie-break ranked
        cards by DECK INDEX, i.e. alphabetically. Both are removed."""
        self.assertNotIn("last_seen", XI.FEATURE_NAMES)
        self.assertNotIn("rel_recency_rank", XI.FEATURE_NAMES)

    def test_streak_is_uncapped_and_discriminates(self):
        """The real fix: `streak` already meant 'outings continuously present'
        but was capped at 20, flattening every stable card in a long cluster."""
        st = dict({c: 200 for c in CORE}, **{"knight": 3})
        ex = XI.build(view(streak=st), truth(), 0.5,
                      collections.Counter(), collections.Counter())
        i = XI.FEATURE_NAMES.index("log_streak")
        vals = {row[i] for row in ex.features}
        self.assertGreater(len(vals), 1, "log_streak must not saturate")

    def test_signal_hits_is_empty_for_a_two_card_edit(self):
        t = sorted((set(DECK) - {"knight", "cannon"}) | {"ice-golem", "tesla"})
        ex = XI.build(view(), t, 0.5, collections.Counter(), collections.Counter())
        self.assertEqual(XI.signal_hits(ex), {})


class Pairwise(unittest.TestCase):
    def _separable(self, n=60):
        counts = dict({c: 20 for c in CORE}, **{"knight": 1})
        return [XI.build(view(counts=counts), truth(), 0.5,
                         collections.Counter(), collections.Counter())
                for _ in range(n)]

    def test_learns_the_outgoing_card(self):
        model = XI.PairwiseExit(epochs=10).fit(self._separable())
        ex = self._separable(1)[0]
        self.assertEqual(ex.deck[model.rank(ex)[0]], "knight")

    def test_untrained_model_is_safe(self):
        ex = example()
        self.assertEqual(sorted(XI.PairwiseExit().rank(ex)), list(range(8)))

    def test_rank_returns_every_card_once(self):
        model = XI.PairwiseExit(epochs=3).fit(self._separable())
        order = model.rank(example())
        self.assertEqual(sorted(order), list(range(8)))

    def test_training_is_deterministic(self):
        a = XI.PairwiseExit(epochs=3).fit(self._separable())
        b = XI.PairwiseExit(epochs=3).fit(self._separable())
        self.assertEqual(a.w, b.w)

    def test_two_card_edits_are_excluded_from_training(self):
        t = sorted((set(DECK) - {"knight", "cannon"}) | {"ice-golem", "tesla"})
        two = XI.build(view(), t, 0.5, collections.Counter(), collections.Counter())
        model = XI.PairwiseExit(epochs=2).fit([two])
        self.assertTrue(all(w == 0.0 for w in model.w),
                        "an example with no single truth teaches nothing")

    def test_pair_ranking_covers_the_whole_space(self):
        model = XI.PairwiseExit(epochs=3).fit(self._separable())
        pairs = model.rank_pairs(example())
        self.assertEqual(len(pairs), 28)          # C(8,2)
        self.assertEqual(len(set(map(frozenset, pairs))), 28)


if __name__ == "__main__":
    unittest.main(verbosity=1)
