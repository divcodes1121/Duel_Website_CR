"""team_analysis.py — a roster read, or two rosters matched against each other.

Behind `#/teams`, which has TWO MODES and one scoring rule shared between them.

    MATCH PLAN     (`squads`)  both rosters. A folder per opponent holding the
                               decks THEY play and the decks YOUR squad answers
                               with, each labelled with the teammate who
                               already pilots it.

    SCOUTING REPORT (`scout`)  one roster — theirs. The same folders, but the
                               right-hand side is drawn from the archetype
                               REPRESENTATIVES rather than from a squad,
                               because there is no squad to draw from.

`analyze()` serves both; `blue_tags` empty IS scout mode. That is one function
rather than two on purpose — see THE TWO MODES SHARE ONE SCORER, below.

────────────────────────────────────────────────────────────────────────────
THE QUESTION THIS ANSWERS, AND THE ONE IT DOES NOT
────────────────────────────────────────────────────────────────────────────

Match Plan answers: *given what this opponent has actually been playing, which
deck that somebody on my team already knows how to pilot does best against that
spread?*

It does NOT answer "what is the best deck against this player", and the
difference is the whole design. The candidate pool is not the meta, not the
122-card space, and not a generated deck — it is exactly the decks the blue
squad has ALREADY PLAYED, with the games to prove it. A recommendation nobody
on the team can pilot is worth nothing on the day, and this project has already
measured what happens when it goes looking for decks that do not exist: Phases
17B and 18 closed exact retrieval and novel generation on ceilings, not on
model quality. See the README.

────────────────────────────────────────────────────────────────────────────
THE SCOUTING REPORT, AND WHY ITS POOL IS THE REPRESENTATIVES
────────────────────────────────────────────────────────────────────────────

With no blue roster the question changes to *what beats this?*, and the pool
has to come from somewhere. It is `deck_counter._representatives()` — the
most-observed real deck of each archetype — and NOT the meta board's top 50,
for the reason `_build_reps` already gives: the board excludes duel and
friendly modes by design, while every number scored here comes out of
`pair_matchup_agg`, which has no mode filter at all. Picking the deck from one
population and the figure beside it from another is the exact fault that note
was written about, and it would be a new instance of it rather than a new
feature.

It is also NOT a generated deck and NOT a deck nobody plays: a representative
is by construction the most-played list of its archetype, so it is a real deck
with a real record, which is what lets it carry an exact rung of the ladder
rather than falling to the archetype matrix on every row.

WHAT A SCOUT ROW CANNOT CARRY IS COMFORT. Nobody owns these decks, so there is
no owner, no games-piloted and no tiebreak — `comfort` and `owner` are `None`
and the ranking is the matchup and nothing else. Instead each row carries the
deck's OWN overall record (`overallWinRate`), so the reader can see how much of
the expected rate is this matchup and how much is simply a strong deck. A
recommendation with a hidden denominator is the thing this module exists not to
produce.

────────────────────────────────────────────────────────────────────────────
THE TWO MODES SHARE ONE SCORER
────────────────────────────────────────────────────────────────────────────

`_score` is unchanged between them, and that is the point rather than a saving.
The site already has one place where two screens could disagree about the same
two decks — the README's note on why this module reuses `matchup_ladder`
instead of reimplementing it — and a second scorer for the second tab would
recreate that fault INSIDE one screen, where it is even harder to notice: the
same deck against the same opponent would read differently depending on which
tab you were standing in.

────────────────────────────────────────────────────────────────────────────
HOW A RECOMMENDATION IS SCORED
────────────────────────────────────────────────────────────────────────────

For an opponent, their decks in the window give an ARCHETYPE SPREAD — each
archetype weighted by how much of their play it is. Then for each candidate
deck from the blue squad:

    expectedWinRate = sum over archetypes a of  weight[a] * winRate(deck vs a)

`winRate(deck vs a)` is `deck_counter.matchup_ladder`, unchanged and not
reimplemented: exact deck-vs-archetype first, then the 7-card cluster, then the
6-card, then the archetype matrix. Every rung is symmetrised upstream, which is
what removes the 58.59% tracked-player house edge, and every rung says which it
is — so a recommendation carries the evidence it was made on rather than a bare
number.

COMFORT IS A TIEBREAK, NOT A MODEL. A deck the owner has played 40 times gets
at most `COMFORT_WEIGHT` points over one played 5 times, and no candidate
enters at all below `MIN_COMFORT_GAMES`. That ordering is deliberate: matchup
first because it is what was asked, comfort second because between two decks
inside the noise the one somebody has actually piloted is the better call.
The weight is a tiebreak sized to lose to any real matchup difference — it is
not a claim that practice is worth 1.5 points of win rate.

────────────────────────────────────────────────────────────────────────────
COST, AND THE CACHE THAT WOULD OTHERWISE THRASH
────────────────────────────────────────────────────────────────────────────

`matchup_ladder` reads `deck_profile` and two `cluster_profile`s. Those are
LRU-cached upstream at 64 and 32 entries — sized for a screen looking at one
deck, not for 40 candidates scored against 8 opponents. Looping opponents on
the outside would evict every candidate's profile on every opponent and turn
~240 memory lookups into ~240 database reads on a spinning volume.

So every candidate's three profiles are built ONCE into a run-local scorecard
(`_DeckProfile`) before any opponent is scored, and the scoring loop reads
memory only. The upstream caches are left alone rather than resized: they are
correct for their own screen, and a run here should not change how the Deck
Counter behaves afterwards.
"""

from __future__ import annotations

import datetime
import os
import traceback
from concurrent.futures import ThreadPoolExecutor

import clash_data as cd
import deck_counter as dcx
import duel_combos as dx
import live_player as live
import team_scout as scout
import tracking

#: The composition veto, if the deployment has it. IMPORTED SOFTLY, the same
#: rule `coach.tune` follows: `deck_harmony` loads three JSON files at import
#: and a deployment missing `cardRoles.json` must cost the variant filter and
#: nothing else. With no veto the projection still runs; it simply cannot drop
#: an incoherent seed, and every seed is a real deck with 60+ games anyway.
try:
    import deck_harmony as _harmony
    _VETO = _harmony.veto
except Exception:  # noqa: BLE001 - deployment shape
    _VETO = None

# ── Floors ──────────────────────────────────────────────────────────────────

#: Squad size cap per side. Mirrors `MAX_SQUAD` in `src/utils/squadParse.ts`,
#: and the mirror is load-bearing: the client REFUSES a roster over the cap,
#: this file SLICES one. A client that permits more than this does not get an
#: error, it gets a report with the tail of its roster missing and nothing
#: saying so. The two constants move in the same change, always.
#:
#: TWELVE, RAISED FROM TEN 2026-09-21 (and from eight 2026-08-30), because
#: that is what the account holder's rosters actually are: "most of the
#: rosters have 10-12 members". A cap under the real input only asks the
#: person to decide which opponents do not matter.
#:
#: THE CAP WAS NOT RAISED UNTIL THE COST WAS FIXED. Before `cluster_index`, a
#: 5v5 took 150-210 s, 97% of it profiling the blue squad's decks one after
#: another, and 12v12 would have been ~9 minutes. Profiling is now a
#: precomputed lookup on a thread pool and players resolve in parallel, so the
#: bill grows with the roster in milliseconds rather than seconds. The scoring
#: loop is `blue x red` in memory: 144 pairs, not 100.
MAX_SQUAD = 12

