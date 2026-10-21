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

    print("you against the AI coach, one game at a time, through the stand-in")
    E_, F_, G_ = deck("e"), deck("f"), deck("g")
    fake.dx = types.SimpleNamespace(card_keys=lambda: sorted({c for t in "abcdefghxyzq" for c in deck(t)} | {"t1", "t2"}))
    fake._own_duel_decks = lambda hist, used: [
        {"cards": d, "count": n, "deckName": "Own " + d[0][0], "art": {}}
        for d, n in ((B1, 9), (B2, 7), (B3, 5), (E_, 4), (F_, 3))]
    fake._drop_event_decks = lambda rows: (rows, 0)
    fake_dz = types.ModuleType("duel_zone")
    fake_dz._arranged = lambda cards, marks: {"cards": list(cards), "art": {}}
    fake_dz.deck_label = lambda cards, arch: "Deck " + sorted(cards)[0][0]
    real_dz = sys.modules.get("duel_zone")
    sys.modules["duel_zone"] = fake_dz
    W = ((None, None), (None, None))
    try:
        cdu._side_cache.clear()
        check("a best of 4 is not a format", cdu.turn("#AAA", "#BBB", [A1], "", *W, games=4).get("error") == "bad_format")
        check("a card you already played this duel is refused",
              cdu.turn("#AAA", "#BBB", [A1, A1[:4] + A2[:4]], "w", *W).get("error") == "bad_decks")
        check("results must cover every earlier game",
              cdu.turn("#AAA", "#BBB", [A1, A2], "", *W).get("error") == "bad_results")
        check("no game after the duel is decided — unless every game is played",
              cdu.turn("#AAA", "#BBB", [A1, A2, A3], "ww", *W).get("error") == "bad_results"
              and "error" not in cdu.turn("#AAA", "#BBB", [A1, A2, A3], "ww", *W, play_all=True))
        t1 = cdu.turn("#AAA", "#BBB", [A1], "", *W)
        check("game 1 answers", "error" not in t1 and t1["game"] == 1 and t1["aiDeck"] in (0, 1, 2), str(t1.get("error")))
        check("duel 1 of a best of 3: the AI loads Coach Assist's own set",
              [d["cards"] for d in t1["ai"]["set"]] == [B1, B2, B3] and t1["aiSet"]["source"] == "coach-assist")
        check("the game has a chance and your deck comes back drawn",
              0 < t1["chance"] < 100 and t1["you"]["deck"]["cards"] == A1)
        check("your coach's figure for the deck you brought", t1["yourOdds"] is not None and "game" in t1["yourOdds"])
        t1b = cdu.turn("#AAA", "#BBB", [A3], "", *W)
        check("THE AI PICKS WITHOUT SEEING YOUR DECK: another deck, the same pick",
              t1b["aiDeck"] == t1["aiDeck"] and t1b["ai"]["set"] == t1["ai"]["set"])
        t2 = cdu.turn("#AAA", "#BBB", [A1, A2], "w", *W)
        check("game 2 replays game 1's pick and brings another deck",
              t2["aiPicks"][0] == t1["aiDeck"] and t2["aiDeck"] not in (None, t1["aiDeck"]), str(t2["aiPicks"]))
        t3 = cdu.turn("#AAA", "#BBB", [A1, A2, A3], "ww", *W, play_all=True)
        check("play all: game 3 after 2-0 still has an AI deck it has not played",
              t3["aiDeck"] is not None and t3["aiDeck"] not in t3["aiPicks"][:2] and t3["playAll"] is True)
        b5 = cdu.turn("#AAA", "#BBB", [A1], "", *W, games=5)
        flat5 = [c for d in b5["ai"]["set"] for c in d["cards"]]
        check("a best of 5: the AI loads five decks that share no card",
              "error" not in b5 and len(b5["ai"]["set"]) == 5 and len(flat5) == len(set(flat5)), str(b5.get("error")))
        b5g5 = cdu.turn("#AAA", "#BBB", [A1, A2, A3, A4, G_], "wlwl", *W, games=5)
        check("a best of 5 reaches a fifth game", b5g5.get("game") == 5 and b5g5["aiDeck"] is not None, str(b5g5.get("error")))
        r1 = cdu.turn("#AAA", "#BBB", [A1], "", *W, round_=1, seen=[A1])
        ai1 = {tuple(d["cards"]) for d in r1["ai"]["set"]}
        check("a rematch draws a different set from the player's rotation",
              r1["aiSet"]["source"] == "rotation" and ai1 != {tuple(B1), tuple(B2), tuple(B3)}, str(ai1))
        check("the rematch says how many of your decks it leans on", r1["seen"] == 1)
        calls_before = [0]
        real_vary = cdu.vary_set

        def counted(*a, **k):
            calls_before[0] += 1
            return real_vary(*a, **k)
        cdu.vary_set = counted
        try:
            cdu.turn("#AAA", "#BBB", [A1, A2], "w", *W, games=5)
            cdu.turn("#AAA", "#BBB", [A1, A2, A3], "wl", *W, games=5)
        finally:
            cdu.vary_set = real_vary
        check("the AI's set is composed once a duel, not once a game", calls_before[0] == 0, str(calls_before))
        # THE AI ONLY LOADS DECKS THAT MAKE SENSE (`coach._constructed_ok`).
        fake._constructed_ok = lambda cards, seed=None: set(cards) != set(B2)
        cdu._side_cache.clear()
        cdu._set_cache.clear()
        s0 = cdu.turn("#AAA", "#BBB", [A1], "", *W)
        names0 = [tuple(d["cards"]) for d in s0["ai"]["set"]]
        check("a deck that makes no sense is never in the AI's set, even Coach Assist's own",
              tuple(B2) not in names0 and s0["aiSet"]["source"] == "composed" and len(names0) >= 3, str(names0))
        s1 = cdu.turn("#AAA", "#BBB", [A1], "", *W, round_=2)
        check("nor in a rematch set", tuple(B2) not in [tuple(d["cards"]) for d in s1["ai"]["set"]])
        # A best of 5 the sensible decks cannot fill alone (B1x overlaps B1, E
        # makes no sense): the set still fields five, taking ONE that fails.
        B1x = B1[:4] + deck("h")[:4]
        real_own = fake._own_duel_decks
        fake._own_duel_decks = lambda hist, used: real_own(hist, used) + [
            {"cards": B1x, "count": 6, "deckName": "Own b1x", "art": {}}]
        fake._constructed_ok = lambda cards, seed=None: set(cards) != set(E_)
        cdu._side_cache.clear()
        cdu._set_cache.clear()
        f5 = cdu.turn("#AAA", "#BBB", [A1], "", *W, games=5)
        flatf = [c for d in f5.get("ai", {}).get("set", []) for c in d["cards"]]
        check("a best of 5 the sensible decks cannot fill takes as few others as it can",
              "error" not in f5 and len(f5["ai"]["set"]) == 5 and len(flatf) == len(set(flatf))
              and f5["aiSet"].get("fallback") is True and f5["aiSet"].get("unsensible") == 1,
              str(f5.get("error") or f5.get("aiSet")))
        fake._own_duel_decks = real_own
        del fake._constructed_ok
        cdu._side_cache.clear()
        cdu._set_cache.clear()
        r1b = cdu.turn("#AAA", "#BBB", [A2, A3], "l", *W, round_=1, seen=[A1])
        check("the AI's set is the same in every game of one duel (seeded on the duel, not your decks)",
              r1b["ai"]["set"] == r1["ai"]["set"])
    finally:
        if real_dz is not None:
            sys.modules["duel_zone"] = real_dz
        else:
            sys.modules.pop("duel_zone", None)

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

