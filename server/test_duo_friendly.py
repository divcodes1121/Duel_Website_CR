"""test_duo_friendly.py — the clan friendly 2v2 board.

    python server/test_duo_friendly.py

Real SQLite files in a temp directory, payloads shaped like the real
`battle_raw` rows (ranked 2v2 is `type: "trail"`, clan friendly is
`type: "clanMate2v2"`, BOTH under game mode `TeamVsTeam` — measured on the live
database 2026-11-08). What is worth testing:

  * a ranked 2v2 battle must never reach the friendly board, though its mode
    string is identical;
  * one real battle stored under several tracked players is ONE game;
  * the board is the top N per win condition, a pair filed under each of its
    decks' win conditions;
  * sides older than the window leave the board;
  * the fold records friendly sides itself, so the hourly job needs no second
    read of `battle_raw`.
"""

from __future__ import annotations

import datetime
import json
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clash_data as cd
import duel_combos as dx
import duo_friendly as df
import duo_pairs as dp
import duo_retention as dr

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


HOG = ["knight", "hog-rider", "fireball", "tesla",
       "archers", "ice-spirit", "the-log", "skeletons"]
GIANT = ["giant", "musketeer", "zap", "mini-pekka",
         "arrows", "goblins", "cannon", "spear-goblins"]
BAIT = ["goblin-barrel", "princess", "rocket", "goblin-gang",
        "inferno-tower", "dart-goblin", "barbarian-barrel", "ice-golem"]
LAVA = ["lava-hound", "balloon", "mega-minion", "tombstone",
        "arrows", "skeleton-army", "fireball", "guards"]
MINER = ["miner", "poison", "bats", "valkyrie",
         "electro-wizard", "royal-ghost", "magic-archer", "mini-pekka"]
GOLEM = ["golem", "night-witch", "baby-dragon", "lightning",
         "tornado", "barbarian-barrel", "elixir-collector", "guards"]


def participant(tag, keys):
    return {
        "tag": tag, "name": "P" + tag, "crowns": 1,
        "cards": [{"name": k, "id": dx.card_info(k).get("id"), "level": 14}
                  for k in keys],
        "supportCards": [{"name": "Tower Princess", "id": 159000000}],
    }


def payload(when, team, opp, kind="clanMate2v2", mode="TeamVsTeam"):
    return {
        "battleTime": when, "type": kind,
        "gameMode": {"id": 72000006, "name": mode},
        "deckSelection": "collection",
        "team": [participant(t, k) for t, k in team],
        "opponent": [participant(t, k) for t, k in opp],
    }


SCHEMA = """
CREATE TABLE battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, player_tag TEXT, battle_time TEXT,
    game_mode TEXT, opponent_tag TEXT, result TEXT, player_card_keys TEXT,
    opponent_card_keys TEXT
);
CREATE TABLE battle_raw (
    player_tag TEXT NOT NULL, battle_time TEXT NOT NULL, game_mode TEXT,
    schema_version INTEGER, stored_at TEXT, raw_json TEXT NOT NULL,
    PRIMARY KEY (player_tag, battle_time)
);
CREATE TABLE tracked_players (tag TEXT PRIMARY KEY, added_at TEXT);
"""

NOW = datetime.datetime(2026, 11, 8, 12, 0, tzinfo=datetime.timezone.utc)


def stamp(days_ago, minute=0):
    return (NOW - datetime.timedelta(days=days_ago, minutes=-minute)).strftime(
        "%Y%m%dT%H%M%S.000Z")


class Fixture:
    def __init__(self, rows):
        self.dir = tempfile.mkdtemp(prefix="duo-friendly-")
        self.src = os.path.join(self.dir, "battles.db")
        self.col = os.path.join(self.dir, "pairs.db")
        con = sqlite3.connect(self.src)
        con.executescript(SCHEMA)
        for i, (tag, p) in enumerate(rows):
            con.execute(
                "INSERT INTO battle_raw (player_tag, battle_time, game_mode, "
                "stored_at, raw_json) VALUES (?,?,?,?,?)",
                (tag, p["battleTime"], p["gameMode"]["name"],
                 "2026-11-08T10:%02d:00+00:00" % (i % 60), json.dumps(p)))
        con.commit()
        con.close()

    def __enter__(self):
        self._resolve, self._db = cd.resolve_db_path, dp.DB_PATH
        cd.resolve_db_path = lambda: self.src
        dp.DB_PATH = self.col
        dp._ready = False
        dp._MODES_CACHE = None
        return self

    def __exit__(self, *exc):
        cd.resolve_db_path, dp.DB_PATH = self._resolve, self._db
        dp._ready = False
        dp._MODES_CACHE = None
        return False


