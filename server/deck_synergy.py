"""DO THESE EIGHT CARDS GO TOGETHER THE WAY REAL DUEL DECKS DO?

    python3 deck_synergy.py --build     # rebuild .deck_synergy.json (~1 min)
    python3 deck_synergy.py --report    # what the live table says

Asked for (2026-09-30): "Or bring one of these" should be decks whose synergy
holds up the way it does in actual duels. `deck_harmony` already vetoes a list
with no air answer or no win condition; what it cannot see is a list that ticks
every box and is still a pile — two small spells, two building-targeting win
conditions, a champion that nothing supports.

THE MEASURE IS COUNTED, NOT JUDGED. For every pair of cards, how much more
often do duel players put them in one deck than chance would (pointwise mutual
information over every deck fielded in a real duel game in the window, each
counted once per game)? A deck's COHESION is the mean over its 28 pairs. No
card knowledge goes in, so "Arrows + Zap" scoring low is the duel population's
verdict, not ours.

IT PREDICTS DUEL RESULTS, AND THAT WAS MEASURED BEFORE IT WAS USED (2026-09-30,
356,922 duel games, pairs counted on the first 75% by time, outcomes on the
last 25%, each side's pilot strength taken out with log5):

    cohesion quintile   won    pilots predicted   residual
    Q1 (lowest)         44.0%       49.7%          -5.7
    Q3                  50.8%       49.8%          +1.1
    Q5 (highest)        54.1%       50.6%          +3.5

    held-out log loss   pilots 0.6810  ->  pilots + cohesion 0.6765

For a deck WITH its own duel record (30+ games) it adds nothing — that record
already contains how well its cards work together — so it is a GATE for decks
the duels have barely seen, not a term added to a rating. That is the case of
"Or bring one of these": ladder decks with 14-80 duel games each.

THE GATE: less cohesive than 9 in 10 of the decks duel players REPEATEDLY field
(the duel catalogue's rule: 10+ games, 3+ pilots), game-weighted. Measured on
the held-out games, thin-evidence decks below it won 1.4 points under what
their pilots predicted and those above it 2.8 over; the gap is ~4 points at
every cut from the 5th to the 25th percentile, so the 10th is not a tuned
number. A deck fielded in 30+ duel games in the window passes whatever it
scores: duel players bring it, which is the thing this asks.

Reads the duel index read-only. Writes only its own file.
"""

from __future__ import annotations

import bisect
import collections
import datetime as _dt
import itertools
import json
import math
import os
import sqlite3
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, ".deck_synergy.json")

#: Days of duel games counted. The duel index's own window.
WINDOW_DAYS = 60
#: The reference population: decks duel players repeatedly field.
REF_MIN_GAMES = 10
REF_MIN_PLAYERS = 3
#: Percentile of the reference (game-weighted) a deck must reach.
GATE_PCT = 10
#: Duel games in the window that make a deck proven, gate or no gate.
PROVEN_GAMES = 30
#: Smoothing: half a sighting per pair, one per card.
PAIR_PRIOR = 0.5

_lock = threading.Lock()
_loaded: tuple[float, dict] | None = None


def _key(cards) -> str:
    return ",".join(sorted(cards))


def table_from(decks: dict[str, tuple]) -> dict:
    """The counts and the reference distribution. Pure.

    `decks` is `{sorted card key: (games, distinct pilots[, wins])}` — every
    deck fielded in a duel game in the window.
    """
    card: collections.Counter = collections.Counter()
    pair: collections.Counter = collections.Counter()
    n = 0
    for k, (g, *_rest) in decks.items():
        cs = k.split(",")
        if len(cs) != 8 or len(set(cs)) != 8:
            continue
        n += g
        for c in cs:
            card[c] += g
        for a, b in itertools.combinations(sorted(cs), 2):
            pair[a + "|" + b] += g
    t = {"n": n, "card": dict(card), "pair": dict(pair)}
    ref = sorted((cohesion(k.split(","), t), v[0]) for k, v in decks.items()
                 if v[0] >= REF_MIN_GAMES and v[1] >= REF_MIN_PLAYERS and k.count(",") == 7)
    ref = [(c, g) for c, g in ref if c is not None]
    total = sum(g for _, g in ref)
    # 101 cut points: `quantiles[q]` is the cohesion at the q-th percentile.
    q, acc, i = [], 0, 0
    for pct in range(101):
        want = total * pct / 100
        while i < len(ref) and acc + ref[i][1] < want:
            acc += ref[i][1]
            i += 1
        q.append(round(ref[min(i, len(ref) - 1)][0], 4) if ref else 0.0)
    t["quantiles"] = q
    t["refDecks"] = len(ref)
    # A PROVEN deck carries its own duel record, `[games, wins]`: for it that
    # record is the evidence, and a pairing percentile would misread it (a
    # staple-heavy list duel players bring constantly can sit at the 0th).
    t["proven"] = {k: [v[0], v[2] if len(v) > 2 else None]
                   for k, v in decks.items() if v[0] >= PROVEN_GAMES}
    return t


