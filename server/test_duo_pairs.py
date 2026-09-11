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


# --------------------------------------------------------------------------
# The raw-cap interlock
# --------------------------------------------------------------------------
#
# SINCE PHASE 2, A 2v2 BATTLE HAS A WINDOW WHERE ITS ONLY COPY IS RAW. The bot
# no longer writes 2v2 into `battles`, and `enforce_raw_cap` deletes non-duel
# raw to keep the disk bounded — on 2026-09-10 it took 4,763,318 rows including
# every 2v2 payload then present. Anything it removes before the fold has run
# is gone from every table.
#
# `purge_non_duel_raw` already accepts the cursor that fixes this. These checks
# pin the property that cursor has to have.


def _purgeable(cursor, stored_at):
    """The bot-side rule, reproduced: a 2v2 raw row may be deleted only when a
    cursor exists AND the row is at or below it.

    Copied here deliberately rather than imported — the rule lives in the bot's
    `purge_non_duel_raw`, which is a different codebase deployed separately, so
    this is the same arrangement `test_battle_modes` uses to pin the 2v2 marker
    list. If the two drift, a battle is deleted before it is folded.
    """
    if not cursor:
        return False            # empty cursor protects everything
    if not stored_at:
        return False            # a row with no arrival stamp cannot be proved safe
    return stored_at <= cursor


def test_an_unprocessed_2v2_payload_is_protected() -> None:
    """The exact race: raw arrives, the fold has NOT run, the cap fires."""
    print("")
    print("2v2 raw that has not been folded is not purgeable")
    with Fixture() as fx:
        dp.migrate(enrol=False)
        cursor = dp.processed_through()
        check("a cursor exists after a fold", bool(cursor), repr(cursor))

        # A payload stored AFTER everything the fold saw.
        later = "2026-12-31T23:59:59+00:00"
        check("it is above the cursor", later > cursor, f"{later} vs {cursor}")
        check("and is therefore protected", _purgeable(cursor, later) is False)

        _add_raw(fx, "#RACE", payload("20260925T100000.000Z",
                 [("#RACE", HOG), ("#RACE2", GIANT)],
                 [("#RACE3", BAIT), ("#RACE4", LAVA)]), stored=later)
        state = dp.unprocessed_since()
        check("the operator view counts it as unprocessed",
              state["unprocessed"] == 1, str(state))


def test_a_processed_2v2_payload_becomes_purgeable() -> None:
    """The other half: once folded, the raw copy is redundant and may go."""
    print("")
    print("2v2 raw that has been folded is purgeable")
    with Fixture() as fx:
        stored = "2026-09-20T12:00:00+00:00"
        _add_raw(fx, "#DONE", payload("20260920T120000.000Z",
                 [("#DONE", HOG), ("#DONE2", GIANT)],
                 [("#DONE3", BAIT), ("#DONE4", LAVA)]), stored=stored)
        dp.migrate(enrol=False)
        cursor = dp.processed_through()
        check("the cursor reached it", cursor >= stored, f"{cursor} vs {stored}")
        check("so it is purgeable", _purgeable(cursor, stored) is True)
        check("and nothing is left unprocessed",
              dp.unprocessed_since()["unprocessed"] == 0,
              str(dp.unprocessed_since()))
        # The pair survives the raw copy being deleted -- that is the point.
        check("the partnership is durable in duo_pairs",
              dp.report()["summary"]["uniquePairs"] > 0)


def test_the_cursor_fails_closed() -> None:
    """An empty cursor must read as PROTECT EVERYTHING, never as nothing to
    protect. That is also how `purge_non_duel_raw` already treats its own empty
    cursor (`if not stored_through: return 0`)."""
    print("")
    print("an absent or unreadable cursor protects everything")
    check("empty cursor protects an old row",
          _purgeable("", "2020-01-01T00:00:00+00:00") is False)
    check("empty cursor protects a new row",
          _purgeable("", "2099-01-01T00:00:00+00:00") is False)
    check("a row with no stored_at is never purgeable",
          _purgeable("2026-09-10T00:00:00+00:00", None) is False)

    was = dp.DB_PATH
    try:
        dp.DB_PATH = "/nonexistent/path/that/cannot/be/created/x.db"
        dp._ready = False
        check("an unreadable collection yields an empty cursor",
              dp.processed_through() == "", repr(dp.processed_through()))
    finally:
        dp.DB_PATH = was
        dp._ready = False


def test_the_cursor_never_overstates_progress() -> None:
    """It may lag reality; it must never claim a battle was folded when it was
    not. Every staged battle must sit at or below the published cursor."""
    print("")
    print("the cursor never runs ahead of what was folded")
    with Fixture():
        dp.migrate(enrol=False)
        cursor = dp.processed_through()
        con = sqlite3.connect(dp.DB_PATH)
        try:
            rows = con.execute(
                "SELECT COUNT(*) FROM duo_stage").fetchone()[0]
        finally:
            con.close()
        check("battles were staged", rows > 0, str(rows))
        check("the cursor is non-empty", bool(cursor))
        # Every payload the fixture stored carries the fixture's stored_at,
        # which must be at or below the cursor.
        check("every folded payload is at or below the cursor",
              "2026-09-01T09:00:00+00:00" <= cursor, cursor)


