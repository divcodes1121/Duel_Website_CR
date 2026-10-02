"""DECKKIES BUILDS A DECK AROUND A CARD THE WAY DUEL PLAYERS DO.

Asked for (2026-10-02), after the first cut of "Build around your cards"
shipped decks that were a real Balloon deck with Balloon swapped for
Graveyard: *"it is just replacing a card with Graveyard — that is not how it
works. We need to build with cards like an actual brain: check duel battles,
there are literally so many decks, + meta + self brain making."*

They were right, and the evidence was sitting unread. Measured that day:
2,501 Graveyard lists were fielded in real duels over 16,591 games, and they
are not 2,501 unrelated decks — they are a handful of WAYS OF PLAYING the card,
each a core most of its pilots agree on plus a few slots people vary:

    splashyard     Graveyard Poison Baby Dragon Ice Wizard Knight Barb Barrel
                   + Tombstone / Tornado / Goblin Cage / Valkyrie
    Giant yard     Graveyard Giant Bowler Snowball Arrows
                   + Witch / Minions / Guards / Mini P.E.K.K.A / Night Witch
    Freeze yard    Graveyard Bowler Freeze Tornado Inferno Dragon ...

A one-card substitution into a deck built for another win condition is none of
those. This module builds the way a person who knows the card does:

  1. SHELLS. Group every real list holding the card by how much they share
     (`SHELL_OVERLAP`). Each group with enough play behind it is one way of
     playing the card (`shells`).
  2. THE CORE. Inside a shell, the cards at least `CORE_SHARE` of its games
     run are the deck's spine. They are taken as they stand — nobody tunes the
     Giant out of Giant Graveyard.
  3. THE FLEX SLOTS. What is left is filled from the cards that shell's pilots
     actually rotate through, and THIS is where the opponent matters: every
     legal way of filling them is scored against the opponent's likely decks
     (the duel win model, with the player's own card levels), plus a prior for
     how many of the shell's games run each card (`PRIOR_POINTS`). The prior is
     what stops a noisy model from picking a card three pilots tried once: a
     rare card has to be worth several points of win chance to take the slot.
  4. IT MUST BE A DECK. `allow` is the caller's structural gate — the three
     special slots, the harmony checklist, the duel-pairing gate, no card
     already spent this duel. A fill that fails is not offered.

Every card of a built deck is therefore one duel players run IN THAT SHELL.
The exact eight may or may not have been fielded as listed; `nearest` says how
close the most-played real list is, and the caller says which it is.

WHAT THIS IS NOT. Free generation over 123-choose-8 was closed in Phase 18:
2.4e11 candidates and no evidence for any of them. That result stands. The
search here is over one shell's own cards — at most a few hundred fills — and
the core is counted, not chosen.

Pure: no database, no network, standard library only. `coach.chosen` reads the
duel index and hands the corpus in.
"""

from __future__ import annotations

import itertools

BRAIN = "deck-architect-1.0"

#: Cards two lists share (of eight) to be the same way of playing the card.
#: Five: the named card plus four more. At six, Giant Graveyard with Minions
#: and Giant Graveyard with Guards and Musketeer are two shells and each is
#: too thin to read a core off.
SHELL_OVERLAP = 5

#: Weight behind a shell before it counts as a way people play the card, and
#: the fewest distinct lists. Thirty is the site's figure for "enough duel
#: games to say something" (`duel_brain.DUEL_MIN_GAMES`).
SHELL_MIN_WEIGHT = 30.0
SHELL_MIN_DECKS = 3

#: Shells built from, heaviest first.
MAX_SHELLS = 6

#: One pilot's games count toward a list's weight up to this many. A pet list
#: one player ran two hundred times is one person's opinion.
PILOT_CAP = 10.0

#: A card run in at least this share of a shell's games is its core; at most
#: `CORE_MAX` of them, named cards included, so at least one slot is chosen.
#:
#: 0.7 AND 7, FROM THE FIRST RUN ON PRODUCTION (2026-10-02). At 0.5 / 6 the
#: Hog 2.6 shell (Cannon .93, Skeletons .92, The Log .90, Ice Spirit .88,
#: Musketeer .82, Fireball .75, Ice Golem .71) kept five of those seven and
#: the model filled the last two slots with Ice Golem and Mighty Miner — Hog
#: 2.6 with no Fireball. A card seven in ten of a shell's games run is not up
#: for debate; what is left to choose is what its pilots really do vary.
CORE_SHARE = 0.7
CORE_MAX = 7

