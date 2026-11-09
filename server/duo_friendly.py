"""duo_friendly.py — TOP PLAYERS' 2v2: the 50 most-played deck pairs for each
win condition, over the last 30 days.

SECOND ROUND (2026-11-09): "the 2v2 decks right now are useless and not that
good, I want just top players' 2v2 decks". Measured first, on 3 days of raw:
the 2v2 battle carries nothing that says who is good (league always 1, no
global rank, trophies on 25 of 134,000 players), so a TOP PLAYER comes from
outside 2v2: the live Path of Legends top 1,000 (`top_decks.live_board`,
re-read on every refresh) plus the CRL group (`.duel_cohorts.json`). Top
players play little clan friendly 2v2 (180 of ~2,060 sides in 3 days, nearly
every pair once) and a lot of ranked 2v2 (758 sides, pairs repeated up to 23
times), so — the account holder's choice — the board reads BOTH: every ranked
or clan friendly 2v2 side where at least one of the two teammates was a top
player when it was recorded. A side is judged once, at recording, against the
top set of that hour; the set itself is replaced only when the board was read.

FIRST ROUND (2026-11-08): "the decks are not updated and useless, ranked decks
only are there", then "just in-clan friendly 2v2, 50 decks for each win
condition". The game stores ranked 2v2 and clan friendly 2v2 under ONE mode
string, `TeamVsTeam`; the payload's `type` tells them apart (`trail` for the
2v2 ladder, `clanMate2v2` for a friendly against clanmates). `duo_pairs` folds
everything into one all-time count since July, which is what made the old
board stale.

WHAT IS KEPT. One row per (battle, side) in `df_side` for `WINDOW_DAYS` (30),
deduplicated by `duo_pairs.battle_identity` (a battle stored under four tracked
players is ONE battle). The board, `df_board`, is rebuilt from that window on
every run: for each canonical win condition (`duo_retention.win_conditions`,
the bot's own map), the `PER_WIN_CONDITION` most-played pairs. A pair is filed
under each of its decks' win conditions.

HOW BATTLES ARRIVE. `duo_pairs._stage` hands each 2v2 payload it reads to
`sides_for` and flushes the result through `record` in the same transaction as
its own staging rows. Sharing that read means sharing its cursor, and the raw
2v2 purge deletes only behind that cursor — so a payload cannot be purged
before it is judged here. Raw 2v2 is kept ~1-2 days behind the fold, so there
is no older history to recover: the window fills from the day this shipped.
"""

from __future__ import annotations

import datetime
import json
import os
import sqlite3
import time

#: The rolling window the board ranks over.
WINDOW_DAYS = int(os.getenv("CLASH_DUO_FRIENDLY_DAYS", "30"))

#: Pairs kept per win condition. The account holder's number.
PER_WIN_CONDITION = int(os.getenv("CLASH_DUO_FRIENDLY_PER_WC", "50"))

#: How many of the live Path of Legends board count as top players.
TOP_BOARD = int(os.getenv("CLASH_DUO_TOP_BOARD", "1000"))

#: The payload `type` of a friendly 2v2 against clanmates, and of ranked 2v2.
FRIENDLY_TYPE = "clanmate2v2"
RANKED_TYPE = "trail"

#: The label stored as a pair's `mode`.
MODE = "top-2v2"

PER_PAGE = 25
MAX_PER_PAGE = 200

#: Keys into a closed map, never column names.
SORTS = {
    "played": "games DESC, last_seen DESC, pair_fp",
    "recent": "last_seen DESC, games DESC, pair_fp",
    "first": "first_seen ASC, games DESC, pair_fp",
}
DEFAULT_SORT = "played"

#: Mode words that mean the decks are not the players' own (a draft, an event
#: deck, a handed deck). Those decks are not what anybody brings.
_NOT_OWN = ("eventdeck", "classicdecks", "mirrordeck", "pickmode", "draft",
            "all_random", "crazy", "heist", "capturetheegg", "training")


