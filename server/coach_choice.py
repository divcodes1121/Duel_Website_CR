"""DECKS BUILT AROUND THE CARDS THE PLAYER NAMES — Coach Assist's "your cards".

Asked for (2026-10-02): "the decks it gave, the player might not play — so we
tell it to give us decks by our choice: we enter the win conditions or cards,
it finds and makes the decks accordingly, shows the matchup percentage,
prioritises duel battles and the brain's deck making".

Coach Assist's answer is chosen from the player's own history and the meta. A
coach who knows their player wants Hog Rider, or will not give up Fireball, had
no way to say so. This is that control: up to `MAX_WANT` cards, every deck
returned holds ALL of them, and each is rated against the opponent's likely
decks by the same brain that ranks "Play this".

WHERE THE DECKS COME FROM, in the order they are trusted:

  yours   a deck the player has actually played (duel history, native duels,
          ladder) that holds the cards
  duel    a deck duel players repeatedly field (`duel_index.catalogue`)
  meta    a vetted ladder deck (`deck_counter.seeds`)
  built   a real deck that lacks ONE of the cards, with the swap real players
          make to bring it in (`swap_graph`); and, after rating, improvements
          the deck builder finds that keep every named card

RULES, each a function below and each tested against literals:

  * every named card is in every deck returned (`holds`);
  * no card already spent this duel (`legal`) — a named card that IS spent is
    reported, never silently ignored;
  * a built deck is at most `MAX_FORCED` human swaps from a real one, never
    swaps a named card out, and the swap is one `swap_graph` has seen;
  * DUEL PROOF BREAKS NEAR-TIES, IT DOES NOT OVERRULE. A deck proven in real
    duels against what this opponent brings leads another within `DUEL_BAND`
    points; outside the band the higher win chance leads (`order`);
  * near-copies are one answer (`pick`);
  * REAL DECKS LEAD, BUILT DECKS FOLLOW (`arrange`). A built deck has never
    been played by anyone: its rate is inherited from the deck it came from.
    Staged on production (2026-10-02) four of six answers for "Hog Rider"
    were built decks ranked above every real one on inherited figures. So the
    two are not cross-ranked: real decks first in their own order, then up to
    `BUILT_SLOTS` built ones, more only when the real ones run out;
  * the player's OWN deck holding the cards is always on the list when it
    could be rated — it is the one deck the reader certainly can play.

Pure: no database, no network, no imports beyond the standard library.
`coach.chosen` gathers the candidates and rates them.
"""

from __future__ import annotations

BRAIN = "coach-choice-1.0"

#: Cards a reader may name. Four leaves four free slots; past that the request
#: is a whole deck and there is nothing left to find.
MAX_WANT = 4

#: Decks shown.
SHOW = 6

#: Of those, how many a built deck may take while real ones are available.
BUILT_SLOTS = 2

#: Lists rated by the combined brain. It reads a list's ladder history the
#: first time it rates it, so this is the cost lever (`coach.BUILD_FINALISTS`).
FINALISTS = 20

#: Finalists held per source, so one large source cannot crowd the others out
#: before anything has been rated. They sum to `FINALISTS`. Duel decks hold the
#: most: they are the evidence this screen is asked to lead with.
QUOTA = {"yours": 4, "duel": 8, "meta": 5, "built": 3}

#: Points of win chance inside which a duel-proven deck leads one that is not.
#: `coach.LEAD_MARGIN`'s figure, for the same claim.
DUEL_BAND = 3.0

#: Named cards a real deck may lack and still be built from. One: the result
#: is then a real deck plus a single swap real players make.
MAX_FORCED = 1

#: Substitutes of a card looked at for the named one (`swap_graph` lists them
#: best first). Wider than the builder's 5 because here the incoming card is
#: fixed by the reader, not chosen by the search.
FORCED_PER_CARD = 8

#: Ways to bring one card into one deck that are kept.
FORCED_PER_DECK = 2

