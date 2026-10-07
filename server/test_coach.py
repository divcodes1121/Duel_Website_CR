"""test_coach.py — the Coach Assist decision rules.

    python server/test_coach.py

No database. Every function under test is either pure or is handed its inputs,
which is why `coach.py` splits the reading (`_history`) from the deciding — the
rules are what can be got wrong, and they are the part worth pinning.

THE RULE EVERYTHING RESTS ON: a duel loadout is three decks that cannot share a
card. Most of what follows is that rule, checked from a different angle.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coach  # noqa: E402

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


def deck(*cards):
    """An 8-card deck padded with placeholders unique to the given cards."""
    out = list(cards)
    i = 0
    while len(out) < 8:
        f = f"filler-{cards[0] if cards else 'x'}-{i}"
        if f not in out:
            out.append(f)
        i += 1
    return out


def D(cards, **kw):
    """A candidate deck dict the way the clusterer emits one."""
    row = {"cards": list(cards), "count": kw.pop("count", 1), "prob": kw.pop("prob", 0.0),
           "archetype": kw.pop("archetype", "hog"), "deckName": kw.pop("deckName", "Deck"),
           "art": {}}
    row.update(kw)
    return row


# ── LEGALITY ───────────────────────────────────────────────────────────────
#
# The difference between predicting and recommending. `predict_companions`
# tolerates two shared cards because it reads noisy pooled history; a deck we
# tell someone to play NEXT must share zero, because they physically cannot
# play it otherwise. The bot shipped the looser rule into its recommendations
# once and told a player to bring a Golem deck repeating Lightning and Baby
# Dragon.

print("\na recommendation must be playable, not merely likely")

A = deck("hog-rider", "musketeer", "cannon")
B = deck("golem", "night-witch", "lightning")
SHARES_ONE = deck("golem", "night-witch", "cannon")  # 'cannon' is in A

check("a deck sharing no cards is legal",
      len(coach._legal([D(B)], set(A))) == 1)
check("a deck sharing ONE card is not",
      len(coach._legal([D(SHARES_ONE)], set(A))) == 0,
      str(set(SHARES_ONE) & set(A)))
check("nothing played means nothing is excluded",
      len(coach._legal([D(A), D(B)], set())) == 2)
check("the strict cap really is zero, not the predictor's two",
      coach.RECOMMEND_MAX_SHARED == 0)


# ── THE ODDS TABLES ────────────────────────────────────────────────────────
#
# Probability-weighted, not counted: a card in the front-runner has to outrank
# a card in three long shots, or the table describes the candidate list rather
# than the threat.

print("\ncard and archetype odds are weighted by the deck's probability")

FAV = D(deck("hog-rider", "musketeer"), prob=0.7, archetype="hog")
LONG1 = D(deck("golem", "night-witch"), prob=0.1, archetype="golem")
LONG2 = D(deck("x-bow", "tesla"), prob=0.1, archetype="xbow")
LONG3 = D(deck("mortar", "knight"), prob=0.1, archetype="mortar")

odds = {r["card"]: r["prob"] for r in coach._card_odds([FAV, LONG1, LONG2, LONG3], limit=40)}
check("a card in the favourite outranks one in a long shot",
      odds["hog-rider"] > odds["golem"], f"{odds['hog-rider']} vs {odds['golem']}")
check("and it carries the deck's own probability",
      abs(odds["hog-rider"] - 0.7) < 1e-6, str(odds["hog-rider"]))

# A card in two candidate decks accumulates both.
SHARED = D(deck("hog-rider", "fireball"), prob=0.3, archetype="hog")
odds2 = {r["card"]: r["prob"] for r in coach._card_odds([FAV, SHARED], limit=40)}
check("a card in two candidates accumulates",
      abs(odds2["hog-rider"] - 1.0) < 1e-6, str(odds2["hog-rider"]))

arch = {r["archetype"]: r["prob"] for r in coach._archetype_odds([FAV, LONG1, LONG2, LONG3])}
check("archetype odds group the decks", abs(arch["hog"] - 0.7) < 1e-6, str(arch))
check("and are capped to the top few", len(arch) <= coach.TOP_ARCHETYPES)

check("the table is limited", len(coach._card_odds([FAV, LONG1], limit=3)) == 3)
check("ties break on the card key, so identical data renders identically",
      [r["card"] for r in coach._card_odds([D(["b-card", "a-card", "c-card"], prob=1.0)], limit=3)]
      == ["a-card", "b-card", "c-card"])
check("no candidates, no odds", coach._card_odds([]) == [])


# ── THE EXPECTED-VALUE SUM ─────────────────────────────────────────────────

print("\nexpected win rate weighs their decks and drops the unscorable")


class FakeSnap:
    pass


def fake_win_prob(rates):
    """Patch `win_prob` with a lookup from the opponent's first card."""
    def inner(mine, theirs, snap):
        r = rates.get(theirs[0])
        return None if r is None else {"winRate": r, "games": 100,
                                       "source": "deck", "tier": "High"}
    return inner


real = coach.win_prob
try:
    coach.win_prob = fake_win_prob({"golem": 80.0, "x-bow": 40.0})
    opp = [D(deck("golem"), prob=0.5), D(deck("x-bow"), prob=0.5)]
    exp = coach._expected(A, opp, FakeSnap())
    check("an even split averages", abs(exp["winRate"] - 60.0) < 1e-6, str(exp["winRate"]))

    opp = [D(deck("golem"), prob=0.9), D(deck("x-bow"), prob=0.1)]
    exp = coach._expected(A, opp, FakeSnap())
    check("a likelier opponent counts for more", abs(exp["winRate"] - 76.0) < 1e-6,
          str(exp["winRate"]))

    # THE ONE THAT MATTERS. A deck with no evidence must be DROPPED, not scored
    # at 50% — an invented coin flip drags a real edge toward the middle and
    # makes two genuinely different candidates look alike.
    coach.win_prob = fake_win_prob({"golem": 80.0})       # x-bow unknown
    opp = [D(deck("golem"), prob=0.5), D(deck("x-bow"), prob=0.5)]
    exp = coach._expected(A, opp, FakeSnap())
    check("an unscorable opponent deck is dropped, not guessed at 50%",
          abs(exp["winRate"] - 80.0) < 1e-6, str(exp["winRate"]))
    check("and the dropped mass is reported so the reader can discount it",
          abs(exp["weight"] - 0.5) < 1e-6, str(exp["weight"]))
    check("every pairing is itemised", len(exp["per"]) == 2)

    coach.win_prob = fake_win_prob({})
    check("nothing scorable at all returns nothing rather than 50%",
          coach._expected(A, opp, FakeSnap()) is None)
finally:
    coach.win_prob = real


# ── THE OPENING ────────────────────────────────────────────────────────────
#
# "They open with this" and "they play this a lot" are different claims. Only
# ordered series can support the first, so the basis is always stated.

print("\nthe opening is only claimed when ordered series support it")

hog, golem, xbow = deck("hog-rider"), deck("golem"), deck("x-bow")


def hist(firsts, all_decks, series=None):
    return {
        "firsts": firsts, "allDecks": all_decks,
        "series": series if series is not None else [None] * len(firsts),
        "seriesDecks": [], "arch": lambda c: "hog", "marks": lambda c: {},
        "archiveUsed": False,
    }


r = coach.opening_decks("#T", hist([hog, hog, golem, xbow], [hog] * 9))
check("enough ordered series ranks by game 1", r["basis"] == "first-game history", r["basis"])
check("and counts the openings, not the games", r["nObs"] == 4, str(r["nObs"]))

r = coach.opening_decks("#T", hist([hog, golem], [hog] * 30))
check("too few falls back to overall play rate", r["basis"] == "overall play rate", r["basis"])
check("and says so via lowConfidence", r["lowConfidence"] is True)
check("the fallback counts every duel deck", r["nObs"] == 30, str(r["nObs"]))
check("the threshold is the bot's", coach.MIN_FIRST_SERIES == 3)

