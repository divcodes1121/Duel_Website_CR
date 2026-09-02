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
import traceback

import clash_data as cd
import deck_counter as dcx
import duel_combos as dx
import live_player as live
import tracking

# ── Floors ──────────────────────────────────────────────────────────────────

#: Squad size cap per side. Mirrors `MAX_SQUAD` in `src/utils/squadParse.ts`,
#: and the mirror is load-bearing: the client REFUSES a roster over the cap,
#: this file SLICES one. A client that permits more than this does not get an
#: error, it gets a report with the tail of its roster missing and nothing
#: saying so. The two constants move in the same change, always.
#:
#: TEN, RAISED FROM EIGHT 2026-08-30, because ten is what people paste — a
#: ranked list off a Discord channel is numbered 1 to 10, and a cap that
#: refuses the most common real input only asks the person to decide which two
#: opponents do not matter. Cost: the scoring loop is `blue x red`, so 64
#: candidate-folder pairs becomes 100, but that loop reads memory only (every
#: profile is built once, up front). The real bill is the 20 player
#: resolutions, which is a quarter more than 16, not 1.6x more.
MAX_SQUAD = 10

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

#: How many blue decks a folder recommends. The user-facing promise is "top 3".
TOP_N = 3

#: How many decks a SCOUT folder recommends. More than `TOP_N`, deliberately.
#:
#: In Match Plan three is the right number because the list is per teammate and
#: the reader is choosing a person, not a deck — a fourth option for one player
#: is noise beside a fifth player with none. A scouting report has no players to
#: split by, so the same three rows would be the entire answer, and the reader
#: here is choosing a deck to go and learn: they want to see where the ranking
#: flattens out. Five is enough rows for that to be visible and still short
#: enough to read at a glance.
SCOUT_TOP_N = 5

#: Opponent decks shown on the left of a folder, and the spread they weight.
#: Their long tail is noise for this purpose: a deck played once tells you
#: nothing about what they will bring to a match.
OPPONENT_DECKS = 6
MIN_OPPONENT_DECK_GAMES = 2

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
         "games": n, "weight": n / total, "share": round(100 * n / total, 1)}
        for wc, n in per.items()
    ]
    out.sort(key=lambda s: (-s["games"], s["archetype"]))
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

    __slots__ = ("cards", "key", "archetype", "name", "art", "owner",
                 "games", "wins", "win_rate", "use_rate", "profile")

    def __init__(self, deck: dict, owner: dict | None, profile: "_DeckProfile"):
        self.cards = list(deck.get("cards") or [])
        self.key = ",".join(sorted(set(self.cards)))
        self.archetype = deck.get("winCondition") or "other"
        self.name = deck.get("name") or dcx._label(self.archetype)
        self.art = deck.get("art") or {}
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
    profiles: dict[str, "_DeckProfile"] = {}
    out: list["_Candidate"] = []

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
            try:
                prof = profiles.get(key)
                if prof is None:
                    prof = _DeckProfile(deck["cards"],
                                        deck.get("winCondition") or "other")
                    profiles[key] = prof
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
    """The archetype representatives, profiled — the scouting report's pool.

    ONE DECK PER ARCHETYPE, from `deck_counter._representatives()`. See the
    module docstring for why these and not the meta board's top 50.

    THE PROFILES ARE BUILT IN ONE PASS AND HELD, which is not merely an
    optimisation here — it is required. `_CLUSTER_CACHE` upstream is 32 entries
    and CLEARS ITSELF WHOLE when it overflows; seventeen decks at two cluster
    levels is thirty-four, so the cache would empty mid-build. That costs
    nothing while the build walks each deck exactly once and never returns to
    it (which is what this loop does), and it would cost a full rescan per deck
    if anything ever looped opponents on the outside. Do not restructure this
    into "score each opponent, widening as needed" — that is the same trap the
    blue pool's note describes, with a cache too small to absorb it.
    """
    global _SCOUT_POOL

    snap = dcx._snap()
    # The snapshot's own build time IS the identity of the representatives.
    # `None` when there is no snapshot at all, which is a state the caller has
    # to report rather than serve an empty ranking for.
    key = (snap or {}).get("computedAt")
    if key is None:
        return []
    if _SCOUT_POOL is not None and _SCOUT_POOL[0] == key:
        return _SCOUT_POOL[1]

    out: list["_Candidate"] = []
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
                "cards": cards,
                "art": rep.get("art") or {},
                "winCondition": arch,
                "name": rep.get("name") or dcx._label(arch),
                # No owner means no games piloted and no win rate of anyone's
                # own. Left at zero rather than invented; `_score` never reads
                # them for an ownerless candidate.
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