#: Threads for the two fan-outs below: resolving roster players and profiling
#: the squad's decks. Both are I/O (SQLite and the CR API release the GIL).
#: ONE POOL FOR THE PROCESS, not one per request, so two big rosters analysed
#: at once share eight threads instead of each taking eight — the service also
#: answers every other screen, and a Team Analysis must not starve them.
_POOL = ThreadPoolExecutor(
    max_workers=int(os.getenv("CLASH_TEAM_THREADS", "8")),
    thread_name_prefix="team",
)

#: Games a blue deck needs before it can be recommended at all. Below this it
#: is not a deck somebody plays, it is a deck somebody tried.
MIN_COMFORT_GAMES = 5

#: Games at which comfort stops accruing. Beyond this more reps do not make a
#: deck more recommendable; they only make it better evidenced, which the
#: matchup half already accounts for.
COMFORT_FULL = 25

#: The most a fully-practised deck may gain over a barely-practised one, in
#: points of expected win rate. Sized to lose to any real matchup difference.
COMFORT_WEIGHT = 1.5

#: How many blue decks a folder recommends.
#:
#: WAS 3, AND THE NUMBER WAS NEVER THE PROBLEM — the reasoning behind it was.
#: Three decks chosen against an opponent model made only of their observed
#: history is three answers to the easy case. Now that `_threats()` projects
#: variants and inferred archetypes as well, there are genuinely different
#: things to prepare for, and a portfolio has room for a counter to their core,
#: something robust across its variants, and a contingency for what they have
#: not shown. `scout.diversify` decides the actual count between
#: `MIN_RECOMMENDATIONS` and this; it is allowed to come back short rather than
#: pad the list with decks nobody should prepare.
TOP_N = scout.MAX_RECOMMENDATIONS

#: Per teammate, on the match-plan board — AND the Coach Roster's What-to-play
#: tab, which reads `perPlayer[0]` and is where this number is actually felt.
#:
#: SEVEN, THE SAME AS THE SQUAD-WIDE LIST (was 5, and 3 before that). Raised on
#: the account holder's request (2026-09-21). The board stays readable at ten
#: teammates because every row is COLLAPSED until opened — the seven decks are
#: behind one row per player, not seven rows each on screen at once.
PER_PLAYER_TOP_N = 7

#: How many decks a SCOUT folder recommends.
#:
#: THE SAME AS `TOP_N` NOW, AND THE DISTINCTION DISSOLVING IS THE CHANGE.
#: It used to be larger: match plan showed three as a HEADLINE over a
#: per-teammate board, and a scouting report — which has no players to split
#: by — showed five because those five were the entire answer. Both are
#: portfolios drawn from the same projection now, sized by `scout.diversify`
#: between `MIN_RECOMMENDATIONS` and this, so there is nothing left for the two
#: numbers to disagree about. They are kept as two names because `limits`
#: publishes both and a client reading `scoutTopN` should not break.
#:
#: The per-teammate board keeps its own, smaller number — see
#: `PER_PLAYER_TOP_N`, whose argument was about the board and not the model.
SCOUT_TOP_N = scout.MAX_RECOMMENDATIONS

#: Opponent decks shown on the left of a folder, and the spread they weight.
#: Their long tail is noise for this purpose: a deck played once tells you
#: nothing about what they will bring to a match.
OPPONENT_DECKS = 6

#: THIS FLOOR NOW APPLIES ONLY TO THE DISPLAYED SPREAD, NOT TO THE PROJECTION.
#:
#: It used to gate the opponent model itself, and that was the quiet fault at
#: the centre of this screen: `_spread` dropped every deck under two games and
#: then RENORMALISED, which handed the dropped mass straight back to the decks
#: they played most. The less history there was, the more confident the model
#: became. `scout.threat_space` keeps the whole tail and expresses a one-game
#: deck as a small weight instead, which is what it is.
MIN_OPPONENT_DECK_GAMES = 2

#: Seeds per archetype the SCOUT pool draws from. The full pool is 40 x ~17;
#: this trims it to the most-played dozen of each, which is ~200 real decks
#: and still two orders of magnitude wider than the one-representative-per-
#: archetype pool it replaces.
#:
#: IT COSTS NO DATABASE READS. A seed arrives from the snapshot carrying its
#: own per-archetype record, so a scout candidate is scored straight off that
#: rather than through `_DeckProfile`'s three queries — which is the only
#: reason a pool this size can sit on a request at all.
SCOUT_SEEDS_PER_ARCHETYPE = 12

#: Candidate decks taken from each blue player, best-played first. A cap
#: exists because the candidate pool is what the run's cost is linear in.
CANDIDATES_PER_PLAYER = 8

#: Default window, matching every other player screen.
DEFAULT_DAYS = 30


# ── Resolving a roster ──────────────────────────────────────────────────────


def _player_window(tag: str, days: int) -> tuple[str | None, str | None, dict]:
    """`(since, until, coverage)` for one tag.

    Counted back from THAT PLAYER'S OWN last stored battle, which is the
    site-wide convention (`app._window`) and matters more here than anywhere
    else: a roster is eight people with eight different last-played dates, and
    a single window counted from today would silently empty the screen for
    whoever was on holiday.
    """
    cov = cd.coverage(tag)
    if not cov.get("end"):
        return None, None, cov
    end = datetime.date.fromisoformat(cov["end"])
    since = (end - datetime.timedelta(days=max(1, days) - 1)).isoformat()
    return since, cov["end"], cov


def _live_decks(rep: dict) -> list[dict]:
    """The live battlelog's deck rows, renamed to `player_report`'s field names.

    A TRANSLATION AND NOTHING MORE. The two readers already agree about the
    substance — both arrange the deck through `cd.arrange_deck`, both classify
    it through the shared `archetype_of` — and they disagree only about what
    the columns are called (`games`/`archetype` here, `matches`/`winCondition`
    there). Everything downstream reads one shape, so the live/stored split
    stops existing past this function; `basis` is what carries the thinness on
    to the screen.
    """
    out = []
    for i, d in enumerate(rep.get("decks") or []):
        games = int(d.get("games") or 0)
        wins = int(d.get("wins") or 0)
        out.append({
            "rank": i + 1,
            "name": d.get("name"),
            "deckHash": d.get("hash") or ",".join(sorted(d.get("cards") or [])),
            "cards": list(d.get("cards") or []),
            "useRate": d.get("useRate") or 0.0,
            "winRate": d.get("winRate") or 0.0,
            "matches": games,
            "wins": wins,
            "losses": max(0, games - wins),
            "avgElixir": None,
            "winCondition": d.get("archetype"),
            "lastSeen": d.get("lastSeen"),
            "art": d.get("art") or {},
            "inferredArt": d.get("inferredArt", False),
        })
    return out


