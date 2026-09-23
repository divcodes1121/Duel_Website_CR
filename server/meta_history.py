"""The meta over time — what is rising, what is falling.

WHY THIS EXISTS AT ALL. `/api/analytics/meta` is a SNAPSHOT: it recomputes
every `CLASH_META_REFRESH` seconds (1800 by default) and keeps NOTHING, so
"Royal Hogs is climbing" was not a sentence this project could say. Rank
movement is not derivable from a single reading, however good that reading is.

ITS OWN SQLITE FILE (`server/.meta_history.db`), gitignored, the same call
`duo_pairs.py` makes and for the same two reasons: the history has to survive
independently of the snapshot that produced it, and a read-write handle to the
bot's 33 GB database is the one thing this project has never taken.

IT IS SMALL BY CONSTRUCTION. Fifty rows a day is ~18k rows a year, so nothing
here is ever a scan worth worrying about, and none of it may sit on a request
path anyway — `snapshot()` is called by a timer and `movement()` reads an
indexed join of two days.

── THE FOUR WAYS A TREND CAN LIE, AND WHAT IS DONE ABOUT EACH ──────────────

1. **NO BASELINE IS NOT ZERO MOVEMENT.** On the day this ships there is one
   snapshot and nothing to compare it with. `movement()` answers
   `basis: "none"` — the same rule `RETENTION_DAYS` follows when it says
   "unknown" rather than inventing a number. A client that renders "0%" for
   every deck would be stating, confidently, that the meta is perfectly still.

2. **A DECK THAT WAS NOT ON THE BOARD DID NOT MOVE.** The board is the top
   fifty; a deck entering at rank 12 did not "climb 39 places" from 51, because
   51 is not where it was — it is merely where the board stopped. Such a row
   carries `entered: true` and a NULL delta. Same for one that has dropped off:
   `left: true`, never "fell to zero use".

3. **A MISSED TIMER MUST NOT SILENTLY CHANGE THE SPAN.** Asking for 7 days
   when the newest baseline is 9 days old is a 9-day comparison, and reporting
   it as 7 would misattribute two days of movement. `comparedWith` and
   `daysApart` are always returned, and they describe the snapshots ACTUALLY
   used, not the ones requested.

4. **A REFRESH IS NOT A DAY.** The board recomputes every half hour, so a naive
   append would store 48 readings a day and a "1 day ago" comparison could
   span 30 minutes. The primary key is `(day, deck_hash)` and a later write on
   the same day REPLACES — so a day means a day, and re-running the timer is
   idempotent rather than cumulative.
"""

from __future__ import annotations

import datetime as _dt
import os
import sqlite3

DB_PATH = os.getenv(
    "CLASH_META_HISTORY_DB",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".meta_history.db"),
)

#: Days of history kept. Generous — the table is tiny — but bounded, because
#: nothing in this project is allowed to grow without a stated limit.
RETAIN_DAYS = 400

#: Rank movement below this is noise on a board whose ordering churns on a few
#: hundred battles. Reported anyway; the client decides what to draw.
NOTABLE_RANK = 3


def _today() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, timeout=30.0, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


