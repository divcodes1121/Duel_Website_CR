"""test_duo_pairs.py — unique 2v2 deck pairs, and the phase-1 migration.

    python server/test_duo_pairs.py

Plain asserts and a counter, matching the other suites here. Real SQLite files
are opened; this module writes them into a temp directory. The deduplication is
a primary key and the aggregation is a `GROUP BY`, and neither can be tested
against a list of dicts.

THE FIXTURE IS SHAPED LIKE THE REAL PAYLOAD, which is the half this project
keeps paying for when it is skipped. `test_team_analysis.py` passed 59/59 while
reading a field that exists on no record; the Bo5 fixtures labelled a row `Bo5`
and gave it three decks. The payloads below carry `team`/`opponent` arrays of
two participants, each with a `cards` list of eight objects keyed by Supercell
`id`, plus a `supportCards` entry — every one of those details taken from a
real `battle_raw` row read off the live database on 2026-09-10.

WHAT IS WORTH TESTING, which is the half that is quietly wrong rather than
broken:

  * **A pair must be order-free at BOTH levels.** Eight cards sort, and the two
    deck fingerprints sort. If either leaks, the same partnership forks into
    several records and every occurrence count is wrong;
  * **one real battle must be one occurrence.** 51,671 2v2 rows have a tracked
    opponent, so the same battle is stored more than once — counting rows would
    inflate those pairs by up to 4x, and the result would look entirely
    plausible;
  * **a battle with no surviving payload must NOT become a pair.** Its second
    deck is unrecoverable, and inventing one from the single deck `battles`
    holds is fabrication. It has to be counted as unreconstructable instead;
  * **the migration must be safe to run twice**, because it will be;
  * **`supportCards` must not enter a deck.** It is the tower troop, and
    including it forks one real deck on tower choice alone;
  * **tag enrolment must be idempotent**, or a player in a thousand 2v2
    battles becomes a thousand queue rows.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import battle_modes as bm
import clash_data as cd
import duel_combos as dx
import duo_pairs as dp
import tracking

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


# --------------------------------------------------------------------------
# Cards, by the id the real payload uses
# --------------------------------------------------------------------------

def _ids(keys):
    return [dx.card_info(k).get("id") for k in keys]


HOG = ["knight", "hog-rider", "fireball", "tesla",
       "archers", "ice-spirit", "the-log", "skeletons"]
GIANT = ["giant", "musketeer", "zap", "mini-pekka",
         "arrows", "goblins", "cannon", "spear-goblins"]
BAIT = ["goblin-barrel", "princess", "rocket", "goblin-gang",
        "inferno-tower", "dart-goblin", "barbarian-barrel", "ice-golem"]
LAVA = ["lava-hound", "balloon", "mega-minion", "tombstone",
        "arrows", "skeleton-army", "fireball", "guards"]
# Two more, so that no partnership below is accidentally the same as another.
# The first draft reused HOG+GIANT as one battle's OPPONENT side and the pair
# legitimately counted three, which read as a dedup failure and was not one —
# a fixture whose arithmetic is ambiguous cannot prove the thing it is for.
MINER = ["miner", "poison", "bats", "valkyrie",
         "electro-wizard", "royal-ghost", "magic-archer", "mini-pekka"]
GOLEM = ["golem", "night-witch", "baby-dragon", "lightning",
         "tornado", "barbarian-barrel", "elixir-collector", "guards"]


def participant(tag, keys, crowns=1, shuffle=False):
    """One player as the CR API really serialises them."""
    ids = _ids(keys)
    order = list(zip(keys, ids))
    if shuffle:
        order = order[3:] + order[:3]
    return {
        "tag": tag,
        "name": "Player " + tag,
        "crowns": crowns,
        "cards": [
            {"name": k.replace("-", " ").title(), "id": i, "level": 14,
             "evolutionLevel": 0, "rarity": "common", "elixirCost": 3}
            for k, i in order
        ],
        # THE TOWER TROOP. Present on every real payload and not part of a deck.
        "supportCards": [{"name": "Tower Princess", "id": 159000000, "level": 14}],
    }


def payload(when, team, opp, mode="TeamVsTeam", shuffle=False):
    return {
        "battleTime": when,
        "gameMode": {"id": 72000006, "name": mode},
        "type": "teamVsTeam",
        "deckSelection": "collection",
        "team": [participant(t, k, shuffle=shuffle) for t, k in team],
        "opponent": [participant(t, k, crowns=0) for t, k in opp],
    }


# --------------------------------------------------------------------------
# A source database with KNOWN contents, in the bot's real schema
# --------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_tag TEXT, battle_time TEXT, game_mode TEXT,
    opponent_tag TEXT, opponent_name TEXT, result TEXT,
    player_deck_hash TEXT, player_card_keys TEXT, opponent_card_keys TEXT,
    player_win_condition TEXT, opponent_win_condition TEXT,
    opponent_deck_hash TEXT, player_crowns INTEGER, opponent_crowns INTEGER,
    player_evo TEXT, opponent_evo TEXT, player_hero TEXT, opponent_hero TEXT,
    player_towers TEXT, opponent_towers TEXT
);
CREATE TABLE battle_raw (
    player_tag TEXT NOT NULL, battle_time TEXT NOT NULL, game_mode TEXT,
    schema_version INTEGER, stored_at TEXT, raw_json TEXT NOT NULL,
    PRIMARY KEY (player_tag, battle_time)
);
CREATE TABLE tracked_players (tag TEXT PRIMARY KEY, added_at TEXT);
"""

# One battle both teammates are tracked for -> TWO raw rows, ONE real battle.
SHARED = payload("20260901T120000.000Z",
                 [("#AA", HOG), ("#BB", GIANT)], [("#CC", BAIT), ("#DD", LAVA)])
# The same battle as the OTHER teammate stored it: sides and order differ.
SHARED_MIRROR = payload("20260901T120000.000Z",
                        [("#BB", GIANT), ("#AA", HOG)], [("#DD", LAVA), ("#CC", BAIT)],
                        shuffle=True)
# The same PAIR again on another day, with different opponents.
AGAIN = payload("20260902T120000.000Z",
                [("#AA", HOG), ("#BB", GIANT)], [("#EE", LAVA), ("#FF", BAIT)])
# A different partnership entirely.
OTHER = payload("20260903T120000.000Z",
                [("#GG", BAIT), ("#HH", LAVA)], [("#II", MINER), ("#JJ", GOLEM)])

# THE ARITHMETIC THE ASSERTIONS BELOW REST ON, stated once so a future reader
# does not have to re-derive it from four payloads:
#
#   SHARED + SHARED_MIRROR  one real battle   team HOG+GIANT   opp BAIT+LAVA
#   AGAIN                   one real battle   team HOG+GIANT   opp BAIT+LAVA
#   OTHER                   one real battle   team BAIT+LAVA   opp MINER+GOLEM
#
#   -> 3 battles, 6 sides, 3 unique pairs
#   -> HOG+GIANT 2   BAIT+LAVA 3   MINER+GOLEM 1


class Promoting:
    """Turn live promotion on for one test.

    `PROMOTION_ENABLED` ships OFF — the mechanism is built and the decision to
    spend 7,083 roster slots on it is not taken — so every check that
    exercises enrolment has to say so explicitly. That is the point: a test
    suite that silently enabled it would stop being evidence about the shipped
    default.
    """

    def __enter__(self):
        self.was = dp.PROMOTION_ENABLED
        dp.PROMOTION_ENABLED = True
        return self

    def __exit__(self, *exc):
        dp.PROMOTION_ENABLED = self.was
        return False


