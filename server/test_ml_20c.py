"""Contract tests for Phase 20C - legality-aware duel confidence validation.

    python server/test_ml_20c.py        # no database, no network

The thing 20C could most easily get wrong is letting the OUTCOME decide the
legality label, which would make the legal/forced split circular and the whole
conclusion worthless. Several tests below exist only to pin that shut.
"""
from __future__ import annotations

import ast
import collections
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import config                                       # noqa: E402
from ml.evaluation import phase20b as B                     # noqa: E402
from ml.evaluation import phase20c as P                     # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "ml", "evaluation", "phase20c.py")


def ts(day, hour=12, minute=0):
    return "202608%02dT%02d%02d00.000Z" % (day, hour, minute)


def deck(*idx):
    return tuple("c%d" % i for i in idx)


D1 = deck(0, 1, 2, 3, 4, 5, 6, 7)
D2 = deck(8, 9, 10, 11, 12, 13, 14, 15)
D3 = deck(16, 17, 18, 19, 20, 21, 22, 23)


def b(day, hour, minute, cards, opp="#A", result="win"):
    return B.Battle(ts(day, hour, minute), "cw_duel_1v1", cards, result, opp)


# --------------------------------------------------------------------------
# Isolation
# --------------------------------------------------------------------------

class TestIsolation(unittest.TestCase):
    def test_no_production_import(self):
        with open(SRC, encoding="utf-8") as _fh:
            tree = ast.parse(_fh.read())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    self.assertNotIn("production", a.name)
            elif isinstance(node, ast.ImportFrom):
                self.assertNotIn("production", node.module or "")

    def test_no_artifact_opened_for_writing(self):
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
            if "w" in mode or "a" in mode or "+" in mode:
                target = ast.dump(node.args[0]) if node.args else ""
                for bad in ("ARTIFACT", "LOG_PATH"):
                    self.assertNotIn(bad, target)

    def test_no_training_or_recalibration(self):
        with open(SRC, encoding="utf-8") as _fh:
            src = _fh.read()
        self.assertNotIn(".fit(", src)
        self.assertNotIn("import recalibrate", src)

    def test_shadow_log_is_only_ever_read(self):
        with open(SRC, encoding="utf-8") as _fh:
            src = _fh.read()
        self.assertNotIn("remove(", src)
        self.assertNotIn("truncate", src)


# --------------------------------------------------------------------------
# Ex-ante legality - the core contract
# --------------------------------------------------------------------------

