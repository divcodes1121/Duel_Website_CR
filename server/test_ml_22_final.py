"""Phase 22 - the frozen production contract, as tests.

    python server/test_ml_22_final.py        # no database, no network

This suite is different from `test_ml_production.py`. That one tests that the
implementation works; this one tests that the CONTRACT has not moved. Every
assertion below corresponds to a numbered clause in
`ml/evaluation/phase22-final-spec.md`, and a failure here means either a
regression or a deliberate contract change that the spec must be updated to
match.

`TestPhase23FixesLanded` used to hold characterisation tests pinning known
deviations from the spec. Phase 23 paid that debt, so those tests now assert
the CORRECTED behaviour instead - kept together so the history of what was
wrong stays legible rather than being deleted.
"""
from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import features as F                                 # noqa: E402
from ml.dataset import DeckPlay                              # noqa: E402
from ml.production import calibration, policy, predictor      # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.join(HERE, "ml", "evaluation", "phase22-final-spec.md")

RECENT = ["knight", "archers", "musketeer", "valkyrie", "mini-pekka",
          "skeletons", "ice-spirit", "bats"]
OTHER = ["giant", "wizard", "witch", "prince", "tesla", "cannon",
         "tombstone", "furnace"]


def play(ts, cards, result="win", mode="Ladder"):
    return DeckPlay(battle_time=ts, mode=mode, cards=tuple(cards), result=result)


# --------------------------------------------------------------------------
# Section 2.1 - Recent is structural
# --------------------------------------------------------------------------

class TestRule1RecentCannotBeReplaced(unittest.TestCase):
    def test_a_foreign_primary_is_reset_to_recent(self):
        r = policy.PredictionResult(primary_deck=list(OTHER),
                                    primary_confidence="high",
                                    change_probability=0.1)
        out = policy.enforce_primary(r, RECENT)
        self.assertEqual(out.primary_deck, RECENT)
        self.assertTrue(out.degraded)
        self.assertIn("has been reset", out.reason)

    def test_a_matching_primary_is_left_alone(self):
        r = policy.PredictionResult(primary_deck=list(RECENT),
                                    primary_confidence="high",
                                    change_probability=0.1)
        out = policy.enforce_primary(r, RECENT)
        self.assertEqual(out.primary_deck, RECENT)
        self.assertFalse(out.degraded)

    def test_predict_returns_recent_as_primary(self):
        plays = [play("20260601T00000%d.000Z" % i, RECENT) for i in range(6)]
        res = predictor.predict("#T", "competitive", plays)
        self.assertEqual(sorted(res.primary_deck), sorted(RECENT))

    def test_primary_is_the_latest_play_not_the_most_frequent(self):
        plays = [play("2026060%dT000000.000Z" % i, OTHER) for i in range(1, 6)]
        plays.append(play("20260609T000000.000Z", RECENT))
        res = predictor.predict("#T", "competitive", plays)
        self.assertEqual(sorted(res.primary_deck), sorted(RECENT))


# --------------------------------------------------------------------------
# Sections 2.5 / 5 - degradation always lands on Recent
# --------------------------------------------------------------------------

class TestRules2And3FallbackToRecent(unittest.TestCase):
    def test_safe_fallback_shape(self):
        r = policy.safe_fallback(RECENT, "because")
        self.assertEqual(r.primary_deck, RECENT)
        self.assertEqual(r.alternatives, [])
        self.assertTrue(r.degraded)
        self.assertEqual(r.reason, "because")
        self.assertEqual(r.basis, "recent")

    def test_no_plays_degrades_rather_than_raises(self):
        res = predictor.predict("#T", "competitive", [])
        self.assertTrue(res.degraded)
        self.assertEqual(res.primary_deck, [])

    def test_thin_history_degrades_with_no_established_shell(self):
        res = predictor.predict("#T", "competitive",
                                [play("20260601T000000.000Z", RECENT)])
        self.assertTrue(res.degraded)
        self.assertEqual(sorted(res.primary_deck), sorted(RECENT))

    def test_predict_never_raises_on_malformed_input(self):
        class Bad:
            battle_time = "20260601T000000.000Z"
            cards = None
        try:
            res = predictor.predict("#T", "competitive", [Bad(), Bad()])
        except Exception as exc:                       # pragma: no cover
            self.fail("predict raised %r; it must degrade instead" % exc)
        self.assertTrue(res.degraded)

    def test_every_degraded_result_still_carries_a_deck_or_empty_list(self):
        for reason in ("no plays", "no established shell", "engine error: X"):
            r = policy.safe_fallback(RECENT, reason)
            self.assertIsInstance(r.primary_deck, list)


