"""Contract tests for Phase 21A - spell-conditioned matchup feasibility.

    python server/test_ml_21a.py        # no database, no network

Phase 20B shipped a conclusion built on a tautology and Phase 20D found the
domain had been mislabelled for twenty phases. Both would have been caught by a
test that asserted what the measurement CONTAINED rather than that it ran. The
tests below are written in that spirit: leakage, duel legality, and the exact
shape of the substrate.
"""
from __future__ import annotations

import ast
import collections
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml.evaluation import phase21a as P                      # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "ml", "evaluation", "phase21a.py")

# Real card keys, so archetype/spell logic is exercised rather than mocked.
HOG = "hog-rider"
GIANT = "giant"
FIRE = "fireball"
LOG = "the-log"
ZAP = "zap"
ROCKET = "rocket"


def deck(*extra):
    """An 8-card deck padded with distinct filler troops."""
    filler = [c for c in ["knight", "archers", "musketeer", "valkyrie",
                          "mini-pekka", "skeletons", "ice-spirit", "bats",
                          "goblins", "spear-goblins", "minions", "barbarians"]
              if c not in P.WINCONS]
    out = list(extra)
    for f in filler:
        if len(out) == 8:
            break
        if f not in out:
            out.append(f)
    return tuple(out[:8])


def deck2(*extra):
    """A second deck that shares no cards with `deck()`'s filler."""
    filler = [c for c in ["prince", "wizard", "witch", "baby-dragon",
                          "tesla", "cannon", "tombstone", "furnace",
                          "elixir-collector", "dark-prince"]
              if c not in P.WINCONS]
    out = list(extra)
    for f in filler:
        if len(out) == 8:
            break
        if f not in out:
            out.append(f)
    return tuple(out[:8])


def payload(rounds_a, rounds_b, crowns_a=None, crowns_b=None, opp_tag="#Y"):
    def side(decks, crowns, tag):
        return [{"tag": tag, "rounds": [
            {"cards": [{"name": _name(k)} for k in d], "crowns": c}
            for d, c in zip(decks, crowns)]}]
    ca = crowns_a or [1] * len(rounds_a)
    cb = crowns_b or [0] * len(rounds_b)
    return json.dumps({"team": side(rounds_a, ca, "#X"),
                       "opponent": side(rounds_b, cb, opp_tag)})


_KEY_TO_NAME = {v: k for k, v in P.NAME_TO_KEY.items()}


def _name(key):
    return _KEY_TO_NAME[key]


# --------------------------------------------------------------------------
# The substrate
# --------------------------------------------------------------------------

class TestVocabulary(unittest.TestCase):
    def test_spells_come_from_the_project_vocabulary(self):
        self.assertIn(FIRE, P.SPELLS)
        self.assertIn(LOG, P.SPELLS)
        self.assertNotIn("knight", P.SPELLS)
        self.assertEqual(len(P.SPELLS), 21)

    def test_every_card_name_maps(self):
        self.assertEqual(len(P.NAME_TO_KEY), 122)
        self.assertNotIn(None, P.NAME_TO_KEY)

    def test_archetype_is_the_priciest_win_condition(self):
        self.assertEqual(P.archetype_of(deck(HOG)), HOG)
        both = P.archetype_of(deck(HOG, GIANT))
        self.assertIn(both, (HOG, GIANT))
        self.assertEqual(both, GIANT if P.ELIXIR[GIANT] > P.ELIXIR[HOG] else HOG)

    def test_archetype_none_when_no_win_condition(self):
        self.assertEqual(P.archetype_of(("knight", "archers", "musketeer",
                                         "valkyrie", "mini-pekka", "skeletons",
                                         "ice-spirit", "bats")), "none")

    def test_spells_of_extracts_only_spells(self):
        self.assertEqual(P.spells_of(deck(FIRE, LOG)), frozenset({FIRE, LOG}))


