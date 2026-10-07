"""test_duel_plan.py — pick for the duel, not the game.

    python server/test_duel_plan.py

Plain asserts and a counter, like the other suites. `duel_plan` knows no card
and no model, so everything here is a handful of invented decks, a `read` that
answers from a table and a `win` that answers from a matrix; every expected
figure is worked out by hand in the comment beside it.

What would be quietly wrong rather than broken:
  * the pick is the deck that wins the DUEL, which is not always the deck with
    the best matchup now — and the suite holds one case where they differ;
  * a card is never played twice: a deck sharing a card with one already
    played, or with one planned for an earlier game, is not a deck to bring;
  * what the read leaves unsaid (a deck they have not shown) is valued, not
    dropped and not spread over the decks it did name unless asked;
  * a game already finished is 1-1 after two whatever was told, and an
    unknown result is both results, never a win.
"""

from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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


def deck(tag):
    return [f"{tag}{i}" for i in range(8)]


A, B, C = deck("a"), deck("b"), deck("c")
X, Y, Z = deck("x"), deck("y"), deck("z")
FA, FB, FC, FX, FY, FZ = (frozenset(d) for d in (A, B, C, X, Y, Z))


def table_read(table, calls=None):
    """`read` answering from {revealed tuple: [(deck, p)]}; records its calls."""
    def read(revealed, lost):
        if calls is not None:
            calls.append((revealed, lost))
        return table.get(revealed, [])
    return read


def matrix_win(m, default=0.5, calls=None):
    def win(mine, theirs):
        if calls is not None:
            calls.append((mine, theirs))
        return m.get((mine, theirs), default)
    return win


NO_SHIFT: dict = {}
near = lambda a, b: abs(a - b) < 1e-9  # noqa: E731

print("what has already happened")
check("nothing played is one case", dp.completions("", 0) == [""])
check("one game played and not told is both results", dp.completions("", 1) == ["w", "l"])
check("told, it is that result", dp.completions("w", 1) == ["w"] and dp.completions("L", 1) == ["l"])
check("two games of three still being played are 1-1, whatever was told",
      dp.completions("", 2) == ["wl", "lw"] and dp.completions("w", 2) == ["wl"])
check("a duel already decided has no case left", dp.completions("ww", 2) == [] and dp.completions("ll", 2) == [])
check("anything that is not a result is dropped, and results past the games played are ignored",
      dp.completions("w?x", 1) == ["w"] and dp.completions("wl", 1) == ["w"])
check("best of five: two games played can be 2-0", sorted(dp.completions("", 2, 5)) == ["ll", "lw", "wl", "ww"])

print("the result of a game moves the next one")
check("no result, no move", dp.shifted(0.5, None, 2, {2: 0.4}) == 0.5)
check("a game with no shift is not moved", dp.shifted(0.5, "w", 1, {2: 0.4}) == 0.5)
up, down = dp.shifted(0.5, "w", 2, {2: 0.4}), dp.shifted(0.5, "l", 2, {2: 0.4})
check("after a win up, after a loss down, by the same log-odds",
      near(up, 1 / (1 + math.exp(-0.4))) and near(up + down, 1.0), f"{up} {down}")
check("an empty shift table is no shift at all", dp.shifted(0.3, "w", 2, {}) == 0.3)
check("the built-in shift moves game 2 and barely game 3",
      dp.SHIFT[2] > 0.2 and abs(dp.SHIFT[3]) < 0.1 and dp.shifted(0.5, "w", 2) > 0.55)

print("the deck that wins the duel is not always the best deck now")
# They bring X, then Y, then Z, for certain. A is my best deck against X (0.60)
# AND my only answer to Y (0.90); B and C lose to Y (0.30). Everything is a
# coin against Z.
READ = {(): [(X, 1.0)], (FX,): [(Y, 1.0)], (FX, FY): [(Z, 1.0)]}
WIN = {(FA, FX): 0.60, (FB, FX): 0.55, (FC, FX): 0.50,
       (FA, FY): 0.90, (FB, FY): 0.30, (FC, FY): 0.30}
