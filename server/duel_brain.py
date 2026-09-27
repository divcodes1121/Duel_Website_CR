"""duel_brain.py — the second brain: what actually wins in DUELS.

Asked for directly (2026-09-27): when Deckkies suggests decks, also search the
duels — take the win conditions an opponent brings, find the decks that played
against those win conditions IN DUELS AND WON, notice when one of a player's
OWN decks is such a deck, keep only the strong ones, and put them in the seven
suggestions, so the recommendation is more pointed and differs for every
player.

This file is the reasoning and NOTHING ELSE — no database, no network, no
imports beyond the standard library. `duel_index.py` counts the evidence and
`team_analysis.py` wires it in. The rule `team_scout.py` follows, for the same
reason: this decides what a coach is told to bring, and a rule that cannot be
tested against literals will be tested by shipping.

────────────────────────────────────────────────────────────────────────────
WHY A SECOND BRAIN, AND NOT A HEAVIER WEIGHT ON THE FIRST
────────────────────────────────────────────────────────────────────────────

`team_scout.score()` ranks decks on LADDER records (`pair_matchup_agg`, one
battle a row). A native duel is a different game in the one way that matters
here — three card-disjoint decks chosen against a known opponent — and the
people who duel seriously play a wider, stronger set of lists than the ladder.
What wins there is evidence the ladder records do not hold.

This project has learned twice that a bigger bounded weight on a second signal
moves nothing (`coach_daily.FAMILIAR_WEIGHT`, 0-1 of 17 families) and that
un-bounding it ranks worse decks above better ones (`MAX_BOOST`). What DID work
was RESERVED SLOTS behind a strength test (`coach_daily.PRIORITY_SLOTS`,
`FAMILY_FAMILIAR_SLOTS`). So this brain never re-weights the ladder ranking.
It measures every row, and it holds up to `DUEL_SLOTS` of the seven for decks
that PROVED themselves in duels against what this opponent brings — the
player's own first, the population's second — and only when the proof clears
the bar.

────────────────────────────────────────────────────────────────────────────
THE EVIDENCE: A DECK AGAINST A WIN CONDITION, IN DUEL GAMES
────────────────────────────────────────────────────────────────────────────

The unit is one duel game. The question put to it is "this deck against that
WIN CONDITION" — the granularity the threat projection already speaks in, and
the one the request named. Two rungs, narrowest first:

  exact    this exact list
  near     this list and every list one card away from it, same win condition

`near` is asked only when `exact` has too few games against that win
condition (`RUNG_MIN_GAMES`). THERE IS NO THIRD, ARCHETYPE-LEVEL RUNG, and that
is deliberate: "Mortar beats Bait 61% in duels" is true of Mortar and says
nothing about THIS Mortar list. Letting it prove a deck would make every list
of a strong archetype a duel pick. A deck proves itself on its own games or
on its near-identical siblings', or not at all.

────────────────────────────────────────────────────────────────────────────
WHO FLEW IT IS TAKEN OUT BEFORE THE DECK IS JUDGED
────────────────────────────────────────────────────────────────────────────

The duel corpus is tracked players — strong ones — and the people they met.
Measured on the first real build (2026-09-27), EVERY ONE of the twelve
highest-rate catalogue decks was flown mostly by pilots who win 70-94% of
their duels with their OTHER decks too: a list at 85.5% whose pilots win
73-84% anyway is not a strong deck, it is strong players. Ranked on the raw
rate, those were the brain's first answers.

So every game carries an EXPECTED result from the two players alone:

  rating  = (wins + PILOT_PRIOR / 2) / (games + PILOT_PRIOR)
            over that player's duel games with their OTHER decks — leave
            this deck out, or a one-deck pilot's rating IS the deck's rate
            and the deck's edge vanishes into its own baseline
  expect  = log5(rating_a, rating_b)
  rate    = 50 + 100 * (wins - expected) / games

— the deck's record against an EQUAL opponent. The raw rate is published
beside the figures (`raw`) so a reader can see how much of a record was the
pilots.

────────────────────────────────────────────────────────────────────────────
WHAT A DUEL FIGURE IS — CHECKED AGAINST THE FUTURE, NOT ARGUED
────────────────────────────────────────────────────────────────────────────

Per win condition the adjusted record is SHRUNK toward 50/50:

  rate = (adjusted wins + DUEL_PRIOR_GAMES / 2) / (games + DUEL_PRIOR_GAMES)

and a deck's figure is the likelihood-weighted mean of those over the
projection, with a one-sided 95% bound taken off the SAME shrunk figure — so a
small sample can never print a rate below its own bound.

THE PRIOR WAS FITTED ON A TEMPORAL HOLDOUT (2026-09-27): records built on the
237,832 games before 13 September, outcomes read off the 82,923 after it,
1,102 catalogue deck x win-condition cells with 5+ games on both sides.

  * THE RECORDS PREDICT. Grouped by the bound, future win rates climb
    53 -> 56 -> 60 -> 64%, and the decks the gate below calls strong went on
    to win 60.6% of their unseen duels against those win conditions.
  * UNSHRUNK, THE PRINTED RATE OVERSHOT THE FUTURE — predicted 76.5%, realised
    67.4% at the top; a few "hot" 78% cells realised 58.6%. Regression to the
    mean. Calibration error 3.9 points unshrunk, 2.2 at 30 games of prior, and
    at the gate the rate a reader sees (60.6%) IS the rate those decks went on
    to win (60.6%).
  * 50/50 AND NOT THE CATALOGUE'S OWN MEAN (~55%, which fits slightly better):
    every duel game has one winner, so 50% is the population by construction,
    and a prior borrowed from the decks people keep playing would flatter every
    list with no games at all. Erring low is the right side for a coach.
  * THE PILOT ADJUSTMENT MEASURED NEUTRAL FOR PREDICTION (error 15.59 against
    15.71). It stays because it is the right figure for a teammate who is not
    the pilot, and it cost nothing in accuracy.

"STRONG ONES" IS THREE THRESHOLDS, all of them:

  nEff    >= DUEL_MIN_GAMES     enough REAL games against what they bring
                                (Kish, over games played — the prior is not
                                evidence and does not count)
  low     >= DUEL_MIN_LOW       a winning matchup, and not by luck
  covered >= DUEL_MIN_COVERED   measured against most of what they bring

A deck 5-0 against Hog is not strong. A deck at 58% over 300 duel games
against the win conditions this opponent brings is.

WHY 95% AND NOT ONE STANDARD ERROR, which the first draft used: the population
answer is a SEARCH over ~2,000 decks. At one standard error roughly one neutral
deck in six clears 50% by chance — hundreds of false answers on that many — and
a hot 10-3 list outranked 58% over 400 games, which a test caught. At 1.645 it
is one in twenty, and the 30-game floor removes most of the rest. No p-value is
printed anywhere; the bound is a filter and a sort key, not a claim.

AND THE RANKING LEADS WITH THE BOUND, NOT THE RATE. On the rate a 65% list
with 40 games sits above a 58% list with 400, and the whole point of the filter
is that the second is the stronger claim.

────────────────────────────────────────────────────────────────────────────
WHAT "THEY BRING" MEANS IN A DUEL
────────────────────────────────────────────────────────────────────────────

The first brain's projection is built from the opponent's 8-card decks — their
ladder, mostly, because a native duel is stored as a 16/24-card loadout every
8-card reader drops. So their DUEL decks were in nobody's projection. The duel
index has them, game by game, and `duel_projection` blends them in: at
`DUEL_THREAT_K` games of their own duels, half the duel brain's projection is
what they actually brought to duels, up to `DUEL_THREAT_MAX`. With under
`DUEL_THREAT_MIN_GAMES` it is the first brain's projection unchanged. The blend
is published with its weight, and it touches ONLY this brain's figures — the
first brain still ranks against its own projection, untouched.
"""

