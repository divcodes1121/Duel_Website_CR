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



def _tier_paths() -> list[str]:
    """Every readable tier, hot first. The archive is simply absent from this
    list when the drive is not connected — callers never branch on it."""
    out = []
    hot = resolve_db_path()
    if hot:
        out.append(hot)
    if archive_available() and os.path.exists(ARCHIVE_DB_PATH):
        out.append(ARCHIVE_DB_PATH)
    return out


def coverage(tag: str | None = None) -> dict:
    """Earliest and latest battle date actually stored, as 'YYYY-MM-DD'.

    Reported per tier and merged. This is what lets the UI offer the range it
    genuinely has instead of a hardcoded 30 days — the hot tier holds ~70 days
    and the archive reaches back further again.
    """
    spans = []
    for path in _tier_paths():
        try:
            con = connect(path)
            try:
                if tag:
                    r = con.execute(
                        "SELECT MIN(battle_time) a, MAX(battle_time) b FROM battles "
                        "WHERE player_tag = ?",
                        (tag,),
                    ).fetchone()
                else:
                    r = con.execute(
                        "SELECT MIN(battle_time) a, MAX(battle_time) b FROM battles"
                    ).fetchone()
                if r and r["a"] and r["b"]:
                    spans.append((r["a"][:8], r["b"][:8]))
            finally:
                con.close()
        except Exception:
            continue
    if not spans:
        return {"start": None, "end": None, "days": 0}
    start = min(s for s, _ in spans)
    end = max(e for _, e in spans)
    import datetime as _dt

    d0 = _dt.date(int(start[:4]), int(start[4:6]), int(start[6:8]))
    d1 = _dt.date(int(end[:4]), int(end[4:6]), int(end[6:8]))
    return {
        "start": f"{start[:4]}-{start[4:6]}-{start[6:8]}",
        "end": f"{end[:4]}-{end[4:6]}-{end[6:8]}",
        "days": (d1 - d0).days + 1,
    }


def _compact(day: str | None) -> str | None:
    """'2026-08-10' -> '20260810'. Already-compact input passes through."""
    if not day:
        return None
    d = str(day).replace("-", "")
    return d[:8] if len(d) >= 8 else None