r = coach.opening_decks("#T", hist([], []))
check("no duel history returns nothing rather than an empty ranking",
      r["decks"] == [] and r["basis"] is None and r["lowConfidence"] is True)

# Four ordered series clears the floor but is still thin, and the flag has two
# independent reasons to fire.
r = coach.opening_decks("#T", hist([hog, hog, golem], [hog] * 5))
check("a thin but ordered read is flagged too", r["lowConfidence"] is True, str(r))


# ── THE DISTRIBUTION TOP-UP ────────────────────────────────────────────────

print("\ntopping up a thin read never makes it look confident")

check("their own history keeps most of the mass", coach.OPP_HISTORY_MASS == 0.7)

pop = [D(deck("golem"), deckName="Golem"), D(deck("x-bow"), deckName="X-Bow")]
real_pop = coach._population_decks
try:
    coach._population_decks = lambda limit=24: [dict(d, fill=True) for d in pop]
    # A variant of something already listed is not a second option.
    near = D(deck("golem") [:8], deckName="Golem variant")
    fills = coach._fills([near], set(), 2)
    check("a fill that is a variant of a listed deck is skipped",
          all(len(set(f["cards"]) & set(near["cards"])) < coach.MIN_OVERLAP for f in fills),
          str([f["deckName"] for f in fills]))
    check("fills are labelled, never silently mixed in",
          all(f.get("fill") for f in fills), str(fills))
    check("asking for none returns none", coach._fills([], set(), 0) == [])
    check("a fill must still be legal",
          coach._fills([], set(deck("golem")), 2)
          and all(not (set(f["cards"]) & set(deck("golem")))
                  for f in coach._fills([], set(deck("golem")), 2)))
finally:
    coach._population_decks = real_pop


# ── THE READ ───────────────────────────────────────────────────────────────
#
# Explanatory, never a second opinion. It must not imply a sharper read than
# the numbers support — which is measured, not stylistic: counter-sniping made
# the bot's top-1 accuracy three times worse when it was tried as a feature.

print("\nthe read states the evidence and grades its own confidence")

best_strong = D(hog, deckName="Hog Cycle", expected={"winRate": 72.0, "weight": 1.0, "per": []})
best_slight = D(hog, deckName="Hog Cycle", expected={"winRate": 57.0, "weight": 1.0, "per": []})
best_flip = D(hog, deckName="Hog Cycle", expected={"winRate": 51.0, "weight": 1.0, "per": []})
best_none = D(hog, deckName="Hog Cycle", expected=None)

opp_one = {"decks": [D(golem, prob=1.0, deckName="Golem")], "source": "opponent-history"}
opp_wide = {"decks": [D(golem, prob=0.2, deckName="Golem"),
                      D(xbow, prob=0.2, deckName="X-Bow"),
                      D(hog, prob=0.2, deckName="Hog")], "source": "opponent-history"}


def text(*a):
    return " ".join(coach._read(*a))


check("a big edge is called an edge",
      "a real edge" in text(1, best_strong, opp_one, [], [golem], None))
check("a small one is not oversold",
      "slight edge" in text(1, best_slight, opp_one, [], [golem], None))
check("a coin flip is called a coin flip",
      "coin flip" in text(1, best_flip, opp_one, [], [golem], None))
check("with no matchup evidence it says what it ranked on instead",
      "no matchup evidence" in text(1, best_none, opp_one, [], [golem], None))

check("one legal deck left is stated as certainty, not a percentage",
      "Only Golem fits" in text(2, best_strong, opp_one, [hog], [golem, xbow], None))
check("a wide field is called a lean",
      "treat this as a lean" in text(1, best_strong, opp_wide, [], [golem], None))

check("burned decks are named, because that is the constraint people forget",
      "cannot repeat" in text(1, best_strong, opp_one, [hog], [golem], None))
check("at the opening it says nothing is burned",
      "Nothing is burned yet" in text(0, best_strong, opp_wide, [], [], None))

obs = {"times": 2, "decks": [D(golem, deckName="Golem"), D(xbow, deckName="X-Bow")]}
said = text(1, best_strong, opp_one, [], [hog], obs)
check("an observed loadout is reported as a fact with its count",
      "2 times" in said and "Golem + X-Bow" in said, said)
check("seen once reads 'once', not '1 times'",
      "once" in text(1, best_strong, opp_one, [], [hog], {"times": 1, "decks": obs["decks"]}))

check("nothing to say is an empty read, not an invented one",
      coach._read(0, None, {"decks": [], "source": "population"}, [], [], None) == [])


# ── CAVEATS ────────────────────────────────────────────────────────────────

print("\nevery reason to distrust the answer is listed separately")

none_hist = hist([], [])
full_hist = hist([hog] * 5, [hog] * 40)

c = coach._caveats(full_hist, none_hist, {"source": "population"}, "expected win rate")
check("no opponent history says so", any("No duel history for the opponent" in x for x in c), str(c))
check("and does NOT also claim the list was topped up",
      not any("topped up" in x for x in c), str(c))

c = coach._caveats(full_hist, full_hist,
                   {"source": "opponent-history+population"}, "expected win rate")
check("a blended list explains the blend and quotes the share",
      any("topped up" in x and "30%" in x for x in c), str(c))

c = coach._caveats(none_hist, full_hist, {"source": "opponent-history"}, "expected win rate")
check("no history of my own is its own caveat",
      any("No duel history for you" in x for x in c), str(c))

c = coach._caveats(full_hist, full_hist, {"source": "opponent-history"}, "how much you play it")
check("ranking without matchup evidence is stated outright",
      any("ranked by how much you play them" in x for x in c), str(c))

check("a full read with evidence carries no caveats",
      coach._caveats(full_hist, full_hist,
                     {"source": "opponent-history"}, "expected win rate") == [])

thin = hist([hog], [hog, hog])
check("a thin opponent history is quantified, not just flagged",
      any("2 duel games" in x for x in
          coach._caveats(full_hist, thin, {"source": "opponent-history"}, "expected win rate")))


# ── THEIR REAL DUEL LOADOUTS ───────────────────────────────────────────────
#
# Not a ranking — a record. Everything else on the screen says what they COULD
# bring; this says which three-deck loadouts they HAVE brought that contain the
# deck just pasted.
#
# The first version anchored on game 1, on the theory that "when they opened
# with this they followed it with that" is the sharper claim. It is, and it is
# also the wrong question: a coach pastes the deck they have just SEEN, which is
# game 2 as often as game 1. Measured over 40 decks these players really ran but
# not necessarily first, the anchor found 62 series and left 20 of the 40
# showing NOTHING — every one of which has a recorded loadout.

print(chr(10) + "their real duel loadouts containing the pasted deck")

hogd, gold, xbowd, mind = deck("hog-rider"), deck("golem"), deck("x-bow"), deck("miner")
hogv = hogd[:7] + ["ice-spirit"]        # one card different: same deck at 6-of-8


def game(cards, result="win"):
    return {"cards": list(cards), "result": result}


def series(games, source="reconstructed", when="2026-08-01T00:00:00Z", won=True):
    return {"games": [game(g) for g in games],
            "source": source, "startTime": when, "opponentName": "Rival",
            "format": "bo3", "caption": "EDGED IT", "won": won}


def H(all_series):
    return {"series": all_series, "seriesDecks": [], "allDecks": [], "firsts": [],
            "arch": lambda c: "hog", "marks": lambda c: {}, "archiveUsed": False}


log = H([
    series([hogd, gold, xbowd]),
    series([gold, hogd, xbowd], when="2026-07-29T00:00:00Z"),   # hog is GAME 2
    series([gold, xbowd, hogv], when="2026-07-28T00:00:00Z"),   # a variant, GAME 3
    series([mind, gold, xbowd], when="2026-07-27T00:00:00Z"),   # no hog at all
])

