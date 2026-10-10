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
import threading
import time
import traceback
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import clash_data as cd
import deck_counter as dcx
import duel_combos as dx
import live_player as live
import team_scout as scout
import tracking

#: WHAT A PLAYER PLAYS is the Decks screen's own count (2026-10-10): own-deck
#: 1v1 games plus native duel games, game by game. Imported softly — `server/`
#: is copied by hand, and without it the projection falls back to
#: `player_report`'s every-mode list exactly as before.
try:
    import player_decks as _pdecks
    from duel_zone import _arranged as _arrange_view
except Exception:  # noqa: BLE001 - deployment shape
    _pdecks = _arrange_view = None

#: THE CARD VIEW (2026-10-10): which cards answer the cards they play. Soft for
#: the same reason; without it the board simply has no "by card" lists.
try:
    import card_counters as _cards
except Exception:  # noqa: BLE001 - deployment shape
    _cards = None

#: THE BALANCE LOG (2026-10-10): the manual's dated nerfs, as points a list's
#: stored record overstates it by. Soft; without it no rate is moved.
try:
    import card_balance as _balance
except Exception:  # noqa: BLE001 - deployment shape
    _balance = None

#: THE NAMED GROUPS OF PLAYERS (`duel_read_train.load_cohorts`, a file of
#: player tags kept on the server only). Team Analysis and Coach Assist offer
#: DUEL lists only from the group named in `DUEL_POOL_COHORT`. Soft: without
#: the reader, or without the group, the whole duel catalogue is the pool and
#: the pool's stats say so.
try:
    from duel_read_train import COHORTS_PATH as _COHORTS_PATH, load_cohorts as _load_cohorts
except Exception:  # noqa: BLE001 - deployment shape
    _COHORTS_PATH, _load_cohorts = None, None

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

#: THE DUEL BRAIN (2026-09-27), imported softly for the same reason: `server/`
#: is copied by hand, and a deployment missing either file must cost the duel
#: evidence and nothing else. Without them every list is exactly what the
#: ladder brain made it, and the report says the duel brain is unavailable.
try:
    # THE FUSED RATE (2026-09-27): the ladder and the duels as one matchup rate,
    # at the level of the threat's version. Pure arithmetic; soft like the duel
    # brain, so a deployment without it scores exactly as before.
    import matchup_fusion as _fusion
except Exception:  # noqa: BLE001
    _fusion = None

try:
    import duel_brain as _duel
    import duel_index as _duel_index
except Exception:  # noqa: BLE001 - deployment shape
    _duel = _duel_index = None

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
TOP_N = 10

#: WHOSE DUEL LISTS MAY BE SUGGESTED (2026-10-10, asked for by name: "whatever
#: duel deck you suggest, make sure it's from the top CRL player and not from
#: some random players"). A duel-catalogue list is offered only when players
#: of this group fielded it in at least `DUEL_POOL_MIN_GAMES` duel games.
#: Measured when it was set: 1,706 catalogue lists, 265 ever fielded by the
#: group, 130 at three games or more — and the Hog / Earthquake / Giant
#: Skeleton list that sat on 16 of 30 opponents' lists had none.
DUEL_POOL_COHORT = (os.environ.get("CLASH_DUEL_POOL_COHORT") or "crl").strip().lower()
DUEL_POOL_MIN_GAMES = 3

#: THE FIELD a list's general strength is measured against (`fieldRate`) is
#: THE AVERAGE OPPONENT, AT THE ARCHETYPE LEVEL: every win condition duel
#: players field, weighted by how many PLAYERS field it. By players, not
#: games: a projection is tempered and summed to one for each player, so an
#: archetype counts once for everybody who owns it.
#:
#: AT THE ARCHETYPE LEVEL ON PURPOSE, and two other fields were staged on 30
#: real opponents first. (1) The twenty most played friendly-duel lists, then
#: (2) every family's three most fielded lists: both left the same two ladder
#: lists on 19-21 of 30 answers. A field of popular LISTS is rated from the
#: version cells — list against list, duel games pilot-adjusted — while most
#: of an opponent's own lists are in no cell and are rated from the list's
#: record against the ARCHETYPE, which is where a list piloted by strong
#: players reads high against everything. A baseline has to be made of the
#: same evidence as the rate it is taken from, or the difference measures the
#: evidence and not the matchup.
FIELD_MIN_SHARE = 0.01

#: Per teammate, on the match-plan board — AND the Coach Roster's What-to-play
#: tab, which reads `perPlayer[0]` and is where this number is actually felt.
#:
#: SEVEN, THE SAME AS THE SQUAD-WIDE LIST (was 5, and 3 before that). Raised on
#: the account holder's request (2026-09-21). The board stays readable at ten
#: teammates because every row is COLLAPSED until opened — the seven decks are
#: behind one row per player, not seven rows each on screen at once.
PER_PLAYER_TOP_N = 10

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
SCOUT_TOP_N = 10

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

#: HOW FAR BEFORE THE WINDOW a player's duel decks are still read
#: (`team_scout.DUEL_OLDER_WEIGHT`): a deck they duelled with two months ago
#: is a deck they own. With a 30-day window that is 90 days of duels, which is
#: what the weight was measured on.
OLDER_DUEL_DAYS = 60

#: Decks of one player that are arranged into their slots for the screen. The
#: rest still COUNT — a player with hundreds of one-off variants has most of
#: their games outside any forty lists, and what they play is every game —
#: but nothing past the first few is ever drawn.
RESOLVE_SEATED = 40

#: Pool rows a match plan's teammates are offered from, per opponent: the
#: strongest this many overall, plus the best few against each family they
#: play. See `_folder.shortlist`.
SQUAD_POOL = 80
SQUAD_POOL_PER_FAMILY = 8

#: Decks holding a card before the card can be called a counter: the mean of
#: fewer is one list's result wearing a card's name.
CARD_MIN_DECKS = 6
#: Decks listed under one counter card.
CARD_DECKS = 3


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


def _family(arch: str | None, cards) -> tuple[str, str]:
    """`(family key, display name)` for one deck.

    The archetype and its label — except for a deck the bot files under
    `other`, which is Minion Giant, Goblin Giant, Skeleton Barrel and several
    more in one bucket. "They play Mixed 83%" names nothing a counter can be
    chosen against, so those are grouped by the win condition they actually
    play (`cd.deck_title`). The matchup evidence still reads `other`; only the
    grouping and the label change.
    """
    arch = arch or "other"
    if arch != "other":
        return arch, dcx._label(arch)
    name = cd.deck_title("other", list(cards or []))
    return "other:" + name.lower().replace(" ", "-"), name


def _own_decks(tag: str, since: str | None, until: str | None) -> dict | None:
    """The decks a player PLAYS in a window, in `player_report`'s row shape.

    `player_decks.played`: own-deck 1v1 games plus native duel games, so a
    2v2 partner's list, a draft and an event's handed-out deck are not "what
    they play", and their duel decks are. EVERY deck comes back, most played
    first — the shares are over all of them — and the first `RESOLVE_SEATED`
    are arranged with the forms they were last seen fielding. None when the
    reader is not deployed or fails; the caller keeps `player_report`'s list.
    """
    if _pdecks is None:
        return None
    try:
        got = _pdecks.played(tag, since, until)
    except Exception:  # noqa: BLE001 - the old list is the fallback
        traceback.print_exc()
        return None
    per, marks = got["per"], got["marks"]
    duel_per = got.get("duel") or {}
    rows = []
    for key, (w, l, d, last, cards, arch) in per.items():
        n = w + l + d
        if n <= 0 or len(set(cards)) != 8:
            continue
        arch = arch or dcx._archetype_of_hash(key) or "other"
        rows.append({
            "deckHash": key, "cards": list(cards), "matches": n, "wins": w,
            "losses": l, "draws": d, "winCondition": arch, "lastSeen": last or None,
            # How many of those games were duel games (the projection's weight).
            "duelMatches": min(n, int(duel_per.get(key) or 0)),
        })
    rows.sort(key=lambda r: r["deckHash"])
    rows.sort(key=lambda r: r["lastSeen"] or "", reverse=True)
    rows.sort(key=lambda r: r["matches"], reverse=True)
    total = sum(r["matches"] for r in rows)
    wins = sum(r["wins"] for r in rows)
    for i, r in enumerate(rows):
        r["rank"] = i + 1
        r["useRate"] = round(100.0 * r["matches"] / total, 1) if total else 0.0
        r["winRate"] = round(100.0 * r["wins"] / r["matches"], 1)
        r["family"], r["familyName"] = _family(r["winCondition"], r["cards"])
        r["name"] = cd.deck_title(r["winCondition"], r["cards"])
        r["art"] = {}
        r["avgElixir"] = None
        if i < RESOLVE_SEATED and _arrange_view is not None:
            view = _arrange_view(r["cards"], marks.get(r["deckHash"]))
            r["cards"] = view["cards"]
            r["art"] = view.get("art") or {}
            r["avgElixir"] = view.get("avgElixir")
            if view.get("artInferred"):
                r["artInferred"] = True
    return {
        "decks": rows, "battles": total, "wins": wins,
        "duelGames": got["duelGames"], "hidden": sum((got["hidden"] or {}).values()),
        "older": _older_duel_decks(tag, since),
    }


def _older_duel_decks(tag: str, since: str | None) -> list[dict]:
    """The lists a player DUELLED with in the `OLDER_DUEL_DAYS` before the
    window, as projection rows (`matches` = duel games). They are not "what
    they play" — nothing on the left of a folder counts them — but a deck
    somebody brought to a duel seven weeks ago is one they can bring again.
    Empty with no window, no duel index, or on any failure."""
    if not since or _duel_index is None:
        return []
    try:
        day = datetime.date.fromisoformat(since[:10])
        lo = (day - datetime.timedelta(days=OLDER_DUEL_DAYS)).isoformat()
        hi = (day - datetime.timedelta(days=1)).isoformat()
        got = _duel_index.player_decks(tag, _duel_index.iso_to_stamp(lo),
                                       _duel_index.iso_to_stamp(hi, end=True))
    except Exception:  # noqa: BLE001 - the window's own decks are the projection
        traceback.print_exc()
        return []
    out = []
    for d in got or []:
        cards = list(d.get("cards") or [])
        if len(set(cards)) != 8 or int(d.get("games") or 0) <= 0:
            continue
        key = scout.deck_key(cards)
        arch = d.get("archetype") or dcx._archetype_of_hash(key) or "other"
        fam, fam_name = _family(arch, cards)
        out.append({
            "deckHash": key, "cards": cards, "matches": int(d["games"]),
            "wins": int(d.get("wins") or 0), "winCondition": arch,
            "lastSeen": d.get("lastSeen") or None, "family": fam,
            "familyName": fam_name, "name": cd.deck_title(arch, cards),
        })
    return out


