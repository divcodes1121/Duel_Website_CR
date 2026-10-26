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


def fake_fillable(cs):
    """How many special slots a fixture deck can fill. The fixtures are
    synthetic keys the card metadata has never heard of, so the real search
    reads every one as plain; this suite checks the WIRING of the three-slot
    rule (`test_suggested_seating.py` checks the rule), so every fixture deck
    fills all three except the one built short on purpose."""
    return 2 if any(str(c).startswith("short-") for c in cs) else 3


def install_fakes():
    ta.cd.fillable_slots = fake_fillable
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
SHORT = cards("short")
ta.dcx._representatives = lambda: {**REPS,
                                   "short": {"cards": list(SHORT), "art": {}, "name": "Short"}}
ta.dcx._snap = lambda: {"cells": {}, "archetypes": [], "computedAt": 1000.0}
ta._SCOUT_POOL = None

scout_pool = ta._scout_candidates()
check("the scout pool is one candidate per archetype representative",
      len(scout_pool) == len(REPS))
# A DECKKIES PICK FIELDS ALL THREE SPECIAL SLOTS. A list whose cards cannot is
# never offered — and never dropped silently: the pool says how many it skipped.
check("a list that cannot fill all three special slots is not in the pool",
      not any(c.key == ",".join(sorted(SHORT)) for c in scout_pool))
check("and the skip is counted", ta.scout_pool_slot_gaps() == 1, str(ta.scout_pool_slot_gaps()))
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

# THE FIELD POOL: every vetted ladder list, not the twelve most played of each
# win condition. The coach's families board chooses a win condition's decks by
# how the reader builds, and those lists are mostly ranked 13th to 40th.
print(NL + "the field pool is every vetted list of a win condition")
_real_seeds, _real_fill = ta.dcx.seeds, ta.cd.fillable_slots
_extra = [k for k in __import__("duel_combos").card_keys() if k not in HOG][:20]
_many = [{"cards": list(HOG[:7]) + [x], "games": 900 - i, "archetypes": {}}
         for i, x in enumerate(_extra)]
ta.dcx.seeds = lambda: {"hog": _many + [dict(_many[0])],
                        "short": [{"cards": list(SHORT), "games": 50, "archetypes": {}}]}
ta.cd.fillable_slots = lambda cs: 0 if set(cs) == set(SHORT) else ta.cd.SPECIAL_SLOTS
ta.dcx._snap = lambda: {"cells": {}, "archetypes": [], "computedAt": 3000.0}
ta._FIELD_POOL = None
ta._SCOUT_POOL = None
_field = ta._field_candidates()
check("it holds every list, past the scout pool's cap",
      len(_field) == len(_many) > ta.SCOUT_SEEDS_PER_ARCHETYPE, str(len(_field)))
check("the scout pool of the same snapshot is still capped",
      len(ta._scout_candidates()) == ta.SCOUT_SEEDS_PER_ARCHETYPE, str(len(ta._scout_candidates())))
check("a list listed twice is one candidate", len({c.key for c in _field}) == len(_field))
check("a list that cannot fill all three special slots is left out here too",
      not any(c.key == ",".join(sorted(SHORT)) for c in _field))
check("a field candidate is nobody's deck, and is a ladder list",
      all(c.owner is None and c.origin == "ladder" for c in _field))
check("it is kept while the snapshot has not moved", ta._field_candidates() is _field)
ta.dcx._snap = lambda: {"cells": {}, "archetypes": [], "computedAt": 3001.0}
check("and rebuilt when it has", ta._field_candidates() is not _field)
ta.dcx._snap = lambda: None
check("no snapshot is no pool", ta._field_candidates() == [])
ta.dcx.seeds, ta.cd.fillable_slots = _real_seeds, _real_fill
ta._FIELD_POOL = None

ta.dcx._representatives = lambda: REPS
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
check("a scout folder recommends up to the list size",
      len(scout_folder["recommended"]) <= ta.SCOUT_TOP_N,
      f"{len(scout_folder['recommended'])} of {ta.SCOUT_TOP_N}")
# TEN ON EVERY LIST (2026-10-10, "we can suggest 10 decks max to the players";
# seven before, five per teammate before that). `team_scout`'s own default
# stays seven: `coach_daily` builds its field plan with it.
# EVERY WIN CONDITION (6.0, 2026-10-23: "show for all win cons"): more rows
# than there are win conditions, one each; the Deck Counter keeps its ten.
check("every Team Analysis list holds every win condition; the Deck Counter ten; the field plan seven",
      ta.PER_PLAYER_TOP_N == ta.TOP_N == ta.SCOUT_TOP_N == ta.ALL_WINCONS >= 30
      and ta.BRING_TOP_N == 10 and ts.MAX_RECOMMENDATIONS == 7,
      f"{ta.PER_PLAYER_TOP_N} / {ta.TOP_N} / {ta.SCOUT_TOP_N} / {ta.BRING_TOP_N} / {ts.MAX_RECOMMENDATIONS}")
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
# TO THE PUBLISHED ROUNDING: the score is worked on the unrounded matchup value
# and `matchupValue` is printed to one decimal, so the two may differ by half
# of that. (They agreed to the bit only while a fixture's weighted mean
# happened to have one decimal; the tempered shares of 4.0 do not.)
check("so the practice tiebreak contributes nothing to its rank",
      all(r["playerFit"] is None for r in scout_folder["recommended"])
      and all(abs(r["score"] - _rebuilt(r)) <= 0.0501
              for r in scout_folder["recommended"]),
      "with no owner there is nothing to be practised at, so the tiebreak "
      "must contribute exactly nothing")
check("the same scorer produced it — the top row still names its rung",
      bool(scout_folder["recommended"])
      and all("source" in m for m in scout_folder["recommended"][0]["matchups"]))
check("the per-threat table rides on the TOP row only — the PDF's one reader",
      all("matchups" not in r for r in scout_folder["recommended"][1:]),
      "every other copy was 80% of a match plan's payload and nothing drew it")

# ── a suggestion fields every special slot its cards can fill ───────────────
#
# Every row `_score` returns is advice, and it is the one chokepoint every list
# on this screen passes through — own decks, Deckkies picks, duel picks, the
# scouting report. REAL card keys here, because the rule reads what each card
# can be; the case is the one measured live: a teammate's own list, fielded
# with Bats as the evolution and Little Prince as the champion, Cannon plain.

print(NL + "a suggested deck fields every special slot its cards can fill")


class _FlatProfile:
    def against(self, other, snap):
        return {"winRate": 55.0, "games": 200, "source": "deck", "tier": "high"}


_live_cards = ["bats", "little-prince", "cannon", "arrows", "fireball", "the-log",
               "hog-rider", "poison"]
_live = ta._Candidate(
    {"cards": _live_cards, "art": {"bats": "evolution"}, "winCondition": "hog",
     "name": "Hog", "matches": 30, "wins": 18, "winRate": 60.0, "useRate": 20.0},
    {"tag": "#B1", "name": "Ravi"}, _FlatProfile())
_row = ta._score(_live, [{"key": "t1", "archetype": "golem", "likelihood": 1.0,
                          "evidence": ts.OBSERVED, "name": "Golem"}], None)
check("the plain Cannon in the wild slot is drawn as the second evolution",
      _row["cards"][:3] == ["bats", "little-prince", "cannon"]
      and _row["art"].get("cannon") == "evolution", str((_row["cards"][:3], _row["art"])))
check("the observed Bats evolution is kept", _row["art"].get("bats") == "evolution")
check("and the filled form is named, so it is not passed off as observed",
      _row.get("artFilled") == ["cannon"], str(_row.get("artFilled")))
_full = ta._score(ta._Candidate(
    {"cards": _live_cards, "art": {"bats": "evolution", "cannon": "evolution"},
     "winCondition": "hog", "name": "Hog", "matches": 30, "wins": 18,
     "winRate": 60.0, "useRate": 20.0},
    {"tag": "#B1", "name": "Ravi"}, _FlatProfile()),
    [{"key": "t1", "archetype": "golem", "likelihood": 1.0,
      "evidence": ts.OBSERVED, "name": "Golem"}], None)
check("a deck already fielded full carries no `artFilled` at all",
      "artFilled" not in _full, str(_full.get("artFilled")))

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

over = ta.analyze(["#B%d" % i for i in range(ta.MAX_SQUAD + 5)], ["#R1"], days=30)
check("the squad cap is enforced server-side too",
      len(over["blue"]) == ta.MAX_SQUAD,
      "the client cap is feedback; this is the boundary")

# READ OFF THE CLIENT'S SOURCE, not restated here. This check used to say
# `== 10`, which pinned the server to a number rather than to the client, so
# raising both to 12 would have meant editing a third place to keep it green.
import re as _re
_client = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                            "src", "utils", "squadParse.ts"), encoding="utf-8").read()
_m = _re.search(r"export const MAX_SQUAD = (\d+);", _client)
check("MAX_SQUAD matches the client's copy",
      bool(_m) and ta.MAX_SQUAD == int(_m.group(1)),
      "src/utils/squadParse.ts MAX_SQUAD — the two are mirrors, and this "
      "file SLICES where the client REFUSES, so a drift is a silently "
      "shortened roster rather than an error")
check("the cap is twenty (raised from twelve on request, 2026-10-17)",
      ta.MAX_SQUAD == 20)
check("a twenty-player roster is analysed whole, both sides",
      len(ta.analyze(["#B%d" % i for i in range(20)],
                     ["#R%d" % i for i in range(20)], days=30)["red"]) == 20)
check("resolution keeps the roster order on the thread pool",
      [p["tag"] for p in over["blue"]] == ["#B%d" % i for i in range(ta.MAX_SQUAD)])

check("a two-roster run is stamped 'squads'", rep["mode"] == "squads")
check("and carries no roster-wide block", "overall" not in rep,
      "in a match plan every recommendation belongs to a named teammate, so "
      "a squad-wide answer would be advice with nobody to take it")

# ── the report, in scout mode ───────────────────────────────────────────────

print(NL + "the report — scouting")

scout_rep = ta.analyze([], ["#R1"], days=30)
import json as _json  # noqa: E402
try:
    _json.dumps(scout_rep)
    _ser = True
except TypeError as _e:
    _ser = str(_e)
check("a scouting report is plain JSON, as the route sends it", _ser is True, str(_ser))
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

# ── the duel brain, wired in ────────────────────────────────────────────────
#
# `duel_brain` decides and has its own suite; this checks the WIRING: every
# row gets its duel figures, picks land under the #1 and keep the list at
# seven, a teammate's own duel deck comes back as theirs, population picks are
# marked and spread across the squad, and with no index nothing changes.

print(NL + "the duel brain, wired in")

import types  # noqa: E402

import duel_brain as dbr  # noqa: E402
import duel_index as dix  # noqa: E402

DUEL_A = cards("duela")
DUEL_B = cards("duelb")
DUEL_C = cards("duelc")
OWN_D = cards("ownd")


def _k(cs):
    return ",".join(sorted(set(cs)))


def _rec(games, wins, opps=("golem", "xbow")):
    # Expected at 50/50, so the adjustment moves nothing and the figures are
    # just the shrunk records.
    return {"exact": {o: [games, wins, games / 2] for o in opps}, "near": {}}


# The ladder brain must be able to score a duel pick too, or `_duel_row`
# rightly drops it rather than draw a row with half its figures missing.
for _cs, _rate in ((DUEL_A, 57.0), (DUEL_B, 55.0), (DUEL_C, 54.0), (OWN_D, 56.0)):
    PROFILES[_k(_cs)] = {"golem": {"winRate": _rate, "games": 300, "tier": "high"},
                         "xbow": {"winRate": _rate, "games": 300, "tier": "high"}}

