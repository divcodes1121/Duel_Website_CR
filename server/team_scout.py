"""team_scout.py — the coaching brain: a threat space, then a preparation pool.

Design record: `DECKKIES_TEAM_SCOUT.md`. This file implements the reasoning and
NOTHING ELSE — no database, no network, no snapshot. Everything it needs is
handed to it. `team_analysis.py` does the wiring.

    NO IMPORTS BEYOND THE STANDARD LIBRARY.

The same rule `deck_harmony.py`, `tiers.ts`, `squadParse.ts` and
`passwordRules.ts` follow, and for the same reason: this decides what a coach
is told to prepare for, and a rule that cannot be tested without a 33 GB SQLite
file will be tested by shipping it. Every one of the cases in the test suite
runs in microseconds against literals.

────────────────────────────────────────────────────────────────────────────
WHAT CHANGED, AND WHY THE OLD ANSWER WAS THE WRONG SHAPE
────────────────────────────────────────────────────────────────────────────

`team_analysis._spread()` was the entire opponent model: archetype share by raw
game count, over their top six decks, with anything under two games dropped and
the remainder renormalised. Three consequences, and the third is the one that
made the screen feel like a database query:

  1. NO RECENCY. `lastSeen` was carried on every deck row and read by nothing.
     A deck abandoned in week one weighed exactly as much as the one they
     played yesterday.

  2. TRUNCATION INVERTED THE CONFIDENCE. Dropping the tail and renormalising
     hands the dropped mass BACK TO THE DECKS THEY PLAY MOST. So the less
     evidence there was, the MORE concentrated the model became — precisely
     backwards, and the opposite of what a coach does with a thin scouting
     report.

  3. THE PROJECTION WAS THE HISTORY. There was no term for a deck they had not
     already played, so every recommendation was optimised against exactly the
     decks in the log and nothing else. That is not a bug in the scorer; the
     scorer was answering the question it was given.

This module answers a different question. `threat_space()` projects what they
are likely to BRING — which is the observed decks, plus real variants of them,
plus the archetypes their behaviour implies — as a distribution that sums to
one. `score()` then ranks OUR decks against that whole distribution.

────────────────────────────────────────────────────────────────────────────
TWO LISTS, NOT ONE, AND THIS IS THE LOAD-BEARING DECISION
────────────────────────────────────────────────────────────────────────────

A recommendation cannot carry `opponent_likelihood`, because a recommendation
is OUR deck and the opponent is not going to play it. The brief asks for both
and they are different objects, so they are two lists:

    threats[]          THEIR projected pool. Each entry has `likelihood`,
                       and the likelihoods sum to 1.0.

    recommendations[]  OUR decks. Each carries `matchupValue`,
                       `threatCovered` (how much of the likelihood mass it was
                       actually scored against), `playerFit`,
                       `evidenceStrength` and `recommendationScore`.

Collapsing them would mean a COUNTER row publishing a probability that the
opponent plays our own deck, which is not a quantity.

────────────────────────────────────────────────────────────────────────────
WHERE THE MASS COMES FROM
────────────────────────────────────────────────────────────────────────────

    switch  = how much of the distribution is NOT their observed decks
    observed_mass = 1 - switch
    variant_mass  = switch * VARIANT_SHARE
    inferred_mass = switch * (1 - VARIANT_SHARE)

`switch` is measured from their own play — see `churn()` — and is CLAMPED SO
OBSERVED ALWAYS HOLDS THE MAJORITY. That ceiling is not a taste call: thirteen
phases of this project's own research found "Recent is undefeated as THE
prediction" at 0.9678 / 0.8710 Jaccard, and every attempt to let a model
overrule the player's current deck lost. A brain that can move more than half
the mass off what they actually play would be reopening a question that was
closed with evidence.

`VARIANT_SHARE` is 0.65 for the matching reason from the other direction:
`ml/candidates.py` measured that one-card variants contain the true next deck
89–94% of the time, and two-card generation was the structural gap. When
somebody deviates, a tweak is likelier than a new archetype.

────────────────────────────────────────────────────────────────────────────
VARIANTS COME FROM THE SEED POOL, NOT FROM A SIBLING SCAN
────────────────────────------------------------------------------------────

`deck_tuner.neighbours()` is the better variant finder in every way but one: it
is a full sibling scan, estimated at ~2.6 s, and this screen resolves up to ten
opponents. Expanding two decks each is twenty scans — roughly a minute added to
a route that answers in 1.5 s warm today. It is not shippable on the request
path and the cap is the whole reason this module exists in a form that can run
in production.

`deck_counter.seeds()` is already in the snapshot: forty real decks per
archetype, each with ≥60 games and its own per-archetype matchup record, and it
costs NO DATABASE WORK AT REQUEST TIME. A seed of the same archetype sharing
six or seven of eight cards with an observed deck IS a real variant of it, held
by real players, with a real record. That is what this uses.

What is given up: a rare variant nobody else plays will not be found. That is
the correct thing to give up — this module must never invent a deck, and a
configuration forty popular lists do not contain is not one a coach should be
told to prepare for over the ones they do.

`neighbours()` remains available for an opt-in deep path. It is deliberately
not called from here.

────────────────────────────────────────────────────────────────────────────
3.0 (2026-10-10): COUNTERS TO WHAT THEY PLAY, NOT A PORTFOLIO AGAINST THE META
────────────────────────────────────────────────────────────────────────────

Reported by the account holder, twice in one day: "the decks given for counter
are very generic and rely on meta — we need decks which counter their
archetypes, whatever they play, at least at a good percentage".

Measured on the live service before anything changed, and all three causes
were in the two functions above:

  * THE PROJECTION WAS PARTLY THE META. Up to 45% of the mass was moved off
    what they play onto seed variants and onto archetypes "their behaviour
    implies" — for an opponent on Minion Giant and Giant, Hog Rider, Royal Hogs
    and Balloon lists were scored against. A counter to a deck they do not
    play is the generic answer by definition.
  * `diversify` IS A PORTFOLIO PICKER. Its archetype-repeat penalty exists to
    spread a list over many archetypes, so rows four to seven were "the best
    deck of some other archetype" at 59-63% while lists at 70%+ against what
    they actually bring were left out.
  * DUEL PICKS WERE PINNED UNDER THE #1 whatever the list's own figure said:
    ten of ten checked sat 5-20 points under the rows below them, one at 40.9%.

`played_space()` is the projection now: their own decks and nothing else, with
every family they play keeping its whole share. `counters()` is the selection:
the strongest decks against that, in the order of the figure printed, no deck
expected to lose, near-copies folded, at most two lists of one win condition,
and a real answer held for every family they play a tenth of the time or more.
`answers()` is the same rows read per family.

On fourteen real opponents (every vetted seed scored against what they play)
the WEAKEST of the seven rose from 48.9-66.1% to 59.5-75.6%.

`threat_space`, `diversify` and `suggest` are unchanged and still used:
`coach_daily` ranks a field plan with `diversify`, and its 204 checks mean what
they meant.

────────────────────────────────────────────────────────────────────────────
4.0 (2026-10-10): THE WIDE READ — THEY DO NOT BRING WHAT THEY MOSTLY PLAY
────────────────────────────────────────────────────────────────────────────

Reported the day 3.0 shipped: "it's not good, because the opponent also
counter-snipes". Measured the same day, read-only, on 700 friendly duels of
the last 30 days (952 player-sides, 2,300 decks brought), each replayed with
only what was stored before the duel:

  * WHAT THEY BRING IS FAR FLATTER THAN WHAT THEY PLAY. The family of the deck
    brought had 18% of that player's games; it was their most played family
    21% of the time and one of their top three 50%. 3.0 scored against their
    play shares as they stood, so it prepared for the one deck and was
    surprised by the rest.
  * IT IS NOT A COUNTER-PICK FROM THEIR OWN LISTS. The deck they brought rated
    +0.03 points [-0.31, +0.37] better against the other player's history
    than their typical deck did (871 choices), and a counter term in a
    conditional logit over their lists fitted to nothing (0.0 to 0.2). From
    the receiving end the two look the same — you prepared for their main
    deck and met another — and the remedy is the same: do not trust the top
    of the list so much.
  * THEIR DUEL DECKS ARE WHAT THEY BRING TO A DUEL. Weighting a duel game of
    theirs as 30 other games, and keeping duel decks from before the window,
    took the log loss of "which family" from 2.83 to 2.43 and of "which list"
    from 3.43 to 2.62 (parameters chosen on one half of the duels, figures
    from the other).

So `played_space` reads their history three ways differently:

    TEMPER             weights are evidence ** 0.5, a family's and a list's
    DUEL_WEIGHT        a duel game in the window counts as 30 other games
    DUEL_OLDER_WEIGHT  a duel game from before it (to 90 days) as 10
    MAX_PLAYED         twenty of their lists are scored against, not twelve

and `counters` passes over a deck that loses badly (`WORST_FLOOR`) to any
family they are likely to bring while better-rounded decks remain.

Judged against the decks really brought, by the same fused rate that ranks
them: the three decks at the top of the list +1.5 points [+1.3, +1.8], the #1
+1.5, and the share of a list of seven that was under 50% against what came
from 11.6% to 5-6%. For scale: the average pool deck rates 49.9% against what
came, 3.0's top three 58.0%, and the best deck in hindsight 67.3% — most of
what is left is not knowable before the duel.

TRIED AND NOT BUILT, with the figure: a share of the weight on the friendly
duel field for decks they have never shown (+0.03, nothing); a blend of the
expected rate with the worst case (the same top three, and it would make the
printed figure something other than a rate); a counter term on their lists
(made the picks worse at every strength).

`plays[].share` is the PROJECTION now — the chance a deck of that family is
what they bring — and `played` beside it is the share of their games.
"""

from __future__ import annotations

import functools
import itertools
import math

#: The brain that produced a recommendation. Written onto every payload and
#: frozen into `coach_match_plans.engine`, so a plan made today can still be
#: told apart from one made by the old scorer when phase 7's results are read
#: back. Bump the MINOR for a weight change, the MAJOR for a shape change.
BRAIN_VERSION = "team-scout-4.0"

# ── How much of the distribution is NOT their observed decks ────────────────

#: Floor on the switch mass. NOT ZERO, and that is the point of it: at zero
#: this module degrades exactly into the old `_spread`, every recommendation
#: optimised against the log and nothing else. Even a one-deck player brings
#: something else occasionally, and a coach who has prepared for none of it has
#: prepared for the easy case only.
SWITCH_MIN = 0.15

#: Ceiling. Observed always holds the majority — see the module docstring for
#: the measurement this rests on. A brain free to move most of the mass off
#: what they actually play would be overruling `Recent`, which lost in Phases
#: 4, 5, 6 and 7.
SWITCH_MAX = 0.45

