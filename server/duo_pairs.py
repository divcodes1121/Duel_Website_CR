"""duo_pairs.py — the unique DECK PAIRS played in 2v2.

**THE UNIT IS A PAIR OF TEAMMATE DECKS, NOT A DECK.** A 2v2 battle is four
players and four decks; what is worth recording is which two decks were brought
*together*. An earlier version of this module collected individual decks and
was wrong for exactly that reason — 364,357 individual decks is not an answer
to "what do people play in 2v2", because the thing a 2v2 player chooses is a
partnership.

    pair identity = canonical( canonical(deck A), canonical(deck B) )

Both levels are order-free. The eight cards of a deck sort; the two deck
fingerprints of a pair sort. So `Deck A + Deck B` and `Deck B + Deck A` are one
record, and so are the same eight cards listed any other way.

WHY IT READS `battle_raw` AND NOT `battles`, WHICH IS THE WHOLE REASON THIS
MODULE COULD BE WRITTEN AT ALL. A `battles` row holds ONE `player_card_keys`,
ONE `opponent_card_keys` and ONE `opponent_tag` — the teammate's deck is in no
column of it. A pair cannot be reconstructed from that row, and inventing one
from the single deck it does hold would be fabricating the other half. The raw
API payload has all of it:

    team:     [ {tag, cards[8], crowns}, {tag, cards[8], crowns} ]
    opponent: [ {tag, cards[8], crowns}, {tag, cards[8], crowns} ]

So **one battle yields TWO pair records** — the team's and the opponents'. Both
are real partnerships that were really played.

**COVERAGE IS 78.2% AND THE REST IS GONE FOR GOOD.** Measured 2026-09-10:

    2v2 rows in `battles`      1,381,535
    with a surviving payload   1,080,047   reconstructable
    without one                  301,488   NOT reconstructable, ever

    by month:  Jun 0/455 (0%)   Jul 520/69,832 (0.7%)
               Aug 16,568/246,118 (6.7%)   Sep 1,062,959/1,065,130 (99.8%)

The raw-cap valve purged 1,881,526 `battle_raw` rows on 2026-09-01, and June
predates raw collection entirely. **Those 301,488 battles are counted and
reported as `unreconstructable`, never fabricated and never quietly dropped.**
The one deck `battles` still holds for them is not half a pair; it is a deck
whose partner is unknown, and saying so is the only honest option.

**NOTHING HERE DELETES ANYTHING.** This is phase 1 of three. Phase 2 is a
change to the BOT (`/opt/clashbot/clashdb.py`, a different codebase on the same
VPS) so that 2v2 never enters `battles` in the first place; phase 3 is the
historical cleanup, which must wait for phase 2 AND for the aggregates —
`player_stats_agg` demonstrably counts 2v2 today (player `#200P8U2QJL` has 73
non-2v2 battles and an aggregate of 337), and `rebuild_aggregates` has no live
caller, so deleting rows now would leave figures nothing could ever recompute.

ONE BATTLE IS ONE OCCURRENCE, WHICH ROW COUNTING WOULD GET WRONG. **51,671 2v2
rows have a tracked opponent**, so the same underlying battle is stored more
than once — once per tracked participant. Counting rows would inflate those
pairs by up to 4x. Every battle is therefore reduced to an identity built from
its own contents (`battle_identity`) and folded exactly once, enforced by a
primary key rather than by hoping.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time

import battle_modes as bm
import clash_data as cd
import duel_combos as dx
import recruit
import tracking

#: Ours, beside the two background snapshots and the tag queue. Gitignored.
#: Phase 1 keeps a dedicated file: it must survive independently of the bot's
#: database, which is the point of a collection that outlives the raw rows.
DB_PATH = os.getenv(
    "CLASH_DUO_DB",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".duo_pairs.db"),
)

#: The mode label every record carries. `TeamVsTeam` and
#: `TeamVsTeam_FixedDeckOrder` are the same game with a different deck-order
#: rule; the raw strings survive in `source_modes`.
MODE = "2v2"

#: Pairs per page. This is a ranking whose head is the answer, not a list.
PER_PAGE = 25
MAX_PER_PAGE = 200

#: **A 2v2 PARTICIPANT IS NOT TRACKED ON SIGHT.** The historical
#: reconciliation found **866,226 distinct participants** against a tracked
#: roster of **4,910** — 176x — because a 2v2 event puts you in front of three
#: strangers every match. Enrolling on first sight is not discovery, it is a
#: roster explosion, and at this project's own ~32 MB per player per year of
#: retention it is roughly 27.6 TB a year against a database with no backup.
#:
#: Three distinct battles is the line between "we happened to meet this person"
#: and "this person plays 2v2". It is deliberately measured in BATTLES, not in
#: sightings or rows: the same battle reaches us once per tracked participant,
#: so a row threshold could be crossed by one battle seen from three sides.
QUALIFY_BATTLES = int(os.getenv("CLASH_DUO_QUALIFY", "3"))

#: **THE BOUND ON EXPENSIVE PER-PLAYER DETAIL.** 866,226 people have played a
#: 2v2 that reached us. Keeping a per-battle row for each of them is 3.8M rows
#: today and unbounded tomorrow, because the population grows with every event
#: and never shrinks.
#:
#: TWO TIERS, AND THE SPLIT IS THE WHOLE POINT:
#:
#:   * **lightweight, kept for EVERYONE** — one row per participant in
#:     `duo_participants`: their tag, how many distinct battles they have
#:     played, and when. That is what ranking and eligibility need, and it is
#:     ~40 bytes a head.
#:   * **expensive, kept for the TOP N ONLY** — the per-battle ledger in
#:     `duo_battle_players`. That is what a per-player 2v2 history would be
#:     built from, and it is the part that scales with battles rather than
#:     with people.
#:
#: Because the lightweight tier covers everyone, **the population is
#: recalculable**: number 1,001 can overtake number 1,000 and be admitted on
#: the next reconcile without a raw rescan. Freezing today's list would make
#: the bound permanent rather than current.
#:
#: Configurable so it can become 500 or 5,000 without a redesign.
DUO_TOP_PLAYERS_LIMIT = int(os.getenv("DUO_TOP_PLAYERS_LIMIT", "1000"))

#: **LIVE PROMOTION IS OFF UNTIL SOMEBODY TURNS IT ON.** The mechanism is
#: built and tested; what is withheld is the decision to spend the roster on
#: it. 7,083 candidates would fill the collection from 4,910 to the 12,000
#: ceiling — +144%, and roughly 380 GB a year at steady state against a
#: database with no backup — so it ships dark, the way `CLASH_OIE=off` and
#: `CLASH_RECRUIT_OPPONENTS=off` already do in this project.
#:
#: `enrol_policy()` still computes and reports exactly what it WOULD do; only
#: the write is gated.
PROMOTION_ENABLED = os.getenv("CLASH_DUO_PROMOTE", "off").strip().lower() in (
    "1", "on", "true", "yes")

#: THE ORDERINGS THE BOARD OFFERS, and the column each one actually sorts on.
#: A CLOSED VOCABULARY, mapped here rather than interpolated from the request:
#: the value reaches this module from a query string, and an ORDER BY built by
#: string concatenation from user input is the one place a read-only board
#: could be turned into something else.
SORTS = {
    "played": "occurrences DESC, pair_fingerprint",
    "recent": "last_seen DESC, pair_fingerprint",
    "first": "first_seen ASC, pair_fingerprint",
}
DEFAULT_SORT = "played"

#: WHICH FAILURE REASONS HOLD THE CURSOR BACK, and it is deliberately not all
#: of them.
#:
#: `unknown_card:<id>` is TRANSIENT. It means this host's card catalog is
#: behind the game, and re-running after the catalog is deployed resolves the
#: payload. That is not hypothetical: when Minion Giant shipped, 81,974 sides
#: read as unresolvable here for exactly that reason, and the fix was a file
#: copy. A cursor that stepped over those would have let the raw cap delete
#: every affected battle instead of waiting.
#:
#: The others -- `side_not_two_participants`, `not_eight_cards`,
#: `duplicate_cards` -- are PERMANENT properties of the payload. No later
#: deploy makes them readable. Blocking on those would jam the cursor forever
#: on one malformed row, which stops ALL raw purging and grows the database
#: without bound. A safe direction is not the same as a safe resting place.
RETRYABLE_REASONS = ("unknown_card:",)

#: How many participating tags to keep on a pair record. The tags exist for
#: reconciliation and for tracking, not as a roster — a pair played 13,000
#: times would otherwise carry 13,000 of them and the row would be mostly tags.
#: `distinct_players` is counted exactly regardless of this cap.
TAG_SAMPLE = 12

#: Payload rows read per batch. Bounds memory, not the scan.
_READ_BATCH = 5000

_lock = threading.Lock()
_ready = False

# --------------------------------------------------------------------------
# Cards
# --------------------------------------------------------------------------
#
# THE PAYLOAD NAMES CARDS BY SUPERCELL ID, AND ID IS THE RIGHT JOIN. The raw
# card object carries `name`, `id`, `level`, `evolutionLevel` and art URLs. The
# name is display text and is localised and re-worded between seasons; the id
# is the stable identifier, and `cards.json` carries it for every card.
_ID_TO_KEY: dict[int, str] = {}


class CardDataUnavailable(RuntimeError):
    """The id -> key map could not be built, so no deck can be read.

    RAISED RATHER THAN RETURNED EMPTY, and this is not defensive decoration —
    it cost a 15-minute run against the live database to learn. `card_info`
    gained its `id` field in the same change as this module, and the analytics
    host had not been redeployed, so every lookup returned `None`, every deck
    resolved to `[]`, and the migration reported **0 pairs and 1.08M unreadable
    payloads**. That is a true sentence about a completely broken run, and it
    is indistinguishable from a database that genuinely holds no readable 2v2.

    `server/` deploys by hand and the two halves of this project always ship
    separately, so a stale sibling module is the NORMAL failure here, not an
    exotic one. It has to be loud.
    """


def _card_map() -> dict[int, str]:
    global _ID_TO_KEY
    if not _ID_TO_KEY:
        built = {}
        for key in dx.card_keys():
            cid = dx.card_info(key).get("id") or 0
            if cid:
                built[int(cid)] = key
        if not built:
            raise CardDataUnavailable(
                "no card ids available — `duel_combos.card_info` returns no "
                "'id' field. Deploy the current server/duel_combos.py; every "
                "deck would otherwise read as unresolvable."
            )
        _ID_TO_KEY = built
    return _ID_TO_KEY


def deck_and_reason(part: dict) -> tuple[list[str], str]:
    """One participant's eight card keys, plus WHY if they could not be read.

    **`supportCards` IS EXCLUDED AND THAT IS NOT AN OVERSIGHT.** It holds the
    tower troop (id 159000000 in the sampled payloads), which is not one of the
    eight cards and is not part of a deck's identity anywhere else in this
    project. Including it would make every deck nine cards and would fork one
    real deck into several on tower choice alone.

    Returns `([], reason)` unless exactly eight cards resolve to known keys. An
    unknown id means a card this deployment's `cards.json` predates, and a
    seven-card deck built by silently dropping it would be a different deck
    wearing a real deck's identity.

    **THE REASON IS RETURNED, NOT LOGGED AND FORGOTTEN.** A refusal that cannot
    be counted and named is indistinguishable from data that never existed —
    which is exactly how 81,941 sides went missing on the first live run
    without anything being able to say that one absent card explained all of
    them. `unknown_card:<id>` carries the id so the answer is a deploy rather
    than an investigation.
    """
    cards = part.get("cards") or []
    if len(cards) != 8:
        return [], "not_eight_cards:{}".format(len(cards))
    m = _card_map()
    keys = []
    for c in cards:
        cid = int(c.get("id") or 0)
        key = m.get(cid)
        if not key:
            return [], "unknown_card:{}".format(cid)
        keys.append(key)
    out = sorted(set(keys))
    if len(out) != 8:
        return [], "duplicate_cards:{}".format(len(out))
    return out, ""


def deck_from_participant(part: dict) -> list[str]:
    """The eight card keys one participant brought. See `deck_and_reason`."""
    return deck_and_reason(part)[0]


# --------------------------------------------------------------------------
# Identity
# --------------------------------------------------------------------------

def deck_fingerprint(card_keys) -> str:
    """A deck's identity: `<mode>d:<sha1 of the sorted keys>`.

    Card order cannot affect it, because the keys are sorted before hashing and
    this is the only place a deck is turned into an identity.
    """
    keys = sorted({str(k).strip().lower() for k in (card_keys or []) if str(k).strip()})
    if len(keys) != 8:
        return ""
    return "{}d:{}".format(
        MODE, hashlib.sha1("{}|{}".format(MODE, ",".join(keys)).encode("utf-8")).hexdigest()
    )


def pair_fingerprint(fp_a: str, fp_b: str, mode: str = MODE) -> str:
    """A partnership's identity, from its two deck fingerprints.

    **THE TWO ARE SORTED, so the pair is unordered.** A 2v2 team has no first
    and second player — the payload's array order is arrival order and means
    nothing — so `Deck A + Deck B` and `Deck B + Deck A` must be one record.

    The mode is hashed in as well as prefixed, for the reason the deck
    fingerprint gives: a prefix alone is a label anyone could strip.

    A MIRROR PAIR IS LEGAL. Two teammates on the same list is a real pairing
    and gets its own identity rather than being refused.
    """
    if not fp_a or not fp_b:
        return ""
    lo, hi = sorted([fp_a, fp_b])
    return "{}:{}".format(
        mode, hashlib.sha1("{}|{}|{}".format(mode, lo, hi).encode("utf-8")).hexdigest()
    )


def battle_identity(payload: dict) -> str:
    """One value per REAL battle, however many rows store it.

    **THIS IS WHAT STOPS DOUBLE COUNTING.** `battle_raw` is keyed
    `(player_tag, battle_time)`, so a battle in which two — or all four —
    participants are tracked is stored two or four times, each copy describing
    the same four players. 51,671 2v2 rows have a tracked opponent, so this is
    not a rare case, and counting rows would inflate those pairs by up to 4x.

    Built from the battle's OWN contents — its timestamp and the sorted set of
    its four tags — rather than from the row that happens to carry it, so every
    copy of one battle produces the same value no matter whose log it came from.
    """
    tags = sorted(
        (p.get("tag") or "").strip().upper()
        for side in ("team", "opponent")
        for p in (payload.get(side) or [])
    )
    stamp = (payload.get("battleTime") or "").strip()
    if not stamp or not any(tags):
        return ""
    return hashlib.sha1("{}|{}".format(stamp, ",".join(tags)).encode("utf-8")).hexdigest()


def pairs_from_payload(payload: dict, problems: dict | None = None):
    """Every partnership in one battle: the team's, and the opponents'.

    Yields `(side, deck_a_fp, deck_b_fp, deck_a_keys, deck_b_keys, tags)` with
    the two decks already in canonical order, so a caller never has to know
    which way round they arrived.

    A SIDE WITH TWO PARTICIPANTS BUT AN UNREADABLE DECK IS SKIPPED, not
    half-recorded. Half a pair is not a pair.

    `problems` is an optional counter that every refusal increments, keyed by
    reason. **EVERY SIDE THIS DECLINES IS THEREFORE ACCOUNTED FOR**: sides
    attempted minus sides yielded equals the sum of the counters, and a
    reconciliation can state why each one was refused instead of reporting a
    shortfall it cannot explain.
    """
    def note(reason: str) -> None:
        if problems is not None:
            problems[reason] = problems.get(reason, 0) + 1

    for side in ("team", "opponent"):
        parts = payload.get(side) or []
        if len(parts) != 2:
            # Not a two-a-side battle. A payload that does not look like 2v2
            # is not forced into the shape.
            note("side_not_two_participants:{}".format(len(parts)))
            continue
        decks, why = [], ""
        for p in parts:
            keys, reason = deck_and_reason(p)
            if reason:
                why = why or reason
            decks.append(keys)
        if why or not all(decks):
            note(why or "unreadable_deck")
            continue
        fps = [deck_fingerprint(d) for d in decks]
        if not all(fps):
            note("no_fingerprint")
            continue
        # Canonical order at BOTH levels, decided once, here.
        (fp_a, deck_a), (fp_b, deck_b) = sorted(zip(fps, decks))
        tags = [(p.get("tag") or "").strip().upper() for p in parts]
        yield side, fp_a, fp_b, deck_a, deck_b, [t for t in tags if t]


# --------------------------------------------------------------------------
# The collection
# --------------------------------------------------------------------------

def _connect() -> sqlite3.Connection:
    """Read-write, because this file is ours. Contrast `clash_data.connect`."""
    con = sqlite3.connect(DB_PATH, timeout=30.0, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def _ensure() -> None:
    global _ready
    if _ready:
        return
    with _lock:
        if _ready:
            return
        con = _connect()
        try:
            con.execute("PRAGMA journal_mode=WAL")
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS duo_pairs (
                    pair_fingerprint   TEXT PRIMARY KEY,
                    mode               TEXT NOT NULL,
                    deck_a_fingerprint TEXT NOT NULL,
                    deck_b_fingerprint TEXT NOT NULL,
                    deck_a_cards       TEXT NOT NULL,
                    deck_b_cards       TEXT NOT NULL,
                    occurrences        INTEGER NOT NULL DEFAULT 0,
                    distinct_players   INTEGER NOT NULL DEFAULT 0,
                    player_tags        TEXT NOT NULL DEFAULT '[]',
                    first_seen         TEXT NOT NULL DEFAULT '',
                    last_seen          TEXT NOT NULL DEFAULT '',
                    source_modes       TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_duo_occ
                    ON duo_pairs(occurrences DESC, pair_fingerprint);
                -- THE OTHER TWO ORDERINGS THE BOARD OFFERS. Measured on the
                -- live 1.29M-pair collection, `ORDER BY last_seen DESC` with
                -- no index is a full scan into a temp B-tree and takes
                -- **32.4 seconds** for one page of 25. These are not
                -- speculative indexes; each is the minimum that turns one
                -- offered sort from a scan into a seek, and each costs about
                -- the same as `idx_duo_occ` (75 MB).
                CREATE INDEX IF NOT EXISTS idx_duo_last
                    ON duo_pairs(last_seen DESC, pair_fingerprint);
                CREATE INDEX IF NOT EXISTS idx_duo_first
                    ON duo_pairs(first_seen, pair_fingerprint);

                -- STAGING. One row per (battle, side), with the battle's own
                -- identity as half the primary key -- so a battle stored under
                -- four tracked players collapses to one row by CONSTRAINT
                -- rather than by a Python set that has to be held in memory
                -- for 1.08M battles.
                CREATE TABLE IF NOT EXISTS duo_stage (
                    battle_id    TEXT NOT NULL,
                    side         TEXT NOT NULL,
                    pair_fp      TEXT NOT NULL,
                    deck_a_fp    TEXT NOT NULL,
                    deck_b_fp    TEXT NOT NULL,
                    deck_a       TEXT NOT NULL,
                    deck_b       TEXT NOT NULL,
                    battle_time  TEXT NOT NULL,
                    game_mode    TEXT NOT NULL,
                    PRIMARY KEY (battle_id, side)
                );
                CREATE INDEX IF NOT EXISTS idx_stage_pair ON duo_stage(pair_fp);

                -- Distinct participants per pair, as a SET enforced by a
                -- primary key for the same reason.
                CREATE TABLE IF NOT EXISTS duo_stage_players (
                    pair_fp TEXT NOT NULL,
                    tag     TEXT NOT NULL,
                    PRIMARY KEY (pair_fp, tag)
                );

                -- WHO PLAYED IN WHICH BATTLE. The primary key is what makes
                -- "distinct battles" mean distinct BATTLES: the same battle
                -- reaches us once per tracked participant, so a tag seen in
                -- one battle from three sides must still count as one. A
                -- sightings counter would let a single battle qualify
                -- somebody, which is precisely the noise the threshold exists
                -- to reject.
                CREATE TABLE IF NOT EXISTS duo_battle_players (
                    battle_id   TEXT NOT NULL,
                    tag         TEXT NOT NULL,
                    battle_time TEXT NOT NULL DEFAULT '',
                    -- 1 once this row has been folded into
                    -- `duo_participants.battles`. See `_roll_participants`: an
                    -- incremental roll ADDS uncounted rows, and it has to,
                    -- because pruning deletes the history it would otherwise
                    -- try to recount from.
                    counted     INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (battle_id, tag)
                );
                CREATE INDEX IF NOT EXISTS idx_bp_tag ON duo_battle_players(tag);

                -- The rollup the enrolment decision reads, so the ingestion
                -- path never touches the 44.7 GB raw table to answer "how many
                -- battles has this player been in".
                CREATE TABLE IF NOT EXISTS duo_participants (
                    tag         TEXT PRIMARY KEY,
                    battles     INTEGER NOT NULL DEFAULT 0,
                    first_seen  TEXT NOT NULL DEFAULT '',
                    last_seen   TEXT NOT NULL DEFAULT '',
                    enrolled_at TEXT NOT NULL DEFAULT '',
                    -- 1 for the current top-N population, whose per-battle
                    -- ledger rows are retained. Recomputed by
                    -- `reconcile_population`, never frozen.
                    retained    INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_part_rank
                    ON duo_participants(battles DESC, tag);

                CREATE TABLE IF NOT EXISTS duo_meta (k TEXT PRIMARY KEY, v TEXT);
                """
            )
            # COLUMNS ADDED AFTER A COLLECTION EXISTS. `CREATE TABLE IF NOT
            # EXISTS` does nothing to a table that is already there, so a new
            # column on `duo_participants` would be missing on every
            # collection built before it — including the 866,226-row one that
            # takes twenty minutes to rebuild. Cheap, idempotent, and the
            # alternative is discarding real work to add a flag.
            for table, column, ddl in (
                ("duo_participants", "retained",
                 "ALTER TABLE duo_participants ADD COLUMN retained "
                 "INTEGER NOT NULL DEFAULT 0"),
                # DEFAULT 1 on an existing collection, not 0: every row already
                # in the ledger has been folded into a participant count, and
                # defaulting to 0 would re-add all 3.9M of them on the next
                # incremental roll.
                ("duo_battle_players", "counted",
                 "ALTER TABLE duo_battle_players ADD COLUMN counted "
                 "INTEGER NOT NULL DEFAULT 1"),
            ):
                have = {r["name"] for r in
                        con.execute(f"PRAGMA table_info({table})").fetchall()}
                if column not in have:
                    con.execute(ddl)
            con.commit()
        finally:
            con.close()
        _ready = True


