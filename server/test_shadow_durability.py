"""Phase 19C-FIX — the shadow log must not lose observations.

WHY THIS FILE EXISTS. 1,277 observations collected in 16C were destroyed, and
the cause was not exotic: `test_anchor_is_battle_time_format_not_wall_clock`
called `os.remove()` on the PRODUCTION log path, so running the test suite wiped
the experiment. Two other paths could also have lost records silently — a fixed
`.1` rotation name that overwrote its own archive, and a bare `except: pass`
around the whole write.

Every test here writes to a temp directory. None of them can reach the real log.
"""
import json
import multiprocessing
import os
import shutil
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml.production import shadow
from ml.production import policy


def _result(band="high", n_alts=0):
    return policy.PredictionResult(
        primary_deck=["c%d" % i for i in range(8)], primary_confidence=band,
        change_probability=0.05,
        alternatives=[{"cards": ["d%d" % i for i in range(8)], "out": [],
                       "in": [], "confidence": "low", "evidence": []}
                      for _ in range(n_alts)])


def _write_many(path, n, tag_prefix):
    """Module-level so it can be a multiprocessing target on Windows spawn."""
    shadow.LOG_PATH = path
    for i in range(n):
        shadow.record("%s%d" % (tag_prefix, i), "duel", _result(), 10, 5, 1.0,
                      anchor_ts="20260810T120000.000Z")


class _TempLog(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "shadow-log.jsonl")
        self._old = shadow.LOG_PATH
        shadow.LOG_PATH = self.path

    def tearDown(self):
        shadow.LOG_PATH = self._old
        shutil.rmtree(self.dir, ignore_errors=True)

    def lines(self):
        if not os.path.exists(self.path):
            return []
        with open(self.path, encoding="utf-8") as fh:
            return [l for l in fh.read().splitlines() if l.strip()]


class NoTestReachesProduction(unittest.TestCase):
    def test_the_log_path_is_overridable(self):
        """The single change that makes the 16C loss unrepeatable."""
        import inspect
        src = inspect.getsource(shadow)
        self.assertIn('os.getenv("CLASH_OIE_LOG"', src)

    def test_no_test_file_removes_the_production_log(self):
        here = os.path.dirname(os.path.abspath(__file__))
        offenders = []
        me = os.path.basename(__file__)
        for name in os.listdir(here):
            if not (name.startswith("test_") and name.endswith(".py")):
                continue
            if name == me:
                continue          # this file quotes the markers it searches for
            src = open(os.path.join(here, name), encoding="utf-8").read()
            for marker in ("_os.remove(shadow.LOG_PATH)",
                           "os.remove(shadow.LOG_PATH)"):
                if marker in src:
                    offenders.append(name)
        self.assertEqual(offenders, [],
                         "these tests delete the production shadow log: %s"
                         % offenders)


class AppendDurability(_TempLog):
    def test_every_record_survives(self):
        for i in range(50):
            shadow.record("#T%d" % i, "duel", _result(), 10, 5, 1.0,
                          anchor_ts="20260810T120000.000Z")
        self.assertEqual(len(self.lines()), 50)

    def test_records_carry_a_unique_id(self):
        for i in range(30):
            shadow.record("#T%d" % i, "duel", _result(), 10, 5, 1.0)
        ids = [json.loads(l)["id"] for l in self.lines()]
        self.assertEqual(len(ids), 30)
        self.assertEqual(len(set(ids)), 30, "ids collided")

    def test_an_existing_log_is_never_replaced(self):
        shadow.record("#A", "duel", _result(), 10, 5, 1.0)
        first = self.lines()[0]
        shadow.record("#B", "duel", _result(), 10, 5, 1.0)
        self.assertEqual(len(self.lines()), 2)
        self.assertEqual(self.lines()[0], first, "the first record was replaced")

    def test_restart_mid_collection_appends_rather_than_truncates(self):
        """A fresh process must continue the log, not start it over."""
        for i in range(10):
            shadow.record("#A%d" % i, "duel", _result(), 10, 5, 1.0)
        import importlib
        importlib.reload(shadow)
        shadow.LOG_PATH = self.path
        for i in range(10):
            shadow.record("#B%d" % i, "duel", _result(), 10, 5, 1.0)
        self.assertEqual(len(self.lines()), 20)

    def test_a_write_failure_is_counted_not_swallowed(self):
        before = shadow.write_stats()["errors"]

        class Boom:
            primary_deck = ["a"] * 8
            primary_confidence = "high"
            alternatives = []
            degraded = False
            reason = ""

            @property
            def change_probability(self):
                raise RuntimeError("nope")

        shadow.record("#X", "duel", Boom(), 10, 5, 1.0)
        self.assertEqual(shadow.write_stats()["errors"], before + 1)


