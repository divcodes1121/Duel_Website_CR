"""test_deck_packages.py — what duel players put around a win condition.

    python server/test_deck_packages.py

Plain asserts and a counter, like the other suites. The games are synthetic,
with invented card keys and a role table written here, so nothing real is read
and the card catalogue can move without touching this file. One block writes a
temporary duel-index file with the real `games` columns.

What would be quietly wrong rather than broken:
  * a spell PACKAGE is the exact set — Log + Rocket is not "has Log" and not
    Log + Rocket + Arrows;
  * the pilots' own records are taken out before anything is called "best";
  * a constructed deck is held to the gate OR to the deck it was built from,
    never to neither;
  * NO TABLE IS NO GATE — a host without the file must keep working.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deck_packages as dp  # noqa: E402

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ok  ", name)
    else:
        failed += 1
        print("  FAIL", name, detail)


ROLE = {"barrel": "wincon", "hog": "wincon", "ram": "wincon",
        "log": "spell", "rocket": "spell", "arrows": "spell", "freeze": "spell", "zap": "spell",
        "tower": "building", "cannon": "building", "hut": "building"}


def role(card):
    return ROLE.get(card, "support")


def deck(*cards):
    """Eight cards: the named ones, padded with this deck's own support."""
    pad = [f"s{i}" for i in range(8)]
    out = list(cards)
    for p in pad:
        if len(out) >= 8:
            break
        if p not in out:
            out.append(p)
    return out


def key(cards):
    return ",".join(cards)


_t = [0]


def g(a_deck, b_deck, winner=1, a="#A", b="#B", mode="CW_Duel_1v1", day=1):
    _t[0] += 1
    return (f"202609{day:02d}T{_t[0]:06d}.000Z", mode, a, b, key(a_deck), key(b_deck), winner)


BAIT = deck("barrel", "log", "rocket", "tower")           # the common package
BAIT_ARROWS = deck("barrel", "arrows", "rocket", "tower")  # one swap, still played
BAIT_ODD = deck("barrel", "arrows", "freeze", "tower")     # two swaps, nobody plays
HOG = deck("hog", "log", "zap", "cannon")
FILL = deck("ram", "zap")

# 200 bait games with log+rocket, 6 with arrows+rocket, 1 with arrows+freeze.
games = []
for i in range(200):
    games.append(g(BAIT, HOG, 1 if i % 2 else 2, a=f"#P{i % 40}", b=f"#Q{i % 40}"))
for i in range(6):
    games.append(g(BAIT_ARROWS, FILL, 1, a=f"#R{i}", b="#Z"))
games.append(g(BAIT_ODD, FILL, 2, a="#ODD", b="#Z"))
T = dp.table_from(games, role)
bar = T["all"]["wc"]["barrel"]

print("the table")
check("every deck fielded is counted under its win condition",
      bar["n"] == 207 and T["all"]["wc"]["hog"]["n"] == 200 and T["all"]["n"] == 414, str(bar["n"]))
check("a spell package is the exact SET, keyed order-free",
      bar["spells"]["log,rocket"][0] == 200 and bar["spells"]["arrows,rocket"][0] == 6)
check("a set under the floor is not stored", "arrows,freeze" not in bar["spells"])
check("buildings are a set too", bar["buildings"]["tower"][0] == 207)
check("cards are counted one at a time, the win condition itself left out",
      bar["cards"]["log"][0] == 200 and bar["cards"]["arrows"][0] == 7 and "barrel" not in bar["cards"])
check("distinct pilots, not games", bar["spells"]["log,rocket"][3] == 40 and bar["pilots"] == 47, str(bar["pilots"]))
check("wins are the side's own", bar["spells"]["log,rocket"][1] == 100 and bar["spells"]["arrows,rocket"][1] == 6)

two = deck("barrel", "hog", "log")
none = deck("log", "zap")
T2 = dp.table_from([g(two, none, 1) for _ in range(4)], role)
check("a deck with two win conditions is counted under each, and each lists the other as a card",
      T2["all"]["wc"]["barrel"]["n"] == 4 and T2["all"]["wc"]["hog"]["n"] == 4
      and T2["all"]["wc"]["barrel"]["cards"]["hog"][0] == 4)
