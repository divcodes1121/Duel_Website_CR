"""duel_feed: every stored duel, newest first — the admin "All Duels" screen.

Runs against a synthetic bot database and a duel index built from it, both in
a temp directory; nothing touches the real ones. Every tag and name here is
invented.

    python server/test_duel_feed.py
"""
from __future__ import annotations

import datetime
import json
import os
import shutil
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clash_data as cd  # noqa: E402
import duel_combos as dx  # noqa: E402
import duel_feed as df  # noqa: E402
import duel_index as di  # noqa: E402

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


HOG = ["hog-rider", "musketeer", "cannon", "fireball", "the-log", "ice-spirit",
       "skeletons", "valkyrie"]
BAIT = ["goblin-barrel", "goblin-gang", "princess", "rocket", "knight",
        "inferno-tower", "electro-spirit", "barbarian-barrel"]
GOLEM = ["golem", "night-witch", "lumberjack", "baby-dragon", "lightning",
         "tornado", "mega-minion", "zap"]
MORTAR = ["mortar", "rascals", "cannon-cart", "goblins", "minions",
          "skeleton-barrel", "arrows", "bats"]
GIANT = ["giant", "graveyard", "bowler", "freeze", "poison", "ice-golem",
         "tombstone", "archers"]
RG = ["royal-giant", "fisherman", "hunter", "lightning", "the-log",
      "royal-ghost", "electro-spirit", "mother-witch"]
XBOW = ["x-bow", "tesla", "archers", "knight", "the-log", "electro-spirit",
        "skeletons", "fireball"]

ID = {k: int(dx.card_info(k).get("id") or 0)
      for k in set(HOG + BAIT + GOLEM + MORTAR + GIANT + RG + XBOW)}
check("every test card is in the catalogue with an id", all(ID.values()),
      str([k for k, v in ID.items() if not v]))

NEWEST = datetime.date(2026, 9, 20)


def stamp(days_ago: int, hhmmss: str = "120000") -> str:
    d = NEWEST - datetime.timedelta(days=days_ago)
    return d.strftime("%Y%m%d") + f"T{hhmmss}.000Z"


def rnd(deck, crowns):
    return {"cards": [{"id": ID[k]} for k in deck], "crowns": crowns}


def payload(bt, ta, tb, ra, rb):
    return {"battleTime": bt, "team": [{"tag": ta, "rounds": ra}],
            "opponent": [{"tag": tb, "rounds": rb}]}


# The version-cell stage of a build reads the counter snapshot and the meta
# board; left alone it would load this checkout's real files.
import deck_counter as dcx_mod  # noqa: E402
import meta as meta_mod  # noqa: E402

_orig_seeds, _orig_dload = dcx_mod.seeds, dcx_mod._load_snapshot
_orig_board, _orig_mload = meta_mod.board, meta_mod._load_snapshot
dcx_mod.seeds = lambda: {}
dcx_mod._load_snapshot = lambda: None
meta_mod.board = lambda: {"decks": []}
meta_mod._load_snapshot = lambda: None

TMP = tempfile.mkdtemp(prefix="duelfeed-")
BOT = os.path.join(TMP, "bot.db")
IDX = os.path.join(TMP, "duel.db")
_orig_tiers, _orig_path = cd._tier_paths, di.PATH
cd._tier_paths = lambda: [BOT]
di.PATH = IDX

seq = [0]


def store(con, tag, mode, pl):
    seq[0] += 1
    con.execute("INSERT INTO battle_raw VALUES (?,?,?,?,?)",
                (tag, pl["battleTime"], mode, f"2026-09-20 00:{seq[0]:05d}", json.dumps(pl)))


def battle_row(con, bt, me, them, mine=None, theirs=None):
    con.execute("INSERT INTO battles VALUES (?,?,?,?,?)",
                (bt, me, them, json.dumps(mine) if mine else None,
                 json.dumps(theirs) if theirs else None))


