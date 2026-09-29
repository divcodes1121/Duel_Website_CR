"""retention.py — delete battles one day at a time once they pass the window.

THE RULE, in the words it was asked for: "data added today gets deleted after
10 months, first day's battles first — not all data at once." So a battle is
kept for `RETENTION_DAYS` whole days after the day it was PLAYED, and each run
removes the oldest battle-day that has passed that line — and only that day, or
at most `MAX_DAYS_PER_RUN` of them. Every player therefore keeps their own last
ten months: someone tracked since June loses June first; someone tracked since
September keeps everything until next July. Nobody's history is cut at once.

WHY THIS REPLACES THE BOT'S OWN DELETE. `clashdb.apply_age_retention` deletes
every battle past the boundary in ONE statement, and it runs only from the bot's
startup maintenance. Nothing had aged out yet (the oldest battle is 2026-06-01,
so a 304-day window first bites on 2027-04-01) — but from then on, a bot that
ran three weeks without a restart would delete three weeks of battles in one
transaction, holding the write lock on a 57 GB file while it did. The bot is
told `CLASH_RETENTION_EXTERNAL = on` and skips that step; this job owns it.

WHAT A RUN DOES

  1. reads the boundary — `today - RETENTION_DAYS`; battle-days strictly older
     than it are due;
  2. **refuses** if any due day ends after the bot's aggregation watermark
     (`retention_meta.cutoff`): a row the aggregates have not folded would
     otherwise vanish from every per-player figure as well as from the table.
     That is the bot's own guard, applied here unchanged;
  3. for the oldest due day, counts what it holds (battles, distinct players,
     players with nothing newer stored), then deletes it in small batches —
     `battles`, `duel_timeline`, and that day's `battle_raw` — committing each
     batch, so the bot never waits long for the lock;
  4. records the day in the ledger (`data_ledger.purge_day`);
  5. takes today's snapshot (size, intake, oldest battle, what expires next).

`MAX_DAYS_PER_RUN` (3) is what keeps a CHANGE of window gentle. Moving from 12
months to 10 makes ~61 days due at once; at three a run against one new due day
a day, that backlog drains at two days a day over about a month instead of
arriving as one delete. Moving from 10 to 12 simply means nothing is due for
two months.

Deleting needs `CLASH_RETENTION_PURGE=on`, set on the systemd UNIT (like the
2v2 jobs), so `royalweb` itself can never delete. Without it a run is a dry run:
it plans, snapshots and records what it WOULD delete.

    python3 retention.py --plan        # what is due, deletes nothing
    python3 retention.py --run         # snapshot + delete what is due (needs the gate)
    python3 retention.py --snapshot    # just today's reading
"""

from __future__ import annotations

import argparse
import contextlib
import datetime
import json
import os
import shutil
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import data_ledger as ledger     # noqa: E402

DB_PATH = os.getenv("CLASH_DB_PATH", "/var/clashbot/battles.db")

#: The window. 304 days = 10 months; 365 for 12. Both env files must agree:
#: `/etc/royalweb.env` (this job) and `/opt/clashbot/.env` (the bot, which also
#: uses it to cap how far back its own screens read).
RETENTION_DAYS = int(os.getenv("CLASH_RETENTION_DAYS", "304"))

#: Below this the job refuses outright. A typo of "30" for "300" must not be
#: able to delete nine months of every player's history.
MIN_RETENTION_DAYS = 90

MAX_DAYS_PER_RUN = max(1, int(os.getenv("CLASH_RETENTION_MAX_DAYS", "3")))
BATCH = int(os.getenv("CLASH_RETENTION_BATCH", "5000"))
PAUSE_S = float(os.getenv("CLASH_RETENTION_PAUSE_S", "0.2"))
FORECAST_DAYS = 30

ENABLED = os.getenv("CLASH_RETENTION_PURGE", "off").strip().lower() in ("1", "on", "true", "yes")

#: The bot's env file, read only to REPORT whether the two sides agree.
BOT_ENV = os.getenv("CLASH_BOT_ENV", "/opt/clashbot/.env")


def _today() -> datetime.date:
    return datetime.datetime.now(datetime.timezone.utc).date()