def test_folding_twice_still_counts_once() -> None:
    """The interlock must not disturb deduplication."""
    print("")
    print("the interlock does not affect battle deduplication")
    with Fixture():
        dp.migrate(enrol=False)
        pairs = dp.report()["summary"]["uniquePairs"]
        occ = dp.report()["summary"]["occurrences"]
        dp.migrate(enrol=False)
        check("pairs unchanged", dp.report()["summary"]["uniquePairs"] == pairs,
              str(dp.report()["summary"]["uniquePairs"]))
        check("occurrences unchanged",
              dp.report()["summary"]["occurrences"] == occ,
              str(dp.report()["summary"]["occurrences"]))
        check("the cursor is still valid", bool(dp.processed_through()))


def test_duel_raw_is_not_in_scope() -> None:
    """`purge_non_duel_raw` only ever touches NON-duel raw, and duel payloads
    are re-read by the bot's own parser. The interlock must not change that:
    it narrows what may be purged, never widens it."""
    print("")
    print("duel raw is outside this interlock entirely")
    for mode in ("CW_Duel_1v1", "Duel_1v1_Friendly", "Duel_1v1_Tournament"):
        check(f"{mode} is not 2v2", not bm.is_duo(mode))
        check(f"{mode} is own-deck 1v1, so it is in battles too",
              bm.is_own_deck_1v1(mode))


# --------------------------------------------------------------------------
# The admin board's contract
# --------------------------------------------------------------------------

def test_the_board_offers_three_orderings() -> None:
    print("")
    print("the board sorts three ways, and only three")
    with Fixture():
        dp.migrate(enrol=False)
        for key in ("played", "recent", "first"):
            rep = dp.report(sort=key, per=50)
            check(f"{key} is accepted", rep["sort"] == key, rep["sort"])
            check(f"{key} returns rows", len(rep["pairs"]) > 0)
        check("the vocabulary is published",
              dp.report()["sorts"] == ["first", "played", "recent"],
              str(dp.report()["sorts"]))


def test_an_unknown_sort_falls_back_rather_than_reaching_the_sql() -> None:
    """`sort` arrives from a query string. It is a KEY into a closed map, so an
    unrecognised value — or an injection attempt — becomes the default instead
    of reaching the ORDER BY."""
    print("")
    print("an unknown sort key falls back to the default")
    with Fixture():
        dp.migrate(enrol=False)
        for bad in ("", "nonsense", "occurrences", "1; DROP TABLE duo_pairs--",
                    "last_seen DESC"):
            rep = dp.report(sort=bad, per=5)
            check(f"{bad!r} -> played", rep["sort"] == "played", rep["sort"])
        check("the table is still there", dp.report()["total"] > 0)


def test_each_ordering_actually_orders() -> None:
    print("")
    print("each ordering is monotonic in its own column")
    with Fixture():
        dp.migrate(enrol=False)
        played = [p["occurrences"] for p in dp.report(sort="played", per=50)["pairs"]]
        check("played descends", played == sorted(played, reverse=True), str(played))
        recent = [p["lastSeen"] for p in dp.report(sort="recent", per=50)["pairs"]]
        check("recent descends", recent == sorted(recent, reverse=True), str(recent))
        first = [p["firstSeen"] for p in dp.report(sort="first", per=50)["pairs"]]
        check("first ascends", first == sorted(first), str(first))


def test_the_default_is_most_played() -> None:
    print("")
    print("the default ordering is most played")
    with Fixture():
        dp.migrate(enrol=False)
        check("default key", dp.report()["sort"] == "played")
        check("...and it is the module default", dp.DEFAULT_SORT == "played")


def test_search_finds_a_deck_fingerprint_not_only_a_pair_one() -> None:
    """The board prints three identifiers per row — the pair's and both decks'.
    A search that only matched the pair's would answer 'no' for two thirds of
    what it shows."""
    print("")
    print("search covers card keys, the pair fingerprint and both deck ones")
    with Fixture():
        dp.migrate(enrol=False)
        row = dp.report(per=1)["pairs"][0]
        check("by card key", dp.report(query="hog-rider")["total"] >= 1)
        check("by pair fingerprint",
              dp.report(query=row["pairFingerprint"])["total"] == 1,
              str(dp.report(query=row["pairFingerprint"])["total"]))
        check("by deck A fingerprint",
              dp.report(query=row["deckA"]["fingerprint"])["total"] >= 1,
              str(dp.report(query=row["deckA"]["fingerprint"])["total"]))
        check("by deck B fingerprint",
              dp.report(query=row["deckB"]["fingerprint"])["total"] >= 1,
              str(dp.report(query=row["deckB"]["fingerprint"])["total"]))
        check("a fingerprint that exists nowhere finds nothing",
              dp.report(query="2v2:0000000000")["total"] == 0)


