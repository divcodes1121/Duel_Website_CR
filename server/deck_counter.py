"""deck_counter.py — what beats what, and what beats this player.

Three questions behind `#/player/<tag>/counter`:

  * **Player Counter** — which archetypes this player loses to, and what to
    bring against them.
  * **Deck vs Deck** — paste two decks, get the head-to-head.
  * **Find Counters** — paste one deck, get what beats it.

────────────────────────────────────────────────────────────────────────────
THE MEASUREMENT THAT SHAPES THIS WHOLE FILE
────────────────────────────────────────────────────────────────────────────

**1. Exact deck-vs-deck is not answerable, and the numbers say so.**
`pair_matchup_agg` holds 1,961,367 deck pairings over 2,399,151 battles, and
they are almost all singletons:

    >= 1 game   1,961,367   100%
    >= 4 games     29,902   1.52%
    >= 8 games     11,502   0.59%      <- our evidence floor
    >= 50 games     1,020   0.05%

So a screen promising "62.4% over 284 battles" for two pasted decks would be
inventing the number for 99.4% of inputs. Matchups are therefore computed at
ARCHETYPE level (the stored `win_condition`), where all 289 cells clear 50
games. That is also what the design's own labels imply — "Hog Cycle" and
"P.E.K.K.A Bridge Spam" are archetypes, not deck lists.

**2. The raw table is biased, and reading it straight makes everything a
counter.** `deck_a` is the TRACKED player's deck, and tracked players are not a
random sample — they win **58.59%** of all stored battles. The bias shows up
where it can be checked: a mirror matchup must be 50% by symmetry, and the raw
table says bait-vs-bait 58.0%, hog-vs-hog 58.8%, graveyard-vs-graveyard 62.5%.

The fix is to symmetrise: cell (A,B) is combined with the REVERSE of cell
(B,A), so the house edge cancels. Every mirror then lands at exactly 50.0% —
that is the proof the correction is right, not an assumption — and the real
matchups come out sane: X-Bow vs Golem 39.9%, Lava vs X-Bow 42.0%, Graveyard vs
Mortar 44.5%.

**Never report a raw cell.** `_symmetric()` is the only way matchup numbers
leave this module.

**3. There is no match duration anywhere.** Not in `battles`, not in
`pair_matchup_agg`, not in the stored `battle_raw` payload, whose keys are
type / battleTime / isLadderTournament / arena / gameMode / deckSelection /
team / opponent / isHostedMatch / leagueNumber. An "average match time" tile
cannot be built from this data and is not faked.

────────────────────────────────────────────────────────────────────────────

The archetype matrix costs ~60 s to build (1.96M pairings joined to a 1.05M-row
deck table), so it is a BACKGROUND SNAPSHOT on the same pattern as `meta.py`,
persisted to disk so a restart serves the previous numbers immediately. The
per-player half needs no snapshot at all: `battles.opponent_win_condition` is
already stored and 100% populated, so that query is ~40 ms.
"""

from __future__ import annotations

import json
import os
import threading
import time

import clash_data as cd
import duel_combos as dx
import meta as meta_board

SNAPSHOT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             ".counter_snapshot.json")
REFRESH_SECONDS = float(os.getenv("CLASH_COUNTER_REFRESH", "3600"))

# Battles behind a matchup before it is reported at all. The pair board's floor
# again (`duel_combos.CONF_MIN_GAMES`), for the same reason.
MIN_GAMES = dx.CONF_MIN_GAMES

# How many counters the CLIENT shows before its "show more" control. Every cell
# clears the evidence floor, so this is a reading budget, not an evidence one —
# and it is only the first page. `find_counters` returns every archetype that
# actually beats the deck.
TOP_COUNTERS = 5

# Battles a pasted deck needs before ITS OWN overall record is used as the
# baseline that counter advantages are measured against. Far above MIN_GAMES,
# because this figure pools every archetype and is then subtracted from all of
# them — an error in it moves every row. At 50 decided battles the baseline is
# worth about +-14 points at 95%, which is loose but no longer nonsense, and
# any deck with real play clears it by orders of magnitude (the most-played Hog
# list has 111,663).
BASELINE_MIN_BATTLES = 50

_lock = threading.Lock()
_snapshot: dict | None = None
_state = {"building": False, "error": None, "startedAt": None}


# --------------------------------------------------------------------------
# Play style — a judgement call, and labelled as one
# --------------------------------------------------------------------------
#
# The design asks for a "counter types" breakdown (Beatdown / Control / Siege /
# Bridge Spam). NOTHING IN THE DATABASE CARRIES THAT: the stored taxonomy is
# `win_condition`, which is a card, not a play style. Rather than drop the
# breakdown or invent a classifier, the seventeen stored archetypes are mapped
# to the five styles players actually use for them. It is opinion, it is in one
# place, and the UI says the grouping is editorial.

STYLE = {
    "golem": "Beatdown", "lava": "Beatdown", "giant": "Beatdown",
    "e-giant": "Beatdown", "3-musk": "Beatdown", "balloon": "Beatdown",
    "xbow": "Siege", "mortar": "Siege",
    "graveyard": "Control", "miner": "Control", "royal-giant": "Control",
    "drill": "Control",
    "hog": "Cycle", "piggies": "Cycle", "bait": "Cycle",
    "bridge-spam": "Bridge Spam",
    "other": "Mixed",
}


def style_of(archetype: str) -> str:
    return STYLE.get((archetype or "").lower(), "Mixed")


# --------------------------------------------------------------------------
# Win conditions — the bot's map, reproduced exactly
# --------------------------------------------------------------------------
#
# `cards.WIN_CONDITION_MAP` / `WIN_CONDITION_PRIORITY` from Clash_Bot, carried
# over unchanged. Every stored `decks.win_condition` was written by the function
# that reads these, so a deck the table has never seen has to be classified the
# same way or it lands on an archetype the matrix has no row for. The order is
# part of the rule, not incidental: the first match down the list wins.

WIN_CONDITION_MAP = {
    "hog-rider": "hog", "goblin-drill": "drill", "graveyard": "graveyard",
    "miner": "miner", "battle-ram": "bridge-spam", "ram-rider": "bridge-spam",
    "royal-hogs": "piggies", "royal-giant": "royal-giant",
    "lava-hound": "lava", "giant": "giant", "balloon": "balloon",
    "electro-giant": "e-giant", "golem": "golem",
    "three-musketeers": "3-musk", "mortar": "mortar", "x-bow": "xbow",
    "goblin-barrel": "bait",
}

WIN_CONDITION_PRIORITY = [
    "lava-hound", "golem", "electro-giant", "royal-giant", "giant",
    "hog-rider", "goblin-drill", "graveyard", "royal-hogs", "balloon",
    "battle-ram", "ram-rider", "mortar", "x-bow", "three-musketeers",
]


