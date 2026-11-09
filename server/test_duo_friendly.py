"""test_duo_friendly.py — the top players' 2v2 board.

    python server/test_duo_friendly.py

Real SQLite files in a temp directory, payloads shaped like the real
`battle_raw` rows (ranked 2v2 is `type: "trail"`, clan friendly is
`type: "clanMate2v2"`, BOTH under game mode `TeamVsTeam` — measured on the live
database 2026-11-08). The live board is never read: `get` is a fake. What is
worth testing:

  * a side is recorded only when one of ITS two players is a top player — the
    opponents being top players does not make this side's decks theirs;
  * an empty top set records nothing (never "everyone");
  * a failed read of the live board keeps the last top set;
  * ranked and clan friendly both count; events and drafts never do;
  * one real battle stored under several tracked players is ONE game;
  * the board is the top N per win condition, a pair filed under each of its
    decks' win conditions; sides older than the window leave it.
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
        self.dir = tempfile.mkdtemp(prefix="duo-top-")
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

    def set_top(self, tags):
        dp._ensure()
        con = dp._connect()
        try:
            out = df.set_top(con, set(tags), {"board": len(tags), "crl": 0})
            con.commit()
            return out
        finally:
            con.close()

    def sides(self, where="1"):
        con = sqlite3.connect(dp.DB_PATH)
        try:
            return con.execute("SELECT kind, tags FROM df_side WHERE " + where).fetchall()
        finally:
            con.close()


def fake_board(tags, status=200):
    """A `recruit._get` stand-in serving one page of the live board."""
    def get(path, **params):
        if status != 200:
            return status, None
        return 200, {"items": [{"tag": t.lstrip("#")} for t in tags], "paging": {}}
    return get


# --------------------------------------------------------------------------
print("\nkind_of")
check("clanMate2v2 is friendly", df.kind_of(payload("x", [], [])) == "friendly")
check("trail is ranked", df.kind_of(payload("x", [], [], kind="trail")) == "ranked")
check("the type is read case-insensitively",
      df.kind_of({"type": "CLANMATE2V2"}, "TeamVsTeam") == "friendly")
check("another battle type is neither", df.kind_of(payload("x", [], [], kind="challenge")) is None)
check("a draft 2v2 is not own decks",
      df.kind_of(payload("x", [], [], kind="trail", mode="TeamVsTeam_PickMode")) is None)
check("an event-deck 2v2 is not own decks",
      df.kind_of(payload("x", [], []), "TeamVsTeam_EventDeck") is None)
check("Royale Shuffle 2v2 is not own decks",
      df.kind_of(payload("x", [], [], mode="RR_TeamVsTeam")) is None)

# --------------------------------------------------------------------------
print("\nsides_for and the top set")
pairs = [("team", "a", "b", HOG, GIANT, ["#AA", "#BB"], "p1"),
         ("opponent", "c", "d", BAIT, LAVA, ["#CC", "#DD"], "p2")]
kept = df.sides_for({}, "bid", "t", pairs, "ranked", {"#AA"})
check("only the side holding a top player is kept", [r[1] for r in kept] == ["team"], str(kept))
check("the row carries its kind", kept[0][-1] == "ranked")
check("an empty top set keeps nothing", df.sides_for({}, "bid", "t", pairs, "ranked", set()) == [])
check("no top filter keeps both sides", len(df.sides_for({}, "bid", "t", pairs)) == 2)
check("a tag without # still matches",
      len(df.sides_for({}, "b", "t", [pairs[1][:5] + (["CC", "#XX"], "p2")],
                       "ranked", {"#CC"})) == 1)

got, info = df.fetch_top(get=fake_board(["#AA", "BB"]), cohorts={"crl": ["cc"]})
check("top = live board + CRL, tags normalised", got == {"#AA", "#BB", "#CC"}, str(got))
check("fetch reports both parts", info == {"board": 2, "crl": 1}, str(info))
_, bad = df.fetch_top(get=fake_board([], status=503), cohorts={})
check("a failed board read reports zero", bad["board"] == 0)

# --------------------------------------------------------------------------
print("\nbuild_board (pure)")


def side(fp, bt, a, b, tags=("#A", "#B")):
    return (fp, bt, "fa-" + fp, "fb-" + fp, json.dumps(a), json.dumps(b), json.dumps(list(tags)))


rows = []
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
check("hog bucket keeps the top 2 by games",
      [f for _, f, _, _ in sorted(by.get("hog", []))] == ["hg", "hb"], str(by.get("hog")))
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
print("\nthe fold records top players' sides, ranked and friendly")

# #AA and #GG are top players; nobody else is.
FRIENDLY = payload(stamp(1), [("#AA", HOG), ("#BB", GIANT)], [("#CC", BAIT), ("#DD", LAVA)])
FRIENDLY_COPY = payload(stamp(1), [("#BB", GIANT), ("#AA", HOG)], [("#DD", LAVA), ("#CC", BAIT)])
FRIENDLY_2 = payload(stamp(2), [("#AA", HOG), ("#BB", GIANT)], [("#EE", MINER), ("#FF", GOLEM)])
RANKED_TOP = payload(stamp(1, 5), [("#ZZ", MINER), ("#GG", GOLEM)], [("#II", HOG), ("#JJ", LAVA)],
                     kind="trail")
RANKED_NOBODY = payload(stamp(1, 9), [("#KK", BAIT), ("#LL", MINER)], [("#MM", GIANT), ("#NN", LAVA)],
                        kind="trail")
EVENT = payload(stamp(1, 11), [("#AA", BAIT), ("#BB", GOLEM)], [("#QQ", HOG), ("#RR", MINER)],
                kind="challenge")
OLD = payload(stamp(40), [("#AA", BAIT), ("#BB", GOLEM)], [("#MM", HOG), ("#NN", MINER)])

with Fixture([("#AA", FRIENDLY), ("#BB", FRIENDLY_COPY), ("#AA", FRIENDLY_2),
              ("#GG", RANKED_TOP), ("#KK", RANKED_NOBODY), ("#AA", EVENT),
              ("#AA", OLD)]) as fx:
    fx.set_top({"#AA", "#GG"})
    dp.migrate(enrol=False)
    allsides = fx.sides()
    check("4 sides: three #AA friendlies (one is old) + one #GG ranked", len(allsides) == 4,
          str(allsides))
    check("no side without a top player was recorded",
          all(("#AA" in t) or ("#GG" in t) for _, t in allsides), str(allsides))
    check("the opponents of a top player are not recorded",
          not fx.sides("tags LIKE '%#CC%' OR tags LIKE '%#II%'"))
    check("the ranked top-player side is recorded as ranked",
          [k for k, t in allsides if "#GG" in t] == ["ranked"])
    check("a ranked battle with no top player is not recorded",
          not fx.sides("tags LIKE '%#KK%'"))
    check("the event battle is not recorded", not fx.sides("tags LIKE '%#QQ%'") and
          len([1 for _, t in allsides if "#AA" in t]) == 3)

    res = df.refresh(now=NOW, fetch=False)
    check("refresh drops the side older than 30 days", res["dropped"] == 1, str(res))
    check("refresh counts battles by kind", res["byKind"] == {"friendly": 2, "ranked": 1}, str(res))
    rep = df.report(per=50)
    hg = [p for p in rep["pairs"] if set(p["deckA"]["cardKeys"]) | set(p["deckB"]["cardKeys"])
          == set(HOG) | set(GIANT)]
    check("Hog + Giant counted twice (two real battles, one stored twice)",
          len(hg) == 1 and hg[0]["occurrences"] == 2, str([p["occurrences"] for p in hg]))
    check("two pairs on the board", rep["total"] == 2, str(rep["total"]))
    check("report says top", rep["kind"] == "top" and rep["summary"]["mode"] == "top-2v2")
    check("summary splits ranked and friendly battles",
          rep["summary"]["battlesRanked"] == 1 and rep["summary"]["battlesFriendly"] == 2,
          str(rep["summary"]))
    check("rows come seated with eight cards a deck",
          all(len(p["deckA"]["cards"]) == 8 and len(p["deckB"]["cards"]) == 8 for p in rep["pairs"]))

    golem = df.report(win_condition="golem", per=50)
    check("a win condition narrows to its own bucket",
          golem["total"] == 1 and "golem" in golem["pairs"][0]["deckA"]["cardKeys"] +
          golem["pairs"][0]["deckB"]["cardKeys"], str(golem["total"]))
    check("chips list every win condition with its count",
          {w["key"] for w in rep["winConditions"]} == set(dr.all_win_conditions())
          and next(w for w in rep["winConditions"] if w["key"] == "golem")["pairs"] == 1)
    check("'other' is the last chip", rep["winConditions"][-1]["key"] == "other")
    check("an unknown win condition falls back to all",
          df.report(win_condition="'; DROP TABLE df_board--")["winCondition"] == "")
    check("an unknown sort falls back to played", df.report(sort="x")["sort"] == "played")
    cards = df.report(cards=["golem"], per=50)
    check("the card filter keeps only pairs with Golem in one deck",
          cards["total"] == 1 and all("golem" in p["deckA"]["cardKeys"] or
                                      "golem" in p["deckB"]["cardKeys"] for p in cards["pairs"]))

    # ARCHETYPE TAGS (2026-11-09): a bucket per tag, a tag on every deck.
    check("the report lists tags, each under its family",
          rep["tags"] and all(t["key"].startswith(df.TAG_PREFIX) and
                              t["key"][2:].split(":")[0] == t["family"] for t in rep["tags"]),
          str(rep["tags"]))
    check("every deck on a row carries its tag",
          all(isinstance(p["deckA"].get("tag"), str) and p["deckA"]["tag"] and
              isinstance(p["deckB"].get("tag"), str) and p["deckB"]["tag"] for p in rep["pairs"]))
    some = rep["tags"][0]
    by_tag = df.report(win_condition=some["key"], per=50)
    check("a tag key narrows the board to that tag",
          by_tag["winCondition"] == some["key"] and by_tag["total"] == some["pairs"] and
          all(some["label"] in (p["deckA"]["tag"], p["deckB"]["tag"]) for p in by_tag["pairs"]),
          str((some, by_tag["total"])))
    check("an unknown tag key falls back to all",
          df.report(win_condition="t:bait:nope")["winCondition"] == "")
    check("the deck tag is the family's when no rule names it",
          df.deck_tag(json.dumps(GOLEM))["family"] == "golem")

    kept_top = df.refresh(now=NOW, get=fake_board([], status=503), cohorts={})
    check("a failed board read keeps the last top set",
          kept_top["top"]["kept"] and kept_top["top"]["players"] == 2, str(kept_top["top"]))
    swapped = df.refresh(now=NOW, get=fake_board(["#XX"]), cohorts={"crl": ["#YY"]})
    check("a good read replaces the set", swapped["top"]["players"] == 2 and
          not swapped["top"]["kept"], str(swapped["top"]))
    check("the board keeps sides judged under the earlier set",
          swapped["boardRows"] == res["boardRows"])

    dp.update()
    check("an incremental run adds nothing", len(fx.sides()) == 3, str(len(fx.sides())))

with Fixture([("#AA", FRIENDLY)]) as fx:
    dp.migrate(enrol=False)
    check("with no top set stored, nothing is recorded", fx.sides() == [])

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