from __future__ import annotations

import math

#: The brain that produced a duel figure or pick. Published with each.
DUEL_BRAIN_VERSION = "duel-brain-1.0"

#: How strong a rung is as evidence — `team_scout.SOURCE_STRENGTH`'s figures
#: for the same granularity ("deck" 0.85, "cluster7" 0.60), so the two brains'
#: evidence reads alike.
DUEL_SOURCE_STRENGTH = {"exact": 0.85, "near": 0.60}

#: Games a rung needs against ONE win condition before it answers for it.
RUNG_MIN_GAMES = {"exact": 6, "near": 8}

#: Cards shared for a list to be the same deck one card off. Mirrors
#: `duel_index.NEAR_OVERLAP`; restated because this module has no imports.
NEAR_OVERLAP = 7

#: A one-sided 95% bound. See "STRONG ONES" in the module docstring for why
#: one standard error was not enough.
DUEL_Z = 1.645

#: Games of prior at 50/50 in every duel figure. FITTED, on the temporal
#: holdout the module docstring describes: calibration error 3.9 points at 0,
#: 2.2 at 20-30, rising again past 40 as the prior starts to erase real edges.
DUEL_PRIOR_GAMES = 30.0

#: The strength filter. See the module docstring.
DUEL_MIN_GAMES = 30.0
DUEL_MIN_LOW = 50.0
DUEL_MIN_COVERED = 0.5