def stamp(day: datetime.date) -> str:
    """Midnight of `day` in `battle_time`'s own format. It is fixed-width, so
    string comparison orders it, and every range here is [day, day + 1)."""
    return day.strftime("%Y%m%dT000000.000Z")


def day_of(battle_time: str) -> datetime.date:
    return datetime.date(int(battle_time[0:4]), int(battle_time[4:6]), int(battle_time[6:8]))


def boundary(today: datetime.date | None = None, days: int | None = None) -> datetime.date:
    """The first battle-day that is KEPT. Every day before it is due."""
    return (today or _today()) - datetime.timedelta(days=RETENTION_DAYS if days is None else days)


def bot_settings(path: str = BOT_ENV) -> dict:
    """The bot's retention value and whether it has handed deletion to us.
    The bot's parser tolerates `KEY = value`, so this does too."""
    out = {"retentionDays": None, "external": None}
    try:
        with open(path) as f:
            for line in f:
                if "=" not in line or line.lstrip().startswith("#"):
                    continue
                k, v = (s.strip() for s in line.split("=", 1))
                if k == "CLASH_RETENTION_DAYS":
                    out["retentionDays"] = int(v)
                elif k == "CLASH_RETENTION_EXTERNAL":
                    out["external"] = v.lower() in ("1", "on", "true", "yes")
    except (OSError, ValueError):
        pass
    return out


def _connect(write: bool) -> sqlite3.Connection:
    if write:
        con = sqlite3.connect(DB_PATH, timeout=60.0)
        con.execute("PRAGMA busy_timeout = 60000")
        return con
    return sqlite3.connect("file:%s?mode=ro" % DB_PATH, uri=True, timeout=30.0)


def _watermark(con) -> str:
    try:
        r = con.execute("SELECT value FROM retention_meta WHERE key = 'cutoff'").fetchone()
        return (r[0] if r else "") or ""
    except sqlite3.Error:
        return ""


def plan(con=None, today: datetime.date | None = None) -> dict:
    """What is due, and whether it may be deleted. Reads only."""
    own = con is None
    con = con or _connect(False)
    try:
        today = today or _today()
        keep_from = boundary(today)
        oldest = con.execute("SELECT MIN(battle_time) FROM battles").fetchone()[0]
        watermark = _watermark(con)
        out = {
            "retentionDays": RETENTION_DAYS, "maxDaysPerRun": MAX_DAYS_PER_RUN,
            "keepFrom": keep_from.isoformat(), "oldestBattle": oldest,
            "watermark": watermark, "enabled": ENABLED, "due": [], "refused": None,
        }
        if RETENTION_DAYS < MIN_RETENTION_DAYS:
            out["refused"] = "retention_below_minimum"
            return out
        if not oldest:
            return out
        first = day_of(oldest)
        due = []
        d = first
        while d < keep_from and len(due) < MAX_DAYS_PER_RUN:
            due.append(d)
            d += datetime.timedelta(days=1)
        out["due"] = [x.isoformat() for x in due]
        out["backlogDays"] = max(0, (keep_from - first).days)
        out["firstDeletion"] = (first + datetime.timedelta(days=RETENTION_DAYS + 1)).isoformat()
        if due and (not watermark or stamp(due[-1] + datetime.timedelta(days=1)) > watermark):
            # The last due day must be wholly behind the watermark, or rows the
            # aggregates never folded would be lost from both places.
            out["refused"] = "behind_watermark"
        return out
    finally:
        if own:
            con.close()


def _day_facts(con, day: datetime.date) -> dict:
    lo, hi = stamp(day), stamp(day + datetime.timedelta(days=1))
    tags = [r[0] for r in con.execute(
        "SELECT DISTINCT player_tag FROM battles WHERE battle_time >= ? AND battle_time < ?",
        (lo, hi))]
    min_id = con.execute("SELECT MIN(id) FROM battles WHERE battle_time >= ? AND battle_time < ?",
                         (lo, hi)).fetchone()[0]
    gone = 0
    for t in tags:
        # Anything played after this day was inserted after its first row, so
        # `id > min_id` rides idx_battles_tag (tag, rowid) instead of scanning.
        newer = con.execute(
            "SELECT 1 FROM battles WHERE player_tag = ? AND id > ? AND battle_time >= ? LIMIT 1",
            (t, min_id or 0, hi)).fetchone()
        gone += newer is None
    return {"tags": tags, "tags_gone": gone}