# --------------------------------------------------------------------------
# Section 2.4 - alternatives are secondary and monotonic
# --------------------------------------------------------------------------

def alt(cards, conf="medium"):
    return {"cards": list(cards), "out": [], "in": [], "confidence": conf,
            "evidence": ["because"]}


class TestRule4AlternativesMonotonic(unittest.TestCase):
    def test_caps_are_monotonic_in_confidence(self):
        caps = policy.ALTERNATIVE_CAPS
        self.assertGreaterEqual(caps["high"], caps["medium"])
        self.assertGreaterEqual(caps["medium"], caps["low"])

    def test_low_confidence_shows_none(self):
        self.assertEqual(policy.ALTERNATIVE_CAPS["low"], 0)

    def test_cap_applied_per_band(self):
        for band, expected in policy.ALTERNATIVE_CAPS.items():
            r = policy.PredictionResult(
                primary_deck=list(RECENT), primary_confidence=band,
                change_probability=0.1,
                alternatives=[alt(OTHER), alt(OTHER), alt(OTHER), alt(OTHER)])
            out = policy.cap_alternatives(r)
            self.assertEqual(len(out.alternatives), expected, band)

    def test_unknown_band_shows_no_alternatives(self):
        r = policy.PredictionResult(primary_deck=list(RECENT),
                                    primary_confidence="banana",
                                    change_probability=0.1,
                                    alternatives=[alt(OTHER)])
        self.assertEqual(policy.cap_alternatives(r).alternatives, [])

    def test_an_alternative_equal_to_the_primary_is_dropped(self):
        r = policy.PredictionResult(primary_deck=list(RECENT),
                                    primary_confidence="high",
                                    change_probability=0.1,
                                    alternatives=[alt(RECENT), alt(OTHER)])
        out = policy.drop_alternatives_matching_primary(r)
        self.assertEqual(len(out.alternatives), 1)
        self.assertEqual(out.alternatives[0]["cards"], OTHER)

    def test_max_alternatives_is_an_upper_bound(self):
        self.assertLessEqual(max(policy.ALTERNATIVE_CAPS.values()),
                             policy.MAX_ALTERNATIVES)


# --------------------------------------------------------------------------
# Section 5 - rules 5 and 6
# --------------------------------------------------------------------------

class TestRule5NoFutureInformation(unittest.TestCase):
    def test_plays_at_or_after_the_cutoff_are_removed(self):
        plays = [play("20260601T000000.000Z", RECENT),
                 play("20260602T000000.000Z", OTHER),
                 play("20260603T000000.000Z", OTHER)]
        kept = policy.assert_no_future(plays, "20260602T000000.000Z")
        self.assertEqual(len(kept), 1)

    def test_equal_timestamp_is_not_past(self):
        plays = [play("20260602T000000.000Z", RECENT)]
        self.assertEqual(policy.assert_no_future(plays, "20260602T000000.000Z"), [])

    def test_no_cutoff_keeps_everything(self):
        plays = [play("20260601T000000.000Z", RECENT)]
        self.assertEqual(len(policy.assert_no_future(plays, "")), 1)