#: What a player with no measurable history is assumed to be. HIGH, because an
#: unknown opponent is a WIDE threat space rather than a narrow one. This is
#: the direct inversion of the truncate-and-renormalise bug: thin evidence must
#: make the model less certain, not more.
PRIOR_SWITCH = 0.55

#: Games at which their own diversity outweighs the prior. Below it the two are
#: blended, so a five-battle read is mostly prior and a hundred-battle read is
#: mostly them.
CHURN_PRIOR_GAMES = 30.0

#: Of the switch mass, how much goes to variants rather than to whole new
#: archetypes. See the module docstring: a deviation is likelier to be a tweak.
VARIANT_SHARE = 0.65

# ── Recency ─────────────────────────────────────────────────────────────────

#: Half-life, in days, on an observed deck's weight. Three weeks is one
#: balance-change cycle in this game; a deck last played two months ago is
#: evidence about a player and not about next weekend.
RECENCY_HALF_LIFE = 21.0

#: A stale deck never falls below this share of its raw weight. They DID play
#: it, and a decay that reaches zero would let a two-month-old deck vanish out
#: of the projection entirely — which is the same silent dropping the tail
#: truncation used to do, arriving by a different route.
RECENCY_FLOOR = 0.10

# ── Variants and inference ──────────────────────────────────────────────────

#: Cards a seed must share with an observed deck to count as a variant of it.
#: Six of eight is `deck_tuner.MAX_SWAP`, and the two agree by construction.
MIN_VARIANT_OVERLAP = 6

#: Relative likelihood of a variant by how far it is from the observed deck.
#: A one-card change is not merely commoner than a two-card change; the
#: candidate research found 1-card recall at 89–94% and 2-card "essentially
#: never" in the same beam, so the gap is real and large.
OVERLAP_WEIGHT = {7: 1.0, 6: 0.45}

#: Observed decks whose variants are expanded, best-likelihood first. The whole
#: projection is bounded by this times the seeds per archetype.
VARIANT_SOURCES = 3

#: Variants kept per observed deck.
VARIANTS_PER_SOURCE = 3

#: Inferred entries kept in total.
MAX_INFERRED = 4

#: Hard cap on the projection. Every candidate is scored against every threat,
#: so this is the term the request cost is linear in.
MAX_THREATS = 12

#: The cap for `played_space` (4.0). `MAX_THREATS` is ALSO `coach_daily`'s
#: field size, so it stays where it is. An opponent's own lists are a longer
#: tail than a meta board: a third of the decks brought to a duel were among
#: the twelve most likely lists, and scoring against twenty was worth +0.4
#: points on the top three (thirty and forty added nothing measurable).
MAX_PLAYED = 20

#: THE WIDE READ (4.0). A weight is `evidence ** TEMPER`, for a family and for
#: a list inside it. 1.0 is "they bring what they play, in proportion"; 0.0 is
#: "every deck they own is as likely as any other". Fitted on which family a
#: player brought to a friendly duel: log loss 2.84 at 1.0, 2.51 at 0.5 and at
#: 0.35, 2.74 at 0.0.
TEMPER = 0.5

#: A DUEL GAME OF THEIRS, in games of anything else. What somebody brings to a
#: duel is, above all, what they have brought to duels. 10 and 30 and 100 are
#: within noise of each other on the picks; 30 was the best on both log
#: losses on the half of the duels the choice was made on.
DUEL_WEIGHT = 30.0

#: A duel game from BEFORE the window (the caller passes up to 60 further
#: days). A deck they duelled with two months ago is still a deck they own.
DUEL_OLDER_WEIGHT = 10.0

#: Games below which an observed deck is evidence of an archetype rather than
#: of a deck. It is KEPT — see the module docstring on what dropping the tail
#: did — but it cannot seed variants, because a list somebody tried once is not
#: a core to build a projection around.
MIN_SOURCE_GAMES = 3

# ── Scoring ─────────────────────────────────────────────────────────────────

#: Points of expected win rate lost by a deck scored against NONE of the threat
#: mass, scaled by how much it missed. A deck measurable against 60% of what
#: they might bring loses 1.6 points to one measurable against all of it —
#: real, and still loseable to a genuine matchup edge, which is the same sizing
#: rule `COMFORT_WEIGHT` follows.
COVERAGE_WEIGHT = 4.0

#: The practice tiebreak. UNCHANGED FROM `team_analysis.COMFORT_WEIGHT`,
#: deliberately: the quantity has not changed and neither has the claim it
#: makes, so it must not quietly gain weight in a commit about something else.
FIT_WEIGHT = 1.5

#: Points lost by a deck whose figures are all bottom-rung. An expected win
#: rate assembled from the archetype matrix is a different claim from one
#: assembled from exact pair records, and the ranking should say so.
EVIDENCE_WEIGHT = 2.0

#: How strong a rung of `deck_counter.matchup_ladder` is as evidence. The keys
#: are `deck_counter.SOURCE_*` verbatim; an unrecognised source scores as the
#: weakest rather than raising, because a new rung added upstream should make
#: this cautious rather than break the request.
SOURCE_STRENGTH = {
    "exact": 1.0,       # these two lists have actually played each other
    # `matchup_fusion`: this list or its one-card variants against THIS exact
    # threat or its variants, 8+ games of ladder and duels together. Below
    # "exact" because most of it is variants rather than the two lists
    # themselves; above "deck" because it is about the threat's version, not
    # its archetype.
    "version": 0.9,
    "deck": 0.85,       # this exact list, against that archetype
    "cluster7": 0.60,   # decks within one card of it
    "cluster6": 0.45,   # within two
    "archetype": 0.25,  # archetype against archetype
}

# ── Diversity ───────────────────────────────────────────────────────────────

#: Points deducted from a candidate identical to one already chosen. Decisive
#: on purpose: seven near-copies of one deck is the exact failure that makes a
#: longer list worse than a short one, and a penalty that a large matchup edge
#: could outrun would let it happen anyway.
REDUNDANCY_WEIGHT = 6.0

#: Added to the card-overlap similarity when two decks share an archetype. Two
#: lists can share only four cards and still be the same plan.
ARCHETYPE_SIMILARITY = 0.20

#: Points charged for EACH deck of the same archetype already in the portfolio.
#:
#: PAIRWISE SIMILARITY ALONE DOES NOT CATCH THIS, and the case review is what
#: showed it. Two Royal Hogs lists sharing three of eight cards score 0.34 on
#: `similarity` — a 2.0-point penalty — so when the pool was thin, three of
#: them took three of seven slots. Every pair was genuinely dissimilar in
#: cards and the list was still three answers to one plan, which is the exact
#: failure §14 of the brief names.
#:
#: IT IS AN OCCUPANCY COST, NOT A CAP. A hard limit of one deck per archetype
#: would be wrong in the other direction: a defensive Hog list and a cycle Hog
#: list really are different preparations, and there are opponents where the
#: two best answers honestly share an archetype. Charging 2.5 points for the
#: second and 5.0 for the third means a genuine matchup edge can still buy the
#: slot, and nothing else can.
ARCHETYPE_REPEAT_PENALTY = 2.5

#: The portfolio: SEVEN, and the floor is the ceiling.
#:
#: IT WAS "5 TO 7", with `PORTFOLIO_DROP` free to stop the list at five when
#: the sixth option fell eight points below the best. Measured live that is
#: what it did for 13 of 30 real opponents, and the account holder asked for
#: seven (2026-09-21). That is a call about what a coach wants in front of
#: them — a longer bench to choose from — and it is theirs to make. The rows
#: are still ranked, so a weaker seventh sits last with its own rate beside it
#: rather than being hidden; nothing on the list claims more than its figures.
#:
#: `diversify` keeps its `minimum` argument and `PORTFOLIO_DROP` keeps its
#: meaning for any caller that asks for a shorter floor; the production
#: callers simply no longer do.
MIN_RECOMMENDATIONS = 7
MAX_RECOMMENDATIONS = 7

#: Shared cards at which two lists ARE the same deck.
#:
#: `duel_zone.COUNTER_MIN_OVERLAP`, which `!counter`, the clusterer, the duel
#: matcher and `coach._fills` all already use. Mirrored rather than imported
#: because this module has no imports — and mirrored rather than re-chosen,
#: because a second definition of "the same deck" is how two screens end up
#: disagreeing about whether they showed you one option or two.
SAME_DECK_OVERLAP = 6

#: A candidate this far in points below the best one is not preparation, it is
#: padding — for a caller that passes a `minimum` below its `limit`. With the
#: portfolio at seven-and-seven it is not reached by production (see
#: `MIN_RECOMMENDATIONS`), and a pool smaller than seven still comes back
#: short rather than inventing a row.
PORTFOLIO_DROP = 8.0

# ── Vocabularies ────────────────────────────────────────────────────────────

#: Why a threat is in the projection. Never inferred from a missing field, and
#: never converted into one another: an inferred deck must not be able to
#: present itself as something the opponent was seen playing.
OBSERVED = "OBSERVED"
VARIANT = "VARIANT"
INFERRED = "INFERRED"

#: Why one of OUR decks is in the list.
REC_COUNTER = "COUNTER"          # answers the observed core
REC_ROBUST = "ROBUST"            # answers observed AND its variants
REC_CONTINGENCY = "CONTINGENCY"  # answers what they have not shown yet

#: The four words the brief asks for, in order of how much is actually known.
KNOWN = "known"
LIKELY = "likely"
POSSIBLE = "possible"
SPECULATIVE = "speculative"


# ── Small helpers, kept pure ────────────────────────────────────────────────


def deck_key(cards) -> str:
    """The order-free identity of eight cards. Matches `deck_counter`'s hash."""
    return ",".join(sorted(set(cards or [])))


def _days_between(later: str | None, earlier: str | None) -> float | None:
    """Whole days between two stamps, tolerating BOTH formats this project holds.

    `player_report` emits `lastSeen` straight out of `battles.battle_time`,
    which is Supercell's `20260907T161011.000Z` — a format `datetime` cannot
    parse without help and `Date.parse` cannot read at all (there is a note
    about that in CLAUDE.md, from the last time it bit). ISO is accepted too so
    a caller holding a normalised stamp does not have to un-normalise it.

    Returns None rather than 0 when either stamp is unreadable. Zero would mean
    "played today", which is the strongest possible recency claim, and
    inventing it from a parse failure is how an abandoned deck ends up leading
    a projection.
    """
    a, b = _stamp(later), _stamp(earlier)
    if a is None or b is None:
        return None
    return max(0.0, (a - b) / 86400.0)