#: Real deck pairs that must make a swap before it brings a named card in.
#: `swap_graph` keeps an edge from 3; staged on production those thin edges
#: built Royal Giant -> Graveyard (3 pairs) and Poison -> X-Bow (8), lists
#: nobody would field. The swaps a reader would recognise sit far above it:
#: Minion Giant -> Hog Rider 165, Royal Hogs -> Hog Rider 96, Battle Ram -> Hog
#: Rider 36, Balloon -> Graveyard 28.
FORCED_MIN_PAIRS = 20

#: Real decks per source that built decks are made from, most-played first.
FORCED_SEEDS = 150

SOURCES = ("yours", "duel", "meta", "built")


def deck_key(cards) -> str:
    return ",".join(sorted(set(cards or [])))


def valid_want(raw, known) -> tuple[list[str], list[str]]:
    """`(want, dropped)`: the named cards this deployment knows, in the order
    given, de-duplicated and capped at `MAX_WANT`; and what was left out.

    An unknown key is DROPPED AND ECHOED, never an error — the catalogue moves
    (a season's new card), and a refusal would blank the control on the day it
    does. Keys are lower-cased and spaces become hyphens, as the 2v2 filter
    does, so "Hog Rider" is `hog-rider`.
    """
    want: list[str] = []
    dropped: list[str] = []
    known = set(known or ())
    for r in raw or []:
        k = str(r or "").strip().lower().replace(" ", "-")
        if not k or k in want or k in dropped:
            continue
        if k in known and len(want) < MAX_WANT:
            want.append(k)
        else:
            dropped.append(k)
    return want, dropped


def holds(cards, want) -> bool:
    """Eight distinct cards that include every named one."""
    s = set(cards or [])
    return len(s) == 8 and set(want or ()) <= s


def legal(cards, used) -> bool:
    """No card already spent this duel — the rule every recommendation follows."""
    return not (set(cards or []) & set(used or ()))


def missing(cards, want) -> list[str]:
    s = set(cards or [])
    return [c for c in want or [] if c not in s]


def forced(cards, want, graph, *, used=(), role=None, per_card: int = FORCED_PER_CARD,
           per_deck: int = FORCED_PER_DECK, min_pairs: int = FORCED_MIN_PAIRS) -> list[dict]:
    """`cards` with its ONE missing named card swapped in, the human way.

    `graph` is `swap_graph`'s `{card: [[substitute, score, pairs], ...]}`: the
    cards people put in `card`'s place. A deck lacking the named card W gives
    up the card whose substitutes list W highest — the card real players
    actually trade for it. Returns up to `per_deck` of `{"cards", "swaps":
    [{"out", "in", "pairs"}], "score"}`, best swap first; `[]` when the deck
    lacks none or more than `MAX_FORCED`, when W is spent, or when nobody makes
    such a swap.

    `role(card)` names what a card IS (win condition, spell, building, troop).
    Given it, the card leaving must be the same kind as the one arriving: a
    win condition takes a win condition's place, a spell a spell's. Without
    that rule Poison gave way to X-Bow and a Graveyard deck gained a second
    win condition and lost its spell. And the swap must be one at least
    `min_pairs` real deck pairs make.
    """
    cards = list(cards or [])
    lacks = missing(cards, want)
    if len(set(cards)) != 8 or not lacks or len(lacks) > MAX_FORCED:
        return []
    new = lacks[0]
    if new in set(used or ()):
        return []
    keep = set(want or ())
    kind = role(new) if role is not None else None
    options = []
    for c in cards:
        if c in keep:
            continue                    # a named card never leaves
        if role is not None and role(c) != kind:
            continue                    # like for like
        for sub, score, pairs in ((graph or {}).get(c) or [])[:per_card]:
            if sub == new:
                if int(pairs) >= min_pairs:
                    options.append((float(score), int(pairs), c))
                break
    options.sort(key=lambda o: (-o[0], -o[1], o[2]))
    out = []
    for score, pairs, c in options[:per_deck]:
        out.append({"cards": [new if x == c else x for x in cards],
                    "swaps": [{"out": c, "in": new, "pairs": pairs}],
                    "score": round(score, 4)})
    return out


