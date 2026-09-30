"""Train the duel win model (`duel_model.py`) from every stored duel game.

    python3 duel_model_train.py            # new duels since the last run, then fit + save
    python3 duel_model_train.py --full     # re-read every stored duel payload
    python3 duel_model_train.py --report   # holdout report only, nothing saved

INCREMENTAL (2026-09-30), because "24 hours is very long — the coach should
update as the bot polls". The parsed games are cached (`CACHE`) with the
`stored_at` watermark they were read up to, so a run reads only payloads the
bot stored since (`ix_raw_stored`, seconds) and refits (~2-3 minutes). With
nothing new it exits without touching the model. A full re-read happens when
the cache is missing, older than `FULL_EVERY_S`, or on `--full`, so games
retention has deleted leave the model within a week.

Reads `battle_raw` READ-ONLY: every native duel payload's rounds, both decks,
both sides' card levels, the result. Player strength is a RUNNING record, known
before each game, exactly as it is when the model is used. Before saving, the
same data is split in time (first 70% fit, last 30% scored) and the report is
stored in the artifact's `meta`, so the screen can quote measured figures.

Slow on purpose-built hardware terms (a full `battle_raw` read, ~5 min on the
VPS) and meant for a timer, never a request.
"""

from __future__ import annotations

import collections
import json
import os
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import duel_model as dm  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".duel_games.pkl")
FULL_EVERY_S = 7 * 24 * 3600


def _card_keys() -> dict[int, str]:
    with open(os.path.join(ROOT, "src", "data", "cards.json"), encoding="utf-8") as f:
        return {c["id"]: c["key"] for c in json.load(f)}


def read_games(db_path: str, since: str | None = None,
               seen: set | None = None) -> tuple[list[tuple], set, str]:
    """`(games, seen battle ids, newest stored_at read)`.

    Games are `(battle_time, round, tagA, tagB, deckA, deckB, defA, defB,
    a_won)`, oldest first. `since` reads only payloads stored after it (the
    `stored_at` index); `seen` carries battle ids across runs, so a duel stored
    from both players' logs is counted once however the polls split it.
    """
    key = _card_keys()
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    games, seen = [], set(seen or ())
    newest = since or ""
    if since:
        cur = con.execute("SELECT game_mode, raw_json, stored_at FROM battle_raw "
                          "WHERE stored_at > ? ORDER BY stored_at", (since,))
    else:
        cur = con.execute("SELECT game_mode, raw_json, stored_at FROM battle_raw")
    try:
        for mode, raw, stored in cur:
            if stored and stored > newest:
                newest = stored
            if not mode or "duel" not in mode.lower():
                continue
            try:
                p = json.loads(raw)
            except ValueError:
                continue
            a, b = (p.get("team") or [{}])[0], (p.get("opponent") or [{}])[0]
            ra, rb = a.get("rounds") or [], b.get("rounds") or []
            bid = (p.get("battleTime"), *sorted([a.get("tag") or "", b.get("tag") or ""]))
            if bid in seen or not ra or len(ra) != len(rb):
                continue
            seen.add(bid)
            for rnd, (x, y) in enumerate(zip(ra, rb)):
                ca, cb = x.get("cards") or [], y.get("cards") or []
                if len(ca) != 8 or len(cb) != 8 or x.get("crowns") == y.get("crowns"):
                    continue
                da = [key.get(c.get("id")) for c in ca]
                db = [key.get(c.get("id")) for c in cb]
                if None in da or None in db:
                    continue
                fa = sum((c.get("maxLevel") or 0) - (c.get("level") or 0) for c in ca) / 8
                fb = sum((c.get("maxLevel") or 0) - (c.get("level") or 0) for c in cb) / 8
                games.append((p.get("battleTime") or "", rnd, a.get("tag"), b.get("tag"),
                              da, db, fa, fb, 1 if (x.get("crowns") or 0) > (y.get("crowns") or 0) else 0))
    finally:
        con.close()
    games.sort()
    return games, seen, newest


