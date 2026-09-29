"""test_data_lifecycle.py — the rolling retention job, the backup job, the ledger.

    python server/test_data_lifecycle.py

Writes its OWN temp SQLite files (a fake bot database and a fake ledger) and
never opens the real ones; every path is an env var for exactly this reason.

What it pins, because each one is a way retention could delete the wrong data:
  * only battle-days strictly older than the window are due, oldest first;
  * at most MAX_DAYS_PER_RUN a run, so shortening the window drains gently;
  * a window under MIN_RETENTION_DAYS is refused outright;
  * a day the aggregation watermark has not passed is refused;
  * a dry run deletes nothing;
  * a deleted day takes exactly that day's battles / timeline / raw, and the
    ledger's counts (players, players with nothing newer) are right;
  * 2v2 raw is never deleted without the fold cursor;
  * a backup keeps only the newest verified copy and a wrong hash cannot mark
    it as pulled.
"""

from __future__ import annotations

import datetime
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_TMP = tempfile.mkdtemp(prefix="lifecycle-")
DB = os.path.join(_TMP, "battles.db")
os.environ.update(
    CLASH_DB_PATH=DB,
    CLASH_DATA_LEDGER=os.path.join(_TMP, "ledger.db"),
    CLASH_RETENTION_DAYS="304",
    CLASH_RETENTION_MAX_DAYS="3",
    CLASH_RETENTION_PURGE="off",
    CLASH_BOT_ENV=os.path.join(_TMP, "bot.env"),
    CLASH_BACKUP_DIR=os.path.join(_TMP, "backups"),
    CLASH_BACKUP_HEADROOM_BYTES="0",
    CLASH_BOT_DIR=os.path.join(_TMP, "nobot"),
)

import data_ledger as ledger   # noqa: E402
import retention as ret        # noqa: E402

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


TODAY = datetime.date(2027, 4, 5)
D = datetime.date


def st(day, hh=12):
    return day.strftime("%Y%m%dT") + "%02d0000.000Z" % hh


def make_db(rows, raw=(), timeline=(), watermark=None):
    """rows: (tag, day). raw: (tag, day, mode). timeline: (tag, day)."""
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(DB + suffix):
            os.remove(DB + suffix)
    con = sqlite3.connect(DB)
    con.executescript("""
        CREATE TABLE battles (id INTEGER PRIMARY KEY AUTOINCREMENT, player_tag TEXT,
                              battle_time TEXT, game_mode TEXT);
        CREATE INDEX idx_battles_tag ON battles(player_tag);
        CREATE INDEX idx_battles_time ON battles(battle_time);
        CREATE TABLE duel_timeline (battle_time TEXT NOT NULL, player_tag TEXT NOT NULL,
                                    PRIMARY KEY (player_tag, battle_time));
        CREATE TABLE battle_raw (player_tag TEXT NOT NULL, battle_time TEXT NOT NULL,
                                 game_mode TEXT, stored_at TEXT, raw_json TEXT NOT NULL,
                                 PRIMARY KEY (player_tag, battle_time));
        CREATE TABLE retention_meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE tracked_players (tag TEXT);
    """)
    for i, (tag, day) in enumerate(rows):
        con.execute("INSERT INTO battles (player_tag, battle_time, game_mode) VALUES (?,?,?)",
                    (tag, st(day, i % 24), "Ladder"))
    for i, (tag, day, mode) in enumerate(raw):
        con.execute("INSERT INTO battle_raw VALUES (?,?,?,?,?)",
                    (tag, st(day, i % 24), mode, "2026-01-01T00:00:00", "{}"))
    for i, (tag, day) in enumerate(timeline):
        con.execute("INSERT INTO duel_timeline VALUES (?,?)", (st(day, i % 24), tag))
    con.execute("INSERT INTO retention_meta VALUES ('cutoff', ?)",
                (watermark or st(TODAY, 0),))
    con.commit()
    con.close()


def count(sql, *a):
    con = sqlite3.connect(DB)
    try:
        return con.execute(sql, a).fetchone()[0]
    finally:
        con.close()


def reset_ledger():
    ledger._ready = False
    p = os.environ["CLASH_DATA_LEDGER"]
    if os.path.exists(p):
        os.remove(p)


