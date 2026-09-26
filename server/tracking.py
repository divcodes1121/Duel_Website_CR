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
            # WHERE A QUEUE ROW GOES WHEN THE BOT HAS ENROLLED IT. The prune
            # below used to DELETE it, and the source and the request time went
            # with it — so the console could say how many tags were waiting and
            # never who had been queued, from where, or how long they waited.
            # Same columns plus the moment it left the queue; bounded by
            # `HISTORY_DAYS`.
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS tag_history (
                    tag          TEXT PRIMARY KEY,
                    requested_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    hits         INTEGER NOT NULL DEFAULT 1,
                    source       TEXT,
                    pruned_at    TEXT NOT NULL
                )
                """
            )
            con.execute(
                "CREATE INDEX IF NOT EXISTS idx_tag_history_at "
                "ON tag_history(requested_at)"
            )
            con.commit()
            _ready = True
        finally:
            con.close()


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _stamp(epoch: float) -> str:
    """The queue's own timestamp format, for an arbitrary moment."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


#: How long a row stays in `tag_history` after it was requested. Long enough
#: for the console's 90-day view; the table is one short row per enrolled tag.
HISTORY_DAYS = 120


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


#: Queue rows above which `request()` prunes what the bot has already enrolled.
#:
#: THE QUEUE IS DRAINED OLDEST-FIRST WITH A LIMIT, AND NOTHING DELETED IT.
#: The bot reads `SELECT tag FROM tag_requests ORDER BY requested_at LIMIT 200`
#: and skips any tag already in `tracked_players`. Rows were never removed
#: here, so once 200 lifetime requests had accumulated -- all of them long
#: since enrolled -- every drain would read the same 200 skips and NEVER SEE a
#: newer request. Enrolment freezes, permanently and silently: the site keeps
#: answering "pending" and nothing ever collects.
#:
#: A hundred people searching a hundred new tags is well inside one batch, so
#: that case was always fine. The failure is cumulative, not concurrent, which
#: is exactly the kind that arrives quietly weeks later.
#:
#: Fixed on THIS side because it is this module's table. The bot could equally
#: filter or delete, but the queue belongs to the website and the website is
#: the one thing here that already writes to it.
PRUNE_ABOVE = 100

#: Seconds between prunes, however many searches arrive.
#:
#: THE PRUNE IS CHEAP PER RUN AND EXPENSIVE PER REQUEST. It reads every row of
#: `tracked_players` -- thousands, and growing -- to find out which queued tags
#: are done. Firing that from `request()` unconditionally means a thousand
#: people searching at once perform a thousand full scans of the bot's table,
#: which turns a housekeeping job into the slowest thing on the path.
#:
#: Once a minute is plenty: the queue only has to stay under the bot's drain
#: batch of 200, and it is drained every two hours. The work is idempotent, so
#: a skipped run costs nothing.
PRUNE_EVERY_S = 60.0

#: Monotonic stamp of the last prune. Process-local on purpose — the API runs
#: as one process, and a shared clock for a job this cheap would be a database
#: write to save a database read.
_last_prune = 0.0


def prune_enrolled() -> int:
    """Drop queue rows the bot has already picked up. Returns rows removed.

    Still writes nowhere but its own file: the bot's `tracked_players` is read
    through the read-only path, exactly as `bot_tracked` does.

    Never raises. A failure here means the queue stays long, which is the
    status quo, and must never cost someone their search.
    """
    _ensure()
    tracked = bot_tracked_set()
    if not tracked:
        return 0

    con = _connect()
    try:
        queued = [r["tag"] for r in con.execute("SELECT tag FROM tag_requests")]
        done = [t for t in queued if t in tracked]
        if not done:
            return 0
        # MOVED, NOT DROPPED — see `tag_history` in `_ensure`.
        now = _now()
        con.executemany(
            """
            INSERT OR REPLACE INTO tag_history
                (tag, requested_at, last_seen_at, hits, source, pruned_at)
            SELECT tag, requested_at, last_seen_at, hits, source, ?
            FROM tag_requests WHERE tag = ?
            """,
            ((now, t) for t in done),
        )
        con.executemany("DELETE FROM tag_requests WHERE tag = ?", ((t,) for t in done))
        con.execute(
            "DELETE FROM tag_history WHERE requested_at < ?",
            (_stamp(time.time() - HISTORY_DAYS * 86400),),
        )
        con.commit()
        return len(done)
    except Exception:
        return 0
    finally:
        con.close()


