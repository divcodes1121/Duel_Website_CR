"""
clash_data.py — read-only access to the Clash_Bot databases.

This mirrors the storage model the Discord bot already uses (see
Clash_Bot/clashdb.py and Clash_Bot/archive.py) rather than inventing a second
one:

    Tier 1  hot / operational   H:\\ClashBot\\data\\battles.db      (rolling window)
    Tier 2  permanent archive   H:\\ClashArchive\\archive.db        (never pruned)

BOTH TIERS MOVED TO H: ON 2026-08-17. Tier 1 was `C:\\ClashBot\\data` until then;
the bot's RETENTION_DAYS went 60 -> 150 and a five-month window (~28.5M battles,
28-41 GB) does not fit on the internal SSD. See Clash_Bot/CLAUDE.md ->
"Everything on H: — the 2026-08-17 move".

THERE IS NO LONGER A FALLBACK. The migration deleted both the old C: database
and the desktop `battles-pre-retention.db`; all that survives on the internal
disk is the 4 KB schema-less stub `Desktop/Clash_Bot/battles.db`, which
`_has_schema` correctly rejects. DB_FALLBACKS is kept because the candidates
are guarded by exists+schema and cost nothing when absent — but do not read it
as a safety net that still catches anything. H: is a hard dependency now,
exactly as it is for the bot.

Three properties matter here and are the whole reason this file exists:

1. EVERY path comes from an environment variable with a local default. That is
   the migration hook — moving to a VPS means setting CLASH_DB_PATH (and
   dropping the archive, or pointing it at network storage). No code changes.

2. The archive is NEVER assumed present. `archive_available()` copies the bot's
   approach: walk up to the nearest existing ancestor directory and test it,
   with a short TTL cache so an unplug/replug is noticed without a restart.

   WHAT THE MOVE CHANGED: an unplugged H: used to cost only the archive, since
   the hot tier lived on C:. Both tiers are now one failure domain, so a
   detached drive leaves NO database at all — `resolve_db_path()` returns None
   and every screen shows the explicit "no database" state. That is still a
   degradation rather than a 500, and it is now the ONLY degradation: the site
   can no longer quietly answer from an older local copy, because there is no
   longer an older local copy. /status reports which paths resolved.

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
DB_PATH = os.getenv("CLASH_DB_PATH", r"H:\ClashBot\data\battles.db")
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


#: A file the BOT can drop to get a reader-free window on the database.
#:
#: WHY THIS EXISTS. `battles.db` is WAL, and a WAL cannot be reset to zero while
#: any reader holds a snapshot. This site opens read-only, short-lived
#: connections and closes every one of them — but under load the connections
#: OVERLAP, so there is never a gap, and `PRAGMA wal_checkpoint(TRUNCATE)` folds
#: nothing however often the bot retries. The WAL then grows without bound (it
#: reached 5.66 GB), and once it is multi-gigabyte every query on both projects
#: crawls.
#:
#: The fix is not fewer connections — it is a scheduled gap. The bot creates
#: this file, checkpoints, and deletes it. While it exists every screen reports
#: "no database", which is a path this codebase already handles everywhere
#: because an unplugged H: does exactly the same thing.
MAINTENANCE_FLAG = os.getenv(
    "CLASH_DB_MAINTENANCE_FLAG",
    os.path.join(os.path.dirname(DB_PATH) if DB_PATH else ".", ".maintenance"))


def maintenance_mode() -> bool:
    """Is the bot asking us to let go of the database?"""
    try:
        return bool(MAINTENANCE_FLAG) and os.path.exists(MAINTENANCE_FLAG)
    except Exception:
        return False


def resolve_db_path() -> str | None:
    """The first candidate that both exists and carries the schema, else None.

    Returning None is a supported state, not an error: the API answers with an
    explicit "no database" rather than raising, so the site degrades instead of
    500-ing when neither the C: install nor a desktop copy is present.
    """
    if maintenance_mode():
        # Deliberately BEFORE the existence check. The database is fine; we are
        # standing back so the bot can fold its WAL.
        return None
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


# The bot's own ARCHETYPE_DISPLAY (duel_stats.py). Title-casing the stored key
# is close but wrong where it matters most: "xbow" is not "Xbow", "bait" is
# short for Log Bait, and "other" means the deck has no single win condition
# rather than that it belongs to an archetype called Other.
ARCHETYPE_DISPLAY = {
    "hog": "Hog Rider",
    "drill": "Goblin Drill",
    "graveyard": "Graveyard",
    "miner": "Miner",
    "bridge-spam": "Bridge Spam",
    "piggies": "Royal Hogs",
    "royal-giant": "Royal Giant",
    "lava": "Lava Hound",
    "giant": "Giant",
    "balloon": "Balloon",
    "e-giant": "Electro Giant",
    "golem": "Golem",
    "3-musk": "Three Musketeers",
    "mortar": "Mortar",
    "xbow": "X-Bow",
    "bait": "Log Bait",
    "other": "Mixed",
}


def _archetype_title(archetype: str | None) -> str:
    """Display name for a stored archetype key.

    An unknown key falls back to title case, so a newly added archetype still
    reads sanely instead of erroring or rendering raw.
    """
    key = (archetype or "").strip().lower()
    if not key or key == "none":
        return "Unknown Deck"
    hit = ARCHETYPE_DISPLAY.get(key.replace("_", "-"))
    if hit:
        return hit
    return " ".join(w.capitalize() for w in key.replace("_", "-").split("-"))


def deck_name(archetype: str | None, cards: list[str], card_meta: dict) -> str:
    """A name that is actually unique in a list of decks.

    The archetype alone is not: clustering merges tech variants but it cannot
    merge genuinely different decks that share a win condition, so a board of
    fifty printed "Hog" six times, "Bridge Spam" five times and "3 Musk" twice —
    and a player's opener list printed "Mortar" twice for the same reason.
    Those really are different decks; the label was just too coarse to say so.

    So the archetype is qualified by the deck's most expensive non-win-condition
    card, which is how players name these decks anyway ("Hog EQ", "Hog
    Musketeer"). Ties break on the card key so the name is stable across runs.

    `card_meta` maps a card key to at least {name, elixir, is_win_condition}.
    """
    base = _archetype_title(archetype)
    arch_key = (archetype or "").lower().replace("_", "-")
    best = None
    for c in cards:
        if c == arch_key:
            continue
        info = card_meta.get(c) or {}
        if info.get("is_win_condition"):
            continue
        cost = info.get("elixir") or 0
        if best is None or (cost, c) > (best[0], best[1]):
            best = (cost, c)
    if not best:
        return base
    label = (card_meta.get(best[1]) or {}).get("name") or best[1].replace("-", " ").title()
    return f"{base} {label}"



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


def tier_windows(tag: str, since: str | None,
                 until: str | None) -> list[tuple[str, str, str]]:
    """`[(db_path, from, to), ...]` — the window, partitioned across the tiers.

    THE ARCHIVE HOLDS EVERY BATTLE INCLUDING THE ONES STILL IN THE HOT TIER, so
    querying both over the same dates counts the overlap twice: 70 days once
    reported 4,406 battles against a lifetime total of 2,070. The hot tier
    therefore answers from its own earliest row onward and the archive only for
    what predates it.

    Extracted because three readers now need it (the player report, the duel
    rows, the card board) and the rule is subtle enough that a third hand-rolled
    copy would eventually drift. The archive slice is omitted entirely when the
    window does not reach past what the hot tier holds, which is why the 30 GB
    file is normally never opened.
    """
    tiers = _tier_paths()
    if not tiers:
        return []

    lo = _compact(since) or "00000000"
    hi = (_compact(until) or "99999999") + "￿"

    hot_from = None
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

    out: list[tuple[str, str, str]] = [
        (tiers[0], (max(lo, hot_from) if hot_from else lo), hi)
    ]
    for path in tiers[1:]:
        if hot_from and lo < hot_from:
            out.append((path, lo, hot_from + "\x00"))
    return out


def player_name(tag: str) -> str | None:
    """The in-game name behind a tag, or None if we have never seen one.

    The bot writes `player_names` on every sync, so this is the name as of the
    last time that player was polled rather than right now. That is the same
    freshness every other figure on the site has.

    Returns None rather than the tag: the CALLER decides what to show when
    there is no name, and a helper that quietly hands back a tag makes
    "unknown player" indistinguishable from "player called #ABC123".
    """
    if not tag:
        return None
    for path, _lo, _hi in _tier_paths_all():
        try:
            con = connect(path)
        except Exception:
            continue
        try:
            row = con.execute(
                "SELECT name FROM player_names WHERE tag = ?", (tag,)
            ).fetchone()
            if row and row["name"]:
                return row["name"]
        except Exception:
            pass
        finally:
            con.close()
    return None


def _tier_paths_all() -> list[tuple[str, str, str]]:
    """Every storage tier, unbounded — for lookups that are not time-scoped."""
    return [(p, "", "￿") for p in _tier_paths()]


def tracked_player_count() -> int:
    """How many players the bot is actually collecting.

    Read from the HOT tier only. The archive carries its own copy of
    `tracked_players` and merging the two would double-count everyone, since a
    tracked player appears in both — this is a population, not a span.

    Returns 0 rather than raising when no database resolves: an absent drive is
    a normal state here, and every other reader in this module treats it that
    way.
    """
    for path in _tier_paths():
        try:
            con = connect(path)
            try:
                row = con.execute("SELECT count(*) FROM tracked_players").fetchone()
                if row:
                    return int(row[0])
            finally:
                con.close()
        except Exception:
            continue
        break
    return 0


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
                        "SELECT deck_hash, archetype, avg_elixir, win_condition, cards "
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
                # PAYLOAD ORDER, not the hash. The hash is alphabetical, so
                # splitting it scatters the three special slots (evolution /
                # hero / champion) through the row. `decks.cards` preserves the
                # order Clash Royale sent, which is what puts them first.
                "cards": _deck_order(m, h),
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

    # Observed marks are looked up over the player's WHOLE history for the deck,
    # not the report window: how someone fields a deck is not a property of the
    # date range being viewed, and the lookup is indexed so it costs nothing.
    art, seats = deck_art(tag, [d["deckHash"] for d in decks[:10]], None)
    for d in decks[:10]:
        observed = art.get(d["deckHash"]) or {}
        # One path for both: the deck is arranged into its slots and the art
        # falls out of that arrangement.
        d["cards"], final = arrange_deck(
            d["cards"], observed, slot_of=seats.get(d["deckHash"]))
        if final:
            d["art"] = final
            if not observed:
                d["artInferred"] = True

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


def _deck_order(meta_row, deck_hash: str) -> list[str]:
    """A deck's eight cards in PAYLOAD order.

    Clash Royale's first three positions are the special slots — evolution,
    hero and champion. Measured on this data: of 795 decks whose payload carried
    evolution marks, all 795 had every mark inside slots 0-2 (slot 0 in 791,
    slot 1 in 569, slot 2 in 775).

    `deck_hash` is alphabetical and therefore useless for display; it only
    identifies. `decks.cards` keeps the real order, so that is preferred and the
    hash is the fallback for a deck the dimension table has not seen.
    """
    if meta_row is not None:
        try:
            cards = json.loads(meta_row["cards"] or "[]")
            if cards:
                return cards[:8]
        except Exception:
            pass
    return [c for c in (deck_hash or "").split(",") if c][:8]


# The three special slots. A deck's first three positions carry the evolution /
# hero / champion slots — measured: of 795 decks whose payload carried marks,
# all 795 had every mark inside slots 0-2.
SPECIAL_SLOTS = 3


# ── WHICH FORM A MARK IS: THE LEVEL SAYS SO, THE ART STRING DOES NOT ────────
#
# `player_evo` stores `[card_key, level, art]`, and every reader in this project
# used `art`. That was the root cause of "evolutions and heroes are not in
# place", and it is not a small error. Measured over 60,000 recent battles
# carrying marks (162,919 marks):
#
#     level 1  art 'evolution'   99,423   61.0%
#     level 2  art 'hero'        37,231   22.9%
#     level 2  art 'evolution'   14,960    9.2%   <- a HERO drawn as an evolution
#     level 1  art 'unknown'     11,305    6.9%   <- an EVOLUTION thrown away
#
# So 16.1% of all marks were wrong or discarded. The visible result was decks
# reporting THREE cards at ~100% 'evolution' when the game allows two: X-Bow
# Tesla came back with tesla 400/400, archers 398/400 and knight 392/400, and
# whichever two the code happened to keep, the hero was never one of them.
#
# `level` has no such ambiguity, and two independent checks say so.
#
#   * It is the slot. Of level-1 marks, 99.8% sit at index 0 or index 2 — the
#     two evolution slots — and NONE at index 1. Of level-2 marks, 87.1% sit at
#     index 1 and 12.7% at index 2 (the wild slot), and NONE at index 0. The two
#     levels are perfectly disjoint over the slots each is allowed to occupy.
#   * It matches the cards. Level 1 covers exactly the 42 cards `cardMeta` says
#     can evolve and level 2 exactly the 16 it says can be a hero — 162,919
#     marks, zero exceptions either way.
#
# And it agrees with the bot, whose `evolution_marks` docstring says plainly
# that `evolutionLevel` takes values 1 and 2 and that LEVEL 2 IS SERVED HERO
# ART. The `art` string is a derived field that loses that a sixth of the time;
# the level it was derived from is still right there in the same tuple.
EVOLUTION_LEVEL = 1
HERO_LEVEL = 2


def mark_variant(mark) -> str | None:
    """'evolution' | 'hero' | None for one `player_evo` entry.

    THE ONE PLACE THIS DECISION IS MADE. Four readers had their own copy of
    `if m[2] in ("evolution", "hero")` and all four were wrong in the same way,
    which is the argument for it being a function.

    The level decides. `art` is consulted only when the level is something other
    than 1 or 2, so a future payload that stops carrying a usable level degrades
    to the old reading instead of returning nothing.
    """
    if not isinstance(mark, (list, tuple)) or len(mark) < 2:
        return None
    level = mark[1]
    if level == EVOLUTION_LEVEL:
        return "evolution"
    if level == HERO_LEVEL:
        return "hero"
    art = mark[2] if len(mark) > 2 else None
    return art if art in ("evolution", "hero") else None


# HOW A CARD IS ACTUALLY FIELDED — measured, not assumed.
#
# The three special slots do have leanings (slot 0 evolution 91%, slot 1 hero
# 72%, slot 2 evolution 85%), and an earlier version inferred from those. But
# the slot is the wrong unit: slot 1 skews hero only because hero-only cards
# tend to sit there. THE CARD DECIDES.
#
# AN EARLIER MEASUREMENT HERE WAS BACKWARDS, and it is worth leaving the wreck
# visible. It read the `art` string and concluded that all four both-form cards
# are fielded as an EVOLUTION 100% of the time — "knight 586/586, valkyrie
# 867/867, musketeer 531/531, wizard 479/479 evolution" — and noted approvingly
# that not one card showed even a 20% minority reading. A unanimous result on a
# genuinely ambiguous question was the tell, and it was read as confirmation.
#
# Re-measured over 60,000 battles reading the LEVEL (see `mark_variant`), three
# of the four are mostly the opposite:
#
#     knight     75.7% hero (5,203)     musketeer  36.1% hero (4,427)
#     valkyrie   61.9% hero (7,870)     wizard     71.5% hero (6,354)
#
# The other twelve hero-capable cards come back 100% hero, as they must — they
# have no evolution to be confused with. That is the shape a correct reading
# has: unanimous where the card allows only one answer, split where it allows
# two.
#
# The fallback looks up what a card is really brought as, and only guesses from
# `can_evolve` / `can_be_hero` for a card never seen marked at all.
SPECIAL_SLOTS = 3

_ART_PROFILE: tuple[dict, float] | None = None
_ART_PROFILE_TTL_S = 1800.0
_ART_SAMPLE_ROWS = 6000


def card_art_profile() -> dict:
    """{card_key: 'evolution' | 'hero'} — how each card is usually fielded.

    Bounded and cached: a LIMIT-ed read of recent marked battles, refreshed
    every half hour. Cheap because `LIMIT` stops the scan early, and the answer
    barely moves — a card's special form is a property of the card.
    """
    global _ART_PROFILE
    now = time.monotonic()
    if _ART_PROFILE and now - _ART_PROFILE[1] < _ART_PROFILE_TTL_S:
        return _ART_PROFILE[0]

    tally: dict[str, dict[str, int]] = {}
    path = resolve_db_path()
    if path:
        try:
            con = connect(path)
            try:
                for r in con.execute(
                    "SELECT player_evo FROM battles "
                    "WHERE player_evo IS NOT NULL AND player_evo != '' "
                    "ORDER BY battle_time DESC LIMIT ?",
                    (_ART_SAMPLE_ROWS,),
                ):
                    try:
                        marks = json.loads(r["player_evo"])
                    except Exception:
                        continue
                    for m in marks:
                        v = mark_variant(m)
                        if v:
                            per = tally.setdefault(m[0], {})
                            per[v] = per.get(v, 0) + 1
            finally:
                con.close()
        except Exception:
            tally = {}

    # sorted() keeps ties stable so the profile does not flip between refreshes.
    profile = {c: max(sorted(k), key=lambda x: k[x]) for c, k in tally.items()}
    _ART_PROFILE = (profile, now)
    return profile


# ── WHAT EACH SPECIAL SLOT MAY HOLD ────────────────────────────────────────
#
# THE BOT DID NOT SETTLE THIS, so it is settled here and the reasoning is
# recorded. Clash_Bot/CLAUDE.md measured that marked cards cap at three per deck
# and states plainly that its data "cannot distinguish" 2-evolution-slots-plus-
# one from three special slots, warning against deriving a `player_hero` column
# until something does. Its own renderer (`card_art.build_image`) meanwhile
# checks `can_be_hero` FIRST in slots 0 and 1 — which would draw hero art in
# slot 1, a position measured at 92% evolution — and its CLAUDE.md describes a
# third arrangement again ("slots 1-2 evolution, slot 3 champion/hero"). Docs,
# code and measurement all disagree over there.
#
# The three special positions are NOT interchangeable, and this is the game's
# rule rather than a statistic (slots numbered as a player sees them):
#
#     slot 1  (index 0)   EVOLUTION only
#     slot 2  (index 1)   hero or champion            — never an evolution
#     slot 3  (index 2)   hero, evolution or champion — the "wild" slot
#
# A champion has neither an evolution nor a hero form, so wherever one is legal
# it simply draws as itself; that is why champions are skipped rather than
# listed in SLOT_ALLOWED. The rule caps a deck at TWO evolutions (slots 1 and
# 3), matching Clash Royale's two evolution slots, and the website's own duel
# builder already encodes the same shape (index 0 Evolution, 1 Hero, 2 Wild).
#
# THE STORED PAYLOAD DOES NOT CLEANLY AGREE, and that is why this is stated
# rather than inferred. Measured over ~8,000 recent marked battles:
#
#     slot 0   evolution 92%   unknown 8%
#     slot 1   hero      70%   evolution 30%
#     slot 2   evolution 83%   hero 11%   unknown 6%
#
# and 14% of single battles carry three evolution marks. The bot's own
# `evolution_marks` docstring says the same thing in more detail: `evolutionLevel`
# takes values 1 and 2, level 2 is served hero art, and it explicitly records
# that "2 evolution slots + 1 other special slot" versus "3 special slots"
# CANNOT be settled from the stored columns.
#
# So the marks say which cards are special and what art each can wear; the slot
# rule below decides what may actually be drawn. Rendering the raw majority put
# three evolution frames on decks that cannot have three.
SLOT_ALLOWED = ({"evolution"}, {"hero"}, {"evolution", "hero"})

# HOW MANY OF EACH FORM A DECK CAN FIELD. Not "two evolutions and one hero" —
# that was this file's first answer and it is wrong, because it reads slot 3 as
# an evolution slot when slot 3 takes EITHER form. What the three slots allow:
#
#     slot 1 (index 0)   evolution, or nothing
#     slot 2 (index 1)   hero, or nothing
#     slot 3 (index 2)   evolution OR hero, or nothing
#
# so two evolutions, two heroes, and at most THREE marks in total. Measured over
# 60,000 battles, by slot, which is the same table read off real loadouts:
#
#     evolution / hero / evolution   62.96%      evolution / hero / -    2.88%
#     evolution /  -   / evolution   21.60%      evolution /  -  / hero  1.57%
#     evolution / hero / HERO         9.25%      the rest               <1.8%
#
# Capping heroes at one made that third row undrawable, and it is not a corner:
# 5,540 of 60,000 battles. It was reported as a Lava Hound deck whose slot 3
# hero Valkyrie rendered plain — one fix breaking another, correctly spotted.
# The total cap is what stops a pooled sample drawing five marks; the per-form
# caps are what keep it legal.
MAX_EVOLUTIONS = 2
MAX_HEROES = 2
MAX_SPECIAL = 3


def cap_special_marks(observed: list[tuple[int, str, str]]) -> dict[str, str]:
    """Keep only as many observed marks as there are slots to draw them in.

    `observed` is [(times_seen, card_key, 'evolution' | 'hero')]. Returns
    {card: variant} holding at most MAX_EVOLUTIONS evolutions, at most
    MAX_HEROES heroes, and at most MAX_SPECIAL marks in total — THE
    MOST-OBSERVED ONES, ties broken on the key so the same evidence always
    renders the same way.

    The total is a separate limit from the per-form ones and both are needed.
    Two evolutions and two heroes are each individually legal but there are only
    three slots, so when both forms are full the weaker of the two second-place
    marks is the one that cannot be drawn — slot 3 is the single seat they are
    competing for.

    THIS REPLACED A POSITIONAL FILTER, and the difference is not cosmetic. Both
    art lookups used to discard any mark on a card that was not in the first
    three entries of the deck's STORED order, reasoning that only the three
    special positions can carry art. The cap is right; the test was wrong.
    `decks.cards` is one payload's order — measured, 0 of 20,000 rows are merely
    alphabetical, so it is real data — but it is ONE player's arrangement, while
    the marks are pooled over everybody who played those eight cards. A deck's
    habitual hero sitting in slot 8 of the representative's copy is not evidence
    that it is not the hero; it is evidence that the representative is not the
    majority.

    Measured on the live board: the positional filter threw away 23 marks across
    21 of the 50 meta decks — Berserker as a hero five separate times, Tesla and
    Knight as evolutions, a Lumberjack evolution. Those decks then drew a plain
    card in a special slot, which is exactly the "evolutions and heroes are not
    in place" the board was reported for.

    So the slot rule is enforced where the slots are actually decided — here for
    how many, and in `arrange_deck` for which position each one lands in — and
    never against an order that has no authority over pooled evidence.
    """
    # Strongest first, ties on the key. One ordering serves both the per-form
    # trim and the fight over slot 3.
    def rank(want, limit):
        rows = sorted((r for r in observed if r[2] == want), key=lambda r: (-r[0], r[1]))
        return rows[:limit]

    evos = rank("evolution", MAX_EVOLUTIONS)
    heroes = rank("hero", MAX_HEROES)

    # Slots 1 and 2 are each owned by one form outright; only what is left over
    # competes, and only for slot 3.
    kept = evos[:1] + heroes[:1]
    contenders = sorted(evos[1:] + heroes[1:], key=lambda r: (-r[0], r[1]))
    kept += contenders[: max(0, MAX_SPECIAL - len(kept))]

    return {card: variant for _, card, variant in kept}


def _apply_wild(ordered: list[str], art: dict, wild: str | None, kind) -> tuple[list[str], dict]:
    """The caller's slot-3 choice, applied LAST and to every path.

    It used to live inside the trust-order branch alone, so it worked on a deck
    nobody had played and did nothing on a deck the meta board had marks for —
    which is most of the decks anyone pastes. From the outside that is a button
    that does not work, and it is the same button either way.

    An explicit choice outranks both inference and observation, because the
    person pasting the deck is telling us what their deck is; a pooled mark says
    what other people's copies were fielded as. It cannot invent a form the card
    does not have.
    """
    if wild not in ("evolution", "hero") or len(ordered) < 3:
        return ordered, art
    card = ordered[2]
    k = kind(card)
    if (wild == "hero" and k in ("hero", "both")) or        (wild == "evolution" and k in ("evolution", "both")):
        art = dict(art)
        art[card] = wild
    return ordered, art


def arrange_deck(cards: list[str], marks: dict, trust_order: bool = False,
                 wild: str | None = None,
                 slot_of: dict[str, int] | None = None) -> tuple[list[str], dict]:
    """Order a deck into its slots and say what art each special slot draws.

    Returns (ordered_cards, {card: 'evolution' | 'hero'}).

    `marks` is `{card: 'evolution' | 'hero'}` for the cards this deck was
    OBSERVED being fielded with — pass it whenever it is known, because it
    decides the answer. Only a deck with no record at all falls back to reading
    the slots off what its cards are capable of, and callers flag that case to
    the UI rather than letting a guess pass for an observation.

    WHY THE STORED ORDER IS NOT ENOUGH. `decks.cards` is usually the payload
    order, and usually that already puts the special cards first — but not
    always. One X-Bow deck on the meta board arrived with its Tesla evolution in
    the hero slot and its remaining special card past position three, so the
    slots could not be filled and the row rendered almost entirely plain.

    So the deck is arranged from what its cards ARE rather than from the order
    they happened to be stored in:

        slot 1  an evolution
        slot 2  a hero, or a champion
        slot 3  the second evolution, else a hero, else a champion
        rest    everything else, in stored order

    Cards keep their relative order within each group, so two decks with the
    same contents always render identically.

    `trust_order=True` SUSPENDS that rebuild AND outranks `marks`, because for
    one source the order is not incidental — it is the answer. A Clash Royale copyDeck link writes
    the three special slots first, in slot order, so its first three IDs already
    say which cards are the evolution, the hero and the wild. Re-deriving them
    from capability actively destroys that: a Goblin Barrel / Valkyrie / Princess
    list came back with Goblins in the hero slot, because Goblins *can* be a
    hero and the rebuild had no reason to prefer the Valkyrie the player
    actually chose. Trust the order and the same link renders exactly as the
    game does.

    `slot_of` is `{card: index}` for where each marked card was OBSERVED sitting,
    which the payload records per battle. It only ever reorders cards the marks
    already chose — it cannot make a card special — but it is the only thing
    that can separate two marks of the same form, since slots 2 and 3 can both
    hold a hero. Callers that aggregate battles (the meta board, the player
    screens) pass it; a pasted link has none and does not need one.

    `wild` overrides slot 3, the only genuinely ambiguous one: four cards
    (knight, valkyrie, musketeer, wizard) have both forms, so a link that puts
    one there cannot say which was meant. The builder solved this with a form
    picker on the wild slot; this is the same choice, offered to whoever pasted
    the deck.
    """
    try:
        import duel_combos as _dcx
    except Exception:
        return list(cards), {}

    profile = card_art_profile()

    def kind(c: str) -> str:
        """What this card is ABLE to be: 'evolution', 'hero', 'both',
        'champion' or ''.

        Capability, not preference — the caller decides which form a both-form
        card should serve, because that depends on the rest of the deck. Four
        cards own both (knight, valkyrie, musketeer, wizard).
        """
        info = _dcx.card_info(c)
        if info.get("is_champion"):
            return "champion"
        can_evo = bool(info.get("can_evolve"))
        can_hero = bool(info.get("can_be_hero"))
        if can_evo and can_hero:
            return "both"
        if can_evo:
            return "evolution"
        if can_hero:
            return "hero"
        return ""

    # Three groups, because a card that owns BOTH forms is the interesting one:
    # it can serve either slot, and which it should serve depends on what else
    # the deck has. Grouping by capability rather than by preferred art is what
    # lets slot 2 be filled at all in a deck whose only hero-capable cards are
    # also evolutions — an X-Bow with Archers + Wizard + Tesla left slot 2 plain
    # because Wizard had already been claimed as an evolution.
    evo_only, hero_only, both, champions = [], [], [], []
    for c in cards:
        k = kind(c)
        if k == "champion":
            champions.append(c)
        elif k == "both":
            both.append(c)
        elif k == "evolution":
            evo_only.append(c)
        elif k == "hero":
            hero_only.append(c)

    # ── WHAT THIS DECK WAS ACTUALLY SEEN FIELDING, IF ANYTHING ──────────────
    #
    # `marks` was accepted and then ignored: every caller was already handing in
    # real observations and the arrangement was derived from card CAPABILITY
    # regardless. The result was that every deck holding a hero-capable staple
    # got a hero, so 43 of the 50 meta decks rendered the maximum loadout — two
    # evolutions and a hero — against 28 that are actually played that way, and
    # the rendering disagreed with the evidence on 19 of 50.
    #
    # That is what made the archetype rows look alike. Barbarian Barrel is in
    # eight of the seventeen archetype decks and can be a hero, so it was
    # promoted into the hero slot in all eight: eight different decks, the same
    # gold card sitting second. The decks were never similar — their first three
    # slots were being manufactured to an identical pattern.
    #
    # So when there is evidence, the evidence decides, and a card nobody was
    # seen fielding specially stays plain however capable it is. Inference is
    # for decks with no record at all — a pasted link, a deck played once — and
    # every caller already flags that case as inferred to the UI.
    if trust_order:
        # THE LINK WINS, INCLUDING OVER OBSERVED MARKS. `marks` is pooled from
        # everyone who has played these eight cards; the link is the deck the
        # person in front of you actually built. When the two disagree the link
        # is the better authority about THIS copy of the list.
        #
        # It matters because the marks also re-order. A Battle Ram / Wizard /
        # Elite Barbarians link came back with Elite Barbarians in the middle
        # and Wizard third, because the pooled marks called Wizard an evolution
        # rather than the hero this player had put in slot 2 — two evolutions
        # and no hero leaves slot 2 to be filled from the rest.
        #
        # The link already placed the special slots. Read the art off the
        # positions and leave every card where the player put it.
        slots = list(cards[:SPECIAL_SLOTS])
        art: dict[str, str] = {}
        if len(slots) > 0 and kind(slots[0]) in ("evolution", "both"):
            art[slots[0]] = "evolution"
        if len(slots) > 1:
            k = kind(slots[1])
            if k in ("hero", "both"):
                art[slots[1]] = "hero"
        if len(slots) > 2:
            k = kind(slots[2])
            if k in ("evolution", "both"):
                art[slots[2]] = "evolution"
            elif k == "hero":
                art[slots[2]] = "hero"
        return _apply_wild(list(cards), art, wild, kind)

    if marks:
        # WHICH SLOT EACH MARK WAS SEEN IN, WHEN THAT IS KNOWN. Everything else
        # here reasons about which cards are special; `slot_of` says where they
        # sat, and the payload records it per battle. Without it two marks of
        # the same form are ordered by the deck's card list, which is arbitrary
        # between them — a Lava Hound deck came out zap / valkyrie / berserker
        # when the player's own 16 battles say zap / berserker / valkyrie, 14 of
        # them unanimous on the middle card.
        def seat(c: str) -> tuple[int, int]:
            return ((slot_of or {}).get(c, SPECIAL_SLOTS), cards.index(c))

        want = set(cards)
        evos = sorted((c for c in cards if c in want and marks.get(c) == "evolution"),
                      key=seat)[:2]
        heroes = sorted((c for c in cards if c in want and marks.get(c) == "hero"),
                        key=seat)[:2]
        hero = heroes[0] if heroes else None
        # A SECOND HERO IS LEGAL, and it goes in slot 3. Measured, 9.25% of
        # battles are fielded evolution / hero / hero — the third-commonest
        # loadout there is. Keeping only `heroes[0]` drew the second one plain.
        hero2 = heroes[1] if len(heroes) > 1 else None
    else:
        hero2 = None
        # THE GOAL IS TO FILL AS MANY SPECIAL SLOTS AS POSSIBLE — two evolutions
        # and a hero is a better rendering of the same deck than two evolutions
        # and a gap. A both-form card is spent on the hero slot only when doing
        # so still leaves two evolutions behind; otherwise an evolution is worth
        # more.
        hero = hero_only[0] if hero_only else None
        if hero is None and both and len(evo_only) + len(both) - 1 >= 2:
            # CHOSEN FROM CONTENT, NOT FROM ARRIVAL ORDER. This was `both[-1]`,
            # the last both-form card as the list happened to arrive — which
            # made the whole arrangement depend on the order it was handed, and
            # therefore not idempotent: arranging an already-arranged deck
            # swapped the hero and the second evolution back and forth. The same
            # deck then rendered one way in the duel series log and the other on
            # the deck-sequence board. The priciest card takes the hero slot,
            # ties broken on the key, so a deck's rendering is a property of its
            # cards and nothing else.
            hero = max(both, key=lambda c: (_dcx.card_info(c).get("elixir") or 0, c))

        evo_pool = [c for c in cards if (c in evo_only or c in both) and c != hero]
        evos = evo_pool[:2]

    slots: list[str | None] = [None, None, None]
    art: dict[str, str] = {}

    # slot 1 — evolution only.
    if evos:
        slots[0] = evos[0]
        art[evos[0]] = "evolution"

    # slot 2 — hero, else a champion (which draws as itself).
    if hero:
        slots[1] = hero
        art[hero] = "hero"
    elif champions:
        slots[1] = champions.pop(0)

    # slot 3 — the wild slot: it takes EITHER form. Second evolution, else a
    # second hero, else a champion. The evolution goes first only because
    # evolution / hero / evolution outnumbers evolution / hero / hero seven to
    # one; when the marks name both, `cap_special_marks` has already picked
    # which of them survives, so this only ever sees one of the two.
    if len(evos) > 1:
        slots[2] = evos[1]
        art[evos[1]] = "evolution"
    elif hero2:
        slots[2] = hero2
        art[hero2] = "hero"
    elif champions:
        slots[2] = champions.pop(0)

    # AN EMPTY SPECIAL SLOT IS FILLED, NEVER COLLAPSED. Compacting the list
    # instead shifted the second evolution up into slot 2 whenever a deck had no
    # hero — which is exactly the position an evolution may not occupy. Slot 2
    # holding an ordinary card is legal; slot 2 holding an evolution is not.
    placed = {c for c in slots if c}
    rest = [c for c in cards if c not in placed]
    for i in range(SPECIAL_SLOTS):
        if slots[i] is None and rest:
            slots[i] = rest.pop(0)
    ordered = [c for c in slots if c] + rest
    return _apply_wild(ordered, art, wild, kind)


def deck_art(tag: str, hashes: list[str],
             since: str | None) -> tuple[dict, dict]:
    """({deck_hash: {card: variant}}, {deck_hash: {card: slot}}) for one player.

    Cheap, unlike the global version: `idx_battles_hash` covers
    (player_tag, player_deck_hash), so this touches only that player's rows for
    those decks rather than scanning.

    The variant comes from `player_evo` and is read off the LEVEL, not the `art`
    string — see `mark_variant`. The deck's stored order is not used either;
    `cap_special_marks` explains what replaced it.

    The second return is WHERE each marked card was seen sitting, taken from the
    same rows via `player_card_keys`. Two marks of the same form cannot be told
    apart without it, because slots 2 and 3 can both hold a hero.
    """
    out: dict[str, dict[str, str]] = {}
    seats: dict[str, dict[str, int]] = {}
    if not hashes:
        return out, seats
    lo = _compact(since) or "00000000"
    for path in _tier_paths():
        try:
            con = connect(path)
        except Exception:
            continue
        try:
            for h in hashes:
                if h in out:
                    continue
                tally: dict[str, dict[str, int]] = {}
                where: dict[str, dict[int, int]] = {}
                try:
                    rows = con.execute(
                        "SELECT player_evo, player_card_keys FROM battles "
                        "WHERE player_tag = ? AND player_deck_hash = ? "
                        "AND battle_time >= ? AND player_evo IS NOT NULL "
                        "AND player_evo != '' LIMIT 200",
                        (tag, h, lo),
                    ).fetchall()
                except Exception:
                    rows = []
                for r in rows:
                    try:
                        marks = json.loads(r["player_evo"])
                    except Exception:
                        continue
                    try:
                        keys = json.loads(r["player_card_keys"] or "[]")
                    except Exception:
                        keys = []
                    for m in marks:
                        v = mark_variant(m)
                        if not v:
                            continue
                        per = tally.setdefault(m[0], {})
                        per[v] = per.get(v, 0) + 1
                        if m[0] in keys:
                            pos = where.setdefault(m[0], {})
                            i = keys.index(m[0])
                            pos[i] = pos.get(i, 0) + 1
                if tally:
                    # Most common fielding wins; sorted() keeps ties stable.
                    # Capped to the slots that exist — see cap_special_marks for
                    # why this is not done by stored position.
                    out[h] = cap_special_marks(
                        [
                            (sum(k.values()), c, max(sorted(k), key=lambda x: k[x]))
                            for c, k in tally.items()
                        ]
                    )
                    seats[h] = {
                        c: max(sorted(p), key=lambda i: p[i])
                        for c, p in where.items()
                        if c in out[h]
                    }
        finally:
            con.close()
    return out, seats


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


_battlelog_cache: dict[str, tuple[list | None, float]] = {}
_BATTLELOG_TTL_S = 120.0


def cr_battlelog(tag: str) -> list | None:
    """The player's most recent battles, live from the CR API.

    THIS IS THE ONLY SOURCE FOR A PLAYER NOBODY HAS EVER TRACKED. `battles.db`
    holds what the bot polled, so a tag searched for the first time has nothing
    in it at all and the screen 404s — while the game itself has been holding
    that player's recent history the whole time, one request away.

    Supercell caps the endpoint at roughly the last 25 battles and does not
    paginate it, so this is a fixed, small window by construction rather than by
    our choice. It is also NOT a substitute for the stored history: no date
    range reaches further back than the log does, and the log is gone the moment
    it rolls over. It answers "what are they doing right now" and nothing else.

    Returns None on any failure — no token, no network, a rate limit, an unknown
    tag — matching `cr_profile`, so a caller can always fall back to whatever is
    stored. An empty LIST is different and means the API answered and the player
    genuinely has no recent battles.

    Cached for two minutes: every screen for a live-only player derives from
    this one call, and the underlying data cannot change faster than a match
    takes to play anyway.
    """
    if not CR_TOKEN:
        return None
    now = time.monotonic()
    hit = _battlelog_cache.get(tag)
    if hit and now - hit[1] < _BATTLELOG_TTL_S:
        return hit[0]

    import urllib.parse
    import urllib.request

    out = None
    try:
        url = (
            CR_API_BASE.rstrip("/")
            + "/players/"
            + urllib.parse.quote(tag)
            + "/battlelog"
        )
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": "Bearer " + CR_TOKEN,
                "Accept": "application/json",
                # The RoyaleAPI proxy answers 403 to urllib's default agent,
                # which is what made a working token look like a bad one.
                "User-Agent": "Mozilla/5.0 (RoyalArena analytics)",
            },
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.load(resp)
        out = data if isinstance(data, list) else None
    except Exception:
        out = None
    _battlelog_cache[tag] = (out, now)
    return out