def _meta_get(con, key: str, default: str = "") -> str:
    row = con.execute("SELECT v FROM duo_meta WHERE k = ?", (key,)).fetchone()
    return row["v"] if row else default


def _meta_set(con, key: str, value) -> None:
    con.execute(
        "INSERT INTO duo_meta(k, v) VALUES(?, ?) "
        "ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        (key, str(value)),
    )


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# --------------------------------------------------------------------------
# Reconstruction
# --------------------------------------------------------------------------

def coverage() -> dict:
    """How much of the 2v2 population can be turned into pairs at all.

    Reported rather than assumed, and reported even when it is bad: the answer
    today is that 21.8% of the rows have no surviving payload and their second
    deck is unrecoverable. **A migration that quietly counted those as done
    would be claiming to have preserved something it destroyed.**
    """
    path = cd.resolve_db_path()
    if not path:
        raise RuntimeError("no readable database")
    con = cd.connect(path)
    try:
        modes = _duo_modes(con)
        if not modes:
            return {"rows": 0, "reconstructable": 0, "unreconstructable": 0,
                    "modes": [], "byMonth": []}
        ph = ",".join("?" for _ in modes)
        row = con.execute(
            f"""
            SELECT COUNT(*) AS rows_2v2,
                   SUM(CASE WHEN r.player_tag IS NOT NULL THEN 1 ELSE 0 END) AS have_raw
            FROM battles b
            LEFT JOIN battle_raw r
              ON r.player_tag = b.player_tag AND r.battle_time = b.battle_time
            WHERE b.game_mode IN ({ph})
            """,
            tuple(modes),
        ).fetchone()
        months = con.execute(
            f"""
            SELECT substr(b.battle_time,1,6) AS month,
                   COUNT(*) AS rows_2v2,
                   SUM(CASE WHEN r.player_tag IS NOT NULL THEN 1 ELSE 0 END) AS have_raw
            FROM battles b
            LEFT JOIN battle_raw r
              ON r.player_tag = b.player_tag AND r.battle_time = b.battle_time
            WHERE b.game_mode IN ({ph})
            GROUP BY month ORDER BY month
            """,
            tuple(modes),
        ).fetchall()
    finally:
        con.close()

    total = row["rows_2v2"] or 0
    have = row["have_raw"] or 0
    return {
        "rows": total,
        "reconstructable": have,
        "unreconstructable": total - have,
        "modes": modes,
        "byMonth": [
            {"month": m["month"], "rows": m["rows_2v2"], "reconstructable": m["have_raw"]}
            for m in months
        ],
    }


