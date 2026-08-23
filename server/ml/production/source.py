"""Ordered per-battle plays for one player, in either domain.

WHY THIS EXISTS. The Coach is fed by `duel_combos.read_duel_rows`, which is
duel-only, and `clash_data.player_report` aggregates by deck hash — neither can
supply the chronological sequence the engine needs to rebuild a shell, its
prior edits, streaks and recency windows. Phase 14 measured competitive as the
STRONGER domain (88.7% shortlist coverage against duel's 61.6%), so shipping
duel-only would have shipped the weaker half.

IT LIVES INSIDE `ml/production/` ON PURPOSE. The engine owns its own read, so
adding competitive support changes no existing module and the blast radius on
`clash_data.py`, `coach.py` and `duel_combos.py` stays at zero.

Everything here reuses the project's established definitions: `tier_windows`
for the hot/archive split, `META_MODES` for competitive, `is_duel_like_mode`
for duels. A second mode taxonomy is exactly how two screens start describing
different battles.
"""
from __future__ import annotations

import json
import os
import threading
import time

import clash_data as cd
from duel_combos import is_duel_like_mode
from meta import META_MODES

from .. import config
from ..dataset import DeckPlay

#: A player's read is capped: the engine only needs enough history to establish
#: a shell, and an unbounded scan on a spinning volume is a latency incident.
MAX_ROWS = 1200

# --------------------------------------------------------------------------
# CACHING — measured, not assumed.
#
# Profiled on live tags: the database read is 109-2317 ms while rebuilding the
# shell is 0-6 ms and scoring is 1-15 ms. The read is ~99% of the latency, so
# caching the derived history representation would have bought about two
# milliseconds. The READ is what has to be cached.
#
# Freshness is a two-step lease rather than a flat TTL. Inside `SOFT_TTL` the
# cached plays are reused outright. After it, a MAX(battle_time) probe — one
# indexed lookup, ~1-10 ms against a ~1 s full read — decides whether anything
# new has landed; if not, the lease is extended instead of re-reading. The bot
# polls every two hours, so most probes legitimately find nothing.
# --------------------------------------------------------------------------

#: HOT TIER ONLY, and this is a deliberate design statement rather than a
#: tuning knob.
#:
#: A shell is 12-87 plays over a few recent weeks. `tier_windows` splits a
#: request across the hot database AND the 46 GB archive whenever it reaches
#: before the player's earliest hot row — which a date bound cannot reliably
#: avoid, because that boundary differs per player. Measured: opening the
#: archive contributed ZERO plays and a second connection on every cold read.
#:
#: So the engine reads the hot tier and says so. The archive remains what it is
#: for — long-range analytics — and an unplugged H: is handled the same way it
#: is everywhere else, by returning nothing rather than raising.
HISTORY_DAYS = int(os.getenv("CLASH_OIE_HISTORY_DAYS", "60"))

SOFT_TTL_S = float(os.getenv("CLASH_OIE_CACHE_TTL", "120"))
MAX_CACHED_PLAYERS = int(os.getenv("CLASH_OIE_CACHE_SIZE", "256"))

_cache: dict = {}
_cache_lock = threading.Lock()
_stats = {"hit": 0, "probe": 0, "miss": 0}


def cache_stats() -> dict:
    with _cache_lock:
        total = sum(_stats.values()) or 1
        return dict(_stats, entries=len(_cache),
                    hitRate=round((_stats["hit"] + _stats["probe"]) / total, 3))


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
        for k in _stats:
            _stats[k] = 0


def _days_ago(days: int) -> str:
    import datetime
    d = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    return d.strftime("%Y%m%d") + "T000000.000Z"


def _latest_battle_time(tag: str) -> str:
    """Cheapest possible freshness probe: one indexed MAX()."""
    try:
        path = cd.resolve_db_path()
        if not path:
            return ""
        con = cd.connect(path)
        try:
            row = con.execute(
                "SELECT MAX(battle_time) m FROM battles WHERE player_tag = ?",
                (tag,)).fetchone()
            return (row["m"] if row else "") or ""
        finally:
            con.close()
    except Exception:
        return ""