r = coach.observed_sequences([hogd], log)
check("a deck played in ANY slot is found, not only as the opener",
      r["matched"] == 3, f"{r['matched']} (anchoring here is what showed a blank panel)")
check("a duel that never used it is not counted", r["matched"] == 3)
check("how many duels were examined is reported", r["searched"] == 4, str(r["searched"]))

pos = sorted(L["position"] for L in r["loadouts"])
check("each loadout says WHICH game they brought it in", pos == [1, 2, 3], str(pos))
check("the whole three-deck loadout comes back, not just what followed",
      all(len(L["games"]) == 3 for L in r["loadouts"]),
      str([len(L["games"]) for L in r["loadouts"]]))
check("exactly one deck per loadout is flagged as the one pasted",
      all(sum(1 for g in L["games"] if g["revealed"]) == 1 for L in r["loadouts"]))
check("the decks that travel with it are aggregated", len(r["nextDecks"]) >= 1)

check("both exact matches and variants are found",
      {L["exact"] for L in r["loadouts"]} == {True, False},
      str({L["exact"] for L in r["loadouts"]}))

# NATIVE rows: the loadout is real, the ORDER is not recorded.
nat = H([series([hogd, gold, xbowd], source="native")])
n = coach.observed_sequences([hogd], nat)
check("a native duel still counts — the three decks are a real loadout",
      n["matched"] == 1, str(n["matched"]))
check("but it is flagged as having no usable game order",
      n["loadouts"][0]["ordered"] is False and n["loadouts"][0]["position"] is None)
check("and the ordered count is reported separately", n["ordered"] == 0, str(n["ordered"]))

# Repeats collapse into ONE loadout with a count and a record.
rep = H([series([hogd, gold, xbowd], when="2026-08-0%dT00:00:00Z" % d, won=(d == 2))
         for d in (1, 2, 3)])
g = coach.observed_sequences([hogd], rep)
check("the same loadout run three times is ONE row, counted",
      len(g["loadouts"]) == 1 and g["loadouts"][0]["times"] == 3,
      f"{len(g['loadouts'])} rows")
check("with the record of how those duels went",
      (g["loadouts"][0]["wins"], g["loadouts"][0]["losses"]) == (1, 2),
      str((g["loadouts"][0]["wins"], g["loadouts"][0]["losses"])))
check("and the most recent date", g["loadouts"][0]["lastSeen"].startswith("2026-08-03"))

# Two reveals: BOTH must be in the loadout, consecutively and in order.
two = coach.observed_sequences([gold, hogd], log)
check("two reveals need both decks, consecutively and in order",
      two["matched"] == 1, str(two["matched"]))
check("and both are flagged as pasted",
      sum(1 for x in two["loadouts"][0]["games"] if x["revealed"]) == 2)

# Ranking and limits.
many = H([series([hogd, gold, xbowd]), series([hogd, gold, xbowd]),
          series([hogd, gold, xbowd]), series([hogd, mind, xbowd])])
mm = coach.observed_sequences([hogd], many)
check("the most-run loadout is listed first",
      mm["loadouts"][0]["times"] == 3, str([L["times"] for L in mm["loadouts"]]))
check("the listing is capped",
      len(coach.observed_sequences([hogd], H([
          series([hogd, gold, xbowd], when="2026-07-%02dT00:00:00Z" % d)
          for d in range(1, 12)]), limit=3)["loadouts"]) <= 3)

check("a deck they have never run matches nothing",
      coach.observed_sequences([deck("mortar")], log)["matched"] == 0)
check("no reveals, no answer", coach.observed_sequences([], log)["matched"] == 0)


print("\nper-archetype chips under every Suggestion deck (Team Scout's `vs`)")
G1, G2, X1 = deck("golem", "night-witch"), deck("golem", "lumberjack"), deck("x-bow")
per = [{"cards": G1, "prob": 0.3, "matchup": {"winRate": 60.0}},
       {"cards": G2, "prob": 0.1, "matchup": {"winRate": 40.0}},
       {"cards": X1, "prob": 0.4, "matchup": {"winRate": 47.0}},
       {"cards": deck("hog-rider"), "prob": 0.2, "matchup": None}]
vs = coach._vs_from_per(per)
check("two decks of one archetype are ONE chip, likelihood-weighted",
      [v for v in vs if v["archetype"] == "golem"][0]["winRate"] == 55.0, str(vs))
check("chips run most likely first, by the archetype's SUMMED share "
      "(Golem 0.3+0.1 ties X-Bow 0.4, then by key)",
      [v["archetype"] for v in vs] == ["golem", "xbow"], str(vs))
check("an archetype with no record is ABSENT, never 50",
      all(v["archetype"] != "hog" for v in vs), str(vs))
check("every chip carries a display name, not the key",
      [v["name"] for v in vs] == ["Golem", "X-Bow"], str(vs))

real = coach.win_prob
try:
    coach.win_prob = fake_win_prob({"golem": 80.0, "x-bow": 40.0})
    exp = coach._expected(A, [D(deck("golem"), prob=0.5), D(deck("x-bow"), prob=0.5)], FakeSnap())
    check("_expected publishes the chips beside the headline",
          [(v["name"], v["winRate"]) for v in exp["vs"]] == [("Golem", 80.0), ("X-Bow", 40.0)],
          str(exp.get("vs")))
finally:
    coach.win_prob = real

rec = {"golem": {"winRate": 62.0}, "xbow": {"winRate": 48.5}, "lava": {"winRate": 70.0}}
got = coach._vs_from_record(rec, ["xbow", "golem", "hog"], {"xbow": 0.6, "golem": 0.3, "hog": 0.1})
check("a composed deck's chips are its record against THEIR archetypes only, in "
      "their order, missing ones absent",
      [(v["archetype"], v["winRate"]) for v in got] == [("xbow", 48.5), ("golem", 62.0)],
      str(got))


print("\nfive chips, not two: likely -> their other win cons -> the meta")
# The live screen that asked for this: no duel history for them, so their
# likely decks were three meta decks and two archetypes — two chips per deck.
likely = [D(deck("hog-rider", "musketeer"), prob=0.47),
          D(deck("hog-rider", "tesla"), prob=0.29),
          D(deck("goblin-barrel"), prob=0.24)]
meta = [{"cards": deck("x-bow"), "archetype": "xbow", "count": 300},
        {"cards": deck("golem"), "archetype": "golem", "count": 200},
        {"cards": deck("hog-rider"), "archetype": "hog", "count": 900},
        {"cards": deck("balloon"), "archetype": "other", "count": 999},
        {"cards": deck("graveyard"), "archetype": "graveyard", "count": 100}]
ch = coach._chip_archetypes(likely, {"lava": 50, "other": 400, "hog": 10}, meta)
check("five chips", len(ch) == coach.CHIP_ARCHETYPES == 5, str(ch))
check("their likely archetypes lead, by share",
      [c["archetype"] for c in ch[:2]] == ["hog", "bait"]
      and [c["kind"] for c in ch[:2]] == ["likely", "likely"], str(ch))
check("then a win condition they play that was not predicted",
      ch[2] == {"archetype": "lava", "kind": "theirs", "share": None}, str(ch))
check("then the meta's most-played, skipping what is already there",
      [(c["archetype"], c["kind"]) for c in ch[3:]] == [("xbow", "meta"), ("golem", "meta")],
      str(ch))
check("`other` is never a chip", all(c["archetype"] != "other" for c in ch))
check("with no opponent the chips come from the meta alone (four real "
      "archetypes in this fixture once `other` is dropped)",
      [c["kind"] for c in coach._chip_archetypes([], None, meta)] == ["meta"] * 4,
      "four real meta archetypes exist here besides `other`")

