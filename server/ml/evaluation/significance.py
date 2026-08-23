"""Player-level bootstrap and PAIRED model comparison.

TWO RULES, AND THE SECOND ONE IS THE ONE THAT IS EASY TO GET WRONG.

1. RESAMPLE PLAYERS, NOT PREDICTIONS. Predictions from one player are heavily
   correlated — a player with 300 near-identical plays is close to one
   observation repeated, not 300 independent ones. Resampling rows would
   produce intervals far too narrow and would make every difference look
   significant.

2. SIGNIFICANCE COMES FROM THE PAIRED DELTA, NEVER FROM CI OVERLAP. Both models
   are scored on the SAME examples, so the comparison is paired. Each replicate
   resamples players, recomputes BOTH models on that replicate, and records the
   difference; the verdict is read off the CI of that difference distribution.

   Asking whether the two marginal CIs overlap is a DIFFERENT AND INVALID test.
   Overlapping marginal intervals are routinely compatible with a significant
   paired difference, because the paired delta cancels the between-player
   variance that dominates each marginal interval. The marginal CIs in the
   report are descriptive; they are never the basis of a verdict.
"""
from __future__ import annotations

import random
from dataclasses import dataclass

from .. import config


@dataclass(frozen=True)
class Interval:
    point: float
    low: float
    high: float
    n: int

    def excludes_zero(self) -> bool:
        return self.low > 0.0 or self.high < 0.0

    def __str__(self) -> str:
        return "%.3f [%.3f, %.3f]" % (self.point, self.low, self.high)


def _percentiles(values: list[float], pct: int) -> tuple[float, float]:
    if not values:
        return 0.0, 0.0
    vals = sorted(values)
    lo_q = (100 - pct) / 200.0
    hi_q = 1.0 - lo_q
    n = len(vals)
    lo = vals[max(0, min(n - 1, int(round(lo_q * (n - 1)))))]
    hi = vals[max(0, min(n - 1, int(round(hi_q * (n - 1)))))]
    return lo, hi


def bootstrap_mean(per_player: dict, iters: int | None = None,
                   seed: int | None = None) -> Interval:
    """CI for the macro-average of a per-player metric.

    `per_player` is {player_tag: [value, ...]}. A replicate draws players with
    replacement, averages within each drawn player, then averages across them.
    """
    tags = sorted(per_player)
    if not tags:
        return Interval(0.0, 0.0, 0.0, 0)

    def macro(sample: list[str]) -> float:
        means = []
        for t in sample:
            vals = per_player[t]
            if vals:
                means.append(sum(vals) / len(vals))
        return sum(means) / len(means) if means else 0.0

    point = macro(tags)
    rng = random.Random(config.BOOTSTRAP_SEED if seed is None else seed)
    n_iter = config.BOOTSTRAP_ITERS if iters is None else iters
    draws = [macro([tags[rng.randrange(len(tags))] for _ in tags])
             for _ in range(n_iter)]
    lo, hi = _percentiles(draws, config.CI_PERCENT)
    return Interval(point, lo, hi, len(tags))


def paired_delta(a_per_player: dict, b_per_player: dict,
                 iters: int | None = None, seed: int | None = None) -> Interval:
    """CI of (metric_A - metric_B), paired on players.

    Both dicts must be keyed by the same players and scored on the same
    examples; only players present in both are used. Each replicate draws one
    set of players and evaluates BOTH models on it, so the draw cancels.
    """
    tags = sorted(set(a_per_player) & set(b_per_player))
    if not tags:
        return Interval(0.0, 0.0, 0.0, 0)

    def player_delta(tag: str) -> float | None:
        av, bv = a_per_player[tag], b_per_player[tag]
        if not av or not bv:
            return None
        return (sum(av) / len(av)) - (sum(bv) / len(bv))

    deltas = {t: d for t in tags if (d := player_delta(t)) is not None}
    keys = sorted(deltas)
    if not keys:
        return Interval(0.0, 0.0, 0.0, 0)

    point = sum(deltas[t] for t in keys) / len(keys)
    rng = random.Random(config.BOOTSTRAP_SEED if seed is None else seed)
    n_iter = config.BOOTSTRAP_ITERS if iters is None else iters
    draws = []
    for _ in range(n_iter):
        sample = [keys[rng.randrange(len(keys))] for _ in keys]
        draws.append(sum(deltas[t] for t in sample) / len(sample))
    lo, hi = _percentiles(draws, config.CI_PERCENT)
    return Interval(point, lo, hi, len(keys))


def verdict(delta: Interval, a_name: str, b_name: str) -> str:
    """The ONLY place a 'better' claim is made, and only from the paired CI."""
    if delta.n == 0:
        return "no paired data"
    if not delta.excludes_zero():
        return "no statistically reliable difference detected"
    winner = a_name if delta.point > 0 else b_name
    return "%s is statistically better" % winner