DUEL_SHORT = cards("short-duel")
_CATALOGUE = [
    {"key": _k(c), "cards": list(c), "archetype": a, "games": 500, "wins": 300,
     "players": 30, "records": r}
    for c, a, r in ((DUEL_A, "hog", _rec(400, 280)), (DUEL_B, "giant", _rec(400, 270)),
                    (DUEL_C, "miner", _rec(400, 262)),
                    # The strongest list in the catalogue — and it cannot fill
                    # all three special slots, so it must never be offered.
                    (DUEL_SHORT, "hog", _rec(400, 330)))
]
_RECORDS = {_k(HOG): _rec(300, 150), _k(OWN_D): _rec(300, 210)}
_PLAYER_DECKS = {
    "#B2": [{"key": _k(OWN_D), "cards": list(OWN_D), "archetype": "hog",
             "games": 10, "wins": 7, "lastSeen": "20260820T120000.000Z"}],
}
_raise_for: set[str] = set()


def _fake_records(cs):
    if _k(cs) in _raise_for:
        raise RuntimeError("simulated read failure")
    return _RECORDS.get(_k(cs), {"exact": {}, "near": {}, "neighbours": 0})


_fake_index = types.SimpleNamespace(
    available=lambda: True,
    catalogue=lambda: _CATALOGUE,
    status=lambda: {"builtAt": "2026-09-27T00:00:00Z", "windowFrom": "20260729T000000.000Z",
                    "windowTo": "20260926T000000.000Z", "windowDays": 60,
                    "windowGames": 1000, "catalogue": len(_CATALOGUE)},
    records=_fake_records,
    iso_to_stamp=dix.iso_to_stamp,
    player_decks=lambda tag, since=None, until=None, modes=None: _PLAYER_DECKS.get(tag, []),
)
_saved_index, _saved_brain = ta._duel_index, ta._duel
ta._duel_index, ta._duel = _fake_index, dbr
try:
    ctx = ta._DuelContext()
    check("the context is on when the index answers", ctx.on and len(ctx.catalogue) == 3)
    check("a catalogue list that cannot fill all three special slots is skipped, and counted",
          ctx.slot_gaps == 1 and all(d["key"] != _k(DUEL_SHORT) for d in ctx.catalogue),
          str(ctx.slot_gaps))
    # THE DUEL CATALOGUE IS IN THE COUNTER POOL (3.0). It was a separate list
    # of "picks" pinned under the #1 whatever the list's own figure said; the
    # account holder asked for the duel decks to be used ("they have so many
    # good decks"), and for decks at a good percentage — so a duel list is a
    # candidate like any other and earns its row on the one figure.
    ta.dcx._snap = lambda: {"cells": {}, "archetypes": [], "computedAt": 1000.0}
    ta._SCOUT_POOL = None
    ta._reset_counter_pool()
    _pool_now = ta._counter_candidates()
    check("the duel catalogue's lists are in the counter pool, marked by source",
          {c.key for c in _pool_now if c.origin == "duel"} == {_k(DUEL_A), _k(DUEL_B), _k(DUEL_C)},
          str(sorted(c.origin or "-" for c in _pool_now)))
    check("the list that cannot fill three slots is not in it",
          all(c.key != _k(DUEL_SHORT) for c in _pool_now))
    check("the pool is kept between requests", ta._counter_candidates() is _pool_now)
    check("and says how many lists it holds from each source",
          ta.counter_pool_stats().get("duel") == 3, str(ta.counter_pool_stats()))

    base = ta._folder(opp, blue_roster, pool, None, ta.TOP_N, None, None)
    duel_f = ta._folder(opp, blue_roster, pool, None, ta.TOP_N, None, ctx)
    d = duel_f["duel"]
    check("the folder says the duel brain ran, and which",
          d["available"] and d["brain"] == dbr.DUEL_BRAIN_VERSION, str(d))
    check("its projection is a distribution", abs(sum(p["likelihood"] for p in d["projection"]) - 1) < 1e-6)
    check("an opponent with no duels of their own gives weight 0",
          d["weight"] == 0.0 and d["theirGames"] == 0, str(d))

    rows = {r["owner"]["tag"]: r for r in duel_f["perPlayer"]}
    check("every list leads with the squad's pick for that teammate",
          all(r["decks"] and r["decks"][0].get("squadPick") for r in rows.values()))
    check("no list grows past seven", all(len(r["decks"]) <= ta.PER_PLAYER_TOP_N for r in rows.values()))
    # THE ORDER IS THE FIGURE PRINTED. A list used to run 66.8, 43.8, 57.5,
    # 63.3 on the live service: a duel pick held at #2 whatever it scored.
    check("below the #1 every list reads in the order of the figure printed",
          all(all(a["expectedWinRate"] >= b["expectedWinRate"]
                  for a, b in zip(r["decks"][1:], r["decks"][2:]))
              for r in rows.values()),
          str({t: [x["expectedWinRate"] for x in r["decks"]] for t, r in rows.items()}))
    check("below the #1 nobody is offered a deck expected to lose",
          all(x["expectedWinRate"] >= ts.FLOOR_RATE
              for r in rows.values() for x in r["decks"][1:]))
    picked = {t: [x for x in r["decks"] if x.get("duelPick")] for t, r in rows.items()}
    own = [x for x in picked["#B2"] if x["duelPick"] == dbr.PICK_OWN]
    check("a teammate's own proven duel deck comes back as THEIRS",
          own and own[0]["owner"]["tag"] == "#B2" and own[0]["key"] == _k(OWN_D),
          str([x["key"] for x in picked["#B2"]]))
    check("with their duel games as the practice line",
          own and own[0]["comfort"]["games"] == 10 and not own[0].get("fill"))
    pops = [x for v in picked.values() for x in v if x["duelPick"] == dbr.PICK_POPULATION]
    check("a duel-catalogue row is marked, ownerless, with the cards they play counted",
          pops and all(x.get("fill") and x["owner"] is None and "known" in x
                       and x.get("origin") == "duel" for x in pops),
          str([(x.get("fill"), x.get("origin")) for x in pops]))
    check("a row the duels call strong is marked proven, and only such a row",
          all(bool(x.get("duelProven")) == bool((x.get("duel") or {}).get("strong"))
              for r in rows.values() for x in r["decks"]))
    check("every duel row was rated on the list's own figure too",
          all(isinstance(x.get("expectedWinRate"), (int, float)) and "vs" in x
              for v in picked.values() for x in v))
    hog_row = next((x for x in rows["#B1"]["decks"] if x["key"] == _k(HOG)), None)
    check("a ladder row with duel evidence carries its figures",
          hog_row is None or (hog_row.get("duel") and not hog_row["duel"]["strong"]),
          str(hog_row and hog_row.get("duel")))
    check("every row carries its rate against each family they play",
          all(isinstance(x.get("vs"), dict) and x["vs"]
              for r in rows.values() for x in r["decks"]))
    check("the squad-wide list is in the order of its figure, and no longer than seven",
          all(a["expectedWinRate"] >= b["expectedWinRate"]
              for a, b in zip(duel_f["recommended"], duel_f["recommended"][1:]))
          and len(duel_f["recommended"]) <= ta.TOP_N,
          str([x["expectedWinRate"] for x in duel_f["recommended"]]))
    check("the short list, strongest of all, is offered to nobody",
          all(x["key"] != _k(DUEL_SHORT) for r in rows.values() for x in r["decks"])
          and all(x["key"] != _k(DUEL_SHORT) for x in duel_f["recommended"]))

    _PLAYER_DECKS["#R1"] = [{"key": _k(DUEL_A), "cards": list(DUEL_A), "archetype": "hog",
                             "games": 30, "wins": 18, "lastSeen": "20260820T120000.000Z"}]
    blended = ta._folder(opp, blue_roster, pool, None, ta.TOP_N, None, ta._DuelContext())["duel"]
    check("an opponent's own duels enter the duel projection with their weight",
          blended["theirGames"] == 30 and abs(blended["weight"] - 30 / 50) < 1e-3
          and any(p["archetype"] == "hog" for p in blended["projection"]), str(blended))
    del _PLAYER_DECKS["#R1"]

    _raise_for.add(_k(HOG))
    survived = ta._folder(opp, blue_roster, pool, None, ta.TOP_N, None, ta._DuelContext())
    check("a failing duel read costs that deck's figures, never the board",
          len(survived["perPlayer"]) == 3 and survived["duel"]["available"])
    _raise_for.clear()

    scout_duel = ta._folder(opp, [], scout_pool, None, ta.SCOUT_TOP_N, None, ta._DuelContext())
    check("a scouting report's picks are population picks and are not fills",
          all(not x.get("fill") for x in scout_duel["recommended"] if x.get("duelPick")))

    # A SOURCE THAT CHANGES DOES NOT MAKE A BOARD WAIT: the pool in hand keeps
    # answering while the next one is built behind it.
    import time as _time  # noqa: E402
    ta._duel_index = types.SimpleNamespace(**{**vars(_fake_index), "available": lambda: False})
    _stale = ta._counter_candidates()
    check("when a source is rebuilt the pool in hand still answers", _stale is _pool_now)
    for _ in range(200):
        if ta._counter_candidates() is not _pool_now:
            break
        _time.sleep(0.01)
    check("and the next pool replaces it, without the duel lists",
          ta._counter_candidates() is not _pool_now
          and all(c.origin != "duel" for c in ta._counter_candidates()),
          str(ta.counter_pool_stats()))

    off_ctx = ta._DuelContext()
    plain = ta._folder(opp, blue_roster, pool, None, ta.TOP_N, None, None)
    off = ta._folder(opp, blue_roster, pool, None, ta.TOP_N, None, off_ctx)
    check("with no index the brain is off and says so", not off_ctx.on
          and off["duel"] == {"available": False})
    check("and every list is exactly the ladder brain's",
          [[x["key"] for x in r["decks"]] for r in off["perPlayer"]]
          == [[x["key"] for x in r["decks"]] for r in plain["perPlayer"]]
          and all("duel" not in x for r in off["perPlayer"] for x in r["decks"]))
    ta._duel = None
    check("and with the module missing, the same", not ta._DuelContext().on)
finally:
    ta._duel_index, ta._duel = _saved_index, _saved_brain
    ta.dcx._snap = lambda: None
    ta._SCOUT_POOL = None
    ta._reset_counter_pool()


# ── the fused rate (`matchup_fusion`) ───────────────────────────────────────
#
# `matchup_fusion` decides and has its own suite; this checks the WIRING: a
# hub candidate reads the version cells, a teammate's own list reads its own
# ladder history, two lists of ONE archetype can score differently, and with
# the module missing every rate is the ladder rung exactly as before.

# ── counters to what they play (brain 3.0) ─────────────────────────────────
#
# `team_scout` decides and `test_counters.py` holds its rules; this checks the
# WIRING: the projection is the player's own decks, a deck filed under `other`
# is grouped by what it is, the Deck Counter's list is a scouting report of
# one player, and the tight rating loop gives the figure the full scorer gives.

print(NL + "counters to what they play")

check("the brain is 7.0", ts.BRAIN_VERSION == "team-scout-7.0" and folder["brain"] == ts.BRAIN_VERSION)

# 7.0: EVERY ROW SAYS WHETHER IT BEATS EVERY FAMILY THEY PLAY — and the mark
# survives the full re-rating of a chosen row (`_CHOSEN_KEYS`).
_fams = [p["family"] for p in folder["plays"] if p["share"] >= ts.EACH_SHARE]
_rows = folder["recommended"]
check("every suggested row carries allArchetypes and its worst matchup",
      _rows and all("allArchetypes" in r and "eachWorst" in r for r in _rows),
      str([(r.get("name"), r.get("allArchetypes")) for r in _rows]))
check("...and a row marked so really is 50%+ against every family on the screen",
      all(all((r["vs"].get(f) or 0) >= ts.EACH_FLOOR for f in _fams)
          for r in _rows if r.get("allArchetypes")), str(_fams))
check("...the rows that beat every family lead the list",
      [r["allArchetypes"] for r in _rows] == sorted((r["allArchetypes"] for r in _rows), reverse=True))
# A SCOUTING folder's rows are only RATED in the pool and rated again in full
# once chosen (`_finish`): the mark has to survive that.
_srows = scout_folder["recommended"]
check("a scouting row keeps its mark through the full re-rating",
      _srows and all(isinstance(r.get("allArchetypes"), bool) and "art" in r for r in _srows),
      str([(r.get("name"), r.get("allArchetypes"), "art" in r) for r in _srows]))
