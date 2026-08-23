"""Contract tests for Phase 20B - the duel applicability measurement.

    python server/test_ml_20b.py        # no database, no network

These guard the ways this measurement could quietly lie: leaking the future
into a feature, scoring an outcome that is not strictly later, mixing players
or domains, reading the card-reuse rule back out of a splitter that already
used it, or reaching into production and changing something.
"""
from __future__ import annotations

import ast
import datetime
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import config, features as F                       # noqa: E402
from ml.dataset import DeckPlay                            # noqa: E402
from ml.evaluation import phase20b as P                     # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "ml", "evaluation", "phase20b.py")


def ts(day: int, hour: int = 12, minute: int = 0) -> str:
    return "202608%02dT%02d%02d00.000Z" % (day, hour, minute)


def battle(day, hour=12, minute=0, cards=None, opp="#OPP", result="win"):
    cards = cards or tuple("c%d" % i for i in range(8))
    return P.Battle(ts(day, hour, minute), "cw_duel_1v1", tuple(cards), result, opp)


def deck(*idx):
    """An 8-card deck built from a card-index list."""
    return tuple("c%d" % i for i in idx)


D1 = deck(0, 1, 2, 3, 4, 5, 6, 7)
D2 = deck(8, 9, 10, 11, 12, 13, 14, 15)      # card-disjoint from D1
D3 = deck(0, 1, 2, 3, 4, 5, 6, 99)           # one card different from D1


# --------------------------------------------------------------------------
# Isolation from production
# --------------------------------------------------------------------------

class TestNoProductionReach(unittest.TestCase):
    def test_module_imports_no_production(self):
        with open(SRC, encoding="utf-8") as _fh:
            tree = ast.parse(_fh.read())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    self.assertNotIn("production", a.name)
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                self.assertNotIn("production", mod)
                self.assertNotIn("production", "".join(
                    a.name for a in node.names))

    def test_no_artifact_is_ever_opened_for_writing(self):
        """The report file is written; an ARTIFACT never is.

        Checked structurally rather than by forbidding write-mode outright,
        because `--out` legitimately writes the report.
        """
        with open(SRC, encoding="utf-8") as _fh:
            tree = ast.parse(_fh.read())
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call)
                    and getattr(node.func, "id", "") == "open"):
                continue
            mode = ""
            if len(node.args) > 1 and isinstance(node.args[1], ast.Constant):
                mode = node.args[1].value or ""
            for kw in node.keywords:
                if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                    mode = kw.value.value or ""
            if not ("w" in mode or "a" in mode or "+" in mode):
                continue
            target = ast.dump(node.args[0]) if node.args else ""
            for forbidden in ("M2_ARTIFACT", "BAND_ARTIFACT", "ARTIFACT_DIR"):
                self.assertNotIn(forbidden, target,
                                 "phase20b opened %s for writing" % forbidden)

    def test_artifacts_unmodified_by_loading(self):
        before = os.path.getmtime(P.M2_ARTIFACT)
        digest_before = open(P.M2_ARTIFACT, "rb").read()
        P.load_m2()
        self.assertEqual(before, os.path.getmtime(P.M2_ARTIFACT))
        self.assertEqual(digest_before, open(P.M2_ARTIFACT, "rb").read())

    def test_no_training_call_in_source(self):
        with open(SRC, encoding="utf-8") as _fh:
            src = _fh.read()
        self.assertNotIn(".fit(", src)
        self.assertNotIn("recalibrate(", src)
        self.assertNotIn("import recalibrate", src)

    def test_m2_artifact_feature_order_is_checked(self):
        model = P.load_m2()
        self.assertEqual(len(model.weights[0]), F.N_FEATURES)


# --------------------------------------------------------------------------
# Duel-run reconstruction carries no card information
# --------------------------------------------------------------------------

class TestRunReconstruction(unittest.TestCase):
    def test_linked_requires_same_opponent(self):
        a = battle(1, 12, 0, D1, opp="#A")
        b = battle(1, 12, 5, D2, opp="#B")
        self.assertFalse(P.linked(a, b))

    def test_linked_requires_gap_within_window(self):
        a = battle(1, 12, 0, D1, opp="#A")
        near = battle(1, 12, 20, D2, opp="#A")
        far = battle(1, 13, 30, D2, opp="#A")
        self.assertTrue(P.linked(a, near))
        self.assertFalse(P.linked(a, far))

    def test_linked_ignores_cards_entirely(self):
        """THE non-circularity guarantee: identical decks must not change the
        answer, or the splitter would be reading the rule it is testing."""
        a = battle(1, 12, 0, D1, opp="#A")
        same = battle(1, 12, 5, D1, opp="#A")
        diff = battle(1, 12, 5, D2, opp="#A")
        self.assertEqual(P.linked(a, same), P.linked(a, diff))
        self.assertTrue(P.linked(a, same))

    def test_missing_opponent_tag_cannot_establish_a_run(self):
        a = battle(1, 12, 0, D1, opp="")
        b = battle(1, 12, 5, D2, opp="")
        self.assertFalse(P.linked(a, b))

    def test_used_before_is_empty_at_a_fresh_duel(self):
        plays = [battle(1, 12, 0, D1, opp="#A"),
                 battle(1, 18, 0, D2, opp="#B")]      # new opponent, hours later
        self.assertEqual(P.used_before(plays, 1), set())

    def test_used_before_accumulates_within_a_run(self):
        plays = [battle(1, 12, 0, D1, opp="#A"),
                 battle(1, 12, 6, D2, opp="#A"),
                 battle(1, 12, 12, D3, opp="#A")]
        used = P.used_before(plays, 2)
        self.assertTrue(set(D1) <= used)
        self.assertTrue(set(D2) <= used)

    def test_used_before_stops_at_a_run_boundary(self):
        plays = [battle(1, 12, 0, D1, opp="#A"),
                 battle(1, 20, 0, D2, opp="#B"),      # boundary
                 battle(1, 20, 6, D3, opp="#B")]
        used = P.used_before(plays, 2)
        self.assertTrue(set(D2) <= used)
        self.assertFalse(set(D1) & used)


