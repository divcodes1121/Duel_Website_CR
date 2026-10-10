"""test_counters.py — counters to what they PLAY (team_scout 3.0), the card view,
and the two pieces of arithmetic that make rating the whole pool affordable.

    python server/test_counters.py

Plain asserts and a counter, matching the other suites here. NO DATABASE:
`team_scout`, `matchup_fusion` and `card_counters` are pure, and every case
runs against literals.

WHAT THIS PINS, each one a thing the account holder reported (2026-10-10) or a
thing that was measured wrong on the live service before the change:

  * the projection is what they PLAY — no seed variant, no archetype "their
    behaviour implies" — and a family keeps its whole share when the tail of
    its lists is cut;
  * the list reads in the order of the figure printed, holds no deck expected
    to lose, folds near-copies, and repeats one win condition twice at most;
  * every family they play a tenth of the time has a real answer on the list;
  * the per-family and per-card lists are the same rows read another way;
  * the manual NAMES cards and never ranks a deck;
  * the tight rating loop and the full scorer give one number for one deck.
"""

from __future__ import annotations

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import card_counters as cc
import matchup_fusion as mf
import team_scout as ts

PASS = FAIL = 0
NL = "\n"


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


def cards(prefix: str, n: int = 8) -> list[str]:
    return [f"{prefix}-{i}" for i in range(n)]


def played(prefix, wc, matches, wins=None, last="20261009T120000.000Z", family=None, name=None):
    d = {"cards": cards(prefix), "matches": matches,
         "wins": matches // 2 if wins is None else wins,
         "winCondition": wc, "lastSeen": last}
    if family:
        d["family"] = family
        d["familyName"] = name or family
    return d


# ── 1. The projection is what they play ─────────────────────────────────────

print("the projection is what they play")

space = ts.played_space([
    played("g1", "giant", 60), played("g2", "giant", 20), played("b1", "bridge-spam", 15),
    played("x1", "xbow", 5),
])
th = space["threats"]
check("every threat is a deck they were seen playing",
      th and all(t["evidence"] == ts.OBSERVED and t["observedCount"] > 0 for t in th))
check("the likelihoods sum to one", abs(sum(t["likelihood"] for t in th) - 1.0) < 1e-3,
      str(sum(t["likelihood"] for t in th)))
check("the mass is all observed, in the old shape",
      space["mass"] == {"observed": 1.0, "variant": 0.0, "inferred": 0.0})
plays = {p["family"]: p for p in space["plays"]}
check("one row a family, most played first",
      [p["family"] for p in space["plays"]] == ["giant", "bridge-spam", "xbow"],
      str([p["family"] for p in space["plays"]]))
check("a family's share is all of its lists", abs(plays["giant"]["share"] - 0.8) < 1e-6
      and plays["giant"]["games"] == 80 and plays["giant"]["decks"] == 2, str(plays["giant"]))

# SEEDS ARE NOT READ AT ALL: nothing they have not played can enter.
seeds = {"hog": [{"cards": cards("hogseed"), "games": 5000}],
         "giant": [{"cards": cards("g1")[:7] + ["other"], "games": 900}]}
old = ts.threat_space([played("g1", "giant", 60)], seeds)
check("the old projection DID add decks they never played (what was reported)",
      any(t["evidence"] != ts.OBSERVED for t in old["threats"]))
new = ts.played_space([played("g1", "giant", 60)])
check("the new one cannot", all(t["evidence"] == ts.OBSERVED for t in new["threats"])
      and len(new["threats"]) == 1 and new["threats"][0]["likelihood"] == 1.0)

# A PLAYER WITH HUNDREDS OF VARIANTS: most of their games sit outside any
# twelve lists. Cutting the tail must not hand a family's games to another.
many = [played(f"m{i}", "miner", 3) for i in range(100)]          # 300 games, 100 lists
many += [played("r1", "royal-giant", 120), played("r2", "royal-giant", 60)]   # 180 games, 2 lists
cut = ts.played_space(many, limit=12)
per = {}
for t in cut["threats"]:
    per[t["family"]] = per.get(t["family"], 0.0) + t["likelihood"]
check("only the most likely lists are scored against", len(cut["threats"]) == 12)
check("Miner is still what they play most, though its lists are small",
      per.get("miner", 0) > per.get("royal-giant", 0), str(per))
check("and each family carries exactly its share of their games",
      abs(per["miner"] - 300 / 480) < 2e-3 and abs(per["royal-giant"] - 180 / 480) < 2e-3, str(per))