def kind_of(payload: dict, game_mode: str = "") -> str | None:
    """'ranked' / 'friendly' for a 2v2 played with the players' own decks,
    None for anything else."""
    t = (payload.get("type") or "").strip().lower()
    kind = {RANKED_TYPE: "ranked", FRIENDLY_TYPE: "friendly"}.get(t)
    if not kind:
        return None
    mode = (game_mode or (payload.get("gameMode") or {}).get("name") or "").lower()
    if mode.startswith("rr_") or any(w in mode for w in _NOT_OWN):
        return None
    return kind


def is_clan_friendly(payload: dict, game_mode: str = "") -> bool:
    """A friendly 2v2 against clanmates, played with the players' own decks."""
    return kind_of(payload, game_mode) == "friendly"


def sides_for(payload: dict, battle_id: str, battle_time: str, pairs,
              kind: str = "friendly", top=None) -> list[tuple]:
    """The `df_side` rows for one payload's already-read pairs.

    `pairs` is what `duo_pairs.pairs_from_payload` yielded for it, so the deck
    reading (and its refusals) is the collection's own, not a second copy.
    With `top` (a set of tags) only a side where at least one of the two
    teammates is in it is kept — an EMPTY set keeps nothing, never everyone.
    """
    out = []
    for side, fp_a, fp_b, deck_a, deck_b, tags, pair_fp in pairs:
        if top is not None and not any(_norm(t) in top for t in tags):
            continue
        out.append((battle_id, side, battle_time or "", pair_fp, fp_a, fp_b,
                    json.dumps(deck_a), json.dumps(deck_b), json.dumps(tags), kind))
    return out


# --------------------------------------------------------------------------
# Storage (inside the collection's own file, `.duo_pairs.db`)
# --------------------------------------------------------------------------