class TestLegalityClass(unittest.TestCase):
    def test_no_overlap_is_class_a(self):
        k, forced = P.legality_class(D1, set(D2))
        self.assertEqual(k, P.CLASS_LEGAL)
        self.assertEqual(forced, 0)

    def test_full_overlap_is_class_c(self):
        k, forced = P.legality_class(D1, set(D1))
        self.assertEqual(k, P.CLASS_ILLEGAL)
        self.assertEqual(forced, config.DECK_SIZE)

    def test_partial_overlap_is_class_b(self):
        k, forced = P.legality_class(D1, {"c0", "c1"})
        self.assertEqual(k, P.CLASS_PARTIAL)
        self.assertEqual(forced, 2)


# --------------------------------------------------------------------------
# Step generation: leakage, ordering, isolation
# --------------------------------------------------------------------------

def make_history(n=12, opp_prefix="#S"):
    """A history with a stable shell, so `current_shell` has >=2 members."""
    plays = []
    for i in range(n):
        # A different opponent per battle and a wide gap: every transition is a
        # fresh duel, so legality never interferes with the leakage tests.
        plays.append(P.Battle(ts(1 + i, 12, 0), "cw_duel_1v1", D1, "win",
                              "%s%d" % (opp_prefix, i)))
    return plays


class TestStepGeneration(unittest.TestCase):
    def setUp(self):
        self.model = P.load_m2()
        self.cuts = P.band_cuts("duel")

    def test_truth_is_never_in_the_features(self):
        """Blanking the truth must not move P(change)."""
        plays = make_history(10)
        steps_a, _ = P.steps_for("#T", "duel", plays, 3, self.cuts, self.model)
        mutated = list(plays)
        mutated[-1] = P.Battle(mutated[-1].ts, "cw_duel_1v1", D2, "loss",
                               mutated[-1].opponent_tag)
        steps_b, _ = P.steps_for("#T", "duel", mutated, 3, self.cuts, self.model)
        self.assertEqual(len(steps_a), len(steps_b))
        # The final step's truth changed, so its label may differ - but every
        # earlier step's score must be identical.
        for a, b in zip(steps_a[:-1], steps_b[:-1]):
            self.assertAlmostEqual(a.p_change, b.p_change, places=12)

    def test_equal_timestamps_are_excluded(self):
        plays = [battle(1, 12, 0, D1, opp="#A"),
                 battle(1, 12, 0, D2, opp="#B"),       # identical stamp
                 battle(2, 12, 0, D1, opp="#C")]
        steps, _ = P.steps_for("#T", "duel", plays, 10, self.cuts, self.model)
        for s in steps:
            self.assertNotEqual(s.ts, ts(1, 12, 0))

    def test_outcome_is_the_immediately_next_battle(self):
        plays = make_history(8)
        plays[-1] = P.Battle(plays[-1].ts, "cw_duel_1v1", D2, "win",
                             plays[-1].opponent_tag)
        steps, _ = P.steps_for("#T", "duel", plays, 1, self.cuts, self.model)
        self.assertEqual(len(steps), 1)
        self.assertTrue(steps[0].changed_prev)

    def test_short_history_is_degraded_not_scored(self):
        plays = [battle(1, 12, 0, D1, opp="#A")]
        steps, deg = P.steps_for("#T", "duel", plays, 5, self.cuts, self.model)
        self.assertEqual(steps, [])

    def test_player_and_domain_are_carried_through(self):
        plays = make_history(8)
        steps, _ = P.steps_for("#XYZ", "duel", plays, 3, self.cuts, self.model)
        self.assertTrue(steps)
        for s in steps:
            self.assertEqual(s.tag, "#XYZ")
            self.assertEqual(s.domain, "duel")

    def test_malformed_decks_are_skipped_by_the_parser(self):
        self.assertIsNone(P.deck_cards("not json"))
        self.assertIsNone(P.deck_cards(json.dumps(["a"] * 7)))
        self.assertIsNone(P.deck_cards(json.dumps(["a"] * 16)))
        self.assertIsNone(P.deck_cards(json.dumps(["a"] * 8)))   # duplicates
        self.assertIsNotNone(P.deck_cards(json.dumps(list(D1))))

    def test_native_duel_loadout_is_not_a_deck(self):
        loadout = json.dumps(["c%d" % i for i in range(24)])
        self.assertIsNone(P.deck_cards(loadout))