# A family worth naming always keeps a list, however small its lists are.
# Six big Giant lists and thirty two-game Hog lists: the four most likely
# lists are all Giant, and Hog is still one game in sixteen of theirs.
tail = [played(f"big{i}", "giant", 150) for i in range(6)] + [played(f"s{i}", "hog", 2) for i in range(30)]
kept = ts.played_space(tail, limit=4)
check("a family played 6% of the time keeps a list in a four-list projection",
      any(t["family"] == "hog" for t in kept["threats"]),
      str([(t["family"], t["likelihood"]) for t in kept["threats"]]))

# The bot's `other` bucket is several win conditions; the caller names them.
mixed = ts.played_space([
    played("mg", "other", 50, family="other:minion-giant", name="Minion Giant"),
    played("sb", "other", 30, family="other:skeleton-barrel", name="Skeleton Barrel"),
    played("h", "hog", 20),
])
check("decks filed under one `other` key are grouped by what they are",
      [(p["family"], p["name"]) for p in mixed["plays"]]
      == [("other:minion-giant", "Minion Giant"), ("other:skeleton-barrel", "Skeleton Barrel"),
          ("hog", "")], str(mixed["plays"]))
check("their threats still carry the archetype the evidence is keyed on",
      all(t["archetype"] == "other" for t in mixed["threats"] if t["family"].startswith("other:")))

dup = ts.played_space([played("g1", "giant", 10), played("g1", "giant", 30)])
check("two rows of one list are one threat", len(dup["threats"]) == 1
      and dup["threats"][0]["observedCount"] == 40)
check("no decks is no history, said", ts.played_space([])["reason"] == "no_history"
      and ts.played_space([])["threats"] == [])
recent = ts.played_space([
    played("a", "hog", 10, last="20261009T120000.000Z"),
    played("b", "giant", 10, last="20260820T120000.000Z"),
])
r = {p["family"]: p["share"] for p in recent["plays"]}
check("a deck played yesterday outweighs one dropped weeks ago", r["hog"] > r["giant"], str(r))


# ── 2. Rows, for the selection tests ────────────────────────────────────────

def row(name, arch, vs, share, extra_cards=None):
    """A scored row: `vs` per family, the figure their share-weighted mean."""
    total = sum(share[f] for f in vs)
    rate = sum(share[f] * vs[f] for f in vs) / total
    cs = extra_cards or cards(name)
    return {"key": ",".join(sorted(cs)), "cards": cs, "archetype": arch, "name": name,
            "expectedWinRate": round(rate, 1), "recommendationScore": round(rate, 3),
            "vs": dict(vs)}


SHARE = {"giant": 0.8, "bridge-spam": 0.2}
PLAYS = [{"family": "giant", "share": 0.8, "name": "Giant"},
         {"family": "bridge-spam", "share": 0.2, "name": "Bridge Spam"}]

print(NL + "the list is counters, in the order of the figure printed")

pool = [
    row("bait-a", "bait", {"giant": 75, "bridge-spam": 45}, SHARE),
    row("bait-b", "bait", {"giant": 73, "bridge-spam": 44}, SHARE),
    row("bait-c", "bait", {"giant": 72, "bridge-spam": 43}, SHARE),
    row("lava", "lava", {"giant": 68, "bridge-spam": 50}, SHARE),
    row("miner", "miner", {"giant": 66, "bridge-spam": 52}, SHARE),
    row("hog", "hog", {"giant": 64, "bridge-spam": 51}, SHARE),
    row("golem", "golem", {"giant": 62, "bridge-spam": 49}, SHARE),
    row("xbow", "xbow", {"giant": 60, "bridge-spam": 48}, SHARE),
    # The Bridge Spam specialist: 54.8 overall, under every row above it.
    row("egiant", "e-giant", {"giant": 48, "bridge-spam": 82}, SHARE),
    row("loser", "drill", {"giant": 40, "bridge-spam": 45}, SHARE),
]
got = ts.counters(pool, PLAYS)
rates = [r["expectedWinRate"] for r in got]
check("seven rows", len(got) == 7, str(len(got)))
check("in the order of the figure printed", rates == sorted(rates, reverse=True), str(rates))
check("no deck expected to lose", all(x >= ts.FLOOR_RATE for x in rates))
check("one win condition appears twice at most",
      max(sum(1 for r in got if r["archetype"] == a) for a in {r["archetype"] for r in got})
      <= ts.PER_ARCHETYPE, str([r["archetype"] for r in got]))