#: Effective games under which a row carries NO duel figure at all. A rate off
#: a handful of games is noise printed as a number — the rule `DECK_RATE_FLOOR`
#: and the matchup floors already apply everywhere else on the site. Every
#: pick clears it by construction (`DUEL_MIN_GAMES` is three times this).
DUEL_SHOW_GAMES = 10.0

#: Slots of the seven held for duel-proven decks. Two: enough to put duel
#: evidence on every list, few enough that the ladder brain's best answers are
#: never displaced wholesale by a second, thinner body of evidence.
DUEL_SLOTS = 2

#: A player's OWN duel deck needs this many of their own duel games in the
#: window to count as a deck they duel with. Below it, one experiment.
OWN_MIN_GAMES = 4

#: Shared cards at which two lists ARE one deck — `team_scout.
#: SAME_DECK_OVERLAP` and `duel_zone.COUNTER_MIN_OVERLAP`, mirrored so "the
#: same deck" means one thing on one list.
SAME_DECK_OVERLAP = 6

#: Population picks are made per teammate. Points of lower bound a pick is
#: worth for being built out of cards the teammate plays (zero below
#: `KNOWN_MIN` of eight, `KNOWN_LEAN` at all eight) — `team_scout`'s known-card
#: shape — and the cost of a pick already handed to a teammate in this folder.
#: Every candidate has already cleared the strength gate, so neither can swap
#: a weak deck in; they choose between proofs.
#:
#: SPREAD WAS 3 AND ONE DECK WENT TO ALL FIVE TEAMMATES in a real folder: its
#: bound led the next answer by eleven points, and three a teammate is four
#: teammates before it gives way. The strong answers' bounds sit a point or
#: four apart as a rule, so at five a comparable answer is shared out after
#: one teammate and only a genuinely dominant one reaches two or three.
KNOWN_MIN = 5
KNOWN_LEAN = 3.0
SPREAD_PENALTY = 5.0

#: The opponent's own duels in the duel projection: games at which they carry
#: half of it, the most they may carry, and the fewest that count at all.
DUEL_THREAT_K = 20.0
DUEL_THREAT_MAX = 0.75
DUEL_THREAT_MIN_GAMES = 6

#: Games of prior at 50% in a pilot's rating. Twenty: a player with five duels
#: all won rates 0.60, not 1.00, and one with two hundred rates as their record.
PILOT_PRIOR = 20.0

#: Why a row is on the list, from this brain's side.
PICK_OWN = "own"          # the player's own duel deck, proven against these
PICK_POPULATION = "duel"  # a deck duel players win with against these


def pilot_rating(wins: float, games: float) -> float:
    """A player's duel strength, shrunk toward 50% by `PILOT_PRIOR` games."""
    return (wins + PILOT_PRIOR / 2.0) / (max(0.0, games) + PILOT_PRIOR)


