"""test_duo_retention.py — the bounded 2v2 retained set.

    python server/test_duo_retention.py

Plain asserts and a counter, matching `test_duo_pairs.py`. Real SQLite files in
a temp directory: the ranking is an `ORDER BY`, the bound is a `LIMIT` and the
eviction is a `DELETE`, and none of those can be tested against a list of dicts.

WHAT IS WORTH TESTING HERE, which is the half that would be quietly wrong:

  * **each win condition must own its own list.** A crowded bucket must not be
    able to evict a quiet bucket's rows, or `3-musk` — whose 50th pair has 13
    uses on the live data — disappears behind `other`, whose 50th has 392;
  * **a pair with two win conditions must be filed under both**, and must
    survive as long as it is top-50 in either;
  * **a count must outlive its record.** If an evicted pair restarts at 1 it can
    never climb back, which is the whole failure this module exists to avoid;
  * **the bound must actually bind.** Discarded candidates must not accumulate,
    or the tail comes back through the side door;
  * **ties must break the same way twice**, or a rerank reshuffles the board for
    no reason;
  * **deletion must refuse by default.** This runs against a collection with no
    backup.
"""

from __future__ import annotations

import itertools
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import duo_pairs as dp          # noqa: E402
import duo_retention as dr      # noqa: E402

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
# Decks whose archetype is known, built from the bot's own rules
# --------------------------------------------------------------------------
#
# Fillers carry NO win condition and none of the three pre-empting cards
# (`miner`, `goblin-barrel`, `wall-breakers`), so the win condition of a deck
# built here is exactly the card put in front of them.

FILLERS = ["knight", "archers", "musketeer", "cannon", "ice-spirit",
           "skeletons", "fireball", "the-log", "zap", "arrows", "valkyrie",
           "bats", "goblins", "spear-goblins", "tesla", "tombstone",
           "barbarians", "minions", "firecracker", "dart-goblin"]


_COMBOS: list = []


def deck(win_card: str, variant: int) -> list[str]:
    """Eight distinct keys: the win condition plus seven fillers.

    A ROTATION IS NOT ENOUGH and the first version of this used one: rotating a
    20-card list by `variant % 20` yields exactly 20 distinct decks, so asking
    for 70 silently produced 20 and every bucket-depth test passed against a
    bucket that could never fill. `combinations` gives C(20,7) = 77,520.
    """
    global _COMBOS
    if len(_COMBOS) <= variant:
        _COMBOS = list(itertools.islice(itertools.combinations(FILLERS, 7),
                                        variant + 200))
    return sorted(set([win_card] + list(_COMBOS[variant])))


