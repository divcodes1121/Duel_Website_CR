"""test_team_scout.py — the coaching brain: projection, scoring, diversity.

    python server/test_team_scout.py

Plain asserts and a counter, matching the other suites here. NO DATABASE and no
snapshot: `team_scout` has no imports beyond the standard library, which is the
whole reason it was split out of `team_analysis`. Every case below runs against
literals in microseconds.

THE EIGHT CASES THE BRIEF NAMES are each a section below, by name. Four more
sections cover properties this codebase has already been bitten by:

  * THE MASS MUST SUM TO ONE. A distribution that does not is not a
    distribution, and every figure computed from it is scaled by an unknown
    constant;
  * AN INFERRED DECK MUST NEVER REPORT ITSELF AS OBSERVED. The single
    dishonesty this module exists to prevent — a generated deck presenting as
    something the opponent was seen playing;
  * THIN EVIDENCE MUST WIDEN THE PROJECTION, NOT SHARPEN IT. This is the exact
    inversion of the bug being replaced, where dropping the tail and
    renormalising made a five-battle read more confident than a hundred-battle
    one. If this test ever passes in the wrong direction the redesign has been
    undone;
  * THE FIXTURES MUST SPEAK THE PRODUCER'S VOCABULARY. `test_team_analysis.py`
    passed 59/59 against a field name that existed nowhere in the payload, and
    this file's fixtures are therefore built from the shapes
    `clash_data.player_report` and `deck_counter.seeds` actually emit —
    `matches` / `winCondition` / `lastSeen`, and `{archetype: [{cards, games,
    archetypes}]}` — not from what reads plausibly.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import team_scout as ts

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


# ── Fixtures ────────────────────────────────────────────────────────────────
#
# Card names are real keys from `cards.json` so a veto passed in from
# `deck_harmony` would have something to read, but nothing here depends on the
# catalogue — the module never looks a card up.

HOG = ["hog-rider", "musketeer", "cannon", "ice-golem",
       "skeletons", "the-log", "fireball", "ice-spirit"]
#: One card different from HOG. This is what a VARIANT is.
HOG_V1 = ["hog-rider", "musketeer", "cannon", "ice-golem",
          "skeletons", "the-log", "fireball", "electro-spirit"]
#: Two cards different from HOG.
HOG_V2 = ["hog-rider", "musketeer", "tesla", "ice-golem",
          "skeletons", "the-log", "fireball", "electro-spirit"]
GIANT = ["giant", "mini-pekka", "musketeer", "zap",
         "arrows", "minions", "knight", "elixir-collector"]
LAVA = ["lava-hound", "balloon", "mega-minion", "tombstone",
        "zap", "arrows", "skeleton-dragons", "guards"]
GRAVE = ["graveyard", "poison", "knight", "baby-dragon",
         "bowler", "tornado", "barbarian-barrel", "archers"]


def deck(cards, matches, *, wc="hog", last="20260920T120000.000Z",
         wins=None, name=""):
    """An opponent deck row, in `player_report`'s own vocabulary."""
    return {"cards": list(cards), "matches": matches,
            "wins": matches // 2 if wins is None else wins,
            "winCondition": wc, "lastSeen": last, "name": name,
            "winRate": 50.0}


def seed(cards, games, arch):
    return {"hash": ts.deck_key(cards), "cards": list(cards),
            "games": games, "archetypes": {arch: {"winRate": 50.0, "games": games}}}


SEEDS = {
    "hog": [seed(HOG, 9000, "hog"), seed(HOG_V1, 4000, "hog"),
            seed(HOG_V2, 2500, "hog")],
    "giant": [seed(GIANT, 7000, "giant")],
    "lava-hound": [seed(LAVA, 6000, "lava-hound")],
    "graveyard": [seed(GRAVE, 5000, "graveyard")],
}

NOW = "20260920T120000.000Z"


