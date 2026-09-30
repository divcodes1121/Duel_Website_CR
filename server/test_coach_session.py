"""test_coach_session.py — today's session: the part of the plan that changes daily.

    python server/test_coach_session.py

Literals only; no database is opened and `build()` is not called. What is
covered is every rule that decides what a player works on today.
"""

from __future__ import annotations

import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coach_session as cs  # noqa: E402
import duel_brain  # noqa: E402

PASS = 0
FAIL = 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


def weak(arch, deficit, battles=40, rate=40.0):
    return {"archetype": arch, "name": arch.title(), "battles": battles,
            "winRate": rate, "deficit": deficit}


def rec(battles, wins, losses=None, name=None):
    return {"battles": battles, "wins": wins,
            "losses": battles - wins if losses is None else losses, "name": name or ""}


DAY = dt.date(2026, 9, 30)
DEFS = {"golem": weak("golem", 12.0), "mortar": weak("mortar", 9.0),
        "hog": weak("hog", 7.0), "miner": weak("miner", 2.0),
        "xbow": weak("xbow", -5.0)}


print("\nthe rotation walks their weakest matchups, one a day")
days = [DAY + dt.timedelta(days=i) for i in range(6)]
foci = [cs.focus(d, DEFS, {}, [], overall=55.0) for d in days]
arches = [f["archetype"] for f in foci]
check("three consecutive days are three different matchups", len(set(arches[:3])) == 3, arches)
check("it cycles back after ROTATION days", arches[0] == arches[3] and arches[1] == arches[4], arches)
check("only the ROTATION weakest take part", set(arches) == {"golem", "mortar", "hog"}, arches)
check("no day repeats the one before it", all(a != b for a, b in zip(arches, arches[1:])), arches)
idx = [f["rotation"]["index"] for f in foci]
check("it says it is a rotation, and which day of it",
      all(f["why"] == "rotation" and f["rotation"]["of"] == 3 for f in foci)
      and sorted(idx[:3]) == [1, 2, 3]
      and all(b == a % 3 + 1 for a, b in zip(idx, idx[1:])), idx)
check("it names tomorrow's matchup", foci[0]["rotation"]["next"] == foci[1]["name"])
check("a strength never enters the rotation", "xbow" not in arches)
check("the standing record rides along", foci[0]["record"]["battles"] == 40)

wobble = dict(DEFS, golem=weak("golem", 8.0), hog=weak("hog", 10.5))
check("a wobble in the deficits does not reorder the day",
      cs.focus(DAY, wobble, {}, [], overall=55.0)["archetype"] == arches[0])

other = dict(DEFS, other=weak("other", 30.0))
check("`other` is never a matchup to drill, however big its deficit",
      all(cs.focus(d, other, {}, [], overall=55.0)["archetype"] != "other" for d in days))


print("\nwhat beat them since yesterday takes the day — beyond their own rate")
f = cs.focus(DAY, DEFS, {"hog": rec(6, 1)}, [], overall=60.0)
check("1-5 against a known weakness takes the day", f["archetype"] == "hog" and f["why"] == "lost_recently", f)
check("it carries the counts and the excess", f["recent"] == {"battles": 6, "wins": 1, "losses": 5}
      and f["excessLosses"] == 2.6, f)
check("and no rotation", f["rotation"] is None)

f = cs.focus(DAY, DEFS, {"hog": rec(21, 9)}, [], overall=60.0)
check("9-12 over 21 is 3.6 losses more than a 60% player's usual: it takes the day",
      f["archetype"] == "hog" and f["why"] == "lost_recently" and f["excessLosses"] == 3.6, f)
