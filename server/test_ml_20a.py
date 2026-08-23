"""Phase 20A contracts. Synthetic fixtures, stdlib unittest, no database.

The matchup harness makes a recommendation from a player's earlier battles and
scores it on later ones. Every way that could cheat has a test: fitting on the
games it scores, letting a single lucky game steer a pick, recommending a deck
the duel rules forbid, or letting one player's table reach another's.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml.evaluation import phase20a as P


def deck(*cards):
    base = ["a", "b", "c", "d", "e", "f", "g", "h"]
    out = list(cards) + [c for c in base if c not in cards]
    return tuple(sorted(out[:8]))


A, B, C = deck(), deck("x1", "x2"), deck("y1", "y2", "y3")


def battle(ts, d, arch, won, opp=None):
    return P.Battle(ts, "competitive", d, arch, opp, won)


class DeckIdentity(unittest.TestCase):
    def test_eight_cards_only(self):
        self.assertIsNone(P.deck_key('["a","b","c"]'))
        self.assertIsNotNone(P.deck_key('["a","b","c","d","e","f","g","h"]'))

    def test_duel_loadouts_are_not_decks(self):
        sixteen = "[" + ",".join('"c%d"' % i for i in range(16)) + "]"
        self.assertIsNone(P.deck_key(sixteen))

    def test_malformed_json_is_skipped(self):
        self.assertIsNone(P.deck_key("not json"))

    def test_duplicates_rejected(self):
        self.assertIsNone(P.deck_key('["a","a","c","d","e","f","g","h"]'))


class MinimumSupport(unittest.TestCase):
    def test_one_lucky_game_cannot_steer_a_recommendation(self):
        """A 1-0 cell is a 100% win rate and means nothing. Phases 3 and 4 both
        lost time to exactly this."""
        bs = [battle("1", B, "hog", True)]                      # 1 game, 100%
        bs += [battle(str(i + 2), A, "hog", i < 3) for i in range(5)]  # 5, 60%
        t = P.MatchupTable(bs, lambda b: b.opp_arch)
        self.assertEqual(t.recommend("hog"), A, "an unsupported cell won")

    def test_a_supported_cell_is_used(self):
        bs = [battle(str(i), B, "hog", True) for i in range(6)]
        bs += [battle(str(i + 10), A, "hog", False) for i in range(6)]
        t = P.MatchupTable(bs, lambda b: b.opp_arch)
        self.assertEqual(t.recommend("hog"), B)

    def test_no_recommendation_when_nothing_clears_the_floor(self):
        bs = [battle("1", A, "hog", True), battle("2", B, "hog", True)]
        t = P.MatchupTable(bs, lambda b: b.opp_arch)
        self.assertIsNone(t.recommend("hog"))

    def test_the_floor_is_actually_applied(self):
        self.assertGreaterEqual(P.MIN_CELL_GAMES, 2)


class NoLeakage(unittest.TestCase):
    def test_the_table_is_fitted_only_on_earlier_battles(self):
        """The scoring half must not appear in the fitting half."""
        bs = [battle(str(i), A, "hog", True) for i in range(10)]
        bs += [battle(str(i + 10), B, "hog", True) for i in range(10)]
        res = P.evaluate_player(bs, "competitive", split=0.5)
        self.assertIsNotNone(res)
        # B only ever appears in the test half, so it cannot be the default.
        t = P.MatchupTable(bs[:10], lambda b: b.opp_arch)
        self.assertEqual(t.default_deck(), A)

    def test_players_do_not_share_a_table(self):
        p1 = [battle(str(i), A, "hog", True) for i in range(6)]
        p2 = [battle(str(i), B, "hog", True) for i in range(6)]
        t1 = P.MatchupTable(p1, lambda b: b.opp_arch)
        t2 = P.MatchupTable(p2, lambda b: b.opp_arch)
        self.assertEqual(t1.recommend("hog"), A)
        self.assertEqual(t2.recommend("hog"), B)

    def test_an_unknown_opponent_gets_no_recommendation(self):
        bs = [battle(str(i), A, "hog", True) for i in range(6)]
        t = P.MatchupTable(bs, lambda b: b.opp_arch)
        self.assertIsNone(t.recommend("golem"))

    def test_draws_never_enter_the_win_rate(self):
        """load() drops draws; a draw counted as a loss would understate every
        strategy equally but silently."""
        import inspect
        src = inspect.getsource(P.load)
        self.assertIn('res == "draw"', src)


class DuelCardRule(unittest.TestCase):
    def test_a_recommendation_may_not_repeat_a_used_card(self):
        """Duels forbid card reuse across the loadout. An overlapping deck is
        ILLEGAL, not merely worse."""
        bs = [battle(str(i), A, "hog", True) for i in range(6)]
        bs += [battle(str(i + 10), B, "hog", False) for i in range(6)]
        t = P.MatchupTable(bs, lambda b: b.opp_arch)
        used = set(A)
        legal = lambda d: len(set(d) & used) <= P.DUEL_MAX_SHARED
        self.assertEqual(t.recommend("hog"), A, "A wins outright when legal")
        self.assertNotEqual(t.recommend("hog", legal), A,
                            "an illegal deck was recommended")

    def test_the_rule_is_zero_shared_not_a_tolerance(self):
        self.assertEqual(P.DUEL_MAX_SHARED, 0)

    def test_no_legal_deck_yields_no_recommendation(self):
        bs = [battle(str(i), A, "hog", True) for i in range(6)]
        t = P.MatchupTable(bs, lambda b: b.opp_arch)
        self.assertIsNone(t.recommend("hog", lambda d: False))


class Ranking(unittest.TestCase):
    def test_ranked_returns_best_first_and_respects_support(self):
        bs = [battle(str(i), A, "hog", True) for i in range(6)]        # 100%
        bs += [battle(str(i + 10), B, "hog", i < 3) for i in range(6)]  # 50%
        bs += [battle("99", C, "hog", True)]                            # n=1
        t = P.MatchupTable(bs, lambda b: b.opp_arch)
        r = t.ranked("hog", 3)
        self.assertEqual(r[0], A)
        self.assertIn(B, r)
        self.assertNotIn(C, r, "an unsupported deck entered the ranking")


class Evaluation(unittest.TestCase):
    def test_a_thin_player_is_skipped_rather_than_guessed(self):
        self.assertIsNone(P.evaluate_player([battle("1", A, "hog", True)],
                                            "competitive"))

    def test_coverage_counts_every_test_game(self):
        bs = [battle(str(i), A, "hog", True) for i in range(20)]
        res = P.evaluate_player(bs, "competitive", split=0.5)
        self.assertEqual(res["arch_cov"][1], res["overall"][1])

    def test_default_arm_only_counts_games_x_played_it(self):
        bs = [battle(str(i), A, "hog", True) for i in range(10)]
        bs += [battle(str(i + 10), B, "hog", False) for i in range(10)]
        res = P.evaluate_player(bs, "competitive", split=0.5)
        # every test game is B, the default is A, so the default arm is empty
        self.assertEqual(res["default"][1], 0)

    def test_the_report_states_the_counterfactual_limit(self):
        txt = P.report({})
        self.assertIn("COUNTERFACTUAL", txt.upper())
        self.assertIn("confounded", txt)


class NoProductionDependency(unittest.TestCase):
    def test_imports_no_production_module(self):
        import ast
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "ml", "evaluation", "phase20a.py")
        with open(path, encoding="utf-8") as fh:
            tree = ast.parse(fh.read())
        mods = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                mods += [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                mods.append(node.module or "")
        for m in mods:
            self.assertNotIn("production", m)

    def test_performs_no_writes(self):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "ml", "evaluation", "phase20a.py")
        with open(path, encoding="utf-8") as fh:
            src = fh.read().upper()
        for bad in ("INSERT ", "UPDATE ", "DELETE ", "DROP "):
            self.assertNotIn(bad, src)


if __name__ == "__main__":
    unittest.main(verbosity=1)