check("the third list of one win condition gave way to a different answer",
      "bait-c" not in [r["name"] for r in got])
check("every row carries its rate against each family", all(r.get("vs") for r in got))

# WHATEVER THEY PLAY: Bridge Spam is a fifth of their games and nothing in the
# strongest seven beats it at 55%. The specialist takes the weakest place.
names = [r["name"] for r in got]
check("a family they play a fifth of the time has its counter on the list",
      "egiant" in names, str(names))
eg = next(r for r in got if r["name"] == "egiant")
check("and that row says what it answers", eg["answers"] == ["bridge-spam"], str(eg["answers"]))
check("the row answering their main family says so too",
      next(r for r in got if r["name"] == "bait-a")["answers"] == ["giant"])
check("the place it took was the weakest row's, not a stronger one's",
      "xbow" not in names and "bait-a" in names and "lava" in names, str(names))
check("nothing the caller holds was written",
      all("answers" not in r and "_v" not in r for r in pool))
check("no private field leaks", all("_v" not in r for r in got))

# Without the answer rule the list is the top seven by figure, and the
# specialist (54.8 overall) is below all of them.
plain = ts.counters(pool, [{"family": "giant", "share": 0.95}, {"family": "bridge-spam", "share": 0.05}])
check("a family under a tenth of their play does not displace a stronger deck",
      "egiant" not in [r["name"] for r in plain], str([r["name"] for r in plain]))

near = [row("a", "bait", {"giant": 75, "bridge-spam": 50}, SHARE,
            extra_cards=["x1", "x2", "x3", "x4", "x5", "x6", "p", "q"]),
        row("a2", "hog", {"giant": 74, "bridge-spam": 50}, SHARE,
            extra_cards=["x1", "x2", "x3", "x4", "x5", "x6", "r", "s"]),
        row("b", "lava", {"giant": 60, "bridge-spam": 50}, SHARE)]
folded = ts.counters(near, PLAYS)
check("a near-copy of a listed deck (six shared cards) is not a second option",
      [r["name"] for r in folded] == ["a", "b"], str([r["name"] for r in folded]))

only_bad = [row("meh", "hog", {"giant": 45, "bridge-spam": 44}, SHARE),
            row("worse", "lava", {"giant": 40, "bridge-spam": 41}, SHARE)]
one = ts.counters(only_bad, PLAYS)
check("when nothing clears the floor one row is shown, at its own figure",
      len(one) == 1 and one[0]["name"] == "meh", str(one))
check("an empty pool is an empty list", ts.counters([], PLAYS) == [])

lead = ts.counters(pool, PLAYS, first=pool[6])
check("a squad's pick leads whatever its figure", lead[0]["name"] == "golem")
check("and the rest still read in order",
      [r["expectedWinRate"] for r in lead[1:]]
      == sorted((r["expectedWinRate"] for r in lead[1:]), reverse=True))
pushed = ts.counters(pool, PLAYS, adjust=lambda r: -30.0 if r["name"] == "bait-a" else 0.0)
check("a cost can move a deck off the list (a teammate already has it)",
      "bait-a" not in [r["name"] for r in pushed])
short = ts.counters(pool, PLAYS, limit=3)
check("the limit is the limit", len(short) == 3)


# ── 3. The same rows, per family ────────────────────────────────────────────

print(NL + "the best counters to each family they play")

ans = ts.answers(pool, PLAYS)
check("one group a family, most played first",
      [g["family"] for g in ans] == ["giant", "bridge-spam"])
g_giant, g_bs = ans
check("ranked by the rate against THAT family",
      [d["rate"] for d in g_giant["decks"]] == sorted((d["rate"] for d in g_giant["decks"]), reverse=True)
      and g_giant["decks"][0]["name"] == "bait-a")
check("the deck's `rate` is its rate against that family",
      all(d["rate"] == d["vs"]["giant"] for d in g_giant["decks"]))
check("three at most", len(g_giant["decks"]) == ts.ANSWERS_PER_FAMILY)
check("two lists of one win condition at most",
      sum(1 for d in g_giant["decks"] if d["archetype"] == "bait") == 2)
check("only counters are listed (55%)", [d["name"] for d in g_bs["decks"]] == ["egiant"],
      str([d["name"] for d in g_bs["decks"]]))
none = ts.answers([row("x", "hog", {"giant": 50, "bridge-spam": 50}, SHARE)], PLAYS)
check("a family nothing beats comes back with an empty list, not padded",
      all(g["decks"] == [] for g in none) and len(none) == 2)