def bot_tracked_set() -> set[str]:
    """Every tag the bot is already collecting, as a set. Empty on any failure.

    `bot_tracked()` answers for one tag and is right for a search; a bulk
    caller asking it two thousand times would open two thousand connections to
    a database on a spinning volume. This is the same read `prune_enrolled()`
    was already doing inline, lifted out so the recruiter shares it.

    Empty on failure means "we cannot say anything is tracked", which makes a
    caller queue tags it did not need to. That is the safe direction: the bot's
    drain skips an already-enrolled tag anyway, so the cost of being wrong here
    is a wasted row, not a wrong enrolment.
    """
    path = cd.resolve_db_path()
    if not path:
        return set()
    try:
        con = cd.connect(path)
    except Exception:
        return set()
    try:
        return {r[0] for r in con.execute("SELECT tag FROM tracked_players")}
    except Exception:
        return set()
    finally:
        con.close()


def queued_tags() -> set[str]:
    """Everything currently sitting in our own queue."""
    _ensure()
    con = _connect()
    try:
        return {r[0] for r in con.execute("SELECT tag FROM tag_requests")}
    finally:
        con.close()


def queue_depth() -> int:
    """How many tags are waiting. 0 if the queue has never been written.

    DOES NOT CREATE THE FILE. Every other reader here calls `_ensure()` first,
    which is right for them — they are on a path that is about to write. This
    one is read by `/api/analytics/status`, the single unauthenticated route,
    and a health probe that brings a database into existence as a side effect of
    being asked a question is doing something it was not asked to do.
    """
    if not os.path.exists(DB_PATH):
        return 0
    con = _connect()
    try:
        return con.execute("SELECT count(*) FROM tag_requests").fetchone()[0]
    except Exception:
        return 0
    finally:
        con.close()


def bulk_request(tags, source: str) -> int:
    """Queue many tags in ONE transaction. Returns how many rows are new.

    `request()` opens a connection, writes, reads back and may prune, all per
    tag — which is right for the one tag a search is about and is the wrong
    shape entirely for two thousand off a leaderboard. This does the same
    INSERT with the same conflict rule, once.

    It deliberately does NOT prune: the recruiter already filters against
    `bot_tracked_set()` before it calls here, so the rows this writes are by
    construction ones the bot has not enrolled, and a prune would scan the
    bot's whole table to discover exactly that.

    `requested_at` still never moves on conflict, for the reason `request()`
    gives — the drain is oldest-first and rewriting it starves a popular tag
    behind its own re-sightings.
    """
    _ensure()
    tags = [t for t in dict.fromkeys(tags) if t]
    if not tags:
        return 0
    now = _now()
    con = _connect()
    try:
        before = con.execute("SELECT count(*) FROM tag_requests").fetchone()[0]
        con.executemany(
            """
            INSERT INTO tag_requests (tag, requested_at, last_seen_at, hits, source)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(tag) DO UPDATE SET
                last_seen_at = excluded.last_seen_at,
                hits = tag_requests.hits + 1
            """,
            ((t, now, now, source) for t in tags),
        )
        con.commit()
        after = con.execute("SELECT count(*) FROM tag_requests").fetchone()[0]
        return after - before
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
        queued = con.execute("SELECT count(*) FROM tag_requests").fetchone()[0]
        out = {
            "requestedAt": row["requested_at"] if row else now,
            "hits": row["hits"] if row else 1,
        }
    finally:
        con.close()

    # Outside the connection above: prune_enrolled opens its own, and holding
    # two writers on one SQLite file is how this project earned its WAL notes.
    #
    # THROTTLED, because this is on the path of every search. See PRUNE_EVERY_S.
    global _last_prune
    if queued > PRUNE_ABOVE:
        now_m = time.monotonic()
        if now_m - _last_prune >= PRUNE_EVERY_S:
            _last_prune = now_m
            prune_enrolled()
    return out


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


def _epoch(stamp: str | None) -> float | None:
    """Seconds since the epoch for both formats this module meets: the queue's
    `2026-09-26T12:57:42Z` and the bot's `2026-09-26T13:06:58.476824+00:00`."""
    if not stamp:
        return None
    try:
        from datetime import datetime

        return datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _bot_rows() -> tuple[dict[str, str], bool]:
    """{tag: added_at} for every player the bot collects, and whether the read
    worked. A plain read through the read-only path, like `bot_tracked_set`."""
    path = cd.resolve_db_path()
    if not path:
        return {}, False
    try:
        con = cd.connect(path)
    except Exception:
        return {}, False
    try:
        return {r[0]: (r[1] or "") for r in con.execute("SELECT tag, added_at FROM tracked_players")}, True
    except Exception:
        return {}, False
    finally:
        con.close()


def _names(tags: list[str]) -> dict[str, str]:
    """In-game names for up to a few hundred tags, in batches. Empty on failure:
    the console then shows tags, which is what it showed before."""
    path = cd.resolve_db_path()
    if not path or not tags:
        return {}
    out: dict[str, str] = {}
    try:
        con = cd.connect(path)
    except Exception:
        return {}
    try:
        for i in range(0, len(tags), 400):
            chunk = tags[i : i + 400]
            q = "SELECT tag, name FROM player_names WHERE tag IN (%s)" % ",".join("?" * len(chunk))
            for r in con.execute(q, chunk):
                if r[1]:
                    out[r[0]] = r[1]
    except Exception:
        pass
    finally:
        con.close()
    return out


