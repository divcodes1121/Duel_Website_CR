"""test_duel_set.py — which decks to load for a duel.

    python server/test_duel_set.py

Plain asserts and a counter, like the other suites. `duel_set` knows no card
and no model: the decks are invented, `value` is a table written here, and the
substitutes and the `allow` check are functions written here.

What would be quietly wrong rather than broken:
  * a set is decks that share NO card — one shared card is not a set unless a
    swap removes it, and with no swaps allowed it is never offered;
  * four decks are loaded, so a set of four is never passed over for a better
    three;
  * a changed deck is checked as the deck it has become, against the deck it
    came from, and a deck the caller pins is never the one that changes;
  * a change has to buy something: equal sets go to the one left untouched.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import duel_set as ds  # noqa: E402

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ok  ", name)
    else:
        failed += 1
        print("  FAIL", name, detail)


def deck(tag, *shared):
    """Eight cards: the shared ones named, the rest this deck's own."""
    own = [f"{tag}{i}" for i in range(8 - len(shared))]
    return list(shared) + own


A, B, C, D, E = deck("a"), deck("b"), deck("c"), deck("d"), deck("e")


def worth(table, default=0.5):
    """`value` from {deck tag: points}: a set is worth the mean of its decks'."""
    calls = []

    def value(group):
        calls.append([sorted(d) for d in group])
        vals = [table.get(next(c for c in d if c[-1].isdigit())[:-1], default) for d in group]
        return sum(vals) / len(vals)
    value.calls = calls
    return value


print("a set is decks that share no card")
r = ds.compose([A, B, C], worth({}))
check("three decks that share nothing are a set, as given",
      r and r["size"] == 3 and [d["index"] for d in r["decks"]] == [0, 1, 2]
      and all(d["swaps"] == [] for d in r["decks"]) and r["swaps"] == 0 and r["brain"] == ds.BRAIN)
check("the answer carries the cards, in the caller's order", r["decks"][0]["cards"] == A)
A_LOG, B_LOG = deck("a", "log"), deck("b", "log")
check("two decks sharing a card are not a set when no swap is allowed",
      ds.compose([A_LOG, B_LOG, C], worth({})) is None)
check("...but the others still are", ds.compose([A_LOG, B_LOG, C, D], worth({}))["size"] == 3)
check("fewer than three decks is no set", ds.compose([A, B], worth({})) is None)
check("no decks is no set, not an error", ds.compose([], worth({})) is None and ds.compose(None, worth({})) is None)
check("a deck that is not eight different cards is not a candidate",
      ds.compose([A, B, C[:7], ["x"] * 8], worth({})) is None)
check("the same deck twice is one deck", ds.compose([A, list(reversed(A)), B], worth({})) is None)
# ...so a repeat does not use up a place in the pool: three places, A three times, then B and C.
check("a repeated deck does not take a second place in the pool",
      (ds.compose([A, list(reversed(A)), A, B, C], worth({}), pool=3) or {}).get("size") == 3)
check("clashes() names the shared cards and who holds them",
      ds.clashes([A_LOG, B_LOG, C]) == {"log": [0, 1]} and ds.clashes([A, B]) == {})

print("the best set of the largest size")
v = worth({"a": 0.9, "b": 0.8, "c": 0.7, "d": 0.2, "e": 0.1})
r4 = ds.compose([A, B, C, D, E], v)
check("FOUR ARE LOADED: a set of four is never passed over for a better three",
      r4["size"] == 4 and [d["index"] for d in r4["decks"]] == [0, 1, 2, 3], str(r4))
check("...and it is the best four (a, b, c, d over any with e)", abs(r4["value"] - (0.9 + 0.8 + 0.7 + 0.2) / 4) < 1e-12)
r3 = ds.compose([A, B, C, D, E], v, size=3)
check("asked for three, the best three", [d["index"] for d in r3["decks"]] == [0, 1, 2])
low = ds.compose([E, D, C, B, A], v, size=3)
check("the order of the candidates does not decide it; the value does",
      sorted(d["index"] for d in low["decks"]) == [2, 3, 4], str(low["decks"]))
