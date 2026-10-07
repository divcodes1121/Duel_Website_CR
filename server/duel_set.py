"""THE SET FOR A DUEL — which decks to load before it starts (`duel-set-1.0`).

Pure: `itertools` only. It knows no card, no history and no model.

A duel is played from prepared decks that share no card: four are loaded, two
or three get played. A player's favourite decks usually DO share cards — the
same Log, the same Fireball — so most players can field exactly one set, the
one they always bring (measured 2026-10-07: of 672 player-duels with the full
set known, 390 players had three distinct decks in thirty days and no choice
at all).

`compose` chooses the set with the best chance of winning the duel. A
candidate set is any group of the player's decks; where two of them share a
card, one gives it up for a card real players swap it for — "we can modify a
few cards" — and the changed deck must pass the caller's own checks as the
deck it has become. Sets are valued by a function the caller supplies (the
look-ahead over the opponent's read, `duel_plan`), so the set, the order it is
played in and the figure shown all come from one ruler.

MEASURED BLIND BEFORE IT WAS USED — see `DECKKIES_DUEL_RECOMMENDER.md`. Rated by
a win model the planner never saw, on duels where both full sets are known
whatever the score (672 player-duels): the set players really brought 52.8%, a
set composed from their own decks AS THEY ARE 54.6%; where their decks allow a
choice, 60.2% against 64.2%. The real results of those duels are too few to
confirm it (83 against 194 player-duels), and the screen must not say more
than that.

THE SWAPS ARE HERE AND NOT USED. Coach Assist calls `compose` with no
`substitutes`, because the same replay says they are almost never needed and
barely help: 98.6% of players with three duel decks can field a set as it
stands (their decks come from duels), and where a swap did change the set
(7.6%) a model rated it two points better, on decks nobody has played —
+0.15 overall. They are for the case this was not measured on: a deck brought
in from OUTSIDE a player's duel sets.
"""
from __future__ import annotations

import itertools

BRAIN = "duel-set-1.0"

#: Decks loaded for a duel, and the fewest that make one playable.
SIZE = 4
MIN_SIZE = 3
#: Decks considered, in the caller's order (their own, most recent first).
POOL = 8
#: Cards shared inside a candidate set that swaps may resolve. Past this the
#: decks are too alike to be a set — the same deck three ways.
MAX_CLASHES = 3
#: Changes to ONE deck. Two is the deck builder's own limit.
MAX_SWAPS_PER_DECK = 2
#: How many of a card's human substitutes are tried, best first.
SUBSTITUTES = 4
#: What a change must buy, in duel-win chance, to be preferred over a set of
#: untouched decks: half a point each. A deck as the player plays it is worth
#: more than the same figure with a card they have not practised.
SWAP_COST = 0.005
#: Candidate sets valued, at most.
MAX_VALUED = 240


def _clean(decks, pool: int) -> list[tuple[int, tuple]]:
    """`(index, cards)` for the first `pool` distinct eight-card decks."""
    out, seen = [], set()
    for i, d in enumerate(decks or []):
        cards = tuple(d or ())
        key = frozenset(cards)
        if len(cards) != 8 or len(key) != 8 or key in seen:
            continue
        seen.add(key)
        out.append((i, cards))
        if len(out) >= pool:
            break
    return out


def clashes(decks) -> dict:
    """`{card: [positions of the decks holding it]}` for cards in two or more."""
    where: dict = {}
    for pos, cards in enumerate(decks):
        for c in cards:
            where.setdefault(c, []).append(pos)
    return {c: ps for c, ps in where.items() if len(ps) > 1}