class TestRule6ProductionNeverTrains(unittest.TestCase):
    def test_fit_is_replaced_with_a_raise(self):
        class Model:
            def fit(self, *_a, **_k):
                return "trained"
        m = Model()
        policy.forbid_training(m)
        with self.assertRaises(RuntimeError):
            m.fit([], [])

    def test_locking_is_idempotent(self):
        class Model:
            def fit(self, *_a, **_k):
                return "trained"
        m = Model()
        policy.forbid_training(m)
        policy.forbid_training(m)
        with self.assertRaises(RuntimeError):
            m.fit([], [])

    def test_the_loaded_artifact_is_locked(self):
        model = predictor._load_change_model()
        if model is None:
            self.skipTest("artifact not present")
        with self.assertRaises(RuntimeError):
            model.fit([], [])


# --------------------------------------------------------------------------
# Section 2.2 - the frozen artifact
# --------------------------------------------------------------------------

class TestFrozenArtifact(unittest.TestCase):
    def test_feature_order_is_part_of_the_contract(self):
        with open(predictor.ARTIFACT, encoding="utf-8") as fh:
            art = json.load(fh)
        self.assertEqual(list(art["feature_names"]), list(F.FEATURE_NAMES))

    def test_class_weighting_stays_off(self):
        with open(predictor.ARTIFACT, encoding="utf-8") as fh:
            art = json.load(fh)
        self.assertFalse(art.get("class_weight"))

    def test_feature_count_is_21(self):
        self.assertEqual(F.N_FEATURES, 21)
        self.assertEqual(len(F.FEATURE_NAMES), 21)

    def test_calibration_version_is_v1(self):
        self.assertEqual(calibration.version(), "band-calibration-v1")

    def test_v2_candidate_is_not_active(self):
        """It exists on disk and must NOT be promoted on current evidence."""
        d = os.path.dirname(predictor.ARTIFACT)
        self.assertTrue(os.path.exists(os.path.join(
            d, "band-calibration-v2-candidate.json")))
        self.assertNotIn("v2", calibration.version())

    def test_band_thresholds_are_ordered(self):
        for domain in ("competitive", "duel"):
            hi, med = calibration.thresholds(domain)
            self.assertLess(hi, med)


# --------------------------------------------------------------------------
# Section 3 - the API contract
# --------------------------------------------------------------------------

class TestApiContract(unittest.TestCase):
    def _payload(self):
        r = policy.PredictionResult(
            primary_deck=list(RECENT), primary_confidence="high",
            change_probability=0.123, alternatives=[alt(OTHER)],
            note="note", basis="recent")
        return r.as_dict()

    def test_primary_shape(self):
        p = self._payload()["primary"]
        self.assertEqual(sorted(p), ["basis", "cards", "confidence"])
        self.assertEqual(p["basis"], "recent")

    def test_no_model_internals_are_exposed(self):
        blob = json.dumps(self._payload()).lower()
        for forbidden in ("weight", "logit", "bias", "scaler", "feature",
                          "cluster", "m2-change", "logistic", "artifact"):
            self.assertNotIn(forbidden, blob, forbidden)

    def test_no_band_accuracy_percentage_is_exposed(self):
        blob = json.dumps(self._payload())
        for domain in policy.BAND_ACCURACY.values():
            for value in domain.values():
                if value is None:
                    continue
                self.assertNotIn(str(value), blob)

    def test_alternative_shape(self):
        a = self._payload()["alternatives"][0]
        self.assertEqual(sorted(a),
                         ["cards", "confidence", "evidence", "in", "out"])
        self.assertIsInstance(a["evidence"], list)

    def test_degraded_is_always_present(self):
        self.assertIn("degraded", self._payload())


# --------------------------------------------------------------------------
# Section 2.3 - confidence is qualitative
# --------------------------------------------------------------------------