class TestParsing(unittest.TestCase):
    def test_parses_rounds_into_ordered_games(self):
        a = [deck(HOG, FIRE), deck2(GIANT, ROCKET)]
        b = [deck2(GIANT, ZAP), deck(HOG, LOG)]
        s, why = P.parse_series("#X", "20260601T000000.000Z", "CW_Duel_1v1",
                                payload(a, b))
        self.assertIsNotNone(s, why)
        self.assertEqual(len(s.games), 2)
        self.assertEqual(s.games[0].cards, a[0])
        self.assertEqual(s.games[0].opp_cards, b[0])
        self.assertEqual(s.opponent_tag, "#Y")

    def test_result_comes_from_per_round_crowns(self):
        a = [deck(HOG), deck2(GIANT)]
        b = [deck2(GIANT), deck(HOG)]
        s, _ = P.parse_series("#X", "t", "CW_Duel_1v1",
                              payload(a, b, [2, 0], [0, 3]))
        self.assertEqual(s.games[0].result, "win")
        self.assertEqual(s.games[1].result, "loss")

    def test_mismatched_round_counts_rejected(self):
        s, why = P.parse_series("#X", "t", "CW_Duel_1v1",
                                payload([deck(HOG), deck2(GIANT)], [deck(HOG)]))
        self.assertIsNone(s)
        self.assertEqual(why, "round mismatch")

    def test_unparseable_rejected(self):
        s, why = P.parse_series("#X", "t", "CW_Duel_1v1", "{not json")
        self.assertIsNone(s)
        self.assertEqual(why, "unparseable")

    def test_a_round_that_is_not_8_distinct_cards_is_rejected(self):
        bad = json.dumps({"team": [{"tag": "#X", "rounds": [
            {"cards": [{"name": _name("knight")}] * 8, "crowns": 1}]}],
            "opponent": [{"tag": "#Y", "rounds": [
                {"cards": [{"name": _name(k)} for k in deck(HOG)], "crowns": 0}]}]})
        s, why = P.parse_series("#X", "t", "CW_Duel_1v1", bad)
        self.assertIsNone(s)
        self.assertEqual(why, "bad round deck")

    def test_unknown_card_name_rejects_rather_than_guesses(self):
        bad = json.dumps({"team": [{"tag": "#X", "rounds": [
            {"cards": [{"name": "Not A Real Card"}] * 8, "crowns": 1}]}],
            "opponent": [{"tag": "#Y", "rounds": [
                {"cards": [{"name": _name(k)} for k in deck(HOG)], "crowns": 0}]}]})
        s, _ = P.parse_series("#X", "t", "CW_Duel_1v1", bad)
        self.assertIsNone(s)


# --------------------------------------------------------------------------
# Transitions, leakage, and duel legality
# --------------------------------------------------------------------------

class TestSteps(unittest.TestCase):
    def _series(self):
        a = [deck(HOG, FIRE), deck2(GIANT, ROCKET)]
        b = [deck2(GIANT, ZAP), deck(HOG, LOG)]
        s, _ = P.parse_series("#X", "20260601T000000.000Z", "CW_Duel_1v1",
                              payload(a, b, [2, 0], [0, 3]))
        return s, a, b

    def test_both_sides_become_subjects(self):
        s, _a, _b = self._series()
        subs = {st.subject for st in P.steps_of(s)}
        self.assertEqual(subs, {"#X", "#Y"})

    def test_truth_is_the_next_game_only(self):
        s, a, b = self._series()
        for st in P.steps_of(s):
            if st.subject == "#X":
                self.assertEqual(st.truth, a[1])
                self.assertEqual(st.revealed, (a[0],))
            else:
                self.assertEqual(st.truth, b[1])
                self.assertEqual(st.revealed, (b[0],))

    def test_used_contains_only_prior_games(self):
        s, a, _b = self._series()
        st = [x for x in P.steps_of(s) if x.subject == "#X"][0]
        self.assertEqual(st.used, frozenset(a[0]))
        self.assertFalse(st.used & (set(a[1]) - set(a[0])))

    def test_truth_cards_never_enter_used(self):
        """The legality filter must not be handed the answer."""
        s, a, _b = self._series()
        for st in P.steps_of(s):
            self.assertFalse(set(st.truth) & st.used,
                             "truth leaked into the used-card set")

    def test_game_index_is_one_based_and_correct(self):
        s, _a, _b = self._series()
        self.assertEqual({st.game_index for st in P.steps_of(s)}, {2})

    def test_three_game_series_yields_two_steps_per_side(self):
        a = [deck(HOG), deck2(GIANT), deck(ROCKET, "prince")]
        b = [deck2(GIANT), deck(HOG), deck2(FIRE, "wizard")]
        s, why = P.parse_series("#X", "t", "CW_Duel_1v1", payload(a, b))
        self.assertIsNotNone(s, why)
        steps = P.steps_of(s)
        self.assertEqual(len(steps), 4)
        self.assertEqual(sorted(st.game_index for st in steps), [2, 2, 3, 3])

    def test_used_accumulates_across_games(self):
        a = [deck(HOG), deck2(GIANT), deck(ROCKET, "prince")]
        b = [deck2(GIANT), deck(HOG), deck2(FIRE, "wizard")]
        s, _ = P.parse_series("#X", "t", "CW_Duel_1v1", payload(a, b))
        g3 = [st for st in P.steps_of(s)
              if st.subject == "#X" and st.game_index == 3][0]
        self.assertTrue(set(a[0]) <= g3.used)
        self.assertTrue(set(a[1]) <= g3.used)

    def test_subject_win_flag_is_per_side(self):
        s, _a, _b = self._series()
        x = [st for st in P.steps_of(s) if st.subject == "#X"][0]
        y = [st for st in P.steps_of(s) if st.subject == "#Y"][0]
        self.assertNotEqual(x.won, y.won)