def _stamp(value: str | None) -> float | None:
    """One stamp -> epoch seconds, or None. Never raises."""
    if not value or not isinstance(value, str):
        return None
    s = value.strip().replace("Z", "").replace("z", "")
    # `20260907T161011.000` -> `2026-09-07T16:10:11`
    if "-" not in s and "T" in s and len(s) >= 15:
        d, _, t = s.partition("T")
        if len(d) == 8 and len(t) >= 6:
            s = f"{d[0:4]}-{d[4:6]}-{d[6:8]}T{t[0:2]}:{t[2:4]}:{t[4:6]}"
    s = s.split(".")[0]
    try:
        import datetime as _dt
        return _dt.datetime.fromisoformat(s).replace(
            tzinfo=_dt.timezone.utc).timestamp()
    except Exception:  # noqa: BLE001
        return None


def _recency(last_seen: str | None, now: str | None) -> float:
    """Weight multiplier for how long ago a deck was last played, in (0, 1].

    Exponential with `RECENCY_HALF_LIFE`, floored at `RECENCY_FLOOR`. An
    unreadable or absent stamp returns 1.0 — NOT the floor. The absence of a
    date is not evidence that a deck is old, and treating it as such would
    silently down-weight every deck on a payload whose stamps this cannot read,
    which is a failure mode that looks exactly like a working one.
    """
    age = _days_between(now, last_seen) if now else None
    if age is None:
        return 1.0
    return max(RECENCY_FLOOR, 0.5 ** (age / RECENCY_HALF_LIFE))


def similarity(a, b, arch_a: str | None = None, arch_b: str | None = None) -> float:
    """How much two decks are the same plan, in [0, 1].

    SUPERLINEAR IN CARD OVERLAP, on purpose. A linear share would charge two
    decks sharing half their cards — which is most pairs of decks in this game,
    since every list runs a small spell and a cheap cycle card — as though they
    were near-copies, and the diversity pass would then spread the portfolio
    across decks that are merely different rather than decks that answer
    different things. Squaring it leaves four shared cards nearly free and
    makes seven shared cards decisive.
    """
    return _pair_similarity(frozenset(a or []), frozenset(b or []), arch_a, arch_b)


def _pair_similarity(sa: frozenset, sb: frozenset,
                     arch_a: str | None, arch_b: str | None) -> float:
    """`similarity` on card sets already built — the arithmetic, once.

    Split out so `diversify` can build each candidate's set ONCE instead of on
    every comparison: at 12v12 it made 310,000 comparisons a request and
    rebuilt two sets for each (measured, 2026-09-21).
    """
    if not sa or not sb:
        return 0.0
    overlap = len(sa & sb) / max(len(sa), len(sb))
    sim = overlap * overlap
    if arch_a and arch_b and arch_a == arch_b:
        sim += ARCHETYPE_SIMILARITY
    return min(1.0, sim)


# ── 1. How much does this opponent deviate? ─────────────────────────────────


def churn(decks) -> dict:
    """How much of the projection should NOT be their observed decks.

    Returns `{switch, diversity, decks, games, evidence}`.

    MEASURED FROM CONCENTRATION, NOT FROM TRANSITIONS. The honest constraint is
    that `player_report` hands back decks already aggregated — games, wins and
    a last-seen per deck — and not the battle sequence, so "how often did they
    change deck between battles" is not answerable from this input without a
    second read of `battles` per opponent. What IS answerable is how their play
    is spread across decks, and `1 - Σ share²` (the complement of the
    Herfindahl index) is exactly that: 0 for somebody who plays one deck, and
    rising toward 1 the more evenly their games are split.

    THE SHRINKAGE IS THE POINT, AND IT RUNS TOWARD THE WIDE END. A player with
    eight battles has a diversity figure, and it means almost nothing; blending
    it toward `PRIOR_SWITCH` by how much evidence there is means a thin read
    produces a WIDER threat space rather than a more confident one. That is the
    direct fix for the behaviour this module was written to replace, where
    dropping the tail and renormalising made a thin read sharper.
    """
    rows = [d for d in (decks or []) if int(d.get("matches") or 0) > 0]
    total = sum(int(d.get("matches") or 0) for d in rows)
    if not rows or total <= 0:
        return {"switch": round(_clamp(PRIOR_SWITCH), 4), "diversity": None,
                "decks": 0, "games": 0, "evidence": "none"}

    hhi = sum((int(d.get("matches") or 0) / total) ** 2 for d in rows)
    diversity = max(0.0, min(1.0, 1.0 - hhi))

    w = total / (total + CHURN_PRIOR_GAMES)
    blended = w * diversity + (1.0 - w) * PRIOR_SWITCH

    return {
        "switch": round(_clamp(blended), 4),
        "diversity": round(diversity, 4),
        "decks": len(rows),
        "games": total,
        # What the figure is standing on, said rather than left to be inferred
        # from the game count. `thin` is the state where the prior is doing
        # most of the work and the reader should know it.
        "evidence": "thin" if total < CHURN_PRIOR_GAMES else "measured",
    }


def _clamp(v: float) -> float:
    return max(SWITCH_MIN, min(SWITCH_MAX, v))


# ── 2. The threat space ─────────────────────────────────────────────────────


def threat_space(decks, seeds=None, *, now=None, veto=None,
                 archetype_of=None) -> dict:
    """What this opponent is likely to BRING, as a distribution summing to 1.0.

    `decks`   their observed decks: `cards`, `matches`, `winCondition`,
              `lastSeen`, and whatever else the caller carries through.
    `seeds`   `deck_counter.seeds()` — `{archetype: [{cards, games, ...}]}`.
              Optional: with none, the projection is the observed decks alone
              and `switch` mass is returned to them, which is the documented
              degradation when the snapshot has not built yet.
    `veto`    `deck_harmony.veto` or None. A generated threat that is not a
              coherent deck is DROPPED, never down-weighted — the same rule
              `deck_tuner.rank` applies, and for the same reason.
    `now`     the stamp recency is measured against. Defaults to the newest
              `lastSeen` on the payload, so a report built from a window that
              ended last month decays from the end of that window rather than
              from today and does not report every deck as ancient.

    EVERY ENTRY SAYS WHICH KIND IT IS AND NEVER CHANGES KIND. An inferred deck
    carries `evidence: INFERRED`, `observedCount: 0` and no `lastSeen`; it
    cannot present itself as something they were seen playing, which is the one
    dishonesty this whole design exists to avoid.
    """
    observed = _observed(decks, now=now)
    ch = churn(decks)

    if not observed:
        return {"threats": [], "churn": ch, "reason": "no_history",
                "brain": BRAIN_VERSION}

    switch = ch["switch"] if seeds else 0.0
    observed_mass = 1.0 - switch

    for t in observed:
        t["likelihood"] = t["share"] * observed_mass

    variants = _variants(observed, seeds, veto=veto,
                         archetype_of=archetype_of) if seeds else []
    inferred = _inferred(observed, seeds, veto=veto,
                         taken={t["key"] for t in observed + variants}) if seeds else []

    _allocate(variants, switch * VARIANT_SHARE)
    _allocate(inferred, switch * (1.0 - VARIANT_SHARE))

    threats = observed + variants + inferred
    threats.sort(key=lambda t: (-t["likelihood"], t["name"]))
    threats = threats[:MAX_THREATS]

    # RENORMALISE ONLY AFTER THE CAP, and only over what survived it. This is
    # the one renormalisation in the module and it is safe because nothing was
    # dropped for being weak evidence — the cap is a cost bound, so the mass it
    # removes genuinely belongs to the entries that remain.
    total = sum(t["likelihood"] for t in threats)
    if total > 0:
        for t in threats:
            t["likelihood"] = round(t["likelihood"] / total, 4)

    for t in threats:
        t["confidence"] = _threat_confidence(t)

    return {
        "threats": threats,
        "churn": ch,
        "reason": None,
        "brain": BRAIN_VERSION,
        # The split, published rather than left to be re-derived by summing.
        "mass": {
            "observed": round(sum(t["likelihood"] for t in threats
                                  if t["evidence"] == OBSERVED), 4),
            "variant": round(sum(t["likelihood"] for t in threats
                                 if t["evidence"] == VARIANT), 4),
            "inferred": round(sum(t["likelihood"] for t in threats
                                  if t["evidence"] == INFERRED), 4),
        },
    }


def _observed(decks, *, now=None) -> list[dict]:
    """Their real decks, recency-weighted, as shares of the observed mass.

    THE WHOLE TAIL IS KEPT. `_spread` dropped anything under two games and
    renormalised, which handed that mass to the decks they play most and made a
    thin read look confident. A deck played once is weak evidence about next
    weekend and real evidence that they own the archetype, and the right place
    to express that is a small weight — not a deletion.
    """
    rows = [d for d in (decks or [])
            if len(set(d.get("cards") or [])) == 8
            and int(d.get("matches") or 0) > 0]
    if not rows:
        return []

    if now is None:
        stamps = [d.get("lastSeen") for d in rows if d.get("lastSeen")]
        now = max(stamps) if stamps else None

    out: list[dict] = []
    for d in rows:
        games = int(d.get("matches") or 0)
        weight = games * _recency(d.get("lastSeen"), now)
        out.append({
            "key": deck_key(d.get("cards")),
            "cards": list(d.get("cards") or []),
            "art": d.get("art") or {},
            "archetype": d.get("winCondition") or "other",
            "name": d.get("name") or "",
            "evidence": OBSERVED,
            "observedCount": games,
            "wins": int(d.get("wins") or 0),
            "winRate": d.get("winRate"),
            "lastSeen": d.get("lastSeen"),
            "similarityToObserved": 1.0,
            "basis": None,
            "_weight": weight,
        })

    total = sum(t["_weight"] for t in out) or 1.0
    for t in out:
        t["share"] = t["_weight"] / total
        del t["_weight"]
    return out


def _variants(observed, seeds, *, veto=None, archetype_of=None) -> list[dict]:
    """Real decks close enough to an observed deck to be a version of it.

    Drawn from the seed pool, never generated — see the module docstring for
    why a sibling scan cannot sit on this request path, and what that costs.
    """
    if not seeds:
        return []

    sources = [t for t in observed
               if t["observedCount"] >= MIN_SOURCE_GAMES]
    sources.sort(key=lambda t: -t["share"])
    sources = sources[:VARIANT_SOURCES]

    taken = {t["key"] for t in observed}
    out: list[dict] = []

    for src in sources:
        pool = list(seeds.get(src["archetype"]) or [])
        found: list[dict] = []
        for seed in pool:
            cards = list(seed.get("cards") or [])
            if len(set(cards)) != 8:
                continue
            key = deck_key(cards)
            if key in taken:
                continue
            overlap = len(set(cards) & set(src["cards"]))
            if overlap < MIN_VARIANT_OVERLAP or overlap >= 8:
                continue
            if veto is not None and veto(cards):
                continue
            found.append({
                "key": key,
                "cards": cards,
                "art": {},
                "archetype": src["archetype"],
                "name": "",
                "evidence": VARIANT,
                "observedCount": 0,
                "wins": 0,
                "winRate": None,
                "lastSeen": None,
                "similarityToObserved": round(overlap / 8.0, 3),
                # WHICH observed deck this is a version of. A variant with no
                # named parent is an assertion; with one it is a step the
                # reader can check.
                "basis": src["key"],
                "basisName": src.get("name") or "",
                "overlap": overlap,
                "_weight": (OVERLAP_WEIGHT.get(overlap, 0.3)
                            * src["share"]
                            * math.log1p(int(seed.get("games") or 0))),
            })
        found.sort(key=lambda v: (-v["_weight"], v["key"]))
        for v in found[:VARIANTS_PER_SOURCE]:
            taken.add(v["key"])
            out.append(v)

    return out