p = dp.plan([A, B, C], table_read(READ), matrix_win(WIN), shift=NO_SHIFT)
by = {r["deck"]: r for r in p["options"]}
check("the best deck for game 1 alone is A", p["gamePick"] == 0 and near(by[0]["game"], 0.60))
# Open B, keep A for Y: .55*.9 + .55*.1*.5 + .45*.9*.5 = 0.725
check("the pick is B: it keeps A for the game A is needed in", p["pick"] == 1 and near(by[1]["duel"], 0.725),
      f"{p['pick']} {by[1]['duel']}")
# Open A: then B or C against Y (0.3), the other against Z: .6*.3 + .6*.7*.5 + .4*.3*.5 = 0.45
check("opening A wins the game more often and the duel less", near(by[0]["duel"], 0.45), str(by[0]["duel"]))
# Open C: .5*.9 + .5*.1*.5 + .5*.9*.5 = 0.70
check("every legal deck is valued, best first",
      [r["deck"] for r in p["options"]] == [1, 2, 0] and near(by[2]["duel"], 0.70))
check("what to bring next, won or lost, is A", by[1]["then"] == {"won": 0, "lost": 0}, str(by[1]["then"]))
check("the header says where the duel stands",
      p["brain"] == dp.BRAIN and p["finished"] == 0 and p["score"] == [0, 0] and not p["over"])

print("a card is never played twice")
A2 = A[:7] + ["new"]                       # shares seven cards with A
p2 = dp.plan([A, A2, C], table_read(READ), matrix_win(WIN), my_played=[A], opp_played=[X],
             results="w", shift=NO_SHIFT)
check("a deck sharing a card with one already played is not an option",
      [r["deck"] for r in p2["options"]] == [2], str(p2["options"]))
# From nothing: opening A leaves only C, opening A2 leaves only C, opening C leaves A or A2 for one game.
p3 = dp.plan([A, A2, C], table_read(READ), matrix_win({**WIN, (frozenset(A2), FY): 0.9}), shift=NO_SHIFT)
by3 = {r["deck"]: r for r in p3["options"]}
# Open C (0.5 vs X), then A vs Y (0.9), then NO deck is left: win(None, Z) = 0.5 by the matrix default.
check("a deck planned for a later game spends its cards for the ones after",
      near(by3[2]["duel"], 0.5 * 0.9 + 0.5 * 0.1 * 0.5 + 0.5 * 0.9 * 0.5), str(by3[2]["duel"]))
dup = dp.plan([B, A, A, C, []], table_read(READ), matrix_win(WIN), shift=NO_SHIFT)
check("indices are the caller's own, through duplicates and empty entries",
      dup["pick"] == 0 and sorted(r["deck"] for r in dup["options"]) == [0, 1, 3], str(dup["options"]))

print("what the read leaves unsaid")
w = matrix_win({(FA, FX): 0.8, (FA, None): 0.4})
# Their decks shown are Y and Z, so the read is asked about (Y, Z).
one = dp.plan([A], table_read({(FY, FZ): [(X, 0.6)]}), w, my_played=[B, C], opp_played=[Y, Z], shift=NO_SHIFT)
check("a deck they have not shown is valued through win(deck, None)",
      near(one["options"][0]["game"], 0.6 * 0.8 + 0.4 * 0.4), str(one["options"]))
ren = dp.plan([A], table_read({(FY, FZ): [(X, 0.6)]}), w, my_played=[B, C], opp_played=[Y, Z],
              shift=NO_SHIFT, unseen=False)
check("asked to, the chance is spread over the decks named instead", near(ren["options"][0]["game"], 0.8))
three = {(FY, FZ): [(X, 0.5), (deck("q"), 0.3), (deck("r"), 0.2)]}
kept = dp.plan([A], table_read(three), w, my_played=[B, C], opp_played=[Y, Z], shift=NO_SHIFT, keep=(1, 1, 1))
check("decks beyond `keep` go to the unseen share", near(kept["options"][0]["game"], 0.5 * 0.8 + 0.5 * 0.4))
over1 = {(FY, FZ): [(X, 0.9), (deck("q"), 0.9)]}
norm = dp.plan([A], table_read(over1), matrix_win({(FA, FX): 0.8, (FA, frozenset(deck("q"))): 0.2}),
               my_played=[B, C], opp_played=[Y, Z], shift=NO_SHIFT)
