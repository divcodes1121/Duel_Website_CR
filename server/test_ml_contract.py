"""test_ml_contract.py — the invariants the whole benchmark rests on.

If any of these fail, every number the harness produces is worthless, so they
are asserted separately from the logic that happens to satisfy them today.

    python server/test_ml_contract.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import config                          # noqa: E402
from ml import dataset as ds                   # noqa: E402
from ml.evaluation import splits               # noqa: E402


CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]


def variant(extra):
    return CORE + [extra]


def play(day, extra, mode="Ranked1v1_NewArena2"):
    return ds.DeckPlay(battle_time="202608%02dT120000.000Z" % day,
                       mode=mode, cards=tuple(variant(extra)))


def history(n=10, extra="knight"):
    return [play(d, extra) for d in range(1, n + 1)]


class ExampleShape(unittest.TestCase):
    def setUp(self):
        self.examples = list(ds.iter_examples("#TAG", history(), "competitive"))
        self.assertTrue(self.examples, "fixture must produce examples")

    def test_every_field_present(self):
        for ex in self.examples:
            self.assertTrue(ex.player_tag)
            self.assertTrue(ex.timestamp)
            self.assertIn(ex.domain, config.DOMAINS)
            self.assertTrue(ex.history)
            self.assertIsNotNone(ex.truth)

    def test_history_is_immutable(self):
        """A predictor holding an example must not be able to alter it."""
        ex = self.examples[0]
        self.assertIsInstance(ex.history, tuple)
        with self.assertRaises(AttributeError):
            ex.truth = None                      # frozen dataclass
        with self.assertRaises(AttributeError):
            ex.history[0].cards = ()             # frozen dataclass

    def test_leak_free_on_every_example(self):
        for ex in self.examples:
            ex.assert_leak_free()

    def test_truth_never_appears_in_history(self):
        for ex in self.examples:
            self.assertNotIn(ex.truth, ex.history)
            self.assertNotIn(ex.truth, ex.cluster_history)

    def test_cluster_history_is_a_subset_of_history(self):
        for ex in self.examples:
            for row in ex.cluster_history:
                self.assertIn(row, ex.history)


class TaskSeparation(unittest.TestCase):
    """Next-deck and incoming-card are different tasks and must not merge."""

    def test_incoming_candidates_exclude_the_current_deck(self):
        plays = history(8) + [play(9, "ice-golem")]
        ex = list(ds.iter_examples("#T", plays, "competitive"))[-1]
        candidates = splits.incoming_candidates(ex)
        for card in ex.previous.card_set:
            self.assertNotIn(card, candidates,
                             "a card already fielded cannot be swapped IN")

    def test_next_deck_models_return_decks_not_rankings(self):
        ex = list(ds.iter_examples("#T", history(), "competitive"))[-1]
        for name, (predict, rank) in splits.NEXT_DECK_MODELS.items():
            deck = predict(ex)
            self.assertEqual(len(deck), config.DECK_SIZE, name)
            self.assertIsInstance(deck, frozenset, name)
            self.assertTrue(all(isinstance(d, frozenset) for d in rank(ex, 3)))

    def test_baselines_receive_no_access_to_truth(self):
        """Blank the truth; predictions must be unchanged."""
        ex = list(ds.iter_examples("#T", history(), "competitive"))[-1]
        blinded = ds.PredictionExample(
            player_tag=ex.player_tag, timestamp=ex.timestamp, domain=ex.domain,
            history=ex.history,
            truth=ds.DeckPlay(battle_time=ex.timestamp, mode="", cards=()),
            cluster_history=ex.cluster_history)
        for name, (predict, _rank) in splits.NEXT_DECK_MODELS.items():
            self.assertEqual(predict(ex), predict(blinded),
                             "%s must not depend on truth" % name)
        self.assertEqual(splits.incoming_candidates(ex),
                         splits.incoming_candidates(blinded))


class EventBuckets(unittest.TestCase):
    def test_no_change_buckets(self):
        ex = list(ds.iter_examples("#T", history(), "competitive"))[-1]
        self.assertEqual(set(splits.buckets_for(ex)), {"overall", "no-change"})

    def test_one_card_change_buckets(self):
        plays = history(8) + [play(9, "ice-golem")]
        ex = list(ds.iter_examples("#T", plays, "competitive"))[-1]
        self.assertEqual(set(splits.buckets_for(ex)),
                         {"overall", "change", "1-card"})

    def test_two_card_change_buckets(self):
        two = CORE[:6] + ["ice-golem", "tesla"]
        plays = history(8) + [ds.DeckPlay(
            battle_time="20260809T120000.000Z", mode="Ladder", cards=tuple(two))]
        ex = list(ds.iter_examples("#T", plays, "competitive"))[-1]
        self.assertEqual(set(splits.buckets_for(ex)),
                         {"overall", "change", "2-card"})

    def test_every_example_lands_in_overall(self):
        for ex in ds.iter_examples("#T", history(), "competitive"):
            self.assertIn("overall", splits.buckets_for(ex))


class NoDatabase(unittest.TestCase):
    """The suites must open NO database — the project's standing convention.

    This caught a real violation: `duel_zone.cluster_player_decks` resolves
    evolution art through `clash_data.card_art_profile`, which calls
    `resolve_db_path()`. Art has nothing to do with cluster membership, so the
    one test that compares against production stubs it.
    """

    def test_dataset_and_contract_suites_open_no_connection(self):
        import clash_data as cd
        saved = (cd.connect, cd.resolve_db_path)

        def boom(*a, **k):
            raise AssertionError("a test opened a database connection")

        cd.connect, cd.resolve_db_path = boom, boom
        try:
            import test_ml_dataset
            import test_ml_metrics
            loader = unittest.TestLoader()
            suite = unittest.TestSuite([
                loader.loadTestsFromModule(test_ml_dataset),
                loader.loadTestsFromModule(test_ml_metrics),
            ])
            with open(os.devnull, "w") as sink:
                result = unittest.TextTestRunner(
                    verbosity=0, stream=sink).run(suite)
        finally:
            cd.connect, cd.resolve_db_path = saved

        self.assertTrue(result.wasSuccessful(),
                        "suites must pass with the database made unreachable: "
                        "%s %s" % (result.failures, result.errors))


if __name__ == "__main__":
    unittest.main(verbosity=1)