_saved_syn = ta._synergy
ta._synergy = types.SimpleNamespace(passes=lambda cards: "odd" not in cards)
check("the card-pairing gate keeps a list duel players pair like a real deck",
      ta._pairs_ok(["hog", "log"]) and not ta._pairs_ok(["hog", "odd"]))
ta._synergy = types.SimpleNamespace(passes=lambda cards: (_ for _ in ()).throw(RuntimeError("x")))
check("...a failing gate costs no list", ta._pairs_ok(["hog", "odd"]))
ta._synergy = None
check("...and no table is no gate", ta._pairs_ok(["hog", "odd"]))
ta._synergy = _saved_syn

# DUEL LISTS COME FROM THE NAMED GROUP ONLY, and every pool list knows its own
# rate against the field.
_GA, _GB, _GC = cards("grpA"), cards("grpB"), cards("grpC")
_cat = [{"key": _k(c), "cards": list(c), "archetype": "hog", "games": 50, "wins": 30,
         "players": 9, "records": None} for c in (_GA, _GB, _GC)]
_saved_g = (ta._duel_index, ta._load_cohorts, ta._COHORTS_PATH, ta.DUEL_POOL_COHORT)
ta._GROUP_LISTS.update(key=None, lists=None)
ta._duel_index = types.SimpleNamespace(
    catalogue=lambda: _cat, status=lambda: {"buildId": "b1"},
    lists_of=lambda tags: {_k(_GA): [7, 3], _k(_GB): [2, 1]} if "#TOP1" in tags else {})
ta._load_cohorts = lambda: {"crl": {"#TOP1", "#TOP2"}}
ta._COHORTS_PATH = None
try:
    _kept, _whose = ta.duel_catalogue()
    check("a duel list is offered only when the group fielded it enough",
          [d["key"] for d in _kept] == [_k(_GA)] and _whose == "crl" and ta.DUEL_POOL_MIN_GAMES == 3,
          f"{[d['key'][:8] for d in _kept]} {_whose}")
    ta._load_cohorts = lambda: {}
    ta._GROUP_LISTS.update(key=None, lists=None)
    check("with no such group every catalogue list is offered, and it says whose",
          ta.duel_catalogue() == (_cat, "everyone"))
    ta._load_cohorts = lambda: (_ for _ in ()).throw(RuntimeError("file gone"))
    ta._GROUP_LISTS.update(key=None, lists=None)
    check("a failing group file costs the narrowing and nothing else",
          ta.duel_catalogue() == (_cat, "everyone"))
    ta.DUEL_POOL_COHORT = ""
    check("an empty setting is everyone", ta.duel_catalogue() == (_cat, "everyone"))
finally:
    ta._duel_index, ta._load_cohorts, ta._COHORTS_PATH, ta.DUEL_POOL_COHORT = _saved_g
    ta._GROUP_LISTS.update(key=None, lists=None)

_fc = ta._Candidate({"cards": HOG, "winCondition": "hog", "origin": "ladder"}, None,
                    ta._DeckProfile(HOG, "hog"))
check("a candidate knows nothing general about itself until the pool is rated", _fc.field is None)
_plain = ta._score(_fc, _proj_threats := ta._plays([deck("Golem", GOLEM, matches=30, wc="golem")])["threats"],
                   None, None, dress=False)
check("...and its row carries no field rate", _plain is not None and "fieldRate" not in _plain)
_fc.field = 51.2
_with = ta._score(_fc, _proj_threats, None, None, dress=False)
_full = ta._score(_fc, _proj_threats, None, None)
check("a rated pool list carries its field rate on the rated row and the dressed one",
      _with["fieldRate"] == 51.2 and _full["fieldRate"] == 51.2)
_sel = ts.counters([_with], [{"family": "golem", "share": 1.0}])
check("...which is what the list tells a counter from an all-round deck by",
      _sel[0]["lift"] == round(_with["expectedWinRate"] - 51.2, 1))
_saved_di2 = ta._duel_index
ta._duel_index = types.SimpleNamespace(deck_players=lambda: [
    ("a," * 7 + "a8", "hog", 60), ("b," * 7 + "b8", "hog", 20),
    ("c," * 7 + "c8", "golem", 19), ("d," * 7 + "d8", "xbow", 1), ("e," * 7 + "e8", "lava", 0)])
try:
    _ft = ta._field_threats()
    check("the average opponent is every archetype players field, by PLAYERS",
          [(t["archetype"], round(t["likelihood"], 3)) for t in _ft]
          == [("hog", round(80 / 100, 3)), ("golem", round(19 / 100, 3)), ("xbow", round(1 / 100, 3))],
          str([(t["archetype"], t["likelihood"]) for t in _ft]))
    check("...at the archetype level: no list, so no version cell is read",
          all(t["cards"] == [] for t in _ft) and abs(sum(t["likelihood"] for t in _ft) - 1.0) < 1e-9)
    check("...each with the share of its lists holding a card, by players, for the card model",
          abs(_ft[0]["cardShare"]["a8"] - 60 / 80) < 1e-9 and abs(_ft[0]["cardShare"]["b8"] - 20 / 80) < 1e-9
          and set(_ft[1]["cardShare"]) == {"c", "c8"}, str(_ft[0].get("cardShare")))
    ta.FIELD_MIN_SHARE, _keep = 0.05, ta.FIELD_MIN_SHARE
    check("...an archetype almost nobody fields is left out, and the rest still sums to one",
          [t["archetype"] for t in ta._field_threats()] == ["hog", "golem"]
          and abs(sum(t["likelihood"] for t in ta._field_threats()) - 1.0) < 1e-9)
    ta.FIELD_MIN_SHARE = _keep
finally:
    ta._duel_index = _saved_di2
_saved_ft = ta._field_threats
ta._field_threats = lambda: (_ for _ in ()).throw(RuntimeError("no field"))
try:
    check("a field that cannot be read rates nothing and breaks nothing", ta._set_field_rates([_fc]) == 0)
finally:
    ta._field_threats = _saved_ft

_fam = ta._family("hog", HOG)
check("a named archetype is its own family", _fam == ("hog", ta.dcx._label("hog")), str(_fam))
_other = ta._family("other", ["minion-giant", "a", "b", "c", "d", "e", "f", "g"])
check("a deck filed under `other` is grouped by the win condition it plays",
      _other[0].startswith("other:") and _other[1] and _other[1] != "Mixed", str(_other))

_proj = ta._plays([
    deck("Hog", HOG, matches=60, wc="hog"),
    deck("Golem", GOLEM, matches=30, wc="golem"),
    deck("Lava", LAVA, matches=10, wc="lava"),
])
check("the projection holds their own decks and nothing else",
      {t["key"] for t in _proj["threats"]} == {_k(HOG), _k(GOLEM), _k(LAVA)}
      and all(t["evidence"] == ts.OBSERVED for t in _proj["threats"]))
check("every family they play is labelled and styled",
      all(p["name"] and p.get("style") for p in _proj["plays"]), str(_proj["plays"]))
check("every threat says which family it is", all(t.get("family") for t in _proj["threats"]))
_bars = ta._spread_of(_proj["plays"])
check("the bars on the left are the shares the list was scored against",
      [(b["archetype"], b["share"]) for b in _bars]
      == [(p["family"], round(100 * p["share"], 1)) for p in _proj["plays"]])

check("a folder publishes what they play, by family",
      folder.get("plays") and all({"family", "name", "share", "games", "decks"} <= set(p)
                                  for p in folder["plays"]), str(folder.get("plays")))
check("...the chance beside the history, and how the history was read",
      all("played" in p and "duelGames" in p for p in folder["plays"])
      and folder["read"]["temper"] == ts.TEMPER and folder["read"]["duelWeight"] == ts.DUEL_WEIGHT,
      str(folder.get("read")))
check("every suggested row says what it does worst against, by name",
      all(r.get("worst") and r["worst"].get("name") and r["worst"]["family"] in r["vs"]
          for r in folder["recommended"]), str([r.get("worst") for r in folder["recommended"]][:2]))
check("its threats are all decks they were seen playing",
      folder["threats"] and all(t["evidence"] == ts.OBSERVED for t in folder["threats"]))
check("every suggested row carries its rate against each family they play",
      all(isinstance(r.get("vs"), dict) and r["vs"] for r in folder["recommended"])
      and all(isinstance(r.get("vs"), dict) for row in folder["perPlayer"] for r in row["decks"]))
check("the squad-wide list reads in the order of its figure",
      [r["expectedWinRate"] for r in folder["recommended"]]
      == sorted((r["expectedWinRate"] for r in folder["recommended"]), reverse=True))
check("a matchup's share is a percentage of the projection, on every row",
      all(abs(m["share"] - round(100 * m["likelihood"], 1)) < 1e-9
          for r in folder["recommended"] for m in (r.get("matchups") or [])))

# RECORDS THE FUSED RATE CAN READ. The fixtures above carry a rate and a game
# count, which is all the ladder rung reads; the fused rate reads WINS and
# LOSSES, so without them it rates nothing and every check below would pass
# on an empty list.
def _rich_profile(cs):
    recs = {}
    for a, r in PROFILES.get(_k(cs), {}).items():
        wins = int(round(r["winRate"] * r["games"] / 100.0))
        recs[a] = {**r, "wins": wins, "losses": r["games"] - wins}
    return {"archetypes": recs, "overall": {"winRate": 52.0, "games": 900}, "battles": 0}


dcx.deck_profile = _rich_profile