check("probabilities that sum past one are scaled, never trusted", near(norm["options"][0]["game"], 0.5))
none = dp.plan([A], table_read({}), w, my_played=[B, C], opp_played=[Y, Z], shift=NO_SHIFT)
check("a read with nothing to say is all unseen", near(none["options"][0]["game"], 0.4))
check("with one game left the duel is the game, and nothing comes next",
      near(one["options"][0]["duel"], one["options"][0]["game"])
      and one["options"][0]["then"] == {"won": None, "lost": None} and one["pick"] == one["gamePick"] == 0)

print("what the read is told")
asked: list = []
dp.plan([A, B, C], table_read(READ, asked), matrix_win(WIN), shift=NO_SHIFT)
told = {(rev, lost) for rev, lost in asked}
check("for the first game there is no game before", ((), None) in told)
check("after I win they lost the game before; after I lose they did not",
      ((FX,), True) in told and ((FX,), False) in told)
check("the same question is asked once", len(asked) == len(told), f"{len(asked)} {len(told)}")
# Which way round: I won game 1, so THEY lost it, and that is what the read hears first.
asked.clear()
dp.plan([B, C], table_read(READ, asked), matrix_win(WIN), my_played=[A], opp_played=[X], results="w", shift=NO_SHIFT)
check("told I won game 1, the read for game 2 hears that they lost it", asked[0] == ((FX,), True), str(asked[0]))
asked.clear()
dp.plan([B, C], table_read(READ, asked), matrix_win(WIN), my_played=[A], opp_played=[X], results="l", shift=NO_SHIFT)
check("told I lost it, it hears that they did not", asked[0] == ((FX,), False), str(asked[0]))
asked.clear()
dp.plan([A, B], table_read({}, asked), matrix_win({}), my_played=[C], opp_played=[], results="w", shift=NO_SHIFT)
check("a game whose deck is not known is still a game: the first question's reveal is None",
      asked[0][0] == (None,), str(asked[:1]))
wc: list = []
dp.plan([A, B, C], table_read(READ), matrix_win(WIN, calls=wc), shift=NO_SHIFT)
check("each pairing is rated once", len(wc) == len(set(wc)), f"{len(wc)} {len(set(wc))}")

print("where the duel stands")
coin = matrix_win({})
flat = table_read({})
s_w = dp.plan([A, B], flat, coin, my_played=[C], opp_played=[X], results="w", shift=NO_SHIFT)
s_l = dp.plan([A, B], flat, coin, my_played=[C], opp_played=[X], results="l", shift=NO_SHIFT)
s_u = dp.plan([A, B], flat, coin, my_played=[C], opp_played=[X], shift=NO_SHIFT)
check("one up with coins is 75%", near(s_w["options"][0]["duel"], 0.75) and s_w["score"] == [1, 0])
check("one down with coins is 25%", near(s_l["options"][0]["duel"], 0.25) and s_l["score"] == [0, 1])
check("not told who won, it is both — 50%, and the score is not claimed",
      near(s_u["options"][0]["duel"], 0.5) and s_u["score"] is None)
check("one up, a win ends it: nothing to bring after a win, something after a loss",
      s_w["options"][0]["then"]["won"] is None and s_w["options"][0]["then"]["lost"] is not None)