def log5(pa: float, pb: float) -> float:
    """P(a beats b) from two ratings — Bill James's log5, the Elo identity.

    0.5 for equal ratings whatever they are, which is what makes it a
    comparison of two players rather than of each with the average.
    """
    num = pa * (1.0 - pb)
    den = num + pb * (1.0 - pa)
    return num / den if den > 0 else 0.5


def deck_key(cards) -> str:
    """The order-free identity of a list — the key every brain uses."""
    return ",".join(sorted(set(cards or [])))


def same_deck(a, b) -> bool:
    return len(set(a or []) & set(b or [])) >= SAME_DECK_OVERLAP


# ── Arithmetic ──────────────────────────────────────────────────────────────


def collapse(threats) -> dict[str, float]:
    """The first brain's projection as `{win condition: likelihood}`.

    PER WIN CONDITION, because that is what a duel record is keyed on. Four Hog
    variants in the projection are one question to this brain, and treating
    them as four would count the same Hog games four times in `nEff`.
    """
    out: dict[str, float] = {}
    for t in threats or []:
        a = t.get("archetype") or ""
        like = float(t.get("likelihood") or 0.0)
        if a and like > 0:
            out[a] = out.get(a, 0.0) + like
    return out


def duel_projection(threats, duel_wcs: dict | None) -> tuple[dict[str, float], float]:
    """What the opponent brings to a DUEL: `(projection, weight of their duels)`.

    `duel_wcs` is `{win condition: games}` from the opponent's own duel games.
    See the module docstring. The weight is 0 under `DUEL_THREAT_MIN_GAMES`
    and `g / (g + DUEL_THREAT_K)` above it, capped at `DUEL_THREAT_MAX` — the
    shape of a prior giving way to data, stated as one line.
    """
    base = collapse(threats)
    total = sum(base.values())
    if total > 0:
        base = {a: v / total for a, v in base.items()}
    duel = {a: int(n) for a, n in (duel_wcs or {}).items() if a and int(n) > 0}
    g = sum(duel.values())
    if g < DUEL_THREAT_MIN_GAMES:
        return base, 0.0
    w = min(DUEL_THREAT_MAX, g / (g + DUEL_THREAT_K))
    if not base:
        w = 1.0
    out = {a: (1.0 - w) * v for a, v in base.items()}
    for a, n in duel.items():
        out[a] = out.get(a, 0.0) + w * n / g
    return out, round(w, 3)


def rung(records: dict | None, opp: str) -> dict | None:
    """The narrowest rung with enough games against one win condition.

    `records` is `duel_index.records()`'s shape: `{"exact": {wc: [games,
    wins, expected]}, "near": {...}}`. Returns `{"games", "wins", "expected",
    "adjusted", "winRate", "raw", "source"}`, or None when neither rung clears
    its floor:

      raw       the record as played
      adjusted  against an equal opponent (pilots taken out)
      winRate   `adjusted`, shrunk toward 50/50 by `DUEL_PRIOR_GAMES` — the
                figure that is ranked, filtered and printed

    A record with no `expected` is taken at 50/50, so it adjusts nothing.
    """
    for source in ("exact", "near"):
        rec = ((records or {}).get(source) or {}).get(opp)
        if not rec:
            continue
        games, wins = int(rec[0]), int(rec[1])
        if games >= RUNG_MIN_GAMES[source]:
            expected = float(rec[2]) if len(rec) > 2 else games / 2.0
            adj_wins = max(0.0, min(float(games), games / 2.0 + wins - expected))
            mean = (adj_wins + DUEL_PRIOR_GAMES / 2.0) / (games + DUEL_PRIOR_GAMES)
            return {"games": games, "wins": wins, "expected": round(expected, 1),
                    "adjusted": round(100.0 * adj_wins / games, 1),
                    "winRate": round(100.0 * mean, 1),
                    "raw": round(100.0 * wins / games, 1), "source": source}
    return None


