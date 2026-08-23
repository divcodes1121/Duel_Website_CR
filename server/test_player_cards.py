"""test_player_cards.py — invariants of the per-player card board.

    python server/test_player_cards.py

No database: the one function that touches SQLite (`_tally`) is replaced with a
stub, so everything below runs on counts written out by hand. That is the whole
point — the rules worth testing are what the board does WITH the counts, and
those must not depend on whatever a real player did last week.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import duel_combos as dx  # noqa: E402
import player_cards as pc  # noqa: E402

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


# ── game-mode scopes ────────────────────────────────────────────────────────

print("\ngame-mode scopes")
check("ranked ladder counts as ranked", "ranked" in pc._mode_of("Ranked1v1_NewArena2"))
check("so does the older arena name", "ranked" in pc._mode_of("Ranked1v1_NewArena"))
check("and plain Ladder", "ranked" in pc._mode_of("Ladder"))
check("friendly practice is duel-like, not ranked",
      pc._mode_of("Friendly") == {"all", "duel"})
check("a native duel is duel-like", "duel" in pc._mode_of("CW_Duel_1v1"))
check("challenges and tournaments are their own scope",
      "tournament" in pc._mode_of("Challenge_AllCards_EventDeck_NoSet")
      and "tournament" in pc._mode_of("Tournament"))
check("everything is in 'all'", all("all" in pc._mode_of(m)
                                    for m in ("Ladder", "Friendly", "PickMode", "")))
check("a mode nobody has classified still lands in 'all' only",
      pc._mode_of("Crazy_Arena") == {"all"})


# ── the comparison window ───────────────────────────────────────────────────

print("\nthe window the deltas compare against")
check("a 30-day window compares with the 30 days before it",
      pc._shift("2026-07-12", "2026-08-10") == ("2026-06-12", "2026-07-11"))
check("it ends the day before this one starts",
      pc._shift("2026-08-01", "2026-08-07") == ("2026-07-25", "2026-07-31"))
check("an open-ended window claims no comparison",
      pc._shift(None, None) == (None, None) and pc._shift("2026-08-01", None) == (None, None))
check("a malformed date claims no comparison",
      pc._shift("not-a-date", "2026-08-10") == (None, None))


# ── the board itself, over counts written by hand ───────────────────────────

print("\nthe board")
A, B, C, D = "knight", "hog-rider", "fireball", "mirror"

_stub = {}


_EMPTY = ({}, 0, 0, False, {}, {"battles": 0, "wins": 0, "from": None, "to": None})


def fake_tally(tag, since, until, mode):
    """Stands in for the SQLite read. Keyed on the window so the previous
    period can be given a different shape from the current one."""
    return _stub.get((since, until), _EMPTY)


pc._tally = fake_tally

# The per-FORM board, over the subset of battles whose payload said which form
# was fielded. Deliberately a SMALLER population than the card board above (30
# battles against 50), because that is the real shape of it — the marks only
# exist on a minority of rows, and the whole point of the split is that both
# sides of a comparison come from the same subset.
#
# A: 18 plain at 50%, 12 evolved at 25% — a card that is WORSE evolved, which
#    is the comparison the board exists to make and the one a merged figure
#    hides completely.
# B: hero only, never seen plain.
# C: plain only, 4 battles — under the floor, so shown and not ranked.
_FORMS = {
    A: {"base": [18, 9], "evolution": [12, 3]},
    B: {"hero": [10, 7]},
    C: {"base": [4, 4]},
}

_stub = {
    # now: A is heavily played and winning, B is a coin flip, C is a one-off
    # 100%, D never played at all.
    #
    # The per-card shape is [battles, wins, EVOLVED, HERO] — the last two are
    # separate counters. A is a knight, which is one of the four cards that can
    # be fielded either way, so it carries both: 12 evolved and 8 hero out of
    # 40. B was only ever fielded as a hero, which is the case that a single
    # merged counter used to report as "100% evolved".
    ("2026-08-01", "2026-08-10"): ({A: [40, 30, 12, 8], B: [20, 10, 0, 20],
                                    C: [1, 1, 0, 0]},
                                   50, 28, False, _FORMS,
                                   {"battles": 30, "wins": 16,
                                    "from": "20260806", "to": "20260810"}),
    # before: A won less, B is unchanged, C absent.
    ("2026-07-22", "2026-07-31"): ({A: [20, 8, 0, 0], B: [10, 5, 0, 0]},
                                   40, 20, False, {},
                                   {"battles": 0, "wins": 0, "from": None, "to": None}),
}
board = pc.card_board("#TAG", "2026-08-01", "2026-08-10", "all")
rows = {r["key"]: r for r in board["cards"]}

check("every card the site knows is listed", len(board["cards"]) == len(dx.card_keys()))
check("including one they never played", rows[D]["battles"] == 0)
check("an unplayed card claims no win rate", rows[D]["winRate"] == 0.0)

check("use rate is a share of BATTLES, not of card slots",
      rows[A]["useRate"] == 80.0, f"got {rows[A]['useRate']}")
check("win rate is a share of the card's own battles",
      rows[A]["winRate"] == 75.0, f"got {rows[A]['winRate']}")
check("evolved play is reported as a share of its own play",
      rows[A]["evoRate"] == 30.0, f"got {rows[A]['evoRate']}")
check("hero play is a SEPARATE share, not folded into the evolved one",
      rows[A]["heroRate"] == 20.0, f"got {rows[A]['heroRate']}")
check("a card only ever fielded as a hero reports 0% evolved",
      rows[B]["evoRate"] == 0.0 and rows[B]["heroRate"] == 100.0,
      f"evo {rows[B]['evoRate']} hero {rows[B]['heroRate']}")
check("the two shares are independent — a card can carry both",
      rows[A]["evoRate"] + rows[A]["heroRate"] == 50.0)
check("a card with no marks at all reports neither",
      rows[C]["evoRate"] == 0.0 and rows[C]["heroRate"] == 0.0)
check("losses are counted", rows[A]["losses"] == 10)


# ── the per-form board ──────────────────────────────────────────────────────
#
# The question this answers: "an evolved Skeletons should not show the same use
# rate and win rate as a plain one." It can only be answered over the battles
# whose payload recorded the form, so the numbers below come from a 30-battle
# subset of the same 50-battle window.

print("\nper-form rates")
fa = rows[A]["forms"]
check("a card seen in two forms is scored once per form",
      sorted(fa) == ["base", "evolution"], str(sorted(fa)))
check("the plain form gets its own win rate",
      fa["base"]["winRate"] == 50.0, f"got {fa['base']['winRate']}")
check("and the evolved form a DIFFERENT one",
      fa["evolution"]["winRate"] == 25.0, f"got {fa['evolution']['winRate']}")
check("which is the whole point — they must not be equal",
      fa["base"]["winRate"] != fa["evolution"]["winRate"])
check("use rate is a share of the FORM-RECORDING battles, not of every battle",
      fa["base"]["useRate"] == 60.0 and fa["evolution"]["useRate"] == 40.0,
      f"base {fa['base']['useRate']} evo {fa['evolution']['useRate']}")
check("a form's use rate is NOT the card's own use rate",
      fa["base"]["useRate"] != rows[A]["useRate"])
check("each form carries its own battle count",
      fa["base"]["battles"] == 18 and fa["evolution"]["battles"] == 12)

check("a card only ever seen as a hero gets a hero row and no base row",
      sorted(rows[B]["forms"]) == ["hero"], str(sorted(rows[B]["forms"])))
check("its hero win rate is its own",
      rows[B]["forms"]["hero"]["winRate"] == 70.0)

check("the evidence floor applies per form, not per card",
      rows[C]["forms"]["base"]["tiered"] is False,
      "4 battles is under the floor even though the card is listed")
check("a form over the floor is ranked",
      fa["base"]["tiered"] is True and fa["evolution"]["tiered"] is True)
check("each form gets its own Wilson interval",
      fa["base"]["interval"] and fa["evolution"]["interval"]
      and fa["base"]["interval"] != fa["evolution"]["interval"])

check("a card never seen in a recorded battle has NO forms key at all",
      "forms" not in rows[D],
      "absent must stay distinct from 'observed and zero'")

cov = board["formCoverage"]
check("the board says what the split is built on",
      cov["battles"] == 30 and cov["share"] == 60.0, str(cov))
check("and over which dates, in ISO",
      cov["from"] == "2026-08-06" and cov["to"] == "2026-08-10", str(cov))
check("compact stored timestamps convert to ISO",
      pc._iso("20260804") == "2026-08-04" and pc._iso(None) is None
      and pc._iso("nonsense") is None)

print("\nthe evidence floor")
check("a card with one battle is not ranked", rows[C]["tiered"] is False)
check("a well-played card is", rows[A]["tiered"] is True)
check("the floor is the pair board's, not a new number",
      pc.CARD_MIN_BATTLES == dx.CONF_MIN_GAMES == 8)
check("a 100% win rate on one game never outranks a real record",
      rows[A]["rank"] < rows[C]["rank"], f"{rows[A]['rank']} vs {rows[C]['rank']}")
check("unranked cards still appear on the board", rows[C]["battles"] == 1)
check("the Wilson tier comes through", rows[A]["tier"] in ("high", "medium", "low"))
check("and refuses to tier a single game", rows[C]["tier"] is None)
check("ranks are 1..n with no gaps",
      sorted(r["rank"] for r in board["cards"]) == list(range(1, len(board["cards"]) + 1)))

print("\nmovement against the previous window")
check("the previous window is reported", board["previous"]["battles"] == 40)
check("use rate movement is in points",
      rows[A]["useDelta"] == 30.0, f"got {rows[A]['useDelta']}")   # 80% - 50%
check("win rate movement is in points",
      rows[A]["winDelta"] == 35.0, f"got {rows[A]['winDelta']}")   # 75% - 40%
check("a flat card moves by nothing",
      rows[B]["winDelta"] == 0.0 and rows[B]["useDelta"] == 15.0)
check("no win-rate movement is claimed where the card is new",
      "winDelta" not in rows[C], "a card unplayed last window has not fallen to zero")
check("but its use rate still rose from nothing", rows[C]["useDelta"] == 2.0)

print("\ntotals")
t = board["totals"]
check("battles and wins are the window's", (t["battles"], t["wins"]) == (50, 28))
check("played counts only cards with battles", t["played"] == 3)
check("ranked counts only cards over the floor", t["ranked"] == 2)
check("the card count is the full pool", t["cards"] == len(dx.card_keys()))

print("\nno comparison to make")
_stub = {("2026-08-01", "2026-08-10"): ({A: [10, 5, 0]}, 10, 5, False)}
solo = pc.card_board("#TAG", None, None, "all")
check("an open window reports no previous period", solo["previous"] is None)
check("and claims no movement at all",
      all("useDelta" not in r and "winDelta" not in r for r in solo["cards"]))

check("an unknown mode falls back to 'all' rather than erroring",
      pc.card_board("#TAG", None, None, "nonsense")["mode"] == "all")


print(f"\n{PASS} passed, {FAIL} failed\n")
sys.exit(1 if FAIL else 0)
