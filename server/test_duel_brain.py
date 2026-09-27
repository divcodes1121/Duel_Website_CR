"""duel_brain: the second brain's rules, against literals. No database.

    python server/test_duel_brain.py
"""
from __future__ import annotations

import ast
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import duel_brain as db  # noqa: E402

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


def near(a, b, tol=0.05):
    return a is not None and b is not None and abs(a - b) <= tol


def deck(*extra, base=("knight", "archers", "fireball", "the-log", "zap",
                       "musketeer", "ice-spirit")):
    """An 8-card list: seven shared cards plus one."""
    return list(base) + list(extra)


HOG = deck("hog-rider")
HOG2 = deck("cannon")              # 7 of 8 shared with HOG
MORTAR = ["mortar", "rascals", "cannon-cart", "goblins", "minions",
          "skeleton-barrel", "barbarian-barrel", "fireball"]
BAIT = ["goblin-barrel", "goblin-gang", "princess", "rocket", "knight",
        "inferno-tower", "ice-spirit", "the-log"]


print("\n-- Imports --")
tree = ast.parse(open(db.__file__, encoding="utf-8").read())
mods = set()
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        mods |= {a.name.split(".")[0] for a in node.names}
    elif isinstance(node, ast.ImportFrom):
        mods.add((node.module or "").split(".")[0])
check("the brain imports only the standard library",
      mods <= {"__future__", "math"}, str(mods))


K = db.DUEL_PRIOR_GAMES


def shrunk(adj_wins, games):
    """The figure the brain prints for one win condition, in percent."""
    return 100.0 * (adj_wins + K / 2) / (games + K)


print("\n-- The prior --")
r = db.rung({"exact": {"hog": [6, 6]}}, "hog")
check("a deck 6-0 does NOT print as certain: 30 games of 50/50 pull it in",
      near(r["winRate"], shrunk(6, 6), 0.05) and r["winRate"] < 60 and r["raw"] == 100.0, str(r))
r = db.rung({"exact": {"hog": [6, 0]}}, "hog")
check("and 0-6 does not print as hopeless", near(r["winRate"], shrunk(0, 6), 0.05) and r["winRate"] > 40)
r = db.rung({"exact": {"hog": [4000, 2400]}}, "hog")
check("with thousands of games the record speaks for itself", near(r["winRate"], 59.9, 0.1), str(r))
v6 = db.value({"hog": 1.0}, {"exact": {"hog": [6, 6]}})
v600 = db.value({"hog": 1.0}, {"exact": {"hog": [600, 600]}})
check("the bound never sits above the printed rate", v6["low"] <= v6["winRate"] <= v6["high"])
check("and it tightens with games", (v600["high"] - v600["low"]) < (v6["high"] - v6["low"]))


print("\n-- Pilot strength --")
check("no games rates 50%", db.pilot_rating(0, 0) == 0.5)
check("five duels all won rates 0.60, not 1.00", near(db.pilot_rating(5, 5), 0.6, 1e-9))
check("two hundred games rate close to their record",
      near(db.pilot_rating(160, 200), 170 / 220, 1e-9))
check("log5 of equal players is a coin flip, however strong",
      near(db.log5(0.8, 0.8), 0.5, 1e-9) and near(db.log5(0.3, 0.3), 0.5, 1e-9))
check("log5 against an average player is the rating itself",
      near(db.log5(0.7, 0.5), 0.7, 1e-9))
check("and it is a probability that sums to one across the two sides",
      near(db.log5(0.7, 0.4) + db.log5(0.4, 0.7), 1.0, 1e-9))
r = db.rung({"exact": {"hog": [10, 10, 6.88]}}, "hog")
check("a record is judged against what the players predicted",
      near(r["adjusted"], 81.2, 0.05) and r["raw"] == 100.0, str(r))
check("and the printed figure is that, shrunk",
      near(r["winRate"], shrunk(5 + 10 - 6.88, 10), 0.05), str(r))
r = db.rung({"exact": {"hog": [10, 3, 1.0]}}, "hog")
check("a deck beating a prediction of 1 in 10 by winning 3 is ABOVE 50",
      near(r["adjusted"], 70.0, 0.05) and r["winRate"] > 50 and r["raw"] == 30.0, str(r))
r = db.rung({"exact": {"hog": [10, 10, 0.0]}}, "hog")
check("the adjusted record is clamped to the games played",
      r["adjusted"] == 100.0 and near(r["winRate"], shrunk(10, 10), 0.05), str(r))
