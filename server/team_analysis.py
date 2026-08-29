"""team_analysis.py — one squad against another, a folder per opponent.

Behind `#/teams`. Paste two rosters, get one folder per opponent player holding
two things side by side: the decks THEY actually play, and the decks from YOUR
squad that answer them, each labelled with the teammate who already plays it.

────────────────────────────────────────────────────────────────────────────
THE QUESTION THIS ANSWERS, AND THE ONE IT DOES NOT
────────────────────────────────────────────────────────────────────────────

It answers: *given what this opponent has actually been playing, which deck
that somebody on my team already knows how to pilot does best against that
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
(`_Scorecard`) before any opponent is scored, and the scoring loop then reads
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

#: Squad size cap per side. Mirrors `MAX_SQUAD` in `src/utils/squadParse.ts`.
#: REFUSED, NOT TRUNCATED — analysing the first eight of eleven answers a
#: question nobody asked, and the missing three are invisible in the output.
MAX_SQUAD = 8

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


class _Scorecard:
    """One blue deck, with everything needed to score it held in memory.

    THE POINT OF THIS CLASS IS THAT IT IS BUILT ONCE. See the module docstring:
    the three profiles behind `matchup_ladder` are LRU-cached upstream at 64/32
    entries, and scoring opponents on the outside of the loop would evict them
    on every pass. Everything expensive happens in `__init__`; `against()` is
    dictionary lookups.
    """

    __slots__ = ("cards", "key", "archetype", "owner", "games", "wins",
                 "win_rate", "use_rate", "art", "name", "_exact", "_c7",
                 "_c6", "_c7_decks", "_c6_decks")

    def __init__(self, deck: dict, owner: dict):
        self.cards = list(deck.get("cards") or [])
        self.key = ",".join(sorted(set(self.cards)))
        self.archetype = deck.get("winCondition") or "other"
        self.name = deck.get("name") or dcx._label(self.archetype)
        self.owner = owner
        self.games = int(deck.get("matches") or 0)
        self.wins = int(deck.get("wins") or 0)
        self.win_rate = float(deck.get("winRate") or 0.0)
        self.use_rate = float(deck.get("useRate") or 0.0)
        self.art = deck.get("art") or {}

        # The three reads, once each, right here.
        self._exact = dcx.deck_profile(self.cards).get("archetypes") or {}
        c7 = dcx.cluster_profile(self.cards, 7)
        c6 = dcx.cluster_profile(self.cards, 6)
        self._c7 = c7.get("archetypes") or {}
        self._c6 = c6.get("archetypes") or {}
        self._c7_decks = c7.get("decks")
        self._c6_decks = c6.get("decks")

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


def _candidates(blue: list[dict]) -> list[_Scorecard]:
    """Every deck the blue squad can actually pilot, profiled and deduped.

    THE SAME DECK ON TWO PLAYERS IS ONE CANDIDATE, kept for whoever has played
    it more. Two teammates on the same list is common and the folder would
    otherwise spend two of its three rows on one deck — which is not two
    options, it is one option and a note about who else knows it.
    """
    best: dict[str, dict] = {}
    for player in blue:
        decks = [d for d in (player.get("decks") or [])
                 if len(set(d.get("cards") or [])) == 8]
        decks.sort(key=lambda d: -int(d.get("matches") or 0))
        for deck in decks[:CANDIDATES_PER_PLAYER]:
            if int(deck.get("matches") or 0) < MIN_COMFORT_GAMES:
                continue
            key = ",".join(sorted(set(deck["cards"])))
            prev = best.get(key)
            if prev is None or int(deck.get("matches") or 0) > int(prev[0].get("matches") or 0):
                best[key] = (deck, player)

    out = []
    for deck, player in best.values():
        try:
            out.append(_Scorecard(deck, player))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    return out


def _comfort(games: int) -> float:
    """The tiebreak, in points. Linear to `COMFORT_FULL`, flat after."""
    if games <= 0:
        return 0.0
    return COMFORT_WEIGHT * min(1.0, games / COMFORT_FULL)


def _score(card: _Scorecard, spread: list[dict], snap: dict | None) -> dict | None:
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
    comfort = _comfort(card.games)
    return {
        "cards": card.cards,
        "art": card.art,
        "archetype": card.archetype,
        "name": card.name,
        "avgElixir": dcx._avg_elixir(card.cards),
        "owner": {"tag": card.owner["tag"], "name": card.owner["name"]},
        "comfort": {
            "games": card.games,
            "wins": card.wins,
            "winRate": card.win_rate,
            "useRate": card.use_rate,
            # What the tiebreak was worth here, stated rather than buried in
            # `score`. A reader comparing two rows can see whether the order
            # came from the matchup or from the practice.
            "bonus": round(comfort, 2),
        },
        # The headline. Weighted over the archetypes that had evidence.
        "expectedWinRate": round(expected, 1),
        # How much of their play this figure actually covers. A deck scored on
        # 40% of their spread is a different claim from one scored on all of it.
        "spreadCovered": round(100 * answered, 1),
        "score": round(expected + comfort, 3),
        "matchups": rows,
    }


# ── The report ──────────────────────────────────────────────────────────────


def _folder(opponent: dict, cards: list[_Scorecard], snap: dict | None) -> dict:
    """One opponent, and what the blue squad should bring against them."""
    decks = (opponent.get("decks") or [])[:OPPONENT_DECKS]
    _archetypes_for(decks)
    spread = _spread(decks)

    scored: list[dict] = []
    if spread:
        for card in cards:
            row = _score(card, spread, snap)
            if row:
                scored.append(row)
        scored.sort(key=lambda r: (-r["score"], -r["comfort"]["games"], r["name"]))

    # BEST DECK PER BLUE PLAYER, which is a different question from the top 3
    # and free once everything is scored. A team format assigns each player a
    # match, so "who on my squad matches up best against this person" is the
    # question a lineup is actually built from — and the top 3 can legitimately
    # all belong to one teammate, which answers the other question well and
    # that one not at all.
    by_player: dict[str, dict] = {}
    for row in scored:
        tag = row["owner"]["tag"]
        if tag not in by_player:
            by_player[tag] = row

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
        "recommended": scored[:TOP_N],
        "byPlayer": [by_player[t] for t in by_player],
        "considered": len(cards),
        # Said out loud rather than left to be inferred from an empty list.
        "reason": (
            None if scored else
            "no_history" if not spread else "no_evidence"
        ),
    }


def analyze(blue_tags: list[str], red_tags: list[str],
            days: int = DEFAULT_DAYS) -> dict:
    """The whole report: both rosters resolved, one folder per opponent.

    Tags arrive already normalised by the caller (`app._route` runs every one
    through `cd.normalize_tag`), so nothing here reaches a query unvalidated.
    """
    blue = [_resolve(t, days) for t in blue_tags[:MAX_SQUAD]]
    red = [_resolve(t, days) for t in red_tags[:MAX_SQUAD]]

    for p in blue:
        _archetypes_for(p.get("decks") or [])

    snap = dcx._snap()
    cards = _candidates(blue)

    folders = [_folder(opp, cards, snap) for opp in red]

    # A squad with nothing pilotable is the one failure the screen cannot
    # recover from, and it is worth naming: every folder below it would be
    # empty for the same reason, and eight identical empty folders do not say
    # "your side has no history" — they say the tool is broken.
    pool_reason = None
    if not cards:
        pool_reason = ("no_blue_history" if not any(p["decks"] for p in blue)
                       else "no_blue_comfort")

    return {
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
            "maxSquad": MAX_SQUAD, "topN": TOP_N,
            "minComfortGames": MIN_COMFORT_GAMES,
            "minOpponentDeckGames": MIN_OPPONENT_DECK_GAMES,
        },
    }


def _side_summary(p: dict) -> dict:
    """A roster chip: who they are and how well they could be read."""
    return {
        "tag": p["tag"], "name": p["name"], "basis": p["basis"],
        "battles": p["battles"], "winRate": p["winRate"],
        "decks": len(p.get("decks") or []),
        "tracking": p["tracking"], "window": p["window"],
    }
