"""TODAY'S SESSION — the part of a coach's plan that is meant to change daily.

Reported 2026-09-30: "the daily practice for everyone on the roster does not
change; it should change daily according to how they play, and they should
improve by seeing the meta decks, the duels…". MEASURED before a line was
written, the same eight real roster players with a 30-day window ending on
each of five consecutive days: the deck put in front of them was IDENTICAL on
all five days for seven of eight, and "Bridge Spam" was that deck for four of
the eight.

That was not a bug in `coach_daily.plan()`. It answers "what is the best deck
against the whole field over the last thirty days", and a thirty-day average
moves by a thirtieth a day. The board is right to be stable — a top pick that
thrashed daily would be noise — and it stays exactly as it was. What was
missing is a DIFFERENT question, the one a coach actually asks each morning:

    what do we work on TODAY?

This module answers it from inputs that really do change day to day, and says
which one moved it:

  FOCUS     one matchup to drill.
              1. what beat them since yesterday, when it did so more than once
                 and is a known weakness (or did it three times);
              2. otherwise their weakest matchups TAKE TURNS, one a day —
                 `ROTATION` of them, walked by the calendar;
              3. with no measured weakness, the field's most-played archetypes
                 take turns instead, and the payload says it is the field's.
  PRACTISE  the deck to bring into that matchup: one that COUNTERS it
            (`COUNTER_MIN`), still wins against the field (`FIELD_MIN`), is
            built from their own cards when one is close enough, and is a
            DIFFERENT WIN CONDITION from the ones they were shown in their
            last sessions (`coach_session_log`).
  AGAINST   the real meta list of that archetype they will meet, with its
            weekly movement.
  DUELS     the deck duel players win with against that win condition, from
            the duel index (their own proven duel deck first), and their own
            duel games this week.
  RISING    the meta decks climbing this week (`meta_history.movement`), and
            which of them are archetypes this player already loses to.

── THE ROTATION IS A SCHEDULE, AND IT IS LABELLED AS ONE ─────────────────────

Taking turns is a coaching choice, not evidence: "Golem today, Mortar
tomorrow" does not claim Golem got worse overnight. So the payload carries
`why: "rotation"` with `rotation.index`/`rotation.of`, and the screen prints
"day 2 of 3" rather than dressing a calendar as a finding. A focus picked
because of yesterday's games says so instead (`why: "lost_recently"`), with
the counts. Nothing here invents a figure.

The rotation set is ordered by archetype KEY, not by deficit, so a small
day-to-day wobble in the deficits cannot reorder it and serve the same matchup
two days running.

── EVERY RULE BELOW IS PURE ──────────────────────────────────────────────────

`focus()`, `practise()`, `rising()` and `duel_answer()` take plain data, so
`test_coach_session.py` drives them with literals. `build()` is the one place
that touches other modules, and every source it reads degrades to "absent"
rather than taking the plan down — the rule `coach_daily.plan()` already
follows for its own three lists.
"""

from __future__ import annotations

import datetime as _dt
import traceback

BRAIN = "coach-session-1.0"

#: How many of their weakest matchups take turns. Three is the width of the
#: weakness cards the screen already draws, so the rotation walks exactly the
#: matchups the coach can see listed above it.
ROTATION = 3

#: "Since yesterday": the reference day and the one before it.
FRESH_DAYS = 2

#: WHAT "IT BEAT THEM SINCE YESTERDAY" MEANS, MEASURED AGAINST THEIR OWN RATE.
#: The first cut was "lost at least twice and more than they won", and staged
#: on eight real roster players it fired on almost every day for anybody who
#: plays: at 50-300 games in two days SOMETHING always clears that. So the
#: test is EXCESS losses -- losses beyond what their own win rate over the
#: window predicts for that many games. A 60% player who goes 4-6 against Hog
#: has lost two more than usual; the same player going 12-9 has not.
#:
#: `FRESH_EXCESS` for an archetype that is already a measured weakness,
#: `FRESH_ALONE` for one that is not (a single bad evening against something
#: they normally handle should be louder before it takes the day).
FRESH_MIN_LOSSES = 2
FRESH_EXCESS = 2.0
FRESH_ALONE = 3.0