def _resolve(tag: str, days: int) -> dict:
    """One roster entry, from whichever source can actually answer for it.

    THREE OUTCOMES, and the screen must be able to tell them apart:

      * `stored`  — the bot has been collecting this player. The real thing.
      * `live`    — nobody has ever tracked them, so the ~25-battle CR API log
                    answers *now* and the tag is queued for collection. Thin,
                    and labelled thin.
      * `unknown` — not tracked and the live API could not be reached either.
                    No decks, no folder content, and the reason said out loud.

    Enrolment is a side effect of being named in a squad, exactly as it is a
    side effect of being searched (`app._enrol`). It writes to OUR queue file,
    never to the bot's database — see tracking.py for why that distinction is
    the whole design.
    """
    since, until, cov = _player_window(tag, days)

    report = None
    try:
        report = cd.player_report(tag, since, until)
    except Exception:  # noqa: BLE001
        traceback.print_exc()

    # Enrolment never takes a screen down with it.
    try:
        st = tracking.status(tag)
        if not st["tracked"] and not st["requested"]:
            tracking.request(tag, "team")
            st = tracking.status(tag)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        st = {"tag": tag, "state": "unknown", "tracked": False, "requested": False}

    if report and (report.get("decks") or report["player"]["battles"]):
        p = report["player"]
        return {
            "tag": tag,
            "name": p.get("name") or tag,
            "basis": "stored",
            "battles": p.get("battles") or 0,
            "winRate": round(100 * (p.get("wins") or 0) / p["battles"], 1)
            if p.get("battles") else 0.0,
            "decks": report.get("decks") or [],
            "coverage": cov,
            "window": {"from": since, "to": until},
            "tracking": st,
        }

    rep = None
    try:
        rep = live.report(tag)
    except Exception:  # noqa: BLE001
        traceback.print_exc()

    if rep is None:
        return {
            "tag": tag, "name": tag, "basis": "unknown", "battles": 0,
            "winRate": 0.0, "decks": [], "coverage": cov,
            "window": {"from": since, "to": until}, "tracking": st,
        }

    # `live.report` is FLAT — no `player` object — so the figures come off the
    # top level, and it carries no NAME at all. A roster of eight "#Y022GRCJQ"
    # chips is unreadable, and the profile call that supplies the name is one
    # extra request on a path that has already made one, only for players
    # nobody is tracking. `player_name` is tried first because it is a database
    # hit and free.
    name = None
    try:
        name = cd.player_name(tag)
        if not name:
            prof = cd.cr_profile(tag)
            name = (prof or {}).get("name")
    except Exception:  # noqa: BLE001
        name = None

    return {
        "tag": tag,
        "name": name or tag,
        "basis": "live",
        "battles": rep.get("battles") or 0,
        "winRate": rep.get("winRate") or 0.0,
        "decks": _live_decks(rep),
        "coverage": cov,
        "window": {"from": since, "to": until},
        "tracking": st,
    }


# ── Seating: every deck on this screen obeys the three-slot rule ───────────


def _seat_decks(decks: list[dict], seat) -> None:
    """Seat any eight-card deck that has no art yet, in place.

    `player_report` seats only its top ten decks (the art lookup is per deck),
    and every seed arrives alphabetical and bare. Both used to reach the screen
    that way — slot 1 holding whatever sorted first, no evolution frame, no
    hero, a champion in slot 6 — while the deck beside them was drawn properly.
    A deck that already carries art has been seated from real observations and
    is left exactly as it is.
    """
    for d in decks:
        cards = d.get("cards") or []
        if d.get("art") or len(set(cards)) != 8:
            continue
        d["cards"], art, inferred = seat(cards)
        d["art"] = art
        if art and inferred:
            d["artInferred"] = True


# ── Archetypes, resolved in bulk ────────────────────────────────────────────


def _archetypes_for(decks: list[dict]) -> None:
    """Fill `winCondition` and `name` on deck rows, in place.

    `player_report` already carries `winCondition` for a deck the bot has a row
    for, so most of these are free. Only live rows and never-seen lists fall
    through to `dcx.archetype_of`, which costs a query each — bounded by the
    deck caps above, so a roster cannot turn into an unbounded scan.
    """
    for d in decks:
        wc = d.get("winCondition")
        if not wc:
            try:
                wc = dcx.archetype_of(list(d.get("cards") or []))
            except Exception:  # noqa: BLE001
                wc = "other"
            d["winCondition"] = wc
        if not d.get("name"):
            d["name"] = dcx._label(wc)


def _spread(decks: list[dict]) -> list[dict]:
    """An opponent's archetype spread: what they play, and how much of it.

    Weights are the SHARE OF THE DECKS CONSIDERED, renormalised, rather than
    the raw `useRate` — the tail below `MIN_OPPONENT_DECK_GAMES` has been cut,
    and leaving the weights summing to less than 1 would quietly shrink every
    expected win rate computed from them toward zero.
    """
    per: dict[str, int] = {}
    for d in decks:
        n = int(d.get("matches") or 0)
        if n < MIN_OPPONENT_DECK_GAMES:
            continue
        wc = d.get("winCondition") or "other"
        per[wc] = per.get(wc, 0) + n
    total = sum(per.values())
    if not total:
        return []
    out = [
        {"archetype": wc, "name": dcx._label(wc), "style": dcx.style_of(wc),
         "games": n, "weight": n / total, "share": round(100 * n / total, 1),
         # A SPREAD IS ALSO A VALID THREAT LIST, and that is deliberate rather
         # than incidental. `_score` iterates `likelihood` and reads `evidence`
         # now, so the same function serves the displayed archetype breakdown
         # and the real projection and there is exactly one scorer. Without
         # these three keys there would be two, which is the fault this module
         # already avoids between its own two modes.
         "key": f"archetype:{wc}", "evidence": scout.OBSERVED,
         "likelihood": n / total}
        for wc, n in per.items()
    ]
    out.sort(key=lambda s: (-s["games"], s["archetype"]))
    return out


def _threats(decks: list[dict], seeds: dict | None) -> dict:
    """The projection: what this opponent is likely to BRING.

    The displayed `spread` above says what they HAVE played, as archetype
    shares. This says what they are likely to bring, as a distribution over
    actual decks — their own, real variants of them, and archetypes their
    behaviour implies. The two are different questions and the screen shows
    both; only this one is scored against.

    `seeds` is `deck_counter.seeds()`, which is snapshot data and costs no
    query. With none — a deployment whose snapshot predates the seed pool —
    `threat_space` returns the observed decks alone, which is exactly the old
    behaviour, stated as a degradation rather than arrived at silently.
    """
    out = scout.threat_space(decks, seeds, veto=_VETO)

    # VARIANTS AND INFERRED THREATS ARE SEEDS, and a seed's cards are its hash
    # split on commas — alphabetical, with `art: {}` because `team_scout` has
    # no imports and cannot seat them. Seated here, where the vocabulary is.
    _seat_decks(out.get("threats") or [], dcx.seater())

    # THE ARCHETYPE KEY IS NOT ITS NAME, and a screenshot is what caught it.
    # `team_scout` has no imports by design, so it cannot reach `_label` and
    # leaves `name` empty on anything it generates; the client falls back to
    # the archetype, and the projection printed "xbow", "bridge-spam" and
    # "drill" in a list whose OBSERVED rows said "X-Bow", "Royal Hogs" and
    # "Hog Rider". Two naming conventions in one column, and the raw one
    # landed on exactly the rows a reader is least sure about.
    #
    # Filled here rather than in the brain because this is the module that
    # already owns the vocabulary — `_archetypes_for` does the same job for
    # the decks on the left of the folder.
    for th in out.get("threats") or []:
        if not th.get("name"):
            th["name"] = dcx._label(th.get("archetype") or "other")
        if th.get("basis") and not th.get("basisName"):
            th["basisName"] = dcx._label(th.get("archetype") or "other")
    return out


# ── The candidate pool, profiled once ───────────────────────────────────────