#: The cards a shell's pilots rotate through: the most-run non-core cards, at
#: least `FLEX_MIN_SHARE` of the shell's games each.
FLEX_POOL = 10
FLEX_MIN_SHARE = 0.05

#: Points of win chance a flex card is worth for being run in EVERY game of
#: the shell; pro rata below that. Ten: a card a tenth of the shell runs must
#: beat a staple by about eight points against this opponent to take its slot.
PRIOR_POINTS = 10.0

#: Decks kept per shell, and in all. EVERY SHELL'S BEST FILL COMES BEFORE ANY
#: SHELL'S SECOND (`build`): the first run kept the six highest values and the
#: most-played way of playing Graveyard — 451 lists, 4,669 games — was not
#: among them, because the model liked two other shells twice each.
PER_SHELL = 2
LIMIT = 8

#: Shared cards at which two built decks are one answer.
SAME_BUILD = 7


def deck_key(cards) -> str:
    return ",".join(sorted(set(cards or [])))


def weight(d: dict) -> float:
    """How much one real list counts: its duel games, capped per pilot.

    An explicit `w` wins — the caller's weight for a list with no duel record
    (a ladder deck, the player's own).
    """
    if d.get("w") is not None:
        return max(0.0, float(d["w"]))
    games = float(d.get("games") or 0)
    players = int(d.get("players") or 0)
    return max(0.0, min(games, PILOT_CAP * max(1, players)))


def shell_overlap(want) -> int:
    """`SHELL_OVERLAP`, raised as more cards are named: lists holding four
    named cards already share four, so five would call everything one shell."""
    return min(7, max(SHELL_OVERLAP, len(set(want or ())) + 3))


def shells(corpus, want=(), *, limit: int = MAX_SHELLS) -> list[dict]:
    """The ways people play these cards, heaviest first.

    `corpus` is real lists, `[{"cards", "games", "wins", "players"}]` (or with
    `w`). Each list joins the first shell whose LEADING list it shares
    `shell_overlap` cards with, heaviest list first — so a shell is named by
    its most-played list and a tech variant cannot start one.

    A shell is `{"rep", "decks", "n", "weight", "games", "wins", "freq"}`:
    `freq[card]` is the share of the shell's weight that runs it, `games` /
    `wins` its real duel record (lists without one do not count toward it).
    """
    at = shell_overlap(want)
    rows = [d for d in corpus or [] if len(set(d.get("cards") or [])) == 8 and weight(d) > 0]
    rows.sort(key=lambda d: (-weight(d), deck_key(d["cards"])))
    groups: list[dict] = []
    for d in rows:
        s = set(d["cards"])
        for g in groups:
            if len(s & g["set"]) >= at:
                g["decks"].append(d)
                break
        else:
            groups.append({"set": s, "decks": [d]})

    out = []
    for g in groups:
        w = sum(weight(d) for d in g["decks"])
        # DISTINCT lists: the caller may hand the same list twice (a duel list
        # that is also the player's own deck adds weight, not a second list).
        n = len({deck_key(d["cards"]) for d in g["decks"]})
        if w < SHELL_MIN_WEIGHT or n < SHELL_MIN_DECKS:
            continue
        per: dict[str, float] = {}
        games = wins = 0
        for d in g["decks"]:
            for c in set(d["cards"]):
                per[c] = per.get(c, 0.0) + weight(d)
            if d.get("wins") is not None and d.get("games"):
                games += int(d["games"])
                wins += int(d["wins"])
        out.append({"rep": list(g["decks"][0]["cards"]), "decks": g["decks"],
                    "n": n, "weight": round(w, 1), "games": games, "wins": wins,
                    "freq": {c: v / w for c, v in per.items()}})
    out.sort(key=lambda s: (-s["weight"], deck_key(s["rep"])))
    return out[:limit]


def core_of(shell: dict, want=(), used=()) -> list[str]:
    """The shell's spine: the named cards, then the cards at least `CORE_SHARE`
    of its games run, most-run first, `CORE_MAX` in all. A card already spent
    this duel is never core — it cannot be played."""
    want = [c for c in dict.fromkeys(want or ())]
    spent = set(used or ())
    freq = shell["freq"]
    ranked = sorted((c for c in freq if c not in want and c not in spent),
                    key=lambda c: (-freq[c], c))
    core = list(want)
    for c in ranked:
        if len(core) >= max(CORE_MAX, len(want)) or freq[c] < CORE_SHARE:
            break
        core.append(c)
    return core