def value(projection: dict[str, float], records: dict | None) -> dict | None:
    """One deck's duel record against a whole projection. None when no win
    condition in it could be answered — a real state, never rendered as 50%.

    THE EFFECTIVE GAMES ARE WHAT A WEIGHTED RATE IS WORTH. A deck with 300
    games against something the opponent brings 5% of the time and four
    against what they bring 60% of the time has not been tested against this
    opponent, whatever its total says. `nEff` is the Kish effective size of
    the likelihood-weighted mean — `mass² / Σ likelihood² / games` — over the
    games actually PLAYED. The bound comes off the shrunk figure's own spread,
    each win condition's `p(1-p) / (games + prior + 1)`, weighted the same way.
    """
    mass = num = raw = strength = var = spread = 0.0
    games = exact_mass = 0.0
    per = []
    for opp, like in sorted((projection or {}).items(), key=lambda kv: (-kv[1], kv[0])):
        if like <= 0:
            continue
        r = rung(records, opp)
        if not r:
            per.append({"archetype": opp, "likelihood": round(like, 4),
                        "winRate": None, "games": 0, "source": None})
            continue
        mass += like
        num += like * r["winRate"]
        raw += like * r["raw"]
        strength += like * DUEL_SOURCE_STRENGTH[r["source"]]
        var += like * like / r["games"]
        p = r["winRate"] / 100.0
        spread += like * like * p * (1.0 - p) / (r["games"] + DUEL_PRIOR_GAMES + 1.0)
        games += r["games"]
        if r["source"] == "exact":
            exact_mass += like
        per.append({"archetype": opp, "likelihood": round(like, 4), **r})
    if mass <= 0:
        return None
    rate = num / mass
    n_eff = mass * mass / var if var > 0 else 0.0
    half = DUEL_Z * 100.0 * math.sqrt(spread) / mass
    low = round(max(0.0, rate - half), 1)
    high = round(min(100.0, rate + half), 1)
    return {
        "winRate": round(rate, 1),
        "raw": round(raw / mass, 1),
        "low": low,
        "high": high,
        "nEff": round(n_eff, 1),
        "games": int(games),
        "covered": round(mass, 4),
        "exact": round(exact_mass / mass, 3),
        "strength": round(strength / mass, 3),
        "per": per,
    }


def strong(v: dict | None) -> bool:
    """Whether a duel value clears the bar for a reserved slot."""
    return bool(
        v
        and v["nEff"] >= DUEL_MIN_GAMES
        and v["low"] >= DUEL_MIN_LOW
        and v["covered"] >= DUEL_MIN_COVERED
    )


def rank_key(v: dict) -> tuple:
    """Strongest proof first: the bound, then the rate, then the evidence."""
    return (-v["low"], -v["winRate"], -v["nEff"])


def public(v: dict | None) -> dict | None:
    """The figures a row carries — `value()` without the per-condition table.

    The table is ~one row per win condition and nothing on the screen reads
    it; `_evidence_on_top`'s argument about `matchups`, applied up front.
    None under `DUEL_SHOW_GAMES` effective games: withheld, not zero.
    """
    if not v or v["nEff"] < DUEL_SHOW_GAMES:
        return None
    out = {k: v[k] for k in ("winRate", "raw", "low", "high", "nEff", "games",
                             "covered", "exact", "strength")}
    out["strong"] = strong(v)
    out["brain"] = DUEL_BRAIN_VERSION
    return out


# ── Candidates ──────────────────────────────────────────────────────────────


def own_answers(projection, decks, *, records_for) -> list[dict]:
    """A player's own duel decks that are proven against this opponent.

    `decks` is `duel_index.player_decks()`: `[{"key", "cards", "archetype",
    "games", "wins"}]`, the player's own counts. `records_for(deck)` returns
    the deck's rungs — POPULATION evidence for the list, which is what makes
    the proof more than one player's streak. Strongest proof first.
    """
    out = []
    for d in decks or []:
        if int(d.get("games") or 0) < OWN_MIN_GAMES or len(set(d.get("cards") or [])) != 8:
            continue
        v = value(projection, records_for(d))
        if strong(v):
            out.append({**d, "duel": v, "pick": PICK_OWN})
    out.sort(key=lambda r: rank_key(r["duel"]) + (r["key"],))
    return out