def _resolve(tag: str, days: int, window: tuple | None = None) -> dict:
    """One roster entry, from whichever source can actually answer for it.

    `window` is an explicit `(since, until)` — the Deck Counter's own date
    range — and replaces the `days` count when given.

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
    if window and window[0]:
        since, until = window[0], window[1]
        cov = cd.coverage(tag)
    else:
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
        out = {
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
        # WHAT THEY PLAY, NOT WHAT IS STORED UNDER THEIR TAG. `player_report`
        # counts every mode and keeps the 25 most played lists: measured on 30
        # real players (2026-10-10), event games moved 42-46% of the archetype
        # mix for two of them, and a player with 882 variants had the wrong
        # archetype named as their most played. The header figures move with
        # the list, so the folder never quotes a win rate over games the deck
        # list beside it leaves out.
        own = _own_decks(tag, since, until)
        if own is not None:
            out["decks"] = own["decks"]
            out["battles"] = own["battles"]
            out["winRate"] = (round(100.0 * own["wins"] / own["battles"], 1)
                              if own["battles"] else 0.0)
            out["played"] = {"source": "own_deck", "duelGames": own["duelGames"],
                             "hidden": own["hidden"]}
            out["older"] = own.get("older") or []
        return out

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
            d["name"] = cd.deck_title(wc, d.get("cards"))
        if not d.get("family"):
            d["family"], d["familyName"] = _family(wc, d.get("cards"))


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
            th["name"] = cd.deck_title(th.get("archetype") or "other", th.get("cards"))
        if th.get("basis") and not th.get("basisName"):
            th["basisName"] = dcx._label(th.get("archetype") or "other")
    return out


def _plays(decks: list[dict], older: list[dict] | None = None) -> dict:
    """THE PROJECTION: what this opponent is likely to BRING, read off what
    they play and only that. `older` is their duel decks from before the
    window (`_older_duel_decks`); see `scout.played_space` for how a duel game,
    an older one and a ladder game are weighed (4.0, the wide read).

    Since 3.0:

    `scout.played_space` over every deck they fielded — most played first, a
    recent deck weighing more than a dropped one, their variations kept as the
    separate lists they are — with each family keeping its whole share. No
    seed variants and no archetypes "their behaviour implies": the account
    holder asked for counters to what they play, "whatever they play", and a
    counter to a deck they do not play is the generic answer by definition.

    Returns `threats` (the lists scored against, seated and named) and `plays`
    (one row a family, labelled). `_threats` above is the older projection and
    is no longer what a board is scored against.
    """
    _archetypes_for(decks)
    out = scout.played_space(decks, older=older)
    _seat_decks(out.get("threats") or [], dcx.seater())
    for th in out.get("threats") or []:
        if not th.get("name"):
            th["name"] = cd.deck_title(th.get("archetype") or "other", th.get("cards"))
    for p in out.get("plays") or []:
        if not p.get("name"):
            p["name"] = dcx._label(p.get("archetype") or "other")
        p["style"] = dcx.style_of(p.get("archetype") or "other")
    return out


def _spread_of(plays: list[dict]) -> list[dict]:
    """The archetype bars on the left of a folder, from the SAME shares the
    list on the right was scored against — so "they play Giant 79%" and the
    `Giant` chip under a deck are one number's two readings. Families under
    two percent are counted and not drawn."""
    return [
        {"archetype": p["family"], "name": p["name"], "style": p.get("style"),
         "games": p["games"], "weight": p["share"],
         "share": round(100.0 * p["share"], 1),
         "key": f"archetype:{p['family']}", "evidence": scout.OBSERVED,
         "likelihood": p["share"]}
        for p in plays if p["share"] >= 0.02
    ][:8]


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

    def exact_record(self, other: str) -> tuple[int, int] | None:
        """`(decided games, wins)` of THIS list against an archetype, from the
        exact rung (8+ games, the site's floor), for `matchup_fusion`."""
        m = self._exact.get(other)
        if not m:
            return None
        w, l = int(m.get("wins") or 0), int(m.get("losses") or 0)
        return (w + l, w) if w + l else None

    def cluster_record(self, other: str) -> tuple[int, int] | None:
        """`(decided games, wins)` of this list's ONE-CARD VARIANTS against an
        archetype — the `cluster7` rung with the list itself taken out, so the
        same games are not counted at two levels of `matchup_fusion`."""
        c = self._c7.get(other)
        if not c:
            return None
        e = self._exact.get(other) or {}
        w = int(c.get("wins") or 0) - int(e.get("wins") or 0)
        n = (int(c.get("wins") or 0) + int(c.get("losses") or 0)
             - int(e.get("wins") or 0) - int(e.get("losses") or 0))
        return (n, max(0, min(w, n))) if n > 0 else None

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

    def exact_record(self, other: str) -> tuple[int, int] | None:
        m = self._records.get(other)
        if not m:
            return None
        w, l = int(m.get("wins") or 0), int(m.get("losses") or 0)
        return (w + l, w) if w + l else None

    def cluster_record(self, other: str) -> None:
        # A seed carries no cluster (see the class note), so its variants are
        # simply not read — the fused rate's prior is then the matrix.
        return None

    def against(self, other: str, snap: dict | None) -> dict | None:
        m = self._records.get(other)
        if m:
            return {"source": dcx.SOURCE_DECK, "decks": 1, **m}
        if snap:
            m = dcx._symmetric(snap, self.archetype, other)
            if m:
                return {"source": dcx.SOURCE_ARCHETYPE, "decks": None, **m}
        return None


class _ListProfile:
    """A real list's OWN ladder record against each archetype, and nothing else.

    For the duel catalogue (`_counter_candidates`). `_DeckProfile` also reads
    the two cluster rungs, a sibling scan each — 65 ms a list measured, 110 s
    for the catalogue. This is the exact rung alone (3 ms a list, the cluster
    index's own rows), which is what a seed carries too (`_SeedProfile`); the
    list's duel record and the version cells come in through the fused rate.
    """

    __slots__ = ("archetype", "_exact", "overall")

    def __init__(self, cards: list[str], archetype: str):
        self.archetype = archetype
        exact = dcx.deck_profile(cards)
        self._exact = exact.get("archetypes") or {}
        self.overall = exact.get("overall")

    def exact_record(self, other: str) -> tuple[int, int] | None:
        m = self._exact.get(other)
        if not m:
            return None
        w, l = int(m.get("wins") or 0), int(m.get("losses") or 0)
        return (w + l, w) if w + l else None

    def cluster_record(self, other: str) -> None:
        return None

    def against(self, other: str, snap: dict | None) -> dict | None:
        m = self._exact.get(other)
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
                 "games", "wins", "win_rate", "use_rate", "profile", "origin", "memo",
                 "field")

    def __init__(self, deck: dict, owner: dict | None, profile: "_DeckProfile"):
        # THE LIST'S OWN RATE AGAINST THE FIELD, for a pool candidate
        # (`_set_field_rates`); None for a teammate's deck, about which
        # nothing general is known.
        self.field = None
        # WHERE THE LIST COMES FROM, for a population candidate: "duel" (the
        # duel catalogue) or "ladder" (a vetted seed). None for a teammate's.
        self.origin = deck.get("origin")
        # The archetype half of this list's fused rate against each archetype
        # (`_FusionContext.rater`). On the candidate because a pool candidate
        # outlives the request, and is replaced exactly when its evidence is.
        self.memo: dict = {}
        self.cards = list(deck.get("cards") or [])
        self.key = ",".join(sorted(set(self.cards)))
        self.archetype = deck.get("winCondition") or "other"
        self.name = deck.get("name") or cd.deck_title(self.archetype, self.cards)
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
_SCOUT_POOL: tuple[object, list["_Candidate"], int] | None = None


def scout_pool_slot_gaps() -> int:
    """How many seeds the current pool skipped because their cards cannot fill
    all three special slots — published, so the filter is never silent."""
    return _SCOUT_POOL[2] if _SCOUT_POOL is not None else 0


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
    # EVERY DECK IN THIS POOL IS ONE DECKKIES WILL SUGGEST, and a suggestion
    # fields all three special slots. A list whose cards cannot fill them — no
    # hero-capable card and no champion, say, so slot 2 can only ever hold a
    # plain card — is skipped and the NEXT seed of that archetype takes its
    # place, so each archetype still offers its full count. Measured on the
    # live snapshot: 21 of 680 seeds. The count is published, never silent.
    gaps = 0
    seeds = dcx.seeds() or {}
    # A seed is its hash split on commas — alphabetical and bare. Seated once
    # here, with the pool, so every "Deckkies pick" and every scouting row is
    # drawn evolution / hero / wild like the rest of the site.
    seat = dcx.seater()

    for arch, decks in seeds.items():
        taken = 0
        for seed in decks:
            if taken >= SCOUT_SEEDS_PER_ARCHETYPE:
                break
            cards = list(seed.get("cards") or [])
            if len(set(cards)) != 8:
                continue
            if cd.fillable_slots(cards) < cd.SPECIAL_SLOTS:
                gaps += 1
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
                    "name": cd.deck_title(arch, cards),
                    # No owner means no games piloted and no win rate of
                    # anyone's own. Left at zero rather than invented; `_score`
                    # never reads them for an ownerless candidate.
                    "matches": 0, "wins": 0, "winRate": 0.0, "useRate": 0.0,
                },
                None,
                prof,
            ))
            taken += 1

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
            if cd.fillable_slots(cards) < cd.SPECIAL_SLOTS:
                gaps += 1
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
                    "name": rep.get("name") or cd.deck_title(arch, cards),
                    "matches": 0, "wins": 0, "winRate": 0.0, "useRate": 0.0,
                },
                None,
                prof,
            ))

    _SCOUT_POOL = (key, out, gaps)
    return out


#: The counter pool, kept between requests: `{"key", "cands", "stats"}`.
_COUNTER_POOL: dict = {"key": None, "cands": [], "stats": {}, "building": False}
_COUNTER_LOCK = threading.Lock()
_COUNTER_BUILD = threading.Lock()


