"""What each player was actually shown, so today's deck can differ from it.

REPORTED 2026-10-12: "the decks should change every day for players as they
see on the dashboard, and it must be different win cons / decks, not the same
type". The picking rule (`coach_session.practise`) can only honour that if it
knows what was on the screen before, and nothing did: every request recomputed
from the same thirty days, so the same matchup produced the same deck.

WHY A STORED LOG AND NOT A RECOMPUTATION. "Different from yesterday" computed
without state needs yesterday's pick, which needs the day before's, and so on
without end; cutting the chain anywhere gives an answer that can disagree with
what the reader really saw, because the window moved under it. The only
reading of "what they saw" that cannot drift is what was served.

ITS OWN SQLITE FILE (`server/.coach_sessions.db`, gitignored -- it holds
player tags), the call `meta_history.py` and `tracking.py` already make: the
bot's database stays `mode=ro`. One row per (player, day, list), a few dozen
bytes, pruned past `RETAIN_DAYS`.

EVERYTHING HERE DEGRADES TO "NOTHING REMEMBERED". A read that fails returns no
history and a write that fails is dropped: the session then repeats itself the
way it used to, which is the old behaviour and never an error on a coach's
main screen.

A DAY'S OWN ROWS ARE NEVER READ BACK FOR THAT DAY. `recent()` returns sessions
strictly BEFORE the day asked about, so asking twice in one day gives the same
deck twice -- the plan is stable through the day and only moves when the day
or the player's games do.
"""

from __future__ import annotations

import datetime as _dt
import os
import sqlite3
import threading
import time

DB_PATH = os.getenv(
    "CLASH_SESSION_LOG_DB",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".coach_sessions.db"),
)

#: Days of rows kept. The picking rule looks back `LOOKBACK_DAYS`; the rest is
#: slack for a coach reviewing a past day.
RETAIN_DAYS = 45

#: How far back a served session still counts. Past this a deck is fair to
#: offer again -- nobody remembers a practice deck from three weeks ago, and a
#: bound keeps a returning player from being locked out of their best answer.
LOOKBACK_DAYS = 14

_PRUNE_EVERY_S = 3600.0
_last_prune = 0.0
_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, timeout=5.0)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        """CREATE TABLE IF NOT EXISTS served (
               tag      TEXT NOT NULL,
               day      TEXT NOT NULL,
               deck_key TEXT NOT NULL,
               family   TEXT NOT NULL,
               focus    TEXT,
               at       TEXT NOT NULL,
               PRIMARY KEY (tag, day, deck_key)
           )"""
    )
    return con


def _iso(day) -> str:
    return day.isoformat() if hasattr(day, "isoformat") else str(day)[:10]


def recent(tag: str, day, sessions: int = 6) -> list[dict]:
    """The last `sessions` days BEFORE `day` on which this player was served a
    practice deck, newest first: `[{day, families: set, keys: set}]`.

    A day can hold more than one list (the focus moved during it, or a coach
    looked through a different window); all of them were on a screen, so all
    of them count as seen.
    """
    try:
        # A READ NEVER CREATES THE FILE. Only a served deck does.
        if not os.path.exists(DB_PATH):
            return []
        d = _dt.date.fromisoformat(_iso(day))
        floor = (d - _dt.timedelta(days=LOOKBACK_DAYS)).isoformat()
        con = _connect()
        try:
            rows = con.execute(
                "SELECT day, deck_key, family FROM served"
                " WHERE tag = ? AND day < ? AND day >= ? ORDER BY day DESC",
                (tag, d.isoformat(), floor),
            ).fetchall()
        finally:
            con.close()
    except Exception:  # noqa: BLE001
        return []
    out: list[dict] = []
    for dy, key, family in rows:
        if not out or out[-1]["day"] != dy:
            if len(out) >= sessions:
                break
            out.append({"day": dy, "families": set(), "keys": set()})
        out[-1]["families"].add(family)
        out[-1]["keys"].add(key)
    return out


def avoid(history: list[dict], family_sessions: int, deck_sessions: int) -> tuple[list, set]:
    """`(win conditions per session, newest first; lists)` the next pick should
    not repeat. The win conditions stay per session so the picker can forgive
    the oldest first and yesterday's last."""
    fams: list = []
    keys: set = set()
    for i, s in enumerate(history):
        if i < family_sessions:
            fams.append(set(s["families"]))
        if i < deck_sessions:
            keys |= s["keys"]
    return fams, keys


def record(tag: str, day, deck_key: str, family: str, focus: str | None = None) -> bool:
    """Note that this list was put in front of this player on `day`."""
    global _last_prune
    if not tag or not deck_key:
        return False
    try:
        now = _dt.datetime.now(_dt.timezone.utc)
        with _lock:
            con = _connect()
            try:
                con.execute(
                    "INSERT INTO served (tag, day, deck_key, family, focus, at)"
                    " VALUES (?, ?, ?, ?, ?, ?)"
                    " ON CONFLICT(tag, day, deck_key) DO UPDATE SET"
                    " family = excluded.family, focus = excluded.focus, at = excluded.at",
                    (tag, _iso(day), deck_key, family or "", focus,
                     now.strftime("%Y-%m-%dT%H:%M:%SZ")),
                )
                if time.time() - _last_prune > _PRUNE_EVERY_S:
                    _last_prune = time.time()
                    con.execute(
                        "DELETE FROM served WHERE day < ?",
                        ((now.date() - _dt.timedelta(days=RETAIN_DAYS)).isoformat(),),
                    )
                con.commit()
            finally:
                con.close()
        return True
    except Exception:  # noqa: BLE001
        return False


def status() -> dict:
    """Counts only -- never a tag. Rides on `/api/analytics/status`."""
    try:
        if not os.path.exists(DB_PATH):
            return {"available": False, "rows": 0}
        con = _connect()
        try:
            n, players, newest = con.execute(
                "SELECT COUNT(*), COUNT(DISTINCT tag), MAX(day) FROM served").fetchone()
        finally:
            con.close()
        return {"available": True, "rows": int(n or 0), "players": int(players or 0),
                "newest": newest}
    except Exception:  # noqa: BLE001
        return {"available": False, "rows": 0}