def resolve(decks, substitutes, allow=None, *, locked=(), max_swaps: int = MAX_SWAPS_PER_DECK,
            per_card: int = SUBSTITUTES):
    """Every way of making `decks` share no card by human swaps, as
    `[(new decks, swaps per deck)]`, in a stable order.

    For each shared card one deck keeps it and the others give it up, each for
    the first of that card's substitutes that is in no deck of the set and
    leaves a deck `allow(new, seed)` passes. `locked` positions never change.
    `substitutes(card)` -> `[(card, pairs)]`, best first.
    """
    shared = clashes(decks)
    if not shared:
        return [([tuple(d) for d in decks], [[] for _ in decks])]
    cards = sorted(shared)
    locked = set(locked)
    out = []
    for keepers in itertools.product(*[shared[c] for c in cards]):
        drops: dict = {}
        ok = True
        for c, keep in zip(cards, keepers):
            for pos in shared[c]:
                if pos == keep:
                    continue
                if pos in locked:
                    ok = False
                drops.setdefault(pos, []).append(c)
        if not ok or any(len(v) > max_swaps for v in drops.values()):
            continue
        new = [list(d) for d in decks]
        swaps = [[] for _ in decks]
        in_use = set().union(*[set(d) for d in decks])
        for pos in sorted(drops):
            seed = tuple(decks[pos])
            choice = _swap_deck(seed, drops[pos], substitutes, allow, in_use, per_card)
            if choice is None:
                ok = False
                break
            new[pos], swaps[pos] = choice
            in_use |= set(new[pos])
        if ok:
            out.append(([tuple(d) for d in new], swaps))
    return out


def _swap_deck(seed, out_cards, substitutes, allow, in_use, per_card):
    """`seed` with `out_cards` replaced, or None. The first combination of
    substitutes (best first) that brings in nothing already in the set and
    that `allow` passes."""
    options = []
    for c in out_cards:
        subs = [(s, int(p)) for s, p in (substitutes(c) or [])[:per_card] if s not in in_use and s not in seed]
        if not subs:
            return None
        options.append(subs)
    for combo in itertools.product(*options):
        ins = [s for s, _p in combo]
        if len(set(ins)) != len(ins):
            continue
        swap = dict(zip(out_cards, combo))
        new = [swap[c][0] if c in swap else c for c in seed]
        if allow is not None and not allow(new, list(seed)):
            continue
        return new, [{"out": c, "in": swap[c][0], "pairs": swap[c][1]} for c in out_cards]
    return None


def compose(decks, value, *, size: int = SIZE, min_size: int = MIN_SIZE, substitutes=None,
            allow=None, must=(), pool: int = POOL, max_clashes: int = MAX_CLASHES,
            swap_cost: float = SWAP_COST) -> dict | None:
    """The set to load, or None when no `min_size` decks can be made to fit.

    `decks`       the player's decks in priority order (eight cards each)
    `value`       value(list of decks) -> chance of winning the duel with them
    `substitutes` substitutes(card) -> [(card, pairs)]; None = no deck is changed
    `allow`       allow(new cards, seed cards) -> bool for a changed deck
    `must`        indices into `decks` that must be in the set, unchanged

    -> `{"brain", "size", "value", "decks": [{"index", "cards", "swaps"}],
    "swaps", "valued"}`. `index` is the caller's; `swaps` is `[{out, in,
    pairs}]` and empty for a deck as given. THE LARGEST SET THAT EXISTS WINS —
    four decks are loaded, so a set of four is never passed over for a better
    three — and among sets of one size the best `value` less `swap_cost` a
    change.
    """
    cand = _clean(decks, pool)
    need = {i for i in must}
    if not need <= {i for i, _c in cand}:
        return None
    valued = 0
    for k in range(min(size, len(cand)), min_size - 1, -1):
        best = None
        for combo in itertools.combinations(range(len(cand)), k):
            idx = [cand[p][0] for p in combo]
            if not need <= set(idx):
                continue
            group = [cand[p][1] for p in combo]
            n_shared = sum(len(ps) - 1 for ps in clashes(group).values())
            if n_shared and (substitutes is None or n_shared > max_clashes):
                continue
            locked = [pos for pos, i in enumerate(idx) if i in need]
            for new, swaps in resolve(group, substitutes, allow, locked=locked):
                if valued >= MAX_VALUED:
                    break
                valued += 1
                n_swaps = sum(len(s) for s in swaps)
                v = float(value([list(d) for d in new]))
                key = (v - swap_cost * n_swaps, -n_swaps, tuple(-i for i in idx))
                if best is None or key > best[0]:
                    best = (key, v, idx, new, swaps)
        if best is not None:
            _key, v, idx, new, swaps = best
            return {"brain": BRAIN, "size": k, "value": v,
                    "decks": [{"index": i, "cards": list(d), "swaps": s} for i, d, s in zip(idx, new, swaps)],
                    "swaps": sum(len(s) for s in swaps), "valued": valued}
    return None
