"""test_ml_policy.py — Phase 7 candidate generation, calibration, policy.

Synthetic only: no database, no network.

    python server/test_ml_policy.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import edit_model as EM        # noqa: E402
from ml import exit_model as E         # noqa: E402
from ml import policy as PO            # noqa: E402
from ml import predictability as PR    # noqa: E402
from ml import substitution as S       # noqa: E402
from ml.evaluation import phase7_dump as P7   # noqa: E402

CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]


def view(extra="ice-golem", prior=None, pool=("knight", "valkyrie", "tesla")):
    deck = CORE + [extra]
    counts = dict({c: 20 for c in CORE}, **{extra: 12})
    for i, p in enumerate(pool):
        counts[p] = 8 - i
    full = {str(w): {c: min(w, 20) for c in deck} for w in (5, 10, 20)}
    return {
        "tag": "#A", "domain": "duel", "ts": "20260810T120000.000Z",
        "prev_deck": sorted(deck), "cluster_size": 20,
        "cluster_card_counts": counts, "recent_counts": full,
        "last_seen": {c: 0 for c in deck}, "streak": {c: 20 for c in deck},
        "prior_edits": prior or [[["ice-golem"], ["knight"]]] * 5,
        "result": "loss", "opp_wc": "golem",
    }


def make_generator(width=3, allow_two=True):
    v = view()
    return PO.CandidateGenerator(
        E.E4Combined(E.PopulationExitStats()),
        S.S2Transition(S.GlobalStats()),
        width=width, allow_two=allow_two)


class TruthQuarantine(unittest.TestCase):
    def test_model_view_strips_the_truth(self):
        row = dict(view(), next_deck=["a"] * 8)
        mv = P7.model_view(row)
        self.assertNotIn("next_deck", mv)
        self.assertIn("prev_deck", mv)

    def test_input_keys_exclude_next_deck(self):
        self.assertNotIn("next_deck", P7.INPUT_KEYS)

    def test_generator_never_reads_the_truth(self):
        """Generation must be identical with the truth changed."""
        gen = make_generator()
        a = gen.generate(dict(view(), next_deck=["x"] * 8))
        b = gen.generate(dict(view(), next_deck=["y"] * 8))
        self.assertEqual(a, b)


class CandidateGeneration(unittest.TestCase):
    def test_stay_is_always_offered(self):
        self.assertEqual(make_generator().generate(view())[0], EM.STAY)

    def test_candidates_are_legal_eight_card_decks(self):
        v = view()
        for c in make_generator().generate(v):
            self.assertEqual(len(c.apply(v["prev_deck"])), 8)

    def test_exits_come_from_the_deck_entries_do_not(self):
        v = view()
        deck = set(v["prev_deck"])
        for c in make_generator().generate(v):
            for x in c.exits:
                self.assertIn(x, deck)
            for y in c.entries:
                self.assertNotIn(y, deck)

    def test_two_card_candidates_can_be_disabled(self):
        v = view()
        sizes = {c.size for c in make_generator(allow_two=False).generate(v)}
        self.assertEqual(sizes, {0, 1})

    def test_width_controls_the_beam(self):
        v = view()
        narrow = len(make_generator(width=1).generate(v))
        wide = len(make_generator(width=3).generate(v))
        self.assertLess(narrow, wide)

    def test_recall_finds_a_reachable_answer(self):
        v = view()
        truth = sorted((set(v["prev_deck"]) - {"ice-golem"}) | {"knight"})
        info = make_generator().recall(v, truth)
        self.assertTrue(info["found"])
        self.assertIsNotNone(info["rank"])

    def test_recall_reports_an_unreachable_answer(self):
        """A card the player has never fielded cannot be generated."""
        v = view()
        truth = sorted((set(v["prev_deck"]) - {"ice-golem"}) | {"never-played"})
        self.assertFalse(make_generator().recall(v, truth)["found"])

    def test_recall_counts_the_edit_size(self):
        v = view()
        truth = sorted((set(v["prev_deck"]) - {"ice-golem", "cannon"})
                       | {"knight", "valkyrie"})
        self.assertEqual(make_generator().recall(v, truth)["n_diff"], 2)


class CalibrationTests(unittest.TestCase):
    def test_uncalibrated_passes_the_score_through(self):
        self.assertEqual(PO.Calibrator().apply(0.42), 0.42)

    def test_fit_moves_probabilities_toward_the_base_rate(self):
        """Scores all 0.9 but only 20% correct -> calibrated well below 0.9."""
        scores = [0.9] * 100
        labels = [1.0] * 20 + [0.0] * 80
        cal = PO.Calibrator().fit(scores, labels)
        self.assertLess(cal.apply(0.9), 0.6)

    def test_calibration_is_monotonic(self):
        cal = PO.Calibrator().fit([0.1] * 50 + [0.9] * 50,
                                  [0.0] * 50 + [1.0] * 50)
        self.assertLess(cal.apply(0.1), cal.apply(0.5))
        self.assertLess(cal.apply(0.5), cal.apply(0.9))

    def test_ece_is_zero_for_perfect_calibration(self):
        probs = [0.0] * 50 + [1.0] * 50
        labels = [0.0] * 50 + [1.0] * 50
        self.assertAlmostEqual(PO.ece(probs, labels), 0.0, places=6)

    def test_ece_detects_overconfidence(self):
        probs = [0.95] * 100
        labels = [1.0] * 20 + [0.0] * 80
        self.assertGreater(PO.ece(probs, labels), 0.7)

    def test_reliability_bins_are_populated(self):
        rows = PO.reliability([0.05, 0.15, 0.95], [0.0, 0.0, 1.0], bins=10)
        self.assertTrue(rows)
        for r in rows:
            self.assertGreaterEqual(r["n"], 1)

    def test_empty_inputs_are_safe(self):
        self.assertEqual(PO.ece([], []), 0.0)
        self.assertEqual(PO.reliability([], []), [])


class PolicyDecision(unittest.TestCase):
    def _policy(self, always: float, j_wrong=0.57, penalty=1.0, margin=0.0):
        class Fixed(PR.PredictabilityModel):
            def predict(self, x):
                return always
        return PO.SelectivePolicy(make_generator(width=1), Fixed(),
                                  PO.Calibrator(), j_wrong=j_wrong,
                                  two_card_penalty=penalty, margin=margin)

    def test_abstains_when_confidence_is_low(self):
        _c, _p, u_edit, u_stay, should = self._policy(0.01).decide(
            view(), {0: 0.5, 1: 0.3, 2: 0.2})
        self.assertFalse(should)
        self.assertLessEqual(u_edit, u_stay)

    def test_edits_when_confidence_is_high(self):
        cand, _p, u_edit, u_stay, should = self._policy(0.99).decide(
            view(), {0: 0.1, 1: 0.6, 2: 0.3})
        self.assertTrue(should)
        self.assertIsNotNone(cand)
        self.assertGreater(u_edit, u_stay)

    def test_certain_no_change_never_edits(self):
        """p_n[0] = 1 makes staying worth 1.0, which nothing can beat."""
        _c, _p, _ue, _us, should = self._policy(0.99).decide(
            view(), {0: 1.0, 1: 0.0, 2: 0.0})
        self.assertFalse(should)

    def test_margin_makes_the_policy_stricter(self):
        """p=0.70 gives E[J|edit] 0.871 against E[J|stay] 0.809, so it edits;
        a 0.5 margin raises the bar past anything reachable."""
        p_n = {0: 0.3, 1: 0.5, 2: 0.2}
        self.assertTrue(self._policy(0.70).decide(view(), p_n)[4])
        self.assertFalse(self._policy(0.70, margin=0.5).decide(view(), p_n)[4])

    def test_two_card_penalty_suppresses_pair_edits(self):
        gen = PO.CandidateGenerator(E.E4Combined(E.PopulationExitStats()),
                                    S.S2Transition(S.GlobalStats()), width=2)

        class Fixed(PR.PredictabilityModel):
            def predict(self, x):
                return 0.9
        strict = PO.SelectivePolicy(gen, Fixed(), PO.Calibrator(),
                                    two_card_penalty=0.0)
        cand, _p, _ue, _us, should = strict.decide(view(), {0: 0.1, 1: 0.2, 2: 0.7})
        if cand is not None and should:
            self.assertEqual(cand.size, 1, "a zeroed penalty must bar 2-card")

    def test_decision_is_deterministic(self):
        pol = self._policy(0.8)
        p_n = {0: 0.2, 1: 0.5, 2: 0.3}
        self.assertEqual(pol.decide(view(), p_n), pol.decide(view(), p_n))


class ErrorTaxonomy(unittest.TestCase):
    def test_abstention_reasons(self):
        v = view()
        found = {"found": True}
        self.assertEqual(
            PO.classify_abstention(v, {0: 0.95}, 0.5, found),
            "low change probability")
        self.assertEqual(
            PO.classify_abstention(v, {0: 0.5}, 0.5, {"found": False}),
            "candidate not generated")
        thin = dict(v, prior_edits=[])
        self.assertEqual(
            PO.classify_abstention(thin, {0: 0.5}, 0.5, found),
            "insufficient player history")

    def test_error_reasons(self):
        v = view()
        truth = sorted((set(v["prev_deck"]) - {"ice-golem"}) | {"knight"})
        self.assertEqual(
            PO.classify_error(v, EM.Candidate(("ice-golem",), ("valkyrie",)), truth),
            "right exit, wrong entry")
        self.assertEqual(
            PO.classify_error(v, EM.Candidate(("cannon",), ("knight",)), truth),
            "right entry, wrong exit")
        self.assertEqual(
            PO.classify_error(v, EM.Candidate(("cannon",), ("valkyrie",)), truth),
            "wrong exit and entry")

    def test_wrong_edit_count_is_detected(self):
        v = view()
        truth = sorted((set(v["prev_deck"]) - {"ice-golem", "cannon"})
                       | {"knight", "valkyrie"})
        self.assertEqual(
            PO.classify_error(v, EM.Candidate(("ice-golem",), ("knight",)), truth),
            "wrong edit count")


if __name__ == "__main__":
    unittest.main(verbosity=1)