def rate_all(value, source="deck", games=400):
    """A ladder stub that answers every archetype the same."""
    return lambda arch: {"winRate": value, "source": source, "games": games,
                         "tier": "high"}


def rate_map(mapping, default=None, source="deck"):
    """A ladder stub with a per-archetype answer. `default=None` = no evidence."""
    def f(arch):
        v = mapping.get(arch, default)
        if v is None:
            return None
        return {"winRate": v, "source": source, "games": 400, "tier": "high"}
    return f


def mass_of(space, kind):
    return sum(t["likelihood"] for t in space["threats"] if t["evidence"] == kind)


# ── The eight cases ─────────────────────────────────────────────────────────


def case_1_many_known_decks():
    print("\ncase 1 — opponent has many known decks")
    decks = [deck(HOG, 40, wc="hog"), deck(GIANT, 30, wc="giant"),
             deck(LAVA, 20, wc="lava-hound"), deck(GRAVE, 10, wc="graveyard")]
    sp = ts.threat_space(decks, SEEDS, now=NOW)
    kinds = {t["evidence"] for t in sp["threats"]}

    check("their four decks are all projected",
          all(any(t["key"] == ts.deck_key(d) for t in sp["threats"])
              for d in (HOG, GIANT, LAVA, GRAVE)))
    check("it is not just the history — variants or inference are present",
          kinds & {ts.VARIANT, ts.INFERRED} != set(), str(kinds))
    check("observed still holds the majority of the mass",
          mass_of(sp, ts.OBSERVED) > 0.5, f"{mass_of(sp, ts.OBSERVED):.3f}")
    check("the most-played deck leads the projection",
          sp["threats"][0]["key"] == ts.deck_key(HOG),
          sp["threats"][0]["key"])


def case_2_thin_history():
    print("\ncase 2 — opponent has very little history")
    thin = ts.threat_space([deck(HOG, 2, wc="hog")], SEEDS, now=NOW)
    rich = ts.threat_space([deck(HOG, 200, wc="hog")], SEEDS, now=NOW)

    check("a thin read allocates MORE mass away from the observed deck",
          thin["churn"]["switch"] > rich["churn"]["switch"],
          f"thin {thin['churn']['switch']} vs rich {rich['churn']['switch']}")
    check("the thin read says its evidence is thin",
          thin["churn"]["evidence"] == "thin", thin["churn"]["evidence"])
    check("the thin read still names the deck they played",
          any(t["key"] == ts.deck_key(HOG) and t["evidence"] == ts.OBSERVED
              for t in thin["threats"]))
    check("nothing in a thin projection claims to be well-known beyond what was seen",
          all(t["confidence"] != ts.KNOWN
              for t in thin["threats"] if t["evidence"] != ts.OBSERVED))


def case_3_one_deck_dominates():
    print("\ncase 3 — one deck dominates the history")
    sp = ts.threat_space([deck(HOG, 120, wc="hog")], SEEDS, now=NOW)
    keys = [t["key"] for t in sp["threats"]]

    check("the dominant deck is first", keys[0] == ts.deck_key(HOG), keys[0])
    check("related variants appear beside it",
          any(t["evidence"] == ts.VARIANT for t in sp["threats"]))
    check("coverage reaches beyond that one archetype",
          len({t["archetype"] for t in sp["threats"]}) > 1,
          str({t["archetype"] for t in sp["threats"]}))
    check("it is not seven near-identical copies",
          len(set(keys)) == len(keys))

    # And the recommendations over it are not seven versions of one answer.
    pool = [
        {"cards": GIANT, "archetype": "giant"},
        {"cards": LAVA, "archetype": "lava-hound"},
        {"cards": GRAVE, "archetype": "graveyard"},
        {"cards": HOG_V1, "archetype": "hog"},
        {"cards": HOG_V2, "archetype": "hog"},
        {"cards": HOG, "archetype": "hog"},
    ]
    rows = [r for r in (ts.score(rate_all(60.0), sp["threats"], **c) for c in pool) if r]
    picked = ts.diversify(rows)
    archs = [p["archetype"] for p in picked]
    check("the portfolio is not one archetype repeated",
          len(set(archs)) > 1, str(archs))


