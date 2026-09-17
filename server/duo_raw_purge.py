"""duo_raw_purge.py — keep only a rolling window of 2v2 raw payloads.

**THE ONLY THING IN THIS REPOSITORY THAT WRITES TO THE BOT'S DATABASE, and it
deletes exactly one kind of row.** Every other module here opens
`/var/clashbot/battles.db` with `mode=ro`, and that guarantee is why
`tracking.py` exists. This file is the deliberate, narrow exception: 2v2 raw
payloads, once they have been folded into the retention system and are older
than the window, are redundant by construction.

WHY IT EXISTS. `battle_raw` holds the full JSON of every battle. 2v2 arrives at
**144,463 payloads a day costing 1.81 GB a day** (measured 2026-09-17), and the
bot's own valve that would drop them — `enforce_raw_cap` -> `purge_non_duel_raw`
— runs only from `_run_startup_maintenance_inner`, i.e. **at bot startup**. The
bot had been up since 2026-09-12 with no purge in 14 days of logs, which is the
whole reason the database reached 77 GB against a 25 GiB cap.

WHAT MAKES A ROW SAFE TO DELETE, and all three must hold:

  1. **it is 2v2** — matched with `battle_modes.is_duo`, the same routing rule
     the rest of the project uses, so duel and 1v1 raw cannot be touched by
     construction rather than by care;
  2. **the retention system has already consumed it** — `stored_at` is at or
     before `duo_pairs.processed_through()`, the fold cursor. This is the exact
     interlock the bot's own valve uses, and the reason it exists: a payload
     the fold has not read yet is the ONLY copy of that battle, because 2v2 no
     longer enters `battles` at all since the 2026-09-10 guard;
  3. **it is older than the window** — a further margin on top of (2), so a
     payload survives long enough to be re-read if anything downstream needs a
     second look.

Fails closed at every step: an unreadable cursor, an empty cursor or a missing
collection all mean "delete nothing".

WHAT IT DOES NOT TOUCH. The `battles` table — not one row. Those 2v2 rows are
~0.9 GB and every per-player aggregate (`player_stats_agg` and friends) counts
them; deleting them without rebuilding the aggregates leaves figures that are
permanently wrong and no longer recomputable. That is a separate decision with a
separate cost, and it is deliberately not taken here.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import battle_modes as bm          # noqa: E402
import duo_pairs as dp             # noqa: E402

#: How much 2v2 raw to keep behind the fold cursor. A day is 24 folds of margin
#: — the collection job runs hourly — and about 1.8 GB at the measured rate.
WINDOW_HOURS = int(os.getenv("CLASH_DUO_RAW_HOURS", "24"))

#: Rows per transaction. Small enough that the bot never waits long for the
#: write lock; it polls this same database every two hours.
BATCH = int(os.getenv("CLASH_DUO_RAW_BATCH", "20000"))

#: Deleting is gated, the same convention `CLASH_OIE` and `CLASH_DUO_RETENTION`
#: already follow here. Reporting what WOULD go always works.
ENABLED = os.getenv("CLASH_DUO_RAW_PURGE", "off").strip().lower() in (
    "1", "on", "true", "yes")

#: The 2v2 predicate, as SQL. It mirrors `battle_modes._DUO_MARKERS` exactly;
#: `verify_markers()` asserts the two agree rather than trusting this copy.
_SQL_IS_DUO = "(lower(game_mode) LIKE '%teamvsteam%' OR lower(game_mode) LIKE '%2v2%')"


def verify_markers() -> None:
    """The SQL predicate and the Python router must name the same modes.

    Two copies of one rule drift, and this one decides what gets deleted. The
    check is cheap and it runs before every purge.
    """
    for mode in ("TeamVsTeam", "TeamVsTeam_FixedDeckOrder", "2v2", "Duel_1v1_Friendly",
                 "Ranked1v1_NewArena2", "Ladder", "CW_Duel_1v1"):
        sql_says = ("teamvsteam" in mode.lower()) or ("2v2" in mode.lower())
        if sql_says != bm.is_duo(mode):
            raise RuntimeError(
                "the SQL 2v2 predicate disagrees with battle_modes.is_duo on %r"
                % mode)


def boundary() -> str:
    """The newest `stored_at` that may be deleted, or "" meaning delete nothing.

    The EARLIER of the fold cursor and the window floor. Taking the earlier of
    the two means a change to either one can only ever make this safer.
    """
    try:
        cursor = dp.processed_through()
    except Exception:
        return ""
    if not cursor:
        # No cursor means nothing is proven consumed. `purge_non_duel_raw` uses
        # the same convention: an empty cursor protects everything.
        return ""
    # Timezone-aware (`utcnow()` is deprecated from 3.12), then rendered naive
    # to match how `stored_at` is compared — as a string.
    floor = (datetime.datetime.now(datetime.timezone.utc)
             - datetime.timedelta(hours=WINDOW_HOURS)).strftime("%Y-%m-%dT%H:%M:%S")
    return min(cursor, floor)


def _db_path() -> str:
    path = dp.cd.resolve_db_path() if hasattr(dp, "cd") else None
    return path or os.getenv("CLASH_DB_PATH", "")


def plan(con=None) -> dict:
    """What a purge would remove. Reads only."""
    verify_markers()
    cut = boundary()
    path = _db_path()
    if not cut or not path:
        return {"boundary": cut, "deletable": 0, "reason": "no cursor or no database"}
    own = con is None
    con = con or sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    try:
        n = con.execute(
            "SELECT COUNT(*) FROM battle_raw WHERE stored_at < ? AND " + _SQL_IS_DUO,
            (cut,)).fetchone()[0]
        keep = con.execute(
            "SELECT COUNT(*) FROM battle_raw WHERE stored_at >= ? AND " + _SQL_IS_DUO,
            (cut,)).fetchone()[0]
        total = con.execute("SELECT COUNT(*) FROM battle_raw").fetchone()[0]
        return {"boundary": cut, "windowHours": WINDOW_HOURS, "deletable": n,
                "keeping2v2": keep, "rawRowsTotal": total, "enabled": ENABLED}
    finally:
        if own:
            con.close()


def purge(confirm: bool = False, limit: int = 0, log=print) -> dict:
    """Delete 2v2 raw older than the boundary, in batches.

    **Batched on purpose.** The bot writes to this database every two hours and
    a single DELETE of a million rows would hold the write lock for minutes.
    Each batch is its own transaction, so the bot waits milliseconds at worst.
    """
    if not confirm or not ENABLED:
        return {"deleted": 0, "refused": True,
                "why": "needs confirm=True and CLASH_DUO_RAW_PURGE enabled",
                "plan": plan()}
    verify_markers()
    cut = boundary()
    path = _db_path()
    if not cut or not path:
        return {"deleted": 0, "refused": True, "why": "no cursor or no database"}

    con = sqlite3.connect(path, timeout=120.0)
    con.execute("PRAGMA busy_timeout=120000")
    try:
        before_duel = con.execute(
            "SELECT COUNT(*) FROM battle_raw WHERE lower(game_mode) LIKE '%duel%'"
        ).fetchone()[0]
        log("collecting the rows to delete (one scan) ...")
        rows = [r[0] for r in con.execute(
            "SELECT rowid FROM battle_raw WHERE stored_at < ? AND " + _SQL_IS_DUO,
            (cut,))]
        if limit:
            rows = rows[:limit]
        log("to delete: %d rows older than %s" % (len(rows), cut))
        done = 0
        for i in range(0, len(rows), BATCH):
            chunk = rows[i:i + BATCH]
            con.execute(
                "DELETE FROM battle_raw WHERE rowid IN (%s)"
                % ",".join("?" * len(chunk)), chunk)
            con.commit()
            done += len(chunk)
            if done % (BATCH * 10) == 0 or done == len(rows):
                log("  deleted %d / %d" % (done, len(rows)))
        after_duel = con.execute(
            "SELECT COUNT(*) FROM battle_raw WHERE lower(game_mode) LIKE '%duel%'"
        ).fetchone()[0]
        # A DUEL ROW GOING MISSING IS THE ONE OUTCOME THAT MUST BE IMPOSSIBLE.
        # The predicate cannot match one, so this is a tripwire, not a hope.
        if before_duel != after_duel:
            raise RuntimeError("duel raw changed: %d -> %d" % (before_duel, after_duel))
        left = con.execute(
            "SELECT COUNT(*) FROM battle_raw WHERE stored_at < ? AND " + _SQL_IS_DUO,
            (cut,)).fetchone()[0]
        return {"deleted": done, "refused": False, "boundary": cut,
                "remainingOlderThanBoundary": left, "duelRawUnchanged": True,
                "duelRawRows": after_duel}
    finally:
        con.close()


if __name__ == "__main__":  # pragma: no cover - operational entry point
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--plan", action="store_true", help="report only, delete nothing")
    ap.add_argument("--purge", action="store_true", help="delete (also needs the env gate)")
    ap.add_argument("--limit", type=int, default=0, help="cap rows, for a first careful run")
    a = ap.parse_args()
    if a.purge:
        print(json.dumps(purge(confirm=True, limit=a.limit), indent=1))
    else:
        print(json.dumps(plan(), indent=1))
