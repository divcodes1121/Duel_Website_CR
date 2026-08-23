"""Phase 19C — the cheap readiness check for the frozen shadow experiment.

WHY ROW COUNT IS THE WRONG SIGNAL. Between two checkpoint runs the database grew
by 43,698 rows and produced exactly zero outcomes. Those rows were historical
BACKFILL: the row count climbed while `MAX(battle_time)` stood still. An outcome
must be a battle STRICTLY LATER than a prediction's anchor, and backfill can only
add battles earlier than the frontier, so it can never ripen an anchor.

So readiness is one question, and it is answerable by a single indexed lookup:

    SELECT MAX(battle_time) FROM battles;

`idx_battles_time` covers that column, so this costs a B-tree descent rather
than a scan — which matters because the alternative (reconciling 574 anchors)
takes ~2 minutes of random I/O on a spinning volume. Poll this; reconcile only
when it moves.

NOTHING HERE IS PART OF THE PREDICTION PATH. New file, read-only, imports no
model, and changes no frozen module.
"""
from __future__ import annotations

import os

import clash_data as cd

#: The frontier as it stood when the 574 observations were frozen. Recorded so
#: a reader can see what the experiment is waiting on without loading the log.
FROZEN_FRONTIER = "20260819T181548.000Z"


def current_frontier() -> str:
    """The newest battle_time in the hot tier, or "" if unavailable.

    One indexed MAX(). Never raises — an unplugged H: reports "not ready"
    rather than taking a caller down.
    """
    try:
        path = cd.resolve_db_path()
        if not path:
            return ""
        con = cd.connect(path)
        try:
            row = con.execute("SELECT MAX(battle_time) m FROM battles").fetchone()
            return (row["m"] if row else "") or ""
        finally:
            con.close()
    except Exception:
        return ""


def anchor_frontier(entries=None) -> str:
    """The newest anchor in the frozen log.

    REPORTED, BUT NOT THE BASELINE. Comparing the global frontier against this
    gave a FALSE READY: the newest anchor (20260819T181204Z) belongs to one
    player while the global frontier (20260819T181548Z) belongs to another, so
    "global > max anchor" was already true at freeze time and said nothing about
    whether any player had played again. Reconciliation returned zero and
    contradicted it, which is how the bug surfaced.
    """
    try:
        from . import shadow
        rows = shadow.load() if entries is None else entries
        anchors = [r.get("anchorTs") or "" for r in rows]
        anchors = [a for a in anchors if a]
        return max(anchors) if anchors else ""
    except Exception:
        return ""


def readiness(entries=None, baseline: str = "") -> dict:
    """Is there any point running reconciliation yet?

    THE BASELINE IS THE FRONTIER AT FREEZE TIME, not the newest anchor. A future
    battle must land after the frontier as it stood when the observations were
    taken; until the frontier moves past that, no battle exists anywhere that
    could be anyone's outcome. This is necessary, not sufficient — the frontier
    can advance for players outside the experiment — but it is the correct cheap
    negative test, and a cheap test only has to be right about when to STOP.
    """
    current = current_frontier()
    base = baseline or FROZEN_FRONTIER
    ready = bool(current and current > base)
    return {
        "currentFrontier": current,
        "baseline": base,
        "anchorFrontier": anchor_frontier(entries),
        "ready": ready,
        # Row count is deliberately absent: it grew by 43,698 while producing
        # zero outcomes, so reporting it here would only invite the same
        # mistake again.
        "reason": ("frontier advanced past the freeze point" if ready else
                   "no database" if not current else
                   "frontier has not advanced since the observations were frozen"),
    }


def readiness_report(r: dict) -> str:
    o = ["FRONTIER WATCH",
         "  baseline (freeze point)  %s" % (r["baseline"] or "-"),
         "  current battle frontier  %s" % (r["currentFrontier"] or "-"),
         "  newest anchor in log     %s  (reported, not the test)"
         % (r["anchorFrontier"] or "-"),
         "  STATUS                   %s" % ("READY - reconcile now"
                                            if r["ready"] else "NOT READY"),
         "  reason                   %s" % r["reason"]]
    return "\n".join(o)
