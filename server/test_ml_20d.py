"""Contract tests for Phase 20D - the practice/native-duel domain correction.

    python server/test_ml_20d.py        # no database, no network

The defect 20D exists to correct was invisible for twenty phases because no
test ever asserted what the `duel` domain CONTAINED. These tests assert it.
"""
from __future__ import annotations

import ast
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from duel_combos import NATIVE_DUEL_MODES                    # noqa: E402
from meta import META_MODES                                  # noqa: E402
from ml import config                                        # noqa: E402
from ml.evaluation import phase20b as B                      # noqa: E402
from ml.evaluation import phase20d as P                      # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "ml", "evaluation", "phase20d.py")


def ts(day, hour=12, minute=0):
    return "202608%02dT%02d%02d00.000Z" % (day, hour, minute)


def deck(n=8, off=0):
    return ["c%d" % (i + off) for i in range(n)]


# --------------------------------------------------------------------------
# The correction itself
# --------------------------------------------------------------------------

class TestDomainDefinition(unittest.TestCase):
    def test_friendly_is_practice(self):
        self.assertEqual(P.classify_domain("Friendly"), "practice")

    def test_showdown_friendly_is_practice(self):
        self.assertEqual(P.classify_domain("Showdown_Friendly"), "practice")

    def test_native_duel_modes_are_excluded(self):
        self.assertIsNone(P.classify_domain("CW_Duel_1v1"))
        self.assertIsNone(P.classify_domain("Duel_1v1_Friendly"))

    def test_native_exclusion_is_case_insensitive(self):
        for m in ("cw_duel_1v1", "CW_DUEL_1V1", "Cw_Duel_1v1"):
            self.assertIsNone(P.classify_domain(m))

    def test_minor_friendly_variants_are_not_practice(self):
        """They were inside the old `duel` domain. Practice is defined by an
        explicit allowlist, so they fall out and are audited instead."""
        for m in ("MirrorDeck_Friendly", "ClassicDecks_Friendly",
                  "Heist_Friendly", "Rage_Friendly", "Overtime_Friendly"):
            self.assertIsNone(P.classify_domain(m))
            self.assertEqual(P.audit_mode(m), "other_friendly")

    def test_competitive_is_untouched(self):
        for m in sorted(META_MODES):
            self.assertEqual(P.classify_domain(m), "competitive")

    def test_practice_and_native_sets_are_disjoint(self):
        self.assertFalse(P.PRACTICE_MODES & set(NATIVE_DUEL_MODES))

    def test_practice_does_not_intersect_competitive(self):
        self.assertFalse(P.PRACTICE_MODES & set(META_MODES))

    def test_audit_buckets_every_mode_exactly_once(self):
        seen = {}
        for m in ("Friendly", "Showdown_Friendly", "CW_Duel_1v1",
                  "Duel_1v1_Friendly", "Ladder", "MirrorDeck_Friendly",
                  "SomethingElse", ""):
            seen[m] = P.audit_mode(m)
        self.assertEqual(seen["Friendly"], "practice")
        self.assertEqual(seen["CW_Duel_1v1"], "native_duel")
        self.assertEqual(seen["Ladder"], "competitive")
        self.assertEqual(seen["MirrorDeck_Friendly"], "other_friendly")
        self.assertEqual(seen["SomethingElse"], "other")
        self.assertEqual(seen[""], "unknown")


class TestLoadoutsNeverBecomeDecks(unittest.TestCase):
    def test_16_card_loadout_rejected(self):
        self.assertIsNone(B.deck_cards(json.dumps(deck(16))))

    def test_24_card_loadout_rejected(self):
        self.assertIsNone(B.deck_cards(json.dumps(deck(24))))

    def test_is_native_loadout_recognises_both_sizes(self):
        self.assertTrue(P.is_native_loadout(deck(16)))
        self.assertTrue(P.is_native_loadout(deck(24)))
        self.assertFalse(P.is_native_loadout(deck(8)))

    def test_a_native_row_cannot_reach_practice_even_at_8_cards(self):
        """DEFENCE IN DEPTH. Should a native row ever carry 8 cards, the mode
        check rejects it before the card check is consulted - so the two guards
        are independent rather than one relying on the other."""
        self.assertIsNone(P.classify_domain("CW_Duel_1v1"))
        self.assertIsNotNone(B.deck_cards(json.dumps(deck(8))))


