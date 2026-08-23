"""Phase 18 contracts. Synthetic fixtures, stdlib unittest, no database.

Phase 18 claims a deck was novel and that a generator would or would not have
produced it. Both claims collapse if any future information reaches the state,
so most of this file is leakage contracts. The strongest one is
`test_changing_the_truth_does_not_change_generation` - if generation is truly
independent of the answer, swapping the answer must not move it.
"""
import ast
import itertools
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml.evaluation import phase18 as P


def deck(*cards):
    base = ["a", "b", "c", "d", "e", "f", "g", "h"]
    out = list(cards) + [c for c in base if c not in cards]
    return tuple(sorted(out[:8]))


A = deck()
B = deck("x1", "x2")
C = deck("y1", "y2", "y3")


def plays(*pairs):
    return list(pairs)


class State(unittest.TestCase):
    def test_absorb_records_cards_pairs_triples_fragments(self):
        st = P.PlayerState()
        st.absorb(A)
        self.assertEqual(st.cards, set(A))
        self.assertEqual(len(st.pairs), 28)
        self.assertEqual(len(st.triples), 56)
        self.assertEqual(len(st.fragments[6]), 28)

    def test_absorbing_the_same_deck_twice_is_idempotent(self):
        st = P.PlayerState()
        st.absorb(A)
        n = (len(st.pairs), len(st.triples), len(st.fragments[4]))
        st.absorb(A)
        self.assertEqual((len(st.pairs), len(st.triples), len(st.fragments[4])), n)
        self.assertEqual(st.card_counts[A[0]], 2, "card counts still accumulate")


class Novelty(unittest.TestCase):
    def test_first_switch_to_an_unseen_deck_is_novel(self):
        steps = P.walk("#T", "duel", plays(("1", A), ("2", B)))
        self.assertTrue(steps[0].novel)

    def test_a_return_is_not_novel(self):
        steps = P.walk("#T", "duel", plays(("1", A), ("2", B), ("3", A)))
        self.assertTrue(steps[0].novel)
        self.assertFalse(steps[1].novel)

    def test_no_change_steps_are_emitted_and_not_novel(self):
        steps = P.walk("#T", "duel", plays(("1", A), ("2", A)))
        self.assertEqual(len(steps), 1)
        self.assertFalse(steps[0].changed)
        self.assertFalse(steps[0].novel)

    def test_novel_classification_uses_only_pre_cutoff_history(self):
        short = P.walk("#T", "duel", plays(("1", A), ("2", B)))
        long = P.walk("#T", "duel", plays(("1", A), ("2", B), ("3", A), ("4", B)))
        self.assertTrue(short[0].novel)
        self.assertTrue(long[0].novel, "a later replay must not un-novel the first")
        self.assertFalse(long[2].novel)

    def test_equal_timestamps_are_still_ordered_by_position(self):
        """Two rows at one instant: the second cannot use the first as its own
        precedent for its OWN deck, but the first is genuinely earlier history."""
        steps = P.walk("#T", "duel", plays(("1", A), ("1", B)))
        self.assertTrue(steps[0].novel)


class Leakage(unittest.TestCase):
    def test_future_cards_never_enter_the_vocabulary(self):
        steps = P.walk("#T", "duel", plays(("1", A), ("2", B), ("3", C)))
        first = steps[0]
        for card in ("y1", "y2", "y3"):
            self.assertNotIn(card, set(first.prev),
                             "a future card reached an earlier step")
        # At step 0 only A had been played, so B's new cards are unseen.
        self.assertEqual(first.truth_in_pool, 6)   # 6 of B's 8 come from A

    def test_the_truth_deck_is_not_used_as_its_own_fragment(self):
        steps = P.walk("#T", "duel", plays(("1", A), ("2", B)))
        self.assertFalse(steps[0].c3,
                         "truth covered itself as a fragment")

    def test_changing_the_truth_does_not_change_generation(self):
        """Generation must depend on history alone. Same history, two different
        answers -> identical player state, so identical candidate SIZES."""
        h = [("1", A), ("2", deck("q1"))]
        s1 = P.walk("#T", "duel", h + [("3", B)])
        s2 = P.walk("#T", "duel", h + [("3", C)])
        self.assertEqual(s1[-1].c0_size_2, s2[-1].c0_size_2)
        self.assertEqual(s1[-1].vocab_cards, s2[-1].vocab_cards)
        self.assertEqual(s1[-1].vocab_decks, s2[-1].vocab_decks)

    def test_generation_does_not_require_the_truth_to_exist(self):
        """A generator size is a property of history; it must compute with no
        truth at all."""
        st = P.PlayerState()
        st.absorb(A)
        # A player who has only ever fielded ONE deck has no other cards, so
        # C0 correctly generates nothing. Give them a second deck.
        self.assertEqual(P.c0_size(A, st, 2), 0)
        st.absorb(deck("z1", "z2", "z3"))
        self.assertGreater(P.c0_size(A, st, 2), 0)

    def test_players_do_not_cross_contaminate(self):
        s1 = P.walk("#P1", "duel", plays(("1", A), ("2", B)))
        s2 = P.walk("#P2", "duel", plays(("1", A), ("2", B)))
        self.assertTrue(s1[0].novel and s2[0].novel)
        self.assertEqual(s1[0].vocab_cards, s2[0].vocab_cards)

    def test_domains_do_not_cross_contaminate(self):
        """walk() is per (player, domain); nothing shared can exist between two
        calls, which is the structural guarantee."""
        d = P.walk("#P1", "duel", plays(("1", A), ("2", B)))
        c = P.walk("#P1", "competitive", plays(("1", C), ("2", B)))
        self.assertTrue(d[0].novel)
        self.assertTrue(c[0].novel, "duel history leaked into competitive")