def _duo_modes(con) -> list[str]:
    """The raw mode strings this database holds that `battle_modes` calls 2v2.

    ASKED OF THE DATA, NOT HARDCODED, so a `LIKE 'teamvsteam%'` here cannot
    drift from the router the rest of the system uses — the drift
    `player_cards` already documents.
    """
    rows = con.execute("SELECT DISTINCT game_mode FROM battle_raw").fetchall()
    modes = {r["game_mode"] for r in rows if bm.is_duo(r["game_mode"] or "")}
    rows = con.execute("SELECT DISTINCT game_mode FROM battles").fetchall()
    modes |= {r["game_mode"] for r in rows if bm.is_duo(r["game_mode"] or "")}
    return sorted(m for m in modes if m)


def _retryable(problems: dict) -> int:
    """How many refusals so far might succeed on a later run. See
    `RETRYABLE_REASONS`."""
    return sum(v for k, v in problems.items()
               if k.startswith(RETRYABLE_REASONS))


def _stage(con, src, since: str | None) -> dict:
    """Read payloads and stage every partnership in them.

    Streams rather than fetching: 1.08M payloads at ~3 kB each is gigabytes of
    JSON, and `fetchall` on that is an out-of-memory kill rather than a slow
    query.
    """
    # TWO QUERIES, AND THE DIFFERENCE IS WHICH INDEX EXISTS.
    #
    # A FULL RUN filters on `game_mode`, which has no index, so it is a scan of
    # a 44.7 GB table either way — and naming the modes at least keeps ~3.5M
    # non-2v2 payloads out of Python.
    #
    # AN INCREMENTAL RUN filters on `stored_at`, which DOES have one
    # (`ix_raw_stored`), and then asks `battle_modes` about each row it gets
    # back. That turns a four-minute scan into an index seek over a few hours
    # of polling — and it picks up a 2v2 mode string Supercell has never
    # shipped before, which an `IN` list built from the modes already present
    # structurally cannot.
    if since:
        sql = ("SELECT player_tag, battle_time, game_mode, stored_at, raw_json "
               "FROM battle_raw WHERE stored_at > ? ORDER BY stored_at")
        args = [since]
        modes = None
    else:
        modes = _duo_modes(src)
        if not modes:
            return {"payloads": 0, "battles": 0, "sides": 0, "unreadable": 0,
                    "tags": set(), "watermark": since or "", "touched": set(),
                    "sidesAttempted": 0, "sidesResolved": 0, "problems": {}}
        ph = ",".join("?" for _ in modes)
        sql = ("SELECT player_tag, battle_time, game_mode, stored_at, raw_json "
               f"FROM battle_raw WHERE game_mode IN ({ph})")
        args = list(modes)

    cur = src.execute(sql, args)
    seen_payloads = unreadable = sides = 0
    sides_attempted = sides_yielded = 0
    problems: dict[str, int] = {}
    high = since or ""
    tags: set[str] = set()
    touched: set[str] = set()
    # THE EARLIEST 2v2 PAYLOAD THIS RUN COULD NOT RESOLVE. The cursor must not
    # advance past it -- see the note where it is applied.
    blocked_at: str | None = None
    stage_rows, player_rows, battle_rows = [], [], []

    while True:
        chunk = cur.fetchmany(_READ_BATCH)
        if not chunk:
            break
        for r in chunk:
            if r["stored_at"] and r["stored_at"] > high:
                high = r["stored_at"]
            # THE WATERMARK MOVES FOR EVERY ROW READ, 2v2 or not — it records
            # how far this pass got through `battle_raw`, not how far it got
            # through the 2v2 in it. Advancing it only past 2v2 rows would
            # re-read every ladder payload in the window on the next run,
            # forever.
            if modes is None and not bm.is_duo(r["game_mode"] or ""):
                continue
            seen_payloads += 1
            try:
                payload = json.loads(r["raw_json"] or "{}")
            except Exception:
                unreadable += 1
                continue
            bid = battle_identity(payload)
            if not bid:
                unreadable += 1
                continue
            got = False
            retryable_before = _retryable(problems)
            # Two sides are OFFERED by every 2v2 payload. Counting what was
            # offered as well as what was taken is what makes the shortfall
            # explainable rather than merely visible.
            sides_attempted += 2
            for side, fp_a, fp_b, deck_a, deck_b, side_tags in pairs_from_payload(
                    payload, problems):
                pair_fp = pair_fingerprint(fp_a, fp_b)
                if not pair_fp:
                    problems["no_pair_fingerprint"] = problems.get("no_pair_fingerprint", 0) + 1
                    continue
                got = True
                sides_yielded += 1
                touched.add(pair_fp)
                stage_rows.append((
                    bid, side, pair_fp, fp_a, fp_b,
                    json.dumps(deck_a), json.dumps(deck_b),
                    r["battle_time"] or "", r["game_mode"] or "",
                ))
                for t in side_tags:
                    player_rows.append((pair_fp, t))
                    # ONE ROW PER (BATTLE, TAG) — the ledger the qualification
                    # threshold is counted from. Keyed on the battle, so the
                    # same battle arriving from four tracked participants
                    # cannot advance anybody four times.
                    battle_rows.append((bid, t, r["battle_time"] or ""))
                    tags.add(t)
            if not got:
                unreadable += 1
            # HOLD THE CURSOR AT A PAYLOAD THAT MIGHT YET RESOLVE.
            #
            # PER SIDE, NOT PER PAYLOAD: a battle where one side carries an
            # unknown card still yields the OTHER side's pair, so `got` is
            # true and the payload looks handled -- while half of it was
            # silently dropped. The first version of this check tested `got`
            # and missed exactly that case.
            if _retryable(problems) > retryable_before:
                stamp = r["stored_at"] or ""
                if stamp and (blocked_at is None or stamp < blocked_at):
                    blocked_at = stamp

        if len(stage_rows) >= _READ_BATCH:
            sides += _flush(con, stage_rows, player_rows, battle_rows)
            stage_rows, player_rows, battle_rows = [], [], []

    if stage_rows:
        sides += _flush(con, stage_rows, player_rows, battle_rows)

    if blocked_at:
        # THE CURSOR IS A PROMISE THAT EVERYTHING AT OR BELOW IT IS PROCESSED,
        # so one unresolvable payload caps it for the whole run -- later
        # successes do not "jump over" it.
        #
        # THIS IS NOT HYPOTHETICAL. When Minion Giant shipped and this host's
        # card catalog was a commit behind, 81,941 sides resolved to nothing.
        # Under a cursor that advanced anyway, the raw cap would have deleted
        # every one of those battles instead of waiting for the catalog fix --
        # turning "deploy the card file and re-run" into permanent loss.
        #
        # An index range scan on ix_raw_stored, not a table scan.
        row = src.execute(
            "SELECT MAX(stored_at) m FROM battle_raw WHERE stored_at < ?",
            (blocked_at,),
        ).fetchone()
        capped = (row["m"] if row else None) or ""
        # NEVER REGRESS below where we already were: rows at or below `since`
        # were processed by an earlier run and are still processed.
        high = capped if capped and capped >= (since or "") else (since or "")

    battles = con.execute("SELECT COUNT(DISTINCT battle_id) c FROM duo_stage").fetchone()["c"]
    return {"payloads": seen_payloads, "battles": battles, "sides": sides,
            "blockedAt": blocked_at, "retryable": _retryable(problems),
            "unreadable": unreadable, "tags": tags, "watermark": high,
            "sidesAttempted": sides_attempted, "sidesResolved": sides_yielded,
            "touched": touched,
            "problems": dict(sorted(problems.items(), key=lambda kv: (-kv[1], kv[0])))}


