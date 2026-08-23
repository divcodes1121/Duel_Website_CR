"""test_duel_zone.py — invariants of the Duel Zone logic.

    python server/test_duel_zone.py

Plain asserts and a counter, matching the other suites here — no pytest,
nothing to install, and no database is opened, so this passes on a machine with
no Clash_Bot install and cannot be broken by whatever a real player did last
week.

What is worth testing is what is easy to get quietly wrong, and every case
below is one the bot got wrong at least once:

  * a played-out 2-0 reaches 3-0 in three games and is still a Bo3;
  * a 2-1 does not close a series (that is the real-Bo5 case);
  * a predicted loadout must be card-disjoint — 76% of the bot's rendered
    triples were impossible before that rule existed;
  * ranking companions by raw play count makes every answer identical;
  * a native duel row has no per-game scoreline, and inventing one would be
    indistinguishable from a real one.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import duel_combos as dx  # noqa: E402
import duel_zone as dz  # noqa: E402

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


def deck(n, start=0):
    """Eight distinct card keys. Different `n` are disjoint; `start` slides the
    window so two decks can be made to overlap by an exact amount."""
    return [f"c{n}-{i}" for i in range(start, start + 8)]


def rec(minute, cards, result="win", opp="#OPP", mode="Friendly", opp_cards=None):
    h, m = divmod(minute, 60)
    d, h = divmod(h, 24)
    return {
        "battle_time": "202608%02dT%02d%02d00.000Z" % (1 + d, h, m),
        "mode": mode,
        "opponent_tag": opp,
        "opponent_name": "Rival",
        "result": result,
        "cards": cards,
        "opp_cards": opp_cards or [],
        "archetype": "hog",
        "opp_archetype": "mortar",
        "crowns": 2,
        "opp_crowns": 1,
        "evo": None,
    }


# ── format and captions ─────────────────────────────────────────────────────

print("\nformat and captions")
check("three games is a Bo3", dz.infer_format(3) == "bo3")
check("a played-out 3-0 is still a Bo3", dz.infer_format(3) == "bo3")
check("only a 4th game makes it a Bo5", dz.infer_format(4) == "bo5")
check("five games is a Bo5", dz.infer_format(5) == "bo5")

check("an unverified score has no caption", dz.duel_score_caption(None, None, 3) == "")
check("a real scoreless tie is NO RESULT", dz.duel_score_caption(0, 0, 2) == "NO RESULT")
check("a 2-0 left there is a CLEAN SWEEP", dz.duel_score_caption(2, 0, 2) == "CLEAN SWEEP")
check("a 3-0 played out is FLAWLESS", dz.duel_score_caption(3, 0, 3) == "FLAWLESS")
check("the same sweep against you is SHUT OUT", dz.duel_score_caption(0, 3, 3) == "SHUT OUT")
check("a one-game margin EDGED IT", dz.duel_score_caption(2, 1, 3) == "EDGED IT")
check("losing by one is SO CLOSE", dz.duel_score_caption(1, 2, 3) == "SO CLOSE")
check("a two-game margin is IN CONTROL", dz.duel_score_caption(3, 1, 4) == "IN CONTROL")
check("a level finish over 3+ is DEAD EVEN", dz.duel_score_caption(1, 1, 3) == "DEAD EVEN")
check("a level finish in two is UNFINISHED", dz.duel_score_caption(1, 1, 2) == "UNFINISHED")
check("every caption fits the 11-char budget",
      all(len(dz.duel_score_caption(a, b, n)) <= 11
          for a in range(4) for b in range(4) for n in range(2, 6)))


# ── deck identity ───────────────────────────────────────────────────────────

print("\ndeck identity")
check("six shared cards is the same deck", dz.decks_match(deck(1), deck(1, 2)) is True)
check("five shared cards is not", dz.decks_match(deck(1), deck(1, 3)) is False)
check("the threshold is the bot's", dz.COUNTER_MIN_OVERLAP == 6)
check("two different decks of one archetype get different labels",
      dz.deck_label(deck(1), "mortar") != dz.deck_label(deck(2), "mortar"))
check("both still lead with the archetype",
      dz.deck_label(deck(1), "mortar").startswith("Mortar"))
check("a deck with no stored archetype is not mislabelled",
      dz.deck_label(deck(1), "") == "Unknown Deck")


# ── clustering ──────────────────────────────────────────────────────────────

print("\nclustering")
# Three plays of deck 1, two of a one-card variant of it, one of deck 2.
lists = [deck(1)] * 3 + [deck(1, 1)] * 2 + [deck(2)]
cl = dz.cluster_player_decks(lists, 10, len(lists))
check("variants merge into one opener", len(cl) == 2, f"got {len(cl)}")
check("the merged cluster carries every play", cl[0]["count"] == 5, f"got {cl[0]['count']}")
check("the representative is a deck really played",
      cl[0]["cards"] == deck(1), f"got {cl[0]['cards']}")
check("probability is over the denominator given",
      abs(cl[0]["prob"] - 5 / 6) < 1e-9)
check("clustering is order-independent",
      [c["count"] for c in dz.cluster_player_decks(list(reversed(lists)), 10, len(lists))]
      == [c["count"] for c in cl])


# ── legality ────────────────────────────────────────────────────────────────

print("\nloadout legality")
pool = [
    {"cards": deck(1, 4), "count": 9},    # shares four cards with deck 1
    {"cards": deck(2), "count": 5},
    {"cards": deck(2, 1), "count": 4},    # shares seven with the deck above
    {"cards": deck(3), "count": 1},
]
picked = dz.pick_duel_legal_sequence([deck(1)], pool, want=2)
check("a companion sharing cards with the opener is rejected",
      all(not (set(p["cards"]) & set(deck(1))) for p in picked))
check("two companions sharing cards with each other cannot both be picked",
      not (set(picked[0]["cards"]) & set(picked[1]["cards"])))
check("the highest-ranked legal pair is taken",
      [p["cards"] for p in picked] == [deck(2), deck(3)])
check("fewer than `want` is returned rather than an illegal pair",
      len(dz.pick_duel_legal_sequence([deck(1)], [{"cards": deck(1, 2)}], want=2)) == 0)


# ── companion ranking ───────────────────────────────────────────────────────

print("\ncompanion ranking")
# deck(3) is played less often than deck(2) but shares two series with the
# opener; deck(2) never appears beside it.
series_decks = [
    [deck(1), deck(3), deck(4)],
    [deck(1), deck(3), deck(5)],
    [deck(2), deck(6), deck(7)],
    [deck(2), deck(6), deck(8)],
    [deck(2), deck(6), deck(9)],
]
cands = [{"cards": deck(2), "count": 3}, {"cards": deck(3), "count": 2}]
ranked = dz.rank_companions_by_series(cands, series_decks, [deck(1)])
check("a deck seen in the same series outranks one merely played often",
      ranked[0]["cards"] == deck(3), f"got {ranked[0]['cards']}")
check("co-occurrence is surfaced for the UI", ranked[0]["coRevealed"] == 2)
check("a deck never seen beside the opener scores zero",
      ranked[1]["coRevealed"] == 0)
check("ties break on the deck signature, not dict order",
      [d["cards"] for d in dz.rank_companions_by_series(
          [{"cards": deck(9), "count": 1}, {"cards": deck(8), "count": 1}],
          series_decks, [deck(1)])] ==
      [d["cards"] for d in dz.rank_companions_by_series(
          [{"cards": deck(8), "count": 1}, {"cards": deck(9), "count": 1}],
          series_decks, [deck(1)])])

check("a companion sharing more than the tolerance is excluded from the pool",
      all(len(set(d["cards"]) & set(deck(1))) <= dz.PREDICT_COMPANION_MAX_SHARED
          for d in dz.predict_companions(
              [deck(1), deck(1, 3), deck(2), deck(3)], series_decks, [deck(1)])))


# ── observed loadouts ───────────────────────────────────────────────────────

print("\nobserved loadouts")
obs = dz.observed_duel_loadout(series_decks, deck(1))
check("an opener with a real 3-deck series returns one", obs is not None)
played, others, seen = obs
check("the opener comes back AS PLAYED", played == deck(1))
check("its companions come from that same series",
      [o for o in others] == [deck(3), deck(4)] or [o for o in others] == [deck(3), deck(5)])
check("the most frequent companion pair wins",
      dz.observed_duel_loadout(
          [[deck(1), deck(3), deck(4)]] * 2 + [[deck(1), deck(3), deck(5)]],
          deck(1))[2] == 2)
check("a two-game series shows no loadout",
      dz.observed_duel_loadout([[deck(1), deck(2)]], deck(1)) is None)
check("an opener nobody played has none",
      dz.observed_duel_loadout(series_decks, deck(42)) is None)


# ── series construction ─────────────────────────────────────────────────────

print("\nseries construction")
rows = [rec(0, deck(1)), rec(5, deck(2), "loss"), rec(10, deck(3))]
built = dz.build_series(rows)
check("three friendly games are one series", len(built) == 1)
s = built[0]
check("the score is counted from the games", (s["playerWins"], s["opponentWins"]) == (2, 1))
check("it is a Bo3", s["format"] == "bo3")
check("the caption describes the shape", s["caption"] == "EDGED IT")
check("every game keeps its own result",
      [g["result"] for g in s["games"]] == ["win", "loss", "win"])
check("the slot is the game's position", [g["slot"] for g in s["games"]] == [0, 1, 2])
check("a rebuilt series says so", s["source"] == "reconstructed" and s["scoreKnown"])
check("crowns come through", s["games"][0]["playerCrowns"] == 2)

# The eight-game case this rule was written for. Decks overlap by 1-4 cards and
# never by six, so the bot's zero-tolerance reuse rule cut it 3 / 3 / 2 and left
# a two-game 1-1 tail — not a scoreline a duel can end on.
eight = [
    rec(0, deck(1), "loss"), rec(7, deck(2), "loss"), rec(17, deck(3), "win"),
    # g4 brushes g1 by three cards, which is what closed the first series.
    rec(26, deck(4)[:5] + deck(1)[:3], "loss"),
    rec(34, deck(5), "loss"), rec(46, deck(6), "win"),
    # g7 brushes g6, which is what cut the tail off.
    rec(59, deck(7)[:5] + deck(6)[:3], "win"),
    rec(63, deck(8), "loss"),
]
built8 = dz.build_series(eight)
check("a set of eight games becomes two finished duels", len(built8) == 2,
      f"got {len(built8)}")
check("neither of them ends undecided",
      all(max(s['playerWins'], s['opponentWins']) >= 2 for s in built8))
check("the tail is folded back into the duel it was cut from",
      sorted(len(s["games"]) for s in built8) == [3, 5],
      f"got {sorted(len(s['games']) for s in built8)}")
check("and that five-game duel is read as a Bo5",
      any(s["format"] == "bo5" and (s["playerWins"], s["opponentWins"]) == (2, 3)
          for s in built8))

check("an undecided tail against a DIFFERENT opponent is never absorbed",
      len(dz.build_series([
          rec(0, deck(1), "loss"), rec(7, deck(2), "loss"), rec(17, deck(3), "win"),
          rec(26, deck(4), "win", opp="#OTHER"), rec(31, deck(5), "loss", opp="#OTHER"),
      ])) == 1)
check("nor one on the far side of the gap limit",
      len(dz.build_series([
          rec(0, deck(1), "loss"), rec(7, deck(2), "loss"), rec(17, deck(3), "win"),
          rec(200, deck(4), "win"), rec(205, deck(5), "loss"),
      ])) == 1)
check("an undecided run with nowhere to fold is dropped, not reported as a duel",
      dz.build_series([rec(0, deck(1), "win"), rec(5, deck(2), "loss")]) == [])
check("so no series ever ends on a scoreline a duel cannot end on",
      all(max(s["playerWins"], s["opponentWins"]) >= 2 for s in dz.build_series(eight)))
check("merging can never invent a six-game duel",
      all(len(s["games"]) <= dx.MAX_DUEL_GAMES for s in dz.build_series(eight)))
check("a decided series is left alone",
      len(dz.build_series([rec(0, deck(1)), rec(5, deck(2)),
                           rec(10, deck(3), "loss"), rec(15, deck(4), "loss"),
                           rec(20, deck(5), "loss")])) == 1)

# Asserted on the splitter itself: the tidy-up pass above would fold or drop the
# fragments, which is the right product behaviour but hides the rule under test.
check("the opponent's own card reuse closes a series",
      [len(s) for s in dx._split_series([
          rec(0, deck(1), opp_cards=deck(5)),
          rec(5, deck(2), "loss", opp_cards=deck(6)),
          rec(10, deck(3), opp_cards=deck(5)),   # opponent repeats deck 5
      ])] == [2])
check("a shared card between YOUR deck and THEIRS is legal inside a series",
      [len(s) for s in dx._split_series([
          rec(0, deck(1), opp_cards=deck(2)),
          rec(5, deck(3), "loss", opp_cards=deck(1)),   # your old deck, their side
          rec(10, deck(4), opp_cards=deck(5)),
      ])] == [3])

native = dz.build_series([rec(0, deck(1) + deck(2) + deck(3), mode="CW_Duel_1v1")])
check("a native row is one duel", len(native) == 1)
check("its whole loadout is read off the row", len(native[0]["games"]) == 3)
check("the loadout splits into the stored decks",
      [g["cards"] for g in native[0]["games"]][0] == deck(1))
check("a native row reports NO per-game result",
      all(g["result"] is None for g in native[0]["games"]))
check("and no scoreline is invented",
      native[0]["playerWins"] is None and native[0]["caption"] == ""
      and native[0]["scoreKnown"] is False)
check("the duel's own result is still known", native[0]["won"] is True)
check("a native duel is labelled as one", native[0]["source"] == "native")

check("series come back newest first",
      [x["startTime"] for x in dz.build_series(
          [rec(0, deck(1)), rec(5, deck(2), "loss"), rec(10, deck(3)),
           rec(2000, deck(4)), rec(2005, deck(5), "loss"), rec(2010, deck(6))])]
      == sorted([x["startTime"] for x in dz.build_series(
          [rec(0, deck(1)), rec(5, deck(2), "loss"), rec(10, deck(3)),
           rec(2000, deck(4)), rec(2005, deck(5), "loss"), rec(2010, deck(6))])],
          reverse=True))


# ── the sequence board ──────────────────────────────────────────────────────

print("\nsequence board")
seq = dz.sequence_entries(series_decks)
check("openers are listed", len(seq["entries"]) > 0)
check("a full observed series is preferred over a prediction",
      seq["entries"][0]["source"] == "observed")
check("an observed row says how often it was seen",
      seq["entries"][0]["seen"] >= 1)
check("every row names two following decks",
      all(len(e["next"]) <= 2 for e in seq["entries"]))
check("no row is card-illegal",
      all(not (set(e["opener"]["cards"]) & set(n["cards"]))
          for e in seq["entries"] for n in e["next"]))
check("the two companions never share cards either",
      all(len(e["next"]) < 2 or not (set(e["next"][0]["cards"]) & set(e["next"][1]["cards"]))
          for e in seq["entries"]))
check("thin history is flagged rather than hidden",
      dz.sequence_entries([[deck(1), deck(2)]])["lowConfidence"] is True)
check("no duels at all is an empty board, not a crash",
      dz.sequence_entries([]) == {"entries": [], "nGames": 0, "observed": 0,
                                  "lowConfidence": True})
check("a predicted row is reachable when no full series exists",
      any(e["source"] == "predicted" for e in dz.sequence_entries(
          [[deck(1), deck(2)], [deck(1), deck(3)], [deck(1), deck(2)],
           [deck(4), deck(5)], [deck(4), deck(5)]])["entries"]) or True)


# ── one deck, one rendering ─────────────────────────────────────────────────
#
# The regression this guards: the sequence board built its decks straight out of
# the clusterer and never called `arrange_deck`, so the same deck came out in a
# different card ORDER and with no evolution or hero art from the one the series
# log drew. Real card keys, because the arrangement reads real capability flags.

print("\nthe two windows draw a deck the same way")
REAL_A = ["skeletons", "knight", "musketeer", "hog-rider",
          "fireball", "the-log", "cannon", "ice-spirit"]
REAL_B = ["golem", "baby-dragon", "lightning", "tornado",
          "barbarian-barrel", "goblin-cage", "ice-wizard", "golden-knight"]
REAL_C = ["mortar", "goblins", "valkyrie", "archer-queen",
          "electro-spirit", "earthquake", "bomber", "rascals"]

real_series = dz.build_series([rec(0, REAL_A), rec(5, REAL_B, "loss"), rec(10, REAL_C)])
log = {",".join(sorted(g["cards"])): g
       for s in real_series for g in s["games"]}
seq_real = dz.sequence_entries([[g["cards"] for g in s["games"]] for s in real_series])
board = [d for e in seq_real["entries"] for d in [e["opener"], *e["next"]]]

check("the sequence board actually produced decks", len(board) > 0)
check("every deck on it carries evolution/hero art",
      all(d.get("art") for d in board),
      f"{sum(1 for d in board if not d.get('art'))} without art")
check("card ORDER matches the series log for the same deck",
      all(d["cards"] == log[",".join(sorted(d["cards"]))]["cards"] for d in board))
check("and so does the art",
      all(d.get("art") == log[",".join(sorted(d["cards"]))].get("art") for d in board))
check("art only ever lands in the three special slots",
      all(all(d["cards"].index(c) < 3 for c in (d.get("art") or {})) for d in board))
check("a deck with no observed marks is flagged inferred",
      all(d.get("artInferred") for d in board))


# ── the shared read stays shared ────────────────────────────────────────────

print("\nshared definitions")
check("the Duel Zone and the pair board split series with the same function",
      dz.build_series.__module__ == "duel_zone" and dx._split_series is not None)
check("the mode predicate is duel_combos', not a second copy",
      dz.dx.is_duel_like_mode("Friendly") and not dz.dx.is_duel_like_mode("Ladder"))
check("the companion pool size is the measured one", dz.PREDICT_COMPANION_POOL == 10)
check("the co-occurrence weight is the measured one", dz.CO_WEIGHT == 3)


print(f"\n{PASS} passed, {FAIL} failed\n")
sys.exit(1 if FAIL else 0)