# --------------------------------------------------------------------------
# THE EXACT DECK'S OWN RECORD
# --------------------------------------------------------------------------
#
# Archetype-level matchups answer "how does Hog do into Graveyard". They cannot
# answer "how does MY Hog do into Graveyard", and swapping a card for a better
# one has to move the number or the screen is not about your deck at all.
#
# The earlier reading — that deck-level was unanswerable — was drawn from the
# right measurement and applied too widely. What is unanswerable is deck vs
# EXACT DECK: 1,979,822 stored pairings and only 11,633 (0.59%) reach 8 games,
# so a specific list against another specific list is almost always a singleton.
#
# Deck vs ARCHETYPE is a different question and the data answers it easily. The
# most-played Hog deck appears in 29,562 pairings as deck_a and 20,182 as
# deck_b: 111,663 decided battles for that one list, and every one of the
# seventeen archetypes clears 697 games against it. Change a card and the deck
# hash changes, so the record changes with it — which is the whole point.
#
# TWO THINGS MAKE IT FAST ENOUGH TO DO ON A KEYPRESS.
#
#  * No join. `deck_hash` IS the sorted card list, so an opponent's archetype is
#    derived from its own key rather than looked up in `decks`. Joining 29,562
#    primary-key lookups into a 1.05M-row table cost 9.7 s; deriving them in
#    Python costs ~50 ms and agrees with the stored column on 400,000 of
#    400,000 real decks.
#  * `ix_pair_a` and `ix_pair_b` already exist, so both directions are index
#    scans.
#
# AND IT IS STILL SYMMETRISED. `deck_a` is the tracked player's side, so the
# forward rows carry the same 58.6% house edge as the archetype matrix. The
# reverse rows are folded in with wins, losses and crowns swapped. The check is
# the same one: this deck's overall record across the whole field comes out at
# 49.9%, not 58%.

_PROFILE_CACHE: dict[str, dict] = {}
_PROFILE_MAX = 64

# ── Near-identical decks ────────────────────────────────────────────────────
#
# The bot's own backoff (`deck_search.DeckArchetypeIndex.wr`) is pair -> cluster
# -> model -> global, where a CLUSTER is every deck sharing at least
# `CLUSTER_MIN_OVERLAP` (6) cards. Reproduced here as a two-rung ladder, because
# "6 of 8" and "7 of 8" are different amounts of "the same deck" and the reader
# should see both rather than have one picked for them:
#
#   exact      these eight cards
#   >= 7       one card different
#   >= 6       two cards different
#   archetype  the win condition, and nothing else
#
# Measured on the most-played Hog list: 1,405 decks share 7+ cards with it and
# 4,439 share 6+, carrying 69,736 and 77,381 games. So the rungs are real
# evidence, not a smoothing trick.
#
# COST, and why it is shaped this way. Finding siblings means looking at every
# stored deck — there is no index for "shares six cards with this" — so the
# 1,054,394 deck hashes are read once per process (2.2 s) and kept. The scan
# itself is 1.6 s. Aggregating a cluster's pair rows was 4.4 s through chunked
# `IN (...)` clauses and is 1.0 s through a TEMP table joined to `ix_pair_a`,
# which is why it is done that way; a `mode=ro` connection can still create
# temp tables, since they live in a separate temp database.
CLUSTER_LEVELS = (7, 6)

_VOCAB: list[str] | None = None
_CLUSTER_CACHE: dict[tuple[str, int], dict] = {}
_CLUSTER_MAX = 32


def _vocabulary() -> list[str]:
    """Every stored deck hash. Read once; the deck population moves in days."""
    global _VOCAB
    if _VOCAB is None:
        tiers = cd._tier_paths()
        if not tiers:
            return []
        try:
            con = cd.connect(tiers[0])
        except Exception:
            return []
        try:
            _VOCAB = [r[0] for r in con.execute("SELECT deck_hash FROM decks")]
        except Exception:
            _VOCAB = []
        finally:
            con.close()
    return _VOCAB


def _siblings(cards: list[str]) -> dict[str, int]:
    """`{deck_hash: shared card count}` for everything within reach.

    ONE scan for every level. `>= 7` is a subset of `>= 6`, so counting the
    overlap once and bucketing afterwards costs 1.6 s instead of 3.2 s — the
    scan is the expensive half, not the comparison.
    """
    mine = set(cards)
    lowest = min(CLUSTER_LEVELS)
    out = {}
    for h in _vocabulary():
        n = 0
        for c in h.split(","):
            if c in mine:
                n += 1
        if n >= lowest:
            out[h] = n
    return out


def _cluster_all(cards: list[str]) -> dict[int, dict]:
    """Every cluster level for one deck, from a single pass over the database.

    Both levels share a scan AND a join: the temp table carries each sibling's
    overlap count, so one walk over the pair rows fills every bucket. Two
    separate passes read 39,925 + 46,869 rows; this reads 46,869 once.
    """
    key = ",".join(sorted(set(cards)))
    cached = {lv: _CLUSTER_CACHE[(key, lv)]
              for lv in CLUSTER_LEVELS if (key, lv) in _CLUSTER_CACHE}
    if len(cached) == len(CLUSTER_LEVELS):
        return cached

    empty = {"archetypes": {}, "overall": None, "battles": 0, "decks": 0}
    out = {lv: dict(empty) for lv in CLUSTER_LEVELS}
    sibs = _siblings(list(set(cards)))
    tiers = cd._tier_paths()
    if not sibs or not tiers:
        return out
    try:
        con = cd.connect(tiers[0])
    except Exception:
        return out

    # One tally per level; a deck sharing 7 counts toward the 6 bucket too.
    per: dict[int, dict[str, list[int]]] = {lv: {} for lv in CLUSTER_LEVELS}

    def bump(level, arch, w, l, d, cf, ca, tf, ta):
        for lv in CLUSTER_LEVELS:
            if level >= lv:
                e = per[lv].setdefault(arch, [0, 0, 0, 0, 0, 0, 0])
                e[0] += w; e[1] += l; e[2] += d
                e[3] += cf; e[4] += ca; e[5] += tf; e[6] += ta

    try:
        con.execute("CREATE TEMP TABLE IF NOT EXISTS sib(h TEXT PRIMARY KEY, n INTEGER)")
        con.execute("DELETE FROM sib")
        con.executemany("INSERT OR IGNORE INTO sib VALUES (?, ?)", sibs.items())
        for r in con.execute(
                "SELECT p.deck_b h, s.n n, p.a_wins w, p.a_losses l, p.a_draws d, "
                "       p.a_crowns cf, p.b_crowns ca, p.a_three tf, p.b_three ta "
                "FROM pair_matchup_agg p JOIN sib s ON s.h = p.deck_a"):
            bump(r["n"], _archetype_of_hash(r["h"]), r["w"] or 0, r["l"] or 0,
                 r["d"] or 0, r["cf"] or 0, r["ca"] or 0, r["tf"] or 0, r["ta"] or 0)
        for r in con.execute(
                "SELECT p.deck_a h, s.n n, p.a_wins w, p.a_losses l, p.a_draws d, "
                "       p.a_crowns cf, p.b_crowns ca, p.a_three tf, p.b_three ta "
                "FROM pair_matchup_agg p JOIN sib s ON s.h = p.deck_b"):
            bump(r["n"], _archetype_of_hash(r["h"]), r["l"] or 0, r["w"] or 0,
                 r["d"] or 0, r["ca"] or 0, r["cf"] or 0, r["ta"] or 0, r["tf"] or 0)
    except Exception:
        return out
    finally:
        con.close()

    if len(_CLUSTER_CACHE) >= _CLUSTER_MAX:
        _CLUSTER_CACHE.clear()
    for lv in CLUSTER_LEVELS:
        res = _score(per[lv])
        res["decks"] = sum(1 for n in sibs.values() if n >= lv)
        out[lv] = res
        _CLUSTER_CACHE[(key, lv)] = res
    return out