class TestNoContamination(unittest.TestCase):
    def _rows(self):
        return [
            ("#A", "Friendly", ts(1), json.dumps(deck(8)), "win", "#X"),
            ("#A", "CW_Duel_1v1", ts(2), json.dumps(deck(16)), "win", "#Y"),
            ("#A", "Duel_1v1_Friendly", ts(3), json.dumps(deck(24)), "loss", "#Z"),
            ("#A", "Ladder", ts(4), json.dumps(deck(8, 50)), "win", "#W"),
            ("#A", "MirrorDeck_Friendly", ts(5), json.dumps(deck(8, 90)), "win", "#V"),
        ]

    def test_load_routes_each_row_correctly(self):
        class FakeCon:
            def __init__(self, rows):
                self.rows = rows

            def execute(self, _q, _p):
                return list(self.rows)

        out, audit, sizes = P.load(FakeCon(self._rows()), ["#A"],
                                   history_days=0, max_rows=1000)
        self.assertEqual([b.mode for b in out[("#A", "practice")]], ["Friendly"])
        self.assertEqual(len(out[("#A", "competitive")]), 1)
        self.assertEqual(audit["native_duel"], 2)
        self.assertEqual(audit["other_friendly"], 1)
        for key in out:
            self.assertIn(key[1], ("practice", "competitive"))

    def test_no_native_row_lands_in_any_domain(self):
        class FakeCon:
            def __init__(self, rows):
                self.rows = rows

            def execute(self, _q, _p):
                return list(self.rows)

        out, _a, _s = P.load(FakeCon(self._rows()), ["#A"],
                             history_days=0, max_rows=1000)
        for (_tag, _dom), plays in out.items():
            for b in plays:
                self.assertNotIn(b.mode.lower(), NATIVE_DUEL_MODES)
                self.assertEqual(len(set(b.cards)), config.DECK_SIZE)

    def test_audit_counts_native_rows_before_the_card_filter(self):
        """The census must not itself be a victim of the 8-card guard, or it
        would report zero native rows and confirm the original mistake."""
        class FakeCon:
            def execute(self, _q, _p):
                return [("#A", "CW_Duel_1v1", ts(1), json.dumps(deck(16)),
                         "win", "#Y")]

        _out, audit, sizes = P.load(FakeCon(), ["#A"], history_days=0)
        self.assertEqual(audit["native_duel"], 1)
        self.assertEqual(sizes["native_duel"][16], 1)


# --------------------------------------------------------------------------
# Evaluation contracts carried over
# --------------------------------------------------------------------------

