"""test_ml_sampler.py - the R3 labelled sampler (PREREGISTRATION P2-P12).

Everything runs against a temp SQLite file, a temp state dir and a temp log,
with a fake `System` standing in for systemctl / journalctl / /status. Nothing
here can reach the production database, the organic log or a real timer.

    python server/test_ml_sampler.py
"""
import collections
import datetime
import json
import os
import random
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clash_data as cd                                  # noqa: E402
from ml import features as F                             # noqa: E402
from ml.production import predictor as P                 # noqa: E402
from ml.production import sampler as S                   # noqa: E402
from ml.production import shadow, source                 # noqa: E402

I9 = F.FEATURE_NAMES.index("log_hours_since_change")
I10 = F.FEATURE_NAMES.index("log_hours_since_last_play")
CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]
NOW = time.time()


def bt(sec):
    return time.strftime("%Y%m%dT%H%M%S", time.gmtime(int(sec))) + ".000Z"


def fake_tag(i):
    # two all-digit tags exercise the whole-token leak scan
    return "#%d" % (2000000 + i) if i in (7, 8) else "#TQ%05dPY" % i


class FakeSystem:
    def __init__(self):
        self.pid = {"clashbot": 111, "royalweb": 222}
        self.nrestarts = 0
        self.errors = 0
        self.status = (True, 0.05)
        self.load, self.ncpu = 0.1, 4
        self.mem = 4 * 1024 ** 3
        self.disk = 50 * 1024 ** 3
        self.disabled = 0

    def service_pid(self, unit):
        return self.pid[unit]

    def service_nrestarts(self, unit):
        return self.nrestarts

    def journal_errors(self, hours):
        return self.errors

    def status_probe(self):
        return self.status

    def loadavg(self):
        return self.load

    def cpus(self):
        return self.ncpu

    def mem_available(self):
        return self.mem

    def disk_free(self, path):
        return self.disk

    def disable_timer(self):
        self.disabled += 1
        return True


class World(unittest.TestCase):
    """1,000 tracked players, 960 with a competitive shell, 40 with no history."""
    N_FRAME = 1000

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.db = os.path.join(self.dir, "battles.db")
        self.state = os.path.join(self.dir, "state")
        self.logs = os.path.join(self.dir, "results")
        os.makedirs(self.logs)
        con = sqlite3.connect(self.db)
        con.execute("CREATE TABLE tracked_players (tag TEXT, added_at TEXT)")
        con.execute("CREATE TABLE battles (player_tag TEXT, battle_time TEXT, game_mode TEXT, "
                    "player_card_keys TEXT, result TEXT, opponent_win_condition TEXT)")
        self.tags = [fake_tag(i) for i in range(self.N_FRAME)]
        con.executemany("INSERT INTO tracked_players VALUES (?, '2026-08-01')", [(t,) for t in self.tags])
        rows = []
        for i, t in enumerate(self.tags):
            if i % 25 == 24:
                continue                                   # no history -> no record
            for d in range(12):
                extra = "knight" if d < 9 or d == 10 else "ice-golem"
                rows.append((t, bt(NOW - 3600 - (11 - d) * 86400), "Ladder",
                             json.dumps(sorted(CORE + [extra])), "win", ""))
        con.executemany("INSERT INTO battles VALUES (?,?,?,?,?,?)", rows)
        con.commit()
        con.close()
        self.sys = FakeSystem()
        self.patches = [mock.patch.object(cd, "resolve_db_path", lambda: self.db)]
        for p in self.patches:
            p.start()
        source.clear_cache()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        source.clear_cache()

    def make(self, t0=None, seed=12345, organic=""):
        c = S.create(self.state, self.db, self.sys, now=NOW, log_dir=self.logs,
                     organic_log=organic, seed=seed, t0=int(t0 if t0 is not None else NOW - 1.5 * 86400))
        self.lp = mock.patch.object(shadow, "LOG_PATH", c.log_path)
        self.lp.start()
        self.addCleanup(self.lp.stop)
        return c

    def tick(self, now=None, env=None):
        return S.tick(self.state, env if env is not None else {"CLASH_OIE_SAMPLER": "on"},
                      self.sys, self.db,
                      now_fn=(lambda: now) if now else time.time)

    def stats(self, c):
        return S._load_jsonl(c.stats_path)

    def records(self, c):
        return shadow.load(c.log_path)