class TestConfidenceIsQualitative(unittest.TestCase):
    def test_bands_are_the_three_frozen_words(self):
        self.assertEqual(set(policy.ALTERNATIVE_CAPS), {"high", "medium", "low"})

    def test_band_accuracy_is_internal_only(self):
        """The spec forbids displaying these. They are disproved:
        competitive high claims 90.5% and measured 69.1%."""
        self.assertEqual(policy.BAND_ACCURACY["competitive"]["high"], 0.905)
        self.assertIsNone(policy.BAND_ACCURACY["competitive"]["low"])

    def test_expected_accuracy_returns_none_for_unmeasured_bands(self):
        self.assertIsNone(calibration.expected_accuracy("competitive", "low"))

    def test_band_assignment_is_monotonic_in_p_change(self):
        for domain in ("competitive", "duel"):
            hi, med = calibration.thresholds(domain)
            self.assertEqual(calibration.band(domain, hi / 2), "high")
            self.assertEqual(calibration.band(domain, (hi + med) / 2), "medium")
            self.assertEqual(calibration.band(domain, min(1.0, med + 0.1)), "low")


# --------------------------------------------------------------------------
# The specification document itself
# --------------------------------------------------------------------------

class TestSpecDocument(unittest.TestCase):
    def _spec(self):
        with open(SPEC, encoding="utf-8") as fh:
            return fh.read()

    def test_spec_exists_and_declares_the_freeze(self):
        self.assertIn("FINAL MODEL DIRECTION: FROZEN", self._spec())

    def test_every_version_axis_is_named(self):
        s = self._spec()
        for v in ("m2-change-v1", "phase2-21", "phase17a-calibrated",
                  "band-calibration-v1", "c1-wide-playerpool",
                  "opponent-read-v1"):
            self.assertIn(v, s, v)

    def test_all_closed_branches_are_recorded(self):
        s = self._spec().lower()
        for branch in ("exact-deck retrieval", "novel-deck generation",
                       "matchup-response", "spell-conditioned"):
            self.assertIn(branch.lower(), s, branch)

    def test_the_version_stamp_matches_what_the_log_records(self):
        """Attribution is only meaningful if the spec and the log agree."""
        s = self._spec()
        stamp = {"calibration": "band-calibration-v1",
                 "candidates": "c1-wide-playerpool",
                 "features": "phase2-21",
                 "model": "m2-change-v1",
                 "policy": "phase17a-calibrated"}
        for value in stamp.values():
            self.assertIn(value, s)


# --------------------------------------------------------------------------
# KNOWN DEVIATIONS - characterisation tests, see the module docstring
# --------------------------------------------------------------------------

