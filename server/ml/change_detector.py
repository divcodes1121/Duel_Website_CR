"""M2 — the change & edit model, and the three baselines it must beat.

OUTPUT IS A DISTRIBUTION OVER EDIT SIZE, not a yes/no:

    {0: P(no edit), 1: P(one card), 2: P(two cards)}   and   P(change) = 1 - P(0)

Two cards is the ceiling, and that is structural rather than a modelling
choice: staying in a cluster requires 6 shared cards, so a third swap is a
cluster SWITCH. Phase 1 confirmed the 3+ bucket is empty in both domains.

THE MODEL IS MULTINOMIAL LOGISTIC REGRESSION, hand-rolled in the standard
library. That is not a compromise — it is the right tool here. The analytics
API installs nothing (`server/README.md`: "Standard library only, on purpose"),
the signal is a handful of behavioural counters, and a linear model over 21
features gives calibrated-ish probabilities that can be read off as weights.
Boosted trees are deliberately NOT built yet: Phase 2's job is to establish
whether the change signal exists at all, and a linear model that beats the
baselines proves that far more cheaply than one that hides it.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from . import features as F


CLASSES = (0, 1, 2)


# --------------------------------------------------------------------------
# Baselines
# --------------------------------------------------------------------------

class B0AlwaysNoChange:
    """The trivial control. Scores the base rate and detects nothing."""
    name = "B0 always-no-change"

    def predict(self, x: list[float]) -> dict:
        return {0: 1.0, 1: 0.0, 2: 0.0}


class B1LifetimeChurn:
    """The player's own lifetime churn, split by their 1-card / 2-card habit.

    Not learned — read straight off the feature vector, so it is the strongest
    thing available without fitting anything.
    """
    name = "B1 lifetime-churn"

    def __init__(self):
        self.i_churn = F.FEATURE_NAMES.index("churn_lifetime")
        self.i_one = F.FEATURE_NAMES.index("one_card_edit_share")
        self.i_two = F.FEATURE_NAMES.index("two_card_edit_share")

    def predict(self, x: list[float]) -> dict:
        p_change = min(1.0, max(0.0, x[self.i_churn]))
        one, two = x[self.i_one], x[self.i_two]
        total = one + two
        if total <= 0:
            one_share = 1.0
        else:
            one_share = one / total
        return {0: 1.0 - p_change,
                1: p_change * one_share,
                2: p_change * (1.0 - one_share)}


class B2RecentChurn(B1LifetimeChurn):
    """The same idea over the last five outings — 'what are they doing lately'."""
    name = "B2 recent-churn"

    def __init__(self):
        super().__init__()
        self.i_churn = F.FEATURE_NAMES.index("churn_last5")


# --------------------------------------------------------------------------
# M2 — multinomial logistic regression
# --------------------------------------------------------------------------

@dataclass
class Standardizer:
    """Zero-mean unit-variance per feature. Fitted on TRAIN ONLY.

    Fitting on the full set would leak test distribution into training, which
    is a small leak that is very easy to introduce and very hard to see.
    """
    mean: list[float] = field(default_factory=list)
    std: list[float] = field(default_factory=list)

    def fit(self, rows: list[list[float]]) -> "Standardizer":
        n = len(rows)
        d = F.N_FEATURES
        self.mean = [0.0] * d
        self.std = [1.0] * d
        if not n:
            return self
        for j in range(d):
            col = [r[j] for r in rows]
            mu = sum(col) / n
            var = sum((v - mu) ** 2 for v in col) / n
            self.mean[j] = mu
            self.std[j] = math.sqrt(var) if var > 1e-12 else 1.0
        return self

    def apply(self, x: list[float]) -> list[float]:
        return [(v - m) / s for v, m, s in zip(x, self.mean, self.std)]


@dataclass
class M2ChangeModel:
    """Softmax regression over FEATURE_NAMES, trained by SGD."""
    name: str = "M2 logistic"
    epochs: int = 12
    lr: float = 0.08
    l2: float = 1e-4
    seed: int = 20260819
    #: Inverse-frequency class weighting. DEFAULT OFF, on evidence.
    #:
    #: It was on first, on the standard reasoning that change is 9.8% of
    #: competitive steps so unweighted SGD would collapse to "always predict
    #: 0". MEASURED ON THE 400-PLAYER TEST SET, THAT REASONING WAS WRONG and
    #: weighting was strictly harmful — it lost on ranking as well as on
    #: calibration:
    #:
    #:                      competitive          duel
    #:   PR-AUC     on/off  0.634 / 0.710   0.761 / 0.770
    #:   ROC-AUC    on/off  0.918 / 0.932   0.799 / 0.803
    #:   F1         on/off  0.472 / 0.614   0.672 / 0.695
    #:   Brier      on/off  0.138 / 0.047   0.375 / 0.191
    #:   mean P     on/off  0.331 / 0.101   0.875 / 0.438
    #:   actual rate         0.098           0.471
    #:
    #: The signal is strong enough that the majority class never swamps it.
    #: Kept as a parameter so the claim stays testable rather than folklore.
    class_weight: bool = False
    weights: list[list[float]] = field(default_factory=list)
    bias: list[float] = field(default_factory=list)
    scaler: Standardizer = field(default_factory=Standardizer)

    # -- inference ---------------------------------------------------------
    def _logits(self, z: list[float]) -> list[float]:
        return [self.bias[k] + sum(w * v for w, v in zip(self.weights[k], z))
                for k in range(len(CLASSES))]

    @staticmethod
    def _softmax(logits: list[float]) -> list[float]:
        top = max(logits)
        exps = [math.exp(v - top) for v in logits]
        total = sum(exps)
        return [e / total for e in exps]

    def predict(self, x: list[float]) -> dict:
        if not self.weights:
            return {0: 1.0, 1: 0.0, 2: 0.0}
        probs = self._softmax(self._logits(self.scaler.apply(x)))
        return {c: probs[i] for i, c in enumerate(CLASSES)}

    # -- training ----------------------------------------------------------
    def fit(self, rows: list[list[float]], labels: list[int]) -> "M2ChangeModel":
        self.scaler = Standardizer().fit(rows)
        scaled = [self.scaler.apply(r) for r in rows]
        d = F.N_FEATURES
        k = len(CLASSES)
        self.weights = [[0.0] * d for _ in range(k)]
        self.bias = [0.0] * k

        # See the field docstring: measured, weighting hurt every metric.
        if self.class_weight:
            counts = [max(1, sum(1 for y in labels if y == c)) for c in CLASSES]
            total = sum(counts)
            weight = [total / (k * c) for c in counts]
        else:
            weight = [1.0] * k

        order = list(range(len(scaled)))
        rng = random.Random(self.seed)
        for epoch in range(self.epochs):
            rng.shuffle(order)
            lr = self.lr / (1.0 + epoch)
            for idx in order:
                z = scaled[idx]
                y = labels[idx]
                probs = self._softmax(self._logits(z))
                cw = weight[y]
                for c in range(k):
                    err = ((1.0 if c == y else 0.0) - probs[c]) * cw
                    step = lr * err
                    wc = self.weights[c]
                    for j in range(d):
                        wc[j] += step * z[j] - lr * self.l2 * wc[j]
                    self.bias[c] += step
        return self

    def top_weights(self, n: int = 8) -> list[tuple[str, float]]:
        """Largest |weight| on the P(change) direction, for error analysis.

        Class 0 is 'no edit', so -w[0] points at editing.
        """
        if not self.weights:
            return []
        pairs = [(name, -self.weights[0][j])
                 for j, name in enumerate(F.FEATURE_NAMES)]
        return sorted(pairs, key=lambda kv: -abs(kv[1]))[:n]


def as_contract(dist: dict) -> dict:
    """The Phase 2 output shape. No card, no explanation — not yet."""
    p0 = dist.get(0, 0.0)
    return {
        "probabilityNoChange": round(p0, 4),
        "probabilityOneChange": round(dist.get(1, 0.0), 4),
        "probabilityTwoChanges": round(dist.get(2, 0.0), 4),
        "probabilityChange": round(1.0 - p0, 4),
    }