r = db.rung({"exact": {"hog": [10, 6]}}, "hog")
check("a record with no prediction is taken at 50/50 and adjusts nothing",
      r["adjusted"] == r["raw"] == 60.0 and r["expected"] == 5.0, str(r))


print("\n-- The projection --")
threats = [
    {"archetype": "hog", "likelihood": 0.1},
    {"archetype": "hog", "likelihood": 0.1},
    {"archetype": "hog", "likelihood": 0.1},
    {"archetype": "hog", "likelihood": 0.1},
    {"archetype": "bait", "likelihood": 0.6},
]
c = db.collapse(threats)
check("four Hog variants are ONE win condition", set(c) == {"hog", "bait"} and near(c["hog"], 0.4))
p, w = db.duel_projection(threats, None)
check("no duels: the first brain's projection, weight 0",
      w == 0.0 and near(p["hog"], 0.4) and near(p["bait"], 0.6))
p, w = db.duel_projection(threats, {"mortar": 5})
check("under the floor their duels do not count", w == 0.0 and "mortar" not in p)
p, w = db.duel_projection(threats, {"mortar": 20})
check("at DUEL_THREAT_K games their duels carry half", near(w, 0.5, 0.001), str(w))
check("and a win condition only their duels show enters the projection",
      near(p["mortar"], 0.5) and near(p["hog"], 0.2) and near(p["bait"], 0.3), str(p))
check("the blend still sums to one", near(sum(p.values()), 1.0, 1e-9))
p, w = db.duel_projection(threats, {"mortar": 100000})
check("however many duels, capped at DUEL_THREAT_MAX", w == db.DUEL_THREAT_MAX, str(w))
p, w = db.duel_projection([], {"mortar": 30, "hog": 10})
check("no first-brain projection at all: their duels are the whole of it",
      w == 1.0 and near(p["mortar"], 0.75) and near(p["hog"], 0.25), str(p))


print("\n-- Rungs --")
rec = {"exact": {"hog": [6, 4], "bait": [5, 5]}, "near": {"bait": [8, 5], "golem": [7, 7]}}
r = db.rung(rec, "hog")
check("exact at its floor answers", r and r["source"] == "exact" and r["games"] == 6)
r = db.rung(rec, "bait")
check("exact under its floor falls to near", r and r["source"] == "near" and r["games"] == 8)
check("near under its floor answers nothing", db.rung(rec, "golem") is None)
check("an absent win condition answers nothing", db.rung(rec, "xbow") is None)
check("no records at all answers nothing", db.rung(None, "hog") is None)
check("an ARCHETYPE-LEVEL rung is not evidence about a deck",
      db.rung({"wincon": {"hog": [5000, 3000]}}, "hog") is None)


print("\n-- Value --")
proj = {"hog": 0.5, "bait": 0.3, "mortar": 0.2}
rec = {"exact": {"hog": [20, 13], "bait": [10, 6]}, "near": {"mortar": [9, 4]}}
v = db.value(proj, rec)
cells = [(0.5, shrunk(13, 20), 20), (0.3, shrunk(6, 10), 10), (0.2, shrunk(4, 9), 9)]
exp_rate = sum(w * p for w, p, _ in cells)
exp_neff = 1.0 / (0.25 / 20 + 0.09 / 10 + 0.04 / 9)
exp_half = db.DUEL_Z * 100 * math.sqrt(sum(
    w * w * (p / 100) * (1 - p / 100) / (g + K + 1) for w, p, g in cells))
check("the rate is likelihood-weighted over answered win conditions",
      near(v["winRate"], exp_rate, 0.06), f"{v['winRate']} vs {exp_rate}")
check("nEff is the Kish effective size of the games PLAYED", near(v["nEff"], exp_neff, 0.06),
      f"{v['nEff']} vs {exp_neff}")
check("the bound is the shrunk figure's own spread, one-sided 95%",
      near(v["low"], exp_rate - exp_half, 0.11) and near(v["high"], exp_rate + exp_half, 0.11),
      f"{v['low']} {v['high']} vs {exp_rate - exp_half:.1f}")
check("raw is published beside it", near(v["raw"], 0.5 * 65 + 0.3 * 60 + 0.2 * 44.4, 0.06))
check("covered is the answered mass", near(v["covered"], 1.0))
check("exact is the share of it off the exact rung", near(v["exact"], 0.8 / 1.0, 0.001))
check("strength mixes the rung strengths",
      near(v["strength"], (0.8 * 0.85 + 0.2 * 0.60), 0.001), str(v["strength"]))
