"""test_ml_change.py — features and the M2 change model.

Synthetic only: no database, no network.

    python server/test_ml_change.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import change_detector as CD      # noqa: E402
from ml import dataset as ds              # noqa: E402
from ml import features as F              # noqa: E402

CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]


def variant(extra):
    return CORE + [extra]


def play(day, extra, result="win", mode="Ranked1v1_NewArena2"):
    return ds.DeckPlay(battle_time="202608%02dT120000.000Z" % day, mode=mode,
                       cards=tuple(variant(extra)), result=result)


def examples(plays, domain="competitive"):
    return list(ds.iter_examples("#T", plays, domain))


class FeatureContract(unittest.TestCase):
    def setUp(self):
        self.ex = examples([play(d, "knight") for d in range(1, 11)])[-1]

    def test_vector_length_matches_names(self):
        self.assertEqual(len(F.extract(self.ex)), F.N_FEATURES)
        self.assertEqual(len(F.FEATURE_NAMES), F.N_FEATURES)

    def test_all_features_are_finite_floats(self):
        for name, value in zip(F.FEATURE_NAMES, F.extract(self.ex)):
            self.assertIsInstance(value, float, name)
            self.assertEqual(value, value, name)          # not NaN

    def test_features_never_read_the_truth(self):
        """THE LEAK TEST. Blank the truth; the vector must not move."""
        blinded = ds.PredictionExample(
            player_tag=self.ex.player_tag, timestamp=self.ex.timestamp,
            domain=self.ex.domain, history=self.ex.history,
            truth=ds.DeckPlay(battle_time=self.ex.timestamp, mode="", cards=()),
            cluster_history=self.ex.cluster_history)
        self.assertEqual(F.extract(self.ex), F.extract(blinded))

    def test_label_is_capped_at_two(self):
        self.assertEqual(F.label(self.ex), 0)
        plays = [play(d, "knight") for d in range(1, 9)]
        plays.append(ds.DeckPlay(battle_time="20260809T120000.000Z",
                                 mode="Ladder",
                                 cards=tuple(CORE[:6] + ["ice-golem", "tesla"])))
        self.assertEqual(F.label(examples(plays)[-1]), 2)


class FeatureMeaning(unittest.TestCase):
    def test_consecutive_identical_counts_the_run(self):
        ex = examples([play(d, "knight") for d in range(1, 11)])[-1]
        idx = F.FEATURE_NAMES.index("consecutive_identical")
        self.assertEqual(F.extract(ex)[idx], 9.0)

    def test_stable_and_volatile_sum_to_eight(self):
        ex = examples([play(d, "knight" if d % 2 else "ice-golem")
                       for d in range(1, 13)])[-1]
        vec = F.extract(ex)
        s = vec[F.FEATURE_NAMES.index("stable_card_count")]
        v = vec[F.FEATURE_NAMES.index("volatile_card_count")]
        self.assertEqual(s + v, 8.0)
        self.assertGreater(v, 0.0, "an alternating slot must read as volatile")

    def test_churn_is_zero_for_a_constant_player(self):
        ex = examples([play(d, "knight") for d in range(1, 11)])[-1]
        vec = F.extract(ex)
        self.assertEqual(vec[F.FEATURE_NAMES.index("churn_lifetime")], 0.0)
        self.assertEqual(vec[F.FEATURE_NAMES.index("churn_last5")], 0.0)

    def test_churn_is_high_for_an_alternating_player(self):
        ex = examples([play(d, "knight" if d % 2 else "ice-golem")
                       for d in range(1, 13)])[-1]
        self.assertGreater(
            F.extract(ex)[F.FEATURE_NAMES.index("churn_lifetime")], 0.8)

    def test_is_duel_flag(self):
        plays = [ds.DeckPlay(battle_time="202608%02dT120000.000Z" % d,
                             mode="Friendly", cards=tuple(variant("knight")))
                 for d in range(1, 11)]
        ex = examples(plays, domain="duel")[-1]
        self.assertEqual(F.extract(ex)[F.FEATURE_NAMES.index("is_duel")], 1.0)

    def test_loss_streak(self):
        """The streak is counted over HISTORY, so the truth's own result is
        not in it — days 8 and 9 are the last two plays the model can see."""
        plays = [play(d, "knight", result="win") for d in range(1, 8)]
        plays += [play(8, "knight", result="loss"),
                  play(9, "knight", result="loss"),
                  play(10, "knight", result="win")]
        ex = examples(plays)[-1]
        self.assertEqual(ex.truth.battle_time[:8], "20260810")
        self.assertEqual(F.extract(ex)[F.FEATURE_NAMES.index("loss_streak")], 2.0)


class Baselines(unittest.TestCase):
    def setUp(self):
        self.ex = examples([play(d, "knight") for d in range(1, 11)])[-1]
        self.x = F.extract(self.ex)

    def test_b0_predicts_no_change_with_certainty(self):
        d = CD.B0AlwaysNoChange().predict(self.x)
        self.assertEqual(d[0], 1.0)
        self.assertEqual(d[1] + d[2], 0.0)

    def test_distributions_sum_to_one(self):
        for model in (CD.B0AlwaysNoChange(), CD.B1LifetimeChurn(),
                      CD.B2RecentChurn()):
            d = model.predict(self.x)
            self.assertAlmostEqual(sum(d.values()), 1.0, places=6, msg=model.name)

    def test_b1_tracks_lifetime_churn(self):
        alt = examples([play(d, "knight" if d % 2 else "ice-golem")
                        for d in range(1, 13)])[-1]
        steady = CD.B1LifetimeChurn().predict(self.x)
        churny = CD.B1LifetimeChurn().predict(F.extract(alt))
        self.assertLess(steady[0], 1.0000001)
        self.assertLess(churny[0], steady[0],
                        "an alternating player must look more likely to edit")


class M2Model(unittest.TestCase):
    def _training_set(self):
        """Separable by construction: churn drives the label."""
        rows, labels = [], []
        base = F.extract(examples([play(d, "knight") for d in range(1, 11)])[-1])
        churny = F.extract(examples([play(d, "knight" if d % 2 else "ice-golem")
                                     for d in range(1, 13)])[-1])
        for _ in range(60):
            rows.append(list(base))
            labels.append(0)
            rows.append(list(churny))
            labels.append(1)
        return rows, labels

    def test_untrained_model_is_safe(self):
        d = CD.M2ChangeModel().predict([0.0] * F.N_FEATURES)
        self.assertEqual(d[0], 1.0)

    def test_probabilities_sum_to_one(self):
        rows, labels = self._training_set()
        model = CD.M2ChangeModel(epochs=4).fit(rows, labels)
        d = model.predict(rows[0])
        self.assertAlmostEqual(sum(d.values()), 1.0, places=6)
        for v in d.values():
            self.assertGreaterEqual(v, 0.0)
            self.assertLessEqual(v, 1.0)

    def test_learns_a_separable_signal(self):
        rows, labels = self._training_set()
        model = CD.M2ChangeModel(epochs=8).fit(rows, labels)
        steady = 1.0 - model.predict(rows[0])[0]
        churny = 1.0 - model.predict(rows[1])[0]
        self.assertGreater(churny, steady,
                           "the churny profile must get the higher P(change)")

    def test_standardizer_is_fitted_on_training_rows_only(self):
        rows, labels = self._training_set()
        model = CD.M2ChangeModel(epochs=2).fit(rows, labels)
        self.assertEqual(len(model.scaler.mean), F.N_FEATURES)
        self.assertTrue(all(s > 0 for s in model.scaler.std),
                        "a zero std would divide by zero at inference")

    def test_training_is_deterministic(self):
        rows, labels = self._training_set()
        a = CD.M2ChangeModel(epochs=3).fit(rows, labels).predict(rows[0])
        b = CD.M2ChangeModel(epochs=3).fit(rows, labels).predict(rows[0])
        self.assertEqual(a, b)


class OutputContract(unittest.TestCase):
    def test_contract_shape(self):
        out = CD.as_contract({0: 0.65, 1: 0.25, 2: 0.10})
        self.assertEqual(set(out), {"probabilityNoChange", "probabilityOneChange",
                                    "probabilityTwoChanges", "probabilityChange"})
        self.assertAlmostEqual(out["probabilityChange"], 0.35, places=4)

    def test_change_is_one_minus_no_change(self):
        out = CD.as_contract({0: 0.4, 1: 0.4, 2: 0.2})
        self.assertAlmostEqual(
            out["probabilityChange"],
            out["probabilityOneChange"] + out["probabilityTwoChanges"], places=4)

    def test_contract_carries_no_card_or_explanation(self):
        """Phase 2 predicts WHETHER, never WHICH."""
        out = CD.as_contract({0: 1.0, 1: 0.0, 2: 0.0})
        for banned in ("card", "candidates", "evidence", "explanation"):
            self.assertNotIn(banned, out)


if __name__ == "__main__":
    unittest.main(verbosity=1)