print("the AI's picks, game by game")
seen_calls = []


def first_free(ai_played, your_played, results):
    seen_calls.append((len(ai_played), len(your_played), results))
    free = [i for i, d in enumerate([A1, A2, A3]) if d not in ai_played]
    return free[0], {"believed": {"game": 50.0, "duel": 50.0}}


got = cdu.ai_picks([A1, A2, A3], [B1, B2, B3], "wl", first_free, 3)
check("one pick a game", [i for i, _ in got] == [0, 1, 2])
check("EACH PICK SEES ONLY YOUR EARLIER DECKS, never the one of its own game",
      [c[1] for c in seen_calls] == [0, 1, 2], str(seen_calls))
check("each pick is told the results from the AI's side", [c[2] for c in seen_calls] == ["", "l", "lw"])
check("it stops where it has nothing legal",
      len(cdu.ai_picks([A1], [B1, B2], "w", lambda a, y, r: (None if a else 0, None), 2)) == 2
      and cdu.ai_picks([A1], [B1, B2], "w", lambda a, y, r: (None if a else 0, None), 2)[1][0] is None)

print("the AI's read of you leans on what you showed before")
X, Y = deck("x"), deck("y")


def hist_read(revealed, lost):
    return [(X, 0.6)]


check("nothing seen is the read itself", cdu.blend_read(hist_read, []) is hist_read)
br = cdu.blend_read(hist_read, [A1], weight=0.5)
got = {tuple(sorted(c)): p for c, p in br((), None)}
check("half the read goes to the deck you showed, half of the rest stays",
      abs(got[tuple(sorted(A1))] - 0.5) < 1e-9 and abs(got[tuple(sorted(X))] - 0.3) < 1e-9, str(got))