def test_pagination_is_server_side_and_bounded() -> None:
    """1.29M pairs must never all cross the wire."""
    print("")
    print("paging is bounded and never returns the whole collection")
    with Fixture():
        dp.migrate(enrol=False)
        total = dp.report()["total"]
        check("more pairs than a page", total > 1, str(total))
        for per in (1, 25, 50, 100):
            rep = dp.report(per=per)
            check(f"per={per} honoured", rep["perPage"] == per, str(rep["perPage"]))
            check(f"per={per} returns at most that many",
                  len(rep["pairs"]) <= per, str(len(rep["pairs"])))
        check("per is capped at MAX_PER_PAGE",
              dp.report(per=10**9)["perPage"] == dp.MAX_PER_PAGE)
        check("per below one is clamped up", dp.report(per=0)["perPage"] == 1)
        check("page below one clamps", dp.report(page=-5, per=1)["page"] == 1)
        check("page past the end clamps",
              dp.report(page=10**9, per=1)["page"] == dp.report(per=1)["pages"])


def test_the_board_states_the_bounded_population() -> None:
    """It must not read as a census of all 866k+ participants."""
    print("")
    print("the board publishes what population it covers")
    with Fixture():
        dp.migrate(enrol=False)
        summ = dp.report()["summary"]
        check("the limit is published", summ["populationLimit"] == 1000,
              str(summ["populationLimit"]))
        check("the retained count is published", "population" in summ)
        check("the full participant count is published too",
              summ["participants"] >= summ["population"],
              f'{summ["participants"]} vs {summ["population"]}')
        check("the cut is published", "populationCut" in summ)


def test_empty_results_are_a_clean_page() -> None:
    print("")
    print("a search matching nothing is an empty page, not an error")
    with Fixture():
        dp.migrate(enrol=False)
        rep = dp.report(query="mega-knight")
        check("no rows", rep["pairs"] == [])
        check("total zero", rep["total"] == 0)
        check("still one page", rep["pages"] == 1, str(rep["pages"]))
        check("page clamps to one", rep["page"] == 1)
        check("the summary still describes the collection",
              rep["summary"]["uniquePairs"] > 0)


def test_the_board_preserves_pair_semantics() -> None:
    """A + B is B + A, card order is irrelevant, and opposing decks are never
    a pair. Asserted through the board's own output."""
    print("")
    print("the board's rows obey the pair rules")
    with Fixture():
        dp.migrate(enrol=False)
        rep = dp.report(per=50)
        for p in rep["pairs"]:
            a, b = p["deckA"], p["deckB"]
            check(f'{p["pairFingerprint"][:12]} deck A is canonically sorted',
                  a["cardKeys"] == sorted(a["cardKeys"]))
            check(f'{p["pairFingerprint"][:12]} deck B is canonically sorted',
                  b["cardKeys"] == sorted(b["cardKeys"]))
            check(f'{p["pairFingerprint"][:12]} the pair is canonically ordered',
                  a["fingerprint"] <= b["fingerprint"],
                  f'{a["fingerprint"]} vs {b["fingerprint"]}')
            check(f'{p["pairFingerprint"][:12]} recomputes to its own id',
                  dp.pair_fingerprint(a["fingerprint"], b["fingerprint"])
                  == p["pairFingerprint"])
            check(f'{p["pairFingerprint"][:12]} order-swapped gives the same id',
                  dp.pair_fingerprint(b["fingerprint"], a["fingerprint"])
                  == p["pairFingerprint"])


def test_every_row_can_be_drawn() -> None:
    """The board renders sixteen card images per row; a row missing art or ids
    would render as gaps."""
    print("")
    print("every row carries what the board draws")
    with Fixture():
        dp.migrate(enrol=False)
        for p in dp.report(per=50)["pairs"]:
            for side in ("deckA", "deckB"):
                d = p[side]
                check(f'{side} has eight cards', len(d["cards"]) == 8)
                check(f'{side} every card has a key', all(c["key"] for c in d["cards"]))
                check(f'{side} every card has a real id',
                      all(c["id"] > 0 for c in d["cards"]), str(d["cardIds"]))
                check(f'{side} every card is named', all(c["name"] for c in d["cards"]))
            check("occurrences is a positive count", p["occurrences"] >= 1)
            check("players is a count", p["players"] >= 0)
            check("first seen is not after last seen",
                  p["firstSeen"] <= p["lastSeen"])




