"""duel_index.py — every native duel GAME, and what each deck did in them.

The evidence behind `duel_brain.py`. That module decides; this one counts.

WHY IT EXISTS (2026-09-27)
==========================

Every recommendation on the site so far is scored on `pair_matchup_agg`: ranked
and ladder 1v1, one battle a row. A native duel is a different game in the way
that matters for a deck recommendation — three card-disjoint decks, chosen
against a known opponent — and the people who duel seriously play a wider and
stronger set of lists than the ladder does. What wins THERE is evidence nothing
on the site had read.

It exists in the database, one level down. A native duel is stored in `battles`
as a single 16- or 24-card loadout with no per-game result (which is why every
8-card consumer drops it), but its raw payload in `battle_raw` carries
`team[0].rounds[i]` and `opponent[0].rounds[i]`: each game's eight cards and
crowns, for BOTH players. Measured on 2026-09-27 over the whole table:

    unique duels                137,427   (8,761 duplicate copies folded)
    games                       332,723   every one decisive, none unreadable
    distinct decks              360,748   3,411 with 10+ games
    win conditions                   17   286 of 289 pairings with 30+ games
    span              2026-06-01 .. now   87% since 1 August

WHAT IT STORES
==============

`games` — one row per duel GAME, both decks, who won it. Append-only, deduped on
the duel's own identity (its `battleTime` plus both tags, the rule `duo_pairs`
uses for 2v2), so a duel stored under two tracked players is one duel.

Rebuilt on every run, from `games` inside the evidence window:

    deck      (id, key, wc, games, wins, players)      every list seen
    deck_wc   (deck, opp_wc, games, wins)              its record per opponent win condition
    sub7      (h, deck)                                 its eight 7-card subsets, hashed
    catalogue (deck, rec)                               decks worth offering, rungs precomputed

`sub7` is what makes "this list or one card away from it" an index read: two
lists share seven cards exactly when they share a 7-card subset, so a deck's
neighbours are the decks behind its eight subset hashes.

WHAT IT MUST NOT DO
===================

* **Write to the bot's database.** It reads `battle_raw` through
  `clash_data.connect` (`mode=ro`); the only file written is this module's own
  (`CLASH_DUEL_INDEX`, default `server/.duel_index.db`, gitignored).
* **Serve another database's numbers.** `meta.source` records which database
  was read, and a reader uses the index only while that is the database the
  site resolves — the `cluster_index` rule.
* **Be required.** Missing or mismatched, every reader returns None/empty and
  Team Analysis ranks exactly as it did before, with the duel brain reporting
  itself unavailable.
* **Guess at a mode.** `duel_combos.is_native_duel` is the allowlist the whole
  site and the bot share. It FAILS SAFE: a new mode string containing "duel" is
  not sliced into games on an assumption about a serialisation nobody has
  inspected.
"""
from __future__ import annotations

import calendar
import datetime
import hashlib
import json
import os
import sqlite3
import sys
import threading
import time
from collections import OrderedDict

import clash_data as cd

PATH = os.getenv(
    "CLASH_DUEL_INDEX",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".duel_index.db"),
)

#: The file format. A reader refuses one it does not know. 2: every record
#: carries the players' expected result beside games and wins.
FORMAT = "2"

#: Days of games the records are counted over, back from the newest game
#: STORED — not from today, the site-wide convention, so a stalled collector
#: shows as an old window rather than as an empty one.
#:
#: SIXTY. The duel meta moves with every balance change and a season's new
#: card (Minion Giant landed on 2026-09-07); a record from four months ago is
#: evidence about a game that has since changed. Sixty days held ~290,000 of
#: the 332,723 games on the day it was set, so the window costs little
#: evidence today and keeps the answer current as the table grows.
WINDOW_DAYS = 60

#: Games older than this are deleted from `games`. The player-deck reads take
#: the caller's own window (up to Team Analysis's 90-day preset), so the table
#: has to outlive the evidence window; 400 days is `meta_history`'s figure.
RETAIN_DAYS = 400

#: A deck enters the CATALOGUE — the decks the brain may offer somebody who
#: does not play them — at this many games in the window, from at least this
#: many different pilots. Three pilots, because one player's streak with a
#: pet list is not a deck the population wins with; ten games, because under
#: it no single win condition can reach a rung. Measured: 2,601 decks qualify.
CATALOGUE_MIN_GAMES = 10
CATALOGUE_MIN_PLAYERS = 3

#: ...and no single pilot may hold more than this share of its games. A
#: strong player's pet list wins because of who flies it; three pilots of whom
#: one played 90% of the games is that, with two passers-by attached.
CATALOGUE_MAX_PILOT_SHARE = 0.5

#: Cards shared for a list to count as the same deck one card off.
NEAR_OVERLAP = 7

#: How often a reader looks for a newer build (one meta read).
RELOAD_CHECK_S = 60.0

#: Payload rows fetched per batch; JSON is ~3 kB a row.
READ_BATCH = 2000

#: Rows written per insert batch.
WRITE_BATCH = 50_000

#: Deck records kept in memory between requests, per build.
RECORD_CACHE = 4096

#: Refusals that may succeed on a later run — a card this deployment's
#: `cards.json` predates. The watermark is held at the first one, the rule
#: `duo_pairs` learned when Minion Giant shipped a commit ahead of the host.
RETRYABLE = ("unknown_card",)

#: Opponent lists whose family matches are remembered during one build of the
#: version cells. A popular opponent turns up in hundreds of hubs' histories,
#: and its eight subsets need looking up once, not once per hub.
VCELL_MATCH_CACHE = 400_000

#: Threat hubs whose version cells a reader keeps in memory, per build.
VCELL_CACHE = 512


def _dcx():
    # Imported late: `deck_counter` is heavy and only the classifier is needed.
    import deck_counter as dcx
    return dcx


def _dx():
    import duel_combos as dx
    return dx


def _duo():
    # The one raw-payload card reader on the site (`deck_and_reason`). A second
    # would drift from it — the tower troop in `supportCards`, unknown ids.
    import duo_pairs as duo
    return duo


def _brain():
    # The pilot rating and log5 live with the rest of the arithmetic, in the
    # module with no imports, where they are tested against literals.
    import duel_brain
    return duel_brain


