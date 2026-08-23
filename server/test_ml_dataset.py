"""test_ml_dataset.py — the leak-free dataset layer.

Synthetic only: no database, no network. Runs on a machine with no Clash_Bot
install, exactly like every other suite here.

    python server/test_ml_dataset.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import config                       # noqa: E402
from ml import dataset as ds                # noqa: E402
import duel_zone as dz                      # noqa: E402


def play(t, cards, mode="Ranked1v1_NewArena2"):
    return ds.DeckPlay(battle_time=t, mode=mode, cards=tuple(cards))


CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]


def variant(extra):
    return CORE + [extra]


class ModeNormalisation(unittest.TestCase):
    """THE REGRESSION. Stored modes are cased; META_MODES is lowercase."""

    def test_cased_competitive_modes_are_recognised(self):
        for mode in ("Ranked1v1_NewArena2", "Ranked1v1_NewArena",
                     "Ladder", "Tournament"):
            self.assertEqual(ds.classify_domain(mode), "competitive",
                             "%s must classify as competitive" % mode)

    def test_lowercase_still_works(self):
        self.assertEqual(ds.classify_domain("ladder"), "competitive")

    def test_duel_like_modes(self):
        self.assertEqual(ds.classify_domain("Friendly"), "duel")
        self.assertEqual(ds.classify_domain("cw_duel_1v1"), "duel")

    def test_excluded_modes(self):
        for mode in ("TeamVsTeam", "Crazy_Arena", "All_Random_Princess",
                     "Challenge_AllCards_EventDeck_NoSet", "PickMode"):
            self.assertIsNone(ds.classify_domain(mode))

    def test_duel_is_not_inferred_from_substring(self):
        """An unrecognised mode containing 'duel' must not become a duel."""
        self.assertIsNone(ds.classify_domain("Some_New_Duel_Event"))

    def test_empty_mode(self):
        self.assertIsNone(ds.classify_domain(""))
        self.assertIsNone(ds.classify_domain(None))


class CardParsing(unittest.TestCase):
    def test_valid_eight(self):
        raw = '["a","b","c","d","e","f","g","h"]'
        self.assertEqual(len(ds.parse_cards(raw)), 8)

    def test_malformed_json(self):
        self.assertIsNone(ds.parse_cards("{oops"))
        self.assertIsNone(ds.parse_cards(None))
        self.assertIsNone(ds.parse_cards(""))

    def test_native_duel_loadout_rejected(self):
        for n in (16, 24):
            raw = "[" + ",".join('"c%d"' % i for i in range(n)) + "]"
            self.assertIsNone(ds.parse_cards(raw),
                              "%d-card loadout is not a deck" % n)

    def test_wrong_length(self):
        self.assertIsNone(ds.parse_cards('["a","b"]'))

    def test_duplicate_cards_rejected(self):
        self.assertIsNone(ds.parse_cards('["a","a","c","d","e","f","g","h"]'))

    def test_non_string_entries(self):
        self.assertIsNone(ds.parse_cards('[1,2,3,4,5,6,7,8]'))
        self.assertIsNone(ds.parse_cards('["a","","c","d","e","f","g","h"]'))

    def test_not_a_list(self):
        self.assertIsNone(ds.parse_cards('{"a":1}'))


class Clustering(unittest.TestCase):
    def test_variants_merge_at_six(self):
        plays = [play("1", variant("knight")),
                 play("2", variant("ice-golem")),
                 play("3", variant("knight"))]
        clusters = ds.cluster_prefix(plays)
        self.assertEqual(len(clusters), 1)
        self.assertEqual(len(clusters[0]), 3)

    def test_distinct_decks_do_not_merge(self):
        other = ["golem", "lightning", "tornado", "baby-dragon",
                 "night-witch", "barbarian-barrel", "elixir-collector", "mega-minion"]
        clusters = ds.cluster_prefix([play("1", variant("knight")),
                                      play("2", other)])
        self.assertEqual(len(clusters), 2)

    def test_members_are_time_ordered(self):
        plays = [play("3", variant("knight")), play("1", variant("knight")),
                 play("2", variant("ice-golem"))]
        members = ds.cluster_prefix(plays)[0]
        self.assertEqual([p.battle_time for p in members], ["1", "2", "3"])

    def test_representative_matches_production(self):
        """Our clusterer must agree with `cluster_player_decks` on the rep.

        A second clustering rule is how the harness would end up measuring a
        different system from the one that ships.

        `card_art_profile` is stubbed because `cluster_player_decks` resolves
        evolution/hero art through it, and that reads the DATABASE. Art has no
        bearing on cluster membership, and this suite guarantees it opens no
        database — a guarantee that is itself asserted in test_ml_contract.py.
        """
        import clash_data as cd
        original = cd.card_art_profile
        cd.card_art_profile = lambda *a, **k: {}
        try:
            decks = [variant("knight"), variant("knight"), variant("ice-golem")]
            plays = [play(str(i), d) for i, d in enumerate(decks)]
            ours = ds.cluster_prefix(plays)
            self.assertEqual(len(ours), 1)
            counts = {}
            for p in ours[0]:
                sig = ",".join(sorted(p.cards))
                counts[sig] = counts.get(sig, 0) + 1
            our_rep = max(sorted(counts.items()), key=lambda kv: kv[1])[0]

            theirs = dz.cluster_player_decks(decks, None, len(decks))
            self.assertEqual(len(theirs), 1)
            their_rep = ",".join(sorted(theirs[0]["cards"]))
            self.assertEqual(our_rep, their_rep)
        finally:
            cd.card_art_profile = original

    def test_cluster_containing_finds_by_overlap(self):
        plays = [play(str(i), variant("knight")) for i in range(3)]
        clusters = ds.cluster_prefix(plays)
        found = ds.cluster_containing(clusters, frozenset(variant("ice-golem")))
        self.assertEqual(len(found), 3)

    def test_cluster_containing_returns_empty_when_unrelated(self):
        plays = [play("1", variant("knight"))]
        clusters = ds.cluster_prefix(plays)
        unrelated = frozenset(["a", "b", "c", "d", "e", "f", "g", "h"])
        self.assertEqual(ds.cluster_containing(clusters, unrelated), [])


class ExampleGeneration(unittest.TestCase):
    def _plays(self, n=10, extra="knight"):
        return [play("2026080%dT120000.000Z" % i, variant(extra))
                for i in range(1, n + 1)]

    def test_history_is_strictly_before_truth(self):
        examples = list(ds.iter_examples("#T", self._plays(), "competitive"))
        self.assertTrue(examples)
        for ex in examples:
            ex.assert_leak_free()
            self.assertTrue(all(p.battle_time < ex.timestamp for p in ex.history))

    def test_truth_is_not_in_history(self):
        for ex in ds.iter_examples("#T", self._plays(), "competitive"):
            self.assertNotIn(ex.truth, ex.history)

    def test_min_cluster_history_respected(self):
        plays = self._plays(config.MIN_CLUSTER_HISTORY)
        examples = list(ds.iter_examples("#T", plays, "competitive"))
        for ex in examples:
            self.assertGreaterEqual(len(ex.cluster_history),
                                    config.MIN_CLUSTER_HISTORY)

    def test_too_short_history_yields_nothing(self):
        self.assertEqual(
            list(ds.iter_examples("#T", self._plays(2), "competitive")), [])

    def test_unordered_input_is_sorted(self):
        plays = list(reversed(self._plays()))
        examples = list(ds.iter_examples("#T", plays, "competitive"))
        stamps = [ex.timestamp for ex in examples]
        self.assertEqual(stamps, sorted(stamps))

    def test_timestamp_collision_is_skipped(self):
        """Two rows at the same instant cannot define a 'next' deck."""
        plays = self._plays(8)
        collided = plays + [ds.DeckPlay(battle_time=plays[-1].battle_time,
                                        mode=plays[-1].mode,
                                        cards=tuple(variant("ice-golem")))]
        for ex in ds.iter_examples("#T", collided, "competitive"):
            self.assertTrue(all(p.battle_time < ex.timestamp
                                for p in ex.history))

    def test_change_accounting(self):
        plays = self._plays(8) + [play("20260809T120000.000Z",
                                       variant("ice-golem"))]
        last = list(ds.iter_examples("#T", plays, "competitive"))[-1]
        self.assertTrue(last.changed)
        self.assertEqual(last.n_changes, 1)
        self.assertEqual(last.incoming, frozenset(["ice-golem"]))
        self.assertEqual(last.outgoing, frozenset(["knight"]))

    def test_no_change_accounting(self):
        last = list(ds.iter_examples("#T", self._plays(), "competitive"))[-1]
        self.assertFalse(last.changed)
        self.assertEqual(last.n_changes, 0)
        self.assertEqual(last.incoming, frozenset())

    def test_next_play_marks_a_cluster_switch(self):
        """Under next-play a switch is emitted as a step, marked False."""
        other = ["golem", "lightning", "tornado", "baby-dragon",
                 "night-witch", "barbarian-barrel", "elixir-collector",
                 "mega-minion"]
        plays = self._plays(8) + [play("20260809T120000.000Z", other)]
        last = list(ds.iter_examples("#T", plays, "competitive",
                                     step_mode="next-play"))[-1]
        self.assertFalse(last.same_cluster)
        self.assertTrue(last.changed)

    def test_next_in_cluster_skips_a_deck_with_no_history(self):
        """A brand-new shell has no prior plays, so it cannot be a step yet."""
        other = ["golem", "lightning", "tornado", "baby-dragon",
                 "night-witch", "barbarian-barrel", "elixir-collector",
                 "mega-minion"]
        plays = self._plays(8) + [play("20260809T120000.000Z", other)]
        examples = list(ds.iter_examples("#T", plays, "competitive"))
        self.assertTrue(all(ex.same_cluster for ex in examples))
        self.assertNotIn(frozenset(other),
                         [ex.truth.card_set for ex in examples])

    def test_duel_loadout_rotation_is_not_a_substitution(self):
        """THE DUEL REGRESSION.

        A duel loadout is three decks that cannot share a card, so consecutive
        duel games are card-disjoint BY RULE. Comparing a game against the
        immediately previous one scores that rotation as an 8-card 'change'.
        Under next-in-cluster each shell is compared against its OWN last
        outing, so an unchanged rotation registers no change at all.
        """
        deck_a = variant("knight")
        deck_b = ["golem", "lightning", "tornado", "baby-dragon",
                  "night-witch", "barbarian-barrel", "elixir-collector",
                  "mega-minion"]
        plays = [ds.DeckPlay(battle_time="202608%02dT120000.000Z" % i,
                             mode="Friendly",
                             cards=tuple(deck_a if i % 2 else deck_b))
                 for i in range(1, 13)]              # A, B, A, B, ...

        rotation = list(ds.iter_examples("#T", plays, "duel",
                                         step_mode="next-play"))
        self.assertTrue(any(ex.changed for ex in rotation),
                        "next-play sees the rotation as constant change")

        substitution = list(ds.iter_examples("#T", plays, "duel"))
        self.assertTrue(substitution, "each shell should still yield steps")
        self.assertFalse(any(ex.changed for ex in substitution),
                         "nothing was edited, so there is no substitution")

    def test_unknown_step_mode_is_rejected(self):
        with self.assertRaises(ValueError):
            list(ds.iter_examples("#T", self._plays(), "competitive",
                                  step_mode="whatever"))

    def test_leak_detector_actually_fires(self):
        """The guard must fail on a deliberately corrupted example."""
        good = list(ds.iter_examples("#T", self._plays(), "competitive"))[0]
        bad = ds.PredictionExample(
            player_tag=good.player_tag,
            timestamp=good.timestamp,
            domain=good.domain,
            history=good.history + (good.truth,),      # the answer, smuggled in
            truth=good.truth,
            cluster_history=good.cluster_history)
        with self.assertRaises(AssertionError):
            bad.assert_leak_free()


if __name__ == "__main__":
    unittest.main(verbosity=1)