# THE TIGHT LOOP AND THE FULL SCORER AGREE, on the real rater.
import matchup_fusion as _mf  # noqa: E402
_saved_fusion = ta._fusion
ta._fusion = _mf
try:
    _rich_pool = ta._candidates(blue_roster)
    _fx_ctx = types.SimpleNamespace(on=False, fx=None, records=lambda cs: None)
    _fx_ctx.fx = ta._FusionContext(None, None)
    _table = _fx_ctx.fx.threat_table(_proj["threats"])
    _agree, _rated = True, 0
    for _c in _rich_pool:
        _lean = ta._score(_c, _proj["threats"], None, _fx_ctx, dress=False, table=_table)
        _full = ta._score(_c, _proj["threats"], None, _fx_ctx)
        if (_lean is None) != (_full is None):
            _agree = False
        elif _lean is not None:
            _rated += 1
            _agree = _agree and all(_lean[k] == _full[k] for k in
                                    ("expectedWinRate", "score", "vs", "threatCovered",
                                     "evidenceStrength", "key", "name"))
            _agree = _agree and "matchups" not in _lean and "art" not in _lean
    check("a pool row rated in the tight loop has the full scorer's figures",
          _agree and _rated >= 2, f"rated {_rated}")
    _c0 = _rich_pool[0]
    check("the archetype half of a rate is worked once and remembered on the candidate",
          len(_c0.memo) >= 1 and _fx_ctx.fx.arch_half(_c0, "golem") is _fx_ctx.fx.arch_half(_c0, "golem"))
    _hog_tl = next(c for c in _rich_pool if c.key == _k(HOG))
    _hog_tl.field = 48.5
    _tl = ta._score(_hog_tl, _proj["threats"], None, _fx_ctx, dress=False, table=_table)
    check("a pool row rated in the TIGHT LOOP carries its field rate too",
          _tl is not None and _tl.get("fieldRate") == 48.5, str(_tl and _tl.get("fieldRate")))
    _hog_tl.field = None

    # THE BALANCE LOG, ON BOTH SIDES OF A RATE. A stand-in for `card_balance`
    # whose drags the cases set: the Hog candidate's list, the Golem threat's.
    _saved_balance = ta._balance
    _DRAGS: dict = {}

    class _Bal:
        @staticmethod
        def drag(cs, as_of=None):
            return _DRAGS.get(_k(cs), 0.0)

        @staticmethod
        def marks(cs, as_of=None):
            return ([{"card": sorted(cs)[0], "kind": "nerf", "form": "base", "date": "2026-10-06"}]
                    if _DRAGS.get(_k(cs)) else [])

    ta._balance = _Bal
    try:
        _hog_c = next(c for c in _rich_pool if c.key == _k(HOG))

        def _rates(balance, drags):
            _DRAGS.clear()
            _DRAGS.update(drags)
            ctx_ = types.SimpleNamespace(on=False, fx=None, records=lambda cs: None)
            ctx_.fx = ta._FusionContext(None, None)
            ctx_.fx.balance = balance
            tab = ctx_.fx.threat_table(_proj["threats"])
            lean = ta._score(_hog_c, _proj["threats"], None, ctx_, dress=False, table=tab)
            full = ta._score(_hog_c, _proj["threats"], None, ctx_)
            return lean, full

        _base, _base_full = _rates(True, {})
        _fam = next(iter(_base["vs"]))
        _off, _ = _rates(False, {_k(HOG): 2.0, _k(GOLEM): 1.0})
        check("the fixture rates the Hog list against a family of theirs",
              _base["vs"].get(_fam) is not None, str(_base["vs"]))
        check("a context that does not ask for the balance log is not moved (Coach Assist)",
              _off["vs"] == _base["vs"], f"{_off['vs']} {_base['vs']}")
        _mine, _mine_full = _rates(True, {_k(HOG): 2.0})
        check("a nerfed list is rated under its record",
              abs((_base["vs"][_fam] - _mine["vs"][_fam]) - 2.0) < 0.11, f"{_base['vs']} {_mine['vs']}")
        _theirs, _ = _rates(True, {_k(GOLEM): 1.0})
        check("a nerfed THREAT is that much easier",
              abs((_theirs["vs"][_fam] - _base["vs"][_fam]) - 1.0) < 0.11, f"{_base['vs']} {_theirs['vs']}")
        _both, _both_full = _rates(True, {_k(HOG): 2.0, _k(GOLEM): 1.0})
        check("both sides apply together",
              abs((_base["vs"][_fam] - _both["vs"][_fam]) - 1.0) < 0.11, f"{_base['vs']} {_both['vs']}")
        check("the tight loop and the full scorer still agree with the log applied",
              all(_both[k] == _both_full[k] for k in ("expectedWinRate", "score", "vs"))
              and all(_mine[k] == _mine_full[k] for k in ("expectedWinRate", "score", "vs")),
              f"{_both['expectedWinRate']} {_both_full['expectedWinRate']}")
        check("the dressed row marks which of its cards changed, and only then",
              _mine_full.get("balance") and _mine_full["balance"][0]["kind"] == "nerf"
              and "balance" not in _base_full, str(_mine_full.get("balance")))
        ta._balance = None
        _gone, _gone_full = _rates(True, {_k(HOG): 2.0})
        check("with no balance log deployed nothing is moved and nothing is marked",
              _gone["vs"] == _base["vs"] and "balance" not in _gone_full)
    finally:
        ta._balance = _saved_balance

    # THE CARD MATCHUP MODEL, BESIDE THE FUSED RATE. A model in which the Hog
    # list's first card is worth 0.3 and every Hog card beats every Golem card
    # by 0.01: 0.94 against the Golem threat, 0.3 against Lava, 0 against itself.
    import card_matchup as _cmm  # noqa: E402
    _saved_cardm, _saved_load = ta._cardm, _cmm.load
    _MODEL = _cmm.prepare({"brain": "card-matchup-test", "main": {HOG[0]: 0.3}, "pair": {
        g + "|" + h: -0.01 for g in GOLEM for h in HOG}})
    check("the stand-in model says what the comment says",
          abs(_cmm.raw(_MODEL, HOG, GOLEM) - 0.94) < 1e-9 and abs(_cmm.raw(_MODEL, HOG, LAVA) - 0.3) < 1e-9
          and _cmm.raw(_MODEL, HOG, HOG) == 0.0)
    try:
        def _cm_rates(asks, model=_MODEL, balance=False):
            _cmm.load = lambda path=None: model
            ctx_ = types.SimpleNamespace(on=False, fx=None, records=lambda cs: None)
            ctx_.fx = ta._FusionContext(None, None)
            ctx_.fx.balance = balance
            if asks:
                ctx_.fx.use_cards()
            tab = ctx_.fx.threat_table(_proj["threats"])
            lean = ta._score(_hog_c, _proj["threats"], None, ctx_, dress=False, table=tab)
            full = ta._score(_hog_c, _proj["threats"], None, ctx_)
            return lean, full, ctx_

        _off, _off_full, _ = _cm_rates(False)
        check("a context that does not ask for the card model is the fused rate (Coach Assist)",
              _off["vs"] == _base["vs"] and _off["expectedWinRate"] == _base["expectedWinRate"])
        _on, _on_full, _ctx_on = _cm_rates(True)
        _by_hand, _n_hand = True, 0
        for _t in _proj["threats"]:
            _r = _ctx_on.fx.rater(_hog_c)(_t)
            if _r is None:      # nothing to go on: unanswered, with or without a model
                continue
            _n_hand += 1
            _want = _cmm.combine(_r["fusedRate"], _cmm.raw(_MODEL, _hog_c.cards, _t["cards"]))
            _by_hand = _by_hand and _r["winRate"] == _want
        check("with it, every rate is combine(fused rate, the model on the two lists)",
              _by_hand and _n_hand >= 1, str(_n_hand))
        check("a threat nothing is known about stays unanswered: the model does not invent a rate",
              (_ctx_on.fx.rater(_hog_c)(_proj["threats"][-1]) is None)
              == (ta._FusionContext(None, None).rater(_hog_c)(_proj["threats"][-1]) is None))
        _gfam = ta._family("golem", GOLEM)[0]
        check("the list the model favours against Golem is rated higher against Golem",
              _on["vs"][_gfam] > _off["vs"][_gfam] + 5, f"{_on['vs']} {_off['vs']}")
        check("...and the headline moves with it", _on["expectedWinRate"] != _off["expectedWinRate"])
        check("the tight loop and the full scorer agree with the model on",
              all(_on[k] == _on_full[k] for k in ("expectedWinRate", "score", "vs", "threatCovered")),
              f"{_on['expectedWinRate']} {_on_full['expectedWinRate']}")
        _flip = _cmm.prepare({"main": {}, "pair": {g + "|" + h: 0.01 for g in GOLEM for h in HOG}})
        check("a model that says the opposite moves the rate the other way",
              _cm_rates(True, _flip)[0]["vs"][_gfam] < _off["vs"][_gfam])
        check("no trained model is the fused rate alone",
              _cm_rates(True, None)[0]["vs"] == _off["vs"])
        ta._cardm = None
        check("no card_matchup module is the fused rate alone, and nothing raises",
              _cm_rates(True)[0]["vs"] == _off["vs"])
        ta._cardm = _saved_cardm

        def _boom(path=None):
            raise RuntimeError("unreadable model")

        _cmm.load = _boom
        _ctx_b = ta._FusionContext(None, None)
        _ctx_b.use_cards()
        check("a model that cannot be loaded never costs a rate", _ctx_b.cm is None)

        # THE BALANCE LOG GOES ON TOP OF THE MODEL, in both loops.
        _saved_balance2 = ta._balance
        ta._balance = types.SimpleNamespace(
            drag=lambda cs, as_of=None: 2.0 if _k(cs) == _k(HOG) else 0.0,
            marks=lambda cs, as_of=None: [])
        try:
            _both_l, _both_f, _ = _cm_rates(True, balance=True)
            check("a nerfed list is rated 2 points under the model's figure, in both loops",
                  abs((_on["vs"][_gfam] - _both_l["vs"][_gfam]) - 2.0) < 0.11
                  and _both_l["vs"] == _both_f["vs"], f"{_on['vs']} {_both_l['vs']}")
        finally:
            ta._balance = _saved_balance2

        # THE AVERAGE OPPONENT OF AN ARCHETYPE has no list; it has card shares.
        _cmm.load = lambda path=None: _MODEL
        _fxv = ta._FusionContext(None, None)
        _fxv.use_cards()
        _share = {c: 1.0 for c in GOLEM}
        _vec = _fxv.card_vector({"cardShare": _share}, None)
        check("a field threat is read through the shares of cards its lists hold",
              _vec is not None and abs(_cmm.score(_vec, HOG) - 0.94) < 1e-9)
        check("a threat with neither a list nor shares gets no model term",
              _fxv.card_vector({"archetype": "golem"}, None) is None)
        check("one list is prepared once a request",
              _fxv.card_vector({}, _k(GOLEM)) is _fxv.card_vector({}, _k(GOLEM)))
        _field_t = [{"cards": [], "archetype": "golem", "family": "golem", "likelihood": 1.0,
                     "key": "archetype:golem", "cardShare": _share}]
        _plain = ta._FusionContext(None, None)
        _r_plain = _plain.rater(_hog_c)(_field_t[0])
        _r_model = _fxv.rater(_hog_c)(_field_t[0])
        check("a list's rate against the FIELD is read through the model too",
              _r_plain is not None and _r_model["winRate"] == _cmm.combine(_r_plain["winRate"], 0.94),
              f"{_r_plain} {_r_model}")
        _lean_field = list(_fxv.lean_rates(_hog_c, _fxv.threat_table(_field_t)))
        check("...the same figure in the tight loop the pool's field rates use",
              _lean_field and _lean_field[0][2] == _r_model["winRate"], str(_lean_field))
    finally:
        ta._cardm, _cmm.load = _saved_cardm, _saved_load
finally:
    ta._fusion = _saved_fusion

# WHAT A PLAYER PLAYS IS THEIR OWN-DECK GAMES AND THEIR DUEL GAMES — the Decks
# screen's count — not everything stored under their tag.
_EVENT = cards("event")
_saved_report, _saved_cov = ta.cd.player_report, ta.cd.coverage
_saved_played = ta._pdecks.played
ta.cd.coverage = lambda tag=None: {"start": "2026-07-01", "end": "2026-08-20", "days": 51}
ta.cd.player_report = lambda tag, since=None, until=None: ({
    "player": {"name": "Mohamed", "battles": 400, "wins": 220},
    # Every mode: an event deck leads it.
    "decks": [deck("Event", _EVENT, matches=300, wc="hog"),
              deck("Golem", GOLEM, matches=90, wc="golem"),
              deck("Xbow", XBOW, matches=10, wc="xbow")],
} if tag == "#R1" else None)
_ASKED_MODES = []
ta._pdecks.played = lambda tag, since=None, until=None, modes=None: _ASKED_MODES.append(modes) or {
    "per": ({_k(GOLEM): [50, 38, 2, "20260820T120000.000Z", list(GOLEM), "golem"],
             _k(XBOW): [6, 4, 0, "20260819T120000.000Z", list(XBOW), "xbow"]}
            if tag == "#R1" else {}),
    "marks": {}, "loadouts": 0, "duelGames": 12, "duelIndex": True,
    "duel": ({_k(GOLEM): 12, _k(XBOW): 400} if tag == "#R1" else {}),
    "archiveUsed": False, "hidden": {"Challenge_AllCards_EventDeck_NoSet": 300},
}
_me = ta._resolve("#R1", 30)
check("an opponent is read from ranked and 1v1 friendly games only (7.0)",
      _ASKED_MODES and set(_ASKED_MODES) == {"ranked_friendly"}
      and ta.OPPONENT_MODES == ta._pdecks.RANKED_FRIENDLY, str(_ASKED_MODES))
check("each deck says how many of its games were duel games, never more than it has",
      [d["duelMatches"] for d in _me["decks"]] == [12, 10], str([d.get("duelMatches") for d in _me["decks"]]))
check("with no duel index there are no older duel decks, and the read still answers",
      _me["older"] == [])


class _OlderIndex:
    asked = None

    @staticmethod
    def iso_to_stamp(day, end=False):
        return (day or "") + ("T235959" if end else "T000000")

    @classmethod
    def player_decks(cls, tag, since=None, until=None, modes=None):
        cls.asked = (tag, since, until)
        cls.modes = modes
        return [{"cards": list(LAVA), "games": 5, "wins": 3, "archetype": "lava",
                 "lastSeen": "20260701T120000.000Z"},
                {"cards": list(LAVA)[:7], "games": 9, "wins": 1, "archetype": "lava"},
                {"cards": list(HOG), "games": 0, "wins": 0, "archetype": "hog"}]