def activity(days: int = 30, limit: int = 300) -> dict:
    """WHO WAS QUEUED, FROM WHERE, AND WHETHER THE BOT HAS PICKED THEM UP.

    The console's Tracking view. Three answers from two tables:

      * every request in the window — the queue AND `tag_history`, so a tag the
        bot enrolled an hour ago is still listed — with its state: `waiting`
        (queued, not collected yet) or `collecting` (in the bot's
        `tracked_players`), when the bot added it and how long that took;
      * the bot's additions per day, each attributed to the source that queued
        it, or `direct` when no queue row exists (a Discord command, or an
        enrolment from before this history was kept);
      * the median wait from request to enrolment.

    Counts over the whole window; only the listed rows are capped at `limit`,
    and `truncated` says so. Reads the bot's table read-only; writes nothing.
    """
    days = max(1, min(int(days or 30), HISTORY_DAYS))
    limit = max(1, min(int(limit or 300), 2000))
    now = time.time()
    # WHOLE UTC DAYS: today and the `days - 1` before it. A rolling cut would
    # open the chart on a partial day, which draws as a dip that did not happen.
    since = _stamp((now // 86400 - (days - 1)) * 86400)
    day_ago = now - 86400

    _ensure()
    con = _connect()
    try:
        queued = [dict(r) for r in con.execute(
            "SELECT tag, requested_at, last_seen_at, hits, source FROM tag_requests")]
        history = [dict(r) for r in con.execute(
            "SELECT tag, requested_at, last_seen_at, hits, source, pruned_at FROM tag_history")]
    finally:
        con.close()

    bot, bot_ok = _bot_rows()

    # Where each tag came from, whenever it was asked for. A tag still in the
    # queue is the fresher record, so it wins over its own history row.
    origin: dict[str, dict] = {r["tag"]: r for r in history}
    origin.update({r["tag"]: r for r in queued})

    # ── the requests in the window ────────────────────────────────────────
    rows = []
    for r in origin.values():
        if (r["requested_at"] or "") < since:
            continue
        added = bot.get(r["tag"]) or None
        req = _epoch(r["requested_at"])
        got = _epoch(added)
        wait = round(got - req) if got is not None and req is not None and got >= req else None
        rows.append({
            "tag": r["tag"],
            "source": r["source"] or "unknown",
            "requestedAt": r["requested_at"],
            "lastSeenAt": r["last_seen_at"],
            "hits": r["hits"],
            "state": "collecting" if added else "waiting",
            "enrolledAt": added,
            "waitSeconds": wait,
            # Collected before anyone asked: the request found it already there.
            "alreadyTracked": bool(added) and wait is None,
        })
    rows.sort(key=lambda x: x["requestedAt"] or "", reverse=True)

    by_source: dict[str, dict[str, int]] = {}
    for x in rows:
        b = by_source.setdefault(x["source"], {"requested": 0, "collecting": 0, "waiting": 0})
        b["requested"] += 1
        b[x["state"]] += 1

    waits = sorted(x["waitSeconds"] for x in rows if x["waitSeconds"] is not None)
    median = None
    if waits:
        mid = len(waits) // 2
        median = waits[mid] if len(waits) % 2 else round((waits[mid - 1] + waits[mid]) / 2)

    # ── the bot's additions per day, by where they came from ──────────────
    daily: dict[str, dict[str, int]] = {}
    added_window = added_24h = 0
    for tag, added in bot.items():
        if not added or added < since:
            continue
        added_window += 1
        t = _epoch(added)
        if t is not None and t >= day_ago:
            added_24h += 1
        src = (origin.get(tag) or {}).get("source") or "direct"
        day = daily.setdefault(added[:10], {})
        day[src] = day.get(src, 0) + 1

    shown = rows[:limit]
    names = _names([x["tag"] for x in shown])
    for x in shown:
        x["name"] = names.get(x["tag"])

    waiting_now = sum(1 for r in queued if r["tag"] not in bot) if bot_ok else len(queued)
    return {
        "generatedAt": _stamp(now),
        "days": days,
        # False when the bot's table could not be read: every state then says
        # `waiting`, and the console must not present that as fact.
        "botRead": bot_ok,
        "tracked": len(bot),
        "queue": {"rows": len(queued), "waiting": waiting_now},
        "summary": {
            "requested": len(rows),
            "collecting": sum(1 for x in rows if x["state"] == "collecting"),
            "waiting": sum(1 for x in rows if x["state"] == "waiting"),
            "addedWindow": added_window,
            "added24h": added_24h,
            "medianWaitSeconds": median,
            "waitSample": len(waits),
        },
        "daily": [{"day": d, "bySource": daily[d]} for d in sorted(daily)],
        "bySource": by_source,
        "requests": shown,
        "truncated": len(rows) > len(shown),
    }