check("a deck with no win condition is counted under the empty key", T2["all"]["wc"][""]["n"] == 4)
check("a deck-game is one deck-game however many win conditions it has", T2["all"]["n"] == 8)

bad = [("20260901T000001.000Z", "CW_Duel_1v1", "#A", "#B", "barrel,log", key(HOG), 1),
       ("20260901T000002.000Z", "CW_Duel_1v1", "#A", "#B", key(["barrel"] * 8), key(HOG), 1)]
T3 = dp.table_from(bad, role)
check("a deck that is not eight different cards is not counted",
      "barrel" not in T3["all"]["wc"] and T3["all"]["wc"]["hog"]["n"] == 2)

print("populations and the window")
mixed = [g(BAIT, HOG, 1, mode="Duel_1v1_Friendly") for _ in range(5)] + [g(BAIT, HOG, 1) for _ in range(7)]
T4 = dp.table_from(mixed, role)
check("friendly duels are their own population, and part of all",
      T4["friendly"]["wc"]["barrel"]["n"] == 5 and T4["all"]["wc"]["barrel"]["n"] == 12)
old = [g(BAIT, HOG, 1, day=1) for _ in range(30)]
new = [g(BAIT, HOG, 2, day=20) for _ in range(4)]
T5 = dp.table_from(old + new, role, since="20260920")
row = T5["all"]["wc"]["barrel"]
check("only games in the window are counted", row["n"] == 4 and row["w"] == 0)
check("games before the window still move the pilots' records",
      row["x"] > 0.6 * 4, f"expected {row['x']} of 4")

print("results with the pilots taken out")
# #STRONG beats everyone with a plain deck; then fields the bait deck and wins.
hist = [g(FILL, HOG, 1, a="#STRONG", b=f"#W{i}") for i in range(60)]
strong = [g(BAIT, HOG, 1, a="#STRONG", b="#NEW1") for _ in range(20)]
fresh = [g(BAIT_ARROWS, HOG, 1, a=f"#N{i}", b=f"#M{i}") for i in range(20)]
T6 = dp.table_from(hist + strong + fresh, role, since=strong[0][0])
s_strong = T6["all"]["wc"]["barrel"]["spells"]["log,rocket"]
s_fresh = T6["all"]["wc"]["barrel"]["spells"]["arrows,rocket"]
check("both packages won every game", s_strong[1] == 20 and s_fresh[1] == 20)
check("a strong pilot's wins were expected; an unknown's were not",
      s_strong[2] > 15 and abs(s_fresh[2] - 10) < 0.01, f"{s_strong[2]} / {s_fresh[2]}")
ranked = dp.rank_sets("barrel", "spells", T6, min_games=10)
by = {tuple(r["set"]): r for r in ranked}
check("so the package the unknowns won with has the bigger edge",
      by[("arrows", "rocket")]["edge"] > by[("log", "rocket")]["edge"] + 1)
check("log5 of two equal pilots is a coin", abs(dp._log5(0.6, 0.6) - 0.5) < 1e-12)

print("how a deck sits with its win condition")
f = dp.fit(BAIT, T, role)
check("the common package's share", abs(f["spell"] - 200 / 207) < 1e-9 and f["spellPilots"] == 40)
check("fit names the sets it measured", f["spellSet"] == ["log", "rocket"] and f["buildingSet"] == ["tower"] and f["wc"] == ["barrel"])
fo = dp.fit(BAIT_ODD, T, role)
check("a package nobody plays is zero, not missing", fo["spell"] == 0.0 and fo["spellPilots"] == 0)
check("the least-run card is found and named", fo["rarest"] == "freeze" and abs(fo["card"] - 1 / 207) < 1e-9, str(fo))
check("a subset of a package is a different package",
      dp.fit(deck("barrel", "log", "tower"), T, role)["spell"] == 0.0)