class Fixture:
    def __init__(self, with_raw=True, unreconstructable=0):
        self.dir = tempfile.mkdtemp(prefix="duo-pairs-")
        self.src = os.path.join(self.dir, "battles.db")
        self.col = os.path.join(self.dir, "pairs.db")
        self.queue = os.path.join(self.dir, "tracking.db")
        con = sqlite3.connect(self.src)
        con.executescript(SCHEMA)

        def battle(tag, when, mode="TeamVsTeam", cards=HOG, opp="#CC"):
            con.execute(
                "INSERT INTO battles (player_tag, battle_time, game_mode, "
                "opponent_tag, result, player_deck_hash, player_card_keys, "
                "opponent_card_keys, player_crowns, opponent_crowns) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (tag, when, mode, opp, "win", "h", json.dumps(cards),
                 json.dumps(GIANT), 2, 0))

        def raw(tag, p, stored="2026-09-01T09:00:00+00:00"):
            con.execute(
                "INSERT INTO battle_raw (player_tag, battle_time, game_mode, "
                "stored_at, raw_json) VALUES (?,?,?,?,?)",
                (tag, p["battleTime"], p["gameMode"]["name"], stored,
                 json.dumps(p)))

        for tag, p in (("#AA", SHARED), ("#BB", SHARED_MIRROR),
                       ("#AA", AGAIN), ("#GG", OTHER)):
            battle(tag, p["battleTime"])
            if with_raw:
                raw(tag, p)

        # 2v2 rows whose payload is GONE. Their second deck is unrecoverable.
        for i in range(unreconstructable):
            battle("#ZZ", "20260701T%02d0000.000Z" % (i % 24))

        # A ladder row, which must be untouched by any of this.
        battle("#AA", "20260904T120000.000Z", mode="Ladder")

        con.execute("INSERT INTO tracked_players VALUES ('#AA', '2026-06-01')")
        con.commit()
        con.close()

    def __enter__(self):
        self._resolve, self._db, self._q = cd.resolve_db_path, dp.DB_PATH, tracking.DB_PATH
        cd.resolve_db_path = lambda: self.src
        dp.DB_PATH = self.col
        tracking.DB_PATH = self.queue
        dp._ready = tracking._ready = False
        # THE MODE MEMO IS KEYED TO NOTHING, so it must be cleared between
        # databases or a fixture inherits the previous one's answer. It is
        # memoised because `SELECT DISTINCT game_mode` is a full scan of a
        # 33 GB table in production; here the databases are tiny and change
        # every test, which is exactly the case the memo is unsafe for.
        dp._MODES_CACHE = None
        return self

    def __exit__(self, *exc):
        cd.resolve_db_path, dp.DB_PATH, tracking.DB_PATH = self._resolve, self._db, self._q
        dp._ready = tracking._ready = False
        dp._MODES_CACHE = None
        return False

    def battles_2v2(self):
        con = sqlite3.connect(self.src)
        try:
            return con.execute(
                "SELECT COUNT(*) FROM battles WHERE game_mode LIKE 'TeamVsTeam%'"
            ).fetchone()[0]
        finally:
            con.close()


# --------------------------------------------------------------------------
# Identity
# --------------------------------------------------------------------------

def test_a_deck_is_order_free() -> None:
    print("a deck's identity ignores card order")
    base = dp.deck_fingerprint(HOG)
    check("rotation", dp.deck_fingerprint(HOG[3:] + HOG[:3]) == base)
    check("reversal", dp.deck_fingerprint(list(reversed(HOG))) == base)
    check("case", dp.deck_fingerprint([c.upper() for c in HOG]) == base)
    check("a different deck differs", dp.deck_fingerprint(GIANT) != base)
    check("seven cards has no identity", dp.deck_fingerprint(HOG[:7]) == "")
    check("a duplicate makes it seven", dp.deck_fingerprint(HOG[:7] + ["knight"]) == "")


def test_a_pair_is_order_free() -> None:
    """The requirement in one assertion: A+B and B+A are the same pair."""
    print("\na pair's identity ignores which deck came first")
    a, b = dp.deck_fingerprint(HOG), dp.deck_fingerprint(GIANT)
    check("A+B == B+A", dp.pair_fingerprint(a, b) == dp.pair_fingerprint(b, a))
    check("a different partner is a different pair",
          dp.pair_fingerprint(a, b) != dp.pair_fingerprint(a, dp.deck_fingerprint(BAIT)))
    check("a mirror pair is legal", dp.pair_fingerprint(a, a) != "")
    check("a mirror is not the same as a mixed pair",
          dp.pair_fingerprint(a, a) != dp.pair_fingerprint(a, b))
    check("half a pair has no identity", dp.pair_fingerprint(a, "") == "")
    check("the mode is in the hash, not just the prefix",
          dp.pair_fingerprint(a, b).split(":")[1]
          != dp.pair_fingerprint(a, b, "ladder").split(":")[1])


def test_one_battle_has_one_identity_from_either_log() -> None:
    """THE PROPERTY THAT STOPS DOUBLE COUNTING. The same battle stored under
    two tracked teammates must reduce to one value, whichever side's log it
    came from and whatever order the arrays are in."""
    print("\none battle, one identity, whoever stored it")
    check("teammates' copies agree",
          dp.battle_identity(SHARED) == dp.battle_identity(SHARED_MIRROR))
    check("a different battle differs",
          dp.battle_identity(SHARED) != dp.battle_identity(AGAIN))
    check("a payload with no tags has no identity",
          dp.battle_identity({"battleTime": "T", "team": [], "opponent": []}) == "")
    check("a payload with no time has no identity",
          dp.battle_identity({"team": [{"tag": "#A"}]}) == "")


def test_the_tower_troop_is_not_in_the_deck() -> None:
    """`supportCards` is on every real payload. Including it would make every
    deck nine cards and fork one real deck on tower choice alone."""
    print("\nsupportCards is excluded from the deck")
    part = participant("#AA", HOG)
    check("the fixture really carries one", len(part["supportCards"]) == 1)
    check("eight cards come back", len(dp.deck_from_participant(part)) == 8)
    check("it is the deck, not the deck plus a tower",
          dp.deck_from_participant(part) == sorted(HOG))


def test_an_unknown_card_refuses_the_deck() -> None:
    """A card id this deployment predates must not silently become a
    seven-card deck wearing a real deck's identity."""
    print("\nan unknown card id refuses the whole deck")
    part = participant("#AA", HOG)
    part["cards"][2]["id"] = 99999999
    check("no deck", dp.deck_from_participant(part) == [])
    short = participant("#AA", HOG)
    short["cards"] = short["cards"][:7]
    check("seven cards is no deck", dp.deck_from_participant(short) == [])


def test_a_refusal_says_which_card_and_why() -> None:
    """THE LESSON FROM THE FIRST LIVE RUN. 81,941 sides were refused and the
    report could only say so — one absent card (Minion Giant, id 26000107)
    explained every single one, and nothing in the output could say that. A
    refusal that cannot be named is indistinguishable from data that never
    existed, and the fix for this one was a deploy rather than an
    investigation."""
    print("")
    print("a refusal names the exact card that caused it")
    # A CARD ID NO CATALOG KNOWS. It must not be Minion Giant's real 26000107:
    # this repo's `cards.json` has carried that since season 87, so the first
    # draft of this test asserted it was unknown and failed — which is the
    # same fact, from the other side, as the live host having been a commit
    # behind and refusing 81,941 sides.
    part = participant("#AA", HOG)
    part["cards"][2]["id"] = 99999999
    keys, why = dp.deck_and_reason(part)
    check("no deck", keys == [])
    check("the reason names the id", why == "unknown_card:99999999", why)
    check("Minion Giant IS known to this catalog",
          dp._card_map().get(26000107) == "minion-giant",
          str(dp._card_map().get(26000107)))

    short = participant("#AA", HOG)
    short["cards"] = short["cards"][:7]
    check("a short deck says so", dp.deck_and_reason(short)[1] == "not_eight_cards:7",
          dp.deck_and_reason(short)[1])

    dupe = participant("#AA", HOG)
    dupe["cards"][1] = dict(dupe["cards"][0])
    check("a duplicated card says so",
          dp.deck_and_reason(dupe)[1] == "duplicate_cards:7",
          dp.deck_and_reason(dupe)[1])

    good, why = dp.deck_and_reason(participant("#AA", HOG))
    check("a readable deck has no reason", why == "" and len(good) == 8, why)


