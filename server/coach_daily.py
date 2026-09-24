"""WHAT TO PLAY, WITH NO OPPONENT — a plan against the field.

Every "what to play" on this site until now has needed an opponent tag, because
the one thing that builds a threat projection — `team_scout.threat_space()` —
builds it from ONE player's observed decks. A coach asking "what should this
player practise tomorrow" has no opponent to name.

── THE WHOLE MODULE RESTS ON ONE FACT ABOUT `team_scout` ───────────────────

    def score(rate_for, threats, *, cards, archetype, fit_games=None)

**The threat space is an injected parameter.** `score()` does not know or care
where the projection came from; it reads `archetype`, `likelihood`, `key`,
`name` and `evidence` off each entry and asks the caller's `rate_for` how the
candidate does against it. So a projection built from the META BOARD gets the
same tested arithmetic — the four separated signals, the coverage penalty, the
evidence weighting, `diversify()`'s archetype-repeat rule — with no second
scorer and no model. **Nothing here trains or calls anything. The OIE stays
frozen and uncalled; this is counted evidence and a weighted average.**

── THE COACHING PART IS THE REWEIGHTING, AND IT IS THE ONLY NEW ARITHMETIC ──

A pure meta answer tells every player the same thing, which is what a tier list
already does. What makes this a plan for ONE player is that the field is
reweighted by where THEY actually lose: if Goblin Drill is 3% of the meta but
they win 22% against it, it is worth more of their preparation than its
population share alone says.

Three rules keep that honest:

  1. **A DEFICIT IS ONLY REAL ABOVE A FLOOR.** Under `MIN_FACED` battles an
     archetype gets no adjustment at all — not a small one. This is the same
     floor the dashboard's matchup cards use, so the two cannot disagree about
     what counts as a weakness.
  2. **THE BOOST IS BOUNDED.** `MAX_BOOST` caps it, or a single catastrophic
     matchup over twelve battles would swallow the projection and the plan
     would stop being about the field at all.
  3. **A STRENGTH IS NEVER DOWN-WEIGHTED.** A deck they beat is still a deck
     they will meet. Boosting the weak ones already moves the relative mass;
     suppressing the strong ones would hide real opponents.

With no history at all the plan is the pure field answer and `basis` says so,
rather than silently pretending the weighting happened.

── HOW MUCH OF A PLAN IS ACTUALLY ABOUT THE PLAYER: MEASURED, NOT CLAIMED ───

Measured across the five real players on the live roster: every plan returns
seven picks, any two of them share FOUR TO SIX, and all five plans together
draw on only ELEVEN distinct decks. Against a given field a handful of decks
really are the best answers, and that is mostly player-independent — the
weighting moves the order and swaps a few entries at the margin.

That is a true and useful answer, and a screen headed "weighted by seven
matchups" could easily be read as promising five different plans for five
players. So the plan SCORES THE UNWEIGHTED PROJECTION TOO and reports
`tailoredPicks` — how many of the picks the weighting actually put there —
with `fromWeighting` on each row. It costs one more pass over a pool that does
no database work, and it turns a rhetorical claim into a number the reader can
check. When it is 0 the screen can say so plainly.
"""

from __future__ import annotations

import datetime as _dt
import math
import traceback

import clash_data as cd
import coach_intel
import deck_counter as dcx
import meta as meta_board
import team_analysis as ta
import team_scout as ts

#: How many meta decks become threats. `team_scout.MAX_THREATS`, deliberately:
#: it is a cost bound on `score()`, which walks every threat for every
#: candidate, and two different caps would make the two paths cost differently
#: for no stated reason.
MAX_THREATS = ts.MAX_THREATS

#: Battles behind an archetype before the player's record against it moves
#: anything. `state/coachDashboard.DASH.matchupBattles` on the client.
MIN_FACED = 10

#: The most a single weakness may multiply a threat's likelihood by.
MAX_BOOST = 2.0

#: Days of meta history the projection asks for.
TREND_DAYS = 7

#: THE SMALLEST REAL SPAN THAT MAY MOVE ANYTHING. The board recomputes every
#: half hour and a one-day delta is mostly that churn — measured live the day
#: after the history started, sixteen of fifty decks had "moved" a rank or two
#: overnight. Under this many days apart the trend is reported and applied to
#: NOTHING, which is the same rule every other floor here follows: below the
#: floor, say nothing rather than say a little.
TREND_MIN_DAYS = 3

#: The most a trend may multiply a threat's likelihood by, and its reciprocal
#: is the most it may divide one. Bounded for the reason MAX_BOOST is: a
#: projection is about what they will MEET, and a deck cannot become the whole
#: field in a week.
TREND_MAX = 1.25

#: Relative change in use rate below which nothing moves. A deck at 0.30% that
#: gains 0.01pp has not risen; it has wobbled.
TREND_FLOOR = 0.15

#: Slots in the projection reserved for archetypes this player measurably
#: loses to but the field's most-played decks do not cover.
#:
#: THIS EXISTS BECAUSE THE FIRST VERSION SHIPPED WITHOUT IT AND THE LIVE ANSWER
#: EXPOSED IT. One roster player's worst matchup by a distance was Goblin Drill
#: — 22.2% over 18 battles, 38.1 points below their own rate — and NO Goblin
#: Drill deck is in the meta's top twelve by use rate, so their single biggest
#: weakness was absent from the projection entirely and the boost had nothing
#: to act on. A plan weighted by weaknesses that cannot represent the weakness
#: is a plan about the field wearing a coaching label.
PRIORITY_SLOTS = 3

#: Recommendations returned. `team_scout`'s own window.
MIN_PICKS = ts.MIN_RECOMMENDATIONS
MAX_PICKS = ts.MAX_RECOMMENDATIONS

BRAIN = "coach-daily-1.0"