f = cs.focus(DAY, DEFS, {"hog": rec(21, 12)}, [], overall=60.0)
check("winning more than losing is never a fresh loss", f["why"] == "rotation", f)
f = cs.focus(DAY, DEFS, {"hog": rec(2, 0)}, [], overall=60.0)
check("0-2 is an excess of 1.2, under the floor", f["why"] == "rotation", f)
f = cs.focus(DAY, DEFS, {"giant": rec(5, 1)}, [], overall=60.0)
check("a matchup they normally handle needs FRESH_ALONE (1-4 is 2.0)", f["why"] == "rotation", f)
f = cs.focus(DAY, DEFS, {"giant": rec(7, 1)}, [], overall=60.0)
check("1-6 against something they normally handle does take the day",
      f["archetype"] == "giant" and f["why"] == "lost_recently", f)
f = cs.focus(DAY, DEFS, {"other": rec(20, 2)}, [], overall=60.0)
check("`other` never takes the day on fresh losses either", f["archetype"] != "other", f)
f = cs.focus(DAY, DEFS, {"hog": rec(6, 1), "mortar": rec(10, 1)}, [], overall=60.0)
check("the biggest excess wins when two qualify", f["archetype"] == "mortar", f)
check("excess losses: 10 games at 60% expect 4", cs.excess_losses(rec(10, 3), 60.0) == 3.0)


print("\nno measured weakness: the field's archetypes take turns, labelled")
threats = [{"archetype": "hog", "likelihood": 0.3}, {"archetype": "hog", "likelihood": 0.1},
           {"archetype": "other", "likelihood": 0.35}, {"archetype": "golem", "likelihood": 0.15},
           {"archetype": "miner", "likelihood": 0.05}, {"archetype": "xbow", "likelihood": 0.05}]
f = cs.focus(DAY, {}, {}, threats, overall=50.0)
check("labelled as the field's rotation", f["why"] == "field_rotation", f)
fs = {cs.focus(d, {}, {}, threats)["archetype"] for d in days}
check("the field's three most-played, variants pooled, `other` excluded",
      fs == {"hog", "golem", "miner"} or fs == {"hog", "golem", "xbow"}, fs)
check("nothing at all is None, not an invented focus", cs.focus(DAY, {}, {}, []) is None)


print("\nthe practice deck: their cards, good against today, still good against the field")


def row(key, field, familiar):
    return {"key": key, "expectedWinRate": field, "affinity": {"familiar": familiar}}


RATES = {"a": 70.0, "b": 58.0, "c": 75.0, "d": 80.0, "e": None}
rv = lambda r: None if RATES.get(r["key"]) is None else {"winRate": RATES[r["key"]], "games": 100, "source": "deck"}
got = cs.practise([row("a", 60.0, True), row("b", 61.0, True), row("c", 57.5, True),
                   row("d", 64.0, False)], rv)
check("the best against the focus among their decks within the slack",
      got["row"]["key"] == "a" and got["source"] == "their-cards", got)
check("a familiar deck 3.5 points down the field is outside the slack (c not picked)",
      got["row"]["key"] != "c")
check("a stronger non-familiar deck does not beat a familiar one", got["row"]["key"] != "d")
check("the rate against the focus is published", got["vsFocus"] == {"winRate": 70.0, "games": 100, "basis": "deck"})
got = cs.practise([row("d", 64.0, False), row("b", 63.0, False)], rv)
check("nothing familiar: the field's, labelled", got["row"]["key"] == "d" and got["source"] == "field", got)
got = cs.practise([row("e", 64.0, True)], rv)
check("no rate against the focus is not a pick", got is None)
check("an empty pool is None", cs.practise([], rv) is None)


