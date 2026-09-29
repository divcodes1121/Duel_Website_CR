"""ladder_raw_purge.py — keep only a rolling few days of LADDER raw payloads.

`battle_raw` stores the full API JSON of every battle the bot collects. For a
ladder (1v1 own-deck) battle that JSON is a second, heavier copy of a row the
bot already wrote to `battles` — about 7 KB against 2 KB — and nothing reads it
afterwards: the website reads raw only for 2v2 (`duo_pairs`) and duels
(`duel_index`), and the bot reads it only for duels and as a last-resort name
lookup. Measured 2026-09-29: ~13 GB of raw, growing ~4 GB a day, cleared only
when the bot RESTARTS (`enforce_raw_cap` runs from startup maintenance). A bot
up for a month would add ~120 GB. The owner approved a daily window.

WHAT MAKES A ROW DELETABLE, and all of these must hold:

  1. **it is not a duel** — `game_mode` does not contain "duel" and is not NULL
     (the bot's own duel reader treats NULL as possibly a duel, so this does);
  2. **it is not 2v2** — those belong to `duo_raw_purge.py`, which deletes only
     behind the 2v2 fold cursor; this job must not reach around that interlock;
  3. **it was stored more than `WINDOW_HOURS` ago** (72) — a margin in which any
     re-read or re-parse is still possible.

AND THE RUN REFUSES, deleting nothing, if:

  * a sample of the rows it would delete does not have its battle in `battles`
    (at least `MIN_MATCH` of `SAMPLE`) — the rule is "a copy of a stored
    battle", so the rule is checked, not assumed;
  * the count of duel raw in the range it touches changes between before and
    after (then it raises, after the fact, and the unit is marked failed).

Deleting needs `CLASH_LADDER_RAW_PURGE=on`, set on the systemd UNIT, so
`royalweb` itself can never delete. Without it a run reports what it would do.
Freed pages go to SQLite's freelist and are reused before the file grows again;
the file does not shrink, and does not need to.

    python3 ladder_raw_purge.py --plan
    python3 ladder_raw_purge.py --purge        # needs the gate
"""

from __future__ import annotations

import argparse
import contextlib
import datetime
import json
import os
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import data_ledger as ledger     # noqa: E402

DB_PATH = os.getenv("CLASH_DB_PATH", "/var/clashbot/battles.db")
WINDOW_HOURS = int(os.getenv("CLASH_LADDER_RAW_HOURS", "72"))
BATCH = int(os.getenv("CLASH_LADDER_RAW_BATCH", "20000"))
PAUSE_S = float(os.getenv("CLASH_LADDER_RAW_PAUSE_S", "0.2"))
SAMPLE = 500
MIN_MATCH = 0.95

ENABLED = os.getenv("CLASH_LADDER_RAW_PURGE", "off").strip().lower() in ("1", "on", "true", "yes")

#: Rows this job may delete, as SQL. Duel (including a NULL mode) and 2v2 are
#: excluded by construction; the 2v2 markers mirror `battle_modes._DUO_MARKERS`.
_SQL_DELETABLE = ("game_mode IS NOT NULL "
                  "AND lower(game_mode) NOT LIKE '%duel%' "
                  "AND lower(game_mode) NOT LIKE '%teamvsteam%' "
                  "AND lower(game_mode) NOT LIKE '%2v2%'")
_SQL_DUEL = "(game_mode IS NULL OR lower(game_mode) LIKE '%duel%')"


