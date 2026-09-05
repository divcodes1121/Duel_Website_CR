"""deck_tuner.py — the swap brain. Phase A: retrieval and ranking.

Design record: `DECK_TUNER.md` at the repo root. Read that first; this file
implements section 6 of it and nothing else yet.

WHAT THIS DOES, IN ONE SENTENCE:

    Given a deck, find the REAL decks that differ from it by one or two cards,
    score each against the archetypes that matter, and name the swap.

WHY THAT IS THE WHOLE TRICK. `deck_counter.py`'s own comment above
`CLUSTER_LEVELS` records the measurement this rests on:

    Measured on the most-played Hog list: 1,405 decks share 7+ cards with it
    and 4,439 share 6+, carrying 69,736 and 77,381 games.

A deck sharing 7 of 8 cards with yours IS a one-card swap of your deck. There
are ~1,400 of them for a typical list, every one is a deck real people pilot,
and every one has its own rows in `pair_matchup_agg` -- so every one is scored
at the DECK-VS-ARCHETYPE rung rather than smoothed into a cluster.

    THE BRAIN NEVER INVENTS A DECK. It finds the version of your deck other
    people are already winning with, and names the card that differs.

COST, AND THE TRAP THIS AVOIDS.

`CLAUDE.md` is explicit that `cluster_profile` is the expensive path and that
`_CLUSTER_CACHE` is 32 entries which CLEAR WHOLE on overflow. So the obvious
implementation -- loop the neighbours, call `deck_profile` on each -- is out:
1,405 x ~0.17 s is four minutes and it would thrash a 64-entry cache twenty-two
times over.

`deck_counter._cluster_all` already scans every one of those candidates. It
calls `_siblings()` once, drops the hashes in a TEMP table, joins that to
`pair_matchup_agg` on the pair indexes, and then POOLS the result into a single
cluster figure. Steps one to three are exactly what is needed here; step four is
the only thing that changes.

    ONE PASS FOR EVERY CANDIDATE -- because the pass was always over every
    candidate. The existing code just adds them up at the end.

This module therefore keeps the tally PER SIBLING HASH. Same scan, same join,
same indexes, a different grouping.

    IT MUST NOT SHARE `_CLUSTER_CACHE`. That cache's whole-clear behaviour is
    tuned for a different access pattern, and borrowing it would evict the
    counter screens' work every time somebody asked for a swap.

WHAT IS DELIBERATELY NOT HERE YET:

  * the composition veto (`deck_harmony.py`, Phase B) -- until it exists,
    `rank()` accepts a `veto` callable and applies nothing when given None;
  * the card manual's sentence (Phase B);
  * Mode B, the composer (Phase C).

Nothing in this file imports the card manual, and nothing in it produces a
number the database did not.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clash_data as cd
import deck_counter as counter


# ── Constants ───────────────────────────────────────────────────────────────
#
# MAX_SWAP is 2 and that is a claim about EVIDENCE, not about taste. A deck two
# cards from a real one is scored on the >= 6 rung, which pools thousands of
# decks; past that there is no rung left and the figure stops being about the
# deck being asked for. The cap and the ladder are the same fact.
MAX_SWAP = 2

# Reuse, never redefine. `MIN_GAMES` is the floor every other screen applies and
# a swap advisor that used a different one would disagree with the counter board
# about the same deck.
MIN_GAMES = counter.MIN_GAMES

# BUT EIGHT GAMES IS NOT ENOUGH TO RECOMMEND A CARD CHANGE, and that is a
# different question from whether a figure may be DISPLAYED.
#
# MEASURED ON PRODUCTION, 2026-09-05, the first live run of this module. The
# top six swaps were all 15-25 games on ONE archetype of three, and the leader
# claimed +34.5pp:
#
#   mother-witch/vines -> dark-prince/fireball  +34.5pp  1/3 archetypes  25 games
#   wizard -> dark-prince                       +23.3pp  2/3 archetypes  18 games
#
# `_comparable` had already made the delta honest -- it is a like-for-like
# comparison over the shared archetype -- so the arithmetic was right and the
# ADVICE was still bad. An 85.7% win rate over 25 games is noise wearing a
# decimal point, and it outranked better-evidenced swaps because coverage was
# only the second sort key.
#
# A swap whose deciding archetype is below this is still RETURNED and still
# shows its figures, because withholding it would hide a real option. It is
# marked `thin` and sorted after everything that clears the bar: an ordering
# says "trust these first" without pretending the others do not exist.
SWAP_MIN_GAMES = 60

# How many swaps to return. Small on purpose: this is advice a person acts on
# one card at a time, and a list of forty is a list nobody reads.
TOP_SWAPS = 8

# Its own cache, its own cap. See the module docstring.
_TUNE_CACHE: dict[tuple, dict] = {}
_TUNE_MAX = 16


def _key(cards: list[str]) -> str:
    """The deck hash. Sorted, de-duplicated, comma-joined -- the same shape
    `deck_counter` uses, because these keys are compared against its rows."""
    return ",".join(sorted(set(cards)))


def _view(cards: list[str]) -> dict:
    """A deck ARRANGED INTO ITS SLOTS with its evolution and hero art resolved.

    THE BUG THIS EXISTS TO FIX, seen on the live screen: every deck this module
    returned came straight out of `h.split(",")`, and a `deck_hash` IS THE
    SORTED CARD LIST. So the client was handed eight cards in ALPHABETICAL
    order with no art at all, and drew them in that order:

        Baby Dragon, Barbarian Barrel, Bowler, Electro Giant, Goblin Hut, ...

    Two things were wrong at once and they compounded. Slot 1 is the evolution
    slot and slot 2 the hero slot, so alphabetical order puts whatever happens
    to start with 'A' where the evolution belongs -- and with no `art` map
    nothing renders as an evolution or a hero anyway. The result was decks that
    were mis-slotted AND identical-looking, which is exactly how it was
    reported.

    `arrange_deck` is the app's ONE answer to "which slots are special", and it
    is what the meta board, the player screens, the Duel Zone and the PDF all
    use. Called here the same way `real_opponents` calls it:

      * `trust_order=False` (the default) -- REBUILD the slots from what the
        cards ARE. `_drawn()` passes True because a pasted copyDeck link really
        does carry slot order; a deck hash carries the alphabet, so trusting it
        would be trusting a sort.
      * `marks` from `_board_art()` -- how this deck was OBSERVED being
        fielded. A dictionary hit on a snapshot that exists anyway.
      * `inferredArt` when the board has never seen the list, so `CardArt` can
        say the art is a guess rather than an observation.
    """
    if not cards:
        return {"cards": [], "art": {}, "inferredArt": False}
    key = _key(cards)
    observed = counter._board_art().get(key, {})
    try:
        order, art = cd.arrange_deck(list(cards), observed,
                                     slot_of=counter._board_slots().get(key))
    except Exception:
        return {"cards": list(cards), "art": {}, "inferredArt": True}
    return {"cards": order, "art": art, "inferredArt": not observed}


def neighbours(cards: list[str], archetypes: list[str] | None = None) -> dict:
    """Every real deck within `MAX_SWAP` cards of `cards`, scored per archetype.

    Returns::

        {"base": "<hash>", "decks": {hash: {"overlap": n,
                                            "archetypes": {arch: record}}},
         "scanned": n_vocab, "found": n_siblings}

    `archetypes` restricts the tally to the archetypes that matter -- the
    opponent's spread. Passing None counts them all, which is what the coverage
    figure needs and costs the same scan.

    ONE SCAN AND ONE JOIN for all of them. The tally is kept per sibling hash
    rather than pooled, which is the only difference from `_cluster_all`.
    """
    base = _key(cards)
    ck = (base, tuple(sorted(archetypes)) if archetypes else None)
    hit = _TUNE_CACHE.get(ck)
    if hit is not None:
        return hit

    empty = {"base": base, "decks": {}, "scanned": 0, "found": 0}

    # `_siblings` buckets at the LOWEST cluster level, which is 6 -- exactly
    # `MAX_SWAP` cards different. The two constants agree by construction and
    # this assert is here so that stays true if either moves.
    lowest = min(counter.CLUSTER_LEVELS)
    if 8 - lowest != MAX_SWAP:
        # Not fatal -- the scan still works -- but the docstring's claim about
        # rungs would no longer hold, so say so rather than drift silently.
        print("deck_tuner: MAX_SWAP %d does not match CLUSTER_LEVELS %r"
              % (MAX_SWAP, counter.CLUSTER_LEVELS), file=sys.stderr)

    sibs = counter._siblings(list(set(cards)))
    # The deck itself is its own sibling at overlap 8. It is the BASELINE, not a
    # candidate, and it is removed here so no caller has to remember to.
    sibs.pop(base, None)
    tiers = cd._tier_paths()
    if not sibs or not tiers:
        return empty
    try:
        con = cd.connect(tiers[0])
    except Exception:
        return empty

    want = set(archetypes) if archetypes else None
    # {sibling hash: {archetype: [w, l, d, cf, ca, tf, ta]}}
    per: dict[str, dict[str, list[int]]] = {}

    def bump(h, arch, w, l, d, cf, ca, tf, ta):
        if want is not None and arch not in want:
            return
        e = per.setdefault(h, {}).setdefault(arch, [0, 0, 0, 0, 0, 0, 0])
        e[0] += w; e[1] += l; e[2] += d
        e[3] += cf; e[4] += ca; e[5] += tf; e[6] += ta

    try:
        con.execute("CREATE TEMP TABLE IF NOT EXISTS tsib(h TEXT PRIMARY KEY, n INTEGER)")
        con.execute("DELETE FROM tsib")
        con.executemany("INSERT OR IGNORE INTO tsib VALUES (?, ?)", sibs.items())
        # BOTH DIRECTIONS, with every column swapped on the second -- this is
        # what cancels the tracked-player bias, and it is copied from
        # `deck_profile` rather than reinvented so the two can never disagree
        # about what a win rate means.
        #
        # NOTE THE ASYMMETRY IN WHAT IS GROUPED. `deck_a` is the sibling and
        # `deck_b` is its opponent in the first query; the second is the reverse.
        # So the hash selected as `h` is always the SIBLING, and the archetype is
        # always read off the OTHER side.
        for r in con.execute(
                "SELECT p.deck_a h, p.deck_b o, p.a_wins w, p.a_losses l, p.a_draws d, "
                "       p.a_crowns cf, p.b_crowns ca, p.a_three tf, p.b_three ta "
                "FROM pair_matchup_agg p JOIN tsib s ON s.h = p.deck_a"):
            bump(r["h"], counter._archetype_of_hash(r["o"]),
                 r["w"] or 0, r["l"] or 0, r["d"] or 0,
                 r["cf"] or 0, r["ca"] or 0, r["tf"] or 0, r["ta"] or 0)
        for r in con.execute(
                "SELECT p.deck_b h, p.deck_a o, p.a_wins w, p.a_losses l, p.a_draws d, "
                "       p.a_crowns cf, p.b_crowns ca, p.a_three tf, p.b_three ta "
                "FROM pair_matchup_agg p JOIN tsib s ON s.h = p.deck_b"):
            bump(r["h"], counter._archetype_of_hash(r["o"]),
                 r["l"] or 0, r["w"] or 0, r["d"] or 0,
                 r["ca"] or 0, r["cf"] or 0, r["ta"] or 0, r["tf"] or 0)
    except Exception:
        return empty
    finally:
        con.close()

    decks = {}
    for h, tally in per.items():
        # `_score` is `deck_counter`'s, so the MIN_GAMES floor, the confidence
        # tier and the win-rate arithmetic are the ones every other screen uses.
        scored = counter._score(tally)
        if not scored["archetypes"]:
            continue
        decks[h] = {"overlap": sibs.get(h, 0), **scored}

    out = {"base": base, "decks": decks,
           "scanned": len(counter._vocabulary()), "found": len(sibs)}
    if len(_TUNE_CACHE) >= _TUNE_MAX:
        _TUNE_CACHE.clear()
    _TUNE_CACHE[ck] = out
    return out


def diff(base: list[str], other: list[str]) -> tuple[list[str], list[str]]:
    """`(out, in)` -- the cards leaving and the cards arriving, both sorted."""
    a, b = set(base), set(other)
    return sorted(a - b), sorted(b - a)


def _floor(record: dict, archetypes: list[str]) -> tuple[float | None, int, str | None]:
    """`(worst win rate, games behind it, which archetype)` over `archetypes`.

    THE FLOOR, NOT THE MEAN, and that is the whole ranking decision.
    `_expected()` in `coach.py` ranks on a probability-weighted average, so a
    deck that crushes the front-runner and loses to the other two can come
    first. A swap is only an improvement if it does not open a hole, and the
    minimum is what says so.

    Archetypes with no evidence are SKIPPED, never scored at 50%. Averaging over
    an empty set flattens the ranking exactly when evidence is thinnest -- the
    same rule `team_analysis` applies, recorded there as renormalising an
    unanswerable archetype out rather than inventing a number for it.

    SKIPPING IS NOT FREE, THOUGH, AND `_comparable()` BELOW IS WHY. A floor
    taken over a subset is flattering in exact proportion to what the subset
    left out, so this function's result is safe to REPORT and unsafe to
    SUBTRACT. Deltas go through `_comparable`.
    """
    worst, games, where = None, 0, None
    for a in archetypes:
        m = record["archetypes"].get(a)
        if not m:
            continue
        if worst is None or m["winRate"] < worst:
            worst, games, where = m["winRate"], m["games"], a
    return worst, games, where


def _comparable(base: dict, cand: dict, archetypes: list[str]) -> dict:
    """Two floors measured over THE SAME archetypes, and how many that was.

    THE BUG THIS EXISTS TO PREVENT, caught by `test_deck_tuner.py` before this
    shipped and worth stating plainly because the wrong version looks right:

        A swap with evidence against ONE archetype had a floor of 66.7% and the
        base deck's floor was 30.0%, so it ranked first on a +36.7 delta. But
        the base's 30.0 came from BALLOON and the swap had never been measured
        against balloon at all. It was credited with fixing a hole nothing had
        looked at.

    A floor over a subset is flattering in exact proportion to what the subset
    left out, so a delta between two floors measured over DIFFERENT subsets is
    not a comparison. The intersection is the only honest one:

        delta = floor(cand over BOTH) - floor(base over BOTH)

    `coverage` then says how much of the asked-for spread that intersection
    was, so a reader can discount a confident number measured on a third of the
    field. This is `team_analysis`'s `spreadCovered`, applied to a swap.
    """
    both = [a for a in archetypes
            if a in base["archetypes"] and a in cand["archetypes"]]
    b_floor, _bg, _ba = _floor(base, both)
    c_floor, c_games, c_where = _floor(cand, both)
    return {
        "on": both,
        "covered": len(both),
        "coverage": round(len(both) / len(archetypes), 3) if archetypes else 0.0,
        "baseFloor": b_floor,
        "floor": c_floor,
        "floorGames": c_games,
        "floorArchetype": c_where,
        "delta": None if (b_floor is None or c_floor is None)
                 else round(c_floor - b_floor, 1),
    }


def _mean(record: dict, archetypes: list[str],
          weights: dict[str, float] | None) -> tuple[float | None, float]:
    """Weighted mean win rate over the archetypes that have evidence.

    Reported BESIDE the floor, never instead of it. "58.1% expected, 44.0% worst
    case" answers two different questions and a coach wants both.
    """
    num = den = 0.0
    for a in archetypes:
        m = record["archetypes"].get(a)
        if not m:
            continue
        w = (weights or {}).get(a, 1.0)
        num += w * m["winRate"]
        den += w
    if not den:
        return None, 0.0
    return round(num / den, 1), round(den, 4)


def rank(cards: list[str],
         archetypes: list[str],
         weights: dict[str, float] | None = None,
         used: set[str] | None = None,
         comfort: set[str] | None = None,
         veto=None,
         limit: int = TOP_SWAPS) -> dict:
    """Swaps for `cards`, best first, against the archetypes in `archetypes`.

    `weights`   -- how likely each archetype is, for the mean. The floor
                   ignores them by design: a hole is a hole whether or not
                   they were expected to find it.
    `used`      -- cards already spent elsewhere in the duel loadout. An
                   incoming card in this set is ILLEGAL, not merely worse.
    `comfort`   -- cards the player has actually piloted. A TIEBREAK, sized to
                   lose to any real matchup difference; `team_analysis` calls
                   its equivalent "not a model" and this is the same claim.
    `veto`      -- `f(cards) -> str | None`, the composition checklist from
                   Phase B. None means no structural filtering yet, and the
                   result says so in `vetoed`.

    Returns the base reading, the ranked swaps, and enough of the working for a
    reader to disagree with the ranking.
    """
    base_key = _key(cards)
    base_profile = counter.deck_profile(cards)
    base_floor, base_floor_games, base_worst = _floor(base_profile, archetypes)
    base_mean, base_weight = _mean(base_profile, archetypes, weights)

    nb = neighbours(cards, archetypes)
    out, skipped = [], {"swap_too_big": 0, "illegal": 0, "vetoed": 0, "no_floor": 0}

    for h, rec in nb["decks"].items():
        other = h.split(",")
        gone, arrived = diff(cards, other)
        if len(gone) > MAX_SWAP or len(arrived) > MAX_SWAP:
            skipped["swap_too_big"] += 1
            continue
        if used and (set(arrived) & used):
            skipped["illegal"] += 1
            continue
        if veto is not None:
            why = veto(other)
            if why:
                skipped["vetoed"] += 1
                continue
        f, fg, fw = _floor(rec, archetypes)
        if f is None:
            # No evidence on any archetype that matters. Not a weak swap -- an
            # unmeasured one, and it is dropped rather than given a default.
            skipped["no_floor"] += 1
            continue
        # LIKE FOR LIKE. See `_comparable`: the delta is taken over the
        # archetypes BOTH decks were measured on, never over each deck's own
        # convenient subset.
        cmp = _comparable(base_profile, rec, archetypes)
        m, mw = _mean(rec, archetypes, weights)
        view = _view(other)
        out.append({
            "deck": view["cards"],
            "view": view,
            "hash": h,
            "overlap": rec["overlap"],
            "out": gone,
            "in": arrived,
            "cards": len(gone),
            # The candidate's own worst matchup, over everything it has been
            # measured against. Safe to report; not what the delta uses.
            "floor": f,
            "floorGames": fg,
            "floorArchetype": fw,
            # THE HEADLINE IS THE DELTA, because the reader is choosing between
            # this and their current deck, not between this and 50%. Measured
            # on `comparedOn` and no wider.
            "floorDelta": cmp["delta"],
            "comparedOn": cmp["on"],
            "covered": cmp["covered"],
            "coverage": cmp["coverage"],
            "baseFloorHere": cmp["baseFloor"],
            "expected": m,
            "expectedDelta": None if base_mean is None or m is None
                             else round(m - base_mean, 1),
            "weight": mw,
            "games": rec["battles"],
            "archetypes": rec["archetypes"],
            # A swap onto a card they have never piloted is a real cost and it
            # is SAID, not hidden in a score.
            "comfortable": bool(comfort) and all(c in comfort for c in arrived),
            # THIN = the archetype the delta rests on has too few games to act
            # on. Shown, not withheld; sorted last, not deleted. See
            # SWAP_MIN_GAMES for the production run that put this here.
            "thin": cmp["floorGames"] < SWAP_MIN_GAMES,
            "deltaGames": cmp["floorGames"],
        })

    # Deterministic to the last field. Two swaps tie on a rounded win rate
    # constantly and the deck hash is the only stable tiebreak -- the same
    # arrangement `coach.suggest` uses, for the same reason.
    #
    # COVERAGE SITS DIRECTLY UNDER THE DELTA. Two swaps claiming the same gain
    # are not equally believable when one was measured across the whole spread
    # and the other on a third of it, and this is the only place that ordering
    # can be expressed without inventing a weight for it.
    #
    # EVIDENCE BEFORE SIZE. `thin` leads the key, so a well-measured +12 comes
    # before a 25-game +34. That ordering is the whole lesson of the first
    # production run and it is deliberately not a weight -- a weight would let
    # a big enough number buy its way past thin evidence, which is exactly what
    # happened.
    out.sort(key=lambda r: (
        r["thin"],
        -(r["floorDelta"] if r["floorDelta"] is not None else -99),
        -r["coverage"],
        -(r["expectedDelta"] if r["expectedDelta"] is not None else -99),
        not r["comfortable"],
        r["cards"],
        -r["games"],
        r["hash"],
    ))

    return {
        "base": {
            "hash": base_key,
            "cards": _view(cards)["cards"],
            "view": _view(cards),
            "floor": base_floor,
            "floorGames": base_floor_games,
            "floorArchetype": base_worst,
            "expected": base_mean,
            "weight": base_weight,
            "games": base_profile["battles"],
            # An empty profile is not a bad deck -- it is a deck nobody has
            # played enough of, and every delta below is then None rather than
            # a comparison against nothing.
            "measured": bool(base_profile["archetypes"]),
        },
        "archetypes": list(archetypes),
        "swaps": out[:limit],
        "considered": len(nb["decks"]),
        "siblings": nb["found"],
        "scanned": nb["scanned"],
        "skipped": skipped,
        # Stated rather than assumed, because Phase B is what fills it in and a
        # reader must know whether the structural filter ran at all.
        "vetoed": veto is not None,
        "minGames": MIN_GAMES,
        "swapMinGames": SWAP_MIN_GAMES,
        "thin": sum(1 for r in out[:limit] if r["thin"]),
        "maxSwap": MAX_SWAP,
    }


# ── MODE B — the composer ───────────────────────────────────────────────────
#
#     GENERATION IS A SEARCH FOR A REAL DECK NOBODY HAS SHOWN YOU YET -- not an
#     invention of a deck nobody has played.
#
# Phase 18 closed free combinatorial generation: 122 choose 8 is 2.4e11
# candidates and no evidence for any of them. That result stands. What this does
# instead is CHOOSE from `deck_counter.seeds()` -- the most-played real decks
# per archetype, each with its own per-archetype record, built on the snapshot
# thread. So:
#
#   * every deck this returns is one somebody actually pilots, which is what
#     keeps it balanced without a model having to make it so;
#   * every figure is that deck's own record at the deck-vs-archetype rung,
#     not a smoothed cluster reading;
#   * AND IT DOES NO DATABASE WORK AT ALL. The pool is in memory. That is the
#     whole reason the scan was moved to the background thread.

#: Decks offered. Small: this is a choice a person makes, and a list of thirty
#: real decks is a list nobody reads.
TOP_DECKS = 6

#: How many candidates the loadout search may combine. The triple search is
#: combinatorial, so this is the lever that keeps it bounded.
LOADOUT_POOL = 24


def _rate(rec: dict, arch: str) -> float | None:
    m = rec["archetypes"].get(arch)
    return m["winRate"] if m else None


def compose(archetypes: list[str],
            weights: dict[str, float] | None = None,
            used: set[str] | None = None,
            comfort: set[str] | None = None,
            veto=None,
            exclude: set[str] | None = None,
            limit: int = TOP_DECKS,
            pool: dict | None = None) -> dict:
    """Real decks that cover `archetypes`, best worst-matchup first.

    `used`    -- cards spent elsewhere in the duel loadout. A deck containing
                 one is ILLEGAL and is removed, not ranked lower.
    `exclude` -- deck hashes already chosen, so a loadout does not offer the
                 same list twice.
    `pool`    -- override for testing; defaults to the snapshot's seeds.

    RANKED ON THE WORST MATCHUP, never the average. A deck that beats their
    likeliest deck and loses to the other two is not the deck to bring, and the
    user's own question settles it: they may bring cards they have never played
    purely to counter you, so what matters is that nothing in the field has a
    clean answer.
    """
    seedmap = pool if pool is not None else counter.seeds()
    used = used or set()
    exclude = exclude or set()
    out, skipped = [], {"illegal": 0, "vetoed": 0, "no_floor": 0, "excluded": 0}

    for _arch, decks in seedmap.items():
        for d in decks:
            if d["hash"] in exclude:
                skipped["excluded"] += 1
                continue
            if used & set(d["cards"]):
                skipped["illegal"] += 1
                continue
            if veto is not None and veto(d["cards"]):
                skipped["vetoed"] += 1
                continue
            f, fg, fw = _floor(d, archetypes)
            if f is None:
                skipped["no_floor"] += 1
                continue
            m, mw = _mean(d, archetypes, weights)
            covered = sum(1 for a in archetypes if a in d["archetypes"])
            view = _view(d["cards"])
            out.append({
                "deck": view["cards"],
                "view": view,
                "hash": d["hash"],
                "archetype": counter._archetype_of_hash(d["hash"]),
                "floor": f,
                "floorGames": fg,
                "floorArchetype": fw,
                "expected": m,
                "weight": mw,
                "covered": covered,
                "coverage": round(covered / len(archetypes), 3) if archetypes else 0.0,
                "games": d["games"],
                "archetypes": d["archetypes"],
                # How many of its eight cards the player has piloted. NOT a
                # score -- a number the reader weighs, because being handed a
                # deck with eight unfamiliar cards mid-duel is a real cost.
                "familiar": sum(1 for c in d["cards"] if c in (comfort or set())),
            })

    # Floor first, then how much of the spread that floor was measured over --
    # the same ordering `rank()` uses and for the same reason. Familiarity is a
    # tiebreak and never overturns evidence.
    out.sort(key=lambda r: (
        -r["floor"], -r["coverage"], -r["familiar"], -r["games"], r["hash"]))

    return {
        "archetypes": list(archetypes),
        "decks": out[:limit],
        "considered": len(out),
        "skipped": skipped,
        "vetoed": veto is not None,
        "poolSize": sum(len(v) for v in seedmap.values()),
        # An empty pool is a SNAPSHOT problem, not "no good decks", and the two
        # must not look the same on screen.
        "poolReady": bool(seedmap),
    }


def loadout(archetypes: list[str],
            weights: dict[str, float] | None = None,
            comfort: set[str] | None = None,
            veto=None,
            pool: dict | None = None,
            size: int = 3) -> dict:
    """Three decks that share no cards, chosen to cover the field BETWEEN them.

        loadout_floor = min over archetype a of ( max over deck d of rate(d, a) )

    THREE DECKS COVER TOGETHER, and that is why they cannot be picked
    independently. Taking the three best decks one at a time gives three decks
    with the same strengths and the same hole -- and the first one eats the
    good cards, so the second and third are chosen from what is left rather
    than from what is needed.

    A duel loadout cannot share a card. `MECHANISM.md` records that verified
    absolute: 21,432 pairs, zero overlap. So this is a set-packing problem, and
    it is solved greedily over a bounded pool with the FLOOR as the objective
    rather than each deck's own quality.
    """
    first = compose(archetypes, weights, comfort=comfort, veto=veto,
                    limit=LOADOUT_POOL, pool=pool)
    cands = first["decks"]
    chosen: list[dict] = []
    used: set[str] = set()

    for _ in range(size):
        best, best_floor = None, None
        for c in cands:
            if c["hash"] in {d["hash"] for d in chosen}:
                continue
            if used & set(c["deck"]):
                continue
            # What the loadout's floor WOULD be with this deck added. Chosen on
            # the group's worst archetype, not on the candidate's own quality:
            # a mediocre deck that answers the one thing nothing else does is
            # worth more here than a strong deck that repeats a strength.
            trial = chosen + [c]
            floor = None
            for a in archetypes:
                rates = [r for r in (_rate(d, a) for d in trial) if r is not None]
                if not rates:
                    continue
                bestrate = max(rates)
                if floor is None or bestrate < floor:
                    floor = bestrate
            if floor is None:
                continue
            if best_floor is None or floor > best_floor:
                best, best_floor = c, floor
        if best is None:
            break
        chosen.append(best)
        used |= set(best["deck"])

    # What the group actually covers, archetype by archetype -- the reading the
    # reader needs to see, because "which of my three answers this" is the
    # question a duel actually asks.
    cover = []
    for a in archetypes:
        rates = [(_rate(d, a), d["hash"]) for d in chosen]
        got = [(r, h) for r, h in rates if r is not None]
        cover.append({
            "archetype": a,
            "best": max(got)[0] if got else None,
            "by": max(got)[1] if got else None,
            # Named rather than hidden: an archetype none of the three has been
            # measured against is a gap in the EVIDENCE, not a bad matchup, and
            # calling it 50% would invent the number this project refuses.
            "measured": bool(got),
        })

    measured = [c["best"] for c in cover if c["best"] is not None]
    return {
        "archetypes": list(archetypes),
        "decks": chosen,
        "coverage": cover,
        "loadoutFloor": min(measured) if measured else None,
        "uncovered": [c["archetype"] for c in cover if not c["measured"]],
        "poolSize": first["poolSize"],
        "poolReady": first["poolReady"],
        "vetoed": veto is not None,
    }
