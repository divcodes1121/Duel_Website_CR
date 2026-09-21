"""test_team_analysis.py — the squad scorer's invariants.

    python server/test_team_analysis.py

No database and no network. Every read the module makes — the matchup ladder's
three profiles, the archetype matrix, the player report, the live battlelog and
the enrolment queue — is replaced by a fixture written out below, so what is
being tested is the SCORING RULE rather than whatever the archive happens to
hold today.

The cases that matter most:

  * A recommendation must follow the opponent's SPREAD, not any one matchup.
    A deck that crushes an archetype the opponent plays 5% of the time must
    lose to a deck that is merely good against the 70% they actually play.
  * Comfort is a TIEBREAK. It must never overturn a real matchup difference,
    and a deck under the floor must not be recommended at all.
  * An unanswerable archetype must not be scored as 50%. Averaging over an
    empty set pulls everything toward even and flattens the ranking exactly
    when there is least evidence — the opposite of what should happen.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deck_counter as dcx  # noqa: E402
import team_analysis as ta
import team_scout as ts  # noqa: E402

PASS = 0
FAIL = 0
NL = chr(10)


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


# ── Fixtures ────────────────────────────────────────────────────────────────

def deck(name, cards, matches=20, wins=10, use=25.0, wc=None):
    return {
        "rank": 1, "name": name, "deckHash": ",".join(sorted(cards)),
        "cards": list(cards), "useRate": use,
        "winRate": round(100 * wins / matches, 1) if matches else 0.0,
        "matches": matches, "wins": wins, "losses": matches - wins,
        "avgElixir": 3.5, "winCondition": wc, "lastSeen": "20260820T120000.000Z",
    }


def cards(prefix):
    """Eight distinct card keys. The 8-card guard is real, so fixtures obey it."""
    return [f"{prefix}-{i}" for i in range(8)]


HOG = cards("hog")
XBOW = cards("xbow")
GOLEM = cards("golem")
LAVA = cards("lava")

#: `deck key -> archetype -> record`. Stands in for `dcx.deck_profile`.
#:
#: THE FIELD IS `games`, and getting that wrong here cost a real bug. Every
#: rung of the matchup ladder — the exact deck profile, both cluster levels and
#: the archetype matrix — publishes its denominator as `games`. An earlier
#: version of this fixture called it `battles`, which is a field on the profile
#: WRAPPER rather than on a per-archetype record; the module read `battles`,
#: got null from every real rung, and the client called `.toLocaleString()` on
#: it. Every test here passed, because the fixture and the code shared one
#: invented name. A fixture that does not speak the real vocabulary pins
#: nothing.
PROFILES = {
    ",".join(sorted(HOG)): {
        # Good against golem, poor against xbow.
        "golem": {"winRate": 62.0, "games": 400, "tier": "high"},
        "xbow": {"winRate": 41.0, "games": 300, "tier": "high"},
    },
    ",".join(sorted(XBOW)): {
        "golem": {"winRate": 44.0, "games": 250, "tier": "high"},
        "xbow": {"winRate": 50.0, "games": 200, "tier": "high"},
    },
    ",".join(sorted(GOLEM)): {
        # Crushes xbow, which the fixture opponent barely plays.
        "xbow": {"winRate": 90.0, "games": 500, "tier": "high"},
        "golem": {"winRate": 50.0, "games": 100, "tier": "high"},
    },
    ",".join(sorted(LAVA)): {},   # nothing known about it at all
}


def fake_deck_profile(cs):
    return {"archetypes": PROFILES.get(",".join(sorted(set(cs))), {}),
            "overall": None, "battles": 0}


def fake_cluster_profile(cs, overlap):
    return {"archetypes": {}, "decks": 0}


def fake_symmetric(snap, a, b):
    return None


def fake_archetype_of(cs):
    for name, cl in (("hog", HOG), ("xbow", XBOW), ("golem", GOLEM), ("lava", LAVA)):
        if sorted(set(cs)) == sorted(set(cl)):
            return name
    return "other"


def install_fakes():
    dcx.deck_profile = fake_deck_profile
    dcx.cluster_profile = fake_cluster_profile
    dcx._symmetric = fake_symmetric
    dcx.archetype_of = fake_archetype_of
    dcx._snap = lambda: {"cells": {}, "archetypes": []}
    dcx._label = lambda a: (a or "other").title()
    dcx.style_of = lambda a: "control"
    dcx._avg_elixir = lambda cs: 3.5


install_fakes()


def player(tag, name, decks, basis="stored"):
    return {
        "tag": tag, "name": name, "basis": basis, "battles": 300,
        "winRate": 55.0, "decks": decks,
        "coverage": {"start": "2026-07-01", "end": "2026-08-20", "days": 51},
        "window": {"from": "2026-07-22", "to": "2026-08-20"},
        "tracking": {"tag": tag, "state": "tracked", "tracked": True,
                     "requested": False},
    }


# ── normalisation of the two deck shapes ────────────────────────────────────

print(NL + "live rows are translated, not reinterpreted")

LIVE = {
    "basis": "live", "battles": 25, "winRate": 60.0,
    "decks": [{
        "hash": "a,b", "cards": HOG, "art": {"hog-0": "evolution"},
        "inferredArt": False, "archetype": "hog", "name": "Hog Rider",
        "games": 12, "wins": 7, "winRate": 58.3, "useRate": 48.0,
        "lastSeen": "20260820T120000.000Z",
    }],
}
rows = ta._live_decks(LIVE)
check("games becomes matches", rows[0]["matches"] == 12)
check("archetype becomes winCondition", rows[0]["winCondition"] == "hog")
check("losses are derived, never negative", rows[0]["losses"] == 5)
check("art survives the rename", rows[0]["art"] == {"hog-0": "evolution"})
check("useRate is the reader's own, not recomputed", rows[0]["useRate"] == 48.0)
check("an empty live report yields no rows", ta._live_decks({}) == [])


# ── the opponent's spread ───────────────────────────────────────────────────

print(NL + "the archetype spread")

spread = ta._spread([
    deck("Hog", HOG, matches=70, wc="hog"),
    deck("Golem", GOLEM, matches=30, wc="golem"),
])
check("weights sum to 1", abs(sum(s["weight"] for s in spread) - 1.0) < 1e-9)
check("the most-played archetype leads", spread[0]["archetype"] == "hog")
check("share is a percentage of the decks considered", spread[0]["share"] == 70.0)

thin = ta._spread([deck("Hog", HOG, matches=70, wc="hog"),
                   deck("Lava", LAVA, matches=1, wc="lava")])
check("a deck under the floor is excluded from the spread",
      [s["archetype"] for s in thin] == ["hog"])
check("and the weights are renormalised over what is left, not left short",
      abs(sum(s["weight"] for s in thin) - 1.0) < 1e-9,
      "otherwise every expected win rate computed from them shrinks toward 0")
check("no decks means no spread", ta._spread([]) == [])
check("a spread of only sub-floor decks is empty, not invented",
      ta._spread([deck("Lava", LAVA, matches=1, wc="lava")]) == [])


# ── the candidate pool ──────────────────────────────────────────────────────

print(NL + "the candidate pool")

blue = [
    player("#B1", "Ravi", [deck("Hog", HOG, matches=40, wins=24, wc="hog"),
                           deck("Xbow", XBOW, matches=3, wins=2, wc="xbow")]),
    player("#B2", "Aditya", [deck("Golem", GOLEM, matches=30, wins=15, wc="golem")]),
]
pool = ta._candidates(blue)
keys = sorted(c.key for c in pool)
check("a deck under MIN_COMFORT_GAMES never becomes a candidate",
      all(c.games >= ta.MIN_COMFORT_GAMES for c in pool),
      f"floor is {ta.MIN_COMFORT_GAMES}")
check("the xbow deck played 3 times is excluded",
      ",".join(sorted(XBOW)) not in keys)
check("both remaining decks are candidates", len(pool) == 2)
check("each candidate knows its owner",
      sorted(c.owner["name"] for c in pool) == ["Aditya", "Ravi"])

shared = [
    player("#B1", "Ravi", [deck("Hog", HOG, matches=40, wins=24, wc="hog")]),
    player("#B2", "Aditya", [deck("Hog", HOG, matches=12, wins=6, wc="hog")]),
]
dedup = ta._candidates(shared)
check("A DECK TWO PLAYERS BOTH RUN IS TWO CANDIDATES, one each",
      len(dedup) == 2,
      "it used to be deduplicated to whoever played it more, which made the "
      "per-player board impossible: the other teammate could not be offered "
      "the deck they actually play")
check("and both owners are represented",
      sorted(c.owner["name"] for c in dedup) == ["Aditya", "Ravi"])
check("but the expensive profile is read ONCE and shared by reference",
      dedup[0].profile is dedup[1].profile,
      "two teammates on one list must not cost two sets of database reads")
check("a player listing the same deck twice still gets one candidate",
      len(ta._candidates([player("#B9", "Dup", [
          deck("Hog", HOG, matches=40, wc="hog"),
          deck("Hog", HOG, matches=30, wc="hog")])])) == 1,
      "dedup WITHIN a player is still right - one person, one list, one option")

check("a deck that is not exactly 8 cards is not a candidate",
      ta._candidates([player("#B3", "Sam",
                             [deck("Loadout", cards("x")[:6], matches=40)])]) == [],
      "a 16/24-card duel loadout is three decks end to end")


# ── comfort ─────────────────────────────────────────────────────────────────

print(NL + "comfort is a tiebreak, not a model")

check("no games is no bonus", ta._comfort(0) == 0.0)
check("the bonus is capped at COMFORT_WEIGHT",
      ta._comfort(10_000) == ta.COMFORT_WEIGHT)
check("it saturates at COMFORT_FULL", ta._comfort(ta.COMFORT_FULL) == ta.COMFORT_WEIGHT)
check("and rises monotonically below it",
      ta._comfort(5) < ta._comfort(15) < ta._comfort(ta.COMFORT_FULL))
check("the whole weight is smaller than any matchup difference worth having",
      ta.COMFORT_WEIGHT <= 2.0,
      "at 1.5pp it cannot overturn a real edge, which is the point")


# ── scoring against a spread ────────────────────────────────────────────────

print(NL + "a recommendation follows the spread, not one matchup")

# The opponent is 90% golem, 10% xbow.
opponent_spread = ta._spread([
    deck("Golem", GOLEM, matches=90, wc="golem"),
    deck("Xbow", XBOW, matches=10, wc="xbow"),
])
def card(d, owner):
    """A `_Candidate` with its own profile, the way `_candidates` builds one."""
    return ta._Candidate(d, owner, ta._DeckProfile(d["cards"], d["winCondition"]))


hog_card = card(deck("Hog", HOG, matches=40, wins=24, wc="hog"),
                {"tag": "#B1", "name": "Ravi"})
golem_card = card(deck("Golem", GOLEM, matches=40, wins=20, wc="golem"),
                  {"tag": "#B2", "name": "Aditya"})

partial_spread_probe = ta._spread([
    deck("Golem", GOLEM, matches=50, wc="golem"),
    deck("Lava", LAVA, matches=50, wc="lava"),   # nothing knows about lava
])
hog_row = ta._score(hog_card, opponent_spread, None)
golem_row = ta._score(golem_card, opponent_spread, None)

# hog: .9*62 + .1*41 = 59.9    golem: .9*50 + .1*90 = 54.0
check("the expected rate is the spread-weighted average",
      hog_row["expectedWinRate"] == 59.9,
      f"got {hog_row['expectedWinRate']}")
check("a deck that crushes a 10% archetype still loses to one that answers the 90%",
      hog_row["score"] > golem_row["score"],
      "golem beats xbow 90-10 and is still the worse call here")
check("every archetype in the spread is reported, in order",
      [m["archetype"] for m in hog_row["matchups"]] == ["golem", "xbow"])
check("each matchup carries the rung it was measured on",
      all(m["source"] == dcx.SOURCE_DECK for m in hog_row["matchups"]))
check("and the human sentence for that rung",
      hog_row["matchups"][0]["sourceText"] == dcx.SOURCE_TEXT[dcx.SOURCE_DECK])
check("each matchup carries the DENOMINATOR the ladder actually publishes",
      hog_row["matchups"][0]["games"] == 400,
      "the ladder says `games`; `battles` is on the profile wrapper and is "
      "null on every rung")
check("an unanswerable archetype reports 0 games rather than null",
      all(m["games"] == 0 for m in
          ta._score(hog_card, partial_spread_probe, None)["matchups"]
          if m["winRate"] is None),
      "the client formats this number, so it may never be null")
check("the recommendation names the teammate who plays it",
      hog_row["owner"] == {"tag": "#B1", "name": "Ravi"})
check("the comfort bonus is stated rather than buried in the score",
      hog_row["comfort"]["bonus"] == round(ta._comfort(40), 2))
# THE SCORE IS A DECOMPOSITION NOW, AND EVERY TERM OF IT IS PUBLISHED.
#
# It was `expectedWinRate + comfort` exactly, and that identity was worth
# pinning while those were the only two things the ranking knew. The brain adds
# two penalties the old scorer could not express — how much of the projected
# threat space a deck was actually measurable against, and what rungs of the
# evidence ladder those measurements came off — so the identity is wider. It is
# still an identity, and it is still checked to the floating-point bit, which
# is the property that mattered: no term may enter the ranking without
# appearing in the payload beside it.
def _rebuilt(r):
    import team_scout as _ts
    fit = r.get("playerFit") or 0.0
    return (r["matchupValue"]
            - _ts.COVERAGE_WEIGHT * (1.0 - r["threatCovered"])
            + _ts.FIT_WEIGHT * fit
            - _ts.EVIDENCE_WEIGHT * (1.0 - r["evidenceStrength"]))


check("the score is exactly its published terms, and nothing else",
      abs(hog_row["score"] - round(_rebuilt(hog_row), 3)) < 1e-9,
      f"{hog_row['score']} vs {round(_rebuilt(hog_row), 3)}")
check("the comfort bonus still reports the practice tiebreak in points",
      hog_row["comfort"]["bonus"] == round(ta._comfort(40), 2))
check("expectedWinRate survives as the headline for existing readers",
      hog_row["expectedWinRate"] == hog_row["matchupValue"])


print(NL + "comfort cannot overturn a real matchup difference")

# Same deck, one owner practised and one not: comfort decides, as a tiebreak.
practised = card(deck("Hog", HOG, matches=40, wc="hog"), {"tag": "#B1", "name": "Ravi"})
rusty = card(deck("Hog", HOG, matches=5, wc="hog"), {"tag": "#B2", "name": "Aditya"})
check("with matchups equal, the practised deck wins",
      ta._score(practised, opponent_spread, None)["score"]
      > ta._score(rusty, opponent_spread, None)["score"])
check("but a 5.9-point matchup gap is not closed by 1.5 points of practice",
      ta._score(hog_card, opponent_spread, None)["score"]
      > ta._score(
          card(deck("Golem", GOLEM, matches=10_000, wc="golem"),
               {"tag": "#B2", "name": "Aditya"}),
          opponent_spread, None)["score"],
      "the golem deck here has every possible rep and still loses")


print(NL + "evidence, and what happens without it")

lava_card = card(deck("Lava", LAVA, matches=40, wc="lava"), {"tag": "#B3", "name": "Sam"})
check("a deck with no evidence against ANY archetype scores None, not 50%",
      ta._score(lava_card, opponent_spread, None) is None,
      "averaging over an empty set is how a ranking goes flat exactly when "
      "there is least to go on")

partial_spread = ta._spread([
    deck("Golem", GOLEM, matches=50, wc="golem"),
    deck("Lava", LAVA, matches=50, wc="lava"),   # nothing knows about lava
])
partial = ta._score(hog_card, partial_spread, None)
check("an unanswerable archetype is renormalised out, not counted as even",
      partial["expectedWinRate"] == 62.0,
      f"got {partial['expectedWinRate']}; 0.5*62 + 0.5*50 would be 56.0")
check("and how much of their play was covered is reported",
      partial["spreadCovered"] == 50.0)
check("the unanswerable archetype still appears, with a null rate",
      any(m["archetype"] == "lava" and m["winRate"] is None
          for m in partial["matchups"]),
      "withheld, not hidden — the reader must see what could not be read")
check("full coverage reports 100", hog_row["spreadCovered"] == 100.0)


# ── a folder ────────────────────────────────────────────────────────────────

print(NL + "a folder")

blue_roster = [
    player("#B1", "Ravi", [deck("Hog", HOG, matches=40, wins=24, wc="hog")]),
    player("#B2", "Aditya", [deck("Golem", GOLEM, matches=30, wins=15, wc="golem")]),
    player("#B3", "Sam", [deck("Xbow", XBOW, matches=30, wins=15, wc="xbow")]),
]
pool = ta._candidates(blue_roster)
opp = player("#R1", "Mohamed", [
    deck("Golem", GOLEM, matches=90, wc="golem"),
    deck("Xbow", XBOW, matches=10, wc="xbow"),
], basis="stored")
folder = ta._folder(opp, blue_roster, pool, None)

check("the folder is named for the opponent", folder["player"]["name"] == "Mohamed")
check("their own decks are the left side", len(folder["theirDecks"]) == 2)
check("at most TOP_N are recommended", len(folder["recommended"]) <= ta.TOP_N)
check("best first", all(
    folder["recommended"][i]["score"] >= folder["recommended"][i + 1]["score"]
    for i in range(len(folder["recommended"]) - 1)))
check("EVERY blue player gets a row, in roster order",
      [r["owner"]["tag"] for r in folder["perPlayer"]] == ["#B1", "#B2", "#B3"],
      "a teammate with nothing to offer must still appear, or a roster of "
      "five silently looks like a roster of three")
check("each row holds that player's OWN decks and nobody else's",
      all(all(d["owner"]["tag"] == r["owner"]["tag"] for d in r["decks"])
          for r in folder["perPlayer"]))
check("no row holds more than the top 3",
      all(len(r["decks"]) <= ta.TOP_N for r in folder["perPlayer"]))
check("each row is sorted best first",
      all(all(r["decks"][i]["score"] >= r["decks"][i + 1]["score"]
              for i in range(len(r["decks"]) - 1))
          for r in folder["perPlayer"]))
check("a row that produced decks states no reason",
      all(r["reason"] is None for r in folder["perPlayer"] if r["decks"]))
check("no per-teammate deck carries the per-threat table — nothing reads it",
      any(r["decks"] for r in folder["perPlayer"])
      and all("matchups" not in d for r in folder["perPlayer"] for d in r["decks"]))
check("the folder's top pick keeps it, for the PDF",
      bool(folder["recommended"]) and "matchups" in folder["recommended"][0]
      and all("matchups" not in d for d in folder["recommended"][1:]))
check("the squad-wide headline lists three DISTINCT decks",
      len({",".join(sorted(set(r["cards"]))) for r in folder["recommended"]})
      == len(folder["recommended"]),
      "one deck under three co-owners is one option wearing three rows")
check("a folder that produced recommendations states no reason",
      folder["reason"] is None)
check("how many candidates were weighed is reported",
      folder["considered"] == len(pool))

empty = ta._folder(player("#R2", "Nobody", []), blue_roster, pool, None)
check("an opponent with no history says so, rather than showing an empty list",
      empty["reason"] == "no_history")
check("and recommends nothing rather than guessing", empty["recommended"] == [])

sam_roster = [player("#B3", "Sam", [deck("Lava", LAVA, matches=40, wc="lava")])]
no_ev = ta._folder(
    player("#R3", "Unread", [deck("Lava", LAVA, matches=50, wc="lava")]),
    sam_roster, ta._candidates(sam_roster), None)
check("a spread nothing can answer is 'no_evidence', not 'no_history'",
      no_ev["reason"] == "no_evidence",
      "the two are different problems and the screen must say which")


# ── the scouting report ─────────────────────────────────────────────────────
#
# One roster in, the archetype REPRESENTATIVES ranked against it. The pool is
# the only thing that differs from a match plan, so these checks are mostly
# about what an ownerless candidate may and may not claim.

print(NL + "the scouting report")

REPS = {
    "hog": {"cards": list(HOG), "art": {}, "name": "Hog"},
    "golem": {"cards": list(GOLEM), "art": {}, "name": "Golem"},
    "xbow": {"cards": list(XBOW), "art": {}, "name": "Xbow"},
    "lava": {"cards": list(LAVA), "art": {}, "name": "Lava"},
}
ta.dcx._representatives = lambda: REPS
ta.dcx._snap = lambda: {"cells": {}, "archetypes": [], "computedAt": 1000.0}
ta._SCOUT_POOL = None

scout_pool = ta._scout_candidates()
check("the scout pool is one candidate per archetype representative",
      len(scout_pool) == len(REPS))
check("a scout candidate has NO owner", all(c.owner is None for c in scout_pool),
      "an archetype representative is nobody's deck, and a zero games-piloted "
      "figure would be a claim about a roster that was never pasted")

# Cached on the snapshot's identity, because `_CLUSTER_CACHE` upstream is 32
# entries and clears itself whole — rebuilding 17 decks x 2 levels per request
# would rescan the sibling table every time for an answer that cannot change.
again = ta._scout_candidates()
check("the pool is reused while the snapshot has not moved", again is scout_pool)
ta.dcx._snap = lambda: {"cells": {}, "archetypes": [], "computedAt": 2000.0}
check("and rebuilt when it has", ta._scout_candidates() is not scout_pool,
      "the representatives come off snapshot['reps'], so a rebuild is exactly "
      "when they may differ and nothing else is")

ta.dcx._snap = lambda: {"cells": {}, "archetypes": [], "computedAt": 1000.0}
ta._SCOUT_POOL = None
scout_pool = ta._scout_candidates()

scout_folder = ta._folder(opp, [], scout_pool, None, ta.SCOUT_TOP_N)
check("a scout folder still draws what they play",
      len(scout_folder["theirDecks"]) == 2)
check("a scout folder has no per-player board",
      scout_folder["perPlayer"] == [],
      "with no blue roster the loop has nothing to iterate — it is not "
      "special-cased, it falls out empty")
# BOTH SQUAD-WIDE LISTS ARE PORTFOLIOS NOW, so the two counts converged — see
# the note on SCOUT_TOP_N. What is still worth pinning is that the scouting
# report is not silently capped below the portfolio it is meant to be.
check("a scout folder recommends up to the portfolio size",
      len(scout_folder["recommended"]) <= ta.SCOUT_TOP_N
      and ta.SCOUT_TOP_N == ts.MAX_RECOMMENDATIONS,
      f"{len(scout_folder['recommended'])} of {ta.SCOUT_TOP_N}")
# SEVEN ON BOTH BOARDS NOW (was 5 per teammate), on the account holder's call.
# The per-teammate list is what the Coach Roster's What-to-play tab reads, so
# this is the number a coach actually sees there.
check("the per-teammate board shows seven, like the squad-wide portfolio",
      ta.PER_PLAYER_TOP_N == 7 and ta.TOP_N == 7,
      f"{ta.PER_PLAYER_TOP_N} / {ta.TOP_N}")
# A TEAMMATE WITH A SHORT LIST IS TOPPED UP, NOT LEFT WITH A REASON.
#
# `coach._fills` has answered this since Coach Assist was written: when a
# player's own history cannot fill the candidate list, top up from the
# population, MARK what was added, and never displace one of their own. A
# teammate with two qualifying decks used to get a two-row board and a teammate
# with none got a bare sentence, which reads as the tool having nothing to say
# about that person rather than as that person having nothing stored.
#
# THE REASON STILL SHIPS. It explains why none of the rows are theirs, which is
# a different fact from there being no rows, and the screen prints both.
print(NL + "a short per-player board is topped up, and the top-ups are marked")
_thin_mate = {
    "tag": "#B9", "name": "Newcomer", "basis": "stored",
    "decks": [],  # nothing of their own at all
}
_thin_folder = ta._folder(opp, [_thin_mate], pool, None, ta.TOP_N,
                          ta.dcx.seeds() or None)
_thin_row = _thin_folder["perPlayer"][0]
check("a teammate with no decks still gets options",
      len(_thin_row["decks"]) > 0, str(len(_thin_row["decks"])))
check("every one of them is marked as a fill",
      all(d.get("fill") for d in _thin_row["decks"]),
      str([d.get("fill") for d in _thin_row["decks"]]))
check("and the reason why none are theirs is still published",
      _thin_row["reason"] == "no_history", str(_thin_row["reason"]))
check("a fill carries no comfort block, because nobody has piloted it",
      all(d["comfort"] is None for d in _thin_row["decks"]))
check("no two fills are the same deck",
      len({",".join(sorted(set(d["cards"]))) for d in _thin_row["decks"]})
      == len(_thin_row["decks"]))

# AND A TEAMMATE WHO HAS THEIR OWN DECKS KEEPS THEM AT THE TOP.
_rich_row = next(r for r in folder["perPlayer"] if r["owner"]["tag"] == "#B1")
_owned = [d for d in _rich_row["decks"] if not d.get("fill")]
# OWN AND POPULATION ARE RANKED TOGETHER NOW — `coach.suggest`'s real sort.
# The two checks that stood here asserted the opposite ("owned decks come
# before any fill") and kept PASSING after the rule changed, because this
# fixture has no population pool at this point in the file: with nothing to
# rank in, "owned first" is trivially true. The ordering contract is pinned in
# `test_team_scout.py`, against literals where the rates can be controlled.
# What is true of the payload whatever the pool is: every row is either a deck
# a teammate owns, or a marked fill — never an unmarked deck of nobody's.
check("every per-player row is owned or marked as a Deckkies pick",
      all(bool(d.get("owner")) != bool(d.get("fill")) for d in _rich_row["decks"]),
      str([(bool(d.get("owner")), bool(d.get("fill"))) for d in _rich_row["decks"]]))
check("the owned half is what `considered` counts",
      _rich_row["considered"] >= len(_owned))

# NO LIST EXCEEDS SEVEN, AND NO ROW IS AN UNMARKED STRANGER — on every
# teammate's board.
for _row in folder["perPlayer"]:
    check(f"{_row['owner']['name']}: at most seven suggestions",
          len(_row["decks"]) <= ta.PER_PLAYER_TOP_N, str(len(_row["decks"])))
    check(f"{_row['owner']['name']}: every row is theirs or a marked pick",
          all((d.get("owner") or {}).get("tag") == _row["owner"]["tag"] or d.get("fill")
              for d in _row["decks"]))

# EVERY THREAT CARRIES A DISPLAY NAME, NOT AN ARCHETYPE KEY.
#
# Found in a SCREENSHOT, not here and not by tsc. `team_scout` has no imports
# by design and so cannot reach `_label`, which means it leaves `name` empty on
# everything it generates; the client fell back to the raw archetype and the
# projection printed "xbow", "bridge-spam" and "drill" in a column whose
# observed rows said "X-Bow", "Royal Hogs" and "Hog Rider". Two naming
# conventions in one list, with the raw one landing on exactly the rows a
# reader is least certain about.
print(NL + "the projection speaks the same vocabulary as the rest of the screen")
_proj = ta._threats([
    deck("Hog", HOG, matches=60, wc="hog"),
    deck("Golem", GOLEM, matches=20, wc="golem"),
], ta.dcx.seeds() or None)
_threat_rows = _proj["threats"]
check("there are threats to check", bool(_threat_rows), str(len(_threat_rows)))
check("every threat has a name",
      all((r.get("name") or "").strip() for r in _threat_rows),
      str([r.get("name") for r in _threat_rows][:4]))
check("no threat prints its raw archetype key as its name",
      all(r["name"] != r["archetype"] or r["archetype"] == ta.dcx._label(r["archetype"])
          for r in _threat_rows),
      str([(r["archetype"], r["name"]) for r in _threat_rows][:4]))
check("a variant names the deck it came from",
      all(r.get("basisName") for r in _threat_rows if r.get("basis")),
      "basisName is what the row prints after 'shared with'")

check("the scout pool is wider than one deck per archetype",
      len(scout_pool) > len(dcx._representatives() or {}) or not dcx.seeds(),
      f"{len(scout_pool)} candidates")
check("a scout recommendation carries no owner",
      all(r["owner"] is None for r in scout_folder["recommended"]))
check("and no comfort block",
      all(r["comfort"] is None for r in scout_folder["recommended"]))
check("so the practice tiebreak contributes nothing to its rank",
      all(r["playerFit"] is None for r in scout_folder["recommended"])
      and all(abs(r["score"] - round(_rebuilt(r), 3)) < 1e-9
              for r in scout_folder["recommended"]),
      "with no owner there is nothing to be practised at, so the tiebreak "
      "must contribute exactly nothing")
check("the same scorer produced it — the top row still names its rung",
      bool(scout_folder["recommended"])
      and all("source" in m for m in scout_folder["recommended"][0]["matchups"]))
check("the per-threat table rides on the TOP row only — the PDF's one reader",
      all("matchups" not in r for r in scout_folder["recommended"][1:]),
      "every other copy was 80% of a match plan's payload and nothing drew it")

# ── the roster-wide read ────────────────────────────────────────────────────

combined = ta._combined([opp, player("#R4", "Second", [
    deck("Hog", HOG, matches=50, wc="hog"),
])], scout_pool, None)
check("the combined spread pools every opponent's decks",
      {s["archetype"] for s in combined["spread"]} == {"golem", "xbow", "hog"})
check("weighted by GAMES, not one vote per player",
      max(combined["spread"], key=lambda s: s["games"])["archetype"] == "golem",
      "golem is 90 games against hog's 50; summing normalised shares would "
      "give a roster's least active member the same say as its most active")
check("it counts the players it read", combined["players"] == 2)
check("and ranks the same pool against it",
      len(combined["recommended"]) <= ta.SCOUT_TOP_N)

empty_combined = ta._combined([player("#R5", "Silent", [])], scout_pool, None)
check("a roster with no history says so rather than ranking nothing",
      empty_combined["reason"] == "no_history")


# ── the whole report ────────────────────────────────────────────────────────

print(NL + "the report")

ta.cd.player_report = lambda tag, since=None, until=None: None
ta.cd.coverage = lambda tag=None: {"start": None, "end": None, "days": 0}
ta.cd.player_name = lambda tag: None
ta.cd.cr_profile = lambda tag: None
ta.live.report = lambda tag: None
ta.tracking.status = lambda tag: {"tag": tag, "state": "queued",
                                  "tracked": False, "requested": True}
ta.tracking.request = lambda tag, source="team": None

rep = ta.analyze(["#B1"], ["#R1"], days=30)
check("an unreadable player is 'unknown', not an error",
      rep["blue"][0]["basis"] == "unknown")
check("both sides are summarised", len(rep["blue"]) == 1 and len(rep["red"]) == 1)
check("one folder per opponent", len(rep["folders"]) == 1)
check("an empty blue squad is named once at the top, not eight times below",
      rep["pool"]["reason"] == "no_blue_history",
      "eight identical empty folders read as a broken tool, not as no history")
check("the floors are published with the report",
      rep["limits"]["minComfortGames"] == ta.MIN_COMFORT_GAMES
      and rep["limits"]["topN"] == ta.TOP_N)
check("the window is echoed back", rep["days"] == 30)

over = ta.analyze(["#B%d" % i for i in range(20)], ["#R1"], days=30)
check("the squad cap is enforced server-side too",
      len(over["blue"]) == ta.MAX_SQUAD,
      "the client cap is feedback; this is the boundary")

check("MAX_SQUAD matches the client's copy", ta.MAX_SQUAD == 10,
      "src/utils/squadParse.ts MAX_SQUAD — the two are mirrors, and this "
      "file SLICES where the client REFUSES, so a drift is a silently "
      "shortened roster rather than an error")

check("a two-roster run is stamped 'squads'", rep["mode"] == "squads")
check("and carries no roster-wide block", "overall" not in rep,
      "in a match plan every recommendation belongs to a named teammate, so "
      "a squad-wide answer would be advice with nobody to take it")

# ── the report, in scout mode ───────────────────────────────────────────────

print(NL + "the report — scouting")

scout_rep = ta.analyze([], ["#R1"], days=30)
check("an empty blue roster IS scout mode", scout_rep["mode"] == "scout",
      "the mode is an absence rather than a flag, so the incoherent "
      "combination — a squad pasted AND scout asked for — cannot be expressed")
check("the mode is published, never inferred from an empty array",
      "mode" in scout_rep,
      "an empty `blue` is also what an ordinary failure produces")
check("no blue side is summarised", scout_rep["blue"] == [])
check("one folder per opponent, as ever", len(scout_rep["folders"]) == 1)
check("the roster-wide read is present", "overall" in scout_rep)
check("both row counts are published so a client can label them",
      scout_rep["limits"]["scoutTopN"] == ta.SCOUT_TOP_N
      and scout_rep["limits"]["topN"] == ta.TOP_N)

ta.dcx._snap = lambda: None
ta._SCOUT_POOL = None
no_snap = ta.analyze([], ["#R1"], days=30)
check("no matchup snapshot is 'no_matchup_data', not 'no_blue_history'",
      no_snap["pool"]["reason"] == "no_matchup_data",
      "the two modes fail differently: a missing squad is the reader's own "
      "history, a missing pool is the server still building and is fixed by "
      "waiting rather than by pasting more")

print(f"{NL}{PASS} passed, {FAIL} failed{NL}")
sys.exit(1 if FAIL else 0)