def rebuild():
    di.build(IDX, BOT)
    di._state["checked"] = 0.0      # look at the new build now, not in a minute


try:
    bot = sqlite3.connect(BOT)
    bot.executescript(
        """
        CREATE TABLE battle_raw(player_tag TEXT, battle_time TEXT, game_mode TEXT,
                                stored_at TEXT, raw_json TEXT);
        CREATE INDEX ix_raw_stored ON battle_raw(stored_at);
        CREATE TABLE battles(battle_time TEXT, player_tag TEXT, opponent_tag TEXT,
                             player_evo TEXT, opponent_evo TEXT);
        CREATE INDEX idx_battles_time ON battles(battle_time);
        CREATE INDEX idx_battles_tag ON battles(player_tag);
        CREATE TABLE player_names(tag TEXT PRIMARY KEY, name TEXT NOT NULL,
                                  updated_at TEXT NOT NULL, source TEXT NOT NULL);
        """
    )
    for tag, name in (("#AAA", "Alpha"), ("#BBB", "Bravo"), ("#CCC", "Charlie"),
                      ("#DDD", "Delta"), ("#EEE", "Echo")):
        bot.execute("INSERT INTO player_names VALUES (?,?,?,?)", (tag, name, "", "test"))

    # D1 — today. #BBB beats #AAA 2-1. Stored under BOTH players, sides swapped.
    #      team = #BBB, so the index must flip it: side a is #AAA.
    T1 = stamp(0, "180000")
    d1_b = [rnd(HOG, 3), rnd(MORTAR, 0), rnd(XBOW, 2)]      # #BBB's three decks
    d1_a = [rnd(BAIT, 1), rnd(GOLEM, 1), rnd(RG, 1)]        # #AAA's
    store(bot, "#BBB", "CW_Duel_1v1", payload(T1, "#BBB", "#AAA", d1_b, d1_a))
    store(bot, "#AAA", "CW_Duel_1v1", payload(T1, "#AAA", "#BBB", d1_a, d1_b))
    # Both players' own rows carry marks. #AAA's row has a WRONG idea of what
    # #BBB fielded (valkyrie as a hero); #BBB's own row says evolution.
    battle_row(bot, T1, "#AAA", "#BBB",
               mine=[["knight", 2, "hero"], ["barbarian-barrel", 2, "hero"]],
               theirs=[["valkyrie", 2, "hero"]])
    battle_row(bot, T1, "#BBB", "#AAA",
               mine=[["valkyrie", 1, "evolution"], ["cannon", 1, "evolution"]],
               theirs=[["knight", 2, "hero"]])
    # Same second, same player tag as a participant, a DIFFERENT opponent: not
    # this duel, and its marks must not be borrowed.
    battle_row(bot, T1, "#BBB", "#ZZZ", mine=[["musketeer", 2, "hero"]])

    # D2 — today, earlier. #CCC sweeps #DDD 2-0. Only #CCC is tracked, so the
    #      one row answers for both sides.
    T2 = stamp(0, "090000")
    store(bot, "#CCC", "Duel_1v1_Friendly",
          payload(T2, "#CCC", "#DDD", [rnd(GIANT, 2), rnd(HOG, 1)],
                  [rnd(GOLEM, 0), rnd(BAIT, 0)]))
    battle_row(bot, T2, "#CCC", "#DDD",
               mine=[["archers", 1, "evolution"]],
               theirs=[["knight", 1, "evolution"]])

    # D3 — 10 days ago. #EEE (no battles row at all) beats #NONAME 2-0.
    T3 = stamp(10)
    store(bot, "#EEE", "CW_Duel_1v1",
          payload(T3, "#EEE", "#NONAME", [rnd(RG, 3), rnd(MORTAR, 1)],
                  [rnd(XBOW, 0), rnd(GOLEM, 0)]))

    # D4 — 45 days ago: in the 60- and 90-day windows, not the 30.
    T4 = stamp(45)
    store(bot, "#AAA", "CW_Duel_1v1",
          payload(T4, "#AAA", "#CCC", [rnd(HOG, 1), rnd(GOLEM, 0)],
                  [rnd(GIANT, 2), rnd(XBOW, 1)]))

    # D5 — 75 days ago: the 90-day window only.
    T5 = stamp(75)
    store(bot, "#DDD", "CW_Duel_1v1",
          payload(T5, "#DDD", "#EEE", [rnd(BAIT, 3), rnd(MORTAR, 2)],
                  [rnd(HOG, 0), rnd(RG, 1)]))

    # D6 — 120 days ago: stored, and in no window this screen offers.
    store(bot, "#AAA", "CW_Duel_1v1",
          payload(stamp(120), "#AAA", "#EEE", [rnd(HOG, 3), rnd(GOLEM, 3)],
                  [rnd(BAIT, 0), rnd(XBOW, 0)]))

    # Not native duels: a ladder battle and a plain friendly, rounds or not.
    store(bot, "#AAA", "Ladder",
          payload(stamp(0, "200000"), "#AAA", "#BBB", [rnd(HOG, 3)], [rnd(BAIT, 0)]))
    store(bot, "#AAA", "Friendly",
          payload(stamp(0, "210000"), "#AAA", "#BBB", [rnd(HOG, 3)], [rnd(BAIT, 0)]))
    bot.commit()
    rebuild()

    print("\n-- The windows --")
    check("three windows, and they are 30, 60 and 90", df.DAYS == (30, 60, 90))
    check("it opens on 30", df.DEFAULT_DAYS == 30 and df.valid_days("") == 30)
    check("anything else is the default",
          [df.valid_days(v) for v in ("7", "45", "abc", None, "-1", "9999", "90 ")]
          == [30, 30, 30, 30, 30, 30, 90])
    r30, r60, r90 = df.report(30), df.report(60), df.report(90)
    check("30 days holds the three recent duels", r30["total"] == 3, str(r30["total"]))
    check("60 days adds the one from 45 days ago", r60["total"] == 4)
    check("90 days adds the one from 75 days ago, and stops there", r90["total"] == 5)
    check("the window is counted back from the newest duel STORED",
          r30["window"] == {"from": "2026-08-22", "to": "2026-09-20"}, str(r30["window"]))
    check("games are counted for the window too",
          (r30["windowGames"], r90["windowGames"]) == (7, 11),
          f"{r30['windowGames']} {r90['windowGames']}")
    check("unfiltered, the total IS the window", r90["total"] == r90["windowDuels"])
    check("the payload says which windows exist", r30["windows"] == [30, 60, 90])

    print("\n-- Newest first, one row a duel --")
    ids = [d["id"] for d in r90["duels"]]
    check("newest first", [d["battleTime"] for d in r90["duels"]]
          == sorted((d["battleTime"] for d in r90["duels"]), reverse=True), str(ids))
    check("a duel stored under both players is listed once",
          sum(1 for d in r90["duels"] if d["battleTime"] == T1) == 1)
    check("only native duels: no ladder battle, no plain friendly",
          all(d["mode"] in ("CW_Duel_1v1", "Duel_1v1_Friendly") for d in r90["duels"])
          and not any(d["battleTime"] > T1 for d in r90["duels"]))
    check("the modes are named", [d["modeLabel"] for d in r30["duels"]]
          == ["War duel", "Friendly duel", "War duel"])
    check("an unknown mode is a Duel, not a guess", df.mode_label("Duel_New_Thing") == "Duel")

    print("\n-- A duel --")
    d1 = r90["duels"][0]
    check("side a is the lexically first tag, whoever the payload called team",
          (d1["a"]["tag"], d1["b"]["tag"]) == ("#AAA", "#BBB"))
    check("both players are named", (d1["a"]["name"], d1["b"]["name"]) == ("Alpha", "Bravo"))
    check("the score is games won", (d1["a"]["wins"], d1["b"]["wins"]) == (1, 2), str(d1["a"]))
    check("and the winner is named, not left to the layout", d1["winner"] == "b")
    check("three games, in order", [g["game"] for g in d1["games"]] == [1, 2, 3])
    check("each game carries both sides' crowns",
          [(g["a"]["crowns"], g["b"]["crowns"]) for g in d1["games"]]
          == [(1, 3), (1, 0), (1, 2)], str([(g["a"]["crowns"], g["b"]["crowns"]) for g in d1["games"]]))
    check("and its own winner", [g["winner"] for g in d1["games"]] == ["b", "a", "b"])
    check("crowns total across the duel", (d1["a"]["crowns"], d1["b"]["crowns"]) == (3, 5))
    check("each side's deck is the deck THAT player fielded in THAT game",
          sorted(d1["games"][0]["a"]["cards"]) == sorted(BAIT)
          and sorted(d1["games"][0]["b"]["cards"]) == sorted(HOG)
          and sorted(d1["games"][2]["a"]["cards"]) == sorted(RG)
          and sorted(d1["games"][2]["b"]["cards"]) == sorted(XBOW))
    check("every deck is eight distinct cards, with a name and an elixir cost",
          all(len(set(g[s]["cards"])) == 8 and g[s]["deckName"] and g[s]["avgElixir"] > 0
              for d in r90["duels"] for g in d["games"] for s in ("a", "b")))
    d2 = r90["duels"][1]
    check("a sweep is two games, 2-0", len(d2["games"]) == 2
          and (d2["a"]["wins"], d2["b"]["wins"]) == (2, 0) and d2["winner"] == "a")
    d3 = r90["duels"][2]
    check("a player nobody has a name for has name None, never their tag",
          d3["b"]["tag"] == "#NONAME" and d3["b"]["name"] is None, str(d3["b"]))

    print("\n-- The forms that were fielded --")
    g1 = d1["games"][0]
    check("a player's own row says how their deck went in",
          g1["b"]["art"].get("valkyrie") == "evolution" and g1["b"]["art"].get("cannon") == "evolution",
          str(g1["b"].get("art")))
    check("and it outranks what the other player's row says about them",
          g1["b"]["art"].get("valkyrie") != "hero")
    check("observed forms are not flagged as inferred",
          "artInferred" not in g1["b"] and "artInferred" not in g1["a"])
    check("the marked cards sit in the special slots",
          set(g1["b"]["cards"][:3]) >= {"valkyrie", "cannon"}, str(g1["b"]["cards"]))
    check("the same second with a different opponent lends nothing",
          g1["b"]["art"].get("musketeer") is None, str(g1["b"]["art"]))
    check("#AAA's own marks: knight and barbarian barrel as heroes",
          g1["a"]["art"] == {"knight": "hero", "barbarian-barrel": "hero"}, str(g1["a"]["art"]))
    check("one tracked player's row answers for the opponent too",
          d2["games"][1]["b"]["art"].get("knight") == "evolution", str(d2["games"][1]["b"]))
    check("and for themselves", d2["games"][0]["a"]["art"].get("archers") == "evolution")
    check("a duel with no battles row is drawn from what its cards can be, and says so",
          all(g[s].get("artInferred") for g in d3["games"] for s in ("a", "b") if g[s].get("art")),
          str(d3["games"][0]["a"]))
    check("the marks lookup rides the time index, not the tag index",
          any("idx_battles_time" in r[3] for r in sqlite3.connect(BOT).execute(
              "EXPLAIN QUERY PLAN SELECT player_tag FROM battles "
              "WHERE battle_time = ? AND +player_tag IN (?, ?)", ("x", "a", "b"))))

    print("\n-- The card filter --")
    hog = df.report(90, ["hog-rider"])
    check("one card: every duel where a deck holds it",
          hog["total"] == 4 and hog["cards"] == ["hog-rider"], str(hog["total"]))
    check("and only those", all(
        any("hog-rider" in g[s]["cards"] for g in d["games"] for s in ("a", "b"))
        for d in hog["duels"]))
    check("the whole window is still reported beside the filtered total",
          hog["windowDuels"] == 5 and hog["windowGames"] == 11)
    check("`giant` is the Giant, not the Royal Giant",
          df.report(90, ["giant"])["total"] == 2 and df.report(90, ["royal-giant"])["total"] == 3,
          f"{df.report(90, ['giant'])['total']} {df.report(90, ['royal-giant'])['total']}")
    check("two cards: ONE deck must hold both",
          df.report(90, ["hog-rider", "valkyrie"])["total"] == 4
          and df.report(90, ["giant", "graveyard"])["total"] == 2)
    check("two cards in two different decks of one duel do not match",
          # D1 holds Hog Rider (#BBB, game 1) and Golem (#AAA, game 2).
          df.report(90, ["hog-rider", "golem"])["total"] == 0)
    check("nor in the two decks of one game",
          # D1 game 1 is Bait against Hog.
          df.report(90, ["goblin-barrel", "hog-rider"])["total"] == 0)
    check("a filter narrows inside the window it is asked for",
          df.report(30, ["hog-rider"])["total"] == 2, str(df.report(30, ["hog-rider"])["total"]))
    check("an unknown key is dropped, and the accepted list is echoed",
          df.report(90, ["hog-rider", "not-a-card", "HOG-RIDER"])["cards"] == ["hog-rider"])
    check("a filter of only unknown keys is no filter",
          df.report(90, ["'; DROP TABLE games--"])["total"] == 5)
    check("and the table is still there", df.report(90)["total"] == 5)
    check("a card nobody fielded is an empty page, not an error",
          df.report(90, ["sparky"])["total"] == 0 and df.report(90, ["sparky"])["duels"] == [])
    sql, args = di._holds(["giant", "poison"])
    check("the filter is bound, and matched on whole keys",
          args == [",giant,", ",poison,"] * 2 and "giant" not in sql and "instr" in sql, sql)

    print("\n-- Paging --")
    p1, p2, p3 = (df.report(90, per=2, page=n) for n in (1, 2, 3))
    check("two a page over five duels is three pages",
          (p1["pages"], p1["perPage"]) == (3, 2) and len(p3["duels"]) == 1)
    check("the pages do not overlap and miss nothing",
          [d["id"] for p in (p1, p2, p3) for d in p["duels"]] == ids)
    check("a page past the end is clamped, and says which page it answered",
          df.report(90, per=2, page=99)["page"] == 3)
    check("page zero and junk are page one",
          df.report(90, page=0)["page"] == 1 and df.report(90, page="x")["page"] == 1)
    check("a page is capped", df.report(90, per=5000)["perPage"] == df.MAX_PER_PAGE
          and df.report(90, per=0)["perPage"] == 1)
    f1, f2 = df.report(90, ["hog-rider"], per=3, page=1), df.report(90, ["hog-rider"], per=3, page=2)
    check("a filtered list pages the same way",
          f1["pages"] == 2 and len(f1["duels"]) == 3 and len(f2["duels"]) == 1
          and not {d["id"] for d in f1["duels"]} & {d["id"] for d in f2["duels"]})

    print("\n-- The plan --")
    con = sqlite3.connect(IDX)
    check("the build created the feed's index",
          "games_duel" in [r[1] for r in con.execute("PRAGMA index_list(games)")])
    plan = [r[3] for r in con.execute(
        "EXPLAIN QUERY PLAN " + di._DUEL_GROUP.format(match="") + " LIMIT 20 OFFSET 0",
        (stamp(89, "000000"),))]
    check("a page walks the index", any("games_duel" in p for p in plan), str(plan))
    check("and sorts nothing", not any("TEMP B-TREE" in p for p in plan), str(plan))
    match, margs = di._holds(["hog-rider"])
    plan = [r[3] for r in con.execute(
        "EXPLAIN QUERY PLAN " + di._DUEL_GROUP.format(match=match) + " LIMIT 20 OFFSET 0",
        (stamp(89, "000000"), *margs))]
    check("a filtered page too, so it can stop at its last row",
          any("games_duel" in p for p in plan) and not any("TEMP B-TREE" in p for p in plan),
          str(plan))
    con.close()

    print("\n-- What is remembered, and for how long --")
    FEED = di._feed["items"]
    FEED.clear()
    df.report(90, ["hog-rider"])
    key = next(k for k in FEED if k[1] == ("hog-rider",))
    check("a small filtered answer keeps its duels", FEED[key]["ids"] is not None
          and len(FEED[key]["ids"]) == 4)
    keep = di.FEED_KEEP_IDS
    di.FEED_KEEP_IDS = 2
    FEED.clear()
    big1 = df.report(90, ["hog-rider"], per=2, page=1)
    key = next(k for k in FEED if k[1] == ("hog-rider",))
    check("a large one keeps only its count", FEED[key]["ids"] is None and FEED[key]["total"] == 4)
    big2 = df.report(90, ["hog-rider"], per=2, page=2)
    check("and still pages correctly from it",
          [d["id"] for d in big1["duels"] + big2["duels"]] == [d["id"] for d in hog["duels"]])
    di.FEED_KEEP_IDS = keep
    # A new duel arrives. Nothing remembered may outlive it.
    T7 = stamp(0, "230000")
    store(bot, "#EEE", "CW_Duel_1v1",
          payload(T7, "#EEE", "#BBB", [rnd(HOG, 3), rnd(GIANT, 3)],
                  [rnd(BAIT, 0), rnd(GOLEM, 0)]))
    bot.commit()
    rebuild()
    after = df.report(90)
    check("a new duel is counted at once", after["total"] == 6 and after["windowGames"] == 13,
          f"{after['total']} {after['windowGames']}")
    check("and leads the list", after["duels"][0]["battleTime"] == T7)
    check("the remembered filter count moved with it",
          df.report(90, ["hog-rider"])["total"] == 5)

    print("\n-- With no index --")
    di.PATH = os.path.join(TMP, "absent.db")
    di._state["checked"] = 0.0
    none = df.report(30, ["hog-rider"], page=4)
    check("no index is a state, not an error",
          none["available"] is False and none["duels"] == [] and none["total"] == 0
          and none["page"] == 1 and none["pages"] == 1)
    check("and it still says what was asked", none["days"] == 30 and none["cards"] == ["hog-rider"])
    di.PATH = IDX
    di._state["checked"] = 0.0
    check("and it is served again when the index is back", df.report(30)["available"] is True)

    print("\n-- Names, batched --")
    check("many names in one read", cd.player_names(["#AAA", "#BBB", "#NONAME", "", None])
          == {"#AAA": "Alpha", "#BBB": "Bravo"})
    check("no tags asks nothing", cd.player_names([]) == {})

    print("\n-- The route --")
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.py"),
               encoding="utf-8").read()
    a = src.index('if path == "/api/analytics/admin/duels":')
    block = src[a:src.index("if path", a + 10)]
    check("it is behind the admin gate", "admin_auth.verify(" in block
          and block.index("admin_auth.verify(") < block.index("duel_feed.report("))
    check("it enrols nobody", "_note_tag" not in block and "_enrol(" not in block)
    check("the window is validated, not passed through", "duel_feed.valid_days(" in block)

    bot.close()
finally:
    cd._tier_paths = _orig_tiers
    di.PATH = _orig_path
    dcx_mod.seeds, dcx_mod._load_snapshot = _orig_seeds, _orig_dload
    meta_mod.board, meta_mod._load_snapshot = _orig_board, _orig_mload
    for keeper in list(cd._KEEPERS.values()):
        try:
            keeper.close()
        except Exception:  # noqa: BLE001
            pass
    cd._KEEPERS.clear()
    shutil.rmtree(TMP, ignore_errors=True)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