def field_threats(board: dict, limit: int = MAX_THREATS,
                  priority: list[str] | None = None) -> list[dict]:
    """The meta board as a threat projection, in `team_scout`'s own shape.

    EVIDENCE IS `OBSERVED`, AND THAT IS NOT A LIBERTY. Every entry is a real
    eight-card list that real players really played, with a real battle count —
    it is observed by the population rather than by one opponent, and since
    this mode has no opponent at all there is nothing for that to be confused
    with. `observedCount` carries the population's battles, so
    `_threat_confidence` reports `known`, which is true of a top-fifty deck.

    `priority` is the archetypes this player loses to, worst first. Up to
    `PRIORITY_SLOTS` of them are admitted even when they sit below the use-rate
    cut — see the constant for the live answer that made this necessary. They
    are REAL META DECKS, drawn from the same board as everything else; nothing
    is generated, and their likelihood is still their own use rate, so a rare
    deck stays rare and it is the BOOST that says it matters here.

    RENORMALISED ONLY AFTER THE CAP, `threat_space`'s rule: the cap is a cost
    bound and drops nothing for being weak, so the mass it removes genuinely
    belongs to what remains.
    """
    decks = [d for d in (board.get("decks") or []) if d.get("cards") and d.get("deckHash")]
    if board.get("building") or not decks:
        return []

    by_use = sorted(decks, key=lambda d: -float(d.get("useRate") or 0.0))
    natural = by_use[:limit]
    covered = {d.get("winCondition") or "other" for d in natural}

    reserved = []
    for arch in (priority or []):
        if len(reserved) >= PRIORITY_SLOTS or len(reserved) >= limit:
            break
        if arch in covered:
            continue
        best = next((d for d in by_use if (d.get("winCondition") or "other") == arch), None)
        if best is not None:
            reserved.append(best)
            covered.add(arch)

    # The reserved decks take slots from the BOTTOM of the natural cut, so the
    # projection stays the same size and the most-played are never displaced.
    rows = (natural[:limit - len(reserved)] + reserved) if reserved else natural
    total = sum(float(d.get("useRate") or 0.0) for d in rows)
    if total <= 0:
        return []

    out = []
    for d in rows:
        out.append({
            "key": ts.deck_key(d.get("cards")),
            # THE JOIN KEY FOR TRENDS. `key` is the sorted card list and the
            # meta history is keyed by the board's own `deckHash`; they are
            # different identifiers and only this one matches.
            "deckHash": d.get("deckHash"),
            "cards": list(d["cards"]),
            "art": d.get("art") or {},
            "archetype": d.get("winCondition") or "other",
            "name": d.get("name") or "",
            "evidence": ts.OBSERVED,
            "observedCount": int(d.get("battles") or 0),
            "wins": int(d.get("wins") or 0),
            "winRate": d.get("winRate"),
            "lastSeen": d.get("lastSeen"),
            "similarityToObserved": 1.0,
            "basis": "meta",
            "useRate": d.get("useRate"),
            "players": d.get("players"),
            "likelihood": round(float(d.get("useRate") or 0.0) / total, 4),
        })
    for t in out:
        t["confidence"] = ts._threat_confidence(t)
    return out


def deficits(faced: list[dict], overall: float) -> dict[str, dict]:
    """`archetype -> {battles, winRate, deficit}` for archetypes past the floor.

    `faced` is `coach_intel.report()['opponentArchetypes']` — OWN-DECK 1v1
    only, which is the one population every figure on the Coach Roster counts.
    `/api/analytics/counter/<tag>` answers a similar question and has NO MODE
    FILTER at all (measured: 872 battles where coach_intel reports 710), so it
    is deliberately not read here.
    """
    out: dict[str, dict] = {}
    for a in faced or []:
        n = int(a.get("battles") or 0)
        if n < MIN_FACED:
            continue
        rate = 100.0 * int(a.get("wins") or 0) / n
        out[a.get("key") or a.get("name") or ""] = {
            "archetype": a.get("key") or "",
            "name": a.get("name") or "",
            "battles": n,
            "winRate": round(rate, 1),
            # POSITIVE MEANS THEY ARE WORSE HERE than they usually are.
            "deficit": round(overall - rate, 1),
        }
    return out


def weight_threats(threats: list[dict], defs: dict[str, dict]) -> list[dict]:
    """Move mass toward what this player actually loses to.

    Returns a NEW list; the input is not mutated, because the unweighted
    projection is reported beside the weighted one and the caller must be able
    to show both.
    """
    if not threats:
        return []
    # THE SHAPE MUST NOT DEPEND ON WHETHER THE WEIGHTING RAN. The early return
    # used to copy the rows untouched, so `boost` and `playerRecord` were
    # ABSENT for a player with no history and present for everyone else — a
    # client reading `t.boost` would have got `undefined` on exactly the
    # accounts the empty state is for. Every row carries both, always.
    if not defs:
        return [dict(t, boost=1.0, playerRecord=None) for t in threats]

    out = []
    for t in threats:
        d = defs.get(t["archetype"])
        boost = 1.0
        if d and d["deficit"] > 0:
            # Bounded, and never a suppression: see rules 2 and 3 above.
            boost = min(MAX_BOOST, 1.0 + d["deficit"] / 100.0)
        row = dict(t)
        row["_w"] = float(t["likelihood"]) * boost
        row["boost"] = round(boost, 3)
        row["playerRecord"] = (
            {"battles": d["battles"], "winRate": d["winRate"], "deficit": d["deficit"]} if d else None
        )
        out.append(row)

    total = sum(r["_w"] for r in out) or 1.0
    for r in out:
        r["likelihood"] = round(r["_w"] / total, 4)
        del r["_w"]
    out.sort(key=lambda r: (-r["likelihood"], r["name"]))
    return out


def trend_threats(threats: list[dict], move: dict | None) -> tuple[list[dict], dict]:
    """Move mass toward what the field is TAKING UP, away from what it is dropping.

    The population share in the board is what people played over the window
    that ended when it was computed. A deck climbing through that window will
    be commoner than its share says by the time this player next queues, and
    one being abandoned will be rarer. That is the only forward-looking thing
    in this module, and it is measured movement rather than a forecast.

    IT REFUSES TO ACT ON A SHORT SPAN. `meta_history` stores one reading a day
    and the board itself recomputes every half hour, so a one-day delta is
    mostly that churn — measured the morning after the history began, sixteen
    of fifty decks had shifted a rank overnight. Under `TREND_MIN_DAYS` the
    trend is REPORTED and applied to nothing.

    A DECK THAT WAS NOT ON THE OLDER BOARD IS NOT A RISER. `meta_history`
    already marks it `entered` with a null delta, because the board is a top
    fifty and arriving at rank 40 is not a climb from 51 — it is merely where
    the board stopped. Such a row is left alone here rather than treated as
    infinite growth.

    Returns the adjusted threats and a report of what it did, so a screen can
    say "this is weighted toward what is rising" only when it actually is.
    """
    state = {
        "basis": (move or {}).get("basis") or "none",
        "daysApart": (move or {}).get("daysApart"),
        "applied": False,
        "reason": None,
        "moved": 0,
    }
    if not threats:
        return [], state
    if not move or move.get("basis") != "measured":
        state["reason"] = (move or {}).get("reason") or "no meta history yet"
        return [dict(t, trend=None) for t in threats], state

    apart = int(move.get("daysApart") or 0)
    if apart < TREND_MIN_DAYS:
        state["reason"] = (
            f"only {apart} day(s) between readings; under {TREND_MIN_DAYS} that is "
            "the board's own churn, not a trend"
        )
        return [dict(t, trend=None) for t in threats], state

    by_hash = {r.get("deckHash"): r for r in (move.get("rows") or [])}
    out = []
    moved = 0
    for t in threats:
        row = by_hash.get(t.get("deckHash"))
        factor = 1.0
        trend = None
        prev = (row or {}).get("previousUseRate")
        delta = (row or {}).get("useDelta")
        # `entered` rows carry a null delta by design; so do departures.
        if row and delta is not None and prev:
            rel = delta / prev
            if abs(rel) >= TREND_FLOOR:
                factor = max(1.0 / TREND_MAX, min(TREND_MAX, 1.0 + rel))
                moved += 1
            trend = {
                "rankDelta": row.get("rankDelta"),
                "useDelta": round(delta, 3),
                "relative": round(rel, 3),
                "factor": round(factor, 3),
            }
        r = dict(t)
        r["trend"] = trend
        r["_t"] = float(t["likelihood"]) * factor
        out.append(r)

    total = sum(r["_t"] for r in out) or 1.0
    for r in out:
        r["likelihood"] = round(r["_t"] / total, 4)
        del r["_t"]
    out.sort(key=lambda r: (-r["likelihood"], r["name"]))
    state.update(applied=True, moved=moved)
    return out, state