def _counter_key() -> tuple | None:
    snap = dcx._snap()
    stamp = (snap or {}).get("computedAt")
    if stamp is None:
        return None
    build = None
    try:
        if _duel_index is not None and _duel_index.available():
            build = (_duel_index.status() or {}).get("buildId") or (
                _duel_index.status() or {}).get("builtAt")
    except Exception:  # noqa: BLE001
        build = None
    return (stamp, build, _cohort_stamp())


def _cohort_stamp():
    """When the group file last changed: a new list of players is a new pool."""
    try:
        return os.path.getmtime(_COHORTS_PATH) if _COHORTS_PATH else None
    except OSError:
        return None


_GROUP_LISTS: dict = {"key": None, "lists": None}


def _group_lists() -> dict | None:
    """`{deck key: [games, pilots]}` for the duel lists of `DUEL_POOL_COHORT`,
    or None when there is no such group (then every catalogue list is offered).
    Read once per duel build and per change of the group file."""
    if _load_cohorts is None or _duel_index is None or not DUEL_POOL_COHORT:
        return None
    try:
        key = ((_duel_index.status() or {}).get("buildId"), _cohort_stamp(), DUEL_POOL_COHORT)
        if _GROUP_LISTS["key"] == key:
            return _GROUP_LISTS["lists"]
        tags = (_load_cohorts() or {}).get(DUEL_POOL_COHORT)
        lists = _duel_index.lists_of(tags) if tags else None
        _GROUP_LISTS.update(key=key, lists=lists or None)
        return _GROUP_LISTS["lists"]
    except Exception:  # noqa: BLE001 - the whole catalogue is the fallback
        traceback.print_exc()
        return None


def duel_catalogue() -> tuple[list[dict], str]:
    """`(the duel lists that may be suggested, whose they are)`.

    The duel catalogue narrowed to the lists the named group fielded
    (`DUEL_POOL_MIN_GAMES`), labelled with the group's name — or the whole
    catalogue, labelled `everyone`, when there is no group to narrow by. ONE
    function for the counter pool and for the duel context Coach Assist reads,
    so the two cannot offer different players' decks.
    """
    try:
        catalogue = _duel_index.catalogue() if _duel_index is not None else []
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        catalogue = []
    group = _group_lists()
    if not group:
        return catalogue, "everyone"
    kept = [d for d in catalogue
            if (group.get(d.get("key")) or [0])[0] >= DUEL_POOL_MIN_GAMES]
    return kept, DUEL_POOL_COHORT


def _field_threats() -> list[dict]:
    """The average opponent as a projection over archetypes (sums to 1)."""
    if _duel_index is None:
        return []
    mass: dict[str, float] = {}
    for _key, wc, players in _duel_index.deck_players():
        if players > 0:
            arch = wc or "other"
            mass[arch] = mass.get(arch, 0.0) + players
    total = sum(mass.values()) or 1.0
    out = [{"cards": [], "archetype": arch, "family": arch, "likelihood": m / total,
            "key": "archetype:" + arch}
           for arch, m in mass.items() if m / total >= FIELD_MIN_SHARE]
    kept = sum(t["likelihood"] for t in out) or 1.0
    for t in out:
        t["likelihood"] /= kept
    out.sort(key=lambda t: (-t["likelihood"], t["key"]))
    return out


def _set_field_rates(cands: list["_Candidate"]) -> int:
    """Put each pool candidate's rate against the field on it (`field`).
    Returns how many were rated. Any failure leaves them None, and a list of
    rows with no field rate is chosen exactly as before 4.1."""
    try:
        threats = _field_threats()
        if not threats or _fusion is None:
            return 0
        ctx = _DuelContext()
        ctx.fx = _FusionContext(ctx, dcx._snap())
        if ctx.on:
            ctx.prefetch([c.cards for c in cands])
        table = ctx.fx.threat_table(threats)
        done = 0
        for c in cands:
            row = scout.score_rates(ctx.fx.lean_rates(c, table), cards=c.cards,
                                    archetype=c.archetype, key=c.key)
            if row and row["threatCovered"] >= 0.5:
                c.field = row["expectedWinRate"]
                done += 1
        return done
    except Exception:  # noqa: BLE001 - a baseline is extra; the pool stands
        traceback.print_exc()
        return 0


def _build_counter_pool(key: tuple) -> dict:
    """Every list Deckkies may offer as a counter.

    TWO SOURCES, one pool, one ranking:

      * EVERY VETTED SEED, not the twelve most played of each archetype. The
        scout pool's dozen are the meta's lists by construction; the best
        answer to one opponent's decks is often a list ranked 20th by games.
      * EVERY DUEL-CATALOGUE LIST. Asked for by name (2026-10-10): "don't omit
        the duel battles — they have so many good decks." Measured on 14 real
        opponents before this shipped: with the catalogue in the pool its
        lists took 66 of 98 slots ON THE SAME FIGURE as the ladder's, and the
        weakest of each seven rose again. A catalogue list is 10+ duel games
        by 3+ pilots, none holding more than half (`duel_index`).

    Both must be able to field all three special slots — the rule every
    suggestion follows. Profiles are the exact rung (`_SeedProfile`,
    `_ListProfile`): no cluster scans, so the whole build is a second or two.
    """
    out: list["_Candidate"] = []
    seat = dcx.seater()
    seen: set[str] = set()
    gaps = 0
    for arch, decks in (dcx.seeds() or {}).items():
        for seed in decks:
            cards = list(seed.get("cards") or [])
            if len(set(cards)) != 8:
                continue
            if cd.fillable_slots(cards) < cd.SPECIAL_SLOTS:
                gaps += 1
                continue
            try:
                prof = _SeedProfile(seed, arch)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                continue
            cards, art, inferred = seat(cards)
            c = _Candidate({
                "cards": cards, "art": art, "inferredArt": inferred,
                "winCondition": arch, "name": cd.deck_title(arch, cards),
                "matches": 0, "wins": 0, "winRate": 0.0, "useRate": 0.0,
                "origin": "ladder"}, None, prof)
            if c.key not in seen:
                seen.add(c.key)
                out.append(c)
    n_seeds = len(out)

    catalogue, duel_from = [], "everyone"
    try:
        if _duel_index is not None and _duel_index.available():
            # ONLY THE NAMED GROUP'S DUEL LISTS (`duel_catalogue`).
            catalogue, duel_from = duel_catalogue()
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    todo = []
    for d in catalogue:
        cards = list(d.get("cards") or [])
        if len(set(cards)) != 8 or d.get("key") in seen:
            continue
        if cd.fillable_slots(cards) < cd.SPECIAL_SLOTS:
            gaps += 1
            continue
        todo.append(d)

    def make(d):
        arch = d.get("archetype") or dcx._archetype_of_hash(d["key"])
        try:
            return d, arch, _ListProfile(list(d["cards"]), arch)
        except Exception:  # noqa: BLE001 - one bad list must not sink the pool
            traceback.print_exc()
            return d, arch, None

    for d, arch, prof in _POOL.map(make, todo):
        if prof is None:
            continue
        cards, art, inferred = seat(list(d["cards"]))
        c = _Candidate({
            "cards": cards, "art": art, "inferredArt": inferred,
            "winCondition": arch, "name": cd.deck_title(arch, cards),
            "matches": 0, "wins": 0, "winRate": 0.0, "useRate": 0.0,
            "origin": "duel"}, None, prof)
        if c.key not in seen:
            seen.add(c.key)
            out.append(c)
    if not out:
        # A snapshot from before the seed pool, and no duel index: the scout
        # pool's own fallback (the archetype representatives), so a deployment
        # mid-upgrade still has something to suggest.
        out = list(_scout_candidates())
        n_seeds = len(out)
    # EACH LIST'S OWN RATE AGAINST THE FIELD, once a pool: what `counters`
    # tells a counter to THIS opponent from an all-round deck by.
    rated = _set_field_rates(out)
    return {"key": key, "cands": out, "building": False,
            "stats": {"ladder": n_seeds, "duel": len(out) - n_seeds, "slotGaps": gaps,
                      "duelFrom": duel_from, "fieldRated": rated}}


def _counter_candidates() -> list["_Candidate"]:
    """The counter pool for this snapshot and this duel build.

    Built once and kept. When either source is rebuilt (the snapshot hourly,
    the duel index after each bot poll) the pool in hand keeps answering while
    a background thread builds the next one — a board must not wait on it.
    Falls back to the scout pool when it cannot be built.
    """
    global _COUNTER_POOL
    key = _counter_key()
    if key is None:
        return []
    with _COUNTER_LOCK:
        pool = _COUNTER_POOL
        if pool["key"] == key:
            return pool["cands"]
        stale = pool["cands"]
        if stale:
            if not pool["building"]:
                pool["building"] = True

                def work():
                    global _COUNTER_POOL
                    try:
                        fresh = _build_counter_pool(key)
                    except Exception:  # noqa: BLE001
                        traceback.print_exc()
                        with _COUNTER_LOCK:
                            _COUNTER_POOL["building"] = False
                        return
                    with _COUNTER_LOCK:
                        _COUNTER_POOL = fresh

                threading.Thread(target=work, name="counter-pool", daemon=True).start()
            return stale
    # Nothing in hand yet: build it now, once, whoever asked first.
    with _COUNTER_BUILD:
        with _COUNTER_LOCK:
            if _COUNTER_POOL["key"] == key or _COUNTER_POOL["cands"]:
                return _COUNTER_POOL["cands"]
        try:
            fresh = _build_counter_pool(key)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return _scout_candidates()
        with _COUNTER_LOCK:
            _COUNTER_POOL = fresh
        return fresh["cands"]


def counter_pool_stats() -> dict:
    """How many lists the counter pool holds, by source. Published."""
    return dict(_COUNTER_POOL.get("stats") or {})


def _reset_counter_pool() -> None:
    """Forget the pool in hand, so the next request builds it. For tests, and
    for a caller that has just replaced one of its two sources by hand."""
    global _COUNTER_POOL
    with _COUNTER_LOCK:
        _COUNTER_POOL = {"key": None, "cands": [], "stats": {}, "building": False}


def _comfort(games: int) -> float:
    """The tiebreak, in points. Linear to `COMFORT_FULL`, flat after."""
    if games <= 0:
        return 0.0
    return COMFORT_WEIGHT * min(1.0, games / COMFORT_FULL)