def _flush(con, stage_rows, player_rows, battle_rows=()) -> int:
    """Write a staging batch. `INSERT OR IGNORE` IS THE DEDUPLICATION.

    A battle stored under several tracked players arrives here several times
    with the same `(battle_id, side)`, and the primary key rejects the repeats.
    Returns how many staging rows were genuinely new.

    **`total_changes`, NOT `COUNT(*)`.** The first version bracketed each batch
    with two `SELECT COUNT(*) FROM duo_stage`, which is a full scan of a table
    on its way to two million rows, a few hundred times over — quadratic work
    to compute a number SQLite already tracks. `total_changes` is a running
    total on the connection and costs nothing.
    """
    before = con.total_changes
    con.executemany(
        "INSERT OR IGNORE INTO duo_stage "
        "(battle_id, side, pair_fp, deck_a_fp, deck_b_fp, deck_a, deck_b, "
        " battle_time, game_mode) VALUES (?,?,?,?,?,?,?,?,?)",
        stage_rows,
    )
    inserted = con.total_changes - before
    con.executemany(
        "INSERT OR IGNORE INTO duo_stage_players (pair_fp, tag) VALUES (?,?)",
        player_rows,
    )
    if battle_rows:
        con.executemany(
            "INSERT OR IGNORE INTO duo_battle_players "
            "(battle_id, tag, battle_time, counted) VALUES (?,?,?,0)",
            battle_rows,
        )
    con.commit()
    return inserted


def _fold(con, only=None) -> int:
    """Collapse the staging tables into pair records. Returns unique pairs.

    IN SQL, NOT IN PYTHON. Roughly 2.2M staged sides and 3.9M participant rows
    would be hundreds of megabytes of dictionaries and sets held for the length
    of the run; SQLite does the same grouping against disk.

    **`only` IS WHAT MAKES AN HOURLY JOB AFFORDABLE.** A full fold rebuilds
    every pair record from every staged side — measured at **9 minutes** on the
    live collection, which is a 15% duty cycle against a spinning volume this
    box also runs the bot and the API on. An incremental run has usually
    touched a few hundred partnerships out of 1.28M, so it refreshes those and
    leaves the rest alone.

    Passing `None` means a full rebuild, and only a full migration does that.
    """
    if only is None:
        con.execute("DELETE FROM duo_pairs")
        scope, args = "", ()
    elif not only:
        # Nothing new. Not an error — it is what most hourly runs find.
        return con.execute("SELECT COUNT(*) c FROM duo_pairs").fetchone()["c"]
    else:
        scope = " WHERE s.pair_fp IN (%s)" % ",".join("?" for _ in only)
        args = tuple(only)
    con.execute(
        """
        INSERT INTO duo_pairs
            (pair_fingerprint, mode, deck_a_fingerprint, deck_b_fingerprint,
             deck_a_cards, deck_b_cards, occurrences, distinct_players,
             player_tags, first_seen, last_seen, source_modes)
        SELECT s.pair_fp,
               '{mode}',
               MIN(s.deck_a_fp),
               MIN(s.deck_b_fp),
               MIN(s.deck_a),
               MIN(s.deck_b),
               -- ONE BATTLE, ONE OCCURRENCE. The staging key already made a
               -- battle unique, so this counts battles and not rows.
               COUNT(*),
               (SELECT COUNT(*) FROM duo_stage_players p WHERE p.pair_fp = s.pair_fp),
               COALESCE((SELECT json_group_array(t) FROM
                   (SELECT tag AS t FROM duo_stage_players p
                     WHERE p.pair_fp = s.pair_fp ORDER BY tag LIMIT {sample})), '[]'),
               MIN(s.battle_time),
               MAX(s.battle_time),
               (SELECT group_concat(DISTINCT game_mode) FROM duo_stage x
                 WHERE x.pair_fp = s.pair_fp)
        FROM duo_stage s
        {scope}
        GROUP BY s.pair_fp
        ON CONFLICT(pair_fingerprint) DO UPDATE SET
            occurrences      = excluded.occurrences,
            distinct_players = excluded.distinct_players,
            player_tags      = excluded.player_tags,
            first_seen       = excluded.first_seen,
            last_seen        = excluded.last_seen,
            source_modes     = excluded.source_modes
        """.format(scope=scope, mode=MODE, sample=TAG_SAMPLE),
        args,
    )
    con.commit()
    return con.execute("SELECT COUNT(*) c FROM duo_pairs").fetchone()["c"]


def _roll_participants(con, replace: bool) -> int:
    """Fold the battle ledger into `duo_participants`. Returns the count.

    **TWO MODES, AND CONFLATING THEM MAKES COUNTS GO BACKWARDS.** The bug this
    exists to avoid, caught before the scheduler was switched on:

      1. a player outside the top-N has 2 battles; the ledger holds both;
      2. `reconcile_population` prunes them and deletes those two rows, which
         is the entire point of the bound;
      3. they play a third battle, so the ledger now holds exactly ONE row;
      4. a roll that RECOMPUTED `battles = COUNT(*)` would write **1**.

    Their count would fall from 2 to 1 on the battle that should have taken
    them to 3. That number decides both qualification and the ranking for the
    retained population, so the bound would quietly stop being recalculable —
    the one property it was designed to have.

      * `replace=True` — a FULL migration, which re-stages every battle and so
        rebuilds the complete ledger before this runs. Recomputing is correct
        there, and repairs any drift.
      * `replace=False` — an incremental run, which only ever sees new rows. It
        ADDS the uncounted ones, so a pruned history is neither recounted nor
        subtracted.

    `enrolled_at` is carried over in both: it records that somebody was queued,
    which stays true whatever their battle count later becomes.
    """
    if replace:
        con.execute(
            """
            INSERT INTO duo_participants (tag, battles, first_seen, last_seen, enrolled_at)
            SELECT tag, COUNT(*), MIN(battle_time), MAX(battle_time), ''
            FROM duo_battle_players
            GROUP BY tag
            ON CONFLICT(tag) DO UPDATE SET
                battles    = excluded.battles,
                first_seen = MIN(duo_participants.first_seen, excluded.first_seen),
                last_seen  = MAX(duo_participants.last_seen, excluded.last_seen)
            """
        )
    else:
        con.execute(
            """
            INSERT INTO duo_participants (tag, battles, first_seen, last_seen, enrolled_at)
            SELECT tag, COUNT(*), MIN(battle_time), MAX(battle_time), ''
            FROM duo_battle_players WHERE counted = 0
            GROUP BY tag
            ON CONFLICT(tag) DO UPDATE SET
                battles    = duo_participants.battles + excluded.battles,
                first_seen = MIN(duo_participants.first_seen, excluded.first_seen),
                last_seen  = MAX(duo_participants.last_seen, excluded.last_seen)
            """
        )
    # IDEMPOTENT BY THIS LINE. A second roll finds nothing uncounted and adds
    # nothing, which is what makes the scheduled job safe to run repeatedly.
    con.execute("UPDATE duo_battle_players SET counted = 1 WHERE counted = 0")
    con.commit()
    return con.execute("SELECT COUNT(*) c FROM duo_participants").fetchone()["c"]