def _inferred(observed, seeds, *, veto=None, taken=None) -> list[dict]:
    """Archetypes their behaviour implies, represented by a real deck each.

    TWO SOURCES, and the second only fires when it is justified. The first is
    the archetypes they already play — their most-played seed, when it is not
    already in the projection. The second is the most-played seeds overall, and
    it exists for the case the brief calls out by name: an opponent with almost
    no history, where the honest projection is broad and the population's own
    answer is the only evidence available. It is marked INFERRED like
    everything else here, so nothing about it reads as observed.
    """
    if not seeds:
        return []
    taken = set(taken or ())
    own = {t["archetype"] for t in observed}
    out: list[dict] = []

    def add(cards, arch, games, why):
        key = deck_key(cards)
        if key in taken or len(set(cards)) != 8:
            return
        if veto is not None and veto(cards):
            return
        taken.add(key)
        out.append({
            "key": key, "cards": list(cards), "art": {},
            "archetype": arch, "name": "",
            "evidence": INFERRED,
            "observedCount": 0, "wins": 0, "winRate": None, "lastSeen": None,
            "similarityToObserved": 0.0,
            "basis": None, "why": why,
            "_weight": math.log1p(int(games or 0)) * (1.0 if why == "own_archetype" else 0.5),
        })

    for arch in sorted(own):
        for seed in (seeds.get(arch) or [])[:1]:
            add(seed.get("cards") or [], arch, seed.get("games"), "own_archetype")

    # The population's answer, only where their own history cannot fill the
    # projection. Bounded by MAX_INFERRED like everything else.
    if len(out) < MAX_INFERRED:
        pop = []
        for arch, decks in (seeds or {}).items():
            if arch in own:
                continue
            for seed in decks[:1]:
                pop.append((int(seed.get("games") or 0), arch, seed))
        pop.sort(key=lambda r: (-r[0], r[1]))
        for games, arch, seed in pop:
            if len(out) >= MAX_INFERRED:
                break
            add(seed.get("cards") or [], arch, games, "meta")

    out.sort(key=lambda t: (-t["_weight"], t["key"]))
    return out[:MAX_INFERRED]


def _allocate(rows, mass: float) -> None:
    """Split `mass` across `rows` by their relative weights, in place."""
    if not rows:
        return
    total = sum(r.get("_weight") or 0.0 for r in rows)
    for r in rows:
        r["likelihood"] = (mass * (r.pop("_weight") or 0.0) / total) if total > 0 else 0.0


def _threat_confidence(t: dict) -> str:
    """One of the four words. Read off the evidence, never off the likelihood.

    A high likelihood does not make a claim well-evidenced — an inferred deck
    can carry real mass precisely because the opponent is unpredictable, and
    calling that `known` would be the lie this module is built to avoid.
    """
    if t["evidence"] == OBSERVED:
        return KNOWN if t["observedCount"] >= MIN_SOURCE_GAMES else LIKELY
    if t["evidence"] == VARIANT:
        return LIKELY if t.get("overlap", 0) >= 7 else POSSIBLE
    return POSSIBLE if t.get("why") == "own_archetype" else SPECULATIVE


# ── 2b. What they PLAY — the projection since 3.0 ───────────────────────────

#: A family they play at least this much of the time is NAMED on the screen
#: (a chip, a group of counters) and always keeps one of the projection's
#: lists. Five percent: one game in twenty is a deck they may bring; under it
#: the list is an experiment and is counted in the shares without being named.
PLAYS_MIN_SHARE = 0.05


def family_of(row) -> str:
    """What a deck is GROUPED under: its archetype, or the family its caller
    named for it.

    The bot files several unrelated win conditions under one `other` key
    (Minion Giant, Goblin Giant, Skeleton Barrel…), so "they play Mixed 83%"
    names nothing a counter can be chosen against. The caller, which owns the
    card vocabulary, puts `family` on such a deck; everything else groups by
    archetype exactly as before.
    """
    return row.get("family") or row.get("archetype") or ""


def played_space(decks, *, now=None, limit=None, older=None) -> dict:
    """What this opponent is likely to BRING, read off their own decks and
    nothing they have not played.

    `decks` is `threat_space`'s input, each row optionally carrying `family`,
    `familyName` and `duelMatches` (how many of its `matches` were duel
    games). `older` is the same shape for lists they DUELLED with before the
    window: `matches` there is duel games, and none of them counts as play in
    the window. Two rows of one list (a roster pooled, a list two opponents
    share) are folded into one.

    Returns `threats` (at most `limit` lists, likelihoods summing to 1.0),
    `plays` (one row a family: `family`, `archetype`, `name`, `share`,
    `played`, `games`, `wins`, `decks`, `duelGames`; most likely first) and
    `churn`.

    `share` IS THE CHANCE, `played` IS THE HISTORY. A list's evidence is its
    games in the window, with a duel game counted `DUEL_WEIGHT` times and an
    older duel game `DUEL_OLDER_WEIGHT` times, times its recency
    (`_recency`); a family's chance is its evidence to the power `TEMPER`,
    and a list's within its family the same. See the module docstring for the
    measurement each of those rests on.

    EVERY FAMILY KEEPS ITS WHOLE CHANCE. Only the most likely lists are scored
    against — a cost bound — and a player with eight hundred variants has most
    of their games outside any twenty of them. So the lists kept for a family
    are scaled up to carry everything the family was worth: cutting the tail
    must not hand a Miner player's Miner games to Royal Giant because the
    Royal Giant games sat in fewer lists. A family worth naming
    (`PLAYS_MIN_SHARE`) always keeps its most likely list.
    """
    limit = MAX_PLAYED if limit is None else limit
    merged: dict[str, dict] = {}

    def fold(d, *, old: bool) -> None:
        cards = list(d.get("cards") or [])
        n = int(d.get("matches") or 0)
        if len(set(cards)) != 8 or n <= 0:
            return
        key = deck_key(cards)
        hit = merged.get(key)
        if hit is None:
            hit = merged[key] = dict(d)
            hit.update(matches=0, wins=0, duelMatches=0, duelOlder=0, lastSeen=None)
        if old:
            hit["duelOlder"] += n
        else:
            hit["matches"] += n
            hit["wins"] += int(d.get("wins") or 0)
            hit["duelMatches"] += min(n, max(0, int(d.get("duelMatches") or 0)))
        if (d.get("lastSeen") or "") > (hit.get("lastSeen") or ""):
            hit["lastSeen"] = d.get("lastSeen")

    for d in decks or []:
        fold(d, old=False)
    for d in older or []:
        fold(d, old=True)

    rows = list(merged.values())
    played = [d for d in rows if d["matches"] > 0]
    for d in rows:
        games = d["matches"]
        d["winRate"] = round(100.0 * d["wins"] / games, 1) if games else None

    ch = churn(played)
    if not rows:
        return {"threats": [], "plays": [], "churn": ch, "reason": "no_history",
                "brain": BRAIN_VERSION}

    if now is None:
        stamps = [d.get("lastSeen") for d in played if d.get("lastSeen")]
        now = max(stamps) if stamps else None

    observed: list[dict] = []
    for d in rows:
        games = d["matches"]
        duel = d["duelMatches"]
        rec = _recency(d.get("lastSeen"), now)
        observed.append({
            "key": deck_key(d.get("cards")),
            "cards": list(d.get("cards") or []),
            "art": d.get("art") or {},
            "archetype": d.get("winCondition") or "other",
            "name": d.get("name") or "",
            "evidence": OBSERVED,
            "observedCount": games,
            "duelCount": duel + d["duelOlder"],
            "wins": d["wins"],
            "winRate": d.get("winRate"),
            "lastSeen": d.get("lastSeen"),
            "similarityToObserved": 1.0,
            "basis": None,
            "family": d.get("family") or d.get("winCondition") or "other",
            "_played": games * rec,
            "_raw": ((games - duel) + DUEL_WEIGHT * duel
                     + DUEL_OLDER_WEIGHT * d["duelOlder"]) * rec,
        })
    total_played = sum(t["_played"] for t in observed) or 1.0

    per: dict[str, dict] = {}
    for t in observed:
        d = merged[t["key"]]
        fam = t["family"]
        t["share"] = t["_played"] / total_played
        e = per.get(fam)
        if e is None:
            e = per[fam] = {"family": fam, "archetype": t["archetype"],
                            "name": d.get("familyName") or "",
                            "share": 0.0, "played": 0.0, "games": 0, "wins": 0,
                            "decks": 0, "duelGames": 0, "_raw": 0.0, "_in": 0.0}
        e["played"] += t["share"]
        e["games"] += t["observedCount"]
        e["wins"] += t["wins"]
        e["decks"] += 1
        e["duelGames"] += t["duelCount"]
        e["_raw"] += t["_raw"]
        t["_w"] = t["_raw"] ** TEMPER if t["_raw"] > 0 else 0.0
        e["_in"] += t["_w"]

    fam_total = sum(e["_raw"] ** TEMPER for e in per.values() if e["_raw"] > 0) or 1.0
    for e in per.values():
        e["share"] = (e["_raw"] ** TEMPER) / fam_total if e["_raw"] > 0 else 0.0
    for t in observed:
        e = per[t["family"]]
        t["chance"] = e["share"] * t["_w"] / e["_in"] if e["_in"] > 0 else 0.0

    observed.sort(key=lambda t: (-t["chance"], t["key"]))
    lead: list[dict] = []
    seen: set[str] = set()
    for t in observed:
        if t["family"] in seen:
            continue
        seen.add(t["family"])
        if per[t["family"]]["share"] >= PLAYS_MIN_SHARE:
            lead.append(t)
    lead = lead[:max(1, limit)]
    held = {t["key"] for t in lead}
    keep = lead + [t for t in observed if t["key"] not in held][:max(0, limit - len(lead))]

    kept: dict[str, float] = {}
    for t in keep:
        kept[t["family"]] = kept.get(t["family"], 0.0) + t["chance"]
    total = sum(per[f]["share"] for f in kept) or 1.0
    for t in keep:
        t["likelihood"] = round(
            per[t["family"]]["share"] * t["chance"] / kept[t["family"]] / total, 4)
        t["confidence"] = _threat_confidence(t)
    for t in observed:
        for k in ("_played", "_raw", "_w", "chance"):
            t.pop(k, None)
    keep.sort(key=lambda t: (-t["likelihood"], t["key"]))

    plays = sorted(per.values(), key=lambda e: (-e["share"], e["family"]))
    for e in plays:
        e["share"] = round(e["share"], 4)
        e["played"] = round(e["played"], 4)
        del e["_raw"], e["_in"]
    return {
        "threats": keep,
        "plays": plays,
        "churn": ch,
        "reason": None,
        "brain": BRAIN_VERSION,
        "read": {"temper": TEMPER, "duelWeight": DUEL_WEIGHT,
                 "duelGames": sum(d["duelMatches"] for d in rows),
                 "olderDuelGames": sum(d["duelOlder"] for d in rows),
                 "lists": len(rows)},
        # All of it is what they were seen playing. Published in the old shape
        # so a reader of `mass` needs no second branch.
        "mass": {"observed": 1.0, "variant": 0.0, "inferred": 0.0},
    }