class _DeckProfile:
    """The three expensive reads for ONE deck list, held in memory.

    KEYED BY THE DECK, NOT BY THE PLAYER, which is the whole reason it is
    separate from `_Candidate`. Two teammates on the same list is common; the
    profiles are a property of the eight cards and must not be read twice
    because two people happen to play them.

    See the module docstring for why they are read up front at all: the ladder's
    caches are LRU 64/32 upstream, sized for a screen looking at one deck, and
    scoring opponents on the outside of the loop would evict them every pass.
    """

    __slots__ = ("archetype", "_exact", "_c7", "_c6", "_c7_decks", "_c6_decks",
                 "overall")

    def __init__(self, cards: list[str], archetype: str):
        self.archetype = archetype
        exact = dcx.deck_profile(cards)
        self._exact = exact.get("archetypes") or {}
        c7 = dcx.cluster_profile(cards, 7)
        c6 = dcx.cluster_profile(cards, 6)
        self._c7 = c7.get("archetypes") or {}
        self._c6 = c6.get("archetypes") or {}
        self._c7_decks = c7.get("decks")
        self._c6_decks = c6.get("decks")
        # THIS DECK'S OWN RECORD ACROSS THE WHOLE FIELD, widened the same way
        # the per-archetype rungs are. It is what a scout row quotes beside its
        # expected rate, so a reader can tell "this beats them" from "this
        # beats everybody" — two very different reasons for a deck to top a
        # ranking, and the headline alone cannot separate them.
        #
        # It is read here rather than where it is used because it comes off a
        # profile that is already in hand; asking for it later would re-enter
        # the LRU that this whole class exists to stop thrashing.
        self.overall = (exact.get("overall")
                        or c7.get("overall") or c6.get("overall"))

    def against(self, other: str, snap: dict | None) -> dict | None:
        """This deck versus one archetype, narrowest evidence first.

        The same ladder `deck_counter.matchup_ladder` walks, read from the
        profiles already in hand. Order is load-bearing and matches upstream:
        this exact deck, then near-identical decks at 7 and 6 shared cards,
        then the archetype matrix.
        """
        m = self._exact.get(other)
        if m:
            return {"source": dcx.SOURCE_DECK, "decks": 1, **m}
        m = self._c7.get(other)
        if m:
            return {"source": dcx.SOURCE_C7, "decks": self._c7_decks, **m}
        m = self._c6.get(other)
        if m:
            return {"source": dcx.SOURCE_C6, "decks": self._c6_decks, **m}
        if snap:
            m = dcx._symmetric(snap, self.archetype, other)
            if m:
                return {"source": dcx.SOURCE_ARCHETYPE, "decks": None, **m}
        return None


class _SeedProfile:
    """A snapshot seed's own records, behind `_DeckProfile`'s interface.

    WHY THIS EXISTS AT ALL: the scouting pool used to be
    `deck_counter._representatives()` — ONE deck per archetype, seventeen in
    total — and a pool that small cannot produce a portfolio. Widening it to
    the seed pool (forty real decks per archetype) through `_DeckProfile` would
    cost three database reads each, six hundred on a request that answers in
    1.5 s warm today, and would thrash a cluster cache that holds 32 entries
    and CLEARS ITSELF WHOLE on overflow.

    A seed does not need them. `deck_counter._build_seeds` already attached
    each one's per-archetype record on the background snapshot thread, from the
    same symmetrised pass over `pair_matchup_agg` that `deck_profile` reads. So
    the figures are the same figures, and this class costs NO QUERY AT ALL.

    IT REPORTS `SOURCE_DECK`, WHICH IS WHAT IT IS — this exact list against
    that archetype — and falls to the archetype matrix when the seed has no
    record for an archetype, exactly as the real ladder does. It cannot offer
    the two cluster rungs, because a seed carries no cluster; that is a real
    narrowing of the evidence and it is visible in the `source` on every row
    rather than hidden behind a rung that was never read.
    """

    __slots__ = ("archetype", "_records", "overall")

    def __init__(self, seed: dict, archetype: str):
        self.archetype = archetype
        self._records = seed.get("archetypes") or {}
        games = int(seed.get("games") or 0)
        wins = sum(int(r.get("wins") or 0) for r in self._records.values())
        decided = sum(int(r.get("wins") or 0) + int(r.get("losses") or 0)
                      for r in self._records.values())
        self.overall = ({"winRate": round(100 * wins / decided, 1),
                         "games": games} if decided else None)

    def against(self, other: str, snap: dict | None) -> dict | None:
        m = self._records.get(other)
        if m:
            return {"source": dcx.SOURCE_DECK, "decks": 1, **m}
        if snap:
            m = dcx._symmetric(snap, self.archetype, other)
            if m:
                return {"source": dcx.SOURCE_ARCHETYPE, "decks": None, **m}
        return None


class _Candidate:
    """One deck AS PLAYED BY ONE PLAYER: the profile, plus that player's record.

    ONE PER (PLAYER, DECK) PAIR, and the pool is no longer deduplicated across
    players. It was, and that was a real bug once the screen started answering
    "what should THIS teammate bring": a shared list was kept for whoever had
    played it more, so the other player simply could not be offered the deck
    they actually play. Dedup now happens WITHIN a player, where a repeated
    list really is one option.

    The profile is shared by reference, so a deck two people play is still only
    read from the database once.

    `owner` IS `None` IN SCOUT MODE, and that is a real state rather than a
    missing value: an archetype representative is nobody's deck. Everything
    that reads it — the comfort tiebreak, the "who plays it" line — is absent
    for those rows rather than defaulted, because a zero games-piloted figure
    would read as "somebody on the team has played this none of the time",
    which is a claim about a team that was never pasted.
    """

    __slots__ = ("cards", "key", "archetype", "name", "art", "inferred", "owner",
                 "games", "wins", "win_rate", "use_rate", "profile")

    def __init__(self, deck: dict, owner: dict | None, profile: "_DeckProfile"):
        self.cards = list(deck.get("cards") or [])
        self.key = ",".join(sorted(set(self.cards)))
        self.archetype = deck.get("winCondition") or "other"
        self.name = deck.get("name") or dcx._label(self.archetype)
        self.art = deck.get("art") or {}
        # Both spellings exist upstream: `player_report` says `artInferred`,
        # the live log and the representatives say `inferredArt`.
        self.inferred = bool(deck.get("artInferred") or deck.get("inferredArt"))
        self.owner = owner
        self.games = int(deck.get("matches") or 0)
        self.wins = int(deck.get("wins") or 0)
        self.win_rate = float(deck.get("winRate") or 0.0)
        self.use_rate = float(deck.get("useRate") or 0.0)
        self.profile = profile

    def against(self, other: str, snap: dict | None) -> dict | None:
        return self.profile.against(other, snap)


