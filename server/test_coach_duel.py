"""test_coach_duel.py — two AI coaches play a duel, game by game.

    python server/test_coach_duel.py

Plain checks and a counter, like the other suites. `play` and `policy` take
functions, so most of this is invented decks, a referee that answers from a
number and coaches that answer from a table; every expected figure is worked
out by hand beside it. `simulate` is driven through a stand-in `coach` module
put in `sys.modules`, so nothing reads a database.

What would be quietly wrong rather than broken:
  * the exact chances of the final scores must add up to one and match the
    arithmetic of a best-of-3 — a tree that drops a branch still looks fine;
  * the second coach sees the results from ITS side ('w' for its own win),
    and its own decks as "mine";
  * no coach brings a deck holding a card it has already played;
  * the in-duel shift moves game 2 and 3, never game 1, and the matchup
    printed beside it is the figure before the shift;
  * a rematch does not ask Coach Assist again (the answer is cached).
"""

from __future__ import annotations

import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coach_duel as cdu  # noqa: E402
import duel_plan as dp  # noqa: E402

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ok  ", name)
    else:
        failed += 1
        print("  FAIL", name, detail)


def near(a, b, tol=1e-9):
    return abs(a - b) <= tol


def deck(tag):
    return [f"{tag}{i}" for i in range(8)]


A1, A2, A3, A4 = deck("a"), deck("b"), deck("c"), deck("d")
B1, B2, B3 = deck("x"), deck("y"), deck("z")
NO_SHIFT = {}


def in_order(decks):
    """A coach that brings its decks in the order loaded."""
    def pick(my_played, opp_played, results):
        return len(my_played), {"seen": (len(my_played), len(opp_played), results)}
    return pick


print("disjoint_set")
rows = [{"cards": A1}, {"cards": A1[:4] + deck("q")[:4]}, {"cards": A2},
        {"cards": A2[::-1]}, {"cards": deck("s")[:7]}, {"cards": A3}, {"cards": A4},
        {"cards": deck("e")}]
got = cdu.disjoint_set(rows)
check("takes rows in order, skipping one that shares a card",
      [r["cards"] for r in got][:2] == [A1, A2], str(got[:2]))
check("the same deck in another order is one deck",
      sum(1 for r in got if set(r["cards"]) == set(A2)) == 1)
check("a row that is not eight cards is skipped", all(len(r["cards"]) == 8 for r in got))
check("stops at four", len(got) == 4 and got[-1]["cards"] == A4, str(len(got)))
check("size is honoured", len(cdu.disjoint_set(rows, size=2)) == 2)
check("nothing in, nothing out", cdu.disjoint_set([]) == [] and cdu.disjoint_set(None) == [])

print("play: a coin")
coin = cdu.play([A1, A2, A3], [B1, B2, B3], in_order(None), in_order(None),
                lambda i, j: 0.5, shift=NO_SHIFT)
paths = sorted(n["path"] for n in coin["games"])
check("five games can be reached in a best of three", paths == ["", "l", "lw", "w", "wl"], str(paths))
check("each final score is a quarter with coins",
      all(near(coin["outcomes"][s], 0.25) for s in ("2-0", "2-1", "1-2", "0-2")), str(coin["outcomes"]))
check("the outcomes add up to one", near(sum(coin["outcomes"].values()), 1.0))
check("the duel is even", near(coin["duel"]["a"], 0.5) and near(coin["duel"]["b"], 0.5))
by = {n["path"]: n for n in coin["games"]}
check("game numbers follow the path", [by[p]["game"] for p in ("", "w", "wl")] == [1, 2, 3])
check("game 3 is reached a quarter of the time on each road",
      near(by["wl"]["reach"], 0.25) and near(by["lw"]["reach"], 0.25) and near(by[""]["reach"], 1.0))

print("play: a favourite")
fav = cdu.play([A1, A2, A3], [B1, B2, B3], in_order(None), in_order(None),
               lambda i, j: 0.6, shift=NO_SHIFT)
# A wins 2-0: .36; 2-1: two roads of .6*.4*.6 = .288; total .648.
check("a 60% favourite every game wins the duel 64.8%", near(fav["duel"]["a"], 0.648), str(fav["duel"]))
check("2-0 is .36 and 0-2 is .16",
      near(fav["outcomes"]["2-0"], 0.36) and near(fav["outcomes"]["0-2"], 0.16))
check("2-1 is .288 and 1-2 is .192",
      near(fav["outcomes"]["2-1"], 0.288) and near(fav["outcomes"]["1-2"], 0.192))

print("play: who sees what")
seen_b = {}


def b_coach(my_played, opp_played, results):
    seen_b[results] = ([tuple(d) for d in my_played], [tuple(d) for d in opp_played])
    return len(my_played), None


cdu.play([A1, A2, A3], [B1, B2, B3], in_order(None), b_coach, lambda i, j: 0.5, shift=NO_SHIFT)
check("the second coach is told its own results ('l' when the first player won)",
      set(seen_b) == {"", "l", "w", "lw", "wl"}, str(sorted(seen_b)))