real_prof = coach.counter.deck_profile
try:
    coach.counter.deck_profile = lambda cards: {"archetypes": {"lava": {"winRate": 47.0},
                                                               "xbow": {"winRate": 61.0}}}
    per = [{"cards": likely[0]["cards"], "prob": 0.47, "matchup": {"winRate": 60.0}},
           {"cards": likely[2]["cards"], "prob": 0.24, "matchup": {"winRate": 68.0}}]
    got = coach._chips(deck("graveyard"), per, ch, None)
    check("a likely chip reads off `per`, the others off the deck's own record",
          [(v["archetype"], v["winRate"], v["kind"]) for v in got]
          == [("hog", 60.0, "likely"), ("bait", 68.0, "likely"),
              ("lava", 47.0, "theirs"), ("xbow", 61.0, "meta")], str(got))
    check("an archetype with no record anywhere is absent, not 50",
          all(v["archetype"] != "golem" for v in got))
    rec = {"hog": {"winRate": 77.0}, "bait": {"winRate": 78.0}, "lava": {"winRate": 70.0},
           "xbow": {"winRate": 55.0}, "golem": {"winRate": 49.0}}
    tuned = coach._chips(deck("goblin-drill"), None, ch, None, record=rec)
    check("a tuner deck reads all five off its own record, in chip order",
          [v["winRate"] for v in tuned] == [77.0, 78.0, 70.0, 55.0, 49.0], str(tuned))
finally:
    coach.counter.deck_profile = real_prof


# ── THE FUSED RATE AND THE DUEL BRAIN (2026-09-27) ──────────────────────────
#
# Team Analysis's two duel-aware pieces, used by Coach Assist. The engine is
# tested where it lives (`test_matchup_fusion`, `test_duel_brain`,
# `test_team_analysis`); what is pinned here is the WIRING: one engine per
# request, an off-switch that restores the old answer exactly, and duel picks
# that obey the duel's own rule — no card already spent, ever.
print("\nthe fused rate and the duel brain")


class FakeRates:
    """`_Rates`' surface: a rate looked up by the opponent's first card (or
    the archetype asked about), and a record of every call."""

    def __init__(self, table, duel=None, on=True):
        self.on = on
        self.table = table
        self.duel = duel
        self.calls = []
        self.prepared = []

    def rate(self, mine, theirs=None, archetype=None):
        self.calls.append((tuple(mine), tuple(theirs or ()), archetype))
        r = self.table.get(theirs[0] if theirs else archetype)
        return None if r is None else {"winRate": r, "games": 50, "source": "version",
                                       "tier": "high", "interval": None, "decks": None}

    def prepare(self, mine, theirs):
        self.prepared.append((len(list(mine)), len(list(theirs))))

    def summary(self):
        return {"brain": "test", "sources": {}}


real = coach.win_prob
try:
    def boom(*_a, **_k):
        raise AssertionError("win_prob ran beside the fused rate")

    coach.win_prob = boom
    fr = FakeRates({"golem": 70.0, "x-bow": 50.0})
    opp = [D(deck("golem"), prob=0.5), D(deck("x-bow"), prob=0.5)]
    try:
        exp = coach._expected(A, opp, FakeSnap(), fr)
        one_engine = True
    except AssertionError:
        exp, one_engine = None, False
    check("with the fused rate on, every pairing is the fused rate — win_prob never runs",
          one_engine and abs(exp["winRate"] - 60.0) < 1e-6, str(exp))
    check("each pairing carries the fused source, so the screen can name it",
          one_engine and exp["per"][0]["matchup"]["source"] == "version")

    coach.win_prob = fake_win_prob({"golem": 80.0, "x-bow": 40.0})
    off = FakeRates({"golem": 1.0}, on=False)
    exp = coach._expected(A, opp, FakeSnap(), off)
    check("with it off, win_prob answers exactly as before",
          abs(exp["winRate"] - 60.0) < 1e-6, str(exp["winRate"]))
    check("and an off rater is never consulted — one engine per request", off.calls == [])

    check("an archetype chip reads the fused archetype levels",
          coach._rate_vs_archetype(A, "lava", FakeSnap(), FakeRates({"lava": 58.5})) == 58.5)
    check("and is absent, not 50, when the fused rate has nothing",
          coach._rate_vs_archetype(A, "lava", None, FakeRates({})) is None)
finally:
    coach.win_prob = real

saved_ta = coach._ta
try:
    coach._ta = None
    r = coach._Rates(None)
    check("without team_analysis the rater is OFF and says so (summary None)",
          not r.on and r.summary() is None)
    check("and it answers None rather than raising", r.rate(A, deck("golem")) is None)
finally:
    coach._ta = saved_ta

if coach._ta is None or getattr(coach._ta, "_duel", None) is None:
    print("  --   duel merge skipped: team_analysis / duel_brain not importable here")
else:
    dbrain = coach._ta._duel

    def key(cards):
        return ",".join(sorted(cards))

    class FakeDuel:
        """`_DuelContext`'s surface, over literal records in the index's shape."""

        def __init__(self, records, catalogue):
            self.on = True
            self.status = {"windowFrom": None}
            self.slot_gaps = 0
            self._records = records
            self.catalogue = catalogue

        def records(self, cards):
            return self._records.get(key(cards))

        def figures(self, cards, projection):
            return dbrain.public(dbrain.value(projection, self.records(cards)))

        def seat(self, cards):
            return list(cards), {}, True

    STRONG = {"exact": {"golem": [400, 300, 200]}}      # adjusted 75%, nEff 400
    WEAK = {"exact": {"golem": [40, 18, 20]}}           # under 50% once adjusted
    spent = deck("zap", "log")                            # game 1, already played
    OPTS = [D(deck("hog", "fireball"), count=9), D(deck("xbow", "tesla"), count=5),
            D(deck("lava", "balloon"), count=4)]
    # Distinct lists (their own fillers) and the illegal one the STRONGER, so
    # a missing legality filter would pick it and the check below goes red.
    # (Proven: with the filter removed from `_duel_merge` it fails.)
    ILLEGAL = deck("pekka", "zap")                        # stronger, shares Zap
    STRONGER = {"exact": {"golem": [400, 330, 200]}}
    LEGAL = deck("miner", "poison")                       # strong, legal
    opp = {"decks": [D(deck("golem"), prob=1.0)]}

    saved = (coach._archetype, coach._duel_decks, coach._rec)
    try:
        coach._archetype = lambda cards: list(cards)[0] if cards else "other"
        coach._duel_decks = lambda rates, tag, since, until: []
        coach._rec = lambda md, o, chips, snap, rates, extra=None: {
            **md, **(extra or {}), "expected": {"winRate": 55.0, "per": [], "vs": []}}

        def run(records, catalogue, recs=None):
            rates = FakeRates({}, duel=FakeDuel(records, catalogue))
            rows = [dict(o, expected={"winRate": 60.0 - i, "per": [], "vs": []})
                    for i, o in enumerate(recs or OPTS)]
            return coach._duel_merge(rows, opp, [], None, rates, set(spent), OPTS,
                                     my_tag="", my_win=(None, None),
                                     opp_tag="", opp_win=(None, None))

        cat = [{"key": key(ILLEGAL), "cards": ILLEGAL, "archetype": "pekka",
                "records": STRONGER},
               {"key": key(LEGAL), "cards": LEGAL, "archetype": "miner",
                "records": STRONG}]
        top, brain = run({key(LEGAL): STRONG, key(ILLEGAL): STRONGER}, cat)
        cards_on = [set(t["cards"]) for t in top]
        check("a population pick sharing a card already spent is NEVER offered",
              all(not (c & set(spent)) for c in cards_on), str([t["cards"][:2] for t in top]))
        check("a legal duel-proven deck takes the held slot, directly under the #1",
              len(top) == coach.MY_TOP_DECKS and set(top[1]["cards"]) == set(LEGAL)
              and top[1].get("duelPick") == dbrain.PICK_POPULATION
              and top[0]["cards"] == OPTS[0]["cards"], str([t["cards"][:2] for t in top]))
        check("the list stays three long and the #1 is untouched",
              len(top) == 3 and top[0]["cards"] == OPTS[0]["cards"])
        check("the report says one pick was held", brain and brain["picked"] == 1, str(brain))

        top, brain = run({key(OPTS[1]["cards"]): STRONG, key(LEGAL): STRONG}, cat)
        check("an option already proven in duels fills the slot — nothing is inserted",
              brain["picked"] == 0 and [t["cards"] for t in top] == [o["cards"] for o in OPTS]
              and top[1].get("duelProven"), str(brain))

        top, brain = run({key(LEGAL): WEAK}, [dict(cat[1], records=WEAK)])
        check("a deck whose duel record is not strong is not picked",
              brain["picked"] == 0 and [t["cards"] for t in top] == [o["cards"] for o in OPTS])
        check("every option still carries its duel figures (None when too thin)",
              all("duel" in t for t in top))
    finally:
        coach._archetype, coach._duel_decks, coach._rec = saved


