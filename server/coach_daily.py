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
         limit: int = MAX_PICKS, brief: bool = False) -> dict:
    """One player's plan against the field.

    `brief` trims the payload for a ROSTER-WIDE read, where one row per player
    is drawn and the full projection is not: the threats keep their names and
    likelihoods but lose their card lists and art, only the top pick keeps its
    cards, and `baselinePicks` is dropped. Measured on the live roster, five
    full plans are 195 kB and five brief ones are a fraction of it. **It is a
    projection of the same answer, not a cheaper one** — nothing is recomputed
    differently, so a brief row can never disagree with the full screen.

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

    def rank(projection):
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
                fit_games=None,
            )
            if got:
                got["name"] = c.name
                out.append(got)
        return ts.diversify(out, limit=limit, minimum=min(MIN_PICKS, limit))

    picks = rank(threats)

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

    if brief:
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
        **({} if brief else {"baselinePicks": baseline}),
        "brief": brief,
        "pool": len(pool),
        "meta": {
            "decks": len(board.get("decks") or []),
            "window": board.get("window"),
            "computedAt": board.get("computedAt"),
        },
    }


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
