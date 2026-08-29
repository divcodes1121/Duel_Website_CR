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
import team_analysis as ta  # noqa: E402

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
check("score is the expected rate plus exactly that bonus",
      abs(hog_row["score"] - (hog_row["expectedWinRate"] + hog_row["comfort"]["bonus"]))
      < 1e-9)


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

check("MAX_SQUAD matches the client's copy", ta.MAX_SQUAD == 8,
      "src/utils/squadParse.ts MAX_SQUAD — the two are mirrors")

print(f"{NL}{PASS} passed, {FAIL} failed{NL}")
sys.exit(1 if FAIL else 0)
