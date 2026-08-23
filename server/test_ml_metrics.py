"""test_ml_metrics.py — every metric against HAND-CALCULATED fixtures.

The arithmetic is written out in each docstring, because a metric that agrees
with itself proves nothing. No database, no network.

    python server/test_ml_metrics.py
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml.evaluation import metrics as M          # noqa: E402
from ml.evaluation import significance as S     # noqa: E402


class NextDeckMetrics(unittest.TestCase):
    def test_exact_is_order_insensitive(self):
        self.assertEqual(M.exact(["a", "b"], ["b", "a"]), 1.0)
        self.assertEqual(M.exact(["a", "b"], ["a", "c"]), 0.0)

    def test_exact_at_k(self):
        preds = [{"a"}, {"b"}, {"c"}]
        self.assertEqual(M.exact_at_k(preds, {"c"}, 3), 1.0)
        self.assertEqual(M.exact_at_k(preds, {"c"}, 2), 0.0,
                         "c is third, so it is outside k=2")

    def test_jaccard(self):
        """{a,b,c} vs {a,b,d}: intersection 2, union 4 -> 0.5"""
        self.assertAlmostEqual(M.jaccard("abc", "abd"), 0.5)

    def test_jaccard_identical_and_disjoint(self):
        self.assertEqual(M.jaccard("abc", "abc"), 1.0)
        self.assertEqual(M.jaccard("abc", "xyz"), 0.0)

    def test_jaccard_two_empty_sets(self):
        self.assertEqual(M.jaccard([], []), 1.0)

    def test_hamming_is_symmetric_difference(self):
        """One swap in an 8-card deck differs by TWO cards, not one."""
        a = list("abcdefgh")
        b = list("abcdefgz")
        self.assertEqual(M.hamming(a, b), 2.0)
        self.assertEqual(M.hamming(a, a), 0.0)

    def test_card_precision_recall(self):
        """pred {a,b,c} vs truth {a,b,d,e}: hits 2 -> P 2/3, R 2/4"""
        self.assertAlmostEqual(M.card_precision("abc", "abde"), 2 / 3)
        self.assertAlmostEqual(M.card_recall("abc", "abde"), 0.5)

    def test_precision_recall_empty_guards(self):
        self.assertEqual(M.card_precision([], "ab"), 0.0)
        self.assertEqual(M.card_recall("ab", []), 0.0)


class RankingMetrics(unittest.TestCase):
    def test_top_k(self):
        ranked = ["x", "y", "z"]
        self.assertEqual(M.top_k(ranked, {"y"}, 1), 0.0)
        self.assertEqual(M.top_k(ranked, {"y"}, 2), 1.0)
        self.assertEqual(M.top_k(ranked, {"x"}, 1), 1.0)
        self.assertEqual(M.top_k(ranked, {"q"}, 3), 0.0)

    def test_reciprocal_rank(self):
        """First hit at position 2 -> 1/2."""
        self.assertEqual(M.reciprocal_rank(["x", "y", "z"], {"y"}), 0.5)
        self.assertEqual(M.reciprocal_rank(["x"], {"x"}), 1.0)
        self.assertEqual(M.reciprocal_rank(["x"], {"q"}), 0.0)

    def test_reciprocal_rank_uses_first_hit(self):
        self.assertEqual(M.reciprocal_rank(["a", "b"], {"a", "b"}), 1.0)

    def test_ndcg_single_relevant_at_second(self):
        """DCG = 1/log2(3) = 0.63093; IDCG = 1/log2(2) = 1."""
        got = M.ndcg(["x", "y"], {"y"}, 10)
        self.assertAlmostEqual(got, 1 / math.log2(3), places=6)

    def test_ndcg_perfect_is_one(self):
        self.assertAlmostEqual(M.ndcg(["a", "b"], {"a", "b"}, 10), 1.0)

    def test_ndcg_no_relevant_is_zero(self):
        self.assertEqual(M.ndcg(["a"], set(), 10), 0.0)

    def test_ndcg_respects_k(self):
        self.assertEqual(M.ndcg(["a", "b", "c"], {"c"}, 2), 0.0)


class ClassificationMetrics(unittest.TestCase):
    def test_prf(self):
        """tp3 fp1 fn2 -> P 0.75, R 0.6, F1 2*.75*.6/1.35 = 0.6667"""
        p, r, f = M.prf(3, 1, 2)
        self.assertAlmostEqual(p, 0.75)
        self.assertAlmostEqual(r, 0.6)
        self.assertAlmostEqual(f, 2 * 0.75 * 0.6 / (0.75 + 0.6))

    def test_prf_all_zero_denominators(self):
        self.assertEqual(M.prf(0, 0, 0), (0.0, 0.0, 0.0))

    def test_prf_predict_nothing(self):
        """The 'always predict no change' control, scored on the CHANGE class."""
        self.assertEqual(M.prf(tp=0, fp=0, fn=17), (0.0, 0.0, 0.0))


class Aggregation(unittest.TestCase):
    def test_mean_median(self):
        self.assertEqual(M.mean([1, 2, 3]), 2)
        self.assertEqual(M.median([1, 2, 3]), 2)
        self.assertEqual(M.median([1, 2, 3, 4]), 2.5)
        self.assertEqual(M.mean([]), 0.0)

    def test_deciles(self):
        vals = [float(i) for i in range(1, 11)]
        self.assertLess(M.decile(vals, 0.1), M.decile(vals, 0.9))


class Statistics(unittest.TestCase):
    def test_bootstrap_on_constant_data_has_zero_width(self):
        per = {"a": [1.0], "b": [1.0], "c": [1.0]}
        iv = S.bootstrap_mean(per, iters=200)
        self.assertAlmostEqual(iv.point, 1.0)
        self.assertAlmostEqual(iv.low, 1.0)
        self.assertAlmostEqual(iv.high, 1.0)

    def test_bootstrap_is_player_level(self):
        """One player with many rows must not outvote nine with one each."""
        per = {"heavy": [1.0] * 1000}
        per.update({"p%d" % i: [0.0] for i in range(9)})
        iv = S.bootstrap_mean(per, iters=200)
        self.assertAlmostEqual(iv.point, 0.1, places=6)

    def test_paired_delta_detects_a_real_difference(self):
        a = {"p%d" % i: [1.0] for i in range(20)}
        b = {"p%d" % i: [0.0] for i in range(20)}
        delta = S.paired_delta(a, b, iters=300)
        self.assertAlmostEqual(delta.point, 1.0)
        self.assertTrue(delta.excludes_zero())
        self.assertIn("better", S.verdict(delta, "A", "B"))

    def test_paired_delta_reports_no_difference_when_identical(self):
        a = {"p%d" % i: [0.5] for i in range(20)}
        b = {"p%d" % i: [0.5] for i in range(20)}
        delta = S.paired_delta(a, b, iters=300)
        self.assertAlmostEqual(delta.point, 0.0)
        self.assertFalse(delta.excludes_zero())
        self.assertEqual(S.verdict(delta, "A", "B"),
                         "no statistically reliable difference detected")

    def test_paired_delta_names_the_loser_correctly(self):
        a = {"p%d" % i: [0.0] for i in range(20)}
        b = {"p%d" % i: [1.0] for i in range(20)}
        delta = S.paired_delta(a, b, iters=300)
        self.assertEqual(S.verdict(delta, "A", "B"), "B is statistically better")

    def test_paired_beats_marginal_overlap(self):
        """THE REASON THE PAIRED TEST EXISTS.

        Twenty players with wildly different skill, where A beats B by a small
        CONSTANT margin. The marginal CIs are enormous and overlap almost
        entirely; the paired delta is tight and excludes zero. Judging by
        marginal overlap would wrongly report 'no difference'.
        """
        base = [i / 20.0 for i in range(20)]
        a = {"p%d" % i: [v + 0.02] for i, v in enumerate(base)}
        b = {"p%d" % i: [v] for i, v in enumerate(base)}
        iv_a = S.bootstrap_mean(a, iters=400)
        iv_b = S.bootstrap_mean(b, iters=400)
        overlap = iv_a.low < iv_b.high and iv_b.low < iv_a.high
        self.assertTrue(overlap, "marginal CIs should overlap in this fixture")

        delta = S.paired_delta(a, b, iters=400)
        self.assertAlmostEqual(delta.point, 0.02, places=6)
        self.assertTrue(delta.excludes_zero(),
                        "paired delta must detect the constant margin")

    def test_empty_inputs_do_not_crash(self):
        self.assertEqual(S.bootstrap_mean({}, iters=10).n, 0)
        self.assertEqual(S.paired_delta({}, {}, iters=10).n, 0)
        self.assertEqual(S.verdict(S.paired_delta({}, {}, iters=10), "A", "B"),
                         "no paired data")

    def test_bootstrap_is_deterministic(self):
        per = {"p%d" % i: [i / 10.0] for i in range(10)}
        first = S.bootstrap_mean(per, iters=200)
        second = S.bootstrap_mean(per, iters=200)
        self.assertEqual((first.low, first.high), (second.low, second.high))


if __name__ == "__main__":
    unittest.main(verbosity=1)