# ── 3. Scoring one of OUR decks against the projection ──────────────────────


def score(rate_for, threats, *, cards, archetype, fit_games=None,
          rate_for_threat=None, lean=False) -> dict | None:
    """One candidate deck against the whole projected threat space.

    `lean=True` returns the same figures WITHOUT the per-threat table — `vs`
    (the rate against each family) is computed here instead. The counter pool
    is two thousand lists and seven are shown; a dozen row dicts for each of
    the rest is most of the cost of rating them. The arithmetic is this
    function's one loop either way, so a lean row and a full row of one deck
    cannot disagree.

    `rate_for(archetype) -> {winRate, source, games, ...} | None` is
    `deck_counter.matchup_ladder`'s answer, handed in rather than imported —
    the caller owns the database and this module owns the arithmetic.

    `rate_for_threat(threat) -> same | None`, when given, is asked INSTEAD, with
    the whole threat row — its cards, not just its archetype — which is what
    lets a rate differ between two Log Bait lists (`matchup_fusion`, Team
    Analysis). Optional and keyword-only, because this function has a SECOND
    CONSUMER (`coach_daily`) that calls it with archetype rates and must not
    change behaviour because this one did.

    Returns None when NOTHING in the projection could be answered. That is a
    real state and it must not be rendered as 50%, which is what averaging over
    an empty set produces. Inherited unchanged from `team_analysis._score`,
    which got this right.

    THE FOUR SIGNALS STAY APART. `matchupValue` is how well it does,
    `threatCovered` is how much of the projection that figure was measured
    over, `evidenceStrength` is what rungs it came off, `playerFit` is whether
    our player can actually pilot it. Collapsing them was what made the old
    payload unable to express "likely, but prepare something else".
    """
    if not threats:
        return None

    rows: list[dict] = []
    answered = 0.0
    weighted_win = 0.0
    weighted_strength = 0.0
    fam_num: dict[str, float] = {}
    fam_den: dict[str, float] = {}

    for t in threats:
        m = rate_for_threat(t) if rate_for_threat is not None else rate_for(t["archetype"])
        like = float(t.get("likelihood") or 0.0)
        if lean:
            if not m or m.get("winRate") is None:
                continue
            rate = float(m["winRate"])
            answered += like
            weighted_win += like * rate
            weighted_strength += like * SOURCE_STRENGTH.get(m.get("source"), 0.25)
            fam = t.get("family") or t.get("archetype") or ""
            if fam and like > 0:
                fam_num[fam] = fam_num.get(fam, 0.0) + like * rate
                fam_den[fam] = fam_den.get(fam, 0.0) + like
            continue
        if not m or m.get("winRate") is None:
            rows.append({
                "threat": t["key"], "archetype": t["archetype"],
                "name": t.get("name") or "", "evidence": t["evidence"],
                "likelihood": like, "winRate": None, "source": None,
                "games": 0, "tier": None,
            })
            if t.get("family"):
                rows[-1]["family"] = t["family"]
            continue
        answered += like
        weighted_win += like * float(m["winRate"])
        weighted_strength += like * SOURCE_STRENGTH.get(m.get("source"), 0.25)
        rows.append({
            "threat": t["key"], "archetype": t["archetype"],
            "name": t.get("name") or "", "evidence": t["evidence"],
            "likelihood": like, "winRate": m.get("winRate"),
            "source": m.get("source"), "games": m.get("games") or 0,
            "tier": m.get("tier"), "interval": m.get("interval"),
        })
        # WHICH FAMILY THE THREAT IS, when the projection names one
        # (`played_space`). Absent otherwise, so a projection built without
        # families — `coach_daily`'s, `threat_space`'s — reads exactly as it did.
        if t.get("family"):
            rows[-1]["family"] = t["family"]

    out = _row(answered, weighted_win, weighted_strength,
               cards=cards, archetype=archetype, fit_games=fit_games)
    if out is None:
        return None
    if lean:
        out["vs"] = {a: round(fam_num[a] / fam_den[a], 1) for a in fam_num if fam_den[a] > 0}
    else:
        out["matchups"] = rows
    return out


def _row(answered: float, weighted_win: float, weighted_strength: float, *,
         cards, archetype, fit_games=None) -> dict | None:
    """A scored row from the three sums `score` and `score_rates` both build.

    ONE PLACE for what a recommendation is worth, so the tight loop over the
    counter pool and the full row drawn on the screen cannot drift apart.
    """
    if answered <= 0:
        return None

    matchup_value = weighted_win / answered
    strength = weighted_strength / answered
    fit = _fit(fit_games)

    recommendation_score = (
        matchup_value
        - COVERAGE_WEIGHT * (1.0 - answered)
        + FIT_WEIGHT * fit
        - EVIDENCE_WEIGHT * (1.0 - strength)
    )

    return {
        "cards": list(cards),
        "key": deck_key(cards),
        "archetype": archetype,
        # The headline, and the same quantity the old `expectedWinRate` was —
        # kept under BOTH names so an existing reader is not broken by a
        # rename that carries no new information.
        "matchupValue": round(matchup_value, 1),
        "expectedWinRate": round(matchup_value, 1),
        "threatCovered": round(answered, 4),
        "spreadCovered": round(100 * answered, 1),
        "evidenceStrength": round(strength, 3),
        "playerFit": round(fit, 3) if fit_games is not None else None,
        "recommendationScore": round(recommendation_score, 3),
        "score": round(recommendation_score, 3),
        "confidence": _rec_confidence(strength, answered),
        "brain": BRAIN_VERSION,
    }


def score_rates(rates, *, cards, archetype, fit_games=None, key=None) -> dict | None:
    """`score(lean=True)` for a caller that already holds the rates.

    `rates` yields `(likelihood, family, win rate, source)` for each threat the
    candidate could be rated against — nothing for one it could not. The
    counter pool's loop (`team_analysis`) reads its evidence straight out of
    the version cells and hands the figures here, instead of building a
    closure and a dictionary per threat for two thousand lists. `key` is the
    candidate's deck key when the caller has it.
    """
    answered = weighted_win = weighted_strength = 0.0
    fam_num: dict[str, float] = {}
    fam_den: dict[str, float] = {}
    for like, fam, rate, source in rates:
        answered += like
        weighted_win += like * rate
        weighted_strength += like * SOURCE_STRENGTH.get(source, 0.25)
        if fam and like > 0:
            fam_num[fam] = fam_num.get(fam, 0.0) + like * rate
            fam_den[fam] = fam_den.get(fam, 0.0) + like
    out = _row(answered, weighted_win, weighted_strength,
               cards=cards, archetype=archetype, fit_games=fit_games)
    if out is None:
        return None
    if key:
        out["key"] = key
    out["vs"] = {a: round(fam_num[a] / fam_den[a], 1) for a in fam_num if fam_den[a] > 0}
    return out


def _fit(games) -> float:
    """How practised our player is on this deck, in [0, 1].

    A TIEBREAK, NOT A MODEL — the same claim `team_analysis._comfort` makes and
    the same shape, linear to the point where more repetitions stop meaning
    anything. `None` games is a deck with no owner (a scouting report row, an
    archetype representative) and scores zero rather than being defaulted to a
    middle value, because nobody has piloted it and inventing familiarity is
    exactly the sort of figure this project refuses.
    """
    if not games or games <= 0:
        return 0.0
    return min(1.0, float(games) / 25.0)


def _rec_confidence(strength: float, covered: float) -> str:
    """How much to trust a recommendation. Evidence AND coverage, not either."""
    if strength >= 0.75 and covered >= 0.80:
        return KNOWN
    if strength >= 0.50 and covered >= 0.60:
        return LIKELY
    if strength >= 0.30 and covered >= 0.35:
        return POSSIBLE
    return SPECULATIVE


def classify(row, threats) -> str:
    """Why this deck is on the list — COUNTER, ROBUST or CONTINGENCY.

    Read from which KINDS of threat it actually answers, not from its rank. A
    deck that beats their observed core and nothing else is a COUNTER; one that
    holds up across the variants too is ROBUST and is the better preparation
    even at a slightly lower headline; one whose value is against what they
    have NOT shown is a CONTINGENCY, and a coach reads that row differently.
    """
    by_kind = {OBSERVED: 0.0, VARIANT: 0.0, INFERRED: 0.0}
    for m in row.get("matchups") or []:
        if m.get("winRate") is None:
            continue
        if float(m["winRate"]) >= 50.0:
            by_kind[m["evidence"]] = by_kind.get(m["evidence"], 0.0) + float(
                m.get("likelihood") or 0.0)

    obs, var, inf = by_kind[OBSERVED], by_kind[VARIANT], by_kind[INFERRED]
    if obs <= 0 and (inf > 0 or var > 0):
        return REC_CONTINGENCY
    if var > 0 and obs > 0:
        return REC_ROBUST
    return REC_COUNTER


# ── 4. Diversity — the portfolio, not the ranking ───────────────────────────