print("\nrising: measured climbs only")
move = {"basis": "measured", "rows": [
    {"deckHash": "a,b,c,d,e,f,g,h", "name": "Hog EQ", "winCondition": "hog", "rank": 2,
     "rankDelta": 7, "useRate": 2.0, "previousUseRate": 0.8, "useDelta": 1.2, "winRate": 55,
     "entered": False, "left": False},
    {"deckHash": "i", "name": "New", "winCondition": "miner", "rank": 10, "rankDelta": None,
     "useRate": 1.0, "previousUseRate": None, "useDelta": None, "entered": True, "left": False},
    {"deckHash": "j", "name": "Wobble", "winCondition": "golem", "rank": 5, "rankDelta": 1,
     "useRate": 1.05, "previousUseRate": 1.0, "useDelta": 0.05, "entered": False, "left": False},
    {"deckHash": "k", "name": "Faller", "winCondition": "xbow", "rank": 30, "rankDelta": -9,
     "useRate": 0.3, "previousUseRate": 0.9, "useDelta": -0.6, "entered": False, "left": False},
    {"deckHash": "l", "name": "Golem Night", "winCondition": "golem", "rank": 20, "rankDelta": 4,
     "useRate": 0.6, "previousUseRate": 0.4, "useDelta": 0.2, "entered": False, "left": False},
]}
r = cs.rising(move, {"golem"})
check("biggest climb first", [x["name"] for x in r] == ["Hog EQ", "Golem Night"], r)
check("an entry has no delta and is not a riser", all(x["name"] != "New" for x in r))
check("a 5% wobble is under the floor", all(x["name"] != "Wobble" for x in r))
check("a faller is not rising", all(x["name"] != "Faller" for x in r))
check("cards come from the deck hash", r[0]["cards"] == list("abcdefgh"))
check("a rising archetype they lose to is marked", r[1]["threatensYou"] and not r[0]["threatensYou"])
check("no measured movement, no risers",
      cs.rising({"basis": "none", "rows": move["rows"]}, set()) == [] and cs.rising(None, set()) == [])


print("\nthe duel answer: proven, their own first")
CARDS_OWN = [f"o{i}" for i in range(8)]
CARDS_POP = [f"p{i}" for i in range(8)]
PROVEN = {"exact": {"golem": [120, 90, 60.0]}, "near": {}}
UNPROVEN = {"exact": {"golem": [120, 50, 60.0]}, "near": {}}
own = [{"key": ",".join(sorted(CARDS_OWN)), "cards": CARDS_OWN, "archetype": "hog", "games": 9, "wins": 6}]
cat = [{"key": ",".join(sorted(CARDS_POP)), "cards": CARDS_POP, "archetype": "miner",
        "games": 400, "wins": 260, "players": 40, "records": PROVEN}]
a = cs.duel_answer("golem", own, lambda d: PROVEN, cat, set(), duel_brain)
check("their own proven duel deck leads", a and a["pick"] == "own" and a["cards"] == CARDS_OWN, a)
a = cs.duel_answer("golem", own, lambda d: UNPROVEN, cat, {"p1", "p2"}, duel_brain)
check("otherwise the population's proven deck", a and a["pick"] == "duel" and a["cards"] == CARDS_POP, a)
check("with its figures and how many of its cards they play",
      a["duel"]["winRate"] > 50 and a["duel"]["strong"] and a["known"] == 2, a)
weak_cat = [dict(cat[0], records=UNPROVEN)]
check("nothing proven is None — never a weak deck offered as proven",
      cs.duel_answer("golem", own, lambda d: UNPROVEN, weak_cat, set(), duel_brain) is None)


print("\nthe day")
check("an explicit day is used", cs.reference_day("2026-09-12") == dt.date(2026, 9, 12))
check("a malformed day falls back to today, never raises",
      cs.reference_day("12/09/2026") == dt.datetime.now(dt.timezone.utc).date())
check("no day is today, UTC", cs.reference_day(None) == dt.datetime.now(dt.timezone.utc).date())


print("\nnothing here calls a model")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "coach_session.py"),
           encoding="utf-8").read()
check("no ml import", "import ml" not in src and "from ml" not in src)
check("the OIE is not referenced", "predictor" not in src and "CLASH_OIE" not in src)
check("no network", "urlopen" not in src and "requests." not in src)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