def case_4_likely_but_bad_matchup():
    print("\ncase 4 — a likely deck we match up badly into")
    decks = [deck(HOG, 60, wc="hog"), deck(GIANT, 40, wc="giant")]
    sp = ts.threat_space(decks, SEEDS, now=NOW)

    # Strong against what they play LESS, weak against what they play most.
    row = ts.score(rate_map({"hog": 35.0, "giant": 70.0,
                             "lava-hound": 60.0, "graveyard": 60.0}),
                   sp["threats"], cards=LAVA, archetype="lava-hound")

    hog_rows = [m for m in row["matchups"] if m["archetype"] == "hog"]
    check("the hog threat is still carried with a real likelihood",
          hog_rows and hog_rows[0]["likelihood"] > 0.2,
          str(hog_rows[0]["likelihood"] if hog_rows else None))
    check("likelihood and matchup are separate fields",
          "matchupValue" in row and "threatCovered" in row
          and row["matchupValue"] != row["threatCovered"])
    check("the bad matchup pulls the headline down",
          row["matchupValue"] < 70.0, str(row["matchupValue"]))

    # The deck that beats their MAIN deck should outrank one that does not,
    # even though both beat something.
    good = ts.score(rate_map({"hog": 70.0, "giant": 35.0,
                              "lava-hound": 50.0, "graveyard": 50.0}),
                    sp["threats"], cards=GRAVE, archetype="graveyard")
    check("answering what they actually play ranks higher",
          good["recommendationScore"] > row["recommendationScore"],
          f"{good['recommendationScore']} vs {row['recommendationScore']}")


def case_5_unseen_but_related():
    print("\ncase 5 — an unseen but strongly related deck can appear")
    sp = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)
    variants = [t for t in sp["threats"] if t["evidence"] == ts.VARIANT]

    check("a never-observed variant is projected", bool(variants))
    check("it names the observed deck it came from",
          all(v["basis"] == ts.deck_key(HOG) for v in variants),
          str([v["basis"] for v in variants]))
    check("it reports zero observations",
          all(v["observedCount"] == 0 for v in variants))
    check("its similarity to the observed deck is published and below 1",
          all(0 < v["similarityToObserved"] < 1 for v in variants),
          str([v["similarityToObserved"] for v in variants]))
    check("a one-card variant outranks a two-card one",
          next((v["likelihood"] for v in variants if v["key"] == ts.deck_key(HOG_V1)), 0)
          > next((v["likelihood"] for v in variants if v["key"] == ts.deck_key(HOG_V2)), 0))