def processed_through() -> str:
    """The `stored_at` cursor this pipeline has folded 2v2 raw payloads through.

    **THIS IS A SAFETY INTERLOCK, NOT A STATISTIC.** Since phase 2 the bot no
    longer writes 2v2 into `battles`, so for a window between arrival and the
    hourly fold the raw payload in `battle_raw` is the ONLY copy of that battle
    anywhere. The bot's `enforce_raw_cap` deletes non-duel raw to keep the disk
    bounded, and on 2026-09-10 it purged 4,763,318 rows including every 2v2
    payload then present. Anything it takes before this pipeline has folded it
    is gone from every table.

    `purge_non_duel_raw` in the bot ALREADY takes exactly this cursor — its
    `stored_through` parameter, documented as "the archive's confirmed raw
    INSERT cursor" — and its own docstring says that called without one it
    "deletes non-duel raw regardless of whether the archive has it —
    data-losing". Production reaches that unguarded path on every maintenance
    run because `flush_raw_stored` is absent (there is no archive on this host),
    so the coordinator takes its `else` branch. **The fix is to give that
    branch a cursor, not to weaken the cap.**

    WHY A ROW AT OR BELOW THIS VALUE IS GENUINELY SAFE TO DELETE. `_stage`
    reads `WHERE stored_at > watermark ORDER BY stored_at` and advances the
    high-water mark for EVERY row it reads. `stored_at` is set at INSERT, so it
    orders with insertion. A row inserted while a fold is running is not in
    that fold's read snapshot — but its `stored_at` is later than every row
    that IS in the snapshot, so it lands above the new watermark and the next
    run picks it up. The cursor can lag reality; it cannot overstate it.

    **FAILS CLOSED.** Any error — missing file, unreadable database, absent
    key — returns "", and an empty cursor must be read by the caller as
    "protect everything", never as "nothing to protect". That is the same
    convention `purge_non_duel_raw` already applies to its own empty cursor:
    `if not stored_through: return 0`.
    """
    try:
        _ensure()
        con = _connect()
        try:
            return _meta_get(con, "watermark", "") or ""
        finally:
            con.close()
    except Exception:
        return ""


def unprocessed_since(cursor: str = None) -> dict:
    """How much 2v2 raw is sitting unprocessed, for the operator.

    The figure that says whether the interlock is doing anything: if this
    stays at zero the fold is keeping up, and if it climbs the raw cap is being
    held off and the database is growing instead of losing data — the safe
    direction, and one worth noticing.
    """
    cursor = processed_through() if cursor is None else cursor
    path = cd.resolve_db_path()
    if not path:
        return {"cursor": cursor, "unprocessed": None, "error": "no database"}
    con = cd.connect(path)
    try:
        modes = _duo_modes(con)
        if not modes:
            return {"cursor": cursor, "unprocessed": 0}
        ph = ",".join("?" for _ in modes)
        if cursor:
            row = con.execute(
                f"SELECT COUNT(*) c FROM battle_raw WHERE game_mode IN ({ph}) "
                "AND (stored_at IS NULL OR stored_at > ?)", (*modes, cursor)
            ).fetchone()
        else:
            row = con.execute(
                f"SELECT COUNT(*) c FROM battle_raw WHERE game_mode IN ({ph})",
                tuple(modes)
            ).fetchone()
        return {"cursor": cursor, "unprocessed": row["c"]}
    finally:
        con.close()


def reconcile_population(limit: int = None, prune: bool = True) -> dict:
    """Recompute the bounded top-N population and prune the expensive tier.

    RANKED BY DISTINCT BATTLES DESCENDING, tag ascending as the tie-break so
    two people on the same count resolve the same way on every run — a
    ranking that reshuffles its own boundary would evict and re-admit the same
    pair of players forever.

    **IT RANKS FROM THE LIGHTWEIGHT TIER, WHICH IS WHY THE BOUND IS NOT A
    FREEZE.** `duo_participants.battles` is maintained for all 866,226
    participants at ~40 bytes each, so number 1,001 overtaking number 1,000 is
    visible here and is admitted on the next run. Ranking from the pruned
    ledger instead would make today's population permanent, because nobody
    outside it would ever accumulate a countable battle again.

    `prune=False` recomputes the marks and keeps every ledger row, which is
    what a dry run wants.
    """
    _ensure()
    limit = DUO_TOP_PLAYERS_LIMIT if limit is None else limit
    con = _connect()
    try:
        total = con.execute("SELECT COUNT(*) c FROM duo_participants").fetchone()["c"]
        con.execute("UPDATE duo_participants SET retained = 0 WHERE retained = 1")
        con.execute(
            """
            UPDATE duo_participants SET retained = 1 WHERE tag IN (
                SELECT tag FROM duo_participants
                ORDER BY battles DESC, tag LIMIT ?
            )
            """,
            (limit,),
        )
        retained = con.execute(
            "SELECT COUNT(*) c FROM duo_participants WHERE retained = 1"
        ).fetchone()["c"]
        cut = con.execute(
            "SELECT MIN(battles) c FROM duo_participants WHERE retained = 1"
        ).fetchone()["c"] or 0

        ledger_before = con.execute(
            "SELECT COUNT(*) c FROM duo_battle_players").fetchone()["c"]
        pruned = 0
        if prune:
            # THE EXPENSIVE TIER, CUT TO THE POPULATION. The pair records
            # themselves are NOT touched: a partnership is evidence about
            # decks, and it stays whether or not either player is important
            # enough to keep a per-battle history for.
            con.execute(
                "DELETE FROM duo_battle_players WHERE counted = 1 AND tag NOT IN "
                "(SELECT tag FROM duo_participants WHERE retained = 1)"
            )
            pruned = ledger_before - con.execute(
                "SELECT COUNT(*) c FROM duo_battle_players").fetchone()["c"]
        con.commit()
        _meta_set(con, "population_limit", limit)
        _meta_set(con, "population_cut", cut)
        _meta_set(con, "reconciled_at", _now())
        con.commit()
    finally:
        con.close()

    return {
        "participants": total,
        "limit": limit,
        "retained": retained,
        # THE BATTLE COUNT AT THE BOUNDARY. "Top 1,000" says how many; this
        # says how good you had to be, which is the figure that tells an
        # operator whether the limit is biting.
        "cutAtBattles": cut,
        "ledgerRowsBefore": ledger_before,
        "ledgerRowsPruned": pruned,
        "pruned": prune,
    }