def _batched(con, sql: str, params: tuple) -> int:
    total = 0
    while True:
        cur = con.execute(sql, params)
        con.commit()
        total += cur.rowcount
        if cur.rowcount < BATCH:
            return total
        time.sleep(PAUSE_S)


def _duo_cursor() -> str:
    """The 2v2 fold cursor. A 2v2 raw payload is only ever deleted behind it."""
    try:
        import duo_pairs as dp          # noqa: PLC0415 — optional on a dev box
        return dp.processed_through() or ""
    except Exception:                   # noqa: BLE001
        return ""


def delete_day(con, day: datetime.date, log=print) -> dict:
    lo, hi = stamp(day), stamp(day + datetime.timedelta(days=1))
    t0 = time.monotonic()
    facts = _day_facts(con, day)
    battles = _batched(con,
        "DELETE FROM battles WHERE id IN (SELECT id FROM battles WHERE battle_time >= ? "
        "AND battle_time < ? LIMIT %d)" % BATCH, (lo, hi))
    duel = _batched(con,
        "DELETE FROM duel_timeline WHERE rowid IN (SELECT rowid FROM duel_timeline "
        "WHERE battle_time >= ? AND battle_time < ? LIMIT %d)" % BATCH, (lo, hi))
    raw = 0
    cursor = _duo_cursor()
    # battle_raw has no index on battle_time; its primary key is (tag, time), so
    # the day is removed tag by tag, and 2v2 rows only behind the fold cursor.
    # The cursor is an ISO `stored_at` ("2026-09-17T02:53:34Z"), so the day
    # after this one, as an ISO date, orders against it as a string.
    duo_ok = bool(cursor) and cursor >= (day + datetime.timedelta(days=1)).isoformat()
    for t in facts["tags"]:
        sql = "DELETE FROM battle_raw WHERE player_tag = ? AND battle_time >= ? AND battle_time < ?"
        if not duo_ok:
            sql += " AND NOT (lower(game_mode) LIKE '%teamvsteam%' OR lower(game_mode) LIKE '%2v2%')"
        raw += con.execute(sql, (t, lo, hi)).rowcount
    con.commit()
    seconds = time.monotonic() - t0
    rec = {"day": day.isoformat(), "battles": battles, "duel_timeline": duel, "raw": raw,
           "tags": len(facts["tags"]), "tags_gone": facts["tags_gone"],
           "seconds": round(seconds, 1)}
    if not (battles or duel or raw):
        return rec                      # a calendar gap: nothing to record
    ledger.add_purge(day.isoformat(), battles=battles, duel_timeline=duel, raw=raw,
                     tags=len(facts["tags"]), tags_gone=facts["tags_gone"],
                     seconds=seconds, retention_days=RETENTION_DAYS, complete=True)
    log("deleted %(day)s: %(battles)d battles, %(tags)d players (%(tags_gone)d with nothing "
        "newer), %(duel_timeline)d timeline, %(raw)d raw in %(seconds)ss" % rec)
    return rec


