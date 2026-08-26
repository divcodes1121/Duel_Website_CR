"""The enrolment queue for tags this site has been asked about.

WHY THIS FILE EXISTS AT ALL. Searching a tag nobody has ever searched should
start collecting that player's history, and the bot already has the mechanism —
a `tracked_players` table it polls. The obvious implementation is to INSERT into
it. This module deliberately does not.

`clash_data.connect` opens every one of the bot's databases with `mode=ro`, and
that is not a style choice: it is the reason a bug in this codebase cannot
corrupt 43 GB of someone else's data, and it is stated as a guarantee in both
READMEs. Adding one read-write handle for one statement removes the guarantee
for the whole process — after that, "this API cannot write to the bot's data" is
no longer true, and the next person to need a write has a precedent instead of a
decision.

So the queue is OURS. This module owns exactly one file, creates it, and is the
only thing that writes anywhere:

    server/.tracking.db      tag_requests(tag, requested_at, hits, source)

The bot picks tags up from there and enrols them in its own table on its own
terms. Until it does, `status()` reports the request as `pending`, and the
screen says so rather than implying collection has begun.

THE BOT SIDE IS BUILT. `drain_tag_requests()` (`Clash_Bot/bot.py:5030`) opens
this file `mode=ro`, takes up to `CLASH_TAG_DRAIN_BATCH` tags oldest-first and
runs each through `clashdb.add_tracked_player` — the same door a Discord command
goes through, so it validates against `TAG_CHARS` and a junk tag from a URL
cannot get in. This docstring said the handoff did not exist for long enough
that `CLOUD_MIGRATION.md` had to warn readers it was lying.

**It is gated on the bot's `CLASH_TRACKING_DB` pointing here.** Unset, the drain
returns `(0, 0)` silently — no error, no log line — and every tag queued here
stays `pending` forever. That is the failure mode to check first if enrolment
appears to have stopped, and it becomes the ONLY enrolment path once Discord is
retired: the other two (auto-tracking a `#TAG` pasted in chat, and
`sync_player_safe(track=True)` on every command) die with the commands.

Writing to the bot's database from here is still off the table — that is the
thing this file exists to avoid, and it is why the handoff is a queue rather
than a direct insert.

Reads of `tracked_players` are still just reads, so those go through the normal
read-only path and are exact.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time

import clash_data as cd

# Beside the two background snapshots, and gitignored with them — derived local
# state, not source.
DB_PATH = os.getenv(
    "CLASH_TRACKING_DB",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".tracking.db"),
)

_lock = threading.Lock()
_ready = False


def _connect() -> sqlite3.Connection:
    """Read-write, because this file is ours. Contrast `clash_data.connect`."""
    con = sqlite3.connect(DB_PATH, timeout=5.0, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def _ensure() -> None:
    global _ready
    if _ready:
        return
    with _lock:
        if _ready:
            return
        con = _connect()
        try:
            # WAL for the same reason the bot uses it: a reader must never block
            # on the writer, and this table is read on every search.
            con.execute("PRAGMA journal_mode=WAL")
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS tag_requests (
                    tag          TEXT PRIMARY KEY,
                    requested_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    hits         INTEGER NOT NULL DEFAULT 1,
                    source       TEXT
                )
                """
            )
            # The bot drains oldest-first, so it wants this index rather than a
            # scan of a table that only grows.
            con.execute(
                "CREATE INDEX IF NOT EXISTS idx_tag_requests_at "
                "ON tag_requests(requested_at)"
            )
            con.commit()
            _ready = True
        finally:
            con.close()


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def bot_tracked(tag: str) -> bool:
    """Is the bot already collecting this player?

    A plain read of the bot's own table, through the read-only path. False on
    any failure — the databases genuinely may not be mounted, and the honest
    answer then is "we cannot say it is tracked", which is what False means to
    every caller here.
    """
    path = cd.resolve_db_path()
    if not path:
        return False
    try:
        con = cd.connect(path)
    except Exception:
        return False
    try:
        row = con.execute(
            "SELECT 1 FROM tracked_players WHERE tag = ? LIMIT 1", (tag,)
        ).fetchone()
        return row is not None
    except Exception:
        # An older bot database may predate the table entirely.
        return False
    finally:
        con.close()


def request(tag: str, source: str = "search") -> dict:
    """Queue a tag for enrolment. Idempotent.

    A repeat search bumps `hits` and `last_seen_at` but never moves
    `requested_at` — the bot drains oldest-first, so rewriting that field would
    let a popular tag starve behind its own re-searches.
    """
    _ensure()
    now = _now()
    con = _connect()
    try:
        con.execute(
            """
            INSERT INTO tag_requests (tag, requested_at, last_seen_at, hits, source)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(tag) DO UPDATE SET
                last_seen_at = excluded.last_seen_at,
                hits = tag_requests.hits + 1
            """,
            (tag, now, now, source),
        )
        con.commit()
        row = con.execute(
            "SELECT requested_at, hits FROM tag_requests WHERE tag = ?", (tag,)
        ).fetchone()
        return {
            "requestedAt": row["requested_at"] if row else now,
            "hits": row["hits"] if row else 1,
        }
    finally:
        con.close()


def status(tag: str) -> dict:
    """What we can say about this tag's collection state, for the UI.

    The three states are deliberately distinct and the screen must not merge
    them, because they mean different things to someone waiting for data:

      tracked  — the bot is collecting; stored history will grow on its own.
      pending  — we have queued it; nothing is being collected YET.
      unknown  — never searched, never tracked.
    """
    _ensure()
    tracked = bot_tracked(tag)
    con = _connect()
    try:
        row = con.execute(
            "SELECT requested_at, last_seen_at, hits FROM tag_requests WHERE tag = ?",
            (tag,),
        ).fetchone()
    finally:
        con.close()

    return {
        "tag": tag,
        "tracked": tracked,
        "requested": row is not None,
        "requestedAt": row["requested_at"] if row else None,
        "lastSeenAt": row["last_seen_at"] if row else None,
        "hits": row["hits"] if row else 0,
        "state": "tracked" if tracked else ("pending" if row is not None else "unknown"),
    }


def pending(limit: int = 200) -> list[dict]:
    """Queued tags the bot has not enrolled yet, oldest request first.

    This is the read the bot's drain would use. Tags it has since picked up are
    filtered out here rather than deleted, so this module still never writes
    anywhere but its own file.
    """
    _ensure()
    con = _connect()
    try:
        rows = con.execute(
            "SELECT tag, requested_at, last_seen_at, hits, source "
            "FROM tag_requests ORDER BY requested_at LIMIT ?",
            (max(1, limit),),
        ).fetchall()
    finally:
        con.close()

    out = []
    for r in rows:
        if bot_tracked(r["tag"]):
            continue
        out.append(
            {
                "tag": r["tag"],
                "requestedAt": r["requested_at"],
                "lastSeenAt": r["last_seen_at"],
                "hits": r["hits"],
                "source": r["source"],
            }
        )
    return out
