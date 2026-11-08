"""duo_friendly.py — CLAN FRIENDLY 2v2: the 50 most-played deck pairs for each
win condition, over the last 30 days.

ASKED FOR (2026-11-08): "the decks are not updated and useless, ranked decks
only are there — we need friendly battle 2v2 decks", then "we just want in-clan
friendly 2v2, and we just need 50 decks for each win condition".

WHY A SECOND COLLECTION, NOT A FILTER ON THE FIRST. The game stores ranked 2v2
and clan friendly 2v2 under ONE mode string, `TeamVsTeam`. What tells them
apart is the payload's `type`: `trail` for the 2v2 ladder, `clanMate2v2` for a
friendly against clanmates (measured 2026-11-08: 17,859 vs 533 payloads in one
day). `duo_pairs` folds both into one count since July, so a friendly pair
needed hundreds of battles to reach a board ranked by all-time ladder counts —
none did, and the board was months-old ladder decks.

WHAT IS KEPT, AND WHY IT IS BOUNDED BY TIME. One row per (battle, side) in
`df_side` for `WINDOW_DAYS` (30), deduplicated by `duo_pairs.battle_identity`
(a battle stored under four tracked players is ONE battle). ~800 sides a day,
so ~25k rows. The board, `df_board`, is rebuilt from that window on every run:
for each canonical win condition (`duo_retention.win_conditions`, the bot's own
map), the `PER_WIN_CONDITION` most-played pairs. A pair is filed under each of
its decks' win conditions. A ranking over a rolling window is what keeps the
decks current; an all-time count is what made the old board stale.

HOW BATTLES ARRIVE. `duo_pairs._stage` hands each 2v2 payload it reads to
`sides_for` and flushes the result through `record` in the same transaction as
its own staging rows. Sharing that read means sharing its cursor, and the raw
2v2 purge deletes only behind that cursor — so a friendly payload cannot be
purged before it is recorded here.

Raw 2v2 is kept ~1-2 days behind the fold, so there is no older friendly
history to recover: the window fills from the day this shipped.
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

#: The payload `type` of a friendly 2v2 against clanmates.
FRIENDLY_TYPE = "clanmate2v2"

#: The label stored as a pair's `mode`.
MODE = "clanMate2v2"

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
#: deck, a handed deck). A clan friendly 2v2 can be played in those modes; its
#: decks are not what anybody brings, so they stay out.
_NOT_OWN = ("eventdeck", "classicdecks", "mirrordeck", "pickmode", "draft",
            "all_random", "crazy", "heist", "capturetheegg", "training")


def is_clan_friendly(payload: dict, game_mode: str = "") -> bool:
    """A friendly 2v2 against clanmates, played with the players' own decks."""
    if (payload.get("type") or "").strip().lower() != FRIENDLY_TYPE:
        return False
    mode = (game_mode or (payload.get("gameMode") or {}).get("name") or "").lower()
    if mode.startswith("rr_"):
        return False
    return not any(w in mode for w in _NOT_OWN)


def sides_for(payload: dict, battle_id: str, battle_time: str, pairs) -> list[tuple]:
    """The `df_side` rows for one payload's already-read pairs.

    `pairs` is what `duo_pairs.pairs_from_payload` yielded for it, so the deck
    reading (and its refusals) is the collection's own, not a second copy.
    """
    out = []
    for side, fp_a, fp_b, deck_a, deck_b, tags, pair_fp in pairs:
        out.append((battle_id, side, battle_time or "", pair_fp, fp_a, fp_b,
                    json.dumps(deck_a), json.dumps(deck_b), json.dumps(tags)))
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
        """
    )


def _meta_get(con, key: str, default: str = "") -> str:
    row = con.execute("SELECT v FROM df_meta WHERE k = ?", (key,)).fetchone()
    return row[0] if row else default


def _meta_set(con, key: str, value) -> None:
    con.execute("INSERT INTO df_meta(k, v) VALUES(?, ?) "
                "ON CONFLICT(k) DO UPDATE SET v = excluded.v", (key, str(value)))


def record(con, rows) -> int:
    """Store friendly sides. `INSERT OR IGNORE` on (battle, side) is the
    deduplication. Does not commit — the caller's transaction does."""
    if not rows:
        return 0
    ensure(con)
    before = con.total_changes
    con.executemany(
        "INSERT OR IGNORE INTO df_side (battle_id, side, battle_time, pair_fp, "
        "deck_a_fp, deck_b_fp, deck_a, deck_b, tags) VALUES (?,?,?,?,?,?,?,?,?)",
        rows,
    )
    added = con.total_changes - before
    if added and not _meta_get(con, "collecting_since"):
        _meta_set(con, "collecting_since", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    return added


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


def refresh(con=None, now: datetime.datetime | None = None) -> dict:
    """Drop sides older than the window and rebuild the board from the rest."""
    import duo_pairs as dp
    import duo_retention as dr

    own = con is None
    if own:
        dp._ensure()
        con = dp._connect()
    try:
        ensure(con)
        cut = cutoff(now)
        dropped = con.execute("DELETE FROM df_side WHERE battle_time < ?", (cut,)).rowcount
        rows = con.execute(
            "SELECT pair_fp, battle_time, deck_a_fp, deck_b_fp, deck_a, deck_b, tags "
            "FROM df_side").fetchall()
        board = build_board([tuple(r) for r in rows], dr.win_conditions)
        con.execute("DELETE FROM df_board")
        con.executemany("INSERT INTO df_board VALUES (?,?,?,?,?,?,?,?,?,?,?)", board)
        battles = con.execute("SELECT COUNT(DISTINCT battle_id) FROM df_side").fetchone()[0]
        _meta_set(con, "built_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        _meta_set(con, "window_from", cut)
        _meta_set(con, "battles", battles)
        _meta_set(con, "sides", len(rows))
        con.commit()
        return {"window": cut, "dropped": dropped, "sides": len(rows),
                "battles": battles, "boardRows": len(board),
                "pairs": len({r[1] for r in board}),
                "winConditions": len({r[0] for r in board})}
    finally:
        if own:
            con.close()


def backfill(hours: int = 72) -> dict:
    """Record the clan friendly 2v2 still in `battle_raw` (the purge keeps
    ~1-2 days). Read-only on the bot's file; idempotent."""
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
                if not is_clan_friendly(payload, gm or ""):
                    continue
                bid = dp.battle_identity(payload)
                if not bid:
                    continue
                kept += 1
                pairs = [(s, a, b, da, db, t, dp.pair_fingerprint(a, b))
                         for s, a, b, da, db, t in dp.pairs_from_payload(payload)]
                batch.extend(sides_for(payload, bid, bt or "", pairs))
            if batch:
                added += record(con, batch)
                con.commit()
                batch = []
    finally:
        src.close()
        con.close()
    return {"duoPayloadsRead": read, "friendlyPayloads": kept, "sidesAdded": added}


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
    """One page of the clan friendly board. `win_condition` empty = every win
    condition's top pairs together (each pair once)."""
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
                ("built_at", "window_from", "battles", "sides", "collecting_since")}
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
    return {
        "kind": "friendly",
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
            "battles": int(meta["battles"] or 0),
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
    ap.add_argument("--backfill", action="store_true",
                    help="record the clan friendly 2v2 still in battle_raw")
    ap.add_argument("--hours", type=int, default=72)
    ap.add_argument("--refresh", action="store_true",
                    help="drop sides past the window and rebuild the board")
    ap.add_argument("--show", type=int, default=0, metavar="N")
    opts = ap.parse_args()
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
    if not (opts.backfill or opts.refresh or opts.show):
        ap.print_help()