def test_the_cursor_stops_at_an_unresolvable_payload() -> None:
    """THE HOLE THAT WOULD HAVE SHIPPED, caught in the pre-deploy review.

    A 2v2 payload the fold cannot resolve is skipped -- and the first version
    of the cursor advanced past it anyway, so the raw cap would have deleted a
    battle that had never been folded. The raw copy is the only record of it.

    THIS IS NOT HYPOTHETICAL. When Minion Giant shipped and this host's card
    catalog was a commit behind, 81,941 sides resolved to nothing. Under a
    cursor that advanced regardless, every one of those battles would have been
    deleted instead of waiting for the catalog fix -- turning "deploy the card
    file and re-run" into permanent loss.
    """
    print("")
    print("the cursor will not step over a payload it could not read")
    with Fixture() as fx:
        bad = payload("20260921T100000.000Z",
                      [("#BAD1", HOG), ("#BAD2", GIANT)],
                      [("#BAD3", BAIT), ("#BAD4", LAVA)])
        bad["team"][0]["cards"][0]["id"] = 99999999      # no catalog knows it
        bad["opponent"][0]["cards"][0]["id"] = 99999999
        _add_raw(fx, "#BAD1", bad, stored="2026-09-21T10:00:00+00:00")
        # ...and a perfectly good payload stored AFTER it, which must not drag
        # the cursor over the bad one.
        _add_raw(fx, "#OK1", payload("20260922T100000.000Z",
                 [("#OK1", MINER), ("#OK2", GOLEM)],
                 [("#OK3", BAIT), ("#OK4", LAVA)]),
                 stored="2026-09-22T10:00:00+00:00")

        out = dp.migrate(enrol=False)
        cursor = dp.processed_through()
        check("the run reported the unresolved payload",
              out["sidesUnresolved"] == 2, str(out["sidesUnresolved"]))
        check("and named where the cursor stopped",
              out["cursorBlockedAt"] == "2026-09-21T10:00:00+00:00",
              str(out["cursorBlockedAt"]))
        check("the cursor did NOT reach the unresolvable payload",
              cursor < "2026-09-21T10:00:00+00:00", repr(cursor))
        check("nor the good payload behind it",
              cursor < "2026-09-22T10:00:00+00:00", repr(cursor))
        check("so the raw cap would protect both",
              _purgeable(cursor, "2026-09-21T10:00:00+00:00") is False
              and _purgeable(cursor, "2026-09-22T10:00:00+00:00") is False)
        check("but everything before the block stays purgeable",
              _purgeable(cursor, "2026-09-01T09:00:00+00:00") is True)


def test_a_clean_run_reports_no_block() -> None:
    print("")
    print("a run with nothing unresolvable reports no block")
    with Fixture():
        out = dp.migrate(enrol=False)
        check("nothing unresolved", out["sidesUnresolved"] == 0,
              str(out["unresolvedReasons"]))
        check("no block recorded", out["cursorBlockedAt"] is None,
              str(out["cursorBlockedAt"]))
        check("and the cursor advanced", bool(dp.processed_through()))


def test_the_cursor_never_regresses() -> None:
    """A blocked run must not push the cursor BACKWARDS below what an earlier
    run already proved processed."""
    print("")
    print("a blocked run does not move the cursor backwards")
    with Fixture() as fx:
        dp.migrate(enrol=False)
        before = dp.processed_through()
        bad = payload("20260921T110000.000Z",
                      [("#BB1", HOG), ("#BB2", GIANT)],
                      [("#BB3", BAIT), ("#BB4", LAVA)])
        bad["team"][0]["cards"][0]["id"] = 99999999
        _add_raw(fx, "#BB1", bad, stored="2026-09-21T11:00:00+00:00")
        dp.update()
        after = dp.processed_through()
        check("the cursor did not regress", after >= before, f"{before} -> {after}")
        check("and still does not cover the bad row",
              after < "2026-09-21T11:00:00+00:00", repr(after))




def test_only_a_retryable_refusal_holds_the_cursor() -> None:
    """THE DESIGN DECISION THAT AVOIDS A PERMANENT JAM.

    `unknown_card` is transient — this host's catalog is behind, and a file
    copy plus a re-run resolves it. Holding the cursor there is right.

    A malformed payload is not transient. No later deploy makes a one-sided
    2v2 readable, so blocking on it would jam the cursor forever, stop ALL raw
    purging and grow the database without bound. A safe direction is not the
    same as a safe resting place.
    """
    print("")
    print("a permanently unreadable payload does not jam the cursor")
    with Fixture() as fx:
        broken = payload("20260923T100000.000Z",
                         [("#MAL1", HOG), ("#MAL2", GIANT)],
                         [("#MAL3", BAIT), ("#MAL4", LAVA)])
        broken["team"] = broken["team"][:1]        # structurally not 2v2
        broken["opponent"] = broken["opponent"][:1]
        _add_raw(fx, "#MAL1", broken, stored="2026-09-23T10:00:00+00:00")

        out = dp.migrate(enrol=False)
        check("it was refused", out["sidesUnresolved"] >= 2,
              str(out["sidesUnresolved"]))
        check("for a permanent reason",
              any(k.startswith("side_not_two_participants")
                  for k in out["unresolvedReasons"]),
              str(out["unresolvedReasons"]))
        check("no retryable refusals", out["retryableRefusals"] == 0,
              str(out["retryableRefusals"]))
        check("so the cursor was NOT held", out["cursorBlockedAt"] is None,
              str(out["cursorBlockedAt"]))
        check("and it advanced past the malformed row",
              dp.processed_through() >= "2026-09-23T10:00:00+00:00",
              repr(dp.processed_through()))