def cohesion(cards, table: dict | None = None) -> float | None:
    """Mean pointwise mutual information over the deck's 28 pairs, or None."""
    t = table if table is not None else load()
    cs = sorted(set(cards or ()))
    if not t or len(cs) != 8 or not t.get("n"):
        return None
    n, card, pair = t["n"], t["card"], t["pair"]
    tot = 0.0
    for a, b in itertools.combinations(cs, 2):
        tot += math.log(((pair.get(a + "|" + b, 0) + PAIR_PRIOR) * n)
                        / ((card.get(a, 0) + 1) * (card.get(b, 0) + 1)))
    return tot / 28


def percentile(cards, table: dict | None = None) -> int | None:
    """Share (0-100) of repeatedly fielded duel decks, by games, this one out-pairs."""
    t = table if table is not None else load()
    c = cohesion(cards, t)
    if c is None or not t.get("quantiles"):
        return None
    return max(0, min(100, bisect.bisect_right(t["quantiles"], c) - 1))


def duel_record(cards, table: dict | None = None) -> list | None:
    """`[games, wins]` in the window for a proven deck, else None."""
    t = table if table is not None else load()
    if not t:
        return None
    p = t.get("proven") or {}
    if isinstance(p, list):             # a table written before records were kept
        return [PROVEN_GAMES, None] if _key(cards) in set(p) else None
    return p.get(_key(cards))


def proven(cards, table: dict | None = None) -> bool:
    return duel_record(cards, table) is not None


def passes(cards, table: dict | None = None) -> bool:
    """True unless the table exists and says these cards do not go together."""
    t = table if table is not None else load()
    if not t:
        return True
    if proven(cards, t):
        return True
    p = percentile(cards, t)
    return p is None or p >= GATE_PCT


def weakest_pairs(cards, table: dict | None = None, n: int = 2) -> list[list[str]]:
    """The pairs duel players put together least, lowest first."""
    t = table if table is not None else load()
    cs = sorted(set(cards or ()))
    if not t or len(cs) != 8:
        return []
    score = []
    for a, b in itertools.combinations(cs, 2):
        v = math.log(((t["pair"].get(a + "|" + b, 0) + PAIR_PRIOR) * t["n"])
                     / ((t["card"].get(a, 0) + 1) * (t["card"].get(b, 0) + 1)))
        score.append((v, a, b))
    score.sort()
    return [[a, b] for _, a, b in score[:n]]


def build(index_path: str, path: str = PATH, now: float | None = None) -> dict:
    t0 = time.time()
    since = _dt.datetime.fromtimestamp((now or time.time()) - WINDOW_DAYS * 86400,
                                       _dt.timezone.utc).strftime("%Y%m%dT%H%M%S.000Z")
    games: collections.Counter = collections.Counter()
    wins: collections.Counter = collections.Counter()
    pilots: dict[str, set] = collections.defaultdict(set)
    con = sqlite3.connect(f"file:{index_path}?mode=ro", uri=True)
    try:
        for a, b, ad, bd, w in con.execute(
                "SELECT a_tag, b_tag, a_deck, b_deck, winner FROM games WHERE battle_time >= ?",
                (since,)):
            games[ad] += 1
            games[bd] += 1
            pilots[ad].add(a)
            pilots[bd].add(b)
            if w == 1:
                wins[ad] += 1
            elif w == 2:
                wins[bd] += 1
    finally:
        con.close()
    t = table_from({k: (g, len(pilots[k]), wins[k]) for k, g in games.items()})
    body = {"builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "since": since, "decks": len(games), "gatePct": GATE_PCT,
            "gateCohesion": t["quantiles"][GATE_PCT] if t["quantiles"] else None, **t}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(body, f)
    os.replace(tmp, path)
    return {"decks": len(games), "deckGames": t["n"], "refDecks": t["refDecks"],
            "proven": len(t["proven"]), "gateCohesion": body["gateCohesion"],
            "seconds": round(time.time() - t0, 1)}


def load(path: str = PATH) -> dict | None:
    """The table, re-read only when the file changes. None before the first build."""
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


def status() -> dict | None:
    t = load()
    if not t:
        return None
    return {k: t.get(k) for k in ("builtAt", "decks", "refDecks", "gatePct", "gateCohesion")}


if __name__ == "__main__":
    if "--build" in sys.argv:
        idx = os.environ.get("CLASH_DUEL_INDEX") or os.path.join(HERE, ".duel_index.db")
        print(json.dumps(build(idx)))
    else:
        print(json.dumps(status()))