def _overall(summary: dict) -> float:
    n = int(summary.get("battles") or 0)
    return 100.0 * int(summary.get("wins") or 0) / n if n else 0.0


def plan(tag: str, since: str | None = None, until: str | None = None,
         limit: int = MAX_PICKS, brief: bool = False,
         compare: bool = False) -> dict:
    """One player's plan against the field.

    `brief` trims the payload for a ROSTER-WIDE read, where one row per player
    is drawn and the full projection is not: the threats keep their names and
    likelihoods but lose their card lists and art, only the top pick keeps its
    cards, and `baselinePicks` is dropped. Measured on the live roster, five
    full plans are 195 kB and five brief ones are a fraction of it. **It is a
    projection of the same answer, not a cheaper one** — nothing is recomputed
    differently, so a brief row can never disagree with the full screen.

    `compare` adds the progress pass -- the same window measured against the
    one before it. It is OPT-IN because it costs a second `coach_intel` read,
    and the roster-wide call fetches one plan per player: five players would
    pay for ten battle passes to draw a screen that shows one figure each.

    NO DATABASE WORK PER CANDIDATE. The pool is `team_analysis._scout_candidates()`
    — ~200 real lists out of the background snapshot's seeds, each carrying its
    own per-archetype record — so scoring two hundred decks against twelve
    threats costs no query at all. The only reads are the player's own battles
    (one pass, `coach_intel`) and the meta snapshot, which is already computed.
    """
    board = meta_board.board()
    # THE DEFICITS ARE NEEDED BEFORE THE PROJECTION, not after it: they decide
    # which archetypes get a reserved slot, and a weakness the projection
    # cannot represent is one the boost can never act on.
    try:
        intel = coach_intel.report(tag, since, until)
    except Exception:
        intel = None
    summary = (intel or {}).get("summary") or {}
    overall = _overall(summary)
    defs = deficits((intel or {}).get("opponentArchetypes") or [], overall) if summary.get("battles") else {}
    worst = [d["archetype"] for d in sorted(defs.values(), key=lambda x: -x["deficit"]) if d["deficit"] > 0]

    raw = field_threats(board, priority=worst)
    if not raw:
        return {
            "tag": tag, "brain": BRAIN, "basis": "none",
            "reason": "building" if board.get("building") else "no_meta",
            "threats": [], "recommendations": [],
            "window": {"from": since, "to": until},
            # THE SHAPE MUST NOT DEPEND ON WHICH BRANCH RETURNED IT -- the
            # same rule `weight_threats` already follows for `boost`. A client
            # reading `progress` would otherwise find it absent on precisely
            # the accounts the empty state is for.
            **({"progress": progress(tag, since, until, intel)} if compare else {}),
        }

    threats = weight_threats(raw, defs)

    # THEN THE FIELD'S OWN DIRECTION, after the player's weighting and before
    # anything is scored. The two are independent: one says what THEY lose to,
    # the other what the population is taking up.
    try:
        import meta_history
        move = meta_history.movement(TREND_DAYS)
    except Exception:
        move = None
    threats, trend = trend_threats(threats, move)
    basis = "weighted" if defs else ("unweighted" if intel else "no_history")

    snap = dcx._snap()
    pool = ta._scout_candidates()
    seat = dcx.seater()

    def score_all(projection):
        """Every candidate scored. THE WHOLE POOL, which is the change.

        This used to end in `diversify()` and return seven, so 197 of 204
        scored decks were computed and thrown away -- and the seven that
        survived were one per archetype, which is a tier list. The families
        and the two personal lists are all built from THIS list, so they read
        the same numbers and cannot disagree about a deck.
        """
        out = []
        for c in pool:
            got = ts.score(
                lambda other, _p=c.profile: _p.against(other, snap),
                projection,
                cards=c.cards,
                archetype=c.archetype,
                # NOBODY'S DECK. The pool is archetype representatives, so
                # there is no games-piloted figure — `None` is a real state and
                # a zero would read as "they have played this none of the
                # time", a claim about a player this pool knows nothing about.
                # What DOES connect a candidate to this player is `affinity`
                # below, computed from their own decks rather than from a
                # games-piloted count the pool cannot have.
                fit_games=None,
            )
            if got:
                got["name"] = c.name
                got["archetype"] = c.archetype
                out.append(got)
        return out

    def rank(projection):
        return ts.diversify(score_all(projection), limit=limit,
                            minimum=min(MIN_PICKS, limit))

    scored = score_all(threats)
    picks = ts.diversify(list(scored), limit=limit, minimum=min(MIN_PICKS, limit))

    # WHAT THE WEIGHTING ACTUALLY CHANGED. See the module note: without this
    # the screen's "weighted by N matchups" is a claim the reader cannot check,
    # and across five real players the plans overlap 4-6 of 7. Costs one more
    # pass over a pool that does no database work.
    baseline = [p["key"] for p in rank(raw)] if defs else [p["key"] for p in picks]
    base_set = set(baseline)
    for p in picks:
        p["fromWeighting"] = bool(defs) and p["key"] not in base_set
    for p in picks:
        ordered, art, inferred = seat(p["cards"])
        p["cards"] = ordered
        p["art"] = art
        p["artInferred"] = inferred

    # -- THE THREE ANSWERS ------------------------------------------------
    #
    # Built from `scored`, so every figure here is the same `score()` row the
    # portfolio above used. NOT in `brief`: the roster-wide read draws one deck
    # per player and would pay for 68 more deck rows a head to show none of
    # them.
    own = repertoire(intel)
    hist, hist_total = archetype_history(intel)
    fams: list[dict] = []
    near: list[dict] = []
    learn = None

    def _build_lists():
        nonlocal fams, near, learn
        pool_cards = card_pool(own)
        for r in scored:
            r["affinity"] = deck_affinity(r["cards"], own, pool_cards)
        near = closest(scored)
        # The bar a new archetype has to clear is the best thing they can
        # already pilot. With nothing familiar there is no bar, and the guard
        # inside `worth_learning` says so.
        beat = near[0]["expectedWinRate"] if near else None
        learn = worth_learning(scored, hist, hist_total, beat)
        fams = families(scored, hist=hist, total=hist_total)
        # A family row draws a card strip, a name, a rate and whether they
        # could already pilot it -- so it carries exactly that. MEASURED: the
        # untrimmed rows made `families` 61 kB of a 108 kB payload, and the
        # single biggest field was `affinity.deckCards`, the eight cards of
        # the OWN deck it matched, which only the `closest` list draws beside
        # its rows. Seventeen families times four decks is sixty-eight rows,
        # so anything per-row is paid for sixty-eight times.
        for g in fams:
            for r in g["decks"]:
                ordered, art, inferred = seat(r["cards"])
                r["cards"] = ordered
                r["art"] = art
                r["artInferred"] = inferred
                for k in ("matchups", "brain", "score", "recommendationScore",
                          "threatCovered", "evidenceStrength", "matchupValue",
                          "playerFit", "confidence", "spreadCovered"):
                    r.pop(k, None)
                a = r.get("affinity")
                if a:
                    a.pop("deckCards", None)
        for r in near:
            ordered, art, inferred = seat(r["cards"])
            r["cards"] = ordered
            r["art"] = art
            r["artInferred"] = inferred
            r.pop("matchups", None)
        if learn:
            ordered, art, inferred = seat(learn["deck"]["cards"])
            learn["deck"]["cards"] = ordered
            learn["deck"]["art"] = art
            learn["deck"]["artInferred"] = inferred
            learn["deck"].pop("matchups", None)

    # IT DEGRADES TO THE OLD ANSWER RATHER THAN TAKING THE TAB DOWN. This is
    # the coach's main screen, and `recommendations`, `threats` and `weighted`
    # are all computed and complete by the time this runs — so a fault in the
    # three new lists costs those three lists and nothing else. The same
    # treatment `intel` and `meta_history` already get in this function.
    #
    # BUILT IN `brief` TOO, AND THAT IS THE POINT. The roster's Today board
    # reads the brief plan and drew `recommendations[0]` — the diversified top
    # pick, which is the same deck for every player, so six rows showed six
    # identical Balloon decks. It costs no query: the affinity is ~200 card-set
    # intersections against at most 25 of their own decks. What `brief` still
    # withholds is the SIZE — see the trim below.
    try:
        _build_lists()
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        fams, near, learn = [], [], None

    if brief:
        # ONE PERSONAL DECK SURVIVES THE TRIM, because it is the only thing on
        # a roster row that differs between players. The families board and the
        # rest of `closest` are the full screen's and are dropped.
        near = near[:1]
        fams = []
        if learn:
            learn = {k: v for k, v in learn.items() if k != 'deck'}
        # The threats keep what a summary row says (name, share, whether this
        # player's record moved it) and lose the eight cards nobody draws there.
        for t in threats:
            for k in ("cards", "art", "artInferred", "wins", "winRate", "lastSeen",
                      "similarityToObserved", "observedCount"):
                t.pop(k, None)
        # Only the top pick is drawn in a roster row; the rest keep their
        # figures so the count and the best rate are still honest.
        for p in picks[1:]:
            p.pop("cards", None)
            p.pop("art", None)
            p.pop("matchups", None)
        for p in picks:
            p.pop("matchups", None)
    else:
        for t in threats:
            ordered, art, inferred = seat(t["cards"])
            t["cards"] = ordered
            t["art"] = art
            t["artInferred"] = inferred

    return {
        "tag": tag,
        "brain": BRAIN,
        "basis": basis,
        "reason": None,
        "window": (intel or {}).get("window") or {"from": since, "to": until},
        "battles": int(summary.get("battles") or 0),
        "winRate": round(overall, 1) if summary.get("battles") else None,
        # What the plan was built against, and what moved it.
        "threats": threats,
        # What the meta's own direction did, so a screen can say "weighted
        # toward what is rising" only when it actually is.
        "trend": trend,
        "weighted": sorted(
            (d for d in defs.values() if d["deficit"] > 0),
            key=lambda d: -d["deficit"],
        ),
        "recommendations": picks,
        # How many picks the weighting put there. 0 is a real answer and the
        # screen says it plainly rather than implying a tailoring that did not
        # happen.
        "tailoredPicks": sum(1 for p in picks if p["fromWeighting"]),
        # WHAT ANSWERS THE FIELD, grouped by win condition so the spread is
        # structural rather than enforced by `diversify`'s repeat penalty.
        # `closest` and `repertoire` ride along in brief (one deck, a few
        # counts); `families` is emptied above and `learn` loses its deck.
        "closest": near,
        "learn": learn,
        "repertoire": {
            "decks": len(own),
            "battles": sum(d["battles"] for d in own),
            "archetypes": len(hist),
            "deckFloor": REPERTOIRE_MIN_BATTLES,
            "sharedFloor": AFFINITY_MIN,
            "knownFloor": KNOWN_MIN,
            "cards": len(card_pool(own)),
        },
        **({} if brief else {
            "families": fams,
            # HOW MANY FAMILIES THE PERSONAL ORDER ACTUALLY MOVED. 0 is a real
            # answer -- a player with no overlap gets the field's board, and
            # the screen says so rather than implying a tailoring that did not
            # happen. Same discipline as `tailoredPicks`.
            "personalised": sum(1 for g in fams if g.get("moved")),
            # How many win conditions they can already play. It is what the
            # board is grouped by, so the screen states it rather than leaving
            # the reader to count the sections.
            "yourFamilies": sum(1 for g in fams if g.get("yours")),
        }),
        **({"progress": progress(tag, since, until, intel)} if compare else {}),
        **({} if brief else {"baselinePicks": baseline}),
        "brief": brief,
        "pool": len(pool),
        "meta": {
            "decks": len(board.get("decks") or []),
            "window": board.get("window"),
            "computedAt": board.get("computedAt"),
        },
    }


