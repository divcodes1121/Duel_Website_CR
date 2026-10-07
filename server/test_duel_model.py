"""test_duel_model.py — the duel win model and how Coach Assist uses it.

    python server/test_duel_model.py

Synthetic games only; no database, no network, and the artifact is written to
a temp path.
"""

from __future__ import annotations

import os
import random
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import duel_model as dm  # noqa: E402

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


A = ["hog-rider", "musketeer", "cannon", "ice-spirit", "skeletons", "the-log", "fireball", "ice-golem"]
B = ["golem", "night-witch", "baby-dragon", "lumberjack", "tornado", "lightning", "barbarian-barrel", "mega-minion"]
W = {"pilot": 1.4, "level": 0.8, "p:hog-rider": 0.1, "p:golem": -0.05, "x:golem|hog-rider": -0.3}

print("\nantisymmetric by construction")
pab = dm.score(W, dm.features(A, B, 1.0, 0.5, 0.6, 0.45))
pba = dm.score(W, dm.features(B, A, 0.5, 1.0, 0.45, 0.6))
check("P(A beats B) = 1 - P(B beats A)", abs(pab + pba - 1.0) < 1e-12, (pab, pba))
check("mirror match with equal players and levels is 50%",
      abs(dm.score(W, dm.features(A, A)) - 0.5) < 1e-12)
check("a shared card cancels (no self-interaction)", "x:hog-rider|hog-rider" not in dm.features(A, A))
x = dm.features(A, B)
check("the counter key is ordered and signed", x.get("x:golem|hog-rider") == -1.0, x.get("x:golem|hog-rider"))

print("\nlevels and strength point the right way")
base = dm.score(W, dm.features(A, B))
check("being a level AHEAD (they have the bigger deficit) raises it",
      dm.score(W, dm.features(A, B, 0.0, 1.0)) > base)
check("being BEHIND lowers it", dm.score(W, dm.features(A, B, 1.0, 0.0)) < base)
check("the stronger player is favoured", dm.score(W, dm.features(A, B, my_str=0.7, opp_str=0.4)) > base)
check("strength shrinks a short record toward 50%",
      dm.strength(2, 2) < 0.6 and abs(dm.strength(0, 0) - 0.5) < 1e-12 and dm.strength(200, 150) > 0.7)

print("\ntraining learns a planted counter")
rnd = random.Random(3)
POOL = ["knight", "archers", "arrows", "zap", "valkyrie", "bats", "minions", "goblins", "princess",
        "tesla", "bomber", "wizard", "witch", "prince", "giant", "balloon"]
rows = []
for _ in range(6000):
    a = rnd.sample(POOL, 7) + ["inferno-dragon"]
    b = rnd.sample(POOL, 7) + ["mega-knight"]
    if rnd.random() < 0.5:
        a, b = b, a
    a_has_inferno = "inferno-dragon" in a
    y = 1 if rnd.random() < (0.75 if a_has_inferno else 0.25) else 0
    rows.append((dm.features(a, b), y))
w = dm.train(rows[:5000])
ev = dm.evaluate(w, rows[5000:])
held = [x for x, _y in rows[5000:] if x.get("p:inferno-dragon", 0) > 0]
learned = sum(dm.score(w, x) for x in held) / len(held)
check("held-out accuracy well above a coin on the planted counter", ev["accuracy"] > 68, ev)
check("the Inferno Dragon side is favoured on held-out games (true rate 75%)", learned > 0.62, learned)
check("evaluate reports n, log loss and accuracy", ev["n"] == 1000 and ev["logLoss"] < 0.65)
check("pilot and level are never shrunk by L2 (a dense signal keeps its weight)",
      dm.train([(dm.features(A, B, my_str=0.8, opp_str=0.2), 1)] * 200, l2=10.0)["pilot"] > 0.3)

print("\nexpected: weighted by likelihood")
M = {"weights": W}
e = dm.expected(M, A, [(B, 3), (A, 1)])
check("likelihoods are normalised", [v["likelihood"] for v in e["vs"]] == [0.75, 0.25], e["vs"])
want = 0.75 * dm.score(W, dm.features(A, B)) + 0.25 * 0.5
check("the win chance is the weighted mean, in percent", abs(e["winRate"] - round(100 * want, 1)) < 0.11, e)
check("no model or no opponents is None, never 50%",
      dm.expected({}, A, [(B, 1)]) is None and dm.expected(M, A, []) is None
      and dm.expected(M, A, [(B, 0)]) is None)

print("\ndeck_deficit")
check("mean over the deck", dm.deck_deficit(["a", "b"], {"a": 2, "b": 0}) == 1.0)
check("a missing card takes the mean of the known ones", dm.deck_deficit(["a", "b", "c"], {"a": 2, "b": 0}) == 1.0)
check("no collection is 0 for everyone (it cancels)", dm.deck_deficit(A, None) == 0.0 and dm.deck_deficit(A, {}) == 0.0)