def _score(card: _Candidate, threats: list[dict], snap: dict | None,
           ctx: "_DuelContext | None" = None, *, dress: bool = True,
           table: list | None = None) -> dict | None:
    """One candidate against a whole projected threat space.

    `dress=False` returns the RATED row only — the figures and the identity —
    without seating, the practice line or the sentence. The counter pool is
    two thousand lists and seven are shown, so the pool is rated and only what
    is chosen is dressed (`_dress`).

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
    # THE FUSED RATE, when this request has one: the ladder and the duels as
    # one number per THREAT, not per archetype, so two Log Bait lists an
    # opponent might bring can score differently (`_FusionContext`). Without
    # it the ladder rung `against` walks is the rate, exactly as before.
    fx = getattr(ctx, "fx", None) if ctx is not None else None
    if not dress and table is not None and fx is not None and fx.on:
        # THE TIGHT LOOP, for a pool row that is only being rated: the figures
        # `scout.score` would give, without a closure and a dictionary a
        # threat. `table` is this opponent's threats prepared once.
        base = scout.score_rates(
            fx.lean_rates(card, table), cards=card.cards, archetype=card.archetype,
            fit_games=card.games if card.owner else None, key=card.key)
        if base is None:
            return None
        base["name"] = card.name
        base["owner"] = ({"tag": card.owner["tag"], "name": card.owner["name"]}
                         if card.owner else None)
        if card.origin:
            base["origin"] = card.origin
        if card.field is not None:
            base["fieldRate"] = card.field
        return base
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
        rate_for_threat=(fx.rater(card, tiers=dress)
                         if fx is not None and fx.on else None),
        # A row that is only being RATED carries no per-threat table: the
        # counter pool is two thousand lists and seven are shown.
        lean=not dress,
    )
    if base is None:
        return None

    for row, t in zip(base.get("matchups") or [], threats):
        # PERCENT OF THE PROJECTION, always. It read the threat's own `share`
        # when it had one — a FRACTION of the observed mass on an observed
        # deck — so one column held 0.285 and 18.6 on adjacent rows.
        row["share"] = round(100 * float(t.get("likelihood") or 0), 1)
        row["name"] = t.get("name") or row.get("name") or ""
        row["sourceText"] = dcx.SOURCE_TEXT.get(row.get("source"))

    out = dict(base)
    # AGAINST EACH FAMILY THEY PLAY — on every row, in both modes. A weighted
    # headline alone cannot show a deck that beats their main list and loses to
    # the one they bring a fifth of the time.
    if "vs" not in out:
        out["vs"] = scout.vs_archetypes(base)
    out["name"] = card.name
    out["owner"] = ({"tag": card.owner["tag"], "name": card.owner["name"]}
                    if card.owner else None)
    if card.origin:
        out["origin"] = card.origin
    if card.field is not None:
        out["fieldRate"] = card.field
    if not dress:
        return out
    return _dress(out, card, threats)


def _dress(out: dict, card: _Candidate, threats: list[dict]) -> dict:
    """Everything a row carries besides its figures. See `_score`."""
    base = out
    # `scout.score` ranks on `playerFit` in [0, 1] scaled by `FIT_WEIGHT`,
    # which is the same quantity and the same weight `_comfort` produced in
    # points. Publishing the points as well keeps the existing contract: a
    # reader comparing two rows can still see whether the order came from the
    # matchup or from the practice.
    comfort = _comfort(card.games) if card.owner else 0.0
    if card.art and card.inferred:
        out["artInferred"] = True
    # A SUGGESTION FIELDS EVERY SPECIAL SLOT ITS CARDS CAN FILL. The candidate
    # arrives seated the way it was fielded — a teammate's own list with their
    # own marks, a population list with the board's — and a capable card nobody
    # was seen fielding stays plain that way. Every row here is advice, so the
    # empty slots are filled; `artFilled` names which forms were filled rather
    # than seen, so the card's tooltip does not pass them off as observed.
    cards, art, filled = cd.complete_seating(
        card.cards, card.art, slot_of=cd.seated_positions(card.cards, card.art))
    out["cards"] = cards
    if filled:
        out["artFilled"] = filled
    out.update({
        "art": art,
        "avgElixir": dcx._avg_elixir(card.cards),
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
    # WHICH OF ITS CARDS THE GAME CHANGED LATELY (the manual's balance log):
    # the arrow on the row. A nerf is already in the figure beside it.
    if _balance is not None:
        try:
            changed = _balance.marks(card.cards)
        except Exception:  # noqa: BLE001
            changed = []
        if changed:
            out["balance"] = changed
    return out


# ── The duel brain ──────────────────────────────────────────────────────────
#
# `duel_brain.py` decides and `duel_index.py` counts; this section only moves
# rows between them and the board. See `duel_brain`'s docstring for the rules:
# every row gets its duel figures, and up to two of each list's seven are held
# for decks PROVED in duel games against what this opponent brings — the
# teammate's own duel decks first, the population's second.


def _duel_records_safe(cards):
    try:
        return _duel_index.records(cards)
    except Exception:  # noqa: BLE001 - one bad read costs one deck's figures
        traceback.print_exc()
        return None


class _DuelContext:
    """What the duel brain needs for ONE request, read once.

    OFF — and every list exactly what the ladder brain made it — when either
    module is missing or the index is absent, unreadable or built from another
    database. The duel brain adds evidence; it never takes a board down.

    Folders are built one after another, so nothing here is shared between
    threads except inside `prefetch`, which writes only after its map returns.
    """

    def __init__(self):
        self.on = bool(_duel and _duel_index and _duel_index.available())
        # ONLY THE NAMED GROUP'S DUEL LISTS are offered (`duel_catalogue`) —
        # here for the duel picks Coach Assist draws from this context.
        catalogue, self.duel_from = duel_catalogue() if self.on else ([], "everyone")
        # A DUEL PICK IS A SUGGESTION TOO, so it is drawn from lists that can
        # field all three special slots — the rule `_scout_candidates` applies
        # to the ladder pool. Measured: 99 of 1,972 catalogue lists cannot.
        # A teammate's OWN duel decks are theirs and are never filtered.
        self.catalogue = [d for d in catalogue
                          if cd.fillable_slots(d.get("cards")) >= cd.SPECIAL_SLOTS]
        self.slot_gaps = len(catalogue) - len(self.catalogue)
        self.status = _duel_index.status() if self.on else None
        # A CATALOGUE LIST ARRIVES WITH ITS DUEL RECORDS — the same object
        # `duel_index.records` returns for it (checked on the live index) — so
        # the two thousand lists of the counter pool cost no read here.
        self._records: dict[str, dict | None] = {
            d["key"]: d["records"] for d in catalogue if d.get("records")}
        self._profiles: dict[str, "_DeckProfile | None"] = {}
        self._decks: dict[tuple, list[dict]] = {}
        self._seat = None
        # The fused rate's per-request state (`_FusionContext`), set by
        # `analyze`. On the duel context because every scorer already has it.
        self.fx: "_FusionContext | None" = None

    def prefetch(self, decks) -> None:
        """Duel records for many lists at once, on the shared pool."""
        if not self.on:
            return
        todo: dict[str, list[str]] = {}
        for c in decks:
            k = scout.deck_key(c)
            if len(set(c or [])) == 8 and k not in self._records:
                todo[k] = list(c)
        if todo:
            keys = list(todo)
            for k, r in zip(keys, _POOL.map(_duel_records_safe, [todo[k] for k in keys])):
                self._records[k] = r

    def records(self, cards) -> dict | None:
        k = scout.deck_key(cards)
        if k not in self._records:
            self._records[k] = _duel_records_safe(cards)
        return self._records[k]

    def figures(self, cards, projection) -> dict | None:
        """A row's public duel figures against a duel projection."""
        return _duel.public(_duel.value(projection, self.records(cards)))

    def window(self, player: dict) -> tuple[str | None, str | None]:
        """The player's own window as stored-format stamps. A player with no
        stored window (live, unknown) falls back to the evidence window."""
        win = player.get("window") or {}
        since = (_duel_index.iso_to_stamp(win.get("from"))
                 or (self.status or {}).get("windowFrom"))
        return since, _duel_index.iso_to_stamp(win.get("to"), end=True)

    def player_decks(self, player: dict) -> list[dict]:
        since, until = self.window(player)
        k = (player.get("tag"), since, until)
        if k not in self._decks:
            try:
                self._decks[k] = _duel_index.player_decks(player.get("tag"), since, until)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                self._decks[k] = []
        return self._decks[k]

    def player_wcs(self, player: dict) -> dict[str, int]:
        out: dict[str, int] = {}
        for d in self.player_decks(player):
            out[d["archetype"]] = out.get(d["archetype"], 0) + int(d["games"])
        return out

    def profile(self, cards, arch: str):
        k = scout.deck_key(cards)
        if k not in self._profiles:
            try:
                self._profiles[k] = _DeckProfile(list(cards), arch)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                self._profiles[k] = None
        return self._profiles[k]

    def seat(self, cards):
        if self._seat is None:
            self._seat = dcx.seater()
        return self._seat(list(cards))


# ── The fused rate (`matchup_fusion`, 2026-09-27) ───────────────────────────

#: Ladder opponent histories of lists OUTSIDE the version cells — in practice a
#: teammate's own lists — kept between requests. A history moves only as fast
#: as the bot writes, and the cells beside it are rebuilt every four hours, so
#: an hour is the same order of staleness.
HISTORY_CACHE = 1024
HISTORY_TTL_S = 3600.0
_HISTORY: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()
_HISTORY_LOCK = threading.Lock()


def _ladder_history(key: str) -> dict | None:
    """`{opponent list: [games, this list's wins]}` off `pair_matchup_agg`,
    cached. None when there is no database or the read fails."""
    now = time.monotonic()
    with _HISTORY_LOCK:
        hit = _HISTORY.get(key)
        if hit is not None and now - hit[0] < HISTORY_TTL_S:
            _HISTORY.move_to_end(key)
            return hit[1]
    path = (cd._tier_paths() or [None])[0]
    if not path or _duel_index is None:
        return None
    try:
        con = cd.connect(path)
        try:
            hist = _duel_index._history(con, key)
        finally:
            con.close()
    except Exception:  # noqa: BLE001 - no history is a smaller answer, not an error
        traceback.print_exc()
        return None
    with _HISTORY_LOCK:
        _HISTORY[key] = (now, hist)
        while len(_HISTORY) > HISTORY_CACHE:
            _HISTORY.popitem(last=False)
    return hist


