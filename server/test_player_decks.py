"""test_player_decks.py — the Decks screen's list.

    python server/test_player_decks.py

Plain asserts and a counter, like the other suites. A real SQLite file is
opened, and it is a temporary one this module writes — nothing here touches the
real database, the cluster index or the duel index.

What is worth testing is what would be quietly wrong:

  * a deck is its CARDS, so two stored orders of one list are one row;
  * a native duel is counted game by game from the duel index and NEVER from
    its loadout row in `battles`, or every duel counts twice;
  * 2v2 and event rows are not this player's decks;
  * the three rates share one denominator that holds the draws;
  * the community record folds both directions of a stored pairing, with the
    sides swapped on the second.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clash_data as cd  # noqa: E402
import player_decks as pd  # noqa: E402

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


TAG = "#PQ2LLLLL"

HOG = ["hog-rider", "musketeer", "ice-golem", "ice-spirit", "skeletons", "cannon",
       "fireball", "the-log"]
GOLEM = ["golem", "night-witch", "baby-dragon", "lumberjack", "tornado", "lightning",
         "mega-minion", "barbarian-barrel"]
BAIT = ["goblin-barrel", "princess", "knight", "goblin-gang", "inferno-tower", "rocket",
        "ice-spirit", "the-log"]


def key(cards):
    return ",".join(sorted(cards))


def row(day, cards, result="win", mode="Ranked1v1_NewArena2", crowns=3, opp_crowns=0,
        evo=None, hour=12, wc="hog"):
    return (
        TAG, "202609%02dT%02d0000.000Z" % (day, hour), mode, "#RIVAL", "Rival", result,
        json.dumps(cards), json.dumps(GOLEM), wc, "golem", crowns, opp_crowns, evo, None,
    )


def make_db(path, rows, pairs=()):
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
    con.executemany("INSERT INTO battles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    con.execute(
        "CREATE TABLE pair_matchup_agg (deck_a TEXT, deck_b TEXT, a_wins INT,"
        " a_losses INT, a_draws INT, games INT)"
    )
    con.executemany("INSERT INTO pair_matchup_agg VALUES (?,?,?,?,?,?)", pairs)
    con.commit()
    con.close()


TMP = tempfile.mkdtemp(prefix="player-decks-test-")
DB = os.path.join(TMP, "battles.db")

ROWS = (
    # Hog: 5 games, 3 won, 1 lost, 1 level. One of them stored in another order.
    [row(1, HOG), row(2, HOG), row(3, list(reversed(HOG))), row(4, HOG, "loss", crowns=0, opp_crowns=1),
     row(5, HOG, "", crowns=1, opp_crowns=1)]
    # Golem: 2 games, the newer of the two-game decks.
    + [row(9, GOLEM, wc="golem"), row(10, GOLEM, "loss", crowns=0, opp_crowns=3, wc="golem")]
    # Bait: 2 games, older.
    + [row(6, BAIT, wc="bait"), row(7, BAIT, wc="bait")]
    # Not this player's decks: 2v2 and an event deck.
    + [row(8, HOG, mode="TeamVsTeam"), row(8, HOG, mode="TeamVsTeam", hour=13),
       row(8, GOLEM, mode="Challenge_AllCards_EventDeck_NoSet", hour=14)]
    # A native duel: one loadout row, 16 cards, the duel's result only.
    + [row(11, HOG + BAIT, mode="CW_Duel_1v1")]
    # A native duel row that happens to hold ONE deck (a one-game duel).
    + [row(12, BAIT, mode="CW_Duel_1v1")]
)

PAIRS = [
    # Hog as deck_a: 10 won, 4 lost, 1 level.
    (key(HOG), key(GOLEM), 10, 4, 1, 15),
    # Hog as deck_b: the row is the OTHER deck's record, so 6 "a wins" are 6 Hog losses.
    (key(BAIT), key(HOG), 6, 3, 0, 9),
]

make_db(DB, ROWS, PAIRS)

cd.tier_windows = lambda tag, since, until: [(DB, since or "0", until or "9")]
cd._tier_paths = lambda: [DB]
cd.player_name = lambda tag: "Tester"


def no_indexes():
    pd._duel_index = lambda: None
    pd._cluster_index = lambda: None
    pd._COMMUNITY.clear()


# --- the window ---------------------------------------------------------------

check("7, 14 and 30 are the windows", [pd.valid_days(x) for x in ("7", "14", "30")] == [7, 14, 30])
check("anything else is the default",
      [pd.valid_days(x) for x in ("15", "", "abc", "0", None, "90", "-7")] == [pd.DEFAULT_DAYS] * 7)
check("the default is one of the windows", pd.DEFAULT_DAYS in pd.DAYS)


# --- the list, with no index of either kind -----------------------------------

no_indexes()
r = pd.report(TAG)
decks = r["decks"]
names = [d["key"] for d in decks]

check("three decks, not five — 2v2 and the event deck are not theirs",
      len(decks) == 3, str(len(decks)))
check("most played first", [d["battles"] for d in decks] == [5, 2, 2],
      str([d["battles"] for d in decks]))
check("the same eight cards in another order are ONE deck", names[0] == key(HOG))
check("equally played: the more recent first", names[1:] == [key(GOLEM), key(BAIT)], str(names[1:]))
check("the total is the games counted", r["total"] == 9 and r["summary"]["battles"] == 9,
      str(r["total"]))

hog = decks[0]
check("wins, losses and draws are counted apart",
      (hog["wins"], hog["losses"], hog["draws"]) == (3, 1, 1),
      str((hog["wins"], hog["losses"], hog["draws"])))
check("the three rates share a denominator that holds the draws",
      (hog["winRate"], hog["drawRate"], hog["lossRate"]) == (60.0, 20.0, 20.0),
      str((hog["winRate"], hog["drawRate"], hog["lossRate"])))
check("the share is of all counted games", hog["useRate"] == 55.56, str(hog["useRate"]))
check("shares add up", abs(sum(d["useRate"] for d in decks) - 100) < 0.05)
check("the newest game is the deck's last seen", hog["lastSeen"].startswith("20260905"))
check("eight cards, arranged", len(hog["cards"]) == 8 and set(hog["cards"]) == set(HOG))
check("average elixir", hog["avgElixir"] == 2.6, str(hog["avgElixir"]))
check("the cycle is the four cheapest", hog["cycle"] == 6, str(hog["cycle"]))
check("a deck has a name", bool(hog["deckName"]) and hog["deckName"] != "Unknown Deck",
      hog["deckName"])

s = r["summary"]
check("what was refused is counted by mode",
      s["hidden"] == 3 and s["hiddenByMode"].get("TeamVsTeam") == 2, str(s["hiddenByMode"]))
check("the duel rows are not counted from `battles`", s["loadouts"] == 2, str(s["loadouts"]))
check("...even the one that holds a single deck",
      next(d for d in decks if d["key"] == key(BAIT))["battles"] == 2)
check("no duel index: no duel games, and it says so",
      s["duelGames"] == 0 and s["duelIndex"] is False)
check("the player's name rides along", r["player"] == {"tag": TAG, "name": "Tester"})


# --- the community record, read live ------------------------------------------

com = hog["community"]
check("both directions of a stored pairing are folded, sides swapped",
      com is not None and (com["wins"], com["losses"], com["draws"]) == (13, 10, 1),
      str(com))
check("community rates are shares of every game too",
      com["battles"] == 24 and com["winRate"] == 54.2 and com["drawRate"] == 4.2
      and com["lossRate"] == 41.7, str(com))
golem = next(d for d in decks if d["key"] == key(GOLEM))
check("the other side of a pairing reads its own way round",
      golem["community"]["wins"] == 4 and golem["community"]["losses"] == 10,
      str(golem["community"]))
check("the payload names what the community row is measured over",
      r["communityBasis"] == "all_stored")

alone = pd.report(TAG, since="20260909T000000.000Z")
check("the window is passed through", [d["key"] for d in alone["decks"]] == [key(GOLEM)],
      str([d["key"] for d in alone["decks"]]))


# --- the community record prefers the cluster index ---------------------------

class FakeCluster:
    asked: list = []

    @staticmethod
    def totals(keys):
        FakeCluster.asked = list(keys)
        return {key(HOG): (700, 250, 50)}


no_indexes()
pd._cluster_index = lambda: FakeCluster
r2 = pd.report(TAG)
by = {d["key"]: d for d in r2["decks"]}
check("a deck the index knows is read from it", by[key(HOG)]["community"]["battles"] == 1000,
      str(by[key(HOG)]["community"]))
check("...and one it does not know is read live", by[key(GOLEM)]["community"]["battles"] == 15,
      str(by[key(GOLEM)]["community"]))
check("the index is asked for every deck once", sorted(FakeCluster.asked) == sorted(by))

FakeCluster.asked = []
pd.report(TAG)
check("a second read is served from the cache", FakeCluster.asked == [])

no_indexes()
pd._live_totals = (lambda orig: (lambda keys: {}))(pd._live_totals)
none = pd.report(TAG)["decks"][0]
check("a list nobody has a record with has no community row", none["community"] is None)


# --- native duels come from the duel index, game by game -----------------------

class FakeDuel:
    calls: list = []

    @staticmethod
    def available():
        return True

    @staticmethod
    def iso_to_stamp(iso, end=False):
        return None if not iso else iso + ("~" if end else "")

    @staticmethod
    def classify(k):
        return "bait" if "goblin-barrel" in k else "hog"

    @staticmethod
    def player_decks(tag, since, until):
        FakeDuel.calls.append((tag, since, until))
        return [
            {"key": key(BAIT), "cards": sorted(BAIT), "archetype": "bait",
             "games": 4, "wins": 3, "lastSeen": "20260912T180000.000Z"},
            {"key": key(HOG), "cards": sorted(HOG), "archetype": "hog",
             "games": 1, "wins": 0, "lastSeen": "20260901T010000.000Z"},
        ]


no_indexes()
pd._duel_index = lambda: FakeDuel
d3 = pd.report(TAG, since="2026-09-01", until="2026-09-30")
check("the duel index is asked for the same window, end of day inclusive",
      FakeDuel.calls[-1] == (TAG, "2026-09-01", "2026-09-30~"), str(FakeDuel.calls[-1]))

# The stamps above do not match the fixture's stored format, so read the whole
# table for the arithmetic.
d3 = pd.report(TAG)
by = {d["key"]: d for d in d3["decks"]}
check("duel games are added to the deck they were played with",
      by[key(BAIT)]["battles"] == 6 and by[key(BAIT)]["wins"] == 5, str(by[key(BAIT)]["battles"]))
check("a duel game not won is a loss", by[key(HOG)]["losses"] == 2 and by[key(HOG)]["battles"] == 6)
check("the total holds them", d3["total"] == 14 and d3["summary"]["duelGames"] == 5,
      str(d3["total"]))
check("order follows the merged count; equal counts, the more recent first",
      [d["key"] for d in d3["decks"]] == [key(BAIT), key(HOG), key(GOLEM)],
      str([d["battles"] for d in d3["decks"]]))
check("a duel game moves last seen forward, never back",
      by[key(BAIT)]["lastSeen"].startswith("20260912")
      and by[key(HOG)]["lastSeen"].startswith("20260905"))
check("it says the duel index answered", d3["summary"]["duelIndex"] is True)


class BrokenDuel(FakeDuel):
    @staticmethod
    def player_decks(tag, since, until):
        raise RuntimeError("index gone")


pd._duel_index = lambda: BrokenDuel
safe = pd.report(TAG)
check("a failing duel index costs the duel games, not the screen",
      safe["total"] == 9 and safe["summary"]["duelIndex"] is False)


# --- the forms a deck was seen fielded with ------------------------------------

no_indexes()
EVO = json.dumps([["skeletons", 1, "evolution"], ["musketeer", 2, "hero"]])
DB2 = os.path.join(TMP, "forms.db")
make_db(DB2, [row(1, HOG), row(2, HOG, evo=EVO), row(3, GOLEM, wc="golem")])
cd.tier_windows = lambda tag, since, until: [(DB2, since or "0", until or "9")]
cd._tier_paths = lambda: [DB2]
forms = {d["key"]: d for d in pd.report(TAG)["decks"]}
seen = forms[key(HOG)]
check("observed forms are drawn",
      seen.get("art", {}).get("skeletons") == "evolution"
      and seen.get("art", {}).get("musketeer") == "hero", str(seen.get("art")))
check("...and not flagged as inferred", not seen.get("artInferred"))
check("the special cards are seated first", set(seen["cards"][:2]) == {"skeletons", "musketeer"},
      str(seen["cards"][:3]))
guess = forms[key(GOLEM)]
check("a deck with no marks says its art is inferred",
      not guess.get("art") or guess.get("artInferred") is True, str(guess))


# --- the lean reader is the battle log's reader, row for row -------------------
#
# `played()` reads through `_own_rows`, which parses a deck string once however
# often it was played and never parses the opponent's. Team Analysis reads it
# for every player on both sides, so it has to be fast — and it has to be the
# SAME rows the battle log's reader would have given, or "what they play" on
# one screen stops being the Decks list on another.

import recent_battles as rb  # noqa: E402

ODD = os.path.join(TMP, "odd.db")
make_db(ODD, ROWS + [
    # No deck on either side: not a battle, on either reader.
    (TAG, "20260913T120000.000Z", "Ladder", "#RIVAL", "Rival", "win", "[]", "[]", "hog", "golem", 1, 0, None, None),
    # No deck of theirs, but an opponent's: kept by both (a loadout to `played`).
    (TAG, "20260913T130000.000Z", "Ladder", "#RIVAL", "Rival", "win", "[]", json.dumps(GOLEM), "hog", "golem", 1, 0, None, None),
    # A deck string that is not JSON: an empty deck to both.
    (TAG, "20260913T140000.000Z", "Ladder", "#RIVAL", "Rival", "loss", "{oops", json.dumps(GOLEM), "hog", "golem", 0, 1, None, None),
    # A mode nobody recorded, and NULLs where a count should be.
    (TAG, "20260913T150000.000Z", None, "#RIVAL", "Rival", "win", json.dumps(HOG), json.dumps(GOLEM), "hog", "golem", None, None, None, None),
    (TAG, "20260913T160000.000Z", "Ladder", "#RIVAL", "Rival", None, json.dumps(HOG), None, None, "golem", None, None, None, None),
])
cd.tier_windows = lambda tag, since, until: [(ODD, since or "0", until or "9")]
cd._tier_paths = lambda: [ODD]
no_indexes()
_ref, _ref_arch, _ref_hidden = rb._read_rows(TAG, None, None)
_got, _got_arch, _got_hidden = pd._own_rows(TAG, None, None)
_keys = ("battle_time", "mode", "result", "cards", "archetype", "crowns", "opp_crowns", "evo")
check("the lean reader returns the battle log's rows, one for one",
      len(_got) == len(_ref) and len(_ref) > 10, f"{len(_got)} vs {len(_ref)}")
check("...the same fields on every row, in the same order",
      [[r[k] for k in _keys] for r in _got] == [[r[k] for k in _keys] for r in _ref])
check("...what the router refused, counted the same way", _got_hidden == _ref_hidden and _got_hidden)
check("...and the same word on the archive", _got_arch == _ref_arch)
check("a row with no deck on either side is in neither",
      all(r["battle_time"] != "20260913T120000.000Z" for r in _got))

_p = pd.played(TAG)
check("played() is report()'s counting half: the same decks",
      set(_p["per"]) == {d["key"] for d in pd.report(TAG)["decks"]})
check("...with a record on each", _p["per"][key(HOG)][:3] == [5, 1, 2] or sum(_p["per"][key(HOG)][:3]) >= 5,
      str(_p["per"][key(HOG)][:3]))
check("...and the event deck and the 2v2 games are not their decks",
      sum(_p["hidden"].values()) >= 3)


# --- an empty window -----------------------------------------------------------

DB3 = os.path.join(TMP, "empty.db")
make_db(DB3, [])
cd.tier_windows = lambda tag, since, until: [(DB3, since or "0", until or "9")]
cd._tier_paths = lambda: [DB3]
no_indexes()
e = pd.report(TAG)
check("no battles is an answer, not an error",
      e["decks"] == [] and e["total"] == 0 and e["summary"]["winRate"] == 0.0)

cd.tier_windows = lambda tag, since, until: []
check("...and so is no storage at all", pd.report(TAG)["decks"] == [])


print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