got2 = {tuple(sorted(c)): p for c, p in br((frozenset(A1[:2] + Y[2:]),), None)}
check("a seen deck sharing a card with one you revealed this duel is not expected",
      tuple(sorted(A1)) not in got2 and abs(sum(got2.values()) - 0.6) < 1e-9, str(got2))
X_TECH = X[:6] + ["q1", "q2"]
got3 = {tuple(sorted(c)): p for c, p in cdu.blend_read(hist_read, [X_TECH], weight=0.5)((), None)}
check("a seen deck two cards off a read row adds to that row", len(got3) == 1
      and abs(got3[tuple(sorted(X))] - 0.8) < 1e-9, str(got3))

print("a rematch set")
import random  # noqa: E402
E = [{"cards": deck(c), "weight": w} for c, w in zip("abcdefg", (9, 7, 5, 4, 3, 2, 1))]
E.append({"cards": deck("a")[:4] + deck("h")[:4], "weight": 50})   # clashes with a
flat = lambda group: 0.5  # noqa: E731
s1 = cdu.vary_set(E, flat, random.Random(1))
check("four decks that share no card", len(s1) == 4 and
      len({c for i in s1 for c in E[i]["cards"]}) == 32, str(s1))
best_has_g = lambda group: 0.9 if deck("g") in group else 0.5  # noqa: E731
s2 = cdu.vary_set(E, best_has_g, random.Random(2), draws=200)
check("only a set within the band of the best is chosen", 6 in s2, str(s2))
base = frozenset(cdu.vary_set(E, flat, random.Random(3)))
s3 = frozenset(cdu.vary_set(E, flat, random.Random(3), avoid=base))
check("the set loaded last time is not chosen again while another qualifies", s3 != base)
rng_sets = {tuple(cdu.vary_set(E, flat, random.Random(k))) for k in range(12)}
check("different rematches draw different sets", len(rng_sets) > 3, str(len(rng_sets)))
clash = [{"cards": deck("a"), "weight": 1}, {"cards": deck("a")[:7] + ["z0"], "weight": 1},
         {"cards": deck("b"), "weight": 1}]
check("no set of three can be drawn from decks that clash: none", cdu.vary_set(clash, flat, random.Random(0)) is None)

print("a card switch")
S = [deck("a"), deck("b"), deck("c")]


def variants(cards):
    if cards == S[0]:
        return [{"cards": S[0][:7] + [S[1][0]], "games": 900},       # takes a card deck b holds
                {"cards": S[0][:7] + ["poison"], "games": 40}]
    return []


got_s, sw = cdu.switch_card(S, variants, random.Random(0), p=1.0)
check("a real one-card variant is switched in", sw == {"deck": 0, "out": S[0][7], "in": "poison", "games": 40}
      and got_s[0] == S[0][:7] + ["poison"], str(sw))
check("never a card another deck of the set holds", S[1][0] not in got_s[0])
check("the other decks are untouched", got_s[1:] == S[1:])
check("no switch when the dice say no", cdu.switch_card(S, variants, random.Random(0), p=0.0) == (S, None))
check("no switch that leaves a deck making no sense",
      cdu.switch_card(S, variants, random.Random(0), p=1.0, ok=lambda new, old: "poison" not in new)[1] is None)
check("no switch with no real variant", cdu.switch_card([S[1], S[2]], variants, random.Random(0), p=1.0)[1] is None)

print("the parts that decide a game read no file, database or network")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "coach_duel.py"), encoding="utf-8").read()
imports = sorted(line.split()[1] for line in src.splitlines() if line.startswith("import "))
check("module-level imports are the standard library and duel_plan",
      imports == ["duel_plan", "sys", "threading", "time", "traceback"], str(imports))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