# -- "WHAT TO PLAY" IS THREE QUESTIONS, AND IT USED TO ANSWER ONLY ONE ------
#
# The screen returned seven decks and they were nearly the same seven for
# everybody. That was not a bug in the scoring; it is what the SHAPE of the
# answer forced, and there are two separate causes:
#
#   1. `diversify()` IS A PORTFOLIO PICKER, AND THIS IS NOT A PORTFOLIO.
#      `ARCHETYPE_REPEAT_PENALTY` deliberately spreads picks across archetypes
#      -- right for Team Scout, where you want several different answers to one
#      opponent. Here it collapses 204 decks to "the best deck of each of seven
#      archetypes", which is a tier list, and a tier list is the same for
#      everyone by construction.
#   2. NOTHING IN THE RANKING KNEW WHAT THE PLAYER PLAYS. `score()` takes
#      `fit_games`, and this module passed None because the pool is ownerless.
#      So the only personal term was the deficit weighting, and its own
#      measurement says what that is worth: `tailoredPicks` runs 0 to 1 of 7.
#
# So the answer is split into the three questions a coach actually asks, each
# with its own evidence and its own sentence:
#
#   FAMILIES        what answers the field, grouped by win condition, so the
#                   spread is STRUCTURAL instead of enforced by a penalty. The
#                   reader browses "what Hog decks beat this meta" rather than
#                   being handed one Hog deck and told it is the Hog answer.
#   CLOSEST         of those, the ones built out of cards they already play.
#   WORTH LEARNING  one family they have no real history with whose best deck
#                   beats everything they can already pilot. The growth
#                   suggestion, and the only one that is allowed to be
#                   unfamiliar.
#
# None of this re-scores anything. All three read the SAME `score()` rows, so
# they cannot disagree about a deck -- the "two lists, not one" rule Team Scout
# already follows for threats and recommendations.

#: Cards a candidate must share with one of their own decks before it can be
#: called related to how they play. MEASURED, not chosen: the pool's staples
#: are barbarian-barrel (34.8% of all 204 decks), skeletons (30.9%), fireball
#: (26.0%) and zap (21.6%), so three and four shared cards are reachable by
#: staples alone and say nothing about anybody. Five is the first level that
#: needs a card outside them.
#:
#: THE FIGURE REPORTED IS RAW SHARED CARDS, deliberately. A staple-weighted
#: score would be more correct and completely uncheckable; "6 of these 8 cards
#: are in a deck you play" is something the reader confirms by looking at two
#: card strips.
AFFINITY_MIN = 5