def _uri(path: str, mode: str) -> str:
    return "file:" + path.replace("\\", "/") + f"?mode={mode}"


def _norm(path: str | None) -> str:
    return os.path.normcase(os.path.abspath(path)) if path else ""


def deck_key(cards) -> str:
    """The order-free identity of a list — `team_scout.deck_key`'s rule."""
    return ",".join(sorted(set(cards or [])))


def classify(key: str) -> str:
    """A deck's win condition, straight off its key.

    `deck_counter._archetype_of_hash`, THE SAME FUNCTION `cluster_index` and
    the matchup ladder label opponents with, so a duel record against "hog" and
    a ladder record against "hog" are records against the same thing. Measured
    against the bot's own stored labels: 1,433 of 1,433 decks agree.
    """
    return _dcx()._archetype_of_hash(key)


def sub7_hashes(key: str) -> list[int]:
    """The eight 7-card subsets of a deck, each hashed to a signed 64-bit int.

    blake2b and not `hash()`: Python salts `hash()` per process, and the
    builder and the readers are different processes.
    """
    cards = key.split(",")
    out = []
    for i in range(len(cards)):
        sub = ",".join(cards[:i] + cards[i + 1:])
        out.append(int.from_bytes(
            hashlib.blake2b(sub.encode("utf-8"), digest_size=8).digest(),
            "big", signed=True))
    return out


def _stamp(day: datetime.date, end: bool = False) -> str:
    """A date in the stored `battleTime` format, so strings compare in order."""
    return day.strftime("%Y%m%d") + ("T235959.999Z" if end else "T000000.000Z")


def _day_of(battle_time: str) -> datetime.date | None:
    try:
        return datetime.datetime.strptime(battle_time[:8], "%Y%m%d").date()
    except (TypeError, ValueError):
        return None


def iso_to_stamp(iso: str | None, end: bool = False) -> str | None:
    """`2026-09-26` -> `20260926T000000.000Z` (or the day's last instant)."""
    if not iso:
        return None
    try:
        return _stamp(datetime.date.fromisoformat(iso[:10]), end)
    except ValueError:
        return None


# ── Reading one payload ─────────────────────────────────────────────────────


def games_of(payload: dict, mode: str) -> tuple[str | None, list[tuple], dict[str, int]]:
    """`(duel id, [game rows], refusals)` for one native duel payload.

    STORED FROM THE LEXICALLY FIRST TAG'S SIDE, so the copy saved under each
    tracked participant produces byte-identical rows and the primary key folds
    them. A game whose crowns are level is kept with winner 0 — none have been
    seen (a duel tiebreak takes a tower), and it is counted rather than assumed.

    A row is `(gid, battle_time, mode, round, a_tag, b_tag, a_deck, b_deck,
    a_crowns, b_crowns, winner)`, winner 1 = a, 2 = b, 0 = level.
    """
    problems: dict[str, int] = {}
    try:
        a = payload["team"][0]
        b = payload["opponent"][0]
    except (KeyError, IndexError, TypeError):
        return None, [], {"no_participants": 1}
    ta, tb = a.get("tag") or "", b.get("tag") or ""
    bt = payload.get("battleTime") or ""
    if not ta or not tb or not bt:
        return None, [], {"no_identity": 1}
    if tb < ta:
        a, b, ta, tb = b, a, tb, ta
    pid = f"{bt}|{ta}|{tb}"
    ra, rb = a.get("rounds") or [], b.get("rounds") or []
    if not ra or not rb:
        return pid, [], {"no_rounds": 1}
    duo = _duo()
    rows = []
    for i in range(min(len(ra), len(rb))):
        da, why_a = duo.deck_and_reason(ra[i])
        db, why_b = duo.deck_and_reason(rb[i])
        if why_a or why_b:
            for why in (why_a, why_b):
                if why:
                    k = why.split(":")[0]
                    problems[k] = problems.get(k, 0) + 1
            continue
        ca, cb = int(ra[i].get("crowns") or 0), int(rb[i].get("crowns") or 0)
        winner = 0 if ca == cb else (1 if ca > cb else 2)
        rows.append((f"{pid}|{i}", bt, mode, i, ta, tb, ",".join(da), ",".join(db),
                     ca, cb, winner))
    return pid, rows, problems


# ── Building ────────────────────────────────────────────────────────────────