# ------------------------------------------------------------------ randomization (P3, P4)
class Randomization(unittest.TestCase):
    FRAME = list(range(1, 5325))

    def test_player_sample_is_seeded_without_replacement(self):
        a = S.derive_schedule(7, self.FRAME, 520, 4, 0)
        b = S.derive_schedule(7, list(reversed(self.FRAME)), 520, 4, 0)   # order-free input
        self.assertEqual(a, b)
        self.assertNotEqual(a, S.derive_schedule(8, self.FRAME, 520, 4, 0))
        rowids = [r for r, _ts in a]
        self.assertEqual(len(set(rowids)), 520)
        self.assertTrue(set(rowids) <= set(self.FRAME))

    def test_inclusion_is_uniform_over_the_frame(self):
        hits = collections.Counter()
        for seed in range(300):
            for r, _ts in S.derive_schedule(seed, self.FRAME, 520, 1, 0):
                hits[(r - 1) * 10 // len(self.FRAME)] += 1
        expected = 300 * 520 / 10
        chi2 = sum((hits[d] - expected) ** 2 / expected for d in range(10))
        self.assertLess(chi2, 27.9)                         # df 9, p = 0.001

    def test_moments_are_in_window_and_24h_apart(self):
        for seed in range(50):
            for _r, ts in S.derive_schedule(seed, self.FRAME, 520, 4, 1000):
                self.assertEqual(len(ts), 4)
                self.assertTrue(all(1000 <= t < 1000 + S.WINDOW_S for t in ts))
                self.assertTrue(all(b - a >= S.MIN_SPACING_S for a, b in zip(ts, ts[1:])))

    def test_moments_are_uniform_in_hour_and_weekday(self):
        hours, days = collections.Counter(), collections.Counter()
        for seed in range(60):
            for _r, ts in S.derive_schedule(seed, self.FRAME, 520, 4, 0):
                for t in ts:
                    hours[(t // 3600) % 24] += 1
                    days[t // 86400] += 1
        n = sum(hours.values())
        chi_h = sum((hours[h] - n / 24) ** 2 / (n / 24) for h in range(24))
        self.assertLess(chi_h, 49.7)                        # df 23, p = 0.001
        self.assertEqual(set(days), set(range(7)))
        for d in range(7):
            self.assertGreater(days[d], n / 7 * 0.8)


# ------------------------------------------------------------------ cohort creation
class Creation(World):

    def test_create_is_deterministic_and_tag_free(self):
        c = self.make()
        self.assertEqual(c.cfg["n"], 520)
        self.assertEqual(c.cfg["M"], self.N_FRAME)
        self.assertAlmostEqual(c.cfg["inclusionProbability"], 0.52)
        with open(c.config_path, encoding="utf-8") as fh:
            raw = fh.read()
        for t in self.tags:
            self.assertNotIn(t, raw)
        sched = [(s["rowid"], s["moments"]) for s in c.cfg["selection"]]
        again = S.derive_schedule(c.cfg["seed"], list(range(1, self.N_FRAME + 1)), 520, 4, c.cfg["T0"])
        self.assertEqual([list(x) for x in again], [list(x) for x in sched])
        self.assertEqual(c.cfg["scheduleSha256"], S.schedule_sha(again))
        self.assertEqual(c.cfg["preregistrationSha256"], S.PREREG_SHA256)
        if os.name != "nt":
            self.assertEqual(os.stat(c.config_path).st_mode & 0o777, 0o600)

    def test_only_one_cohort(self):
        self.make()
        with self.assertRaises(SystemExit):
            S.create(self.state, self.db, self.sys, now=NOW, log_dir=self.logs)


# ------------------------------------------------------------------ ticks
class Ticks(World):

    def test_rate_limits_per_tick_hour_and_day(self):
        c = self.make()
        self.assertTrue(self.tick().startswith("ok"))
        moments = [s for s in self.stats(c) if s["type"] == "moment"]
        self.assertEqual(len(moments), S.MAX_PER_TICK)
        for _ in range(2):
            self.tick()
        self.assertEqual(len([s for s in self.stats(c) if s["type"] == "moment"]), 60)
        self.tick()                                         # hour cap reached
        self.assertEqual(len([s for s in self.stats(c) if s["type"] == "moment"]), 60)

    def test_day_cap(self):
        c = self.make()
        fake = [{"type": "moment", "key": "x%d" % i, "player": "p%d" % i, "moment": 0,
                 "scheduledAt": 0, "executedAt": int(NOW) - 7200 - i, "status": "eligible",
                 "latencyMs": 1.0} for i in range(S.MAX_PER_DAY)]
        for f in fake:
            S._append(c.stats_path, f)
        self.tick()
        self.assertEqual(len([s for s in self.stats(c) if s["type"] == "moment"]), S.MAX_PER_DAY)

    def test_no_duplicates_no_retries(self):
        c = self.make()
        self.tick()
        first = {s["key"] for s in self.stats(c) if s["type"] == "moment"}
        self.tick()
        keys = [s["key"] for s in self.stats(c) if s["type"] == "moment"]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertTrue(first <= set(keys))
        ids = [r["id"] for r in self.records(c)]
        self.assertEqual(len(ids), len(set(ids)))

    def test_records_are_schema3_sampler_and_carry_their_horizon(self):
        c = self.make()
        self.tick()
        recs = self.records(c)
        self.assertTrue(recs)
        for r in recs:
            self.assertEqual((r["schema"], r["origin"], r["cohort"], r["domain"]),
                             (3, "sampler", c.id, "competitive"))
            self.assertIn(r["moment"], range(4))
            self.assertEqual(r["horizonUntil"], shadow._stamp_plus(r["requestStamp"], S.HORIZON_S))
            self.assertLessEqual(r["scheduledAt"], r["requestedAt"])
            self.assertEqual(r["readPath"], "miss")
            self.assertTrue(shadow.measurement_order_ok(r))
            self.assertIsInstance(r["pChangeExact"], float)
            self.assertIsInstance(r["pChange9999Exact"], float)
            self.assertAlmostEqual(r["pChange"], round(r["pChangeExact"], 3))
            self.assertIsNotNone(r["player"])
            self.assertNotIn("tag", r)

    def test_ineligible_players_are_counted_not_replaced(self):
        c = self.make()
        for _ in range(3):
            self.tick()
        st = collections.Counter(s["status"] for s in self.stats(c) if s["type"] == "moment")
        self.assertEqual(set(st) - {"eligible", "no_record"}, set())
        self.assertEqual(sum(st.values()), 60)

    def test_kill_switch(self):
        c = self.make()
        self.assertEqual(self.tick(env={"CLASH_OIE_SAMPLER": "off"}), "disabled (kill switch)")
        self.assertEqual(self.tick(env={}), "disabled (kill switch)")
        self.assertEqual(self.stats(c), [])

    def test_window_end_marks_missed_and_disables(self):
        c = self.make()
        self.tick()
        # a test jumps to the window end with few moments run; the day-3
        # zero-eligible condition is exercised on its own below
        with mock.patch.object(S, "ZERO_ELIGIBLE_MAX", 1.0):
            out = self.tick(now=c.cfg["windowEnd"] + 1)
        self.assertTrue(out.startswith("complete"))
        self.assertTrue(os.path.exists(c.complete_path))
        self.assertEqual(self.sys.disabled, 1)
        st = collections.Counter(s["status"] for s in self.stats(c) if s["type"] == "moment")
        self.assertEqual(sum(st.values()), 520 * 4)
        self.assertEqual(self.tick(), "complete")

    def test_frame_change_is_counted(self):
        c = self.make()
        con = sqlite3.connect(self.db)
        con.execute("DELETE FROM tracked_players")
        con.commit()
        con.close()
        self.tick()
        st = {s["status"] for s in self.stats(c) if s["type"] == "moment"}
        self.assertEqual(st, {"frame_changed"})

    def test_rowid_pointing_at_another_player_is_frame_changed(self):
        """A selected rowid that now holds a DIFFERENT tag must not be predicted
        for: only the salted-hash check can tell."""
        c = self.make()
        con = sqlite3.connect(self.db)
        con.execute("UPDATE tracked_players SET tag = '#ZZ' || rowid")
        con.commit()
        con.close()
        self.tick()
        st = {s["status"] for s in self.stats(c) if s["type"] == "moment"}
        self.assertEqual(st, {"frame_changed"})
        self.assertEqual(self.records(c), [])

    def test_failure_isolation(self):
        c = self.make()
        with mock.patch.object(P, "predict_for_tag", side_effect=RuntimeError("boom")):
            out = self.tick()
        self.assertTrue(out.startswith("ok"), out)
        st = [s for s in self.stats(c) if s["type"] == "moment"]
        self.assertEqual({s["status"] for s in st}, {"failed"})
        done = {s["key"] for s in st}
        self.tick()
        again = [s["key"] for s in self.stats(c) if s["type"] == "moment"]
        self.assertEqual(len(again), len(set(again)))          # never retried
        self.assertTrue(done <= set(again))


# ------------------------------------------------------------------ engine equivalence
class Engine(World):

    def test_sampler_path_prediction_equals_plain_prediction(self):
        c = self.make()
        tag = self.tags[3]
        plain = P.predict_for_tag(tag, "competitive")
        source.clear_cache()
        seen = {}

        def extra(result):
            seen["served"] = P.last_served()
            return {"origin": "sampler", "cohort": c.id}
        sampled = P.predict_for_tag(tag, "competitive", record_shadow=True, measurement_extra=extra)
        self.assertEqual(plain.as_dict(), sampled.as_dict())
        self.assertEqual(plain.change_probability, sampled.change_probability)
        self.assertEqual(seen["served"][I9], 0.0)
        self.assertGreater(seen["served"][I10], 0.0)

    def test_counterfactual_is_9999_on_the_same_observation(self):
        c = self.make()
        self.tick()
        r = next(x for x in self.records(c) if x["pChangeExact"] is not None)
        # rebuild the same observation's vector from the record's own stamp
        model = P._load_change_model()
        tag = next(t for t in self.tags if shadow._hash(t) == r["player"])
        with mock.patch.object(P, "_request_stamp", lambda: r["requestStamp"]):
            res = P.predict(tag, "competitive", source.load_plays(tag, "competitive"))
            served = P.last_served()
        self.assertEqual(res.change_probability, r["pChangeExact"])
        cf = list(served)
        cf[I10] = 0.0
        self.assertEqual(1.0 - model.predict(cf).get(0, 0.0), r["pChange9999Exact"])
        # the "9999" engine: an unparseable stamp zeroes x9 and x10
        with mock.patch.object(P, "_request_stamp", lambda: "9999"):
            old = P.predict(tag, "competitive", source.load_plays(tag, "competitive"))
        self.assertAlmostEqual(old.change_probability, r["pChange9999Exact"], places=12)

    def test_extra_cannot_overwrite_measured_clocks(self):
        c = self.make()
        P.predict_for_tag(self.tags[0], "competitive", record_shadow=True,
                          measurement_extra=lambda res: {"requestStamp": "20000101T000000.000Z",
                                                         "origin": "sampler", "cohort": c.id})
        r = self.records(c)[-1]
        self.assertNotEqual(r["requestStamp"], "20000101T000000.000Z")

    def test_coach_path_records_origin_coach(self):
        c = self.make()
        P.predict_for_tag(self.tags[0], "competitive", record_shadow=True)
        r = self.records(c)[-1]
        self.assertEqual((r["schema"], r["origin"], r["cohort"], r["pChangeExact"]),
                         (3, "coach", "", None))


# ------------------------------------------------------------------ outcomes with a horizon
class Outcomes(unittest.TestCase):

    def test_record_horizon_censors_and_24h_sensitivity(self):
        from ml.dataset import DeckPlay
        e = {"id": "a", "schema": 3, "player": "p", "domain": "competitive",
             "anchorTs": "20260901T100000.000Z", "latestVisibleBattle": "20260901T100000.000Z",
             "visibleAsOf": "20260901T110000.000Z", "requestedAt": "20260901T120000.000Z",
             "requestStamp": "20260901T120000.000Z", "horizonUntil": "20260908T120000.000Z",
             "primaryHash": "x"}
        deck = tuple(sorted(CORE + ["knight"]))
        late = {"p": {"competitive": [DeckPlay(battle_time="20260909T000000.000Z", mode="Ladder",
                                               cards=deck)]}}
        ok = {"p": {"competitive": [DeckPlay(battle_time="20260902T000000.000Z", mode="Ladder",
                                             cards=deck)]}}
        far = "20261231T000000.000Z"
        self.assertEqual(shadow.outcomes_v2([e], late, far)["a"]["status"], "censored")
        self.assertEqual(shadow.outcomes_v2([e], ok, far)["a"]["status"], "scored")
        self.assertEqual(shadow.outcomes_v2([e], ok, far, max_after_s=86400)["a"]["status"], "scored")
        two_days = {"p": {"competitive": [DeckPlay(battle_time="20260903T130000.000Z", mode="Ladder",
                                                   cards=deck)]}}
        self.assertEqual(shadow.outcomes_v2([e], two_days, far, max_after_s=86400)["a"]["status"],
                         "censored")
        tie = {"p": {"competitive": [DeckPlay(battle_time=e["requestStamp"], mode="Ladder", cards=deck)]}}
        self.assertEqual(shadow.outcomes_v2([e], tie, far)["a"]["status"], "censored")


# ------------------------------------------------------------------ safety
class Safety(World):

    def test_readonly_connection_refuses_writes(self):
        con = S.connect_ro(self.db)
        with self.assertRaises(sqlite3.OperationalError):
            con.execute("INSERT INTO tracked_players VALUES ('#X', 'x')")
        con.close()

    def test_module_has_no_write_enrol_or_serve_path(self):
        import inspect
        src = inspect.getsource(S)
        for bad in ("import tracking", "tracking.", "INSERT ", "UPDATE ", "DELETE ", "VACUUM",
                    "import socket", "socketserver", "HTTPServer", "_route", "sqlite3.connect(db",
                    "mode=rw"):
            self.assertNotIn(bad, src, bad)
        self.assertEqual(src.count("sqlite3.connect("), 1)          # only connect_ro
        self.assertIn("?mode=ro", src)

    def test_no_raw_tag_in_any_sampler_file(self):
        c = self.make()
        for _ in range(3):
            self.tick()
        for p in (c.log_path, c.stats_path, c.config_path):
            with open(p, encoding="utf-8") as fh:
                text = fh.read()
            for t in self.tags:
                self.assertNotIn(t, text)

    def test_leak_scan_catches_a_planted_tag_but_not_digits_in_numbers(self):
        c = self.make()
        self.tick()
        stats = self.stats(c)
        self.assertIsNone(S.check_stop(c, self.sys, stats, NOW, tags=self.tags))
        S._append(c.stats_path, {"type": "note", "n": int("9" + self.tags[7].lstrip("#") + "1")})
        self.assertIsNone(S.check_stop(c, self.sys, self.stats(c), NOW, tags=self.tags))
        S._append(c.stats_path, {"type": "note", "t": self.tags[3]})
        self.assertEqual(S.check_stop(c, self.sys, self.stats(c), NOW, tags=self.tags),
                         "raw tag found in sampler files")


class StopConditions(World):
    """Each preregistered stop condition stops the sampler and disables the timer."""

    def assertStops(self, mutate, expect, ticks_before=1, now=None):
        c = self.make()
        for _ in range(ticks_before):
            self.tick()
        mutate(c)
        out = self.tick(now=now)
        self.assertTrue(out.startswith("STOPPED"), out)
        self.assertIn(expect, out)
        self.assertTrue(os.path.exists(c.stopped_path))
        self.assertGreaterEqual(self.sys.disabled, 1)
        self.assertEqual(self.tick(), "stopped")
        return c

    def test_clashbot_pid(self):
        self.assertStops(lambda c: self.sys.pid.__setitem__("clashbot", 999), "clashbot PID")

    def test_royalweb_restart(self):
        self.assertStops(lambda c: self.sys.pid.__setitem__("royalweb", 999), "royalweb restarted")

    def test_royalweb_nrestarts(self):
        self.assertStops(lambda c: setattr(self.sys, "nrestarts", 1), "NRestarts")

    def test_status_failure(self):
        self.assertStops(lambda c: setattr(self.sys, "status", (False, 0.1)), "/status failed")

    def test_status_slow_twice(self):
        def slow(c):
            self.sys.status = (True, 3.0)
            self.tick()
        self.assertStops(slow, "twice in a row")

    def test_status_slow_once_is_tolerated(self):
        c = self.make()
        self.sys.status = (True, 3.0)
        self.assertTrue(self.tick().startswith("ok"))
        self.sys.status = (True, 0.1)
        self.assertTrue(self.tick().startswith("ok"))
        self.assertFalse(os.path.exists(c.stopped_path))

    def test_load(self):
        self.assertStops(lambda c: setattr(self.sys, "load", 8.1), "load average")

    def test_memory(self):
        self.assertStops(lambda c: setattr(self.sys, "mem", 100 * 1024 ** 2), "MemAvailable")

    def test_disk(self):
        self.assertStops(lambda c: setattr(self.sys, "disk", 100 * 1024 ** 2), "free disk")

    def test_journal_errors(self):
        self.assertStops(lambda c: setattr(self.sys, "errors", 6), "royalweb errors")

    def test_organic_log_contamination(self):
        organic = os.path.join(self.logs, "organic.jsonl")

        def plant(c):
            with open(organic, "w", encoding="utf-8") as fh:
                fh.write(json.dumps({"origin": "sampler", "id": "zz"}) + "\n")
        c = self.make(organic=organic)
        self.tick()
        plant(c)
        out = self.tick()
        self.assertIn("organic log", out)

    def test_foreign_record_in_sampler_log(self):
        self.assertStops(lambda c: S._append(c.log_path, {"id": "q", "origin": "coach", "schema": 3,
                                                           "cohort": c.id}), "sampler log")

    def test_duplicate_ids(self):
        def dup(c):
            r = self.records(c)[0]
            S._append(c.log_path, r)
        self.assertStops(dup, "duplicate record ids")

    def test_spacing_violation(self):
        def twice(c):
            m = next(s for s in self.stats(c) if s["type"] == "moment")
            S._append(c.stats_path, dict(m, key=m["player"] + ":9", executedAt=m["executedAt"] + 60))
        self.assertStops(twice, "within 24 h")

    def test_ineligible_share(self):
        def bad(c):
            for i in range(100):
                S._append(c.stats_path, {"type": "moment", "key": "b%d" % i, "player": "b%d" % i,
                                         "moment": 0, "scheduledAt": 0, "executedAt": 1000 + i,
                                         "status": "failed", "latencyMs": 1.0})
        self.assertStops(bad, "20% of moments")

    def _moments(self, c, eligible, failed):
        for i in range(eligible + failed):
            S._append(c.stats_path, {"type": "moment", "key": "m%d" % i, "player": "m%d" % i,
                                     "moment": 0, "scheduledAt": 0, "executedAt": 1000 + i,
                                     "status": "eligible" if i < eligible else "failed",
                                     "latencyMs": 1.0})

    def test_ineligible_share_boundary_stops_just_above_20_percent(self):
        c = self.make()
        self._moments(c, 79, 21)                               # 21% of 100
        self.assertIn("20% of moments", self.tick())

    def test_ineligible_share_boundary_exactly_20_percent_continues(self):
        c = self.make()
        self._moments(c, 80, 20)                               # 20% is not "> 20%"
        self.assertTrue(self.tick().startswith("ok"))
        self.assertFalse(os.path.exists(c.stopped_path))

    def test_zero_eligible_players_after_day_3(self):
        c = self.make(t0=NOW - 3.5 * 86400)
        # only one tick has run: most selected players have no eligible moment yet
        out = self.tick()
        self.assertIn("0 eligible moments", out)

    def test_p95_latency(self):
        def slow(c):
            for i in range(20):
                S._append(c.stats_path, {"type": "moment", "key": "s%d" % i, "player": "s%d" % i,
                                         "moment": 0, "scheduledAt": 0, "executedAt": 5000 + i,
                                         "status": "eligible", "latencyMs": 6000.0})
        self.assertStops(slow, "p95")

    def test_three_overruns(self):
        def over(c):
            for _ in range(3):
                S._append(c.stats_path, {"type": "tick", "overrun": True, "statusLatencyS": 0.1})
        self.assertStops(over, "overrunning")

    def test_identity_failure(self):
        real = P.predict_for_tag

        def perturbed(tag, domain, record_shadow=False, max_alternatives=3, measurement_extra=None):
            def wrap(result):
                result.change_probability += 1e-9
                return measurement_extra(result)
            return real(tag, domain, record_shadow=record_shadow, measurement_extra=wrap)
        c = self.make()
        with mock.patch.object(P, "predict_for_tag", perturbed):
            out = self.tick()
        self.assertIn("identity", out)
        self.assertTrue(os.path.exists(c.stopped_path))


class _FlaggingConnection:
    """A real read-only connection that REPORTS a write when a chosen query runs,
    standing in for a sampler write that mode=ro would in reality refuse."""

    def __init__(self, con, marker):
        self.con, self.marker, self.flag = con, marker, False

    def execute(self, sql, *a):
        if self.marker in sql:
            self.flag = True
        return self.con.execute(sql, *a)

    @property
    def total_changes(self):
        return 1 if self.flag else self.con.total_changes

    def close(self):
        self.con.close()


class AmendmentOne(World):
    """AMENDMENT 1: a write on ANY sampler-owned connection stops the sampler
    (total_changes); another process's commit only moves data_version, which is
    recorded and never a stop."""

    def flagging(self, marker):
        real = S.connect_ro
        return mock.patch.object(S, "connect_ro", lambda p: _FlaggingConnection(real(p), marker))

    def test_write_on_the_frame_read_stops(self):
        c = self.make()
        with self.flagging("rowid IN ("):
            out = self.tick()
        self.assertIn("database write by the sampler", out)
        self.assertTrue(os.path.exists(c.stopped_path))
        self.assertEqual(self.sys.disabled, 1)

    def test_write_on_a_moment_lookup_stops(self):
        c = self.make()
        with self.flagging("WHERE rowid = ?"):
            out = self.tick()
        self.assertIn("database write by the sampler", out)
        self.assertTrue(any(s.get("dbWrite") for s in self.stats(c) if s["type"] == "moment"))

    def test_write_on_the_tick_connection_stops(self):
        c = self.make()
        with self.flagging("PRAGMA data_version"):
            out = self.tick()
        self.assertIn("database write by the sampler", out)
        self.assertTrue(os.path.exists(c.stopped_path))

    def test_another_process_committing_is_informational_only(self):
        c = self.make()
        real = P.predict_for_tag

        def with_bot_write(*a, **kw):
            bot = sqlite3.connect(self.db)                  # the bot's own read-write handle
            bot.execute("INSERT INTO battles VALUES ('#BOT', '20260101T000000.000Z', 'Ladder', '[]', 'win', '')")
            bot.commit()
            bot.close()
            return real(*a, **kw)
        with mock.patch.object(P, "predict_for_tag", with_bot_write):
            out = self.tick()
        self.assertTrue(out.startswith("ok"), out)
        tick = [s for s in self.stats(c) if s["type"] == "tick"][-1]
        self.assertIs(tick["dataVersionMoved"], True)
        self.assertFalse(os.path.exists(c.stopped_path))

    def test_quiet_database_records_no_movement(self):
        c = self.make()
        self.tick()
        tick = [s for s in self.stats(c) if s["type"] == "tick"][-1]
        self.assertIs(tick["dataVersionMoved"], False)

    def test_config_names_the_amendment(self):
        c = self.make()
        self.assertEqual(c.cfg["amendment1"], S.AMENDMENT_1_SHA256)
        self.assertIn("amendment-1", c.cfg["dbWriteCheck"])


class ZeroEligibleWindow(World):
    """P12 is evaluated literally: before day 3 it cannot fire."""

    def test_before_day_3_zero_eligible_does_not_stop(self):
        c = self.make(t0=NOW - 1 * 86400)
        self.assertTrue(self.tick().startswith("ok"))
        self.assertFalse(os.path.exists(c.stopped_path))


if __name__ == "__main__":
    unittest.main(verbosity=1)