class TestLegality(unittest.TestCase):
    def _tables(self):
        t = P.Tables()
        t.player_decks["#X"][tuple(sorted(deck(HOG)))] = 5
        t.player_decks["#X"][tuple(sorted(deck2(GIANT)))] = 3
        t.archetypes.update({HOG, GIANT})
        return t

    def _step(self, used):
        return P.Step(subject="#X", other="#Y", ts="t", game_index=2,
                      revealed=(deck(HOG),), used=frozenset(used),
                      truth=deck2(GIANT), truth_arch=GIANT,
                      other_used=frozenset(), other_revealed=(deck2(GIANT),),
                      won=True)

    def test_a_spent_deck_is_not_a_candidate(self):
        t = self._tables()
        legal = P.legal_archetypes(t, self._step(deck(HOG)))
        self.assertNotIn(HOG, legal)
        self.assertIn(GIANT, legal)

    def test_a_single_spent_card_removes_the_deck(self):
        t = self._tables()
        legal = P.legal_archetypes(t, self._step({deck(HOG)[0]}))
        self.assertNotIn(HOG, legal)

    def test_nothing_spent_leaves_everything_legal(self):
        t = self._tables()
        legal = P.legal_archetypes(t, self._step(set()))
        self.assertEqual(legal, {HOG, GIANT})

    def test_ranking_never_returns_an_illegal_archetype(self):
        t = self._tables()
        st = self._step(deck(HOG))
        pool = P.legal_archetypes(t, st)
        for arm in P.ARMS.values():
            self.assertNotIn(HOG, P.rank(t, st, arm, restrict=pool))

    def test_candidates_come_from_training_decks_not_the_truth(self):
        """An archetype the subject has never played must not appear just
        because it is the answer."""
        t = P.Tables()
        t.archetypes.update({HOG, GIANT})
        st = self._step(set())
        self.assertEqual(P.legal_archetypes(t, st), set())


# --------------------------------------------------------------------------
# Tables and scoring
# --------------------------------------------------------------------------

class TestTables(unittest.TestCase):
    def test_low_support_cells_do_not_move_the_ranking(self):
        t = P.Tables()
        t.archetypes.update({HOG, GIANT})
        t.arch_prior[HOG] = 100
        t.arch_prior[GIANT] = 100
        t.by_spell[FIRE][GIANT] = P.MIN_CELL - 1      # below the floor
        st = P.Step("#X", "#Y", "t", 2, (deck(HOG, FIRE),), frozenset(),
                    deck2(GIANT), GIANT, frozenset(), (deck2(GIANT),), True)
        a = t.score(st, GIANT, ("spells",))
        b = t.score(st, HOG, ("spells",))
        self.assertAlmostEqual(a, b, places=9)

    def test_supported_cells_do_move_the_ranking(self):
        t = P.Tables()
        t.archetypes.update({HOG, GIANT})
        t.arch_prior[HOG] = 100
        t.arch_prior[GIANT] = 100
        t.by_spellset[frozenset({FIRE})][GIANT] = 50
        t.by_spellset[frozenset({FIRE})][HOG] = 1
        st = P.Step("#X", "#Y", "t", 2, (deck(FIRE),), frozenset(),
                    deck2(GIANT), GIANT, frozenset(), (deck2(GIANT),), True)
        self.assertGreater(t.score(st, GIANT, ("spells",)),
                           t.score(st, HOG, ("spells",)))

    def test_arms_are_distinct_information_sets(self):
        self.assertEqual(set(P.ARMS["A full"]), {"history", "cards", "spells"})
        self.assertNotIn("spells", P.ARMS["B no spells"])
        self.assertNotIn("cards", P.ARMS["C no opp cards"])
        self.assertEqual(P.ARMS["D history only"], ("history",))
        self.assertEqual(P.ARMS["E spells only"], ("spells",))

    def test_ablation_arms_differ_only_by_information(self):
        """A and B must share smoothing and priors, or the comparison measures
        regularisation instead of information."""
        self.assertTrue(set(P.ARMS["B no spells"]) < set(P.ARMS["A full"]))


# --------------------------------------------------------------------------
# Isolation
# --------------------------------------------------------------------------

class TestIsolation(unittest.TestCase):
    def test_no_production_import(self):
        with open(SRC, encoding="utf-8") as fh:
            tree = ast.parse(fh.read())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    self.assertNotIn("production", a.name)
            elif isinstance(node, ast.ImportFrom):
                self.assertNotIn("production", node.module or "")

    def test_no_training_and_no_artifact_write(self):
        with open(SRC, encoding="utf-8") as fh:
            src = fh.read()
        self.assertNotIn(".fit(", src)
        self.assertNotIn("ARTIFACT", src)
        self.assertNotIn("shadow", src)

    def test_database_is_opened_read_only(self):
        with open(SRC, encoding="utf-8") as fh:
            src = fh.read()
        self.assertIn("mode=ro", src)

    def test_only_native_duel_modes_are_read(self):
        self.assertEqual(set(P.NATIVE_MODES),
                         {"CW_Duel_1v1", "Duel_1v1_Friendly"})
        with open(SRC, encoding="utf-8") as fh:
            src = fh.read()
        self.assertNotIn("Showdown_Friendly", src)


if __name__ == "__main__":
    unittest.main(verbosity=2)