#: Battles on one of THEIR OWN decks before it counts as something they play.
#: MEASURED on six real accounts: without it the closest match for one player
#: was "5 of 8 shared with a deck you played 3x", and for another the entire
#: related list came off decks played ONCE or TWICE. A deck someone tried once
#: is not their playstyle, and building a recommendation on it is the
#: "1 battles - 100.0% won" fault this project already fixed on the headline
#: deck block. Five is that block's floor (`DECK_RATE_FLOOR`), reused rather
#: than reinvented so the two cannot disagree about what "a deck you play"
#: means.
REPERTOIRE_MIN_BATTLES = 5

#: Points of expected win rate a deck is worth for being one they could
#: already pilot. `team_scout.FIT_WEIGHT`, reused rather than reinvented: it
#: is the same claim ("this player has practice on this") with the same units,
#: and two different weights for one quantity would eventually disagree.
#:
#: IT IS BOUNDED AND SMALL ON PURPOSE. At most 1.5 points, so a deck they know
#: well can overtake one a point better that they have never touched, and
#: cannot overtake one six points better. Raising it would manufacture
#: personalisation rather than measure it -- the mistake `MAX_BOOST` is capped
#: to avoid, made in a second place.
FAMILIAR_WEIGHT = ts.FIT_WEIGHT

#: Decks kept per win condition. The family exists to show that an archetype
#: has variants; four is enough to see that and short enough to scan.
FAMILY_DECKS = 4

#: Cards of a candidate that must be ones they ALREADY PLAY before it can be
#: reserved a slot in its family. A different, denser signal from
#: `AFFINITY_MIN`, and a WEAKER claim: that floor says "close to one deck you
#: pilot", this one says "built out of cards you own and use".
#:
#: IT EXISTS BECAUSE DECK-LEVEL AFFINITY IS TOO SPARSE TO FILL A BOARD.
#: Measured across six live accounts, five shared cards with a single one of
#: their decks qualified 0 to 55 of 204 candidates, so most of the seventeen
#: families had nothing familiar in them and fell back to the field's four —
#: which is why the board still looked the same for everybody. Cards-anywhere
#: qualifies 1 to 161 of 204 on the same accounts and separates them sharply,
#: because it scales with how varied their play actually is.
#:
#: THE FLOOR IS STILL REAL. A player with fifteen distinct cards gets ONE
#: qualifying candidate, and that is the honest answer for somebody whose
#: decks sit outside what the field is answered with -- not a reason to lower
#: it until something qualifies.
KNOWN_MIN = 5

#: Of those four, how many are reserved for the decks CLOSEST TO WHAT THEY
#: PLAY rather than to the field's best.
#:
#: THE ORDERING NUDGE ALONE WAS NOT ENOUGH, AND THE MEASUREMENT IS WHY. With
#: `FAMILIAR_WEIGHT` and nothing else, `personalised` came back 0 or 1 of 17
#: families on all six live accounts and 54 of ~68 decks sat on every single
#: player's board -- the board was still the same board, which is exactly what
#: was reported. The gap between a family's best deck and its second is
#: routinely five points, far more than the 1.5 a bounded nudge may move, so
#: familiarity could never reorder anything.
#:
#: RAISING THE WEIGHT WAS THE WRONG FIX: it would put worse decks above better
#: ones on a weak signal, which is manufacturing personalisation rather than
#: measuring it -- the mistake `MAX_BOOST` is capped to avoid.
#:
#: This is `PRIORITY_SLOTS`' answer to the same problem one level down. The
#: family keeps its best answers AND reserves room for the ones this player
#: could actually pick up, each labelled, instead of pretending a single
#: ranking can carry both claims. A family with nothing familiar in it spends
#: no slots and shows four of the field's best, because there is nothing
#: personal to say about it.
FAMILY_FAMILIAR_SLOTS = 2

#: A win condition is outside their range when it is under this share of their
#: battles AND under this many of them. Both, because the share alone calls a
#: busy player's minor deck "new" and the count alone calls everything new for
#: somebody with forty battles.
LEARN_MAX_SHARE = 0.05
LEARN_MAX_BATTLES = 15


def repertoire(intel: dict | None) -> list[dict]:
    """Their own 8-card decks in this window, most played first.

    A native duel row stores a 16- or 24-card loadout, which `coach_intel`
    already refuses to split into invented decks; the guard is repeated here
    because this function is the one that decides what "a deck they play"
    means for the affinity figure.
    """
    out = []
    for d in (intel or {}).get("decks") or []:
        cards = [c for c in (d.get("cards") or []) if c]
        if len(set(cards)) == 8 and int(d.get("battles") or 0) >= REPERTOIRE_MIN_BATTLES:
            out.append({
                "key": d.get("key") or ",".join(sorted(cards)),
                "cards": cards,
                "battles": int(d.get("battles") or 0),
                "wins": int(d.get("wins") or 0),
            })
    out.sort(key=lambda d: -d["battles"])
    return out


def archetype_history(intel: dict | None) -> tuple[dict[str, int], int]:
    """`{win condition: battles}` over their OWN decks, and the total.

    `archetypes` is what they PLAYED; `opponentArchetypes` is what they faced,
    and confusing the two would recommend somebody the deck they keep losing
    to. The deficit weighting reads the other one, three functions up.
    """
    hist = {}
    for a in (intel or {}).get("archetypes") or []:
        key = (a.get("key") or "").strip().lower()
        if key:
            hist[key] = hist.get(key, 0) + int(a.get("battles") or 0)
    return hist, sum(hist.values())


def card_pool(own: list[dict]) -> set[str]:
    """Every card that appears in a deck they actually play.

    Built once per request and passed in: `deck_affinity` runs 204 times and
    rebuilding this inside it would rebuild the same set 204 times.
    """
    pool: set[str] = set()
    for d in own:
        pool.update(d["cards"])
    return pool


def deck_affinity(cards, own: list[dict], pool: set[str] | None = None) -> dict:
    """How close one candidate is to the decks this player actually runs.

    THE CLOSEST SINGLE DECK, not an average over their repertoire. A player
    with one Hog deck and six others is a Hog player for the purposes of "can
    you pilot this"; averaging would bury the one deck that makes the answer
    yes. The deck it matched is named so the claim is checkable.
    """
    cs = set(cards)
    best, match = 0, None
    for d in own:
        n = len(cs & set(d["cards"]))
        if n > best:
            best, match = n, d
    # TWO SIGNALS, TWO CLAIMS, KEPT APART. `shared` is the overlap with the
    # single closest deck they run -- "you could pilot this today". `known` is
    # how many of the eight are cards they play at all, across every deck --
    # "this is built out of your cards". The first is the stronger claim and
    # the sparser one; the second is what has enough density to say anything
    # about most win conditions.
    known = len(cs & (card_pool(own) if pool is None else pool))
    return {
        "shared": best,
        "of": len(cs),
        "familiar": best >= AFFINITY_MIN,
        "known": known,
        "knowsCards": known >= KNOWN_MIN,
        "deckKey": (match or {}).get("key"),
        "deckCards": (match or {}).get("cards"),
        "deckBattles": int((match or {}).get("battles") or 0) if match else 0,
    }