# --------------------------------------------------------------------------
print("\nis_clan_friendly")
check("clanMate2v2 on TeamVsTeam is friendly",
      df.is_clan_friendly(payload("x", [], []), "TeamVsTeam"))
check("ranked 2v2 (trail) is not, though the mode string is identical",
      not df.is_clan_friendly(payload("x", [], [], kind="trail"), "TeamVsTeam"))
check("the type is read case-insensitively",
      df.is_clan_friendly({"type": "CLANMATE2V2"}, "TeamVsTeam"))
check("a draft clan 2v2 is not own decks",
      not df.is_clan_friendly(payload("x", [], [], mode="TeamVsTeam_PickMode"),
                              "TeamVsTeam_PickMode"))
check("an event-deck clan 2v2 is not own decks",
      not df.is_clan_friendly(payload("x", [], []), "TeamVsTeam_EventDeck"))
check("the payload's own mode is used when none is passed",
      not df.is_clan_friendly(payload("x", [], [], mode="Royale_Shuffle_2v2".replace("Royale", "RR"))))

# --------------------------------------------------------------------------
print("\nbuild_board (pure)")


def side(fp, bt, a, b, tags=("#A", "#B")):
    return (fp, bt, "fa-" + fp, "fb-" + fp, json.dumps(a), json.dumps(b), json.dumps(list(tags)))


rows = []
# Hog+Giant played 3 times, Hog+Bait twice, Hog+Lava once (newest), Giant+Giant once.
for i in range(3):
    rows.append(side("hg", stamp(1, i), HOG, GIANT, ("#A", "#B" if i else "#C")))
for i in range(2):
    rows.append(side("hb", stamp(2, i), HOG, BAIT))
rows.append(side("hl", stamp(0), HOG, LAVA))
rows.append(side("gg", stamp(5), GIANT, GIANT))
board = df.build_board(rows, dr.win_conditions, per=2)
by = {}
for wc, fp, rank, games, players, first, last, *_ in board:
    by.setdefault(wc, []).append((rank, fp, games, players))
check("hog bucket keeps the top 2 by games", [f for _, f, _, _ in sorted(by.get("hog", []))] == ["hg", "hb"],
      str(by.get("hog")))
check("games counted per pair", dict((f, g) for _, f, g, _ in by["hog"]) == {"hg": 3, "hb": 2})
check("distinct players counted across sides", dict((f, p) for _, f, _, p in by["hog"])["hg"] == 3)
check("a pair is filed under each deck's win condition",
      "hg" in [f for _, f, _, _ in by.get("giant", [])])
check("a mirror pair is filed once under its one win condition",
      sum(1 for r in board if r[1] == "gg") == 1)
check("ranks start at 1 in every bucket", all(min(r for r, *_ in v) == 1 for v in by.values()))
tie = df.build_board([side("aaa", stamp(3), HOG, GIANT), side("zzz", stamp(1), HOG, BAIT)],
                     dr.win_conditions, per=1)
check("a tie in games goes to the newer last battle",
      [r[1] for r in tie if r[0] == "hog"] == ["zzz"], str(tie))

# --------------------------------------------------------------------------
print("\nthe fold records friendly sides, and only friendly ones")

FRIENDLY = payload(stamp(1), [("#AA", HOG), ("#BB", GIANT)], [("#CC", BAIT), ("#DD", LAVA)])
# The same battle as the other teammate stored it.
FRIENDLY_COPY = payload(stamp(1), [("#BB", GIANT), ("#AA", HOG)], [("#DD", LAVA), ("#CC", BAIT)])
FRIENDLY_2 = payload(stamp(2), [("#AA", HOG), ("#BB", GIANT)], [("#EE", MINER), ("#FF", GOLEM)])
RANKED = payload(stamp(1, 5), [("#GG", BAIT), ("#HH", MINER)], [("#II", GIANT), ("#JJ", LAVA)],
                 kind="trail")