def case_6_no_evidence():
    print("\ncase 6 — no meaningful evidence")
    empty = ts.threat_space([], SEEDS, now=NOW)
    check("an empty history is a named state, not an empty ranking",
          empty["reason"] == "no_history" and empty["threats"] == [],
          str(empty["reason"]))
    check("churn falls back to the WIDE prior, not to zero",
          empty["churn"]["switch"] >= ts.SWITCH_MIN
          and empty["churn"]["evidence"] == "none",
          str(empty["churn"]))

    # And a candidate that can be scored against nothing returns nothing,
    # rather than the 50% an average over an empty set produces.
    sp = ts.threat_space([deck(HOG, 20, wc="hog")], SEEDS, now=NOW)
    none_row = ts.score(rate_map({}, default=None), sp["threats"],
                        cards=GIANT, archetype="giant")
    check("a candidate with no evidence scores None, never 50%",
          none_row is None, str(none_row))

    # Partial evidence must be reported as partial, and must cost something.
    part = ts.score(rate_map({"hog": 60.0}), sp["threats"],
                    cards=GIANT, archetype="giant")
    full = ts.score(rate_all(60.0), sp["threats"], cards=LAVA,
                    archetype="lava-hound")
    check("partial coverage is published", part["threatCovered"] < 1.0)
    check("partial coverage scores below full coverage at the same win rate",
          part["recommendationScore"] < full["recommendationScore"],
          f"{part['recommendationScore']} vs {full['recommendationScore']}")

    # BOTH DIRECTIONS, because the first fixture written here only tested one
    # and tested it wrongly. Answering `hog` covers the observed deck AND the
    # two variants of it — 88% of the projection — and at that coverage, off
    # exact-deck records, `known` is the honest word. The property being
    # asserted is that coverage MOVES the confidence, so it needs a candidate
    # measurable against a corner of the projection, not against most of it.
    corner = ts.score(rate_map({"graveyard": 60.0}), sp["threats"],
                      cards=GIANT, archetype="giant")
    check("broad coverage on strong evidence is stated as known",
          part["confidence"] == ts.KNOWN,
          f"{part['confidence']} at {part['threatCovered']}")
    check("coverage of one corner of the projection is speculative",
          corner["confidence"] == ts.SPECULATIVE,
          f"{corner['confidence']} at {corner['threatCovered']}")
    check("the two differ only by coverage, not by evidence quality",
          corner["evidenceStrength"] == part["evidenceStrength"],
          f"{corner['evidenceStrength']} vs {part['evidenceStrength']}")


def case_7_duplicates():
    print("\ncase 7 — near-identical recommendations are penalised")
    sp = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)

    # Three near-copies scoring highest, one genuinely different deck below.
    rows = []
    for cards, arch, rate in ((HOG, "hog", 62.0), (HOG_V1, "hog", 61.5),
                              (HOG_V2, "hog", 61.0), (LAVA, "lava-hound", 58.0)):
        r = ts.score(rate_all(rate), sp["threats"], cards=cards, archetype=arch)
        rows.append(r)

    picked = ts.diversify(rows, limit=3, minimum=1)
    keys = [p["key"] for p in picked]
    check("the different deck is promoted over a third near-copy",
          ts.deck_key(LAVA) in keys, str(keys))
    check("redundancy is published on every pick after the first",
          all("redundancy" in p for p in picked)
          and picked[0]["redundancy"] == 0.0)
    check("an adjusted score is published beside the raw one",
          all("adjustedScore" in p for p in picked))
    check("similarity is superlinear — four shared cards is nearly free",
          ts.similarity(["a", "b", "c", "d", "e", "f", "g", "h"],
                        ["a", "b", "c", "d", "1", "2", "3", "4"]) < 0.3)
    check("seven shared cards is decisive",
          ts.similarity(HOG, HOG_V1, "hog", "hog") > 0.85,
          str(ts.similarity(HOG, HOG_V1, "hog", "hog")))

    # SAME ARCHETYPE, DIFFERENT CARDS — the case pairwise similarity misses,
    # found by reviewing thirty real opponents rather than by reading. Two
    # Royal Hogs lists sharing three cards score 0.34 on `similarity`, so the
    # 2.0-point penalty let three of them take three of seven slots. Every
    # pair was genuinely dissimilar and the list was still three answers to
    # one plan.
    hog_a = ["hog-rider", "musketeer", "cannon", "ice-golem",
             "skeletons", "the-log", "fireball", "ice-spirit"]
    hog_b = ["hog-rider", "valkyrie", "tesla", "bomber",
             "goblins", "zap", "arrows", "electro-spirit"]
    hog_c = ["hog-rider", "knight", "tombstone", "archers",
             "guards", "barbarian-barrel", "poison", "bats"]
    check("two same-archetype lists CAN be dissimilar in cards",
          ts.similarity(hog_a, hog_b, "hog", "hog") < 0.35,
          str(ts.similarity(hog_a, hog_b, "hog", "hog")))

    sp2 = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)
    flat = []
    for cards, arch in ((hog_a, "hog"), (hog_b, "hog"), (hog_c, "hog"),
                        (LAVA, "lava-hound"), (GRAVE, "graveyard")):
        flat.append(ts.score(rate_all(60.0), sp2["threats"], cards=cards,
                             archetype=arch))
    chosen = ts.diversify(flat, limit=4, minimum=1)
    hogs = sum(1 for c in chosen if c["archetype"] == "hog")
    check("an archetype cannot take the whole portfolio on equal scores",
          hogs <= 2, f"{hogs} of {len(chosen)} are hog")
    check("the other archetypes are promoted into the freed slots",
          len({c["archetype"] for c in chosen}) >= 3,
          str([c["archetype"] for c in chosen]))

    # AND IT IS A COST, NOT A CAP. A genuine matchup edge must still be able
    # to buy the slot, or the portfolio starts refusing the right answer for
    # being the same shape as another right answer.
    strong = []
    for cards, arch, rate in ((hog_a, "hog", 72.0), (hog_b, "hog", 71.0),
                              (LAVA, "lava-hound", 52.0),
                              (GRAVE, "graveyard", 51.0)):
        strong.append(ts.score(rate_all(rate), sp2["threats"], cards=cards,
                               archetype=arch))
    picked2 = ts.diversify(strong, limit=3, minimum=1)
    check("a large edge still buys a second deck of one archetype",
          sum(1 for c in picked2 if c["archetype"] == "hog") == 2,
          str([(c["archetype"], c["recommendationScore"]) for c in picked2]))