class TestPhase23FixesLanded(unittest.TestCase):
    """These replaced the Phase 22 characterisation tests.

    Each one pinned a KNOWN DEVIATION from the frozen spec; Phase 23 paid the
    debt, so each now asserts the corrected behaviour instead. Kept as a group
    so the history of what was wrong stays legible.
    """

    def test_FIX1_change_probability_is_not_in_the_payload(self):
        """Spec 3.1. A logistic score must not cross the UI boundary.

        Measured ECE 0.2806 competitive / 0.6097 practice - internal AND wrong.
        """
        r = policy.PredictionResult(primary_deck=list(RECENT),
                                    primary_confidence="high",
                                    change_probability=0.123,
                                    domain="competitive")
        d = r.as_dict()
        self.assertNotIn("changeProbability", d)
        self.assertNotIn("0.123", json.dumps(d))
        # still available internally, which is where the band comes from
        self.assertEqual(r.change_probability, 0.123)

    def test_FIX2_the_domain_is_called_practice(self):
        """Spec 7.2. Phase 20D established the population contains no duels."""
        self.assertIn("practice", policy.BAND_ACCURACY)
        self.assertNotIn("duel", policy.BAND_ACCURACY)

    def test_FIX2_the_frozen_artifact_key_is_untouched(self):
        """The rename must not rewrite history. The artifact still says `duel`
        and one mapping absorbs the difference, so stored observations stay
        attributable to the artifact that produced them."""
        self.assertEqual(calibration.ARTIFACT_DOMAIN["practice"], "duel")
        with open(calibration.ARTIFACT, encoding="utf-8") as fh:
            art = json.load(fh)
        self.assertIn("duel", art["domains"])
        self.assertEqual(calibration.thresholds("practice"),
                         (0.0061, 0.0339))

    def test_FIX3_practice_shows_no_band_and_no_alternatives(self):
        """Spec 2.3. Practice ordering fails: macro high 65.4% < medium 69.7%.

        The alternatives go with the band, because the 2/1/0 cap is justified
        by the bands meaning something.
        """
        r = policy.PredictionResult(
            primary_deck=list(RECENT), primary_confidence="high",
            change_probability=0.01, alternatives=[alt(OTHER)],
            domain="practice")
        d = r.as_dict()
        self.assertNotIn("confidence", d["primary"])
        self.assertEqual(d["alternatives"], [])
        self.assertFalse(d["bandShown"])

    def test_FIX3_competitive_still_shows_its_band(self):
        r = policy.PredictionResult(
            primary_deck=list(RECENT), primary_confidence="high",
            change_probability=0.01, alternatives=[alt(OTHER)],
            domain="competitive")
        d = r.as_dict()
        self.assertEqual(d["primary"]["confidence"], "high")
        self.assertEqual(len(d["alternatives"]), 1)
        self.assertTrue(d["bandShown"])

    def test_FIX3_band_support_is_declared_per_domain(self):
        self.assertTrue(policy.BAND_SUPPORTED["competitive"])
        self.assertFalse(policy.BAND_SUPPORTED["practice"])

    def test_FIX5_stale_accuracy_claims_are_gone_from_the_cap_rationale(self):
        """Spec 7.5. The RULE is right; the numbers printed beside it were not."""
        import inspect
        src = inspect.getsource(policy)
        cap_block = src[src.index("#: RULE 4"):src.index("ALTERNATIVE_CAPS = ")]
        # The figures are still QUOTED, and that is correct - a comment that
        # says "this number was disproved" is more useful than one that
        # silently drops it. What must not survive is presenting them as
        # current fact, so the marker is what the assertion looks for.
        self.assertIn("disproved", cap_block)
        self.assertIn("ordering alone", cap_block)
        self.assertNotIn("The bands already mean something measured", cap_block)

    def test_the_primary_never_loses_its_deck_when_the_band_is_hidden(self):
        """Suppressing the band must not suppress the answer."""
        r = policy.PredictionResult(primary_deck=list(RECENT),
                                    primary_confidence="high",
                                    change_probability=0.01,
                                    domain="practice")
        self.assertEqual(r.as_dict()["primary"]["cards"], RECENT)
        self.assertEqual(r.as_dict()["primary"]["basis"], "recent")


class TestDuelSupportIsAbsent(unittest.TestCase):
    """Spec 5, rule 7. The duel card-reuse rule is absolute (21,432 pairs,
    zero overlap) but production drops every native duel row, so the rule has
    nothing to apply to. This pins that fact so a future duel feature cannot
    quietly assume coverage already exists."""

    def test_a_16_card_loadout_is_not_a_deck(self):
        from ml import config
        from ml.production import source
        rows = [("20260601T000000.000Z", "CW_Duel_1v1",
                 json.dumps(["c%d" % i for i in range(16)]), "win", "")]
        self.assertEqual(source._rows_to_plays(rows, "duel"), [])
        self.assertEqual(config.DECK_SIZE, 8)

    def test_a_24_card_loadout_is_not_a_deck(self):
        from ml.production import source
        rows = [("20260601T000000.000Z", "CW_Duel_1v1",
                 json.dumps(["c%d" % i for i in range(24)]), "win", "")]
        self.assertEqual(source._rows_to_plays(rows, "duel"), [])



