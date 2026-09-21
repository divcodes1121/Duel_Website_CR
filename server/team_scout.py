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
"""

from __future__ import annotations

import math

#: The brain that produced a recommendation. Written onto every payload and
#: frozen into `coach_match_plans.engine`, so a plan made today can still be
#: told apart from one made by the old scorer when phase 7's results are read
#: back. Bump the MINOR for a weight change, the MAJOR for a shape change.
BRAIN_VERSION = "team-scout-2.0"

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
    sa, sb = set(a or []), set(b or [])
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


# ── 3. Scoring one of OUR decks against the projection ──────────────────────


def score(rate_for, threats, *, cards, archetype, fit_games=None) -> dict | None:
    """One candidate deck against the whole projected threat space.

    `rate_for(archetype) -> {winRate, source, games, ...} | None` is
    `deck_counter.matchup_ladder`'s answer, handed in rather than imported —
    the caller owns the database and this module owns the arithmetic.

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

    for t in threats:
        m = rate_for(t["archetype"])
        like = float(t.get("likelihood") or 0.0)
        if not m or m.get("winRate") is None:
            rows.append({
                "threat": t["key"], "archetype": t["archetype"],
                "name": t.get("name") or "", "evidence": t["evidence"],
                "likelihood": like, "winRate": None, "source": None,
                "games": 0, "tier": None,
            })
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
        "matchups": rows,
        "confidence": _rec_confidence(strength, answered),
        "brain": BRAIN_VERSION,
    }


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


def diversify(rows, *, limit=MAX_RECOMMENDATIONS, minimum=MIN_RECOMMENDATIONS):
    """Greedy maximal-marginal-relevance over the scored candidates.

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
    pool = sorted((dict(r) for r in rows), key=lambda r: -r["recommendationScore"])
    if not pool:
        return []

    best = pool[0]["recommendationScore"]
    floor = best - PORTFOLIO_DROP

    chosen: list[dict] = [pool[0]]
    pool[0]["redundancy"] = 0.0
    pool[0]["adjustedScore"] = round(pool[0]["recommendationScore"], 3)
    rest = pool[1:]

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
            sim = max(
                similarity(cand["cards"], c["cards"],
                           cand.get("archetype"), c.get("archetype"))
                for c in chosen
            )
            repeat = taken.get(cand.get("archetype") or "", 0)
            penalty = REDUNDANCY_WEIGHT * sim + ARCHETYPE_REPEAT_PENALTY * repeat
            scored.append((cand["recommendationScore"] - penalty, sim, cand))
        scored.sort(key=lambda s: (-s[0], s[2]["key"]))
        adjusted, sim, pick = scored[0]

        # The floor is checked on the RAW score, not the adjusted one. A deck
        # that is genuinely good preparation should not be excluded for
        # resembling something already on the list — it should be ranked below
        # it, which is what the penalty already does.
        if pick["recommendationScore"] < floor and len(chosen) >= minimum:
            break

        pick["redundancy"] = round(sim, 3)
        pick["adjustedScore"] = round(adjusted, 3)
        chosen.append(pick)
        rest = [r for r in rest if r["key"] != pick["key"]]

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
    seen = [set(r.get("cards") or []) for r in existing]
    out = []
    for cand in pool:
        cards = set(cand.get("cards") or [])
        if not cards:
            continue
        if any(len(cards & s) >= min_overlap for s in seen):
            continue
        row = dict(cand)
        # THE MARK IS ON THE ROW, not inferred from a missing owner. A scouting
        # report's rows are ownerless too and are not fills; conflating them
        # would make "nobody plays this" and "nobody on YOUR SQUAD plays this"
        # the same sentence, and they are different claims.
        row["fill"] = True
        out.append(row)
        seen.append(cards)
        if len(out) >= need:
            break
    return out


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
