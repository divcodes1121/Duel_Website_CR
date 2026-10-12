"""Checks for `player_skill.py` — a player's skill with each win condition.

Run directly: `python server/test_player_skill.py`. No database; the builder's
command is run once on a synthetic game cache in a temp directory.
"""
from __future__ import annotations

import json
import math
import os
import pickle
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import player_skill as ps  # noqa: E402

PASS = FAIL = 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


WC = {"hog-rider": 4, "golem": 8, "balloon": 5, "miner": 3, "lava-hound": 7, "graveyard": 5}
is_wc = lambda c: c in WC  # noqa: E731
cost = lambda c: WC.get(c, 3)  # noqa: E731

print("a deck's win condition")
check("its priciest win-condition card",
      ps.family_of(["miner", "balloon", "arrows", "lava-hound"], is_wc, cost) == "lava-hound")
check("alphabetically first on a tie", ps.family_of(["graveyard", "balloon", "zap"], is_wc, cost) == "balloon")
check("the order of the cards does not matter",
      ps.family_of(["lava-hound", "miner"], is_wc, cost) == ps.family_of(["miner", "lava-hound"], is_wc, cost))
check("none when the deck has none, or there is no deck",
      ps.family_of(["arrows", "zap"], is_wc, cost) is None and ps.family_of([], is_wc, cost) is None
      and ps.family_of(None, is_wc, cost) is None)

print("skill, its tag and what it moves a game by")
check("wins over expectation a game, shrunk by K", ps.skill([30, 20, 14.0], 20.0) == (20 - 14.0) / 50.0)
check("the module's own K when none is given", ps.skill([30, 20, 14.0]) == (20 - 14.0) / (30 + ps.K))
check("nothing played, or no record: zero", ps.skill([0, 0, 0.0]) == 0.0 and ps.skill(None) == 0.0)
check("a few games barely move it", abs(ps.skill([2, 2, 1.0], 20.0)) < 0.05)
check("under the floor of games there is no tag", ps.tag([ps.TAG_MIN_GAMES - 1, 7, 1.0]) is None and ps.tag(None) is None)
check("strong, weak and even by the thresholds",
      ps.tag([40, 30, 20.0], 20.0) == "strong" and ps.tag([40, 12, 20.0], 20.0) == "weak"
      and ps.tag([40, 21, 20.0], 20.0) == "even")
check("exactly on a threshold counts",
      ps.tag([80, 44, 40.0], 20.0) == "strong" and ps.tag([80, 38, 40.0], 20.0) == "weak")
check("a game moves by weight x (my skill - theirs)",
      abs(ps.shift([30, 20, 14.0], [30, 10, 15.0], 2.0, 20.0) - 2.0 * (6 / 50 + 5 / 50)) < 1e-12)
check("it is antisymmetric", ps.shift([30, 20, 14.0], [10, 4, 5.0]) == -ps.shift([10, 4, 5.0], [30, 20, 14.0]))
check("an unknown player on either side is no skill, not an error",
      ps.shift(None, None) == 0.0 and ps.shift([30, 20, 14.0], None, 2.0, 20.0) == 2.0 * 6 / 50)

print("the table")
A, B, C = ("hog-rider", "x1"), ("golem", "x2"), ("balloon", "x3")
fam = lambda d: d[0] if d[0] in WC else None  # noqa: E731
G = [  # time, tag a, tag b, deck a, deck b, a won
    ("t1", "#P", "#Q", A, B, 1),
    ("t2", "#P", "#Q", A, B, 1),
    ("t3", "#Q", "#P", B, C, 0),
    ("t4", "#P", "#R", A, ("none", "y"), 0),
]
seen = []


def expect(i, gap):
    seen.append((i, round(gap, 6)))
    return 0.0          # every game a coin flip from everything but skill


out = ps.build(G, expect, fam, holdout_share=0.0)
P, Q = out["players"]["#P"], out["players"]["#Q"]
check("every game is filed under the win condition each player brought, with its result and expectation",
      P == {"hog-rider": [3, 2, 1.5], "balloon": [1, 1, 0.5]} and Q == {"golem": [3, 0, 1.5]}, str(out["players"]))