def _score(card: _Candidate, spread: list[dict], snap: dict | None) -> dict | None:
    """One candidate against one opponent's whole spread.

    Returns None when NOTHING in the spread could be answered — no rung of the
    ladder had evidence for any archetype they play. That is a real state on a
    thin database and it must not be rendered as 50.0%, which is what averaging
    over an empty set would produce.

    `weighted` renormalises over the archetypes that DID answer. The
    alternative — treating an unanswerable archetype as even — silently pulls
    every deck toward 50 and makes the ranking flatter the less evidence there
    is, which is exactly backwards.
    """
    rows = []
    answered = 0.0
    total_win = 0.0
    for s in spread:
        m = card.against(s["archetype"], snap)
        if not m:
            rows.append({
                "archetype": s["archetype"], "name": s["name"],
                "share": s["share"], "winRate": None, "source": None,
                "games": 0, "tier": None,
            })
            continue
        w = s["weight"]
        answered += w
        total_win += w * float(m.get("winRate") or 0.0)
        rows.append({
            "archetype": s["archetype"], "name": s["name"], "share": s["share"],
            "winRate": m.get("winRate"), "source": m.get("source"),
            "sourceText": dcx.SOURCE_TEXT.get(m.get("source")),
            # `games`, NOT `battles`. Every rung of the ladder — the exact
            # deck profile, both clusters and the archetype matrix — publishes
            # its denominator as `games`; `battles` is a field on the profile
            # WRAPPER, not on a per-archetype record, so reading it here gave
            # null on every rung and the client then called
            # `.toLocaleString()` on it. Found by calling the real endpoint,
            # not by the unit tests, whose fixture had invented the name.
            "games": m.get("games") or 0, "tier": m.get("tier"),
            "interval": m.get("interval"), "decks": m.get("decks"),
        })

    if answered <= 0:
        return None

    expected = total_win / answered

    # NO OWNER MEANS NO COMFORT, and the ranking is then the matchup alone.
    # A scout row is an archetype representative — nobody's deck — so there is
    # nothing to be practised at and no tiebreak to apply. Defaulting the bonus
    # to zero would give the same ordering, but publishing `comfort: {games: 0}`
    # would state that somebody has piloted it zero times, which is a claim
    # about a roster that was never pasted.
    comfort = _comfort(card.games) if card.owner else 0.0

    # THE DECK'S OWN RECORD ACROSS THE FIELD, for scout rows only. It is the
    # denominator the headline is missing on its own: a deck expected to win
    # 58% against this opponent while winning 57% against everybody is barely a
    # counter, and one at 58% against a 49% baseline is a real answer. The
    # screen shows the difference; this ships both halves rather than the
    # subtraction, so the two numbers can be read separately.
    overall = card.profile.overall if not card.owner else None

    out = {
        "cards": card.cards,
        "art": card.art,
        "archetype": card.archetype,
        "name": card.name,
        "avgElixir": dcx._avg_elixir(card.cards),
        "owner": {"tag": card.owner["tag"], "name": card.owner["name"]}
        if card.owner else None,
        "comfort": {
            "games": card.games,
            "wins": card.wins,
            "winRate": card.win_rate,
            "useRate": card.use_rate,
            # What the tiebreak was worth here, stated rather than buried in
            # `score`. A reader comparing two rows can see whether the order
            # came from the matchup or from the practice.
            "bonus": round(comfort, 2),
        } if card.owner else None,
        # The headline. Weighted over the archetypes that had evidence.
        "expectedWinRate": round(expected, 1),
        # How much of their play this figure actually covers. A deck scored on
        # 40% of their spread is a different claim from one scored on all of it.
        "spreadCovered": round(100 * answered, 1),
        "score": round(expected + comfort, 3),
        "matchups": rows,
    }
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


def _folder(opponent: dict, blue: list[dict], cards: list[_Candidate],
            snap: dict | None, top_n: int = TOP_N) -> dict:
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
    spread = _spread(decks)

    scored: list[dict] = []
    if spread:
        for card in cards:
            row = _score(card, spread, snap)
            if row:
                scored.append(row)
        # The second key is games piloted, which a scout row does not have —
        # `comfort` is None there and reading it subscripts a None. Falling
        # back to 0 keeps ownerless rows ordered by score then by name, which
        # is a total order because the pool is one deck per archetype.
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
            # `scored` is already sorted and grouping preserves that order.
            "decks": rows[:TOP_N],
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
        "recommended": _distinct(scored)[:top_n],
        "perPlayer": per_player,
        "considered": len(cards),
        # Said out loud rather than left to be inferred from an empty list.
        "reason": (
            None if scored else
            "no_history" if not spread else "no_evidence"
        ),
    }


def _combined(red: list[dict], cards: list[_Candidate],
              snap: dict | None) -> dict:
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
    for opp in red:
        own = (opp.get("decks") or [])[:OPPONENT_DECKS]
        _archetypes_for(own)
        decks.extend(own)

    spread = _spread(decks)
    if not spread:
        return {"players": len(red), "spread": [], "recommended": [],
                "reason": "no_history"}

    scored = [row for row in (_score(c, spread, snap) for c in cards) if row]
    scored.sort(key=lambda r: (-r["score"], r["name"]))
    return {
        "players": len(red),
        "spread": spread,
        "recommended": _distinct(scored)[:SCOUT_TOP_N],
        "reason": None if scored else "no_evidence",
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
    scout = not blue_tags

    blue = [_resolve(t, days) for t in blue_tags[:MAX_SQUAD]]
    red = [_resolve(t, days) for t in red_tags[:MAX_SQUAD]]

    for p in blue:
        _archetypes_for(p.get("decks") or [])

    snap = dcx._snap()
    cards = _scout_candidates() if scout else _candidates(blue)
    top_n = SCOUT_TOP_N if scout else TOP_N

    folders = [_folder(opp, blue, cards, snap, top_n) for opp in red]

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
            "no_matchup_data" if scout else
            "no_blue_history" if not any(p["decks"] for p in blue)
            else "no_blue_comfort"
        )

    out = {
        "mode": "scout" if scout else "squads",
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
            "minComfortGames": MIN_COMFORT_GAMES,
            "minOpponentDeckGames": MIN_OPPONENT_DECK_GAMES,
        },
    }
    # THE ROSTER-WIDE READ, scout only. In a match plan every recommendation
    # belongs to a named teammate, so a squad-wide answer would be advice with
    # nobody to take it. See `_combined`.
    if scout:
        out["overall"] = _combined(red, cards, snap)
    return out


def _side_summary(p: dict) -> dict:
    """A roster chip: who they are and how well they could be read."""
    return {
        "tag": p["tag"], "name": p["name"], "basis": p["basis"],
        "battles": p["battles"], "winRate": p["winRate"],
        "decks": len(p.get("decks") or []),
        "tracking": p["tracking"], "window": p["window"],
    }