print("\nswaps: only what real duel players changed, only what helps")
W2 = dict(W, **{"p:inferno-dragon": 0.6, "p:electro-wizard": 0.2})
M2 = {"weights": W2}
variants = [
    {"cards": [c if c != "cannon" else "inferno-dragon" for c in A], "games": 40, "players": 12},
    {"cards": [c if c != "cannon" else "electro-wizard" for c in A], "games": 90, "players": 30},
    {"cards": [c if c != "cannon" else "zap" for c in A], "games": 500, "players": 99},     # no help
    {"cards": [c for c in A if c not in ("cannon", "ice-spirit")] + ["bats", "arrows"], "games": 99, "players": 9},
]
sw = dm.swaps(M2, A, variants, [(B, 1)])
check("best gain first", [s["in"] for s in sw] == ["inferno-dragon", "electro-wizard"], sw)
check("a variant that does not help is dropped", all(s["in"] != "zap" for s in sw))
check("a two-card difference is not a swap", all(s["in"] != "bats" for s in sw))
check("each names what goes out, what comes in, and how often it was played",
      sw[0]["out"] == "cannon" and sw[0]["games"] == 40 and sw[0]["gain"] > 0.5)
check("a card already spent this duel is never offered",
      all(s["in"] != "inferno-dragon" for s in dm.swaps(M2, A, variants, [(B, 1)], used={"inferno-dragon"})))

print("\nthe artifact")
tmp = os.path.join(tempfile.mkdtemp(), "m.json")
dm.save({"pilot": 1.23456, "tiny": 1e-6}, {"games": 5}, path=tmp)
got = dm.load(tmp)
check("round-trips, rounded, near-zero weights dropped",
      got["weights"] == {"pilot": 1.23456} and got["meta"]["games"] == 5, got)
check("no file is None", dm.load(tmp + ".missing") is None)

print("\nCoach Assist: ordering only when every option is scored")
import coach  # noqa: E402
import duel_index as di  # noqa: E402
# THE PACKAGE GATE HAS ITS OWN SUITE (`test_deck_packages.py`). A host with real
# tables — the server has them — must not decide whether these invented
# variants are offered.
_real_constructed_ok = coach._constructed_ok
coach._constructed_ok = lambda cards, seed=None: True
saved = (dm.load, di.available, di.player_record, di.near_variants, coach.cd.cr_profile)
try:
    dm.load = lambda path=dm.PATH: {"weights": W2, "meta": {"games": 9, "holdout": {"accuracy": 63.2}}}
    di.available = lambda: True
    di.player_record = lambda tag: (100, 60) if tag == "#ME" else (100, 50)
    di.near_variants = lambda cards, **k: variants if set(cards) == set(A) else []
    coach.cd.cr_profile = lambda tag: None
    opp = {"decks": [{"cards": B, "prob": 1.0, "deckName": "Golem"}]}
    weak = [c if c != "hog-rider" else "goblins" for c in A]
    rows = [{"cards": weak, "deckName": "weak"}, {"cards": A, "deckName": "strong"}]
    out, info, swaps = coach._brain(rows, opp, "#ME", "#OPP", set())
    check("rows are re-ordered by the brain's win chance", [r["deckName"] for r in out] == ["strong", "weak"],
          [(r["deckName"], r["brain"]["winRate"]) for r in out])
    check("each row carries the reading, named per opponent deck",
          out[0]["brain"]["vs"][0]["name"] == "Golem" and "cards" not in out[0]["brain"]["vs"][0])
    check("info says it ranked, and carries the measured holdout", info["ranked"] and info["holdout"]["accuracy"] == 63.2)
    check("the stronger player's strength is reported", info["strength"]["mine"] > info["strength"]["theirs"])
    check("swaps are for the NEW top deck", swaps and swaps[0]["in"] == "inferno-dragon", swaps)
    check("the caller's rows are not mutated", "brain" not in rows[0])
    seen_seed: list = []
    coach._constructed_ok = lambda cards, seed=None: bool(seen_seed.append(seed))
    _o, _i, sw_gate = coach._brain(rows, opp, "#ME", "#OPP", set())
    check("a variant the package gate refuses is not offered, and it is judged against the deck it changes",
          sw_gate == [] and seen_seed and set(seen_seed[0]) == set(A), str(seen_seed[:1]))
    coach._constructed_ok = lambda cards, seed=None: True
    dm.load = lambda path=dm.PATH: None
    out2, info2, sw2 = coach._brain(rows, opp, "#ME", "#OPP", set())
    check("no trained model: the list stands exactly as ranked", out2 is rows and info2 is None and sw2 == [])
    dm.load = lambda path=dm.PATH: {"weights": W2, "meta": {}}
    out3, info3, _ = coach._brain(rows, {"decks": []}, "#ME", "#OPP", set())
    check("no opponent decks: untouched", out3 is rows and info3 is None)

    def boom(*a, **k):
        raise RuntimeError("index gone")
    di.player_record = boom
    out4, info4, _ = coach._brain(rows, opp, "#ME", "#OPP", set())
    check("a failure returns the rows untouched, never raises", out4 is rows and info4 is None)