_saved_di = ta._duel_index
ta._duel_index = _OlderIndex
try:
    _old = ta._older_duel_decks("#R1", "2026-08-01")
    check("older duel decks are the lists they duelled with BEFORE the window",
          [d["deckHash"] for d in _old] == [_k(LAVA)] and _old[0]["matches"] == 5
          and _old[0]["family"] and _old[0]["name"], str(_old))
    check("...asked of the days just before it, no further back than the constant",
          _OlderIndex.asked == ("#R1", "2026-06-02T000000", "2026-07-31T235959")
          and ta.OLDER_DUEL_DAYS == 60, str(_OlderIndex.asked))
    check("...friendly duels only, never clan-war duels (7.0)",
          tuple(_OlderIndex.modes or ()) == ("duel_1v1_friendly",), str(_OlderIndex.modes))
    check("...and of nothing when there is no window", ta._older_duel_decks("#R1", None) == [])
    _me2 = ta._resolve("#R1", 30)
    check("a resolved player carries them, apart from the decks they play",
          [d["deckHash"] for d in _me2["older"]] == [_k(LAVA)]
          and _k(LAVA) not in [d["deckHash"] for d in _me2["decks"]])
    _fold = ta._plays(_me2["decks"], _me2["older"])
    check("...and the projection scores against them",
          _k(LAVA) in {t["key"] for t in _fold["threats"]}
          and next(p for p in _fold["plays"] if p["archetype"] == "lava")["played"] == 0)
    ta._duel_index = types.SimpleNamespace(
        iso_to_stamp=_OlderIndex.iso_to_stamp,
        player_decks=lambda *a, **k: (_ for _ in ()).throw(RuntimeError("index gone")))
    check("a failing duel index costs the older decks and nothing else",
          ta._older_duel_decks("#R1", "2026-08-01") == [])
finally:
    ta._duel_index = _saved_di
check("a stored player's decks are the ones they PLAY: the event deck is not one",
      [d["deckHash"] for d in _me["decks"]] == [_k(GOLEM), _k(XBOW)],
      str([d["deckHash"] for d in _me["decks"]]))
check("...most played first, with their record and their share on each",
      _me["decks"][0]["matches"] == 90 and _me["decks"][0]["wins"] == 50
      and _me["decks"][0]["useRate"] == 90.0 and _me["decks"][0]["winCondition"] == "golem")
check("...and a family and a name on every one",
      all(d.get("family") and d.get("familyName") and d.get("name") for d in _me["decks"]))
check("the header counts the same games the deck list does",
      _me["battles"] == 100 and _me["winRate"] == 56.0, f"{_me['battles']} {_me['winRate']}")
check("...and says how many were duel games and how many were left out",
      _me["played"] == {"source": "own_deck", "duelGames": 12, "hidden": 300}, str(_me.get("played")))
_real = ta._pdecks.played
ta._pdecks.played = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no reader"))
check("without the reader the every-mode list still answers",
      len(ta._resolve("#R1", 30)["decks"]) == 3)
ta._pdecks.played = _real

# THE DECK COUNTER'S LIST IS A SCOUTING REPORT OF ONE PLAYER.
ta.dcx._snap = lambda: {"cells": {}, "archetypes": [], "computedAt": 1000.0}
ta._SCOUT_POOL = None
ta._reset_counter_pool()
# THE CHECKS BELOW ARE THE ENGINE'S WIRING (rating, selection, views), on the
# fixture's candidates: since 5.0 the pool comes from `_competitive_pool`,
# which has its own section further down.
_saved_cp = ta._competitive_pool
# The stub is the 4.1 window pool, so the window checks below keep testing
# how a pool, its days and each list's play reach the rows.
ta._competitive_pool = lambda days, until=None: ta._window_pool(days)
_bring = ta.bring("#R1")
check("bring() answers with what they play and the decks to bring",
      _bring["plays"] and _bring["decks"] and _bring["brain"] == ts.BRAIN_VERSION, str(_bring.get("reason")))
check("...and says how their history was read",
      _bring["read"]["duelGames"] == 22 and _bring["read"]["temper"] == ts.TEMPER, str(_bring.get("read")))
check("...every pool row that reached the list kept its worst case through the dressing, named",
      all(d.get("worst") and d["worst"].get("name") and d["worst"]["rate"] == d["vs"][d["worst"]["family"]]
          for d in _bring["decks"]), str([d.get("worst") for d in _bring["decks"]][:2]))

# BOTH SCREENS ASK FOR THE BALANCE LOG; a context built by anything else does not.
_asked = []
_saved_fc = ta._FusionContext


class _SpyFC(_saved_fc):
    def threat_table(self, threats):
        _asked.append(self.balance)
        return super().threat_table(threats)


ta._FusionContext = _SpyFC
try:
    ta.bring("#R1")
    check("the Deck Counter's list reads the balance log", _asked and all(_asked), str(_asked))
    del _asked[:]
    ta.analyze([], ["#R1"], days=30)
    check("and so does Team Analysis", _asked and all(_asked), str(_asked))
    check("a context built without asking does not", _saved_fc(None, None).balance is False)
finally:
    ta._FusionContext = _saved_fc

# BOTH SCREENS, AND THE POOL'S FIELD RATES, ASK FOR THE CARD MODEL.
import card_matchup as _cmm2  # noqa: E402
_used = []
_saved_load2, _saved_stamp2 = _cmm2.load, _cmm2.stamp


class _SpyCards(_saved_fc):
    def use_cards(self):
        _used.append(1)
        return super().use_cards()


ta._FusionContext = _SpyCards
_cmm2.load = lambda path=None: _cmm2.prepare({"brain": "card-matchup-test", "main": {HOG[0]: 0.2}, "pair": {}})
try:
    _b2 = ta.bring("#R1")
    check("the Deck Counter's list asks for the card model", len(_used) >= 1, str(_used))
    check("...and says which model rated it", _b2.get("cardModel") == "card-matchup-test", str(_b2.get("cardModel")))
    del _used[:]
    _a2 = ta.analyze([], ["#R1"], days=30)
    check("so does Team Analysis", len(_used) >= 1 and _a2["fusion"].get("cardModel") in ("card-matchup-test", None),
          str(_a2.get("fusion")))
    del _used[:]
    _saved_ft2 = ta._field_threats
    ta._field_threats = lambda: [{"cards": [], "archetype": "golem", "family": "golem",
                                  "likelihood": 1.0, "key": "archetype:golem"}]
    try:
        ta._set_field_rates([])
    finally:
        ta._field_threats = _saved_ft2
    check("and the pool's rates against the field, or a liked list would look like a counter to everybody",
          len(_used) == 1 and ta._fusion is not None, str(_used))
    check("a context built without asking has no model", _saved_fc(None, None).cm is None)
    _cmm2.load = lambda path=None: None
    check("before a model is trained the list says so and still answers",
          ta.bring("#R1").get("cardModel") is None and ta.bring("#R1")["decks"])
    _cmm2.stamp = lambda path=None: 1.0
    _k1 = ta._counter_key()
    _cmm2.stamp = lambda path=None: 2.0
    check("a retrained model is a new counter pool", _k1 is not None and ta._counter_key() != _k1
          and ta._counter_key()[:3] == _k1[:3], f"{_k1} {ta._counter_key()}")
finally:
    ta._FusionContext = _saved_fc
    _cmm2.load, _cmm2.stamp = _saved_load2, _saved_stamp2
check("...the same decks a scouting report of that player lists",
      [d["key"] for d in _bring["decks"]]
      == [d["key"] for d in ta.analyze([], ["#R1"], days=30)["folders"][0]["recommended"]])
check("...in the order of their figure",
      [d["expectedWinRate"] for d in _bring["decks"]]
      == sorted((d["expectedWinRate"] for d in _bring["decks"]), reverse=True))
check("...with a group for every family they play",
      [g["family"] for g in _bring["byFamily"]] == [p["family"] for p in _bring["plays"]][:ts.ANSWER_FAMILIES])
check("...each deck in a group carrying its rate against THAT family",
      all(d["rate"] == d["vs"][g["family"]] and d["rate"] >= ts.GOOD_RATE
          for g in _bring["byFamily"] for d in g["decks"]))
check("...no per-threat table on the grouped rows",
      all("matchups" not in d for g in _bring["byFamily"] for d in g["decks"]))
check("...and how many lists it was chosen from",
      _bring["pool"]["decks"] == len(ta._counter_candidates()))
check("an explicit window is the window", ta.bring("#R1", "2026-08-01", "2026-08-20")["window"]
      == {"from": "2026-08-01", "to": "2026-08-20"})
_none = ta.bring("#NOBODY")
check("nobody stored is no_history, with no decks invented",
      _none["reason"] == "no_history" and _none["decks"] == [] and _none["byFamily"] == [])

# THE DAY WINDOW REACHES THE SUGGESTIONS (2026-10-11): the lists played in
# the days asked for, and not the ones the days before were heavier in.
_SCALE = 7 / 60.0       # a pool that played the same games a day, 7 days against 60
check("under five games in the window is not played in it",
      ta.window_state({0: 2, 3: 2, 9: 500}, 7, 60, _SCALE) == ("absent", 4) and ta.WINDOW_MIN_GAMES == 5)
check("a share under half of what it held before is fading - the previous days are the heavier side",
      ta.window_state({1: 30, 20: 600}, 7, 60, _SCALE) == ("fading", 30) and ta.WINDOW_FADE == 0.5)
check("...exactly half is not",
      ta.window_state({1: 35, 20: 600}, 7, 60, _SCALE) == ("easing", 35))
check("...and the rest by how the share moved",
      [ta.window_state({1: n, 20: 600}, 7, 60, _SCALE)[0] for n in (55, 56, 70, 87, 88)]
      == ["easing", "steady", "steady", "steady", "rising"])
check("IT IS SHARE, NOT GAMES A DAY: the same games a day while the pool doubled is a fall",
      ta.window_state({1: 70, 20: 600}, 7, 60, _SCALE)[0] == "steady"
      and ta.window_state({1: 60, 20: 600}, 7, 60, 2 * _SCALE)[0] == "fading")
check("played in the window and never before it is new",
      ta.window_state({2: 9}, 7, 60, _SCALE) == ("new", 9))
check("too little before to compare with is played, never fading",
      ta.window_state({2: 6, 20: 40}, 7, 60, _SCALE) == ("played", 6)        # 4.7 games expected
      and ta.window_state({2: 6, 20: 600}, 7, 10, _SCALE) == ("played", 6)    # ten days of record
      and ta.window_state({2: 6, 20: 600}, 7, 60, None) == ("played", 6)
      and ta.WINDOW_MIN_EXPECTED == 10.0 and ta.WINDOW_MIN_PREVIOUS == 14)
check("games before the previous days are not counted on either side",
      ta.window_state({1: 30, 70: 6000}, 7, 60, _SCALE) == ("new", 30))
check("a span is its days, both ends counted",
      ta._span_days("2026-08-14", "2026-08-20") == 7 and ta._span_days("2026-08-20", "2026-08-20") == 1
      and ta._span_days(None, "2026-08-20") is None and ta._span_days("x", "y") is None)

_pool_keys = [c.key for c in ta._counter_candidates()]
_wk = {a: next(k for k in _pool_keys if k.startswith(a)) for a in ("hog", "golem", "xbow", "lava")}


def _days(spans):
    out = {}
    for lo, hi, n in spans:
        for a in range(lo, hi):
            out[a] = n
    return out


# Hog and X-Bow: ten games a day for ninety days. Golem: heavy a fortnight ago,
# nearly gone this week. Lava: not played for a month.
_ACT = {_wk["hog"]: _days([(0, 90, 10)]), _wk["xbow"]: _days([(0, 90, 10)]),
        _wk["golem"]: _days([(0, 6, 2), (8, 30, 20), (30, 90, 10)]),
        _wk["lava"]: _days([(30, 90, 10)])}