# ── the tuner honours the duel too ───────────────────────────────────────────
# Reported: game 1 was a Giant Skeleton drill deck, and after it the tuner's
# loadout offered a Giant Skeleton graveyard deck — `tune` handed the swaps and
# the composer the spent cards and forgot the loadout. A fake tuner records
# what each call was given, so the CALLER's side is pinned here.
print(chr(10) + "every list the tuner returns is told what has been spent")
import types  # noqa: E402

calls: dict = {}
fake_tuner = types.ModuleType("deck_tuner")
fake_tuner.rank = lambda cards, archs, **kw: calls.setdefault("rank", kw) and {}
fake_tuner.compose = lambda archs, **kw: calls.setdefault("compose", kw) and {"decks": []}
fake_tuner.personalise = lambda rows, profile: rows
fake_tuner.playstyle_families = lambda fams: set()
fake_tuner.loadout = lambda archs, **kw: calls.setdefault("loadout", kw) and {"decks": []}
fake_harmony = types.ModuleType("deck_harmony")
fake_harmony.veto = lambda cards: None
fake_harmony.check = lambda cards: {}
saved_mods = {k: sys.modules.get(k) for k in ("deck_tuner", "deck_harmony")}
saved_spread = coach._spread
sys.modules["deck_tuner"], sys.modules["deck_harmony"] = fake_tuner, fake_harmony
coach._spread = lambda decks: (["hogcycle"], {"hogcycle": 1.0})
# NO TABLE, whatever this machine has built: the VPS has a real one, and a
# check that reads it is testing the host, not the code.
no_table = types.ModuleType("deck_synergy")
no_table.load = lambda: None
saved_mods["deck_synergy"] = sys.modules.get("deck_synergy")
sys.modules["deck_synergy"] = no_table
try:
    SPENT = {"giant-skeleton", "goblin-drill", "bomber", "arrows",
             "fireball", "tesla", "knight", "skeletons"}
    BEST = ["hog-rider", "musketeer", "ice-spirit", "cannon",
            "the-log", "ice-golem", "earthquake", "firecracker"]
    out = coach.tune(BEST, [{"cards": BEST}], used=SPENT, games_left=2)
    check("the swaps are told the spent cards", calls["rank"].get("used") == SPENT)
    check("the composer is told the spent cards", calls["compose"].get("used") == SPENT)
    check("THE LOADOUT is told the spent cards", calls["loadout"].get("used") == SPENT,
          str(calls["loadout"]))
    check("and is sized to the games left, not always three",
          calls["loadout"].get("size") == 2, str(calls["loadout"].get("size")))

    # THE SYNERGY GATE reaches both lists that draw on the composer. With no
    # table the gate is None (today's list, never an empty one); with a table
    # it is a callable answering (passes, percentile).
    check("no synergy table = no gate, for the composer and the loadout",
          calls["compose"].get("synergy", "absent") is None
          and calls["loadout"].get("synergy", "absent") is None)
    fake_syn = types.ModuleType("deck_synergy")
    fake_syn.load = lambda: {"n": 1}
    fake_syn.passes = lambda cards, table=None: "hog-rider" not in cards
    fake_syn.percentile = lambda cards, table=None: 5 if "hog-rider" in cards else 70
    fake_syn.duel_record = lambda cards, table=None: None if "hog-rider" in cards else [40, 22]
    saved_syn = sys.modules.get("deck_synergy")
    sys.modules["deck_synergy"] = fake_syn
    try:
        calls.clear()
        coach.tune(BEST, [{"cards": BEST}], used=SPENT, games_left=2)
        g1, g2 = calls["compose"].get("synergy"), calls["loadout"].get("synergy")
        check("WITH a table, the composer gets the gate",
              callable(g1) and g1(BEST) == (False, 5, None) and g1(SPENT) == (True, 70, [40, 22]),
              str(g1))
        check("and so does the loadout", callable(g2) and g2(BEST) == (False, 5, None))
    finally:
        if saved_syn is None:
            sys.modules.pop("deck_synergy", None)
        else:
            sys.modules["deck_synergy"] = saved_syn

    calls.clear()
    out = coach.tune(BEST, [{"cards": BEST}], used=SPENT, games_left=1)
    check("with one game left there is no loadout (it would repeat the composer)",
          "loadout" not in calls and out["loadout"] is None)

    # A SWAP IS A DECK WE TELL THEM TO PLAY: the tuner's veto is the checklist
    # and then the package gate, measured against the deck being changed.
    veto = calls["rank"].get("veto")
    saved_ok = coach._constructed_ok
    seen = []
    try:
        coach._constructed_ok = lambda cards, seed=None: bool(seen.append(seed)) or "freeze" not in cards
        check("the tuner's veto passes a swap the package gate passes", callable(veto) and veto(BEST) is None)
        check("...refuses one it does not, with a reason",
              isinstance(veto(BEST[:7] + ["freeze"]), str))
        check("...and judges it against the deck being tuned", seen and all(s == BEST for s in seen), str(seen[:1]))
        fake_harmony.veto = lambda cards: "no air answer"
        check("the checklist's own reason still comes first", veto(BEST) == "no air answer")
    finally:
        fake_harmony.veto = lambda cards: None
        coach._constructed_ok = saved_ok
finally:
    coach._spread = saved_spread
    for k, v in saved_mods.items():
        if v is None:
            sys.modules.pop(k, None)
        else:
            sys.modules[k] = v


print("\na clearly better duel-proven pick leads (2026-09-30)")


def _row(name, rate, pick=None, strong=False):
    r = {"deckName": name, "cards": [f"{name}{i}" for i in range(8)], "expected": {"winRate": rate}}
    if pick:
        r["duelPick"] = pick
        r["duel"] = {"strong": strong}
    return r


live = [_row("Graveyard Poison", 49.8), _row("Bridge Spam Giant Skeleton", 56.3, "duel", True),
        _row("Bridge Spam Ronin", 42.8)]
out = coach._lead_with_proof(live)
check("the live screen's case: 56.3% duel-proven leads a 49.8% top row",
      out[0]["deckName"] == "Bridge Spam Giant Skeleton" and out[0].get("ledByDuel"))
check("nothing is dropped and the old #1 is second", [r["deckName"] for r in out]
      == ["Bridge Spam Giant Skeleton", "Graveyard Poison", "Bridge Spam Ronin"])
check("the input is not mutated", "ledByDuel" not in live[1])
check("inside the margin the ladder's #1 stays",
      coach._lead_with_proof([_row("A", 55.0), _row("B", 57.9, "duel", True)])[0]["deckName"] == "A")
