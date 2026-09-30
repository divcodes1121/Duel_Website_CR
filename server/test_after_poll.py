"""test_after_poll.py — updating right after a poll, and duels split across polls.

    python server/test_after_poll.py

Literals and a temp SQLite; nothing real is read or written.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import after_poll as ap  # noqa: E402
import duel_combos as dc  # noqa: E402
import duel_model_train as tr  # noqa: E402

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


def iso(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).isoformat()


NOW = 1_790_000_000.0
print("\nwhen to run")
check("nothing stored since the last run: quiet", ap.decide(iso(NOW - 3600), iso(NOW - 3600), NOW) == "quiet")
check("new data still arriving (a poll in progress): wait", ap.decide(iso(NOW - 60), iso(NOW - 3600), NOW) == "polling")
check("new data and five quiet minutes (the poll finished): run", ap.decide(iso(NOW - 301), iso(NOW - 3600), NOW) == "run")
check("first ever run: runs once the poll is quiet", ap.decide(iso(NOW - 900), None, NOW) == "run")
check("an empty table: quiet", ap.decide(None, None, NOW) == "quiet")


print("\na friendly duel split across two polls is one duel once both halves are stored")
def game(minute, result, cards, opp):
    t = dt.datetime(2026, 9, 30, 12, minute, 0)
    return {"battle_time": t.strftime("%Y%m%dT%H%M%S.000Z"), "result": result,
            "cards": cards, "opp_cards": opp, "opponent_tag": "#OPP"}


D = [[f"a{i}" for i in range(8)], [f"b{i}" for i in range(8)], [f"c{i}" for i in range(8)]]
O = [[f"x{i}" for i in range(8)], [f"y{i}" for i in range(8)], [f"z{i}" for i in range(8)]]
g1, g2, g3 = game(0, "win", D[0], O[0]), game(6, "loss", D[1], O[1]), game(12, "win", D[2], O[2])
after_poll_a = dc.split_chunk([g1, g2])
check("after poll A (1-1, game 3 not yet stored): not shown as a finished duel",
      after_poll_a == [], after_poll_a)
after_poll_b = dc.split_chunk([g1, g2, g3])
check("after poll B brings game 3: one best-of-3, 2-1",
      len(after_poll_b) == 1 and len(after_poll_b[0]) == 3, after_poll_b)
check("a 2-0 is already a finished duel after poll A",
      len(dc.split_chunk([game(0, "win", D[0], O[0]), game(6, "win", D[1], O[1])])) == 1)
late = game(59, "win", D[2], O[2])
check("a game 47 minutes later is a new session, never glued on",
      dc.split_chunk([g1, g2, late]) == [], dc.split_chunk([g1, g2, late]))


print("\nthe model reads only what was stored since its last run")
tmp = tempfile.mkdtemp()
db = os.path.join(tmp, "b.db")
con = sqlite3.connect(db)
con.execute("CREATE TABLE battle_raw(player_tag TEXT, battle_time TEXT, game_mode TEXT, "
            "schema_version INT, stored_at TEXT, raw_json TEXT)")
cards = json.load(open(os.path.join(tr.ROOT, "src", "data", "cards.json"), encoding="utf-8"))
ids = [c["id"] for c in cards[:24]]


def payload(bt, tag_a, tag_b, win_a):
    rounds = lambda off, w: [{"crowns": 1 if w else 0,
                              "cards": [{"id": i, "level": 14, "maxLevel": 14} for i in ids[off:off + 8]]}]
    return json.dumps({"battleTime": bt,
                       "team": [{"tag": tag_a, "rounds": rounds(0, win_a)}],
                       "opponent": [{"tag": tag_b, "rounds": rounds(8, not win_a)}]})


rows = [("#A", "20260930T100000.000Z", "CW_Duel_1v1", 1, "2026-09-30T10:10:00+00:00", payload("20260930T100000.000Z", "#A", "#B", True)),
        # the same duel stored again from the opponent's log, in the NEXT poll
        ("#B", "20260930T100000.000Z", "CW_Duel_1v1", 1, "2026-09-30T14:10:00+00:00", payload("20260930T100000.000Z", "#B", "#A", False)),
        ("#C", "20260930T130000.000Z", "CW_Duel_1v1", 1, "2026-09-30T14:11:00+00:00", payload("20260930T130000.000Z", "#C", "#D", False)),
        ("#E", "20260930T130500.000Z", "Ranked1v1_NewArena2", 1, "2026-09-30T14:12:00+00:00", payload("20260930T130500.000Z", "#E", "#F", True))]
con.executemany("INSERT INTO battle_raw VALUES (?,?,?,?,?,?)", rows[:1])
con.commit()
g_a, seen_a, wm_a = tr.read_games(db)
check("poll A: one duel game read", len(g_a) == 1 and wm_a == "2026-09-30T10:10:00+00:00", (len(g_a), wm_a))
con.executemany("INSERT INTO battle_raw VALUES (?,?,?,?,?,?)", rows[1:])
con.commit()
g_b, seen_b, wm_b = tr.read_games(db, since=wm_a, seen=seen_a)
check("poll B: only what was stored since, and the duel seen from the other side is not counted twice",
      len(g_b) == 1 and g_b[0][2] == "#C", g_b)
check("ladder payloads are skipped, but the watermark still moves past them",
      wm_b == "2026-09-30T14:12:00+00:00", wm_b)
g_c, _s, wm_c = tr.read_games(db, since=wm_b, seen=seen_b)
check("nothing new: nothing read, watermark unchanged", g_c == [] and wm_c == wm_b)
con.close()

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