def case_8_player_compatibility():
    print("\ncase 8 — our player's own pool matters")
    sp = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)

    practised = ts.score(rate_all(58.0), sp["threats"], cards=GIANT,
                         archetype="giant", fit_games=40)
    fresh = ts.score(rate_all(58.0), sp["threats"], cards=LAVA,
                     archetype="lava-hound", fit_games=0)
    ownerless = ts.score(rate_all(58.0), sp["threats"], cards=GRAVE,
                         archetype="graveyard")

    check("a deck they already pilot outranks an identical one they do not",
          practised["recommendationScore"] > fresh["recommendationScore"])
    check("player fit is its own field, not folded into the win rate",
          practised["matchupValue"] == fresh["matchupValue"]
          and practised["playerFit"] != fresh["playerFit"])
    check("the tiebreak cannot overturn a real matchup difference",
          ts.FIT_WEIGHT <= 1.5)
    check("an ownerless row publishes NO fit rather than zero",
          ownerless["playerFit"] is None, str(ownerless["playerFit"]))


# ── Four properties this codebase has been bitten by ────────────────────────


def property_mass_sums_to_one():
    print("\nproperty — the projection is a distribution")
    for label, decks in (
        ("one deck", [deck(HOG, 40, wc="hog")]),
        ("four decks", [deck(HOG, 40, wc="hog"), deck(GIANT, 20, wc="giant"),
                        deck(LAVA, 8, wc="lava-hound"), deck(GRAVE, 1, wc="graveyard")]),
        ("one battle", [deck(HOG, 1, wc="hog")]),
    ):
        sp = ts.threat_space(decks, SEEDS, now=NOW)
        total = sum(t["likelihood"] for t in sp["threats"])
        check(f"{label}: likelihoods sum to 1.0", abs(total - 1.0) < 1e-3,
              f"{total:.6f}")
        check(f"{label}: no negative or >1 likelihood",
              all(0.0 <= t["likelihood"] <= 1.0 for t in sp["threats"]))
        check(f"{label}: the published mass split matches the entries",
              abs(sum(sp["mass"].values()) - 1.0) < 1e-3, str(sp["mass"]))

    check("with no seed pool the projection degrades to the observed decks",
          all(t["evidence"] == ts.OBSERVED
              for t in ts.threat_space([deck(HOG, 40)], None, now=NOW)["threats"]))
    check("and that degraded projection still sums to one",
          abs(sum(t["likelihood"] for t in
                  ts.threat_space([deck(HOG, 40), deck(GIANT, 10, wc="giant")],
                                  None, now=NOW)["threats"]) - 1.0) < 1e-3)