def cluster_profile(cards: list[str], overlap: int) -> dict:
    """One level of `_cluster_all`, which computes them all together."""
    key = (",".join(sorted(set(cards))), overlap)
    hit = _CLUSTER_CACHE.get(key)
    if hit is not None:
        return hit
    return _cluster_all(cards).get(
        overlap, {"archetypes": {}, "overall": None, "battles": 0, "decks": 0})


def _score(per: dict[str, list[int]]) -> dict:
    """Tally -> per-archetype records. Shared by the exact and cluster paths so
    the two can never differ in how a win rate or a tier is computed."""
    out: dict[str, dict] = {}
    tw = tl = tg = 0
    for arch, (w, l, d, cf, ca, tf, ta) in per.items():
        games = w + l + d
        tw += w; tl += l; tg += games
        if games < MIN_GAMES:
            continue
        decided = max(1, w + l)
        tier, interval = dx.confidence_tier(w, decided)
        out[arch] = {
            "games": games, "wins": w, "losses": l, "draws": d,
            "winRate": round(100 * w / decided, 1),
            "avgCrownsFor": round(cf / games, 2),
            "avgCrownsAgainst": round(ca / games, 2),
            "crownDiff": round((cf - ca) / games, 2),
            "threeCrownFor": round(100 * tf / games, 1),
            "threeCrownAgainst": round(100 * ta / games, 1),
            "tier": tier, "interval": interval,
        }
    overall = None
    if tw + tl:
        overall = {"winRate": round(100 * tw / (tw + tl), 1), "games": tg}
    return {"archetypes": out, "overall": overall, "battles": tg}


def _archetype_of_hash(deck_hash: str) -> str:
    """An opponent's archetype, straight off its key. See the note above."""
    names = set(deck_hash.split(","))
    if "miner" in names:
        return "miner"
    if "goblin-barrel" in names or "wall-breakers" in names:
        return "bait"
    for card in WIN_CONDITION_PRIORITY:
        if card in names:
            return WIN_CONDITION_MAP[card]
    return "other"


def deck_profile(cards: list[str]) -> dict:
    """`{archetype: record}` for THIS EXACT DECK, symmetrised.

    Returns `{"archetypes": {...}, "overall": {...}, "battles": n}`, or empty
    when the deck has never been seen. Cached, because the screen asks for the
    same deck repeatedly as the user clicks between tabs.
    """
    key = ",".join(sorted(set(cards)))
    hit = _PROFILE_CACHE.get(key)
    if hit is not None:
        return hit

    per: dict[str, list[int]] = {}
    tiers = cd._tier_paths()
    if not tiers:
        return {"archetypes": {}, "overall": None, "battles": 0}

    def bump(arch, w, l, d, cf, ca, tf, ta):
        e = per.setdefault(arch, [0, 0, 0, 0, 0, 0, 0])
        e[0] += w; e[1] += l; e[2] += d
        e[3] += cf; e[4] += ca; e[5] += tf; e[6] += ta

    try:
        con = cd.connect(tiers[0])
    except Exception:
        return {"archetypes": {}, "overall": None, "battles": 0}
    try:
        for r in con.execute(
            "SELECT deck_b h, a_wins w, a_losses l, a_draws d, "
            "       a_crowns cf, b_crowns ca, a_three tf, b_three ta "
            "FROM pair_matchup_agg WHERE deck_a = ?", (key,)):
            bump(_archetype_of_hash(r["h"]), r["w"] or 0, r["l"] or 0, r["d"] or 0,
                 r["cf"] or 0, r["ca"] or 0, r["tf"] or 0, r["ta"] or 0)
        # The reverse direction, with every side swapped — this is what cancels
        # the tracked-player bias.
        for r in con.execute(
            "SELECT deck_a h, a_wins w, a_losses l, a_draws d, "
            "       a_crowns cf, b_crowns ca, a_three tf, b_three ta "
            "FROM pair_matchup_agg WHERE deck_b = ?", (key,)):
            bump(_archetype_of_hash(r["h"]), r["l"] or 0, r["w"] or 0, r["d"] or 0,
                 r["ca"] or 0, r["cf"] or 0, r["ta"] or 0, r["tf"] or 0)
    except Exception:
        return {"archetypes": {}, "overall": None, "battles": 0}
    finally:
        con.close()

    res = _score(per)
    res["decks"] = 1

    if len(_PROFILE_CACHE) >= _PROFILE_MAX:
        _PROFILE_CACHE.clear()
    _PROFILE_CACHE[key] = res
    return res


def real_opponents(cards: list[str], limit: int = 24) -> list[dict]:
    """The actual decks this exact list has played, with the scoreline.

    NO EVIDENCE FLOOR, because this is not an estimate. `MIN_GAMES` exists so
    the screen never quotes a win rate off two games, and that is right — but
    it also meant a deck that genuinely lost 0-3 to a specific Lava Hound list
    vanished from the page entirely, replaced by archetype rows measured on
    decks one card different. "Your deck lost to this deck" is a fact about
    games that were played; it needs a record, not a sample size.

    So the rate table keeps its floor and this sits beside it, reporting W-L
    rather than a percentage. Losing records first, because the question people
    arrive with is what beat them.

    Two indexed lookups on `pair_matchup_agg`, so it costs nothing.
    """
    key = ",".join(sorted(set(cards)))
    tiers = cd._tier_paths()
    if not tiers:
        return []
    try:
        con = cd.connect(tiers[0])
    except Exception:
        return []
    agg: dict[str, list[int]] = {}
    try:
        for r in con.execute(
                "SELECT deck_b o, a_wins w, a_losses l, a_draws d "
                "FROM pair_matchup_agg WHERE deck_a = ?", (key,)):
            e = agg.setdefault(r["o"], [0, 0, 0])
            e[0] += r["w"] or 0; e[1] += r["l"] or 0; e[2] += r["d"] or 0
        for r in con.execute(
                "SELECT deck_a o, a_losses w, a_wins l, a_draws d "
                "FROM pair_matchup_agg WHERE deck_b = ?", (key,)):
            e = agg.setdefault(r["o"], [0, 0, 0])
            e[0] += r["w"] or 0; e[1] += r["l"] or 0; e[2] += r["d"] or 0
    except Exception:
        return []
    finally:
        con.close()

    out = []
    for opp, (w, l, d) in agg.items():
        # A loadout row is a whole duel, not a deck it faced.
        if opp.count(",") != 7 or opp == key:
            continue
        cards_o = opp.split(",")
        order, art = cd.arrange_deck(cards_o, _board_art().get(opp, {}),
                                     slot_of=_board_slots().get(opp))
        arch = _archetype_of_hash(opp)
        out.append({
            "archetype": arch, "name": _label(arch), "style": style_of(arch),
            "cards": order, "art": art,
            "inferredArt": opp not in _board_art(),
            "wins": w, "losses": l, "draws": d, "games": w + l + d,
            "avgElixir": _avg_elixir(cards_o),
            # Stated as a record. A percentage off two games is the thing the
            # floor exists to prevent.
            "beatsYou": l > w,
        })
    # What beat you, worst first; then the rest by how much was played.
    out.sort(key=lambda r: (not r["beatsYou"], -(r["losses"] - r["wins"]), -r["games"]))
    return out[:limit]