def _candidates(blue: list[dict]) -> list["_Candidate"]:
    """Every (player, deck) pair the blue squad can actually pilot.

    NOT DEDUPLICATED ACROSS PLAYERS. It used to be — a shared list was kept for
    whoever had played it more — and that quietly made the per-player view
    impossible: the other teammate could not be offered the deck they actually
    play. Two people on one archetype is normal, and for a lineup they are two
    separate options, because two different people have to pilot them.

    Deduplication WITHIN a player still happens, via the deck key: one person
    listed twice on one list is one option.

    Profiles are shared by deck key, so a list two teammates both play still
    costs one set of database reads rather than two.
    """
    # PASS 1: which (player, deck) pairs qualify, and which distinct decks
    # they need profiled. No reads yet.
    wanted: list[tuple[dict, dict, str]] = []
    first: dict[str, tuple[list[str], str]] = {}
    for player in blue:
        decks = [d for d in (player.get("decks") or [])
                 if len(set(d.get("cards") or [])) == 8]
        decks.sort(key=lambda d: -int(d.get("matches") or 0))
        seen: set[str] = set()
        for deck in decks[:CANDIDATES_PER_PLAYER]:
            if int(deck.get("matches") or 0) < MIN_COMFORT_GAMES:
                continue
            key = ",".join(sorted(set(deck["cards"])))
            if key in seen:
                continue
            seen.add(key)
            wanted.append((player, deck, key))
            first.setdefault(key, (deck["cards"], deck.get("winCondition") or "other"))

    # PASS 2: every distinct deck profiled ONCE, on the pool. This was the
    # whole cost of the screen — 36 decks one after another took 206 s of a
    # 208 s 5v5 — and each profile is independent reads of its own deck.
    def make(item):
        key, (cards, arch) = item
        try:
            return key, _DeckProfile(cards, arch)
        except Exception:  # noqa: BLE001 - one bad deck must not sink the roster
            traceback.print_exc()
            return key, None

    profiles = dict(_POOL.map(make, list(first.items())))

    # PASS 3: the candidates, in the original roster-and-deck order, which the
    # tiebreaks downstream rely on.
    out: list["_Candidate"] = []
    for player, deck, key in wanted:
        prof = profiles.get(key)
        if prof is None:
            continue
        try:
            out.append(_Candidate(deck, player, prof))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    return out


#: The scout pool, kept between requests as `(snapshot age key, candidates)`.
#:
#: WHY THIS IS CACHED AT ALL, when the blue pool deliberately is not: the blue
#: pool is different on every request (it is somebody's roster), and the scout
#: pool is the SAME SEVENTEEN DECKS every time. Rebuilding it per request would
#: pay ~1.6 s of sibling scan per deck for an answer that cannot have changed.
#:
#: KEYED ON THE COUNTER SNAPSHOT, because that is the only thing that can move
#: it: `_representatives()` reads `snapshot["reps"]`, so a rebuild is exactly
#: when these decks may differ and nothing else is. A time-based TTL here would
#: be a second, weaker statement of the same fact and could disagree with it.
_SCOUT_POOL: tuple[object, list["_Candidate"]] | None = None


def _scout_candidates() -> list["_Candidate"]:
    """The scouting report's pool: real decks out of the snapshot's seeds.

    WAS ONE DECK PER ARCHETYPE — `deck_counter._representatives()`, seventeen
    in total. That is why the old scouting report could only ever be a ranking
    of archetypes wearing deck art: with one candidate per archetype there is
    no such thing as a variant, a second opinion inside an archetype, or a
    portfolio. Asking it for five recommendations returned the five best
    archetypes, which is a different and much weaker answer than five decks.

    NOW `SCOUT_SEEDS_PER_ARCHETYPE` PER ARCHETYPE, ~200 real lists, every one
    with 60+ games and its own per-archetype record already attached by the
    background snapshot thread.

    IT COSTS NO DATABASE READS, which is the only reason a pool this size can
    sit on a request. See `_SeedProfile` for why, and for what evidence is
    given up in exchange (the two cluster rungs, which a seed has no cluster
    for and which the `source` on every row now says plainly).

    THE REPRESENTATIVES ARE STILL FIRST. `_build_seeds` sorts each archetype's
    list by games, so seed[0] IS the most-played deck of that archetype — the
    same deck `_representatives()` returned. Nothing was lost; the tail was
    added behind it.

    FALLS BACK TO THE REPRESENTATIVES when the snapshot predates the seed pool.
    A deployment mid-upgrade gets the old, narrower answer rather than an empty
    screen, and the pool size is published so the difference is visible.
    """
    global _SCOUT_POOL

    snap = dcx._snap()
    # The snapshot's own build time IS the identity of the pool. `None` when
    # there is no snapshot at all, which is a state the caller has to report
    # rather than serve an empty ranking for.
    key = (snap or {}).get("computedAt")
    if key is None:
        return []
    if _SCOUT_POOL is not None and _SCOUT_POOL[0] == key:
        return _SCOUT_POOL[1]

    out: list["_Candidate"] = []
    seeds = dcx.seeds() or {}
    # A seed is its hash split on commas — alphabetical and bare. Seated once
    # here, with the pool, so every "Deckkies pick" and every scouting row is
    # drawn evolution / hero / wild like the rest of the site.
    seat = dcx.seater()

    for arch, decks in seeds.items():
        for seed in decks[:SCOUT_SEEDS_PER_ARCHETYPE]:
            cards = list(seed.get("cards") or [])
            if len(set(cards)) != 8:
                continue
            try:
                prof = _SeedProfile(seed, arch)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                continue
            cards, art, inferred = seat(cards)
            out.append(_Candidate(
                {
                    "cards": cards,
                    "art": art,
                    "inferredArt": inferred,
                    "winCondition": arch,
                    "name": dcx._label(arch),
                    # No owner means no games piloted and no win rate of
                    # anyone's own. Left at zero rather than invented; `_score`
                    # never reads them for an ownerless candidate.
                    "matches": 0, "wins": 0, "winRate": 0.0, "useRate": 0.0,
                },
                None,
                prof,
            ))

    if not out:
        # THE PRE-SEED SNAPSHOT PATH, kept because a deployment can be mid
        # upgrade. `_DeckProfile` here is the expensive read, and it is
        # affordable only because this pool is seventeen decks.
        #
        # THE PROFILES ARE BUILT IN ONE PASS AND HELD, which is required rather
        # than an optimisation: `_CLUSTER_CACHE` upstream is 32 entries and
        # CLEARS ITSELF WHOLE when it overflows, and seventeen decks at two
        # cluster levels is thirty-four. That costs nothing while the build
        # walks each deck once and never returns to it, and it would cost a
        # full rescan per deck if anything ever looped opponents on the
        # outside. Do not restructure this into "score each opponent, widening
        # as needed".
        for arch, rep in (dcx._representatives() or {}).items():
            cards = list(rep.get("cards") or [])
            if len(set(cards)) != 8:
                continue
            try:
                prof = _DeckProfile(cards, arch)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                continue
            out.append(_Candidate(
                {
                    "cards": cards, "art": rep.get("art") or {},
                    "inferredArt": rep.get("inferredArt", False),
                    "winCondition": arch,
                    "name": rep.get("name") or dcx._label(arch),
                    "matches": 0, "wins": 0, "winRate": 0.0, "useRate": 0.0,
                },
                None,
                prof,
            ))

    _SCOUT_POOL = (key, out)
    return out


def _comfort(games: int) -> float:
    """The tiebreak, in points. Linear to `COMFORT_FULL`, flat after."""
    if games <= 0:
        return 0.0
    return COMFORT_WEIGHT * min(1.0, games / COMFORT_FULL)