def shortlist(cands: list[dict], limit: int = FINALISTS, quota: dict | None = None) -> list[dict]:
    """The lists worth the combined brain's time, source by source.

    `cands` carry `source` and `fast` (the quick model's win chance, or None)
    and `plays` (games behind the list). Within a source: best `fast` first,
    then most-played. Each source takes up to its quota; slots a source cannot
    fill go to the best of what is left, so a request only the meta can answer
    still gets `limit` lists. One entry per deck — the first source to hold it
    keeps it, and `SOURCES` is the order of trust.
    """
    quota = dict(QUOTA if quota is None else quota)

    def rank(c):
        f = c.get("fast")
        return (f is None, -(f or 0.0), -int(c.get("plays") or 0), deck_key(c["cards"]))

    seen: set[str] = set()
    by_source: dict[str, list[dict]] = {s: [] for s in SOURCES}
    for s in SOURCES:
        for c in sorted((c for c in cands if c.get("source") == s), key=rank):
            k = deck_key(c["cards"])
            if k in seen:
                continue
            seen.add(k)
            by_source[s].append(c)

    out: list[dict] = []
    rest: list[dict] = []
    for s in SOURCES:
        take = by_source[s][:max(0, int(quota.get(s, 0)))]
        out.extend(take)
        rest.extend(by_source[s][len(take):])
    rest.sort(key=rank)
    out.extend(rest[:max(0, limit - len(out))])
    return out[:limit]


def proven(row: dict) -> bool:
    """Whether a row's duel record clears the duel brain's strength gate."""
    return bool((row.get("duel") or {}).get("strong"))


def order(rows: list[dict], band: float = DUEL_BAND) -> list[dict]:
    """Best first. Rated rows before unrated; among rated, the win chance —
    with a duel-proven row treated as `band` points higher, which is exactly
    "it leads anything within the band and nothing outside it". Ties: proof,
    then a deck the player already plays, then games, then the deck key.
    """
    def key(r):
        w = r.get("win")
        eff = None if w is None else float(w) + (band if proven(r) else 0.0)
        return (eff is None, -(eff or 0.0), not proven(r),
                r.get("source") != "yours", -int(r.get("plays") or 0),
                deck_key(r["cards"]))
    return sorted(rows, key=key)


def same_at(want) -> int:
    """Shared cards at which two answers are one. Six, the site's rule — seven
    once four cards are named, because every answer then already shares four."""
    return 7 if len(want or ()) >= 4 else 6


def pick(rows: list[dict], want=(), show: int = SHOW) -> list[dict]:
    """The first `show` of `rows` (already ordered) that are different decks."""
    at = same_at(want)
    out: list[dict] = []
    for r in rows:
        if any(len(set(r["cards"]) & set(o["cards"])) >= at for o in out):
            continue
        out.append(r)
        if len(out) >= show:
            break
    return out


def arrange(rows: list[dict], want=(), show: int = SHOW,
            built_slots: int = BUILT_SLOTS) -> list[dict]:
    """The list as shown: real decks in `order`, then built ones.

    Up to `built_slots` built decks when there are real ones to show beside
    them; the rest of `show` when there are not. A built deck that is a
    near-copy of a real one already listed is not a second answer. The
    player's own best deck is kept on the list if `pick` would have cut it.
    """
    ordered = order(rows)
    real = [r for r in ordered if r.get("source") != "built"]
    built = [r for r in ordered if r.get("source") == "built"]
    at = same_at(want)

    top = pick(real, want, show)
    fresh = [b for b in built
             if not any(len(set(b["cards"]) & set(r["cards"])) >= at for r in top)]
    room = max(built_slots, show - len(top))
    made = pick(fresh, want, min(room, show))
    top = top[:max(0, show - len(made))]

    mine = next((r for r in real if r.get("source") == "yours" and r.get("win") is not None), None)
    if mine is not None and top and not any(r is mine for r in top):
        # In place of the lowest real row, unless it is a near-copy of one
        # that is staying (then that one already stands for it).
        if not any(len(set(mine["cards"]) & set(r["cards"])) >= at for r in top[:-1]):
            top = order(top[:-1] + [mine])
    return top + made