def exact_pair(cards_a: list[str], cards_b: list[str]) -> dict | None:
    """Two EXACT lists against each other, when that record actually exists.

    Almost never does — 0.59% of stored pairings reach the floor — but when it
    does it is the best answer available and beats any generalisation.
    """
    a = ",".join(sorted(set(cards_a)))
    b = ",".join(sorted(set(cards_b)))
    tiers = cd._tier_paths()
    if not tiers or a == b:
        return None
    try:
        con = cd.connect(tiers[0])
    except Exception:
        return None
    try:
        f = con.execute(
            "SELECT a_wins w, a_losses l, a_draws d, a_crowns ac, b_crowns bc, "
            "       a_three a3, b_three b3 FROM pair_matchup_agg "
            "WHERE deck_a = ? AND deck_b = ?", (a, b)).fetchone()
        r = con.execute(
            "SELECT a_wins w, a_losses l, a_draws d, a_crowns ac, b_crowns bc, "
            "       a_three a3, b_three b3 FROM pair_matchup_agg "
            "WHERE deck_a = ? AND deck_b = ?", (b, a)).fetchone()
    except Exception:
        return None
    finally:
        con.close()
    if not f and not r:
        return None
    snap = {"cells": {}}
    if f:
        snap["cells"][f"{a}|{b}"] = dict(f)
    if r:
        snap["cells"][f"{b}|{a}"] = dict(r)
    return _symmetric(snap, a, b)


# --------------------------------------------------------------------------
# Building the matrix
# --------------------------------------------------------------------------

def _build_matrix() -> dict:
    """Raw archetype x archetype cells, straight out of `pair_matchup_agg`.

    Returned UNSYMMETRISED and never handed out in that form — `_symmetric()`
    is what callers read. Keeping the raw direction is what makes the
    correction possible at all.
    """
    tiers = cd._tier_paths()
    if not tiers:
        raise RuntimeError("no readable database")

    con = cd.connect(tiers[0])
    try:
        rows = con.execute(
            """SELECT da.win_condition a, db.win_condition b,
                      SUM(p.a_wins) w, SUM(p.a_losses) l, SUM(p.a_draws) d,
                      SUM(p.games) g, SUM(p.a_crowns) ac, SUM(p.b_crowns) bc,
                      SUM(p.a_three) a3, SUM(p.b_three) b3
                 FROM pair_matchup_agg p
                 JOIN decks da ON da.deck_hash = p.deck_a
                 JOIN decks db ON db.deck_hash = p.deck_b
                WHERE p.deck_a <> '' AND p.deck_b <> ''
                GROUP BY da.win_condition, db.win_condition"""
        ).fetchall()
    finally:
        con.close()

    cells = {}
    tw = tl = 0
    for r in rows:
        a, b = (r["a"] or "other"), (r["b"] or "other")
        cells[f"{a}|{b}"] = {
            "w": r["w"] or 0, "l": r["l"] or 0, "d": r["d"] or 0,
            "g": r["g"] or 0, "ac": r["ac"] or 0, "bc": r["bc"] or 0,
            "a3": r["a3"] or 0, "b3": r["b3"] or 0,
        }
        tw += r["w"] or 0
        tl += r["l"] or 0

    return {
        "cells": cells,
        "archetypes": sorted({k.split("|")[0] for k in cells}),
        # Kept so the UI can state the bias it is correcting for.
        "rawBias": round(100 * tw / max(1, tw + tl), 2),
        "battles": tw + tl,
        "reps": _build_reps(),
        "computedAt": time.time(),
    }


def _build_reps() -> dict[str, list[str]]:
    """`archetype -> the most-played deck of it`, over the MATCHUP population.

    The bot's own rule for a representative — `deck_search`'s "the most-observed
    deck of an archetype" — and deliberately NOT the meta board's top 50, which
    is where these used to come from.

    The board excludes duel and friendly modes on purpose: it answers "what is
    the ladder running", and duels have their own screen. But this screen's
    numbers come from `pair_matchup_agg`, which has no mode filter at all —
    measured, duel battles are present at 72.7% against 61.3% for normal ones.
    So a row's figures counted duels while the deck printed beside it was picked
    from a population that had them removed. Same table for both now.

    Derived without a join: `deck_hash` is the sorted card list, so an
    archetype comes off the key. The GROUP BY is 1.98M rows into ~231k groups
    and belongs here, on the background thread, not in a request.
    """
    tiers = cd._tier_paths()
    if not tiers:
        return {}
    try:
        con = cd.connect(tiers[0])
    except Exception:
        return {}
    totals: dict[str, int] = {}
    try:
        for col in ("deck_a", "deck_b"):
            for h, g in con.execute(
                    f"SELECT {col}, SUM(games) FROM pair_matchup_agg "
                    f"WHERE {col} <> '' GROUP BY {col}"):
                totals[h] = totals.get(h, 0) + (g or 0)
    except Exception:
        return {}
    finally:
        con.close()

    best: dict[str, tuple[int, str]] = {}
    for h, g in totals.items():
        # A loadout row (16 or 24 cards) is a whole duel, not a deck; it cannot
        # represent an archetype and it never matches a pasted list.
        if h.count(",") != 7:
            continue
        arch = _archetype_of_hash(h)
        if arch not in best or g > best[arch][0]:
            best[arch] = (g, h)
    return {a: h.split(",") for a, (_g, h) in best.items()}


def _symmetric(snap: dict, a: str, b: str) -> dict | None:
    """A's record against B, with the tracked-player bias removed.

    Cell (A,B) plus the reverse of cell (B,A). A mirror comes out at exactly
    50%, which is the check that this is right.
    """
    cells = snap["cells"]
    f = cells.get(f"{a}|{b}")
    r = cells.get(f"{b}|{a}")
    if not f and not r:
        return None

    w = (f["w"] if f else 0) + (r["l"] if r else 0)
    l = (f["l"] if f else 0) + (r["w"] if r else 0)
    d = (f["d"] if f else 0) + (r["d"] if r else 0)
    ac = (f["ac"] if f else 0) + (r["bc"] if r else 0)
    bc = (f["bc"] if f else 0) + (r["ac"] if r else 0)
    a3 = (f["a3"] if f else 0) + (r["b3"] if r else 0)
    b3 = (f["b3"] if f else 0) + (r["a3"] if r else 0)
    games = w + l + d
    if games < MIN_GAMES:
        return None

    decided = max(1, w + l)
    tier, interval = dx.confidence_tier(w, decided)
    return {
        "a": a, "b": b,
        "games": games, "wins": w, "losses": l, "draws": d,
        "winRate": round(100 * w / decided, 1),
        "avgCrownsFor": round(ac / games, 2),
        "avgCrownsAgainst": round(bc / games, 2),
        "crownDiff": round((ac - bc) / games, 2),
        "threeCrownFor": round(100 * a3 / games, 1),
        "threeCrownAgainst": round(100 * b3 / games, 1),
        "tier": tier, "interval": interval,
    }


