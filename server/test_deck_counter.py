"""test_deck_counter.py — invariants of the matchup engine.

    python server/test_deck_counter.py

No database: a snapshot is injected by hand, so the rules are tested on counts
written out here rather than on whatever the archive happens to hold.

The case that matters most is the SYMMETRISATION. The stored table is recorded
from the tracked player's side and tracked players win ~58.6% of everything, so
reading a raw cell makes every deck look like a counter. The check that the
correction is right is that a mirror must come out at exactly 50%, and that is
asserted below on a deliberately lopsided fixture.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deck_counter as dc  # noqa: E402
import duel_combos as dx  # noqa: E402

PASS = 0
FAIL = 0
NL = chr(10)


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


def cell(w, l, d=0, ac=0, bc=0, a3=0, b3=0):
    return {"w": w, "l": l, "d": d, "g": w + l + d, "ac": ac, "bc": bc,
            "a3": a3, "b3": b3}


# A fixture with the real bias baked in: whoever is deck_a wins 70% of the time,
# including in the mirror, which is impossible in reality.
SNAP = {
    "cells": {
        "hog|hog": cell(70, 30, ac=100, bc=60, a3=10, b3=4),
        "hog|golem": cell(70, 30, ac=90, bc=50, a3=12, b3=3),
        "golem|hog": cell(70, 30, ac=95, bc=55, a3=9, b3=5),
        "xbow|hog": cell(90, 10, ac=120, bc=30, a3=20, b3=1),
        "hog|xbow": cell(30, 70, ac=40, bc=110, a3=2, b3=18),
        "mortar|hog": cell(4, 1),          # under the floor
        "golem|golem": cell(70, 30),
    },
    "archetypes": ["golem", "hog", "mortar", "xbow"],
    "rawBias": 70.0,
    "battles": 800,
    "computedAt": 0,
}


# ── the correction ──────────────────────────────────────────────────────────

print("\nsymmetrisation")
m = dc._symmetric(SNAP, "hog", "hog")
check("a mirror comes out at exactly 50%, however biased the raw cell",
      m["winRate"] == 50.0, f"got {m['winRate']} from a raw 70%")
check("and counts both directions", m["games"] == 200, f"got {m['games']}")

g = dc._symmetric(SNAP, "hog", "golem")
check("a balanced pair of cells also lands at 50%",
      g["winRate"] == 50.0, f"got {g['winRate']}")
check("golem's view is the exact complement",
      dc._symmetric(SNAP, "golem", "hog")["winRate"] == 50.0)

x = dc._symmetric(SNAP, "xbow", "hog")
# 90-10 one way and 30-70 the other means 160 wins from 200 once combined, not
# 90% — the reverse cell carries real games and they count.
check("a real edge survives the correction", x["winRate"] == 80.0, f"got {x['winRate']}")
check("and reverses cleanly for the other side",
      dc._symmetric(SNAP, "hog", "xbow")["winRate"] == 20.0)
check("crowns are swapped with the reversed cell, not added blindly",
      x["avgCrownsFor"] == round(230 / 200, 2), f"got {x['avgCrownsFor']}")
check("three-crown shares follow the same swap",
      x["threeCrownFor"] == round(100 * 38 / 200, 1), f"got {x['threeCrownFor']}")

print("\nthe evidence floor")
check("a matchup under the floor is not reported at all",
      dc._symmetric(SNAP, "mortar", "hog") is None)
check("the floor is the pair board's, not a new number",
      dc.MIN_GAMES == dx.CONF_MIN_GAMES == 8)
check("an archetype pair nobody has played is None",
      dc._symmetric(SNAP, "xbow", "golem") is None)


# ── the two database readers, stubbed ───────────────────────────────────────
#
# `deck_profile` and `exact_pair` are the only functions here that open SQLite.
# They are replaced so this suite keeps its promise of running anywhere, and so
# the backoff can be tested by DECIDING what evidence exists rather than by
# hoping the archive happens to contain some.

_PROFILES: dict[str, dict] = {}
_CLUSTERS: dict[tuple[str, int], dict] = {}
_EXACT: dict[tuple[str, str], dict] = {}
EMPTY_PROFILE = {"archetypes": {}, "overall": None, "battles": 0, "decks": 0}


def fake_profile(cards):
    return _PROFILES.get(",".join(sorted(set(cards))), EMPTY_PROFILE)


def fake_cluster(cards, overlap):
    return _CLUSTERS.get((",".join(sorted(set(cards))), overlap), EMPTY_PROFILE)


def fake_exact(a, b):
    return _EXACT.get((",".join(sorted(set(a))), ",".join(sorted(set(b)))))


dc.deck_profile = fake_profile
dc.cluster_profile = fake_cluster
dc.exact_pair = fake_exact


# ── find counters ───────────────────────────────────────────────────────────

print("\nfind counters")
dc._snapshot = SNAP
# A full deck list, so the archetype has to be derived rather than looked up.
HOG = ["hog-rider", "musketeer", "cannon", "skeletons", "ice-spirit",
       "fireball", "the-log", "knight"]
check("an unknown deck resolves to an ARCHETYPE key, not a card key",
      dc.archetype_of(HOG) == "hog", dc.archetype_of(HOG))
check("Miner takes priority, as in the bot", dc.archetype_of(["miner", "golem"]) == "miner")
check("Goblin Barrel means bait", dc.archetype_of(["goblin-barrel", "knight"]) == "bait")
check("priority order decides between two win conditions",
      dc.archetype_of(["hog-rider", "golem"]) == "golem")
check("a deck with no win condition is 'other'",
      dc.archetype_of(["knight", "archers"]) == "other")

res = dc.find_counters(HOG)
names = [c["archetype"] for c in res["counters"]]
check("only archetypes that actually beat it are listed", names == ["xbow"], f"got {names}")
check("a 50% mirror is not called a counter", "hog" not in names)
check("nor is a losing archetype", "golem" not in names)
check("how many were weighed is reported", res["considered"] >= 3, str(res.get("considered")))
check("the target's record against the field is given",
      res["overall"]["winRate"] is not None)
check("counter advantage is measured against that field average",
      res["counters"][0]["advantage"] ==
      round(res["counters"][0]["winRate"] - (100 - res["overall"]["winRate"]), 1))
check("each counter carries its own evidence tier", res["counters"][0]["tier"] is not None)

print("\nstyle grouping")
check("styles are a documented map, not a database column",
      dc.style_of("golem") == "Beatdown" and dc.style_of("xbow") == "Siege"
      and dc.style_of("bridge-spam") == "Bridge Spam")
check("an archetype nobody classified falls back to Mixed",
      dc.style_of("brand-new-thing") == "Mixed")
check("the style split only counts archetypes that beat the target",
      all(s["share"] <= 100 for s in res["styles"])
      and abs(sum(s["share"] for s in res["styles"]) - 100) < 0.2)


# ── no snapshot yet ─────────────────────────────────────────────────────────

print("\nbefore the matrix has been built")
dc._snapshot = None
empty = dc.find_counters(HOG)
check("find_counters degrades to an empty board rather than raising",
      empty["counters"] == [] and empty["target"]["archetype"])
vs = dc.deck_vs_deck(HOG, ["golem"])
check("deck_vs_deck still names both sides", vs["a"]["name"] and vs["b"]["name"])
check("and says there is no matchup rather than inventing one", vs["matchup"] is None)
check("status reports that it is still building", dc.status()["building"] is True)

dc._snapshot = SNAP
print("\nmirror detection")
check("the SAME EIGHT CARDS is a mirror",
      dc.deck_vs_deck(HOG, HOG)["mirror"] is True)

# Two Hog decks that differ by one card are not a mirror. They used to be:
# `mirror` compared archetypes, so any two Hog lists were declared identical
# and handed 50% by construction.
HOG_ALT = ["hog-rider", "musketeer", "cannon", "skeletons", "ice-spirit",
           "fireball", "the-log", "ice-golem"]
alt = dc.deck_vs_deck(HOG, HOG_ALT)
check("two DIFFERENT lists of one archetype are not", alt["mirror"] is False)
check("but the screen can still say they share an archetype",
      alt["sameArchetype"] is True)


# ── the backoff: the cards decide, and the answer says how ──────────────────
#
# The complaint this pins: "I am changing cards along Hog Rider and the record
# stays the same." It did, because every Hog deck was answered with the Hog
# archetype's row. Now the pasted list is looked up first and only an unplayed
# deck falls back to the average.

print("\nwhich record answered")

GOLEM = ["golem", "baby-dragon", "mega-minion", "tornado", "lightning",
         "barbarian-barrel", "night-witch", "elixir-collector"]
k_hog, k_alt = ",".join(sorted(HOG)), ",".join(sorted(HOG_ALT))

_PROFILES.clear(); _CLUSTERS.clear(); _EXACT.clear()
res = dc.deck_vs_deck(HOG, GOLEM)
check("with no record of either deck it falls back to the archetype",
      res["source"] == dc.SOURCE_ARCHETYPE, str(res["source"]))

# This exact Hog list has its own record against Golem.
_PROFILES[k_hog] = {
    "archetypes": {"golem": {"games": 400, "wins": 120, "losses": 280, "draws": 0,
                             "winRate": 30.0, "avgCrownsFor": 0.9,
                             "avgCrownsAgainst": 1.4, "crownDiff": -0.5,
                             "threeCrownFor": 4.0, "threeCrownAgainst": 12.0,
                             "tier": "high", "interval": "+-4%"}},
    "overall": {"winRate": 48.0, "games": 4000}, "battles": 4000,
}
res = dc.deck_vs_deck(HOG, GOLEM)
check("this exact deck's own record is preferred over the archetype",
      res["source"] == dc.SOURCE_DECK, str(res["source"]))
check("and it is the number reported", res["matchup"]["winRate"] == 30.0,
      str(res["matchup"]["winRate"]))
check("the archetype average would have said something else",
      dc._symmetric(SNAP, "hog", "golem")["winRate"] != 30.0)
check("the deck's own battle count travels with it", res["a"]["battles"] == 4000)

# THE HEADLINE: swap one card and the answer changes.
_PROFILES[k_alt] = {
    "archetypes": {"golem": {"games": 250, "wins": 175, "losses": 75, "draws": 0,
                             "winRate": 70.0, "avgCrownsFor": 1.7,
                             "avgCrownsAgainst": 0.8, "crownDiff": 0.9,
                             "threeCrownFor": 18.0, "threeCrownAgainst": 3.0,
                             "tier": "high", "interval": "+-6%"}},
    "overall": {"winRate": 55.0, "games": 2500}, "battles": 2500,
}
a = dc.deck_vs_deck(HOG, GOLEM)["matchup"]["winRate"]
b = dc.deck_vs_deck(HOG_ALT, GOLEM)["matchup"]["winRate"]
check("changing ONE card changes the matchup", a != b, f"{a} vs {b}")
check("and both are the deck's own record, not the archetype's",
      dc.deck_vs_deck(HOG_ALT, GOLEM)["source"] == dc.SOURCE_DECK)

# An exact pair beats even that.
_EXACT[(k_hog, ",".join(sorted(GOLEM)))] = {
    "a": "hog", "b": "golem", "games": 40, "wins": 30, "losses": 10, "draws": 0,
    "winRate": 75.0, "avgCrownsFor": 1.9, "avgCrownsAgainst": 0.6,
    "crownDiff": 1.3, "threeCrownFor": 20.0, "threeCrownAgainst": 2.0,
    "tier": "medium", "interval": "+-13%",
}
res = dc.deck_vs_deck(HOG, GOLEM)
check("two lists that have actually met beat every generalisation",
      res["source"] == dc.SOURCE_EXACT and res["matchup"]["winRate"] == 75.0,
      f"{res['source']} {res['matchup']['winRate']}")

# ── widening, when the exact list is not enough ─────────────────────────────
#
# "if not then >7 cards then >6". The rungs are the pasted deck's own evidence,
# widened — not the other deck's, and not the archetype's.

_EXACT.clear(); _PROFILES.clear(); _CLUSTERS.clear()


def cluster(win, games, decks):
    return {
        "archetypes": {"golem": {"games": games, "wins": int(games * win / 100),
                                 "losses": games - int(games * win / 100),
                                 "draws": 0, "winRate": win, "avgCrownsFor": 1.1,
                                 "avgCrownsAgainst": 1.2, "crownDiff": -0.1,
                                 "threeCrownFor": 8.0, "threeCrownAgainst": 9.0,
                                 "tier": "high", "interval": "+-2%"}},
        "overall": {"winRate": win, "games": games}, "battles": games,
        "decks": decks,
    }


_CLUSTERS[(k_hog, 7)] = cluster(41.0, 69736, 1405)
_CLUSTERS[(k_hog, 6)] = cluster(44.0, 77381, 4439)
res = dc.deck_vs_deck(HOG, GOLEM)
check("with no exact record it widens to one-card-different, not the archetype",
      res["source"] == dc.SOURCE_C7, str(res["source"]))
check("and says how many decks were pooled to get there",
      res["matchup"]["decks"] == 1405, str(res["matchup"].get("decks")))

# The whole ladder is returned, not just the rung that won.
_PROFILES[k_hog] = {
    "archetypes": {"golem": {"games": 104, "wins": 39, "losses": 65, "draws": 0,
                             "winRate": 37.5, "avgCrownsFor": 0.7,
                             "avgCrownsAgainst": 1.2, "crownDiff": -0.5,
                             "threeCrownFor": 3.8, "threeCrownAgainst": 21.2,
                             "tier": "high", "interval": "+-9%"}},
    "overall": {"winRate": 48.0, "games": 4000}, "battles": 4000,
}
res = dc.deck_vs_deck(HOG, GOLEM)
srcs = [m["source"] for m in res["ladder"]]
check("every rung with evidence is returned, narrowest first",
      srcs == [dc.SOURCE_DECK, dc.SOURCE_C7, dc.SOURCE_C6, dc.SOURCE_ARCHETYPE],
      str(srcs))
check("and the narrowest is the headline", res["source"] == dc.SOURCE_DECK)
check("a thin exact reading can now be weighed against a wide one",
      res["ladder"][0]["games"] == 104 and res["ladder"][2]["games"] == 77381)
check("no rung is invented where there is no evidence",
      all(m.get("games") for m in res["ladder"]))

# find_counters uses the same evidence, per row.
_PROFILES.clear(); _CLUSTERS.clear()
_PROFILES[k_hog] = {
    "archetypes": {"golem": {"games": 400, "wins": 100, "losses": 300, "draws": 0,
                             "winRate": 25.0, "avgCrownsFor": 0.8,
                             "avgCrownsAgainst": 1.5, "crownDiff": -0.7,
                             "threeCrownFor": 3.0, "threeCrownAgainst": 14.0,
                             "tier": "high", "interval": "+-4%"}},
    "overall": {"winRate": 48.0, "games": 4000}, "battles": 4000,
}
res = dc.find_counters(HOG)
by = {c["archetype"]: c for c in res["counters"]}
check("an archetype the deck has really played is scored on that",
      by["golem"]["winRate"] == 75.0 and by["golem"]["source"] == dc.SOURCE_DECK,
      str(by.get("golem")))
check("Golem now counters this list, where the archetype average said otherwise",
      "golem" in by)
check("an archetype it has not met enough falls back, and says so",
      all(c["source"] == dc.SOURCE_ARCHETYPE for c in res["counters"]
          if c["archetype"] != "golem"))
check("the baseline is the deck's own record when it has one",
      res["overall"]["winRate"] == 48.0 and res["source"] == dc.SOURCE_DECK)

# A deck played once and won once reported "100.0% over 1 battles" as the
# baseline, which made every advantage equal the row's own win rate — "+61.5"
# against a field the deck had never met. The per-archetype floor cannot catch
# it, because the baseline pools every archetype.
_PROFILES[k_hog] = {
    "archetypes": {},
    "overall": {"winRate": 100.0, "games": 1}, "battles": 1,
}
thin = dc.find_counters(HOG)
check("a one-battle deck does NOT get to be its own baseline",
      thin["source"] == dc.SOURCE_ARCHETYPE, str(thin["source"]))
check("and its advantages are not its win rates",
      all(c["advantage"] != c["winRate"] for c in thin["counters"]),
      str([(c["archetype"], c["winRate"], c["advantage"]) for c in thin["counters"]]))
check("the floor is stated, not magic",
      dc.BASELINE_MIN_BATTLES >= 50 and dc.BASELINE_MIN_BATTLES > dc.MIN_GAMES)


# -- duels are in, loadout rows are not --------------------------------------
#
# `pair_matchup_agg` has no game-mode filter, so duel battles are already part
# of every figure on this screen. Measured on the live table, an 8-card duel
# battle's deck pair is present 72.7% of the time against 61.3% for a ladder
# one -- duels are if anything better represented, not filtered out.
#
# What CANNOT be counted is a native duel row: it stores the whole 16- or
# 24-card loadout plus the series result, so there is no per-game outcome to
# attribute to any deck pair. Those hashes must never be mistaken for decks,
# which is the guard `_build_reps` applies.

print(NL + "duel data")
LOADOUT = ",".join("c%d" % i for i in range(16))
DECK = ",".join("c%d" % i for i in range(8))
check("an 8-card hash has exactly seven commas", DECK.count(",") == 7)
check("a 16-card loadout does not, so it is rejected as a deck",
      LOADOUT.count(",") != 7,
      "the guard _build_reps uses to keep duel loadouts out of the archetypes")
check("classifying a loadout hash still does not raise",
      dc._archetype_of_hash("golem," + LOADOUT) == "golem")
check("and an 8-card duel deck classifies exactly like a ladder one",
      dc._archetype_of_hash("cannon,fireball,hog-rider,ice-golem,ice-spirit,"
                            "musketeer,skeletons,the-log") == "hog")

print(f"\n{PASS} passed, {FAIL} failed\n")
sys.exit(1 if FAIL else 0)