v = db.value({"hog": 0.5, "golem": 0.5}, {"exact": {"hog": [10, 7]}})
check("an unanswered win condition lowers coverage, not the rate",
      near(v["covered"], 0.5) and near(v["winRate"], shrunk(7, 10), 0.06), str(v))
check("and it is listed as unanswered, never as 50%",
      any(x["archetype"] == "golem" and x["winRate"] is None for x in v["per"]))
check("nothing answered is None, not 50%", db.value({"hog": 1.0}, {"exact": {}}) is None)
check("no projection is None", db.value({}, rec) is None)


print("\n-- Strength --")
base = {"nEff": 40.0, "low": 55.0, "covered": 0.8}
check("all three thresholds met is strong", db.strong(base))
check("thin evidence is not strong", not db.strong({**base, "nEff": 29.9}))
check("a bound under 50 is not strong", not db.strong({**base, "low": 49.9}))
check("measured against too little of them is not strong",
      not db.strong({**base, "covered": 0.49}))
check("None is not strong", not db.strong(None))
lucky = db.value({"hog": 1.0}, {"exact": {"hog": [8, 7]}})
solid = db.value({"hog": 1.0}, {"exact": {"hog": [400, 232]}})
check("a lucky 7-1 is NOT strong (too few games)", not db.strong(lucky), str(lucky))
check("58% over 400 games IS strong", db.strong(solid), str(solid))
hot = db.value({"hog": 1.0}, {"exact": {"hog": [13, 10]}})
check("a hot 10-3 is not strong either — the search would be full of them",
      not db.strong(hot), str(hot))
hot40 = db.value({"hog": 1.0}, {"exact": {"hog": [40, 26]}})
check("and the ranking puts 58%/400 above a hotter 65%/40",
      hot40["winRate"] > solid["winRate"] and db.rank_key(solid) < db.rank_key(hot40),
      f"{solid['low']} vs {hot40['low']}")
pub = db.public(solid)
check("public() drops the per-condition table and says strong + brain",
      "per" not in pub and pub["strong"] is True and pub["brain"] == db.DUEL_BRAIN_VERSION)
elite = db.value({"hog": 1.0}, {"exact": {"hog": [400, 340, 312.0]}})
check("85% flown by pilots expected to win 78% is a ~57% deck, and says so",
      near(elite["winRate"], shrunk(200 + 340 - 312, 400), 0.06)
      and near(elite["raw"], 85.0, 0.05), str(elite))
check("so a strong-pilot record does not become a strong deck",
      elite["low"] < db.value({"hog": 1.0}, {"exact": {"hog": [400, 340]}})["low"])
check("public(None) is None", db.public(None) is None)
check("a figure off too few games is withheld, not printed",
      db.public(db.value({"hog": 1.0}, {"exact": {"hog": [8, 7]}})) is None)
check("every pick clears the display floor by construction",
      db.DUEL_MIN_GAMES >= db.DUEL_SHOW_GAMES)


print("\n-- Own answers --")
good = {"exact": {"hog": [300, 180]}}
bad = {"exact": {"hog": [300, 120]}}
decks = [
    {"key": db.deck_key(HOG), "cards": HOG, "games": 12, "wins": 8},
    {"key": db.deck_key(MORTAR), "cards": MORTAR, "games": 3, "wins": 3},   # too few of theirs
    {"key": db.deck_key(BAIT), "cards": BAIT, "games": 20, "wins": 9},
    {"key": "x", "cards": ["a", "b"], "games": 50, "wins": 40},             # not a deck
]
recs = {db.deck_key(HOG): good, db.deck_key(MORTAR): good, db.deck_key(BAIT): bad}
own = db.own_answers({"hog": 1.0}, decks, records_for=lambda d: recs.get(d["key"]))
check("only their proven decks with enough of their own games",
      [o["key"] for o in own] == [db.deck_key(HOG)], str([o["key"] for o in own]))
check("marked as their own", own[0]["pick"] == db.PICK_OWN)


print("\n-- Population answers --")
cat = [
    {"key": db.deck_key(HOG), "cards": HOG, "records": {"exact": {"hog": [400, 240]}}},
    {"key": db.deck_key(HOG2), "cards": HOG2, "records": {"exact": {"hog": [400, 232]}}},
    {"key": db.deck_key(MORTAR), "cards": MORTAR, "records": {"exact": {"hog": [200, 130]}}},
    {"key": db.deck_key(BAIT), "cards": BAIT, "records": {"exact": {"hog": [200, 90]}}},
]
pop = db.population_answers({"hog": 1.0}, cat)
keys = [p["key"] for p in pop]
check("a near-copy of a stronger answer is dropped",
      db.deck_key(HOG2) not in keys and db.deck_key(HOG) in keys, str(keys))
