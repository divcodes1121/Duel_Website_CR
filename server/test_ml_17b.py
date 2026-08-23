"""Phase 17B contracts. Synthetic fixtures, stdlib unittest, no database.

The measurement claims a deck was "historical" or "novel" at a moment in time.
Both claims are only worth anything if the history used to make them genuinely
predates the step, so most of this file is leakage contracts rather than
arithmetic.
"""
import ast
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml.evaluation import phase17b as P


def D(*cards):
    """An 8-card deck key from a short label, so fixtures stay readable."""
    base = ["a", "b", "c", "d", "e", "f", "g", "h"]
    out = list(cards) + base[len(cards):]
    return tuple(sorted(out[:8]))


A, B, C = D("A1"), D("B1"), D("C1")


def plays(*pairs):
    return [(ts, deck) for ts, deck in pairs]


class DeckIdentity(unittest.TestCase):
    def test_eight_cards_only(self):
        self.assertIsNone(P.deck_key('["a","b","c"]'))
        self.assertIsNone(P.deck_key('["a","b","c","d","e","f","g","h","i"]'))
        self.assertIsNotNone(P.deck_key('["a","b","c","d","e","f","g","h"]'))

    def test_native_duel_loadouts_are_not_decks(self):
        """16/24-card rows must never become an 8-card deck."""
        sixteen = '[' + ",".join('"c%d"' % i for i in range(16)) + ']'
        self.assertIsNone(P.deck_key(sixteen))

    def test_order_does_not_change_identity(self):
        self.assertEqual(P.deck_key('["h","g","f","e","d","c","b","a"]'),
                         P.deck_key('["a","b","c","d","e","f","g","h"]'))

    def test_duplicate_cards_are_rejected(self):
        self.assertIsNone(P.deck_key('["a","a","c","d","e","f","g","h"]'))

    def test_malformed_json_is_skipped_not_raised(self):
        self.assertIsNone(P.deck_key("not json"))
        self.assertIsNone(P.deck_key(""))


class ModeClassification(unittest.TestCase):
    def test_casing_regression(self):
        """The Phase 1 zero-step bug: raw casing vs a lowercase allowlist."""
        self.assertEqual(P.classify_domain("Ladder"), "competitive")
        self.assertEqual(P.classify_domain("ladder"), "competitive")

    def test_unknown_mode_is_neither_domain(self):
        # NOT "Showdown_Friendly_Nonsense": is_duel_like_mode matches by prefix
        # and calls it duel. That is the repository definition and this phase
        # imports it rather than re-deciding it.
        self.assertIsNone(P.classify_domain("Crazy_Arena"))
        self.assertIsNone(P.classify_domain("TeamVsTeam"))
        self.assertIsNone(P.classify_domain(""))
        self.assertIsNone(P.classify_domain(None))


class SwitchDetection(unittest.TestCase):
    def test_staying_on_the_same_deck_is_not_a_switch(self):
        ev = P.switch_events("#T", "duel", plays(("1", A), ("2", A), ("3", A)))
        self.assertEqual(ev, [])

    def test_a_changed_deck_is_a_switch(self):
        ev = P.switch_events("#T", "duel", plays(("1", A), ("2", B)))
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0].prev, A)
        self.assertEqual(ev[0].truth, B)

    def test_first_play_never_produces_an_event(self):
        ev = P.switch_events("#T", "duel", plays(("1", A)))
        self.assertEqual(ev, [])


class HistoricalVersusNovel(unittest.TestCase):
    def test_a_first_sighting_is_novel(self):
        ev = P.switch_events("#T", "duel", plays(("1", A), ("2", B)))
        self.assertFalse(ev[0].historical)

    def test_a_return_is_historical(self):
        #      A     B      back to A
        ev = P.switch_events("#T", "duel", plays(("1", A), ("2", B), ("3", A)))
        self.assertFalse(ev[0].historical)      # B was new
        self.assertTrue(ev[1].historical)       # A had been played

    def test_the_truth_deck_is_never_its_own_precedent(self):
        """THE core leakage contract: history folds in only after the step."""
        ev = P.switch_events("#T", "duel", plays(("1", A), ("2", B)))
        self.assertFalse(ev[0].historical)
        self.assertNotIn(B, ev[0].pool_recent)
        self.assertNotIn(B, ev[0].pool_freq)

    def test_a_future_deck_cannot_make_a_step_historical(self):
        """Playing B later must not retro-classify the earlier switch to B."""
        early = P.switch_events("#T", "duel", plays(("1", A), ("2", B)))
        later = P.switch_events("#T", "duel",
                                plays(("1", A), ("2", B), ("3", A), ("4", B)))
        self.assertFalse(early[0].historical)
        self.assertFalse(later[0].historical)   # same step, same verdict
        self.assertTrue(later[2].historical)    # the SECOND return is historical

    def test_repeated_returns_are_each_historical(self):
        ev = P.switch_events("#T", "duel",
                             plays(("1", A), ("2", B), ("3", A), ("4", B),
                                   ("5", A)))
        self.assertEqual([e.historical for e in ev], [False, True, True, True])

    def test_outings_ago_counts_plays_not_events(self):
        ev = P.switch_events("#T", "duel",
                             plays(("1", A), ("2", B), ("3", B), ("4", A)))
        self.assertTrue(ev[-1].historical)
        self.assertEqual(ev[-1].outings_ago, 3)      # index 3 minus index 0

    def test_novel_events_carry_no_recency(self):
        ev = P.switch_events("#T", "duel", plays(("1", A), ("2", B)))
        self.assertIsNone(ev[0].outings_ago)