def diversify(rows, *, limit=MAX_RECOMMENDATIONS, minimum=MIN_RECOMMENDATIONS,
              score_key="recommendationScore", bonus=None, first=None):
    """Greedy maximal-marginal-relevance over the scored candidates.

    `score_key` AND `bonus` EXIST FOR `squad_plan` AND DEFAULT TO EXACTLY THE
    OLD BEHAVIOUR. The squad planner ranks a teammate's list on a PERSONAL
    score (the same figure plus what their own cards are worth) and rewards a
    pick for answering an archetype the list so far does not — `bonus(cand,
    chosen)`, in the same points as the score. The floor, the redundancy
    penalty and the archetype-repeat rule are this function's and are not
    duplicated there; a second portfolio picker would be two rules for one
    question that eventually disagree. `property_speedups_are_exact` pins the
    defaults against the reference implementation.

    `first` is a row (matched by `key`) that leads the list whatever its
    score — the #1 the squad assigned this teammate. The floor is still taken
    from the best score in the pool, not from `first`.

    THE PROBLEM THIS SOLVES IS THE ONE A LONGER LIST CREATES. Taking the top
    seven by score returns seven versions of whatever archetype happens to beat
    their core, which is strictly worse preparation than the top three were:
    the reader gains six rows and no new information, and the one deck that
    answers the thing they have not shown never makes the cut.

    Greedy rather than exhaustive: the pool is a few hundred and the selection
    is seven, so an optimal subset search is combinatorial for a result no
    reader could tell apart from this one.

    `minimum` IS NOT A QUOTA. If only three candidates clear `PORTFOLIO_DROP`,
    three come back. A list padded to five with decks nobody should prepare is
    the failure mode of promising a length instead of a standard.
    """
    # SHALLOW COPIES, because the same scored rows are handed to more than one
    # portfolio — a teammate's own list and the squad-wide one share dicts —
    # and this function writes `redundancy` and `adjustedScore` onto what it
    # returns. Mutating the caller's rows let whichever portfolio was built
    # LAST overwrite the figures the other one had published.
    pool = sorted((dict(r) for r in rows), key=lambda r: -r[score_key])
    if not pool:
        return []

    best = pool[0][score_key]
    if first is not None:
        lead = [r for r in pool if r["key"] == first["key"]]
        if lead:
            pool = lead + [r for r in pool if r["key"] != first["key"]]
    floor = best - PORTFOLIO_DROP

    chosen: list[dict] = [pool[0]]
    pool[0]["redundancy"] = 0.0
    pool[0]["adjustedScore"] = round(pool[0][score_key], 3)
    rest = pool[1:]

    # EACH CANDIDATE'S CLOSEST RESEMBLANCE TO THE LIST SO FAR, carried forward
    # and updated against the newest pick only. It was recomputed against the
    # whole chosen list on every round — O(n * k^2) similarity calls, 310,000
    # of them on a 12v12 board — for a maximum that can only ever grow by the
    # one deck just added. Same numbers: `max` does not care what order it saw
    # its arguments in, and `similarity` is symmetric.
    cards = {id(r): frozenset(r.get("cards") or []) for r in pool}
    top = pool[0]
    closest = {id(r): _pair_similarity(cards[id(r)], cards[id(top)],
                                       r.get("archetype"), top.get("archetype"))
               for r in rest}

    while rest and len(chosen) < limit:
        # How many of each archetype are already spoken for. Recomputed each
        # pass rather than carried, because the count is the penalty and a
        # stale one would charge the wrong slot.
        taken: dict[str, int] = {}
        for c in chosen:
            a = c.get("archetype") or ""
            taken[a] = taken.get(a, 0) + 1

        scored = []
        for cand in rest:
            sim = closest[id(cand)]
            repeat = taken.get(cand.get("archetype") or "", 0)
            penalty = REDUNDANCY_WEIGHT * sim + ARCHETYPE_REPEAT_PENALTY * repeat
            extra = bonus(cand, chosen) if bonus is not None else 0.0
            scored.append((cand[score_key] - penalty + extra, sim, cand))
        # `min`, not a full sort: only the first is used, and `min` returns the
        # first of equal keys exactly as a stable sort would put it first.
        adjusted, sim, pick = min(scored, key=lambda s: (-s[0], s[2]["key"]))

        # The floor is checked on the RAW score, not the adjusted one. A deck
        # that is genuinely good preparation should not be excluded for
        # resembling something already on the list — it should be ranked below
        # it, which is what the penalty already does.
        if pick[score_key] < floor and len(chosen) >= minimum:
            break

        pick["redundancy"] = round(sim, 3)
        pick["adjustedScore"] = round(adjusted, 3)
        chosen.append(pick)
        rest = [r for r in rest if r["key"] != pick["key"]]
        pc, pa = cards[id(pick)], pick.get("archetype")
        for r in rest:
            s = _pair_similarity(cards[id(r)], pc, r.get("archetype"), pa)
            if s > closest[id(r)]:
                closest[id(r)] = s

    return chosen


# ── 4b. Topping up a list that is too short to be a choice ──────────────────


def fills(existing, pool, need: int, *, min_overlap: int = SAME_DECK_OVERLAP):
    """Rows from `pool` to top up a short list, skipping what is already there.

    THIS IS `coach._fills`, AND THE PRECEDENT IS THE POINT. Coach Assist has
    shipped this since it was written: when a player's own history cannot fill
    the candidate list it tops up from the population, marks what it added, and
    keeps the reader's own decks ahead of the additions. It is the same problem
    one level up — a teammate with two qualifying decks gets a two-row board
    and a reason, which reads as the tool having nothing to say about them.

    IT RETURNS CANDIDATES, IT DOES NOT ORDER THEM. `existing` comes back
    untouched and this only ever returns additions; WHERE an addition lands is
    `suggest()`'s decision, which ranks the two together by strength the way
    `coach.suggest` does. (An earlier version appended fills below every owned
    deck and called that Coach Assist's rule. It was not — see `suggest`.)

    THE SKIP IS A HARD ONE, not a penalty. `diversify` grades similarity
    because it is choosing among options that all deserve to be there; this is
    choosing filler, and filler that is a near-copy of a real recommendation is
    the reader being shown the same deck twice with one of them labelled as a
    guess. Six shared cards IS the same deck (`SAME_DECK_OVERLAP`).
    """
    if need <= 0:
        return []
    # TWO DECKS SHARE `min_overlap` CARDS EXACTLY WHEN THEY SHARE A
    # `min_overlap`-CARD SUBSET, so "is this a near-copy of anything accepted
    # so far" is a set lookup over its 28 six-card subsets instead of an
    # intersection against every accepted deck. Same answer, including the
    # degenerate cases; at 12v12 the old form made 1.4M intersections a
    # request (measured, 2026-09-21).
    seen: set[frozenset] = set()
    for r in existing:
        seen.update(_subsets(frozenset(r.get("cards") or []), min_overlap))
    out = []
    for cand in pool:
        cards = frozenset(cand.get("cards") or [])
        if not cards:
            continue
        subs = _subsets(cards, min_overlap)
        if any(x in seen for x in subs):
            continue
        row = dict(cand)
        # THE MARK IS ON THE ROW, not inferred from a missing owner. A scouting
        # report's rows are ownerless too and are not fills; conflating them
        # would make "nobody plays this" and "nobody on YOUR SQUAD plays this"
        # the same sentence, and they are different claims.
        row["fill"] = True
        out.append(row)
        seen.update(subs)
        if len(out) >= need:
            break
    return out


@functools.lru_cache(maxsize=16384)
def _subsets(cards: frozenset, size: int) -> tuple[frozenset, ...]:
    """Every `size`-card subset of `cards`. Memoised: the fill pool is the same
    ~200 decks for every teammate of every folder in one request."""
    if size <= 0:
        return (frozenset(),)
    return tuple(frozenset(c) for c in itertools.combinations(sorted(cards), size))


def suggest(own, pool, *, limit: int = MAX_RECOMMENDATIONS):
    """WHAT DECKKIES SUGGESTS TO PLAY — their decks and the population's, ranked
    together by strength.

    THIS IS `coach.suggest`'S ACTUAL SORT, and an earlier version of this
    module misdescribed it. `coach.suggest` builds its list from the player's
    own legal decks, tops it up with population decks, and then sorts the whole
    list by expected win rate — so a population deck that beats the opponent
    by more DOES sit above one the player owns. This module first shipped the
    top-ups appended below every owned deck ("never ranked in") and said that
    was Coach Assist's rule. It was not, and on a live squad it put a player's
    own 60.0% deck above two 71.7% / 71.3% answers they could have been told
    about. The account holder asked for the stronger decks to lead.

    THE PLAYER'S OWN DECKS STILL HAVE AN EDGE, AND IT IS THE PRINCIPLED ONE.
    `score()` already adds `FIT_WEIGHT * playerFit` to a deck they pilot — up
    to 1.5 points — so between two decks inside the noise the one they know
    wins, and a population deck has to be genuinely better to pass it. That is
    a tiebreak sized to lose to any real matchup difference, which is exactly
    what the account holder asked for and exactly what Coach Assist does.

    NEAR-COPIES ARE STILL REFUSED (`fills`, six shared cards): a population
    list that is their own deck with one card swapped is their deck, and the
    version they already play is the one kept.
    """
    own = list(own or [])
    extra = fills(own, pool or [], need=len(pool or []))
    return diversify(own + extra, limit=limit, minimum=limit)


# ── 4b'. Counters — the list since 3.0 ──────────────────────────────────────

#: A deck is a COUNTER to a family at or above this rate against it. The
#: figure that names a row as the answer to something they play, and the floor
#: of the per-family lists (`answers`). Five points clear of level: under it a
#: fused rate's own interval usually reaches 50.
GOOD_RATE = 55.0

#: A deck expected to LOSE to what they play is never suggested. Before 3.0 a
#: row was listed at 40.9% because the duels rated it against the win condition
#: in general; whatever else is true of such a deck, it is not what to bring.
FLOOR_RATE = 50.0

#: Lists of ONE win condition on a list of seven. A cap, not a penalty: the
#: order stays the order of the figure printed, and the reader still gets more
#: than one kind of answer. Without it the seven best counters to a Log Bait
#: player were seven Royal Hogs lists a card or two apart.
PER_ARCHETYPE = 2

#: A family they play at least this much of the time gets a real answer on the
#: list — the best deck against IT, when one clears `GOOD_RATE` — even if the
#: strongest all-round decks do not beat it. "Whatever they play."
ANSWER_SHARE = 0.10

#: Counters listed per family by `answers`, and families it covers.
ANSWERS_PER_FAMILY = 3
ANSWER_FAMILIES = 5

#: A deck under `WORST_FLOOR` against ANY family they are likely to bring
#: (`WORST_SHARE` of the projection or more) has a HOLE, and is chosen as
#: though it were `HOLE_COST` points weaker. The deck that beats their main
#: list and folds to the one they switch to is the pick a switch punishes.
#: Measured with the wide read: the share of a list of seven under 50%
#: against what really came 6.2% -> 5.5%, the top three -0.04 points (inside
#: the noise). A cost and not a ban — passing every such deck over for any
#: deck without a hole measured the same, and would rank a 51% deck above a
#: 70% one in a small pool. Costs of 5, 8 and 12 measured no different.
WORST_FLOOR = 45.0
WORST_SHARE = 0.05
HOLE_COST = 3.0


def _rate(row) -> float:
    return float(row.get("expectedWinRate") or 0.0)


