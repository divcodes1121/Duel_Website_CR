"""data_ledger.py — the one record of what the storage jobs did to the data.

Two jobs change what is stored, and both write here:

  * `retention.py` — deletes battles once they are older than the retention
    window, ONE BATTLE-DAY AT A TIME, and records every day it removes;
  * `db_backup.py` — takes a verified, compressed copy of the bot's database
    and records it, including when a machine off the VPS confirmed it has it.

Plus one `snapshot` row a day: how big the database is, how many battles came
in, how old the oldest one is, and what is due to expire next. The admin
console's "Data lifecycle" view is drawn entirely from these tables, so it
never has to scan the 57 GB file on a request.

WHY ITS OWN FILE (`server/.data_ledger.db`, gitignored), the same reasoning as
`.meta_history.db` and `.duo_pairs.db`: the record of a deletion must not live
inside the database it deletes from, and the bot's database is opened
read-write by exactly two jobs in this repository — this ledger is not a reason
to add a third handle.

Nothing here reads the bot's database. It only stores what the jobs tell it.
"""

from __future__ import annotations

import contextlib
import datetime
import json
import os
import sqlite3

PATH = os.getenv(
    "CLASH_DATA_LEDGER",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".data_ledger.db"),
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS purge_day (
    day            TEXT PRIMARY KEY,   -- the battle day removed, YYYY-MM-DD
    run_date       TEXT NOT NULL,      -- the UTC date the deletion ran
    finished_at    TEXT NOT NULL,
    battles        INTEGER NOT NULL,
    duel_timeline  INTEGER NOT NULL,
    raw            INTEGER NOT NULL,
    tags           INTEGER NOT NULL,   -- distinct players who lost that day
    tags_gone      INTEGER NOT NULL,   -- ... of whom nothing newer is stored
    seconds        REAL NOT NULL,
    retention_days INTEGER NOT NULL,
    complete       INTEGER NOT NULL    -- 0 while a day is part-deleted
);
CREATE TABLE IF NOT EXISTS snapshot (
    date            TEXT PRIMARY KEY,  -- UTC date the reading was taken
    taken_at        TEXT NOT NULL,
    battles_total   INTEGER,
    max_id          INTEGER,
    inserted        INTEGER,           -- battles written since the previous reading
    file_bytes      INTEGER,
    page_size       INTEGER,
    page_count      INTEGER,
    freelist_pages  INTEGER,
    oldest_battle   TEXT,
    newest_battle   TEXT,
    tracked_players INTEGER,
    retention_days  INTEGER,
    watermark       TEXT,
    next_purge_day  TEXT,
    disk_total      INTEGER,
    disk_free       INTEGER,
    raw_rows        INTEGER,           -- battle_raw rows (index count)
    raw_bytes       INTEGER,           -- ESTIMATE: rows x mean payload of the newest 2,000
    by_month        TEXT,              -- JSON {YYYY-MM: battles}
    forecast        TEXT               -- JSON [[YYYY-MM-DD, battles]] due to expire
);
CREATE TABLE IF NOT EXISTS run (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job         TEXT NOT NULL,         -- 'retention' | 'backup'
    started_at  TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    status      TEXT NOT NULL,         -- ok | dry_run | refused | error | nothing_due
    detail      TEXT                   -- JSON
);
CREATE TABLE IF NOT EXISTS backup (
    name          TEXT PRIMARY KEY,    -- battles-YYYYMMDDTHHMMZ
    created_at    TEXT NOT NULL,
    finished_at   TEXT,
    db_bytes      INTEGER,
    zst_bytes     INTEGER,
    sha256        TEXT,
    extras_bytes  INTEGER,
    extras_sha256 TEXT,
    mode          TEXT,                -- stream (dbstream | zstd) | copy (backup API temp file)
    check_kind    TEXT,                -- integrity | quick
    check_result  TEXT,
    counts        TEXT,                -- JSON
    status        TEXT NOT NULL,       -- running | verified | failed | deleted
    pulled_at     TEXT,                -- when an off-box copy was confirmed
    pulled_host   TEXT,
    deleted_at    TEXT
);
"""

_ready = False


def now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect() -> sqlite3.Connection:
    global _ready
    con = sqlite3.connect(PATH, timeout=30.0)
    con.row_factory = sqlite3.Row
    if not _ready:
        con.executescript(_SCHEMA)
        # `CREATE TABLE IF NOT EXISTS` does nothing to a table that already
        # exists, so a column added later has to be added here too.
        have = {r[1] for r in con.execute("PRAGMA table_info(snapshot)")}
        for col in ("raw_rows", "raw_bytes"):
            if col not in have:
                con.execute("ALTER TABLE snapshot ADD COLUMN %s INTEGER" % col)
        if "mode" not in {r[1] for r in con.execute("PRAGMA table_info(backup)")}:
            con.execute("ALTER TABLE backup ADD COLUMN mode TEXT")
        con.commit()
        _ready = True
    return con


def record_run(job: str, started_at: str, status: str, detail: dict | None = None) -> None:
    with contextlib.closing(connect()) as con, con:
        con.execute(
            "INSERT INTO run (job, started_at, finished_at, status, detail) VALUES (?,?,?,?,?)",
            (job, started_at, now_iso(), status, json.dumps(detail or {}, sort_keys=True)))


def add_purge(day: str, *, battles: int, duel_timeline: int, raw: int, tags: int,
              tags_gone: int, seconds: float, retention_days: int, complete: bool) -> None:
    """Record one battle-day's deletion.

    A day can be deleted across two runs (a run that is stopped part way), so
    the counts ADD to what is already there rather than replacing it; `tags`
    and `tags_gone` are measured once, before the first row goes, and kept.
    """
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    with contextlib.closing(connect()) as con, con:
        con.execute(
            """INSERT INTO purge_day (day, run_date, finished_at, battles, duel_timeline, raw,
                                      tags, tags_gone, seconds, retention_days, complete)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(day) DO UPDATE SET
                   run_date = excluded.run_date,
                   finished_at = excluded.finished_at,
                   battles = purge_day.battles + excluded.battles,
                   duel_timeline = purge_day.duel_timeline + excluded.duel_timeline,
                   raw = purge_day.raw + excluded.raw,
                   tags = MAX(purge_day.tags, excluded.tags),
                   tags_gone = MAX(purge_day.tags_gone, excluded.tags_gone),
                   seconds = purge_day.seconds + excluded.seconds,
                   retention_days = excluded.retention_days,
                   complete = excluded.complete""",
            (day, today, now_iso(), battles, duel_timeline, raw, tags, tags_gone,
             round(seconds, 2), retention_days, int(complete)))


def put_snapshot(row: dict) -> None:
    """Store today's reading. A second run on one day REPLACES the first, so
    re-running the timer never stores two readings for one date."""
    cols = ("date", "taken_at", "battles_total", "max_id", "inserted", "file_bytes",
            "page_size", "page_count", "freelist_pages", "oldest_battle", "newest_battle",
            "tracked_players", "retention_days", "watermark", "next_purge_day",
            "disk_total", "disk_free", "raw_rows", "raw_bytes", "by_month", "forecast")
    vals = [row.get(c) for c in cols]
    for i, c in enumerate(cols):
        if c in ("by_month", "forecast") and vals[i] is not None and not isinstance(vals[i], str):
            vals[i] = json.dumps(vals[i])
    with contextlib.closing(connect()) as con, con:
        con.execute("INSERT OR REPLACE INTO snapshot (%s) VALUES (%s)"
                    % (",".join(cols), ",".join("?" * len(cols))), vals)


def previous_max_id(before_date: str) -> int | None:
    """`max_id` of the newest reading older than `before_date`, or None when
    there is none — "no baseline" is not "nothing inserted"."""
    with contextlib.closing(connect()) as con:
        r = con.execute("SELECT max_id FROM snapshot WHERE date < ? AND max_id IS NOT NULL "
                        "ORDER BY date DESC LIMIT 1", (before_date,)).fetchone()
    return None if r is None else int(r[0])


def put_backup(name: str, **fields) -> None:
    with contextlib.closing(connect()) as con, con:
        con.execute("INSERT OR IGNORE INTO backup (name, created_at, status) VALUES (?,?,?)",
                    (name, fields.get("created_at") or now_iso(), fields.get("status", "running")))
        if fields:
            sets = ", ".join("%s = ?" % k for k in fields)
            con.execute("UPDATE backup SET %s WHERE name = ?" % sets, (*fields.values(), name))


def get_backup(name: str) -> dict | None:
    with contextlib.closing(connect()) as con:
        r = con.execute("SELECT * FROM backup WHERE name = ?", (name,)).fetchone()
    return dict(r) if r else None


def backups() -> list[dict]:
    with contextlib.closing(connect()) as con:
        return [dict(r) for r in con.execute("SELECT * FROM backup ORDER BY created_at DESC")]


def _json(value, default):
    try:
        return json.loads(value) if value else default
    except (TypeError, ValueError):
        return default


def report(days: int = 120) -> dict:
    """Everything the console's Data lifecycle view draws, in one read.

    Shaped for the client: snapshots and purges oldest first, the newest
    snapshot's month histogram and forecast unpacked, backups newest first.
    """
    days = max(1, min(int(days), 400))
    since = (datetime.datetime.now(datetime.timezone.utc).date()
             - datetime.timedelta(days=days)).isoformat()
    with contextlib.closing(connect()) as con:
        snaps = [dict(r) for r in con.execute(
            "SELECT * FROM snapshot WHERE date >= ? ORDER BY date", (since,))]
        purges = [dict(r) for r in con.execute(
            "SELECT * FROM purge_day WHERE run_date >= ? ORDER BY day", (since,))]
        runs = [dict(r) for r in con.execute(
            "SELECT * FROM run ORDER BY id DESC LIMIT 30")]
        totals = con.execute(
            "SELECT COUNT(*), COALESCE(SUM(battles),0), COALESCE(SUM(tags),0) FROM purge_day"
        ).fetchone()
    latest = snaps[-1] if snaps else None
    for s in snaps:
        if s is not latest:          # only the newest reading's histogram is drawn
            s.pop("by_month", None)
            s.pop("forecast", None)
    if latest:
        latest["by_month"] = _json(latest.get("by_month"), {})
        latest["forecast"] = _json(latest.get("forecast"), [])
    for r in runs:
        r["detail"] = _json(r.get("detail"), {})
    return {
        "snapshots": snaps,
        "latest": latest,
        "purges": purges,
        "runs": runs,
        "backups": backups()[:20],
        "totals": {"daysPurged": totals[0], "battlesPurged": totals[1], "tagDays": totals[2]},
    }