check("its own played decks are its own", seen_b["l"][0] == [tuple(B1)] and seen_b["l"][1] == [tuple(A1)])
check("after 1-1 it has seen two of each, in order",
      seen_b["lw"][0] == [tuple(B1), tuple(B2)] and seen_b["lw"][1] == [tuple(A1), tuple(A2)])

print("play: the shift")
sh = cdu.play([A1, A2, A3], [B1, B2, B3], in_order(None), in_order(None), lambda i, j: 0.5)
bys = {n["path"]: n for n in sh["games"]}
check("game 1 is not shifted", near(bys[""]["chance"], 0.5) and near(bys[""]["matchup"], 0.5))
check("after winning game 1 the next is above the matchup, by the fitted shift",
      near(bys["w"]["chance"], dp.shifted(0.5, "w", 2)) and bys["w"]["chance"] > 0.5
      and near(bys["w"]["matchup"], 0.5))
check("after losing it is below", bys["l"]["chance"] < 0.5)
check("game 3 moves by the game-3 shift", near(bys["wl"]["chance"], dp.shifted(0.5, "l", 3)))
check("with the shift a coin duel is still even (it is symmetric)", near(sh["duel"]["a"], 0.5))

print("play: a coach with nothing left")


def two_decks(my_played, opp_played, results):
    return (len(my_played) if len(my_played) < 2 else None), None


ff = cdu.play([A1, A2], [B1, B2, B3], two_decks, in_order(None), lambda i, j: 0.5, shift=NO_SHIFT)
byf = {n["path"]: n for n in ff["games"]}
check("game 3 with no deck is a forfeit for that side",
      byf["wl"]["forfeit"] == "a" and byf["wl"]["chance"] == 0.0 and byf["wl"]["a"]["deck"] is None)
check("the duel then needs 2-0 for them: a quarter", near(ff["duel"]["a"], 0.25), str(ff["duel"]))

print("policy")
# Each of my decks against each of theirs; my deck a beats x but loses to y.
M = {("a", "x"): .8, ("a", "y"): .3, ("a", None): .5,
     ("b", "x"): .5, ("b", "y"): .6, ("b", None): .5,
     ("c", "x"): .5, ("c", "y"): .5, ("c", None): .5}


def tag_of(d):
    return sorted(d)[0][0] if d else None


def win(my, theirs):
    return M[(tag_of(my), tag_of(theirs))]


def read(revealed, lost):
    shown = {tag_of(r) for r in revealed if r}
    return [(c, .5) for c in (B1, B2) if tag_of(c) not in shown]


pol = cdu.policy([A1, A2, A3], read, win)
i, info = pol([], [], "")
check("the coach picks through the look-ahead and says what it believed",
      i in (0, 1, 2) and 0 < info["believed"]["duel"] < 100 and "game" in info["believed"], str(info))
check("it says what it expected them to bring", [e["cards"] for e in info["expected"]] == [sorted(B1), sorted(B2)]
      and info["expected"][0]["p"] == 50.0, str(info.get("expected")))
i2, info2 = pol([[A1, A2, A3][i]], [B1], "w")
check("it never brings a deck it has played", i2 != i)
check("after they showed x it expects only y", [e["cards"] for e in info2["expected"]] == [sorted(B2)])
blind = cdu.policy([A1, A2, A3], None, None)
check("with no read it brings the first deck it still can",
      blind([], [], "")[0] == 0 and blind([A1], [B1], "l")[0] == 1 and blind([A1], [B1], "l")[1] == {})


def broken(revealed, lost):
    raise RuntimeError("no read today")


check("a read that fails still brings a deck", cdu.policy([A1, A2], broken, win)([], [], "")[0] == 0)

print("referee")
ra = cdu._referee(lambda a, b: 0.7, lambda b, a: 0.4)
check("the mean of both rulers, each from its side", near(ra(A1, B1), (0.7 + 0.6) / 2))
check("one ruler alone answers", near(cdu._referee(None, lambda b, a: 0.4)(A1, B1), 0.6))
check("no ruler is a coin", cdu._referee(None, None)(A1, B1) == 0.5)

print("simulate, through a stand-in Coach Assist")
calls = []
SETS = {"#AAA": [A1, A2, A3, A4], "#BBB": [B1, B2, B3]}


def fake_suggest(me, opp, my_played, opp_played, *wins, kind=None, keep=None, **_kw):
    calls.append((me, opp, kind))
    recs = [{"cards": d, "deckName": "Deck " + d[0][0], "art": {}, "brain": {"winRate": 55.0},
             "secret": True} for d in SETS[me]]
    if keep is not None:
        keep.update(ctx={"model": {"weights": {}}}, opp_hist={"read": [], "tag": opp}, rates=None)
    return {"recommendations": recs, "duelSet": {"duel": 57.5, "size": len(recs)},
            "counters": {"decks": [], "pool": 12}, "myName": me.strip("#").title(),
            "opponent": {"engine": "duel-read-1.0", "readFit": "crl"},
            "brainModel": {"skill": {"k": 20}, "levelScale": 0.0},
            "fusion": {"cardModel": "card-matchup-1.0"},
            "profiles": {"mine": {"winCons": [{"card": "hog-rider", "name": "Hog Rider", "share": 0.4,
                                               "winRate": 61.0, "use": "main",
                                               "skill": {"tag": "strong"}}]}},
            "evidence": {"mySeries": 9, "myGames": 22}}