def enrol_policy(threshold: int = QUALIFY_BATTLES, ceiling: int = None,
                 dry: bool = False) -> dict:
    """Promote QUALIFYING 2v2 participants into tracking, and no others.

    THE POLICY, and the reason each half of it exists:

      * **A participant needs `threshold` DISTINCT BATTLES.** 866,226 people
        were seen in 2v2 against a roster of 4,910. One battle is somebody you
        happened to be matched with; three is somebody who plays 2v2. Counted
        from `duo_battle_players`, whose primary key is `(battle_id, tag)`, so
        one battle reaching us from four participants cannot advance anyone
        four times.
      * **The 12,000 ceiling is absolute**, and it is `recruit.CEILING` rather
        than a second number — one cap on the collection, not one per source.
      * **Over the ceiling, the most-seen qualify first.** `recruit.enqueue`
        truncates its input in order, so ranking by battle count descending
        before calling it IS the priority rule; there is no second sort.

    **IT REUSES `recruit.enqueue` RATHER THAN REIMPLEMENTING THE CAP.** That
    function already counts a queued tag as spent — "a queued tag is an
    enrolled tag that has not happened yet" — and a second implementation of a
    ceiling is two ceilings that will eventually disagree about the same
    roster.

    NOT ENROLLING SOMEBODY NEVER DISCARDS THEIR DATA. Their pair is stored,
    their battles are counted, and their candidacy persists; the only thing
    withheld is the decision to spend polling and storage on them. Those are
    different questions and this function only answers the second.
    """
    _ensure()
    ceiling = recruit.CEILING if ceiling is None else ceiling
    # WHO IS ALREADY COLLECTED, read ONCE and up front. An already-tracked
    # participant is not a candidate at all — not a rejected one, not a
    # deferred one — and must never occupy a slot or appear in a ranking that
    # decides who gets the last one.
    try:
        tracked = tracking.bot_tracked_set()
    except Exception:
        tracked = set()

    con = _connect()
    try:
        total = con.execute("SELECT COUNT(*) c FROM duo_participants").fetchone()["c"]
        below = con.execute(
            "SELECT COUNT(*) c FROM duo_participants WHERE battles < ?", (threshold,)
        ).fetchone()["c"]
        # RANKED HERE, so the truncation inside `recruit.enqueue` keeps the
        # most-observed participants rather than an arbitrary slice.
        qualified = [
            r["tag"] for r in con.execute(
                "SELECT tag FROM duo_participants WHERE battles >= ? "
                "ORDER BY battles DESC, tag", (threshold,)
            ).fetchall()
        ]
    finally:
        con.close()

    already = [t for t in qualified if t in tracked]
    eligible = [t for t in qualified if t not in tracked]

    if not PROMOTION_ENABLED:
        # SHIPS DARK. Everything above is computed exactly as a live run would
        # compute it, so the report is the truth about what would happen; only
        # the write is withheld. See `PROMOTION_ENABLED`.
        dry = True

    if dry:
        # WHAT WOULD HAPPEN, computed against the real ceiling and the real
        # roster, writing nothing. An earlier version faked this by passing
        # `ceiling=0`, which reports every candidate as blocked and answers a
        # question nobody asked.
        queued = tracking.queued_tags()
        fresh = [t for t in eligible if t not in queued]
        room = max(0, ceiling - (len(tracked) + len(queued)))
        would = min(len(fresh), room)
        report = {
            "skippedTracked": len(already),
            "skippedQueued": sum(1 for t in eligible if t in queued),
            "added": would, "ceiling": ceiling, "tracked": len(tracked),
            "queued": len(queued), "cappedByCeiling": len(fresh) > room,
        }
    else:
        report = recruit.enqueue(eligible, "2v2", ceiling=ceiling)
        # `enqueue` counts what IT skipped, and `eligible` already excludes
        # tracked participants — so its own figure is always 0 here. The count
        # that belongs in this report is how many QUALIFIED participants were
        # already being collected, which only this function knows.
        report["skippedTracked"] = len(already)

    # Stamp who we actually queued, so a later rebuild does not re-offer them
    # and the console can say when somebody was promoted.
    if report["added"] and not dry:
        queued_now = tracking.queued_tags()
        con = _connect()
        try:
            con.executemany(
                "UPDATE duo_participants SET enrolled_at = ? "
                "WHERE tag = ? AND enrolled_at = ''",
                [(_now(), t) for t in eligible if t in queued_now],
            )
            con.commit()
        finally:
            con.close()

    n_eligible = len(eligible)
    return {
        "participantsDiscovered": total,
        "alreadyTracked": report["skippedTracked"],
        "alreadyQueued": report["skippedQueued"],
        "belowThreshold": below,
        "threshold": threshold,
        # ELIGIBLE MEANS QUALIFIED AND UNTRACKED. A tracked participant is
        # counted under `alreadyTracked` and nowhere else, so the buckets
        # partition the population instead of overlapping.
        "qualified": len(qualified),
        "eligible": n_eligible,
        "newlyEnrolled": report["added"] if PROMOTION_ENABLED and not dry else 0,
        "wouldEnrol": report["added"],
        # WHAT THE CEILING COST, stated as a number rather than a flag. A
        # boolean says a limit was hit; this says how many real candidates it
        # turned away, which is the figure that decides whether to raise it.
        "blockedByCeiling": max(
            0, n_eligible - report["skippedQueued"] - report["added"]),
        "promotionEnabled": PROMOTION_ENABLED,
        "ceiling": report["ceiling"],
        "trackedNow": report["tracked"],
        "queuedNow": report["queued"],
        "cappedByCeiling": report["cappedByCeiling"],
        "dryRun": dry,
    }


def migrate(since: str | None = None, enrol: bool = True) -> dict:
    """Phase 1: build the pair collection from the surviving raw payloads.

    **IT DELETES NOTHING.** Not from `battles`, not from `battle_raw`. Phase 2
    (the bot no longer writing 2v2 into `battles`) and the aggregate rebuild
    both have to land before a historical cleanup is even safe to consider, and
    both are outside this repository.

    SAFE TO RUN REPEATEDLY. The staging tables are keyed on the battle's own
    identity so a second pass re-inserts nothing, and `_fold` rewrites
    `duo_pairs` wholesale from staging rather than adding to it — so occurrence
    counts cannot double, which is the failure a merge-style rebuild would have.

    `since` limits the read to payloads STORED after a watermark. `stored_at`
    is arrival time, which is the correct thing to watermark on: a battle that
    arrives late carrying an old `battleTime` still has a current `stored_at`,
    where a `battle_time` watermark would miss it forever — the fault that left
    `player_stats_agg` 48% short of the live table.
    """
    _ensure()
    started = time.time()
    path = cd.resolve_db_path()
    if not path:
        raise RuntimeError("no readable database")
    # BEFORE THE SCAN, NOT DURING IT. Without card ids nothing can be read, and
    # discovering that after a quarter of an hour of streaming JSON is the
    # difference between an error and a wasted afternoon.
    _card_map()

    # COVERAGE IS A FULL-SCAN REPORT AND AN INCREMENTAL RUN MUST NOT PAY FOR
    # IT. It answers "how much of the historical 2v2 in `battles` has a
    # surviving payload", which is a fact about rows that already exist — it
    # cannot change because a new battle arrived, and after phase 2 no new 2v2
    # row enters `battles` at all. Computing it needs `_duo_modes`' DISTINCT
    # over a 44.7 GB table plus two LEFT JOINs, and it was **the whole 9.6
    # minutes** of a scheduled run whose actual work is an index seek. The
    # stored figures are reused instead, and a full migration refreshes them.
    if since is None:
        cov = coverage()
    else:
        con = _connect()
        try:
            cov = {
                "rows": int(_meta_get(con, "rows_2v2", "0") or 0),
                "reconstructable": int(_meta_get(con, "reconstructable", "0") or 0),
                "unreconstructable": int(
                    _meta_get(con, "unreconstructable", "0") or 0),
                "modes": json.loads(_meta_get(con, "source_modes", "[]") or "[]"),
                # WITHHELD rather than restated from a previous run: the monthly
                # split is the part most likely to be read as current.
                "byMonth": [],
            }
        finally:
            con.close()

    src = cd.connect(path)
    try:
        con = _connect()
        try:
            staged = _stage(con, src, since)
            pairs = _fold(con, None if since is None else staged["touched"])
            participants = _roll_participants(con, replace=since is None)
        finally:
            con.close()
        # THE BOUND IS APPLIED AS PART OF THE MIGRATION, not left for somebody
        # to remember. A rebuild that repopulated the full 3.8M-row ledger and
        # then relied on a separate command to trim it would be unbounded for
        # however long that gap lasted.
        population = reconcile_population()
        con = _connect()
        try:
            _meta_set(con, "watermark", staged["watermark"])
            _meta_set(con, "built_at", _now())
            _meta_set(con, "rows_2v2", cov["rows"])
            _meta_set(con, "reconstructable", cov["reconstructable"])
            _meta_set(con, "unreconstructable", cov["unreconstructable"])
            _meta_set(con, "source_modes", json.dumps(cov["modes"]))
            _meta_set(con, "battles_folded", staged["battles"])
            _meta_set(con, "payloads_read", staged["payloads"])
            occ = con.execute(
                "SELECT COALESCE(SUM(occurrences),0) c FROM duo_pairs"
            ).fetchone()["c"]
            con.commit()
        finally:
            con.close()
    finally:
        src.close()

    # THE ENROLMENT IS A SEPARATE DECISION FROM THE AGGREGATION, and runs
    # after it for that reason: a participant who does not qualify still has
    # their pair stored and their battles counted. `enrol=False` builds the
    # collection and promotes nobody, which is what a dry run wants.
    enrolment = enrol_policy() if enrol else {
        "participantsDiscovered": participants, "newlyEnrolled": 0,
        "note": "enrolment skipped",
    }

    return {
        # The report the requirement asks for, in its own words.
        "rows2v2": cov["rows"],
        "reconstructable": cov["reconstructable"],
        "unreconstructable": cov["unreconstructable"],
        "payloadsRead": staged["payloads"],
        "battlesDeduplicated": staged["battles"],
        "duplicatePayloads": max(0, staged["payloads"] - staged["battles"]),
        # ATTEMPTED - RESOLVED == the sum of `unresolvedReasons`, always. That
        # identity is what turns a shortfall into an explanation.
        "sidesAttempted": staged["sidesAttempted"],
        "sidesResolved": staged["sidesResolved"],
        "sidesUnresolved": staged["sidesAttempted"] - staged["sidesResolved"],
        "unresolvedReasons": staged["problems"],
        "sidesStaged": staged["sides"],
        "uniquePairs": pairs,
        "pairOccurrences": occ,
        "duplicateOccurrencesFolded": max(0, occ - pairs),
        "unreadablePayloads": staged["unreadable"],
        # WHERE THE CURSOR STOPPED, and why. Null means nothing blocked it and
        # every payload read was folded. A value means the raw cap is being
        # held off at that point until whatever made the payload unreadable is
        # fixed -- which is the safe direction, but not a state to sit in.
        "cursorBlockedAt": staged.get("blockedAt"),
        # Only retryable refusals hold the cursor; the count of those is what
        # says whether the block will clear on its own after a deploy.
        "retryableRefusals": staged.get("retryable", 0),
        "participants": participants,
        "population": population,
        # THE REPORT THE POLICY ASKS FOR, in its own terms. `discovered` is
        # every participant seen; the three lines under it partition them, and
        # `blockedByCeiling` is what a raised ceiling would buy.
        "enrolment": enrolment,
        # PHASE 1 DELETES NOTHING, and the report says so in the same figures
        # a destructive migration would have used to claim success.
        "rowsDeleted": 0,
        "rowsRemainingInBattles": cov["rows"],
        "byMonth": cov["byMonth"],
        "seconds": round(time.time() - started, 2),
    }