#: Never a focus. `other` is the bot's bucket for decks outside its seventeen
#: win conditions -- Minion Giant, Goblin Giant, Elixir Golem... -- so "drill
#: Mixed today" names no matchup anyone could practise.
NOT_A_MATCHUP = frozenset({"other", ""})

#: THE PRACTICE DECK MUST COUNTER TODAY'S MATCHUP. `team_scout.GOOD_RATE`'s
#: figure, for the same claim ("a good percentage against what they face").
#:
#: REPORTED 2026-10-12: "this should change daily, with different decks and
#: different win cons, according to what they are losing and what deck
#: counters it". MEASURED on the seven roster players over eight days: two got
#: the IDENTICAL deck on all eight, one of them at 24.2% against the day's
#: focus, and the other five cycled two or three lists on a three-day loop.
#:
#: The cause was the rule this replaces, `FIELD_SLACK = 3.0`: the pick had to
#: sit within three points of their best all-round deck. A player with one
#: stand-out list (61.8 against a next-best 58) therefore had exactly ONE
#: candidate whatever the focus was -- while the same players held 3 to 11
#: different win conditions among their own-card decks at 55%+ against it.
COUNTER_MIN = 55.0

#: ...and must not give the rest of the field away. An absolute floor, not a
#: distance from their best: "still wins against the field" is the claim, and
#: a distance turns one strong deck into the only deck.
FIELD_MIN = 50.0

#: A win condition practised in the last this-many SESSIONS is not offered
#: again, and an exact list not for this many. Sessions are the days a plan was
#: actually served (`coach_session_log`), not calendar days -- a player who
#: opens the page every third day must not be handed the same deck each time
#: because the rotation happened to come round.
#:
#: THREE, AND NOT TWO, BECAUSE OF `ROTATION`. The focus walks three matchups,
#: so with two a player whose cards hold three counters loops the same three
#: win conditions on the rotation's own beat. Replayed on the seven roster
#: players over fourteen days (real candidates, real daily focus):
#:
#:     sessions avoided   win conditions a player   vs focus   own-card picks
#:     old rule                1 1 2 2 2 3 3           62.3        98 of 98
#:     2                       4 5 6 6 6 7 8           66.2        95
#:     3                       7 7 7 7 7 7 8           65.8        94
#:     4                       7 7 7 8 8 8 9           65.6        91
#:
#: The same win condition as the day before: 50 of 91 day steps under the old
#: rule, 0 of 91 under every row below it. Days under 55% against the focus:
#: 11 of 98, then 0. The cost is against the FIELD, 59.3 -> 55.1, which is the
#: point of the change -- the deck is for today's matchup.
AVOID_FAMILY_SESSIONS = 3
AVOID_DECK_SESSIONS = 6

#: Rising decks shown. The board is fifty and a week moves about a dozen.
RISING_MAX = 3

#: A riser must have grown by at least this share of its old use rate — the
#: floor `coach_daily.TREND_FLOOR` already applies to the projection, so the
#: two cannot disagree about what "rising" means.
RISING_FLOOR = 0.15

#: Days of their own duel games summarised beside the duel answer.
DUEL_WEEK = 7


# ── Pure rules ────────────────────────────────────────────────────────────────


def _losses(a: dict) -> int:
    n = int(a.get("battles") or 0)
    return int(a.get("losses") if a.get("losses") is not None
               else n - int(a.get("wins") or 0) - int(a.get("draws") or 0))


def recent_record(faced: list[dict] | None) -> dict[str, dict]:
    """`archetype -> {battles, wins, losses}` since yesterday."""
    out: dict[str, dict] = {}
    for a in faced or []:
        key = (a.get("key") or "").strip().lower()
        if not key:
            continue
        out[key] = {"battles": int(a.get("battles") or 0),
                    "wins": int(a.get("wins") or 0),
                    "losses": _losses(a),
                    "name": a.get("name") or key}
    return out


def excess_losses(r: dict, overall: float) -> float:
    """Losses beyond what their usual rate predicts for this many games."""
    p = max(0.0, min(100.0, float(overall))) / 100.0
    return r["losses"] - r["battles"] * (1.0 - p)