tie = ds.compose([A, B, C, D], worth({}), size=3)
check("equal sets go to the earlier candidates (the caller's priority)",
      [d["index"] for d in tie["decks"]] == [0, 1, 2])
many = [deck(f"m{i}") for i in range(12)]
vm = worth({"m11": 1.0})
check("only the first POOL candidates are considered",
      all(d["index"] < ds.POOL for d in ds.compose(many, vm)["decks"]))
check("the caller can widen the pool", any(d["index"] == 11 for d in ds.compose(many, vm, pool=12)["decks"]))
check("it says how many sets it valued", r4["valued"] == 5 and len(v.calls) >= 5, str(r4["valued"]))

print("a deck the caller pins")
must = ds.compose([A, B, C, D, E], v, size=3, must=[4])
check("a pinned deck is in the set even when it is the worst", 4 in [d["index"] for d in must["decks"]])
check("...with the best two beside it", sorted(d["index"] for d in must["decks"]) == [0, 1, 4])
check("a pinned deck outside the pool is no set", ds.compose(many, vm, must=[11]) is None)

print("a shared card, resolved by a swap real players make")
SUBS = {"log": [("barrel", 400), ("snowball", 90)], "fire": [("poison", 120)]}


def subs(card):
    return SUBS.get(card, [])


allowed = []


def allow_all(new, seed):
    allowed.append((list(new), list(seed)))
    return True


r = ds.compose([A_LOG, B_LOG, C], worth({}), substitutes=subs, allow=allow_all)
check("with swaps allowed the three become a set", r and r["size"] == 3 and r["swaps"] == 1, str(r))
changed = [d for d in r["decks"] if d["swaps"]]
check("exactly one deck gives the card up, for its best substitute",
      len(changed) == 1 and changed[0]["swaps"] == [{"out": "log", "in": "barrel", "pairs": 400}]
      and "barrel" in changed[0]["cards"] and "log" not in changed[0]["cards"])
kept = [d for d in r["decks"] if d["index"] != changed[0]["index"] and "log" in d["cards"]]
check("...and the other keeps it", len(kept) == 1)
check("the result shares no card", ds.clashes([d["cards"] for d in r["decks"]]) == {})
check("the changed deck was checked as the deck it became, against the deck it came from",
      any("barrel" in new and "log" in seed and "log" not in new for new, seed in allowed))
check("the swapped card sits where the old one sat", changed[0]["cards"].index("barrel") == 0)

refuse_barrel = lambda new, seed: "barrel" not in new  # noqa: E731
r2 = ds.compose([A_LOG, B_LOG, C], worth({}), substitutes=subs, allow=refuse_barrel)
check("a substitute the check refuses is passed over for the next",
      [s["in"] for d in r2["decks"] for s in d["swaps"]] == ["snowball"])
check("when the check refuses every substitute there is no set",
      ds.compose([A_LOG, B_LOG, C], worth({}), substitutes=subs, allow=lambda n, s: False) is None)
check("a card with no substitute cannot be given up",
      ds.compose([deck("a", "rare"), deck("b", "rare"), C], worth({}), substitutes=subs, allow=allow_all) is None)
C_BARREL = deck("c", "barrel")
r3 = ds.compose([A_LOG, B_LOG, C_BARREL], worth({}), substitutes=subs, allow=allow_all)
check("a substitute already in the set is not brought in twice",
      [s["in"] for d in r3["decks"] for s in d["swaps"]] == ["snowball"], str(r3 and r3["decks"]))

print("which deck changes")
pin = ds.compose([A_LOG, B_LOG, C], worth({}), substitutes=subs, allow=allow_all, must=[0])
check("a pinned deck is never the one that changes",
      next(d for d in pin["decks"] if d["index"] == 0)["swaps"] == []
      and next(d for d in pin["decks"] if d["index"] == 1)["swaps"] != [])