class TestDomainClassification(unittest.TestCase):
    def test_unknown_mode_is_dropped(self):
        self.assertIsNone(P.classify_domain(""))
        self.assertIsNone(P.classify_domain("SomeEventMode2v2"))

    def test_duel_and_competitive_are_separated(self):
        """The allowlist is `cw_duel_1v1` / `duel_1v1_friendly`, NOT the
        word "duel" - an unrecognised mode containing it fails safe."""
        self.assertEqual(P.classify_domain("cw_duel_1v1"), "duel")
        self.assertEqual(P.classify_domain("duel_1v1_friendly"), "duel")
        self.assertEqual(P.classify_domain("Ladder"), "competitive")
        self.assertIsNone(P.classify_domain("Duel"))


# --------------------------------------------------------------------------
# Statistics
# --------------------------------------------------------------------------

class TestStatistics(unittest.TestCase):
    def test_ece_is_zero_for_a_perfect_forecaster(self):
        probs = [0.0] * 50 + [1.0] * 50
        labels = [0] * 50 + [1] * 50
        self.assertAlmostEqual(P.ece(probs, labels), 0.0, places=9)

    def test_ece_is_one_for_a_confidently_wrong_forecaster(self):
        probs = [1.0] * 40
        labels = [0] * 40
        self.assertAlmostEqual(P.ece(probs, labels), 1.0, places=9)

    def test_brier_matches_the_definition(self):
        self.assertAlmostEqual(P.brier([0.5, 0.5], [1, 0]), 0.25, places=9)

    def test_macro_weights_players_equally(self):
        # One player with 100 steps must not outvote one with 1.
        pp = {"#A": [1.0] * 100, "#B": [0.0]}
        self.assertAlmostEqual(P.macro(pp), 0.5, places=9)

    def test_band_cuts_come_from_the_artifact(self):
        hi, med = P.band_cuts("duel")
        self.assertLess(hi, med)
        self.assertLess(med, 1.0)

    def test_band_assignment_is_monotonic(self):
        cuts = (0.1, 0.5)
        self.assertEqual(P.band_for(0.01, cuts), "high")
        self.assertEqual(P.band_for(0.3, cuts), "medium")
        self.assertEqual(P.band_for(0.9, cuts), "low")


class TestShellReplication(unittest.TestCase):
    def test_shell_contains_the_most_recent_play(self):
        plays = [DeckPlay(ts(1 + i), "cw_duel_1v1", D1) for i in range(6)]
        shell = P.current_shell(plays)
        self.assertTrue(any(m is plays[-1] for m in shell))

    def test_empty_history_gives_no_shell(self):
        self.assertEqual(P.current_shell([]), [])



class TestMixingFraction(unittest.TestCase):
    """The 19D reconciliation is an INFERENCE, so its arithmetic is pinned and
    it must refuse to answer when no mixture explains the observation."""

    def test_midpoint_is_a_half(self):
        self.assertAlmostEqual(P.mixing_fraction(0.5, 0.0, 1.0), 0.5, places=9)

    def test_endpoints(self):
        self.assertAlmostEqual(P.mixing_fraction(0.2, 0.2, 0.9), 0.0, places=9)
        self.assertAlmostEqual(P.mixing_fraction(0.9, 0.2, 0.9), 1.0, places=9)

    def test_outside_the_bracket_returns_none(self):
        """No mixture of 0.2 and 0.9 produces 0.05, so quoting a share would
        be fabricating one."""
        self.assertIsNone(P.mixing_fraction(0.05, 0.2, 0.9))
        self.assertIsNone(P.mixing_fraction(1.5, 0.2, 0.9))

    def test_degenerate_subpopulations_return_none(self):
        self.assertIsNone(P.mixing_fraction(0.5, 0.3, 0.3))

    def test_19d_constants_are_self_consistent(self):
        bands = P.NINETEEN_D_DUEL["bands"]
        total = sum(n for n, _ in bands.values())
        self.assertEqual(total, P.NINETEEN_D_DUEL["reconciled"])
        implied = sum(n * a for n, a in bands.values()) / total
        self.assertAlmostEqual(P.NINETEEN_D_DUEL["stay_rate"], implied, places=2)


class TestGateRunsOnEmpty(unittest.TestCase):
    def test_gate_survives_no_duel_steps(self):
        out = P.gate({"duel": [], "competitive": []})
        self.assertTrue(any("nothing to conclude" in line for line in out))


if __name__ == "__main__":
    unittest.main(verbosity=2)