check("a duel pick that is not strong never leads",
      coach._lead_with_proof([_row("A", 50.0), _row("B", 60.0, "duel", False)])[0]["deckName"] == "A")
check("a better row with no duel proof never leads (that is the ladder's own order)",
      coach._lead_with_proof([_row("A", 50.0), _row("B", 60.0)])[0]["deckName"] == "A")
check("of two qualifying picks the higher leads",
      coach._lead_with_proof([_row("A", 50.0), _row("B", 55.0, "own", True),
                              _row("C", 58.0, "duel", True)])[0]["deckName"] == "C")
check("one row or none is returned as is",
      coach._lead_with_proof([]) == [] and coach._lead_with_proof([_row("A", 1.0)])[0]["deckName"] == "A")


print("\nevent decks leave the player's own history")
import deck_evidence as _dev  # noqa: E402
_saved = _dev.known
EV = ["arrows", "dart-goblin", "goblin-barrel", "goblin-demolisher", "goblins", "inferno-tower",
      "mega-knight", "the-log"]
OK = [f"ok{i}" for i in range(8)]
LONE = [f"lone{i}" for i in range(8)]
verdicts = {",".join(sorted(EV)): {"verdict": "event"}, ",".join(sorted(LONE)): {"verdict": "few_pilots"}}
_dev.known = lambda h: verdicts.get(h)
try:
    kept, dropped = coach._drop_event_decks([{"cards": EV}, {"cards": OK}, {"cards": LONE}])
    check("the event deck is dropped and counted", dropped == 1 and all(d["cards"] != EV for d in kept))
    check("a deck never vetted stays", any(d["cards"] == OK for d in kept))
    check("a player's own few-pilot deck stays — only `event` acts here", any(d["cards"] == LONE for d in kept))
finally:
    _dev.known = _saved


# ── THE FITTED READ (`duel_read`, 2026-10-07) ──────────────────────────────
#
# Which deck they bring next, from the ORDER and recency of their own duels.
# The model is `test_duel_read.py`'s; what is pinned here is the wiring: that
# Coach Assist uses it when it can, says so, and falls back when it cannot.

print("\nthe fitted read leads, and the counts stand behind it")

_T = 1_000_000_000.0
_DAY = 86400.0
_real_now = coach._now
coach._now = lambda: _T
RA, RB, RC, RD = deck("ra-open"), deck("rb-second"), deck("rc-third"), deck("rd-old")


def _rh(days_ago, decks, won=None, friendly=False):
    return {"t": _T - days_ago * _DAY, "decks": decks, "friendly": friendly,
            "won": won if won is not None else [True] * len(decks)}


def RH(read, firsts=None, all_decks=None):
    """A history with the read's rows beside the counted ones."""
    flat = all_decks if all_decks is not None else [d for h in read for d in h["decks"]]
    return {"firsts": firsts if firsts is not None else [h["decks"][0] for h in read],
            "allDecks": flat, "series": [],
            "seriesDecks": [h["decks"] for h in read],
            "arch": lambda c: "hog", "marks": lambda c: {}, "archiveUsed": False, "read": read}


# RB is in every duel and RD was played most of all, long ago; RA is what they
# OPEN with now. A count says RD or RB; the read says RA.
habit = ([_rh(d, [RD, RB]) for d in (29, 28, 27, 26, 25)]
         + [_rh(d, [RA, RB, RC]) for d in (4, 3, 2, 1)])
try:
    r = coach.opening_decks("#T", RH(habit))
    check("the read answers and says which engine did", r.get("engine") == coach._dr.BRAIN, str(r.get("engine")))
    check("the opener of their recent duels leads, not the most-played list",
          set(r["decks"][0]["cards"]) == set(RA), r["decks"][0]["cards"][0])
    check("every row is marked as the read's", all(d.get("read") for d in r["decks"]))
    seen = sum(d["prob"] for d in r["decks"])
    check("the figures leave room for a deck not seen",
          0 < seen < 1 and abs(r["newDeck"] - round(1 - seen, 4)) < 1e-3, f"{seen} {r.get('newDeck')}")
    check("the basis is still stated", r["basis"] == "first-game history")
    check("what they have left is filed by role",
          set(r["left"]["left"]) == {"wincon", "spell", "building", "support"}
          and r["left"]["spent"] == {"wincon": [], "spell": [], "building": [], "support": []})

    plain = RH(habit)
    del plain["read"]
    r0 = coach.opening_decks("#T", plain)
    check("a history without the read's rows is counted as before",
          "engine" not in r0 and not any(d.get("read") for d in r0["decks"]))

    r = coach.next_decks("#T", [RA], RH(habit))
    check("after the opener, what followed it leads", set(r["decks"][0]["cards"]) == set(RB))
    check("nothing offered shares a card with the reveal",
          all(not (set(d["cards"]) & set(RA)) for d in r["decks"]))
    top = r["decks"][0]
    odds = {c["card"]: c["prob"] for c in r["cards"]}
    check("a card's chance is the chance of the decks holding it, not a share of the list",
          abs(odds[top["cards"][0]] - round(top["prob"], 4)) < 1e-3 and odds[top["cards"][0]] < 1,
          str(odds.get(top["cards"][0])))
    check("the revealed deck is what is spent", sum(len(v) for v in r["left"]["spent"].values()) == 8)

    # Never seen with a deck that shares NO card with the reveal: the read has
    # nothing, and the tolerant count still shows what is near.
    NEAR = deck("near", "ra-open")                      # shares one card with RA
    only_near = [_rh(d, [RA, NEAR]) for d in (3, 2, 1)]
    r = coach.next_decks("#T", [RA], RH(only_near))
    check("with nothing strictly legal the tolerant count answers",
          "engine" not in r and len(r["decks"]) == 1 and set(r["decks"][0]["cards"]) == set(NEAR))

    wide = coach.opening_decks("#T", RH(habit), kind=True)["newDeck"]
    war = coach.opening_decks("#T", RH(habit), kind=False)["newDeck"]
    check("told the duel is friendly, a new deck is likelier", wide > war, f"{wide} vs {war}")

    o = coach.opponent_next("#O", [RA], RH(habit))
    check("the opponent's read carries what they have left",
          o.get("engine") == coach._dr.BRAIN and "left" in o and "newDeck" in o)
    shares = [d["prob"] for d in o["decks"] if d.get("read")]
    own = [d["p"] for d in o["decks"] if d.get("read")]
    check("their decks keep the read's proportions",
          len(shares) >= 2 and abs(shares[0] / shares[1] - own[0] / own[1]) < 1e-2, f"{shares} {own}")
    check("and the shares the win rate is weighted by sum to one",
          abs(sum(d["prob"] for d in o["decks"]) - 1.0) < 1e-9)

    # A PLAYER WHO ROTATES: seven decks, so the three likeliest hold well under
    # half of what may come. The recommendation is weighed against five.
    many = [deck(f"m{i}") for i in range(7)]
    rota = [_rh(7 - i, [many[i], many[(i + 3) % 7]]) for i in range(7)]
    o = coach.opponent_next("#O", [], RH(rota))
    check("a flat read is scored against five decks, not three",
          len(o["decks"]) == coach.OPP_READ_DECKS == 5, str(len(o["decks"])))
    check("every one of them is worth scoring against",
          all(d["p"] >= coach.OPP_READ_MIN_P for d in o["decks"]))
    counted = RH(rota)
    del counted["read"]
    check("a counted read still lists three",
          len(coach.opponent_next("#O", [], counted)["decks"]) == coach.OPP_TOP_DECKS == 3)

    _real_read = coach._dr.read

    def _boom(*a, **k):
        raise RuntimeError("the read broke")

    coach._dr.read = _boom
    try:
        r = coach.opening_decks("#T", RH(habit))
        check("a read that raises costs nothing: the counts answer", "engine" not in r and len(r["decks"]) >= 1)
    finally:
        coach._dr.read = _real_read