# --------------------------------------------------------------------------
# Snapshot plumbing — the same shape as meta.py
# --------------------------------------------------------------------------

def _load_snapshot() -> None:
    global _snapshot
    try:
        with open(SNAPSHOT_PATH, encoding="utf-8") as fh:
            _snapshot = json.load(fh)
    except Exception:
        _snapshot = None


def _save_snapshot(snap: dict) -> None:
    tmp = SNAPSHOT_PATH + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(snap, fh)
        os.replace(tmp, SNAPSHOT_PATH)
    except Exception:
        pass


def refresh(force: bool = False) -> None:
    global _snapshot
    with _lock:
        if _state["building"]:
            return
        if (_snapshot and not force
                and (time.time() - _snapshot.get("computedAt", 0)) < REFRESH_SECONDS):
            return
        _state["building"] = True
        _state["startedAt"] = time.time()
        _state["error"] = None
    try:
        snap = _build_matrix()
        with _lock:
            _snapshot = snap
        _save_snapshot(snap)
    except Exception as exc:  # noqa: BLE001
        with _lock:
            # The TYPE, not the message. This string is served in a
            # response body, and a sqlite message can carry the database path.
            # The full traceback still goes to stderr for the operator.
            _state["error"] = type(exc).__name__
    finally:
        with _lock:
            _state["building"] = False


def start_background() -> None:
    _load_snapshot()

    def loop():
        # Read the deck vocabulary once, here, rather than making the first
        # person to paste a deck wait 2.2 s for it. It is only needed by the
        # cluster path, but that is the path a first-time user hits.
        try:
            _vocabulary()
        except Exception:
            pass
        while True:
            try:
                refresh()
            except Exception:
                pass
            time.sleep(min(REFRESH_SECONDS, 300))

    threading.Thread(target=loop, daemon=True, name="counter-refresh").start()


def _snap() -> dict | None:
    with _lock:
        return _snapshot


def status() -> dict:
    snap = _snap()
    with _lock:
        building, error, started = _state["building"], _state["error"], _state["startedAt"]
    return {
        "building": building or snap is None,
        "error": error,
        "elapsedSeconds": round(time.time() - started, 1) if started else 0,
        "ageSeconds": round(time.time() - snap["computedAt"], 1) if snap else None,
        "rawBias": snap["rawBias"] if snap else None,
        "battles": snap["battles"] if snap else 0,
    }


# --------------------------------------------------------------------------
# The three answers
# --------------------------------------------------------------------------

def _label(archetype: str) -> str:
    return cd._archetype_title(archetype)


def _representatives() -> dict[str, dict]:
    """`archetype -> a real deck of that archetype`, for the rows to draw.

    A matchup row naming "Graveyard" and showing nothing is a row you cannot
    act on — the design's tables all carry the actual eight cards.

    THE DECK COMES FROM THE SAME POPULATION AS THE NUMBERS. It used to be the
    first hit per archetype on the meta board's top 50, which is the most-played
    deck of that archetype ON LADDER: the board excludes duel and friendly modes
    by design, because it answers a different question. But these rows count
    duels — `pair_matchup_agg` has no mode filter, and duel battles turn out to
    be present at 72.7% against 61.3% for normal ones — so the deck beside the
    figures was picked from a population the figures did not use.
    `snapshot["reps"]` is the most-observed deck per archetype over the matchup
    table itself, duels included.

    The meta board is still asked for ART, which is the one thing it has and
    the pair table does not; a deck it has never seen falls back to inference
    and is flagged, exactly like a pasted deck.
    """
    snap = _snap()
    reps = (snap or {}).get("reps") or {}
    if not reps:
        return {}
    art_by_hash = _board_art()
    slots_by_hash = _board_slots()
    out: dict[str, dict] = {}
    for arch, cards in reps.items():
        key = ",".join(sorted(cards))
        observed = art_by_hash.get(key, {})
        try:
            order, art = cd.arrange_deck(list(cards), observed,
                                         slot_of=slots_by_hash.get(key))
        except Exception:
            order, art = list(cards), {}
        out[arch] = {
            "cards": order,
            "art": art,
            "inferredArt": not observed,
            "name": _label(arch),
            "useRate": None,
            "winRate": None,
            "avgElixir": _avg_elixir(cards),
        }
    return out


def archetype_of(cards: list[str]) -> str:
    """The archetype of a pasted deck, read from the stored deck row when the
    exact list is known and derived from its win-condition cards otherwise.

    Read, not recomputed: `decks.win_condition` was written by the bot's own
    `get_win_condition`, and a second classifier here would eventually disagree
    with the one every stored battle was labelled by.
    """
    if not cards:
        return "other"
    key = ",".join(sorted(cards))
    tiers = cd._tier_paths()
    if tiers:
        try:
            con = cd.connect(tiers[0])
            try:
                row = con.execute(
                    "SELECT win_condition FROM decks WHERE deck_hash = ?", (key,)
                ).fetchone()
                if row and row["win_condition"]:
                    return row["win_condition"]
            finally:
                con.close()
        except Exception:
            pass

    # Unknown list: derive it the way the bot does, with the bot's own rules and
    # in the bot's own order. An earlier version returned the priciest
    # win-condition CARD ("hog-rider"), but the stored vocabulary is archetype
    # keys ("hog") — so every unknown deck resolved to a name the matrix has no
    # row for and came back with no counters at all.
    names = set(cards)
    if "miner" in names:                       # Miner always takes priority
        return "miner"
    if "goblin-barrel" in names or "wall-breakers" in names:
        return "bait"
    for card in WIN_CONDITION_PRIORITY:
        if card in names:
            return WIN_CONDITION_MAP[card]
    return "other"