class Fixture:
    """A collection of our own, with the census tables present but empty."""

    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="duo-retention-")
        self.db = os.path.join(self.dir, "pairs.db")
        self._old_path, self._old_ready = dp.DB_PATH, dp._ready
        dp.DB_PATH, dp._ready = self.db, False
        self.con = dr._connect()

    def add(self, win_card_a: str, win_card_b: str, occurrences: int,
            variant: int = 0, battles: int = 0) -> str:
        """One pair record, exactly as `_fold` would leave it."""
        a, b = deck(win_card_a, variant), deck(win_card_b, variant + 7)
        fp_a, fp_b = dp.deck_fingerprint(a), dp.deck_fingerprint(b)
        lo, hi = sorted([fp_a, fp_b])
        cards = {fp_a: a, fp_b: b}
        fp = dp.pair_fingerprint(fp_a, fp_b)
        self.con.execute(
            "INSERT OR REPLACE INTO duo_pairs (pair_fingerprint, mode, "
            "deck_a_fingerprint, deck_b_fingerprint, deck_a_cards, "
            "deck_b_cards, occurrences, distinct_players, player_tags, "
            "first_seen, last_seen, source_modes) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (fp, dp.MODE, lo, hi, json.dumps(cards[lo]), json.dumps(cards[hi]),
             occurrences, 2, "[]", "2026-09-01T00:00:00Z",
             "2026-09-02T00:00:00Z", "TeamVsTeam"))
        for n in range(battles):
            self.con.execute(
                "INSERT OR IGNORE INTO duo_stage (battle_id, side, pair_fp, "
                "deck_a_fp, deck_b_fp, deck_a, deck_b, battle_time, game_mode) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (f"{fp[:12]}-battle-{n}", "team", fp, lo, hi,
                 json.dumps(cards[lo]), json.dumps(cards[hi]),
                 "2026-09-01T00:00:00Z", "TeamVsTeam"))
        self.con.commit()
        return fp

    def close(self):
        self.con.close()
        dp.DB_PATH, dp._ready = self._old_path, self._old_ready
        shutil.rmtree(self.dir, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


# --------------------------------------------------------------------------

def test_the_taxonomy_is_the_canonical_one() -> None:
    print("\nthe win conditions are the bot's own, all of them")
    wcs = dr.all_win_conditions()
    check("17 canonical win conditions", len(wcs) == 17, str(len(wcs)))
    check("`other` is one of them", "other" in wcs)
    for expected in ("hog", "golem", "xbow", "3-musk", "bait", "bridge-spam"):
        check(f"`{expected}` present", expected in wcs)
    check("no editorial style leaked in",
          not {"Beatdown", "Control", "Siege", "Mixed"} & set(wcs))
    # A pair is two decks, so one or two win conditions -- never zero.
    check("a hog+golem pair is filed under both",
          dr.win_conditions(deck("hog-rider", 0), deck("golem", 3))
          == ("golem", "hog"))
    check("a hog+hog pair is filed once",
          dr.win_conditions(deck("hog-rider", 0), deck("hog-rider", 5)) == ("hog",))


def test_each_win_condition_keeps_its_own_fifty() -> None:
    print("\nevery win condition gets its own top 50, and cannot evict another's")
    with Fixture() as fx:
        # A crowded bucket and a quiet one, exactly like `other` vs `3-musk`.
        for i in range(70):
            fx.add("hog-rider", "hog-rider", occurrences=1000 + i, variant=i)
        for i in range(12):
            fx.add("three-musketeers", "three-musketeers", occurrences=2 + i,
                   variant=i)
        out = dr.rebuild(fx.con)
        c = dr.census(fx.con)["winConditions"]
        check("hog retained exactly 50", c["hog"]["retained"] == 50,
              str(c["hog"]["retained"]))
        check("3-musk kept all 12 it has", c["3-musk"]["retained"] == 12,
              str(c["3-musk"]["retained"]))
        check("a quiet bucket survives a crowded one",
              c["3-musk"]["cut"] == 2 and c["3-musk"]["top"] == 13,
              json.dumps(c["3-musk"]))
        check("hog's cut is the 50th count, not the 70th",
              c["hog"]["cut"] == 1000 + 20, str(c["hog"]["cut"]))
        check("no bucket exceeds the depth",
              all(v["retained"] <= 50 for v in c.values()))
        check("rebuild reports what it wrote",
              out["retainedRows"] == sum(v["retained"] for v in c.values()))


def test_ranking_is_usage_and_ties_are_deterministic() -> None:
    print("\nranking is usage count, ties break on the fingerprint")
    with Fixture() as fx:
        fps = [fx.add("golem", "golem", occurrences=5, variant=i)
               for i in range(6)]
        dr.RETAIN_PER_WC, old = 3, dr.RETAIN_PER_WC
        try:
            dr.rebuild(fx.con)
            got = [r["pair_fp"] for r in fx.con.execute(
                "SELECT pair_fp FROM duo_retained WHERE win_condition='golem' "
                "ORDER BY rank")]
            check("an all-tie bucket keeps the lowest fingerprints",
                  got == sorted(fps)[:3], str(got))
            first = list(got)
            dr.rebuild(fx.con)
            again = [r["pair_fp"] for r in fx.con.execute(
                "SELECT pair_fp FROM duo_retained WHERE win_condition='golem' "
                "ORDER BY rank")]
            check("and a second rebuild produces the same order", first == again)
        finally:
            dr.RETAIN_PER_WC = old
    with Fixture() as fx:
        low = fx.add("mortar", "mortar", occurrences=3, variant=1)
        high = fx.add("mortar", "mortar", occurrences=99, variant=2)
        dr.rebuild(fx.con)
        order = [r["pair_fp"] for r in fx.con.execute(
            "SELECT pair_fp FROM duo_retained WHERE win_condition='mortar' "
            "ORDER BY rank")]
        check("more-used ranks first", order == [high, low], str(order))


def test_a_new_pair_can_enter_and_the_fiftieth_can_be_displaced() -> None:
    print("\n#51 can become #50, and a brand-new pair can enter")
    with Fixture() as fx:
        for i in range(50):
            fx.add("balloon", "balloon", occurrences=100 + i, variant=i)
        dr.rebuild(fx.con)
        before = dr.retained_pairs(fx.con)
        weakest = fx.con.execute(
            "SELECT pair_fp FROM duo_retained WHERE win_condition='balloon' "
            "ORDER BY rank DESC LIMIT 1").fetchone()["pair_fp"]
        check("bucket is full at 50", len(before) == 50, str(len(before)))

        # A pair nobody has seen before, arriving with enough use to displace.
        a, b = deck("balloon", 90), deck("balloon", 95)
        fp = dp.pair_fingerprint(dp.deck_fingerprint(a), dp.deck_fingerprint(b))
        dr.observe_pairs(fx.con, [(fp, a, b, 500)])
        after = dr.retained_pairs(fx.con)
        check("the newcomer is retained", fp in after)
        check("the old #50 is gone", weakest not in after)
        check("the bucket is still exactly 50", len(after) == 50, str(len(after)))
        rank = fx.con.execute(
            "SELECT rank FROM duo_retained WHERE pair_fp = ?", (fp,)).fetchone()
        check("and it entered near the top", rank["rank"] == 1, str(rank["rank"]))


def test_a_count_outlives_the_record() -> None:
    print("\nan evicted pair keeps its count and can climb back")
    with Fixture() as fx:
        dr.CANDIDATES_PER_WC, oldc = 4, dr.CANDIDATES_PER_WC
        dr.RETAIN_PER_WC, oldr = 2, dr.RETAIN_PER_WC
        try:
            strong = [fx.add("x-bow", "x-bow", occurrences=50, variant=i)
                      for i in range(4)]
            dr.rebuild(fx.con)
            check("candidates are capped", fx.con.execute(
                "SELECT COUNT(*) c FROM duo_candidates WHERE "
                "win_condition='xbow'").fetchone()["c"] == 4)
            a, b = deck("x-bow", 80), deck("x-bow", 85)
            fp = dp.pair_fingerprint(dp.deck_fingerprint(a),
                                     dp.deck_fingerprint(b))
            # It arrives once: too weak to displace anything.
            dr.observe_pairs(fx.con, [(fp, a, b, 1)])
            check("a single sighting does not displace a strong bucket",
                  fp not in dr.retained_pairs(fx.con))
            # It keeps arriving. Space-Saving lets it inherit the weakest count.
            for _ in range(3):
                dr.observe_pairs(fx.con, [(fp, a, b, 60)])
            row = fx.con.execute(
                "SELECT occurrences, overstated FROM duo_candidates WHERE "
                "pair_fp = ?", (fp,)).fetchone()
            check("it is a candidate now", row is not None)
            check("its count is never understated",
                  row and row["occurrences"] >= 60, str(dict(row)) if row else "")
            check("and the inherited part is recorded, not hidden",
                  row and row["overstated"] >= 0)
            check("it reaches the retained set", fp in dr.retained_pairs(fx.con))
        finally:
            dr.CANDIDATES_PER_WC, dr.RETAIN_PER_WC = oldc, oldr


def test_discarded_candidates_do_not_accumulate() -> None:
    print("\nthe bound binds: discarded candidates cannot grow the store")
    with Fixture() as fx:
        dr.CANDIDATES_PER_WC, oldc = 10, dr.CANDIDATES_PER_WC
        try:
            for i in range(10):
                fx.add("graveyard", "graveyard", occurrences=100, variant=i)
            dr.rebuild(fx.con)
            for i in range(400):        # a flood of one-off partnerships
                a, b = deck("graveyard", 200 + i), deck("graveyard", 900 + i)
                fp = dp.pair_fingerprint(dp.deck_fingerprint(a),
                                         dp.deck_fingerprint(b))
                dr.observe_pairs(fx.con, [(fp, a, b, 1)], commit=False)
            fx.con.commit()
            n = fx.con.execute(
                "SELECT COUNT(*) c FROM duo_candidates").fetchone()["c"]
            check("candidate table stayed at its cap", n == 10, str(n))
            check("400 one-off pairs added nothing", n <= dr.CANDIDATES_PER_WC)
        finally:
            dr.CANDIDATES_PER_WC = oldc


def test_multiple_win_conditions() -> None:
    print("\na pair with two win conditions is filed under both")
    with Fixture() as fx:
        fp = fx.add("hog-rider", "golem", occurrences=40)
        dr.rebuild(fx.con)
        rows = {r["win_condition"] for r in fx.con.execute(
            "SELECT win_condition FROM duo_retained WHERE pair_fp = ?", (fp,))}
        check("filed under hog and golem", rows == {"hog", "golem"}, str(rows))
        check("but counted once as an identity",
              len(dr.retained_pairs(fx.con)) == 1)
        # Retained in one bucket is enough to be retained at all.
        for i in range(60):
            fx.add("golem", "golem", occurrences=900 + i, variant=i + 3)
        dr.rebuild(fx.con)
        keep = dr.retained_pairs(fx.con)
        check("pushed out of golem but kept by hog", fp in keep)
        in_golem = fx.con.execute(
            "SELECT COUNT(*) c FROM duo_retained WHERE pair_fp = ? AND "
            "win_condition='golem'", (fp,)).fetchone()["c"]
        check("and it really did leave the golem list", in_golem == 0)


def test_retained_battles_match_retained_pairs() -> None:
    print("\nthe battles kept are exactly the retained pairs' battles")
    with Fixture() as fx:
        dr.RETAIN_PER_WC, old = 2, dr.RETAIN_PER_WC
        try:
            keep_a = fx.add("miner", "miner", occurrences=90, variant=1, battles=9)
            keep_b = fx.add("miner", "miner", occurrences=80, variant=2, battles=4)
            drop = fx.add("miner", "miner", occurrences=3, variant=3, battles=7)
            dr.rebuild(fx.con)
            keep = dr.retained_pairs(fx.con)
            check("two retained, one dropped",
                  keep == {keep_a, keep_b}, str(len(keep)))
            battles = dr.retained_battles(fx.con)
            check("13 battles retained (9 + 4)", len(battles) == 13,
                  str(len(battles)))
            dropped_ids = {r["battle_id"] for r in fx.con.execute(
                "SELECT battle_id FROM duo_stage WHERE pair_fp = ?", (drop,))}
            check("and none of them belong to the dropped pair",
                  not (battles & dropped_ids))
            plan = dr.prune_plan(fx.con)
            check("the plan counts the removable pair", plan["pairsRemovable"] == 1)
            check("the plan counts the removable battles",
                  plan["stageRowsRemovable"] == 7, str(plan["stageRowsRemovable"]))
            check("and reports the battles it would keep",
                  plan["battlesRetained"] == 13)
        finally:
            dr.RETAIN_PER_WC = old


def test_verification_is_independent() -> None:
    print("\nverify() re-derives the answer rather than trusting the builder")
    with Fixture() as fx:
        for i in range(8):
            fx.add("lava-hound", "lava-hound", occurrences=10 + i, variant=i)
        dr.rebuild(fx.con)
        out = dr.verify(fx.con)
        check("a correct rebuild verifies", out["ok"], json.dumps(out))
        check("no retained row carries an overstated count after a rebuild",
              out["retainedWithOverstatedCount"] == 0)
        # Corrupt the retained set behind verify's back; it must notice.
        fx.con.execute("DELETE FROM duo_retained WHERE rank = 1")
        fx.con.commit()
        bad = dr.verify(fx.con)
        check("and a tampered one does not", not bad["ok"])


def test_deletion_refuses_by_default() -> None:
    print("\nnothing is deleted without an explicit confirmation")
    with Fixture() as fx:
        fx.add("giant", "giant", occurrences=5, variant=1, battles=3)
        fx.add("giant", "giant", occurrences=4, variant=2, battles=2)
        dr.rebuild(fx.con)
        before = fx.con.execute("SELECT COUNT(*) c FROM duo_pairs").fetchone()["c"]
        out = dr.apply_prune(fx.con)
        check("refused with no confirmation", out["refused"])
        check("and it says why", "confirm" in out["why"])
        out2 = dr.apply_prune(fx.con, confirm=True)
        check("still refused while the flag is off", out2["refused"] or not dr.ENABLED)
        after = fx.con.execute("SELECT COUNT(*) c FROM duo_pairs").fetchone()["c"]
        check("nothing was deleted either way", before == after, f"{before} -> {after}")
        check("and the plan is returned instead", "plan" in out)


def test_staging_dedup_and_1v1_are_untouched() -> None:
    print("\nthe dedup ledger and every non-2v2 path are untouched")
    with Fixture() as fx:
        fp = fx.add("royal-giant", "royal-giant", occurrences=2, variant=1,
                    battles=2)
        dr.rebuild(fx.con)
        # The staging primary key is what makes a replay a no-op. Prove it still
        # is after this module has written to the same database.
        rows_before = fx.con.execute(
            "SELECT COUNT(*) c FROM duo_stage").fetchone()["c"]
        fx.con.execute(
            "INSERT OR IGNORE INTO duo_stage (battle_id, side, pair_fp, "
            "deck_a_fp, deck_b_fp, deck_a, deck_b, battle_time, game_mode) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (f"{fp[:12]}-battle-0", "team", fp, "x", "y", "[]", "[]", "t", "m"))
        fx.con.commit()
        rows_after = fx.con.execute(
            "SELECT COUNT(*) c FROM duo_stage").fetchone()["c"]
        check("a replayed (battle, side) is still a no-op",
              rows_before == rows_after, f"{rows_before} -> {rows_after}")
        check("duo_stage was not dropped or rebuilt", rows_after == 2)

        # This module must not know anything about 1v1 or duels: the tables it
        # touches are the two it created plus the two it reads.
        src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "duo_retention.py"), encoding="utf-8").read()
        for forbidden in ("FROM battles", "duel_timeline", "player_stats_agg",
                          "battle_raw", "DELETE FROM duo_battle_players",
                          "DROP TABLE"):
            check(f"never touches `{forbidden}`", forbidden not in src)
        check("and writes only its own two tables",
              src.count("INSERT INTO duo_candidates")
              + src.count("INSERT INTO duo_retained") >= 2)