def in_range(archetype: str, hist: dict[str, int], total: int) -> bool:
    """Has this player actually played this win condition?

    THE PARTITION RUNS ON THIS, NOT ON CARD OVERLAP, AND A LIVE BOARD IS WHY.
    Grouping on `knowsCards` collapsed: a player with twenty-five decks and a
    sixty-seven-card pool clears "five of eight cards I play" in ALL SEVENTEEN
    families, so every section was "theirs" and the split said nothing. Card
    overlap is the right signal for choosing WHICH decks of a family to show —
    it is dense, which is exactly why it cannot also decide what is in range.

    It is `worth_learning`'s own test, inverted, so the two cannot disagree
    about the same player: a win condition is outside their range when it is
    under `LEARN_MAX_SHARE` of their battles AND under `LEARN_MAX_BATTLES` of
    them, and in range otherwise.
    """
    n = hist.get(archetype, 0)
    if n > LEARN_MAX_BATTLES:
        return True
    return bool(total) and (n / total) > LEARN_MAX_SHARE


def _fit_fraction(aff: dict | None) -> float:
    """0 at the affinity floor, 1 when all eight cards are shared.

    Below the floor it is ZERO rather than a small number: three and four
    shared cards are reachable by staples alone, so crediting them would let
    the noise floor reorder a board.
    """
    if not aff:
        return 0.0
    n = int(aff.get("shared") or 0)
    span = 8 - (AFFINITY_MIN - 1)
    return max(0.0, min(1.0, (n - (AFFINITY_MIN - 1)) / span))


def personal_rate(r: dict) -> float:
    """Expected win rate, plus what practice on it is worth to THIS player.

    THE ONE RULE THAT PERSONALISES THE BOARD. The families were ordered by the
    field alone and every player saw the same seventeen sections in the same
    order with the same decks inside them, which is the complaint this exists
    to answer.

    It is deliberately NOT a re-ranking by familiarity: that would put the deck
    they already play at the top of a screen whose job is telling them what to
    play instead. It is the field's answer, nudged by at most
    `FAMILIAR_WEIGHT` points toward what they can actually pilot.

    WHERE THEY HAVE NO HISTORY IT CHANGES NOTHING, and that is correct rather
    than a shortfall: if they have never played Mortar, the best Mortar decks
    are the best Mortar decks, and inventing a personal order over them would
    be inventing. `personalised` on the payload counts how many families this
    actually moved, so the screen can state the size of the effect instead of
    implying it.
    """
    return r.get("expectedWinRate", 0.0) + FAMILIAR_WEIGHT * _fit_fraction(r.get("affinity"))


def _pick(decks: list[dict], per: int) -> list[dict]:
    """The `per` decks of one family this player should see.

    The field's best FIRST, then up to `FAMILY_FAMILIAR_SLOTS` reserved for the
    ones closest to what they play that did not already make the cut. Each
    reserved row is marked `closestOfFamily`, so the screen says why it is
    there rather than implying it out-ranked the others.

    A FAMILY WITH NOTHING FAMILIAR SPENDS NO SLOTS. Reserving room for decks
    that do not exist would drop the field's third and fourth best answers to
    show nothing in their place.
    """
    # RESERVED ON `knowsCards`, NOT `familiar`. Deck-level affinity is the
    # stronger claim and is made in the "Closest" list; here it is too sparse
    # to reach most families, which is what left the board looking the same
    # for everybody. See `KNOWN_MIN`.
    familiar = [r for r in decks if r.get("affinity", {}).get("knowsCards")]
    if not familiar or per <= FAMILY_FAMILIAR_SLOTS:
        return decks[:per]

    reserved = min(FAMILY_FAMILIAR_SLOTS, len(familiar))
    keep = decks[:per - reserved]
    seen = {r["key"] for r in keep}
    # Closest first among those not already shown; ties by the better answer.
    extra = sorted(
        (r for r in familiar if r["key"] not in seen),
        key=lambda r: (-(r.get("affinity", {}).get("known") or 0),
                       -(r.get("affinity", {}).get("shared") or 0),
                       -r["expectedWinRate"]),
    )[:reserved]
    for r in extra:
        r["closestOfFamily"] = True
    out = keep + extra

    # TOP BACK UP IF THE RESERVATION WENT UNSPENT. A test caught this: when the
    # only familiar deck is ALREADY in the top cut there is nothing left to put
    # in the slot held for it, and the family came back with three decks
    # instead of four -- a reservation quietly costing the reader the field's
    # fourth-best answer and showing nothing in its place.
    if len(out) < per:
        seen = {r["key"] for r in out}
        out += [r for r in decks if r["key"] not in seen][:per - len(out)]

    # Back into reading order once chosen: the list is still a ranking, the
    # reservation only decides WHO is in it.
    out.sort(key=lambda r: (-personal_rate(r), -r["expectedWinRate"], r["name"]))
    return out


def families(scored: list[dict], per: int = FAMILY_DECKS,
             hist: dict[str, int] | None = None, total: int = 0) -> list[dict]:
    """The scored pool grouped by win condition, best family first.

    ORDERED BY THEIR BEST DECK, not by how many decks a family has: twelve
    mediocre Mortar lists must not outrank two good Hog ones. Inside a family
    the same rule, so `decks[0]` is always the family's answer.
    """
    groups: dict[str, dict] = {}
    for r in scored:
        a = r.get("archetype") or "other"
        g = groups.get(a)
        if g is None:
            g = groups[a] = {
                "archetype": a,
                "name": dcx._label(a),
                "decks": [],
                "total": 0,
            }
        g["total"] += 1
        g["decks"].append(r)

    out = []
    for g in groups.values():
        # The field's own order, kept so the payload can say how much the
        # personal one actually differs from it -- the `tailoredPicks` rule:
        # a claim the reader cannot check is not worth making.
        field_first = min(g["decks"], key=lambda r: (-r["expectedWinRate"], r["name"]))
        g["decks"].sort(key=lambda r: (-personal_rate(r), -r["expectedWinRate"], r["name"]))
        best = g["decks"][0]
        # `best` STAYS THE EXPECTED WIN RATE, never the personal score. The
        # screen prints it as a percentage against the field, and printing a
        # familiarity-adjusted number as a win rate would be printing a figure
        # that is not one.
        g["best"] = best["expectedWinRate"]
        g["moved"] = best["key"] != field_first["key"]
        # NO `spreadCovered` ON THE FAMILY. It was published for one build and
        # measured 100.0 for all seventeen families on every account -- at the
        # top of a 204-deck pool every family's best deck answers the whole
        # projection, so the figure is true and says nothing. A field that
        # never varies is decoration; this project has shipped that mistake
        # before (`type` and `confidence` on the scouting report).
        # Marked in place rather than re-sorted: the coach's own rule from the
        # arsenal, and it keeps the family list a statement about the FIELD.
        g["familiar"] = sum(1 for r in g["decks"] if r.get("affinity", {}).get("familiar"))
        # IN THEIR RANGE, OR NOT. This is the partition the board is grouped
        # by, and it is a measured fact rather than a weight: either some deck
        # of this win condition is built from cards they already play, or none
        # is.
        g["knows"] = sum(1 for r in g["decks"] if r.get("affinity", {}).get("knowsCards"))
        # WHETHER THEY PLAY THIS WIN CONDITION, which is a different question
        # from whether its decks use their cards. With no history passed there
        # is nothing to partition on and every family is "the field".
        g["yours"] = in_range(g["archetype"], hist or {}, total)
        g["games"] = (hist or {}).get(g["archetype"], 0)
        g["_p"] = personal_rate(best)
        g["decks"] = _pick(g["decks"], per)
        out.append(g)
    # WIN CONDITIONS THEY CAN ALREADY PLAY FIRST, then the rest of the field,
    # each run ordered by how well it answers the field.
    #
    # THIS IS A PARTITION, NOT A WEIGHT, AND THE MEASUREMENT IS WHY. Ordering
    # by `personal_rate` alone moved 0 or 1 of 17 families on all six live
    # accounts and left 54 of ~68 decks on every player's board -- the board
    # really was the same board, which is what was reported. A bounded nudge
    # cannot reorder a list whose gaps are five points wide, and un-bounding it
    # would rank worse decks above better ones on a weak signal.
    #
    # Grouping claims nothing about quality: inside each run the field's own
    # rate still decides, so a deck is never called better for being familiar.
    # It answers a different question -- "which of these can I play today" --
    # by putting those sections where they can be found.
    out.sort(key=lambda g: (not g["yours"], -g["_p"], -g["best"], g["name"]))
    for g in out:
        g.pop("_p", None)
    return out


