"""
clash_data.py — read-only access to the Clash_Bot databases.

This mirrors the storage model the Discord bot already uses (see
Clash_Bot/clashdb.py and Clash_Bot/archive.py) rather than inventing a second
one:

    Tier 1  hot / operational   C:\\ClashBot\\data\\battles.db      (rolling window)
    Tier 2  permanent archive   H:\\ClashArchive\\archive.db        (never pruned)

Three properties matter here and are the whole reason this file exists:

1. EVERY path comes from an environment variable with a local default. That is
   the migration hook — moving to a VPS means setting CLASH_DB_PATH (and
   dropping the archive, or pointing it at network storage). No code changes.

2. The archive is NEVER assumed present. `archive_available()` copies the bot's
   approach: walk up to the nearest existing ancestor directory and test it,
   with a short TTL cache so an unplug/replug is noticed without a restart. If
   drive H: is not connected, every query silently answers from the hot DB
   alone. Nothing raises, nothing 500s, the site just shows the recent window.

3. Connections are strictly READ-ONLY (`mode=ro`). The bot writes to these
   files continuously; this process must never take a write lock or hold one
   open long enough to block a poll. WAL mode means our reads do not block its
   writes either.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time

# --------------------------------------------------------------------------
# Paths — env first, local default second. This is the migration seam.
# --------------------------------------------------------------------------
DB_PATH = os.getenv("CLASH_DB_PATH", r"C:\ClashBot\data\battles.db")
ARCHIVE_DB_PATH = os.getenv("CLASH_ARCHIVE_DB_PATH", r"H:\ClashArchive\archive.db")

# Fallbacks if the primary hot DB is missing (a fresh checkout, or a machine
# with only the desktop copy). Ordered best-first.
#
# NOTE the desktop candidate is battles-pre-retention.db, not battles.db —
# the latter exists there as a 4 KB empty stub with no tables in it. Picking a
# file purely because it exists is how that stub got selected and every query
# then died on "no such table"; see _has_schema below.
_DESKTOP = os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop", "Clash_Bot")
DB_FALLBACKS = [
    p
    for p in (
        os.getenv("CLASH_DB_FALLBACK", ""),
        os.path.join(_DESKTOP, "battles-pre-retention.db"),
        os.path.join(_DESKTOP, "battles.db"),
    )
    if p
]

# The tables this API actually reads. A candidate file must carry them to count
# as usable — existing on disk is not enough.
REQUIRED_TABLES = ("player_stats_agg", "player_deck_agg", "battles")

_AVAIL_TTL_S = 30.0
_avail_cache: tuple[bool, float] | None = None
_avail_lock = threading.Lock()


def _dir_of(path: str) -> str:
    return os.path.dirname(path) or "."


_schema_cache: dict[str, bool] = {}


def _has_schema(path: str) -> bool:
    """True when `path` is a readable SQLite file carrying REQUIRED_TABLES.

    Existence is not enough: an empty stub, a half-copied file, or a database
    from a different project all exist happily and then fail on first query.
    Result is cached per path — this runs on every request.
    """
    if path in _schema_cache:
        return _schema_cache[path]
    ok = False
    try:
        con = connect(path)
        try:
            names = {
                r["name"]
                for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            ok = all(t in names for t in REQUIRED_TABLES)
        finally:
            con.close()
    except Exception:
        ok = False
    _schema_cache[path] = ok
    return ok


def resolve_db_path() -> str | None:
    """The first candidate that both exists and carries the schema, else None.

    Returning None is a supported state, not an error: the API answers with an
    explicit "no database" rather than raising, so the site degrades instead of
    500-ing when neither the C: install nor a desktop copy is present.
    """
    for p in (DB_PATH, *DB_FALLBACKS):
        if p and os.path.exists(p) and _has_schema(p):
            return p
    return None


def archive_available(force: bool = False) -> bool:
    """True when the archive drive is mounted and the file is there.

    Same shape as archive.archive_available() in the bot: cached briefly so hot
    paths do not stat a USB volume on every request, re-probed on demand.
    """
    global _avail_cache
    now = time.monotonic()
    with _avail_lock:
        if not force and _avail_cache and now - _avail_cache[1] < _AVAIL_TTL_S:
            return _avail_cache[0]
        ok = False
        try:
            d = os.path.abspath(_dir_of(ARCHIVE_DB_PATH))
            while d and not os.path.isdir(d):
                parent = os.path.dirname(d)
                if parent == d:
                    break
                d = parent
            ok = bool(d) and os.path.isdir(d) and os.path.exists(ARCHIVE_DB_PATH)
        except Exception:
            ok = False
        _avail_cache = (ok, now)
        return ok


def connect(path: str) -> sqlite3.Connection:
    """Read-only connection. `mode=ro` is not advisory — SQLite refuses writes,
    so a bug here can never corrupt the bot's data."""
    uri = "file:" + path.replace("\\", "/") + "?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=5.0, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def sources() -> dict:
    """What the API is actually reading from, for the status endpoint."""
    hot = resolve_db_path()
    arc = archive_available(force=True)
    return {
        "hot": {
            "path": hot,
            "available": bool(hot),
            "sizeBytes": os.path.getsize(hot) if hot and os.path.exists(hot) else 0,
        },
        "archive": {
            "path": ARCHIVE_DB_PATH,
            "available": arc,
            "sizeBytes": os.path.getsize(ARCHIVE_DB_PATH) if arc else 0,
        },
    }