class _FusionContext:
    """The fused, version-level matchup rate for ONE request.

    Every rate is `matchup_fusion.fused` over what this request can read:

        matrix       the archetype matrix, from the counter snapshot
        cluster      the list's one-card variants vs the archetype (`_DeckProfile`)
        archetype    the list vs the archetype — ladder, plus its duel record
        family       the list vs the threat's one-card family
        version      the list's one-card family vs the threat exactly

    The two version levels come from the duel index's VERSION CELLS when the
    list and the threat are both hubs (the population and the seeds); for a
    list outside the cells — a teammate's own — the family level is computed
    here from its own ladder history, and the version level is not read (it
    would need the threat's whole history per request). A threat that is no
    hub gets the archetype levels only; a temporal holdout put that loss at
    0.0006 of log loss.

    ON whenever `matchup_fusion` imports; the cells and the duels are optional
    beneath it, so a box with neither still gets the archetype levels fused
    with the variants prior.
    """

    def __init__(self, duel: "_DuelContext | None", snap: dict | None):
        self.on = _fusion is not None
        self.duel = duel
        self.snap = snap
        self._matrix: dict[tuple, tuple | None] = {}
        self._cells: dict[str, dict | None] = {}
        self._hub: dict[str, bool] = {}
        self._fam: dict[str, dict[str, tuple]] = {}
        self._fam_done: dict[str, set] = {}
        self._rates: dict[tuple, dict | None] = {}
        self.stats = {"version": 0, "deck": 0, "cluster7": 0, "archetype": 0, "none": 0}
        # THE BALANCE LOG, when the caller asks for it (`balance = True`: Team
        # Analysis and the Deck Counter's bring list). A list holding a card
        # nerfed since most of its games were played is rated a little under
        # its record, and a threat holding one a little easier
        # (`card_balance`). Coach Assist builds this context too and does not
        # ask, so its figures are exactly what they were.
        self.balance = False
        self._drag: dict[str, float] = {}

    def drag(self, key: str | None) -> float:
        """Points a list's record overstates it by today (`card_balance.drag`)."""
        if not key or not self.balance or _balance is None:
            return 0.0
        v = self._drag.get(key)
        if v is None:
            try:
                v = float(_balance.drag(key.split(",")))
            except Exception:  # noqa: BLE001 - the balance log never costs a rate
                v = 0.0
            self._drag[key] = v
        return v

    def matrix(self, a: str, b: str) -> tuple | None:
        k = (a, b)
        if k not in self._matrix:
            m = dcx._symmetric(self.snap, a, b) if self.snap else None
            decided = (int(m["wins"]) + int(m["losses"])) if m else 0
            self._matrix[k] = (int(m["wins"]) / decided, int(m["games"])) if decided else None
        return self._matrix[k]

    def is_hub(self, key: str) -> bool:
        if key not in self._hub:
            try:
                self._hub[key] = bool(_duel_index) and _duel_index.is_version_hub(key.split(","))
            except Exception:  # noqa: BLE001
                self._hub[key] = False
        return self._hub[key]

    def cells(self, tkey: str) -> dict | None:
        if tkey not in self._cells:
            try:
                self._cells[tkey] = (_duel_index.version_cells(tkey.split(","))
                                     if _duel_index else None)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                self._cells[tkey] = None
        return self._cells[tkey]

    def prepare(self, cards, threats, *, hubs_too: bool = False) -> None:
        """The family level for every candidate OUTSIDE the cells, against
        every deck-level threat, in one pass over each list's own history.
        Histories are read on the shared pool; a list already prepared for a
        threat is not prepared again.

        `hubs_too` prepares HUB lists as well, for threats the cells may not
        hold. Team Analysis never asks — its threats are the seeds and the
        board, which ARE the threat hubs, so the cells answer. Coach Assist
        asks, because its threats are one opponent's own decks, most of which
        are in no cell; `rate` reads a prepared family only when the cells had
        nothing, so a hub against a threat hub still reads the cells."""
        if not self.on:
            return
        tkeys = {scout.deck_key(t.get("cards")) for t in threats
                 if len(set(t.get("cards") or [])) == 8}
        want: dict[str, set] = {}
        for c in cards:
            if len(set(c.cards)) != 8 or (self.is_hub(c.key) and not hubs_too):
                continue
            missing = tkeys - self._fam_done.get(c.key, set())
            if missing:
                want[c.key] = missing
        if not want:
            return
        keys = list(want)
        hists = dict(zip(keys, _POOL.map(_ladder_history, keys)))
        for key, missing in want.items():
            by_sub: dict[str, list[str]] = {}
            for tk in missing:
                for sub in _duel_index._subs(tk):
                    by_sub.setdefault(sub, []).append(tk)
            acc = self._fam.setdefault(key, {})
            fresh: dict[str, list[float]] = {}
            for opp, (n, w) in (hists.get(key) or {}).items():
                hit: set[str] = set()
                for sub in _duel_index._subs(opp):
                    hit.update(by_sub.get(sub, ()))
                for tk in hit:
                    a = fresh.get(tk)
                    if a is None:
                        fresh[tk] = [n, w]
                    else:
                        a[0] += n
                        a[1] += w
            for tk, (n, w) in fresh.items():
                acc[tk] = (n, w)
            self._fam_done.setdefault(key, set()).update(missing)

    def family(self, key: str, tkey: str) -> tuple | None:
        if tkey not in self._fam_done.get(key, set()):
            return None
        return self._fam.get(key, {}).get(tkey)

    def arch_half(self, card: "_Candidate", arch_t: str) -> tuple:
        """The archetype half of `card`'s fused rate against one archetype,
        remembered on the candidate (see `rater`)."""
        duel_on = bool(self.duel is not None and self.duel.on)
        k = (arch_t, duel_on, id(self.snap))
        remembered = getattr(card, "memo", None)
        if remembered is not None:
            hit = remembered.get(k)
            if hit is not None:
                return hit
        prof = card.profile
        exact_of = getattr(prof, "exact_record", None)
        cluster_of = getattr(prof, "cluster_record", None)
        arch_duel = None
        if duel_on:
            r = (((self.duel.records(card.cards) or {}).get("exact")) or {}).get(arch_t)
            if r:
                g, w = float(r[0]), float(r[1])
                e = float(r[2]) if len(r) > 2 else g / 2
                arch_duel = (g, g / 2 + w - e)
        half = _fusion.arch_level(
            self.matrix(card.archetype, arch_t),
            cluster=cluster_of(arch_t) if cluster_of else None,
            arch_ladder=exact_of(arch_t) if exact_of else None,
            arch_duel=arch_duel)
        if remembered is not None:
            remembered[k] = half
        return half

    def threat_table(self, threats: list[dict]) -> list[tuple]:
        """One opponent's threats, prepared ONCE for the tight loop:
        `(likelihood, family, archetype, deck key, version cells, balance
        drag)` each."""
        out = []
        for t in threats:
            tcards = t.get("cards") or []
            tkey = scout.deck_key(tcards) if len(set(tcards)) == 8 else None
            out.append((float(t.get("likelihood") or 0.0),
                        t.get("family") or t.get("archetype") or "",
                        t.get("archetype") or "other", tkey,
                        self.cells(tkey) if tkey else None,
                        self.drag(tkey)))
        return out

    def lean_rates(self, card: "_Candidate", table: list[tuple]):
        """`(likelihood, family, win rate, source)` for every threat in `table`
        this candidate can be rated against — `rater`'s figures, for a caller
        rating the whole counter pool (`team_scout.score_rates`).

        The same evidence in the same order: the remembered archetype half,
        then the version cells for a hub, or the candidate's own prepared
        family level outside them. No closure, no dictionary and no tier per
        threat, which is most of what rating two thousand lists used to cost.
        """
        hub = self.is_hub(card.key)
        key = card.key
        finish_rate = _fusion.finish_rate
        seen = self._rates
        mine = self.drag(key)
        for like, fam, arch_t, tkey, cells, theirs in table:
            # A RATE THIS REQUEST HAS ALREADY WORKED OUT IN FULL WINS. A
            # teammate can own the very list a pool row is, and theirs was
            # rated first with a richer profile (its one-card variants); the
            # row is drawn from that rate later, so it is ranked on it here.
            # Staged on a real 12v12 before this: twelve lists came back a
            # tenth of a point out of order.
            if seen:
                hit = seen.get((key, tkey or "archetype:" + arch_t), 0)
                if hit != 0:
                    if hit is not None:
                        yield like, fam, hit["winRate"], hit["source"]
                    continue
            fam_l = fam_d = ver_l = ver_d = None
            if tkey:
                if hub and cells:
                    v = cells.get(key)
                    if v:
                        fam_l, ver_l = (v[0], v[1]), (v[2], v[3])
                        fam_d, ver_d = (v[4], v[5]), (v[6], v[7])
                if fam_l is None:
                    fam_l = self.family(key, tkey)
            got = finish_rate(self.arch_half(card, arch_t), fam_l, fam_d, ver_l, ver_d)
            if got is not None:
                rate = got[0]
                if mine or theirs:
                    rate = round(min(100.0, max(0.0, rate + theirs - mine)), 1)
                yield like, fam, rate, got[1]

    def rater(self, card: "_Candidate", *, tiers: bool = True):
        """`rate_for_threat` for `team_scout.score`, for one candidate.

        THE ARCHETYPE HALF IS COMPUTED ONCE A CANDIDATE AND AN ARCHETYPE
        (`matchup_fusion.arch_level`) and remembered on the candidate: it does
        not depend on which list of that archetype the threat is, and the
        counter pool's two thousand candidates live as long as the evidence
        they were built from. Only the two version levels are worked per
        threat. `tiers=False` leaves the confidence tier off — it is drawn on
        the handful of rows that reach the screen and costs a Wilson interval
        on each of the tens of thousands that do not.
        """
        hub = self.is_hub(card.key)

        def arch_half(arch_t: str) -> tuple:
            return self.arch_half(card, arch_t)

        def with_tier(out: dict | None) -> dict | None:
            if tiers and out is not None and "tier" not in out:
                games = int(out["games"])
                out["tier"], out["interval"] = dx.confidence_tier(
                    int(round(out["winRate"] / 100.0 * games)), games)
            return out

        def rate(t: dict) -> dict | None:
            arch_t = t.get("archetype") or "other"
            tcards = t.get("cards") or []
            tkey = scout.deck_key(tcards) if len(set(tcards)) == 8 else None
            memo = (card.key, tkey or "archetype:" + arch_t)
            if memo in self._rates:
                return with_tier(self._rates[memo])
            fam_l = fam_d = ver_l = ver_d = None
            if tkey:
                if hub:
                    cells = self.cells(tkey)
                    v = cells.get(card.key) if cells else None
                    if v:
                        fam_l, ver_l = (v[0], v[1]), (v[2], v[3])
                        fam_d, ver_d = (v[4], v[5]), (v[6], v[7])
                if fam_l is None:
                    # A list outside the cells, or a hub against a threat the
                    # cells do not hold. The second is prepared only when the
                    # caller asked (`prepare(hubs_too=True)`), so on Team
                    # Analysis this reads None for a hub, exactly as before.
                    fam_l = self.family(card.key, tkey)
            out = _fusion.finish(
                arch_half(arch_t),
                fam_ladder=fam_l, fam_duel=fam_d, ver_ladder=ver_l, ver_duel=ver_d)
            if out is not None and self.balance:
                # The balance log, on both sides, BEFORE the rate is remembered:
                # the tight loop reads the remembered figure as it stands.
                shift = self.drag(tkey) - self.drag(card.key)
                if shift:
                    out["winRate"] = round(
                        min(100.0, max(0.0, float(out["winRate"]) + shift)), 1)
                    out["balanceShift"] = round(shift, 2)
            out = with_tier(out)
            self.stats[out["source"] if out else "none"] = (
                self.stats.get(out["source"] if out else "none", 0) + 1)
            self._rates[memo] = out
            return out

        return rate


