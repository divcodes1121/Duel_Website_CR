"""Phase 19D — fit confidence bands from REAL production outcomes.

WHY. Phase 19C reconciled 167 competitive predictions against the battles that
actually followed, and the shipped `high` band delivered 72.3% [64.7, 78.7]
against a published claim of 90.5% — the whole interval below the claim. The
band is overconfident in production. The cuts have to move.

WHAT THIS IS NOT. A retrain. `M2ChangeModel` weights, the feature set, candidate
generation, ranking and Recent are untouched. This fits THRESHOLDS on the
model's existing P(change) output, which is the same thing Phase 17A did — only
now against real outcomes rather than a backtest.

TWO RULES THAT DO MOST OF THE WORK:

  MINIMUM SUPPORT. A band with one observation is not an estimate. Competitive
  `low` had n=1 and scored 0/1; quoting "0.0%" from that would be dressing up a
  coin flip. Bands below `MIN_BAND_PLAYERS` publish `None`, not a number.

  HELD-OUT BY PLAYER. Cuts are fitted on one set of players and scored on
  another. Choosing cuts that make the fitting sample look monotonic is trivial
  and means nothing; the ordering has to survive players the cuts never saw.
"""
from __future__ import annotations

import hashlib
import json
import math

#: Below this many players a band is reported but NOT given an accuracy claim.
MIN_BAND_PLAYERS = 30

#: A domain with fewer reconciled players than this is not calibrated at all.
MIN_DOMAIN_PLAYERS = 100


def wilson(k: int, n: int, z: float = 1.96) -> tuple:
    """95% interval for a proportion. Small-n honest, unlike a normal approx."""
    if not n:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, centre - half), min(1.0, centre + half))


def split_by_player(rows, seed: str = "19d") -> tuple:
    """Deterministic player-level halves. A player never spans both sides."""
    fit, evl = [], []
    for r in rows:
        h = hashlib.md5((seed + "|" + str(r["player"])).encode()).hexdigest()
        (fit if int(h, 16) % 2 else evl).append(r)
    return fit, evl


def quantile_cuts(rows, min_share: float = 0.20) -> tuple:
    """Empirical tertile-ish cuts on P(change), with a minimum share per band.

    The simplest defensible mapping, and the one to beat. `min_share` stops a
    degenerate solution that puts everything in one band — the failure mode the
    17A competitive fit hit when its accuracy floor was satisfiable everywhere.
    """
    s = sorted(rows, key=lambda r: r["pChange"])
    n = len(s)
    if n < 6:
        return (0.15, 0.45)
    lo_i = max(int(n * min_share), 1)
    hi_i = min(int(n * (1 - min_share)), n - 1)
    return (s[lo_i]["pChange"], s[hi_i]["pChange"])


def monotonic_cuts(rows, min_share: float = 0.20):
    """Search cuts that maximise separation between the top and bottom band.

    Still just two thresholds on one score — no new model, and every candidate
    is constrained to leave real support in each band.
    """
    s = sorted(rows, key=lambda r: r["pChange"])
    n = len(s)
    if n < 12:
        return quantile_cuts(rows, min_share)
    ok = [1 if r["correct"] else 0 for r in s]
    pre = [0] * (n + 1)
    for i, v in enumerate(ok):
        pre[i + 1] = pre[i] + v
    floor = max(int(n * min_share), 3)
    best, best_gap = None, -1.0
    for i in range(floor, n - 2 * floor + 1):
        for j in range(i + floor, n - floor + 1):
            hi = pre[i] / i
            lo = (pre[n] - pre[j]) / (n - j)
            mid = (pre[j] - pre[i]) / max(1, j - i)
            if not (hi >= mid >= lo):
                continue                      # must be monotonic on the fit set
            if hi - lo > best_gap:
                best_gap, best = hi - lo, (i, j)
    if best is None:
        return quantile_cuts(rows, min_share)
    i, j = best
    return (s[i]["pChange"], s[j]["pChange"])


def band_of(p: float, cuts: tuple) -> str:
    return "high" if p < cuts[0] else ("medium" if p < cuts[1] else "low")