def focus(day: _dt.date, defs: dict[str, dict], recent: dict[str, dict],
          threats: list[dict], names: dict[str, str] | None = None,
          overall: float = 50.0) -> dict | None:
    """Today's one matchup, and WHY it is today's.

    `defs` is `coach_daily.deficits()` (window, past the floor); `recent` is
    `recent_record()`; `threats` is the weighted field projection, used only
    when there is no measured weakness at all; `overall` is their win rate over
    the window, in percent.
    """
    names = names or {}

    def name_of(k: str) -> str:
        return ((defs.get(k) or {}).get("name") or (recent.get(k) or {}).get("name")
                or names.get(k) or k)

    weak = {k: d for k, d in defs.items()
            if float(d.get("deficit") or 0) > 0 and k not in NOT_A_MATCHUP}

    # 1. WHAT BEAT THEM SINCE YESTERDAY, beyond their own normal rate.
    fresh = []
    for k, r in recent.items():
        if k in NOT_A_MATCHUP or r["losses"] < FRESH_MIN_LOSSES or r["losses"] <= r["wins"]:
            continue
        x = excess_losses(r, overall)
        if x >= (FRESH_EXCESS if k in weak else FRESH_ALONE):
            fresh.append((-x, -r["losses"], k))
    if fresh:
        fresh.sort()
        k = fresh[0][2]
        return {"archetype": k, "name": name_of(k), "why": "lost_recently",
                "record": _record(defs.get(k)),
                "recent": _recent(recent.get(k)),
                "excessLosses": round(-fresh[0][0], 1), "rotation": None}

    # 2. THEIR WEAKEST MATCHUPS TAKE TURNS.
    ranked = sorted(weak.values(), key=lambda d: (-float(d["deficit"]), d["archetype"]))
    pool = [d["archetype"] for d in ranked[:ROTATION]]
    why = "rotation"
    # 3. NO MEASURED WEAKNESS: THE FIELD'S MOST-PLAYED ARCHETYPES TAKE TURNS.
    if not pool:
        why = "field_rotation"
        share: dict[str, float] = {}
        for t in threats or []:
            a = t.get("archetype") or ""
            if a and a not in NOT_A_MATCHUP:
                share[a] = share.get(a, 0.0) + float(t.get("likelihood") or 0.0)
        pool = [a for a, _ in sorted(share.items(), key=lambda kv: (-kv[1], kv[0]))[:ROTATION]]
    if not pool:
        return None
    order = sorted(pool)
    idx = day.toordinal() % len(order)
    k = order[idx]
    return {"archetype": k, "name": name_of(k), "why": why,
            "record": _record(defs.get(k)), "recent": _recent(recent.get(k)),
            "rotation": {"index": idx + 1, "of": len(order),
                         "names": [name_of(a) for a in order],
                         "next": name_of(order[(idx + 1) % len(order)])}}


def _record(d: dict | None) -> dict | None:
    if not d:
        return None
    return {"battles": int(d["battles"]), "winRate": d["winRate"], "deficit": d["deficit"]}


def _recent(r: dict | None) -> dict | None:
    if not r or not r.get("battles"):
        return None
    return {"battles": r["battles"], "wins": r["wins"], "losses": r["losses"]}


#: Where a practice deck came from, nearest to the player first.
#:   their-cards   five or more cards shared with ONE deck they pilot
#:   known-cards   five or more of its cards are cards they play somewhere
#:   field         neither -- the pool's answer, and labelled as that
TIERS = (("their-cards", "familiar"), ("known-cards", "knowsCards"), ("field", None))