def test_every_unresolved_side_is_accounted_for() -> None:
    """THE IDENTITY THE RECONCILIATION RESTS ON:

        sides attempted - sides resolved == sum of the reason counters

    Without it a shortfall is visible and unexplainable, which is exactly the
    state the first live run left. With it, every refused side has a cause that
    can be named and counted."""
    print("")
    print("attempted minus resolved equals the reasons, exactly")
    problems = {}
    got = list(dp.pairs_from_payload(SHARED, problems))
    check("a clean payload yields two sides", len(got) == 2)
    check("...and records no problems", problems == {}, str(problems))

    broken = payload("20260905T120000.000Z",
                     [("#KK", HOG), ("#LL", GIANT)], [("#MM", BAIT), ("#NN", LAVA)])
    broken["team"][0]["cards"][0]["id"] = 99999999   # a card no catalog knows
    broken["opponent"] = broken["opponent"][:1]      # and a malformed side
    problems = {}
    got = list(dp.pairs_from_payload(broken, problems))
    check("neither side survives", len(got) == 0, str(len(got)))
    check("2 attempted - 0 resolved == 2 reasons",
          sum(problems.values()) == 2, str(problems))
    check("the unknown card is named",
          "unknown_card:99999999" in problems, str(problems))
    check("the malformed side is named",
          "side_not_two_participants:1" in problems, str(problems))


def test_the_migration_report_balances() -> None:
    """The same identity, end to end through a real migration."""
    print("")
    print("the migration's own report balances")
    with Fixture():
        out = dp.migrate(enrol=False)
        check("attempted - resolved == sum of reasons",
              out["sidesAttempted"] - out["sidesResolved"]
              == sum(out["unresolvedReasons"].values()),
              str(out["sidesAttempted"]) + " - " + str(out["sidesResolved"])
              + " vs " + str(sum(out["unresolvedReasons"].values())))
        check("a clean fixture leaves nothing unresolved",
              out["sidesUnresolved"] == 0, str(out["unresolvedReasons"]))
        check("duplicate payloads are reported",
              out["duplicatePayloads"]
              == out["payloadsRead"] - out["battlesDeduplicated"],
              str(out["duplicatePayloads"]))
        check("one payload was a duplicate of a battle already seen",
              out["duplicatePayloads"] == 1, str(out["duplicatePayloads"]))


def test_both_sides_of_a_battle_are_partnerships() -> None:
    print("\none battle yields two pairs, theirs and ours")
    got = list(dp.pairs_from_payload(SHARED))
    check("two sides", len(got) == 2, str(len(got)))
    check("sides are named", {g[0] for g in got} == {"team", "opponent"})
    check("each side's decks are canonically ordered",
          all(g[1] <= g[2] for g in got))
    check("each side carries its two tags", all(len(g[5]) == 2 for g in got))


# --------------------------------------------------------------------------
# The migration
# --------------------------------------------------------------------------

def test_the_same_battle_from_two_logs_counts_once() -> None:
    """The fixture stores one battle twice — once per tracked teammate — plus
    the same partnership again on another day. The pair must count TWO."""
    print("\na battle stored twice is one occurrence")
    with Fixture() as fx:
        out = dp.migrate(enrol=False)
        check("four payloads read", out["payloadsRead"] == 4, str(out["payloadsRead"]))
        check("but only three real battles", out["battlesDeduplicated"] == 3,
              str(out["battlesDeduplicated"]))
        rep = dp.report(per=50)
        hog_giant = dp.pair_fingerprint(dp.deck_fingerprint(HOG),
                                        dp.deck_fingerprint(GIANT))
        row = [p for p in rep["pairs"] if p["pairFingerprint"] == hog_giant]
        check("the shared partnership exists", len(row) == 1, str(len(row)))
        # Two battles used it, and one of those was stored twice. Counting
        # ROWS would say three.
        check("...and counts 2, not 3", row[0]["occurrences"] == 2,
              str(row[0]["occurrences"]) if row else "missing")
        check("three unique pairs in total", out["uniquePairs"] == 3,
              str(out["uniquePairs"]))
        check("six sides, i.e. two per real battle",
              out["pairOccurrences"] == 6, str(out["pairOccurrences"]))


def test_repeated_partnerships_fold_into_one_record() -> None:
    print("\nthe same two decks together is one record with a count")
    with Fixture() as fx:
        dp.migrate(enrol=False)
        rep = dp.report(per=50)
        fps = [p["pairFingerprint"] for p in rep["pairs"]]
        check("no pair appears twice", len(fps) == len(set(fps)), str(fps))
        check("every pair carries two eight-card decks",
              all(len(p["deckA"]["cardKeys"]) == 8 and len(p["deckB"]["cardKeys"]) == 8
                  for p in rep["pairs"]))
        check("occurrences exceed pairs, i.e. something folded",
              rep["summary"]["occurrences"] > rep["summary"]["uniquePairs"],
              f'{rep["summary"]["occurrences"]} vs {rep["summary"]["uniquePairs"]}')


def test_the_migration_is_idempotent() -> None:
    """It will be run more than once. Running it twice must not double a count."""
    print("\nrunning the migration twice changes nothing")
    with Fixture():
        first = dp.migrate(enrol=False)
        second = dp.migrate(enrol=False)
        check("the same pairs", first["uniquePairs"] == second["uniquePairs"],
              f'{first["uniquePairs"]} -> {second["uniquePairs"]}')
        check("the same occurrences",
              first["pairOccurrences"] == second["pairOccurrences"],
              f'{first["pairOccurrences"]} -> {second["pairOccurrences"]}')
        check("the same real battles",
              first["battlesDeduplicated"] == second["battlesDeduplicated"])


def test_a_missing_payload_is_reported_never_invented() -> None:
    """THE LINE THAT MATTERS MOST. 301,488 real rows have no payload, so their
    partner deck cannot be known. The one deck `battles` holds must not be
    dressed up as half a pair."""
    print("\na battle with no payload is counted, not fabricated")
    with Fixture(unreconstructable=25) as fx:
        out = dp.migrate(enrol=False)
        check("every 2v2 row is counted", out["rows2v2"] == fx.battles_2v2(),
              f'{out["rows2v2"]} vs {fx.battles_2v2()}')
        check("the unreconstructable ones are named", out["unreconstructable"] == 25,
              str(out["unreconstructable"]))
        check("reconstructable + unreconstructable is the whole population",
              out["reconstructable"] + out["unreconstructable"] == out["rows2v2"])
        check("no pair was invented for them",
              out["uniquePairs"] == dp.report(per=50)["summary"]["uniquePairs"])
        check("the board repeats the shortfall",
              dp.report()["summary"]["unreconstructable"] == 25)


def test_phase_one_deletes_nothing() -> None:
    """Phase 2 (the bot) and the aggregate rebuild both have to land first."""
    print("\nthe migration deletes nothing at all")
    with Fixture(unreconstructable=10) as fx:
        before = fx.battles_2v2()
        out = dp.migrate(enrol=False)
        check("no rows deleted", out["rowsDeleted"] == 0)
        check("every 2v2 row is still in battles", fx.battles_2v2() == before,
              f"{before} -> {fx.battles_2v2()}")
        check("...and the report says so plainly",
              out["rowsRemainingInBattles"] == before,
              str(out["rowsRemainingInBattles"]))
        check("the board declares which phase this is",
              dp.report()["summary"]["phase"] == 1)