def test_one_bad_side_still_holds_the_cursor() -> None:
    """The case the first version of this check missed: a payload where ONE
    side carries an unknown card still yields the other side's pair, so the
    payload looks handled while half of it was dropped."""
    print("")
    print("a half-readable payload still holds the cursor")
    with Fixture() as fx:
        half = payload("20260924T100000.000Z",
                       [("#HALF1", HOG), ("#HALF2", GIANT)],
                       [("#HALF3", BAIT), ("#HALF4", LAVA)])
        half["team"][0]["cards"][0]["id"] = 99999999   # only the team side
        _add_raw(fx, "#HALF1", half, stored="2026-09-24T10:00:00+00:00")

        out = dp.migrate(enrol=False)
        check("one side survived", out["sidesResolved"] > 0)
        check("one side did not", out["sidesUnresolved"] >= 1,
              str(out["sidesUnresolved"]))
        check("it is counted as retryable", out["retryableRefusals"] >= 1,
              str(out["retryableRefusals"]))
        check("and the cursor is held at it",
              out["cursorBlockedAt"] == "2026-09-24T10:00:00+00:00",
              str(out["cursorBlockedAt"]))
        check("so the raw cap protects that payload",
              _purgeable(dp.processed_through(), "2026-09-24T10:00:00+00:00")
              is False)


# --------------------------------------------------------------------------
# The cursor invariant, case by case
# --------------------------------------------------------------------------
#
# THE CURSOR MEANS: every RETRYABLE piece of 2v2 raw at or before this
# stored_at has been successfully incorporated. It does NOT mean "the fold read
# this row", and it must never advance past a retryable refusal.
#
# It MAY advance past a permanently malformed payload, because no future
# catalog or code deploy makes that payload readable — and holding on one would
# stop all raw purging forever. "Safe to move the cursor past" and
# "successfully incorporated" are related but not the same claim.

UNKNOWN_ID = 99999999          # no catalog knows it -> retryable


def _occ(fp):
    con = sqlite3.connect(dp.DB_PATH)
    try:
        r = con.execute(
            "SELECT occurrences FROM duo_pairs WHERE pair_fingerprint = ?",
            (fp,)).fetchone()
        return r[0] if r else 0
    finally:
        con.close()


def _sides_staged(bid):
    con = sqlite3.connect(dp.DB_PATH)
    try:
        return {r[0] for r in con.execute(
            "SELECT side FROM duo_stage WHERE battle_id = ?", (bid,))}
    finally:
        con.close()


def _broken(p, side, index=0):
    """Give one participant a card id no catalog knows -> a RETRYABLE refusal."""
    p[side][index]["cards"][0]["id"] = UNKNOWN_ID
    return p


def _malformed(p):
    """Structurally not 2v2 -> a PERMANENT refusal."""
    p["team"] = p["team"][:1]
    p["opponent"] = p["opponent"][:1]
    return p


def test_case_a_both_sides_valid() -> None:
    print("")
    print("CASE A — both sides valid")
    with Fixture() as fx:
        stamp = "2026-09-25T10:00:00+00:00"
        _add_raw(fx, "#A1", payload("20260925T100000.000Z",
                 [("#A1", HOG), ("#A2", GIANT)],
                 [("#A3", MINER), ("#A4", GOLEM)]), stored=stamp)
        out = dp.migrate(enrol=False)
        check("nothing unresolved", out["sidesUnresolved"] == 0,
              str(out["unresolvedReasons"]))
        check("no block", out["cursorBlockedAt"] is None)
        check("the cursor advanced past it",
              dp.processed_through() >= stamp, repr(dp.processed_through()))
        check("so the raw becomes purgeable",
              _purgeable(dp.processed_through(), stamp) is True)


def test_case_b_both_sides_unknown_card() -> None:
    print("")
    print("CASE B — both sides carry an unknown card")
    with Fixture() as fx:
        stamp = "2026-09-25T11:00:00+00:00"
        p = payload("20260925T110000.000Z",
                    [("#B1", HOG), ("#B2", GIANT)],
                    [("#B3", MINER), ("#B4", GOLEM)])
        _broken(p, "team"); _broken(p, "opponent")
        _add_raw(fx, "#B1", p, stored=stamp)
        out = dp.migrate(enrol=False)
        check("neither side incorporated", out["sidesUnresolved"] == 2,
              str(out["sidesUnresolved"]))
        check("retryable refusals recorded", out["retryableRefusals"] == 2,
              str(out["retryableRefusals"]))
        check("the block names the payload", out["cursorBlockedAt"] == stamp,
              str(out["cursorBlockedAt"]))
        check("the cursor did not advance past it",
              dp.processed_through() < stamp, repr(dp.processed_through()))
        check("so the raw stays protected",
              _purgeable(dp.processed_through(), stamp) is False)