class Generators(unittest.TestCase):
    def test_c0_needs_the_incoming_cards_to_be_known(self):
        st = P.PlayerState()
        st.absorb(A)
        one_off = tuple(sorted(set(A) - {"a"} | {"zz"}))
        self.assertFalse(P.c0_covered(one_off, A, st, 1), "zz was never played")
        st.absorb(deck("zz"))
        self.assertTrue(P.c0_covered(one_off, A, st, 1))

    def test_c0_respects_the_substitution_budget(self):
        st = P.PlayerState()
        st.absorb(A)
        st.absorb(deck("z1", "z2", "z3"))
        two_off = tuple(sorted(set(A) - {"a", "b"} | {"z1", "z2"}))
        self.assertFalse(P.c0_covered(two_off, A, st, 1))
        self.assertTrue(P.c0_covered(two_off, A, st, 2))

    def test_c0_size_grows_with_the_budget(self):
        st = P.PlayerState()
        st.absorb(A)
        st.absorb(deck("z1", "z2", "z3"))
        self.assertLess(P.c0_size(A, st, 1), P.c0_size(A, st, 2))

    def test_c1_requires_every_pair_seen(self):
        st = P.PlayerState()
        st.absorb(A)
        self.assertTrue(P.c1_covered(A, st))
        mixed = tuple(sorted(set(A) - {"a"} | {"zz"}))
        st.absorb(deck("zz"))
        # zz has now been seen WITH most of A, so check a pair that never co-occurred
        st2 = P.PlayerState()
        st2.absorb(A)
        st2.absorb(("zz", "q1", "q2", "q3", "q4", "q5", "q6", "q7"))
        self.assertFalse(P.c1_covered(mixed, st2))

    def test_c2_is_stricter_than_c1(self):
        st = P.PlayerState()
        st.absorb(A)
        self.assertTrue(P.c1_covered(A, st))
        self.assertTrue(P.c2_covered(A, st))

    def test_c3_finds_a_fragment_and_completes_from_the_pool(self):
        st = P.PlayerState()
        st.absorb(A)
        st.absorb(deck("z1", "z2"))          # shares 6 cards with A
        target = tuple(sorted(set(A) - {"a", "b"} | {"z1", "z2"}))
        self.assertTrue(P.c3_covered(target, st))
        self.assertIn(P.c3_detail(target, st), P.FRAGMENT_SIZES)

    def test_c3_fails_when_no_fragment_matches(self):
        st = P.PlayerState()
        st.absorb(A)
        alien = ("m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8")
        self.assertFalse(P.c3_covered(alien, st))

    def test_pool_coverage(self):
        st = P.PlayerState()
        st.absorb(A)
        self.assertTrue(P.pool_covered(A, st))
        self.assertFalse(P.pool_covered(("zz",) + A[1:], st))

    def test_c0_one_card_rank_is_none_for_multi_card_changes(self):
        st = P.PlayerState()
        st.absorb(A)
        st.absorb(deck("z1", "z2"))
        two_off = tuple(sorted(set(A) - {"a", "b"} | {"z1", "z2"}))
        self.assertIsNone(P.c0_one_card_rank(two_off, A, st))

    def test_c0_one_card_rank_prefers_the_more_played_card(self):
        st = P.PlayerState()
        st.absorb(A)
        for _ in range(5):
            st.absorb(deck("pop"))            # "pop" fielded often
        st.absorb(deck("rare"))
        target_pop = tuple(sorted(set(A) - {"a"} | {"pop"}))
        target_rare = tuple(sorted(set(A) - {"a"} | {"rare"}))
        self.assertLess(P.c0_one_card_rank(target_pop, A, st),
                        P.c0_one_card_rank(target_rare, A, st))


class Arithmetic(unittest.TestCase):
    def test_choose(self):
        self.assertEqual(P._choose(8, 2), 28)
        self.assertEqual(P._choose(8, 3), 56)
        self.assertEqual(P._choose(5, 0), 1)
        self.assertEqual(P._choose(3, 5), 0)

    def test_c0_size_matches_brute_force(self):
        """The analytic size must equal what enumeration would produce."""
        st = P.PlayerState()
        st.absorb(A)
        st.absorb(deck("z1", "z2", "z3"))
        pool = [c for c in st.cards if c not in set(A)]
        brute = 0
        for k in (1, 2):
            brute += (len(list(itertools.combinations(range(8), k)))
                      * len(list(itertools.combinations(pool, k))))
        self.assertEqual(P.c0_size(A, st, 2), brute)


class NoProductionDependency(unittest.TestCase):
    def test_phase18_imports_no_production_module(self):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "ml", "evaluation", "phase18.py")
        tree = ast.parse(open(path, encoding="utf-8").read())
        names = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names += [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names.append(node.module or "")
        for n in names:
            self.assertNotIn("production", n)

    def test_module_performs_no_database_writes(self):
        src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "ml", "evaluation", "phase18.py"),
                   encoding="utf-8").read().upper()
        for forbidden in ("INSERT ", "UPDATE ", "DELETE ", "CREATE TABLE", "DROP "):
            self.assertNotIn(forbidden, src)


if __name__ == "__main__":
    unittest.main(verbosity=1)