def _ensure(con: sqlite3.Connection) -> None:
    con.execute(
        """CREATE TABLE IF NOT EXISTS meta_snapshot (
               day           TEXT NOT NULL,
               deck_hash     TEXT NOT NULL,
               rank          INTEGER NOT NULL,
               use_rate      REAL NOT NULL,
               win_rate      REAL NOT NULL,
               players       INTEGER NOT NULL,
               battles       INTEGER NOT NULL,
               name          TEXT NOT NULL,
               win_condition TEXT,
               PRIMARY KEY (day, deck_hash)
           )"""
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_meta_day ON meta_snapshot(day)")
    con.commit()


def snapshot(board: dict, *, day: str | None = None) -> dict:
    """Store one reading of the deck board.

    REFUSES A BOARD THAT IS NOT A READING. While `meta.refresh()` is still
    computing, `board()` answers `{"building": true, "decks": []}` — storing
    that would write a day with no decks in it, and a later comparison against
    that day would report the entire meta as having vanished and come back.
    An empty or building board is not history; it is the absence of one.
    """
    decks = board.get("decks") or []
    if board.get("building") or not decks:
        return {"stored": 0, "day": day or _today(),
                "skipped": "building" if board.get("building") else "empty"}

    d = day or _today()
    con = _connect()
    try:
        _ensure(con)
        rows = [
            (
                d,
                x.get("deckHash") or "",
                int(x.get("rank") or 0),
                float(x.get("useRate") or 0.0),
                float(x.get("winRate") or 0.0),
                int(x.get("players") or 0),
                int(x.get("battles") or 0),
                x.get("name") or "",
                x.get("winCondition"),
            )
            for x in decks
            if x.get("deckHash")
        ]
        # REPLACE, not INSERT: see fault 4 in the module note. A day is a day.
        con.executemany(
            """INSERT OR REPLACE INTO meta_snapshot
               (day, deck_hash, rank, use_rate, win_rate, players, battles, name, win_condition)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            rows,
        )
        cutoff = (
            _dt.datetime.strptime(d, "%Y-%m-%d") - _dt.timedelta(days=RETAIN_DAYS)
        ).strftime("%Y-%m-%d")
        con.execute("DELETE FROM meta_snapshot WHERE day < ?", (cutoff,))
        con.commit()
        return {"stored": len(rows), "day": d, "skipped": None}
    finally:
        con.close()


def days_stored() -> int:
    con = _connect()
    try:
        _ensure(con)
        return int(con.execute("SELECT COUNT(DISTINCT day) FROM meta_snapshot").fetchone()[0])
    finally:
        con.close()


def _day_rows(con: sqlite3.Connection, day: str) -> dict[str, sqlite3.Row]:
    cur = con.execute("SELECT * FROM meta_snapshot WHERE day = ?", (day,))
    return {r["deck_hash"]: r for r in cur}


def movement(days: int = 7) -> dict:
    """How the board has moved over roughly `days`.

    Returns `basis: "none"` — never a list of zeros — when there is nothing to
    compare against. See fault 1.
    """
    # `days or 7` WOULD BE WRONG: 0 is falsy, so `?movement=0` would silently
    # become a seven-day answer rather than being clamped. Absent means default;
    # a supplied 0 is an out-of-range number and clamps like any other.
    days = 7 if days is None else max(1, min(int(days), RETAIN_DAYS))
    con = _connect()
    try:
        _ensure(con)
        stored = [r[0] for r in con.execute("SELECT DISTINCT day FROM meta_snapshot ORDER BY day DESC")]
        if not stored:
            return {"basis": "none", "reason": "nothing stored yet", "snapshots": 0,
                    "latest": None, "comparedWith": None, "daysApart": None,
                    "requestedDays": days, "rows": []}

        latest = stored[0]
        target = (
            _dt.datetime.strptime(latest, "%Y-%m-%d") - _dt.timedelta(days=days)
        ).strftime("%Y-%m-%d")
        # The newest snapshot AT OR BEFORE the target day. A gap in the timer
        # widens the span rather than inventing one.
        older = next((d for d in stored if d <= target), None)
        if older is None:
            return {"basis": "none",
                    "reason": f"only {len(stored)} day(s) stored; nothing on or before {target}",
                    "snapshots": len(stored), "latest": latest, "comparedWith": None,
                    "daysApart": None, "requestedDays": days, "rows": []}

        now_rows, then_rows = _day_rows(con, latest), _day_rows(con, older)
        apart = (
            _dt.datetime.strptime(latest, "%Y-%m-%d") - _dt.datetime.strptime(older, "%Y-%m-%d")
        ).days

        rows = []
        for h, r in now_rows.items():
            p = then_rows.get(h)
            entered = p is None
            rows.append({
                "deckHash": h,
                "name": r["name"],
                "winCondition": r["win_condition"],
                "rank": r["rank"],
                "useRate": r["use_rate"],
                "winRate": r["win_rate"],
                "players": r["players"],
                # A deck that was not on the board did not move. See fault 2.
                "previousRank": None if entered else p["rank"],
                "rankDelta": None if entered else p["rank"] - r["rank"],
                "previousUseRate": None if entered else p["use_rate"],
                "useDelta": None if entered else round(r["use_rate"] - p["use_rate"], 4),
                "entered": entered,
                "left": False,
            })
        for h, p in then_rows.items():
            if h in now_rows:
                continue
            rows.append({
                "deckHash": h, "name": p["name"], "winCondition": p["win_condition"],
                "rank": None, "useRate": None, "winRate": None, "players": None,
                "previousRank": p["rank"], "rankDelta": None,
                "previousUseRate": p["use_rate"], "useDelta": None,
                "entered": False, "left": True,
            })

        # Biggest climbs first; entries and departures after the movers, since
        # neither carries a delta to sort by.
        rows.sort(key=lambda x: (x["rankDelta"] is None, -(x["rankDelta"] or 0)))
        return {"basis": "measured", "reason": None, "snapshots": len(stored),
                "latest": latest, "comparedWith": older, "daysApart": apart,
                "requestedDays": days, "notableRank": NOTABLE_RANK, "rows": rows}
    finally:
        con.close()


def status() -> dict:
    """For `/api/analytics/status`, so a stalled timer is visible."""
    try:
        con = _connect()
        try:
            _ensure(con)
            row = con.execute(
                "SELECT COUNT(DISTINCT day) n, MAX(day) newest, MIN(day) oldest FROM meta_snapshot"
            ).fetchone()
            return {"days": int(row["n"] or 0), "newest": row["newest"], "oldest": row["oldest"]}
        finally:
            con.close()
    except Exception:
        return {"days": 0, "newest": None, "oldest": None}


if __name__ == "__main__":
    import argparse
    import json

    ap = argparse.ArgumentParser(description="Deckkies meta history")
    ap.add_argument("--snapshot", action="store_true", help="store today's board")
    ap.add_argument("--movement", type=int, metavar="DAYS", help="print movement over DAYS")
    ap.add_argument("--status", action="store_true")
    a = ap.parse_args()

    if a.snapshot:
        import meta as meta_board

        # The board is computed in the background; ask for it and wait for the
        # scan rather than storing the empty envelope that comes back first.
        meta_board.refresh(force=True)
        print(json.dumps(snapshot(meta_board.board()), indent=1))
    if a.movement:
        m = movement(a.movement)
        print(json.dumps({k: v for k, v in m.items() if k != "rows"}, indent=1))
        for r in m["rows"][:15]:
            mark = "NEW" if r["entered"] else ("GONE" if r["left"] else f"{r['rankDelta']:+d}")
            print(f"  {mark:>5}  {str(r['rank'] or '-'):>3}  {r['name'][:40]}")
    if a.status:
        print(json.dumps(status(), indent=1))