def _drawn(cards: list[str], wild: str | None = None) -> tuple[list[str], dict]:
    """A pasted deck, ordered into its slots and told what art to draw.

    A Clash Royale copy-deck link carries eight card IDS and nothing else — no
    evolution flag, no hero flag, no slot information. So a pasted deck arrived
    here as bare keys and rendered eight plain cards, sitting next to a meta
    deck that had its evolutions and heroes drawn properly. Same screen, two
    different-looking decks, for no reason the reader could see.

    `arrange_deck` is the app's one answer to "which slots are special": the
    same function the meta board, the player screens and the PDF all use. It
    decides from what the cards ARE (slot 1 an evolution, slot 2 a hero or
    champion, slot 3 the second evolution else a hero else a champion) rather
    than from an order the link does not carry.

    BUT INFERENCE IS THE FALLBACK, NOT THE FIRST ANSWER. If the pasted list is
    a deck the meta board already covers, that board has counted how it is
    ACTUALLY fielded over the last few days, and those marks are used instead —
    so a pasted meta deck renders identically to the same deck in the row
    beneath it, which is the whole reason to bother. The lookup is a dictionary
    hit on a snapshot that exists anyway: `deck_hash` is just the sorted card
    list, so no query is needed.

    Only a deck the board has never seen falls through to inference, and the
    caller flags that with `inferredArt` — `CardArt` says so in the tooltip
    rather than letting a guess pass for an observation.

    Returns `(ordered_cards, art, inferred)`.
    """
    if not cards:
        return [], {}, False
    # Not consulted for the ORDER any more — see `arrange_deck`, where the link
    # outranks pooled marks. Kept only to say whether the board has ever seen
    # this list, which is what `inferredArt` reports.
    observed = _board_art().get(",".join(sorted(cards)), {})
    try:
        # TRUST THE LINK'S ORDER. A copyDeck link writes the three special slots
        # first, in slot order, so the list already says which card is the
        # evolution, which is the hero and which is the wild. Rebuilding that
        # from capability put Goblins in the hero slot of a Goblin Barrel /
        # Valkyrie / Princess deck, because Goblins *can* be a hero — the deck
        # rendered as a different deck. See `arrange_deck`.
        ordered, art = cd.arrange_deck(list(cards), observed,
                                       trust_order=True, wild=wild)
    except Exception:
        return list(cards), {}, not observed
    return ordered, art, not observed


def draw_deck(cards: list[str], wild: str | None = None) -> dict:
    """One pasted deck, ready to render, and nothing else.

    Exists so the paste box can draw the deck the INSTANT a link is recognised
    rather than at the moment the user presses Compare. Both used to call
    `_drawn`, but only the Compare response carried the result, so a pasted deck
    sat in link order with plain art and then rearranged itself into its
    evolution and hero frames seconds later, when the user had already looked at
    it. Same function behind both, so the two can never disagree.

    Cheap by construction — a dictionary hit on the meta snapshot plus the
    arrangement. No database, no matrix, so it answers while the paste is still
    being typed.
    """
    order, art, inferred = _drawn(cards, wild)
    third = order[2] if len(order) > 2 else None
    info = dx.card_info(third) if third else {}
    return {
        "cards": order,
        "art": art,
        "inferredArt": inferred,
        "avgElixir": _avg_elixir(cards),
        # Slot 3 is the only genuinely ambiguous one — four cards have both
        # forms and a link cannot say which was meant. The client offers a
        # choice when, and only when, this is true.
        "wildSlot": third,
        "wildChoosable": bool(info.get("can_evolve") and info.get("can_be_hero")),
        "wild": art.get(third) if third else None,
    }


def _board_art() -> dict[str, dict]:
    """`deck_hash -> observed art`, for every deck on the current meta board.

    The board's art pass aggregates `player_evo` across up to 400 battles per
    deck and keeps only marks that clear a minimum share, which is a far better
    reading than any single battle — and it has already run.
    """
    try:
        board = meta_board.board()
    except Exception:
        return {}
    return {
        d["deckHash"]: d["art"]
        for d in (board.get("decks") or [])
        if d.get("deckHash") and d.get("art")
    }


def _board_slots() -> dict[str, dict]:
    """`deck_hash -> {card: slot index}`, from the board's own arrangement.

    The board has already decided where each mark sits, using the slot the
    payload recorded (`cd.arrange_deck(..., slot_of=)`). Handing that back means
    a deck drawn here is drawn the same way it is drawn on the meta board — the
    art alone is not enough, because slots 2 and 3 can both hold a hero and
    without this the two screens ordered a two-hero deck differently.
    """
    try:
        board = meta_board.board()
    except Exception:
        return {}
    return {
        d["deckHash"]: {c: i for i, c in enumerate((d.get("cards") or [])[:3])}
        for d in (board.get("decks") or [])
        if d.get("deckHash") and d.get("art")
    }


# How a matchup number was arrived at, best first. The screen prints this —
# "62.4%" from this deck's own 4,000 battles and "62.4%" from the archetype
# average are not the same claim, and a reader is entitled to know which.
SOURCE_EXACT = "exact"        # these two lists have played each other
SOURCE_DECK = "deck"          # this exact list, against that archetype
SOURCE_C7 = "cluster7"        # lists one card different
SOURCE_C6 = "cluster6"        # lists two cards different
SOURCE_ARCHETYPE = "archetype"  # archetype against archetype

SOURCE_TEXT = {
    SOURCE_EXACT: "these two exact decks have met",
    SOURCE_DECK: "this exact deck, against every deck of that archetype",
    SOURCE_C7: "decks one card different from this one",
    SOURCE_C6: "decks two cards different from this one",
    SOURCE_ARCHETYPE: "archetype against archetype — too few battles for this deck",
}

_CLUSTER_SOURCE = {7: SOURCE_C7, 6: SOURCE_C6}


def matchup_ladder(cards: list[str], other: str, snap: dict | None) -> list[dict]:
    """Every reading of `cards` vs archetype `other`, widest evidence last.

    The point is to SHOW the backoff rather than silently pick a rung. A reader
    looking at "37.5% over 104 battles" wants to know what the near-identical
    decks say, because 104 battles is thin and 70,000 near-identical ones are
    not — and if the two disagree, that is worth seeing too.

    Rungs with no evidence are left out; the list is never padded.
    """
    out = []
    exact = deck_profile(cards)["archetypes"].get(other)
    if exact:
        out.append({"source": SOURCE_DECK, "decks": 1, **exact})
    for overlap in CLUSTER_LEVELS:
        prof = cluster_profile(cards, overlap)
        m = prof["archetypes"].get(other)
        if m:
            out.append({"source": _CLUSTER_SOURCE[overlap],
                        "decks": prof["decks"], **m})
    if snap:
        m = _symmetric(snap, archetype_of(cards), other)
        if m:
            out.append({"source": SOURCE_ARCHETYPE, "decks": None, **m})
    return out


def deck_vs_deck(cards_a: list[str], cards_b: list[str],
                 wild_a: str | None = None, wild_b: str | None = None) -> dict:
    """Head-to-head for two pasted decks.

    THE NUMBER FOLLOWS THE CARDS, and there are three ways to get one. They are
    tried best-first and the answer says which it used:

      1. THE EXACT PAIR. Rare — 0.59% of stored pairings reach the floor — but
         unbeatable when it exists.
      2. THIS DECK vs THAT ARCHETYPE, from `deck_profile`. This is the one that
         usually answers, and it is card-sensitive: swap a card and the deck
         hash changes, so a different set of battles is counted.
      3. Archetype vs archetype, the old behaviour, for a deck nobody has
         played enough for either of the above.

    Reporting only (3) is what made the screen ignore the cards — every Hog
    deck, however built, returned the same figure.
    """
    snap = _snap()
    a, b = archetype_of(cards_a), archetype_of(cards_b)
    reps = _representatives()
    # `wild` only changes how slot 3 is DRAWN — the deck's identity is its card
    # set, so no figure below depends on it.
    order_a, art_a, inf_a = _drawn(cards_a, wild_a)
    order_b, art_b, inf_b = _drawn(cards_b, wild_b)
    prof_a = deck_profile(cards_a)
    out = {
        "a": {"archetype": a, "name": _label(a), "cards": order_a, "art": art_a,
              "inferredArt": inf_a, "avgElixir": _avg_elixir(cards_a),
              "meta": reps.get(a), "battles": prof_a["battles"]},
        "b": {"archetype": b, "name": _label(b), "cards": order_b, "art": art_b,
              "inferredArt": inf_b, "avgElixir": _avg_elixir(cards_b),
              "meta": reps.get(b)},
        "mirror": sorted(set(cards_a)) == sorted(set(cards_b)),
        "sameArchetype": a == b,
        "matchup": None,
        "source": None,
    }

    m = exact_pair(cards_a, cards_b)
    if m:
        out["matchup"], out["source"] = m, SOURCE_EXACT
        return out

    # The whole backoff, every rung that has evidence, widest last. The first
    # entry is the narrowest reading and becomes the headline; the rest are
    # shown beneath it so a thin exact record can be weighed against tens of
    # thousands of near-identical games.
    ladder = matchup_ladder(cards_a, b, snap)
    out["ladder"] = [{**m, "a": a, "b": b} for m in ladder]
    if ladder:
        out["matchup"] = {**ladder[0], "a": a, "b": b}
        out["source"] = ladder[0]["source"]
    return out