def evaluate(rows, cuts: tuple) -> dict:
    """Per-band support, accuracy, macro and CI on a set of rows."""
    out = {}
    total = len(rows) or 1
    for band in ("high", "medium", "low"):
        sel = [r for r in rows if band_of(r["pChange"], cuts) == band]
        players = {r["player"] for r in sel}
        k = sum(1 for r in sel if r["correct"])
        lo, hi = wilson(k, len(sel))
        per = {}
        for r in sel:
            per.setdefault(r["player"], []).append(1.0 if r["correct"] else 0.0)
        macro = (sum(sum(v) / len(v) for v in per.values()) / len(per)) if per else 0.0
        enough = len(players) >= MIN_BAND_PLAYERS
        out[band] = {
            "n": len(sel), "players": len(players),
            "share": len(sel) / total, "correct": k,
            # An accuracy CLAIM requires support. Below the floor the numbers
            # are still reported for diagnosis but published as None.
            "accuracy": (k / len(sel)) if sel else None,
            "accuracyMacro": macro if sel else None,
            "ci": [lo, hi],
            "publishable": enough,
            "published": (k / len(sel)) if (sel and enough) else None,
        }
    return out



def _usable(rows):
    """Rows carrying a numeric score. A record without one cannot contribute to
    a score metric, and a report must not crash on a malformed row — the whole
    point of the checkpoint is to survive bad data and say so."""
    out = []
    for r in rows or ():
        p = r.get("pChange")
        if isinstance(p, (int, float)):
            out.append(r)
    return out


def brier(rows) -> float:
    """Calibration of the underlying score, unchanged by any cut.

    P(change) is the probability the deck CHANGES, so P(Recent correct) is its
    complement — getting that backwards inverts the metric.
    """
    rows = _usable(rows)
    if not rows:
        return 0.0
    return sum((1.0 - r["pChange"] - (1.0 if r["correct"] else 0.0)) ** 2
               for r in rows) / len(rows)


def ece(rows, bins: int = 5) -> float:
    """Expected calibration error of P(Recent correct) against outcomes."""
    rows = _usable(rows)
    if not rows:
        return 0.0
    total, err = len(rows), 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        sel = [r for r in rows if lo <= (1.0 - r["pChange"]) < hi
               or (b == bins - 1 and (1.0 - r["pChange"]) == 1.0)]
        if not sel:
            continue
        conf = sum(1.0 - r["pChange"] for r in sel) / len(sel)
        acc = sum(1 for r in sel if r["correct"]) / len(sel)
        err += (len(sel) / total) * abs(conf - acc)
    return err


def reliability(rows, bins: int = 5) -> list:
    """Reliability by score bin — the diagnostic behind Brier and ECE."""
    rows = _usable(rows)
    out = []
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        sel = [r for r in rows if lo <= (1.0 - r["pChange"]) < hi
               or (b == bins - 1 and (1.0 - r["pChange"]) == 1.0)]
        if not sel:
            continue
        k = sum(1 for r in sel if r["correct"])
        cl, ch = wilson(k, len(sel))
        out.append({"bin": "%.1f-%.1f" % (lo, hi), "n": len(sel),
                    "meanConfidence": sum(1.0 - r["pChange"] for r in sel) / len(sel),
                    "accuracy": k / len(sel), "ci": [cl, ch]})
    return out


def fit_domain(rows) -> dict:
    """Fit on half the players, report on the other half. Never on both."""
    players = {r["player"] for r in rows}
    if len(players) < MIN_DOMAIN_PLAYERS:
        return {"calibrated": False, "players": len(players),
                "reason": "only %d reconciled players, %d required"
                          % (len(players), MIN_DOMAIN_PLAYERS)}
    fit, evl = split_by_player(rows)
    candidates = {"quantile": quantile_cuts(fit), "monotonic": monotonic_cuts(fit)}
    results = {}
    for name, cuts in candidates.items():
        held = evaluate(evl, cuts)
        acc = [held[b]["accuracy"] for b in ("high", "medium", "low")
               if held[b]["accuracy"] is not None]
        ordered = len(acc) > 1 and all(a >= c for a, c in zip(acc, acc[1:]))
        results[name] = {"cuts": list(cuts), "heldOut": held, "ordered": ordered,
                         "fitPlayers": len({r["player"] for r in fit}),
                         "evalPlayers": len({r["player"] for r in evl})}
    return {"calibrated": True, "players": len(players),
            "candidates": results,
            "brier": brier(rows), "ece": ece(rows),
            "reliability": reliability(rows)}