def test_case_c_one_side_unknown_one_valid() -> None:
    """THE CRITICAL REGRESSION. One teammate pair resolves, the other does not.
    The successful half must not be double-counted on retry, and the failed
    half must still be recoverable."""
    print("")
    print("CASE C — one side unknown, one side valid (the critical case)")
    with Fixture() as fx:
        stamp = "2026-09-25T12:00:00+00:00"
        p = payload("20260925T120000.000Z",
                    [("#C1", HOG), ("#C2", GIANT)],
                    [("#C3", MINER), ("#C4", GOLEM)])
        _broken(p, "team")
        _add_raw(fx, "#C1", p, stored=stamp)
        bid = dp.battle_identity(p)
        good = dp.pair_fingerprint(dp.deck_fingerprint(MINER), dp.deck_fingerprint(GOLEM))
        bad = dp.pair_fingerprint(dp.deck_fingerprint(HOG), dp.deck_fingerprint(GIANT))

        out1 = dp.migrate(enrol=False)
        good1, bad1 = _occ(good), _occ(bad)
        check("the valid side WAS incorporated", "opponent" in _sides_staged(bid),
              str(_sides_staged(bid)))
        check("the unknown side was NOT", "team" not in _sides_staged(bid),
              str(_sides_staged(bid)))
        check("it is counted as retryable", out1["retryableRefusals"] == 1,
              str(out1["retryableRefusals"]))
        check("the cursor did NOT advance past the payload",
              dp.processed_through() < stamp, repr(dp.processed_through()))
        check("so the raw payload stays protected",
              _purgeable(dp.processed_through(), stamp) is False)

        # The catalog is deployed and the fold is re-run.
        dp._ID_TO_KEY[UNKNOWN_ID] = "knight"
        try:
            out2 = dp.migrate(enrol=False)
            check("the retry resolved everything", out2["sidesUnresolved"] == 0,
                  str(out2["unresolvedReasons"]))
            check("both sides are now staged", _sides_staged(bid) == {"team", "opponent"},
                  str(_sides_staged(bid)))
            check("the already-successful side was NOT double-counted",
                  _occ(good) == good1, f"{good1} -> {_occ(good)}")
            check("the failed side WAS incorporated", _occ(bad) == bad1 + 1,
                  f"{bad1} -> {_occ(bad)}")
            check("every participant counts exactly one battle",
                  all(_battles_of(t) == 1 for t in ("#C1", "#C2", "#C3", "#C4")),
                  str([_battles_of(t) for t in ("#C1", "#C2", "#C3", "#C4")]))
            check("and the cursor may now advance",
                  dp.processed_through() >= stamp, repr(dp.processed_through()))
        finally:
            dp._ID_TO_KEY.pop(UNKNOWN_ID, None)


def test_case_d_permanent_malformed_payload() -> None:
    print("")
    print("CASE D — permanently malformed payload")
    with Fixture() as fx:
        stamp = "2026-09-25T13:00:00+00:00"
        _add_raw(fx, "#D1", _malformed(payload("20260925T130000.000Z",
                 [("#D1", HOG), ("#D2", GIANT)],
                 [("#D3", MINER), ("#D4", GOLEM)])), stored=stamp)
        out = dp.migrate(enrol=False)
        check("it was refused", out["sidesUnresolved"] >= 2,
              str(out["sidesUnresolved"]))
        check("the refusal is observable and named",
              any(k.startswith("side_not_two_participants")
                  for k in out["unresolvedReasons"]),
              str(out["unresolvedReasons"]))
        check("it is NOT retryable", out["retryableRefusals"] == 0,
              str(out["retryableRefusals"]))
        check("so it does not jam the cursor", out["cursorBlockedAt"] is None)
        check("the cursor progresses beyond it",
              dp.processed_through() >= stamp, repr(dp.processed_through()))
        check("and it was never claimed as incorporated",
              _sides_staged(dp.battle_identity(payload(
                  "20260925T130000.000Z",
                  [("#D1", HOG), ("#D2", GIANT)],
                  [("#D3", MINER), ("#D4", GOLEM)]))) == set())


def test_case_e_permanent_then_valid() -> None:
    print("")
    print("CASE E — permanent refusal followed by a valid payload")
    with Fixture() as fx:
        _add_raw(fx, "#E0", _malformed(payload("20260925T140000.000Z",
                 [("#E0", HOG), ("#E9", GIANT)],
                 [("#E8", MINER), ("#E7", GOLEM)])),
                 stored="2026-09-25T14:00:00+00:00")
        later = "2026-09-25T15:00:00+00:00"
        _add_raw(fx, "#E1", payload("20260925T150000.000Z",
                 [("#E1", HOG), ("#E2", GIANT)],
                 [("#E3", MINER), ("#E4", GOLEM)]), stored=later)
        out = dp.migrate(enrol=False)
        check("the later payload was processed", out["sidesResolved"] >= 2,
              str(out["sidesResolved"]))
        check("the permanent one did not block it",
              out["cursorBlockedAt"] is None, str(out["cursorBlockedAt"]))
        check("the cursor progressed normally",
              dp.processed_through() >= later, repr(dp.processed_through()))