check("a deck with no win condition is counted for the player and filed nowhere",
      "#R" not in out["players"] and out["games"] == 4)
# before game 1: nobody has a record. Before game 2: P 1-0, Q 0-1.
s1, s0 = (1 + 10) / 21, (0 + 10) / 21
check("the expectation is handed each player's running record BEFORE the game",
      seen[0] == (0, 0.0) and seen[1] == (1, round(math.log(s1 / (1 - s1)) - math.log(s0 / (1 - s0)), 6)), str(seen[:2]))
check("no holdout asked for, none reported", out["holdout"] is None)
# A game the model expects A to win 73.1% of the time: that, not a coin flip, is what is added.
tilt = ps.build(G[:2], lambda i, gap: 1.0, fam, holdout_share=0.0)["players"]
p73 = 1 / (1 + math.exp(-1.0))
check("what a game SHOULD have gone is what is added for each side",
      abs(tilt["#P"]["hog-rider"][2] - 2 * p73) < 1e-9 and abs(tilt["#Q"]["golem"][2] - 2 * (1 - p73)) < 1e-9,
      str(tilt))

# The holdout: the last game is scored with only what came before it.
H = [("t%d" % i, "#P", "#Q", A, B, 1) for i in range(9)] + [("t9", "#P", "#Q", A, B, 1)]
hold = ps.build(H, lambda i, gap: 0.0, fam, holdout_share=0.1, k=20.0, weight=2.0)["holdout"]
want = 2.0 * ((9 - 4.5) / 29 - (0 - 4.5) / 29)
check("the newest games are scored with the table as it stood before each",
      hold["n"] == 1 and hold["moved"] == 1 and hold["base"] == round(-math.log(0.5), 4)
      and hold["withSkill"] == round(-math.log(1 / (1 + math.exp(-want))), 4), str(hold))
check("...and the gain is what the term bought", hold["gain"] == round(hold["base"] - hold["withSkill"], 4) and hold["gain"] > 0)
flip = ps.build(H[:9] + [("t9", "#P", "#Q", A, B, 0)], lambda i, gap: 0.0, fam, holdout_share=0.1)["holdout"]
check("a term that points the wrong way shows as a loss", flip["gain"] < 0)
later = ps.build(H + [("t99", "#P", "#Q", A, B, 0)] * 0, lambda i, gap: 0.0, fam, holdout_share=0.1)["holdout"]
check("the score of a game does not depend on anything after it", later == hold)

print("what is kept")
kept = ps.trim({"#BIG": {"hog-rider": [9, 6.0, 4.4567], "golem": [1, 0.0, 0.5]}, "#SMALL": {"hog-rider": [9, 9.0, 4.0]}})
check("players under the floor of duel games are left out", list(kept) == ["#BIG"] and ps.MIN_GAMES == 10)
check("records are rounded for the file", kept["#BIG"] == {"hog-rider": [9, 6, 4.457], "golem": [1, 0, 0.5]})

print("reading")
tmp = tempfile.mkdtemp(prefix="player_skill_")
path = os.path.join(tmp, "table.json")
check("no file is no table, and the term is off", ps.load(path) is None and ps.on(path) is False
      and ps.records("#P", path) == {} and ps.status(path) == {"available": False})
body = {"brain": ps.BRAIN, "meta": {"on": True, "k": 20.0, "weight": 2.0, "players": 1, "games": 12,
                                    "holdout": {"n": 6000, "gain": 0.001}},
        "players": {"#ABC": {"hog-rider": [12, 8, 6.0]}}}
ps.save(body, path)
check("a saved table is read back", ps.load(path)["players"] == body["players"] and ps.on(path))
check("a player's records by tag, whatever the case; nobody else's",
      ps.records("#abc", path) == {"hog-rider": [12, 8, 6.0]} and ps.records("#NOPE", path) == {}
      and ps.records("", path) == {})
