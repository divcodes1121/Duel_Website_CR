"""test_coach_daily.py — the field projection and the weighting.

    python server/test_coach_daily.py

Synthetic boards only; no database is opened and `plan()` is not called (it
reads the meta snapshot and the battle store). What is covered is the only new
arithmetic in the module: turning the meta board into a projection, and moving
its mass toward what one player actually loses to.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coach_daily as cdl  # noqa: E402
import team_scout as ts  # noqa: E402

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


def deck(h, arch, use, battles=5000, name=None):
    return {
        "deckHash": h,
        "cards": [f"{h}{i}" for i in range(8)],
        "winCondition": arch,
        "useRate": use,
        "battles": battles,
        "wins": battles // 2,
        "winRate": 50.0,
        "players": 100,
        "name": name or arch.title(),
    }


def board(*decks, building=False):
    return {"building": building, "decks": list(decks)}


def faced(name, battles, wins):
    return {"key": name, "name": name.title(), "battles": battles,
            "wins": wins, "losses": battles - wins, "draws": 0}


print("\nthe field projection")

th = cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "golem", 5.0), deck("c", "bait", 5.0)))
check("one threat per meta deck", len(th) == 3, len(th))
check("likelihood is the use rate, normalised",
      abs(th[0]["likelihood"] - 0.5) < 1e-6, th[0]["likelihood"])
check("and the set sums to 1.0", abs(sum(t["likelihood"] for t in th) - 1.0) < 1e-3)
check("archetype is the win condition, which is what `rate_for` is keyed on",
      th[0]["archetype"] == "hog", th[0]["archetype"])
check("every field is what team_scout.score reads",
      all(k in th[0] for k in ("key", "archetype", "likelihood", "name", "evidence")))

check("evidence is OBSERVED — these are real decks really played",
      all(t["evidence"] == ts.OBSERVED for t in th))
check("observedCount carries the population's battles, so confidence is `known`",
      th[0]["observedCount"] == 5000 and th[0]["confidence"] == ts.KNOWN,
      (th[0]["observedCount"], th[0]["confidence"]))

print("\nthe cap, and renormalising only after it")
many = board(*[deck(chr(97 + i), f"a{i}", 20.0 - i) for i in range(20)])
capped = cdl.field_threats(many)
check("capped at team_scout's own MAX_THREATS", len(capped) == cdl.MAX_THREATS, len(capped))
check("team_scout owns that number, not this module", cdl.MAX_THREATS == ts.MAX_THREATS)
check("the survivors still sum to 1.0", abs(sum(t["likelihood"] for t in capped) - 1.0) < 1e-3)
check("the most-played survive, not the first seen",
      capped[0]["archetype"] == "a0" and all(t["archetype"] != "a19" for t in capped))

print("\na board that is not a reading is not a projection")
check("a building board yields nothing", cdl.field_threats(board(deck("a", "hog", 10.0), building=True)) == [])
check("an empty board yields nothing", cdl.field_threats(board()) == [])
check("a board of zero use rate yields nothing",
      cdl.field_threats(board(deck("a", "hog", 0.0))) == [])

print("\ndeficits: only past the floor, and only against their OWN rate")
d = cdl.deficits(
    [faced("drill", 20, 4),     # 20% vs 60% -> deficit 40
     faced("golem", 30, 18),    # 60% -> deficit 0
     faced("bait", 5, 0)],      # 0% but FIVE battles
    60.0,
)
check("an archetype under the floor is absent entirely", "bait" not in d, sorted(d))
check("a real deficit is measured against their own rate",
      d["drill"]["deficit"] == 40.0, d["drill"])
check("a matchup they hold has no deficit", d["golem"]["deficit"] == 0.0, d["golem"])
check("the floor is the dashboard's matchup floor", cdl.MIN_FACED == 10)
check("it carries its own evidence", d["drill"]["battles"] == 20 and d["drill"]["winRate"] == 20.0)

print("\nweighting: mass moves toward what they lose to")
base = cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "drill", 10.0)))
w = cdl.weight_threats(base, cdl.deficits([faced("drill", 20, 4)], 60.0))
by = {t["archetype"]: t for t in w}
check("the weak matchup gains mass", by["drill"]["likelihood"] > by["hog"]["likelihood"],
      {k: v["likelihood"] for k, v in by.items()})
check("and it still sums to 1.0", abs(sum(t["likelihood"] for t in w) - 1.0) < 1e-3)
check("the boost is reported, not hidden", by["drill"]["boost"] == 1.4, by["drill"]["boost"])
check("the untouched threat keeps a boost of exactly 1", by["hog"]["boost"] == 1.0)
check("the player's record rides along so the screen can say why",
      by["drill"]["playerRecord"]["battles"] == 20 and by["drill"]["playerRecord"]["winRate"] == 20.0)
check("a threat they have no record against carries none",
      by["hog"]["playerRecord"] is None)

print("\nthe three rules that keep the weighting honest")
huge = cdl.weight_threats(
    cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "drill", 10.0))),
    cdl.deficits([faced("drill", 20, 0)], 100.0),  # deficit 100
)
check("the boost is BOUNDED, or one matchup swallows the projection",
      max(t["boost"] for t in huge) <= cdl.MAX_BOOST,
      max(t["boost"] for t in huge))

strong = cdl.weight_threats(
    cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "bait", 10.0))),
    cdl.deficits([faced("bait", 30, 30)], 50.0),  # they crush it: deficit -50
)
by2 = {t["archetype"]: t for t in strong}
check("a STRENGTH is never down-weighted — they will still meet it",
      by2["bait"]["boost"] == 1.0 and abs(by2["bait"]["likelihood"] - 0.5) < 1e-3,
      by2["bait"])

thin = cdl.weight_threats(
    cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "drill", 10.0))),
    cdl.deficits([faced("drill", 5, 0)], 60.0),  # under the floor
)
check("a deficit under the floor moves NOTHING, not a little",
      all(t["boost"] == 1.0 for t in thin))

print("\nreserved slots: a weakness the projection cannot represent is useless")
# The live answer that made this necessary: this player's worst matchup by a
# distance was an archetype NO top-twelve meta deck carried, so the boost had
# nothing at all to act on.
wide = board(*[deck(chr(97 + i), f"a{i}", 20.0 - i) for i in range(20)],
             deck("z", "drill", 0.4, name="Goblin Drill"))
plain = cdl.field_threats(wide)
check("without priority the rare archetype is absent",
      all(t["archetype"] != "drill" for t in plain))
withp = cdl.field_threats(wide, priority=["drill"])
check("a named weakness is admitted from below the cut",
      any(t["archetype"] == "drill" for t in withp),
      [t["archetype"] for t in withp])
check("and the projection does not grow",
      len(withp) == len(plain) == cdl.MAX_THREATS, (len(withp), len(plain)))
check("the most-played are never displaced",
      withp[0]["archetype"] == "a0" and withp[1]["archetype"] == "a1",
      [t["archetype"] for t in withp[:2]])
check("its likelihood is still its OWN use rate — rare stays rare",
      next(t for t in withp if t["archetype"] == "drill")["likelihood"]
      < next(t for t in withp if t["archetype"] == "a0")["likelihood"])
check("an archetype already in the cut costs no slot",
      cdl.field_threats(wide, priority=["a0"])[0]["archetype"] == "a0"
      and len(cdl.field_threats(wide, priority=["a0"])) == cdl.MAX_THREATS)
check("a weakness the meta does not carry at all is simply not added",
      all(t["archetype"] != "nope" for t in cdl.field_threats(wide, priority=["nope"])))

print("\nthe meta's own direction")


def mv(basis="measured", apart=7, rows=()):
    return {"basis": basis, "daysApart": apart, "reason": None, "rows": list(rows)}


def row(h, prev, delta, rank=None):
    return {"deckHash": h, "previousUseRate": prev, "useDelta": delta, "rankDelta": rank}


tb = cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "golem", 10.0)))
# field_threats must carry the join key, or nothing can ever match.
check("a threat carries the board's own deckHash",
      all(t.get("deckHash") for t in tb), [t.get("deckHash") for t in tb])

up, st = cdl.trend_threats(tb, mv(rows=[row("a", 8.0, 2.0)]))
by = {t["archetype"]: t for t in up}
check("a rising deck gains mass", by["hog"]["likelihood"] > by["golem"]["likelihood"],
      {k: v["likelihood"] for k, v in by.items()})
check("and it still sums to 1.0", abs(sum(t["likelihood"] for t in up) - 1.0) < 1e-3)
check("the trend is reported on the row, not hidden",
      by["hog"]["trend"] and by["hog"]["trend"]["factor"] > 1.0, by["hog"]["trend"])
check("the untouched deck carries trend None", by["golem"]["trend"] is None)
check("and the state says it ran", st["applied"] is True and st["moved"] == 1, st)

down, _ = cdl.trend_threats(tb, mv(rows=[row("a", 8.0, -4.0)]))
byd = {t["archetype"]: t for t in down}
check("a deck being dropped loses mass", byd["hog"]["likelihood"] < byd["golem"]["likelihood"],
      {k: v["likelihood"] for k, v in byd.items()})

huge, _ = cdl.trend_threats(tb, mv(rows=[row("a", 0.1, 90.0)]))
check("the lift is BOUNDED, or one week's fashion becomes the whole field",
      max(t["trend"]["factor"] for t in huge if t["trend"]) <= cdl.TREND_MAX)
crash, _ = cdl.trend_threats(tb, mv(rows=[row("a", 90.0, -89.0)]))
check("and so is the trim", min(t["trend"]["factor"] for t in crash if t["trend"])
      >= 1.0 / cdl.TREND_MAX)

noise, stn = cdl.trend_threats(tb, mv(rows=[row("a", 8.0, 0.05)]))
check("a wobble under the floor moves NOTHING, not a little",
      all(t["likelihood"] == b["likelihood"] for t, b in zip(noise, tb)), stn["moved"])

print("\na short span is the board's churn, not a trend")
short, sts = cdl.trend_threats(tb, mv(apart=1, rows=[row("a", 8.0, 4.0)]))
check("under TREND_MIN_DAYS nothing moves", sts["applied"] is False)
check("and the reason says why", "churn" in (sts["reason"] or ""), sts["reason"])
check("likelihoods are untouched",
      [t["likelihood"] for t in short] == [t["likelihood"] for t in tb])

print("\nno history is not a flat trend")
none_, stn2 = cdl.trend_threats(tb, {"basis": "none", "reason": "nothing stored yet", "rows": []})
check("basis none applies nothing", stn2["applied"] is False)
check("and every row still carries the key, just null",
      all("trend" in t and t["trend"] is None for t in none_))
check("a missing movement payload is handled too",
      cdl.trend_threats(tb, None)[1]["applied"] is False)

# `entered` rows carry a null delta BY DESIGN — the board is a top fifty, so
# arriving at rank 40 is not a climb from 51.
entered, ste = cdl.trend_threats(tb, mv(rows=[
    {"deckHash": "a", "previousUseRate": None, "useDelta": None, "rankDelta": None}]))
check("a deck that was not on the older board is NOT treated as a riser",
      all(t["trend"] is None for t in entered) and ste["moved"] == 0)

print("\nno prose")
_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "coach_daily.py"),
            encoding="utf-8").read()
check("explain() is not called: Team Scout's prose was removed on request, and "
      "its vocabulary is about an OPPONENT, which a field projection has none of",
      "ts.explain" not in _src)

print("\nno history is a state, not a zero")
none = cdl.weight_threats(base, {})
check("with no deficits the projection is returned unchanged",
      [t["likelihood"] for t in none] == [t["likelihood"] for t in base])
check("and the input was NOT mutated — both are reported side by side",
      all("boost" not in t for t in base))
check("weighting an empty projection is empty, not an error", cdl.weight_threats([], {}) == [])

print("\nbrief is a PROJECTION of the same answer, never a cheaper one")
# `plan()` itself reads the meta snapshot and the battle store, so the shape
# is checked on the piece that decides it rather than by calling the route.
_full = cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "golem", 5.0)))
check("a threat carries its cards for the full screen",
      all("cards" in t for t in _full))
_trimmed = [dict(t) for t in _full]
for _t in _trimmed:
    for _k in ("cards", "art", "artInferred", "wins", "winRate", "lastSeen",
               "similarityToObserved", "observedCount"):
        _t.pop(_k, None)
check("trimming drops only what a roster row does not draw",
      all("cards" not in t for t in _trimmed))
check("and KEEPS what the row says — name, share, and whether the player moved it",
      all(all(k in t for k in ("name", "archetype", "likelihood", "key"))
          for t in _trimmed))
check("the likelihoods are untouched by trimming, so the two cannot disagree",
      [t["likelihood"] for t in _trimmed] == [t["likelihood"] for t in _full])

print("\nwhat they actually play")


def odeck(n, battles, cards=None):
    cs = cards or [f"c{n}{i}" for i in range(8)]
    return {"key": ",".join(sorted(cs)), "cards": cs, "battles": battles, "wins": battles // 2}


_intel = {"decks": [odeck(1, 100), odeck(2, 30), odeck(3, 3),
                    {"key": "x", "cards": ["a"] * 8, "battles": 50},          # 1 distinct
                    {"key": "y", "cards": [f"d{i}" for i in range(16)], "battles": 40}],  # a duel loadout
          "archetypes": [{"key": "hog", "battles": 120}, {"key": "golem", "battles": 30},
                         {"key": "mortar", "battles": 4}]}

_own = cdl.repertoire(_intel)
check("a deck played once is not a playstyle — the 3-battle deck is dropped",
      [d["battles"] for d in _own] == [100, 30], str([d["battles"] for d in _own]))
check("the floor is the headline block's, reused", cdl.REPERTOIRE_MIN_BATTLES == 5)
check("a 16-card duel loadout is never split into invented decks",
      all(len(set(d["cards"])) == 8 for d in _own))
check("eight copies of one card is not eight cards either",
      all(len(set(d["cards"])) == 8 for d in _own))
check("most played first", _own[0]["battles"] == 100)
check("no decks at all is an empty repertoire, not a crash", cdl.repertoire(None) == [])

_hist, _tot = cdl.archetype_history(_intel)
check("their own win conditions are counted", _hist["hog"] == 120 and _tot == 154)
# NOT a docstring check, and the first draft of this was `... or True`, which
# is a check that cannot fail. Feed it an intel where the two fields DISAGREE:
# reading the wrong one recommends somebody the deck they keep losing to.
_faced = {"archetypes": [{"key": "hog", "battles": 120}],
          "opponentArchetypes": [{"key": "golem", "battles": 999}]}
_h2, _t2 = cdl.archetype_history(_faced)
check("it reads what they PLAYED, never what they faced",
      _h2 == {"hog": 120} and _t2 == 120, str(_h2))


print("\nhow close a candidate is to what they play")
_a = cdl.deck_affinity([f"c1{i}" for i in range(8)], _own)
check("an exact copy of a deck they play is 8 of 8", _a["shared"] == 8)
check("and it is marked familiar", _a["familiar"] is True)
check("it names the deck it matched, so the claim is checkable",
      _a["deckKey"] == _own[0]["key"] and _a["deckBattles"] == 100)

_half = [f"c1{i}" for i in range(5)] + ["zzz1", "zzz2", "zzz3"]
check("five shared clears the floor", cdl.deck_affinity(_half, _own)["familiar"] is True)
_four = [f"c1{i}" for i in range(4)] + ["zzz1", "zzz2", "zzz3", "zzz4"]
check("four does NOT — staples alone reach four", cdl.deck_affinity(_four, _own)["familiar"] is False)
check("and the raw count is still reported, not hidden",
      cdl.deck_affinity(_four, _own)["shared"] == 4)
check("nothing shared is zero, with no deck named",
      cdl.deck_affinity(["q"] * 1 + [f"q{i}" for i in range(7)], _own)["deckKey"] is None)
check("an empty repertoire cannot make anything familiar",
      cdl.deck_affinity([f"c1{i}" for i in range(8)], [])["familiar"] is False)

# THE CLOSEST SINGLE DECK, not an average over the repertoire.
_two = [{"key": "a", "cards": [f"c1{i}" for i in range(8)], "battles": 9},
        {"key": "b", "cards": [f"z{i}" for i in range(8)], "battles": 900}]
check("it matches the CLOSEST deck, not the most played",
      cdl.deck_affinity([f"c1{i}" for i in range(8)], _two)["deckKey"] == "a")


check("it also counts cards they play ANYWHERE, not just in the closest deck",
      cdl.deck_affinity([f"c1{i}" for i in range(4)] + [f"c2{i}" for i in range(4)], _own)["known"] == 8)
check("which is a different figure from the single-deck overlap",
      cdl.deck_affinity([f"c1{i}" for i in range(4)] + [f"c2{i}" for i in range(4)], _own)["shared"] == 4)
check("so a deck spread across two of their decks is NOT close to either",
      cdl.deck_affinity([f"c1{i}" for i in range(4)] + [f"c2{i}" for i in range(4)], _own)["familiar"] is False)
check("but is still built from cards they play",
      cdl.deck_affinity([f"c1{i}" for i in range(4)] + [f"c2{i}" for i in range(4)], _own)["knowsCards"] is True)
check("the card pool is every card in a deck they play", len(cdl.card_pool(_own)) == 16)
check("a passed pool and a derived one agree",
      cdl.deck_affinity([f"c1{i}" for i in range(8)], _own, cdl.card_pool(_own))["known"]
      == cdl.deck_affinity([f"c1{i}" for i in range(8)], _own)["known"])


print("\nfamilies: the field's answer, grouped by win condition")


def sc(arch, rate, cards=None, shared=0, known=None):
    # `known` defaults to `shared`: a deck overlapping one of their decks by N
    # cards necessarily has at least N cards they play. Passing it separately
    # is how the sparse/dense split is exercised.
    k = shared if known is None else known
    return {"key": f"{arch}-{rate}", "name": cdl.dcx._label(arch), "archetype": arch,
            "cards": cards or [f"{arch}{i}" for i in range(8)],
            "expectedWinRate": rate, "spreadCovered": 50.0,
            "affinity": {"shared": shared, "familiar": shared >= cdl.AFFINITY_MIN,
                         "known": k, "knowsCards": k >= cdl.KNOWN_MIN}}


_scored = [sc("hog", 55.0), sc("hog", 61.0), sc("hog", 58.0, shared=6),
           sc("golem", 60.0), sc("golem", 52.0),
           sc("mortar", 49.0)]
_f = cdl.families(_scored)
check("one group per win condition", [g["archetype"] for g in _f] == ["hog", "golem", "mortar"])
check("ordered by their BEST deck, never by how many decks they hold",
      [g["best"] for g in _f] == [61.0, 60.0, 49.0])
check("twelve mediocre lists do not outrank two good ones",
      _f[0]["archetype"] == "hog" and _f[0]["total"] == 3)
check("inside a family the best is first", _f[0]["decks"][0]["expectedWinRate"] == 61.0)
check("the family reports how many of its decks they could already pilot",
      _f[0]["familiar"] == 1 and _f[1]["familiar"] == 0)
check("the total counts the whole family, not the trimmed list",
      cdl.families(_scored, per=1)[0]["total"] == 3)
check("but only `per` are carried", len(cdl.families(_scored, per=1)[0]["decks"]) == 1)
check("no scored decks is no families", cdl.families([]) == [])

# THE RESERVATION RUNS ON THE DENSER SIGNAL.
_dense = ([sc("xbow", 64.0 - n) for n in range(10)]
          + [sc("xbow", 50.0, cards=[f"k{i}" for i in range(8)], shared=2, known=8)])
_gx = cdl.families(_dense)[0]
check("a deck built from their cards is reserved even with no single deck close",
      any(r["expectedWinRate"] == 50.0 for r in _gx["decks"]),
      str([r["expectedWinRate"] for r in _gx["decks"]]))
check("and a family counts those, not just the close ones", _gx["knows"] == 1)
_sparse = [sc("lava", 64.0 - n, known=4) for n in range(10)]
check("below the cards floor nothing is reserved",
      [r["expectedWinRate"] for r in cdl.families(_sparse)[0]["decks"]] == [64.0, 63.0, 62.0, 61.0])
# The family summary must not carry a figure that cannot vary.
check("a family carries no spreadCovered — it measured 100.0 on all 17, every account",
      all("spreadCovered" not in g for g in _f))
check("it carries what a family row is judged on instead",
      all(set(g) >= {"archetype", "name", "best", "total", "familiar", "decks"} for g in _f))


print("\nthe families are ordered FOR THIS PLAYER, within bounds")

check("below the affinity floor familiarity is worth nothing",
      cdl._fit_fraction({"shared": 4}) == 0.0 and cdl._fit_fraction({"shared": 0}) == 0.0)
check("at the floor it is just above nothing", 0 < cdl._fit_fraction({"shared": 5}) <= 0.25)
check("all eight shared is the maximum", cdl._fit_fraction({"shared": 8}) == 1.0)
check("no affinity at all is nothing, not a middle value", cdl._fit_fraction(None) == 0.0)

# A DECK THEY KNOW CAN OVERTAKE A SLIGHTLY BETTER ONE THEY DO NOT.
_close = [sc("hog", 60.0), sc("hog", 59.4, shared=8)]
check("a deck they know well overtakes one 0.6 points better",
      cdl.families(_close)[0]["decks"][0]["expectedWinRate"] == 59.4)
# AND IT IS BOUNDED, which is the whole honesty of the rule.
_far = [sc("hog", 62.0), sc("hog", 59.4, shared=8)]
check("but NOT one 2.6 points better — the nudge is capped at FIT_WEIGHT",
      cdl.families(_far)[0]["decks"][0]["expectedWinRate"] == 62.0)
check("the cap is team_scout's own, not a second opinion on one quantity",
      cdl.FAMILIAR_WEIGHT == ts.FIT_WEIGHT)

check("`best` stays the expected win rate, never the adjusted score",
      cdl.families(_close)[0]["best"] == 59.4)

_two = [sc("hog", 60.0), sc("golem", 60.4, shared=8)]
check("a family they can pilot leads one marginally better that they cannot",
      cdl.families(_two)[0]["archetype"] == "golem")
check("a family records whether the personal order moved its top deck",
      cdl.families([sc("hog", 61.0), sc("hog", 60.5, shared=8)])[0]["moved"] is True)
_none = cdl.families([sc("hog", 55.0), sc("golem", 60.0)])
check("with no familiarity anywhere the order is the field's, unchanged",
      [g["archetype"] for g in _none] == ["golem", "hog"])
check("and nothing is reported as moved — 0 is a real answer",
      all(g["moved"] is False for g in _none))


print("\nevery family reserves room for what they can pilot")

# Twelve decks of one family: the four best are strangers, two weaker ones are
# theirs. The field-only board would never show the two they can play.
_big = ([sc("hog", 64.0 - n) for n in range(10)]
        + [sc("hog", 52.0, cards=[f"own{i}" for i in range(8)], shared=7),
           sc("hog", 51.0, cards=[f"ow2{i}" for i in range(8)], shared=6)])
_g = cdl.families(_big)[0]
check("the family still shows four decks", len(_g["decks"]) == 4, str(len(_g["decks"])))
_rates = sorted(r["expectedWinRate"] for r in _g["decks"])
check("two of them are the ones they can pilot",
      52.0 in _rates and 51.0 in _rates, str(_rates))
check("and two are still the field's best",
      64.0 in _rates and 63.0 in _rates, str(_rates))
check("the reserved rows are MARKED, so the screen can say why they are there",
      sum(1 for r in _g["decks"] if r.get("closestOfFamily")) == 2)
check("the field's best is not marked as one",
      not next(r for r in _g["decks"] if r["expectedWinRate"] == 64.0).get("closestOfFamily"))
check("the closest is preferred over the merely familiar",
      any(r.get("closestOfFamily") and r["affinity"]["shared"] == 7 for r in _g["decks"]))

# A FAMILY WITH NOTHING FAMILIAR SPENDS NO SLOTS.
_plain = cdl.families([sc("golem", 64.0 - n) for n in range(10)])[0]
check("a family with nothing familiar shows four of the field's best",
      [r["expectedWinRate"] for r in _plain["decks"]] == [64.0, 63.0, 62.0, 61.0],
      str([r["expectedWinRate"] for r in _plain["decks"]]))
check("and marks none of them reserved",
      not any(r.get("closestOfFamily") for r in _plain["decks"]))

# A deck already in the top four is not ALSO taken as a reserved slot.
_dup = ([sc("bait", 64.0, cards=[f"own{i}" for i in range(8)], shared=8)]
        + [sc("bait", 60.0 - n) for n in range(10)])
_gd = cdl.families(_dup)[0]
check("a familiar deck already in the cut does not consume a reserved slot too",
      len({r["key"] for r in _gd["decks"]}) == 4, str([r["key"] for r in _gd["decks"]]))
check("so the field's next best still gets in",
      60.0 in [r["expectedWinRate"] for r in _gd["decks"]],
      str([r["expectedWinRate"] for r in _gd["decks"]]))

check("a family smaller than the cut is shown whole",
      len(cdl.families([sc("mortar", 55.0), sc("mortar", 54.0)])[0]["decks"]) == 2)


print("the board is grouped by what they can already play")

# THE PARTITION RUNS ON WHAT THEY HAVE PLAYED, not on card overlap. Grouping
# on card overlap collapsed live: a broad player cleared it in all seventeen
# families and every section came back "theirs".
_mix = [sc("hog", 64.0), sc("golem", 55.0, shared=7), sc("mortar", 60.0)]
_hist3, _tot3 = {"golem": 200}, 200
_go = cdl.families(_mix, hist=_hist3, total=_tot3)
check("a win condition they play leads one 9 points better that they do not",
      _go[0]["archetype"] == "golem", str([g["archetype"] for g in _go]))
check("and the rest keep the field's own order behind it",
      [g["archetype"] for g in _go[1:]] == ["hog", "mortar"])
check("each family says whether it is in their range",
      [g["yours"] for g in _go] == [True, False, False])
check("and carries how many games they have on it", _go[0]["games"] == 200)
check("grouping claims nothing about quality — `best` is untouched",
      _go[0]["best"] == 55.0 and _go[1]["best"] == 64.0)
check("with no history at all it is exactly the field's order",
      [g["archetype"] for g in cdl.families([sc("hog", 64.0), sc("golem", 55.0)])]
      == ["hog", "golem"])
check("and nothing is claimed to be theirs",
      not any(g["yours"] for g in cdl.families([sc("hog", 64.0), sc("golem", 55.0)])))

# `in_range` is ONE definition, shared with `worth_learning`.
check("a win condition they have played a lot of is in range",
      cdl.in_range("hog", {"hog": 200}, 1000) is True)
check("a handful of games out of thousands is not",
      cdl.in_range("hog", {"hog": 10}, 4000) is False)
check("but a handful out of a handful is — share OR count, never one alone",
      cdl.in_range("hog", {"hog": 10}, 60) is True)
check("never played is never in range", cdl.in_range("hog", {}, 1000) is False)
check("and it is exactly what `worth_learning` refuses to offer",
      cdl.worth_learning(_mix, _hist3, _tot3, beat=None)["archetype"] != "golem")


print("\nclosest: what they could pilot today")
_near = cdl.closest(_scored)
check("only familiar decks are in it", all(r["affinity"]["familiar"] for r in _near))
check("exactly the one that cleared the floor", len(_near) == 1)
# Sorted by the ANSWER, not by how familiar. Two familiar decks, worse one more alike.
_mix = [sc("hog", 52.0, shared=8), sc("golem", 61.0, shared=5)]
check("sorted by expected win rate, NOT by how familiar it is",
      [r["expectedWinRate"] for r in cdl.closest(_mix)] == [61.0, 52.0])
check("nothing familiar is an empty list, not a lowered floor",
      cdl.closest([sc("hog", 70.0, shared=4)]) == [])


print("\nworth learning: one archetype outside their range")
_hist2 = {"hog": 300}      # they are a hog player and nothing else
_learn = cdl.worth_learning(_scored, _hist2, 300, beat=58.0)
check("it picks a family they have no history with", _learn["archetype"] == "golem")
check("and says how much they have actually played it", _learn["yourBattles"] == 0)
check("with the margin over what they can already pilot", _learn["beats"] == 2.0)
check("a family they already play is never offered as new",
      cdl.worth_learning(_scored, {"hog": 300, "golem": 200}, 500, beat=40.0)["archetype"] == "mortar")
check("NOTHING is offered when nothing unfamiliar beats what they can pilot",
      cdl.worth_learning(_scored, _hist2, 300, beat=99.0) is None)
check("with nothing familiar there is no bar to clear",
      cdl.worth_learning(_scored, _hist2, 300, beat=None)["archetype"] == "golem")
# The share and the count are BOTH needed.
check("a busy player's minor deck is still outside their range on share",
      cdl.worth_learning(_scored, {"hog": 3000, "golem": 10}, 3010, beat=None)["archetype"] == "golem")
check("but a deck they play a lot of is not, however small the share",
      cdl.worth_learning(_scored, {"hog": 100000, "golem": 4000}, 104000,
                         beat=None)["archetype"] != "golem")


print("\nthe window before this one")
check("a 30-day window is preceded by the 30 days ending the day before",
      cdl.previous_window("2026-08-26", "2026-09-24") == ("2026-07-27", "2026-08-25"))
check("the span is taken from the DATES, not from a `days` the caller may not have sent",
      cdl.previous_window("2026-09-18", "2026-09-24") == ("2026-09-11", "2026-09-17"))
check("a one-day window has a one-day predecessor",
      cdl.previous_window("2026-09-24", "2026-09-24") == ("2026-09-23", "2026-09-23"))
check("it crosses a month and a leap day without arithmetic of its own",
      cdl.previous_window("2028-03-01", "2028-03-05") == ("2028-02-25", "2028-02-29"))
check("no window in, no window out", cdl.previous_window(None, "2026-09-24") == (None, None))
check("an unparseable date is refused, not guessed",
      cdl.previous_window("not-a-date", "2026-09-24") == (None, None))
check("a datetime is tolerated — the API's own from/to may carry one",
      cdl.previous_window("2026-09-18T00:00:00Z", "2026-09-24T23:59:59Z")
      == ("2026-09-11", "2026-09-17"))
check("a window that ends before it starts is refused",
      cdl.previous_window("2026-09-24", "2026-09-18") == (None, None))


print("\nthe noise band is what stops a small sample reading as progress")
# THE CASE THE ADJUSTMENT EXISTS FOR. On the plain normal estimate a window of
# 10/10 has a standard error of exactly ZERO, so this ten-point drop would be
# published as a real slide off twenty battles.
_c, _b = cdl._band(9, 10, 10, 10)
check("10/10 then 9/10 is NOT a real move", cdl._direction(_c, _b) == "flat",
      f"change {_c:.1f} band {_b:.1f}")
check("and the band it was judged against is not zero", _b > 0, f"band {_b}")
check("the change reported is the RAW difference, not the adjusted one",
      abs(_c - (-10.0)) < 1e-9, f"{_c}")

_c, _b = cdl._band(6, 12, 8, 12)
check("a 16-point gap over twelve battles a side is still noise",
      cdl._direction(_c, _b) == "flat", f"change {_c:.1f} band {_b:.1f}")

_c, _b = cdl._band(600, 1000, 450, 1000)
check("the same gap over a thousand a side is a real rise",
      cdl._direction(_c, _b) == "up", f"change {_c:.1f} band {_b:.1f}")
_c, _b = cdl._band(450, 1000, 600, 1000)
check("and reversed, a real fall", cdl._direction(_c, _b) == "down")

check("more evidence narrows the band", cdl._band(6, 12, 8, 12)[1] > cdl._band(60, 120, 80, 120)[1])
check("exactly at the band is flat, not a move", cdl._direction(5.0, 5.0) == "flat")
check("an empty window yields no claim at all", cdl._band(0, 0, 5, 10) == (0.0, 0.0))
check("flat never means unchanged — the change survives it",
      cdl._band(6, 12, 8, 12)[0] != 0)


print("\nprogress: window against window, with no snapshot table")


class _FakeIntel:
    """Stands in for `coach_intel`, keyed by the window asked for."""

    def __init__(self, by_window):
        self.by = by_window
        self.calls = []

    def report(self, tag, since=None, until=None):
        self.calls.append((since, until))
        return self.by.get(since)


def _arch(key, name, battles, wins):
    return {"key": key, "name": name, "battles": battles, "wins": wins}


def _intel(battles, wins, archs):
    return {"summary": {"battles": battles, "wins": wins}, "opponentArchetypes": archs}


def _run(now, before, since="2026-08-26", until="2026-09-24"):
    real = cdl.coach_intel
    fake = _FakeIntel({cdl.previous_window(since, until)[0]: before})
    cdl.coach_intel = fake
    try:
        return cdl.progress("#AAA", since, until, now), fake
    finally:
        cdl.coach_intel = real


# A weakness that really closed: 30% -> 62% against Mortar, overall steady.
_now = _intel(400, 208, [_arch("mortar", "Mortar", 100, 62), _arch("golem", "Golem", 80, 24)])
_was = _intel(400, 200, [_arch("mortar", "Mortar", 100, 30), _arch("golem", "Golem", 80, 25)])
_p, _fake = _run(_now, _was)
check("it reads exactly one extra window", len(_fake.calls) == 1, str(_fake.calls))
check("and it is the window before this one", _fake.calls[0] == ("2026-07-27", "2026-08-25"))
check("comparable, with both sides past the floor", _p["comparable"] is True)
check("the floor it used is published", _p["floor"] == cdl.COMPARE_MIN)
_m = {r["archetype"]: r for r in _p["matchups"]}
check("the closed weakness is listed even though it is no longer a weakness",
      "mortar" in _m)
check("it is marked resolved", _m["mortar"]["resolved"] is True)
check("with the direction of the record itself", _m["mortar"]["direction"] == "up")
check("and both windows' rates, so the reader can check it",
      _m["mortar"]["before"]["winRate"] == 30.0 and _m["mortar"]["now"]["winRate"] == 62.0)
check("a weakness that did not move is listed and NOT resolved",
      _m["golem"]["resolved"] is False and _m["golem"]["direction"] == "flat")
check("the worst standing deficit sorts first", _p["matchups"][0]["archetype"] == "golem")

# THE DISCIPLINE: the gap closed because the player got worse everywhere else.
_now = _intel(400, 120, [_arch("mortar", "Mortar", 100, 30)])     # overall 30, mortar 30
_was = _intel(400, 200, [_arch("mortar", "Mortar", 100, 30)])     # overall 50, mortar 30
_p, _ = _run(_now, _was)
_m = {r["archetype"]: r for r in _p["matchups"]}
check("a deficit that closed because the OVERALL rate fell is not resolved",
      _m["mortar"]["resolved"] is False)
check("because the record against it never moved — 'flat', not 'up'",
      _m["mortar"]["direction"] == "flat")
check("the gap really did close, which is why this needs a second condition",
      _m["mortar"]["deficitBefore"] == 20.0 and _m["mortar"]["deficitNow"] == 0.0)
check("and the overall fall is reported as a fall", _p["overall"]["direction"] == "down")

# A matchup they have stopped meeting.
_now = _intel(400, 200, [_arch("mortar", "Mortar", 3, 1)])
_was = _intel(400, 200, [_arch("mortar", "Mortar", 100, 30)])
_p, _ = _run(_now, _was)
_m = {r["archetype"]: r for r in _p["matchups"]}
check("a matchup under the floor NOW is 'thin', not a movement",
      _m["mortar"]["direction"] == "thin" and _m["mortar"]["change"] is None)
check("it is never called resolved off a three-battle sample",
      _m["mortar"]["resolved"] is False)

_now = _intel(400, 200, [_arch("mortar", "Mortar", 100, 30)])
_was = _intel(400, 200, [])
_p, _ = _run(_now, _was)
_m = {r["archetype"]: r for r in _p["matchups"]}
check("a matchup absent from the earlier window is 'unseen', not a rise from zero",
      _m["mortar"]["direction"] == "unseen")
check("and it carries no invented earlier rate",
      _m["mortar"]["before"]["winRate"] is None and _m["mortar"]["before"]["battles"] == 0)

# Thin windows, and WHICH side is thin.
_p, _ = _run(_intel(4, 2, []), _intel(400, 200, []))
check("too few battles now is named as such", _p["reason"] == "thin_now")
check("and nothing is compared", _p["comparable"] is False and _p["overall"]["change"] is None)
check("but the counts are still reported, so the screen can say how far off it is",
      _p["overall"]["now"]["battles"] == 4 and _p["overall"]["before"]["battles"] == 400)

_p, _ = _run(_intel(400, 200, []), _intel(4, 2, []))
check("too little history BEFORE is a different reason", _p["reason"] == "thin_before")

_p, _ = _run(_intel(400, 200, []), None)
check("no earlier report at all is thin_before, not a crash", _p["reason"] == "thin_before")

_p = cdl.progress("#AAA", None, None, _intel(400, 200, []))
check("with no window there is no comparison and it says so",
      _p["reason"] == "no_window" and _p["comparable"] is False)

# Only real weaknesses are listed — a matchup they are GOOD at is not progress.
_now = _intel(400, 200, [_arch("hog", "Hog Rider", 100, 80)])
_was = _intel(400, 200, [_arch("hog", "Hog Rider", 100, 75)])
_p, _ = _run(_now, _was)
check("a matchup they beat is not listed as something to work on",
      _p["matchups"] == [])

print("\nthe snapshot table was dropped on purpose, and the file says why")
src_cd = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "coach_daily.py"),
              encoding="utf-8").read()
check("the reasoning is recorded where the next reader will look",
      "coach_player_snapshot" in src_cd and "SERVICE-ROLE" in src_cd)
# NOT `"supabase" not in src`: the module NAMES Supabase, in the comment
# explaining why the snapshot table was dropped, so that check passed only
# until the reasoning was written down and then failed on prose. What matters
# is the mechanism -- there is no REST path, no service-role key and no way to
# send anything anywhere.
check("and it reaches Supabase by no route at all",
      "rest/v1" not in src_cd and "service_role" not in src_cd
      and "urlopen" not in src_cd and "requests." not in src_cd
      and "http" not in src_cd.replace("https://", "").lower())


print("\nnothing here calls a model")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "coach_daily.py"),
           encoding="utf-8").read()
check("no ml import", "import ml" not in src and "from ml" not in src)
check("the OIE is not referenced", "predictor" not in src and "CLASH_OIE" not in src)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