def player_report(tag: str, since: str | None = None, until: str | None = None) -> dict | None:
    """Everything the analysis screen needs, for an explicit date window.

    Deck rows are aggregated from `battles` inside the window rather than read
    from `player_deck_agg`, which is lifetime-only. That is what makes the date
    range mean anything: pick a different window and the ranking, the use rates
    and the totals all change with it.

    Both tiers are summed when the archive is mounted and the window reaches
    past what the hot tier holds; otherwise only the hot tier is opened.
    """
    tiers = _tier_paths()
    if not tiers:
        return None

    lo = _compact(since) or "00000000"
    hi = (_compact(until) or "99999999") + "￿"  # inclusive of the whole end day

    deck_rows: dict[str, list] = {}   # hash -> [battles, wins, draws, last_seen]
    totals = [0, 0, 0]                # battles, wins, losses
    crowns = [0, 0]
    per_day: dict[tuple[str, str], list[int]] = {}
    day_totals: dict[str, int] = {}
    archive_used = False

    # The archive holds EVERY battle ever, including the ones still sitting in
    # the hot tier — so querying both over the same dates counts the overlap
    # twice (70 days reported 4,406 battles against a lifetime total of 2,070).
    # Partition the window by date instead: the hot tier answers from its own
    # earliest row onward, the archive answers only for what predates that.
    hot_from = None
    if tiers:
        try:
            con = connect(tiers[0])
            try:
                r = con.execute(
                    "SELECT MIN(battle_time) m FROM battles WHERE player_tag = ?", (tag,)
                ).fetchone()
                hot_from = (r["m"] or "")[:8] or None
            finally:
                con.close()
        except Exception:
            hot_from = None

    def window_for(idx: int) -> tuple[str, str] | None:
        if idx == 0:
            return (max(lo, hot_from) if hot_from else lo), hi
        if not hot_from or lo >= hot_from:
            return None            # hot tier already covers it all
        return lo, hot_from + "\x00"   # strictly before the hot tier's first day

    for idx, path in enumerate(tiers):
        win = window_for(idx)
        if win is None:
            continue
        w_lo, w_hi = win
        try:
            con = connect(path)
        except Exception:
            continue
        try:
            rows = con.execute(
                "SELECT player_deck_hash h, substr(battle_time,1,8) d, "
                "       COUNT(*) n, "
                "       SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) w, "
                "       SUM(CASE WHEN result='draw' THEN 1 ELSE 0 END) dr, "
                "       SUM(COALESCE(player_crowns,0)) cf, "
                "       SUM(COALESCE(opponent_crowns,0)) ca, "
                "       MAX(battle_time) last "
                "FROM battles WHERE player_tag = ? AND battle_time >= ? AND battle_time <= ? "
                "GROUP BY h, d",
                (tag, w_lo, w_hi),
            ).fetchall()
        except Exception:
            rows = []
        finally:
            con.close()

        if rows and idx > 0:
            archive_used = True

        for r in rows:
            h, d, n, w, dr = r["h"] or "", r["d"], r["n"] or 0, r["w"] or 0, r["dr"] or 0
            cell = deck_rows.setdefault(h, [0, 0, 0, ""])
            cell[0] += n
            cell[1] += w
            cell[2] += dr
            cell[3] = max(cell[3], r["last"] or "")
            totals[0] += n
            totals[1] += w
            totals[2] += max(0, n - w - dr)
            crowns[0] += r["cf"] or 0
            crowns[1] += r["ca"] or 0
            day = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
            pd = per_day.setdefault((h, day), [0, 0])
            pd[0] += n
            pd[1] += w
            day_totals[day] = day_totals.get(day, 0) + n

    if not deck_rows:
        return None

    # Deck metadata (archetype, elixir) comes from whichever tier has it.
    meta: dict[str, sqlite3.Row] = {}
    top_hashes = [h for h, _ in sorted(deck_rows.items(), key=lambda kv: -kv[1][0])][:25]
    if top_hashes:
        ph = ",".join("?" for _ in top_hashes)
        for path in tiers:
            missing = [h for h in top_hashes if h not in meta]
            if not missing:
                break
            try:
                con = connect(path)
                try:
                    for r in con.execute(
                        "SELECT deck_hash, archetype, avg_elixir, win_condition "
                        "FROM decks WHERE deck_hash IN (%s)" % ph,
                        top_hashes,
                    ):
                        meta.setdefault(r["deck_hash"], r)
                finally:
                    con.close()
            except Exception:
                continue

    name = None
    tracked = False
    for path in tiers:
        try:
            con = connect(path)
            try:
                if name is None:
                    nr = con.execute(
                        "SELECT name FROM player_names WHERE tag = ?", (tag,)
                    ).fetchone()
                    if nr:
                        name = nr["name"]
                if not tracked:
                    tracked = (
                        con.execute(
                            "SELECT 1 FROM tracked_players WHERE tag = ?", (tag,)
                        ).fetchone()
                        is not None
                    )
            finally:
                con.close()
        except Exception:
            continue

    decks = []
    for i, h in enumerate(top_hashes):
        battles, wins, draws, last = deck_rows[h]
        m = meta.get(h)
        decks.append(
            {
                "rank": i + 1,
                "name": _archetype_title(m["archetype"] if m else None),
                "deckHash": h,
                "cards": [c for c in h.split(",") if c][:8],
                "useRate": round(battles / totals[0] * 100, 1) if totals[0] else 0.0,
                "winRate": round(wins / battles * 100, 1) if battles else 0.0,
                "matches": battles,
                "wins": wins,
                "losses": max(0, battles - wins - draws),
                "avgElixir": (m["avg_elixir"] if m else None),
                "winCondition": (m["win_condition"] if m else None),
                "lastSeen": last,
            }
        )

    days = sorted(day_totals)
    series = []
    for d in decks[:10]:
        h = d["deckHash"]
        use, win = [], []
        for day in days:
            n, w = per_day.get((h, day), [0, 0])
            dt = day_totals.get(day, 0)
            use.append(round(n / dt * 100, 2) if dt else 0.0)
            win.append(round(w / n * 100, 2) if n else 0.0)
        series.append({"deckHash": h, "use": use, "win": win})

    return {
        "player": {
            "name": name or tag,
            "tag": tag,
            "verified": tracked,
            "battles": totals[0],
            "wins": totals[1],
            "losses": totals[2],
            "draws": max(0, totals[0] - totals[1] - totals[2]),
            "crownsFor": crowns[0],
            "crownsAgainst": crowns[1],
        },
        "decks": decks,
        "trends": {"days": days, "series": series, "archiveUsed": archive_used},
    }