check("a losing deck is not an answer", db.deck_key(BAIT) not in keys)
check("strongest bound first", keys[0] == db.deck_key(MORTAR), str(keys))
check("limit is honoured", len(db.population_answers({"hog": 1.0}, cat, limit=1)) == 1)


print("\n-- Personal choice --")


def ans(cards, low, key=None):
    return {"key": key or db.deck_key(cards), "cards": cards,
            "duel": {"low": low, "winRate": low + 5, "nEff": 100.0}}


A = ans(MORTAR, 56.0)
B = ans(BAIT, 55.0)
C = ans(deck("golem"), 50.5)
picks = db.personal([A, B, C], slots=2)
check("with nothing to lean on, the proof decides", [p["key"] for p in picks] == [A["key"], B["key"]])
picks = db.personal([A, B, C], known=set(BAIT), slots=1)
check("a pick built of their own cards wins a near-tie",
      picks[0]["key"] == B["key"] and picks[0]["known"] == 8, str(picks[0]["key"]))
picks = db.personal([A, B, C], known=set(BAIT[:3]), slots=1)
check("three known cards (under KNOWN_MIN) earn nothing", picks[0]["key"] == A["key"])
picks = db.personal([A, B, C], taken={A["key"]: 1}, slots=1)
check("a pick a teammate already holds gives way to a comparable one",
      picks[0]["key"] == B["key"])
picks = db.personal([A, ans(deck("golem"), 45.0)], taken={A["key"]: 1}, slots=1)
check("but never to a clearly weaker one", picks[0]["key"] == A["key"])
picks = db.personal([A, B], exclude=[MORTAR[:6] + ["zap", "log"]], slots=2)
check("a near-copy of a deck already on their list is not a new option",
      [p["key"] for p in picks] == [B["key"]])
check("slots are honoured", len(db.personal([A, B, C], slots=1)) == 1)


print("\n-- Merge --")


def row(name, cards, strong=False, extra=None):
    r = {"name": name, "cards": cards,
         "duel": {"strong": strong, "low": 55.0 if strong else 45.0}}
    r.update(extra or {})
    return r


listing = [row(f"r{i}", deck(c)) for i, c in enumerate(
    ["hog-rider", "golem", "giant", "balloon", "miner", "graveyard", "x-bow"])]
p1 = {"name": "duel1", "cards": MORTAR, "duelPick": "own"}
p2 = {"name": "duel2", "cards": BAIT}
out, n = db.merge(listing, [p1, p2])
names = [r["name"] for r in out]
check("two picks go straight under the #1", names[:3] == ["r0", "duel1", "duel2"], str(names))
check("the list keeps seven rows", len(out) == 7)
check("the lowest rows are the ones dropped", names[3:] == ["r1", "r2", "r3", "r4"], str(names))
check("picks are marked", out[1]["duelPick"] == "own" and out[2]["duelPick"] == "duel"
      and out[1]["duelProven"] and out[2]["duelProven"])
check("and counted", n == 2)
check("the caller's rows are not written", "duelProven" not in listing[0]
      and len(listing) == 7)

one = [row("a", deck("hog-rider")), row("b", deck("golem"), strong=True)] + listing[2:]
out, n = db.merge(one, [p1, p2])
check("a strong row already listed takes a slot and is marked",
      n == 1 and out[2]["name"] == "b" and out[2]["duelProven"], str([r["name"] for r in out]))
check("a proven row is never the one dropped", any(r["name"] == "b" for r in out))
two = [row("a", deck("hog-rider"), strong=True), row("b", deck("golem"), strong=True)] + listing[2:]
out, n = db.merge(two, [p1, p2])
check("two proven rows leave no slot: nothing is inserted", n == 0 and len(out) == 7)
out, n = db.merge(listing, [{"name": "copy", "cards": deck("hog-rider")}, p2])
check("a pick that copies a listed deck is skipped for the next",
      n == 1 and out[1]["name"] == "duel2", str([r["name"] for r in out]))
out, n = db.merge(listing[:3], [p1, p2])
check("a short list grows instead of losing rows", len(out) == 5 and n == 2)
out, n = db.merge([], [p1, p2])
check("an empty list takes the picks alone", [r["name"] for r in out] == ["duel1", "duel2"])
out, n = db.merge(listing, [])
check("no picks: the list is unchanged in order and length",
      [r["name"] for r in out] == [r["name"] for r in listing] and n == 0)


print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