check("card order does not matter", dp.fit(list(reversed(BAIT)), T, role)["spell"] == f["spell"])
check("not eight cards is not placed", dp.fit(BAIT[:7], T, role) is None)
check("a win condition the table has not seen is not placed",
      dp.fit(deck("ram", "log", "rocket", "tower"), {"all": {"n": 1, "wc": {}}}, role) is None)
both = dp.table_from([g(two, HOG, 1) for _ in range(10)] + [g(deck("barrel", "log"), HOG, 1) for _ in range(90)], role)
fb = dp.fit(two, both, role)
# Under `barrel` every deck runs Log alone (100 of 100); under `hog` only these
# ten do, of 110 (the other hundred are HOG with Log + Zap).
check("with two win conditions each measure is the lower of the two",
      abs(fb["spell"] - 10 / 110) < 1e-9, str(fb["spell"]))

print("the gate")
check("the common deck passes", dp.check(BAIT, T, role)["ok"])
c = dp.check(BAIT_ODD, T, role, seed=BAIT)
check("TWO SWAPS INTO A PACKAGE NOBODY PLAYS IS STOPPED, on the spell set and on the card",
      not c["ok"] and c["problems"] == ["spell", "card"], str(c["problems"]))
check("...and the reading says why", c["fit"]["rarest"] == "freeze" and c["seedFit"]["spell"] > 0.9)
c1 = dp.check(BAIT_ARROWS, T, role, seed=BAIT)
check("one swap into a package people do play passes", c1["ok"], str(c1))
check("the gates are the three named constants",
      dict(dp.GATES) == {"spell": dp.SPELL_MIN_SHARE, "building": dp.BUILDING_MIN_SHARE, "card": dp.CARD_MIN_SHARE})

# A player's own odd list: under the gate, and a swap that does not make it stranger.
ODD_SEED = deck("barrel", "arrows", "freeze", "tower")
ODD_SWAP = deck("barrel", "arrows", "freeze", "tower")[:7] + ["x-new"]
many = games + [g(ODD_SWAP, FILL, 1, a="#ODD2", b="#Z")]
TM = dp.table_from(many, role)
cs = dp.check(ODD_SEED, TM, role)
check("an odd deck with no seed fails the gate", not cs["ok"])
check("the same deck as its own seed is no worse than itself", dp.check(ODD_SEED, TM, role, seed=ODD_SEED)["ok"])
worse = deck("barrel", "zap", "freeze", "tower")
check("a swap that makes an odd deck odder is still stopped",
      not dp.check(worse, TM, role, seed=BAIT)["ok"])
bld = dp.check(deck("barrel", "log", "rocket", "hut"), T, role, seed=BAIT)
check("a building nobody runs with the win condition is a building problem",
      "building" in bld["problems"], str(bld["problems"]))
check("NO TABLE IS NO GATE", dp.check(BAIT_ODD, {}, role)["ok"] and dp.check(BAIT_ODD, {}, role)["fit"] is None)
check("a deck the table cannot place is not judged",
      dp.check(deck("ram", "freeze", "arrows"), {"all": {"n": 5, "wc": {}}}, role)["ok"])
check("passes() is check()['ok']", dp.passes(BAIT, T, role) and not dp.passes(BAIT_ODD, T, role, seed=BAIT))

print("the rankings")
wr = dp.rank_wincons(T, min_games=1)
check("win conditions are ordered by games, with their share of all deck-games",
      [r["card"] for r in wr] == ["barrel", "hog", "ram"] and abs(wr[0]["share"] - 207 / 414) < 1e-9, str(wr))
check("the empty key is never ranked as a win condition",
      all(r["card"] for r in dp.rank_wincons(T2, min_games=1)))
rs = dp.rank_sets("barrel", "spells", T, min_games=1)
check("packages are ordered by games", [tuple(r["set"]) for r in rs] == [("log", "rocket"), ("arrows", "rocket")])
check("a row under the floor is not ranked", len(dp.rank_sets("barrel", "spells", T, min_games=10)) == 1)
check("twelve games at 75% do not outrank two thousand at 54%",
      dp._edge(12, 9, 6.0) < dp._edge(2000, 1080, 1000.0))