def _enrol_tags(tags, threshold: int, ceiling: int) -> list[str]:
    """Promote just these tags if they now qualify. Returns who was queued.

    The ingestion-path counterpart to `enrol_policy`. It looks at the handful
    of participants in ONE battle instead of ranking the whole table, because
    this runs per battle and the table has 866,226 rows in it.

    **IT STILL GOES THROUGH `recruit.enqueue`**, so the 12,000 ceiling is
    enforced by the same code and against the same tracked-plus-queued count as
    every other source. A per-battle shortcut that checked the cap its own way
    would be a second ceiling.
    """
    if not tags or not PROMOTION_ENABLED:
        # ONE GATE FOR BOTH PATHS. The bulk historical promotion and the
        # per-battle one are the same decision about the same roster, and a
        # flag that stopped only the bulk one would let the collection fill up
        # anyway, two players at a time, while appearing to be switched off.
        return []
    _ensure()
    con = _connect()
    try:
        rows = con.execute(
            "SELECT tag FROM duo_participants WHERE battles >= ? AND enrolled_at = '' "
            "AND tag IN (%s) ORDER BY battles DESC, tag"
            % ",".join("?" for _ in tags),
            (threshold, *tags),
        ).fetchall()
    finally:
        con.close()
    ready = [r["tag"] for r in rows]
    if not ready:
        return []
    before = tracking.queued_tags()
    recruit.enqueue(ready, "2v2", ceiling=ceiling)
    after = tracking.queued_tags()
    queued = sorted(after - before)
    if queued:
        con = _connect()
        try:
            con.executemany(
                "UPDATE duo_participants SET enrolled_at = ? WHERE tag = ?",
                [(_now(), t) for t in queued],
            )
            con.commit()
        finally:
            con.close()
    return queued


def observe(payload: dict, game_mode: str = "", enrol: bool = True,
            threshold: int = QUALIFY_BATTLES, ceiling: int = None) -> dict:
    """Take ONE 2v2 battle. The phase-2 ingestion entry point.

    **THE PAIR IS ALWAYS STORED; THE TRACKING DECISION IS SEPARATE.** A
    participant who has not yet qualified still has their partnership recorded
    and their battle counted — the only thing withheld is spending polling and
    storage on them. Conflating the two would mean throwing away a real deck
    pairing because nobody in it was famous enough yet.

    IDEMPOTENT ON THE BATTLE, not on the call. `duo_stage`'s
    `PRIMARY KEY (battle_id, side)` is what makes a repeat a no-op, so the same
    battle delivered twice — which is the normal case, once per tracked
    participant — advances no occurrence count and no participant total.

    Returns what happened, so a caller can log it and an acceptance test can
    assert it.
    """
    mode = game_mode or ((payload.get("gameMode") or {}).get("name") or "")
    if not bm.is_duo(mode):
        return {"duo": False, "mode": mode}

    _ensure()
    ceiling = recruit.CEILING if ceiling is None else ceiling
    bid = battle_identity(payload)
    if not bid:
        return {"duo": True, "stored": False, "reason": "no_battle_identity"}

    problems: dict[str, int] = {}
    found = list(pairs_from_payload(payload, problems))
    if not found:
        return {"duo": True, "stored": False, "reason": "no_readable_side",
                "problems": problems, "retryable": _retryable(problems)}

    when = (payload.get("battleTime") or "").strip()
    con = _connect()
    try:
        # PER SIDE, NOT PER BATTLE. The guard used to be
        # `SELECT 1 FROM duo_stage WHERE battle_id = ?`, which meant a battle
        # whose team side failed on an unknown card and whose opponent side
        # succeeded could NEVER be completed: the second call saw the battle
        # id already present and returned "duplicate", so the missing half was
        # lost even after the catalog was fixed. The staging key is
        # `(battle_id, side)` and the retry has to ask the same question.
        already = {r["side"] for r in con.execute(
            "SELECT side FROM duo_stage WHERE battle_id = ?", (bid,)).fetchall()}

        fresh, tags = [], []
        for side, fp_a, fp_b, deck_a, deck_b, side_tags in found:
            pair_fp = pair_fingerprint(fp_a, fp_b)
            if not pair_fp:
                problems["no_pair_fingerprint"] = problems.get("no_pair_fingerprint", 0) + 1
                continue
            tags.extend(side_tags)
            if side in already:
                continue                      # this half is already recorded
            con.execute(
                "INSERT OR IGNORE INTO duo_stage (battle_id, side, pair_fp, "
                "deck_a_fp, deck_b_fp, deck_a, deck_b, battle_time, game_mode) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (bid, side, pair_fp, fp_a, fp_b, json.dumps(deck_a),
                 json.dumps(deck_b), when, mode),
            )
            for t in side_tags:
                con.execute(
                    "INSERT OR IGNORE INTO duo_stage_players (pair_fp, tag) VALUES (?,?)",
                    (pair_fp, t))
                con.execute(
                    "INSERT OR IGNORE INTO duo_battle_players "
                    "(battle_id, tag, battle_time, counted) VALUES (?,?,?,0)",
                    (bid, t, when))
            fresh.append(pair_fp)
        con.commit()

        if not fresh:
            # Nothing new: the same battle arriving again from another tracked
            # participant, which is the normal case rather than an error.
            return {"duo": True, "stored": False, "duplicate": True,
                    "battleId": bid, "problems": problems,
                    "retryable": _retryable(problems)}

        # THE SAME TWO CALLS THE BATCH PATH MAKES, on just what changed.
        # `_fold` RECOMPUTES each touched pair from `duo_stage` rather than
        # incrementing it, which is what makes completing a half-staged battle
        # safe: the side already recorded is counted once, not twice. The
        # earlier hand-rolled `occurrences + 1` upsert here could not have that
        # property, and keeping two implementations of "what a pair record is"
        # is how they would eventually disagree.
        _fold(con, set(fresh))
        _roll_participants(con, replace=False)
    finally:
        con.close()

    enrolled = _enrol_tags(sorted(set(tags)), threshold, ceiling) if enrol else []
    return {"duo": True, "stored": True, "battleId": bid, "pairs": fresh,
            "participants": sorted(set(tags)), "enrolled": enrolled,
            "problems": problems, "retryable": _retryable(problems)}


def update() -> dict:
    """Fold in payloads stored since the last run. See `migrate`."""
    _ensure()
    con = _connect()
    try:
        mark = _meta_get(con, "watermark", "")
        # HAS THE LEDGER BEEN PRUNED? If it has, a full rebuild is the ONLY
        # safe way to recompute participant counts — and this function must
        # never silently become one, because a full rebuild recomputes from
        # whatever the ledger currently holds, which after a prune is a
        # fraction of the history.
        pruned = con.execute(
            "SELECT COUNT(*) c FROM duo_participants WHERE retained = 0 "
            "AND battles > 0"
        ).fetchone()["c"]
    finally:
        con.close()

    if not mark and pruned:
        # No watermark AND a pruned ledger: a full pass would recompute
        # everyone's count from the survivors and drive most of them to zero.
        # Refuse rather than corrupt; `--migrate` is the deliberate way to
        # rebuild, and it re-stages every payload first so the ledger is whole
        # again before anything is recomputed.
        raise RuntimeError(
            "no watermark and the ledger has been pruned — run --migrate "
            "to rebuild, which restages every payload before recomputing"
        )
    return migrate(since=mark or None)


# --------------------------------------------------------------------------
# Reading it
# --------------------------------------------------------------------------

def _deck_view(raw) -> list[dict]:
    try:
        keys = json.loads(raw or "[]")
    except Exception:
        keys = []
    out = []
    for k in keys:
        info = dx.card_info(k)
        out.append({
            "key": k,
            "id": info.get("id") or 0,
            "name": info.get("name") or k,
            "elixir": info.get("elixir") or 0,
        })
    return out


def _pair_row(row) -> dict:
    a, b = _deck_view(row["deck_a_cards"]), _deck_view(row["deck_b_cards"])

    def elixir(cards):
        vals = [c["elixir"] for c in cards if c["elixir"]]
        return round(sum(vals) / len(vals), 2) if vals else 0

    try:
        tags = json.loads(row["player_tags"] or "[]")
    except Exception:
        tags = []
    return {
        "pairFingerprint": row["pair_fingerprint"],
        "mode": row["mode"],
        "deckA": {
            "fingerprint": row["deck_a_fingerprint"],
            "cards": a,
            "cardKeys": [c["key"] for c in a],
            "cardIds": [c["id"] for c in a],
            "avgElixir": elixir(a),
        },
        "deckB": {
            "fingerprint": row["deck_b_fingerprint"],
            "cards": b,
            "cardKeys": [c["key"] for c in b],
            "cardIds": [c["id"] for c in b],
            "avgElixir": elixir(b),
        },
        "occurrences": row["occurrences"],
        "players": row["distinct_players"],
        # A SAMPLE, capped at TAG_SAMPLE, and named as one so nobody reads it
        # as the full roster. `players` is the exact count.
        "playerTags": tags,
        "firstSeen": row["first_seen"],
        "lastSeen": row["last_seen"],
        "sourceModes": [m for m in (row["source_modes"] or "").split(",") if m],
        "mirror": row["deck_a_fingerprint"] == row["deck_b_fingerprint"],
    }