check("the weights the table was built for", ps.weights(path) == (20.0, 2.0))
st = ps.status(path)
check("status says what it measured and holds no tag",
      st["available"] and st["on"] is True and st["players"] == 1 and "#ABC" not in json.dumps(st))
other = os.path.join(tmp, "other.json")
ps.save({**body, "meta": {**body["meta"], "on": False}}, other)
os.utime(other, (os.path.getmtime(path), os.path.getmtime(path)))
check("two files written in one instant are two tables (the cache is keyed by path too)",
      ps.on(path) is True and ps.on(other) is False)
check("a table whose own holdout did not gain is off", ps.on(other) is False)
bad = os.path.join(tmp, "bad.json")
open(bad, "w").write("{not json")
check("a file that cannot be read is no table, never an error", ps.load(bad) is None and ps.on(bad) is False)
odd = os.path.join(tmp, "odd.json")
open(odd, "w").write(json.dumps({"players": []}))
check("...nor is one of the wrong shape", ps.load(odd) is None)

print("the builder's command, on a synthetic cache")
import card_matchup as cm  # noqa: E402

model_path = os.path.join(tmp, "model.json")
json.dump({"brain": "t", "main": {"hog-rider": 0.0}, "pair": {"golem|hog-rider": 0.0},
           "meta": {"holdout": {"nuisance": [1.0, 0.5]}, "trainedAt": "x"}}, open(model_path, "w"))
FILL_A = ["hog-rider", "the-log", "fireball", "musketeer", "ice-spirit", "skeletons", "cannon", "ice-golem"]
FILL_B = ["golem", "night-witch", "baby-dragon", "lightning", "tornado", "lumberjack", "mega-minion", "barbarian-barrel"]
rows = []
for i in range(40):
    # (battle time, round, tag a, tag b, deck a, deck b, deficit a, deficit b, a won)
    rows.append(("202610%02dT000000.000Z" % (1 + i // 4), i % 3, "#WIN", "#LOSE", FILL_A, FILL_B, 0.0, 0.0, 1))
rows.append(("20261012T000000.000Z", 0, "#WIN", "#LOSE", FILL_A[:7], FILL_B, 0.0, 0.0, 1))   # seven cards: skipped
cache = os.path.join(tmp, "games.pkl")
pickle.dump({"games": rows}, open(cache, "wb"))
saved_path, saved_env = cm.PATH, os.environ.get("CLASH_DUEL_GAMES")
cm.PATH = model_path
os.environ["CLASH_DUEL_GAMES"] = cache
built = os.path.join(tmp, "built.json")
try:
    code = ps.main(["--build", "--out=" + built])
finally:
    cm.PATH = saved_path
    if saved_env is None:
        os.environ.pop("CLASH_DUEL_GAMES", None)
    else:
        os.environ["CLASH_DUEL_GAMES"] = saved_env
got = json.load(open(built))
check("it writes the table", code == 0 and got["brain"] == ps.BRAIN and got["meta"]["games"] == 40)
check("a deck that is not eight different cards is not a game", got["meta"]["games"] == 40)
check("the winner's record with Hog Rider is over expectation, the loser's with Golem under",
      got["players"]["#WIN"]["hog-rider"][0] == 40 and got["players"]["#WIN"]["hog-rider"][1] == 40
      and got["players"]["#WIN"]["hog-rider"][2] < 40 and got["players"]["#LOSE"]["golem"][1] == 0)
check("too few held-out games to trust: the table is written with the term OFF",
      got["meta"]["on"] is False and got["meta"]["holdout"]["n"] < ps.HOLDOUT_MIN)
cm_saved = cm.load
cm.load = lambda path=None: None
try:
    check("with no card matchup model there is nothing to build from: a failing exit and no file", ps.main(["--build", "--out=" + os.path.join(tmp, "x.json")]) == 2
          and not os.path.exists(os.path.join(tmp, "x.json")))
finally:
    cm.load = cm_saved

src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "player_skill.py"), encoding="utf-8").read()
top = [line.split()[1] for line in src.splitlines() if line.startswith("import ")]
check("the reader imports the standard library only", sorted(top) == ["json", "math", "os", "sys", "threading", "time"], str(top))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