def test_only_2v2_is_read() -> None:
    print("\nladder rows are not touched by any of this")
    with Fixture() as fx:
        dp.migrate(enrol=False)
        for p in dp.report(per=50)["pairs"]:
            check(f'{p["pairFingerprint"][:14]} came from a 2v2 mode',
                  all("teamvsteam" in m.lower() for m in p["sourceModes"]),
                  str(p["sourceModes"]))


# --------------------------------------------------------------------------
# Tracking
# --------------------------------------------------------------------------

def test_tags_are_discovered_but_not_promoted_on_sight() -> None:
    """THE POLICY CHANGE, asserted on the historical path.

    Every participant is DISCOVERED and counted; none is promoted, because in
    this fixture nobody reaches three distinct battles — #AA plays two (SHARED
    and AGAIN; SHARED_MIRROR is the same battle) and everyone else fewer. An
    earlier version of this suite asserted that nine of ten were queued, which
    is exactly the unbounded behaviour that would have put 863,712 strangers
    into the roster.
    """
    print("")
    print("participants are discovered, and promoted only on merit")
    with Fixture():
        out = dp.migrate(enrol=True)
        check("ten participants discovered", out["participants"] == 10,
              str(out["participants"]))          # AA BB CC DD EE FF GG HH II JJ
        e = out["enrolment"]
        check("all ten are below the three-battle line",
              e["belowThreshold"] == 10, str(e["belowThreshold"]))
        check("none eligible", e["eligible"] == 0, str(e["eligible"]))
        check("NOBODY was queued", e["newlyEnrolled"] == 0, str(e["newlyEnrolled"]))
        check("the queue really is empty", tracking.queued_tags() == set(),
              str(tracking.queued_tags()))
        check("#AA is counted as two battles, not three",
              _battles_of("#AA") == 2, str(_battles_of("#AA")))



# --------------------------------------------------------------------------
# The board
# --------------------------------------------------------------------------

def test_the_board_ranks_and_pages() -> None:
    print("\nthe board is a ranking of partnerships")
    with Fixture():
        dp.migrate(enrol=False)
        rep = dp.report(page=1, per=1)
        check("one pair per page", len(rep["pairs"]) == 1)
        check("most played first", rep["pairs"][0]["occurrences"] == 3,
              str(rep["pairs"][0]["occurrences"]))
        check("more than one page", rep["pages"] > 1, str(rep["pages"]))
        check("a page past the end clamps",
              dp.report(page=99, per=1)["page"] == rep["pages"])
        check("per is capped", dp.report(per=99999)["perPage"] == dp.MAX_PER_PAGE)


def test_a_pair_row_carries_what_the_board_draws() -> None:
    print("\nevery row carries two full decks with ids and names")
    with Fixture():
        dp.migrate(enrol=False)
        p = dp.report(per=1)["pairs"][0]
        for side in ("deckA", "deckB"):
            d = p[side]
            check(f"{side} has eight cards", len(d["cards"]) == 8)
            check(f"{side} has eight real ids", all(i > 0 for i in d["cardIds"]),
                  str(d["cardIds"]))
            check(f"{side} names every card", all(c["name"] for c in d["cards"]))
            check(f"{side} has an average elixir", d["avgElixir"] > 0)
            check(f"{side} carries its own fingerprint", bool(d["fingerprint"]))
        check("distinct players are counted", p["players"] >= 2, str(p["players"]))
        check("a tag sample is carried for reconciliation", len(p["playerTags"]) >= 2)
        check("first seen is at or before last seen", p["firstSeen"] <= p["lastSeen"])


def test_the_board_can_be_searched() -> None:
    print("\nsearching finds the partnerships holding a card")
    with Fixture():
        dp.migrate(enrol=False)
        check("hog-rider appears", dp.report(query="hog-rider")["total"] >= 1)
        check("a card in nothing finds nothing",
              dp.report(query="mega-knight")["total"] == 0,
              str(dp.report(query="mega-knight")["total"]))
        # A card that sorted into deck B on one pair and deck A on another must
        # be found either way, or the search silently answers for one side.
        check("guards is in both a deck A and a deck B",
              dp.report(query="guards")["total"] >= 2,
              str(dp.report(query="guards")["total"]))


def test_never_built_is_not_built_and_empty() -> None:
    print("\nnever built reads differently from built and empty")
    with Fixture():
        check("built is false first", dp.report()["summary"]["built"] is False)
        dp.migrate(enrol=False)
        check("built is true after", dp.report()["summary"]["built"] is True)


def test_no_payloads_at_all_is_survivable() -> None:
    """A database whose raw tier was purged entirely. It must report the
    shortfall rather than raising or claiming success."""
    print("\na database with no surviving payloads")
    with Fixture(with_raw=False, unreconstructable=5) as fx:
        out = dp.migrate(enrol=False)
        check("no pairs", out["uniquePairs"] == 0, str(out["uniquePairs"]))
        check("nothing claimed as reconstructed", out["battlesDeduplicated"] == 0)
        check("every row is reported unreconstructable",
              out["unreconstructable"] == out["rows2v2"],
              f'{out["unreconstructable"]} vs {out["rows2v2"]}')
        check("and nothing was deleted", fx.battles_2v2() == out["rows2v2"])


# --------------------------------------------------------------------------
# The qualified enrolment policy
# --------------------------------------------------------------------------
#
# THE POLICY EXISTS BECAUSE OF A MEASUREMENT. The historical reconciliation
# found 866,226 distinct 2v2 participants against a tracked roster of 4,910 —
# 176x — because a 2v2 event puts you in front of three strangers a match.
# Enrolling on sight is a roster explosion, and at ~32 MB per player per year
# it is roughly 27.6 TB a year against a database with no backup.
#
# So: three distinct BATTLES qualifies you, 12,000 is an absolute ceiling, and
# over the ceiling the most-seen go first. Every check below is one of those
# three sentences, or the thing that would break them.


def battle_at(when, team, opp):
    """A distinct 2v2 battle. Distinct tags means a distinct battle identity."""
    return payload(when, team, opp)


def test_one_battle_does_not_track_anybody() -> None:
    print("")
    print("a first sighting stores the pair and tracks nobody")
    with Fixture():
        out = dp.observe(battle_at("20260901T100000.000Z",
                                   [("#N1", HOG), ("#N2", GIANT)],
                                   [("#N3", BAIT), ("#N4", LAVA)]))
        check("the battle was taken", out["stored"] is True, str(out))
        check("two pairs stored", len(out["pairs"]) == 2, str(out["pairs"]))
        check("NOBODY was enrolled", out["enrolled"] == [], str(out["enrolled"]))
        check("the pair is on the board anyway", dp.report()["total"] == 2,
              str(dp.report()["total"]))


def test_the_third_distinct_battle_is_what_qualifies() -> None:
    """One, two, still nothing; three, and they are promoted."""
    print("")
    print("three distinct battles is the line")
    with Fixture(), Promoting():
        seen = []
        for i, when in enumerate(("20260901T100000.000Z",
                                  "20260902T100000.000Z",
                                  "20260903T100000.000Z")):
            out = dp.observe(battle_at(
                when, [("#N1", HOG), ("#N2", GIANT)],
                # Different opponents each time, so these are three genuinely
                # different battles rather than one arriving three ways.
                [("#O%d" % i, BAIT), ("#P%d" % i, LAVA)]))
            seen.append(out["enrolled"])
        check("nobody after one", seen[0] == [], str(seen[0]))
        check("nobody after two", seen[1] == [], str(seen[1]))
        check("promoted on the third", "#N1" in seen[2] and "#N2" in seen[2],
              str(seen[2]))
        # The opponents appeared once each and must NOT have come with them.
        check("the one-off opponents are not promoted",
              not any(t.startswith("#O") or t.startswith("#P") for t in seen[2]),
              str(seen[2]))