def practise(scored: list[dict], rate_vs, *, family_of=None,
             avoid_families=(), avoid_keys=(),
             counter: float = COUNTER_MIN, field_min: float = FIELD_MIN) -> dict | None:
    """The deck to bring into today's matchup.

    `scored` are `coach_daily`'s rows (each with `expectedWinRate` against the
    field and `affinity`); `rate_vs(row) -> {winRate, games, source} | None`
    is the row's record against the focus archetype; `family_of(row)` names
    its win condition (the archetype when not given).

    IN ORDER, AND EACH LINE IS A RULE:
      1. it counters the focus (`counter`) and still wins the field
         (`field_min`);
      2. its win condition is not one of `avoid_families` and the list is not
         one of `avoid_keys` -- what they were shown in their last sessions;
      3. their own cards first (`TIERS`), and within a tier the best against
         the focus.

    A TIER IS LEFT BEFORE A WIN CONDITION IS REPEATED. With only Mortar lists
    of their own beating Bridge Spam, the day after a Mortar day goes to a
    deck built from cards they play elsewhere rather than to Mortar again.

    `avoid_families` is one set per past session, NEWEST FIRST (a flat set is
    one session). When nothing in the whole pool satisfies all of them the
    OLDEST session is forgiven first, so the last thing given up is "not the
    win condition they had yesterday". The counter floor outlasts all of it: a
    real counter is repeated before a fresh deck that loses the matchup.
    `fresh` and `counters` say which of those happened.
    """
    fam = family_of or (lambda r: r.get("archetype") or "")
    rated = []
    for r in scored:
        m = rate_vs(r)
        if not m or m.get("winRate") is None:
            continue
        rated.append((r, m, fam(r)))
    if not rated:
        return None

    layers = avoid_families or ()
    if isinstance(layers, (set, frozenset)) or (layers and isinstance(next(iter(layers)), str)):
        layers = [set(layers)]
    layers = [set(s) for s in layers if s]
    every = set().union(*layers) if layers else set()
    ak = set(avoid_keys or ())

    # (needs the counter floor, needs the field floor, win conditions avoided,
    #  lists avoided) -- strictest first.
    passes = []
    for need_counter in (True, False):
        for k in range(len(layers), 0, -1):
            fams = set().union(*layers[:k])
            passes.append((need_counter, True, fams, ak))
            passes.append((need_counter, True, fams, set()))
        passes.append((need_counter, True, set(), ak))
        passes.append((need_counter, True, set(), set()))
    passes.append((False, False, set(), set()))

    for need_counter, need_field, fams, keys in passes:
        for source, flag in TIERS:
            best = None
            for r, m, f in rated:
                if flag and not (r.get("affinity") or {}).get(flag):
                    continue
                vs, field = float(m["winRate"]), float(r["expectedWinRate"])
                if need_counter and vs < counter:
                    continue
                if need_field and field < field_min:
                    continue
                if f in fams or (r.get("key") or "") in keys:
                    continue
                k = (vs, field, r.get("key") or "")
                if best is None or k > best[0]:
                    best = (k, r, m, f)
            if best is not None:
                _, r, m, f = best
                return {"row": r, "source": source, "family": f,
                        # Not a win condition or list from their last sessions.
                        "fresh": f not in every and (r.get("key") or "") not in ak,
                        "counters": float(m["winRate"]) >= counter,
                        "vsFocus": {"winRate": round(float(m["winRate"]), 1),
                                    "games": int(m.get("games") or 0),
                                    "basis": m.get("source")}}
    return None


def rising(move: dict | None, weak: set[str], limit: int = RISING_MAX) -> list[dict]:
    """The meta decks climbing this week, biggest climb first.

    Only a MEASURED movement, and only a deck that was on both boards: one
    that entered has no delta (`meta_history`'s fault 2) and is not a riser.
    `threatensYou` marks an archetype this player already loses to.
    """
    if not move or move.get("basis") != "measured":
        return []
    out = []
    for r in move.get("rows") or []:
        prev, delta, rd = r.get("previousUseRate"), r.get("useDelta"), r.get("rankDelta")
        if r.get("entered") or r.get("left") or not prev or delta is None or not rd or rd <= 0:
            continue
        if delta / prev < RISING_FLOOR:
            continue
        out.append({
            "deckHash": r.get("deckHash"),
            "cards": [c for c in (r.get("deckHash") or "").split(",") if c],
            "name": r.get("name") or "",
            "archetype": r.get("winCondition") or "other",
            "rank": r.get("rank"),
            "rankDelta": rd,
            "useRate": r.get("useRate"),
            "previousUseRate": prev,
            "winRate": r.get("winRate"),
            "threatensYou": (r.get("winCondition") or "") in weak,
        })
    out.sort(key=lambda x: (-x["rankDelta"], -(x["useRate"] or 0), x["name"]))
    return out[:limit]


