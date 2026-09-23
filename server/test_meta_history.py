"""test_meta_history.py — the four ways a trend can lie.

    python server/test_meta_history.py

Writes its OWN temp SQLite file (like test_duo_pairs.py does) and never opens
the real one; the module's path is an env var for exactly this reason.
"""

from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_TMP = tempfile.mkdtemp(prefix="metahist-")
os.environ["CLASH_META_HISTORY_DB"] = os.path.join(_TMP, "t.db")

import meta_history as mh  # noqa: E402

PASS = 0
FAIL = 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


def board(*decks, building=False):
    """`decks` as (hash, rank, useRate, name) — the fields movement reads."""
    return {
        "building": building,
        "decks": [
            {"deckHash": h, "rank": r, "useRate": u, "winRate": 50.0,
             "players": 100, "battles": 1000, "name": n, "winCondition": "hog"}
            for (h, r, u, n) in decks
        ],
    }


def reset():
    p = os.environ["CLASH_META_HISTORY_DB"]
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(p + suffix)
        except OSError:
            pass


print("\nno baseline is not zero movement")
reset()
mh.snapshot(board(("a", 1, 10.0, "Hog"), ("b", 2, 8.0, "Golem")), day="2026-09-01")
m = mh.movement(7)
check("one snapshot answers basis 'none'", m["basis"] == "none", m)
check("and returns NO rows rather than a list of zeros", m["rows"] == [], m["rows"])
check("it says why", bool(m["reason"]), m)
check("an empty history also answers 'none', not an error",
      (reset() or mh.movement(7))["basis"] == "none")

print("\na day is a day, however often the board recomputes")
reset()
mh.snapshot(board(("a", 1, 10.0, "Hog")), day="2026-09-01")
mh.snapshot(board(("a", 4, 4.0, "Hog")), day="2026-09-01")  # same day, later refresh
mh.snapshot(board(("a", 2, 9.0, "Hog")), day="2026-09-08")
m = mh.movement(7)
check("re-running a day REPLACES it", mh.days_stored() == 2, mh.days_stored())
check("so the comparison uses the last reading of that day",
      m["rows"][0]["previousRank"] == 4, m["rows"][0])

print("\na deck that was not on the board did not move")
reset()
mh.snapshot(board(("a", 1, 10.0, "Hog")), day="2026-09-01")
mh.snapshot(board(("a", 2, 9.0, "Hog"), ("new", 1, 12.0, "Mortar")), day="2026-09-08")
m = mh.movement(7)
byh = {r["deckHash"]: r for r in m["rows"]}
check("an entrant is flagged, not credited with a climb",
      byh["new"]["entered"] is True and byh["new"]["rankDelta"] is None, byh["new"])
check("it carries no invented previous rank", byh["new"]["previousRank"] is None)
check("a deck present in both gets a real delta",
      byh["a"]["rankDelta"] == -1 and byh["a"]["entered"] is False, byh["a"])
check("the sign says DOWN the board is negative",
      byh["a"]["rank"] == 2 and byh["a"]["previousRank"] == 1 and byh["a"]["rankDelta"] < 0)

print("\na deck that left is not a deck that fell to zero")
reset()
mh.snapshot(board(("a", 1, 10.0, "Hog"), ("gone", 2, 8.0, "Lava")), day="2026-09-01")
mh.snapshot(board(("a", 1, 10.0, "Hog")), day="2026-09-08")
m = mh.movement(7)
byh = {r["deckHash"]: r for r in m["rows"]}
check("the departure is reported", "gone" in byh and byh["gone"]["left"] is True)
check("with no current use rate invented", byh["gone"]["useRate"] is None, byh["gone"])
check("and no rank delta", byh["gone"]["rankDelta"] is None)

print("\na missed timer widens the span and SAYS SO")
reset()
mh.snapshot(board(("a", 5, 5.0, "Hog")), day="2026-09-01")
mh.snapshot(board(("a", 1, 9.0, "Hog")), day="2026-09-12")
m = mh.movement(7)  # asked for 7; nearest baseline is 11 days back
check("it compares against the newest snapshot AT OR BEFORE the target",
      m["comparedWith"] == "2026-09-01", m["comparedWith"])
check("and reports the REAL span, not the requested one",
      m["daysApart"] == 11 and m["requestedDays"] == 7, (m["daysApart"], m["requestedDays"]))
check("the latest day is named too", m["latest"] == "2026-09-12")

print("\na board that is not a reading is not stored")
reset()
r1 = mh.snapshot({"building": True, "decks": []})
r2 = mh.snapshot({"building": False, "decks": []})
r3 = mh.snapshot({"building": True, "decks": [{"deckHash": "a", "rank": 1, "useRate": 1.0,
                                               "winRate": 50.0, "players": 1, "battles": 1,
                                               "name": "x", "winCondition": None}]})
check("a building board is skipped", r1["stored"] == 0 and r1["skipped"] == "building", r1)
check("an empty board is skipped", r2["stored"] == 0 and r2["skipped"] == "empty", r2)
check("building wins even when decks are present", r3["stored"] == 0, r3)
check("so nothing was written", mh.days_stored() == 0, mh.days_stored())

print("\nordering and shape")
reset()
mh.snapshot(board(("up", 10, 2.0, "Up"), ("down", 1, 9.0, "Down"), ("flat", 5, 5.0, "Flat")),
            day="2026-09-01")
mh.snapshot(board(("up", 2, 7.0, "Up"), ("down", 9, 2.0, "Down"), ("flat", 5, 5.0, "Flat"),
                  ("new", 12, 1.0, "New")), day="2026-09-08")
m = mh.movement(7)
check("biggest climb first", m["rows"][0]["deckHash"] == "up", [r["deckHash"] for r in m["rows"]])
check("entrants sort after everything with a delta",
      m["rows"][-1]["deckHash"] == "new", [r["deckHash"] for r in m["rows"]])
check("a flat deck reports 0, which is a measurement",
      next(r for r in m["rows"] if r["deckHash"] == "flat")["rankDelta"] == 0)
check("use rate delta is carried too",
      abs(next(r for r in m["rows"] if r["deckHash"] == "up")["useDelta"] - 5.0) < 1e-9)
check("basis is measured once there are two days", m["basis"] == "measured")

print("\nbounds")
reset()
mh.snapshot(board(("a", 1, 1.0, "Hog")), day="2026-09-08")
mh.snapshot(board(("a", 1, 1.0, "Hog")), day="2026-09-01")
check("days is clamped low", mh.movement(0)["requestedDays"] == 1, mh.movement(0)["requestedDays"])
check("days is clamped high", mh.movement(99999)["requestedDays"] == mh.RETAIN_DAYS)
check("status reports the span", mh.status()["days"] == 2 and mh.status()["newest"] == "2026-09-08",
      mh.status())

print("\nretention prunes, and is bounded")
reset()
mh.snapshot(board(("a", 1, 1.0, "Hog")), day="2024-01-01")
mh.snapshot(board(("a", 1, 1.0, "Hog")), day="2026-09-08")
check("a day older than RETAIN_DAYS is dropped on the next write",
      mh.days_stored() == 1, mh.days_stored())

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