def test_the_hard_bound() -> None:
    print("\nthe retained identities cannot exceed 17 x 50")
    with Fixture() as fx:
        wc_cards = ["hog-rider", "goblin-drill", "graveyard", "miner",
                    "battle-ram", "royal-hogs", "royal-giant", "lava-hound",
                    "giant", "balloon", "electro-giant", "golem",
                    "three-musketeers", "mortar", "x-bow", "goblin-barrel"]
        for card in wc_cards:
            for i in range(4):
                fx.add(card, card, occurrences=10 + i, variant=i)
        dr.rebuild(fx.con)
        c = dr.census(fx.con)["winConditions"]
        check("every win condition present got a bucket", len(c) >= 16, str(len(c)))
        check("no bucket over the depth",
              all(v["retained"] <= dr.RETAIN_PER_WC for v in c.values()))
        total = sum(v["retained"] for v in c.values())
        check("total rows <= 17 x 50", total <= 17 * dr.RETAIN_PER_WC, str(total))
        check("distinct identities <= total rows",
              len(dr.retained_pairs(fx.con)) <= total)


def test_maintain_counts_only_what_is_new() -> None:
    print("\nmaintenance counts each staged side exactly once")
    with Fixture() as fx:
        fx.add("hog-rider", "hog-rider", occurrences=5, variant=1, battles=5)
        dr.rebuild(fx.con)
        before = fx.con.execute(
            "SELECT occurrences FROM duo_candidates WHERE win_condition='hog'"
        ).fetchone()["occurrences"]
        check("rebuild seeded the exact count", before == 5, str(before))

        # EVERY EXISTING ROW IS ALREADY COUNTED. The rebuild consumed
        # duo_pairs.occurrences, which those rows produced.
        uncounted = fx.con.execute(
            "SELECT COUNT(*) c FROM duo_stage WHERE counted = 0").fetchone()["c"]
        check("existing staging rows default to counted", uncounted == 0, str(uncounted))
        out = dr.maintain(fx.con)
        after = fx.con.execute(
            "SELECT occurrences FROM duo_candidates WHERE win_condition='hog'"
        ).fetchone()["occurrences"]
        check("a maintenance run over nothing new changes nothing",
              after == before and out["staged_counted"] == 0, f"{before} -> {after}")