# The index module itself, with only its play-by-day reader replaced: the
# rest of the engine reads the real one, as it does in production.
_saved_win = (dix.activity, ta._today)
check("the engine reads the duel index module", ta._duel_index is dix)
dix.activity = lambda: {"day": "20261011", "games": _ACT}
ta._today = lambda: __import__("datetime").date(2026, 10, 11)
try:
    _whole = {d["key"]: d["expectedWinRate"] for d in _bring["decks"]}
    check("before the window: the Golem list leads this opponent's list",
          _bring["decks"][0]["key"] == _wk["golem"] and _wk["hog"] in _whole, str(list(_whole)))
    ta._reset_counter_pool()
    _c7, _i7 = ta._window_pool(7)
    check("a pool knows when each of its lists was played, and through which day",
          ta.counter_pool_stats().get("activityDay") == "20261011"
          and ta.counter_pool_stats().get("activityLists") == 4
          and all(c.act is not None for c in ta._counter_candidates()))
    check("seven days: the list not played and the list the days before were heavier in are left out",
          sorted(c.key for c in _c7) == sorted([_wk["hog"], _wk["xbow"]])
          and _i7["applied"] and _i7["kept"] == 2 and _i7["pool"] == 4
          and _i7["notPlayed"] == 1 and _i7["fading"] == 1 and _i7["previousDays"] == 60,
          str(ta._window_public(_i7)))
    check("...each kept list with its games in the window and which way its share moved",
          _i7["states"] == {_wk["hog"]: ("rising", 70), _wk["xbow"]: ("rising", 70)}, str(_i7["states"]))
    check("...and what is published says what was done, without the per-list map",
          ta._window_public(_i7)["lists"] == {"rising": 2, "fading": 1, "absent": 1}
          and "states" not in ta._window_public(_i7) and ta._window_public(_i7)["day"] == "2026-10-11")
    _c30, _i30 = ta._window_pool(30)
    check("thirty days: the Golem list was played in THOSE days, so it is back; Lava still is not",
          sorted(c.key for c in _c30) == sorted([_wk["hog"], _wk["xbow"], _wk["golem"]])
          and _i30["states"][_wk["golem"]] == ("rising", 452), str(_i30.get("states")))
    check("a window is worked out once a pool", ta._window_pool(7)[0] is _c7)

    _b7 = ta.bring("#R1", "2026-08-14", "2026-08-20")
    check("the Deck Counter's list follows the window: seven days of range is a seven-day pool",
          _b7["pool"]["window"]["applied"] and _b7["pool"]["window"]["days"] == 7
          and _b7["pool"]["decks"] == 2, str(_b7["pool"]))
    check("...the old-meta list is not on it, however well it scored",
          _wk["golem"] not in [d["key"] for d in _b7["decks"]]
          and [d["key"] for d in _b7["decks"]] == [_wk["hog"]], str([d["key"][:10] for d in _b7["decks"]]))
    check("...THE FIGURE OF A LIST THAT STAYED IS THE SAME FIGURE",
          _b7["decks"][0]["expectedWinRate"] == _whole[_wk["hog"]],
          f"{_b7['decks'][0]['expectedWinRate']} {_whole[_wk['hog']]}")
    check("...and its row says how much it was played in those days",
          _b7["decks"][0].get("recent") == {"days": 7, "games": 70, "trend": "rising"},
          str(_b7["decks"][0].get("recent")))
    check("...the views are read off the same windowed pool",
          all(d["key"] != _wk["golem"] for g in _b7["byFamily"] for d in g["decks"]))
    _b30 = ta.bring("#R1", "2026-07-22", "2026-08-20")
    check("a thirty-day range brings the Golem list back, at the figure it had",
          _b30["decks"][0]["key"] == _wk["golem"]
          and _b30["decks"][0]["expectedWinRate"] == _whole[_wk["golem"]]
          and _b30["decks"][0]["recent"]["days"] == 30)
    check("no range is the default thirty days, the same days their history is read over",
          ta.bring("#R1")["pool"]["window"]["days"] == ta.DEFAULT_DAYS)

    _s7 = ta.analyze([], ["#R1"], days=7)
    try:
        __import__("json").dumps(_s7)
        __import__("json").dumps(ta.analyze(["#B1"], ["#R1"], days=7))
        _ser7 = True
    except TypeError as _e7:
        _ser7 = str(_e7)
    check("a scouting report and a match plan WITH ROWS are plain JSON (5.0: a local "
          "function once shadowed the folder's `spread`)", _ser7 is True, str(_ser7))
    check("...and the folder's archetype bars are still a list",
          isinstance(_s7["folders"][0]["spread"], list))
    check("a scouting report at seven days is the same pool and says so",
          _s7["pool"]["window"]["applied"] and _s7["pool"]["decks"] == 2
          and [d["key"] for d in _s7["folders"][0]["recommended"]] == [_wk["hog"]]
          and [d["key"] for d in _s7["overall"]["recommended"]] == [_wk["hog"]],
          str(_s7["pool"].get("window")))
    check("...the same decks the Deck Counter lists for that window",
          [d["key"] for d in _s7["folders"][0]["recommended"]] == [d["key"] for d in _b7["decks"]])
    _p7 = ta.analyze(["#B1"], ["#R1"], days=7)
    _fills = [d for d in _p7["folders"][0]["perPlayer"][0]["decks"] if not d.get("owner")]
    check("a match plan's fills come from the windowed pool too",
          _p7["pool"]["window"]["applied"] and _fills
          and all(d["key"] != _wk["golem"] for d in _fills)
          and all(d["key"] != _wk["golem"] for d in _p7["folders"][0]["recommended"]),
          str([d["key"][:10] for d in _fills]))
    _p30 = ta.analyze(["#B1"], ["#R1"], days=30)
    check("...and at thirty days the Golem list is offered again",
          _wk["golem"] in [d["key"] for d in _p30["folders"][0]["perPlayer"][0]["decks"]])

    # A TEAMMATE'S OWN DECK IS THEIRS, whatever the meta did with the list.
    _own_c = ta._Candidate({"cards": _wk["golem"].split(","), "winCondition": "golem"},
                           {"tag": "#B1", "name": "B1"}, ta._counter_candidates()[1].profile)
    check("the window never reads a teammate's own deck", _own_c.act is None)

    # WHEN IT IS NOT APPLIED the pool comes back whole, and it says why.
    _all = ta._counter_candidates()
    check("no window, no filter", ta._window_pool(None)[0] is _all
          and ta._window_pool(0)[1]["reason"] == "no_window")
    check("a window longer than the record is not applied (All Data)",
          ta._window_pool(4000)[0] is _all and ta._window_pool(4000)[1]["reason"] == "past_record"
          and ta._window_pool(4000)[1]["applied"] is False)
    ta._today = lambda: __import__("datetime").date(2026, 10, 15)
    check("a play-by-day table four days old is not applied",
          ta._window_pool(7)[0] is _all and ta._window_pool(7)[1]["reason"] == "stale"
          and ta.WINDOW_STALE_DAYS == 3)
    ta._today = lambda: __import__("datetime").date(2026, 10, 14)
    check("...three days old still is", ta._window_pool(7)[1]["applied"])
    ta._today = lambda: __import__("datetime").date(2026, 10, 11)

    # A list the build did not cover is UNKNOWN, which is not "not played".
    _saved_act = dict(_ACT)
    del _ACT[_wk["lava"]]
    ta._reset_counter_pool()
    _cu, _iu = ta._window_pool(7)
    check("a list the build did not cover is kept, with nothing claimed about it",
          _wk["lava"] in [c.key for c in _cu] and _wk["lava"] not in _iu["states"]
          and ta._window_public(_iu)["lists"].get("unknown") == 1, str(ta._window_public(_iu)))
    _ACT.update(_saved_act)

    # A window that would leave a handful of lists is a fault, not a filter.
    _ACT[_wk["hog"]] = _days([(30, 90, 10)])
    _ACT[_wk["xbow"]] = _days([(30, 90, 10)])
    _ACT[_wk["golem"]] = _days([(30, 90, 10)])
    ta._reset_counter_pool()
    _ct, _it = ta._window_pool(7)
    check("a window that would keep under a quarter of the pool is not applied",
          len(_ct) == 4 and _it["reason"] == "thin" and not _it["applied"] and not _it["states"]
          and ta.WINDOW_MIN_KEEP == 0.25, str(ta._window_public(_it)))
    _ACT.update(_saved_act)

    # An index from before the table, and one that fails.
    dix.activity = lambda: None
    ta._reset_counter_pool()
    _cn, _in = ta._window_pool(7)
    check("an index with no play-by-day table: the whole pool, as before, and it says so",
          len(_cn) == 4 and _in["reason"] == "no_activity" and _in["kept"] == 4)
    check("...and the list is the one from before the window existed",
          [d["key"] for d in ta.bring("#R1", "2026-08-14", "2026-08-20")["decks"]]
          == [d["key"] for d in _bring["decks"]])
    dix.activity = lambda: (_ for _ in ()).throw(RuntimeError("index gone"))
    ta._reset_counter_pool()
    _saved_err = sys.stderr
    sys.stderr = __import__("io").StringIO()
    try:
        _cf, _if = ta._window_pool(7)
    finally:
        sys.stderr = _saved_err
    check("a failing read costs the window and nothing else",
          len(_cf) == 4 and _if["reason"] == "no_activity")
finally:
    dix.activity, ta._today = _saved_win
    ta._reset_counter_pool()

# THE CARD VIEW: the manual names the cards, the rated pool ranks the decks.
import card_counters as _ccx  # noqa: E402

_cvs = [cards(f"cv{i}") for i in range(8)]
for _i, _cs in enumerate(_cvs):
    _cs[0] = "ronin" if _i < 6 else f"plain-{_i}"          # six lists hold Ronin
_card_rows = [
    {"key": _k(cs), "cards": cs, "archetype": f"a{i}", "name": f"deck {i}",
     "expectedWinRate": 70.0 - i if i < 6 else 40.0, "recommendationScore": 70.0 - i,
     "vs": {"hog": 70.0 - i}, "art": {}}
    for i, cs in enumerate(_cvs)
]
_their = [{"cards": ["pekka", "mega-knight", "c", "d", "e", "f", "g", "h"], "likelihood": 1.0}]
_saved_cc = (_ccx.ROLES, _ccx.BEATS)
_ccx.ROLES = {"ronin": {"counters": ["pekka", "mega-knight"]}, "pekka": {}, "mega-knight": {}}
_ccx.BEATS = _ccx._relations(_ccx.ROLES)
try:
    _view = ta._by_card(_card_rows, _their, lambda rows: rows)
    check("their cards are listed with the share of their games each is in",
          _view and _view["theirCards"][0]["share"] == 1.0)
    _ronin = next((c for c in _view["cards"] if c["card"] == "ronin"), None)
    check("a card that answers what they play is searched", _ronin is not None, str(_view["cards"]))
    check("...its decks ranked by the measured figure, three at most",
          _ronin and [d["expectedWinRate"] for d in _ronin["decks"]] == [70.0, 69.0, 68.0])
    check("...with the cards of theirs it answers",
          _ronin and {a["card"] for a in _ronin["answers"]} == {"pekka", "mega-knight"})
    check("...and a lift that is a difference of measured rates",
          _ronin and abs(_ronin["lift"] - round((sum(70.0 - i for i in range(6)) / 6)
                                                 - (sum(r["expectedWinRate"] for r in _card_rows) / 8), 1)) < 1e-9,
          str(_ronin and _ronin["lift"]))
    check("a card the manual has no relation for is not listed, however its decks do",
          all(c["card"] == "ronin" for c in _view["cards"]))
    # Three lists hold it and do far better than the two that do not — a real
    # lift, and still too few lists to call the CARD the reason.
    _few = ta._by_card(_card_rows[:3] + _card_rows[6:], _their, lambda rows: rows)
    check("a card in too few lists is not called a counter", _few["cards"] == [])
    _flat = [dict(r, expectedWinRate=50.0) for r in _card_rows]
    check("a card whose decks do no better than the pool is not listed, whatever the manual says",
          ta._by_card(_flat, _their, lambda rows: rows)["cards"] == [])