def load_plays(tag: str, domain: str, since: str | None = None,
               until: str | None = None, limit: int = MAX_ROWS,
               use_cache: bool = True) -> list:
    """Chronological `DeckPlay`s for one player in one domain.

    Returns [] rather than raising when no database resolves — an analytics
    screen that shows the recent deck is useful; one that 500s is not.
    """
    if since is None and until is None and HISTORY_DAYS > 0:
        since = _days_ago(HISTORY_DAYS)
        bounded = True
    else:
        bounded = False

    # THE CACHE KEY HAS NO DOMAIN IN IT, and that is the whole point.
    #
    # `_read_rows` does not filter by mode in SQL - both domains read exactly
    # the same rows and are partitioned in Python. Keying the cache per domain
    # therefore ran the identical query twice per player. Measured on disjoint
    # tag sets, the cost followed the ORDER rather than the domain:
    #
    #     duel first:         duel p95 1194 ms   competitive p95   96 ms
    #     competitive first:  duel p95  151 ms   competitive p95 1217 ms
    #
    # Whichever domain went first paid the cold disk and the second read its
    # rows back out of the OS page cache. One read now serves both.
    key = (tag, since, until, limit)
    cacheable = use_cache and bounded
    rows = None
    if cacheable:
        now = time.monotonic()
        with _cache_lock:
            hit = _cache.get(key)
        if hit:
            loaded_at, cached_rows, seen_max = hit
            if now - loaded_at < SOFT_TTL_S:
                with _cache_lock:
                    _stats["hit"] += 1
                rows = cached_rows
            elif _latest_battle_time(tag) == seen_max:
                with _cache_lock:
                    _cache[key] = (now, cached_rows, seen_max)
                    _stats["probe"] += 1
                rows = cached_rows

    if rows is None:
        rows = _read_rows(tag, since, limit)
        if cacheable:
            with _cache_lock:
                _stats["miss"] += 1
                if len(_cache) >= MAX_CACHED_PLAYERS:
                    # Cheap eviction: drop the oldest lease. A strict LRU would
                    # need per-hit bookkeeping for no measurable gain here.
                    oldest = min(_cache, key=lambda k: _cache[k][0])
                    _cache.pop(oldest, None)
                _cache[key] = (time.monotonic(), rows,
                               max((r[0] for r in rows), default=""))

    return _rows_to_plays(rows, domain, limit)


def _read_rows(tag: str, since, limit: int) -> list:
    """The uncached read. ~99% of the engine's latency lives here.

    DOMAIN-AGNOSTIC ON PURPOSE. The query never filtered by mode, so one read
    serves both domains; `_rows_to_plays` does the partitioning. Returns plain
    tuples rather than sqlite3.Row so a cached result holds no connection state.
    """
    path = cd.resolve_db_path()
    if not path:
        return []
    try:
        con = cd.connect(path)
    except Exception:
        return []
    try:
        cur = con.execute(
            "SELECT battle_time, game_mode, player_card_keys, result, "
            "       opponent_win_condition "
            "FROM battles WHERE player_tag = ? AND battle_time >= ? "
            "ORDER BY battle_time DESC LIMIT ?",
            (tag, since or "", limit))
        return [(r["battle_time"] or "", r["game_mode"] or "",
                 r["player_card_keys"] or "[]", r["result"] or "",
                 r["opponent_win_condition"] or "") for r in cur.fetchall()]
    except Exception:
        return []
    finally:
        try:
            con.close()
        except Exception:
            pass


def _rows_to_plays(rows, domain: str, limit: int = MAX_ROWS) -> list:
    """Partition one cached row set into the plays for a single domain."""
    out = []
    for battle_time, mode, card_json, result, opp_wc in rows:
        # PHASE 23, FIX 2. `practice`, not `duel`. `is_duel_like_mode`
        # admits anything containing "friendly" and the 8-card guard below
        # drops every native duel loadout, so what survives is practice.
        if domain == "practice":
            if not is_duel_like_mode(mode):
                continue
        elif mode.lower() not in META_MODES:
            continue
        try:
            cards = json.loads(card_json)
        except (ValueError, TypeError):
            continue
        # A native duel row carries the whole 16/24-card loadout and is not a
        # deck; the research dataset drops it for the same reason.
        if not isinstance(cards, list) or len(set(cards)) != config.DECK_SIZE:
            continue
        out.append(DeckPlay(
            battle_time=battle_time, mode=mode, cards=tuple(cards),
            result=result, opponent_win_condition=opp_wc))

    out.sort(key=lambda p: p.battle_time)
    return out[-limit:]


def available() -> bool:
    """Is there a database to read at all?"""
    try:
        return cd.resolve_db_path() is not None
    except Exception:
        return False
