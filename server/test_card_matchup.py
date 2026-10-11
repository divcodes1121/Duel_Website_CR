"""Checks for card_matchup.py — the arithmetic, the artifact, the stack.

No database, no numpy. Run directly: `python server/test_card_matchup.py`.
"""
import json
import os
import random
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import card_matchup as cm  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print(f"FAIL: {name} {detail}")


CARDS = [f"c{i:02d}" for i in range(20)]
rnd = random.Random(4)
BODY = {
    "brain": cm.BRAIN,
    "main": {c: round(rnd.uniform(-0.3, 0.3), 4) for c in CARDS},
    "pair": {f"{a}|{b}": round(rnd.uniform(-0.5, 0.5), 4)
             for i, a in enumerate(CARDS) for b in CARDS[i + 1:]},
    "meta": {"trainedAt": "2026-10-11T00:00:00Z", "ladderGames": 10, "duelGames": 5,
             "holdout": {"n": 3, "gain": 0.03}},
}
M = cm.prepare(BODY)


def deck():
    return rnd.sample(CARDS, 8)


# ── the model ────────────────────────────────────────────────────────────────
check("an artifact prepares into a model", M is not None and len(M["cards"]) == 20)
check("a pair weight is stored both ways round with opposite signs",
      all(abs(M["x"][a][b] + M["x"][b][a]) < 1e-12 for a in CARDS for b in M["x"][a]))
a_, b_ = "c00", "c01"
check("positive pair weight a|b means a beats b",
      abs(M["x"][a_][b_] - BODY["pair"]["c00|c01"]) < 1e-12)

pairs = [(deck(), deck()) for _ in range(200)]
check("antisymmetric: A against B is minus B against A",
      all(abs(cm.raw(M, a, b) + cm.raw(M, b, a)) < 1e-9 for a, b in pairs))
check("a deck against itself is level", all(abs(cm.raw(M, a, a)) < 1e-9 for a, _ in pairs))
check("the prepared opponent gives the term-by-term figure",
      all(abs(cm.score(cm.vector(M, b), a) - cm.raw(M, a, b)) < 1e-9 for a, b in pairs))

# By hand, on a model of three cards.
tiny = cm.prepare({"main": {"a": 0.2, "b": -0.1, "c": 0.05}, "pair": {"a|b": 0.4, "b|c": -0.3}})
check("by hand: [a] against [b] = main gap + a beats b",
      abs(cm.raw(tiny, ["a"], ["b"]) - (0.2 + 0.1 + 0.4)) < 1e-12)
check("by hand: [b] against [c] reads the pair as stored (c beats b)",
      abs(cm.raw(tiny, ["b"], ["c"]) - (-0.1 - 0.05 - 0.3)) < 1e-12)
check("by hand: [c] against [b] flips it",
      abs(cm.raw(tiny, ["c"], ["b"]) - (0.05 + 0.1 + 0.3)) < 1e-12)
check("by hand: a card both hold cancels in the main terms and has no pair with itself",
      abs(cm.raw(tiny, ["a", "b"], ["b", "c"]) - (0.2 - 0.05 + 0.4 + 0.0 - 0.3)) < 1e-12,
      str(cm.raw(tiny, ["a", "b"], ["b", "c"])))
check("a card the model has never seen is neutral",
      abs(cm.raw(M, pairs[0][0][:7] + ["new-card"], pairs[0][1])
          - cm.raw(M, pairs[0][0][:7], pairs[0][1])) < 1e-12)

# ── the average opponent ─────────────────────────────────────────────────────
d1, d2, mine = deck(), deck(), deck()
check("a share of 1 for each of eight cards is that deck",
      abs(cm.score(cm.vector(M, {c: 1.0 for c in d1}), mine) - cm.raw(M, mine, d1)) < 1e-9)
share = {}
for d, w in ((d1, 0.75), (d2, 0.25)):
    for c in d:
        share[c] = share.get(c, 0.0) + w