def _score(card: _Candidate, threats: list[dict], snap: dict | None) -> dict | None:
    """One candidate against a whole projected threat space.

    `threats` IS EITHER. A `_spread()` row carries `likelihood` and `evidence`
    now, so the displayed archetype breakdown and the real projection from
    `_threats()` are both valid inputs and there is one scorer for both. That
    matters more here than it looks: this module's own docstring records that
    a second scorer for the second tab would let the same deck read differently
    depending on which tab you stood in, and a second scorer for the second
    OPPONENT MODEL would be the same fault one level down.

    THE ARITHMETIC IS `team_scout.score` AND NOT A COPY OF IT. Everything below
    the call is presentation — the owner, the practice tiebreak, the art, and
    the two fields a scouting row carries instead of an owner. The decision of
    what a recommendation is worth lives in one file with no imports, where it
    can be tested against literals.

    Returns None when NOTHING in the projection could be answered. That is a
    real state on a thin database and it must not be rendered as 50.0%, which
    is what averaging over an empty set produces.
    """
    base = scout.score(
        lambda arch: card.against(arch, snap),
        threats,
        cards=card.cards,
        archetype=card.archetype,
        # NO OWNER MEANS NO FIT, and `None` rather than 0. An archetype
        # representative is nobody's deck, so there is nothing to be practised
        # at; publishing a zero would state that somebody has piloted it none
        # of the time, which is a claim about a roster that was never pasted.
        fit_games=card.games if card.owner else None,
    )
    if base is None:
        return None

    comfort = _comfort(card.games) if card.owner else 0.0

    # `scout.score` ranks on `playerFit` in [0, 1] scaled by `FIT_WEIGHT`,
    # which is the same quantity and the same weight `_comfort` produced in
    # points. Publishing the points as well keeps the existing contract: a
    # reader comparing two rows can still see whether the order came from the
    # matchup or from the practice.
    for row, t in zip(base["matchups"], threats):
        # The spread fields the client has always drawn, beside the new ones.
        row["share"] = t.get("share", round(100 * float(t.get("likelihood") or 0), 1))
        row["name"] = t.get("name") or row.get("name") or ""
        row["sourceText"] = dcx.SOURCE_TEXT.get(row.get("source"))

    out = dict(base)
    if card.art and card.inferred:
        out["artInferred"] = True
    out.update({
        "art": card.art,
        "name": card.name,
        "avgElixir": dcx._avg_elixir(card.cards),
        "owner": {"tag": card.owner["tag"], "name": card.owner["name"]}
        if card.owner else None,
        "comfort": {
            "games": card.games,
            "wins": card.wins,
            "winRate": card.win_rate,
            "useRate": card.use_rate,
            "bonus": round(comfort, 2),
        } if card.owner else None,
        # WHY THIS DECK IS ON THE LIST — counter, robust, or contingency. Read
        # from which KINDS of threat it actually beats, never from its rank.
        "type": scout.classify(base, threats),
    })
    out["explanation"] = scout.explain(out, threats)

    # THE DECK'S OWN RECORD ACROSS THE FIELD, for ownerless rows only. It is
    # the denominator the headline is missing on its own: a deck expected to
    # win 58% against this opponent while winning 57% against everybody is
    # barely a counter, and one at 58% against a 49% baseline is a real answer.
    overall = card.profile.overall if not card.owner else None
    if overall:
        out["overallWinRate"] = overall.get("winRate")
        out["overallGames"] = overall.get("games")
    return out


# ── The report ──────────────────────────────────────────────────────────────


def _distinct(rows: list[dict]) -> list[dict]:
    """One row per DECK, keeping the best-scoring owner of it.

    Only for the squad-wide headline. The per-player board WANTS the same deck
    to appear under each teammate who plays it; a "top 3 for the squad" that
    listed one deck three times under three names would be one option wearing
    three rows.
    """
    seen: set[str] = set()
    out = []
    for r in rows:
        key = ",".join(sorted(set(r["cards"])))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def _suggested(own: list[dict], pool, limit: int) -> list[dict]:
    """WHAT DECKKIES SUGGESTS TO PLAY: `own` and the population, ranked together.

    `scout.suggest` does the work — this only makes it safe to call from the
    board. `pool` is a callable so the population is scored once per folder,
    on first use, and never at all in a scouting report (whose candidate pool
    already IS the population).

    A FAILURE FALLS BACK TO THE OWNED DECKS ALONE, diversified. The population
    half is the part that reaches into the snapshot, and a snapshot problem
    must cost the suggestions it adds and not the decks the player already has.
    """
    try:
        return scout.suggest(own, pool(), limit=limit)
    except Exception:  # noqa: BLE001 - the population half must never take the board down
        traceback.print_exc()
        return scout.diversify(own, limit=limit, minimum=limit)


def _evidence_on_top(rows: list[dict], keep: int = 1) -> list[dict]:
    """`matchups` stays on the first `keep` rows only, and is dropped from the rest.

    THE PER-THREAT TABLE IS THE BULK OF THE PAYLOAD AND ALMOST NOTHING READS
    IT. One row per projected threat, ~4 kB per recommendation, and a 5v5
    match plan carries 5 folders x (7 + 5 x 7) of them — measured, 80% of a
    1.08 MB report. The screen stopped printing it (2026-09-21); the one reader
    left is the PDF, which prints the table for each folder's TOP pick. Keeping
    every copy made a saved 10v10 board ~4.6 MB, past what a browser will
    store, which is how "This board is too large to store in the browser" was
    reported.

    The rows are `diversify`'s COPIES, so this cannot reach into another list
    that shares a deck.
    """
    for row in rows[keep:]:
        row.pop("matchups", None)
    return rows