class TestReconciledArm(unittest.TestCase):
    def _plays(self):
        D1 = tuple(deck(8))
        D2 = tuple(deck(8, 40))
        return [B.Battle(ts(1), "Friendly", D1, "win", "#A"),
                B.Battle(ts(2), "Friendly", D1, "win", "#B"),
                B.Battle(ts(3), "Friendly", D2, "win", "#C")]

    def test_duel_records_are_relabelled_to_practice(self):
        rec = [{"anchorTs": ts(2), "domain": "duel",
                "player": P.C.player_hash("#T"), "pChange": 0.02,
                "confidence": "high"}]
        out, stats = P.reconciled_arm(rec, {("#T", "practice"): self._plays()},
                                      ["#T"])
        self.assertEqual(len(out["practice"]), 1)
        self.assertFalse(out["practice"][0].correct)     # D2 != D1

    def test_first_strictly_later_only(self):
        rec = [{"anchorTs": ts(1), "domain": "duel",
                "player": P.C.player_hash("#T"), "pChange": 0.02,
                "confidence": "high"}]
        out, _ = P.reconciled_arm(rec, {("#T", "practice"): self._plays()},
                                  ["#T"])
        self.assertEqual(out["practice"][0].ts, ts(2))
        self.assertTrue(out["practice"][0].correct)      # D1 == D1

    def test_player_isolation(self):
        rec = [{"anchorTs": ts(2), "domain": "duel",
                "player": P.C.player_hash("#T"), "pChange": 0.02,
                "confidence": "high"}]
        out, stats = P.reconciled_arm(
            rec, {("#OTHER", "practice"): self._plays()}, ["#T"])
        self.assertEqual(len(out["practice"]), 0)
        self.assertEqual(stats["no_history"], 1)

    def test_anchor_outside_practice_is_counted_not_guessed(self):
        """A prediction anchored on a minor friendly variant has no practice
        anchor. It must be reported, not silently attached to a nearby row."""
        rec = [{"anchorTs": ts(9), "domain": "duel",
                "player": P.C.player_hash("#T"), "pChange": 0.02,
                "confidence": "high"}]
        out, stats = P.reconciled_arm(rec, {("#T", "practice"): self._plays()},
                                      ["#T"])
        self.assertEqual(len(out["practice"]), 0)
        self.assertEqual(stats["anchor_not_in_practice"], 1)

    def test_competitive_records_stay_competitive(self):
        rec = [{"anchorTs": ts(1), "domain": "competitive",
                "player": P.C.player_hash("#T"), "pChange": 0.02,
                "confidence": "high"}]
        plays = [B.Battle(ts(1), "Ladder", tuple(deck(8)), "win", "#A"),
                 B.Battle(ts(2), "Ladder", tuple(deck(8)), "win", "#B")]
        out, _ = P.reconciled_arm(rec, {("#T", "competitive"): plays}, ["#T"])
        self.assertEqual(len(out["competitive"]), 1)
        self.assertEqual(len(out["practice"]), 0)


class TestNoFutureLeakage(unittest.TestCase):
    def test_population_arm_scores_only_prior_history(self):
        model = B.load_m2()
        cuts = {"practice": B.band_cuts("duel"),
                "competitive": B.band_cuts("competitive")}
        D1 = tuple(deck(8))
        plays = [B.Battle(ts(1 + i), "Friendly", D1, "win", "#O%d" % i)
                 for i in range(10)]
        a, _ = P.population_arm({("#T", "practice"): plays}, 3, cuts, model, 5)
        mutated = list(plays)
        mutated[-1] = B.Battle(mutated[-1].ts, "Friendly", tuple(deck(8, 60)),
                               "loss", mutated[-1].opponent_tag)
        b, _ = P.population_arm({("#T", "practice"): mutated}, 3, cuts, model, 5)
        for x, y in zip(a["practice"][:-1], b["practice"][:-1]):
            self.assertAlmostEqual(x.p_change, y.p_change, places=12)


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

    def test_no_training_or_recalibration(self):
        with open(SRC, encoding="utf-8") as fh:
            src = fh.read()
        self.assertNotIn(".fit(", src)
        self.assertNotIn("import recalibrate", src)

    def test_artifacts_untouched_by_loading(self):
        before = open(B.M2_ARTIFACT, "rb").read()
        band_before = open(B.BAND_ARTIFACT, "rb").read()
        B.load_m2()
        B.band_cuts("duel")
        self.assertEqual(before, open(B.M2_ARTIFACT, "rb").read())
        self.assertEqual(band_before, open(B.BAND_ARTIFACT, "rb").read())

    def test_no_artifact_or_log_opened_for_writing(self):
        with open(SRC, encoding="utf-8") as fh:
            tree = ast.parse(fh.read())
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

    def test_the_old_duel_label_is_not_a_scored_domain(self):
        self.assertNotIn("duel", P.DOMAINS)
        self.assertIn("practice", P.DOMAINS)


if __name__ == "__main__":
    unittest.main(verbosity=2)
