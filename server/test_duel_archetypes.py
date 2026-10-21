"""Tests for `duel_archetypes` — the duel decks grouped by archetype.

No database: `group`, `counter_score`, `family_score` and `pick` are pure.
Run: python test_duel_archetypes.py
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import duel_archetypes as da  # noqa: E402

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ok  ", name)
    else:
        failed += 1
        print("  FAIL", name, detail)


def deck(t):
    return [f"{t}{i}" for i in range(8)]


def key(t):
    return ",".join(sorted(deck(t)))


print("grouping")
rows = [
    (key("a"), "hog", 40, 22, 9, 10),        # a hog list
    (key("b"), "hog", 12, 6, 4, 3),          # a smaller hog list, CRL
    (key("c"), "hog", 30, 20, 2, 25),        # one pilot's pet list: out
    (key("d"), "hog", 2, 2, 2, 1),           # too few games: out
    (key("e"), "other", 10, 5, 3, 4),        # an "other" list
    (key("f"), "golem", 9, 4, 1, 9),         # one pilot: out
    ("x0,x1,x2", "bait", 50, 25, 9, 9),      # not eight cards: out
]
vs = {key("a"): {"golem": (10, 7, 5.0), "bait": (2, 1, 1.0)},
      key("b"): {"golem": (6, 2, 3.0)}}
crl = {key("b"): (3, 2), key("a"): (1, 1)}
fams = da.group(rows, vs, crl, title=lambda cards: "Minion Giant")
check("families by archetype, the other bucket split by win condition",
      sorted(fams) == ["hog", "other:minion-giant"], str(sorted(fams)))
check("a pet list, a thin list and a broken list are left out",
      [e["cards"][0][0] for e in fams["hog"]] == ["b", "a"], str([e["cards"][0] for e in fams["hog"]]))
check("CRL lists rank first, and need the CRL group's games",
      fams["hog"][0]["tier"] == "crl" and fams["hog"][1]["tier"] == "duel")
check("a record against an archetype is kept from VS_MIN games",
      list(fams["hog"][1]["vs"]) == ["golem"])
check("the edge is wins over the pilots' expectation, shrunk",
      abs(fams["hog"][1]["edge"] - round((7 - 5.0) / (10 + da.K), 4)) < 1e-9)

print("reading a list against an opponent")
mix = {"golem": 1.0}
a, b = fams["hog"][1], fams["hog"][0]
check("a list that beat the archetype beyond its pilots scores above one that lost to it",
      da.counter_score(a, mix) > 0 > da.counter_score(b, mix))
check("an archetype missing from its record counts as expected (0), the edge still counts",
      abs(da.counter_score(a, {"lava": 1.0}) - da.GENERAL_WEIGHT * a["edge"]) < 1e-12)

print("picking for a player")
F = {
    "hog": [dict(cards=deck(f"h{i}"), tier="crl" if i < 2 else "duel", games=20, crlGames=3 if i < 2 else 0,
                 edge=0.0, vs={"golem": [10, 5 + (i % 3), 5.0]}) for i in range(8)],
    "bait": [dict(cards=deck(f"b{i}"), tier="duel", games=20, crlGames=0, edge=0.0,
                  vs={"golem": [10, 9, 5.0]}) for i in range(5)],
    "lava": [dict(cards=deck(f"l{i}"), tier="duel", games=20, crlGames=0, edge=0.0,
                  vs={"golem": [10, 1, 5.0]}) for i in range(5)],
}
got = da.pick(F, ["hog"], {"golem": 1.0}, random.Random(1), per_own=3, counter_families=1, per_counter=2,
              slack=0)
fam_order = [g["family"] for g in got]
check("their own family first, then the family that counters the opponent best",
      fam_order == ["hog", "hog", "hog", "bait", "bait"], str(fam_order))
check("CRL lists come before the rest of the family", [g["tier"] for g in got[:2]] == ["crl", "crl"])
check("no list twice", len({",".join(g["cards"]) for g in got}) == len(got))
ex = da.pick(F, ["hog"], {"golem": 1.0}, random.Random(1), per_own=8, counter_families=0,
             exclude={",".join(deck("h0"))})
check("an excluded list is never picked", all(g["cards"] != deck("h0") for g in ex) and len(ex) == 7)
draws = {tuple(g["cards"][0] for g in da.pick(F, ["hog"], {"golem": 1.0}, random.Random(s), per_own=3,
                                              counter_families=0)) for s in range(30)}
check("lists equally good are drawn, so two seeds do not always give the same lists", len(draws) > 1, str(draws))
same = [tuple(g["cards"][0] for g in da.pick(F, ["hog"], {"golem": 1.0}, random.Random(7), per_own=3,
                                             counter_families=0)) for _ in range(3)]
check("one seed gives the same lists every time", len(set(same)) == 1)
fams_drawn = {tuple(sorted({g["family"] for g in da.pick(F, [], {"golem": 1.0}, random.Random(s), per_own=0,
                                                         counter_families=1, per_counter=1)})) for s in range(30)}
check("the counter families are drawn among the best few, not always the single best", len(fams_drawn) > 1,
      str(fams_drawn))

print("the module stands alone")
src = open(da.__file__, encoding="utf-8").read().split('"""', 2)[2]
top = [ln for ln in src.splitlines() if ln.startswith(("import ", "from "))]
check("module-level imports are the standard library",
      all(m.split()[1].split(".")[0] in {"__future__", "datetime", "json", "os", "sqlite3", "sys", "time"}
          for m in top), str(top))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