def test_case_f_retryable_then_valid() -> None:
    print("")
    print("CASE F — retryable refusal followed by a valid payload")
    with Fixture() as fx:
        blocked = "2026-09-25T16:00:00+00:00"
        p = payload("20260925T160000.000Z",
                    [("#F1", HOG), ("#F2", GIANT)],
                    [("#F3", MINER), ("#F4", GOLEM)])
        _broken(p, "team"); _broken(p, "opponent")
        _add_raw(fx, "#F1", p, stored=blocked)
        later = "2026-09-25T17:00:00+00:00"
        _add_raw(fx, "#F5", payload("20260925T170000.000Z",
                 [("#F5", BAIT), ("#F6", LAVA)],
                 [("#F7", MINER), ("#F8", GOLEM)]), stored=later)

        out = dp.migrate(enrol=False)
        check("the cursor stopped at or before the blocked payload",
              dp.processed_through() < blocked, repr(dp.processed_through()))
        check("...and therefore also protects the later one",
              _purgeable(dp.processed_through(), later) is False)
        check("the later payload may still have been READ and folded",
              out["sidesResolved"] >= 2, str(out["sidesResolved"]))

        dp._ID_TO_KEY[UNKNOWN_ID] = "knight"
        try:
            dp.migrate(enrol=False)
            check("after the catalog fix the blocked payload is retried",
                  dp.processed_through() >= later, repr(dp.processed_through()))
        finally:
            dp._ID_TO_KEY.pop(UNKNOWN_ID, None)


def test_case_g_row_arrives_during_the_fold() -> None:
    """A row inserted while a fold runs is outside that fold's snapshot, and
    its stored_at is later than everything in it — so the cursor cannot claim
    it and the next run collects it."""
    print("")
    print("CASE G — a row arrives while the fold is running")
    with Fixture() as fx:
        dp.migrate(enrol=False)
        cursor = dp.processed_through()
        arrived = "2026-12-01T00:00:00+00:00"          # later than the fold saw
        _add_raw(fx, "#G1", payload("20261201T000000.000Z",
                 [("#G1", HOG), ("#G2", GIANT)],
                 [("#G3", MINER), ("#G4", GOLEM)]), stored=arrived)
        check("the cursor does not claim it", cursor < arrived, repr(cursor))
        check("so the raw cap protects it",
              _purgeable(cursor, arrived) is False)
        before = dp.report()["summary"]["occurrences"]
        dp.update()
        check("the next run processes it",
              dp.report()["summary"]["occurrences"] > before,
              str(dp.report()["summary"]["occurrences"]))
        check("and only then does the cursor cover it",
              dp.processed_through() >= arrived, repr(dp.processed_through()))


def test_case_h_fold_failure_mid_run() -> None:
    """An exception partway through must not leave the cursor claiming rows
    that were never incorporated, and re-running must be idempotent."""
    print("")
    print("CASE H — the fold raises partway through")
    with Fixture() as fx:
        dp.migrate(enrol=False)
        before_cursor = dp.processed_through()
        before_occ = dp.report()["summary"]["occurrences"]

        stamp = "2026-11-01T00:00:00+00:00"
        _add_raw(fx, "#H1", payload("20261101T000000.000Z",
                 [("#H1", HOG), ("#H2", GIANT)],
                 [("#H3", MINER), ("#H4", GOLEM)]), stored=stamp)

        real = dp._fold
        dp._fold = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
        try:
            dp.update()
            check("the run raised", False, "no exception")
        except RuntimeError:
            check("the run raised", True)
        finally:
            dp._fold = real

        check("the cursor did NOT advance", dp.processed_through() == before_cursor,
              f"{before_cursor} -> {dp.processed_through()}")
        check("so the new payload is still protected",
              _purgeable(dp.processed_through(), stamp) is False)

        dp.update()
        check("re-running succeeds", dp.processed_through() >= stamp,
              repr(dp.processed_through()))
        after = dp.report()["summary"]["occurrences"]
        dp.update()
        check("and is idempotent", dp.report()["summary"]["occurrences"] == after,
              str(dp.report()["summary"]["occurrences"]))
        check("nothing was lost", after > before_occ, f"{before_occ} -> {after}")