# ── the boundary ─────────────────────────────────────────────────────────────
print("boundary")
check("304 days before 2027-04-05 is 2026-06-05", ret.boundary(TODAY) == D(2026, 6, 5))
check("the 12-month window is one setting", ret.boundary(TODAY, 365) == D(2026, 4, 5))
check("stamp is battle_time's own format", ret.stamp(D(2026, 6, 1)) == "20260601T000000.000Z")

# ── what is due ──────────────────────────────────────────────────────────────
print("plan")
days = [D(2026, 6, 1) + datetime.timedelta(days=i) for i in range(10)]
make_db([("#A", d) for d in days] + [("#B", days[0])])
p = ret.plan(today=TODAY)
check("oldest days first, capped at MAX_DAYS_PER_RUN",
      p["due"] == ["2026-06-01", "2026-06-02", "2026-06-03"], p["due"])
check("backlog counts every due day, not just this run's", p["backlogDays"] == 4, p)
check("the kept boundary day itself is never due", "2026-06-05" not in p["due"])
check("first deletion date = oldest day + window + 1", p["firstDeletion"] == "2027-04-02", p)
p2 = ret.plan(today=D(2027, 4, 1))
check("the day before the first deletion, nothing is due", p2["due"] == [], p2)

make_db([("#A", d) for d in days], watermark=st(D(2026, 6, 2), 0))
check("refused when a due day is not wholly behind the watermark",
      ret.plan(today=TODAY)["refused"] == "behind_watermark")

make_db([("#A", d) for d in days])
saved = ret.RETENTION_DAYS
ret.RETENTION_DAYS = 30
check("a window under the minimum is refused", ret.plan(today=TODAY)["refused"] == "retention_below_minimum")
ret.RETENTION_DAYS = saved

# ── dry run ─────────────────────────────────────────────────────────────────
print("dry run")
reset_ledger()
make_db([("#A", d) for d in days])
_real_today = ret._today
ret._today = lambda: TODAY
out = ret.run(log=lambda *a: None)
check("gate off -> dry_run", out["status"] == "dry_run", out["status"])
check("a dry run deletes nothing", count("SELECT COUNT(*) FROM battles") == 10)
check("a dry run still records a snapshot", ledger.report()["latest"] is not None)
check("... and a run", ledger.report()["runs"][0]["status"] == "dry_run")

# ── deleting a day ───────────────────────────────────────────────────────────
print("delete")
reset_ledger()
rows = ([("#A", days[0])] * 3 + [("#B", days[0])] * 2 + [("#C", days[0])]
        + [("#A", days[6])] + [("#B", days[1])])
make_db(rows,
        raw=[("#A", days[0], "Ladder"), ("#B", days[0], "TeamVsTeam"), ("#A", days[6], "Ladder")],
        timeline=[("#A", days[0]), ("#A", days[6])])
ret.ENABLED = True
ret._duo_cursor = lambda: ""           # no fold cursor: 2v2 raw must survive
out = ret.run(log=lambda *a: None)
first = out["deleted"][0]
check("run deletes when gated on", out["status"] == "ok", out["status"])
check("day 1: 6 battles", first["battles"] == 6, first)
check("day 1: 3 distinct players", first["tags"] == 3, first)
check("day 1: only #C has nothing newer stored",
      first["tags_gone"] == 1, first)
check("day 1: its timeline row", first["duel_timeline"] == 1, first)
check("day 1: its ladder raw, NOT its 2v2 raw without a cursor", first["raw"] == 1, first)
check("the 2v2 payload is still there",
      count("SELECT COUNT(*) FROM battle_raw WHERE game_mode = 'TeamVsTeam'") == 1)
check("battles after the boundary are untouched",
      count("SELECT COUNT(*) FROM battles WHERE battle_time >= ?", ret.stamp(D(2026, 6, 5))) == 1)
check("day 2 was also due and went", count("SELECT COUNT(*) FROM battles") == 1)
check("an empty due day is not recorded", len(ledger.report()["purges"]) == 2,
      len(ledger.report()["purges"]))
check("totals add up", ledger.report()["totals"]["battlesPurged"] == 7,
      ledger.report()["totals"])

ret._duo_cursor = lambda: "2027-01-01T00:00:00Z"
make_db([("#B", days[0])], raw=[("#B", days[0], "TeamVsTeam")])
reset_ledger()
ret.run(log=lambda *a: None)
check("with the cursor past the day, its 2v2 raw goes too",
      count("SELECT COUNT(*) FROM battle_raw") == 0)