def property_inference_is_never_disguised():
    print("\nproperty — inference never presents itself as observation")
    sp = ts.threat_space([deck(HOG, 30, wc="hog")], SEEDS, now=NOW)
    generated = [t for t in sp["threats"] if t["evidence"] != ts.OBSERVED]

    check("there is something generated to check", bool(generated))
    check("nothing generated reports an observation count",
          all(t["observedCount"] == 0 for t in generated))
    check("nothing generated carries a lastSeen",
          all(t["lastSeen"] is None for t in generated))
    check("nothing generated is called 'known'",
          all(t["confidence"] != ts.KNOWN for t in generated),
          str([t["confidence"] for t in generated]))
    check("observed rows DO carry their count",
          all(t["observedCount"] > 0
              for t in sp["threats"] if t["evidence"] == ts.OBSERVED))
    check("the four confidence words are the only ones used",
          all(t["confidence"] in (ts.KNOWN, ts.LIKELY, ts.POSSIBLE, ts.SPECULATIVE)
              for t in sp["threats"]))


def property_thin_evidence_widens():
    print("\nproperty — thin evidence widens, it does not sharpen")
    # THE INVERSION OF THE BUG BEING REPLACED. `_spread` dropped everything
    # under two games and renormalised, handing that mass back to the decks
    # they played most — so a thin read came out MORE concentrated. If this
    # ever reverses, the redesign has been undone.
    thin = ts.threat_space([deck(HOG, 3, wc="hog"), deck(GIANT, 1, wc="giant")],
                           SEEDS, now=NOW)
    rich = ts.threat_space([deck(HOG, 150, wc="hog"), deck(GIANT, 50, wc="giant")],
                           SEEDS, now=NOW)

    check("the thin read puts less mass on observed decks",
          mass_of(thin, ts.OBSERVED) < mass_of(rich, ts.OBSERVED),
          f"thin {mass_of(thin, ts.OBSERVED):.3f} vs rich {mass_of(rich, ts.OBSERVED):.3f}")
    check("a one-game deck is KEPT, not dropped and redistributed",
          any(t["key"] == ts.deck_key(GIANT) and t["evidence"] == ts.OBSERVED
              for t in thin["threats"]))
    check("observed mass never exceeds the ceiling on switch",
          mass_of(rich, ts.OBSERVED) >= 1.0 - ts.SWITCH_MAX - 1e-6,
          f"{mass_of(rich, ts.OBSERVED):.3f}")


def property_recency_is_read():
    print("\nproperty — lastSeen is actually read")
    # It was carried and ignored by the module this replaces.
    fresh = deck(HOG, 40, wc="hog", last="20260920T120000.000Z")
    stale = deck(GIANT, 40, wc="giant", last="20260701T120000.000Z")
    sp = ts.threat_space([fresh, stale], SEEDS, now=NOW)
    a = next(t for t in sp["threats"] if t["key"] == ts.deck_key(HOG))
    b = next(t for t in sp["threats"] if t["key"] == ts.deck_key(GIANT))

    check("equal games, recent deck outweighs the stale one",
          a["likelihood"] > b["likelihood"],
          f"{a['likelihood']} vs {b['likelihood']}")
    check("the stale deck does not vanish", b["likelihood"] > 0)
    check("Supercell's battle-time format parses",
          ts._stamp("20260907T161011.000Z") is not None)
    check("ISO parses too", ts._stamp("2026-09-07T16:10:11Z") is not None)
    check("an unreadable stamp is full weight, not the floor",
          ts._recency("not-a-date", NOW) == 1.0,
          str(ts._recency("not-a-date", NOW)))
    check("a missing stamp is full weight", ts._recency(None, NOW) == 1.0)
    check("the decay floor holds for an ancient deck",
          ts._recency("20200101T120000.000Z", NOW) == ts.RECENCY_FLOOR)