def test_the_same_battle_twice_does_not_advance_anyone() -> None:
    """THE CASE THAT WOULD LET ONE BATTLE QUALIFY SOMEBODY. The same battle
    reaches us once per tracked participant, so a sightings counter would cross
    a three-battle threshold on a single battle seen from three sides."""
    print("")
    print("one battle delivered repeatedly counts once")
    with Fixture():
        b = battle_at("20260901T100000.000Z",
                      [("#N1", HOG), ("#N2", GIANT)],
                      [("#N3", BAIT), ("#N4", LAVA)])
        first = dp.observe(b)
        again = dp.observe(b)
        third = dp.observe(b)
        check("the first is stored", first["stored"] is True)
        check("the second is a duplicate", again.get("duplicate") is True, str(again))
        check("the third is a duplicate", third.get("duplicate") is True)
        check("nobody was promoted by repetition",
              not first["enrolled"] and not again.get("enrolled")
              and not third.get("enrolled"), str(first["enrolled"]))
        rep = dp.report(per=50)
        check("the pair still counts one",
              all(p["occurrences"] == 1 for p in rep["pairs"]),
              str([p["occurrences"] for p in rep["pairs"]]))
        check("the participant still counts one battle",
              _battles_of("#N1") == 1, str(_battles_of("#N1")))


def _battles_of(tag):
    import sqlite3 as _s
    con = _s.connect(dp.DB_PATH)
    try:
        row = con.execute(
            "SELECT battles FROM duo_participants WHERE tag = ?", (tag,)).fetchone()
        return row[0] if row else 0
    finally:
        con.close()


def test_an_already_tracked_player_stays_one_record() -> None:
    print("")
    print("a tracked player is left alone")
    with Fixture():
        # `#AA` is in the fixture's `tracked_players`.
        for i, when in enumerate(("20260901T110000.000Z", "20260902T110000.000Z",
                                  "20260903T110000.000Z")):
            dp.observe(battle_at(when, [("#AA", HOG), ("#N2", GIANT)],
                                 [("#Q%d" % i, BAIT), ("#R%d" % i, LAVA)]))
        out = dp.enrol_policy()
        check("the tracked one is counted as already tracked",
              out["alreadyTracked"] >= 1, str(out))
        queued = tracking.queued_tags()
        check("and was not queued a second time", "#AA" not in queued, str(queued))


def test_below_threshold_players_are_counted_not_enrolled() -> None:
    print("")
    print("candidates below the line are reported, not promoted")
    with Fixture():
        dp.observe(battle_at("20260901T100000.000Z",
                             [("#N1", HOG), ("#N2", GIANT)],
                             [("#N3", BAIT), ("#N4", LAVA)]))
        out = dp.enrol_policy()
        check("four participants discovered",
              out["participantsDiscovered"] == 4, str(out["participantsDiscovered"]))
        check("all four are below the threshold",
              out["belowThreshold"] == 4, str(out["belowThreshold"]))
        check("none eligible", out["eligible"] == 0, str(out["eligible"]))
        check("none enrolled", out["newlyEnrolled"] == 0, str(out["newlyEnrolled"]))
        check("the threshold is stated in the report", out["threshold"] == 3,
              str(out["threshold"]))


def test_the_ceiling_is_absolute() -> None:
    """With room for one, one qualifying player is taken. With no room, none —
    and the report says how many real candidates were turned away."""
    print("")
    print("the 12,000 ceiling refuses rather than trims silently")
    with Fixture(), Promoting():
        for i, when in enumerate(("20260901T100000.000Z", "20260902T100000.000Z",
                                  "20260903T100000.000Z")):
            dp.observe(battle_at(when, [("#N1", HOG), ("#N2", GIANT)],
                                 [("#S%d" % i, BAIT), ("#T%d" % i, LAVA)]),
                       enrol=False)

        # The fixture holds one tracked player, so a ceiling of 2 leaves room
        # for exactly one of the two qualifying teammates.
        out = dp.enrol_policy(ceiling=2)
        check("two players qualified", out["eligible"] == 2, str(out["eligible"]))
        check("only one fitted", out["newlyEnrolled"] == 1, str(out["newlyEnrolled"]))
        check("the other is reported as blocked",
              out["blockedByCeiling"] == 1, str(out["blockedByCeiling"]))
        check("and the report says the cap bit",
              out["cappedByCeiling"] is True, str(out))

    with Fixture(), Promoting():
        for i, when in enumerate(("20260901T100000.000Z", "20260902T100000.000Z",
                                  "20260903T100000.000Z")):
            dp.observe(battle_at(when, [("#N1", HOG), ("#N2", GIANT)],
                                 [("#S%d" % i, BAIT), ("#T%d" % i, LAVA)]),
                       enrol=False)
        full = dp.enrol_policy(ceiling=1)   # already one tracked: no room at all
        check("a full roster enrols nobody", full["newlyEnrolled"] == 0,
              str(full["newlyEnrolled"]))
        check("both candidates are reported blocked",
              full["blockedByCeiling"] == 2, str(full["blockedByCeiling"]))


def test_the_most_seen_qualify_first() -> None:
    """Over the ceiling, the ranking is by distinct battles descending."""
    print("")
    print("over the ceiling, the most-observed go first")
    with Fixture(), Promoting():
        # #BUSY plays five battles, #QUIET exactly three.
        for i in range(5):
            dp.observe(battle_at("2026090%dT120000.000Z" % (i + 1),
                                 [("#BUSY", HOG), ("#U%d" % i, GIANT)],
                                 [("#V%d" % i, BAIT), ("#W%d" % i, LAVA)]),
                       enrol=False)
        for i in range(3):
            dp.observe(battle_at("2026091%dT130000.000Z" % i,
                                 [("#QUIET", GIANT), ("#X%d" % i, HOG)],
                                 [("#Y%d" % i, BAIT), ("#Z%d" % i, LAVA)]),
                       enrol=False)
        check("#BUSY has five battles", _battles_of("#BUSY") == 5,
              str(_battles_of("#BUSY")))
        check("#QUIET has three", _battles_of("#QUIET") == 3,
              str(_battles_of("#QUIET")))
        out = dp.enrol_policy(ceiling=2)   # one tracked already -> room for one
        check("exactly one was taken", out["newlyEnrolled"] == 1,
              str(out["newlyEnrolled"]))
        queued = tracking.queued_tags()
        check("and it is the busier player", "#BUSY" in queued, str(sorted(queued)))
        check("...not the quieter one", "#QUIET" not in queued, str(sorted(queued)))


def test_a_pair_survives_its_players_not_qualifying() -> None:
    """The separation the policy rests on: storing a partnership and tracking a
    person are different decisions, and the second must not veto the first."""
    print("")
    print("an unqualified player's pair is still stored")
    with Fixture():
        out = dp.observe(battle_at("20260901T100000.000Z",
                                   [("#N1", HOG), ("#N2", GIANT)],
                                   [("#N3", BAIT), ("#N4", LAVA)]))
        check("nobody tracked", out["enrolled"] == [])
        rep = dp.report(per=50)
        check("both partnerships are on the board", rep["total"] == 2,
              str(rep["total"]))
        check("with their real decks",
              any(set(p["deckA"]["cardKeys"]) == set(sorted(HOG))
                  or set(p["deckB"]["cardKeys"]) == set(sorted(HOG))
                  for p in rep["pairs"]))


def test_a_non_2v2_payload_is_refused_by_observe() -> None:
    """`observe` is the 2v2 branch. It must not quietly accept a ladder game."""
    print("")
    print("observe only takes 2v2")
    with Fixture():
        ladder = payload("20260901T100000.000Z",
                         [("#N1", HOG), ("#N2", GIANT)],
                         [("#N3", BAIT), ("#N4", LAVA)], mode="Ladder")
        out = dp.observe(ladder)
        check("refused", out["duo"] is False, str(out))
        check("nothing stored", dp.report()["total"] == 0)