# --------------------------------------------------------------------------
# PHASE 23 - the endpoint's three modes
# --------------------------------------------------------------------------

class TestOieModes(unittest.TestCase):
    """`off` / `shadow` / `on`, at the boundary the browser actually sees.

    `coach._OIE_MODE` is read once at import, so it is patched rather than
    re-imported; re-importing `coach` would rebuild its caches and the module
    is shared with every other suite.
    """

    def setUp(self):
        import coach
        self.coach = coach
        self._saved = coach._OIE_MODE

    def tearDown(self):
        self.coach._OIE_MODE = self._saved

    def test_off_returns_disabled_and_never_calls_the_engine(self):
        self.coach._OIE_MODE = "off"
        called = []
        payload = self.coach.opponent_read("#TAG")
        self.assertEqual(payload, {"enabled": False, "read": None})
        self.assertEqual(called, [])

    def test_shadow_is_also_disabled_to_the_browser(self):
        """Shadow records; it must show the user nothing."""
        self.coach._OIE_MODE = "shadow"
        payload = self.coach.opponent_read("#TAG")
        self.assertFalse(payload["enabled"])
        self.assertIsNone(payload["read"])

    def test_an_engine_exception_under_on_degrades_to_no_read(self):
        self.coach._OIE_MODE = "on"
        original = self.coach.observe
        try:
            def boom(_tag):
                raise RuntimeError("engine down")
            self.coach.observe = boom
            payload = self.coach.opponent_read("#TAG")
            self.assertTrue(payload["enabled"])
            self.assertIsNone(payload["read"])
        finally:
            self.coach.observe = original

    def test_the_surfaced_domain_is_competitive(self):
        """PHASE 23B product decision. Practice is observed but never shown:
        without a validated band it carries no confidence and no alternatives,
        so the panel would hold the recent deck and nothing else."""
        self.assertEqual(self.coach.SURFACED_DOMAIN, "competitive")
        self.assertTrue(policy.BAND_SUPPORTED[self.coach.SURFACED_DOMAIN])

    def test_both_domains_are_still_observed(self):
        """Surfacing one must not stop the other being logged - that mistake
        once starved the competitive half of the shadow experiment."""
        import inspect
        src = inspect.getsource(self.coach.observe)
        self.assertIn('"practice"', src)
        self.assertIn('"competitive"', src)

    def test_default_mode_is_off(self):
        import inspect
        src = inspect.getsource(self.coach)
        self.assertIn('os.getenv("CLASH_OIE", "off")', src)


class TestSerializedResponseHasNoInternals(unittest.TestCase):
    """FIX 1, at the exact boundary: the JSON the browser receives."""

    FORBIDDEN = ("changeprobability", "logit", "logistic", "weight", "bias",
                 "scaler", "feature", "cluster", "m2-change", "artifact",
                 "training", "shell", "pchange")

    def _endpoint_json(self, domain):
        r = policy.PredictionResult(
            primary_deck=list(RECENT), primary_confidence="high",
            change_probability=0.87, alternatives=[alt(OTHER)],
            note="steady", domain=domain)
        return json.dumps({"enabled": True, "read": r.as_dict()}).lower()

    def test_no_internal_token_appears_for_either_domain(self):
        for domain in ("competitive", "practice"):
            blob = self._endpoint_json(domain)
            for token in self.FORBIDDEN:
                self.assertNotIn(token, blob, "%s leaked in %s" % (token, domain))

    def test_the_score_value_itself_does_not_appear(self):
        for domain in ("competitive", "practice"):
            self.assertNotIn("0.87", self._endpoint_json(domain))

    def test_disabled_payload_carries_nothing(self):
        blob = json.dumps({"enabled": False, "read": None}).lower()
        for token in self.FORBIDDEN:
            self.assertNotIn(token, blob)


if __name__ == "__main__":
    unittest.main(verbosity=2)