def closest(scored: list[dict], limit: int = MAX_PICKS) -> list[dict]:
    """The decks they could pilot today, best answer first.

    SORTED BY EXPECTED WIN RATE, NOT BY HOW FAMILIAR IT IS. The question this
    list answers is "what should I play", and familiarity is the FILTER, not
    the ranking -- sorting by overlap would put the deck they already run at
    the top of a screen whose whole job is telling them what to play instead.
    """
    near = [r for r in scored if r.get("affinity", {}).get("familiar")]
    near.sort(key=lambda r: (-r["expectedWinRate"], r["name"]))
    return near[:limit]


def worth_learning(scored: list[dict], hist: dict[str, int], total: int,
                   beat: float | None) -> dict | None:
    """One win condition outside their range whose best deck beats what is in it.

    THE `beat` GUARD IS THE WHOLE HONESTY OF THIS. A new archetype is only
    worth the weeks it costs if it is actually better than what they can
    already pilot, so this returns None rather than inventing a growth
    suggestion -- the same refusal as `reason: null` on an outranked deck.
    `beat` is the best expected rate among their familiar options; with no
    familiar options there is nothing to beat and the best unfamiliar family
    is offered on its own merits.
    """
    fams = families(scored, per=1)
    for g in fams:
        n = hist.get(g["archetype"], 0)
        # The same test the board's partition uses, so "outside their range"
        # means one thing in this module.
        if in_range(g["archetype"], hist, total):
            continue
        if beat is not None and g["best"] <= beat:
            continue
        best = g["decks"][0]
        return {
            "archetype": g["archetype"],
            "name": g["name"],
            "deck": best,
            "expectedWinRate": g["best"],
            # What they have actually played of it. 0 is the common answer and
            # is said plainly rather than hidden behind "new to you".
            "yourBattles": n,
            "yourShare": round(100.0 * n / total, 1) if total else None,
            # The margin over the best thing they can already pilot, which is
            # the entire argument for spending time on it.
            "beats": round(g["best"] - beat, 1) if beat is not None else None,
        }
    return None


# -- IS THE WEAKNESS CLOSING? ----------------------------------------------
#
# MEASURED AGAINST THE WINDOW BEFORE THIS ONE, not against a stored snapshot.
# The plan for this (`coach_player_snapshot`, one row a day, written by a
# nightly timer) was dropped, and the three reasons are worth keeping because
# each would apply again to the next thing somebody wants to remember:
#
#   1. NOTHING WOULD HAVE WRITTEN IT. The analytics service holds the Supabase
#      ANON key, for `admin_auth`'s one RPC gate, and nothing else. Writing
#      coach-owned rows needs the SERVICE-ROLE key, which bypasses RLS on
#      every table in the project -- and it would sit on the same box as the
#      bot and the 33 GB database, which still has no backup. A daily figure
#      is not worth that blast radius.
#   2. A SNAPSHOT ONLY HOLDS THE DAYS SOMEBODY LOOKED. Recomputation holds
#      every day the battles do, and it answers for history that PREDATES the
#      feature -- which a snapshot table by construction never can. So this is
#      answerable today, over months of stored play, instead of being
#      worthless until a timer has run for a month.
#   3. A STORED RATE CAN DRIFT FROM ITS OWN WINDOW. Recomputing from the rows
#      IS the window.
#
# What a snapshot would really buy is what the engine RECOMMENDED on a given
# day -- the engines move, so that genuinely cannot be recovered later. That
# is a different table answering a different question, and it is not this one.

#: Battles needed IN EACH WINDOW before a matchup is compared at all. It is
#: `MIN_FACED`, the same floor `deficits()` uses to decide a weakness is real,
#: applied to both sides -- the comparison must not be able to call something
#: a weakness and then refuse to say whether it moved, or the other way round.
COMPARE_MIN = MIN_FACED

#: The noise band, in standard errors of the difference. Two, i.e. roughly a
#: 95% interval under the normal approximation. NOT A SIGNIFICANCE TEST, and
#: nothing prints a p-value or the word -- it is the width below which two
#: records of this size differ for no reason at all.
COMPARE_Z = 2.0


def previous_window(since: str | None, until: str | None) -> tuple[str | None, str | None]:
    """The window of the same length ending the day before `since`.

    `_window` in app.py builds an INCLUSIVE range counting back from the
    player's last stored battle, so the span is `(until - since) + 1` days and
    the window before it ends on `since - 1`. Taking the span from the dates
    rather than from the request's `days` is what keeps this right when a
    caller passed an explicit `from`/`to` instead.
    """
    if not since or not until:
        return None, None
    try:
        a = _dt.date.fromisoformat(str(since)[:10])
        b = _dt.date.fromisoformat(str(until)[:10])
    except ValueError:
        return None, None
    span = (b - a).days + 1
    if span < 1:
        return None, None
    end = a - _dt.timedelta(days=1)
    return (end - _dt.timedelta(days=span - 1)).isoformat(), end.isoformat()


def _band(w_now: int, n_now: int, w_was: int, n_was: int) -> tuple[float, float]:
    """`(change, noise band)` in percentage points.

    AGRESTI-CAFFO, not the plain normal interval: one success and one failure
    are added to each sample before the variance is taken. The plain estimate
    puts the standard error at ZERO whenever a window is all wins or all
    losses, so a player who went 10/10 and then 9/10 would be credited with a
    real ten-point slide -- and the small, lopsided sample is exactly the case
    a floor of ten battles leaves in.

    THE CHANGE IS FROM THE RAW RATES AND THE BAND FROM THE ADJUSTED ONES, on
    purpose. The adjusted rate is a device for estimating spread; printing it
    would be printing a number that is not this player's record.
    """
    if n_now <= 0 or n_was <= 0:
        return 0.0, 0.0
    p_now = (w_now + 1) / (n_now + 2)
    p_was = (w_was + 1) / (n_was + 2)
    se = math.sqrt(p_now * (1 - p_now) / (n_now + 2) + p_was * (1 - p_was) / (n_was + 2))
    change = 100.0 * w_now / n_now - 100.0 * w_was / n_was
    return change, COMPARE_Z * se * 100.0


