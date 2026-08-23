"""Phase 19D contracts. Synthetic fixtures, stdlib unittest, no database.

Calibration is where it is easiest to fool yourself: choose cuts on the same
rows you score, publish a band built on one observation, or quietly retrain the
model while calling it "calibration". Each of those has a test here.
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml.production import recalibrate as R


def rows(n, domain="competitive", start=0.0, step=0.01, correct_below=0.5):
    """Rows whose correctness degrades as pChange rises — a signal to find."""
    out = []
    for i in range(n):
        p = start + i * step
        out.append({"domain": domain, "player": "p%d" % i, "pChange": p,
                    "band": "high", "degraded": False,
                    "correct": p < correct_below, "inAlts": False})
    return out


class Wilson(unittest.TestCase):
    def test_zero_of_one_is_not_zero_percent(self):
        """Competitive `low` was 0/1. Its interval reaches 79%."""
        lo, hi = R.wilson(0, 1)
        self.assertEqual(lo, 0.0)
        self.assertGreater(hi, 0.7)

    def test_a_large_sample_narrows(self):
        _lo1, hi1 = R.wilson(50, 100)
        _lo2, hi2 = R.wilson(500, 1000)
        self.assertLess(hi2 - 0.5, hi1 - 0.5)

    def test_empty_is_zero_not_an_error(self):
        self.assertEqual(R.wilson(0, 0), (0.0, 0.0))


class PlayerAwareSplit(unittest.TestCase):
    def test_a_player_never_spans_both_sides(self):
        rs = [{"player": "p%d" % (i % 20), "pChange": 0.1, "correct": True}
              for i in range(200)]
        fit, evl = R.split_by_player(rs)
        self.assertEqual({r["player"] for r in fit} & {r["player"] for r in evl},
                         set())

    def test_the_split_is_deterministic(self):
        rs = rows(50)
        a, _ = R.split_by_player(rs)
        b, _ = R.split_by_player(rs)
        self.assertEqual([r["player"] for r in a], [r["player"] for r in b])


class MinimumSupport(unittest.TestCase):
    def test_a_sparse_band_publishes_None_not_a_number(self):
        rs = rows(40)
        res = R.evaluate(rs, (0.001, 0.002))     # forces a tiny top band
        high = res["high"]
        self.assertLess(high["players"], R.MIN_BAND_PLAYERS)
        self.assertFalse(high["publishable"])
        self.assertIsNone(high["published"],
                          "an accuracy claim was published without support")

    def test_a_supported_band_does_publish(self):
        rs = rows(200, step=0.005)
        res = R.evaluate(rs, (0.4, 0.8))
        self.assertTrue(res["high"]["publishable"])
        self.assertIsNotNone(res["high"]["published"])

    def test_a_thin_domain_is_not_calibrated_at_all(self):
        res = R.fit_domain(rows(38, domain="duel"))
        self.assertFalse(res["calibrated"])
        self.assertIn("required", res["reason"])

    def test_a_thick_domain_is_calibrated(self):
        res = R.fit_domain(rows(300, step=0.003))
        self.assertTrue(res["calibrated"])
        self.assertIn("monotonic", res["candidates"])


class CutsAreNotFittedOnTheEvaluationSet(unittest.TestCase):
    def test_fit_and_eval_players_are_disjoint(self):
        res = R.fit_domain(rows(300, step=0.003))
        c = res["candidates"]["monotonic"]
        self.assertGreater(c["fitPlayers"], 0)
        self.assertGreater(c["evalPlayers"], 0)
        self.assertEqual(c["fitPlayers"] + c["evalPlayers"], 300)

    def test_cuts_leave_real_support_in_each_band(self):
        rs = rows(300, step=0.003)
        for cuts in (R.quantile_cuts(rs), R.monotonic_cuts(rs)):
            ev = R.evaluate(rs, cuts)
            for band in ("high", "medium", "low"):
                self.assertGreater(ev[band]["n"], 0,
                                   "%s collapsed to an empty band" % band)


class ScoreMetrics(unittest.TestCase):
    def test_brier_uses_P_recent_correct_not_P_change(self):
        """P(change) is the probability the deck CHANGES; Recent is right when
        it does NOT. Getting that backwards inverts the metric."""
        confident_right = [{"player": "a", "pChange": 0.0, "correct": True}]
        confident_wrong = [{"player": "a", "pChange": 0.0, "correct": False}]
        self.assertLess(R.brier(confident_right), R.brier(confident_wrong))
        self.assertAlmostEqual(R.brier(confident_right), 0.0)
        self.assertAlmostEqual(R.brier(confident_wrong), 1.0)

    def test_ece_detects_overconfidence(self):
        over = [{"player": "p%d" % i, "pChange": 0.02, "correct": i < 30}
                for i in range(100)]           # claims 98%, delivers 30%
        self.assertGreater(R.ece(over), 0.5)

    def test_reliability_bins_report_support(self):
        rel = R.reliability(rows(100, step=0.01))
        self.assertTrue(rel)
        for b in rel:
            self.assertIn("n", b)
            self.assertIn("ci", b)


class NoTrainingHappens(unittest.TestCase):
    def test_the_module_never_touches_the_change_model(self):
        """Scan the AST, not the prose. The docstring names M2ChangeModel while
        explaining that it is NOT touched, and a raw text search cannot tell the
        difference between a reference and a promise."""
        import ast
        import inspect
        tree = ast.parse(inspect.getsource(R))
        names, imports, calls = set(), set(), set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                names.add(node.id)
            elif isinstance(node, ast.Attribute):
                names.add(node.attr)
            elif isinstance(node, ast.Import):
                imports.update(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                imports.add(node.module or "")
            if isinstance(node, ast.Call):
                f = node.func
                if isinstance(f, ast.Attribute):
                    calls.add(f.attr)
                elif isinstance(f, ast.Name):
                    calls.add(f.id)
        self.assertNotIn("M2ChangeModel", names)
        # A CALL to .fit() is training. A local variable named `fit` — which is
        # what `fit, evl = split_by_player(...)` produces — is not.
        self.assertNotIn("fit", calls, "a .fit() call would be training")
        self.assertNotIn("weights", names)
        for mod in imports:
            self.assertNotIn("change_detector", mod)
            self.assertNotIn("predictor", mod)

    def test_only_thresholds_are_produced(self):
        res = R.fit_domain(rows(300, step=0.003))
        cuts = res["candidates"]["monotonic"]["cuts"]
        self.assertEqual(len(cuts), 2)
        self.assertTrue(all(isinstance(c, float) for c in cuts))


class Versioning(unittest.TestCase):
    ART = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "ml", "artifacts")

    def test_the_v1_artifact_is_not_overwritten(self):
        self.assertTrue(os.path.exists(
            os.path.join(self.ART, "band-calibration-v1.json")))

    def test_the_candidate_is_a_separate_file(self):
        self.assertTrue(os.path.exists(
            os.path.join(self.ART, "band-calibration-v2-candidate.json")))

    def test_the_candidate_is_not_active(self):
        from ml.production import calibration as C
        self.assertEqual(C.version(), "band-calibration-v1",
                         "a candidate calibration became active")

    def test_the_candidate_declares_itself_inactive(self):
        art = json.load(open(os.path.join(
            self.ART, "band-calibration-v2-candidate.json"), encoding="utf-8"))
        self.assertIn("CANDIDATE", art["status"])
        self.assertIn("why_not_active", art)

    def test_duel_publishes_no_accuracy_claim(self):
        art = json.load(open(os.path.join(
            self.ART, "band-calibration-v2-candidate.json"), encoding="utf-8"))
        self.assertFalse(art["domains"]["duel"]["calibrated"])

    def test_shadow_version_stamp_is_unchanged(self):
        from ml.production import shadow
        self.assertEqual(shadow.VERSIONS["calibration"], "band-calibration-v1",
                         "the running collection was split across two systems")


if __name__ == "__main__":
    unittest.main(verbosity=1)