small = ts.answers(pool, PLAYS + [{"family": "xbow", "share": 0.02, "name": "X-Bow"}])
check("a family under 5% of their play is not named", [g["family"] for g in small] == ["giant", "bridge-spam"])


# ── 4. One arithmetic, three ways in ────────────────────────────────────────

print(NL + "a lean row and a full row of one deck cannot disagree")

rng = random.Random(20261010)
SOURCES = ["version", "deck", "cluster7", "archetype", None]
bad = 0
for _ in range(400):
    n = rng.randint(1, 12)
    threats = []
    for i in range(n):
        fam = rng.choice(["giant", "hog", "other:minion-giant"])
        threats.append({"key": f"t{i}", "cards": cards(f"t{i}"), "evidence": ts.OBSERVED,
                        "archetype": "other" if fam.startswith("other") else fam,
                        "family": fam, "likelihood": rng.random()})
    table = {}
    for t in threats:
        table[t["key"]] = (None if rng.random() < 0.15 else
                           {"winRate": round(rng.uniform(20, 85), 1), "source": rng.choice(SOURCES),
                            "games": rng.randint(8, 900)})
    kw = dict(cards=cards("mine"), archetype="hog", fit_games=rng.choice([None, 3, 40]))
    full = ts.score(None, threats, rate_for_threat=lambda t: table[t["key"]], **kw)
    lean = ts.score(None, threats, rate_for_threat=lambda t: table[t["key"]], lean=True, **kw)
    direct = ts.score_rates(
        ((float(t["likelihood"]), t["family"], table[t["key"]]["winRate"], table[t["key"]]["source"])
         for t in threats if table[t["key"]]), **kw)
    if full is None:
        bad += lean is not None or direct is not None
        continue
    keys = ("expectedWinRate", "matchupValue", "threatCovered", "evidenceStrength",
            "recommendationScore", "score", "playerFit", "confidence", "key", "archetype")
    same = all(full[k] == lean[k] == direct[k] for k in keys)
    same = same and ts.vs_archetypes(full) == lean["vs"] == direct["vs"]
    same = same and "matchups" not in lean and "matchups" in full
    bad += not same
check("score, score(lean) and score_rates agree on 400 random projections", bad == 0, str(bad))

fam_rows = ts.score(None, [{"key": "t", "cards": cards("t"), "evidence": ts.OBSERVED,
                            "archetype": "other", "family": "other:minion-giant", "likelihood": 1.0}],
                    rate_for_threat=lambda t: {"winRate": 61.0, "source": "deck", "games": 90},
                    cards=cards("m"), archetype="hog")
check("a matchup row names the family its threat belongs to",
      fam_rows["matchups"][0].get("family") == "other:minion-giant")
check("and the per-family read is keyed on it", ts.vs_archetypes(fam_rows) == {"other:minion-giant": 61.0})
plain_rows = ts.score(lambda a: {"winRate": 55.0, "source": "deck", "games": 50},
                      [{"key": "t", "cards": cards("t"), "evidence": ts.OBSERVED,
                        "archetype": "hog", "likelihood": 1.0}], cards=cards("m"), archetype="hog")
check("a projection without families reads exactly as it did",
      "family" not in plain_rows["matchups"][0] and ts.vs_archetypes(plain_rows) == {"hog": 55.0})


print(NL + "the fused rate, in two halves")

bad = 0
for _ in range(600):
    def ev(scale=200):
        if rng.random() < 0.35:
            return None
        n = rng.randint(1, scale)
        return (n, rng.randint(0, n))
    matrix = None if rng.random() < 0.15 else (rng.random(), rng.choice([3, 8, 500]))
    kw1 = dict(cluster=ev(), arch_ladder=ev(), arch_duel=ev(40))
    kw2 = dict(fam_ladder=ev(), fam_duel=ev(40), ver_ladder=ev(), ver_duel=ev(40))
    whole = mf.fused(matrix, **kw1, **kw2)
    base = mf.arch_level(matrix, **kw1)
    halves = mf.finish(base, **kw2)
    fast = mf.finish_rate(base, kw2["fam_ladder"], kw2["fam_duel"], kw2["ver_ladder"], kw2["ver_duel"])
    if whole is None:
        bad += halves is not None or fast is not None
    else:
        bad += whole != halves or fast != (whole["winRate"], whole["source"])
check("fused == finish(arch_level) == finish_rate on 600 random evidence sets", bad == 0, str(bad))