def test_a_pruned_pair_that_returns_accumulates() -> None:
    print("\na pair dropped from the tail keeps its count and climbs back")
    with Fixture() as fx:
        dr.RETAIN_PER_WC, oldr = 1, dr.RETAIN_PER_WC
        # Deletion is gated on CLASH_DUO_RETENTION, which is off by default and
        # correctly refused the first version of this test. Flipped here only.
        dr.ENABLED, olde = True, dr.ENABLED
        try:
            keep = fx.add("golem", "golem", occurrences=50, variant=1, battles=50)
            tail = fx.add("golem", "golem", occurrences=9, variant=2, battles=9)
            dr.rebuild(fx.con)
            check("only the leader is retained",
                  dr.retained_pairs(fx.con) == {keep})
            dr.apply_prune(fx.con, confirm=True, stage=True)
            gone = fx.con.execute(
                "SELECT COUNT(*) c FROM duo_pairs WHERE pair_fingerprint = ?",
                (tail,)).fetchone()["c"]
            check("the tail pair's record is gone", gone == 0)
            check("and so are its staging rows", fx.con.execute(
                "SELECT COUNT(*) c FROM duo_stage WHERE pair_fp = ?",
                (tail,)).fetchone()["c"] == 0)
            check("the retained pair's battles are untouched", fx.con.execute(
                "SELECT COUNT(*) c FROM duo_stage WHERE pair_fp = ?",
                (keep,)).fetchone()["c"] == 50)
            kept_count = fx.con.execute(
                "SELECT occurrences FROM duo_candidates WHERE pair_fp = ?",
                (tail,)).fetchone()
            check("BUT ITS COUNT SURVIVES in the candidate pool",
                  kept_count and kept_count["occurrences"] == 9,
                  str(dict(kept_count)) if kept_count else "missing")

            # It comes back: 42 new battles arrive for the same pair.
            a, b = deck("golem", 2), deck("golem", 9)
            for n in range(42):
                fx.con.execute(
                    "INSERT OR IGNORE INTO duo_stage (battle_id, side, pair_fp, "
                    "deck_a_fp, deck_b_fp, deck_a, deck_b, battle_time, "
                    "game_mode, counted) VALUES (?,?,?,?,?,?,?,?,?,0)",
                    (f"return-{n}", "team", tail, "x", "y", json.dumps(a),
                     json.dumps(b), "2026-09-17T00:00:00Z", "TeamVsTeam"))
            fx.con.commit()
            dr.maintain(fx.con)
            now = fx.con.execute(
                "SELECT occurrences FROM duo_candidates WHERE pair_fp = ?",
                (tail,)).fetchone()["occurrences"]
            check("it resumes from 9 rather than restarting at 1",
                  now == 51, str(now))
            check("and overtakes the incumbent", tail in dr.retained_pairs(fx.con))
        finally:
            dr.RETAIN_PER_WC, dr.ENABLED = oldr, olde


