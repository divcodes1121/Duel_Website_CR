"""test_ml_vocabulary.py — Phase 9 player-wide pool.

The leakage contract is the point of this file: a card first seen at T must not
be in the pool used at T.

    python server/test_ml_vocabulary.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import candidates as C        # noqa: E402
from ml import exit_model as E        # noqa: E402
from ml import substitution as S      # noqa: E402
from ml import vocabulary as V        # noqa: E402

CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]


def view(extra="knight", shell=("ice-golem",)):
    deck = sorted(CORE + [extra])
    counts = dict({c: 20 for c in CORE}, **{extra: 12})
    for c in shell:
        counts[c] = 5
    return {"tag": "#A", "domain": "duel", "ts": "20260810T120000.000Z",
            "prev_deck": deck, "cluster_size": 20,
            "cluster_card_counts": counts, "prior_edits": []}


class Leakage(unittest.TestCase):
    def test_a_card_seen_only_at_T_is_absent_from_the_pool_at_T(self):
        """THE CONTRACT. observe() must come after pool_for()."""
        vocab = V.PlayerVocabulary()
        v = view()
        pool_before = vocab.pool_for(v)
        self.assertNotIn("mega-knight", pool_before)
        vocab.observe("#A", "duel", ["mega-knight"])
        self.assertIn("mega-knight", vocab.pool_for(v))

    def test_pool_is_empty_for_an_unseen_player(self):
        pool = V.PlayerVocabulary().pool_for(view())
        # Only the current shell contributes before anything is observed.
        self.assertEqual(set(pool), {"ice-golem"})

    def test_domains_do_not_bleed_into_each_other(self):
        vocab = V.PlayerVocabulary()
        vocab.observe("#A", "competitive", ["mega-knight"])
        self.assertNotIn("mega-knight", vocab.pool_for(view()))

    def test_players_do_not_bleed_into_each_other(self):
        vocab = V.PlayerVocabulary()
        vocab.observe("#B", "duel", ["mega-knight"])
        self.assertNotIn("mega-knight", vocab.pool_for(view()))


class Tiers(unittest.TestCase):
    def setUp(self):
        self.vocab = V.PlayerVocabulary()
        for _ in range(5):
            self.vocab.observe("#A", "duel", ["often-used"])
        self.vocab.observe("#A", "duel", ["rarely-used"])

    def test_shell_cards_are_tier_one(self):
        self.assertEqual(self.vocab.pool_for(view())["ice-golem"], V.TIER_SHELL)

    def test_frequent_player_cards_are_tier_two(self):
        self.assertEqual(self.vocab.pool_for(view())["often-used"],
                         V.TIER_PLAYER_FREQ)

    def test_rare_player_cards_are_tier_three(self):
        self.assertEqual(self.vocab.pool_for(view())["rarely-used"],
                         V.TIER_PLAYER_RARE)

    def test_global_cards_are_tier_four(self):
        pool = self.vocab.pool_for(view(), global_prior=["meta-card"])
        self.assertEqual(pool["meta-card"], V.TIER_GLOBAL)

    def test_shell_membership_outranks_player_frequency(self):
        """A card in the current shell stays tier 1 however often it is used."""
        for _ in range(50):
            self.vocab.observe("#A", "duel", ["ice-golem"])
        self.assertEqual(self.vocab.pool_for(view())["ice-golem"], V.TIER_SHELL)

    def test_current_deck_is_never_in_the_pool(self):
        pool = self.vocab.pool_for(view(), global_prior=["hog"])
        for card in view()["prev_deck"]:
            self.assertNotIn(card, pool)

    def test_tier_weights_decrease_with_evidence(self):
        w = [V.tier_weight(t) for t in (V.TIER_SHELL, V.TIER_PLAYER_FREQ,
                                        V.TIER_PLAYER_RARE, V.TIER_GLOBAL)]
        self.assertTrue(all(a > b for a, b in zip(w, w[1:])))


class PoolDrivesGeneration(unittest.TestCase):
    def _gen(self):
        return C.C1WideOneCard(E.E4Combined(E.PopulationExitStats()),
                               S.S2Transition(S.GlobalStats()))

    def test_override_widens_the_candidate_set(self):
        v = view()
        narrow = self._gen().generate(v)
        wide = self._gen().generate(
            dict(v, pool_override={"ice-golem": 1, "extra-a": 2, "extra-b": 3}))
        self.assertGreater(len(wide), len(narrow))

    def test_override_entries_come_from_the_override(self):
        v = dict(view(), pool_override={"only-this": 1})
        for c in self._gen().generate(v):
            for y in c.entries:
                self.assertEqual(y, "only-this")

    def test_override_still_excludes_the_current_deck(self):
        v = dict(view(), pool_override={c: 1 for c in view()["prev_deck"]})
        for c in self._gen().generate(v):
            self.assertEqual(c.size, 0, "nothing legal can enter")

    def test_a_truth_outside_the_shell_becomes_reachable(self):
        """The Phase 8 finding, as a test."""
        v = view()
        truth = sorted((set(v["prev_deck"]) - {"knight"}) | {"other-shell-card"})
        self.assertIsNone(self._gen().recall(v, truth)["rank"])
        widened = dict(v, pool_override={"other-shell-card": 2})
        self.assertIsNotNone(self._gen().recall(widened, truth)["rank"])


class Diversity(unittest.TestCase):
    def test_counts_unique_decks_and_patterns(self):
        from ml.edit_model import Candidate
        prev = view()["prev_deck"]
        cands = [Candidate(("knight",), ("a",)), Candidate(("knight",), ("b",))]
        d = V.diversity(cands, prev)
        self.assertEqual(d["unique_decks"], 2)
        self.assertEqual(d["unique_entry_cards"], 2)
        self.assertEqual(d["n"], 2)

    def test_repeated_candidates_do_not_inflate_diversity(self):
        from ml.edit_model import Candidate
        prev = view()["prev_deck"]
        cands = [Candidate(("knight",), ("a",))] * 5
        d = V.diversity(cands, prev)
        self.assertEqual(d["unique_decks"], 1)
        self.assertEqual(d["unique_patterns"], 1)
        self.assertEqual(d["n"], 5)


if __name__ == "__main__":
    unittest.main(verbosity=1)