both = ds.compose([A_LOG, B_LOG, C], worth({}), substitutes=subs, allow=allow_all, must=[0, 1])
check("two pinned decks sharing a card cannot be a set", both is None)
keep_b = ds.compose([A_LOG, B_LOG, C], worth({}), substitutes=subs,
                    allow=lambda new, seed: seed[1].startswith("a"))
check("the deck whose change the check allows is the one that changes",
      next(d for d in keep_b["decks"] if d["index"] == 0)["swaps"] != [])
got = ds.resolve([tuple(A_LOG), tuple(B_LOG), tuple(C)], subs, allow_all)
check("resolve() offers each way round", len(got) == 2 and all(ds.clashes(new) == {} for new, _s in got))
check("resolve() on decks that already fit returns them untouched",
      ds.resolve([tuple(A), tuple(B)], subs) == [([tuple(A), tuple(B)], [[], []])])

print("a change has to buy something")
plain = [A, B, C]
with_swap = [A_LOG, B_LOG, C, D]
# Untouched set (a_log, c, d) and swapped set (a_log, b_log', c): make them equal in value.
eq = worth({"a": 0.6, "b": 0.6, "c": 0.6, "d": 0.6})
r = ds.compose(with_swap, eq, size=3, substitutes=subs, allow=allow_all)
check("equal value: the set left untouched wins", r["swaps"] == 0, str(r["decks"]))
# The only set holding BOTH a and b needs the swap; d is what an untouched set has to take instead.
bit = worth({"a": 0.6, "b": 0.6, "c": 0.6, "d": 0.597})   # the swapped set is 0.1 point better
r = ds.compose(with_swap, bit, size=3, substitutes=subs, allow=allow_all)
check("a tenth of a point does not buy a change", r["swaps"] == 0, str(r["decks"]))
big = worth({"a": 0.9, "b": 0.9, "c": 0.6, "d": 0.1})     # a + b together: 0.800 against 0.533
r = ds.compose(with_swap, big, size=3, substitutes=subs, allow=allow_all)
check("twenty-seven points do", r["swaps"] == 1 and abs(r["value"] - (0.9 + 0.9 + 0.6) / 3) < 1e-12, str(r))
check("the value reported is the set's own, not less the cost", abs(r["value"] - 0.8) < 1e-12)
r = ds.compose(with_swap, big, size=3, substitutes=subs, allow=allow_all, swap_cost=0.5)
check("the cost is the caller's to set", r["swaps"] == 0)

print("too alike to be a set")
X = deck("x", "s1", "s2", "s3", "s4")
Y = deck("y", "s1", "s2", "s3", "s4")
wide = {c: [(f"{c}-alt", 50), (f"{c}-alt2", 40)] for c in ("s1", "s2", "s3", "s4")}
check("four shared cards are past what swaps may resolve",
      ds.compose([X, Y, C], worth({}), substitutes=lambda c: wide.get(c, []), allow=allow_all) is None)
X3, Y3 = deck("x", "s1", "s2", "s3"), deck("y", "s1", "s2", "s3")
r = ds.compose([X3, Y3, C], worth({}), substitutes=lambda c: wide.get(c, []), allow=allow_all)
check("three shared cards can be, with no deck changing more than two",
      r is not None and r["swaps"] == 3 and max(len(d["swaps"]) for d in r["decks"]) == 2, str(r))
check("...and the caller can tighten it",
      ds.compose([X3, Y3, C], worth({}), substitutes=lambda c: wide.get(c, []), allow=allow_all,
                 max_clashes=2) is None)
three = [deck("p", "log"), deck("q", "log"), deck("r", "log")]
r = ds.compose(three, worth({}), substitutes=subs, allow=allow_all)
check("a card in three decks stays in one and leaves two",
      r is not None and sum(1 for d in r["decks"] if "log" in d["cards"]) == 1
      and sorted(s["in"] for d in r["decks"] for s in d["swaps"]) == ["barrel", "snowball"], str(r))

print("nothing here reads a file, a database or the network")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "duel_set.py"), encoding="utf-8").read()
imports = sorted(line.split()[1] for line in src.splitlines() if line.startswith("import "))
check("duel_set imports the standard library only", imports == ["itertools"], str(imports))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