def boundary(now: datetime.datetime | None = None) -> str:
    """The newest `stored_at` that may be deleted, in stored_at's own format
    (`2026-09-29T09:20:17.896426+00:00`, which orders as a string)."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    return (now - datetime.timedelta(hours=WINDOW_HOURS)).strftime("%Y-%m-%dT%H:%M:%S")


def _duel_in_range(con, cut: str) -> int:
    return con.execute("SELECT COUNT(*) FROM battle_raw WHERE stored_at < ? AND %s" % _SQL_DUEL,
                       (cut,)).fetchone()[0]


def _sample_match(con, cut: str) -> tuple[int, int]:
    """Of up to SAMPLE deletable rows, how many have their battle in `battles`.
    Spread across the range by stepping through it rather than taking the
    oldest, so one old stretch cannot stand for the whole."""
    rows = con.execute(
        "SELECT player_tag, battle_time FROM battle_raw WHERE stored_at < ? AND %s "
        "ORDER BY stored_at DESC LIMIT ?" % _SQL_DELETABLE, (cut, SAMPLE * 20)).fetchall()
    rows = rows[::max(1, len(rows) // SAMPLE)][:SAMPLE]
    hit = 0
    for tag, bt in rows:
        # The exact second narrows to a handful of rows via idx_battles_time;
        # the unary `+` keeps the planner off idx_battles_tag, which for a
        # heavily-tracked player means walking thousands of rows per lookup.
        if con.execute("SELECT 1 FROM battles WHERE battle_time = ? AND +player_tag = ? LIMIT 1",
                       (bt, tag)).fetchone():
            hit += 1
    return hit, len(rows)


def plan(con=None) -> dict:
    own = con is None
    con = con or sqlite3.connect("file:%s?mode=ro" % DB_PATH, uri=True, timeout=30.0)
    try:
        cut = boundary()
        deletable = con.execute("SELECT COUNT(*) FROM battle_raw WHERE stored_at < ? AND %s"
                                % _SQL_DELETABLE, (cut,)).fetchone()[0]
        hit, n = _sample_match(con, cut) if deletable else (0, 0)
        refused = None
        if n and hit / n < MIN_MATCH:
            refused = "sample_not_in_battles"
        return {"boundary": cut, "windowHours": WINDOW_HOURS, "deletable": deletable,
                "sample": n, "sampleInBattles": hit, "refused": refused, "enabled": ENABLED}
    finally:
        if own:
            con.close()


def purge(confirm: bool = False, log=print) -> dict:
    started = ledger.now_iso()
    try:
        with contextlib.closing(sqlite3.connect("file:%s?mode=ro" % DB_PATH, uri=True,
                                                timeout=30.0)) as ro:
            p = plan(ro)
        if p["refused"]:
            log("REFUSED: %s (%d of %d sampled rows have their battle)"
                % (p["refused"], p["sampleInBattles"], p["sample"]))
            ledger.record_run("ladder_raw", started, "refused", p)
            return {"status": "refused", **p}
        if not p["deletable"]:
            ledger.record_run("ladder_raw", started, "nothing_due", p)
            return {"status": "nothing_due", **p}
        if not (ENABLED and confirm):
            log("dry run: would delete %d ladder raw rows stored before %s"
                % (p["deletable"], p["boundary"]))
            ledger.record_run("ladder_raw", started, "dry_run", p)
            return {"status": "dry_run", **p}

        t0 = time.monotonic()
        con = sqlite3.connect(DB_PATH, timeout=60.0)
        con.execute("PRAGMA busy_timeout = 60000")
        try:
            duel_before = _duel_in_range(con, p["boundary"])
            deleted = 0
            while True:
                cur = con.execute(
                    "DELETE FROM battle_raw WHERE rowid IN (SELECT rowid FROM battle_raw "
                    "WHERE stored_at < ? AND %s LIMIT %d)" % (_SQL_DELETABLE, BATCH),
                    (p["boundary"],))
                con.commit()
                deleted += cur.rowcount
                if cur.rowcount < BATCH:
                    break
                time.sleep(PAUSE_S)
            duel_after = _duel_in_range(con, p["boundary"])
        finally:
            con.close()
        detail = {**p, "deleted": deleted, "duelBefore": duel_before, "duelAfter": duel_after,
                  "seconds": round(time.monotonic() - t0, 1)}
        if duel_after != duel_before:
            ledger.record_run("ladder_raw", started, "error",
                              {**detail, "message": "duel raw count changed"})
            raise RuntimeError("duel raw changed %d -> %d" % (duel_before, duel_after))
        ledger.record_run("ladder_raw", started, "ok", detail)
        log("deleted %d ladder raw rows stored before %s in %ss (duel raw %d, unchanged)"
            % (deleted, p["boundary"], detail["seconds"], duel_after))
        return {"status": "ok", **detail}
    except Exception as exc:   # noqa: BLE001 — recorded, then re-raised
        if not isinstance(exc, RuntimeError) or "duel raw changed" not in str(exc):
            ledger.record_run("ladder_raw", started, "error",
                              {"error": type(exc).__name__, "message": str(exc)[:300]})
        raise


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--purge", action="store_true", help="delete (also needs the env gate)")
    args = ap.parse_args()
    out = purge(confirm=True) if args.purge else plan()
    print(json.dumps(out, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
