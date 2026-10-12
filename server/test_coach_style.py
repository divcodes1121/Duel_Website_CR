"""test_coach_style.py — how a player builds, and which lists are built that way.

    python server/test_coach_style.py

Literals only: `role_of` and `elixir_of` are passed in, so nothing here reads
a card catalogue or a database.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coach_style as st  # noqa: E402

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


ROLE = {"hog": "wincon", "gy": "wincon", "golem": "wincon",
        "fireball": "spell", "log": "spell", "eq": "spell", "snowball": "spell",
        "poison": "spell", "barrel": "spell", "zap": "spell",
        "cannon": "building", "tesla": "building"}
COST = {"golem": 8, "hog": 4, "gy": 5, "fireball": 4, "poison": 4, "eq": 3, "cannon": 3,
        "tesla": 4, "log": 2, "snowball": 2, "barrel": 2, "zap": 2,
        "musk": 4, "knight": 3, "valk": 4, "skel": 1, "ice": 1, "baby": 4, "pekka": 7,
        "night": 4, "lumber": 4, "goblins": 2, "bats": 2}
role_of = lambda c: ROLE.get(c, "support")
elx = lambda c: COST.get(c, 3)

# A Hog player: Fireball + Log, Cannon, Musketeer / Knight / Skeletons / Ice.
HOG_FL = ["hog", "fireball", "log", "cannon", "musk", "knight", "skel", "ice"]
# The same player's Graveyard deck: Poison + Barrel, no building.
GY_PB = ["gy", "poison", "barrel", "knight", "baby", "valk", "skel", "ice"]
OWN = [{"cards": HOG_FL, "battles": 70}, {"cards": GY_PB, "battles": 30}]

print("\nthe profile is their own games, by role")
P = st.profile(OWN, role_of, elx)
check("battles and decks are counted", P["battles"] == 100 and P["decks"] == 2, P)
check("a card's share is the share of their battles it was in",
      abs(P["card"]["fireball"] - 0.7) < 1e-9 and abs(P["card"]["knight"] - 1.0) < 1e-9, P["card"])
check("a spell PACKAGE is the exact set, by battles",
      abs(P["packages"][("fireball", "log")] - 0.7) < 1e-9
      and abs(P["packages"][("barrel", "poison")] - 0.3) < 1e-9, P["packages"])
check("the share of games with no building", abs(P["noBuilding"] - 0.3) < 1e-9, P["noBuilding"])
check("mean deck cost is weighted by battles",
      abs(P["elixir"] - (0.7 * sum(map(elx, HOG_FL)) / 8 + 0.3 * sum(map(elx, GY_PB)) / 8)) < 1e-9)
check("under STYLE_MIN_BATTLES there is no profile",
      st.profile([{"cards": HOG_FL, "battles": st.STYLE_MIN_BATTLES - 1}], role_of, elx) is None)
check("no decks is no profile", st.profile([], role_of, elx) is None)
check("a deck with no battles adds nothing",
      st.profile(OWN + [{"cards": ["golem"] * 8, "battles": 0}], role_of, elx)["decks"] == 2)

print("\nwhat they pair with WHICH win condition")
check("a win condition with enough games is read on its own",
      set(P["byWinCon"]) == {"hog", "gy"}, sorted(P["byWinCon"]))
check("their Hog games run Fireball + Log, every time",
      abs(P["byWinCon"]["hog"]["packages"][("fireball", "log")] - 1.0) < 1e-9)
check("their Graveyard games run Poison + Barrel and no building",
      abs(P["byWinCon"]["gy"]["packages"][("barrel", "poison")] - 1.0) < 1e-9
      and abs(P["byWinCon"]["gy"]["noBuilding"] - 1.0) < 1e-9)
thin = st.profile([{"cards": HOG_FL, "battles": 70}, {"cards": GY_PB, "battles": 5}], role_of, elx)
check("a win condition under the floor has no reading of its own",
      set(thin["byWinCon"]) == {"hog"}, sorted(thin["byWinCon"]))

print("\na list is fitted against it")
same = st.fit(HOG_FL, P, role_of, elx)
eq = st.fit(["hog", "eq", "snowball", "tesla", "musk", "knight", "skel", "ice"], P, role_of, elx)
other = st.fit(["hog", "eq", "snowball", "tesla", "pekka", "night", "lumber", "goblins"], P, role_of, elx)
check("their own build fits best", same["score"] > eq["score"] > other["score"],
      (same["score"], eq["score"], other["score"]))
check("the counts are the list's spells and support they play",
      same["spells"] == [2, 2] and same["support"] == [4, 4] and same["building"] == "yours", same)
check("other spells, same support: spells 0 of 2, support 4 of 4, a building they do not run",
      eq["spells"] == [0, 2] and eq["support"] == [4, 4] and eq["building"] == "other", eq)
check("nothing of theirs: 0 and 0", other["spells"] == [0, 2] and other["support"] == [0, 4], other)
check("the exact package's share of their battles is published", same["package"] == 0.7 and eq["package"] == 0.0)
check("the score is within 0..1", 0.0 <= other["score"] <= same["score"] <= 1.0)
check("no profile is no fit", st.fit(HOG_FL, None, role_of, elx) is None)

mixed = st.fit(["hog", "fireball", "zap", "cannon", "musk", "knight", "skel", "ice"], P, role_of, elx)
check("two spells they play, in a package they do not field, fits less than their package",
      mixed["spells"] == [1, 2] and mixed["score"] < same["score"], mixed)

# Two packages, half their games each. A list that takes one spell from each
# uses spells they play exactly as much as a list that IS one of the packages
# -- only the package can tell them apart.
TWO = st.profile([{"cards": ["golem", "fireball", "log", "musk", "knight", "skel", "ice", "valk"], "battles": 50},
                  {"cards": ["golem", "poison", "zap", "musk", "knight", "skel", "ice", "valk"], "battles": 50}],
                 role_of, elx)
is_pkg = st.fit(["hog", "fireball", "log", "musk", "knight", "skel", "ice", "valk"], TWO, role_of, elx)
split = st.fit(["hog", "fireball", "zap", "musk", "knight", "skel", "ice", "valk"], TWO, role_of, elx)
check("one spell from each of their packages is not a package they field",
      split["spells"] == [2, 2] and split["package"] == 0.0 and is_pkg["package"] == 0.5
      and is_pkg["score"] > split["score"], (is_pkg, split))

print("\nthe win condition's own games lead")
# A Graveyard list with the Hog games' spells against one with the Graveyard games' spells.
gy_fl = st.fit(["gy", "fireball", "log", "knight", "baby", "valk", "skel", "ice"], P, role_of, elx)
gy_pb = st.fit(GY_PB, P, role_of, elx)
check("their Graveyard spells beat their more-played Hog spells ON a Graveyard list",
      gy_pb["score"] > gy_fl["score"], (gy_pb["score"], gy_fl["score"]))
check("and it says how many games that reading is off", gy_pb["winConBattles"] == 30, gy_pb)
flat = {k: v for k, v in P.items() if k != "byWinCon"}
check("without the win condition's own reading the more-played spells would win",
      st.fit(["gy", "fireball", "log", "knight", "baby", "valk", "skel", "ice"], flat, role_of, elx)["score"]
      > st.fit(GY_PB, flat, role_of, elx)["score"])
golem = st.fit(["golem", "fireball", "log", "cannon", "musk", "knight", "skel", "ice"], P, role_of, elx)
check("a win condition they do not play is read off everything they play",
      golem["winConBattles"] == 0 and golem["spells"] == [2, 2], golem)

print("\nno building is a choice too")
nb = st.profile([{"cards": GY_PB, "battles": 60}], role_of, elx)
with_b = st.fit(["gy", "poison", "barrel", "cannon", "baby", "valk", "skel", "ice"], nb, role_of, elx)
without = st.fit(GY_PB, nb, role_of, elx)
check("a player who runs none fits a list with none", without["building"] == "none", without)
check("and a list with a building they never run fits less",
      with_b["building"] == "other" and with_b["score"] < without["score"], (with_b, without))

print("\npace")
heavy = st.profile([{"cards": ["golem", "fireball", "zap", "pekka", "night", "lumber", "baby", "valk"],
                     "battles": 50}], role_of, elx)
light = ["hog", "log", "snowball", "skel", "ice", "goblins", "bats", "cannon"]
heavy_list = ["golem", "poison", "barrel", "pekka", "night", "lumber", "baby", "musk"]
check("a heavy player fits a heavy list better than a cycle list, card overlap aside",
      st.fit(heavy_list, heavy, role_of, elx)["score"] > st.fit(light, heavy, role_of, elx)["score"])
check("the weights sum to one", abs(sum(w for _, w in st.WEIGHTS) - 1.0) < 1e-9)
check("spells and support outweigh the building and pace together",
      dict(st.WEIGHTS)["spells"] + dict(st.WEIGHTS)["support"]
      > 2 * (dict(st.WEIGHTS)["building"] + dict(st.WEIGHTS)["pace"]))


def row(key, rate, score=None, cards=None):
    r = {"key": key, "name": key, "expectedWinRate": rate,
         "cards": cards or [f"{key}-{i}" for i in range(8)]}
    if score is not None:
        r["style"] = {"score": score}
    return r


print("\nthe pick: built their way, among lists that still beat the field")
fam = [row("best", 63.0, 0.10), row("a", 60.0, 0.50), row("b", 58.0, 0.40), row("c", 56.0, 0.30),
       row("d", 55.0, 0.20), row("far", 52.5, 0.90), row("loser", 49.0, 0.99)]
got = [r["key"] for r in st.pick(fam, 4)]
check("the four closest builds inside the band", set(got) == {"a", "b", "c", "d"}, got)
check("returned best rate first", got == ["a", "b", "c", "d"], got)
check("a list under STYLE_FLOOR is never chosen for fitting, however close", "loser" not in got)
check("nor one past STYLE_BAND of the best (63 - 10 = 53)", "far" not in got)
check("the field's best is passed over when four closer builds exist", "best" not in got)
check("a wider band lets it in", "far" in [r["key"] for r in st.pick(fam, 4, band=11.0)])
check("a lower floor lets a 49% list in -- which is why there is a floor",
      "loser" in [r["key"] for r in st.pick(fam, 4, band=99.0, floor=0.0)])

upside = [row("hi", 60.0, 0.10), row("mid", 58.0, 0.50), row("lo", 56.0, 0.90)]
check("the closest build is CHOSEN first but the rows read best rate first",
      [r["key"] for r in st.pick(upside, 3)] == ["hi", "mid", "lo"]
      and [r["key"] for r in st.pick(upside, 1)] == ["lo"],
      [r["key"] for r in st.pick(upside, 3)])

weak = [row("x", 51.0, 0.1), row("y", 50.0, 0.9), row("z", 48.0, 0.5)]
check("a win condition with nothing above the floor shows its best by rate",
      [r["key"] for r in st.pick(weak, 2)] == ["x", "y"], [r["key"] for r in st.pick(weak, 2)])
short = [row("only", 60.0, 0.2), row("low1", 50.0, 0.9), row("low2", 49.0, 0.8)]
check("short of four eligible, the rest come by rate -- four rows where lists exist",
      [r["key"] for r in st.pick(short, 3)] == ["only", "low1", "low2"])

print("\nno style is the field's order")
plain = [row("p1", 55.0), row("p2", 61.0), row("p3", 58.0)]
check("rows with no style read come back by rate", [r["key"] for r in st.pick(plain, 2)] == ["p2", "p3"])
check("no decks is no rows", st.pick([], 4) == [])
check("a tie in fit goes to the better rate",
      [r["key"] for r in st.pick([row("t1", 56.0, 0.3), row("t2", 59.0, 0.3)], 1)] == ["t2"])

print("\nfour builds, not one build four times")
base = ["k1", "k2", "k3", "k4", "k5", "k6", "k7"]
copies = [row("c1", 60.0, 0.9, base + ["v1"]), row("c2", 59.5, 0.8, base + ["v2"]),
          row("c3", 59.0, 0.7, base + ["v3"]), row("else", 58.0, 0.2)]
got = [r["key"] for r in st.pick(copies, 2)]
check("a near copy of a chosen list is skipped for a different build", got == ["c1", "else"], got)
got = [r["key"] for r in st.pick(copies, 4)]
check("but near copies still fill the rows when nothing else exists", len(got) == 4, got)
check("NEAR_COPY is one card of difference", st.NEAR_COPY == 7)

print("\ntwo players, one win condition, two boards")
A = st.profile([{"cards": HOG_FL, "battles": 80}], role_of, elx)
B = st.profile([{"cards": ["hog", "eq", "snowball", "tesla", "valk", "baby", "goblins", "bats"],
                 "battles": 80}], role_of, elx)
LISTS = {
    "fl-cannon": ["hog", "fireball", "log", "cannon", "musk", "knight", "skel", "ice"],
    "fl-tesla": ["hog", "fireball", "log", "tesla", "musk", "valk", "skel", "ice"],
    "eq-tesla": ["hog", "eq", "snowball", "tesla", "valk", "baby", "goblins", "bats"],
    "eq-cannon": ["hog", "eq", "snowball", "cannon", "valk", "knight", "goblins", "bats"],
    "pekka": ["hog", "poison", "zap", "pekka", "night", "lumber", "baby", "bats"],
}
RATES = {"fl-cannon": 57.0, "fl-tesla": 56.0, "eq-tesla": 57.5, "eq-cannon": 56.5, "pekka": 60.0}


def board(prof):
    rows = [dict(row(k, RATES[k], cards=c), style=st.fit(c, prof, role_of, elx)) for k, c in LISTS.items()]
    return [r["key"] for r in st.pick(rows, 2)]


check("the Fireball + Log player is shown the Fireball + Log lists",
      set(board(A)) == {"fl-cannon", "fl-tesla"}, board(A))
check("the Earthquake player is shown the Earthquake lists",
      set(board(B)) == {"eq-tesla", "eq-cannon"}, board(B))
check("and the field's own order would have shown both of them the same two",
      [r["key"] for r in st.pick([row(k, RATES[k], cards=c) for k, c in LISTS.items()], 2)]
      == ["pekka", "eq-tesla"])

print("\nwhat is published about the profile")
pub = st.public(P, lambda c: c.upper())
check("their packages, most used first, named",
      pub["packages"][0] == {"spells": ["fireball", "log"], "names": ["FIREBALL", "LOG"], "share": 0.7}, pub)
check("the rule's own figures ride along", pub["band"] == st.STYLE_BAND and pub["floor"] == st.STYLE_FLOOR)
check("and which win conditions were read on their own", pub["winCons"] == ["gy", "hog"])
check("no card shares in the public profile", "card" not in pub and "byWinCon" not in pub)
check("no profile publishes nothing", st.public(None) is None)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
