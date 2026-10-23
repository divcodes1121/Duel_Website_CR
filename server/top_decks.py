"""WHAT THE TOP 1,000 PLAYERS PLAY (`top-decks-1.0`, 2026-10-23).

Asked for after Team Analysis 6.0 went live: "still the decks suggested are
very bad and those decks are not used by top players — target the top 1k
players as a deck suggestion, and the CRL duel list, and set the frequency like
that".

WHO: the top `TOP_N` (1,000) of the LIVE ranked board (Path of Legends, the
season being played: `LIVE_BOARD`), read again on EVERY build — a step after
every poll — so the players, and so the decks, move with the board ("the top
1000 changes every time the bot polls ... so we get fresh decks every time").
The finished-season board the recruiter reads (`recruit.leaderboard_tags`) does
not move for a month; it is the fallback when the live one cannot be read. A
top player the bot does not track yet is queued (`recruit.enqueue`, source
`top-live`), so their games are collected from the next poll on.

WHAT: every ranked game (Path of Legends and trophy road — `RANKED_PREFIXES`)
each of them played in the last `DAYS` (90) days, by exact eight-card list.
The deck they chose to climb with, not a friendly or an event.

THE FILE (`.top_decks.json`, gitignored, mode 600) holds NO TAGS: a player is
their place in the board's order, so "how many top players use this" can be
counted over any window without naming anybody.

    {"brain", "builtAt", "season", "players", "withGames", "newest", "days",
     "decks": {key: {"a": archetype, "p": [[player, [[age, games, wins], ...]], ...]}}}

`age` is days before `newest` (the newest day any of them played).

`window(data, days, last)` -> `{key: [players, games, wins, archetype]}` over
the `days` ending on `last` — the frequency Team Analysis picks its pool by.

A step of `after_poll.py`. A build that cannot read the board keeps the last
file (exit 2). `test_top_decks.py`.
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import threading
import time

BRAIN = "top-decks-1.0"
HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.environ.get("CLASH_TOP_DECKS") or os.path.join(HERE, ".top_decks.json")

#: Players read off the top of the ranked board.
TOP_N = 1000
#: Days of their games kept in the file (the longest window Team Analysis asks for).
DAYS = 90
#: The board being played now: ranks move all season (checked 2026-10-23:
#: 200 with ratings; the season-numbered board of the current month is 404).
LIVE_BOARD = "/locations/global/pathoflegend/players"
#: Page size asked of the board.
PAGE = 1000

#: Modes that count: the ranked ladder (Path of Legends) and trophy road.
RANKED_PREFIXES = ("ranked1v1", "ladder")


def is_ranked(mode: str | None) -> bool:
    m = (mode or "").strip().lower()
    return any(m.startswith(p) for p in RANKED_PREFIXES)


def deck_key(cards) -> str:
    return ",".join(sorted(set(cards)))


def _day(stamp: str) -> datetime.date | None:
    """A battle stamp (`20261023T...`) or `YYYYMMDD` as a date."""
    s = (stamp or "")[:8]
    try:
        return datetime.date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    except (ValueError, TypeError):
        return None


def aggregate(players_rows) -> dict:
    """`players_rows` = `[(player index, [row, ...]), ...]`, a row being
    `{"battle_time", "mode", "cards", "archetype", "won": bool}` (any order).
    Returns the file's body (without the build fields). Pure."""
    acc: dict[str, dict] = {}
    newest = None
    with_games = 0
    for idx, rows in players_rows:
        mine: dict[str, dict[datetime.date, list[int]]] = {}
        for r in rows:
            if not is_ranked(r.get("mode")):
                continue
            cards = r.get("cards") or []
            if len(cards) != 8 or len(set(cards)) != 8:
                continue
            d = _day(r.get("battle_time") or "")
            if d is None:
                continue
            key = deck_key(cards)
            e = acc.get(key)
            if e is None:
                e = acc[key] = {"a": r.get("archetype") or "", "p": {}}
            per = mine.setdefault(key, {})
            gw = per.setdefault(d, [0, 0])
            gw[0] += 1
            gw[1] += 1 if r.get("won") else 0
            if newest is None or d > newest:
                newest = d
        if mine:
            with_games += 1
        for key, per in mine.items():
            acc[key]["p"][idx] = per
    out: dict[str, dict] = {}
    for key, e in acc.items():
        plist = []
        for idx in sorted(e["p"]):
            days = sorted(e["p"][idx].items())
            plist.append([idx, [[(newest - d).days, g, w] for d, (g, w) in days]])
        out[key] = {"a": e["a"], "p": plist}
    return {"newest": newest.strftime("%Y%m%d") if newest else None,
            "withGames": with_games, "decks": out}