def suggest_tags(limit: int = 5) -> list[dict]:
    """A few real tags with the most data — so the demo chips always resolve."""
    path = resolve_db_path()
    if not path:
        return []
    try:
        con = connect(path)
    except Exception:
        return []
    try:
        rows = con.execute(
            "SELECT s.player_tag AS tag, s.battles, n.name "
            "FROM player_stats_agg s LEFT JOIN player_names n ON n.tag = s.player_tag "
            "ORDER BY s.battles DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [{"tag": r["tag"], "name": r["name"], "battles": r["battles"]} for r in rows]
    except Exception:
        return []
    finally:
        con.close()


# --------------------------------------------------------------------------
# Clash Royale API — the few fields the databases do not carry
# --------------------------------------------------------------------------
#
# battles.db stores match history, not profiles, so trophies and arena have to
# come from the live API. Everything here is best-effort: no token, no network,
# or a rate limit all return None and the screen falls back to stored numbers.

CR_API_BASE = os.getenv("CR_API_BASE", "https://api.clashroyale.com/v1")
CR_TOKEN = os.getenv("CR_TOKEN", "")

# The bot keeps its credentials in its own .env; read them rather than making
# the user copy a 500-character token into a second place.
_BOT_ENV = os.path.join(_DESKTOP, ".env")


def _load_bot_env() -> None:
    global CR_API_BASE, CR_TOKEN
    if CR_TOKEN or not os.path.exists(_BOT_ENV):
        return
    try:
        with open(_BOT_ENV, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k == "CR_TOKEN" and not CR_TOKEN:
                    CR_TOKEN = v
                elif k == "CR_API_BASE":
                    CR_API_BASE = v
    except Exception:
        pass


_load_bot_env()

_profile_cache: dict[str, tuple[dict | None, float]] = {}
_PROFILE_TTL_S = 300.0


def cr_profile(tag: str) -> dict | None:
    """Trophies, best trophies, arena and level from the live CR API.

    Returns None on any failure — the caller shows stored stats instead. Cached
    for five minutes so re-sorting or changing the date range does not spend a
    rate-limit slot.

    The User-Agent matters: the RoyaleAPI proxy answers 403 to Python's default
    urllib agent, which is what made this look like a bad token at first.
    """
    if not CR_TOKEN:
        return None
    now = time.monotonic()
    hit = _profile_cache.get(tag)
    if hit and now - hit[1] < _PROFILE_TTL_S:
        return hit[0]

    import urllib.parse
    import urllib.request

    out = None
    try:
        url = CR_API_BASE.rstrip("/") + "/players/" + urllib.parse.quote(tag)
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": "Bearer " + CR_TOKEN,
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (RoyalArena analytics)",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            d = json.load(resp)
        out = {
            "name": d.get("name"),
            "trophies": d.get("trophies"),
            "bestTrophies": d.get("bestTrophies"),
            "expLevel": d.get("expLevel"),
            "arena": (d.get("arena") or {}).get("name"),
            "clan": (d.get("clan") or {}).get("name"),
        }
    except Exception:
        out = None
    _profile_cache[tag] = (out, now)
    return out