def worst_case(vs, plays, *, share=WORST_SHARE):
    """`{family, rate}` — the family they are likely to bring that a deck does
    WORST against, from its per-family rates. None when it was rated against
    none of them."""
    worst = None
    for p in plays or []:
        if float(p.get("share") or 0.0) < share:
            continue
        v = (vs or {}).get(p["family"])
        if v is None:
            continue
        if worst is None or v < worst["rate"]:
            worst = {"family": p["family"], "rate": v}
    return worst


def counters(rows, plays, *, limit=MAX_RECOMMENDATIONS,
             score_key="recommendationScore", first=None, adjust=None):
    """The decks to bring: the strongest counters to what they play.

    `rows` are scored candidates (`score()`'s rows — each is copied, nothing
    the caller holds is written). `plays` is `played_space()["plays"]`.

      1. STRONGEST FIRST, on `score_key` (plus `adjust(row)`, in the same
         points — the squad planner's cost for a deck a teammate already has).
      2. NO DECK EXPECTED TO LOSE (`FLOOR_RATE`), no near-copy of a deck
         already on the list (`SAME_DECK_OVERLAP`), at most `PER_ARCHETYPE`
         lists of one win condition. A deck with a HOLE (`WORST_FLOOR`
         against a family they are likely to bring) is chosen as though it
         were `HOLE_COST` points weaker.
      3. AN ANSWER FOR EVERY FAMILY THEY REALLY PLAY (`ANSWER_SHARE`). Where
         nothing on the list beats a family at `GOOD_RATE`, the best deck that
         does takes the place of the weakest row that is not itself the only
         answer to something. A specialist — 88% against the Royal Hogs they
         bring one game in ten, level against the rest — is exactly the deck a
         duel needs and a single weighted figure never shows.
      4. READ IN THE ORDER OF THE FIGURE PRINTED. Before 3.0 a list ran 66.8,
         43.8, 57.5, 63.3: pick order, with nothing on the screen to say why.

    `first` is a row (matched by `key`) that leads whatever its figure — the
    #1 a squad assigned this teammate. Each row comes back with `vs` (its rate
    against each family) and `answers` (the families it is the list's best
    counter to). Fewer than `limit` rows come back when fewer clear the floor;
    one row always does when anything was scored at all.
    """
    pool = []
    for r in rows or []:
        c = dict(r)
        if "vs" not in c:
            c["vs"] = vs_archetypes(c)
        c["_v"] = float(c.get(score_key) or 0.0) + (float(adjust(c)) if adjust else 0.0)
        c["worst"] = worst_case(c["vs"], plays)
        if c["worst"] is not None and c["worst"]["rate"] < WORST_FLOOR:
            c["_v"] -= HOLE_COST
        pool.append(c)
    if not pool:
        return []
    pool.sort(key=lambda r: (-r["_v"], r["key"]))

    chosen: list[dict] = []
    subs: set[frozenset] = set()
    count: dict[str, int] = {}

    def fits(r, skip=None) -> bool:
        """Whether `r` may join the list (ignoring the row `skip`, about to go)."""
        a = r.get("archetype") or ""
        n = count.get(a, 0) - (1 if skip is not None and (skip.get("archetype") or "") == a else 0)
        if n >= PER_ARCHETYPE:
            return False
        mine = _subsets(frozenset(r.get("cards") or []), SAME_DECK_OVERLAP)
        if skip is None:
            return not any(s in subs for s in mine)
        others: set[frozenset] = set()
        for c in chosen:
            if c is not skip:
                others.update(_subsets(frozenset(c.get("cards") or []), SAME_DECK_OVERLAP))
        return not any(s in others for s in mine)

    def take(r) -> None:
        chosen.append(r)
        subs.update(_subsets(frozenset(r.get("cards") or []), SAME_DECK_OVERLAP))
        a = r.get("archetype") or ""
        count[a] = count.get(a, 0) + 1

    def drop(r) -> None:
        chosen.remove(r)
        subs.clear()
        for c in chosen:
            subs.update(_subsets(frozenset(c.get("cards") or []), SAME_DECK_OVERLAP))
        a = r.get("archetype") or ""
        count[a] = count.get(a, 0) - 1

    lead = None
    if first is not None:
        lead = next((r for r in pool if r["key"] == first["key"]), None)
        if lead is not None:
            take(lead)

    for r in pool:
        if len(chosen) >= limit:
            break
        if r is lead or _rate(r) < FLOOR_RATE or not fits(r):
            continue
        take(r)
    if not chosen:
        # Nothing clears the floor. One row, at its own figure, says so better
        # than an empty board that reads as "no data".
        take(pool[0])

    main = [p["family"] for p in (plays or [])
            if float(p.get("share") or 0.0) >= ANSWER_SHARE]

    def best_on_list(fam):
        got = [c for c in chosen if c["vs"].get(fam) is not None]
        return max(got, key=lambda c: (c["vs"][fam], c["_v"])) if got else None

    protected: set[str] = set()
    for fam in main:
        held = best_on_list(fam)
        if held is not None and held["vs"][fam] >= GOOD_RATE:
            protected.add(held["key"])
            continue
        listed = {c["key"] for c in chosen}
        cands = [r for r in pool
                 if r["key"] not in listed and r["vs"].get(fam) is not None
                 and r["vs"][fam] >= GOOD_RATE and _rate(r) >= FLOOR_RATE]
        cands.sort(key=lambda r: (-r["vs"][fam], -r["_v"], r["key"]))
        for cand in cands:
            if len(chosen) < limit:
                if fits(cand):
                    take(cand)
                    protected.add(cand["key"])
                    break
                continue
            victims = [c for c in chosen
                       if c is not lead and c["key"] not in protected]
            if not victims:
                break
            victim = min(victims, key=lambda c: (c["_v"], c["key"]))
            if fits(cand, skip=victim):
                drop(victim)
                take(cand)
                protected.add(cand["key"])
                break

    for c in chosen:
        c["answers"] = []
    for fam in main:
        held = best_on_list(fam)
        if held is not None and held["vs"][fam] >= GOOD_RATE:
            held["answers"].append(fam)

    head = [lead] if lead is not None else []
    tail = [c for c in chosen if c is not lead]
    tail.sort(key=lambda r: (-_rate(r), -r["_v"], r["key"]))
    out = head + tail
    for c in out:
        del c["_v"]
    return out


def answers(rows, plays, *, per=ANSWERS_PER_FAMILY, families=ANSWER_FAMILIES):
    """The same rows read PER FAMILY: for each family they play, the decks
    with the best rate against it.

    One entry a family worth naming (`PLAYS_MIN_SHARE`), most played first, at
    most `families` of them: the `plays` row plus `decks`, each a copy of a
    scored row carrying `rate` (its rate against THIS family) beside its
    figure against everything they play. Only counters are listed
    (`GOOD_RATE`); a family nothing beats comes back with an empty list, which
    is a real answer and the screen says it. Near-copies are folded and one
    win condition appears at most `PER_ARCHETYPE` times, as on `counters`.
    """
    scored = []
    for r in rows or []:
        c = dict(r)
        if "vs" not in c:
            c["vs"] = vs_archetypes(c)
        scored.append(c)
    out = []
    named = [p for p in (plays or [])
             if float(p.get("share") or 0.0) >= PLAYS_MIN_SHARE][:families]
    for p in named:
        fam = p["family"]
        cands = [r for r in scored
                 if r["vs"].get(fam) is not None and r["vs"][fam] >= GOOD_RATE]
        cands.sort(key=lambda r: (-r["vs"][fam],
                                  -float(r.get("recommendationScore") or 0.0), r["key"]))
        picked: list[dict] = []
        subs: set[frozenset] = set()
        count: dict[str, int] = {}
        for r in cands:
            if len(picked) >= per:
                break
            a = r.get("archetype") or ""
            if count.get(a, 0) >= PER_ARCHETYPE:
                continue
            mine = _subsets(frozenset(r.get("cards") or []), SAME_DECK_OVERLAP)
            if any(s in subs for s in mine):
                continue
            row = dict(r)
            row["rate"] = r["vs"][fam]
            picked.append(row)
            subs.update(mine)
            count[a] = count.get(a, 0) + 1
        out.append({**p, "decks": picked})
    return out


# ── 4c. The squad — who brings what ─────────────────────────────────────────
#
# `suggest()` ANSWERS ONE TEAMMATE AT A TIME, AND THAT IS WHY A MATCH PLAN READ
# THE SAME FOR EVERYBODY. The population half of every teammate's list is the
# SAME scored pool — "what beats this opponent" does not depend on who asks —
# and a player's own decks win at most `FIT_WEIGHT` (1.5 points) against it.
# Measured on a live 5v1 (2026-09-25): all five teammates got the same #1 deck,
# two got byte-identical lists, and 35 slots held 12 distinct decks. A lineup
# cannot be chosen from five copies of one answer.
#
# THE FIX IS TO ASK THE SQUAD'S QUESTION, NOT TO WEIGHT THE PLAYER'S ONE HARDER.
# `coach_daily` already learned that a bigger familiarity weight only ranks
# worse decks above better ones on a weak signal. Three rules instead:
#
#   1. A BAND, NOT A RE-RANKING. A teammate's #1 is chosen from the decks
#      within `PRIMARY_BAND` points of the best they could be shown. Nobody is
#      handed a clearly worse deck so the board looks personal; inside the
#      band the matchup figures cannot tell the options apart, so something
#      else may decide.
#   2. WHAT DECIDES INSIDE IT IS THE SQUAD. #1 picks are assigned greedily,
#      each one worth what it ADDS to the squad's answers — archetype by
#      archetype, weighted by how likely the opponent is to bring it — plus
#      what the teammate's own cards are worth. Two teammates share a #1 only
#      when one has nothing else in the band.
#   3. THE REST OF EACH LIST IS STILL `diversify`, on the personal score, with
#      a bonus for answering an archetype the list does not yet answer and a
#      cost for a deck already assigned to somebody else.

#: A card count at which a candidate is "built out of your cards". Five of
#: eight, the figure `coach_daily.KNOWN_MIN` settled on after measuring that
#: deck-level overlap is too sparse to reach most candidates. Restated rather
#: than imported because this module has no imports; the two must agree.
KNOWN_MIN = 5

#: Points a candidate is worth for being built out of cards the teammate
#: plays: zero below `KNOWN_MIN`, `KNOWN_WEIGHT` at all eight. The same bound
#: as `FIT_WEIGHT` and for the same reason — it is a tiebreak inside the noise,
#: never a reason to prefer a deck several points worse.
KNOWN_WEIGHT = FIT_WEIGHT

#: How far below the best available a teammate's #1 may sit. Matchup rates
#: here are likelihood-weighted means of per-archetype records whose own
#: intervals run several points wide; three points is inside that and well
#: inside `PORTFOLIO_DROP`, so the band only ever chooses between options the
#: evidence cannot rank.
PRIMARY_BAND = 3.0

