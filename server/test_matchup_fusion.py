"""test_matchup_fusion.py — one matchup rate from the ladder and the duels.

    python server/test_matchup_fusion.py

Pure arithmetic, against literals: no database, no card data. The constants
were fitted on a temporal holdout of real duel games (see the module
docstring); these checks pin them, and pin what each step does with them.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matchup_fusion as mf  # noqa: E402

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


def near(a, b, tol=1e-9):
    return abs(a - b) <= tol


print("\n-- the fitted constants --")
check("a duel game is worth four ladder games", mf.ALPHA == 4.0)
check("the variants prior shrinks with K = 10", mf.K_CLUSTER == 10.0)
check("the archetype level shrinks with K = 100", mf.K_ARCH == 100.0)
check("the family level shrinks with K = 30", mf.K_FAMILY == 30.0)
check("the version level shrinks with K = 30", mf.K_VERSION == 30.0)
check("a matrix cell needs the site's 8 games", mf.MATRIX_MIN == 8)
check("a level is NAMED the source at 8 games", mf.SOURCE_MIN == 8.0)


print("\n-- one step --")
p, n = mf.step(0.6, None, None, 30)
check("no evidence leaves the prior exactly as it was", p == 0.6 and n == 0.0)
p, n = mf.step(0.5, (30, 21), None, 30)
check("ladder evidence: (wins + K*prior) / (games + K)", near(p, (21 + 15) / 60) and n == 30)
p1, n1 = mf.step(0.5, None, (10, 7), 30)
p2, n2 = mf.step(0.5, (40, 28), None, 30)
check("one duel game carries the weight of four ladder games",
      near(p1, p2) and n1 == n2 == 40, f"{p1} {p2}")
p, n = mf.step(0.5, (10, 14), None, 30)
check("more wins than games is clamped to the games", near(p, (10 + 15) / 40))
p, n = mf.step(0.5, (10, -3), None, 30)
check("negative wins are clamped to zero", near(p, 15 / 40))
p, n = mf.step(0.5, (0, 0), (0, 0), 30)
check("zero games is no evidence", p == 0.5 and n == 0.0)


print("\n-- the whole chain --")
got = mf.fused((0.5, 100), arch_ladder=(200, 120), arch_duel=(50, 30), fam_ladder=(40, 28),
               ver_ladder=(30, 20), ver_duel=(5, 4))
# p1 = (120 + 4*30 + 100*0.5) / (200 + 4*50 + 100) = 290 / 500 = 0.58
# p2 = (28 + 30*0.58) / (40 + 30)                = 45.4 / 70
# p3 = (20 + 4*4 + 30*p2) / (30 + 4*5 + 30)
p1 = 290 / 500
p2 = (28 + 30 * p1) / 70
p3 = (36 + 30 * p2) / 80
check("hand-computed three-level example", got and got["winRate"] == round(100 * p3, 1),
      str(got))
check("its evidence is the version levels together (40 + 50 games)",
      got and got["games"] == 90 and got["source"] == mf.SOURCE_VERSION)
check("each level's evidence is published",
      got and got["levels"] == {"cluster": 0.0, "archetype": 400.0, "family": 40.0,
                                "version": 50.0})
check("and which brain produced it", got and got["brain"] == mf.FUSION_VERSION)

check("nothing at all is None, never 50%", mf.fused(None) is None)
check("a matrix cell under 8 games is not a prior", mf.fused((0.7, 7)) is None)
m = mf.fused((0.62, 40))
check("the matrix alone is an archetype-level answer",
      m and m["winRate"] == 62.0 and m["source"] == mf.SOURCE_ARCHETYPE and m["games"] == 40)
m = mf.fused(None, arch_ladder=(12, 9))
check("with no matrix the prior is 50/50 and the evidence still counts",
      m and m["winRate"] == round(100 * (9 + 50) / 112, 1) and m["source"] == mf.SOURCE_DECK)
m = mf.fused((0.5, 100), arch_ladder=(7, 7))
check("seven games is not enough to name the deck level",
      m and m["source"] == mf.SOURCE_ARCHETYPE, str(m))
m = mf.fused((0.5, 100), arch_ladder=(8, 8))
check("eight games is", m and m["source"] == mf.SOURCE_DECK and m["games"] == 8)
m = mf.fused((0.5, 100), arch_ladder=(400, 200), ver_ladder=(4, 4))
check("version evidence under 8 games leaves the deck level named",
      m and m["source"] == mf.SOURCE_DECK and m["games"] == 400)
m = mf.fused((0.5, 100), fam_duel=(2, 2))
check("two duel games are eight ladder games' worth, enough to name the level",
      m and m["source"] == mf.SOURCE_VERSION and m["games"] == 8, str(m))


print("\n-- the variants prior --")
m = mf.fused((0.5, 100), cluster=(300, 210))
check("a list's variants move the prior before the list's own record is read",
      m and m["winRate"] == round(100 * (210 + 10 * 0.5) / 310, 1)
      and m["source"] == mf.SOURCE_CLUSTER, str(m))
m = mf.fused((0.5, 100), cluster=(300, 210), arch_ladder=(50, 20))
check("and the list's own record is then shrunk toward that, not toward the matrix",
      m and m["winRate"] == round(100 * (20 + 100 * (215 / 310)) / 150, 1)
      and m["source"] == mf.SOURCE_DECK, str(m))
check("the variants level carries the ladder's own source name",
      mf.SOURCE_CLUSTER == "cluster7")
check("variants alone, with no matrix, still answer",
      mf.fused(None, cluster=(20, 15)) is not None)
try:
    mf.fused((0.5, 100), (10, 5))
    positional = True
except TypeError:
    positional = False
check("evidence cannot be passed positionally", not positional)


print("\n-- what the shrinkage is for --")
base = mf.fused((0.5, 5000), arch_ladder=(2000, 1100))
thin = mf.fused((0.5, 5000), arch_ladder=(2000, 1100), fam_ladder=(3, 3))
check("three wins against a family barely move a well-evidenced list",
      base and thin and 0 < thin["winRate"] - base["winRate"] < 5,
      f"{base and base['winRate']} -> {thin and thin['winRate']}")
thick = mf.fused((0.5, 5000), arch_ladder=(2000, 1100), fam_ladder=(600, 480))
check("six hundred games against the family move it most of the way",
      thick and thick["winRate"] > 75, str(thick and thick["winRate"]))
lo = mf.fused((0.5, 100), arch_ladder=(100, 40), fam_ladder=(50, 20))
hi = mf.fused((0.5, 100), arch_ladder=(100, 40), fam_ladder=(50, 35))
check("more wins at a level never lowers the rate", lo["winRate"] < hi["winRate"])
extreme = mf.fused((1.0, 100), arch_ladder=(10000, 10000), arch_duel=(10000, 10000),
                   fam_duel=(10000, 10000))
check("a rate never leaves 0..100", 0 <= extreme["winRate"] <= 100)


print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
