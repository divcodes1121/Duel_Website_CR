"""duel_index: native duel payloads in, per-deck duel records out.

Runs against a synthetic bot database in a temp directory; nothing touches the
real one.

    python server/test_duel_index.py
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clash_data as cd  # noqa: E402
import duel_combos as dx  # noqa: E402
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
HOG_N = [c if c != "valkyrie" else "tesla" for c in HOG]          # one card off, still Hog
HOG_X = [c if c != "hog-rider" else "royal-giant" for c in HOG]   # one card off, NOT Hog
MORTAR = ["mortar", "rascals", "cannon-cart", "goblins", "minions",
          "skeleton-barrel", "barbarian-barrel", "arrows"]
BAIT = ["goblin-barrel", "goblin-gang", "princess", "rocket", "knight",
        "inferno-tower", "ice-spirit", "the-log"]
GOLEM = ["golem", "night-witch", "lumberjack", "baby-dragon", "lightning",
         "tornado", "mega-minion", "zap"]

ID = {k: int(dx.card_info(k).get("id") or 0) for k in
      set(HOG + HOG_N + HOG_X + MORTAR + BAIT + GOLEM)}
check("every test card is in the catalogue with an id", all(ID.values()),
      str([k for k, v in ID.items() if not v]))


def rnd(deck, crowns, bad=False):
    cards = [{"id": ID[k]} for k in deck]
    if bad:
        cards[0] = {"id": 99999999}
    return {"cards": cards, "crowns": crowns}


def payload(bt, ta, tb, ra, rb):
    return {"battleTime": bt, "team": [{"tag": ta, "rounds": ra}],
            "opponent": [{"tag": tb, "rounds": rb}]}


def day(n):
    """A battle time `n` days before 2026-09-20."""
    import datetime
    d = datetime.date(2026, 9, 20) - datetime.timedelta(days=n)
    return d.strftime("%Y%m%d") + "T120000.000Z"


def gw(rec):
    """Games and wins of a record, without the players' expected result."""
    return list(rec[:2]) if rec else rec


# HERMETIC HUBS. The version-cell stage reads the counter snapshot's seeds and
# the meta board; left alone it would load this checkout's real snapshot files.
# No seeds and no board until the section that sets its own.
import deck_counter as dcx_mod  # noqa: E402
import meta as meta_mod  # noqa: E402

_orig_seeds, _orig_dload = dcx_mod.seeds, dcx_mod._load_snapshot
_orig_board, _orig_mload = meta_mod.board, meta_mod._load_snapshot
dcx_mod.seeds = lambda: {}
dcx_mod._load_snapshot = lambda: None
meta_mod.board = lambda: {"decks": []}
meta_mod._load_snapshot = lambda: None

TMP = tempfile.mkdtemp(prefix="duelidx-")
BOT = os.path.join(TMP, "bot.db")
IDX = os.path.join(TMP, "duel.db")
_orig_tiers = cd._tier_paths
_orig_path = di.PATH
cd._tier_paths = lambda: [BOT]
di.PATH = IDX

stamp_n = [0]


def insert(con, tag, mode, pl):
    stamp_n[0] += 1
    con.execute("INSERT INTO battle_raw VALUES (?,?,?,?,?)",
                (tag, pl["battleTime"], mode, f"2026-09-20 00:{stamp_n[0]:05d}",
                 json.dumps(pl)))


