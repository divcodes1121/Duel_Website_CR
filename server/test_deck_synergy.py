"""test_deck_synergy.py — do these eight cards go together the way duel decks do?

    python server/test_deck_synergy.py

Plain asserts and a counter, like the other suites. A temporary duel-index
file is written with the real `games` columns (`a_deck`/`b_deck` are sorted
comma-joined card keys, which is what the index stores); nothing real is read.

What would be quietly wrong rather than broken:
  * a deck made of cards that are always fielded together must out-pair a deck
    of the same cards shuffled into combinations nobody plays;
  * the percentile is against decks duel players REPEATEDLY field (10+ games,
    3+ pilots), not against every one-off pile;
  * a deck proven in duels (30+ games) passes whatever its cohesion;
  * NO TABLE IS NO GATE — a host without the file must keep its list, never
    empty it.
"""

from __future__ import annotations

import os
import random
import sqlite3
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deck_synergy as syn  # noqa: E402

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ok  ", name)
    else:
        failed += 1
        print("  FAIL", name, detail)


# Three real "archetypes" whose eight cards always travel together.
A = ["hog-rider", "musketeer", "ice-spirit", "cannon", "the-log", "ice-golem", "earthquake", "skeletons"]
B = ["golem", "night-witch", "baby-dragon", "lumberjack", "tornado", "lightning", "barbarian-barrel", "mega-minion"]
C = ["x-bow", "tesla", "archers", "knight", "fireball", "bats", "electro-spirit", "goblin-gang"]
# A pile: two cards from each, plus two — every pair is one nobody fields.
PILE = A[:3] + B[:3] + C[:2]


def key(cards):
    return ",".join(sorted(cards))


print("pure table: cohesive decks out-pair piles")
decks = {key(A): (400, 60), key(B): (300, 40), key(C): (200, 30), key(PILE): (2, 2)}
t = syn.table_from(decks)
check("a real deck is more cohesive than a pile of the same cards",
      syn.cohesion(A, t) > syn.cohesion(PILE, t), f"{syn.cohesion(A, t)} vs {syn.cohesion(PILE, t)}")
check("order of cards does not matter", syn.cohesion(list(reversed(A)), t) == syn.cohesion(A, t))
check("not eight distinct cards = no reading", syn.cohesion(A[:7], t) is None
      and syn.cohesion(A[:7] + A[:1], t) is None)
check("the pile is NOT in the reference (2 games, 2 pilots)", t["refDecks"] == 3, str(t["refDecks"]))
check("101 quantile cut points, non-decreasing",
      len(t["quantiles"]) == 101 and t["quantiles"] == sorted(t["quantiles"]))
check("the pile sits below the gate", syn.percentile(PILE, t) < syn.GATE_PCT
      and not syn.passes(PILE, t), str(syn.percentile(PILE, t)))
check("each real deck passes", all(syn.passes(d, t) for d in (A, B, C)))
check("proven: 30+ duel games", syn.proven(A, t) and not syn.proven(PILE, t))
check("a proven deck without wins in its input has a record with wins unknown",
      syn.duel_record(A, t) == [400, None] and syn.duel_record(PILE, t) is None)
t_w = syn.table_from({key(A): (400, 60, 230)})
check("with wins, the record is [games, wins]", syn.duel_record(A, t_w) == [400, 230])
check("a table from before records were kept (a list) still answers proven",
      syn.proven(A, {**t, "proven": [key(A)]}) and not syn.proven(PILE, {**t, "proven": [key(A)]}))
wp = syn.weakest_pairs(PILE, t)
check("the weakest pairs are cross-archetype pairs",
      len(wp) == 2 and all(not (set(p) <= set(A) or set(p) <= set(B) or set(p) <= set(C)) for p in wp),
      str(wp))

print("\na proven deck passes whatever it scores")
t2 = syn.table_from({**decks, key(PILE): (35, 20)})
check("the same pile, fielded in 35 duel games by 20 pilots, is proven and passes",
      syn.proven(PILE, t2) and syn.passes(PILE, t2))

print("\nno table is no gate")
check("passes() with an empty table is True (the list is kept, never emptied)",
      syn.passes(PILE, {}) is True)
check("percentile() without a table is None", syn.percentile(PILE, {}) is None)
check("cohesion() without a table is None", syn.cohesion(A, {}) is None)

print("\nbuild() reads the index's games table read-only and writes its own file")
tmp = tempfile.mkdtemp()
idx = os.path.join(tmp, "idx.db")
out = os.path.join(tmp, "syn.json")
con = sqlite3.connect(idx)
con.execute("CREATE TABLE games(gid TEXT PRIMARY KEY, battle_time TEXT NOT NULL, mode TEXT NOT NULL,"
            " round INTEGER NOT NULL, a_tag TEXT NOT NULL, b_tag TEXT NOT NULL, a_deck TEXT NOT NULL,"
            " b_deck TEXT NOT NULL, a_crowns INTEGER NOT NULL, b_crowns INTEGER NOT NULL,"
            " winner INTEGER NOT NULL)")
rnd = random.Random(3)
now = time.time()
recent = time.strftime("%Y%m%dT%H%M%S.000Z", time.gmtime(now - 86400))
old = time.strftime("%Y%m%dT%H%M%S.000Z", time.gmtime(now - 90 * 86400))
rows = []
for i in range(300):
    d1, d2 = rnd.sample([A, B, C], 2)
    rows.append((f"g{i}", recent, "Duel", 1, f"#P{i % 40}", f"#Q{i % 37}", key(d1), key(d2), 1, 0,
                 1 if i % 3 else 2))
# An OLD pile game is outside the window and must not count.
rows.append(("old", old, "Duel", 1, "#Z1", "#Z2", key(PILE), key(A), 1, 0, 1))
con.executemany("INSERT INTO games VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
con.commit()
con.close()
r = syn.build(idx, out, now=now)
check("three decks in the window (the old pile is outside it)", r["decks"] == 3, str(r))
check("the gate's cohesion is stated", r["gateCohesion"] is not None)
loaded = syn.load(out)
check("load() reads it back", loaded and loaded["refDecks"] == 3 and "quantiles" in loaded)
check("status fields are there", all(k in loaded for k in ("builtAt", "gatePct", "gateCohesion")))
rec = syn.duel_record(A, loaded)
check("build() keeps each proven deck's games and wins, and they add up",
      rec is not None and rec[0] >= 30 and 0 < rec[1] < rec[0]
      and sum(v[0] for v in loaded["proven"].values()) == 600
      and sum(v[1] for v in loaded["proven"].values()) == 300, str(loaded["proven"]))
check("a pile the window never saw still gets a reading, and fails",
      syn.percentile(PILE, loaded) == 0 and not syn.passes(PILE, loaded))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