# ── the ledger adds a part-deleted day instead of overwriting it ──────────────
print("ledger")
reset_ledger()
ledger.add_purge("2026-06-01", battles=10, duel_timeline=0, raw=0, tags=4, tags_gone=1,
                 seconds=1, retention_days=304, complete=False)
ledger.add_purge("2026-06-01", battles=5, duel_timeline=0, raw=0, tags=4, tags_gone=1,
                 seconds=1, retention_days=304, complete=True)
row = ledger.report()["purges"][0]
check("a day split across runs adds its counts", row["battles"] == 15, row)
check("... and ends complete", row["complete"] == 1)

make_db([("#A", days[0])] * 4)
ret.snapshot(today=D(2027, 4, 1))
s1 = ledger.report(days=400)["latest"]
check("first snapshot has no baseline, so inserted is unknown, not 0", s1["inserted"] is None, s1)
con = sqlite3.connect(DB)
con.executemany("INSERT INTO battles (player_tag, battle_time) VALUES (?,?)", [("#Z", st(days[3]))] * 7)
con.commit(); con.close()
ret.snapshot(today=D(2027, 4, 2))
s2 = ledger.report(days=400)["latest"]
check("next day's inserted = new rows since the last reading", s2["inserted"] == 7, s2)
check("forecast starts at the oldest stored day", s2["forecast"][0][0] == "2026-06-01", s2["forecast"][:2])
check("by-month histogram", s2["by_month"] == {"2026-06": 11}, s2["by_month"])
check("raw rows are counted apart from battles", s2["raw_rows"] == 0, s2["raw_rows"])

# ── bot settings ─────────────────────────────────────────────────────────────
with open(os.environ["CLASH_BOT_ENV"], "w") as f:
    f.write("CLASH_RETENTION_DAYS = 304\nCLASH_RETENTION_EXTERNAL = on\n# x = y\n")
b = ret.bot_settings()
check("reads the bot's `KEY = value` env", b == {"retentionDays": 304, "external": True}, b)

ret._today = _real_today
ret.ENABLED = False

# ── backup ──────────────────────────────────────────────────────────────────
print("backup")
import time                     # noqa: E402

import db_backup as bk          # noqa: E402

bk.EXTRA_FILES, bk.EXTRA_DBS = [], []
make_db([("#A", days[0])] * 50)
r1 = bk.run(full=True, log=lambda *a: None)
check("a backup verifies its snapshot", r1["status"] == "ok" and r1["check"] == "ok", r1)
check("counts are recorded", r1["counts"]["battles"] == 50, r1["counts"])
time.sleep(61)                   # names are per minute
r2 = bk.run(log=lambda *a: None)
files = sorted(os.listdir(os.environ["CLASH_BACKUP_DIR"]))
check("only the newest verified copy stays on the box",
      files == sorted([r2["name"] + ".db.zst", r2["name"] + ".json", r2["extras"]]), files)
check("the older one is marked deleted",
      [x["status"] for x in ledger.backups()] == ["verified", "deleted"])
check("a wrong hash cannot mark a backup pulled",
      bk.mark_pulled(r2["name"], "0" * 64)["ok"] is False)
check("the right hash can", bk.mark_pulled(r2["name"], r2["sha256"], "pc")["ok"] is True)
check("pulled_at recorded", ledger.get_backup(r2["name"])["pulled_at"] is not None)
if os.access(bk.DBSTREAM, os.X_OK):
    import subprocess           # noqa: E402
    time.sleep(61)
    r3 = bk.run(log=lambda *a: None)
    check("with dbstream built, the default mode is stream", r3.get("mode") == "stream", r3.get("mode"))
    check("the stream's check ran in its own transaction", r3["check"] == "ok", r3)
    restored = os.path.join(_TMP, "restored.db")
    subprocess.run(["zstd", "-q", "-d", "-f",
                    os.path.join(os.environ["CLASH_BACKUP_DIR"], r3["db"]), "-o", restored], check=True)
    rc = sqlite3.connect(restored)
    check("a streamed backup decompresses to a database that passes integrity_check",
          rc.execute("PRAGMA integrity_check").fetchone()[0] == "ok")
    check("... holding every battle", rc.execute("SELECT COUNT(*) FROM battles").fetchone()[0] == 50)
    rc.close()
else:
    print("  (stream mode not tested here: tools/dbstream is not built on this machine)")
bk.HEADROOM = 10 ** 18
check("refuses when the disk cannot hold the snapshot", bk.run(log=lambda *a: None)["status"] == "refused")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