def test_the_historical_policy_reports_every_bucket() -> None:
    """The report the migration has to produce: discovered, already tracked,
    below threshold, eligible, enrolled, blocked."""
    print("")
    print("the enrolment report partitions everyone it saw")
    with Fixture(), Promoting():
        for i in range(3):
            dp.observe(battle_at("2026090%dT140000.000Z" % (i + 1),
                                 [("#N1", HOG), ("#N2", GIANT)],
                                 [("#E%d" % i, BAIT), ("#F%d" % i, LAVA)]),
                       enrol=False)
        out = dp.enrol_policy()
        total = out["participantsDiscovered"]
        check("everyone is in exactly one bucket",
              out["belowThreshold"] + out["qualified"] == total,
              f'{out["belowThreshold"]} + {out["qualified"]} vs {total}')
        check("two qualified", out["eligible"] == 2, str(out["eligible"]))
        check("six were one-offs", out["belowThreshold"] == 6,
              str(out["belowThreshold"]))
        check("both qualifiers were enrolled", out["newlyEnrolled"] == 2,
              str(out["newlyEnrolled"]))
        check("nothing was blocked", out["blockedByCeiling"] == 0,
              str(out["blockedByCeiling"]))
        check("the ceiling is the shared one", out["ceiling"] == 12000,
              str(out["ceiling"]))


def test_enrolment_is_idempotent() -> None:
    print("")
    print("running the policy twice enrols nobody twice")
    with Fixture(), Promoting():
        for i in range(3):
            dp.observe(battle_at("2026090%dT150000.000Z" % (i + 1),
                                 [("#N1", HOG), ("#N2", GIANT)],
                                 [("#G%d" % i, BAIT), ("#H%d" % i, LAVA)]),
                       enrol=False)
        first = dp.enrol_policy()
        second = dp.enrol_policy()
        check("the first promotes two", first["newlyEnrolled"] == 2,
              str(first["newlyEnrolled"]))
        check("the second promotes nobody", second["newlyEnrolled"] == 0,
              str(second["newlyEnrolled"]))
        check("and says they are already queued",
              second["alreadyQueued"] >= 2, str(second["alreadyQueued"]))




def test_an_incremental_run_catches_a_brand_new_2v2_mode() -> None:
    """THE PROPERTY THE INDEXED PATH BUYS, and the reason it is worth having.

    A full run filters on an `IN` list built from the mode strings already in
    the database, so a mode Supercell ships tomorrow is invisible to it until
    somebody reruns the whole thing. The incremental run filters on
    `stored_at` — which is indexed — and asks `battle_modes` about each row it
    gets back, so a new 2v2 mode is picked up the first time one arrives.

    2v2 went from 2.77% to 25.11% of the database in three months, so "a mode
    that did not exist last week" is the normal case here, not a hypothetical.
    """
    print("")
    print("an incremental run sees a 2v2 mode that did not exist before")
    with Fixture() as fx:
        dp.migrate(enrol=False)
        before = dp.report()["summary"]["uniquePairs"]
        before_occ = dp.report()["summary"]["occurrences"]

        # A mode string appearing for the first time, stored AFTER the run.
        fresh = payload("20260909T120000.000Z",
                        [("#NEW1", MINER), ("#NEW2", GOLEM)],
                        [("#NEW3", HOG), ("#NEW4", GIANT)],
                        mode="TeamVsTeam_Rumble")
        con = sqlite3.connect(fx.src)
        con.execute(
            "INSERT INTO battle_raw (player_tag, battle_time, game_mode, "
            "stored_at, raw_json) VALUES (?,?,?,?,?)",
            ("#NEW1", fresh["battleTime"], "TeamVsTeam_Rumble",
             "2026-09-30T00:00:00+00:00", json.dumps(fresh)))
        con.commit()
        con.close()

        check("the router already calls it 2v2", bm.is_duo("TeamVsTeam_Rumble"))
        out = dp.update()
        check("the incremental run read it", out["payloadsRead"] == 1,
              str(out["payloadsRead"]))
        after = dp.report()["summary"]["uniquePairs"]
        after_occ = dp.report()["summary"]["occurrences"]
        # BOTH ITS PARTNERSHIPS ALREADY EXIST in this fixture, so the right
        # assertion is that they were COUNTED again, not that new records
        # appeared. The first draft asserted `+2 pairs` and failed at 3 -> 3,
        # which is the collection behaving correctly.
        check("no new partnership, because both already existed",
              after == before, f"{before} -> {after}")
        check("but both were counted again", after_occ == before_occ + 2,
              f"{before_occ} -> {after_occ}")
        check("and the new mode is recorded on them",
              any("TeamVsTeam_Rumble" in p["sourceModes"]
                  for p in dp.report(per=50)["pairs"]),
              str([p["sourceModes"] for p in dp.report(per=50)["pairs"]]))


# --------------------------------------------------------------------------
# The two resource bounds
# --------------------------------------------------------------------------
#
# They are INDEPENDENT and it matters that they are:
#
#   DUO_TOP_PLAYERS_LIMIT  bounds expensive per-player 2v2 DETAIL
#   CLASH_RECRUIT_CEILING  bounds full player TRACKING
#
# A player can sit in the lightweight participation tier without being tracked,
# and a pair can exist without either participant being either. Collapsing the
# two would mean a deck partnership disappearing because nobody in it was
# important enough, which is the opposite of what the pair board is for.


def test_promotion_ships_disabled() -> None:
    """The shipped default is OFF, and the report still tells the truth.

    7,083 candidates would take the roster from 4,910 to the 12,000 ceiling —
    +144%, roughly 380 GB a year at steady state, against a database with no
    backup. So the mechanism ships dark, the way `CLASH_OIE=off` already does,
    and what is withheld is the write rather than the answer.
    """
    print("")
    print("live promotion is off by default")
    check("the module default is off", dp.PROMOTION_ENABLED is False,
          str(dp.PROMOTION_ENABLED))
    with Fixture():
        for i in range(3):
            dp.observe(payload("2026090%dT160000.000Z" % (i + 1),
                               [("#P1", HOG), ("#P2", GIANT)],
                               [("#A%d" % i, BAIT), ("#B%d" % i, LAVA)]))
        out = dp.enrol_policy()
        check("two players did qualify", out["eligible"] == 2, str(out["eligible"]))
        check("...and it says what it WOULD do", out["wouldEnrol"] == 2,
              str(out["wouldEnrol"]))
        check("but nobody was actually promoted", out["newlyEnrolled"] == 0,
              str(out["newlyEnrolled"]))
        check("the queue is untouched", tracking.queued_tags() == set(),
              str(tracking.queued_tags()))
        check("and the report says the gate is shut",
              out["promotionEnabled"] is False, str(out["promotionEnabled"]))


def test_the_gate_covers_the_ingestion_path_too() -> None:
    """A flag that stopped only the bulk promotion would let the roster fill
    two players at a time while appearing to be switched off."""
    print("")
    print("the gate covers per-battle promotion as well")
    with Fixture():
        out = None
        for i in range(4):
            out = dp.observe(payload("2026090%dT170000.000Z" % (i + 1),
                                     [("#P1", HOG), ("#P2", GIANT)],
                                     [("#C%d" % i, BAIT), ("#D%d" % i, LAVA)]))
        check("well past the threshold", _battles_of("#P1") == 4,
              str(_battles_of("#P1")))
        check("and still nobody enrolled", out["enrolled"] == [],
              str(out["enrolled"]))
        check("the queue is still empty", tracking.queued_tags() == set())