finally:
    _ccx.ROLES, _ccx.BEATS = _saved_cc
ta.cd.player_report, ta.cd.coverage = _saved_report, _saved_cov
ta._pdecks.played = _saved_played
dcx.deck_profile = fake_deck_profile
ta.dcx._snap = lambda: None
ta._SCOUT_POOL = None
ta._reset_counter_pool()


ta._competitive_pool = _saved_cp


print(NL + "5.0: the pool is what the CRL group brings, and the window's meta")
import datetime as _dt5  # noqa: E402

CR1, CR2, CR3 = cards("cra"), cards("crb"), cards("crc")     # lists the group brought
CR4, CR5 = cards("crd"), cards("cre")                         # one player's short runs
CR6 = cards("crf")                                            # one player's staple
ME1, ME2, ME3 = cards("mea"), cards("meb"), cards("mec")     # vetted lists
ME4 = cards("med")                                           # a less played Hog list
SH5 = list(SHORT)                                            # cannot fill three slots
_gw_calls = []


def _gw5(tags, since, until):
    _gw_calls.append((tuple(sorted(tags)), since, until))
    return {_k(CR1): [5, 3, 2], _k(CR2): [2, 1, 2], _k(CR3): [1, 1, 1],
            _k(CR4): [3, 2, 1], _k(CR5): [5, 4, 1], _k(CR6): [20, 12, 1],
            _k(ME1): [4, 3, 2], _k(SH5): [9, 5, 3]}


# Play by day, ages counted back from 14 October. ME1 and ME2 are played now,
# ME3 was heavy before the window and is nearly gone (fading).
_ACT5 = {_k(ME1): {0: 60, 3: 60, 20: 300}, _k(ME2): {1: 40, 5: 40, 20: 400},
         _k(ME3): {2: 3, 4: 3, 20: 3000}, _k(ME4): {0: 30, 2: 30}}
_fake5 = types.SimpleNamespace(
    group_window=_gw5,
    activity=lambda: {"day": "20261014", "games": _ACT5},
    status=lambda: {"buildId": "b5"},
    available=lambda: True,
)
_seeds5 = {"golem": [{"cards": list(ME1), "games": 400, "archetypes": {"xbow": {
               "wins": 60, "losses": 40, "games": 100, "winRate": 60.0}}}],
           "hog": [{"cards": list(ME2), "games": 300, "archetypes": {}},
                   {"cards": list(ME3), "games": 300, "archetypes": {}},
                   {"cards": list(ME4), "games": 300, "archetypes": {}}]}
_saved_top = ta._top
ta._top = None   # the 6.0 meta half; the top-1000 half is tested on its own below
_saved5 = (ta._duel_index, ta._load_cohorts, ta.DUEL_POOL_COHORT, ta.dcx.seeds,
           ta._set_field_rates, ta._today, ta.META_LISTS, ta.CRL_MIN_GAMES,
           ta._COMP_CACHE["by"], ta._COMP_CACHE["building"],
           ta.META_PER_FAMILY, ta.META_MIN_GAMES)
ta._duel_index = _fake5
ta._load_cohorts = lambda: {"crl": {"#TOP1", "#TOP2"}}
ta.DUEL_POOL_COHORT = "crl"
ta.dcx.seeds = lambda: _seeds5
ta._set_field_rates = lambda cands: 0
ta._today = lambda: _dt5.date(2026, 10, 14)
ta._COMP_CACHE["by"], ta._COMP_CACHE["building"] = {}, set()
try:
    check("a window is held to 7..90 days, 30 when none is asked",
          [ta.pool_days(d) for d in (None, 0, 3, 7, 15, 30, 90, 4000)]
          == [30, 30, 7, 7, 15, 30, 90, 90] and ta.POOL_DEFAULT_DAYS == 30)
    p7, i7 = ta._competitive_pool(7)
    keys7 = {c.key: c for c in p7}
    check("the group's lists of the window are read, for its tags, between the window's days",
          _gw_calls and _gw_calls[-1] == (("#TOP1", "#TOP2"), "20261008", "20261015"),
          str(_gw_calls[-1:]))
    check("a list the group brought twice or more is in the pool, once is not",
          _k(CR1) in keys7 and _k(CR2) in keys7 and _k(CR3) not in keys7
          and ta.CRL_MIN_GAMES == 2, str(sorted(keys7)))
    # 6.0: ONE PLAYER'S SHORT RUN IS NOT A LIST TO SUGGEST. 378 of 506 CRL
    # lists in the live pool were one player's, 145 of them twice, and the
    # best of each win condition was the luckiest of them (2026-10-23).
    check("one player's list from a short run is not in (6.0)",
          _k(CR5) not in keys7 and _k(CR4) not in keys7, str(sorted(keys7)))
    check("...two of the group's from two games is, and one player's staple is",
          _k(CR2) in keys7 and _k(CR6) in keys7
          and ta.CRL_MIN_PILOTS == 2 and ta.CRL_SOLO_GAMES == 20, str(sorted(keys7)))
    check("the rule is a staple: pilots, else games",
          ta._crl_proven([2, 1, 2]) and ta._crl_proven([20, 3, 1])
          and not ta._crl_proven([19, 9, 1]) and not ta._crl_proven([3, 3]))
    check("a list that cannot fill all three special slots is not, and is counted",
          _k(SH5) not in keys7 and i7["slotGaps"] == 1, str(i7.get("slotGaps")))
    check("the window's played vetted lists are in it; one fading out of it is not",
          _k(ME1) in keys7 and _k(ME2) in keys7 and _k(ME3) not in keys7, str(sorted(keys7)))
    check("a list the group brought is labelled crl, with the group's record on it",
          keys7[_k(CR1)].origin == "crl" and keys7[_k(CR1)].crl == [5, 3, 2]
          and keys7[_k(ME1)].origin == "crl" and keys7[_k(ME1)].meta_rank == 1,
          str((keys7[_k(CR1)].origin, keys7[_k(CR1)].crl, keys7[_k(ME1)].meta_rank)))
    check("a meta list nobody of the group brought is labelled meta, ranked by its play",
          keys7[_k(ME2)].origin == "meta" and keys7[_k(ME2)].crl is None
          and keys7[_k(ME2)].meta_rank == 2, str((keys7[_k(ME2)].origin, keys7[_k(ME2)].meta_rank)))
    check("a seed keeps the seed's own records; a list outside the seeds reads its own",
          isinstance(keys7[_k(ME1)].profile, ta._SeedProfile)
          and isinstance(keys7[_k(CR1)].profile, ta._ListProfile))
    check("the group's lists lead the pool, most brought first",
          [c.key for c in p7][:3] == [_k(CR6), _k(CR1), _k(ME1)], str([c.key for c in p7]))
    check("the pool says what it holds, and over which days",
          i7["days"] == 7 and i7["from"] == "2026-10-08" and i7["to"] == "2026-10-14"
          and i7["group"] == "crl" and i7["crlLists"] == 4 and i7["metaLists"] == 3
          and i7["crlGames"] == 31 and i7["pool"] == 6 and i7["crlSkipped"] == 3
          and i7["topLists"] == 0 and i7["top"]["reason"] in ("no_file", "no_module"),
          str(ta._pool_public(i7)))
    check("...and a meta list's play in the window rides on its row (`states`)",
          i7["states"].get(_k(ME1))[1] == 120 and "states" not in ta._pool_public(i7),
          str(i7["states"].get(_k(ME1))))
    # 6.0: THE META OF EVERY WIN CONDITION, not the most played overall.
    check("the meta half is capped per win condition", ta.META_PER_FAMILY == 8
          and ta.META_MIN_GAMES == 50)
    check("...so a less played Hog list is in beside the most played", _k(ME4) in keys7
          and keys7[_k(ME4)].origin == "meta", str(sorted(keys7)))
    ta.META_PER_FAMILY = 1
    ta._COMP_CACHE["by"] = {}
    p1, _i1 = ta._competitive_pool(7)
    check("...the most played of each first",
          {c.key for c in p1 if c.meta_rank} == {_k(ME1), _k(ME2)},
          str([(c.key, c.meta_rank) for c in p1]))
    ta.META_PER_FAMILY = _saved5[10]
    ta.META_MIN_GAMES = 100
    ta._COMP_CACHE["by"] = {}
    p1, _i1 = ta._competitive_pool(7)
    check("...and a list played under META_MIN_GAMES in the window is not",
          {c.key for c in p1 if c.meta_rank} == {_k(ME1)},
          str([(c.key, c.meta_rank) for c in p1]))
    ta.META_MIN_GAMES = _saved5[11]
    ta._COMP_CACHE["by"] = {}

    # A REPLAY reads no game after the day it stands on.
    _gw_calls.clear()
    past, ipast = ta._competitive_pool(7, until=_dt5.date(2026, 10, 1))
    check("a window anchored in the past reads the group's games before it",
          _gw_calls[-1][1:] == ("20260925", "20261002"), str(_gw_calls[-1:]))
    check("...and the play by day shifted back to it (ME1's games of 14 Oct are after it)",
          ipast["to"] == "2026-10-01" and _k(ME1) not in {c.key for c in past if c.origin == "meta"},
          str([(c.key, c.origin) for c in past]))

    # KEPT, and rebuilt beside the one in hand when its sources move.
    ta._COMP_CACHE["by"] = {}
    a5 = ta._competitive_pool(15)
    check("a window's pool is kept", ta._competitive_pool(15) is a5)
    check("another window is another pool", ta._competitive_pool(30) is not a5)
    _key0 = ta._counter_key
    _built = []
    _real_build = ta._build_competitive_pool

    def _slow_build(d, last):
        _built.append(d)
        return _real_build(d, last)

    ta._build_competitive_pool = _slow_build
    ta._counter_key = lambda: ("moved",)
    try:
        stale = ta._competitive_pool(15)
        check("when its sources move the pool in hand still answers at once", stale is a5)
        for _ in range(200):
            if ta._COMP_CACHE["by"].get((15, "2026-10-14"), (None,))[0] == ("moved",):
                break
            __import__("time").sleep(0.01)
        fresh = ta._competitive_pool(15)
        check("...while the next is built beside it, once, and then answers",
              fresh is not a5 and _built == [15] and fresh[1]["days"] == 15, str(_built))
    finally:
        ta._counter_key = _key0
        ta._build_competitive_pool = _real_build

    # THE WIN CONDITION, as `player_skill` names one.
    _real_ci = ta.dx.card_info
    _wc_info = {"hog-rider": {"is_win_condition": True, "elixir": 4},
                "golem": {"is_win_condition": True, "elixir": 8},
                "skeletons": {"elixir": 1}}
    ta.dx.card_info = lambda c: _wc_info.get(c, {})
    ta._WINCON_CACHE.clear()
    try:
        check("a deck's win condition is its priciest win-condition card",
              ta._wincon(["skeletons", "hog-rider", "golem"]) == "golem"
              and ta._wincon(["skeletons"]) is None and ta._wincon([]) is None)
        mate = {"decks": [{"cards": ["hog-rider"] + cards("h")[:7], "matches": 30},
                          {"cards": ["golem"] + cards("g")[:7], "matches": 10},
                          {"cards": ["skeletons"] + cards("s")[:7], "matches": 60},
                          {"cards": ["golem"] + cards("t")[:7], "matches": 0}]}
        check("a teammate's win conditions are shares of their games with one",
              ta._wincon_shares(mate) == {"hog-rider": 0.75, "golem": 0.25},
              str(ta._wincon_shares(mate)))
    finally:
        ta.dx.card_info = _real_ci
        ta._WINCON_CACHE.clear()
    _real_ps = ta._ps
    ta._ps = types.SimpleNamespace(
        on=lambda: True, weights=lambda: (20.0, 2.0),
        records=lambda tag: {"golem": [30, 20, 15.0]} if tag == "#S" else {},
        skill=__import__("player_skill").skill)
    try:
        check("a teammate's record with a win condition is a shift in log-odds",
              ta._skill_shifts("#S") == {"golem": 2.0 * (20 - 15.0) / (30 + 20.0)}
              and ta._skill_shifts("#nobody") == {}, str(ta._skill_shifts("#S")))
        ta._ps = types.SimpleNamespace(on=lambda: False)
        check("...and none when the table's own holdout did not gain", ta._skill_shifts("#S") == {})
        ta._ps = None
        check("...or there is no table", ta._skill_shifts("#S") == {})
    finally:
        ta._ps = _real_ps

    # 6.1: THE TOP 1,000 PLAYERS' LISTS ARE THE META HALF when there is a file.
    TP1, TP2, TP3 = cards("tpa"), cards("tpb"), cards("tpc")
    _topwin = {_k(TP1): [40, 900, 480, "hog"], _k(TP2): [2, 300, 150, "hog"],
               _k(TP3): [3, 20, 10, "golem"], _k(ME1): [5, 60, 33, "golem"],
               _k(CR1): [4, 50, 30, ""]}
    _top_calls = []
    ta._top = types.SimpleNamespace(
        PATH="/nonexistent-top-decks",
        load=lambda: {"season": "live", "players": 1000},
        window=lambda data, days, last: (_top_calls.append((days, last)), _topwin)[1])
    ta._COMP_CACHE["by"] = {}
    pt, it = ta._competitive_pool(7)
    kt = {c.key: c for c in pt}
    check("with the top-1000 file, its lists are the meta half (6.0's meta lists are not read)",
          _k(TP1) in kt and _k(ME2) not in kt and _k(ME4) not in kt and it["metaLists"] == 0,
          str(sorted(kt)))
    check("...read over the window asked for, ending on its last day",
          _top_calls[-1] == (7, _dt5.date(2026, 10, 14)), str(_top_calls[-1:]))
    check("a list fewer than three top players used is not in, however much one played it",
          _k(TP2) not in kt and ta.TOP_MIN_PLAYERS == 3)
    check("...nor one three used for fewer than thirty games", _k(TP3) not in kt and ta.TOP_MIN_GAMES == 30)
    check("a top list is labelled top and carries its use; one the CRL group brought too keeps both",
          kt[_k(TP1)].origin == "top" and kt[_k(TP1)].top == [40, 900, 480]
          and kt[_k(CR1)].origin == "top" and kt[_k(CR1)].crl == [5, 3, 2], str(kt[_k(CR1)].origin))
    check("the most used lead the pool", pt[0].key == _k(TP1), pt[0].key)
    check("the pool says how many top lists it holds", it["topLists"] == 3 and it["top"]["season"] == "live",
          str(ta._pool_public(it)))
    check("the frequency bonus: half a point a doubling of its users, at most three",
          ta.use_bonus(kt[_k(TP1)]) == round(0.5 * __import__("math").log2(41), 2)
          and ta.use_bonus(types.SimpleNamespace(top=[100000, 1, 1], crl=None)) == ta.TOP_USE_CAP == 3.0
          and ta.use_bonus(types.SimpleNamespace(top=None, crl=[5, 3, 2])) == round(0.5 * __import__("math").log2(3), 2)
          and ta.use_bonus(types.SimpleNamespace(top=None, crl=None)) == 0.0)
    ta._top = None
    ta._COMP_CACHE["by"] = {}

    # NO GROUP: the meta half alone, said.
    ta._COMP_CACHE["by"] = {}
    ta._load_cohorts = lambda: {}
    nog, inog = ta._competitive_pool(7)
    check("with no group the pool is the window's meta, and says there was none",
          inog["group"] is None and inog["crlLists"] == 0 and nog
          and all(c.origin == "meta" for c in nog), str(ta._pool_public(inog)))
    ta._COMP_CACHE["by"] = {}
    _fake5.activity = lambda: None
    empty, iempty = ta._competitive_pool(7)
    check("with neither, an empty pool that says why", empty == [] and iempty["reason"] == "empty",
          str(ta._pool_public(iempty)))
