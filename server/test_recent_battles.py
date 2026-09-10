"""test_recent_battles.py — the battle log, and the paging around it.

    python server/test_recent_battles.py

Plain asserts and a counter, matching the other suites here. A real SQLite file
IS opened, but it is a temporary one this module writes: the point of most of
these checks is the interaction between a WHERE clause, a sort and a page
offset, and that cannot be tested against a hand-built list.

What is worth testing here is what is quietly wrong rather than broken:

  * a page that is off the end must clamp, not error — narrowing the date range
    while page 9 is open is the ordinary way to get there, and an error would
    make the date control able to break the screen;
  * the summary counts the WINDOW, not the page, or the win rate changes as you
    turn pages while sitting under a control that says thirty days;
  * rows are dropped BEFORE they are counted, or "page 4 of 12" renders empty;
  * two ordered tier reads concatenated are not ordered;
  * the outcome comes from the stored result, not from the crowns — a battle
    can end level on crowns and still have a recorded winner.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clash_data as cd  # noqa: E402
import recent_battles as rb  # noqa: E402

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


TAG = "#TEST123"


def deck(n):
    return [f"c{n}-{i}" for i in range(8)]


def _make_db(path, rows):
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE battles ("
        " player_tag TEXT, battle_time TEXT, game_mode TEXT,"
        " opponent_tag TEXT, opponent_name TEXT, result TEXT,"
        " player_card_keys TEXT, opponent_card_keys TEXT,"
        " player_win_condition TEXT, opponent_win_condition TEXT,"
        " player_crowns INT, opponent_crowns INT,"
        " player_evo TEXT, opponent_evo TEXT)"
    )
    con.executemany(
        "INSERT INTO battles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows
    )
    con.commit()
    con.close()


def row(day, mode="Ranked1v1", result="win", cards=None, opp_cards=None,
        crowns=3, opp_crowns=0, opp="#RIVAL"):
    return (
        TAG,
        "202608%02dT120000.000Z" % day,
        mode,
        opp,
        "Rival",
        result,
        json.dumps(deck(1) if cards is None else cards),
        json.dumps(deck(2) if opp_cards is None else opp_cards),
        "hog_rider",
        "golem",
        crowns,
        opp_crowns,
        None,
        None,
    )


TMP = tempfile.mkdtemp(prefix="recent-battles-test-")
DB = os.path.join(TMP, "battles.db")
_make_db(DB, [row(d) for d in range(1, 26)])

# `tier_windows` walks the real storage tiers; point the whole thing at the
# scratch file instead, which is the only monkeypatch this suite needs.
cd.tier_windows = lambda tag, since, until: [(DB, since or "0", until or "9")]


# --- paging -----------------------------------------------------------------

r = rb.report(TAG, page=1)
check("a page holds PER_PAGE battles", len(r["battles"]) == rb.PER_PAGE, str(len(r["battles"])))
check("25 battles is 3 pages of 10", r["pages"] == 3 and r["total"] == 25,
      f"{r['pages']} pages, {r['total']} total")

last = rb.report(TAG, page=3)
check("the last page holds the remainder", len(last["battles"]) == 5, str(len(last["battles"])))

over = rb.report(TAG, page=99)
check(
    "a page past the end CLAMPS rather than erroring",
    over["page"] == 3 and len(over["battles"]) == 5,
    f"page {over['page']}, {len(over['battles'])} rows",
)
check("...and page 0 clamps up", rb.report(TAG, page=0)["page"] == 1)

check(
    "`per` is capped so one request cannot become the whole window",
    rb.report(TAG, per=5000)["perPage"] == rb.MAX_PER_PAGE,
)

# No page shares a battle with another.
seen = []
for p in (1, 2, 3):
    seen += [b["id"] for b in rb.report(TAG, page=p)["battles"]]
check("the three pages partition the window", len(seen) == 25 and len(set(seen)) == 25,
      f"{len(seen)} rows, {len(set(seen))} distinct")


# --- order ------------------------------------------------------------------

first = rb.report(TAG, page=1)["battles"]
check(
    "newest first",
    [b["battleTime"] for b in first] == sorted((b["battleTime"] for b in first), reverse=True),
)
check(
    "...and page 1 really is newer than page 3",
    first[0]["battleTime"] > last["battles"][-1]["battleTime"],
)


# --- the summary describes the window, not the page -------------------------

s = rb.report(TAG, page=2)["summary"]
check("the summary counts the whole window", s["battles"] == 25, str(s["battles"]))
check("...even from page 2", s["wins"] == 25 and s["losses"] == 0, f"{s['wins']}W {s['losses']}L")


# --- who played --------------------------------------------------------------

who = rb.report(TAG)["player"]
check("the report carries the tag it was asked about", who["tag"] == TAG, str(who))
check(
    "...and a name field even when no name is stored",
    "name" in who and who["name"] is None,
    "None, not the tag - the CLIENT decides what to show, or 'unknown player' "
    "and 'player called #ABC123' become the same thing",
)

cd.player_name = lambda t: "Pedro"
check("a stored name is carried through", rb.report(TAG)["player"]["name"] == "Pedro")
cd.player_name = lambda t: None


# --- what counts as an outcome ---------------------------------------------

check("a stored win is a win", rb._outcome("win", 0, 0) == "win")
check("a stored loss is a loss", rb._outcome("loss", 3, 0) == "loss",
      "the recorded result beats the crowns")
check("crowns are only the fallback", rb._outcome("", 3, 1) == "win")
check("level crowns with no result is a draw", rb._outcome("", 1, 1) == "draw")


# --- every mode is a row, not just the duel-like ones -----------------------

_make_db(os.path.join(TMP, "mixed.db"), [
    row(1, mode="Ranked1v1_NewArena"),
    row(2, mode="CW_Duel_1v1"),
    row(3, mode="Friendly"),
    row(4, mode="Tournament"),
])
cd.tier_windows = lambda tag, since, until: [(os.path.join(TMP, "mixed.db"), "0", "9")]
mixed = rb.report(TAG)
check(
    "a ladder game is a row (this is not a duel screen)",
    mixed["total"] == 4,
    f"{mixed['total']} of 4 kept",
)
labels = sorted(b["modeLabel"] for b in mixed["battles"])
check("modes collapse to readable labels", labels == ["Duel", "Friendly", "Ladder", "Tournament"],
      str(labels))
check(
    "an unrecognised mode named 'duel' is NOT labelled Duel",
    rb._mode_label("SomeNew_Duel_Thing") == "Battle",
    "the allowlist is the authority, or this screen and the Duel Zone "
    "would disagree about the same row",
)


# --- a row with no decks is dropped before it is counted --------------------

_make_db(os.path.join(TMP, "empty.db"), [
    row(1),
    (TAG, "20260802T120000.000Z", "Ranked1v1", "#X", "X", "win",
     "[]", "[]", "", "", 0, 0, None, None),
])
cd.tier_windows = lambda tag, since, until: [(os.path.join(TMP, "empty.db"), "0", "9")]
e = rb.report(TAG)
check(
    "a deckless row is left out of the COUNT as well as the page",
    e["total"] == 1 and len(e["battles"]) == 1,
    f"total {e['total']}, {len(e['battles'])} rows",
)


# --- two tiers, concatenated, must still be ordered -------------------------

hot = os.path.join(TMP, "hot.db")
arc = os.path.join(TMP, "arc.db")
_make_db(hot, [row(d) for d in (20, 21, 22)])
_make_db(arc, [row(d) for d in (1, 2, 3)])
cd.tier_windows = lambda tag, since, until: [(hot, "0", "9"), (arc, "0", "9")]
t = rb.report(TAG)
times = [b["battleTime"] for b in t["battles"]]
check(
    "battles from two tiers are sorted ACROSS them",
    times == sorted(times, reverse=True),
    str(times),
)
check("...and the archive tier is reported as used", t["summary"]["archiveUsed"] is True)


# --- the mode filter --------------------------------------------------------
#
# THE FAULT THIS CLOSES IS INVISIBLE IN THE DATA. A `TeamVsTeam` row stores
# exactly eight player cards, eight opponent cards and one opponent tag, so it
# is structurally identical to a ladder row — nothing downstream of the read
# can tell them apart, and a 2v2 battle rendered here as a duel between two
# people looks entirely correct. On the live database 2v2 went from 2.77% of
# stored battles in June to 25.11% in September, so this was roughly one row in
# four, on every player's log, for a month.
#
# The mode strings below are real ones, taken from
# `SELECT DISTINCT game_mode FROM battles` on 2026-09-10.

MIXED = os.path.join(TMP, "modes.db")
_make_db(MIXED, [
    row(1, mode="Ranked1v1_NewArena2"),
    row(2, mode="Ladder"),
    row(3, mode="CW_Battle_1v1"),
    row(4, mode="CW_Duel_1v1"),
    row(5, mode="Friendly"),
    row(6, mode="Showdown_Friendly"),
    row(7, mode="TeamVsTeam"),
    row(8, mode="TeamVsTeam"),
    row(9, mode="TeamVsTeam_FixedDeckOrder"),
    row(10, mode="Challenge_AllCards_EventDeck_NoSet"),
    row(11, mode="PickMode"),
    row(12, mode="Crazy_Arena"),
    row(13, mode="MirrorDeck_Friendly"),
])
cd.tier_windows = lambda tag, since, until: [(MIXED, "0", "9")]
m = rb.report(TAG, per=50)
kept = {b["mode"] for b in m["battles"]}

check(
    "ranked, ladder, clan war, duel and friendly are all listed",
    kept == {"Ranked1v1_NewArena2", "Ladder", "CW_Battle_1v1", "CW_Duel_1v1",
             "Friendly", "Showdown_Friendly"},
    str(sorted(kept)),
)
check("no 2v2 row is drawn as a duel",
      not any("teamvsteam" in k.lower() for k in kept), str(sorted(kept)))
check("the event-deck challenge is not listed",
      "Challenge_AllCards_EventDeck_NoSet" not in kept)
check("the draft mode is not listed", "PickMode" not in kept)
check("the mirror-deck friendly is not listed", "MirrorDeck_Friendly" not in kept)
check("the totals count only what is drawable", m["total"] == 6, str(m["total"]))

# WHAT IS DROPPED IS COUNTED. An allowlist's failure mode is a perfectly good
# battle going missing in silence, so the omission has to be visible where the
# reader already is.
check("the hidden total is every refused row",
      m["summary"]["hidden"] == 7, str(m["summary"]["hidden"]))
check("the breakdown names each mode",
      set(m["summary"]["hiddenByMode"]) ==
      {"TeamVsTeam", "TeamVsTeam_FixedDeckOrder",
       "Challenge_AllCards_EventDeck_NoSet", "PickMode", "Crazy_Arena",
       "MirrorDeck_Friendly"},
      str(sorted(m["summary"]["hiddenByMode"])))
check("...with the right counts",
      m["summary"]["hiddenByMode"]["TeamVsTeam"] == 2,
      str(m["summary"]["hiddenByMode"]))
check("...biggest first, so the dominant exclusion reads first",
      list(m["summary"]["hiddenByMode"].values())[0] == 2,
      str(m["summary"]["hiddenByMode"]))

# A NEW SUPERCELL MODE MUST ANNOUNCE ITSELF. The whole cost of an allowlist is
# that a genuinely new competitive mode is excluded until somebody adds it, and
# this is the line that makes that survivable rather than silent.
NEW = os.path.join(TMP, "new-mode.db")
_make_db(NEW, [row(1, mode="Ranked1v1_NewArena2"), row(2, mode="Sparky_Rumble")])
cd.tier_windows = lambda tag, since, until: [(NEW, "0", "9")]
n = rb.report(TAG)
check("an unrecognised mode is refused", n["total"] == 1, str(n["total"]))
check("...and named, not merely counted",
      n["summary"]["hiddenByMode"] == {"Sparky_Rumble": 1},
      str(n["summary"]["hiddenByMode"]))

# A future ranked arena is the case an EXACT allowlist would have broken, on
# the day a season turned, with nothing raised anywhere.
FUTURE = os.path.join(TMP, "future.db")
_make_db(FUTURE, [row(1, mode="Ranked1v1_NewArena3")])
cd.tier_windows = lambda tag, since, until: [(FUTURE, "0", "9")]
check("a ranked arena Supercell has not shipped yet is still listed",
      rb.report(TAG)["total"] == 1)

# A CLEAN LOG SAYS NOTHING ABOUT HIDDEN BATTLES. `hidden` must be 0 rather than
# absent, or the client cannot tell "none were dropped" from "an old API that
# does not report it".
CLEAN = os.path.join(TMP, "clean.db")
_make_db(CLEAN, [row(d, mode="Ladder") for d in range(1, 5)])
cd.tier_windows = lambda tag, since, until: [(CLEAN, "0", "9")]
c = rb.report(TAG)
check("nothing hidden reports zero, not absence", c["summary"]["hidden"] == 0)
check("...and an empty breakdown", c["summary"]["hiddenByMode"] == {})

# The label branch for 2v2 was removed as unreachable. Assert the reason holds.
check("no drawable battle can carry a 2v2 label",
      all(b["modeLabel"] != "2v2" for b in m["battles"]))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
