"""test_ml_candidates.py — Phase 8 candidate generation.

Includes the PERMANENT CONTRACT that Phase 7 showed was missing: generation
must run on every step from the prefix alone, never conditioned on knowing an
edit occurred. Phase 6's "deployable" result was invalidated by exactly that.

    python server/test_ml_candidates.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import candidates as C        # noqa: E402
from ml import exit_model as E        # noqa: E402
from ml import substitution as S      # noqa: E402
from ml.evaluation import phase7_dump as P7   # noqa: E402

CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]


def view(extra="knight", prior=None, pool=("ice-golem", "valkyrie", "tesla")):
    deck = sorted(CORE + [extra])
    counts = dict({c: 20 for c in CORE}, **{extra: 12})
    for i, p in enumerate(pool):
        counts[p] = 8 - i
    full = {str(w): {c: min(w, 20) for c in deck} for w in (5, 10, 20)}
    return {
        "tag": "#A", "domain": "duel", "ts": "20260810T120000.000Z",
        "prev_deck": deck, "cluster_size": 20, "cluster_card_counts": counts,
        "recent_counts": full, "last_seen": {c: 0 for c in deck},
        "streak": {c: 20 for c in deck},
        # OLDEST FIRST, matching the dump.
        "prior_edits": prior if prior is not None else [
            [["valkyrie"], ["ice-golem"]], [["ice-golem"], ["knight"]]],
        "result": "loss", "opp_wc": "golem",
    }


def models():
    return (E.E4Combined(E.PopulationExitStats()), S.S2Transition(S.GlobalStats()))


class HistoricalReconstruction(unittest.TestCase):
    def test_walks_back_through_the_edit_history(self):
        v = view()
        variants = C.historical_variants(v)
        marks = [sorted(d - set(CORE))[0] for d in variants]
        self.assertEqual(marks, ["knight", "ice-golem", "valkyrie"])

    def test_every_variant_is_a_legal_eight_card_deck(self):
        for d in C.historical_variants(view()):
            self.assertEqual(len(d), 8)

    def test_no_history_yields_only_the_current_deck(self):
        self.assertEqual(len(C.historical_variants(view(prior=[]))), 1)

    def test_duplicate_variants_are_collapsed(self):
        v = view(prior=[[["knight"], ["ice-golem"]],
                        [["ice-golem"], ["knight"]],
                        [["knight"], ["ice-golem"]],
                        [["ice-golem"], ["knight"]]])
        variants = C.historical_variants(v)
        self.assertEqual(len(variants), len(set(variants)))

    def test_corrupt_history_stops_rather_than_producing_bad_decks(self):
        """An edit that cannot be inverted must not emit a 7- or 9-card deck."""
        v = view(prior=[[["not-in-deck"], ["also-absent"]]])
        for d in C.historical_variants(v):
            self.assertEqual(len(d), 8)


class GeneratorContract(unittest.TestCase):
    """The Phase 7 lesson, made permanent."""

    def _all(self):
        xm, em = models()
        return [C.C0Beam(xm, em, 3), C.C1WideOneCard(xm, em),
                C.C2TwoCard(xm, em), C.C3Historical(xm, em), C.C4Union(xm, em)]

    def test_generation_never_reads_the_truth(self):
        """THE CONTRACT. Candidates must not depend on the next deck."""
        for gen in self._all():
            a = gen.generate(dict(view(), next_deck=["x"] * 8))
            b = gen.generate(dict(view(), next_deck=["y"] * 8))
            self.assertEqual(a, b, gen.name)

    def test_generation_works_on_a_no_change_step(self):
        """Phase 6 only built candidates on true edits; that was the oracle."""
        v = view()
        for gen in self._all():
            self.assertTrue(len(gen.generate(v)) >= 1, gen.name)

    def test_input_keys_do_not_include_the_truth(self):
        self.assertNotIn("next_deck", P7.INPUT_KEYS)

    def test_candidates_are_legal_and_unique(self):
        v = view()
        for gen in self._all():
            cands = gen.generate(v)
            self.assertEqual(len(cands), len({(c.exits, c.entries) for c in cands}),
                             gen.name)
            for c in cands:
                self.assertEqual(len(c.apply(v["prev_deck"])), 8, gen.name)

    def test_exits_are_in_the_deck_and_entries_are_not(self):
        v = view()
        deck = set(v["prev_deck"])
        for gen in self._all():
            for c in gen.generate(v):
                for x in c.exits:
                    self.assertIn(x, deck, gen.name)
                for y in c.entries:
                    self.assertNotIn(y, deck, gen.name)


class GeneratorShapes(unittest.TestCase):
    def test_c1_emits_only_one_card_edits(self):
        xm, em = models()
        sizes = {c.size for c in C.C1WideOneCard(xm, em).generate(view())}
        self.assertTrue(sizes <= {0, 1})

    def test_c2_emits_only_two_card_edits(self):
        xm, em = models()
        sizes = {c.size for c in C.C2TwoCard(xm, em).generate(view())}
        self.assertTrue(sizes <= {0, 2})

    def test_c2_enumerates_more_exit_pairs_than_c0(self):
        xm, em = models()
        c0 = {c.exits for c in C.C0Beam(xm, em, 3).generate(view()) if c.size == 2}
        c2 = {c.exits for c in C.C2TwoCard(xm, em).generate(view()) if c.size == 2}
        self.assertGreater(len(c2), len(c0))

    def test_c4_is_a_superset_and_respects_its_cap(self):
        xm, em = models()
        v = view()
        union = C.C4Union(xm, em, cap=1000).generate(v)
        for gen in (C.C0Beam(xm, em, 3), C.C3Historical(xm, em)):
            for c in gen.generate(v):
                self.assertIn(c, union, gen.name)
        self.assertLessEqual(len(C.C4Union(xm, em, cap=5).generate(v)), 5)

    def test_stay_is_offered_by_every_generator(self):
        xm, em = models()
        for gen in (C.C0Beam(xm, em, 3), C.C1WideOneCard(xm, em),
                    C.C2TwoCard(xm, em), C.C3Historical(xm, em)):
            self.assertIn(C.STAY, gen.generate(view()), gen.name)


class RecallMeasurement(unittest.TestCase):
    def test_recall_finds_a_returning_deck(self):
        xm, em = models()
        v = view()
        truth = sorted((set(v["prev_deck"]) - {"knight"}) | {"ice-golem"})
        info = C.C3Historical(xm, em).recall(v, truth)
        self.assertIsNotNone(info["rank"])
        self.assertTrue(info["hits"][3])

    def test_recall_reports_an_unreachable_deck(self):
        xm, em = models()
        v = view()
        truth = sorted((set(v["prev_deck"]) - {"knight"}) | {"never-seen"})
        info = C.C4Union(xm, em).recall(v, truth)
        self.assertIsNone(info["rank"])
        self.assertFalse(any(info["hits"].values()))

    def test_repeat_rate_counts_only_edits(self):
        v = view()
        same = (v, v["prev_deck"])                     # no change: ignored
        back = (v, sorted((set(v["prev_deck"]) - {"knight"}) | {"ice-golem"}))
        res = C.deck_repeat_rate([same, back])
        self.assertEqual(res["total"], 1)
        self.assertEqual(res["repeat"], 1)

    def test_repeat_rate_detects_a_novel_deck(self):
        v = view()
        novel = (v, sorted((set(v["prev_deck"]) - {"knight"}) | {"brand-new"}))
        res = C.deck_repeat_rate([novel])
        self.assertEqual(res["repeat"], 0)
        self.assertEqual(res["rate"], 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=1)