#: A win rate at or above which an archetype counts as ANSWERED. Coverage
#: gain is measured from here, so a deck that loses to an archetype adds
#: nothing for it however many points it improves on a worse loss.
ANSWERED = 50.0

#: Points of personal score per point of likelihood-weighted coverage added.
#: One: both are win-rate points, so the conversion is the identity.
COVER_WEIGHT = 1.0

#: Cost, in the tail of a teammate's list, of a deck already assigned as
#: somebody else's #1. The archetype-repeat penalty's size: enough to prefer a
#: different answer of similar strength, not enough to hide a clearly better
#: one.
TAKEN_PENALTY = ARCHETYPE_REPEAT_PENALTY

#: Cost, in the tail of a list, of each teammate EARLIER IN THE ROSTER who
#: already lists the deck, capped at `TAKEN_PENALTY`. The #1s alone left two
#: teammates sharing 4.7 of 7 decks on live squads — below the #1 everybody
#: drew on the same population ranking. The cap keeps it a spread rule: it
#: can move a backup a couple of points down, never swap in a bad one.
SHARED_PENALTY = 1.0


def archetype_weights(threats) -> dict[str, float]:
    """`{archetype: likelihood}` over the projection, summed per archetype.

    Coverage is counted per ARCHETYPE, not per threat deck: three Giant
    variants are one question for a coach ("have we got a Giant answer"), and
    counting them three times would let one archetype crowd out the rest.
    """
    out: dict[str, float] = {}
    for t in threats or []:
        # The FAMILY when the projection names one (`played_space`), so the
        # decks the bot files under `other` are counted as what they are.
        a = family_of(t)
        if a:
            out[a] = out.get(a, 0.0) + float(t.get("likelihood") or 0.0)
    return out


def vs_archetypes(row) -> dict[str, float]:
    """A scored row's win rate against each archetype of the projection.

    Likelihood-weighted over the threats of that archetype that were actually
    measured. An archetype with no measured threat is ABSENT, not 50 — the
    rule `score()` applies to the whole row, applied one level down.
    """
    num: dict[str, float] = {}
    den: dict[str, float] = {}
    for m in row.get("matchups") or []:
        if m.get("winRate") is None:
            continue
        a = family_of(m)
        like = float(m.get("likelihood") or 0.0)
        if not a or like <= 0:
            continue
        num[a] = num.get(a, 0.0) + like * float(m["winRate"])
        den[a] = den.get(a, 0.0) + like
    return {a: round(num[a] / den[a], 1) for a in num if den[a] > 0}


def known_cards(cards, pool) -> int:
    """How many of a deck's cards the teammate plays in a deck of their own."""
    return len(set(cards or []) & set(pool or ()))


def _known_bonus(n: int) -> float:
    """0 below `KNOWN_MIN`, rising linearly to `KNOWN_WEIGHT` at eight."""
    span = 8 - (KNOWN_MIN - 1)
    return KNOWN_WEIGHT * max(0.0, min(1.0, (n - (KNOWN_MIN - 1)) / span))


def cover_gain(vs: dict, have: dict, weight: dict) -> float:
    """Likelihood-weighted points a deck adds over the answers already held.

    Measured from `ANSWERED` where nothing is held yet, and only where the
    deck is BETTER — `coach_daily.coverage_gain`'s rule, so a deck mediocre
    everywhere cannot look useful by averaging.
    """
    gain = 0.0
    for a, rate in vs.items():
        w = weight.get(a, 0.0)
        if w <= 0:
            continue
        d = rate - max(have.get(a, ANSWERED), ANSWERED)
        if d > 0:
            gain += w * d
    return gain


def _held(rows) -> dict[str, float]:
    """The best rate held against each archetype across `rows`."""
    have: dict[str, float] = {}
    for r in rows:
        for a, rate in (r.get("vs") or {}).items():
            if rate > have.get(a, -1.0):
                have[a] = rate
    return have


def squad_plan(players, pool, threats, *, limit: int = MAX_RECOMMENDATIONS):
    """Every teammate's list against ONE opponent, chosen as a squad.

    `players` is `[{"tag", "own": [scored rows], "cards": set}]` in roster
    order — `cards` being every card in a deck they actually play. `pool` is
    the population, scored against the same `threats`, shared by all.

    Returns `(lists, cover)`: `lists[tag]` is that teammate's ranked list
    (copies — nothing the caller holds is written), `cover` is one row per
    archetype of the projection saying which #1 answers it best. A teammate
    with nothing scored gets an empty list, and the caller says why.
    """
    weight = archetype_weights(threats)
    # What they play, as `counters` reads it: one row a family.
    plays = [{"family": a, "share": w}
             for a, w in sorted(weight.items(), key=lambda kv: (-kv[1], kv[0]))]

    # ── Each teammate's candidates, scored for THEM ──────────────────────
    cand: dict[str, list[dict]] = {}
    for p in players:
        own = list(p.get("own") or [])
        rows = []
        for r in own + fills(own, pool or [], need=len(pool or [])):
            c = dict(r)
            c["vs"] = vs_archetypes(c)
            c["known"] = 8 if c.get("owner") else known_cards(
                c.get("cards"), p.get("cards"))
            c["personalScore"] = round(
                float(c["recommendationScore"]) + _known_bonus(c["known"]), 3)
            rows.append(c)
        cand[p["tag"]] = rows

    # ── #1 picks, assigned as a squad ────────────────────────────────────
    eligible: dict[str, list[dict]] = {}
    for tag, rows in cand.items():
        if rows:
            top = max(r["recommendationScore"] for r in rows)
            eligible[tag] = [r for r in rows
                             if r["recommendationScore"] >= top - PRIMARY_BAND]

    order = {p["tag"]: i for i, p in enumerate(players)}
    primary: dict[str, dict] = {}
    have: dict[str, float] = {}
    taken: set[str] = set()
    waiting = [t for t in order if t in eligible]
    while waiting:
        best = None
        for tag in waiting:
            fresh = [r for r in eligible[tag] if r["key"] not in taken]
            for r in (fresh or eligible[tag]):
                # NO COVERAGE TERM FOR THE FIRST #1. With nothing held, "what
                # it adds" is its whole edge over 50% on every archetype — the
                # matchup figure counted a second time — and a test caught it
                # outvoting a teammate's own deck. Coverage is a question
                # about what the squad already has, so it waits for an answer.
                value = r["personalScore"] + (COVER_WEIGHT * cover_gain(
                    r["vs"], have, weight) if have else 0.0)
                # Highest value, then the stronger deck, then roster order
                # and the key — deterministic, so a board reloads the same.
                k = (-value, -r["recommendationScore"], order[tag], r["key"])
                if best is None or k < best[0]:
                    best = (k, tag, r)
        _, tag, r = best
        primary[tag] = r
        taken.add(r["key"])
        for a, rate in r["vs"].items():
            if rate > have.get(a, -1.0):
                have[a] = rate
        waiting.remove(tag)

    # ── The rest of each list ────────────────────────────────────────────
    lists: dict[str, list[dict]] = {}
    listed: dict[str, int] = {}
    for p in players:
        tag = p["tag"]
        rows = cand.get(tag) or []
        if not rows:
            lists[tag] = []
            continue
        mine = primary[tag]
        others = {r["key"] for t, r in primary.items() if t != tag}

        def cost(c, _others=others):
            # A deck that is somebody else's #1, or that teammates earlier in
            # the roster already list, gives way to a comparable other one.
            if c["key"] in _others:
                return -TAKEN_PENALTY
            return -min(TAKEN_PENALTY, SHARED_PENALTY * listed.get(c["key"], 0))

        # THE REST OF THE LIST IS COUNTERS TOO (3.0): the strongest decks
        # against what this opponent plays, an answer for every family they
        # play, in the order of the figure printed. It was a portfolio
        # (`diversify`), whose archetype-repeat penalty filled the tail with
        # one deck of each of several archetypes at 60% while stronger answers
        # to what they actually bring were left out.
        picked = counters(rows, plays, limit=limit, score_key="personalScore",
                          first=mine, adjust=cost)
        head = picked[0]
        head["squadPick"] = True
        lists[tag] = picked
        for r in lists[tag]:
            listed[r["key"]] = listed.get(r["key"], 0) + 1

    # ── Which #1 answers each archetype ──────────────────────────────────
    cover = []
    for a, w in sorted(weight.items(), key=lambda kv: (-kv[1], kv[0])):
        best = None
        for tag in order:
            r = primary.get(tag)
            if r is None or a not in r["vs"]:
                continue
            if best is None or r["vs"][a] > best[1]["vs"][a]:
                best = (tag, r)
        cover.append({
            "archetype": a,
            "likelihood": round(w, 4),
            "tag": best[0] if best else None,
            "deck": best[1].get("name") if best else None,
            "winRate": best[1]["vs"][a] if best else None,
            "answered": bool(best and best[1]["vs"][a] >= ANSWERED),
        })
    for c in cover:
        if c["tag"] and c["answered"]:
            lists[c["tag"]][0].setdefault("covers", []).append(c["archetype"])
    return lists, cover


# ── 5. Saying why, from the evidence and nothing else ───────────────────────


def explain(row, threats) -> str:
    """A coach's sentence for one recommendation, assembled from real fields.

    EVERY CLAUSE IS READ OFF A NUMBER THAT IS IN THE PAYLOAD. Nothing here
    describes a tendency the data did not measure, which is the rule the Coach
    already follows — this project measured counter-sniping on 3,569 leak-free
    trials and found narrating an invented tendency made top-1 accuracy three
    times worse. The sentence names evidence; it does not tell a story.
    """
    kind = row.get("type") or classify(row, threats)
    beaten = [m for m in (row.get("matchups") or [])
              if m.get("winRate") is not None and float(m["winRate"]) >= 50.0]
    beaten.sort(key=lambda m: -float(m.get("likelihood") or 0))

    lead = beaten[0] if beaten else None
    name = (lead or {}).get("name") or (lead or {}).get("archetype") or ""

    if kind == REC_ROBUST:
        head = (f"Holds up against {name} and the close variants of it"
                if name else "Holds up across their likely pool")
    elif kind == REC_CONTINGENCY:
        head = (f"Not something they have shown, but answers {name}"
                if name else "Cover for what they have not shown yet")
    else:
        head = (f"Answers {name}, which is most of what they play"
                if name else "Answers their observed core")

    cover = round(100 * float(row.get("threatCovered") or 0))
    tail = f"measured against {cover}% of their projected pool"

    fit = row.get("playerFit")
    if fit is not None and fit > 0:
        tail += "; a deck they already pilot"

    conf = row.get("confidence")
    if conf in (POSSIBLE, SPECULATIVE):
        tail += "; thin evidence"

    return f"{head} — {tail}."