def ensure(con) -> None:
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS df_side (
            battle_id   TEXT NOT NULL,
            side        TEXT NOT NULL,
            battle_time TEXT NOT NULL,
            pair_fp     TEXT NOT NULL,
            deck_a_fp   TEXT NOT NULL,
            deck_b_fp   TEXT NOT NULL,
            deck_a      TEXT NOT NULL,
            deck_b      TEXT NOT NULL,
            tags        TEXT NOT NULL DEFAULT '[]',
            PRIMARY KEY (battle_id, side)
        );
        CREATE INDEX IF NOT EXISTS idx_df_side_time ON df_side(battle_time);

        CREATE TABLE IF NOT EXISTS df_board (
            win_condition TEXT    NOT NULL,
            pair_fp       TEXT    NOT NULL,
            rank          INTEGER NOT NULL,
            games         INTEGER NOT NULL,
            players       INTEGER NOT NULL,
            first_seen    TEXT    NOT NULL,
            last_seen     TEXT    NOT NULL,
            deck_a_fp     TEXT    NOT NULL,
            deck_b_fp     TEXT    NOT NULL,
            deck_a        TEXT    NOT NULL,
            deck_b        TEXT    NOT NULL,
            PRIMARY KEY (win_condition, pair_fp)
        );
        CREATE INDEX IF NOT EXISTS idx_df_board_rank ON df_board(win_condition, rank);

        CREATE TABLE IF NOT EXISTS df_meta (k TEXT PRIMARY KEY, v TEXT);

        -- The top players a side must include to be recorded.
        CREATE TABLE IF NOT EXISTS df_top (tag TEXT PRIMARY KEY);
        """
    )
    # A collection built by the first round has no `kind` column.
    have = {r[1] for r in con.execute("PRAGMA table_info(df_side)")}
    if "kind" not in have:
        con.execute("ALTER TABLE df_side ADD COLUMN kind TEXT NOT NULL DEFAULT 'friendly'")


def _meta_get(con, key: str, default: str = "") -> str:
    row = con.execute("SELECT v FROM df_meta WHERE k = ?", (key,)).fetchone()
    return row[0] if row else default


def _meta_set(con, key: str, value) -> None:
    con.execute("INSERT INTO df_meta(k, v) VALUES(?, ?) "
                "ON CONFLICT(k) DO UPDATE SET v = excluded.v", (key, str(value)))


def record(con, rows) -> int:
    """Store sides. `INSERT OR IGNORE` on (battle, side) is the deduplication.
    Does not commit — the caller's transaction does."""
    if not rows:
        return 0
    ensure(con)
    before = con.total_changes
    con.executemany(
        "INSERT OR IGNORE INTO df_side (battle_id, side, battle_time, pair_fp, "
        "deck_a_fp, deck_b_fp, deck_a, deck_b, tags, kind) VALUES (?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    added = con.total_changes - before
    if added and not _meta_get(con, "collecting_since"):
        _meta_set(con, "collecting_since", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    return added


# --------------------------------------------------------------------------
# Who counts as a top player
# --------------------------------------------------------------------------

def _norm(tag) -> str:
    t = str(tag or "").strip().upper()
    if t and not t.startswith("#"):
        t = "#" + t
    return t


def top_tags(con) -> set[str]:
    """The stored top-player set (`df_top`)."""
    ensure(con)
    return {r[0] for r in con.execute("SELECT tag FROM df_top")}


def fetch_top(get=None, cohorts=None) -> tuple[set[str], dict]:
    """The live Path of Legends top `TOP_BOARD` and the CRL group. `get` and
    `cohorts` are injectable for tests. Never raises; a part that cannot be
    read comes back empty and is reported."""
    board, crl = [], set()
    try:
        import top_decks
        if get is None:
            import recruit
            get = recruit._get
        board = [t for t in (_norm(x) for x in top_decks.live_board(get, TOP_BOARD)) if t]
    except Exception:  # noqa: BLE001
        board = []
    try:
        if cohorts is None:
            import duel_read_train as drt
            cohorts = drt.load_cohorts()
        crl = {t for t in (_norm(x) for x in ((cohorts or {}).get("crl") or ())) if t}
    except Exception:  # noqa: BLE001
        crl = set()
    return set(board) | crl, {"board": len(board), "crl": len(crl)}


def set_top(con, tags, info: dict) -> dict:
    """Replace the stored top set — ONLY when the board was read. A failed read
    keeps the last set, so one bad hour does not empty the collection."""
    ensure(con)
    if not info.get("board"):
        n = con.execute("SELECT COUNT(*) FROM df_top").fetchone()[0]
        return {"kept": True, "players": n, **info}
    con.execute("DELETE FROM df_top")
    con.executemany("INSERT OR IGNORE INTO df_top(tag) VALUES (?)", [(t,) for t in tags])
    _meta_set(con, "top_board", info.get("board", 0))
    _meta_set(con, "top_crl", info.get("crl", 0))
    _meta_set(con, "top_players", len(set(tags)))
    _meta_set(con, "top_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    return {"kept": False, "players": len(set(tags)), **info}


# --------------------------------------------------------------------------
# The board
# --------------------------------------------------------------------------

def _stamp(dt: datetime.datetime) -> str:
    """A `battle_time`-shaped stamp (`20261108T102014.000Z`), so a window
    boundary compares as a string against stored battle times."""
    return dt.strftime("%Y%m%dT%H%M%S.000Z")


def cutoff(now: datetime.datetime | None = None, days: int = WINDOW_DAYS) -> str:
    now = now or datetime.datetime.now(datetime.timezone.utc)
    return _stamp(now - datetime.timedelta(days=days))


def build_board(rows, win_conditions, per: int = PER_WIN_CONDITION) -> list[tuple]:
    """Pure: `rows` = (pair_fp, battle_time, deck_a_fp, deck_b_fp, deck_a,
    deck_b, tags_json) for every side in the window. Returns `df_board` rows,
    top `per` pairs for each win condition by games, newest last battle on a
    tie, then fingerprint so the order is stable."""
    pairs: dict[str, dict] = {}
    for fp, bt, fa, fb, da, db, tg in rows:
        p = pairs.get(fp)
        if p is None:
            p = pairs[fp] = {"games": 0, "first": bt, "last": bt, "fa": fa,
                             "fb": fb, "da": da, "db": db, "tags": set()}
        p["games"] += 1
        if bt < p["first"]:
            p["first"] = bt
        if bt > p["last"]:
            p["last"] = bt
        try:
            p["tags"].update(json.loads(tg or "[]"))
        except Exception:  # noqa: BLE001
            pass
    buckets: dict[str, list] = {}
    for fp, p in pairs.items():
        for wc in win_conditions(p["da"], p["db"]):
            buckets.setdefault(wc, []).append((fp, p))
    out = []
    for wc, items in buckets.items():
        items.sort(key=lambda it: it[0])
        items.sort(key=lambda it: it[1]["last"], reverse=True)
        items.sort(key=lambda it: it[1]["games"], reverse=True)
        for rank, (fp, p) in enumerate(items[:per], start=1):
            out.append((wc, fp, rank, p["games"], len(p["tags"]), p["first"],
                        p["last"], p["fa"], p["fb"], p["da"], p["db"]))
    return out


def refresh(con=None, now: datetime.datetime | None = None, fetch: bool = True,
            get=None, cohorts=None) -> dict:
    """Re-read the top players, drop sides older than the window and rebuild
    the board from the rest."""
    import duo_pairs as dp
    import duo_retention as dr

    own = con is None
    if own:
        dp._ensure()
        con = dp._connect()
    try:
        ensure(con)
        top = set_top(con, *fetch_top(get, cohorts)) if fetch else None
        cut = cutoff(now)
        dropped = con.execute("DELETE FROM df_side WHERE battle_time < ?", (cut,)).rowcount
        rows = con.execute(
            "SELECT pair_fp, battle_time, deck_a_fp, deck_b_fp, deck_a, deck_b, tags "
            "FROM df_side").fetchall()
        board = build_board([tuple(r) for r in rows], dr.win_conditions)
        con.execute("DELETE FROM df_board")
        con.executemany("INSERT INTO df_board VALUES (?,?,?,?,?,?,?,?,?,?,?)", board)
        battles = con.execute("SELECT COUNT(DISTINCT battle_id) FROM df_side").fetchone()[0]
        kinds = dict(con.execute(
            "SELECT kind, COUNT(DISTINCT battle_id) FROM df_side GROUP BY kind").fetchall())
        _meta_set(con, "built_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        _meta_set(con, "window_from", cut)
        _meta_set(con, "battles", battles)
        _meta_set(con, "battles_ranked", kinds.get("ranked", 0))
        _meta_set(con, "battles_friendly", kinds.get("friendly", 0))
        _meta_set(con, "sides", len(rows))
        con.commit()
        return {"top": top, "window": cut, "dropped": dropped, "sides": len(rows),
                "battles": battles, "byKind": kinds, "boardRows": len(board),
                "pairs": len({r[1] for r in board}),
                "winConditions": len({r[0] for r in board})}
    finally:
        if own:
            con.close()


def reset() -> dict:
    """Empty the sides and the board (the top set stays)."""
    import duo_pairs as dp
    dp._ensure()
    con = dp._connect()
    try:
        ensure(con)
        n = con.execute("DELETE FROM df_side").rowcount
        con.execute("DELETE FROM df_board")
        con.commit()
        return {"sidesDeleted": n}
    finally:
        con.close()


def backfill(hours: int = 72, get=None, cohorts=None) -> dict:
    """Record the top players' 2v2 still in `battle_raw` (the purge keeps
    ~1-2 days). Reads the top set first. Read-only on the bot's file;
    idempotent."""
    import clash_data as cd
    import battle_modes as bm
    import duo_pairs as dp

    dp._card_map()
    path = cd.resolve_db_path()
    if not path:
        raise RuntimeError("no readable database")
    since = (datetime.datetime.now(datetime.timezone.utc)
             - datetime.timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%S")
    src = sqlite3.connect("file:{}?mode=ro".format(path), uri=True, timeout=30)
    dp._ensure()
    con = dp._connect()
    read = kept = added = 0
    try:
        ensure(con)
        top_info = set_top(con, *fetch_top(get, cohorts))
        con.commit()
        top = top_tags(con)
        # TWO PASSES: the mode first (raw_json is the last column, so this
        # never reads the big payloads), then the JSON of the 2v2 rows only.
        ids = [rid for rid, gm in src.execute(
            "SELECT rowid, game_mode FROM battle_raw WHERE stored_at > ?", (since,))
            if bm.is_duo(gm or "")]
        batch = []
        for i in range(0, len(ids), 500):
            part = ids[i:i + 500]
            chunk = src.execute(
                "SELECT game_mode, battle_time, raw_json FROM battle_raw WHERE rowid IN "
                "({})".format(",".join("?" * len(part))), part).fetchall()
            for gm, bt, rj in chunk:
                read += 1
                try:
                    payload = json.loads(rj or "{}")
                except Exception:  # noqa: BLE001
                    continue
                kind = kind_of(payload, gm or "")
                if not kind:
                    continue
                bid = dp.battle_identity(payload)
                if not bid:
                    continue
                kept += 1
                pairs = [(s, a, b, da, db, t, dp.pair_fingerprint(a, b))
                         for s, a, b, da, db, t in dp.pairs_from_payload(payload)]
                batch.extend(sides_for(payload, bid, bt or "", pairs, kind, top))
            if batch:
                added += record(con, batch)
                con.commit()
                batch = []
    finally:
        src.close()
        con.close()
    return {"top": top_info, "duoPayloadsRead": read, "ownDeckPayloads": kept,
            "sidesAdded": added}


# --------------------------------------------------------------------------
# Reading it
# --------------------------------------------------------------------------

def _cards() -> dict[str, str]:
    """A card to draw on each win condition's chip: the first card the bot's
    own map files under it. `other` has none."""
    try:
        import deck_counter as dcx
        out = {}
        for card, wc in dcx.WIN_CONDITION_MAP.items():
            out.setdefault(wc, card)
        return out
    except Exception:  # noqa: BLE001
        return {}


def _labels() -> dict[str, str]:
    try:
        import deck_counter as dcx
        return {wc: dcx._label(wc) for wc in _all_win_conditions()}
    except Exception:  # noqa: BLE001
        return {}


def _all_win_conditions() -> tuple[str, ...]:
    try:
        import duo_retention as dr
        return dr.all_win_conditions()
    except Exception:  # noqa: BLE001
        return ()


def report(page: int = 1, per: int = PER_PAGE, sort: str = DEFAULT_SORT,
           cards=(), win_condition: str = "") -> dict:
    """One page of the board. `win_condition` empty = every win condition's
    top pairs together (each pair once)."""
    import duo_pairs as dp

    dp._ensure()
    per = max(1, min(MAX_PER_PAGE, per))
    sort = sort if sort in SORTS else DEFAULT_SORT
    picked = dp.valid_cards(cards)
    known = _all_win_conditions()
    wc = (win_condition or "").strip().lower()
    if wc not in known:
        wc = ""
    con = dp._connect()
    try:
        ensure(con)
        if wc:
            base = ("SELECT pair_fp, games, players, first_seen, last_seen, deck_a_fp, "
                    "deck_b_fp, deck_a, deck_b FROM df_board WHERE win_condition = ?")
            base_args = [wc]
        else:
            base = ("SELECT pair_fp, MAX(games) games, MAX(players) players, "
                    "MIN(first_seen) first_seen, MAX(last_seen) last_seen, deck_a_fp, "
                    "deck_b_fp, deck_a, deck_b FROM df_board GROUP BY pair_fp")
            base_args = []
        where, args = "", []
        if picked:
            # Every picked card in ONE deck; quoted so `giant` is not every giant.
            side = lambda col: " AND ".join("{} LIKE ?".format(col) for _ in picked)  # noqa: E731
            where = " WHERE (({}) OR ({}))".format(side("deck_a"), side("deck_b"))
            args = ['%"{}"%'.format(c) for c in picked] * 2
        sql = "SELECT * FROM (" + base + ")" + where
        total = con.execute("SELECT COUNT(*) FROM (" + sql + ")",
                            (*base_args, *args)).fetchone()[0]
        pages = max(1, -(-total // per))
        page = max(1, min(pages, page))
        rows = con.execute(sql + " ORDER BY " + SORTS[sort] + " LIMIT ? OFFSET ?",
                           (*base_args, *args, per, (page - 1) * per)).fetchall()
        counts = dict(con.execute(
            "SELECT win_condition, COUNT(*) FROM df_board GROUP BY win_condition").fetchall())
        board_pairs = con.execute("SELECT COUNT(DISTINCT pair_fp) FROM df_board").fetchone()[0]
        meta = {k: _meta_get(con, k) for k in
                ("built_at", "window_from", "battles", "battles_ranked", "battles_friendly",
                 "sides", "collecting_since", "top_board", "top_crl", "top_players")}
        oldest = con.execute("SELECT MIN(battle_time), MAX(battle_time) FROM df_side").fetchone()
    finally:
        con.close()

    seat = dp._seater()
    labels = _labels()
    out_rows = []
    for r in rows:
        row = {
            "pair_fingerprint": r["pair_fp"], "mode": MODE,
            "deck_a_fingerprint": r["deck_a_fp"], "deck_b_fingerprint": r["deck_b_fp"],
            "deck_a_cards": r["deck_a"], "deck_b_cards": r["deck_b"],
            "occurrences": r["games"], "distinct_players": r["players"],
            "player_tags": "[]", "first_seen": r["first_seen"],
            "last_seen": r["last_seen"], "source_modes": "TeamVsTeam",
        }
        out_rows.append(dp._pair_row(row, seat))
    chip_cards = _cards()
    wcs = [{"key": k, "label": labels.get(k, k), "pairs": counts.get(k, 0),
            "card": chip_cards.get(k)} for k in known]
    wcs.sort(key=lambda w: (w["key"] == "other", w["label"].lower()))
    num = lambda k: int(meta[k] or 0)  # noqa: E731
    return {
        "kind": "top",
        "pairs": out_rows,
        "page": page,
        "pages": pages,
        "perPage": per,
        "total": total,
        "query": "",
        "cards": picked,
        "sort": sort,
        "sorts": sorted(SORTS),
        "winCondition": wc,
        "winConditions": wcs,
        "perWinCondition": PER_WIN_CONDITION,
        "windowDays": WINDOW_DAYS,
        "summary": {
            "mode": MODE,
            "built": bool(meta["built_at"]),
            "builtAt": meta["built_at"],
            "uniquePairs": board_pairs,
            "battles": num("battles"),
            "battlesRanked": num("battles_ranked"),
            "battlesFriendly": num("battles_friendly"),
            "topBoard": num("top_board"),
            "topCrl": num("top_crl"),
            "topPlayers": num("top_players"),
            "firstSeen": (oldest[0] if oldest else "") or "",
            "lastSeen": (oldest[1] if oldest else "") or "",
            "collectingSince": meta["collecting_since"],
            "windowFrom": meta["window_from"],
        },
    }


if __name__ == "__main__":
    import argparse
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--reset", action="store_true",
                    help="empty the recorded sides and the board first")
    ap.add_argument("--backfill", action="store_true",
                    help="record the top players' 2v2 still in battle_raw")
    ap.add_argument("--hours", type=int, default=72)
    ap.add_argument("--refresh", action="store_true",
                    help="re-read the top players, drop old sides, rebuild the board")
    ap.add_argument("--show", type=int, default=0, metavar="N")
    opts = ap.parse_args()
    if opts.reset:
        print(json.dumps(reset(), indent=1))
    if opts.backfill:
        print(json.dumps(backfill(opts.hours), indent=1))
    if opts.refresh:
        print(json.dumps(refresh(), indent=1))
    if opts.show:
        rep = report(per=opts.show)
        print(json.dumps({k: v for k, v in rep.items() if k != "pairs"}, indent=1))
        for p in rep["pairs"]:
            print("{:>5}x  {} + {}".format(p["occurrences"], ",".join(p["deckA"]["cardKeys"]),
                                           ",".join(p["deckB"]["cardKeys"])))
    if not (opts.reset or opts.backfill or opts.refresh or opts.show):
        ap.print_help()