def population_answers(projection, catalogue, *, limit: int = 24) -> list[dict]:
    """Decks duel players WIN WITH against this projection, strongest first.

    `catalogue` is `duel_index.catalogue()`, each entry carrying its own
    `records`. Near-copies of a stronger answer are dropped, so `limit`
    answers are `limit` decks and not one deck `limit` times.
    """
    rows = []
    for d in catalogue or []:
        if len(set(d.get("cards") or [])) != 8:
            continue
        v = value(projection, d.get("records"))
        if strong(v):
            rows.append({**d, "duel": v, "pick": PICK_POPULATION})
    rows.sort(key=lambda r: rank_key(r["duel"]) + (r["key"],))
    out: list[dict] = []
    for r in rows:
        if any(same_deck(r["cards"], o["cards"]) for o in out):
            continue
        out.append(r)
        if len(out) >= limit:
            break
    return out


def _known_lean(n: int) -> float:
    span = 8 - (KNOWN_MIN - 1)
    return KNOWN_LEAN * max(0.0, min(1.0, (n - (KNOWN_MIN - 1)) / span))


def personal(answers, *, known=(), taken: dict | None = None,
             exclude=(), slots: int = DUEL_SLOTS) -> list[dict]:
    """Up to `slots` of the population's answers, chosen FOR ONE PLAYER.

    The proof leads (`low`); a pick built out of cards they play gains up to
    `KNOWN_LEAN`; one already handed to a teammate in this folder loses
    `SPREAD_PENALTY` per teammate. `exclude` is the decks already on their
    list — a pick that is a near-copy of one is not a new option. Each pick
    carries `known`, the cards of it they play.
    """
    known = set(known or ())
    taken = taken or {}
    scored = []
    for a in answers or []:
        k = len(set(a["cards"]) & known)
        score = (a["duel"]["low"] + _known_lean(k)
                 - SPREAD_PENALTY * int(taken.get(a["key"], 0)))
        scored.append((-score, rank_key(a["duel"]), a["key"], a, k))
    scored.sort(key=lambda s: s[:3])
    out: list[dict] = []
    held = [list(c) for c in exclude or ()]
    for *_, a, k in scored:
        if len(out) >= slots:
            break
        if any(same_deck(a["cards"], c) for c in held):
            continue
        out.append({**a, "known": k})
        held.append(a["cards"])
    return out


# ── Putting them on the list ────────────────────────────────────────────────


def merge(rows, picks, *, slots: int = DUEL_SLOTS, limit: int = 7):
    """The final list: the ranked rows, with up to `slots` held for duel proof.

    `rows` is the first brain's list, best first, each carrying `duel` (its
    public duel figures, possibly None). `picks` are this player's own proven
    duel decks followed by the population's, already shaped like rows. Nothing
    the caller holds is written.

      1. A row already on the list whose duel figures are strong COUNTS toward
         the slots and is marked `duelProven` — the ladder and the duels agree,
         the best evidence either brain can give.
      2. Open slots take picks that are not near-copies of a listed deck.
      3. Picks go DIRECTLY UNDER THE FIRST ROW. The first row is the squad
         plan's #1, a squad decision, and it stays; a duel-proven answer is the
         most specific evidence on the list for a duel, and the request was for
         it to be prominent, so it does not sit at the foot. The list keeps
         `limit` rows by dropping from the bottom the lowest rows that are
         neither proven nor picked.

    Returns `(rows, picked)`.
    """
    out = [dict(r) for r in rows or []]
    proven = 0
    for r in out:
        if (r.get("duel") or {}).get("strong"):
            r["duelProven"] = True
            proven += 1
    open_slots = max(0, slots - proven)
    chosen: list[dict] = []
    for p in picks or []:
        if len(chosen) >= open_slots:
            break
        if any(same_deck(p.get("cards"), r.get("cards")) for r in out + chosen):
            continue
        row = dict(p)
        row["duelProven"] = True
        row["duelPick"] = p.get("duelPick") or PICK_POPULATION
        chosen.append(row)
    if not chosen:
        return out, 0
    merged = out[:1] + chosen + out[1:]
    while len(merged) > limit:
        for i in range(len(merged) - 1, 0, -1):
            if not merged[i].get("duelProven"):
                del merged[i]
                break
        else:
            del merged[-1]
    return merged, len(chosen)