def find_counters(cards: list[str], wild: str | None = None) -> dict:
    """Which archetypes beat this deck, best first.

    THE PASTED LIST IS THE SUBJECT, not its archetype. Every row is that exact
    deck's own record against the archetype (`deck_profile`), so replacing a
    card replaces the battles being counted and the table moves. An archetype
    the deck has not met often enough falls back to the matrix, and the row says
    which of the two it is.
    """
    snap = _snap()
    target = archetype_of(cards)
    order, art, inferred = _drawn(cards, wild)
    profile = deck_profile(cards)
    out = {
        "target": {"archetype": target, "name": _label(target), "cards": order,
                   "art": art, "inferredArt": inferred,
                   "avgElixir": _avg_elixir(cards),
                   "battles": profile["battles"]},
        "counters": [], "styles": [], "overall": None,
    }
    if not snap:
        return out

    reps = _representatives()

    # The same ladder the versus tab walks, once per archetype: this exact list
    # first, then lists one card different, then two, then the archetype. Every
    # rung is the PASTED DECK's record, so the counter's win rate is its
    # complement, and the row says which rung answered.
    #
    # `cluster_profile` returns all seventeen archetypes at once, so the widening
    # is paid for once per level rather than once per row — and only if some
    # archetype actually needs it.
    clusters: dict[int, dict] = {}

    def widen(overlap):
        if overlap not in clusters:
            clusters[overlap] = cluster_profile(cards, overlap)
        return clusters[overlap]

    rows = []
    for other in snap["archetypes"]:
        mine, src, pooled = profile["archetypes"].get(other), SOURCE_DECK, 1
        if not mine:
            for overlap in CLUSTER_LEVELS:
                prof = widen(overlap)
                mine = prof["archetypes"].get(other)
                if mine:
                    src, pooled = _CLUSTER_SOURCE[overlap], prof["decks"]
                    break
        if mine:
            rows.append({
                "archetype": other, "name": _label(other), "style": style_of(other),
                "winRate": round(100 - mine["winRate"], 1),
                "games": mine["games"],
                "crownDiff": round(-mine["crownDiff"], 2),
                "tier": mine["tier"], "interval": mine["interval"],
                "source": src, "pooledDecks": pooled, "deck": reps.get(other),
            })
            continue
        m = _symmetric(snap, other, target)
        if not m:
            continue
        rows.append({
            "archetype": other, "name": _label(other), "style": style_of(other),
            "winRate": m["winRate"], "games": m["games"],
            "crownDiff": m["crownDiff"], "tier": m["tier"], "interval": m["interval"],
            "source": SOURCE_ARCHETYPE, "pooledDecks": None, "deck": reps.get(other),
        })

    # How the target does against the field, so a counter can be stated as an
    # ADVANTAGE over that rather than as a bare percentage. Taken from the
    # deck's own overall record when it has one, for the same reason the rows
    # are: the baseline a counter is measured against has to be the same deck.
    #
    # BUT IT NEEDS ITS OWN FLOOR, and a much higher one than a single matchup.
    # A deck played once and won once produced "100.0% over 1 battles" as the
    # baseline, which turned every advantage into the row's own win rate —
    # "+61.5" against a field the deck has never met. The per-archetype floor of
    # 8 cannot catch this because the baseline pools seventeen archetypes: the
    # rows all correctly fell back to the matrix while the baseline did not.
    baseline = None
    if profile["overall"] and profile["overall"]["games"] >= BASELINE_MIN_BATTLES:
        baseline, out["source"] = profile["overall"], SOURCE_DECK
    else:
        for overlap in CLUSTER_LEVELS:
            prof = widen(overlap)
            if prof["overall"] and prof["overall"]["games"] >= BASELINE_MIN_BATTLES:
                baseline, out["source"] = prof["overall"], _CLUSTER_SOURCE[overlap]
                break
    if baseline:
        overall = baseline["winRate"]
        tg = baseline["games"]
    else:
        tw = tl = tg = 0
        for other in snap["archetypes"]:
            m = _symmetric(snap, target, other)
            if m:
                tw += m["wins"]
                tl += m["losses"]
                tg += m["games"]
        overall = round(100 * tw / max(1, tw + tl), 1) if tg else None
        out["source"] = SOURCE_ARCHETYPE
    out["overall"] = {"winRate": overall, "games": tg}
    # The real decks it has met, floor or no floor — see `real_opponents`.
    out["played"] = real_opponents(cards)

    for r in rows:
        # Counter advantage: how much better this archetype does against the
        # target than the field does. Positive means it really is a counter.
        r["advantage"] = round(r["winRate"] - (100 - overall), 1) if overall is not None else None

    # ONLY ARCHETYPES THAT ACTUALLY BEAT IT. Ranking the field and taking the
    # top five hands back a "counter" at 48.3%, which is the opposite of one;
    # a short list is the honest answer when a deck has few real counters, and
    # `considered` says how many were weighed to get it.
    rows.sort(key=lambda r: (-r["winRate"], -r["games"], r["archetype"]))
    out["considered"] = len(rows)
    # THE WHOLE FIELD, not only the half that beats it. `counters` answers "what
    # do I have to fear", which is the question this endpoint was built for and
    # is deliberately a short list; a spread of the deck against every archetype
    # is a different question — "how does this deck do, in general" — and it
    # cannot be reconstructed from a list that has already dropped everything
    # under 50%. These rows are computed above either way, so it costs nothing.
    out["field"] = rows
    # Every archetype that beats it, not the top `limit` of them — the client
    # pages the list, the same as the player board. Truncating here meant a
    # deck with nine real counters silently reported five.
    out["counters"] = [r for r in rows if r["winRate"] > 50]

    # The style split of everything that beats the target, not of the top five —
    # five rows cannot carry a percentage breakdown.
    beats = [r for r in rows if r["winRate"] > 50]
    total = sum(r["games"] for r in beats)
    styles: dict[str, int] = {}
    for r in beats:
        styles[r["style"]] = styles.get(r["style"], 0) + r["games"]
    out["styles"] = sorted(
        ({"style": k, "share": round(100 * v / total, 1), "games": v}
         for k, v in styles.items()),
        key=lambda s: -s["share"],
    )
    return out