def snapshot(con=None, today: datetime.date | None = None) -> dict:
    """Today's reading of the database, stored in the ledger. Reads only; every
    figure is a pragma, an index-only aggregate or a range on idx_battles_time."""
    own = con is None
    con = con or _connect(False)
    try:
        today = today or _today()
        page_size = con.execute("PRAGMA page_size").fetchone()[0]
        page_count = con.execute("PRAGMA page_count").fetchone()[0]
        freelist = con.execute("PRAGMA freelist_count").fetchone()[0]
        lo, hi = con.execute("SELECT MIN(battle_time), MAX(battle_time) FROM battles").fetchone()
        max_id = con.execute("SELECT MAX(id) FROM battles").fetchone()[0]
        total = con.execute("SELECT COUNT(*) FROM battles").fetchone()[0]
        by_month = {r[0][:4] + "-" + r[0][4:6]: r[1] for r in con.execute(
            "SELECT substr(battle_time, 1, 6) AS m, COUNT(*) FROM battles "
            "WHERE battle_time IS NOT NULL GROUP BY m ORDER BY m") if r[0]}
        # The next days to expire are always the OLDEST stored ones — each day
        # d goes on d + RETENTION_DAYS + 1 — so the forecast starts there, and
        # it has something to say months before the first deletion.
        start = day_of(lo) if lo else today
        end = start + datetime.timedelta(days=FORECAST_DAYS)
        forecast = [[r[0][:4] + "-" + r[0][4:6] + "-" + r[0][6:8], r[1]] for r in con.execute(
            "SELECT substr(battle_time, 1, 8) AS d, COUNT(*) FROM battles "
            "WHERE battle_time >= ? AND battle_time < ? GROUP BY d ORDER BY d",
            (stamp(start), stamp(end)))]
        try:
            tracked = con.execute("SELECT COUNT(*) FROM tracked_players").fetchone()[0]
        except sqlite3.Error:
            tracked = None
        # RAW PAYLOADS ARE NOT PER-BATTLE DATA. They churn: 2v2 on a daily
        # timer, ladder only when the bot restarts. Counting them apart is what
        # lets the console project the per-battle part of the file honestly.
        # The byte figure is an ESTIMATE (rows x the newest 2,000's mean size),
        # because an exact one is a scan of ~13 GB.
        try:
            raw_rows = con.execute("SELECT COUNT(*) FROM battle_raw").fetchone()[0]
            raw_avg = con.execute(
                "SELECT AVG(length(raw_json)) FROM (SELECT raw_json FROM battle_raw "
                "ORDER BY stored_at DESC LIMIT 2000)").fetchone()[0] or 0
            raw_bytes = int(raw_rows * raw_avg)
        except sqlite3.Error:
            raw_rows = raw_bytes = None
        prev = ledger.previous_max_id(today.isoformat())
        disk = shutil.disk_usage(os.path.dirname(os.path.abspath(DB_PATH)))
        row = {
            "date": today.isoformat(), "taken_at": ledger.now_iso(),
            "battles_total": total, "max_id": max_id,
            "inserted": None if prev is None or max_id is None else max(0, max_id - prev),
            "file_bytes": os.path.getsize(DB_PATH), "page_size": page_size,
            "page_count": page_count, "freelist_pages": freelist,
            "oldest_battle": lo, "newest_battle": hi, "tracked_players": tracked,
            "retention_days": RETENTION_DAYS, "watermark": _watermark(con),
            "next_purge_day": (day_of(lo).isoformat() if lo else None),
            "disk_total": disk.total, "disk_free": disk.free,
            "raw_rows": raw_rows, "raw_bytes": raw_bytes,
            "by_month": by_month, "forecast": forecast,
        }
        ledger.put_snapshot(row)
        return row
    finally:
        if own:
            con.close()


def run(log=print) -> dict:
    started = ledger.now_iso()
    try:
        with contextlib.closing(_connect(False)) as ro:
            p = plan(ro)
        detail = {"plan": p, "bot": bot_settings(), "deleted": []}
        if p["refused"]:
            status = "refused"
            log("REFUSED: %s" % p["refused"])
        elif not p["due"]:
            status = "nothing_due"
            log("nothing due; first deletion %s" % p.get("firstDeletion"))
        elif not ENABLED:
            status = "dry_run"
            log("dry run (CLASH_RETENTION_PURGE is off): would delete %s" % ", ".join(p["due"]))
        else:
            status = "ok"
            with contextlib.closing(_connect(True)) as con:
                for d in p["due"]:
                    detail["deleted"].append(delete_day(con, datetime.date.fromisoformat(d), log))
        with contextlib.closing(_connect(False)) as ro:
            snap = snapshot(ro)
        detail["snapshot"] = {k: snap[k] for k in ("battles_total", "inserted", "file_bytes",
                                                   "freelist_pages", "oldest_battle")}
        ledger.record_run("retention", started, status, detail)
        return {"status": status, **detail}
    except Exception as exc:   # noqa: BLE001 — recorded, then re-raised
        ledger.record_run("retention", started, "error",
                          {"error": type(exc).__name__, "message": str(exc)[:300]})
        raise


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--snapshot", action="store_true")
    args = ap.parse_args()
    if args.run:
        out = run()
    elif args.snapshot:
        out = snapshot()
    else:
        out = {"plan": plan(), "bot": bot_settings()}
    print(json.dumps(out, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