finally:
    (ta._duel_index, ta._load_cohorts, ta.DUEL_POOL_COHORT, ta.dcx.seeds,
     ta._set_field_rates, ta._today, ta.META_LISTS, ta.CRL_MIN_GAMES,
     ta._COMP_CACHE["by"], ta._COMP_CACHE["building"],
     ta.META_PER_FAMILY, ta.META_MIN_GAMES) = _saved5
    ta._top = _saved_top
    ta._COMP_CACHE["by"], ta._COMP_CACHE["building"] = {}, set()


print(NL + "5.1: 'vs the field' is the rated figure, never a record with no games")


class _NoLadder:
    overall = {"winRate": 0.0, "games": 0}

    def against(self, other, snap):
        return None


def _dressed(card):
    base = {"key": card.key, "cards": list(card.cards), "matchups": [], "threatCovered": 1.0,
            "evidenceStrength": 1.0, "confidence": "known", "expectedWinRate": 60.0,
            "matchupValue": 60.0, "playerFit": None}
    return ta._dress(base, card, [])


_c51 = ta._Candidate({"cards": list(HOG), "winCondition": "hog"}, None, _NoLadder())
_o51 = _dressed(_c51)
check("a list with no ladder games prints no 'vs the field' (it printed 0.0% +59.5, live)",
      _o51.get("overallWinRate") is None, str(_o51.get("overallWinRate")))
_c51.field = 55.46
check("...a list with a rated figure against the field prints that",
      _dressed(_c51)["overallWinRate"] == 55.5, str(_dressed(_c51).get("overallWinRate")))
_NoLadder.overall = {"winRate": 51.0, "games": 40}
_c51.field = None
check("...and a ladder record with games behind it, when there is no rated figure",
      _dressed(_c51)["overallWinRate"] == 51.0 and ta.OVERALL_MIN_GAMES == 20)


print(NL + "the fused rate")
import matchup_fusion as mf  # noqa: E402

FA = cards("fa")                                  # a candidate the cells cover
FB = cards("fb")                                  # a teammate's own list, outside them
T1 = cards("tx")                                  # a threat hub
T2 = [c if c != "tx-7" else "ty-7" for c in T1]   # another list of the SAME archetype
T3 = cards("tz")                                  # a threat nobody hubs
PROFILES[_k(FA)] = {"xbow": {"winRate": 55.0, "games": 100, "wins": 55, "losses": 45,
                             "tier": "high"}}
PROFILES[_k(FB)] = {"xbow": {"winRate": 50.0, "games": 40, "wins": 20, "losses": 20,
                             "tier": "high"}}
_fx_hubs = {_k(FA), _k(T1), _k(T2)}
_fx_cells = {_k(T1): {_k(FA): (40.0, 30.0, 20.0, 16.0, 5.0, 4.0, 0.0, 0.0)},
             _k(T2): {_k(FA): (40.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)}}
_fx_index = types.SimpleNamespace(
    is_version_hub=lambda cs: _k(cs) in _fx_hubs,
    version_cells=lambda cs: _fx_cells.get(_k(cs)),
    _subs=dix._subs,
    status=lambda: {"versionCells": 2},
)
_saved = (ta._duel_index, ta._fusion, ta._ladder_history)
ta._duel_index = _fx_index
ta._ladder_history = (lambda key: {_k(T1): [10, 9], _k(T3): [6, 1], _k(GOLEM): [50, 25]}
                      if key == _k(FB) else None)
try:
    fx = ta._FusionContext(None, None)
    fctx = types.SimpleNamespace(fx=fx)
    card_a = ta._Candidate({"cards": FA, "winCondition": "hog", "name": "A"}, None,
                           ta._DeckProfile(FA, "hog"))
    card_b = ta._Candidate({"cards": FB, "winCondition": "hog", "name": "B", "matches": 30,
                            "wins": 15, "winRate": 50.0},
                           {"tag": "#B1", "name": "Ravi"}, ta._DeckProfile(FB, "hog"))
    _fx_threats = [
        {"key": "t1", "cards": T1, "archetype": "xbow", "likelihood": 0.4,
         "evidence": ts.OBSERVED, "name": "X-Bow"},
        {"key": "t2", "cards": T2, "archetype": "xbow", "likelihood": 0.4,
         "evidence": ts.OBSERVED, "name": "X-Bow"},
        {"key": "t3", "cards": T3, "archetype": "xbow", "likelihood": 0.2,
         "evidence": ts.OBSERVED, "name": "X-Bow"},
    ]
    fx.prepare([card_a, card_b], _fx_threats)
    row_a = ta._score(card_a, _fx_threats, None, fctx)
    by = {m["threat"]: m for m in row_a["matchups"]}
    want1 = mf.fused(None, arch_ladder=(100, 55), fam_ladder=(40, 30), fam_duel=(5, 4.0),
                     ver_ladder=(20, 16), ver_duel=(0, 0.0))
    check("a hub candidate against a threat hub reads the version cells",
          by["t1"]["winRate"] == want1["winRate"] and by["t1"]["source"] == "version",
          f"{by['t1']} want {want1}")
    check("two lists of ONE archetype now score differently",
          by["t1"]["winRate"] != by["t2"]["winRate"], f"{by['t1']['winRate']} {by['t2']['winRate']}")
    want3 = mf.fused(None, arch_ladder=(100, 55))
    check("a threat no hub covers is scored at the archetype levels only",
          by["t3"]["winRate"] == want3["winRate"] and by["t3"]["source"] == "deck", str(by["t3"]))
    check("every fused row carries the site's own confidence tier",
          by["t1"]["tier"] in ("high", "medium", "low", None) and "interval" in by["t1"])
    row_b = ta._score(card_b, _fx_threats, None, fctx)
    byb = {m["threat"]: m for m in row_b["matchups"]}
    want_b1 = mf.fused(None, arch_ladder=(40, 20), fam_ladder=(10, 9))
    check("a teammate's own list reads its family level off its own history",
          byb["t1"]["winRate"] == want_b1["winRate"], f"{byb['t1']} want {want_b1}")
    want_b3 = mf.fused(None, arch_ladder=(40, 20), fam_ladder=(6, 1))
    check("and it works against a threat no hub covers too",
          byb["t3"]["winRate"] == want_b3["winRate"], f"{byb['t3']} want {want_b3}")
    # T2 is T1 with one card changed, so T1 IS in T2's family: games against
    # the neighbouring list are evidence about this one — the version level's
    # whole point. (Its Golem games, in no threat's family, count nowhere: the
    # t1 figure above is exactly 10 games.)
    check("the list one card off a threat is in that threat's family",
          byb["t2"]["winRate"] == want_b1["winRate"], f"{byb['t2']} want {want_b1}")
    check("the context counts which level each rate came off",
          fx.stats["version"] >= 1 and fx.stats["deck"] >= 1, str(fx.stats))
    check("a rate asked twice is computed once",
          ta._score(card_a, _fx_threats, None, fctx)["matchups"][0]["winRate"] == by["t1"]["winRate"])

    # THE SWITCH-OFF PATH: no module, no fused rate — the ladder rung, exactly.
    ta._fusion = None
    off = ta._FusionContext(None, None)
    check("with the module missing the context is off", not off.on)
    row_off = ta._score(card_a, _fx_threats, None, types.SimpleNamespace(fx=off))
    check("and every rate is the ladder rung it always was",
          [m["winRate"] for m in row_off["matchups"]] == [55.0, 55.0, 55.0]
          and all(m["source"] == "deck" for m in row_off["matchups"]),
          str([m["winRate"] for m in row_off["matchups"]]))
    row_none = ta._score(card_a, _fx_threats, None)
    check("as it is with no context at all",
          [m["winRate"] for m in row_none["matchups"]] == [55.0, 55.0, 55.0])
finally:
    ta._duel_index, ta._fusion, ta._ladder_history = _saved

check("the report says which brain rated it",
      (scout_rep.get("fusion") or {}).get("brain") == mf.FUSION_VERSION
      and "sources" in scout_rep["fusion"], str(scout_rep.get("fusion")))

print(f"{NL}{PASS} passed, {FAIL} failed{NL}")
sys.exit(1 if FAIL else 0)