finally:
    coach._now = _real_now

print("\na native duel is read in game order, with its games' results")
import types as _types  # noqa: E402

_fake_index = _types.ModuleType("duel_index")
N1, N2, N3 = deck("n-one"), deck("n-two"), deck("n-three")
_stamp = "20260901T120000.000Z"
_fake_index.iso_to_stamp = lambda iso, end=False: iso
_fake_index.player_results = lambda tag, lo, hi: {
    (_stamp, ",".join(sorted(N1))): True, (_stamp, ",".join(sorted(N2))): False}
_saved_index = sys.modules.get("duel_index")
sys.modules["duel_index"] = _fake_index
_rows = [{"battle_time": _stamp, "mode": "Duel_1v1_Friendly", "opponent_tag": "#OPP",
          "opponent_name": "Rival", "result": "win", "cards": N1 + N2 + N3, "opp_cards": [],
          "archetype": "hog", "opp_archetype": "", "crowns": 3, "opp_crowns": 1, "evo": None, "opp_evo": None},
         {"battle_time": "20260902T120000.000Z", "mode": "CW_Duel_1v1", "opponent_tag": "#OPP",
          "opponent_name": "Rival", "result": "loss", "cards": N2 + N1, "opp_cards": [],
          "archetype": "hog", "opp_archetype": "", "crowns": 0, "opp_crowns": 2, "evo": None, "opp_evo": None}]
_real_rows = coach.dx.read_duel_rows
coach.dx.read_duel_rows = lambda tag, since, until: (_rows, False)
coach._HISTORY_CACHE.clear()
try:
    h = coach._history("#NATIVE", "2026-08-25", "2026-09-05")
    check("a native duel's first block is its opener",
          sorted(map(sorted, h["firsts"])) == sorted([sorted(N1), sorted(N2)]), str(len(h["firsts"])))
    rd = h["read"]
    check("the read's history is oldest first, decks in game order",
          len(rd) == 2 and rd[0]["t"] < rd[1]["t"] and [sorted(d) for d in rd[0]["decks"]]
          == [sorted(N1), sorted(N2), sorted(N3)])
    check("each game's result comes from the duel index; one it does not hold is unknown, not a loss",
          rd[0]["won"] == [True, False, None], str(rd[0]["won"]))
    check("a friendly duel is marked, a clan-war duel is not",
          rd[0]["friendly"] is True and rd[1]["friendly"] is False)
finally:
    coach.dx.read_duel_rows = _real_rows
    coach._HISTORY_CACHE.clear()
    if _saved_index is not None:
        sys.modules["duel_index"] = _saved_index
    else:
        del sys.modules["duel_index"]

print("\npick for the duel, not the game (2026-10-07)")
import duel_plan as _plan_oracle  # noqa: E402

_PA, _PB, _PC, _PD = deck("pa"), deck("pb"), deck("pc"), deck("pd")
_PX, _PY, _PZ = deck("px"), deck("py"), deck("pz")
# They bring X, then Y, then Z. A is my best deck against X and my only answer
# to Y — the case `test_duel_plan.py` works by hand: open B, keep A.
_PM = {("pa", "px"): 0.60, ("pb", "px"): 0.55, ("pc", "px"): 0.50,
       ("pa", "py"): 0.90, ("pb", "py"): 0.30, ("pc", "py"): 0.30}


def _tagof(cards):
    """The one named card of a `deck(...)`; the rest is filler."""
    return next(c for c in cards if not c.startswith("filler"))


def _fake_pair(model, rates, a, b, **kw):
    return _PM.get((_tagof(a), _tagof(b)), 0.5), "combined"


class _FakeRead:
    BRAIN = "duel-read-1.0"

    def __init__(self):
        self.calls = []

    def read(self, hist, rev, now, friendly_now=None, **kw):
        self.calls.append(([list(r) for r in rev], friendly_now, kw))
        nxt = {0: _PX, 1: _PY, 2: _PZ}.get(len(rev))
        return [{"cards": list(nxt), "p": 1.0}] if nxt else []


def _prow(cards, name):
    return {"cards": list(cards), "deckName": name, "archetype": "x", "art": {}, "brain": {"winRate": 1.0}}