def test_an_already_tracked_player_is_not_a_candidate_at_all() -> None:
    """Not a rejected candidate and not a deferred one — not a candidate. They
    must never appear in the ranking that decides who gets the last slot."""
    print("")
    print("a tracked participant is not a candidate")
    with Fixture(), Promoting():
        # `#AA` is tracked in the fixture.
        for i in range(3):
            dp.observe(payload("2026090%dT180000.000Z" % (i + 1),
                               [("#AA", HOG), ("#FRESH", GIANT)],
                               [("#E%d" % i, BAIT), ("#F%d" % i, LAVA)]),
                       enrol=False)
        out = dp.enrol_policy()
        check("both cleared three battles", out["qualified"] == 2,
              str(out["qualified"]))
        check("but only the untracked one is eligible", out["eligible"] == 1,
              str(out["eligible"]))
        check("the tracked one is counted separately",
              out["alreadyTracked"] == 1, str(out["alreadyTracked"]))
        queued = tracking.queued_tags()
        check("only the new player was queued", queued == {"#FRESH"}, str(queued))
        check("the tracked one consumed no slot", "#AA" not in queued)


def test_the_population_is_bounded_and_ranked() -> None:
    print("")
    print("expensive detail is bounded to the top N")
    with Fixture():
        # #BUSY: 4 battles. #MID: 3. #RARE: 1.
        for i in range(4):
            dp.observe(payload("2026090%dT190000.000Z" % (i + 1),
                               [("#BUSY", HOG), ("#G%d" % i, GIANT)],
                               [("#H%d" % i, BAIT), ("#I%d" % i, LAVA)]))
        for i in range(3):
            dp.observe(payload("2026091%dT190000.000Z" % i,
                               [("#MID", GIANT), ("#J%d" % i, HOG)],
                               [("#K%d" % i, BAIT), ("#L%d" % i, LAVA)]))
        dp.observe(payload("20260920T190000.000Z",
                           [("#RARE", MINER), ("#M0", GOLEM)],
                           [("#N0", BAIT), ("#O0", LAVA)]))

        out = dp.reconcile_population(limit=2)
        check("only two are retained", out["retained"] == 2, str(out["retained"]))
        check("the cut is reported", out["cutAtBattles"] == 3,
              str(out["cutAtBattles"]))
        check("ledger rows were pruned", out["ledgerRowsPruned"] > 0,
              str(out["ledgerRowsPruned"]))
        kept = _retained_tags()
        check("the busiest is kept", "#BUSY" in kept, str(sorted(kept)))
        check("the second busiest is kept", "#MID" in kept, str(sorted(kept)))
        check("the one-off is not", "#RARE" not in kept, str(sorted(kept)))


def _retained_tags():
    import sqlite3 as _s
    con = _s.connect(dp.DB_PATH)
    try:
        return {r[0] for r in con.execute(
            "SELECT tag FROM duo_participants WHERE retained = 1")}
    finally:
        con.close()


def _participant_count():
    import sqlite3 as _s
    con = _s.connect(dp.DB_PATH)
    try:
        return con.execute("SELECT COUNT(*) FROM duo_participants").fetchone()[0]
    finally:
        con.close()


def test_the_bound_keeps_the_lightweight_tier_for_everyone() -> None:
    """THE PROPERTY THAT MAKES THE BOUND RECALCULABLE RATHER THAN A FREEZE.

    Pruning the per-battle ledger must not delete the participant rows it was
    counted from — those are what let number 1,001 be seen overtaking number
    1,000 on a later run. Rank from the pruned ledger instead and today's
    population becomes permanent, because nobody outside it can ever
    accumulate another countable battle.
    """
    print("")
    print("everyone stays in the lightweight tier after pruning")
    with Fixture():
        for i in range(4):
            dp.observe(payload("2026090%dT200000.000Z" % (i + 1),
                               [("#BUSY", HOG), ("#P%d" % i, GIANT)],
                               [("#Q%d" % i, BAIT), ("#R%d" % i, LAVA)]))
        before = _participant_count()
        dp.reconcile_population(limit=1)
        after = _participant_count()
        check("no participant row was deleted", after == before,
              f"{before} -> {after}")
        check("their battle counts survive", _battles_of("#BUSY") == 4,
              str(_battles_of("#BUSY")))
        check("including for the evicted", _battles_of("#P0") == 1,
              str(_battles_of("#P0")))


def test_a_player_can_enter_the_population_later() -> None:
    """#1001 overtaking #1000, in miniature."""
    print("")
    print("the population is recalculated, not frozen")
    with Fixture():
        for i in range(3):
            dp.observe(payload("2026090%dT210000.000Z" % (i + 1),
                               [("#FIRST", HOG), ("#S%d" % i, GIANT)],
                               [("#T%d" % i, BAIT), ("#U%d" % i, LAVA)]))
        dp.observe(payload("20260915T210000.000Z",
                           [("#LATE", MINER), ("#V0", GOLEM)],
                           [("#W0", BAIT), ("#X0", LAVA)]))
        dp.reconcile_population(limit=1)
        check("the busier player holds the slot", "#FIRST" in _retained_tags(),
              str(sorted(_retained_tags())))

        # #LATE now plays four more, overtaking #FIRST.
        for i in range(4):
            dp.observe(payload("20260916T2%d0000.000Z" % i,
                               [("#LATE", MINER), ("#Y%d" % i, GOLEM)],
                               [("#Z%d" % i, BAIT), ("#AB%d" % i, LAVA)]))
        check("#LATE overtook on the lightweight counts",
              _battles_of("#LATE") == 5 and _battles_of("#FIRST") == 3,
              f'LATE={_battles_of("#LATE")} FIRST={_battles_of("#FIRST")}')
        dp.reconcile_population(limit=1)
        kept = _retained_tags()
        check("and takes the slot on the next reconcile", kept == {"#LATE"},
              str(sorted(kept)))


def test_pruning_never_touches_the_pairs() -> None:
    """A partnership is evidence about DECKS. It stays whether or not either
    player is important enough to keep a per-battle history for."""
    print("")
    print("the pair board survives the bound")
    with Fixture():
        for i in range(3):
            dp.observe(payload("2026090%dT220000.000Z" % (i + 1),
                               [("#BUSY", HOG), ("#AC%d" % i, GIANT)],
                               [("#AD%d" % i, BAIT), ("#AE%d" % i, LAVA)]))
        before = dp.report()["summary"]["uniquePairs"]
        occ_before = dp.report()["summary"]["occurrences"]
        dp.reconcile_population(limit=1)
        check("no pair was lost", dp.report()["summary"]["uniquePairs"] == before,
              str(dp.report()["summary"]["uniquePairs"]))
        check("no occurrence was lost",
              dp.report()["summary"]["occurrences"] == occ_before,
              str(dp.report()["summary"]["occurrences"]))


def test_a_pair_is_valid_whatever_its_players_status() -> None:
    """Zero, one or two tracked participants — the pair is the same record."""
    print("")
    print("a pair is valid with none, one or two tracked players")
    with Fixture():
        # none tracked
        dp.observe(payload("20260901T230000.000Z",
                           [("#U1", HOG), ("#U2", GIANT)],
                           [("#U3", BAIT), ("#U4", LAVA)]))
        # one tracked (#AA is in the fixture's tracked_players)
        dp.observe(payload("20260902T230000.000Z",
                           [("#AA", MINER), ("#U5", GOLEM)],
                           [("#U6", BAIT), ("#U7", LAVA)]))
        rep = dp.report(per=50)
        # THREE, not four: both battles were against BAIT+LAVA, so that
        # partnership is one record counted twice. The first draft expected
        # four and was asserting that deduplication does not work.
        check("three unique partnerships from two battles", rep["total"] == 3,
              str(rep["total"]))
        bait_lava = [p for p in rep["pairs"] if p["occurrences"] == 2]
        check("the repeated opponent pair counted twice", len(bait_lava) == 1,
              str([p["occurrences"] for p in rep["pairs"]]))
        check("all of them carry two full decks",
              all(len(p["deckA"]["cardKeys"]) == 8
                  and len(p["deckB"]["cardKeys"]) == 8 for p in rep["pairs"]))
        check("and none was withheld for want of a tracked player",
              all(p["occurrences"] >= 1 for p in rep["pairs"]))