def _avg_elixir(cards: list[str]) -> float:
    if not cards:
        return 0.0
    return round(sum(dx.card_info(c).get("elixir") or 0 for c in cards) / len(cards), 1)


#: How many times this player must have met one exact list before it is named
#: as the deck they face. Below this, the "most common" deck is whichever
#: single opponent happened to appear twice, which is noise wearing the
#: authority of a recommendation. The archetype's representative is the honest
#: answer there -- it is at least the most-played version of the thing.
FACED_MIN_SIGHTINGS = 3


def _faced_deck(seen: dict | None, rep: dict | None,
                archetype: str) -> tuple[dict | None, str, int]:
    """The deck to draw beside a matchup row: theirs if they have met it enough.

    Returns `(deck, basis, sightings)` where basis is "faced" or "typical".
    """
    best_n, best_cards = 0, None
    for _hash, (count, cards) in (seen or {}).items():
        if count > best_n or (count == best_n and best_cards
                              and ",".join(sorted(cards)) < ",".join(sorted(best_cards))):
            # The key tiebreak is not decoration: opponent decks tie on count
            # constantly, and falling through to dict order would reshuffle the
            # drawn deck between two identical requests.
            best_n, best_cards = count, cards
    if best_n < FACED_MIN_SIGHTINGS or not best_cards:
        return rep, "typical", 0

    observed = _board_art().get(",".join(sorted(best_cards)), {})
    try:
        order, art = cd.arrange_deck(list(best_cards), observed)
    except Exception:
        order, art = list(best_cards), {}
    return (
        {
            "cards": order,
            "art": art,
            "inferredArt": not observed,
            "name": _label(archetype),
            "useRate": None,
            "winRate": None,
            "avgElixir": _avg_elixir(best_cards),
        },
        "faced",
        best_n,
    )


def player_counter(tag: str, since: str | None = None,
                   until: str | None = None) -> dict:
    """How this player fares against each archetype, and what to bring.

    Reads `battles.opponent_win_condition` directly — it is stored and 100%
    populated, so no join and no snapshot are needed here.
    """
    per: dict[str, list[int]] = {}
    # THE DECK THIS PLAYER ACTUALLY FACES, per archetype.
    #
    # The rows below were always personal — they are this player's own battles,
    # grouped by what they ran into. The DECK beside each row was not: it came
    # from `_representatives()`, which is the most-observed deck of that
    # archetype across the whole database. So every player was shown the same
    # eight cards for "X-Bow", which is what made these rows read as generic and
    # look interchangeable between accounts.
    #
    # `opponent_card_keys` is in the same table and the same query, so the deck
    # they have personally run into most is nearly free. That is a strictly
    # better answer to "what beats me": it is theirs, it is what they will meet
    # again, and it is the thing the win rate above it was actually measured on.
    faced: dict[str, dict[str, list]] = {}
    total = wins = 0
    archive_used = False

    for idx, (path, lo, hi) in enumerate(cd.tier_windows(tag, since, until)):
        try:
            con = cd.connect(path)
        except Exception:
            continue
        try:
            rows = con.execute(
                "SELECT opponent_win_condition wc, result, player_crowns, "
                "       opponent_crowns, opponent_card_keys "
                "FROM battles "
                "WHERE player_tag = ? AND battle_time >= ? AND battle_time <= ?",
                (tag, lo, hi),
            ).fetchall()
        except Exception:
            rows = []
        finally:
            con.close()
        if rows and idx > 0:
            archive_used = True
        for r in rows:
            wc = (r["wc"] or "").strip() or "other"
            e = per.setdefault(wc, [0, 0, 0, 0])
            e[0] += 1
            total += 1
            if r["result"] == "win":
                e[1] += 1
                wins += 1
            e[2] += r["player_crowns"] or 0
            e[3] += r["opponent_crowns"] or 0

            # EXACTLY EIGHT CARDS. A 16- or 24-card duel loadout is three decks
            # end to end; counting it as "a deck they faced" would draw a deck
            # that never existed. Same guard as everywhere else.
            try:
                opp = json.loads(r["opponent_card_keys"] or "[]")
            except Exception:
                continue
            if len(opp) != 8:
                continue
            seen = faced.setdefault(wc, {})
            slot = seen.setdefault(",".join(sorted(opp)), [0, opp])
            slot[0] += 1

    overall = round(100 * wins / total, 1) if total else 0.0
    reps = _representatives()
    matchups = []
    for wc, (n, w, cf, ca) in per.items():
        if n < MIN_GAMES:
            continue
        wr = round(100 * w / n, 1)
        tier, interval = dx.confidence_tier(w, n)
        deck, deck_basis, deck_seen = _faced_deck(faced.get(wc), reps.get(wc), wc)
        matchups.append({
            "archetype": wc, "name": _label(wc), "style": style_of(wc),
            # The deck a reader can actually act on, not just its label.
            "deck": deck,
            # WHOSE DECK THIS IS. "faced" means they have personally run into
            # this exact list and `deckSeen` says how often; "typical" means
            # they have not met one list often enough to name, so the
            # archetype's most-observed deck stands in. The screen must say
            # which -- an example deck presented as the one they keep losing to
            # is a different claim.
            "deckBasis": deck_basis,
            "deckSeen": deck_seen,
            "battles": n, "wins": w, "winRate": wr,
            # Against this player's OWN average, which is what makes a matchup
            # a weakness rather than just a number.
            "diff": round(wr - overall, 1),
            "avgCrownsFor": round(cf / n, 2), "avgCrownsAgainst": round(ca / n, 2),
            "tier": tier, "interval": interval,
        })
    matchups.sort(key=lambda m: (m["winRate"], -m["battles"], m["archetype"]))

    # EVERY matchup comes back, and the two lists PARTITION them.
    #
    # This used to be `matchups[:5]` and `matchups[-5:]`, which had two
    # problems. The screen said "16 archetypes analyzed" and then offered ten
    # of them with no way to reach the other six — the number was a claim the
    # page could not honour. And with fewer than ten archetypes the two slices
    # overlapped, so the same matchup appeared under both "worst" and "best".
    #
    # The split is on the player's OWN average rather than on rank, because
    # that is what makes a matchup a weakness instead of merely the lower half
    # of a list: `diff` is already win rate minus that average. Paging is the
    # client's job — it has the room to decide how many rows fit.
    worst = [m for m in matchups if m["diff"] < 0]
    best = [m for m in matchups if m["diff"] >= 0]

    return {
        "player": {"tag": tag, "winRate": overall, "battles": total,
                   "wins": wins, "archiveUsed": archive_used},
        "worst": worst,
        "best": list(reversed(best)),
        # What to bring: the archetypes this player is worst against, stated as
        # a recommendation with the player's own win rate against them.
        "recommended": [
            {**m, "yourWinRate": round(100 - m["winRate"], 1)} for m in worst
        ],
        "analyzed": len(matchups),
        "minBattles": MIN_GAMES,
    }