def test_adversarial_sequences() -> None:
    """Every combination of valid / retryable / permanent, checked for the five
    properties that matter."""
    print("")
    print("adversarial sequences")
    kinds = ("valid", "unknown", "permanent")
    n = 0
    for first in kinds:
        for second in kinds:
            n += 1
            with Fixture() as fx:
                stamps = []
                for i, kind in enumerate((first, second)):
                    stamp = "2026-10-%02dT00:00:00+00:00" % (i + 1)
                    stamps.append(stamp)
                    p = payload("202610%02dT000000.000Z" % (i + 1),
                                [("#S%d1" % i, HOG), ("#S%d2" % i, GIANT)],
                                [("#S%d3" % i, MINER), ("#S%d4" % i, GOLEM)])
                    if kind == "unknown":
                        _broken(p, "team")
                    elif kind == "permanent":
                        _malformed(p)
                    _add_raw(fx, "#S%d1" % i, p, stored=stamp)

                out = dp.migrate(enrol=False)
                cursor = dp.processed_through()
                label = f"{first}/{second}"

                # 1. nothing retryable before the cursor is left unresolved
                if out["cursorBlockedAt"]:
                    check(f"[{label}] cursor stops before the block",
                          cursor < out["cursorBlockedAt"],
                          f'{cursor} vs {out["cursorBlockedAt"]}')
                else:
                    check(f"[{label}] no retryable work outstanding",
                          out["retryableRefusals"] == 0,
                          str(out["retryableRefusals"]))

                # 2/3. re-running changes no count
                occ = dp.report()["summary"]["occurrences"]
                parts = dp.report()["summary"].get("uniquePairs")
                dp.migrate(enrol=False)
                check(f"[{label}] occurrences stable on re-run",
                      dp.report()["summary"]["occurrences"] == occ,
                      str(dp.report()["summary"]["occurrences"]))
                check(f"[{label}] pairs stable on re-run",
                      dp.report()["summary"]["uniquePairs"] == parts)

                # 4. a retryable problem is never silently dropped
                if "unknown" in (first, second):
                    check(f"[{label}] the retryable refusal is reported",
                          out["retryableRefusals"] > 0,
                          str(out["retryableRefusals"]))

                # 5. permanent data does not jam the cursor
                if first == "permanent" and second == "permanent":
                    check(f"[{label}] permanent-only does not block",
                          out["cursorBlockedAt"] is None,
                          str(out["cursorBlockedAt"]))
    print(f"       {n} sequences checked")


def test_the_same_battle_from_several_participants_still_counts_once() -> None:
    print("")
    print("one battle delivered from several tracked participants")
    with Fixture() as fx:
        p = payload("20261010T000000.000Z",
                    [("#M1", HOG), ("#M2", GIANT)],
                    [("#M3", MINER), ("#M4", GOLEM)])
        # the same battle, stored under all four participants
        for i, tag in enumerate(("#M1", "#M2", "#M3", "#M4")):
            _add_raw(fx, tag, p, stored="2026-10-10T0%d:00:00+00:00" % i)
        out = dp.migrate(enrol=False)
        # MEASURED AGAINST THE FIXTURE'S OWN CONTENTS, not as absolutes. The
        # fixture ships four payloads covering three battles (one of them
        # already stored twice), so this test's four copies of one battle take
        # the totals to eight payloads and four real battles. Asserting the
        # bare numbers here has caught me out repeatedly and each time the code
        # was right.
        check("this battle's four copies were all read",
              out["payloadsRead"] == 8, str(out["payloadsRead"]))
        check("and collapsed to one real battle",
              out["battlesDeduplicated"] == 4, str(out["battlesDeduplicated"]))
        check("so three of its copies were folded away",
              out["duplicatePayloads"] == 4, str(out["duplicatePayloads"]))
        check("each participant counts one battle",
              all(_battles_of(t) == 1 for t in ("#M1", "#M2", "#M3", "#M4")),
              str([_battles_of(t) for t in ("#M1", "#M2", "#M3", "#M4")]))
        bid = dp.battle_identity(p)
        check("exactly two staged sides", len(_sides_staged(bid)) == 2,
              str(_sides_staged(bid)))


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
    test_an_unprocessed_2v2_payload_is_protected()
    test_a_processed_2v2_payload_becomes_purgeable()
    test_the_cursor_fails_closed()
    test_the_cursor_never_overstates_progress()
    test_the_cursor_stops_at_an_unresolvable_payload()
    test_a_clean_run_reports_no_block()
    test_the_cursor_never_regresses()
    test_only_a_retryable_refusal_holds_the_cursor()
    test_one_bad_side_still_holds_the_cursor()
    test_case_a_both_sides_valid()
    test_case_b_both_sides_unknown_card()
    test_case_c_one_side_unknown_one_valid()
    test_case_d_permanent_malformed_payload()
    test_case_e_permanent_then_valid()
    test_case_f_retryable_then_valid()
    test_case_g_row_arrives_during_the_fold()
    test_case_h_fold_failure_mid_run()
    test_adversarial_sequences()
    test_the_same_battle_from_several_participants_still_counts_once()
    test_folding_twice_still_counts_once()
    test_duel_raw_is_not_in_scope()
    test_a_pruned_players_count_does_not_go_backwards()
    test_pruning_never_drops_an_uncounted_row()
    test_the_board_ranks_and_pages()
    test_the_board_offers_three_orderings()
    test_an_unknown_sort_falls_back_rather_than_reaching_the_sql()
    test_each_ordering_actually_orders()
    test_the_default_is_most_played()
    test_search_finds_a_deck_fingerprint_not_only_a_pair_one()
    test_pagination_is_server_side_and_bounded()
    test_the_board_states_the_bounded_population()
    test_empty_results_are_a_clean_page()
    test_the_board_preserves_pair_semantics()
    test_every_row_can_be_drawn()
    test_a_pair_row_carries_what_the_board_draws()
    test_the_board_can_be_searched()
    test_never_built_is_not_built_and_empty()
    test_no_payloads_at_all_is_survivable()
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