mix = 0.75 * cm.raw(M, mine, d1) + 0.25 * cm.raw(M, mine, d2)
check("the fixture's decks overlap, so the next check is not about disjoint decks",
      set(mine) & set(d1) and set(mine) & set(d2) and set(d1) & set(d2))
check("two lists mixed by share score EXACTLY as the mix of the two (linear in their deck)",
      abs(cm.score(cm.vector(M, share), mine) - mix) < 1e-9,
      f"{cm.score(cm.vector(M, share), mine)} {mix}")
check("...and a different mix is a different opponent",
      abs(cm.score(cm.vector(M, {c: 1.0 for c in d2}), mine) - mix) > 1e-6)

# ── the figure ───────────────────────────────────────────────────────────────
check("the stack is the fitted one", (cm.STACK_FUSED, cm.STACK_MODEL) == (0.19, 1.0))
check("level and level is 50", cm.combine(50.0, 0.0) == 50.0)
check("the model alone moves a level fused rate by its own logit",
      abs(cm.combine(50.0, 0.4) - round(100 * cm.sig(0.4), 1)) < 1e-9)
check("more fused rate is more figure", cm.combine(60.0, 0.1) > cm.combine(55.0, 0.1))
check("more model is more figure", cm.combine(55.0, 0.3) > cm.combine(55.0, 0.1))
check("by hand", abs(cm.combine(62.0, -0.25)
                     - round(100 * cm.sig(0.19 * cm.logit(0.62) - 0.25), 1)) < 1e-9)
check("it stays a percentage at the ends",
      0.0 <= cm.combine(0.0, -9) <= cm.combine(100.0, 9) <= 100.0)
check("one decimal, the site's unit", cm.combine(57.3, 0.123) == round(cm.combine(57.3, 0.123), 1))

# ── the artifact ─────────────────────────────────────────────────────────────
tmp = tempfile.mkdtemp(prefix="card-matchup-test-")
path = os.path.join(tmp, "m.json")
check("no file is no model", cm.load(path) is None and cm.stamp(path) is None)
check("...and the status says so", cm.status(path) == {"available": False})
with open(path, "w", encoding="utf-8") as f:
    f.write("{not json")
check("a file that cannot be read is no model, not an error", cm.load(path) is None)
time.sleep(0.02)
with open(path, "w", encoding="utf-8") as f:
    json.dump(BODY, f)
os.utime(path, (time.time() + 5, time.time() + 5))
got = cm.load(path)
check("a written artifact loads", got is not None and abs(cm.raw(got, d1, d2) - cm.raw(M, d1, d2)) < 1e-12)
check("the same file is not read twice", cm.load(path) is got)
check("it has a stamp", isinstance(cm.stamp(path), float))
BODY2 = dict(BODY, main=dict(BODY["main"], c00=9.0))
with open(path, "w", encoding="utf-8") as f:
    json.dump(BODY2, f)
os.utime(path, (time.time() + 10, time.time() + 10))
check("a changed file is read again", cm.load(path)["main"]["c00"] == 9.0)
st = cm.status(path)
check("the status carries what the trainer measured",
      st["available"] and st["brain"] == cm.BRAIN and st["cards"] == 20 and st["pairs"] == 190
      and st["trainedAt"] == "2026-10-11T00:00:00Z" and st["holdout"]["gain"] == 0.03
      and st["stack"] == [0.19, 1.0], str(st))
with open(path, "w", encoding="utf-8") as f:
    json.dump({"brain": "x", "main": {}, "pair": {}}, f)
os.utime(path, (time.time() + 15, time.time() + 15))
check("an artifact with no weights is no model", cm.load(path) is None)
check("a pair of a card with itself is dropped",
      cm.prepare({"main": {"a": 1.0}, "pair": {"a|a": 3.0, "|b": 1.0}})["x"] == {})
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "card_matchup.py"),
           encoding="utf-8").read()
check("the module is pure, by its imports", "import numpy" not in src and "import sqlite3" not in src
      and "import scipy" not in src)

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