def _ensure(con: sqlite3.Connection) -> None:
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS games(
            gid         TEXT PRIMARY KEY,
            battle_time TEXT NOT NULL,
            mode        TEXT NOT NULL,
            round       INTEGER NOT NULL,
            a_tag       TEXT NOT NULL,
            b_tag       TEXT NOT NULL,
            a_deck      TEXT NOT NULL,
            b_deck      TEXT NOT NULL,
            a_crowns    INTEGER NOT NULL,
            b_crowns    INTEGER NOT NULL,
            winner      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS games_a ON games(a_tag, battle_time);
        CREATE INDEX IF NOT EXISTS games_b ON games(b_tag, battle_time);
        CREATE INDEX IF NOT EXISTS games_time ON games(battle_time);
        """
    )


def _meta(con: sqlite3.Connection) -> dict[str, str]:
    try:
        return {k: v for k, v in con.execute("SELECT k, v FROM meta")}
    except sqlite3.Error:
        return {}


def _native_modes_sql() -> tuple[str, list[str]]:
    """`lower(game_mode) IN (...)` built FROM the allowlist, so it cannot drift."""
    modes = sorted(_dx().NATIVE_DUEL_MODES)
    return "lower(game_mode) IN (" + ",".join("?" for _ in modes) + ")", modes


def _ingest(con: sqlite3.Connection, src: sqlite3.Connection, since: str | None) -> dict:
    """Read new duel payloads into `games`. Returns what happened.

    TWO QUERIES, AND THE DIFFERENCE IS WHICH INDEX EXISTS — `duo_pairs._stage`'s
    arrangement. The first run filters on `game_mode`, which has no index, so it
    is one scan of `battle_raw` (~4 minutes on the VPS). Every later run reads
    `stored_at > watermark` through `ix_raw_stored`, an index range over a few
    hours of polling.

    THE TOP IS READ FIRST. `stored_at` is the ARRIVAL time, set at insert, so
    everything that arrives during this run lands above `top` and is the next
    run's. The watermark becomes `top` — every row at or below it has been
    examined — unless a retryable refusal holds it lower.
    """
    where, modes = _native_modes_sql()
    top = src.execute("SELECT MAX(stored_at) m FROM battle_raw").fetchone()["m"] or ""
    if since:
        sql = ("SELECT game_mode, stored_at, raw_json FROM battle_raw "
               f"WHERE stored_at > ? AND stored_at <= ? AND {where} ORDER BY stored_at")
        args = [since, top, *modes]
    else:
        sql = f"SELECT game_mode, stored_at, raw_json FROM battle_raw WHERE {where}"
        args = list(modes)

    payloads = duplicates = unreadable = new_games = 0
    seen: set[str] = set()
    problems: dict[str, int] = {}
    blocked_at: str | None = None
    batch: list[tuple] = []

    def flush() -> int:
        before = con.total_changes
        con.execute("BEGIN")
        con.executemany(
            "INSERT OR IGNORE INTO games VALUES (?,?,?,?,?,?,?,?,?,?,?)", batch)
        con.execute("COMMIT")
        return con.total_changes - before

    cur = src.execute(sql, args)
    while True:
        chunk = cur.fetchmany(READ_BATCH)
        if not chunk:
            break
        for r in chunk:
            mode = r["game_mode"] or ""
            if not _dx().is_native_duel(mode):
                continue
            payloads += 1
            try:
                payload = json.loads(r["raw_json"] or "{}")
            except Exception:  # noqa: BLE001 - a corrupt payload is counted, not fatal
                unreadable += 1
                continue
            pid, rows, why = games_of(payload, mode)
            for k, n in why.items():
                problems[k] = problems.get(k, 0) + n
            if pid is None:
                unreadable += 1
                continue
            if pid in seen:
                duplicates += 1
                continue
            seen.add(pid)
            if any(k in RETRYABLE for k in why):
                stamp = r["stored_at"] or ""
                if stamp and (blocked_at is None or stamp < blocked_at):
                    blocked_at = stamp
            batch.extend(rows)
            if len(batch) >= WRITE_BATCH:
                new_games += flush()
                batch = []
    if batch:
        new_games += flush()

    watermark = top
    if blocked_at:
        # THE WATERMARK PROMISES EVERYTHING AT OR BELOW IT WAS READ, so the
        # first payload that might yet resolve caps it. Never below `since`.
        row = src.execute(
            "SELECT MAX(stored_at) m FROM battle_raw WHERE stored_at < ?",
            (blocked_at,)).fetchone()
        capped = (row["m"] if row else None) or ""
        watermark = capped if capped and capped >= (since or "") else (since or "")
    return {"payloads": payloads, "duplicates": duplicates, "unreadable": unreadable,
            "newGames": new_games, "watermark": watermark, "blockedAt": blocked_at,
            "problems": dict(sorted(problems.items()))}


def _records_sql(con: sqlite3.Connection, deck_id: int | None, key: str, wc: str,
                 deck_t: str = "deck", deck_wc_t: str = "deck_wc",
                 sub7_t: str = "sub7") -> dict:
    """A deck's exact and near records, read from the named tables.

    NEAR IS "THIS LIST, OR ONE CARD AWAY, OF THE SAME WIN CONDITION". A swap
    that changes the win condition makes a different kind of deck, and pooling
    it would blur the very distinction the records are keyed on. The list
    itself is part of its own neighbourhood.
    """
    exact: dict[str, list] = {}
    if deck_id is not None:
        for opp, g, w, e in con.execute(
                f"SELECT opp_wc, games, wins, exp FROM {deck_wc_t} WHERE deck = ?",
                (deck_id,)):
            exact[opp] = [int(g), int(w), round(float(e), 2)]

    hs = sub7_hashes(key)
    cards = set(key.split(","))
    ids = []
    for nid, nkey, nwc in con.execute(
            f"SELECT DISTINCT d.id, d.key, d.wc FROM {sub7_t} s "
            f"JOIN {deck_t} d ON d.id = s.deck "
            f"WHERE s.h IN ({','.join('?' for _ in hs)})", hs):
        # The hash only nominates. The overlap is checked on the cards, so a
        # collision can never admit a stranger.
        if nwc == wc and len(cards & set(nkey.split(","))) >= NEAR_OVERLAP:
            ids.append(nid)
    near: dict[str, list] = {}
    for i in range(0, len(ids), 500):
        part = ids[i:i + 500]
        for opp, g, w, e in con.execute(
                f"SELECT opp_wc, SUM(games), SUM(wins), SUM(exp) FROM {deck_wc_t} "
                f"WHERE deck IN ({','.join('?' for _ in part)}) GROUP BY opp_wc", part):
            cur = near.setdefault(opp, [0, 0, 0.0])
            cur[0] += int(g)
            cur[1] += int(w)
            cur[2] += float(e)
    for v in near.values():
        v[2] = round(v[2], 2)
    return {"exact": exact, "near": near, "neighbours": len(ids)}


#: Each deck's record against each opponent win condition, from the temp
#: `sides` table. CROSS JOIN PINS THE JOIN ORDER — scan `sides`, look each deck
#: up by its unique key. Left to the planner, a fresh table with no statistics
#: can be driven the other way round (measured 60x slower on `cluster_index`),
#: and no equality test can see it; `test_duel_index.py` checks the PLAN.
DECK_WC_SELECT = """
SELECT d.id, o.wc, COUNT(*), SUM(s.won), SUM(s.exp)
  FROM sides s
  CROSS JOIN deck_new d
  CROSS JOIN deck_new o
 WHERE d.key = s.deck AND o.key = s.opp
 GROUP BY d.id, o.wc
"""


# ── Version cells (`matchup_fusion`, 2026-09-27) ────────────────────────────
#
# The table behind the fused rate's two VERSION levels:
#
#   family   (V2)  this list  vs  the threat's one-card family
#   version  (V4)  this list's one-card family  vs  the threat exactly
#
# each from the ladder (`pair_matchup_agg`, all time, as every ladder figure on
# the site) and from the duels (this build's window, pilot-adjusted). Both
# levels together took a temporal holdout from 0.6838 to 0.6798 log loss, and
# where the threat is a popular list from 0.6773 to 0.6582 — the whole case is
# in `matchup_fusion`'s docstring.
#
# HUBS, NOT EVERY LIST. Computing either level needs a list's whole opponent
# history, which is a read of the 55 GB file per list: fine off the request
# path for a few thousand lists, impossible on it for every candidate. So the
# table covers the lists that come up on EVERY request:
#
#   candidate hubs  the duel catalogue + every counter-snapshot seed + the meta
#                   board — the population Deckkies picks from
#   threat hubs     the seeds + the board — what the threat projection is built
#                   from, and where the holdout put the gain
#
# A teammate's own list is computed per request by `team_analysis` from its own
# history, which is small; a threat that is nobody's hub gets the archetype
# levels only, which the holdout measured as close to free (0.6864 -> 0.6858).
#
# ONE PASS OVER EACH HUB'S HISTORY FILLS BOTH LEVELS: as a candidate its
# opponents in a threat's family are V2 evidence; as a threat its opponents in
# a candidate's family are V4 evidence for that candidate.


def _subs(key: str) -> list[str]:
    """The eight 7-card subsets of a list, as strings — two lists share seven
    cards exactly when they share one. Strings, not `sub7_hashes`: nothing here
    leaves the build process, and a dict hashes a string for free."""
    cards = key.split(",")
    return [",".join(cards[:i] + cards[i + 1:]) for i in range(len(cards))]


def _version_hubs(catalogue_keys) -> tuple[list[str], set[str]]:
    """`(candidate hubs, threat hubs)`. Threat hubs are a subset of candidates."""
    dcx = _dcx()
    seeds = dcx.seeds() or {}
    if not seeds:
        try:
            dcx._load_snapshot()
            seeds = dcx.seeds() or {}
        except Exception:  # noqa: BLE001 - no snapshot is a smaller table, not a failure
            seeds = {}
    threats = {deck_key(s.get("cards")) for lst in seeds.values() for s in lst
               if len(set(s.get("cards") or [])) == 8}
    try:
        import meta as meta_board
        board = meta_board.board()
        if not board.get("decks"):
            meta_board._load_snapshot()
            board = meta_board.board()
        threats |= {deck_key(d.get("cards")) for d in (board.get("decks") or [])
                    if len(set(d.get("cards") or [])) == 8}
    except Exception:  # noqa: BLE001
        pass
    cands = set(catalogue_keys) | threats
    return sorted(cands), threats


def _history(src: sqlite3.Connection, key: str) -> dict[str, list[int]]:
    """`{opponent list: [games, this list's wins]}` from the ladder, both
    sides of `pair_matchup_agg` folded (a row is stored once, either way round;
    draws are not games here, as in every ladder rate on the site)."""
    out: dict[str, list[int]] = {}
    for opp, w, l in src.execute(
            "SELECT deck_b, a_wins, a_losses FROM pair_matchup_agg WHERE deck_a = ?", (key,)):
        r = out.get(opp)
        if r is None:
            out[opp] = [w + l, w]
        else:
            r[0] += w + l
            r[1] += w
    for opp, w, l in src.execute(
            "SELECT deck_a, a_wins, a_losses FROM pair_matchup_agg WHERE deck_b = ?", (key,)):
        r = out.get(opp)           # stored the other way round: our wins are a_losses
        if r is None:
            out[opp] = [w + l, l]
        else:
            r[0] += w + l
            r[1] += l
    return out


def _build_vcells(con: sqlite3.Connection, source: str, catalogue_keys) -> dict | None:
    """Write `vhub_new` and `vcell_new`. Run while `temp.sides` still holds the
    window's pilot-adjusted duel sides. Returns counts, or None when there is
    nothing to build — no counter snapshot means no threat hubs, and then the
    last build's cells stay rather than being swapped for tables that were
    never written."""
    cands, threats = _version_hubs(catalogue_keys)
    if not cands or not threats:
        return None
    hub_id = {k: i + 1 for i, k in enumerate(cands)}
    cand_by_sub: dict[str, list[int]] = {}
    threat_by_sub: dict[str, list[int]] = {}
    for k, i in hub_id.items():
        for s in _subs(k):
            cand_by_sub.setdefault(s, []).append(i)
            if k in threats:
                threat_by_sub.setdefault(s, []).append(i)

    none = ((), ())
    cache: dict[str, tuple] = {}

    def match(opp: str) -> tuple[tuple, tuple]:
        """`(threat ids whose family holds opp, candidate ids whose family holds opp)`."""
        hit = cache.get(opp)
        if hit is None:
            ts: set[int] = set()
            cs: set[int] = set()
            for s in _subs(opp):
                ts.update(threat_by_sub.get(s, ()))
                cs.update(cand_by_sub.get(s, ()))
            hit = (tuple(ts), tuple(cs)) if ts or cs else none
            if len(cache) < VCELL_MATCH_CACHE:
                cache[opp] = hit
        return hit

    con.execute("DROP TABLE IF EXISTS temp.vparts")
    con.execute("CREATE TEMP TABLE vparts(t INTEGER, c INTEGER, k INTEGER, n REAL, w REAL)")
    parts: list[tuple] = []

    def flush() -> None:
        if parts:
            con.execute("BEGIN")
            con.executemany("INSERT INTO vparts VALUES (?,?,?,?,?)", parts)
            con.execute("COMMIT")
            parts.clear()

    src = cd.connect(source)
    try:
        for key, cid in hub_id.items():
            hist = _history(src, key)
            # V2 — this list against every threat's family.
            acc: dict[int, list[float]] = {}
            for opp, (n, w) in hist.items():
                for tid in match(opp)[0]:
                    a = acc.get(tid)
                    if a is None:
                        acc[tid] = [n, w]
                    else:
                        a[0] += n
                        a[1] += w
            parts.extend((tid, cid, 0, n, w) for tid, (n, w) in acc.items())
            # V4 — every candidate's family against THIS list, when it is a
            # threat: the opponent's wins are this list's losses.
            if key in threats:
                acc = {}
                for opp, (n, w) in hist.items():
                    for c2 in match(opp)[1]:
                        a = acc.get(c2)
                        if a is None:
                            acc[c2] = [n, n - w]
                        else:
                            a[0] += n
                            a[1] += n - w
                parts.extend((cid, c2, 1, n, w) for c2, (n, w) in acc.items())
            if len(parts) >= WRITE_BATCH:
                flush()
    finally:
        src.close()

    # The duels, from this build's window, with who flew them taken out.
    d2: dict[tuple, list[float]] = {}
    d4: dict[tuple, list[float]] = {}
    for deck, opp, won, exp in con.execute("SELECT deck, opp, won, exp FROM sides"):
        adj = 0.5 + won - exp
        cid = hub_id.get(deck)
        if cid is not None:
            for tid in match(opp)[0]:
                a = d2.get((tid, cid))
                if a is None:
                    d2[(tid, cid)] = [1, adj]
                else:
                    a[0] += 1
                    a[1] += adj
        if opp in threats:
            tid = hub_id[opp]
            for c2 in match(deck)[1]:
                a = d4.get((tid, c2))
                if a is None:
                    d4[(tid, c2)] = [1, adj]
                else:
                    a[0] += 1
                    a[1] += adj
    parts.extend((t, c, 2, n, w) for (t, c), (n, w) in d2.items())
    parts.extend((t, c, 3, n, w) for (t, c), (n, w) in d4.items())
    flush()
    del d2, d4, cache

    con.executescript(
        """
        DROP TABLE IF EXISTS vhub_new;
        DROP TABLE IF EXISTS vcell_new;
        CREATE TABLE vhub_new(id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE,
                              threat INTEGER NOT NULL);
        CREATE TABLE vcell_new(
            t INTEGER NOT NULL, c INTEGER NOT NULL,
            l2n REAL NOT NULL, l2w REAL NOT NULL, l4n REAL NOT NULL, l4w REAL NOT NULL,
            d2n REAL NOT NULL, d2w REAL NOT NULL, d4n REAL NOT NULL, d4w REAL NOT NULL,
            PRIMARY KEY (t, c)) WITHOUT ROWID;
        """)
    con.execute("BEGIN")
    con.executemany("INSERT INTO vhub_new VALUES (?, ?, ?)",
                    ((i, k, int(k in threats)) for k, i in hub_id.items()))
    con.execute(
        """
        INSERT INTO vcell_new
        SELECT t, c,
               TOTAL(CASE k WHEN 0 THEN n END), TOTAL(CASE k WHEN 0 THEN w END),
               TOTAL(CASE k WHEN 1 THEN n END), TOTAL(CASE k WHEN 1 THEN w END),
               TOTAL(CASE k WHEN 2 THEN n END), TOTAL(CASE k WHEN 2 THEN w END),
               TOTAL(CASE k WHEN 3 THEN n END), TOTAL(CASE k WHEN 3 THEN w END)
          FROM vparts GROUP BY t, c
        """)
    con.execute("COMMIT")
    cells = con.execute("SELECT COUNT(*) FROM vcell_new").fetchone()[0]
    con.execute("DROP TABLE IF EXISTS temp.vparts")
    return {"hubs": len(hub_id), "threats": len(threats), "cells": cells}


def build(path: str | None = None, source: str | None = None, *, full: bool = False) -> dict:
    """Bring the index up to date. Returns a summary.

    1. INGEST new duel payloads (all of them on the first run, or with `full`).
    2. PRUNE games past `RETAIN_DAYS`.
    3. AGGREGATE the evidence window into `*_new` tables, in SQL.
    4. SWAP them in and stamp `meta` in ONE transaction, so a reader sees the
       old build or the new one and never half of each.
    """
    path = path or PATH
    source = source or (cd._tier_paths() or [None])[0]
    if not source:
        raise RuntimeError("no_database")
    _duo()._card_map()  # raises CardDataUnavailable BEFORE a four-minute scan
    started = time.time()

    con = sqlite3.connect(_uri(path, "rwc"), uri=True, timeout=30.0)
    con.isolation_level = None
    try:
        _ensure(con)
        meta = _meta(con)
        if full or meta.get("source") not in (None, _norm(source)):
            # A different database (or an explicit rebuild) starts from nothing:
            # a watermark is only meaningful against the file it was read from.
            con.execute("DELETE FROM games")
            meta = {}

        # 1. Ingest.
        t0 = time.perf_counter()
        src = cd.connect(source)
        try:
            got = _ingest(con, src, meta.get("watermark") or None)
        finally:
            src.close()
        t_ingest = time.perf_counter() - t0

        # 2. Prune, and find the window. Anchored on the newest STORED game.
        newest = con.execute("SELECT MAX(battle_time) FROM games").fetchone()[0] or ""
        anchor = _day_of(newest) or datetime.date.today()
        since = _stamp(anchor - datetime.timedelta(days=WINDOW_DAYS - 1))
        pruned = con.execute(
            "DELETE FROM games WHERE battle_time < ?",
            (_stamp(anchor - datetime.timedelta(days=RETAIN_DAYS)),)).rowcount

        # 3. Aggregate. First every side of every game in the window, with the
        # result the two PLAYERS alone would predict (`duel_brain`'s docstring,
        # "WHO FLEW IT IS TAKEN OUT"): each rated on their duels with their
        # OTHER decks, shrunk to 50%, compared by log5.
        t1 = time.perf_counter()
        window = con.execute(
            "SELECT a_tag, b_tag, a_deck, b_deck, winner FROM games WHERE battle_time >= ?",
            (since,)).fetchall()
        window_games = len(window)
        tag_n: dict[str, int] = {}
        tag_w: dict[str, int] = {}
        td_n: dict[tuple, int] = {}
        td_w: dict[tuple, int] = {}
        for at, bt, ad, bd, win in window:
            for tag, deck, won in ((at, ad, win == 1), (bt, bd, win == 2)):
                tag_n[tag] = tag_n.get(tag, 0) + 1
                tag_w[tag] = tag_w.get(tag, 0) + won
                td_n[(tag, deck)] = td_n.get((tag, deck), 0) + 1
                td_w[(tag, deck)] = td_w.get((tag, deck), 0) + won

        def rating(tag: str, deck: str) -> float:
            return _brain().pilot_rating(tag_w[tag] - td_w[(tag, deck)],
                                         tag_n[tag] - td_n[(tag, deck)])

        con.execute("DROP TABLE IF EXISTS temp.sides")
        con.execute("CREATE TEMP TABLE sides(deck TEXT, tag TEXT, opp TEXT, "
                    "won INTEGER, exp REAL)")
        log5 = _brain().log5
        batch = []
        for at, bt, ad, bd, win in window:
            ea = log5(rating(at, ad), rating(bt, bd))
            batch.append((ad, at, bd, int(win == 1), ea))
            batch.append((bd, bt, ad, int(win == 2), 1.0 - ea))
            if len(batch) >= WRITE_BATCH:
                con.execute("BEGIN")
                con.executemany("INSERT INTO sides VALUES (?,?,?,?,?)", batch)
                con.execute("COMMIT")
                batch = []
        if batch:
            con.execute("BEGIN")
            con.executemany("INSERT INTO sides VALUES (?,?,?,?,?)", batch)
            con.execute("COMMIT")
        del window, tag_n, tag_w, td_n, td_w, batch

        for t in ("deck_new", "deck_wc_new", "sub7_new", "catalogue_new"):
            con.execute(f"DROP TABLE IF EXISTS {t}")
        con.executescript(
            """
            CREATE TABLE deck_new(
                id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, wc TEXT NOT NULL,
                games INTEGER NOT NULL, wins INTEGER NOT NULL, players INTEGER NOT NULL,
                top_pilot INTEGER NOT NULL);
            CREATE TABLE deck_wc_new(
                deck INTEGER NOT NULL, opp_wc TEXT NOT NULL,
                games INTEGER NOT NULL, wins INTEGER NOT NULL, exp REAL NOT NULL,
                PRIMARY KEY (deck, opp_wc)) WITHOUT ROWID;
            CREATE TABLE sub7_new(
                h INTEGER NOT NULL, deck INTEGER NOT NULL,
                PRIMARY KEY (h, deck)) WITHOUT ROWID;
            CREATE TABLE catalogue_new(deck INTEGER PRIMARY KEY, rec TEXT NOT NULL);
            """
        )

        # Every list, labelled ONCE by the shared classifier, with how many
        # pilots it has and how much of it the busiest one played.
        rows = con.execute(
            """
            SELECT deck, SUM(n), SUM(w), COUNT(*), MAX(n) FROM (
                SELECT deck, tag, COUNT(*) AS n, SUM(won) AS w
                  FROM sides GROUP BY deck, tag)
             GROUP BY deck
            """).fetchall()
        con.execute("BEGIN")
        con.executemany(
            "INSERT INTO deck_new(key, wc, games, wins, players, top_pilot) "
            "VALUES (?,?,?,?,?,?)",
            ((k, classify(k), g, w, p, t) for k, g, w, p, t in rows))
        con.execute("COMMIT")
        n_decks = len(rows)
        del rows

        # Each list against each opponent WIN CONDITION.
        con.execute("BEGIN")
        con.execute("INSERT INTO deck_wc_new " + DECK_WC_SELECT)
        con.execute("COMMIT")

        # The 7-card subsets, streamed.
        cur = con.execute("SELECT id, key FROM deck_new")
        while True:
            part = cur.fetchmany(WRITE_BATCH // 8)
            if not part:
                break
            con.execute("BEGIN")
            con.executemany(
                "INSERT OR IGNORE INTO sub7_new VALUES (?, ?)",
                ((h, i) for i, k in part for h in sub7_hashes(k)))
            con.execute("COMMIT")

        # The catalogue, with its rungs precomputed so a request pays nothing
        # for the ~2,600 decks it ranks.
        cat = con.execute(
            "SELECT id, key, wc FROM deck_new "
            "WHERE games >= ? AND players >= ? AND top_pilot <= ? * games",
            (CATALOGUE_MIN_GAMES, CATALOGUE_MIN_PLAYERS,
             CATALOGUE_MAX_PILOT_SHARE)).fetchall()
        recs = []
        for i, k, wc in cat:
            r = _records_sql(con, i, k, wc, "deck_new", "deck_wc_new", "sub7_new")
            recs.append((i, json.dumps(r, separators=(",", ":"))))
        con.execute("BEGIN")
        con.executemany("INSERT INTO catalogue_new VALUES (?, ?)", recs)
        con.execute("COMMIT")
        n_rows = con.execute("SELECT COUNT(*) FROM deck_wc_new").fetchone()[0]
        t_agg = time.perf_counter() - t1

        # 3b. The version cells (`matchup_fusion`), while `sides` still holds
        # the window's duels. THIS STAGE MAY FAIL WITHOUT COSTING THE BUILD:
        # the duel brain's own tables are already written, and a request with
        # no version cells scores at the archetype levels, which is the fused
        # rate minus its narrowest evidence — never a wrong one.
        t_v = time.perf_counter()
        try:
            vstats = _build_vcells(con, source, [k for _, k, _ in cat])
        except Exception as exc:  # noqa: BLE001
            if con.in_transaction:
                con.execute("ROLLBACK")
            con.execute("DROP TABLE IF EXISTS vhub_new")
            con.execute("DROP TABLE IF EXISTS vcell_new")
            print(f"duel_index: version cells skipped: {type(exc).__name__}: {exc}",
                  file=sys.stderr)
            vstats = None
        t_vcell = time.perf_counter() - t_v
        con.execute("DROP TABLE IF EXISTS temp.sides")

        # 4. The swap.
        built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        total = con.execute("SELECT COUNT(*) FROM games").fetchone()[0]
        stamp = {
            "format": FORMAT,
            "builtAt": built_at,
            # WHAT A READER'S CACHES KEY ON. `builtAt` is to the second, and
            # two builds inside one second would share it — a cache keyed on
            # it would keep serving the first build's records. A test caught it.
            "buildId": str(time.time_ns()),
            "source": _norm(source),
            "watermark": got["watermark"],
            "games": str(total),
            "windowGames": str(window_games),
            "windowFrom": since,
            "windowTo": newest,
            "windowDays": str(WINDOW_DAYS),
            "decks": str(n_decks),
            "rows": str(n_rows),
            "catalogue": str(len(recs)),
            "buildSeconds": f"{time.time() - started:.1f}",
        }
        swap = ["deck", "deck_wc", "sub7", "catalogue"]
        if vstats is not None:
            # Only a stage that finished replaces the last build's cells; a
            # failed one leaves them, stale by one build and consistent with
            # their own hub ids.
            swap += ["vhub", "vcell"]
            stamp.update({"vhubs": str(vstats["hubs"]), "vthreats": str(vstats["threats"]),
                          "vcells": str(vstats["cells"]), "vcellSeconds": f"{t_vcell:.1f}"})
        con.execute("BEGIN IMMEDIATE")
        for t in swap:
            con.execute(f"DROP TABLE IF EXISTS {t}")
            con.execute(f"ALTER TABLE {t}_new RENAME TO {t}")
        con.executemany("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)", stamp.items())
        con.execute("COMMIT")
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        con.close()

    return {
        "builtAt": built_at,
        "ingest": got,
        "pruned": pruned,
        "games": total,
        "windowGames": window_games,
        "window": {"from": since, "to": newest, "days": WINDOW_DAYS},
        "decks": n_decks,
        "rows": n_rows,
        "catalogue": len(recs),
        "versionCells": vstats,
        "seconds": {"ingest": round(t_ingest, 1), "aggregate": round(t_agg, 1),
                    "versionCells": round(t_vcell, 1),
                    "total": round(time.time() - started, 1)},
    }


# ── Reading ─────────────────────────────────────────────────────────────────


_lock = threading.Lock()
_state: dict = {"buildId": None, "meta": {}, "checked": 0.0, "catalogue": None,
                "vhubs": None, "vhub_keys": None}
_cache: "OrderedDict[str, dict]" = OrderedDict()
_vcache: "OrderedDict[str, dict]" = OrderedDict()


def _ro(path: str) -> sqlite3.Connection:
    con = sqlite3.connect(_uri(path, "ro"), uri=True, timeout=5.0,
                          check_same_thread=False)
    con.isolation_level = None
    return con


def _usable(meta: dict[str, str]) -> bool:
    """A build this code can read, of the database the site is reading."""
    if meta.get("format") != FORMAT or not meta.get("builtAt"):
        return False
    hot = (cd._tier_paths() or [None])[0]
    return bool(hot) and meta.get("source") == _norm(hot)


def _current() -> dict | None:
    """The live build's meta, re-read at most every `RELOAD_CHECK_S`. Never raises."""
    now = time.monotonic()
    with _lock:
        if now - _state["checked"] < RELOAD_CHECK_S and _state["checked"]:
            return _state["meta"] if _usable(_state["meta"]) else None
        _state["checked"] = now
        if not os.path.exists(PATH):
            _state.update(buildId=None, meta={}, catalogue=None, vhubs=None, vhub_keys=None)
            _vcache.clear()
            return None
        try:
            con = _ro(PATH)
            try:
                meta = _meta(con)
            finally:
                con.close()
        except sqlite3.Error:
            _state.update(buildId=None, meta={}, catalogue=None, vhubs=None, vhub_keys=None)
            _vcache.clear()
            return None
        if meta.get("buildId") != _state["buildId"]:
            _cache.clear()
            _vcache.clear()
            _state.update(buildId=meta.get("buildId"), catalogue=None, vhubs=None,
                          vhub_keys=None)
        _state["meta"] = meta
        return meta if _usable(meta) else None


def available() -> bool:
    return _current() is not None


def records(cards) -> dict | None:
    """`{"exact": {wc: [games, wins]}, "near": {...}, "archetype", "neighbours"}`.

    None when there is no usable index — the caller then has no duel evidence,
    which is a state and not an error. A deck the duels have never seen comes
    back with empty rungs (its neighbours may still answer). Cached per build.
    """
    key = deck_key(cards)
    if len(key.split(",")) != 8:
        return None
    if _current() is None:
        return None
    with _lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
            return hit
    try:
        con = _ro(PATH)
        try:
            # ONE READ TRANSACTION, so a build that swaps its tables in between
            # the two queries cannot mix one build's ids with another's rows.
            con.execute("BEGIN")
            row = con.execute("SELECT id, wc FROM deck WHERE key = ?", (key,)).fetchone()
            wc = row[1] if row else classify(key)
            out = _records_sql(con, row[0] if row else None, key, wc)
            con.execute("COMMIT")
        finally:
            con.close()
    except sqlite3.Error:
        return None
    out["archetype"] = wc
    with _lock:
        _cache[key] = out
        while len(_cache) > RECORD_CACHE:
            _cache.popitem(last=False)
    return out


def catalogue() -> list[dict]:
    """Every deck the brain may offer, with its rungs. Loaded once per build."""
    if _current() is None:
        return []
    with _lock:
        if _state["catalogue"] is not None:
            return _state["catalogue"]
    try:
        con = _ro(PATH)
        try:
            con.execute("BEGIN")
            rows = con.execute(
                "SELECT d.key, d.wc, d.games, d.wins, d.players, c.rec "
                "FROM catalogue c JOIN deck d ON d.id = c.deck").fetchall()
            con.execute("COMMIT")
        finally:
            con.close()
    except sqlite3.Error:
        return []
    out = []
    for key, wc, g, w, p, rec in rows:
        r = json.loads(rec)
        r["archetype"] = wc
        out.append({"key": key, "cards": key.split(","), "archetype": wc,
                    "games": int(g), "wins": int(w), "players": int(p), "records": r})
    out.sort(key=lambda d: (-d["games"], d["key"]))
    with _lock:
        _state["catalogue"] = out
    return out


def _vhubs() -> dict[str, tuple[int, bool]]:
    """`{list key: (hub id, is a threat hub)}` for the live build, loaded once
    per build. Empty when the build has no version cells (an index written
    before they existed, or a build whose stage failed) — a state, not an error."""
    if _current() is None:
        return {}
    with _lock:
        if _state["vhubs"] is not None:
            return _state["vhubs"]
    try:
        con = _ro(PATH)
        try:
            rows = con.execute("SELECT id, key, threat FROM vhub").fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        rows = []
    hubs = {k: (i, bool(t)) for i, k, t in rows}
    with _lock:
        _state["vhubs"] = hubs
        _state["vhub_keys"] = {i: k for k, (i, _t) in hubs.items()}
    return hubs


def is_version_hub(cards) -> bool:
    """Whether the version cells cover this list AS A CANDIDATE."""
    return deck_key(cards) in _vhubs()


def version_cells(threat_cards) -> dict[str, tuple] | None:
    """`{candidate key: (l2n, l2w, l4n, l4w, d2n, d2w, d4n, d4w)}` against ONE
    threat, or None when the threat is not a hub of this build.

    `l2`/`d2` are the candidate against the threat's one-card family, `l4`/`d4`
    the candidate's family against the threat exactly — games and wins from
    the candidate's side, ladder then duel (duel wins pilot-adjusted). A
    candidate hub missing from the dict has no evidence at either level, which
    is a real answer: zero games. Cached per build.
    """
    key = deck_key(threat_cards)
    hubs = _vhubs()
    hit = hubs.get(key)
    if not hit or not hit[1]:
        return None
    with _lock:
        got = _vcache.get(key)
        if got is not None:
            _vcache.move_to_end(key)
            return got
        names = _state["vhub_keys"] or {}
    try:
        con = _ro(PATH)
        try:
            rows = con.execute(
                "SELECT c, l2n, l2w, l4n, l4w, d2n, d2w, d4n, d4w FROM vcell WHERE t = ?",
                (hit[0],)).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return None
    out = {names[r[0]]: tuple(r[1:]) for r in rows if r[0] in names}
    with _lock:
        _vcache[key] = out
        while len(_vcache) > VCELL_CACHE:
            _vcache.popitem(last=False)
    return out


def _player_rows(tag: str, since: str | None, until: str | None) -> list[tuple]:
    lo, hi = since or "", until or "~"
    con = _ro(PATH)
    try:
        return con.execute(
            """
            SELECT a_deck, CASE winner WHEN 1 THEN 1 ELSE 0 END, battle_time
              FROM games WHERE a_tag = ? AND battle_time >= ? AND battle_time <= ?
            UNION ALL
            SELECT b_deck, CASE winner WHEN 2 THEN 1 ELSE 0 END, battle_time
              FROM games WHERE b_tag = ? AND battle_time >= ? AND battle_time <= ?
            """, (tag, lo, hi, tag, lo, hi)).fetchall()
    finally:
        con.close()


def player_decks(tag: str, since: str | None = None, until: str | None = None) -> list[dict]:
    """The decks one player duelled with in a window, most-played first.

    `since`/`until` are stored-format stamps (`iso_to_stamp`). Every game of
    theirs the index holds counts — the evidence window bounds the records, not
    what somebody has played.
    """
    if not tag or _current() is None:
        return []
    try:
        rows = _player_rows(tag, since, until)
    except sqlite3.Error:
        return []
    per: dict[str, list] = {}
    for deck, won, bt in rows:
        cur = per.setdefault(deck, [0, 0, ""])
        cur[0] += 1
        cur[1] += int(won)
        if bt > cur[2]:
            cur[2] = bt
    out = [{"key": k, "cards": k.split(","), "archetype": classify(k),
            "games": g, "wins": w, "lastSeen": last}
           for k, (g, w, last) in per.items()]
    out.sort(key=lambda d: (-d["games"], d["key"]))
    return out


def player_record(tag: str) -> tuple[int, int]:
    """`(games, wins)` over every duel game of theirs the index holds — the
    running record `duel_model.strength` turns into a player's strength."""
    if not tag or _current() is None:
        return 0, 0
    try:
        rows = _player_rows(tag, None, None)
    except sqlite3.Error:
        return 0, 0
    return len(rows), sum(int(w) for _d, w, _t in rows)


#: A variant must have been played this many duel games to be offered as a
#: change real players made — one game of a one-card difference is a typo.
VARIANT_MIN_GAMES = 10


def near_variants(cards, min_games: int = VARIANT_MIN_GAMES, limit: int = 60) -> list[dict]:
    """Real duel decks ONE CARD away from `cards`: what duel players changed.

    The `sub7` table nominates every stored deck sharing a 7-card subset; the
    overlap is then checked on the cards, so a hash collision cannot admit a
    stranger. Most-played first. `[]` with no index.
    """
    key = deck_key(cards)
    have = set(key.split(","))
    if len(have) != 8 or _current() is None:
        return []
    hs = sub7_hashes(key)
    try:
        con = _ro(PATH)
        try:
            rows = con.execute(
                f"SELECT DISTINCT d.key, d.games, d.wins, d.players FROM sub7 s "
                f"JOIN deck d ON d.id = s.deck WHERE s.h IN ({','.join('?' for _ in hs)}) "
                f"AND d.games >= ?", (*hs, int(min_games))).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return []
    out = []
    for k, g, w, p in rows:
        c = k.split(",")
        if len(set(c) & have) == 7:
            out.append({"cards": c, "games": int(g), "wins": int(w), "players": int(p)})
    out.sort(key=lambda d: (-d["games"], ",".join(d["cards"])))
    return out[:limit]


def player_wcs(tag: str, since: str | None = None, until: str | None = None) -> dict[str, int]:
    """`{win condition: games}` — what one player brings to their duels."""
    out: dict[str, int] = {}
    for d in player_decks(tag, since, until):
        out[d["archetype"]] = out.get(d["archetype"], 0) + d["games"]
    return out


def status() -> dict:
    """What `/api/analytics/status` publishes. Counts and times only."""
    cur = _current()
    meta = _state["meta"] or {}
    age = None
    if meta.get("builtAt"):
        try:
            age = round(time.time() - calendar.timegm(
                time.strptime(meta["builtAt"], "%Y-%m-%dT%H:%M:%SZ")))
        except (ValueError, OverflowError):
            age = None

    def num(k):
        v = meta.get(k, "")
        return int(v) if v.isdigit() else None

    return {
        "available": cur is not None,
        "builtAt": meta.get("builtAt"),
        "ageSeconds": age,
        "games": num("games"),
        "windowGames": num("windowGames"),
        "windowDays": num("windowDays"),
        "windowFrom": meta.get("windowFrom"),
        "windowTo": meta.get("windowTo"),
        "decks": num("decks"),
        "catalogue": num("catalogue"),
        # The version cells behind `matchup_fusion`: absent (None) on a build
        # written before they existed.
        "versionHubs": num("vhubs"),
        "versionThreats": num("vthreats"),
        "versionCells": num("vcells"),
        "buildSeconds": float(meta["buildSeconds"]) if meta.get("buildSeconds") else None,
    }


if __name__ == "__main__":
    if "--build" in sys.argv or "--full" in sys.argv:
        print(json.dumps(build(full="--full" in sys.argv), indent=2))
    elif "--status" in sys.argv:
        print(json.dumps(status(), indent=2))
    else:
        print("usage: duel_index.py --build | --full | --status")
        sys.exit(2)