class RankPools(unittest.TestCase):
    def test_the_current_deck_is_excluded_from_the_pool(self):
        """Leaving `prev` in guarantees R0 scores 0 at rank 1 by construction -
        the Phase 1 `recent`-on-change-events trap."""
        ev = P.switch_events("#T", "duel",
                             plays(("1", A), ("2", B), ("3", A)))
        # At ev[1] the player is ON B and returns to A, so B is what must go.
        self.assertEqual(ev[1].prev, B)
        self.assertNotIn(B, ev[1].pool_recent)
        self.assertNotIn(B, ev[1].pool_freq)

    def test_truth_is_in_the_pool_EXACTLY_when_it_is_historical(self):
        """The pool holds decks played strictly before the step. So a returning
        deck SHOULD be there - that is what retrieval retrieves - and a genuinely
        new one must NOT be, or `novel` would be unmeasurable."""
        ev = P.switch_events("#T", "duel",
                             plays(("1", A), ("2", B), ("3", C), ("4", A)))
        for e in ev:
            present = e.truth in e.pool_recent
            self.assertEqual(present, e.historical,
                             "pool membership disagrees with the historical flag")
            self.assertEqual(e.truth in e.pool_freq, e.historical)

    def test_a_novel_truth_is_absent_from_both_pools(self):
        ev = P.switch_events("#T", "duel", plays(("1", A), ("2", B)))
        self.assertFalse(ev[0].historical)
        self.assertNotIn(B, ev[0].pool_recent)
        self.assertNotIn(B, ev[0].pool_freq)

    def test_recency_pool_is_most_recent_first(self):
        ev = P.switch_events("#T", "duel",
                             plays(("1", A), ("2", B), ("3", C), ("4", A)))
        # At the final step prev=C, history order A,B,C -> pool most recent first
        self.assertEqual(ev[-1].pool_recent[0], B)

    def test_frequency_pool_is_most_played_first(self):
        ev = P.switch_events("#T", "duel",
                             plays(("1", A), ("2", A), ("3", A), ("4", B),
                                   ("5", C)))
        self.assertEqual(ev[-1].pool_freq[0], A)

    def test_vocab_counts_distinct_prior_decks(self):
        ev = P.switch_events("#T", "duel",
                             plays(("1", A), ("2", B), ("3", C)))
        self.assertEqual(ev[0].vocab, 1)     # only A seen
        self.assertEqual(ev[1].vocab, 2)     # A and B seen


class Isolation(unittest.TestCase):
    def test_players_do_not_cross_contaminate(self):
        by = {("#P1", "duel"): plays(("1", A), ("2", B)),
              ("#P2", "duel"): plays(("1", C), ("2", B))}
        events, players, _ = P.collect(by, min_plays=2)
        # B is novel for BOTH players; P1 playing it cannot help P2.
        self.assertEqual([e.historical for e in events["duel"]], [False, False])
        self.assertEqual(players["duel"], {"#P1", "#P2"})

    def test_domains_do_not_cross_contaminate(self):
        by = {("#P1", "duel"): plays(("1", A), ("2", B)),
              ("#P1", "competitive"): plays(("1", C), ("2", B))}
        events, _, _ = P.collect(by, min_plays=2)
        self.assertFalse(events["duel"][0].historical)
        self.assertFalse(events["competitive"][0].historical,
                         "duel history leaked into competitive")

    def test_equal_timestamps_are_not_treated_as_earlier(self):
        """Two rows at the same instant: neither may serve as the other's past."""
        ev = P.switch_events("#T", "duel", plays(("1", A), ("1", B)))
        self.assertFalse(ev[0].historical)

    def test_thin_players_are_excluded_by_min_plays(self):
        by = {("#P1", "duel"): plays(("1", A), ("2", B))}
        events, players, _ = P.collect(by, min_plays=10)
        self.assertEqual(events.get("duel", []), [])
        self.assertEqual(players.get("duel", set()), set())


class Retrieval(unittest.TestCase):
    def test_recall_and_mrr_on_a_hand_checked_fixture(self):
        ev = P.switch_events("#T", "duel",
                             plays(("1", A), ("2", B), ("3", C), ("4", A)))
        hist = [e for e in ev if e.historical]
        self.assertEqual(len(hist), 1)             # only the return to A
        r = P.retrieval(ev, "pool_recent")
        self.assertEqual(r["n"], 1)
        # prev=C excluded; pool is [B, A] most-recent-first, so A is rank 2.
        self.assertEqual(r["recall"][1], 0.0)
        self.assertEqual(r["recall"][3], 1.0)
        self.assertAlmostEqual(r["mrr"], 0.5)

    def test_novel_events_are_not_scored(self):
        ev = P.switch_events("#T", "duel", plays(("1", A), ("2", B)))
        self.assertEqual(P.retrieval(ev, "pool_recent")["n"], 0)


class NoProductionDependency(unittest.TestCase):
    def test_phase17b_imports_no_production_module(self):
        """A feasibility measurement must not measure the shipped system."""
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "ml", "evaluation", "phase17b.py")
        tree = ast.parse(open(path, encoding="utf-8").read())
        names = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names += [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names.append(node.module or "")
        for n in names:
            self.assertNotIn("production", n,
                             "phase17b must not import %s" % n)

    def test_module_performs_no_writes(self):
        src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "ml", "evaluation", "phase17b.py"),
                   encoding="utf-8").read()
        for forbidden in ("INSERT", "UPDATE ", "DELETE", "CREATE TABLE", "DROP"):
            self.assertNotIn(forbidden, src.upper().replace("UPDATE(", ""))


if __name__ == "__main__":
    unittest.main(verbosity=1)