rc = dp.rank_cards("barrel", T, role, min_games=1)
check("support cards exclude spells and buildings", all(r["role"] == "support" for r in rc) and rc)
check("role=None lists every role",
      {r["role"] for r in dp.rank_cards("barrel", T, role, role=None, min_games=1)} == {"spell", "building", "support"})
check("an unknown win condition ranks nothing", dp.rank_sets("nope", "spells", T) == [] and dp.rank_cards("nope", T, role) == [])

print("the file")
tmp = tempfile.mkdtemp()
idx = os.path.join(tmp, "idx.db")
con = sqlite3.connect(idx)
con.execute("CREATE TABLE games (battle_time TEXT, mode TEXT, round INTEGER, a_tag TEXT, b_tag TEXT, "
            "a_deck TEXT, b_deck TEXT, a_crowns INTEGER, b_crowns INTEGER, winner INTEGER)")
REAL_A = "arrows,cannon,fireball,hog-rider,ice-spirit,knight,musketeer,skeletons"
REAL_B = "baby-dragon,golem,lightning,lumberjack,mega-minion,night-witch,tornado,zap"
import time as _time  # noqa: E402
now = _time.time()
stamp = _time.strftime("%Y%m%dT%H%M%S.000Z", _time.gmtime(now - 86400))
stale = _time.strftime("%Y%m%dT%H%M%S.000Z", _time.gmtime(now - 90 * 86400))
for i in range(12):
    con.execute("INSERT INTO games VALUES (?,?,?,?,?,?,?,?,?,?)",
                (stamp, "Duel_1v1_Friendly" if i < 4 else "CW_Duel_1v1", 1, f"#A{i}", f"#B{i}", REAL_A, REAL_B, 1, 0, 1))
for i in range(5):
    con.execute("INSERT INTO games VALUES (?,?,?,?,?,?,?,?,?,?)",
                (stale, "CW_Duel_1v1", 1, f"#A{i}", f"#B{i}", REAL_A, REAL_B, 0, 1, 2))
con.commit()
con.close()
path = os.path.join(tmp, "pk.json")
rep = dp.build(idx, path, now=now)
check("build() counts the window's deck-games, friendly apart",
      rep["deckGames"] == 24 and rep["friendlyDeckGames"] == 8, str(rep))
loaded = dp.load(path)
check("load() reads it back with the gates it was built under",
      loaded and loaded["brain"] == dp.BRAIN and loaded["gates"]["spell"] == dp.SPELL_MIN_SHARE)
check("real cards are filed by the card data: Hog's package is Arrows + Fireball",
      loaded["all"]["wc"]["hog-rider"]["spells"]["arrows,fireball"][0] == 12
      and loaded["all"]["wc"]["hog-rider"]["buildings"]["cannon"][0] == 12)
check("games older than the window are not counted but did move the records",
      loaded["all"]["wc"]["golem"]["n"] == 12 and loaded["all"]["wc"]["hog-rider"]["x"] < 6.0,
      str(loaded["all"]["wc"]["hog-rider"]["x"]))
empty = os.path.join(tmp, "empty.json")
with open(empty, "w", encoding="utf-8") as fh:
    fh.write("{}")
# THE SAME INSTANT AS THE TABLE JUST LOADED, on purpose: by the time alone the
# loader handed back the previous file's table (it did, on the server).
same = os.path.getmtime(path)
os.utime(empty, (same, same))
check("a file that is not a table loads as none, even written in the same instant as a real one",
      dp.load(path) is not None and dp.load(empty) is None)
check("...and the real one still loads after it", (dp.load(path) or {}).get("brain") == dp.BRAIN)
with open(empty, "w", encoding="utf-8") as fh:
    fh.write("[1, 2]")
check("a file that is not even an object loads as none", dp.load(empty) is None)
check("a missing file loads as none", dp.load(os.path.join(tmp, "absent.json")) is None)
check("fit() with the real role function places a real deck",
      dp.fit(REAL_A.split(","), loaded)["spell"] == 1.0)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
