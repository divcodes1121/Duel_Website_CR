"""test_coach_session_log.py — what each player was shown, so today can differ.

    python server/test_coach_session_log.py

Writes its own temp SQLite file; nothing here opens the real log or the bot's
database.
"""

from __future__ import annotations

import os
import sys
import tempfile

_TMP = tempfile.mkdtemp(prefix="sesslog-")
os.environ["CLASH_SESSION_LOG_DB"] = os.path.join(_TMP, "sessions.db")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coach_session as cs  # noqa: E402
import coach_session_log as slog  # noqa: E402

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


T = "#ABC001"

print("\nnothing remembered is a real, empty answer")
check("no file yet: no history", slog.recent(T, "2026-10-12") == [])
check("no file yet: the status says so and creates nothing",
      slog.status() == {"available": False, "rows": 0} and not os.path.exists(slog.DB_PATH))
check("an empty history avoids nothing", slog.avoid([], 3, 6) == ([], set()))

print("\na served deck is remembered, per day")
check("recording answers True", slog.record(T, "2026-10-10", "k-hog", "Hog Rider", "golem") is True)
slog.record(T, "2026-10-11", "k-mortar", "Mortar", "hog")
h = slog.recent(T, "2026-10-12")
check("newest first", [s["day"] for s in h] == ["2026-10-11", "2026-10-10"], h)
check("each session carries its win conditions and lists",
      h[0] == {"day": "2026-10-11", "families": {"Mortar"}, "keys": {"k-mortar"}}, h[0])
check("another player's sessions are not theirs", slog.recent("#ABC002", "2026-10-12") == [])
check("a deck with no key is not a session", slog.record(T, "2026-10-11", "", "Mortar") is False)

print("\na day never reads its own rows back")
slog.record(T, "2026-10-12", "k-gy", "Graveyard", "lava")
check("today's own pick is not history for today",
      [s["day"] for s in slog.recent(T, "2026-10-12")] == ["2026-10-11", "2026-10-10"])
check("asked twice in one day, the history is the same -- the deck is stable through the day",
      slog.recent(T, "2026-10-12") == slog.recent(T, "2026-10-12"))
check("it IS history for tomorrow",
      slog.recent(T, "2026-10-13")[0]["families"] == {"Graveyard"})

print("\nthe same list twice in a day is one row; two lists are both seen")
slog.record(T, "2026-10-12", "k-gy", "Graveyard", "lava")
slog.record(T, "2026-10-12", "k-xbow", "X-Bow", "golem")
s = slog.recent(T, "2026-10-13")[0]
check("both lists shown that day count as seen",
      s["families"] == {"Graveyard", "X-Bow"} and s["keys"] == {"k-gy", "k-xbow"}, s)
check("four rows in the file, not five", slog.status()["rows"] == 4, slog.status())
check("the status counts players and never names one",
      slog.status() == {"available": True, "rows": 4, "players": 1, "newest": "2026-10-12"},
      slog.status())

print("\nsessions, not calendar days")
P = "#ABC003"
for day, key, fam in (("2026-10-01", "a", "Hog Rider"), ("2026-10-04", "b", "Mortar"),
                      ("2026-10-07", "c", "Golem"), ("2026-10-10", "d", "Miner")):
    slog.record(P, day, key, fam)
h = slog.recent(P, "2026-10-13", sessions=6)
check("a player who opens the page every third day still has four sessions behind them",
      [s["day"] for s in h] == ["2026-10-10", "2026-10-07", "2026-10-04", "2026-10-01"], h)
fams, keys = slog.avoid(h, cs.AVOID_FAMILY_SESSIONS, cs.AVOID_DECK_SESSIONS)
check("the last AVOID_FAMILY_SESSIONS win conditions, newest first, one set a session",
      fams == [{"Miner"}, {"Golem"}, {"Mortar"}], fams)
check("the lists of every session read", keys == {"a", "b", "c", "d"}, keys)
check("`sessions` caps how many are read",
      [s["day"] for s in slog.recent(P, "2026-10-13", sessions=2)] == ["2026-10-10", "2026-10-07"])
check("a session past LOOKBACK_DAYS is forgotten",
      [s["day"] for s in slog.recent(P, "2026-10-20")] == ["2026-10-10", "2026-10-07"])
check("a past day sees only what came before it",
      [s["day"] for s in slog.recent(P, "2026-10-07")] == ["2026-10-04", "2026-10-01"])

print("\nthe log and the picker together")


def row(key, arch, vs, field=56.0):
    return {"key": key, "expectedWinRate": field, "archetype": arch, "_vs": vs,
            "affinity": {"familiar": True, "knowsCards": True}}


POOL = [row("hog", "Hog Rider", 70.0), row("mortar", "Mortar", 66.0),
        row("golem", "Golem", 64.0), row("miner", "Miner", 62.0), row("gy", "Graveyard", 60.0)]
rate = lambda r: {"winRate": r["_vs"], "games": 60, "source": "deck"}
Q = "#ABC004"
shown = []
for i in range(10):
    day = "2026-10-%02d" % (i + 1)
    f, k = slog.avoid(slog.recent(Q, day, sessions=cs.AVOID_DECK_SESSIONS),
                      cs.AVOID_FAMILY_SESSIONS, cs.AVOID_DECK_SESSIONS)
    again = cs.practise(POOL, rate, avoid_families=f, avoid_keys=k)
    got = cs.practise(POOL, rate, avoid_families=f, avoid_keys=k)
    assert again["row"]["key"] == got["row"]["key"]
    slog.record(Q, day, got["row"]["key"], got["family"])
    shown.append(got["family"])
check("ten days through the real log: no win condition two days running",
      all(a != b for a, b in zip(shown, shown[1:])), shown)
check("and four different win conditions in any four days",
      all(len(set(shown[i:i + 4])) == 4 for i in range(len(shown) - 3)), shown)
check("the best counter leads on the first day", shown[0] == "Hog Rider", shown)

print("\na broken log costs the memory, never the plan")
real = slog.DB_PATH
slog.DB_PATH = os.path.join(_TMP, "no-such-dir", "x.db")
check("an unreadable log is an empty history", slog.recent(T, "2026-10-13") == [])
check("an unwritable log is a dropped write", slog.record(T, "2026-10-13", "k", "Hog") is False)
check("and an unavailable status", slog.status() == {"available": False, "rows": 0})
slog.DB_PATH = real

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
