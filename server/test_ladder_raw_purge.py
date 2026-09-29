"""test_ladder_raw_purge.py — the daily ladder raw window.

    python server/test_ladder_raw_purge.py

Own temp SQLite files; never opens the real database. Pins what may and may not
be deleted: only old, non-duel, non-2v2 raw whose battle is stored.
"""

from __future__ import annotations

import datetime
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_TMP = tempfile.mkdtemp(prefix="ladderraw-")
DB = os.path.join(_TMP, "battles.db")
os.environ.update(CLASH_DB_PATH=DB, CLASH_DATA_LEDGER=os.path.join(_TMP, "ledger.db"),
                  CLASH_LADDER_RAW_PURGE="off", CLASH_LADDER_RAW_HOURS="72")

import data_ledger as ledger    # noqa: E402
import ladder_raw_purge as lr   # noqa: E402

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


NOW = datetime.datetime.now(datetime.timezone.utc)
OLD = (NOW - datetime.timedelta(days=5)).isoformat()
NEW = (NOW - datetime.timedelta(hours=10)).isoformat()


def make(raw, battles_for_ladder=True):
    """raw: (tag, battle_time, game_mode, stored_at)."""
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(DB + suffix):
            os.remove(DB + suffix)
    con = sqlite3.connect(DB)
    con.executescript("""
        CREATE TABLE battles (id INTEGER PRIMARY KEY, player_tag TEXT, battle_time TEXT);
        CREATE INDEX idx_battles_tag ON battles(player_tag);
        CREATE INDEX idx_battles_time ON battles(battle_time);
        CREATE TABLE battle_raw (player_tag TEXT NOT NULL, battle_time TEXT NOT NULL,
                                 game_mode TEXT, schema_version INTEGER, stored_at TEXT,
                                 raw_json TEXT NOT NULL, PRIMARY KEY (player_tag, battle_time));
        CREATE INDEX ix_raw_stored ON battle_raw(stored_at);
    """)
    for tag, bt, mode, stored in raw:
        con.execute("INSERT INTO battle_raw VALUES (?,?,?,?,?,?)", (tag, bt, mode, 1, stored, "{}"))
        if battles_for_ladder and mode and "2v2" not in mode.lower() and "teamvsteam" not in mode.lower():
            con.execute("INSERT INTO battles (player_tag, battle_time) VALUES (?,?)", (tag, bt))
    con.commit()
    con.close()


def rows(where="1"):
    con = sqlite3.connect(DB)
    try:
        return con.execute("SELECT game_mode, stored_at FROM battle_raw WHERE " + where).fetchall()
    finally:
        con.close()


FIXTURE = [
    ("#A", "20260920T100000.000Z", "Ranked1v1_NewArena2", OLD),   # deletable
    ("#A", "20260920T110000.000Z", "Ladder", OLD),                # deletable
    ("#B", "20260920T120000.000Z", "Duel_1v1_Friendly", OLD),     # duel: never
    ("#B", "20260920T130000.000Z", None, OLD),                    # NULL mode: never
    ("#C", "20260920T140000.000Z", "TeamVsTeam", OLD),            # 2v2: the other job's
    ("#A", "20260929T100000.000Z", "Ladder", NEW),                # inside the window
]

print("plan")
make(FIXTURE)
p = lr.plan()
check("two rows are deletable", p["deletable"] == 2, p)
check("both sampled rows have their battle", p["sampleInBattles"] == p["sample"] == 2, p)
check("not refused", p["refused"] is None)

print("dry run")
out = lr.purge(confirm=True, log=lambda *a: None)
check("gate off -> dry run", out["status"] == "dry_run", out["status"])
check("a dry run deletes nothing", len(rows()) == 6)
check("the run is recorded", ledger.report()["runs"][0]["job"] == "ladder_raw")

print("purge")
lr.ENABLED = True
out = lr.purge(confirm=True, log=lambda *a: None)
check("deleted exactly the two old ladder rows", out["status"] == "ok" and out["deleted"] == 2, out)
left = sorted(str(m) for m, _ in rows())
check("duel, NULL-mode, 2v2 and recent ladder all remain",
      left == sorted(["Duel_1v1_Friendly", "None", "TeamVsTeam", "Ladder"]), left)
check("duel count unchanged and reported", out["duelBefore"] == out["duelAfter"] == 2, out)
check("purge without confirm is a dry run even when gated",
      lr.purge(confirm=False, log=lambda *a: None)["status"] in ("dry_run", "nothing_due"))
check("a second run has nothing due", lr.purge(confirm=True, log=lambda *a: None)["status"] == "nothing_due")

print("refusal")
make(FIXTURE, battles_for_ladder=False)
out = lr.purge(confirm=True, log=lambda *a: None)
check("rows without a stored battle -> refused, nothing deleted",
      out["status"] == "refused" and len(rows()) == 6, out)

print("window")
check("boundary is WINDOW_HOURS back, in stored_at's order",
      lr.boundary(datetime.datetime(2026, 9, 29, 12, tzinfo=datetime.timezone.utc)) == "2026-09-26T12:00:00")
check("2026-09-26T11:59:59.9+00:00 sorts before the boundary",
      "2026-09-26T11:59:59.900000+00:00" < "2026-09-26T12:00:00")
check("2026-09-26T12:00:00.1+00:00 does not",
      not ("2026-09-26T12:00:00.100000+00:00" < "2026-09-26T12:00:00"))

lr.ENABLED = False
print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