# --------------------------------------------------------------------------
# Queries
# --------------------------------------------------------------------------

def normalize_tag(tag: str) -> str | None:
    """'y022grcjq' -> '#Y022GRCJQ'. Mirrors clashdb.normalize_tag, including the
    14-symbol Supercell alphabet, so junk never reaches a query."""
    if not tag:
        return None
    chars = "0289PYLQGRJCUV"
    candidate = "#" + str(tag).strip().lstrip("#").upper()
    body = candidate[1:]
    if not (5 <= len(body) <= 12):
        return None
    if any(c not in chars for c in body):
        return None
    return candidate


def _archetype_title(archetype: str | None) -> str:
    if not archetype:
        return "Unknown Deck"
    return " ".join(w.capitalize() for w in archetype.replace("_", "-").split("-"))


def player_overview(tag: str) -> dict | None:
    """Summary strip + the player's decks, from the hot tier.

    deck_hash is itself the sorted comma-joined card list, so the eight card
    keys come straight off it — no join to `decks` needed for the art.
    """
    path = resolve_db_path()
    if not path:
        return None
    con = connect(path)
    try:
        cur = con.cursor()

        stats = cur.execute(
            "SELECT battles, wins, losses, draws, crowns_for, crowns_against, last_seen "
            "FROM player_stats_agg WHERE player_tag = ?",
            (tag,),
        ).fetchone()
        if not stats:
            return None

        name_row = cur.execute("SELECT name FROM player_names WHERE tag = ?", (tag,)).fetchone()
        tracked = cur.execute(
            "SELECT 1 FROM tracked_players WHERE tag = ?", (tag,)
        ).fetchone() is not None

        deck_rows = cur.execute(
            "SELECT pda.deck_hash, pda.battles, pda.wins, pda.draws, pda.archetype, "
            "       pda.last_seen, d.avg_elixir, d.win_condition "
            "FROM player_deck_agg pda "
            "LEFT JOIN decks d ON d.deck_hash = pda.deck_hash "
            "WHERE pda.player_tag = ? AND pda.battles > 0 "
            "ORDER BY pda.battles DESC LIMIT 25",
            (tag,),
        ).fetchall()

        total = stats["battles"] or 0
        decks = []
        for i, r in enumerate(deck_rows):
            cards = [c for c in (r["deck_hash"] or "").split(",") if c][:8]
            battles = r["battles"] or 0
            wins = r["wins"] or 0
            draws = r["draws"] or 0
            decks.append(
                {
                    "rank": i + 1,
                    "name": _archetype_title(r["archetype"]),
                    "deckHash": r["deck_hash"],
                    "cards": cards,
                    "useRate": round(battles / total * 100, 1) if total else 0.0,
                    "winRate": round(wins / battles * 100, 1) if battles else 0.0,
                    "matches": battles,
                    "wins": wins,
                    "losses": max(0, battles - wins - draws),
                    "avgElixir": r["avg_elixir"],
                    "winCondition": r["win_condition"],
                    "lastSeen": r["last_seen"],
                }
            )

        return {
            "player": {
                "name": name_row["name"] if name_row else tag,
                "tag": tag,
                "verified": tracked,
                "battles": total,
                "wins": stats["wins"] or 0,
                "losses": stats["losses"] or 0,
                "draws": stats["draws"] or 0,
                "crownsFor": stats["crowns_for"] or 0,
                "crownsAgainst": stats["crowns_against"] or 0,
                "lastSeen": stats["last_seen"],
            },
            "decks": decks,
        }
    finally:
        con.close()