OLD = payload(stamp(40), [("#KK", BAIT), ("#LL", GOLEM)], [("#MM", HOG), ("#NN", MINER)])

with Fixture([("#AA", FRIENDLY), ("#BB", FRIENDLY_COPY), ("#AA", FRIENDLY_2),
              ("#GG", RANKED), ("#KK", OLD)]) as fx:
    dp.migrate(enrol=False)
    con = sqlite3.connect(dp.DB_PATH)
    n_sides = con.execute("SELECT COUNT(*) FROM df_side").fetchone()[0]
    n_battles = con.execute("SELECT COUNT(DISTINCT battle_id) FROM df_side").fetchone()[0]
    ranked_tags = con.execute("SELECT COUNT(*) FROM df_side WHERE tags LIKE '%#GG%'").fetchone()[0]
    con.close()
    check("3 friendly battles -> 6 sides (the stored copy adds nothing)", n_sides == 6, str(n_sides))
    check("3 distinct friendly battles", n_battles == 3, str(n_battles))
    check("the ranked battle is not recorded", ranked_tags == 0)

    res = df.refresh(now=NOW)
    check("refresh drops the side older than 30 days", res["dropped"] == 2, str(res))
    rep = df.report(per=50)
    pairs = {(tuple(sorted(p["deckA"]["cardKeys"])), tuple(sorted(p["deckB"]["cardKeys"]))): p
             for p in rep["pairs"]}
    hg = [p for p in rep["pairs"] if set(p["deckA"]["cardKeys"]) | set(p["deckB"]["cardKeys"])
          == set(HOG) | set(GIANT)]
    check("Hog + Giant counted twice (two real battles)", len(hg) == 1 and hg[0]["occurrences"] == 2,
          str([p["occurrences"] for p in hg]))
    check("the board lists each pair once with no win condition chosen",
          len(rep["pairs"]) == len({p["pairFingerprint"] for p in rep["pairs"]}))
    ranked_sets = [set(BAIT) | set(MINER), set(GIANT) | set(LAVA)]
    check("neither ranked pair is on the board",
          not any(set(p["deckA"]["cardKeys"]) | set(p["deckB"]["cardKeys"]) in ranked_sets
                  for p in rep["pairs"]))
    check("report says friendly", rep["kind"] == "friendly" and rep["summary"]["mode"] == "clanMate2v2")
    check("rows come seated with eight cards a deck",
          all(len(p["deckA"]["cards"]) == 8 and len(p["deckB"]["cards"]) == 8 for p in rep["pairs"]))

    lava = df.report(win_condition="lava", per=50)
    check("a win condition narrows to its own bucket",
          lava["total"] >= 1 and all("lava-hound" in p["deckA"]["cardKeys"] + p["deckB"]["cardKeys"]
                                     for p in lava["pairs"]), str(lava["total"]))
    check("chips list every win condition with its count",
          {w["key"] for w in rep["winConditions"]} == set(dr.all_win_conditions())
          and next(w for w in rep["winConditions"] if w["key"] == "lava")["pairs"] == lava["total"])
    check("'other' is the last chip", rep["winConditions"][-1]["key"] == "other")
    check("an unknown win condition falls back to all",
          df.report(win_condition="'; DROP TABLE df_board--")["winCondition"] == "")
    check("an unknown sort falls back to played", df.report(sort="x")["sort"] == "played")

    cards = df.report(cards=["golem"], per=50)
    check("the card filter keeps only pairs with Golem in one deck",
          cards["total"] >= 1 and all("golem" in p["deckA"]["cardKeys"] or
                                      "golem" in p["deckB"]["cardKeys"] for p in cards["pairs"]))
    giant = df.report(cards=["giant"], per=50)
    check("'giant' is the Giant, not every giant",
          all("giant" in p["deckA"]["cardKeys"] or "giant" in p["deckB"]["cardKeys"]
              for p in giant["pairs"]))
    check("a second refresh is stable", df.refresh(now=NOW)["boardRows"] == res["boardRows"])

    # A second update reads nothing new and records nothing twice.
    dp.update()
    con = sqlite3.connect(dp.DB_PATH)
    again = con.execute("SELECT COUNT(*) FROM df_side").fetchone()[0]
    con.close()
    check("an incremental run adds nothing", again == 4, str(again))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