try:
    bot = sqlite3.connect(BOT)
    bot.execute("CREATE TABLE battle_raw(player_tag TEXT, battle_time TEXT, "
                "game_mode TEXT, stored_at TEXT, raw_json TEXT)")
    bot.execute("CREATE INDEX ix_raw_stored ON battle_raw(stored_at)")

    # Twelve duels: four pilots on Mortar+Hog against twelve different
    # opponents on Bait+Golem. Mortar wins 9 of 12, Hog 6 of 12.
    for i in range(12):
        p, o = f"#P{i % 4}", f"#O{i:02d}"
        ra = [rnd(MORTAR, 3 if i < 9 else 0), rnd(HOG, 2 if i % 2 == 0 else 1)]
        rb = [rnd(BAIT, 0 if i < 9 else 1), rnd(GOLEM, 1 if i % 2 == 0 else 2)]
        pl = payload(day(i % 5), p, o, ra, rb)
        insert(bot, p, "CW_Duel_1v1", pl)
        # Duel 0 is ALSO stored under the opponent, sides swapped.
        if i == 0:
            insert(bot, o, "CW_Duel_1v1",
                   payload(day(0), o, p, rb, ra))
    # A one-card Hog variant, and a one-card variant that is not Hog.
    insert(bot, "#P9", "Duel_1v1_Friendly",
           payload(day(1), "#P9", "#Q1", [rnd(HOG_N, 3)], [rnd(GOLEM, 0)]))
    insert(bot, "#P8", "CW_Duel_1v1",
           payload(day(1), "#P8", "#Q2", [rnd(HOG_X, 3)], [rnd(GOLEM, 0)]))
    # Outside the 60-day window (kept, not counted), and past retention (deleted).
    insert(bot, "#P0", "CW_Duel_1v1",
           payload(day(70), "#P0", "#Q3", [rnd(MORTAR, 0)], [rnd(BAIT, 3)]))
    insert(bot, "#P0", "CW_Duel_1v1",
           payload(day(500), "#P0", "#Q4", [rnd(MORTAR, 0)], [rnd(BAIT, 3)]))
    # Not native duels: ignored, rounds or not.
    insert(bot, "#P0", "Ladder",
           payload(day(0), "#P0", "#Q5", [rnd(MORTAR, 3)], [rnd(BAIT, 0)]))
    insert(bot, "#P0", "Friendly",
           payload(day(0), "#P0", "#Q6", [rnd(MORTAR, 3)], [rnd(BAIT, 0)]))
    bot.commit()

    print("\n-- games_of --")
    pl = payload(day(0), "#Z", "#A", [rnd(HOG, 3)], [rnd(BAIT, 1)])
    pid, rows, why = di.games_of(pl, "CW_Duel_1v1")
    check("stored from the lexically first tag's side",
          pid.endswith("|#A|#Z") and rows[0][4] == "#A" and rows[0][6] == di.deck_key(BAIT))
    check("and the winner follows the swap", rows[0][10] == 2, str(rows[0]))
    pid2, rows2, _ = di.games_of(payload(day(0), "#A", "#Z", [rnd(BAIT, 1)], [rnd(HOG, 3)]),
                                 "CW_Duel_1v1")
    check("both participants' copies are byte-identical", pid == pid2 and rows == rows2)
    _, rows, why = di.games_of(payload(day(0), "#A", "#Z", [rnd(HOG, 1)], [rnd(BAIT, 1)]),
                               "CW_Duel_1v1")
    check("level crowns are kept with winner 0", rows[0][10] == 0)
    _, rows, why = di.games_of(payload(day(0), "#A", "#Z", [rnd(HOG, 3, bad=True)],
                                       [rnd(BAIT, 1)]), "CW_Duel_1v1")
    check("an unknown card drops the game and says why",
          rows == [] and why.get("unknown_card") == 1, str(why))
    check("no rounds is named", di.games_of({"battleTime": "t", "team": [{"tag": "#A"}],
                                             "opponent": [{"tag": "#B"}]}, "x")[2]
          == {"no_rounds": 1})

    print("\n-- The plan --")
    mem = sqlite3.connect(":memory:")
    mem.execute("CREATE TEMP TABLE sides(deck TEXT, tag TEXT, opp TEXT, won INTEGER, exp REAL)")
    mem.execute("CREATE TABLE deck_new(id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, "
                "wc TEXT NOT NULL)")
    plan = [r[3] for r in mem.execute("EXPLAIN QUERY PLAN " + di.DECK_WC_SELECT)]
    first = next((p for p in plan if p.startswith(("SCAN", "SEARCH"))), "")
    check("the aggregate SCANS sides first", first.startswith("SCAN s"), str(plan))
    check("and looks each deck up by its key",
          sum(1 for p in plan if p.startswith("SEARCH") and "key=?" in p) == 2, str(plan))

    print("\n-- Building --")
    out = di.build(IDX, BOT)
    ing = out["ingest"]
    check("native duels only: 12 + 1 copy + 2 variants + 2 old = 17 payloads",
          ing["payloads"] == 17, str(ing))
    check("the copy under the opponent is folded", ing["duplicates"] == 1, str(ing))
    check("24 + 2 + 2 games ingested, the 500-day one then pruned",
          ing["newGames"] == 28 and out["pruned"] == 1 and out["games"] == 27, str(out))
    check("the window holds 26 (the 70-day game is outside it)",
          out["windowGames"] == 26, str(out))
    check("the watermark is the top of battle_raw", ing["watermark"] ==
          bot.execute("SELECT MAX(stored_at) FROM battle_raw").fetchone()[0])
    st = di.status()
    check("status reports a usable build", st["available"] and st["games"] == 27
          and st["windowDays"] == di.WINDOW_DAYS, str(st))

    r = di.records(MORTAR)
    check("Mortar's exact record against Bait: 9 of 12",
          gw(r["exact"].get("bait")) == [12, 9], str(r["exact"]))
    check("the out-of-window loss is not in it", r["exact"]["bait"][0] == 12)

    rec = di.records(MORTAR)["exact"]["bait"]
    check("every record carries the players' expected result",
          len(rec) == 3 and 0 < rec[2] < rec[0], str(rec))
    check("its archetype is the shared classifier's", r["archetype"] == "mortar")
    r = di.records(HOG)
    check("Hog's exact record against Golem: 6 of 12", gw(r["exact"].get("golem")) == [12, 6])
    check("near adds the one-card Hog variant, not the Royal Giant one",
          gw(r["near"].get("golem")) == [13, 7], str(r["near"]))
    r = di.records(HOG_N)
    check("a variant with one game of its own still sees its neighbourhood",
          gw(r["exact"].get("golem")) == [1, 1] and gw(r["near"].get("golem")) == [13, 7], str(r))
    unseen = [c if c != "musketeer" else "archers" for c in HOG]
    r = di.records(unseen)
    check("a list the duels never saw has no exact record but real neighbours",
          r["exact"] == {} and gw(r["near"].get("golem")) == [12, 6], str(r))
    check("and a list two cards away is not one of them", r["neighbours"] == 1, str(r))
    check("a non-deck asks nothing", di.records(["hog-rider"]) is None)

    cat = {d["key"]: d for d in di.catalogue()}
    check("the catalogue holds the four decks with 10+ games and 3+ pilots",
          set(cat) == {di.deck_key(d) for d in (MORTAR, HOG, BAIT, GOLEM)}, str(list(cat)))
    check("its rungs arrive precomputed", cat[di.deck_key(MORTAR)]["records"]["exact"]
          .get("bait")[:2] == [12, 9])

    decks = {d["key"]: d for d in di.player_decks("#P0")}
    check("a player's own duel decks, their own counts",
          decks[di.deck_key(MORTAR)]["games"] == 4 and decks[di.deck_key(HOG)]["games"] == 3,
          str({k[:12]: v["games"] for k, v in decks.items()}))
    windowed = {d["key"]: d for d in di.player_decks("#P0", since=di.iso_to_stamp("2026-09-01"))}
    check("and inside a window, only that window", windowed[di.deck_key(MORTAR)]["games"] == 3)
    check("their win conditions", di.player_wcs("#O00") == {"bait": 1, "golem": 1},
          str(di.player_wcs("#O00")))
    check("a stranger has none", di.player_decks("#NOBODY") == [])

    # PER-GAME RESULTS (`player_results`) — what a `battles` row cannot say
    # about a native duel, and what the duel read's record with a deck is
    # counted from. Keyed by the duel's own stamp and the deck.
    res = di.player_results("#P0")
    won = [v for (_bt, k), v in res.items() if k == di.deck_key(MORTAR)]
    check("each of a player's duel games has its own result, by duel and deck",
          len(won) == decks[di.deck_key(MORTAR)]["games"]
          and sum(won) == decks[di.deck_key(MORTAR)]["wins"], f"{len(won)} {sum(won)}")
    check("...inside a window, only that window",
          len(di.player_results("#P0", since=di.iso_to_stamp("2026-09-01"))) < len(res))
    check("a stranger has no results", di.player_results("#NOBODY") == {})

    # EVERY LIST HOLDING A CARD (`decks_holding`) — the deck architect's
    # evidence. The whole `deck` table, which is far more than the catalogue.
    holding = di.decks_holding(["hog-rider"], min_games=1)
    hk = [d["key"] for d in holding]
    check("every duel list holding a card comes back, catalogue or not",
          di.deck_key(HOG) in hk and len(hk) > sum(1 for k in cat if "hog-rider" in k.split(",")),
          str(len(hk)))
    check("each really holds it", all("hog-rider" in d["cards"] and len(d["cards"]) == 8 for d in holding))
    check("most-played first", [d["games"] for d in holding] == sorted((d["games"] for d in holding), reverse=True))
    check("it carries the record and who flew it",
          all({"games", "wins", "players", "topPilot", "archetype"} <= set(d) for d in holding)
          and holding[0]["games"] >= holding[0]["wins"] >= 0 and holding[0]["players"] >= 1)
    check("a floor on games is applied",
          all(d["games"] >= 3 for d in di.decks_holding(["hog-rider"], min_games=3)))
    both = di.decks_holding(["hog-rider", "musketeer"], min_games=1)
    check("two cards: only lists holding BOTH",
          both and all({"hog-rider", "musketeer"} <= set(d["cards"]) for d in both))
    rg = di.decks_holding(["royal-giant"], min_games=1)
    check("`giant` does not match royal-giant: membership is checked on the cards, not the text",
          di.decks_holding(["giant"], min_games=1) == [] and
          (not rg or all("giant" not in d["cards"] for d in rg)), str(len(rg)))
    check("no card, or a card nobody fielded, is an empty answer",
          di.decks_holding([]) == [] and di.decks_holding(["three-musketeers"], min_games=1) == [])

    print("\n-- Incremental --")
    insert(bot, "#P1", "CW_Duel_1v1",
           payload(day(0).replace("T12", "T13"), "#P1", "#O99",
                   [rnd(MORTAR, 3), rnd(HOG, 3, bad=True)], [rnd(BAIT, 0), rnd(GOLEM, 0)]))
    bot.commit()
    out = di.build(IDX, BOT)
    check("the next run reads only what arrived", out["ingest"]["payloads"] == 1
          and out["ingest"]["newGames"] == 1, str(out["ingest"]))
    check("an unknown card holds the watermark below it",
          out["ingest"]["blockedAt"] and out["ingest"]["watermark"] < out["ingest"]["blockedAt"],
          str(out["ingest"]))
    di._state["checked"] = 0.0
    check("and the new game is in the records", gw(di.records(MORTAR)["exact"]["bait"]) == [13, 10])
    out = di.build(IDX, BOT)
    check("a held watermark re-reads the payload, and the key folds it",
          out["ingest"]["payloads"] == 1 and out["ingest"]["newGames"] == 0, str(out["ingest"]))

    print("\n-- Another database --")
    cd._tier_paths = lambda: [os.path.join(TMP, "someone-else.db")]
    di._state["checked"] = 0.0
    check("an index of another database is not served", not di.available()
          and di.records(MORTAR) is None and di.catalogue() == []
          and di.decks_holding(["hog-rider"], min_games=1) == [])
    cd._tier_paths = lambda: [BOT]
    di._state["checked"] = 0.0
    check("and is served again for its own", di.available())

    print("\n-- Version cells --")
    check("a build with no seeds writes no version cells, and says so",
          out.get("versionCells") is None and di.status()["versionCells"] is None,
          str(out.get("versionCells")))
    k = di.deck_key
    BAIT_N = [c if c != "knight" else "valkyrie" for c in BAIT]            # one card off Bait
    BAIT_2 = [c if c not in ("knight", "rocket") else
              ("valkyrie" if c == "knight" else "poison") for c in BAIT]   # two cards off
    STRAY_A = ["x-bow", "tesla", "archers", "knight", "the-log", "electro-spirit",
               "skeletons", "fireball"]
    STRAY_B = ["lava-hound", "balloon", "minions", "mega-minion", "arrows",
               "inferno-dragon", "tombstone", "zap"]
    dcx_mod.seeds = lambda: {"bait": [{"cards": BAIT}], "golem": [{"cards": GOLEM}]}
    out = di.build(IDX, BOT)
    check("threat hubs but no ladder table: the stage is skipped, the build is not",
          out.get("versionCells") is None and di.available(), str(out.get("versionCells")))
    bot.execute("CREATE TABLE pair_matchup_agg(deck_a TEXT, deck_b TEXT, a_wins INTEGER, "
                "a_losses INTEGER, a_draws INTEGER, games INTEGER, PRIMARY KEY (deck_a, deck_b))")
    ladder = [
        (MORTAR, BAIT, 20, 10),      # Mortar 20-10 against Bait itself
        (BAIT_N, MORTAR, 7, 3),      # stored the other way round: Mortar 3-7 against a Bait variant
        (BAIT_2, MORTAR, 0, 50),     # two cards off Bait: NOT Bait's family
        (HOG, BAIT, 8, 12),          # Hog 8-12 against Bait
        (HOG_N, BAIT, 9, 3),         # a Hog variant 9-3 against Bait
        (GOLEM, BAIT_N, 6, 2),       # Golem 6-2 against a Bait variant
        (STRAY_A, STRAY_B, 40, 40),  # two lists no hub is near
    ]
    bot.executemany("INSERT INTO pair_matchup_agg VALUES (?,?,?,?,0,?)",
                    [(k(a), k(b), w, l, w + l) for a, b, w, l in ladder])
    bot.commit()
    out = di.build(IDX, BOT)
    vs = out.get("versionCells") or {}
    check("hubs are the catalogue plus the seeds; threats are the seeds",
          vs.get("hubs") == 4 and vs.get("threats") == 2, str(vs))
    di._state["checked"] = 0.0
    st = di.status()
    check("status publishes the version cells",
          st["versionHubs"] == 4 and st["versionThreats"] == 2 and st["versionCells"] == vs.get("cells"),
          str(st))
    check("a catalogue list is a candidate hub", di.is_version_hub(MORTAR))
    check("a list nobody hubs is not", not di.is_version_hub(STRAY_A))
    check("a list that is not a THREAT hub has no cells to be scored against",
          di.version_cells(MORTAR) is None)
    vb = di.version_cells(BAIT)
    mb = vb.get(k(MORTAR)) if vb else None
    check("Mortar vs Bait's family: Bait 20-10 plus the variant 3-7, not the list two cards off",
          mb is not None and mb[0] == 40 and mb[1] == 23, str(mb))
    check("Mortar's family vs Bait exactly: 20-10", mb is not None and mb[2] == 30 and mb[3] == 20,
          str(mb))
    hb = vb.get(k(HOG)) if vb else None
    check("Hog vs Bait's family: 8-12", hb is not None and hb[0] == 20 and hb[1] == 8, str(hb))
    check("Hog's family vs Bait: Hog 8-12 plus its variant 9-3",
          hb is not None and hb[2] == 32 and hb[3] == 17, str(hb))
    gb = vb.get(k(GOLEM)) if vb else None
    check("Golem vs Bait's family counts the variant it beat 6-2",
          gb is not None and gb[0] == 8 and gb[1] == 6 and gb[2] == 0, str(gb))
    vg = di.version_cells(GOLEM)
    bg = vg.get(k(BAIT)) if vg else None
    check("Bait's family vs Golem: the Bait variant lost 2-6, from Bait's side",
          bg is not None and bg[2] == 8 and bg[3] == 2, str(bg))
    # The duels: every Mortar-Bait game in the window (13, with the one the
    # incremental section added), Hog beat Golem 6 of 12, and the two Hog
    # variants won their single games against Golem.
    # (A record rounds its expected result to 2 dp; a cell sums it unrounded,
    # so the two agree to within that rounding, not to the last digit.)
    rm = di.records(MORTAR)["exact"]["bait"]
    check("Mortar's duels vs Bait's family: every window game, pilot-adjusted wins",
          mb is not None and rm[0] == 13 and mb[4] == rm[0]
          and abs(mb[5] - (rm[0] / 2 + rm[1] - rm[2])) < 0.01, f"{mb} {rm}")
    check("and the same games as Mortar's family vs Bait", mb is not None and mb[6] == mb[4]
          and abs(mb[7] - mb[5]) < 1e-6, str(mb))
    hg = vg.get(k(HOG)) if vg else None
    r_h = di.records(HOG)["exact"]["golem"]
    r_n = di.records(HOG_N)["exact"]["golem"]
    r_x = di.records(HOG_X)["exact"]["golem"]
    want = (6 + 6 - r_h[2]) + (0.5 + 1 - r_n[2]) + (0.5 + 1 - r_x[2])
    check("Hog's family vs Golem in duels: Hog's 12 and both one-card variants' single games",
          hg is not None and hg[6] == 14 and abs(hg[7] - want) < 0.02, str(hg))
    check("while Hog alone vs Golem's family is its own 12",
          hg is not None and hg[4] == 12, str(hg))
    check("no cell anywhere names a list no hub is near",
          all(k(STRAY_A) not in (di.version_cells(t) or {}) for t in (BAIT, GOLEM)))
    rebuilt = di.build(IDX, BOT)
    di._state["checked"] = 0.0
    check("a rebuild gives the same cells", (rebuilt.get("versionCells") or {}).get("cells")
          == vs.get("cells") and (di.version_cells(BAIT) or {}).get(k(MORTAR)) == mb)
    dcx_mod.seeds = lambda: {}

    print("\n-- Pilot strength --")
    # One pilot who wins every duel, with both decks, against ten opponents
    # who lose every game. Their X-Bow deck is 10-0 — and the index must
    # record that the two PLAYERS predicted most of that.
    XBOW = ["x-bow", "tesla", "archers", "knight", "the-log", "electro-spirit",
            "skeletons", "fireball"]
    LAVA = ["lava-hound", "balloon", "minions", "mega-minion", "arrows",
            "inferno-dragon", "tombstone", "zap"]
    PEKKA = ["pekka", "battle-ram", "bandit", "royal-ghost", "electro-wizard",
             "magic-archer", "poison", "barbarian-barrel"]
    GY = ["graveyard", "baby-dragon", "ice-wizard", "tornado", "bowler",
          "giant-snowball", "guards", "mega-knight"]
    more = {k: int(dx.card_info(k).get("id") or 0) for k in set(XBOW + LAVA + PEKKA + GY)}
    check("the pilot scenario's cards are all known", all(more.values()),
          str([k for k, v in more.items() if not v]))
    ID.update(more)
    BOT2 = os.path.join(TMP, "bot2.db")
    IDX2 = os.path.join(TMP, "duel2.db")
    b2 = sqlite3.connect(BOT2)
    b2.execute("CREATE TABLE battle_raw(player_tag TEXT, battle_time TEXT, "
               "game_mode TEXT, stored_at TEXT, raw_json TEXT)")
    b2.execute("CREATE INDEX ix_raw_stored ON battle_raw(stored_at)")
    for i in range(10):
        insert(b2, "#ACE", "CW_Duel_1v1",
               payload(day(i % 5).replace("T12", f"T1{i}"), "#ACE", f"#W{i}",
                       [rnd(XBOW, 3), rnd(LAVA, 3)], [rnd(PEKKA, 0), rnd(GY, 0)]))
    b2.commit()
    cd._tier_paths = lambda: [BOT2]
    di.PATH = IDX2
    di._state["checked"] = 0.0
    di.build(IDX2, BOT2)
    opp_wc = di.classify(di.deck_key(PEKKA))
    rec = di.records(XBOW)["exact"][opp_wc]
    # ACE on X-Bow is rated on their Lava games (10/10 -> 20/30); each
    # opponent on P.E.K.K.A on their other game (0/1 -> 10/21); log5 of those
    # is 0.6875 a game.
    check("a pilot who wins everything carries a high expectation",
          gw(rec) == [10, 10] and abs(rec[2] - 6.875) <= 0.01, str(rec))
    import duel_brain as dbr  # noqa: E402
    r = dbr.rung(di.records(XBOW), opp_wc)
    check("so their 10-0 is judged as ~81% against an equal opponent, not 100%",
          abs(r["adjusted"] - 81.2) <= 0.1 and r["raw"] == 100.0, str(r))
    k = dbr.DUEL_PRIOR_GAMES
    check("and the printed figure is that record shrunk toward 50/50",
          abs(r["winRate"] - 100 * (8.12 + k / 2) / (10 + k)) <= 0.1, str(r))
    b2.close()
    cd._tier_paths = lambda: [BOT]

    bot.close()
finally:
    cd._tier_paths = _orig_tiers
    di.PATH = _orig_path
    dcx_mod.seeds, dcx_mod._load_snapshot = _orig_seeds, _orig_dload
    meta_mod.board, meta_mod._load_snapshot = _orig_board, _orig_mload
    shutil.rmtree(TMP, ignore_errors=True)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