def window(data: dict | None, days: int, last: datetime.date | None = None) -> dict:
    """`{deck key: [players, games, wins, archetype]}` over the `days` ending
    on `last` (the file's newest day when None). Empty without a file."""
    if not data or not data.get("decks") or not data.get("newest"):
        return {}
    newest = _day(data["newest"])
    if newest is None:
        return {}
    last = last or newest
    lag = (newest - last).days          # ages in the file count back from `newest`
    lo, hi = lag, lag + int(days) - 1
    out: dict[str, list] = {}
    for key, e in data["decks"].items():
        players = games = wins = 0
        for _idx, days_rows in e.get("p") or []:
            g = w = 0
            for age, gg, ww in days_rows:
                if lo <= age <= hi:
                    g += gg
                    w += ww
            if g:
                players += 1
                games += g
                wins += w
        if games:
            out[key] = [players, games, wins, e.get("a") or ""]
    return out


_CACHE = {"stamp": None, "data": None}
_LOCK = threading.Lock()


def load(path: str | None = None) -> dict | None:
    """The file, re-read when it changes. None when absent or unreadable."""
    p = path or PATH
    try:
        st = os.stat(p)
    except OSError:
        return None
    stamp = (p, st.st_mtime_ns, st.st_size)
    with _LOCK:
        if _CACHE["stamp"] == stamp:
            return _CACHE["data"]
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(data, dict) or data.get("brain") != BRAIN:
        return None
    with _LOCK:
        _CACHE["stamp"], _CACHE["data"] = stamp, data
    return data


def status(path: str | None = None) -> dict:
    """For `/api/analytics/status`: counts only, never a tag."""
    d = load(path)
    if not d:
        return {"available": False}
    return {"available": True, "builtAt": d.get("builtAt"), "season": d.get("season"),
            "players": d.get("players"), "withGames": d.get("withGames"),
            "newest": d.get("newest"), "decks": len(d.get("decks") or {})}


#: Tries a page of the live board gets: it answers 500 now and then (seen
#: 2026-10-23: a 200 and a 500 one second apart).
TRIES = 4


def live_board(get, limit: int = TOP_N, pause: float = 3.0) -> list[str]:
    """The top `limit` tags of the live board, in rank order, through `get`
    (`recruit._get`: `(status, json)`). [] when it cannot be read."""
    out: list[str] = []
    seen: set[str] = set()
    after = None
    while len(out) < limit:
        params = {"limit": min(PAGE, limit - len(out))}
        if after:
            params["after"] = after
        for attempt in range(TRIES):
            status, data = get(LIVE_BOARD, **params)
            if status == 200 and isinstance(data, dict):
                break
            if attempt + 1 < TRIES:
                time.sleep(pause)
        if status != 200 or not isinstance(data, dict):
            break
        items = data.get("items") or []
        if not items:
            break
        for item in items:
            tag = (item.get("tag") or "").strip().upper()
            if tag and not tag.startswith("#"):
                tag = "#" + tag
            if tag and tag not in seen:
                seen.add(tag)
                out.append(tag)
        after = ((data.get("paging") or {}).get("cursors") or {}).get("after")
        if not after:
            break
    return out[:limit]


def build(path: str | None = None, top: int = TOP_N, days: int = DAYS) -> int:
    """Read the board and every top player's ranked games; write the file."""
    sys.path.insert(0, HERE)
    import recruit
    import player_decks as pd
    import recent_battles as rb

    import clash_data as cd

    t0 = time.time()
    tags = [t for t in (cd.normalize_tag(x) for x in live_board(recruit._get, top)) if t]
    season = "live"
    if len(tags) < max(1, top // 2) and load(path) is None:
        # ONLY WITH NO FILE AT ALL: a finished season's board is a month old
        # (and when the API is failing it walks back further — one build read
        # June's), so a file from the last poll's live board is the better one.
        season = recruit.current_season()
        tags = recruit.leaderboard_tags(top, season) if season else []
    if len(tags) < max(1, top // 2):
        print(f"top decks: board unreadable ({len(tags)} tags, {recruit.last_error()}); kept the last file")
        return 2
    since = (datetime.datetime.now(datetime.timezone.utc).date()
             - datetime.timedelta(days=days)).isoformat()
    queued = None
    try:
        queued = recruit.enqueue(tags, "top-live")
    except Exception as exc:  # noqa: BLE001 - queueing never costs the build
        print(f"top decks: queueing failed: {exc}")

    def rows_of(tag):
        try:
            rows, _arch, _hidden = pd._own_rows(tag, since, None)
        except Exception:  # noqa: BLE001 - one player must not sink the build
            return []
        return [{"battle_time": r["battle_time"], "mode": r["mode"], "cards": r["cards"],
                 "archetype": r["archetype"],
                 "won": rb._outcome(r["result"], r["crowns"], r["opp_crowns"]) == "win"}
                for r in rows if is_ranked(r["mode"])]

    body = aggregate((i, rows_of(t)) for i, t in enumerate(tags))
    body.update({"brain": BRAIN, "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                 "season": season, "players": len(tags), "days": days})
    p = path or PATH
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, p)
    print(f"top decks: {len(tags)} players ({body['withGames']} with ranked games), "
          f"{len(body['decks'])} lists, newest {body['newest']}, board {season}, "
          f"queued {(queued or {}).get('added')} new, {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    if "--build" in sys.argv:
        raise SystemExit(build())
    print(json.dumps(status(), indent=1))