def _duel_row(pick: dict, owner: dict | None, threats: list[dict], snap: dict | None,
              ctx: _DuelContext, *, fill: bool) -> dict | None:
    """A duel pick as a full recommendation row.

    SCORED BY THE LADDER BRAIN TOO, so the row carries every field every other
    row carries — its expected win rate against the same projection, its
    archetype figures, its practice line — and the reader can compare it with
    the rows around it on the same terms. The duel figures ride beside those.
    None when the ladder has nothing to say about it, which drops the pick
    rather than drawing a row with half its figures missing.
    """
    arch = pick.get("archetype") or dcx._archetype_of_hash(pick["key"])
    prof = ctx.profile(pick["cards"], arch)
    if prof is None:
        return None
    cards, art, inferred = ctx.seat(pick["cards"])
    games = int(pick.get("games") or 0) if owner else 0
    wins = int(pick.get("wins") or 0) if owner else 0
    deck = {
        "cards": cards, "art": art, "inferredArt": inferred,
        "winCondition": arch, "name": cd.deck_title(arch, cards),
        # AN OWN DUEL DECK'S PRACTICE IS THEIR DUEL GAMES WITH IT — the one
        # count of how often they have actually flown it.
        "matches": games, "wins": wins,
        "winRate": round(100.0 * wins / games, 1) if games else 0.0,
        "useRate": 0.0,
    }
    try:
        row = _score(_Candidate(deck, owner, prof), threats, snap, ctx)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return None
    if row is None:
        return None
    row["vs"] = scout.vs_archetypes(row)
    row["known"] = 8 if owner else int(pick.get("known") or 0)
    row["personalScore"] = round(
        float(row.get("recommendationScore") or row["score"])
        + scout._known_bonus(row["known"]), 3)
    if fill and not owner:
        row["fill"] = True
    row["duel"] = _duel.public(pick["duel"])
    row["duelPick"] = pick.get("pick") or _duel.PICK_POPULATION
    return row


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


def _own_duel_rows(mate: dict, ctx: _DuelContext | None, projection: dict,
                   threats: list[dict], snap: dict | None, held: list[dict]) -> list[dict]:
    """A teammate's OWN duel decks proven against this opponent, as rows.

    Their duel decks are theirs whether or not the ladder has seen them, and
    one that duel players win with against what this opponent brings is the
    most personal answer there is. They join the teammate's own candidates and
    are ranked on the same figure as everything else — a duel deck is no
    longer PINNED under the #1 whatever that figure says.
    """
    if ctx is None or not ctx.on or not projection:
        return []
    try:
        decks = ctx.player_decks(mate)
        own = _duel.own_answers(projection, decks,
                                records_for=lambda d: ctx.records(d["cards"]))
    except Exception:  # noqa: BLE001 - the ladder list stands on its own
        traceback.print_exc()
        return []
    rows = []
    for o in own:
        if any(_duel.same_deck(o["cards"], h.get("cards")) for h in held + rows):
            continue
        row = _duel_row(o, mate, threats, snap, ctx, fill=False)
        if row is not None:
            rows.append(row)
    return rows


#: What the SELECTION wrote on a row, carried over when the row is rated in
#: full for the screen.
_CHOSEN_KEYS = ("answers", "fill", "squadPick", "covers", "known", "personalScore", "rate",
                "worst", "lift", "allRound")


def _finish(rows: list[dict], by_key: dict, threats: list[dict],
            ctx: _DuelContext | None, projection: dict,
            snap: dict | None = None) -> list[dict]:
    """Dress the rows that were chosen, and put the duels' figures on them.

    A pool row was only RATED (`_score(dress=False)`: its figures and its rate
    against each family, no per-threat table); the handful that made a list
    are rated in full here — the same rates, remembered — then seated and
    named. Every row with enough duel games carries its duel figures, and one
    the duels call strong is marked `duelProven`: the ladder and the duels
    agreeing, on a row that earned its place on the one figure the list is
    ordered by.
    """
    out = []
    for r in rows:
        if "art" not in r:
            card = by_key.get(r["key"])
            full = _score(card, threats, snap, ctx) if card is not None else None
            if full is not None:
                for k in _CHOSEN_KEYS:
                    if k in r:
                        full[k] = r[k]
                r = full
        if ctx is not None and ctx.on and projection:
            try:
                r["duel"] = ctx.figures(r.get("cards"), projection)
            except Exception:  # noqa: BLE001
                r["duel"] = None
            if (r.get("duel") or {}).get("strong"):
                r["duelProven"] = True
        # A LIST FROM THE DUEL CATALOGUE says so — the label the screen already
        # draws for a duel deck. It is on the list because of its figure, like
        # every row; the label says where the list comes from.
        if r.get("origin") == "duel" and not r.get("duelPick"):
            r["duelPick"] = _duel.PICK_POPULATION if _duel is not None else "duel"
        out.append(r)
    return out


def _slim(row: dict) -> dict:
    """A row for a per-family or per-card list: the deck and its figures,
    without the per-threat table (`_evidence_on_top`'s argument)."""
    r = dict(row)
    r.pop("matchups", None)
    r.pop("explanation", None)
    return r


def _by_card(rows: list[dict], threats: list[dict], finish) -> dict | None:
    """THE CARD VIEW: the cards that answer what they play, and for each the
    best decks holding it — ranked by measured matchup rate.

    The pipeline the account holder described (2026-10-10): "figure 'this card
    counters most of their archetypes', search decks for that card, use
    ranking to find the top decks of that card, then compare each deck by
    matchup percentage against the opponent's decks."

      1. THEIR CARDS, by the share of their games each is in.
      2. WHICH CARDS ARE WORTH SEARCHING is the manual's call
         (`card_counters.worth`): a card that answers something they really
         play, or a win condition they carry little against.
      3. WHICH OF THOSE COUNTER THEM is the database's: `lift` is how much
         better the pool's decks holding the card do against what they play
         than the pool does — measured rates, over `CARD_MIN_DECKS` lists or
         more. A card whose decks do no better than average is not listed,
         whatever the manual says about it.
      4. THE DECKS under each card are the best holding it, on the same
         figure every other list is ordered by.

    None when the card manual is not deployed.
    """
    if _cards is None or not rows:
        return None
    # The manual is living data: a roles file pushed since the last look is
    # read here, at the one place a card view starts.
    try:
        _cards.refresh()
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    if not _cards.available():
        return None
    use = _cards.usage(threats)
    if not use:
        return None
    mean_all = sum(float(r["expectedWinRate"]) for r in rows) / len(rows)
    holding: dict[str, list[dict]] = {}
    for r in rows:
        for c in r.get("cards") or []:
            holding.setdefault(c, []).append(r)

    found = []
    for card, rs in holding.items():
        if len(rs) < CARD_MIN_DECKS:
            continue
        why = _cards.worth(card, use,
                           win_condition=bool(dx.card_info(card).get("is_win_condition")))
        if why is None:
            continue
        lift = sum(float(r["expectedWinRate"]) for r in rs) / len(rs) - mean_all
        if lift <= 0:
            continue
        found.append((card, rs, why, lift))
    found.sort(key=lambda f: (-f[3], f[0]))
    found = found[:_cards.COUNTER_CARDS]

    def one(item):
        card, rs, why, lift = item
        rs = sorted(rs, key=lambda r: (-float(r["expectedWinRate"]),
                                       -float(r.get("recommendationScore") or 0), r["key"]))
        picked: list[dict] = []
        count: dict[str, int] = {}
        for r in rs:
            if len(picked) >= CARD_DECKS:
                break
            if float(r["expectedWinRate"]) < scout.FLOOR_RATE:
                break
            # The rules of every list here: no near-copy of a deck already
            # shown, and one win condition twice at most — three Log Bait
            # lists under "Rocket" would be one answer shown three times.
            a = r.get("archetype") or ""
            if count.get(a, 0) >= scout.PER_ARCHETYPE:
                continue
            if any(len(set(r["cards"]) & set(p["cards"])) >= scout.SAME_DECK_OVERLAP
                   for p in picked):
                continue
            picked.append(r)
            count[a] = count.get(a, 0) + 1
        return {
            "card": card,
            "why": why["why"],
            # Their cards this one answers / their cards that answer it, with
            # the share of their games each is in. Card keys and shares only.
            "answers": why["answers"][:5],
            "open": why["open"][:5],
            "exposure": why["exposure"],
            "lift": round(lift, 1),
            "lists": len(rs),
            # Copies: a deck can be the best under two cards, and two searches
            # must not dress one shared row at once.
            "decks": [_slim(r) for r in finish([dict(r) for r in picked])],
        }

    # ONE SEARCH A CARD, side by side: each reads the same rated pool, so the
    # searches do not wait on one another.
    cards = [c for c in _POOL.map(one, found) if c["decks"]]
    return {"theirCards": _cards.their_cards(use), "cards": cards}


