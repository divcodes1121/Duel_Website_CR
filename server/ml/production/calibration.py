"""Phase 17A — production confidence calibration.

WHY THIS EXISTS. The bands were graded on the Phase 14 research population,
which stepped `next-in-cluster`. Production asks "what deck comes next", and the
16C backtest measured what the old thresholds actually deliver on that question:

    duel  high  91.2% of reads at 70.8% pooled / 61.2% macro

A label claiming "high" on nine reads in ten while being wrong three times in
ten is not a confidence signal, it is decoration. This module re-cuts the
thresholds against measured production outcomes.

WHAT THIS IS NOT. A retrain. The underlying P(change) model is untouched and
still orders correctness correctly — the 16C decile table runs 98.7% -> 72.6%
(competitive) and 92.0% -> 34.4% (duel). Only the cut points move.

COMPETITIVE IS DELIBERATELY UNCHANGED. Its accuracy is uniformly high, so equal
tertiles measured 93.3 / 92.4 / 82.3 — no separation at all. The existing cuts
are the only ones that discriminate; only the published accuracies were wrong.
"""
from __future__ import annotations

import json
import os
import threading

ARTIFACT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "artifacts", "band-calibration-v1.json")

#: Used when the artifact is missing. These are the ORIGINAL Phase 14 cuts, so
#: an absent artifact degrades to the previously shipped behaviour rather than
#: to something no one has measured.
FALLBACK = (0.15, 0.45)

_lock = threading.Lock()
_cal = None
_loaded = False


def _load():
    global _cal, _loaded
    with _lock:
        if _loaded:
            return _cal
        _loaded = True
        try:
            with open(ARTIFACT, encoding="utf-8") as fh:
                _cal = json.load(fh)
        except Exception:
            _cal = None
        return _cal


def version() -> str:
    cal = _load()
    return (cal or {}).get("version", "uncalibrated")


#: PHASE 23, FIX 2. The public domain is `practice`; the FROZEN artifact
#: still keys it `duel`, and historical artifacts are never overwritten
#: (spec section 6). One mapping here is the whole cost of the rename, and
#: it keeps every stored observation attributable to the artifact that
#: produced it.
ARTIFACT_DOMAIN = {"practice": "duel", "competitive": "competitive"}


def thresholds(domain: str) -> tuple:
    cal = _load()
    if not cal:
        return FALLBACK
    d = (cal.get("domains") or {}).get(ARTIFACT_DOMAIN.get(domain, domain))
    if not d:
        return FALLBACK
    try:
        return float(d["high_below"]), float(d["medium_below"])
    except Exception:
        return FALLBACK


def band(domain: str, p_change: float) -> str:
    """The calibrated confidence band for the PRIMARY prediction."""
    hi, med = thresholds(domain)
    if p_change < hi:
        return "high"
    if p_change < med:
        return "medium"
    return "low"


def expected_accuracy(domain: str, band_name: str):
    """What this band measured on held-out players, or None if not measured.

    Returned so a caller can show the number rather than the adjective. `None`
    is a real answer — competitive 'low' had 3 held-out predictions, which is
    not an estimate of anything.
    """
    cal = _load()
    if not cal:
        return None
    d = (cal.get("domains") or {}).get(
        ARTIFACT_DOMAIN.get(domain, domain)) or {}
    return (d.get("measured") or {}).get(band_name)
