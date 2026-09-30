"""DECKKIES BUILDS DECKS THE WAY A PERSON DOES — and plans the whole duel.

Asked for (2026-09-30): "a deck recommendation that makes decks on its own
like real humans, which can interchange cards, and good deck layouts".

── THE BUILDER ─────────────────────────────────────────────────────────────

A person does not assemble eight cards from nothing. They take a deck they
know, look at what the opponent brings, and swap a card or two for ones that
do the same job better here — The Log for Barbarian Barrel, Cannon for Tesla.
So does this:

  * START from real decks (`seeds`): the player's options, their own history,
    the personal "bring" list.
  * MOVE only by swaps humans make (`swap_graph`, learned from 43,998 real
    decks one card apart), at most `MAX_SWAPS` per deck, a beam of `BEAM`.
    Every built deck is therefore within two human edits of a real one.
  * JUDGE each candidate with a fast scorer (the duel model) while searching;
    the caller re-ranks the finalists with the combined brain.
  * KEEP a deck only when it still works (`allow`: the harmony check, the
    three special slots, no card spent this duel) and gains at least
    `MIN_GAIN` points over the deck it came from.

── THE PLANNER ─────────────────────────────────────────────────────────────

Three card-disjoint decks chosen for the WHOLE best-of-3, not one game: every
candidate triple from the top `LOADOUT_POOL` is scored as a series — each of
my decks against each of their likely decks, played out game by game with no
repeats on either side (`series_win`), averaged over the order they might
bring theirs, maximised over the order I bring mine. A deck that only answers
what another of mine already answers adds nothing to that number.

Pure: no database, no network. `coach.py` wires it.
"""

from __future__ import annotations

import itertools

BRAIN = "deck-builder-1.0"

MAX_SWAPS = 2
PER_CARD = 5
BEAM = 8
MIN_GAIN = 1.0
LIMIT = 4
SAME_DECK = 6
LOADOUT_POOL = 18


def deck_key(cards) -> str:
    return ",".join(sorted(set(cards)))


def one_swaps(cards, graph: dict, *, used=(), per_card: int = PER_CARD) -> list[tuple]:
    """Every one-card human swap of `cards`: `(out, in, new_cards, pairs)`."""
    have, spent = set(cards), set(used or ())
    out = []
    for c in cards:
        for sub, _score, pairs in ((graph or {}).get(c) or [])[:per_card]:
            if sub in have or sub in spent:
                continue
            new = [sub if x == c else x for x in cards]
            out.append((c, sub, new, int(pairs)))
    return out


def build(seeds, score, graph: dict, *, used=(), allow=None, max_swaps: int = MAX_SWAPS,
          beam: int = BEAM, per_card: int = PER_CARD, min_gain: float = MIN_GAIN,
          limit: int = LIMIT) -> list[dict]:
    """Built decks, best first.

    `seeds` are `[{"cards", "source", "name"?}]`; `score(cards) -> win %`;
    `allow(new_cards, seed_cards) -> bool` (None allows everything).
    """
    cache: dict[str, float] = {}

    def sc(cards):
        k = deck_key(cards)
        if k not in cache:
            cache[k] = float(score(cards))
        return cache[k]

    seed_keys = {deck_key(s["cards"]) for s in seeds or []}
    results = []
    for s in seeds or []:
        base_cards = list(s["cards"])
        if len(set(base_cards)) != 8:
            continue
        base = sc(base_cards)
        frontier = [(base_cards, [])]
        seen = {deck_key(base_cards)}
        for _depth in range(max_swaps):
            nxt = []
            for cards, path in frontier:
                for c_out, c_in, new, pairs in one_swaps(cards, graph, used=used, per_card=per_card):
                    k = deck_key(new)
                    if k in seen:
                        continue
                    seen.add(k)
                    if allow is not None and not allow(new, base_cards):
                        continue
                    step = path + [{"out": c_out, "in": c_in, "pairs": pairs}]
                    nxt.append((sc(new), new, step))
            nxt.sort(key=lambda r: -r[0])
            frontier = [(new, step) for _s, new, step in nxt[:beam]]
            for val, new, step in nxt[:beam]:
                if val - base >= min_gain and deck_key(new) not in seed_keys:
                    results.append({"cards": new, "win": round(val, 1), "seedWin": round(base, 1),
                                    "gain": round(val - base, 1), "swaps": step,
                                    "seed": base_cards, "seedSource": s.get("source"),
                                    "seedName": s.get("name")})
    results.sort(key=lambda r: (-r["win"], len(r["swaps"]), deck_key(r["cards"])))
    out: list[dict] = []
    for r in results:
        if any(len(set(r["cards"]) & set(o["cards"])) >= SAME_DECK for o in out):
            continue
        out.append(r)
        if len(out) >= limit:
            break
    return out


# ── The whole duel ───────────────────────────────────────────────────────────


def series_win(games: list[float], need_me: int = 2, need_them: int = 2) -> float:
    """P(I reach `need_me` wins before they reach `need_them`), game by game."""
    def go(i, a, b):
        if a == 0:
            return 1.0
        if b == 0 or i >= len(games):
            return 0.0
        p = games[i]
        return p * go(i + 1, a - 1, b) + (1 - p) * go(i + 1, a, b - 1)
    return go(0, need_me, need_them)


def loadout_value(mine: list, theirs: list, prob, need_me: int = 2, need_them: int = 2) -> dict:
    """A loadout's best-of-N win chance against their decks.

    `prob(i, j)` is my deck i against their deck j. My order is chosen (best of
    all orders); theirs is unknown, so every order of theirs counts equally.
    With fewer of theirs than games, each game is against their mixture.
    """
    games = len(mine)
    best, best_order = -1.0, None
    for order in itertools.permutations(range(games)):
        if len(theirs) >= games:
            vals = []
            for t in itertools.permutations(range(len(theirs)), games):
                vals.append(series_win([prob(order[k], t[k]) for k in range(games)], need_me, need_them))
            v = sum(vals) / len(vals)
        else:
            per = [sum(prob(i, j) for j in range(len(theirs))) / max(1, len(theirs)) for i in order]
            v = series_win(per, need_me, need_them)
        if v > best:
            best, best_order = v, list(order)
    return {"win": best, "order": best_order}


def plan_loadout(cands: list[dict], theirs: list, prob, *, size: int = 3,
                 need_me: int = 2, need_them: int = 2, pool: int = LOADOUT_POOL,
                 used=()) -> dict | None:
    """The best card-disjoint `size` decks from `cands` for the whole duel.

    `cands` are `[{"cards", ...}]` already ranked (best single-game first);
    `prob(cand_index, their_index)`. Returns `{"decks": [cand indices in the
    order to play them], "win": series win chance}` or None.
    """
    spent = set(used or ())
    idx = [i for i, c in enumerate(cands[:pool])
           if len(set(c["cards"])) == 8 and not (set(c["cards"]) & spent)]
    best = None
    for triple in itertools.combinations(idx, size):
        cardsets = [set(cands[i]["cards"]) for i in triple]
        if any(cardsets[a] & cardsets[b] for a in range(size) for b in range(a + 1, size)):
            continue
        # Positions 0..size-1 of this triple; `prob` maps them back to cands.
        v = loadout_value(list(range(size)), theirs,
                          lambda a, j, t=triple: prob(t[a], j), need_me, need_them)
        if best is None or v["win"] > best["win"]:
            best = {"decks": [triple[i] for i in v["order"]], "win": v["win"]}
    return best