def property_contract():
    print("\nproperty — the contract and its constants")
    check("the brain is versioned", ts.BRAIN_VERSION.startswith("team-scout-"))
    check("observed always keeps the majority", ts.SWITCH_MAX < 0.5)
    check("the switch floor is above zero — otherwise this is the old model",
          ts.SWITCH_MIN > 0)
    check("an unknown player is assumed WIDE",
          ts.PRIOR_SWITCH > (ts.SWITCH_MIN + ts.SWITCH_MAX) / 2)
    check("a deviation is likelier to be a tweak than a new archetype",
          ts.VARIANT_SHARE > 0.5)
    check("the variant overlap floor matches deck_tuner's MAX_SWAP of 2",
          8 - ts.MIN_VARIANT_OVERLAP == 2)
    check("the portfolio is 5 to 7",
          ts.MIN_RECOMMENDATIONS == 5 and ts.MAX_RECOMMENDATIONS == 7)
    check("the fit tiebreak is unchanged from team_analysis.COMFORT_WEIGHT",
          ts.FIT_WEIGHT == 1.5)
    check("every ladder source has a strength and the weakest is the default",
          set(ts.SOURCE_STRENGTH) == {"exact", "deck", "cluster7",
                                      "cluster6", "archetype"}
          and ts.SOURCE_STRENGTH["exact"] > ts.SOURCE_STRENGTH["archetype"])
    check("threats are capped so the scoring loop is bounded",
          ts.MAX_THREATS <= 12)

    sp = ts.threat_space([deck(HOG, 40, wc="hog")], SEEDS, now=NOW)
    check("the projection is capped", len(sp["threats"]) <= ts.MAX_THREATS)
    row = ts.score(rate_all(60.0), sp["threats"], cards=GIANT,
                   archetype="giant", fit_games=10)
    for field in ("matchupValue", "threatCovered", "evidenceStrength",
                  "playerFit", "recommendationScore", "confidence",
                  "matchups", "brain"):
        check(f"a recommendation publishes `{field}`", field in row)
    check("expectedWinRate survives under its old name for existing readers",
          row["expectedWinRate"] == row["matchupValue"])
    check("evidence strength tracks the rung it came off",
          ts.score(rate_all(60.0, source="exact"), sp["threats"], cards=GIANT,
                   archetype="giant")["evidenceStrength"]
          > ts.score(rate_all(60.0, source="archetype"), sp["threats"],
                     cards=GIANT, archetype="giant")["evidenceStrength"])


def property_types_and_explanations():
    print("\nproperty — every recommendation knows why it exists")
    sp = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)

    counter = ts.score(rate_map({"hog": 65.0}, default=40.0),
                       sp["threats"], cards=GIANT, archetype="giant")
    conting = ts.score(rate_map({"hog": 40.0}, default=65.0),
                       sp["threats"], cards=LAVA, archetype="lava-hound")

    check("a deck beating their observed core is a COUNTER or ROBUST",
          ts.classify(counter, sp["threats"]) in (ts.REC_COUNTER, ts.REC_ROBUST),
          ts.classify(counter, sp["threats"]))
    check("a deck that only answers what they have not shown is a CONTINGENCY",
          ts.classify(conting, sp["threats"]) == ts.REC_CONTINGENCY,
          ts.classify(conting, sp["threats"]))

    text = ts.explain(counter, sp["threats"])
    check("the explanation is one concise sentence",
          text.endswith(".") and 20 < len(text) < 220, text)
    check("it names the measured coverage",
          "%" in text, text)
    check("it never claims an unmeasured tendency",
          not any(w in text.lower() for w in
                  ("always", "never", "prefers", "tends to", "likes")), text)

    fitted = ts.score(rate_all(60.0), sp["threats"], cards=GIANT,
                      archetype="giant", fit_games=30)
    check("a practised deck says so in its explanation",
          "already pilot" in ts.explain(fitted, sp["threats"]),
          ts.explain(fitted, sp["threats"]))