def _direction(change: float, band: float) -> str:
    """'up' / 'down' / 'flat'. Flat means INDISTINGUISHABLE, not unchanged."""
    if abs(change) <= band:
        return "flat"
    return "up" if change > 0 else "down"


def _faced(intel: dict | None) -> dict[str, dict]:
    """`archetype -> row` over `opponentArchetypes`, no floor applied."""
    out: dict[str, dict] = {}
    for a in (intel or {}).get("opponentArchetypes") or []:
        key = a.get("key") or a.get("name") or ""
        if key:
            out[key] = a
    return out


def _rate(row: dict | None) -> tuple[int, int, float | None]:
    """`(battles, wins, rate)` off one `opponentArchetypes` entry."""
    n = int((row or {}).get("battles") or 0)
    w = int((row or {}).get("wins") or 0)
    return n, w, (100.0 * w / n if n else None)


def progress(tag: str, since: str | None, until: str | None,
             intel: dict | None = None) -> dict:
    """Whether this player's weaknesses are closing, window against window.

    `intel` is the CURRENT window's `coach_intel.report()`, passed in because
    `plan()` has already paid for it -- so this adds exactly one more pass
    over the battle rows, for the previous window, and nothing else.

    A MATCHUP IS ONLY COMPARED WHEN BOTH WINDOWS CLEAR THE FLOOR. Falling
    under it is reported as a state (`unseen` / `thin`) rather than as a
    movement of zero, because "they stopped meeting this" and "this did not
    change" are different facts and only one of them is about the player.
    """
    p_since, p_until = previous_window(since, until)
    out: dict = {
        "window": {"from": since, "to": until},
        "previous": {"from": p_since, "to": p_until},
        "floor": COMPARE_MIN,
        "comparable": False,
        "reason": None,
        "overall": None,
        "matchups": [],
    }
    if not p_since:
        out["reason"] = "no_window"
        return out

    try:
        before = coach_intel.report(tag, p_since, p_until)
    except Exception:
        before = None

    s_now = (intel or {}).get("summary") or {}
    s_was = (before or {}).get("summary") or {}
    n_now, w_now = int(s_now.get("battles") or 0), int(s_now.get("wins") or 0)
    n_was, w_was = int(s_was.get("battles") or 0), int(s_was.get("wins") or 0)

    overall = {
        "now": {"battles": n_now, "winRate": round(100.0 * w_now / n_now, 1) if n_now else None},
        "before": {"battles": n_was, "winRate": round(100.0 * w_was / n_was, 1) if n_was else None},
        "change": None, "band": None, "direction": None,
    }
    out["overall"] = overall

    if n_now < COMPARE_MIN or n_was < COMPARE_MIN:
        # NAMED, so the screen can say WHICH side is short. "You have not
        # played enough yet" and "there is nothing before this to compare
        # against" read completely differently to somebody being coached.
        out["reason"] = "thin_now" if n_now < COMPARE_MIN else "thin_before"
        return out

    change, band = _band(w_now, n_now, w_was, n_was)
    out["comparable"] = True
    overall["change"] = round(change, 1)
    overall["band"] = round(band, 1)
    overall["direction"] = _direction(change, band)

    now_rate = 100.0 * w_now / n_now
    was_rate = 100.0 * w_was / n_was
    f_now, f_was = _faced(intel), _faced(before)

    # THE UNION OF BOTH WINDOWS' WEAKNESSES, not just the current ones. A
    # deficit that has CLOSED is the best thing this screen can report, and
    # listing only what is still wrong would delete it -- the player would see
    # the same three names week after week with no record of the one they
    # fixed.
    keys: set[str] = set()
    for src, base in ((f_now, now_rate), (f_was, was_rate)):
        for k, a in src.items():
            n, _w, r = _rate(a)
            if n >= COMPARE_MIN and r is not None and base - r > 0:
                keys.add(k)

    rows = []
    for k in keys:
        a_now, a_was = f_now.get(k), f_was.get(k)
        nn, ww, r_now = _rate(a_now)
        pn, pw, r_was = _rate(a_was)
        row = {
            "archetype": k,
            "name": (a_now or a_was or {}).get("name") or k,
            "now": {"battles": nn, "winRate": round(r_now, 1) if r_now is not None else None},
            "before": {"battles": pn, "winRate": round(r_was, 1) if r_was is not None else None},
            "deficitNow": round(now_rate - r_now, 1) if r_now is not None else None,
            "deficitBefore": round(was_rate - r_was, 1) if r_was is not None else None,
            "change": None, "band": None,
        }
        if nn < COMPARE_MIN or pn < COMPARE_MIN:
            row["direction"] = "unseen" if (nn == 0 or pn == 0) else "thin"
        else:
            ch, bd = _band(ww, nn, pw, pn)
            row["change"] = round(ch, 1)
            row["band"] = round(bd, 1)
            row["direction"] = _direction(ch, bd)
        # A WEAKNESS IS GONE WHEN THE GAP CLOSED **AND** THE RECORD ITSELF
        # ROSE. The gap alone is not enough, and the first version of this got
        # it wrong in a way a test caught: a deficit also closes when the
        # player gets worse at EVERYTHING ELSE and their overall rate falls to
        # meet a matchup that never moved at all. Measured on the gap alone
        # that prints as resolved -- the screen congratulating somebody for a
        # decline.
        #
        # Requiring 'up' rather than merely not-'down' is what excludes it,
        # since that case is exactly 'flat'. It is a strong badge and it
        # should need evidence: a five-point deficit crossing zero is inside
        # the noise band of any sample this floor admits, so it stays unbadged
        # and the row's two rates say what happened. 'up' also implies both
        # windows cleared the floor, so this can never fire off three battles.
        row["resolved"] = bool(
            row["deficitBefore"] is not None and row["deficitBefore"] > 0
            and row["deficitNow"] is not None and row["deficitNow"] <= 0
            and row["direction"] == "up"
        )
        rows.append(row)

    rows.sort(key=lambda r: (-(r["deficitNow"] if r["deficitNow"] is not None else -999.0), r["name"]))
    out["matchups"] = rows
    return out


if __name__ == "__main__":
    import argparse
    import json

    ap = argparse.ArgumentParser(description="A plan against the field")
    ap.add_argument("tag")
    ap.add_argument("--days", type=int, default=30)
    a = ap.parse_args()

    since, until = cd.window_for(a.tag, days=a.days) if hasattr(cd, "window_for") else (None, None)
    out = plan(a.tag, since, until)
    print(json.dumps({k: v for k, v in out.items()
                      if k not in ("threats", "recommendations")}, indent=1))
    print("\nTHREATS (weighted):")
    for t in out["threats"][:8]:
        pr = t.get("playerRecord")
        note = f"  [{pr['winRate']}% over {pr['battles']}]" if pr else ""
        print(f"  {t['likelihood']:.3f}  x{t.get('boost', 1):.2f}  {t['name'][:34]}{note}")
    print("\nPICKS:")
    for p in out["recommendations"]:
        print(f"  {p['expectedWinRate']:5.1f}%  cover {p['spreadCovered']:5.1f}%  {p['name'][:40]}")