def _folder(opponent: dict, blue: list[dict], cards: list[_Candidate],
            snap: dict | None, top_n: int = TOP_N,
            seeds: dict | None = None) -> dict:
    """One opponent, and what should be brought against them.

    BOTH MODES COME THROUGH HERE. In a scouting report `blue` is empty, so
    `perPlayer` falls out empty on its own rather than being special-cased —
    the loop below has nothing to iterate. That is the whole reason the two
    modes are one function: the left-hand side of a folder (what they play) and
    the ranking of the right-hand side are identical work, and only the pool
    and the row count differ.
    """
    decks = (opponent.get("decks") or [])[:OPPONENT_DECKS]
    _archetypes_for(decks)
    # WHAT THEY HAVE PLAYED. Still shown, because a coach wants to see the
    # history as well as the projection, and still an archetype breakdown.
    spread = _spread(decks)
    # WHAT THEY ARE LIKELY TO BRING. The whole opponent's deck list goes in,
    # not the displayed six: the tail is small weight in a projection and it
    # was never noise, only weak evidence.
    projection = _threats(opponent.get("decks") or [], seeds)
    threats = projection["threats"]

    scored: list[dict] = []
    if threats:
        for card in cards:
            row = _score(card, threats, snap)
            if row:
                scored.append(row)
        # The second key is games piloted, which a scout row does not have —
        # `comfort` is None there and reading it subscripts a None. Falling
        # back to 0 keeps ownerless rows ordered by score then by name.
        scored.sort(key=lambda r: (-r["score"],
                                   -((r["comfort"] or {}).get("games") or 0),
                                   r["name"]))

    # EVERY BLUE PLAYER GETS THEIR OWN TOP THREE, in roster order.
    #
    # This is the shape the screen is built from. A team format assigns each
    # player a match, so the question is "what should Ravi bring against this
    # person", asked once per teammate — not "what are the three best decks on
    # the squad", which can legitimately all belong to one person and leaves
    # everyone else with nothing to play.
    #
    # A PLAYER WITH NOTHING TO OFFER STILL APPEARS, with a reason. Dropping
    # them would silently shorten the list and make a roster of five look like
    # a roster of three — the same failure as a parser that drops a tag.
    #
    # A SCOUT ROW HAS NO OWNER TO GROUP BY, and `blue` is empty there anyway,
    # so the grouping is skipped rather than made to tolerate a null key: a
    # bucket under `None` would be built and then never read, which is the kind
    # of dead structure that later reads as an intentional one.
    by_tag: dict[str, list[dict]] = {}
    for row in scored:
        if row["owner"]:
            by_tag.setdefault(row["owner"]["tag"], []).append(row)

    # THE POPULATION, SCORED ONCE PER FOLDER.
    #
    # Real decks out of the snapshot, ranked against THIS opponent's
    # projection. Not owner-specific — it is "what Deckkies would suggest
    # against this person" — so the same ranked list serves every teammate
    # and the squad-wide list. Scoring it per teammate would be ten identical
    # passes over ~200 candidates.
    #
    # LAZY, and never built in a scouting report: there the candidate pool
    # already IS the population, so `scored` is this list.
    _fill_pool: list[dict] | None = None

    def fill_pool() -> list[dict]:
        nonlocal _fill_pool
        if _fill_pool is None:
            scored_fills = []
            # NOT GATED ON `seeds`. That argument is the THREAT projection's
            # source; the fill CANDIDATES come from `_scout_candidates()`,
            # which falls back to the archetype representatives when the
            # snapshot predates the seed pool. Gating on `seeds` silently
            # switched fills off on exactly the deployment that needs them
            # most, and `_scout_candidates()` already returns [] when there is
            # no snapshot at all — which is the right degradation and says so.
            for card in _scout_candidates():
                row = _score(card, threats, snap)
                if row:
                    scored_fills.append(row)
            scored_fills.sort(key=lambda r: (-r["score"], r["name"]))
            _fill_pool = _distinct(scored_fills)
        return _fill_pool

    # THE SQUAD'S QUESTION, NOT FIVE COPIES OF ONE PLAYER'S. `scout.squad_plan`
    # assigns each teammate a different #1 from the options the evidence
    # cannot separate, chosen so the squad's #1s answer as many of this
    # opponent's archetypes as they can, leaning on cards each teammate
    # already plays. Measured before it (2026-09-25, live 5v1): one #1 for
    # all five, two identical lists, 12 distinct decks in 35 slots.
    #
    # A TEAMMATE'S CARDS ARE THE ONES IN DECKS THEY ACTUALLY RUN — the same
    # `MIN_COMFORT_GAMES` floor that decides which of their decks are
    # candidates, so "built out of your cards" and "a deck you play" cannot
    # disagree about what counts as playing it.
    plan_lists: dict[str, list[dict]] | None = None
    cover: list[dict] = []
    if blue and threats:
        try:
            squad = []
            for mate in blue:
                pool_cards: set[str] = set()
                for d in mate.get("decks") or []:
                    if int(d.get("matches") or 0) >= MIN_COMFORT_GAMES:
                        pool_cards.update(d.get("cards") or [])
                squad.append({"tag": mate["tag"],
                              "own": by_tag.get(mate["tag"], []),
                              "cards": pool_cards})
            plan_lists, cover = scout.squad_plan(squad, fill_pool(), threats,
                                                 limit=PER_PLAYER_TOP_N)
            names = {m["tag"]: m["name"] for m in blue}
            for c in cover:
                c["name"] = dcx._label(c["archetype"] or "other")
                c["player"] = names.get(c["tag"]) if c["tag"] else None
        except Exception:  # noqa: BLE001 - the old per-teammate lists are the fallback
            traceback.print_exc()
            plan_lists, cover = None, []

    per_player = []
    for mate in blue:
        rows = by_tag.get(mate["tag"], [])
        # `own`, NOT `decks`. Naming it `decks` rebound the opponent's list
        # eight lines above and `theirDecks` came back holding the LAST blue
        # player's decks — the left half of the board showing the wrong team.
        own = [d for d in (mate.get("decks") or [])
               if len(set(d.get("cards") or [])) == 8]
        per_player.append({
            "owner": {"tag": mate["tag"], "name": mate["name"]},
            "basis": mate["basis"],
            # WHAT DECKKIES SUGGESTS THIS TEAMMATE PLAYS: their own decks and
            # the population's, RANKED TOGETHER BY STRENGTH.
            #
            # That is `coach.suggest`'s sort, and an earlier build got it wrong
            # the other way: it appended population decks BELOW every owned
            # one and called that Coach Assist's rule. It was not — Coach
            # Assist sorts the combined list by expected win rate — and on a
            # live squad it left a player's own 60.0% deck above 71.7% and
            # 71.3% answers. The account holder asked for the strongest to
            # lead, and that is what Coach Assist does.
            #
            # THEIR OWN DECKS KEEP A REAL EDGE: `score()` adds up to
            # `FIT_WEIGHT` (1.5 points) for a deck they pilot, so a population
            # deck must be genuinely better to pass one of theirs, not merely
            # level. Near-copies of their own decks are refused outright.
            #
            # This module's docstring argues the candidate pool is "exactly
            # the decks the blue squad has ALREADY PLAYED". That argument is
            # about knowing who can pilot a deck on the day, and it survives
            # as the `owner` on every row and the `fill` mark on every row that
            # has none — the reader is told which is which, rather than the
            # stronger deck being withheld.
            "decks": _evidence_on_top(
                plan_lists[mate["tag"]] if plan_lists is not None
                else _suggested(rows, fill_pool, PER_PLAYER_TOP_N), keep=0),
            "considered": len(rows),
            # WHICH empty state this is, said rather than inferred from a
            # missing list. The three are genuinely different problems: nothing
            # stored, nothing practised enough, nothing measurable.
            "reason": (
                None if rows else
                "no_history" if not own else
                "no_comfort" if not any(
                    int(d.get("matches") or 0) >= MIN_COMFORT_GAMES for d in own)
                else "no_evidence"
            ),
        })

    return {
        "player": {
            "tag": opponent["tag"], "name": opponent["name"],
            "basis": opponent["basis"], "battles": opponent["battles"],
            "winRate": opponent["winRate"], "tracking": opponent["tracking"],
            "coverage": opponent["coverage"], "window": opponent["window"],
        },
        # LEFT SIDE of the opened folder: what they actually play.
        "theirDecks": decks,
        "spread": spread,
        # RIGHT SIDE: what to bring, best first.
        # The squad-wide top 3, deduplicated by DECK so the headline is three
        # options rather than one option with two co-owners. It is what the
        # folder card's face shows; the board itself is `perPlayer`.
        #
        # IN A SCOUTING REPORT THIS IS THE WHOLE ANSWER, not a headline over a
        # per-player board, which is why the caller passes a longer `top_n`.
        # `_distinct` is a no-op there — the representatives are already one
        # deck per archetype — and is left in the path anyway rather than
        # branched around, because a pool that ever gained a second deck of an
        # archetype should still collapse it here.
        # THE PROJECTION. What they are likely to BRING — their observed decks,
        # real variants of them, and the archetypes their behaviour implies —
        # as a distribution summing to 1.0, every entry labelled with which
        # kind it is and how confident that is. This is what `recommended` was
        # scored against, and it is published so the reader can check the
        # reasoning rather than take the ranking on faith.
        "threats": threats,
        "churn": projection["churn"],
        "mass": projection.get("mass"),
        # RIGHT SIDE: WHAT DECKKIES SUGGESTS TO PLAY, best first.
        #
        # SEVEN, DIVERSIFIED, and the diversity is what makes a longer list
        # worth having: taking the top seven by score returns seven answers to
        # the same threat, and `scout.diversify` penalises redundancy so the
        # list covers the observed core, the variants around it and the thing
        # they have not shown.
        #
        # IN A MATCH PLAN THE SQUAD'S DECKS AND THE POPULATION'S ARE RANKED
        # TOGETHER (`_suggested`), the same sort as each teammate's list. In a
        # scouting report `scored` already IS the population.
        "recommended": _evidence_on_top(
            _suggested(_distinct(scored), fill_pool, top_n) if blue
            else scout.diversify(_distinct(scored), limit=top_n)
        ),
        "perPlayer": per_player,
        # WHICH TEAMMATE'S #1 ANSWERS EACH ARCHETYPE THEY MAY BRING, most
        # likely first. Empty in a scouting report (nobody to assign) and on
        # the fallback path; the client draws nothing rather than a strip of
        # blanks.
        "squadCover": cover,
        "considered": len(cards),
        "brain": scout.BRAIN_VERSION,
        # Said out loud rather than left to be inferred from an empty list.
        "reason": (
            None if scored else
            "no_history" if not threats else "no_evidence"
        ),
    }