_saved_plan = (coach._dr, coach._combined_pair, coach._dp)
_fr = _FakeRead()
coach._dr, coach._combined_pair = _fr, _fake_pair
try:
    P_TOP = [_prow(_PA, "A"), _prow(_PB, "B"), _prow(_PC, "C")]
    P_OPP = {"engine": "duel-read-1.0", "decks": []}
    P_HIST = {"read": [{"t": _T - _DAY, "decks": [_PX, _PY, _PZ]}]}
    P_CTX = {"model": {"weights": {}}, "kw": dict(my_def=None, opp_def=None, my_str=0.5, opp_str=0.5)}
    rows, info = coach._duel_plan(P_TOP, P_TOP, [], [], "", P_OPP, P_HIST, None, P_CTX, None)
    want = _plan_oracle.plan(
        [_PA, _PB, _PC],
        lambda rev, lost: [({0: _PX, 1: _PY, 2: _PZ}[len(rev)], 1.0)] if len(rev) < 3 else [],
        lambda a, b: _PM.get((_tagof(a) if a else "", _tagof(b) if b else ""), 0.5))
    wby = {o["deck"]: o for o in want["options"]}
    check("the options are re-ordered by the chance of winning the DUEL: B leads, A was best now",
          [r["deckName"] for r in rows] == ["B", "C", "A"], str([r["deckName"] for r in rows]))
    check("each row carries this game and the duel, in percent, as the plan computed them",
          rows[0]["plan"]["duel"] == round(100 * wby[1]["duel"], 1)
          and rows[0]["plan"]["game"] == 55.0 and rows[2]["plan"]["game"] == 60.0, str(rows[0]["plan"]))
    check("...and the deck to bring next, as a row the screen can draw",
          rows[0]["plan"]["then"]["won"]["deckName"] == "A"
          and sorted(rows[0]["plan"]["then"]["lost"]["cards"]) == sorted(_PA)
          and "brain" not in rows[0]["plan"]["then"]["won"])
    check("the summary says it ranked, that it changed the pick, and where the duel stands",
          info == {"brain": _plan_oracle.BRAIN, "games": 3, "finished": 0, "score": [0, 0], "results": "",
                   "ranked": True, "changed": True, "pool": 3}, str(info))
    check("the caller's rows are not mutated", "plan" not in P_TOP[0])
    check("the read is asked as the screen's own read is — the kind of duel, and never who lost",
          all(k == {} for _r, _f, k in _fr.calls) and _fr.calls and _fr.calls[0][1] is None)

    _fr.calls.clear()
    rows1, info1 = coach._duel_plan([_prow(_PB, "B"), _prow(_PC, "C")], [], [_PA], [_PX], "w", P_OPP, P_HIST,
                                    True, P_CTX, None)
    check("told who won game 1, the plan starts from 1-0",
          info1["score"] == [1, 0] and info1["results"] == "w" and info1["finished"] == 1)
    check("a win that ends the duel leaves nothing to bring after it",
          rows1[0]["plan"]["then"]["won"] is None and rows1[0]["plan"]["then"]["lost"] is not None)
    check("the kind of duel reaches the read", _fr.calls[0][1] is True)
    check("a result moves the chance of the next game: 30% after a win is more than 30%",
          rows1[0]["plan"]["game"] > 30.0, str(rows1[0]["plan"]))
    _r, info_u = coach._duel_plan([_prow(_PB, "B")], [], [_PA], [_PX], "", P_OPP, P_HIST, None, P_CTX, None)
    check("not told, the score is not claimed", info_u["score"] is None and info_u["results"] == "")
    _r, info_j = coach._duel_plan([_prow(_PB, "B")], [], [_PA], [_PX], "zzw!", P_OPP, P_HIST, None, P_CTX, None)
    check("anything that is not a result is dropped", info_j["results"] == "w")

    _fr.calls.clear()
    coach._duel_plan([_prow(_PB, "B")], [], [_PA], [], "w", P_OPP, P_HIST, None, P_CTX, None)
    check("a game of theirs whose deck is not known is handed to the read as a reveal that rules nothing out",
          _fr.calls[0][0] == [["?"]], str(_fr.calls[0][0]))

    rows2, info2 = coach._duel_plan([_prow(_PB, "B"), _prow(_PC, "C")], [_prow(_PA, "A"), _prow(_PD, "D")],
                                    [], [], "", P_OPP, P_HIST, None, P_CTX, None)
    check("the rest of my legal pool is planned with, but only the options are listed",
          info2["pool"] == 4 and [r["deckName"] for r in rows2] == ["B", "C"]
          and rows2[0]["plan"]["then"]["won"]["deckName"] == "A")
    many = [_prow(deck(f"m{i}"), f"M{i}") for i in range(12)]
    _r, info_m = coach._duel_plan(many[:3], many, [], [], "", P_OPP, P_HIST, None, P_CTX, None)
    check("the pool is capped", info_m["pool"] == coach.PLAN_POOL)
    short = [_prow(_PA, "A"), {"cards": _PB[:7], "deckName": "seven"}]
    rows3, info3 = coach._duel_plan(short, [], [], [], "", P_OPP, P_HIST, None, P_CTX, None)
    check("a row that could not be valued leaves the order alone",
          [r["deckName"] for r in rows3] == ["A", "seven"] and not info3["ranked"] and not info3["changed"]
          and "plan" in rows3[0] and "plan" not in rows3[1])

    check("no fitted read for the opponent: the list stands",
          coach._duel_plan(P_TOP, P_TOP, [], [], "", {"decks": []}, P_HIST, None, P_CTX, None) == (P_TOP, None))
    check("no history to read: the list stands",
          coach._duel_plan(P_TOP, P_TOP, [], [], "", P_OPP, {"read": []}, None, P_CTX, None) == (P_TOP, None))
    check("no win model: the list stands",
          coach._duel_plan(P_TOP, P_TOP, [], [], "", P_OPP, P_HIST, None, {}, None) == (P_TOP, None))
    check("two games played and decided, or three played: nothing to plan",
          coach._duel_plan(P_TOP, P_TOP, [_PD, _PD], [_PX, _PY], "ww", P_OPP, P_HIST, None, P_CTX, None)[1] is None
          and coach._duel_plan(P_TOP, P_TOP, [_PA, _PB, _PC], [_PX, _PY, _PZ], "", P_OPP, P_HIST, None, P_CTX,
                               None) == (P_TOP, None))

    # A DECK THEY HAVE NOT SHOWN IS PLAYED AT THEIR LEVELS, not maxed. The read
    # names X at 50%; the other half is unseen. Their known decks are two
    # levels down on every card and the model's only weight is the level term.
    class _Half(_FakeRead):
        def read(self, hist, rev, now, friendly_now=None, **kw):
            return [{"cards": list(_PX), "p": 0.5}]

    coach._dr = _Half()
    lv_ctx = {"model": {"weights": {"level": 1.0}},
              "kw": dict(my_def=None, opp_def={c: 2.0 for c in _PX + _PY + _PZ}, my_str=0.5, opp_str=0.5)}
    rows_lv, _i = coach._duel_plan([_prow(_PA, "A")], [], [_PB, _PC], [_PY, _PZ], "", P_OPP, P_HIST, None,
                                   lv_ctx, None)
    # 0.5 * 0.60 (A against X) + 0.5 * sigmoid(2 - 0) = 0.30 + 0.4404
    check("a deck they have not shown is rated at their own levels, not as a maxed deck",
          rows_lv[0]["plan"]["game"] == 74.0, str(rows_lv[0]["plan"]))
    coach._dr = _fr

    class _Boom(_FakeRead):
        def read(self, *a, **k):
            raise RuntimeError("read gone")

    coach._dr = _Boom()
    check("a read that raises returns the rows untouched, never an error",
          coach._duel_plan(P_TOP, P_TOP, [], [], "", P_OPP, P_HIST, None, P_CTX, None) == (P_TOP, None))
    coach._dr = _fr
    coach._dp = None
    check("no plan module: the list stands",
          coach._duel_plan(P_TOP, P_TOP, [], [], "", P_OPP, P_HIST, None, P_CTX, None) == (P_TOP, None))
finally:
    coach._dr, coach._combined_pair, coach._dp = _saved_plan

_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "coach.py"), encoding="utf-8").read()
_sug = _src[_src.index("def suggest("):_src.index("def mine_hist_pool(")]
check("suggest plans AFTER the brain has ranked and BEFORE it names the best deck",
      _sug.index("_brain(top, opp") < _sug.index("_duel_plan(top, mine, my_played, opp_played, results")
      < _sug.index("best = top[0] if top else None"))
check("...and the answer carries the plan", '"duelPlan": duel_plan' in _sug)

print("\na constructed deck must make sense as a deck (2026-10-07)")
_PK_BAD = deck("pk-odd")
_PK_OK = deck("pk-fine")
_PK_SEED = deck("pk-seed")
fake_pk = types.ModuleType("deck_packages")
pk_calls: list = []


def _pk_passes(cards, table=None, role_of=None, seed=None):
    pk_calls.append(seed)
    return set(cards) != set(_PK_BAD)


fake_pk.passes = _pk_passes
_saved_pk = sys.modules.get("deck_packages")
_saved_gate = coach._synergy_gate
sys.modules["deck_packages"] = fake_pk
try:
    pct = {",".join(sorted(_PK_OK)): 60, ",".join(sorted(_PK_SEED)): 4, ",".join(sorted(_PK_BAD)): 80}
    coach._synergy_gate = lambda: (lambda cards: (pct.get(",".join(sorted(cards)), 2) >= 10,
                                                  pct.get(",".join(sorted(cards)), 2), None))
    check("a deck both gates pass is fine", coach._constructed_ok(_PK_OK))
    check("the package gate alone stops a deck, whatever its pairing score", not coach._constructed_ok(_PK_BAD))
    check("...and is told the seed", coach._constructed_ok(_PK_OK, _PK_SEED) and pk_calls[-1] == _PK_SEED)
    low = deck("pk-low")                                   # pairing percentile 2
    check("the pairing gate stops a constructed deck with no seed", not coach._constructed_ok(low))
    check("...and one that pairs worse than the deck it was built from",
          not coach._constructed_ok(low, _PK_SEED))
    pct[",".join(sorted(low))] = 4
    check("a deck no worse than its own odd seed passes", coach._constructed_ok(low, _PK_SEED))
    check("...but not against a seed that pairs well", not coach._constructed_ok(low, _PK_OK))
    coach._synergy_gate = lambda: None
    check("no pairing table: the package gate still decides",
          coach._constructed_ok(_PK_OK) and not coach._constructed_ok(_PK_BAD))

    def _pk_boom(cards, table=None, role_of=None, seed=None):
        raise RuntimeError("table unreadable")

    fake_pk.passes = _pk_boom
    check("a package table that raises is no gate, never an error", coach._constructed_ok(_PK_BAD))
finally:
    coach._synergy_gate = _saved_gate
    if _saved_pk is None:
        sys.modules.pop("deck_packages", None)
    else:
        sys.modules["deck_packages"] = _saved_pk

check("real cards are filed under the four roles",
      [coach._role_of(c) for c in ("hog-rider", "fireball", "cannon", "musketeer")]
      == ["wincon", "spell", "building", "support"])

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
