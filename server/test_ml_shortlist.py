"""test_ml_shortlist.py — Phase 14 product payload.

The structural guarantee is the point: Recent can never be displaced.

    python server/test_ml_shortlist.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import shortlist as SL          # noqa: E402
from ml.edit_model import Candidate     # noqa: E402

CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]
DECK = sorted(CORE + ["knight"])
CANDS = [Candidate(("knight",), (c,)) for c in ("ice-golem", "valkyrie", "tesla", "wizard")]


def build(p_change=0.6, support=5, k=3):
    return SL.build(DECK, p_change, CANDS, lambda c: support, k)


class RecentIsNeverDisplaced(unittest.TestCase):
    """THE GUARANTEE. Phases 4-7 all lost by overruling Recent."""

    def test_primary_is_always_the_current_deck(self):
        for p in (0.0, 0.3, 0.9, 1.0):
            self.assertEqual(build(p_change=p).primary, DECK)

    def test_alternatives_never_replace_the_primary(self):
        sl = build(p_change=0.99)
        self.assertEqual(sl.primary, DECK)
        for a in sl.alternatives:
            self.assertNotEqual(a.cards, DECK)

    def test_primary_correct_equals_the_recent_baseline(self):
        sl = build()
        self.assertTrue(SL.coverage(sl, DECK)["primary_correct"])
        other = sorted((set(DECK) - {"knight"}) | {"ice-golem"})
        self.assertFalse(SL.coverage(sl, other)["primary_correct"])


class Alternatives(unittest.TestCase):
    def test_respects_the_cap(self):
        self.assertEqual(len(build(k=2).alternatives), 2)

    def test_each_alternative_is_a_legal_eight_card_deck(self):
        for a in build().alternatives:
            self.assertEqual(len(a.cards), 8)
            self.assertEqual(len(set(a.cards)), 8)

    def test_stay_is_never_offered_as_an_alternative(self):
        from ml.edit_model import STAY
        sl = SL.build(DECK, 0.6, [STAY] + CANDS, lambda c: 1, 3)
        for a in sl.alternatives:
            self.assertTrue(a.exits, "STAY is the primary, not an alternative")

    def test_ranks_are_sequential(self):
        self.assertEqual([a.rank for a in build().alternatives], [1, 2, 3])

    def test_evidence_mentions_prior_swaps_when_they_exist(self):
        with_hist = build(support=4).alternatives[0]
        self.assertTrue(any("4 times" in e for e in with_hist.evidence))
        without = build(support=0).alternatives[0]
        self.assertFalse(any("before" in e for e in without.evidence))


class ConfidenceBands(unittest.TestCase):
    def test_primary_confidence_falls_as_change_becomes_likely(self):
        self.assertEqual(SL._primary_band(0.05), SL.HIGH)
        self.assertEqual(SL._primary_band(0.30), SL.MEDIUM)
        self.assertEqual(SL._primary_band(0.80), SL.LOW)

    def test_no_alternative_is_high_without_change_evidence(self):
        for a in build(p_change=0.2).alternatives:
            self.assertNotEqual(a.confidence, SL.HIGH)

    def test_high_needs_rank_one_change_and_support(self):
        self.assertEqual(build(p_change=0.7, support=8).alternatives[0].confidence,
                         SL.HIGH)
        self.assertNotEqual(build(p_change=0.7, support=1).alternatives[0].confidence,
                            SL.HIGH)

    def test_quiet_state_says_so(self):
        self.assertIn("No strong change signal", build(p_change=0.05).note)

    def test_active_state_does_not_overclaim(self):
        note = build(p_change=0.8).note
        self.assertIn("not forecasts", note)
        self.assertNotIn("will", note.lower().split("plausible")[0])


class Coverage(unittest.TestCase):
    def test_detects_a_hit_in_the_alternatives(self):
        target = sorted((set(DECK) - {"knight"}) | {"valkyrie"})
        cov = SL.coverage(build(), target)
        self.assertTrue(cov["in_alternatives"])
        self.assertEqual(cov["alternative_rank"], 2)
        self.assertTrue(cov["covered"])

    def test_reports_a_miss(self):
        target = sorted((set(DECK) - {"knight"}) | {"never-suggested"})
        cov = SL.coverage(build(), target)
        self.assertFalse(cov["covered"])
        self.assertIsNone(cov["alternative_rank"])

    def test_payload_is_json_shaped(self):
        d = build().as_dict()
        self.assertEqual(set(d), {"primary", "changeProbability",
                                  "alternatives", "note"})
        self.assertIn("confidence", d["primary"])
        self.assertTrue(all("evidence" in a for a in d["alternatives"]))


if __name__ == "__main__":
    unittest.main(verbosity=1)