def load_cache() -> dict | None:
    import pickle
    try:
        with open(CACHE, "rb") as f:
            return pickle.load(f)
    except (OSError, EOFError, ValueError, ImportError):
        return None


def save_cache(c: dict) -> None:
    import pickle
    tmp = CACHE + ".tmp"
    with open(tmp, "wb") as f:
        pickle.dump(c, f, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(tmp, CACHE)


def with_strength(games):
    """Each game with both players' strength BEFORE it: `(game, strA, strB)`."""
    rec = collections.defaultdict(lambda: [0, 0])
    out = []
    for g in games:
        _t, _r, a, b, *_rest, y = g
        out.append((g, dm.strength(*rec[a]), dm.strength(*rec[b])))
        rec[a][0] += 1; rec[a][1] += y
        rec[b][0] += 1; rec[b][1] += 1 - y
    return out


def rows_of(items):
    return [(dm.features(g[4], g[5], g[6], g[7], sa, sb), g[8]) for g, sa, sb in items]


def choice_check(weights: dict, items) -> dict:
    """Held-out three-game series: game-2 wins when the pick matched the model."""
    series = collections.defaultdict(list)
    for g, sa, sb in items:
        series[(g[0], g[2], g[3])].append((g, sa, sb))
    agree, disagree = [0, 0], [0, 0]
    for gs in series.values():
        if len(gs) != 3:
            continue
        gs.sort(key=lambda it: it[0][1])
        for side in (0, 1):
            mine = [it[0][4 + side] for it in gs]
            theirs = [it[0][5 - side] for it in gs]
            fm = [it[0][6 + side] for it in gs]
            ft = [it[0][7 - side] for it in gs]
            ms, os_ = (gs[0][1], gs[0][2]) if side == 0 else (gs[0][2], gs[0][1])
            won2 = (gs[1][0][8] == 1) == (side == 0)

            def val(i):
                return sum(dm.score(weights, dm.features(mine[i], theirs[j], fm[i], ft[j], ms, os_))
                           for j in (1, 2)) / 2
            b = agree if val(1) >= val(2) else disagree
            b[0] += 1; b[1] += int(won2)
    return {"agree": {"n": agree[0], "won": round(100 * agree[1] / max(1, agree[0]), 1)},
            "disagree": {"n": disagree[0], "won": round(100 * disagree[1] / max(1, disagree[0]), 1)}}


def main(argv: list[str]) -> int:
    db = os.environ.get("CLASH_DB_PATH") or "/var/clashbot/battles.db"
    t0 = time.time()
    cache = None if "--full" in argv else load_cache()
    if cache and time.time() - float(cache.get("fullAt") or 0) > FULL_EVERY_S:
        cache = None
    if cache:
        new, seen, newest = read_games(db, since=cache["watermark"], seen=cache["seen"])
        print(f"incremental: {len(new)} new duel games since {cache['watermark']}")
        if not new and dm.load() is not None and "--report" not in argv:
            print("no new duel games; model unchanged")
            return 0
        games = sorted(cache["games"] + new)
        cache.update(games=games, seen=seen, watermark=newest)
    else:
        games, seen, newest = read_games(db)
        cache = {"games": games, "seen": seen, "watermark": newest, "fullAt": time.time()}
        print(f"full read: {len(games)} duel games")
    if "--report" not in argv:
        save_cache(cache)
    if len(games) < 1000:
        print(f"only {len(games)} duel games — not training")
        return 1
    items = with_strength(games)
    cut = int(len(items) * 0.7)
    w = dm.train(rows_of(items[:cut]))
    report = {
        "games": len(games),
        "from": games[0][0][:8], "to": games[-1][0][:8],
        "testFrom": items[cut][0][0][:8],
        "holdout": dm.evaluate(w, rows_of(items[cut:])),
        "choice": choice_check(w, items[cut:]),
    }
    print(json.dumps(report, indent=1))
    if "--report" in argv:
        return 0
    final = dm.train(rows_of(items))
    report["trainedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    report["seconds"] = round(time.time() - t0)
    dm.save(final, report)
    print(f"saved {dm.PATH} ({len(final)} weights) in {report['seconds']}s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