def property_degradation():
    print("\nproperty — it never raises on a malformed payload")
    bad = [
        {"cards": None, "matches": 5},
        {"cards": ["a", "b"], "matches": 3},                 # not 8 cards
        {"cards": HOG, "matches": 0},                        # no games
        {"cards": HOG, "matches": 4, "lastSeen": "garbage"},
        {"cards": GIANT, "matches": 2, "winCondition": None},
    ]
    try:
        sp = ts.threat_space(bad, SEEDS, now=NOW)
        ok = True
    except Exception as exc:  # noqa: BLE001
        sp, ok = None, False
        print(f"       raised {exc!r}")
    check("a malformed payload does not raise", ok)
    if sp:
        check("only real eight-card decks are projected as observed",
              all(len(set(t["cards"])) == 8
                  for t in sp["threats"] if t["evidence"] == ts.OBSERVED))
        check("it still sums to one",
              abs(sum(t["likelihood"] for t in sp["threats"]) - 1.0) < 1e-3)

    check("diversify on an empty pool returns empty", ts.diversify([]) == [])
    check("score against an empty projection returns None",
          ts.score(rate_all(60.0), [], cards=HOG, archetype="hog") is None)
    check("a veto that rejects everything leaves the observed decks alone",
          all(t["evidence"] == ts.OBSERVED for t in ts.threat_space(
              [deck(HOG, 40, wc="hog")], SEEDS, now=NOW,
              veto=lambda c: "no")["threats"]))


def property_portfolio_is_not_padded():
    print("\nproperty — the list is a standard, not a length")
    sp = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)
    # One strong deck and three far below the drop floor.
    rows = [ts.score(rate_all(70.0), sp["threats"], cards=GIANT, archetype="giant")]
    for cards, arch in ((LAVA, "lava-hound"), (GRAVE, "graveyard"), (HOG_V2, "hog")):
        rows.append(ts.score(rate_all(45.0), sp["threats"], cards=cards,
                             archetype=arch))
    picked = ts.diversify(rows)
    check("weak candidates are not padded into the list to reach five",
          len(picked) < ts.MIN_RECOMMENDATIONS, str(len(picked)))
    check("the strong one is kept", picked[0]["key"] == ts.deck_key(GIANT))

    # And with enough real candidates it does reach the portfolio size.
    many = []
    for i, (cards, arch) in enumerate((
            (GIANT, "giant"), (LAVA, "lava-hound"), (GRAVE, "graveyard"),
            (HOG, "hog"), (HOG_V2, "hog"),
            (["giant", "witch", "musketeer", "zap", "arrows", "minions",
              "knight", "tesla"], "giant"),
            (["balloon", "lumberjack", "barbarian-barrel", "musketeer",
              "tombstone", "arrows", "minions", "knight"], "balloon"))):
        many.append(ts.score(rate_all(62.0 - i * 0.4), sp["threats"],
                             cards=cards, archetype=arch))
    picked = ts.diversify(many)
    check("a real pool fills the portfolio",
          ts.MIN_RECOMMENDATIONS <= len(picked) <= ts.MAX_RECOMMENDATIONS,
          str(len(picked)))
    check("and never exceeds the ceiling", len(picked) <= ts.MAX_RECOMMENDATIONS)


def main() -> int:
    print("team_scout — the coaching brain")
    case_1_many_known_decks()
    case_2_thin_history()
    case_3_one_deck_dominates()
    case_4_likely_but_bad_matchup()
    case_5_unseen_but_related()
    case_6_no_evidence()
    case_7_duplicates()
    case_8_player_compatibility()
    property_mass_sums_to_one()
    property_inference_is_never_disguised()
    property_thin_evidence_widens()
    property_recency_is_read()
    property_contract()
    property_types_and_explanations()
    property_degradation()
    property_portfolio_is_not_padded()
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