def _folder(opponent: dict, blue: list[dict], cards: list[_Candidate],
            snap: dict | None, top_n: int = TOP_N,
            seeds: dict | None = None, ctx: _DuelContext | None = None,
            *, views: bool = False) -> dict:
    """One opponent, and what should be brought against them.

    BOTH MODES COME THROUGH HERE. In a scouting report `blue` is empty, so
    `perPlayer` falls out empty on its own rather than being special-cased —
    the loop below has nothing to iterate. That is the whole reason the two
    modes are one function: the left-hand side of a folder (what they play) and
    the ranking of the right-hand side are identical work, and only the pool
    and the row count differ.

    `views` adds the two other readings of the same rated pool — the best
    counters to each family they play (`byFamily`) and the decks behind each
    counter card (`byCard`). The Deck Counter asks for them; a board of twelve
    opponents does not carry them.
    """
    decks = (opponent.get("decks") or [])[:OPPONENT_DECKS]
    _archetypes_for(decks)
    # WHAT THEY PLAY — every deck they fielded in the window, own-deck games
    # and duel games, most played first — and nothing they have not played.
    projection = _plays(opponent.get("decks") or [], opponent.get("older"))
    threats = projection["threats"]
    plays = projection.get("plays") or []
    spread = _spread_of(plays)
    names = {p["family"]: p["name"] for p in plays}

    # THE DUELS' OWN PROJECTION, for the duel figures every row carries: the
    # one above blended with what this opponent brought to their own duels.
    duel_proj: dict = {}
    duel_weight, their_duels = 0.0, 0
    if ctx is not None and ctx.on and threats:
        try:
            opp_wcs = ctx.player_wcs(opponent)
            their_duels = sum(opp_wcs.values())
            duel_proj, duel_weight = _duel.duel_projection(threats, opp_wcs)
        except Exception:  # noqa: BLE001 - the duel half must never take the board down
            traceback.print_exc()
            duel_proj = {}

    by_key: dict[str, _Candidate] = {}
    fx_on = ctx is not None and getattr(ctx, "fx", None) is not None and ctx.fx.on
    table = ctx.fx.threat_table(threats) if fx_on and threats else None

    def rate_all(pool: list[_Candidate]) -> list[dict]:
        rows = []
        for card in pool:
            row = _score(card, threats, snap, ctx, dress=False, table=table)
            if row:
                rows.append(row)
                by_key.setdefault(card.key, card)
        # HOW MUCH MORE each list gains against THIS opponent than the typical
        # list does (`scout.pool_lift`), on the whole pool before any cut.
        scout.pool_lift(rows)
        rows.sort(key=lambda r: (-r["score"], r["key"]))
        return _distinct(rows)

    scored: list[dict] = []
    if threats:
        if ctx is not None and getattr(ctx, "fx", None) is not None:
            # A teammate's own lists are outside the version cells; their
            # family evidence comes off their own ladder histories, read once
            # each, on the shared pool, before anything is scored.
            ctx.fx.prepare(cards, threats)
        if blue:
            for card in cards:
                row = _score(card, threats, snap, ctx)
                if row:
                    scored.append(row)
            scored.sort(key=lambda r: (-r["score"],
                                       -((r["comfort"] or {}).get("games") or 0),
                                       r["name"]))
        else:
            scored = rate_all(cards)

    # THE POPULATION, RATED ONCE PER FOLDER: every vetted ladder list and every
    # duel-catalogue list (`_counter_candidates`), against what THIS opponent
    # plays. In a scouting report `cards` already is that pool.
    _pool_rows: list[dict] | None = None

    def pool_rows() -> list[dict]:
        nonlocal _pool_rows
        if _pool_rows is None:
            _pool_rows = scored if not blue else (
                rate_all(_counter_candidates()) if threats else [])
        return _pool_rows

    def finish(rows: list[dict]) -> list[dict]:
        out_rows = _finish(rows, by_key, threats, ctx, duel_proj, snap)
        for r in out_rows:
            w = r.get("worst")
            if w and not w.get("name"):
                w["name"] = names.get(w["family"]) or dcx._label(w["family"] or "other")
        return out_rows

    def shortlist(rows: list[dict]) -> list[dict]:
        """The pool rows a squad can actually be offered: the strongest
        overall, and the best against each family they play. A teammate's list
        is seven rows chosen within a few points of the top, so handing every
        teammate two thousand rows to copy and sort is the whole cost of a
        large board for decks that can never be picked."""
        if len(rows) <= SQUAD_POOL:
            return rows
        keep = {r["key"]: r for r in rows[:SQUAD_POOL]}
        for p in plays:
            if p["share"] < scout.ANSWER_SHARE:
                continue
            fam = p["family"]
            best = sorted((r for r in rows if r["vs"].get(fam) is not None),
                          key=lambda r: (-r["vs"][fam], r["key"]))[:SQUAD_POOL_PER_FAMILY]
            for r in best:
                keep.setdefault(r["key"], r)
        return sorted(keep.values(), key=lambda r: (-r["score"], r["key"]))

    by_tag: dict[str, list[dict]] = {}
    for row in scored:
        if row["owner"]:
            by_tag.setdefault(row["owner"]["tag"], []).append(row)

    # A TEAMMATE'S CARDS ARE THE ONES IN DECKS THEY ACTUALLY RUN — the same
    # `MIN_COMFORT_GAMES` floor that decides which of their decks are
    # candidates, so "built out of your cards" and "a deck you play" cannot
    # disagree about what counts as playing it.
    mate_cards: dict[str, set[str]] = {}
    for mate in blue:
        pool_cards: set[str] = set()
        for d in mate.get("decks") or []:
            if int(d.get("matches") or 0) >= MIN_COMFORT_GAMES:
                pool_cards.update(d.get("cards") or [])
        mate_cards[mate["tag"]] = pool_cards

    # Their own duel decks proven against this opponent join their own rows.
    duel_picked = 0
    for mate in blue:
        if not threats:
            break
        mine = by_tag.setdefault(mate["tag"], [])
        extra = _own_duel_rows(mate, ctx, duel_proj, threats, snap, mine)
        duel_picked += len(extra)
        mine.extend(extra)

    # THE SQUAD'S QUESTION, NOT FIVE COPIES OF ONE PLAYER'S. `scout.squad_plan`
    # assigns each teammate a different #1 from the options the evidence
    # cannot separate; the rest of each list is the strongest counters to what
    # this opponent plays (`scout.counters`).
    plan_lists: dict[str, list[dict]] | None = None
    cover: list[dict] = []
    if blue and threats:
        try:
            squad = [{"tag": mate["tag"], "own": by_tag.get(mate["tag"], []),
                      "cards": mate_cards[mate["tag"]]} for mate in blue]
            plan_lists, cover = scout.squad_plan(squad, shortlist(pool_rows()), threats,
                                                 limit=PER_PLAYER_TOP_N)
            who = {m["tag"]: m["name"] for m in blue}
            for c in cover:
                c["name"] = names.get(c["archetype"]) or dcx._label(c["archetype"] or "other")
                c["player"] = who.get(c["tag"]) if c["tag"] else None
        except Exception:  # noqa: BLE001 - the per-teammate lists are the fallback
            traceback.print_exc()
            plan_lists, cover = None, []

    def suggested(own: list[dict], limit: int) -> list[dict]:
        """Own decks and the population's, as one list of counters."""
        try:
            short = shortlist(pool_rows())
            extra = scout.fills(own, short, need=len(short))
        except Exception:  # noqa: BLE001 - the population half must never take the board down
            traceback.print_exc()
            extra = []
        return scout.counters(list(own) + extra, plays, limit=limit)

    per_player = []
    for mate in blue:
        rows = by_tag.get(mate["tag"], [])
        # `own`, NOT `decks`. Naming it `decks` rebound the opponent's list
        # eight lines above and `theirDecks` came back holding the LAST blue
        # player's decks — the left half of the board showing the wrong team.
        own = [d for d in (mate.get("decks") or [])
               if len(set(d.get("cards") or [])) == 8]
        listing = (plan_lists[mate["tag"]] if plan_lists is not None
                   else suggested(rows, PER_PLAYER_TOP_N))
        per_player.append({
            "owner": {"tag": mate["tag"], "name": mate["name"]},
            "basis": mate["basis"],
            # WHAT DECKKIES SUGGESTS THIS TEAMMATE PLAYS: their own decks and
            # the population's — ladder lists and duel lists — as ONE list of
            # counters to what this opponent plays, in the order of the figure
            # printed. Their own decks keep a real edge (`FIT_WEIGHT`, up to
            # 1.5 points), and a near-copy of one of theirs is refused.
            "decks": _evidence_on_top(finish(listing), keep=0),
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

    # The squad-wide list (a match plan's folder face; a scouting report's
    # whole answer).
    if not threats:
        recommended = []
    elif blue:
        recommended = suggested(_distinct(scored), top_n)
    else:
        recommended = scout.counters(scored, plays, limit=top_n)
    recommended = finish(recommended)
    for r in recommended:
        if blue and not r.get("owner"):
            r["fill"] = True

    duel = ({"available": False} if ctx is None or not ctx.on else {
        "available": True,
        "brain": _duel.DUEL_BRAIN_VERSION,
        "weight": duel_weight,
        "theirGames": their_duels,
        "projection": [
            {"archetype": a, "name": dcx._label(a), "likelihood": round(v, 4)}
            for a, v in sorted(duel_proj.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
        "picked": duel_picked,
        "pickedRecommended": sum(1 for r in recommended if r.get("origin") == "duel"),
    })

    out = {
        "player": {
            "tag": opponent["tag"], "name": opponent["name"],
            "basis": opponent["basis"], "battles": opponent["battles"],
            "winRate": opponent["winRate"], "tracking": opponent["tracking"],
            "coverage": opponent["coverage"], "window": opponent["window"],
        },
        # LEFT SIDE of the opened folder: what they actually play.
        "theirDecks": decks,
        "spread": spread,
        # WHAT THEY PLAY, by family: the shares everything on the right was
        # scored against, and the names of the chips under each deck.
        "plays": [{"family": p["family"], "archetype": p["archetype"],
                   "name": p["name"], "share": p["share"], "games": p["games"],
                   "decks": p["decks"], "played": p.get("played"),
                   "duelGames": p.get("duelGames")}
                  for p in plays if p["share"] >= scout.PLAYS_MIN_SHARE],
        # The lists the rates were measured against: their own decks, most
        # likely first, summing to 1.0.
        "threats": threats,
        "churn": projection["churn"],
        "mass": projection.get("mass"),
        # HOW THEIR HISTORY WAS READ (4.0): the weights, and how many duel
        # games stood behind the projection.
        "read": projection.get("read"),
        # RIGHT SIDE: WHAT DECKKIES SUGGESTS TO PLAY — the strongest counters
        # to what they play, in the order of the figure printed.
        "recommended": _evidence_on_top(recommended),
        "perPlayer": per_player,
        "duel": duel,
        # WHICH TEAMMATE'S #1 ANSWERS EACH FAMILY THEY PLAY, most played first.
        # Empty in a scouting report (nobody to assign).
        "squadCover": cover,
        "considered": len(cards),
        "brain": scout.BRAIN_VERSION,
        # Said out loud rather than left to be inferred from an empty list.
        "reason": (
            None if (scored or recommended) else
            "no_history" if not threats else "no_evidence"
        ),
    }
    if views and threats:
        # THE SAME RATED POOL, READ TWO MORE WAYS, side by side with nothing
        # waiting on anything: per family they play, and per counter card.
        rows = pool_rows()
        fam_job = _POOL.submit(lambda: [
            {**{k: v for k, v in g.items() if k != "decks"},
             "decks": [_slim(r) for r in finish(g["decks"])]}
            for g in scout.answers(rows, plays)])
        # The card view runs HERE, not on the pool: its own searches are what
        # go to the pool, and a pool job that waits on pool jobs can starve.
        try:
            out["byCard"] = _by_card(rows, threats, finish)
        except Exception:  # noqa: BLE001 - a view is extra; the list stands
            traceback.print_exc()
            out["byCard"] = None
        try:
            out["byFamily"] = fam_job.result()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            out["byFamily"] = []
    return out


def _combined(red: list[dict], cards: list[_Candidate],
              snap: dict | None, seeds: dict | None = None,
              ctx: _DuelContext | None = None) -> dict:
    """The whole opposing roster as ONE spread, and what answers all of it.

    THE QUESTION A SCOUTING REPORT CAN ASK AND A MATCH PLAN CANNOT. A match
    plan assigns a person to each opponent, so a squad-wide answer would be
    advice nobody is in a position to take. With one roster on the table the
    real question is often the other one — *we are playing this clan next week,
    what should we be practising* — and that is a property of the roster as a
    whole rather than of any player in it.

    WEIGHTED BY GAMES, NOT BY PLAYER: every opponent's decks are pooled and
    projected as one player's would be (`_plays`), so a roster's least active
    member does not get the same say as its most active.
    """
    pooled: list[dict] = []
    pooled_older: list[dict] = []
    for opp in red:
        pooled.extend(dict(d) for d in (opp.get("decks") or []))
        pooled_older.extend(dict(d) for d in (opp.get("older") or []))

    projection = _plays(pooled, pooled_older)
    threats = projection["threats"]
    plays = projection.get("plays") or []
    if not threats:
        return {"players": len(red), "spread": [], "threats": [], "plays": [],
                "recommended": [], "reason": "no_history",
                "brain": scout.BRAIN_VERSION}

    by_key: dict[str, _Candidate] = {}
    fx_on = ctx is not None and getattr(ctx, "fx", None) is not None and ctx.fx.on
    table = ctx.fx.threat_table(threats) if fx_on else None
    scored = []
    for c in cards:
        row = _score(c, threats, snap, ctx, dress=False, table=table)
        if row:
            scored.append(row)
            by_key.setdefault(c.key, c)
    scout.pool_lift(scored)
    scored.sort(key=lambda r: (-r["score"], r["key"]))
    recommended = scout.counters(_distinct(scored), plays, limit=SCOUT_TOP_N)

    # THE DUELS, ROSTER-WIDE: every opponent's own duel games pooled, for the
    # duel figures on each row.
    duel = {"available": False}
    proj: dict = {}
    if ctx is not None and ctx.on:
        try:
            pooled_wcs: dict[str, int] = {}
            for opp in red:
                for a, n in ctx.player_wcs(opp).items():
                    pooled_wcs[a] = pooled_wcs.get(a, 0) + n
            proj, weight = _duel.duel_projection(threats, pooled_wcs)
            duel = {
                "available": True, "brain": _duel.DUEL_BRAIN_VERSION,
                "weight": weight, "theirGames": sum(pooled_wcs.values()),
                "projection": [
                    {"archetype": a, "name": dcx._label(a), "likelihood": round(v, 4)}
                    for a, v in sorted(proj.items(), key=lambda kv: (-kv[1], kv[0]))],
            }
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    recommended = _finish(recommended, by_key, threats, ctx, proj, snap)
    if duel.get("available"):
        duel["picked"] = sum(1 for r in recommended if r.get("origin") == "duel")
    return {
        "players": len(red),
        "spread": _spread_of(plays),
        "plays": [{"family": p["family"], "archetype": p["archetype"],
                   "name": p["name"], "share": p["share"], "games": p["games"],
                   "decks": p["decks"], "played": p.get("played"),
                   "duelGames": p.get("duelGames")}
                  for p in plays if p["share"] >= scout.PLAYS_MIN_SHARE],
        "threats": threats,
        "churn": projection["churn"],
        "mass": projection.get("mass"),
        "read": projection.get("read"),
        "recommended": _evidence_on_top(recommended),
        "duel": duel,
        "reason": None if scored else "no_evidence",
        "brain": scout.BRAIN_VERSION,
    }


def bring(tag: str, since: str | None = None, until: str | None = None) -> dict:
    """WHAT TO BRING AGAINST ONE PLAYER — the Deck Counter's list.

    The same engine, the same pool and the same figures as a scouting report
    of that one player, so the two screens cannot disagree about a deck: the
    seven strongest counters to what they play, the best counters to each
    family they play, and the decks behind each counter card.

    It replaces a list that restated the player's own worst matchups from
    "your" side. Measured before it went (2026-10-10, 437 held-out players):
    35.5% of the rows that list told a reader to bring had a rate UNDER 50% by
    its own figure, and the deck drawn beside each was the list of that
    archetype the player had MET most — the meta's list, which is why six
    players were shown the same eight cards.
    """
    opp = _resolve(tag, DEFAULT_DAYS, window=(since, until) if since else None)
    _seat_decks((opp.get("decks") or [])[:RESOLVE_SEATED], dcx.seater())
    snap = dcx._snap()
    cards = _counter_candidates()
    ctx = _DuelContext()
    ctx.fx = _FusionContext(ctx, snap)
    ctx.fx.balance = True
    if ctx.on:
        try:
            ctx.prefetch([c.cards for c in cards])
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    folder = _folder(opp, [], cards, snap, SCOUT_TOP_N, None, ctx, views=True)
    return {
        "basis": opp["basis"],
        "battles": opp["battles"],
        "window": opp["window"],
        "plays": folder["plays"],
        "read": folder.get("read"),
        "decks": folder["recommended"],
        "byFamily": folder.get("byFamily") or [],
        "byCard": folder.get("byCard"),
        "reason": folder["reason"],
        "pool": {"decks": len(cards), **counter_pool_stats()},
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
        _seat_decks((p.get("decks") or [])[:RESOLVE_SEATED], seat)

    snap = dcx._snap()
    # READ ONCE FOR THE WHOLE RUN. `seeds()` is a dictionary off the snapshot,
    # so this is a reference rather than a copy and costs nothing — but asking
    # per folder would re-enter `_snap()` ten times for an answer that cannot
    # change inside one request.
    seeds = dcx.seeds() or None
    # THE COUNTER POOL in a scouting report: every vetted ladder list and
    # every duel-catalogue list. A match plan's `cards` are the squad's own
    # decks, and each folder rates the same counter pool beside them.
    cards = _counter_candidates() if is_scout else _candidates(blue)
    top_n = SCOUT_TOP_N if is_scout else TOP_N

    # THE DUEL BRAIN, read once for the request. Every list the board draws
    # holds decks from the squad's pool and the population's (the scout seeds),
    # so both have their duel records fetched up front, on the pool, instead of
    # one at a time inside the folder loop.
    ctx = _DuelContext()
    ctx.fx = _FusionContext(ctx, snap)
    ctx.fx.balance = True
    if ctx.on:
        try:
            ctx.prefetch([c.cards for c in cards]
                         + ([] if is_scout else [c.cards for c in _counter_candidates()]))
        except Exception:  # noqa: BLE001
            traceback.print_exc()

    folders = [_folder(opp, blue, cards, snap, top_n, seeds, ctx) for opp in red]

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
            # The lists every folder's counters were chosen from, by source.
            "counters": counter_pool_stats(),
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
        # THE SECOND BRAIN, and the evidence it read: the duel index's build
        # and window. `available: false` means every list above is the ladder
        # brain's alone, and nothing on the screen may claim otherwise.
        "duelBrain": ({
            "available": True,
            "brain": _duel.DUEL_BRAIN_VERSION,
            "builtAt": ctx.status.get("builtAt"),
            "windowFrom": ctx.status.get("windowFrom"),
            "windowTo": ctx.status.get("windowTo"),
            "windowDays": ctx.status.get("windowDays"),
            "games": ctx.status.get("windowGames"),
            "catalogue": ctx.status.get("catalogue"),
        } if ctx.on and ctx.status else {"available": False}),
        # THE FUSED RATE, and what it stood on: which brain, whether the
        # version cells were there, and how many rates came off each level.
        # `sources.version` is how many threat rates this board read at the
        # threat's own list — the number that says the rate was version-aware.
        "fusion": ({
            "brain": _fusion.FUSION_VERSION,
            "versionCells": bool(_duel_index and _duel_index.status().get("versionCells")),
            "sources": dict(ctx.fx.stats),
        } if ctx.fx is not None and ctx.fx.on else {"available": False}),
        # WHAT THE THREE-SLOT RULE SKIPPED: lists Deckkies would otherwise have
        # offered whose cards cannot fill every special slot. Counted, because
        # a filter nobody can see is a filter nobody can check.
        "slots": {
            "poolSkipped": scout_pool_slot_gaps(),
            "duelSkipped": getattr(ctx, "slot_gaps", 0),
        },
    }
    # THE ROSTER-WIDE READ, scout only. In a match plan every recommendation
    # belongs to a named teammate, so a squad-wide answer would be advice with
    # nobody to take it. See `_combined`.
    if is_scout:
        out["overall"] = _combined(red, cards, snap, seeds, ctx)
    return out


def _side_summary(p: dict) -> dict:
    """A roster chip: who they are and how well they could be read."""
    return {
        "tag": p["tag"], "name": p["name"], "basis": p["basis"],
        "battles": p["battles"], "winRate": p["winRate"],
        "decks": len(p.get("decks") or []),
        "tracking": p["tracking"], "window": p["window"],
    }