finally:
    dm.load, di.available, di.player_record, di.near_variants, coach.cd.cr_profile = saved

print("\nthe COMBINED brain: the old brain's deck judgment + strength + levels")
from types import SimpleNamespace  # noqa: E402


class FakeRates:
    """The old brain's per-matchup rates, as coach._Rates answers them."""
    on = True

    def __init__(self, table):
        self.table = table
        self.prepared = []

    def rate(self, mine, theirs=None, archetype=None):
        v = self.table.get(",".join(sorted(mine)))
        return None if v is None else {"winRate": v, "games": 100, "source": "deck"}

    def prepare(self, mine, theirs):
        self.prepared.append(len(mine))


strong_deck = A
weak_deck = [c if c != "hog-rider" else "goblins" for c in A]
old_table = {",".join(sorted(strong_deck)): 48.0, ",".join(sorted(weak_deck)): 60.0}
saved = (dm.load, di.available, di.player_record, di.near_variants, coach.cd.cr_profile)
try:
    dm.load = lambda path=dm.PATH: {"weights": W2, "meta": {}}
    di.available = lambda: True
    di.player_record = lambda tag: (0, 0)
    di.near_variants = lambda cards, **k: variants if set(cards) == set(A) else []
    coach.cd.cr_profile = lambda tag: None
    opp = {"decks": [{"cards": B, "prob": 1.0, "deckName": "Golem"}]}
    rates = FakeRates(old_table)
    rows = [{"cards": strong_deck, "deckName": "strong-by-model"},
            {"cards": weak_deck, "deckName": "strong-by-old-brain"}]
    out, info, swaps = coach._brain(rows, opp, "#ME", "#OPP", set(), rates)
    check("equal players, no levels: the combined figure IS the old brain's rate",
          {r["deckName"]: r["brain"]["winRate"] for r in out}
          == {"strong-by-model": 48.0, "strong-by-old-brain": 60.0}, [(r["deckName"], r["brain"]) for r in out])
    check("ordering follows the combined brain, not the new model alone",
          out[0]["deckName"] == "strong-by-old-brain")
    check("the mode is reported as combined, with the measured head-to-head",
          info["mode"] == "combined" and info["measured"]["agree"] == 59.0)
    # A on top by the old brain, so the fake variants (which belong to A) are proposed.
    top_table = {",".join(sorted(strong_deck)): 60.0, ",".join(sorted(weak_deck)): 48.0}
    r5 = FakeRates(dict(top_table, **{",".join(sorted(v["cards"])): 55.0 for v in variants}))
    _o5, _i5, sw5 = coach._brain(rows, opp, "#ME", "#OPP", set(), r5)
    check("the proposed variants were prepared for the old brain first",
          bool(r5.prepared) and r5.prepared[0] > 0, r5.prepared)
    check("swaps the fast model proposes are dropped when the combined brain sees a loss", sw5 == [], sw5)
    r6 = FakeRates(top_table)
    _o6, _i6, sw6 = coach._brain(rows, opp, "#ME", "#OPP", set(), r6)
    check("a variant the old brain cannot rate is not compared against one it did", sw6 == [], sw6)

    di.player_record = lambda tag: (200, 150) if tag == "#ME" else (200, 80)
    out2, _i, _s = coach._brain(rows, opp, "#ME", "#OPP", set(), FakeRates(old_table))
    check("a stronger player lifts the old brain's rate",
          all(r["brain"]["winRate"] > old_table[",".join(sorted(r["cards"]))] for r in out2))

    di.player_record = lambda tag: (0, 0)
    good = {",".join(sorted(v["cards"])): 70.0 for v in variants}
    good.update(old_table)
    _o, _i, sw3 = coach._brain([rows[0]], opp, "#ME", "#OPP", set(), FakeRates(good))
    check("a swap both brains like is kept, with the combined gain (48 -> 70)",
          sw3 and sw3[0]["gain"] == 22.0 and sw3[0]["winRate"] == 70.0, sw3)
    none_rates = FakeRates({})
    out4, info4, _ = coach._brain(rows, opp, "#ME", "#OPP", set(), none_rates)
    check("where the old brain has no rate, the new model answers that matchup",
          all(r.get("brain") for r in out4) and all(r["brain"]["sources"] == {"model": 1} for r in out4))
finally:
    dm.load, di.available, di.player_record, di.near_variants, coach.cd.cr_profile = saved


print("\nnothing here calls the network or writes the bot's database")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "duel_model.py"), encoding="utf-8").read()
check("no network", "urlopen" not in src and "requests." not in src)
check("no database", "sqlite3" not in src)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