class TestExAnteLegality(unittest.TestCase):
    def test_undecided_duel_is_forced(self):
        """1-0 after one game: the duel is live, so the deck is spent."""
        plays = [b(1, 12, 0, D1, "#A", "win")]
        st = P.ex_ante_state(plays, 0, "duel")
        self.assertEqual(st["class"], P.FORCED)
        self.assertTrue(set(D1) <= st["used"])

    def test_decided_duel_is_legal(self):
        """2-0 takes a Bo3, so the next battle opens a fresh duel."""
        plays = [b(1, 12, 0, D1, "#A", "win"), b(1, 12, 6, D2, "#A", "win")]
        st = P.ex_ante_state(plays, 1, "duel")
        self.assertEqual(st["class"], P.LEGAL)
        self.assertEqual(st["used"], set())

    def test_loss_side_also_decides(self):
        plays = [b(1, 12, 0, D1, "#A", "loss"), b(1, 12, 6, D2, "#A", "loss")]
        self.assertEqual(P.ex_ante_state(plays, 1, "duel")["class"], P.LEGAL)

    def test_one_all_is_still_live(self):
        plays = [b(1, 12, 0, D1, "#A", "win"), b(1, 12, 6, D2, "#A", "loss")]
        st = P.ex_ante_state(plays, 1, "duel")
        self.assertEqual(st["class"], P.FORCED)
        self.assertTrue(set(D1) <= st["used"])
        self.assertTrue(set(D2) <= st["used"])

    def test_five_games_closes_regardless(self):
        plays = [b(1, 12, i, deck(*range(i * 8, i * 8 + 8)), "#A",
                   "win" if i % 2 else "loss") for i in range(5)]
        self.assertEqual(P.ex_ante_state(plays, 4, "duel")["class"], P.LEGAL)

    def test_competitive_is_never_forced(self):
        plays = [b(1, 12, 0, D1, "#A", "win")]
        self.assertEqual(P.ex_ante_state(plays, 0, "competitive")["class"],
                         P.LEGAL)

    def test_legality_never_reads_the_next_battle(self):
        """THE contract. Appending any future battle - same deck, different
        deck, different opponent - must not move the label."""
        base = [b(1, 12, 0, D1, "#A", "win"), b(1, 12, 6, D2, "#A", "loss")]
        before = P.ex_ante_state(base, 1, "duel")
        for nxt in (b(1, 12, 12, D1, "#A", "win"),
                    b(1, 12, 12, D3, "#A", "win"),
                    b(2, 12, 0, D1, "#Z", "loss")):
            after = P.ex_ante_state(base + [nxt], 1, "duel")
            self.assertEqual(before["class"], after["class"])
            self.assertEqual(before["used"], after["used"])

    def test_run_reconstruction_uses_no_cards(self):
        """Identical decks must not change the run, or the split would be
        reading the rule it is testing."""
        same = [b(1, 12, 0, D1, "#A", "win"), b(1, 12, 6, D1, "#A", "loss")]
        diff = [b(1, 12, 0, D1, "#A", "win"), b(1, 12, 6, D2, "#A", "loss")]
        self.assertEqual(P.run_ending_at(same, 1), P.run_ending_at(diff, 1))

    def test_run_stops_at_a_new_opponent(self):
        plays = [b(1, 12, 0, D1, "#A", "win"), b(1, 12, 6, D2, "#B", "win")]
        self.assertEqual(P.run_ending_at(plays, 1), [1])

    def test_run_stops_after_the_gap(self):
        plays = [b(1, 12, 0, D1, "#A", "win"), b(1, 14, 0, D2, "#A", "win")]
        self.assertEqual(P.run_ending_at(plays, 1), [1])

    def test_used_cards_accumulate_across_the_live_run(self):
        plays = [b(1, 12, 0, D1, "#A", "win"), b(1, 12, 6, D2, "#A", "loss")]
        st = P.ex_ante_state(plays, 1, "duel")
        self.assertEqual(len(st["used"]), 16)


# --------------------------------------------------------------------------
# Hashes - duplicated from production, so pin them
# --------------------------------------------------------------------------

class TestHashes(unittest.TestCase):
    def test_deck_hash_is_order_independent(self):
        self.assertEqual(P.deck_hash(list(D1)), P.deck_hash(list(reversed(D1))))

    def test_deck_hash_length(self):
        self.assertEqual(len(P.deck_hash(D1)), 16)

    def test_player_hash_is_salted_and_stable(self):
        a = P.player_hash("#ABC")
        self.assertEqual(len(a), 16)
        self.assertEqual(a, P.player_hash("#ABC"))
        self.assertNotEqual(a, P.player_hash("#ABD"))

    def test_hashes_actually_resolve_the_real_log(self):
        """The self-validation: a wrong formula resolves nothing.

        Skipped rather than failed when the log is absent, so the suite still
        runs on a machine with no experiment on it.
        """
        records = P.load_log()
        if not records:
            self.skipTest("no shadow log present")
        cohorts = os.path.join(HERE, "ml", "results", "cohorts")
        if not os.path.isdir(cohorts):
            self.skipTest("no cohort tag lists present")
        tags = set()
        for name in os.listdir(cohorts):
            if name.startswith("tags") and name.endswith(".json"):
                tags |= set(json.load(open(os.path.join(cohorts, name))))
        if not tags:
            self.skipTest("cohort lists empty")
        hashes = {P.player_hash(t) for t in tags}
        anchored = [r for r in records if r.get("anchorTs")]
        hit = sum(1 for r in anchored if r.get("player") in hashes)
        self.assertGreater(hit / max(1, len(anchored)), 0.9,
                           "player_hash does not match the production salt")


# --------------------------------------------------------------------------
# Outcome selection
# --------------------------------------------------------------------------