def report(page: int = 1, per: int = PER_PAGE, query: str = "",
           sort: str = DEFAULT_SORT) -> dict:
    """One page of the unique 2v2 pairs.

    `sort` is a KEY into `SORTS`, never a column name — an unrecognised value
    falls back to the default rather than reaching the ORDER BY.
    """
    _ensure()
    per = max(1, min(MAX_PER_PAGE, per))
    sort = sort if sort in SORTS else DEFAULT_SORT
    order = SORTS[sort]
    con = _connect()
    try:
        where, args = "", []
        q = (query or "").strip().lower()
        if q:
            # CARD KEY, PAIR FINGERPRINT OR EITHER DECK FINGERPRINT. The deck
            # fingerprints are their own columns, so a search for one has to
            # name them — matching only the pair's would answer "no" for a
            # deck that really is in the collection, on half the identifiers
            # the board itself prints.
            where = ("WHERE lower(deck_a_cards) LIKE ? OR lower(deck_b_cards) LIKE ? "
                     "OR lower(pair_fingerprint) LIKE ? "
                     "OR lower(deck_a_fingerprint) LIKE ? "
                     "OR lower(deck_b_fingerprint) LIKE ?")
            args = ["%{}%".format(q)] * 5

        total = con.execute(
            "SELECT COUNT(*) c FROM duo_pairs " + where, args
        ).fetchone()["c"]
        pages = max(1, -(-total // per))
        page = max(1, min(pages, page))
        rows = con.execute(
            "SELECT * FROM duo_pairs " + where +
            " ORDER BY " + order + " LIMIT ? OFFSET ?",
            (*args, per, (page - 1) * per),
        ).fetchall()

        agg = con.execute(
            "SELECT COUNT(*) pairs, COALESCE(SUM(occurrences),0) occ, "
            "       MIN(first_seen) f, MAX(last_seen) l FROM duo_pairs"
        ).fetchone()
        built_at = _meta_get(con, "built_at")
        raw_modes = _meta_get(con, "source_modes", "[]")
        pop = {
            "all": con.execute(
                "SELECT COUNT(*) c FROM duo_participants").fetchone()["c"],
            "retained": con.execute(
                "SELECT COUNT(*) c FROM duo_participants WHERE retained = 1"
            ).fetchone()["c"],
            "limit": int(_meta_get(con, "population_limit",
                                   str(DUO_TOP_PLAYERS_LIMIT)) or 0),
            "cut": int(_meta_get(con, "population_cut", "0") or 0),
        }
        meta = {k: int(_meta_get(con, k, "0") or 0) for k in
                ("rows_2v2", "reconstructable", "unreconstructable", "battles_folded")}
    finally:
        con.close()

    try:
        source_modes = json.loads(raw_modes)
    except Exception:
        source_modes = []

    return {
        "pairs": [_pair_row(r) for r in rows],
        "page": page,
        "pages": pages,
        "perPage": per,
        "total": total,
        "query": query or "",
        "sort": sort,
        "sorts": sorted(SORTS),
        "summary": {
            "mode": MODE,
            "uniquePairs": agg["pairs"] or 0,
            "occurrences": agg["occ"] or 0,
            "battlesFolded": meta["battles_folded"],
            "firstSeen": agg["f"] or "",
            "lastSeen": agg["l"] or "",
            "sourceModes": source_modes,
            "builtAt": built_at,
            "built": bool(built_at),
            # THE HONEST HALF. `battles` still holds every 2v2 row — phase 1
            # deletes nothing — and 21.8% of them have no surviving payload, so
            # their partnership is unrecoverable and is NOT represented here.
            "rows2v2": meta["rows_2v2"],
            "reconstructable": meta["reconstructable"],
            "unreconstructable": meta["unreconstructable"],
            "phase": 1,
            # THE BOARD MUST NOT LOOK LIKE EVERY 2v2 PLAYER IN EXISTENCE.
            # `participants` is everybody ever seen; `population` is the
            # bounded set whose expensive detail is retained.
            "participants": pop["all"],
            "population": pop["retained"],
            "populationLimit": pop["limit"],
            "populationCut": pop["cut"],
        },
    }


def phase2_dry_run(threshold: int = QUALIFY_BATTLES,
                   limit: int = None) -> dict:
    """The pre-deployment report for phase 2. Writes nothing.

    Every figure is read from the collection this repository already built, so
    it describes what the bot-side change would meet on the day it ships rather
    than a projection. `actualEnrolled` is 0 by construction — historical bulk
    promotion has not been approved, and `PROMOTION_ENABLED` is off.
    """
    _ensure()
    limit = DUO_TOP_PLAYERS_LIMIT if limit is None else limit
    rep = report(per=1)
    pol = enrol_policy(threshold=threshold, dry=True)
    con = _connect()
    try:
        battles = con.execute(
            "SELECT COUNT(DISTINCT battle_id) c FROM duo_stage").fetchone()["c"]
        retained = con.execute(
            "SELECT COUNT(*) c FROM duo_participants WHERE retained = 1"
        ).fetchone()["c"]
        cut = int(_meta_get(con, "population_cut", "0") or 0)
        payloads = int(_meta_get(con, "payloads_read", "0") or 0)
    finally:
        con.close()

    return {
        # WITHHELD, NOT GUESSED, when the collection predates the key that
        # records it. A fallback to the battle count prints
        # `duplicatePerspectives: 0` — a confident claim that deduplication
        # found nothing, on a run where it folded 135,076 payloads. Same rule
        # as the retention runway saying "unknown".
        "2v2BattlesObserved": payloads or None,
        "uniqueActualBattles": battles,
        "duplicatePerspectives": (payloads - battles) if payloads else None,
        "uniqueTeammatePairs": rep["summary"]["uniquePairs"],
        "participantsDiscovered": pol["participantsDiscovered"],
        "alreadyTrackedParticipants": pol["alreadyTracked"],
        "newUntrackedParticipants":
            pol["participantsDiscovered"] - pol["alreadyTracked"],
        "participantsAtOrAboveThreshold": pol["qualified"],
        "eligibleParticipants": pol["eligible"],
        "wouldEnrol": pol["wouldEnrol"],
        # ZERO BY CONSTRUCTION. Not "none qualified" — none was promoted,
        # because the decision to spend the roster has not been taken.
        "actualEnrolled": 0,
        "promotionEnabled": PROMOTION_ENABLED,
        "threshold": threshold,
        "ceiling": pol["ceiling"],
        "trackedRoster": pol["trackedNow"],
        "populationLimit": limit,
        "populationRetained": retained,
        "populationCutAtBattles": cut,
        "unreconstructableHistorical": rep["summary"]["unreconstructable"],
    }


if __name__ == "__main__":  # pragma: no cover - operator entry point
    import argparse

    ap = argparse.ArgumentParser(
        description="phase 1: build unique 2v2 deck pairs. Deletes nothing.")
    ap.add_argument("--migrate", action="store_true",
                    help="rebuild the pair collection from every surviving payload")
    ap.add_argument("--update", action="store_true",
                    help="fold in payloads stored since the last run")
    ap.add_argument("--coverage", action="store_true",
                    help="report how much of the 2v2 population is reconstructable")
    ap.add_argument("--no-enrol", action="store_true",
                    help="build the collection and promote nobody")
    ap.add_argument("--enrol", action="store_true",
                    help="run the qualified enrolment policy on its own")
    ap.add_argument("--enrol-dry", action="store_true",
                    help="report who WOULD be promoted, and promote nobody")
    ap.add_argument("--threshold", type=int, default=QUALIFY_BATTLES,
                    help="distinct 2v2 battles required to qualify (default %d)"
                         % QUALIFY_BATTLES)
    ap.add_argument("--reconcile", action="store_true",
                    help="recompute the bounded top-N population and prune")
    ap.add_argument("--phase2-dry-run", action="store_true",
                    help="the pre-deployment report; writes nothing")
    ap.add_argument("--cursor", action="store_true",
                    help="print the stored_at cursor 2v2 raw is safe to purge "
                         "through, and how much is still unprocessed")
    ap.add_argument("--limit", type=int, default=DUO_TOP_PLAYERS_LIMIT,
                    help="population size (default %d)" % DUO_TOP_PLAYERS_LIMIT)
    ap.add_argument("--show", type=int, default=0, metavar="N",
                    help="print the top N pairs")
    opts = ap.parse_args()

    if opts.coverage:
        print(json.dumps(coverage(), indent=2))
    if opts.migrate:
        print(json.dumps(migrate(enrol=not opts.no_enrol), indent=2))
    if opts.update:
        print(json.dumps(update(), indent=2))
    if opts.enrol_dry:
        # CEILING 0 leaves no room, so `recruit.enqueue` queues nobody while
        # every other figure in the report is computed exactly as it would be
        # for real. A dry run that used a different code path would be
        # reporting on something other than what a live run does.
        print(json.dumps(enrol_policy(threshold=opts.threshold, dry=True),
                         indent=2))
    if opts.enrol:
        print(json.dumps(enrol_policy(threshold=opts.threshold), indent=2))
    if opts.reconcile:
        print(json.dumps(reconcile_population(limit=opts.limit), indent=2))
    if opts.cursor:
        print(json.dumps(unprocessed_since(), indent=2))
    if opts.phase2_dry_run:
        print(json.dumps(phase2_dry_run(threshold=opts.threshold,
                                        limit=opts.limit), indent=2))
    if opts.show:
        rep = report(page=1, per=min(opts.show, MAX_PER_PAGE))
        print(json.dumps(rep["summary"], indent=2))
        for p in rep["pairs"]:
            print("{:>7}x  {}".format(p["occurrences"], p["pairFingerprint"][:18]))
            print("          A: {}".format(", ".join(p["deckA"]["cardKeys"])))
            print("          B: {}".format(", ".join(p["deckB"]["cardKeys"])))
    if not (opts.migrate or opts.update or opts.show or opts.coverage
            or opts.enrol or opts.enrol_dry or opts.reconcile
            or opts.phase2_dry_run or opts.cursor):
        ap.print_help()
