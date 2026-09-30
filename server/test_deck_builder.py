"""test_deck_builder.py — the human-like deck builder, its move set, and the
whole-duel loadout planner.

    python server/test_deck_builder.py

Literals only; no database, no network.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deck_builder as db  # noqa: E402
import swap_graph as sg  # noqa: E402

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


def key(cards):
    return ",".join(sorted(cards))


print("\nthe swap graph: human substitutions from decks one card apart")
decks = {}
contexts = [["k1", "k2", "k3", "k4", "k5", "k6", "k7"],
            ["m1", "m2", "m3", "m4", "m5", "m6", "m7"],
            ["n1", "n2", "n3", "n4", "n5", "n6", "n7"]]
for ctx in contexts:                               # three contexts, each seen with log AND with barrel
    decks[key(ctx + ["the-log"])] = 100
    decks[key(ctx + ["barbarian-barrel"])] = 60
decks[key(contexts[0][:6] + ["zap", "tesla"])] = 50     # a one-off pair: zap<->? only once
decks[key(contexts[0][:6] + ["zap", "cannon"])] = 40
g = sg.build_from(decks)
subs = dict((b, (s, p)) for b, s, p in sg.substitutes("the-log", g))
check("log -> barbarian barrel is learned (seen in 3 deck pairs)", "barbarian-barrel" in subs, g.get("the-log"))
check("and the reverse", "the-log" in dict((b, 0) for b, *_ in sg.substitutes("barbarian-barrel", g)))
check("its pair count is the number of deck pairs", subs.get("barbarian-barrel", (0, 0))[1] == 3)
check("a substitution seen in fewer than MIN_PAIRS deck pairs is not a move",
      "cannon" not in dict((b, 0) for b, *_ in sg.substitutes("tesla", g)))
check("substitutes of an unknown card is empty", sg.substitutes("nope", g) == [] and sg.substitutes("x", None) == [])

print("\none human swap at a time")
G = {"the-log": [["barbarian-barrel", 0.4, 900], ["arrows", 0.1, 300]],
     "cannon": [["tesla", 0.6, 800], ["inferno-tower", 0.2, 200]],
     "valkyrie": [["knight", 0.2, 800]]}
DECK = ["hog-rider", "the-log", "cannon", "valkyrie", "musketeer", "fireball", "ice-spirit", "skeletons"]
sw = db.one_swaps(DECK, G)
check("every swap is out -> in with its evidence",
      ("cannon", "tesla", 800) in [(o, i, p) for o, i, _n, p in sw])
check("a swapped deck is still eight distinct cards", all(len(set(n)) == 8 for *_x, n, _p in sw))
check("a card already spent this duel is never swapped in",
      all(i != "tesla" for _o, i, _n, _p in db.one_swaps(DECK, G, used={"tesla"})))
check("a card already in the deck is never swapped in",
      all(i != "musketeer" for _o, i, _n, _p in db.one_swaps(DECK, dict(G, skeletons=[["musketeer", 0.9, 99]]))))

print("\nthe builder: human moves, judged, kept only when they help")
WANT = {"tesla": 6.0, "barbarian-barrel": 3.0, "knight": -2.0}
score = lambda cards: 50.0 + sum(WANT.get(c, 0.0) for c in cards)
built = db.build([{"cards": DECK, "source": "own"}], score, G)
check("it finds the two helpful human swaps together (cannon->tesla, log->barrel)",
      built and set(built[0]["cards"]) == set(DECK) - {"cannon", "the-log"} | {"tesla", "barbarian-barrel"},
      built[:1])
check("win, the seed's win and the gain are reported", built[0]["win"] == 59.0 and built[0]["seedWin"] == 50.0
      and built[0]["gain"] == 9.0)
check("every step names the swap and how many real deck pairs made it",
      {(s["out"], s["in"], s["pairs"]) for s in built[0]["swaps"]} == {("cannon", "tesla", 800), ("the-log", "barbarian-barrel", 900)})
check("never more than MAX_SWAPS away from a real deck", all(len(b["swaps"]) <= db.MAX_SWAPS for b in built))
check("a swap that hurts is never kept (valkyrie -> knight)",
      all("knight" not in b["cards"] for b in built))
check("near-copies are deduplicated", all(len(set(a["cards"]) & set(b["cards"])) < db.SAME_DECK
                                         for i, a in enumerate(built) for b in built[i + 1:]))
no_tesla = lambda new, seed: "tesla" not in new
b2 = db.build([{"cards": DECK, "source": "own"}], score, G, allow=no_tesla)
check("`allow` refuses decks that break the rules (here: no tesla)", all("tesla" not in b["cards"] for b in b2)
      and b2 and b2[0]["gain"] == 3.0, b2[:1])
check("below MIN_GAIN nothing is offered", db.build([{"cards": DECK}], lambda c: 50.0, G) == [])
check("a built deck identical to another seed is not 'built'",
      all(key(b["cards"]) != key(DECK) for b in built))

print("\nthe whole duel: series arithmetic")
check("a coin flip each game is a coin-flip series", abs(db.series_win([0.5, 0.5, 0.5]) - 0.5) < 1e-12)
p1, p2, p3 = 0.7, 0.4, 0.6
closed = p1 * p2 + p1 * (1 - p2) * p3 + (1 - p1) * p2 * p3
check("best-of-3 matches the closed form", abs(db.series_win([p1, p2, p3]) - closed) < 1e-12)
check("already 1-0 up (need 1 of 2)", abs(db.series_win([0.5, 0.5], 1, 2) - 0.75) < 1e-12)
check("a won game ends it: a 1.0 first game at need 1 is 1", db.series_win([1.0, 0.0], 1, 1) == 1.0)

print("\nthe planner values COVERAGE, not three copies of one strength")
# Their three decks: T0, T1, T2. Three 'mirrors' crush T0 and lose to the rest;
# three 'specialists' each answer a different one.
cands = [{"cards": [f"m{i}{k}" for k in range(8)]} for i in range(3)] + \
        [{"cards": [f"s{i}{k}" for k in range(8)]} for i in range(3)]
def prob(ci, tj):
    if ci < 3:
        return 0.9 if tj == 0 else 0.3
    return 0.75 if tj == ci - 3 else 0.45
plan = db.plan_loadout(cands, [0, 1, 2], prob)
check("it picks the three specialists", plan and sorted(plan["decks"]) == [3, 4, 5], plan)
mirrors = db.loadout_value([0, 1, 2], [0, 1, 2], lambda a, j: prob(a, j))["win"]
check("and their series chance beats the mirrors'", plan["win"] > mirrors, (plan["win"], mirrors))
shared = [{"cards": ["x"] + [f"a{k}" for k in range(7)]}, {"cards": ["x"] + [f"b{k}" for k in range(7)]},
          {"cards": [f"c{k}" for k in range(8)]}, {"cards": [f"d{k}" for k in range(8)]}]
p2_ = db.plan_loadout(shared, [0, 1, 2], lambda c, t: 0.9 if c < 2 else 0.5)
check("never two decks sharing a card", p2_ is None or not (set(shared[p2_["decks"][0]]["cards"])
      & set(shared[p2_["decks"][1]]["cards"])), p2_)
check("spent cards are excluded from the loadout",
      db.plan_loadout(cands, [0, 1, 2], prob, used={"s00"}) is None or
      3 not in db.plan_loadout(cands, [0, 1, 2], prob, used={"s00"})["decks"])
check("with one opponent deck known, each game is against it",
      abs(db.loadout_value([0, 1, 2], [0], lambda a, j: 0.6)["win"] - db.series_win([0.6] * 3)) < 1e-12)

print("\nnothing here reads a database or the network")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "deck_builder.py"), encoding="utf-8").read()
check("pure", "sqlite3" not in src and "urlopen" not in src)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