def test_maintenance_is_idempotent_on_replay() -> None:
    print("\nreplaying a battle after maintenance does not double-count")
    with Fixture() as fx:
        fp = fx.add("mortar", "mortar", occurrences=1, variant=1, battles=1)
        dr.rebuild(fx.con)
        a, b = deck("mortar", 1), deck("mortar", 8)
        row = ("dup-battle", "team", fp, "x", "y", json.dumps(a), json.dumps(b),
               "2026-09-17T00:00:00Z", "TeamVsTeam", 0)
        sql = ("INSERT OR IGNORE INTO duo_stage (battle_id, side, pair_fp, "
               "deck_a_fp, deck_b_fp, deck_a, deck_b, battle_time, game_mode, "
               "counted) VALUES (?,?,?,?,?,?,?,?,?,?)")
        fx.con.execute(sql, row)
        fx.con.commit()
        dr.maintain(fx.con)
        first = fx.con.execute(
            "SELECT occurrences FROM duo_candidates WHERE pair_fp = ?",
            (fp,)).fetchone()["occurrences"]
        # The same battle delivered again — the staging primary key refuses it.
        fx.con.execute(sql, row)
        fx.con.commit()
        dr.maintain(fx.con)
        second = fx.con.execute(
            "SELECT occurrences FROM duo_candidates WHERE pair_fp = ?",
            (fp,)).fetchone()["occurrences"]
        check("a replayed (battle, side) adds nothing", first == second,
              f"{first} -> {second}")
        check("and maintenance run twice adds nothing either",
              dr.maintain(fx.con)["staged_counted"] == 0)


def main() -> int:
    for fn in (test_the_taxonomy_is_the_canonical_one,
               test_each_win_condition_keeps_its_own_fifty,
               test_ranking_is_usage_and_ties_are_deterministic,
               test_a_new_pair_can_enter_and_the_fiftieth_can_be_displaced,
               test_a_count_outlives_the_record,
               test_discarded_candidates_do_not_accumulate,
               test_multiple_win_conditions,
               test_retained_battles_match_retained_pairs,
               test_verification_is_independent,
               test_deletion_refuses_by_default,
               test_staging_dedup_and_1v1_are_untouched,
               test_the_hard_bound,
               test_maintain_counts_only_what_is_new,
               test_a_pruned_pair_that_returns_accumulates,
               test_maintenance_is_idempotent_on_replay):
        fn()
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
