"""WHICH CARDS DO HUMANS INTERCHANGE — learned from every pair of real decks
that differ by exactly one card.

    python3 swap_graph.py --build     # rebuild .swap_graph.json (~2 min)

Two real decks sharing seven cards are one human substitution: the card that
differs went out, the other came in. Counted once per deck pair, weighted by
the smaller deck's games, then normalised by how often each card is swapped at
all (`w / sqrt(out_total * in_total)`), so a staple does not look like
everything's substitute. Measured on 43,998 real decks (2026-09-30): The Log
-> Barbarian Barrel, Cannon -> Tesla, Fireball -> Lightning / Poison, Valkyrie
-> Knight, Skeletons -> Goblins / Goblin Gang, Inferno Dragon -> Baby Dragon —
learned with no card knowledge at all.

It is the deck builder's MOVE SET (`deck_builder.py`): the builder only ever
makes swaps like these, which is what keeps a built deck the kind of deck a
person would build. Sources are the duel index's decks (5+ duel games) and the
ladder's (30+ games in `pair_matchup_agg`); both files are opened read-only.
"""

from __future__ import annotations

import collections
import json
import math
import os
import sqlite3
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, ".swap_graph.json")

#: A substitution must be seen in this many distinct real deck pairs.
MIN_PAIRS = 3
DUEL_MIN_GAMES = 5
LADDER_MIN_GAMES = 30

_lock = threading.Lock()
_loaded: tuple[float, dict] | None = None


def build_from(decks: dict[str, int]) -> dict[str, list]:
    """`{card: [[substitute, score, pairs], ...]}`, best first. Pure.

    `decks` is `{sorted card key: games}`.
    """
    groups: dict[str, list] = collections.defaultdict(list)
    for k, g in decks.items():
        c = k.split(",")
        if len(c) != 8:
            continue
        for i in range(8):
            groups[",".join(c[:i] + c[i + 1:])].append((c[i], int(g)))
    swap: collections.Counter = collections.Counter()
    pairs: collections.Counter = collections.Counter()
    for members in groups.values():
        if len(members) < 2:
            continue
        for i, (a, ga) in enumerate(members):
            for b, gb in members[i + 1:]:
                w = min(ga, gb)
                swap[(a, b)] += w
                swap[(b, a)] += w
                pairs[(a, b)] += 1
                pairs[(b, a)] += 1
    out_tot: collections.Counter = collections.Counter()
    in_tot: collections.Counter = collections.Counter()
    for (a, b), w in swap.items():
        out_tot[a] += w
        in_tot[b] += w
    graph: dict[str, list] = collections.defaultdict(list)
    for (a, b), w in swap.items():
        if pairs[(a, b)] >= MIN_PAIRS and out_tot[a] and in_tot[b]:
            graph[a].append([b, round(w / math.sqrt(out_tot[a] * in_tot[b]), 4), pairs[(a, b)]])
    for a in graph:
        graph[a].sort(key=lambda r: (-r[1], -r[2], r[0]))
    return dict(graph)


def substitutes(card: str, graph: dict | None, k: int = 6) -> list[tuple[str, float, int]]:
    """The `k` cards humans most often put in `card`'s place."""
    return [tuple(r) for r in ((graph or {}).get(card) or [])[:k]]


def build(index_path: str, db_path: str, path: str = PATH) -> dict:
    t0 = time.time()
    decks: dict[str, int] = {}
    con = sqlite3.connect(f"file:{index_path}?mode=ro", uri=True)
    try:
        for k, g in con.execute("SELECT key, games FROM deck WHERE games >= ?", (DUEL_MIN_GAMES,)):
            if k.count(",") == 7:
                decks[k] = decks.get(k, 0) + int(g)
    finally:
        con.close()
    n_duel = len(decks)
    lad: collections.Counter = collections.Counter()
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        for col in ("deck_a", "deck_b"):
            for h, g in con.execute(f"SELECT {col}, SUM(games) FROM pair_matchup_agg "
                                    f"WHERE {col} <> '' GROUP BY {col}"):
                if h and h.count(",") == 7:
                    lad[h] += int(g or 0)
    finally:
        con.close()
    for h, g in lad.items():
        if g >= LADDER_MIN_GAMES:
            decks[h] = decks.get(h, 0) + g
    graph = build_from(decks)
    body = {"builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "decks": len(decks), "duelDecks": n_duel,
            "edges": sum(len(v) for v in graph.values()), "graph": graph}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    os.replace(tmp, path)
    return {k: v for k, v in body.items() if k != "graph"} | {"seconds": round(time.time() - t0)}


def load(path: str = PATH) -> dict | None:
    """The graph, re-read only when the file changes. None before the first build."""
    global _loaded
    try:
        m = os.path.getmtime(path)
    except OSError:
        return None
    with _lock:
        if _loaded is not None and _loaded[0] == m:
            return _loaded[1]
    try:
        with open(path, encoding="utf-8") as f:
            body = json.load(f)
    except (OSError, ValueError):
        return None
    with _lock:
        _loaded = (m, body)
    return body


if __name__ == "__main__":
    if "--build" in sys.argv:
        idx = os.environ.get("CLASH_DUEL_INDEX") or os.path.join(HERE, ".duel_index.db")
        db = os.environ.get("CLASH_DB_PATH") or "/var/clashbot/battles.db"
        print(json.dumps(build(idx, db)))