def _combined(red: list[dict], cards: list[_Candidate],
              snap: dict | None, seeds: dict | None = None) -> dict:
    """The whole opposing roster as ONE spread, and what answers all of it.

    THE QUESTION A SCOUTING REPORT CAN ASK AND A MATCH PLAN CANNOT. A match
    plan assigns a person to each opponent, so a squad-wide answer would be
    advice nobody is in a position to take. With one roster on the table the
    real question is often the other one — *we are playing this clan next week,
    what should we be practising* — and that is a property of the roster as a
    whole rather than of any player in it.

    WEIGHTED BY GAMES, NOT BY PLAYER. Summing each player's normalised shares
    would give a roster's least active member the same say as its most active,
    which is a claim that everyone plays the same amount. Games are what the
    weights already mean everywhere else in this module, so pooling them is the
    same arithmetic one player's spread already does — `_spread` is simply
    handed every considered deck on the roster at once.
    """
    decks: list[dict] = []
    pooled: list[dict] = []
    for opp in red:
        own = (opp.get("decks") or [])[:OPPONENT_DECKS]
        _archetypes_for(own)
        decks.extend(own)
        # The PROJECTION pools every deck, not the displayed six. See `_folder`.
        pooled.extend(opp.get("decks") or [])

    spread = _spread(decks)
    projection = _threats(pooled, seeds)
    threats = projection["threats"]
    if not threats:
        return {"players": len(red), "spread": [], "threats": [],
                "recommended": [], "reason": "no_history",
                "brain": scout.BRAIN_VERSION}

    scored = [row for row in (_score(c, threats, snap) for c in cards) if row]
    scored.sort(key=lambda r: (-r["score"], r["name"]))
    return {
        "players": len(red),
        "spread": spread,
        "threats": threats,
        "churn": projection["churn"],
        "mass": projection.get("mass"),
        "recommended": _evidence_on_top(
            scout.diversify(_distinct(scored), limit=SCOUT_TOP_N)),
        "reason": None if scored else "no_evidence",
        "brain": scout.BRAIN_VERSION,
    }


def analyze(blue_tags: list[str], red_tags: list[str],
            days: int = DEFAULT_DAYS) -> dict:
    """The whole report: the opposing roster resolved, one folder per opponent.

    AN EMPTY `blue_tags` IS THE SCOUTING REPORT. That is the mode switch, and
    it is an absence rather than a flag on purpose: the two modes differ in
    exactly one input — whether there is a squad to recommend from — so making
    it a separate parameter would allow the incoherent combination (a squad
    pasted, and scout mode asked for) that this shape cannot express.

    The mode is published as `mode` so no client ever has to infer it from an
    empty array, which is the same value an ordinary failure produces.

    Tags arrive already normalised by the caller (`app._route` runs every one
    through `cd.normalize_tag`), so nothing here reaches a query unvalidated.
    """
    # `is_scout`, NOT `scout` — that name is the team_scout module now, and
    # shadowing it here would make the brain unreachable from inside the one
    # function that orchestrates it.
    is_scout = not blue_tags

    # EVERY PLAYER RESOLVED AT ONCE, on the shared pool. Each is its own
    # stored-history read — or, for somebody never tracked, a live CR API call
    # that takes a second or two — and 24 of them one after another was up to
    # a minute for a roster of strangers. `map` keeps the roster order.
    tags = [t for t in blue_tags[:MAX_SQUAD]] + [t for t in red_tags[:MAX_SQUAD]]
    resolved = list(_POOL.map(lambda t: _resolve(t, days), tags))
    nb = len(blue_tags[:MAX_SQUAD])
    blue, red = resolved[:nb], resolved[nb:]

    for p in blue:
        _archetypes_for(p.get("decks") or [])

    # Past its top ten, a stored report's decks carry no art and sit in
    # whatever order the decks table kept. Both squads are drawn, so both get
    # seated — the opponent's list is the left half of every folder.
    seat = dcx.seater()
    for p in resolved:
        _seat_decks(p.get("decks") or [], seat)

    snap = dcx._snap()
    # READ ONCE FOR THE WHOLE RUN. `seeds()` is a dictionary off the snapshot,
    # so this is a reference rather than a copy and costs nothing — but asking
    # per folder would re-enter `_snap()` ten times for an answer that cannot
    # change inside one request.
    seeds = dcx.seeds() or None
    cards = _scout_candidates() if is_scout else _candidates(blue)
    top_n = SCOUT_TOP_N if is_scout else TOP_N

    folders = [_folder(opp, blue, cards, snap, top_n, seeds) for opp in red]

    # A pool with nothing in it is the one failure the screen cannot recover
    # from, and it is worth naming ONCE at the top: every folder below it would
    # be empty for the same reason, and eight identical empty folders do not
    # say "there is nothing to recommend from" — they say the tool is broken.
    #
    # The two modes fail differently and must say so differently. A missing
    # blue squad is the reader's own history; a missing scout pool is the
    # matchup snapshot still building on the server, which is nothing the
    # reader did and is fixed by waiting rather than by pasting more.
    pool_reason = None
    if not cards:
        pool_reason = (
            "no_matchup_data" if is_scout else
            "no_blue_history" if not any(p["decks"] for p in blue)
            else "no_blue_comfort"
        )

    out = {
        "mode": "scout" if is_scout else "squads",
        "blue": [_side_summary(p) for p in blue],
        "red": [_side_summary(p) for p in red],
        "folders": folders,
        "pool": {
            "decks": len(cards),
            "reason": pool_reason,
            "minGames": MIN_COMFORT_GAMES,
        },
        "days": days,
        "limits": {
            "maxSquad": MAX_SQUAD, "topN": TOP_N, "scoutTopN": SCOUT_TOP_N,
            "perPlayerTopN": PER_PLAYER_TOP_N,
            "minRecommendations": scout.MIN_RECOMMENDATIONS,
            "minComfortGames": MIN_COMFORT_GAMES,
            "minOpponentDeckGames": MIN_OPPONENT_DECK_GAMES,
        },
        # WHICH BRAIN PRODUCED THIS. Frozen into `coach_match_plans.engine` by
        # the Coach Roster, so a plan made today can still be told apart from
        # one made by the old scorer when phase 7 reads its results back.
        "brain": scout.BRAIN_VERSION,
    }
    # THE ROSTER-WIDE READ, scout only. In a match plan every recommendation
    # belongs to a named teammate, so a squad-wide answer would be advice with
    # nobody to take it. See `_combined`.
    if is_scout:
        out["overall"] = _combined(red, cards, snap, seeds)
    return out


def _side_summary(p: dict) -> dict:
    """A roster chip: who they are and how well they could be read."""
    return {
        "tag": p["tag"], "name": p["name"], "basis": p["basis"],
        "battles": p["battles"], "winRate": p["winRate"],
        "decks": len(p.get("decks") or []),
        "tracking": p["tracking"], "window": p["window"],
    }
