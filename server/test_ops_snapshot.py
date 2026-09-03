"""test_ops_snapshot.py — the admin console's operational metrics.

    python server/test_ops_snapshot.py

Plain asserts and a counter, matching the other suites here. A real SQLite file
IS opened, but it is a temporary one this module writes — the same arrangement
`test_recent_battles.py` uses, and for the same reason: every figure here is the
result of a pragma or an aggregate over real rows, and neither can be tested
against a hand-built list.

WHAT IS WORTH TESTING, which is the half that is quietly wrong rather than
broken:

  * `freeBytes` must be counted, because it is the whole reason this exists.
    A file whose size has not moved for two days is either a dead collector or a
    healthy one writing into reclaimed pages, and those two look identical until
    something reports the freelist;
  * `liveBytes + freeBytes` must equal the page total, or the storage bar is
    drawing two slices that do not add up to the thing they are slicing;
  * the poll failure rate is a DELTA between two cumulative counters, so it must
    fall over gracefully when the bot restarts and the counters reset — a
    negative delta is not a negative failure rate, it is no answer;
  * the retention runway must be WITHHELD when the window is unknown, never
    guessed. This service is not told the bot's `CLASH_RETENTION_DAYS`, and a
    confident wrong number on the one screen that exists to be trusted is worse
    than an absent one;
  * every group degrades INDEPENDENTLY. A missing `bot_health` table must cost
    the poll figures and nothing else, because the console is read during an
    incident and that is exactly when a table might be missing.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


# --------------------------------------------------------------------------
# A database with KNOWN contents, so every figure below has an arithmetic
# answer rather than a plausible one.
# --------------------------------------------------------------------------

PAGE = 4096
N_BATTLES = 120
OLDEST = "20260601T000058.000Z"
NEWEST = "20260903T085236.000Z"


def build(path: str, *, with_health: bool = True, with_aggs: bool = True) -> None:
    con = sqlite3.connect(path)
    con.execute("PRAGMA page_size = %d" % PAGE)
    con.execute("VACUUM")
    con.executescript(
        """
        CREATE TABLE battles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_tag TEXT, battle_time TEXT, game_mode TEXT,
            opponent_tag TEXT, result TEXT);
        CREATE TABLE tracked_players (tag TEXT PRIMARY KEY, added_at TEXT);
        CREATE TABLE retention_meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE player_deck_agg (player_tag TEXT, deck_hash TEXT);
        CREATE TABLE player_stats_agg (player_tag TEXT PRIMARY KEY, battles INTEGER);
        """
    )
    if with_aggs:
        con.execute("CREATE TABLE pair_matchup_agg (deck_a TEXT, deck_b TEXT, games INTEGER)")
        # 40 of the 120 battles folded -> a coverage ratio with a known answer.
        con.execute("INSERT INTO player_stats_agg VALUES ('#A', 25)")
        con.execute("INSERT INTO player_stats_agg VALUES ('#B', 15)")
        con.execute("INSERT INTO pair_matchup_agg VALUES ('h1', 'h2', 30)")
        con.execute("INSERT INTO pair_matchup_agg VALUES ('h2', 'h3', 7)")

    # The span is pinned at both ends; the middle is filler so COUNT is known.
    con.execute("INSERT INTO battles (player_tag, battle_time) VALUES ('#A', ?)", (OLDEST,))
    for i in range(N_BATTLES - 2):
        con.execute(
            "INSERT INTO battles (player_tag, battle_time) VALUES ('#A', ?)",
            ("202607%02dT120000.000Z" % ((i % 28) + 1),),
        )
    con.execute("INSERT INTO battles (player_tag, battle_time) VALUES ('#A', ?)", (NEWEST,))
    for i in range(7):
        con.execute("INSERT INTO tracked_players VALUES (?, '2026-08-01')", ("#T%d" % i,))
    con.execute("INSERT INTO retention_meta VALUES ('cutoff', '20260903T085249.000Z')")
    con.execute("INSERT INTO retention_meta VALUES ('last_rebuild', '2026-07-23T18:40:30Z')")

    if with_health:
        con.execute(
            "CREATE TABLE bot_health (ts TEXT, tracked_players INTEGER, "
            "poll_time_ms INTEGER, api_requests INTEGER, failed_requests INTEGER, "
            "database_size INTEGER, memory_mb REAL)"
        )
        # Cumulative counters. The delta is 1000 requests / 25 failures = 2.5%.
        con.execute("INSERT INTO bot_health VALUES "
                    "('2026-09-03T06:53:32Z', 7, 400000, 120000, 775, 0, 0)")
        con.execute("INSERT INTO bot_health VALUES "
                    "('2026-09-03T08:53:24Z', 7, 484826, 121000, 800, 0, 0)")
    con.commit()
    con.close()


def load(path: str, retention: str | None = None):
    """Import a FRESH clash_data bound to `path`.

    Config is read at import time in this module, so a second test with a
    different database needs a genuinely fresh import — reusing the first one
    silently measures the first database.
    """
    for mod in ("clash_data",):
        sys.modules.pop(mod, None)
    os.environ["CLASH_DB_PATH"] = path
    os.environ["CLASH_ARCHIVE_DB_PATH"] = ""
    if retention is None:
        os.environ.pop("CLASH_RETENTION_DAYS", None)
    else:
        os.environ["CLASH_RETENTION_DAYS"] = retention
    import clash_data as cd  # noqa: PLC0415
    return cd


tmp = tempfile.mkdtemp(prefix="ops-test-")
db = os.path.join(tmp, "battles.db")
build(db)
cd = load(db)
snap = cd.ops_snapshot()

# --------------------------------------------------------------------------
print("\nstorage — where the bytes actually are")

st = snap["storage"]
check("storage group present", st is not None)
check("page size read", st["pageSize"] == PAGE, str(st["pageSize"]))
check("page count positive", st["pageCount"] > 0, str(st["pageCount"]))
check("free pages counted", st["freePages"] >= 0, str(st["freePages"]))
# THE LOAD-BEARING ONE. The console draws live and free as two slices of the
# page total; if they do not add up the bar is lying about its own width.
check(
    "live + free == page total",
    st["liveBytes"] + st["freeBytes"] == st["pageCount"] * st["pageSize"],
    f'{st["liveBytes"]} + {st["freeBytes"]} != {st["pageCount"] * st["pageSize"]}',
)
check("free bytes derive from page size",
      st["freeBytes"] == st["freePages"] * PAGE, str(st["freeBytes"]))
check("file bytes match the real file",
      st["fileBytes"] == os.path.getsize(db), str(st["fileBytes"]))

# --------------------------------------------------------------------------
print("\ncollection — is the bot still writing")

co = snap["collection"]
check("battles counted", co["battles"] == N_BATTLES, str(co["battles"]))
check("tracked players counted", co["trackedPlayers"] == 7, str(co["trackedPlayers"]))
# The compact stored form is not parseable by Date.parse, and the console feeds
# this straight to ago(). An unconverted stamp renders "Invalid Date" on the one
# figure whose whole job is to say how fresh the data is.
check("newest battle is ISO", co["newestBattle"] == "2026-09-03T08:52:36Z",
      str(co["newestBattle"]))
check("oldest battle is ISO", co["oldestBattle"] == "2026-06-01T00:00:58Z",
      str(co["oldestBattle"]))
check("last poll timestamp", co["lastPollAt"] == "2026-09-03T08:53:24Z",
      str(co["lastPollAt"]))
check("last poll duration", co["lastPollMs"] == 484826, str(co["lastPollMs"]))
# A DELTA, not the lifetime pair: 800-775 failures over 121000-120000 requests.
check("failure rate is the delta between polls",
      co["pollFailurePct"] == 2.5, str(co["pollFailurePct"]))

# --------------------------------------------------------------------------
print("\naggregates — how far the rollup has drifted")

ag = snap["aggregates"]
check("stats battles summed", ag["statsBattles"] == 40, str(ag["statsBattles"]))
check("pair games summed", ag["pairGames"] == 37, str(ag["pairGames"]))
# 40 folded of 120 live. The ratio is the drift, and it is the figure that made
# a 51.5% real-world gap visible at all.
check("coverage is agg over live", ag["coveragePct"] == 33.3, str(ag["coveragePct"]))
check("watermark converted to ISO", ag["watermark"] == "2026-09-03T08:52:49Z",
      str(ag["watermark"]))
check("last rebuild passed through", ag["lastRebuild"] == "2026-07-23T18:40:30Z",
      str(ag["lastRebuild"]))

# --------------------------------------------------------------------------
print("\nretention — withheld when the window is unknown")

# This service is NOT told the bot's window by default, and must not invent one.
check("no window configured -> days is None", snap["retention"]["days"] is None)
check("no window configured -> no boundary",
      snap["retention"]["boundary"] is None)
check("no window configured -> no runway",
      snap["retention"]["daysUntilFirstDelete"] is None)

cd2 = load(db, retention="304")
r2 = cd2.ops_snapshot()["retention"]
check("window configured -> days reported", r2["days"] == 304, str(r2["days"]))
check("window configured -> boundary computed", bool(r2["boundary"]), str(r2["boundary"]))
# The oldest row is 2026-06-01 and the boundary is 304 days back from today, so
# the runway is positive and large. Pinning the exact integer would pin the
# clock; what matters is that it is computed and forward-looking.
check("window configured -> runway is positive",
      isinstance(r2["daysUntilFirstDelete"], int) and r2["daysUntilFirstDelete"] > 0,
      str(r2["daysUntilFirstDelete"]))

# --------------------------------------------------------------------------
print("\ndegradation — one missing table costs one group, not the page")

tmp2 = tempfile.mkdtemp(prefix="ops-test-nohealth-")
db2 = os.path.join(tmp2, "battles.db")
build(db2, with_health=False, with_aggs=False)
cd3 = load(db2)
s3 = cd3.ops_snapshot()
check("no bot_health -> storage still reported", s3["storage"] is not None)
check("no bot_health -> battles still counted",
      s3["collection"]["battles"] == N_BATTLES, str(s3["collection"]["battles"]))
check("no bot_health -> poll figures are None",
      s3["collection"]["lastPollAt"] is None and s3["collection"]["lastPollMs"] is None)
check("no pair_matchup_agg -> pairGames is 0, not a crash",
      s3["aggregates"]["pairGames"] == 0, str(s3["aggregates"]["pairGames"]))
check("empty player_stats_agg -> coverage withheld",
      s3["aggregates"]["coveragePct"] is None, str(s3["aggregates"]["coveragePct"]))

# --------------------------------------------------------------------------
print("\nno database at all — the supported state, not an error")

cd4 = load(os.path.join(tmp, "does-not-exist.db"))
s4 = cd4.ops_snapshot()
check("absent database returns the shape",
      set(s4) == {"collection", "storage", "aggregates", "retention"}, str(list(s4)))
check("absent database reports all-null",
      all(v is None for v in s4.values()), str(s4))

# --------------------------------------------------------------------------
print("\n_iso — the conversion the console depends on")

check("_iso converts a real stamp", cd._iso("20260903T085236.000Z") == "2026-09-03T08:52:36Z")
check("_iso refuses None", cd._iso(None) is None)
check("_iso refuses a short string", cd._iso("2026") is None)
check("_iso refuses empty", cd._iso("") is None)

print(f"\n{PASS} passed, {FAIL} failed\n")
sys.exit(1 if FAIL else 0)