def duel_answer(archetype: str, own_decks: list[dict], records_for, catalogue: list[dict],
                known: set[str], brain) -> dict | None:
    """The deck duel players win with against this win condition.

    The player's own duel deck first when it is proven (population evidence
    for the list, `duel_brain.own_answers`), then the population's strongest,
    leaning toward one built from their cards (`duel_brain.personal`). Only
    decks that clear `duel_brain.strong` — nothing weak is offered as "proven".
    """
    proj = {archetype: 1.0}
    own = brain.own_answers(proj, own_decks, records_for=records_for)
    if own:
        o = own[0]
        return {"cards": list(o["cards"]), "key": o["key"], "archetype": o["archetype"],
                "pick": "own", "duel": brain.public(o["duel"]),
                "theirGames": int(o.get("games") or 0), "known": 8}
    pop = brain.population_answers(proj, catalogue, limit=12)
    got = brain.personal(pop, known=known, slots=1)
    if not got:
        return None
    p = got[0]
    return {"cards": list(p["cards"]), "key": p["key"], "archetype": p["archetype"],
            "pick": "duel", "duel": brain.public(p["duel"]),
            "players": int(p.get("players") or 0), "known": int(p.get("known") or 0)}


def reference_day(day: str | None) -> _dt.date:
    """The day the session is for: `day` when given (YYYY-MM-DD), else today UTC."""
    if day:
        try:
            return _dt.date.fromisoformat(day[:10])
        except ValueError:
            pass
    return _dt.datetime.now(_dt.timezone.utc).date()


# ── The one impure function ───────────────────────────────────────────────────