class TestOutcomeSelection(unittest.TestCase):
    def _plays(self):
        return [b(1, 12, 0, D1, "#A", "win"),
                b(1, 12, 6, D2, "#A", "win"),
                b(2, 12, 0, D1, "#B", "win"),
                b(3, 12, 0, D3, "#C", "win")]

    def test_first_strictly_later_is_taken(self):
        plays = self._plays()
        rec = [{"anchorTs": ts(2, 12, 0), "domain": "duel",
                "player": P.player_hash("#T"), "pChange": 0.1,
                "confidence": "high", "primaryHash": P.deck_hash(D1)}]
        out, stats = P.reconciled_arm(rec, {("#T", "duel"): plays}, ["#T"])
        self.assertEqual(len(out["duel"]), 1)
        obs = out["duel"][0]
        self.assertEqual(obs.ts, ts(3, 12, 0))       # the NEXT battle, not later ones
        self.assertFalse(obs.correct)                # D3 != D1
        self.assertEqual(stats["primary_hash_match"], 1)

    def test_equal_timestamp_is_not_an_outcome(self):
        plays = [b(1, 12, 0, D1, "#A", "win"), b(1, 12, 0, D2, "#A", "win")]
        rec = [{"anchorTs": ts(1, 12, 0), "domain": "duel",
                "player": P.player_hash("#T"), "pChange": 0.1,
                "confidence": "high"}]
        out, stats = P.reconciled_arm(rec, {("#T", "duel"): plays}, ["#T"])
        self.assertEqual(len(out["duel"]), 0)
        self.assertEqual(stats["no_outcome"], 1)

    def test_unresolvable_player_is_counted_not_guessed(self):
        rec = [{"anchorTs": ts(1, 12, 0), "domain": "duel",
                "player": "deadbeefdeadbeef", "pChange": 0.1,
                "confidence": "high"}]
        out, stats = P.reconciled_arm(rec, {}, ["#T"])
        self.assertEqual(len(out["duel"]), 0)
        self.assertEqual(stats["unresolved_player"], 1)

    def test_player_isolation(self):
        """One player's battles can never become another's outcome."""
        rec = [{"anchorTs": ts(2, 12, 0), "domain": "duel",
                "player": P.player_hash("#T"), "pChange": 0.1,
                "confidence": "high"}]
        out, stats = P.reconciled_arm(
            rec, {("#OTHER", "duel"): self._plays()}, ["#T"])
        self.assertEqual(len(out["duel"]), 0)
        self.assertEqual(stats["no_history"], 1)

    def test_domain_isolation(self):
        rec = [{"anchorTs": ts(2, 12, 0), "domain": "duel",
                "player": P.player_hash("#T"), "pChange": 0.1,
                "confidence": "high"}]
        out, _ = P.reconciled_arm(
            rec, {("#T", "competitive"): self._plays()}, ["#T"])
        self.assertEqual(len(out["duel"]), 0)


# --------------------------------------------------------------------------
# Reporting helpers
# --------------------------------------------------------------------------

class TestWilson(unittest.TestCase):
    def test_interval_contains_the_point(self):
        lo, hi = P.wilson(5, 8)
        self.assertLess(lo, 0.625)
        self.assertGreater(hi, 0.625)

    def test_small_n_is_wide(self):
        lo, hi = P.wilson(5, 8)
        self.assertLess(lo, 0.35)
        self.assertGreater(hi, 0.85)

    def test_large_n_is_tight(self):
        lo, hi = P.wilson(920, 1000)
        self.assertGreater(hi - lo, 0.0)
        self.assertLess(hi - lo, 0.06)

    def test_zero_n_is_safe(self):
        self.assertEqual(P.wilson(0, 0), (0.0, 0.0))


class TestSupportFloor(unittest.TestCase):
    def test_min_players_floor_is_meaningful(self):
        self.assertGreaterEqual(P.MIN_PLAYERS, 30)

    def test_reference_matches_the_shipped_claims(self):
        self.assertAlmostEqual(P.REFERENCE["duel"]["high"], 0.921, places=3)
        self.assertAlmostEqual(P.REFERENCE["competitive"]["high"], 0.905, places=3)
        self.assertIsNone(P.REFERENCE["competitive"]["low"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