def _iso_day(battle_time: str) -> str:
    """'20260810T110323.000Z' -> '2026-08-10'."""
    if not battle_time or len(battle_time) < 8:
        return ""
    return f"{battle_time[0:4]}-{battle_time[4:6]}-{battle_time[6:8]}"


def deck_trends(tag: str, deck_hashes: list[str], days: int = 30) -> dict:
    """Per-day use and win rate for the given decks.

    Two things keep this fast on a 12 GB hot tier and a 29 GB archive:

    * The window is pushed into SQL. `battle_time` is 'YYYYMMDDThhmmss.sssZ', so
      a plain string comparison is a correct date bound and uses the composite
      (player_tag, player_deck_hash) index instead of walking a player's whole
      history. Without this the pair of queries took ~17s.

    * The archive is only opened when the hot tier does not already reach back
      far enough. Most windows are well inside the retention cutoff, so the
      29 GB file is never touched.

    When the drive is absent the hot tier answers alone and `archiveUsed` is
    false, so the UI can say which tiers the numbers came from.
    """
    path = resolve_db_path()
    if not path or not deck_hashes:
        return {"days": [], "series": [], "archiveUsed": False}

    import datetime as _dt

    since = (_dt.datetime.utcnow() - _dt.timedelta(days=days)).strftime("%Y%m%d")

    placeholders = ",".join("?" for _ in deck_hashes)
    sql = (
        "SELECT player_deck_hash AS h, substr(battle_time,1,8) AS d, "
        "       COUNT(*) AS n, SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) AS w "
        "FROM battles WHERE player_tag = ? AND battle_time >= ? "
        "AND player_deck_hash IN (%s) "
        "GROUP BY h, d" % placeholders
    )
    params = [tag, since, *deck_hashes]

    buckets: dict[tuple[str, str], list[int]] = {}
    totals: dict[str, int] = {}

    def absorb(rows):
        for r in rows:
            day = _iso_day(r["d"] + "T")
            if not day:
                continue
            key = (r["h"], day)
            cell = buckets.setdefault(key, [0, 0])
            cell[0] += r["n"] or 0
            cell[1] += r["w"] or 0
            totals[day] = totals.get(day, 0) + (r["n"] or 0)

    con = connect(path)
    try:
        absorb(con.execute(sql, params).fetchall())
        # How far back the hot tier actually goes for this player. If it already
        # covers the window, the archive has nothing to add.
        earliest = con.execute(
            "SELECT MIN(battle_time) AS m FROM battles WHERE player_tag = ?", (tag,)
        ).fetchone()["m"]
    finally:
        con.close()

    hot_covers_window = bool(earliest) and earliest[:8] <= since

    archive_used = False
    if not hot_covers_window and archive_available():
        try:
            acon = connect(ARCHIVE_DB_PATH)
            try:
                absorb(acon.execute(sql, params).fetchall())
                archive_used = True
            finally:
                acon.close()
        except Exception:
            # A drive yanked mid-query must not take the request down.
            archive_used = False

    day_list = sorted({d for (_, d) in buckets})[-days:]
    series = []
    for h in deck_hashes:
        use, win = [], []
        for d in day_list:
            n, w = buckets.get((h, d), [0, 0])
            day_total = totals.get(d, 0)
            use.append(round(n / day_total * 100, 2) if day_total else 0.0)
            win.append(round(w / n * 100, 2) if n else 0.0)
        series.append({"deckHash": h, "use": use, "win": win})

    return {"days": day_list, "series": series, "archiveUsed": archive_used}


def suggest_tags(limit: int = 5) -> list[dict]:
    """A few real tags with the most data — used for the 'popular players' chips
    so the demo links point at something that actually resolves."""
    path = resolve_db_path()
    if not path:
        return []
    con = connect(path)
    try:
        rows = con.execute(
            "SELECT s.player_tag AS tag, s.battles, n.name "
            "FROM player_stats_agg s LEFT JOIN player_names n ON n.tag = s.player_tag "
            "ORDER BY s.battles DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [{"tag": r["tag"], "name": r["name"], "battles": r["battles"]} for r in rows]
    finally:
        con.close()