# ── 5. The card manual names cards and never ranks a deck ───────────────────

print(NL + "which card answers which")

ROLES = {
    "ronin": {"counters": ["pekka", "mega-knight", "any-melee"], "counteredBy": ["minions"]},
    "pekka": {"counteredBy": ["inferno-tower", "skeleton-army", "ronin"]},
    "mega-knight": {"counteredBy": ["inferno-tower"]},
    "inferno-tower": {}, "skeleton-army": {}, "minions": {},
    "balloon": {"counteredBy": ["tornado", "musketeer"]},
    "tornado": {}, "musketeer": {}, "hog-rider": {}, "the-log": {"counters": ["skeleton-army"]},
}
rel = cc._relations(ROLES)
check("a relation written under the card that counters is read",
      "pekka" in rel["ronin"] and "mega-knight" in rel["ronin"])
check("and one written only under the card that is countered",
      "pekka" in rel["inferno-tower"] and "balloon" in rel["tornado"])
check("prose tokens that are not cards are dropped", "any-melee" not in rel["ronin"])
check("a card does not answer itself", all(a not in s for a, s in rel.items()))

_saved = (cc.ROLES, cc.BEATS)
cc.ROLES, cc.BEATS = ROLES, rel
try:
    use = cc.usage([
        {"cards": ["pekka", "mega-knight", "the-log", "x1", "x2", "x3", "x4", "x5"], "likelihood": 0.6},
        {"cards": ["pekka", "musketeer", "y1", "y2", "y3", "y4", "y5", "y6"], "likelihood": 0.3},
        {"cards": ["tornado", "z1", "z2", "z3", "z4", "z5", "z6", "z7"], "likelihood": 0.1},
    ])
    check("a card's share is the share of their games it is in",
          abs(use["pekka"] - 0.9) < 1e-9 and abs(use["mega-knight"] - 0.6) < 1e-9
          and abs(use["tornado"] - 0.1) < 1e-9, str({k: use[k] for k in ("pekka", "mega-knight", "tornado")}))
    top = cc.their_cards(use, limit=3)
    check("their cards are listed most used first", top[0] == {"card": "pekka", "share": 0.9}
          and len(top) == 3)

    ronin = cc.worth("ronin", use)
    check("a card that answers cards they really play is worth searching",
          ronin and ronin["why"] == "answers"
          and [a["card"] for a in ronin["answers"]] == ["pekka", "mega-knight"], str(ronin))
    check("with the share of their games each of those is in",
          ronin["answers"][0]["share"] == 0.9)

    log = cc.worth("the-log", use)
    check("a card whose only target they do not play is not", log is None, str(log))

    loon = cc.worth("balloon", use, win_condition=True)
    check("a win condition they carry little against is worth searching — 'fewer Tornado decks'",
          loon and loon["why"] == "open" and abs(loon["exposure"] - 0.4) < 1e-9, str(loon))
    check("and it says which of their cards answer it",
          [a["card"] for a in loon["open"]] == ["musketeer", "tornado"])
    heavy = cc.usage([{"cards": ["tornado", "musketeer", "a", "b", "c", "d", "e", "f"], "likelihood": 1.0}])
    check("the same win condition into a deck that carries the answers is not",
          cc.worth("balloon", heavy, win_condition=True) is None)
    check("a support card is never 'open' — only a win condition is",
          cc.worth("balloon", use, win_condition=False) is None)
    check("a win condition the manual knows no answer to is not called open",
          cc.worth("hog-rider", use, win_condition=True) is None,
          "'nothing of theirs answers it' would only mean nobody wrote any down")
    check("a card the manual does not hold is not searched", cc.worth("minion-giant", use) is None)
    check("no usage is no read", cc.usage([]) == {} and cc.usage([{"cards": ["a"], "likelihood": 0}]) == {})
finally:
    cc.ROLES, cc.BEATS = _saved

check("the shipped manual is loaded", cc.available() and len(cc.ROLES) >= 120, str(len(cc.ROLES)))
check("it knows the example the account holder gave: Ronin answers P.E.K.K.A and Mega Knight",
      cc.beats("ronin", "pekka") and cc.beats("ronin", "mega-knight"))
check("and that nothing in it is a relation to a non-card",
      all(b in cc.ROLES for s in cc.BEATS.values() for b in s))
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "card_counters.py"),
           encoding="utf-8").read()
check("the module produces no win rate: it imports no evidence and returns no rate",
      "import clash_data" not in src and "winRate" not in src and "import sqlite3" not in src)


print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