A1_TECHED = A1[:6] + ["t1", "t2"]


def fake_tools(cards, opp_hist, kind, ctx, rates):
    def r(revealed, lost):
        # The #BBB coach's read of #AAA: the first deck with a tech swap.
        if opp_hist.get("tag") == "#AAA":
            return [(A1_TECHED, 0.4)]
        return []

    def w(my, theirs):
        return 0.6 if my and sorted(my)[0][0] in "ab" else 0.5
    return r, w


fake = types.ModuleType("coach")
fake.suggest = fake_suggest
fake._plan_tools = fake_tools
fake._dp = dp
fake._dr = object()
fake._archetype = lambda cards: "other"
real_coach = sys.modules.get("coach")
sys.modules["coach"] = fake
try:
    cdu._cache.clear()
    out = cdu.simulate("#AAA", "#BBB", ("2026-09-20", "2026-10-20"), (None, None), kind=True)
    check("no error", "error" not in out, str(out.get("error")))
    check("Coach Assist is asked once for each side, each from its own seat",
          calls == [("#AAA", "#BBB", True), ("#BBB", "#AAA", True)], str(calls))
    check("each side's set is the set Coach Assist loaded",
          [d["cards"] for d in out["a"]["set"]] == [A1, A2, A3, A4] and len(out["b"]["set"]) == 3)
    check("only the fields the screen draws go out", "secret" not in out["a"]["set"][0]
          and out["a"]["set"][0]["vsRead"] == 55.0)
    check("the outcomes are percent and add up to 100",
          abs(sum(out["outcomes"].values()) - 100.0) < 0.2, str(out["outcomes"]))
    check("the duel figures add up to 100", abs(out["duel"]["a"] + out["duel"]["b"] - 100) < 0.11)
    check("five games in the tree", len(out["tree"]) == 5)
    legal = True
    tree = {n["path"]: n for n in out["tree"]}
    for p, n in tree.items():
        for side, s in (("a", out["a"]["set"]), ("b", out["b"]["set"])):
            used = set()
            for k in range(len(p) + 1):
                node = tree[p[:k]]
                d = node[side]["deck"]
                cards = set(s[d]["cards"])
                if cards & used:
                    legal = False
                used |= cards
    check("down every road, no coach plays a card twice", legal)
    # A's ruler: .6 for its decks a/b, .5 else; B's ruler: .5 for x/y/z
    # (not a/b) -> referee .55 when A brings a or b.
    check("the matchup is the mean of both rulers, in percent", tree[""]["matchup"] == 55.0,
          str(tree[""]["matchup"]))
    check("each pick says what its coach believed", "believed" in tree[""]["a"])
    # B's stand-in read always names A1 with two cards changed: still a hit
    # when A brings A1, never when A brings another deck.
    hits = [(n["a"]["deck"], e["hit"]) for n in out["tree"] for e in n["b"].get("expected") or []]
    check("a deck two cards off the one expected counts as read right",
          hits and all(h == (d == 0) for d, h in hits), str(hits))
    check("the brain line says which read and engines played",
          out["a"]["brain"]["readFit"] == "crl" and out["a"]["brain"]["skill"] is True
          and out["a"]["brain"]["cardModel"] == "card-matchup-1.0")
    check("the coach's own figure for its set is carried", out["a"]["belief"] == 57.5)
    check("the coached player's main win condition is carried",
          out["a"]["profile"][0]["name"] == "Hog Rider" and out["a"]["profile"][0]["tag"] == "strong")
    again = cdu.simulate("#AAA", "#BBB", ("2026-09-20", "2026-10-20"), (None, None), kind=True)
    check("a rematch asks Coach Assist nothing", len(calls) == 2 and again is out)

    SETS["#CCC"] = [A1, A2]
    short = cdu.simulate("#CCC", "#BBB", (None, None), (None, None))
    check("a player who cannot field three decks is said so, by side",
          short.get("error") == "short_set" and short["side"] == "a" and short["decks"] == 2, str(short))

    def no_ctx(me, opp, *a, keep=None, **k):
        got = fake_suggest(me, opp, *a, keep=None, **k)
        if keep is not None:
            keep.update(ctx=None, opp_hist=None, rates=None)
        return got
    fake.suggest = no_ctx
    nb = cdu.simulate("#AAA", "#BBB", (None, "x"), (None, None))
    check("with no win model on either side there is no duel to play", nb.get("error") == "no_brain", str(nb))
finally:
    if real_coach is not None:
        sys.modules["coach"] = real_coach
    else:
        sys.modules.pop("coach", None)

print("the parts that decide a game read no file, database or network")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "coach_duel.py"), encoding="utf-8").read()
imports = sorted(line.split()[1] for line in src.splitlines() if line.startswith("import "))
check("module-level imports are the standard library and duel_plan",
      imports == ["duel_plan", "sys", "threading", "time", "traceback"], str(imports))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