class Rotation(_TempLog):
    def test_rotation_never_discards_the_active_log(self):
        old_max = shadow.MAX_BYTES
        shadow.MAX_BYTES = 800                 # force rotation quickly
        try:
            for i in range(40):
                shadow.record("#T%d" % i, "duel", _result(), 10, 5, 1.0)
        finally:
            shadow.MAX_BYTES = old_max
        archives = [f for f in os.listdir(self.dir)
                    if f.startswith("shadow-log.jsonl.") and not f.endswith(".lock")]
        self.assertTrue(archives, "rotation produced no archive")
        total = len(self.lines())
        for a in archives:
            with open(os.path.join(self.dir, a), encoding="utf-8") as fh:
                total += len([l for l in fh.read().splitlines() if l.strip()])
        self.assertEqual(total, 40, "rotation lost records")

    def test_archives_are_timestamped_not_a_fixed_name(self):
        """A fixed `.1` overwrote its own archive on the second rotation."""
        import inspect
        src = inspect.getsource(shadow._rotate_if_needed)
        self.assertNotIn('LOG_PATH + ".1"', src)
        self.assertIn("strftime", src)


class Concurrency(_TempLog):
    def test_many_threads_lose_nothing(self):
        threads = [threading.Thread(target=_write_many,
                                    args=(self.path, 25, "#T%d-" % t))
                   for t in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        lines = self.lines()
        self.assertEqual(len(lines), 150)
        for l in lines:
            json.loads(l)                       # every line is intact JSON
        ids = [json.loads(l)["id"] for l in lines]
        self.assertEqual(len(set(ids)), 150, "records were duplicated")

    def test_multiple_processes_lose_nothing(self):
        """The case that actually bit: separate processes, one file.

        A `threading.Lock` coordinates nothing across processes.
        """
        procs = [multiprocessing.Process(target=_write_many,
                                         args=(self.path, 20, "#P%d-" % i))
                 for i in range(4)]
        for p in procs:
            p.start()
        for p in procs:
            p.join(60)
        lines = self.lines()
        self.assertEqual(len(lines), 80,
                         "expected 80 records, found %d" % len(lines))
        ids = [json.loads(l)["id"] for l in lines]
        self.assertEqual(len(set(ids)), 80)

    def test_a_reader_during_writes_sees_only_whole_records(self):
        stop = threading.Event()
        bad = []

        def reader():
            while not stop.is_set():
                for l in self.lines():
                    try:
                        json.loads(l)
                    except Exception:
                        bad.append(l)

        r = threading.Thread(target=reader, daemon=True)
        r.start()
        _write_many(self.path, 60, "#R")
        stop.set()
        r.join(5)
        self.assertEqual(bad, [], "a reader saw a torn record")


class Verification(_TempLog):
    def test_a_clean_log_verifies(self):
        for i in range(10):
            shadow.record("#T%d" % i, "duel", _result(), 10, 5, 1.0,
                          anchor_ts="20260810T120000.000Z")
        v = shadow.verify_log(self.path)
        self.assertTrue(v["ok"])
        self.assertEqual(v["records"], 10)
        self.assertEqual(v["duplicateIds"], 0)
        self.assertEqual(v["malformed"], 0)

    def test_a_malformed_trailing_record_is_reported_not_ignored(self):
        for i in range(5):
            shadow.record("#T%d" % i, "duel", _result(), 10, 5, 1.0)
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write('{"truncated": ')          # a torn final line
        v = shadow.verify_log(self.path)
        self.assertFalse(v["ok"])
        self.assertEqual(v["malformed"], 1)
        self.assertIn("malformed", " ".join(v["problems"]))

    def test_duplicates_are_detected(self):
        shadow.record("#T", "duel", _result(), 10, 5, 1.0)
        line = self.lines()[0]
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")               # same id twice
        v = shadow.verify_log(self.path)
        self.assertEqual(v["duplicateIds"], 1)
        self.assertFalse(v["ok"])

    def test_missing_log_is_reported(self):
        v = shadow.verify_log(os.path.join(self.dir, "nope.jsonl"))
        self.assertFalse(v["exists"])
        self.assertFalse(v["ok"])

    def test_version_stamps_are_counted(self):
        shadow.record("#A", "duel", _result(), 10, 5, 1.0)
        old = dict(shadow.VERSIONS)
        try:
            shadow.VERSIONS["policy"] = "something-else"
            shadow.record("#B", "duel", _result(), 10, 5, 1.0)
        finally:
            shadow.VERSIONS.clear()
            shadow.VERSIONS.update(old)
        v = shadow.verify_log(self.path)
        self.assertEqual(len(v["versionStamps"]), 2)


class CheckpointSafety(_TempLog):
    def _entries(self, tags, versions=None):
        return [{"id": "id%d" % i, "player": shadow._hash(t),
                 "ts": "2026-08-19T00:%02d:00Z" % (i % 60), "domain": "duel",
                 "anchorTs": "20260810T120000.000Z", "confidence": "high",
                 "degraded": False, "reason": "", "latencyMs": 10,
                 "versions": versions or dict(shadow.VERSIONS),
                 "primaryHash": "h", "altHashes": []}
                for i, t in enumerate(tags)]

    def test_mixed_version_stamps_block_a_conclusion(self):
        tags = ["#T%d" % i for i in range(120)]
        ents = self._entries(tags[:60])
        ents += self._entries(tags[60:], versions={"policy": "older-system"})
        ck = shadow.checkpoint(tags, lambda t, d: [], ents)
        self.assertFalse(ck["duel"]["enoughPlayers"] and ck["duel"].get("versionsConsistent", True))
        txt = shadow.checkpoint_report(ck)
        self.assertIn("MIXED VERSION", txt.upper())

    def test_a_single_version_stamp_is_consistent(self):
        tags = ["#T%d" % i for i in range(10)]
        ck = shadow.checkpoint(tags, lambda t, d: [], self._entries(tags))
        self.assertTrue(ck["duel"]["versionsConsistent"])




class FrontierWatch(unittest.TestCase):
    """Phase 19C. The cheap readiness test must be right about when to STOP."""

    def test_the_baseline_is_the_freeze_point_not_the_newest_anchor(self):
        """Comparing against the newest ANCHOR gave a false READY: that anchor
        belongs to one player and the global frontier to another, so the
        comparison was already true at freeze time."""
        from ml.production import frontier
        import inspect
        src = inspect.getsource(frontier.readiness)
        self.assertIn("FROZEN_FRONTIER", src)

    def test_an_unadvanced_frontier_is_not_ready(self):
        from ml.production import frontier
        r = frontier.readiness(entries=[], baseline="99999999T999999.000Z")
        self.assertFalse(r["ready"])

    def test_an_advanced_frontier_is_ready(self):
        from ml.production import frontier
        if not frontier.current_frontier():
            self.skipTest("no database")
        r = frontier.readiness(entries=[], baseline="20260101T000000.000Z")
        self.assertTrue(r["ready"])

    def test_a_missing_database_is_not_ready_rather_than_raising(self):
        from ml.production import frontier
        real = frontier.current_frontier
        try:
            frontier.current_frontier = lambda: ""
            r = frontier.readiness(entries=[])
            self.assertFalse(r["ready"])
            self.assertEqual(r["reason"], "no database")
        finally:
            frontier.current_frontier = real

    def test_row_count_is_not_part_of_the_signal(self):
        """Row count grew 43,698 while producing zero outcomes."""
        from ml.production import frontier
        r = frontier.readiness(entries=[])
        self.assertNotIn("rows", json.dumps(r).lower())

if __name__ == "__main__":
    unittest.main(verbosity=1)