check("one down, a loss ends it", s_l["options"][0]["then"]["lost"] is None and s_l["options"][0]["then"]["won"] is not None)
done = dp.plan([A, B], flat, coin, my_played=[C, deck("d")], opp_played=[X, Y], results="ww", shift=NO_SHIFT)
check("a duel already won has no pick", done["over"] and done["options"] == [] and done["pick"] is None)
full = dp.plan([A], flat, coin, my_played=[B, C, deck("d")], opp_played=[X, Y, Z], shift=NO_SHIFT)
check("three games played is over", full["over"])
empty = dp.plan([], flat, coin, shift=NO_SHIFT)
check("no deck to bring is no pick, not an error", empty["options"] == [] and empty["pick"] is None and not empty["over"])
spent = dp.plan([A], flat, coin, my_played=[A], opp_played=[X], results="w", shift=NO_SHIFT)
check("every deck already spent is no pick", spent["options"] == [] and spent["pick"] is None)

print("the in-duel shift in the plan")
sg = 1 / (1 + math.exp(-0.5))
sh_w = dp.plan([A, B], flat, coin, my_played=[C], opp_played=[X], results="w", shift={2: 0.5})
check("one up, game 2 is no longer a coin", near(sh_w["options"][0]["game"], sg), str(sh_w["options"][0]["game"]))
check("...and the duel follows it (game 3 unshifted)", near(sh_w["options"][0]["duel"], sg + (1 - sg) * 0.5))
sh_l = dp.plan([A, B], flat, coin, my_played=[C], opp_played=[X], results="l", shift={2: 0.5})
check("one down, it moves the other way", near(sh_l["options"][0]["game"], 1 - sg))
# From nothing with coins: 0.5 * (sg + (1 - sg) * 0.5) + 0.5 * ((1 - sg) * 0.5) = 0.5 exactly.
sh_0 = dp.plan([A, B, C], flat, coin, shift={2: 0.5})
check("a symmetric shift leaves an even duel even", near(sh_0["options"][0]["duel"], 0.5))
# The shift makes game 1 worth more: with it the best-now deck gains on the look-ahead's.
with_shift = dp.plan([A, B, C], table_read(READ), matrix_win(WIN), shift={2: 1.5})
gap0 = by[1]["duel"] - by[0]["duel"]
bys = {r["deck"]: r for r in with_shift["options"]}
check("a result that carries makes winning game 1 worth more", bys[1]["duel"] - bys[0]["duel"] < gap0,
      f"{gap0} -> {bys[1]['duel'] - bys[0]['duel']}")
check("None for `shift` is the built-in one; {} is none",
      dp.plan([A, B], flat, coin, my_played=[C], opp_played=[X], results="w")["options"][0]["game"] > 0.55)

print("ties, clamps, best of five")
tie = dp.plan([C, A, B], flat, coin, shift=NO_SHIFT)
check("equal decks keep the caller's order", [r["deck"] for r in tie["options"]] == [0, 1, 2] and tie["pick"] == 0)
wild = dp.plan([A], table_read({(FY, FZ): [(X, 1.0)]}), matrix_win({(FA, FX): 7.0}),
               my_played=[B, C], opp_played=[Y, Z], shift=NO_SHIFT)
check("a rate outside 0..1 is clamped, not propagated", 0.99 < wild["options"][0]["game"] < 1.0)
five = dp.plan([A, B, C, deck("d"), deck("e")], flat, coin, games=5, shift=NO_SHIFT, keep=(2, 1, 1, 1, 1))
check("best of five from nothing with coins is even, and needs three",
      near(five["options"][0]["duel"], 0.5) and five["games"] == 5 and len(five["options"]) == 5)
five2 = dp.plan([A, B, C], flat, coin, games=5, my_played=[deck("d"), deck("e")], opp_played=[X, Y],
                results="ww", shift=NO_SHIFT)
# 2-0 up in a best of five with coins: 1 - 0.5^3 = 0.875
check("2-0 up in a best of five is not over, and is 87.5%",
      not five2["over"] and near(five2["options"][0]["duel"], 0.875), str(five2["options"][:1]))

print("nothing here reads a file, a database or the network")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "duel_plan.py"), encoding="utf-8").read()
imports = sorted(line.split()[1] for line in src.splitlines() if line.startswith("import "))
check("duel_plan imports the standard library only", imports == ["itertools", "math"], str(imports))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