def test_the_two_bounds_are_independent() -> None:
    """A player in the lightweight tier need not be tracked, and a retained
    player need not be tracked either."""
    print("")
    print("the population bound and the tracking ceiling are separate")
    with Fixture():
        for i in range(3):
            dp.observe(payload("2026090%dT235900.000Z" % (i + 1),
                               [("#SOLO", HOG), ("#AF%d" % i, GIANT)],
                               [("#AG%d" % i, BAIT), ("#AH%d" % i, LAVA)]))
        dp.reconcile_population(limit=1)
        check("#SOLO is in the retained population",
              "#SOLO" in _retained_tags(), str(sorted(_retained_tags())))
        check("but is not tracked", "#SOLO" not in tracking.bot_tracked_set())
        check("and was not queued either, promotion being off",
              "#SOLO" not in tracking.queued_tags())


def test_a_pruned_players_count_does_not_go_backwards() -> None:
    """THE REGRESSION THE SCHEDULER WOULD HAVE SHIPPED.

    A player outside the top-N has their ledger rows pruned — that is the whole
    point of the bound. If a later incremental roll then RECOMPUTED
    `battles = COUNT(*)` from what survives, their count would collapse to the
    number of battles since the prune.

    Concretely: two battles, pruned, then a third — and the recomputing version
    writes **1** on the battle that should have taken them to **3**. That number
    decides qualification and the ranking for the retained population, so the
    bound would silently stop being recalculable, which is the one property it
    exists to have.
    """
    print("")
    print("a pruned player keeps their battle count")
    with Fixture() as fx:
        # #SMALL plays two battles; #BIG plays five so it owns the single slot.
        # THROUGH `battle_raw` AND `migrate`, the way production gets here —
        # so there is a real watermark and the incremental path is the one
        # under test. Built with `observe` alone there is no watermark, and
        # `update` would fall back to a full rebuild, which is a different
        # code path with a different (and now refused) hazard.
        for i in range(2):
            _add_raw(fx, "#SMALL", payload("2026090%dT100000.000Z" % (i + 1),
                     [("#SMALL", HOG), ("#SM%d" % i, GIANT)],
                     [("#SO%d" % i, BAIT), ("#SP%d" % i, LAVA)]))
        for i in range(5):
            _add_raw(fx, "#BIG", payload("2026091%dT100000.000Z" % i,
                     [("#BIG", MINER), ("#BM%d" % i, GOLEM)],
                     [("#BO%d" % i, BAIT), ("#BP%d" % i, LAVA)]))
        dp.migrate(enrol=False)
        check("#SMALL has two", _battles_of("#SMALL") == 2, str(_battles_of("#SMALL")))

        out = dp.reconcile_population(limit=1)
        check("only #BIG is retained", _retained_tags() == {"#BIG"},
              str(sorted(_retained_tags())))
        check("and rows were pruned", out["ledgerRowsPruned"] > 0,
              str(out["ledgerRowsPruned"]))
        check("#SMALL's ledger rows are gone", _ledger_rows_for("#SMALL") == 0,
              str(_ledger_rows_for("#SMALL")))
        check("but the lightweight count survives", _battles_of("#SMALL") == 2,
              str(_battles_of("#SMALL")))

        # A third battle arrives through the incremental path, exactly as the
        # scheduled job would deliver it.
        _add_raw(fx, "#SMALL", payload("20260920T100000.000Z",
                 [("#SMALL", HOG), ("#SQ0", GIANT)],
                 [("#SR0", BAIT), ("#SS0", LAVA)]),
                 stored="2026-09-30T00:00:00+00:00")

        dp.update()
        check("the third battle took them to three, not back to one",
              _battles_of("#SMALL") == 3, str(_battles_of("#SMALL")))
        check("and the retained player is unharmed", _battles_of("#BIG") == 5,
              str(_battles_of("#BIG")))

        # The scheduled job runs hourly, so running it again must add nothing.
        dp.update()
        dp.update()
        check("repeated runs add nothing", _battles_of("#SMALL") == 3,
              str(_battles_of("#SMALL")))


def _add_raw(fx, tag, p, stored="2026-09-01T09:00:00+00:00"):
    """Put one payload into the fixture's `battle_raw`, as the bot would."""
    con = sqlite3.connect(fx.src)
    try:
        con.execute(
            "INSERT OR IGNORE INTO battle_raw (player_tag, battle_time, "
            "game_mode, stored_at, raw_json) VALUES (?,?,?,?,?)",
            (tag, p["battleTime"], p["gameMode"]["name"], stored, json.dumps(p)))
        con.commit()
    finally:
        con.close()


def _ledger_rows_for(tag):
    import sqlite3 as _s
    con = _s.connect(dp.DB_PATH)
    try:
        return con.execute(
            "SELECT COUNT(*) FROM duo_battle_players WHERE tag = ?", (tag,)
        ).fetchone()[0]
    finally:
        con.close()


def test_pruning_never_drops_an_uncounted_row() -> None:
    """A row staged but not yet folded must survive a reconcile, or the battle
    it represents is lost from every count that would ever have seen it."""
    print("")
    print("an uncounted ledger row is never pruned")
    with Fixture():
        dp.observe(payload("20260901T110000.000Z",
                           [("#T1", HOG), ("#T2", GIANT)],
                           [("#T3", BAIT), ("#T4", LAVA)]))
        con = sqlite3.connect(dp.DB_PATH)
        con.execute("UPDATE duo_battle_players SET counted = 0")
        con.commit()
        con.close()
        before = _ledger_rows_for("#T1")
        dp.reconcile_population(limit=1)
        check("the uncounted row is still there",
              _ledger_rows_for("#T1") == before, str(_ledger_rows_for("#T1")))


if __name__ == "__main__":
    test_a_deck_is_order_free()
    test_a_pair_is_order_free()
    test_one_battle_has_one_identity_from_either_log()
    test_the_tower_troop_is_not_in_the_deck()
    test_an_unknown_card_refuses_the_deck()
    test_a_refusal_says_which_card_and_why()
    test_every_unresolved_side_is_accounted_for()
    test_the_migration_report_balances()
    test_both_sides_of_a_battle_are_partnerships()
    test_the_same_battle_from_two_logs_counts_once()
    test_repeated_partnerships_fold_into_one_record()
    test_the_migration_is_idempotent()
    test_a_missing_payload_is_reported_never_invented()
    test_phase_one_deletes_nothing()
    test_only_2v2_is_read()
    test_tags_are_discovered_but_not_promoted_on_sight()
    test_one_battle_does_not_track_anybody()
    test_the_third_distinct_battle_is_what_qualifies()
    test_the_same_battle_twice_does_not_advance_anyone()
    test_an_already_tracked_player_stays_one_record()
    test_below_threshold_players_are_counted_not_enrolled()
    test_the_ceiling_is_absolute()
    test_the_most_seen_qualify_first()
    test_a_pair_survives_its_players_not_qualifying()
    test_a_non_2v2_payload_is_refused_by_observe()
    test_the_historical_policy_reports_every_bucket()
    test_enrolment_is_idempotent()
    test_an_incremental_run_catches_a_brand_new_2v2_mode()
    test_promotion_ships_disabled()
    test_the_gate_covers_the_ingestion_path_too()
    test_an_already_tracked_player_is_not_a_candidate_at_all()
    test_the_population_is_bounded_and_ranked()
    test_the_bound_keeps_the_lightweight_tier_for_everyone()
    test_a_player_can_enter_the_population_later()
    test_pruning_never_touches_the_pairs()
    test_a_pair_is_valid_whatever_its_players_status()
    test_the_two_bounds_are_independent()
    test_a_pruned_players_count_does_not_go_backwards()
    test_pruning_never_drops_an_uncounted_row()
    test_the_board_ranks_and_pages()
    test_a_pair_row_carries_what_the_board_draws()
    test_the_board_can_be_searched()
    test_never_built_is_not_built_and_empty()
    test_no_payloads_at_all_is_survivable()
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