def build(tag: str, day: _dt.date, *, defs: dict, threats: list[dict], scored: list[dict],
          pool, snap, board: dict, move: dict | None, own_cards: set[str],
          seat_pick, deck_key, overall: float = 50.0, brief: bool = False,
          record: bool = False) -> dict | None:
    """Today's session, from what `coach_daily.plan()` already has in hand.

    The only NEW reads are the player's own battles since yesterday (one short
    `coach_intel` pass), what they were served in their last sessions (a tiny
    file of its own, `coach_session_log`) and the duel index (a cached
    catalogue, and one indexed lookup of their own duel games). Each degrades
    to absent.

    `record` notes the deck as served. True only for a plan for TODAY: a coach
    reviewing a past day (`day=`) reads the history as it stood before that
    day and must not rewrite what the player was shown.
    """
    since = (day - _dt.timedelta(days=FRESH_DAYS - 1)).isoformat()
    try:
        import coach_intel
        recent_intel = coach_intel.report(tag, since, day.isoformat())
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        recent_intel = None
    rsum = (recent_intel or {}).get("summary") or {}
    recent = recent_record((recent_intel or {}).get("opponentArchetypes"))

    board_decks = [d for d in (board.get("decks") or []) if d.get("cards")]
    # ARCHETYPE TITLES, not deck names: a threat's `name` is one list's name
    # ("Hog Rider EQ"), and the focus is a whole win condition.
    import clash_data as cd
    arches = {t.get("archetype") for t in threats} | {d.get("winCondition") or "other"
                                                      for d in board_decks}
    names = {k: cd._archetype_title(k) for k in arches if k}

    f = focus(day, defs, recent, threats, names, overall=overall)
    weak = {k for k, d in defs.items() if float(d.get("deficit") or 0) > 0} - NOT_A_MATCHUP
    risers = rising(move, weak)
    for r in risers:
        ordered, art, inferred = seat_pick(r["cards"])[:3]
        r["cards"], r["art"], r["artInferred"] = ordered, art, inferred

    out = {
        "brain": BRAIN,
        "day": day.isoformat(),
        "since": since,
        "lastDays": {"battles": int(rsum.get("battles") or 0),
                     "wins": int(rsum.get("wins") or 0),
                     "losses": int(rsum.get("losses") or 0)},
        "focus": f,
        "practise": None,
        "against": None,
        "duel": None,
        "duelWeek": None,
        "rising": risers,
    }
    if f is None:
        return out
    arch = f["archetype"]
    f["rising"] = any(r["archetype"] == arch for r in risers)

    # PRACTISE: the pool's own record against the focus, per candidate.
    by_key = {deck_key(c.cards): c for c in pool}

    def rate_vs(row):
        c = by_key.get(row.get("key"))
        return c.profile.against(arch, snap) if c is not None else None

    # WHAT THEY WERE SHOWN BEFORE TODAY, so today's is a different win
    # condition. A deck's family is its win condition's NAME: the bot files
    # Minion Giant, Goblin Giant and Skeleton Barrel under one `other`, and
    # those are three different decks to the person practising them.
    def family_of(row):
        return cd.deck_title(row.get("archetype"), row.get("cards"))

    try:
        import coach_session_log as slog
        history = slog.recent(tag, day, sessions=AVOID_DECK_SESSIONS)
        avoid_fams, avoid_keys = slog.avoid(history, AVOID_FAMILY_SESSIONS, AVOID_DECK_SESSIONS)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        slog, history, avoid_fams, avoid_keys = None, [], set(), set()

    try:
        got = practise(scored, rate_vs, family_of=family_of,
                       avoid_families=avoid_fams, avoid_keys=avoid_keys)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        got = None
    if got:
        r = got["row"]
        ordered, art, inferred, filled = seat_pick(r["cards"])
        aff = r.get("affinity") or {}
        out["practise"] = {
            "key": r["key"], "name": r.get("name") or "", "archetype": r.get("archetype"),
            "family": got["family"],
            "cards": ordered, "art": art, "artInferred": inferred,
            **({"artFilled": filled} if filled else {}),
            "expectedWinRate": r["expectedWinRate"],
            "vsFocus": got["vsFocus"], "source": got["source"],
            "shared": aff.get("shared"), "known": aff.get("known"),
            "deckBattles": aff.get("deckBattles"),
            # Whether it is a win condition and list they have not been shown
            # in their last sessions, and how many sessions that was read from.
            "fresh": got["fresh"], "counters": got["counters"],
            "sessionsSeen": len(history),
        }
        if record and slog is not None:
            slog.record(tag, day, r["key"], got["family"], arch)

    # AGAINST: the meta's most-played list of that archetype, as fielded.
    of_arch = sorted((d for d in board_decks if (d.get("winCondition") or "other") == arch),
                     key=lambda d: -float(d.get("useRate") or 0.0))
    if of_arch:
        d = of_arch[0]
        mv = next((m for m in (move or {}).get("rows") or []
                   if m.get("deckHash") == d.get("deckHash")), None)
        out["against"] = {
            "name": d.get("name") or "", "cards": list(d["cards"]), "art": d.get("art") or {},
            "useRate": d.get("useRate"), "winRate": d.get("winRate"),
            "rankDelta": (mv or {}).get("rankDelta"), "entered": bool((mv or {}).get("entered")),
        }

    # DUELS: proven against this win condition, and their own week of duels.
    try:
        import duel_brain
        import duel_index
        if duel_index.available():
            wk = duel_index.iso_to_stamp((day - _dt.timedelta(days=DUEL_WEEK - 1)).isoformat())
            own = duel_index.player_decks(tag, wk)
            out["duelWeek"] = {"games": sum(d["games"] for d in own),
                               "wins": sum(d["wins"] for d in own), "days": DUEL_WEEK}
            cat = [d for d in duel_index.catalogue()
                   if cd.fillable_slots(d.get("cards")) >= cd.SPECIAL_SLOTS]
            ans = duel_answer(arch, own, lambda d: duel_index.records(d["cards"]), cat,
                              own_cards, duel_brain)
            if ans:
                ordered, art, inferred, filled = seat_pick(ans["cards"])
                ans.update(cards=ordered, art=art, artInferred=inferred)
                if filled:
                    ans["artFilled"] = filled
                ans["name"] = cd.deck_title(ans["archetype"], ordered)
                out["duel"] = ans
    except Exception:  # noqa: BLE001
        traceback.print_exc()

    if brief:
        # A roster row draws the focus and the practice deck; the rest keep
        # their figures and lose their card strips.
        for k in ("against", "duel"):
            if out[k]:
                for f2 in ("cards", "art", "artInferred", "artFilled"):
                    out[k].pop(f2, None)
        for r in out["rising"]:
            for f2 in ("cards", "art", "artInferred"):
                r.pop(f2, None)
    return out