def flex_pool(shell: dict, core, used=()) -> list[str]:
    """The cards the shell's pilots rotate through, most-run first."""
    taken = set(core) | set(used or ())
    freq = shell["freq"]
    ranked = sorted((c for c in freq if c not in taken and freq[c] >= FLEX_MIN_SHARE),
                    key=lambda c: (-freq[c], c))
    return ranked[:FLEX_POOL]


def nearest(cards, shell: dict) -> dict | None:
    """The shell's real list closest to `cards`: most shared cards, then most
    games. `{"cards", "shared", "games", "wins", "players"}`."""
    s = set(cards)
    best = None
    for d in shell["decks"]:
        k = (len(s & set(d["cards"])), int(d.get("games") or 0))
        if best is None or k > best[0]:
            best = (k, d)
    if best is None:
        return None
    (shared, _g), d = best
    return {"cards": list(d["cards"]), "shared": shared, "games": int(d.get("games") or 0),
            "wins": d.get("wins"), "players": int(d.get("players") or 0)}


def assemble(shell: dict, want=(), *, score=None, allow=None, used=(),
             per_shell: int = PER_SHELL) -> list[dict]:
    """The best fills of one shell, best first.

    `score(cards) -> win %` against the opponent (None = no model: the shell's
    own consensus decides). `allow(cards) -> bool` is the structural gate.

    Each result: `cards`, `core`, `flex` (the cards chosen for the open slots),
    `tuned` (the flex cards that are NOT the shell's most-run choice — what the
    opponent changed), `fast` (the model's figure, or None), `value` (what it
    was chosen on), `nearest`.
    """
    core = core_of(shell, want, used)
    need = 8 - len(core)
    if need < 0:
        return []
    pool = flex_pool(shell, core, used)
    if len(pool) < need:
        return []
    freq = shell["freq"]
    usual = set(pool[:need])
    rows = []
    for combo in itertools.combinations(pool, need):
        cards = core + list(combo)
        if allow is not None and not allow(cards):
            continue
        # A scorer that cannot rate a list (no model weights, nothing of
        # theirs to score against) answers None, and the consensus decides.
        got = score(cards) if score is not None else None
        fast = None if got is None else float(got)
        prior = PRIOR_POINTS * (sum(freq[c] for c in combo) / need) if need else 0.0
        rows.append({"cards": cards, "core": list(core), "flex": list(combo),
                     "tuned": [c for c in combo if c not in usual],
                     "fast": None if fast is None else round(fast, 1),
                     "value": round((50.0 if fast is None else fast) + prior, 3)})
    rows.sort(key=lambda r: (-r["value"], deck_key(r["cards"])))
    out: list[dict] = []
    for r in rows:
        if any(len(set(r["cards"]) & set(o["cards"])) >= SAME_BUILD for o in out):
            continue
        r["nearest"] = nearest(r["cards"], shell)
        out.append(r)
        if len(out) >= per_shell:
            break
    return out


def build(corpus, want=(), *, score=None, allow=None, used=(), limit: int = LIMIT) -> list[dict]:
    """Decks built around `want` from the real lists in `corpus`, best first.

    One or two per shell, near-copies across shells folded. Each carries its
    `shell`: `{"decks", "games", "wins", "weight", "rank"}` — how many real
    lists and duel games that way of playing the card rests on, and which
    shell it is (0 = the most played).
    """
    out: list[dict] = []
    for i, sh in enumerate(shells(corpus, want)):
        for n, r in enumerate(assemble(sh, want, score=score, allow=allow, used=used)):
            r["shell"] = {"decks": sh["n"], "games": sh["games"], "wins": sh["wins"],
                          "weight": sh["weight"], "rank": i}
            r["_nth"] = n
            out.append(r)
    # Each shell's best fill first, then the seconds; by value within each.
    out.sort(key=lambda r: (r["_nth"], -r["value"], r["shell"]["rank"], deck_key(r["cards"])))
    kept: list[dict] = []
    for r in out:
        r.pop("_nth", None)
        if any(len(set(r["cards"]) & set(k["cards"])) >= SAME_BUILD for k in kept):
            continue
        kept.append(r)
        if len(kept) >= limit:
            break
    return kept
