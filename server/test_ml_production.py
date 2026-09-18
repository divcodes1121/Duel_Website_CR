"""test_ml_production.py — the Phase 15 production contract.

Each of the seven safety rules is a test. They exist because fourteen phases of
measurement produced exactly one invariant worth enforcing in code: Recent is
the prediction, and the ML layer may only add to it.

    python server/test_ml_production.py
"""
import calendar
import datetime
import json
import math
import os
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import features as F               # noqa: E402
from ml.dataset import DeckPlay            # noqa: E402
from ml.production import adapter, calibration, policy  # noqa: E402
from ml.production import predictor as P   # noqa: E402

CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]


def play(day, extra, result="win"):
    return DeckPlay(battle_time="202608%02dT120000.000Z" % day, mode="Ladder",
                    cards=tuple(sorted(CORE + [extra])), result=result)


def history(n=12):
    out = [play(d, "knight") for d in range(1, n - 2)]
    out += [play(n - 2, "ice-golem"), play(n - 1, "knight"), play(n, "ice-golem")]
    return out


#: KNOWN BUGS #24 (Brain Phase 10). `predict` stamps a live read with the
#: request wall clock, so a fixture dated in the past reads as a shell idle for
#: however long ago it was written, and an assertion about it becomes a
#: property of the calendar. Every test here runs on a pinned request clock:
#: five minutes after `history()`'s last play. A test whose fixture ends later
#: pins its own stamp with `request_at`.
PINNED_REQUEST_STAMP = "20260812T120500.000Z"
_REAL_REQUEST_STAMP = P._request_stamp


def setUpModule():
    P._request_stamp = lambda: PINNED_REQUEST_STAMP


def tearDownModule():
    P._request_stamp = _REAL_REQUEST_STAMP


def request_at(stamp):
    """Pin the request clock to `stamp` for the length of a `with` block."""
    return mock.patch.object(P, "_request_stamp", lambda: stamp)


class Rule1_RecentIsNeverReplaced(unittest.TestCase):
    def test_primary_is_the_most_recent_deck(self):
        h = history()
        r = P.predict("#A", "competitive", h)
        self.assertEqual(r.primary_deck, sorted(h[-1].cards))

    def test_enforce_primary_resets_a_tampered_result(self):
        r = policy.PredictionResult(primary_deck=["wrong"] * 8,
                                    primary_confidence="high",
                                    change_probability=0.9)
        fixed = policy.enforce_primary(r, sorted(CORE + ["knight"]))
        self.assertEqual(fixed.primary_deck, sorted(CORE + ["knight"]))
        self.assertTrue(fixed.degraded)
        self.assertIn("reset", fixed.reason)

    def test_no_alternative_equals_the_primary(self):
        r = P.predict("#A", "competitive", history())
        for a in r.alternatives:
            self.assertNotEqual(sorted(a["cards"]), sorted(r.primary_deck))


class ShadowFoundRegressions(unittest.TestCase):
    """Two correctness bugs that ONLY appeared against live history.

    Offline the research cache handed the engine a pre-built shell, so neither
    could occur. Shadow mode surfaced both on the first live run.
    """

    def _two_shells(self):
        """A player who alternates between two overlapping shells."""
        other = ["golem", "lightning", "tornado", "baby-dragon",
                 "night-witch", "barbarian-barrel", "elixir-collector",
                 "mega-minion"]
        out = []
        for d in range(1, 9):
            out.append(play(d, "knight"))
        for d in range(9, 15):
            out.append(DeckPlay(battle_time="202608%02dT120000.000Z" % d,
                                mode="Ladder", cards=tuple(sorted(other))))
        return out

    def test_shell_is_the_one_containing_the_latest_play(self):
        """`cluster_containing` matched by OVERLAP and could return a different
        shell — 25% of live competitive reads, which fired Rule 1 and built
        candidates from a deck the player was not on."""
        h = self._two_shells()
        view, shell = adapter.build_context("#A", "competitive", h)
        self.assertEqual(sorted(view["prev_deck"]), sorted(h[-1].cards))
        self.assertTrue(any(p is h[-1] for p in shell))

    def test_primary_never_needs_resetting_on_a_multi_shell_player(self):
        h = self._two_shells()
        with request_at("20260814T120500.000Z"):     # the fixture's last play + 5 min
            r = P.predict("#A", "competitive", h)
        self.assertEqual(r.primary_deck, sorted(h[-1].cards))
        self.assertNotIn("reset", r.reason)

    def test_shell_is_a_subset_of_history_not_all_of_it(self):
        """Change features are within-shell. Passing every play made a player
        look maximally volatile and pinned live P(change) near 1.0."""
        h = self._two_shells()
        _view, shell = adapter.build_context("#A", "competitive", h)
        self.assertLess(len(shell), len(h))

    def test_change_probability_is_not_pegged_for_a_steady_player(self):
        steady = [play(d, "knight") for d in range(1, 15)]
        # Pinned to the fixture (last play + 5 min). Unpinned, a wall-clock
        # stamp reads this shell as idle for weeks and the assertion fails from
        # 2026-09-27T18:51:45Z (KNOWN BUGS #24) - which is the model being right
        # about an idle shell, not the whole-history bug this test guards.
        with request_at("20260814T120500.000Z"):
            r = P.predict("#A", "competitive", steady)
        self.assertLess(r.change_probability, 0.5,
                        "a player who never edits must not read as volatile")


class Rule2and3_FailuresReturnRecent(unittest.TestCase):
    def test_empty_history_degrades_rather_than_raises(self):
        r = P.predict("#A", "competitive", [])
        self.assertTrue(r.degraded)
        self.assertEqual(r.alternatives, [])

    def test_single_play_has_no_shell_and_still_answers(self):
        r = P.predict("#A", "competitive", [play(1, "knight")])
        self.assertEqual(r.primary_deck, sorted(CORE + ["knight"]))
        self.assertTrue(r.degraded)

    def test_a_broken_play_object_cannot_take_the_screen_down(self):
        class Bad:
            battle_time = "20260801T120000.000Z"
            cards = None
        r = P.predict("#A", "competitive", [Bad()])
        self.assertTrue(r.degraded)
        self.assertIn("error", r.reason)

    def test_fallback_is_shaped_like_a_normal_result(self):
        """PHASE 23: `changeProbability` left the payload (FIX 1) and
        `bandShown` joined it (FIX 3)."""
        d = policy.safe_fallback(["a"] * 8, "test").as_dict()
        self.assertEqual(set(d), {"primary", "alternatives", "note",
                                  "degraded", "bandShown"})
        self.assertNotIn("changeProbability", d)


class Rule4_LowConfidenceShowsLess(unittest.TestCase):
    def test_high_confidence_caps_alternatives_at_two(self):
        r = policy.PredictionResult(["x"] * 8, "high", 0.05,
                                    alternatives=[{"cards": [str(i)] * 8, "out": [],
                                                   "in": [], "confidence": "low",
                                                   "evidence": []} for i in range(5)])
        self.assertEqual(len(policy.cap_alternatives(r).alternatives), 2)

    def test_lower_confidence_shows_FEWER_not_more(self):
        """Phase 19B. This previously asserted that `low` got the full three —
        the inverse of Rule 4's own wording, so the least trustworthy band
        showed the longest list. Duel `low` measures 47.3% correct; it has no
        business offering three configurations."""
        def r(band):
            return policy.PredictionResult(
                ["x"] * 8, band, 0.9,
                alternatives=[{"cards": [str(i)] * 8, "out": [], "in": [],
                               "confidence": "low", "evidence": []}
                              for i in range(5)])
        counts = [len(policy.cap_alternatives(r(b)).alternatives)
                  for b in ("high", "medium", "low")]
        self.assertEqual(counts, [2, 1, 0])
        self.assertEqual(counts, sorted(counts, reverse=True),
                         "alternative counts must be monotonic in confidence")


class Rule5and6_NoFutureInformation(unittest.TestCase):
    def test_plays_at_or_after_the_cutoff_are_dropped(self):
        h = history()
        cut = h[-1].battle_time
        kept = policy.assert_no_future(h, cut)
        self.assertTrue(all(p.battle_time < cut for p in kept))
        self.assertEqual(len(kept), len(h) - 1)

    def test_prediction_honours_the_cutoff(self):
        h = history()
        r = P.predict("#A", "competitive", h, cutoff_ts=h[-1].battle_time)
        self.assertEqual(r.primary_deck, sorted(h[-2].cards),
                         "the cutoff row must not become the primary")

    def test_view_never_includes_the_cutoff_row(self):
        h = history()
        v = adapter.build_view("#A", "competitive", h, cutoff_ts=h[-1].battle_time)
        self.assertLess(v["ts"], h[-1].battle_time)

    def test_no_cutoff_uses_everything(self):
        h = history()
        self.assertEqual(len(policy.assert_no_future(h, "")), len(h))


class Rule7_ProductionDoesNotTrain(unittest.TestCase):
    def test_loaded_model_refuses_to_fit(self):
        m = P._load_change_model()
        if m is None:
            self.skipTest("artifact not present")
        with self.assertRaises(RuntimeError):
            m.fit([], [])


I9 = F.FEATURE_NAMES.index("log_hours_since_change")
I10 = F.FEATURE_NAMES.index("log_hours_since_last_play")

#: Request stamps against `history()`, whose last play is 20260812T120000: the
#: anchor itself, then 5 min, 4 h, 36 h and 40 days later. On this fixture they
#: land in the high, high, medium, low and low bands.
STAMPS = ("20260812T120000.000Z", "20260812T120500.000Z", "20260812T160000.000Z",
          "20260814T000000.000Z", "20260921T120000.000Z")


def uncapped():
    """Bypass ONLY the band cap, in this process, to see the whole generated list."""
    return mock.patch.object(policy, "cap_alternatives",
                             lambda result, limit=policy.MAX_ALTERNATIVES: result)


def identity(alternatives):
    return [(tuple(a["cards"]), tuple(a["out"]), tuple(a["in"])) for a in alternatives]


class TimestampCorrection(unittest.TestCase):
    """Brain Phases 8-11. `predict` used to build its example with
    timestamp="9999", which `features._parse` cannot read, so features 9 and 10
    were 0 on every read. It now passes `cutoff_ts`, or the request clock in
    UTC. That may move the band, the number of alternatives shown, their labels
    and the note - and nothing else."""

    def _extracted(self, tag, domain, plays, **kw):
        """(result, stamp, feature vector) for the one example `predict` scores."""
        seen = []
        real = F.extract

        def spy(example):
            vec = real(example)
            seen.append((example.timestamp, vec))
            return vec
        with mock.patch.object(P.F, "extract", spy):
            result = P.predict(tag, domain, plays, **kw)
        self.assertEqual(len(seen), 1, "the change model reads exactly one example")
        return result, seen[0][0], seen[0][1]

    # T1 ---------------------------------------------------------------------
    def test_request_stamp_is_utc_in_battle_time_format(self):
        epoch = calendar.timegm((2026, 9, 14, 18, 52, 53, 0, 0, 0))
        real_gmtime = time.gmtime
        # localtime is moved 5.5 h away: a stamp built from it would show.
        with mock.patch.object(P.time, "gmtime", lambda *a: real_gmtime(epoch)), \
                mock.patch.object(P.time, "localtime", lambda *a: real_gmtime(epoch + 19800)):
            stamp = _REAL_REQUEST_STAMP()
        self.assertEqual(stamp, "20260914T185253.000Z")
        self.assertEqual(F._parse(stamp), datetime.datetime(2026, 9, 14, 18, 52, 53))

    def test_request_stamp_reads_the_real_clock_in_utc(self):
        stamp = _REAL_REQUEST_STAMP()
        parsed = F._parse(stamp)
        self.assertIsNotNone(parsed, stamp)
        now = datetime.datetime.fromtimestamp(time.time(), datetime.timezone.utc)
        drift = abs((parsed - now.replace(tzinfo=None)).total_seconds())
        self.assertLessEqual(drift, 120, "a local-time stamp is off by the host's UTC offset")

    # T2 ---------------------------------------------------------------------
    def test_predict_never_passes_the_placeholder_stamp(self):
        _r, pinned, _x = self._extracted("#A", "competitive", history())
        self.assertEqual(pinned, PINNED_REQUEST_STAMP)
        with mock.patch.object(P, "_request_stamp", _REAL_REQUEST_STAMP):
            _r, live, _x = self._extracted("#A", "competitive", history())
        for stamp in (pinned, live):
            self.assertNotEqual(stamp, "9999")
            self.assertIsNotNone(F._parse(stamp), stamp)

    def test_explicit_cutoff_wins_over_the_request_clock(self):
        reads = []

        def clock():
            reads.append(1)
            return PINNED_REQUEST_STAMP
        h = history()
        with mock.patch.object(P, "_request_stamp", clock):
            _r, stamp, _x = self._extracted("#A", "competitive", h,
                                            cutoff_ts=h[-1].battle_time)
        self.assertEqual(stamp, h[-1].battle_time)
        self.assertEqual(reads, [], "the request clock is not read when a cutoff is supplied")

    # T3 ---------------------------------------------------------------------
    def test_temporal_features_are_populated_together(self):
        # a shell edited on day 6 and unchanged through day 12
        plays = ([play(d, "knight") for d in range(1, 6)]
                 + [play(d, "ice-golem") for d in range(6, 13)])
        with request_at("20260812T180000.000Z"):             # 6 h after the last play
            _r, _s, late = self._extracted("#A", "competitive", plays)
        self.assertAlmostEqual(late[I10], math.log1p(6.0), places=9)
        self.assertAlmostEqual(late[I9], math.log1p(150.0), places=9)   # 6 d 6 h since the edit
        self.assertGreater(late[I10], 0.0)
        self.assertGreaterEqual(late[I9], late[I10])
        with request_at(plays[-1].battle_time):              # the anchor
            _r, _s, anchor = self._extracted("#A", "competitive", plays)
        self.assertEqual(anchor[I10], 0.0)
        self.assertAlmostEqual(anchor[I9], math.log1p(144.0), places=9)
        others = [i for i in range(F.N_FEATURES) if i not in (I9, I10)]
        self.assertEqual([late[i] for i in others], [anchor[i] for i in others],
                         "only features 9 and 10 read the stamp")

    # T4 ---------------------------------------------------------------------
    def test_primary_deck_is_identical_under_every_stamp(self):
        h = history()
        for domain in ("competitive", "practice"):
            decks = set()
            for stamp in STAMPS:
                with request_at(stamp):
                    r = P.predict("#A", domain, h)
                self.assertEqual(r.primary_deck, sorted(h[-1].cards), (domain, stamp))
                self.assertFalse(r.degraded, (domain, stamp))
                decks.add(tuple(r.primary_deck))
            self.assertEqual(len(decks), 1, domain)

    # T5 ---------------------------------------------------------------------
    def test_generated_alternatives_are_identical_under_every_stamp(self):
        h = history()
        generated, shown = [], []
        for stamp in STAMPS:
            with request_at(stamp):
                with uncapped():
                    generated.append(identity(P.predict("#A", "competitive", h).alternatives))
                shown.append(identity(P.predict("#A", "competitive", h).alternatives))
        self.assertTrue(generated[0], "the fixture must generate alternatives or this proves nothing")
        for lst in generated[1:]:
            self.assertEqual(lst, generated[0])
        for lst in shown:
            self.assertEqual(lst, generated[0][:len(lst)],
                             "what is shown is a prefix of the unchanged generated list")

    # T6 ---------------------------------------------------------------------
    def test_count_moves_only_with_the_corrected_band(self):
        self.assertEqual(policy.ALTERNATIVE_CAPS, {"high": 2, "medium": 1, "low": 0})
        h = history()
        by_band = {}
        for stamp in STAMPS:
            with request_at(stamp):
                with uncapped():
                    generated = len(P.predict("#A", "competitive", h).alternatives)
                r = P.predict("#A", "competitive", h)
            self.assertEqual(r.primary_confidence,
                             calibration.band("competitive", r.change_probability), stamp)
            self.assertEqual(len(r.alternatives),
                             min(policy.ALTERNATIVE_CAPS[r.primary_confidence], generated), stamp)
            by_band[r.primary_confidence] = len(r.alternatives)
        self.assertEqual(by_band, {"high": 2, "medium": 1, "low": 0},
                         "the stamps must reach every band, or the cap is not exercised")

    # T7 ---------------------------------------------------------------------
    def test_payload_degradation_and_practice_are_unchanged(self):
        class Bad:
            battle_time = "20260801T120000.000Z"
            cards = None
        degrading = {"empty": [], "single play": [play(1, "knight")], "broken": [Bad()]}
        h = history()
        outcomes = {}
        for stamp in STAMPS:
            with request_at(stamp):
                r = P.predict("#A", "competitive", h)
                d = r.as_dict()
                self.assertEqual(set(d), {"primary", "alternatives", "note", "degraded", "bandShown"})
                self.assertNotIn("changeProbability", d)
                self.assertEqual((r.degraded, r.reason), (False, ""))
                practice = P.predict("#A", "practice", h).as_dict()
                self.assertEqual(set(practice["primary"]), {"cards", "basis"})
                self.assertEqual(practice["alternatives"], [])
                self.assertFalse(practice["bandShown"])
                for name, plays in degrading.items():
                    x = P.predict("#A", "competitive", plays)
                    outcomes.setdefault(name, set()).add(
                        (x.degraded, x.reason, tuple(x.primary_deck), len(x.alternatives)))
        for name, seen in outcomes.items():
            self.assertEqual(len(seen), 1, name)
            self.assertTrue(next(iter(seen))[0], name)

    # KNOWN BUGS #24 ---------------------------------------------------------
    def test_this_module_runs_on_a_pinned_request_clock(self):
        """If this fails, something unpinned the clock, and every assertion on a
        dated fixture here has become a property of the calendar."""
        self.assertIsNot(P._request_stamp, _REAL_REQUEST_STAMP)
        self.assertEqual(P._request_stamp(), PINNED_REQUEST_STAMP)

    # X9 (Brain Phase 20, RQ3) ----------------------------------------------
    def _edited_shell(self):
        # a shell edited on day 6 and unchanged since, so x9 is well above 0
        return ([play(d, "knight") for d in range(1, 6)]
                + [play(d, "ice-golem") for d in range(6, 13)])

    def test_only_x9_is_served_as_zero(self):
        self.assertEqual(P.SERVED_AS_ZERO, (I9,))

    def test_served_vector_differs_from_extract_only_at_x9(self):
        plays = self._edited_shell()
        with request_at("20260812T180000.000Z"):
            _r, _s, extracted = self._extracted("#A", "competitive", plays)
        self.assertGreater(extracted[I9], 0.0, "extract still computes x9")
        self.assertGreater(extracted[I10], 0.0, "x10 still reads the stamp")
        seen = []
        real = P._served_vector

        def spy(example):
            vec = real(example)
            seen.append(vec)
            return vec
        with request_at("20260812T180000.000Z"), mock.patch.object(P, "_served_vector", spy):
            P.predict("#A", "competitive", plays)
        served = seen[0]
        self.assertEqual(served[I9], 0.0)
        self.assertEqual([served[i] for i in range(F.N_FEATURES) if i != I9],
                         [extracted[i] for i in range(F.N_FEATURES) if i != I9])

    def test_change_probability_scores_the_served_vector(self):
        model = P._load_change_model()
        if model is None:
            self.skipTest("artifact not present")
        plays = self._edited_shell()
        with request_at("20260812T180000.000Z"):
            _r, _s, extracted = self._extracted("#A", "competitive", plays)
            r = P.predict("#A", "competitive", plays)
        served = list(extracted)
        served[I9] = 0.0
        self.assertAlmostEqual(r.change_probability, 1 - model.predict(served)[0], places=12)
        self.assertNotAlmostEqual(r.change_probability, 1 - model.predict(extracted)[0], places=6,
                                  msg="the fixture must make x9 matter, or this proves nothing")

    def test_x10_still_moves_the_probability(self):
        plays = self._edited_shell()
        ps = set()
        for stamp in ("20260812T120500.000Z", "20260814T000000.000Z"):
            with request_at(stamp):
                ps.add(round(P.predict("#A", "competitive", plays).change_probability, 9))
        self.assertEqual(len(ps), 2, "holding x9 at 0 must not freeze the stamp's effect")

    def test_forbid_training_is_idempotent(self):
        class M:
            def fit(self, *a):
                return "fitted"
        m = M()
        policy.forbid_training(m)
        policy.forbid_training(m)
        with self.assertRaises(RuntimeError):
            m.fit()


class ArtifactContract(unittest.TestCase):
    def test_artifact_exists_and_declares_its_features(self):
        if not os.path.exists(P.ARTIFACT):
            self.skipTest("artifact not present")
        with open(P.ARTIFACT, encoding="utf-8") as fh:
            art = json.load(fh)
        from ml import features as F
        self.assertEqual(list(art["feature_names"]), list(F.FEATURE_NAMES))
        self.assertIn("trained_on", art)

    def test_feature_order_mismatch_refuses_the_artifact(self):
        """A reordered feature list silently invalidates every weight."""
        from ml import features as F
        saved = F.FEATURE_NAMES
        P._loaded = False
        P._model = None
        try:
            F.FEATURE_NAMES = ("bogus",) + saved[1:]
            self.assertIsNone(P._load_change_model())
        finally:
            F.FEATURE_NAMES = saved
            P._loaded = False
            P._model = None

    def test_status_reports_the_mode(self):
        s = P.status()
        self.assertIn(s["mode"], ("full", "counting-fallback"))


class CachingAndSource(unittest.TestCase):
    """Phase 16B. Profiled: the DB read is ~99% of latency (109-2317 ms) while
    shell rebuild is 0-6 ms and scoring 1-15 ms — so the READ is cached."""

    def test_cache_stats_shape(self):
        from ml.production import source
        s = source.cache_stats()
        for k in ("hit", "probe", "miss", "entries", "hitRate"):
            self.assertIn(k, s)

    def test_clear_cache_resets_counters(self):
        from ml.production import source
        source.clear_cache()
        s = source.cache_stats()
        self.assertEqual(s["entries"], 0)
        self.assertEqual(s["hit"], 0)

    def test_engine_reads_the_hot_tier_only(self):
        """Opening the 46 GB archive contributed ZERO plays and cost a second
        connection on every cold read; cold p95 was 1883 ms and is now 285."""
        import inspect
        from ml.production import source
        src = inspect.getsource(source._read_rows)
        self.assertNotIn("tier_windows", src)
        self.assertIn("resolve_db_path", src)

    def test_days_ago_is_a_battle_time_string(self):
        from ml.production import source
        v = source._days_ago(30)
        self.assertEqual(len(v), len("20260101T000000.000Z"))
        self.assertIn("T", v)


class OneReadServesBothDomains(unittest.TestCase):
    """Phase 19. The query never filtered by mode, so keying the cache per
    domain ran the identical read twice per player. Measured on disjoint tags,
    the cost followed call ORDER, not domain: duel-first gave duel p95 1194 ms
    and competitive 96 ms; competitive-first inverted it exactly."""

    def setUp(self):
        from ml.production import source
        source.clear_cache()

    def test_cache_key_carries_no_domain(self):
        import inspect
        from ml.production import source
        src = inspect.getsource(source.load_plays)
        self.assertIn("key = (tag, since, until, limit)", src)
        self.assertNotIn("key = (tag, domain", src)

    def test_the_read_is_domain_agnostic(self):
        import inspect
        from ml.production import source
        src = inspect.getsource(source._read_rows)
        self.assertNotIn("is_duel_like_mode", src)
        self.assertNotIn("META_MODES", src)

    def test_partitioning_splits_one_row_set_by_domain(self):
        from ml.production import source
        deck = json.dumps(["c%d" % i for i in range(8)])
        rows = [("20260810T120000.000Z", "Ladder", deck, "victory", ""),
                ("20260810T130000.000Z", "Showdown_Friendly", deck, "victory", "")]
        comp = source._rows_to_plays(rows, "competitive")
        practice = source._rows_to_plays(rows, "practice")
        self.assertEqual(len(comp), 1)
        self.assertEqual(len(practice), 1)
        self.assertEqual(comp[0].mode, "Ladder")
        self.assertEqual(practice[0].mode, "Showdown_Friendly")

    def test_sixteen_card_loadouts_are_still_dropped(self):
        from ml.production import source
        loadout = json.dumps(["c%d" % i for i in range(16)])
        rows = [("20260810T120000.000Z", "Showdown_Friendly", loadout, "", "")]
        self.assertEqual(source._rows_to_plays(rows, "practice"), [])

    def test_second_domain_does_not_re_read(self):
        """The behavioural guarantee: after one domain has loaded a player, the
        other must be served from the SAME cache entry."""
        from ml.production import source
        deck = json.dumps(["c%d" % i for i in range(8)])
        rows = [("20260810T120000.000Z", "Ladder", deck, "victory", "")]
        calls = []
        real = source._read_rows
        try:
            source._read_rows = lambda tag, since, limit: (
                calls.append(tag) or rows)
            source.load_plays("#T", "duel")
            source.load_plays("#T", "competitive")
        finally:
            source._read_rows = real
        self.assertEqual(len(calls), 1, "the second domain re-read the database")

    def test_plays_are_chronological_after_partitioning(self):
        from ml.production import source
        deck = json.dumps(["c%d" % i for i in range(8)])
        rows = [("20260812T120000.000Z", "Ladder", deck, "", ""),
                ("20260810T120000.000Z", "Ladder", deck, "", "")]
        plays = source._rows_to_plays(rows, "competitive")
        self.assertEqual([p.battle_time for p in plays],
                         sorted(p.battle_time for p in plays))


class DriftDetection(unittest.TestCase):
    def test_no_entries_means_no_drift(self):
        from ml.production import shadow
        self.assertEqual(shadow.drift([]), {})

    def test_matching_distribution_is_within_tolerance(self):
        from ml.production import shadow
        ref = shadow.REFERENCE["competitive"]
        rows = [{"domain": "competitive", "pChange": ref["pChange"],
                 "confidence": "high"} for _ in range(int(100 * ref["high"]))]
        rows += [{"domain": "competitive", "pChange": ref["pChange"],
                  "confidence": "low"} for _ in range(int(100 * ref["low"]))]
        rows += [{"domain": "competitive", "pChange": ref["pChange"],
                  "confidence": "medium"} for _ in range(int(100 * ref["medium"]))]
        self.assertFalse(shadow.drift(rows)["competitive"]["drifted"])

    def test_a_shifted_distribution_is_flagged(self):
        from ml.production import shadow
        rows = [{"domain": "duel", "pChange": 0.0, "confidence": "high"}
                for _ in range(50)]
        info = shadow.drift(rows)["duel"]
        self.assertTrue(info["drifted"])
        self.assertIn("evaluate", info["action"])

    def test_drift_never_suggests_automatic_retraining(self):
        from ml.production import shadow
        rows = [{"domain": "duel", "pChange": 0.0, "confidence": "high"}
                for _ in range(50)]
        action = shadow.drift(rows)["duel"]["action"]
        self.assertNotIn("retrain", action.lower())


class ReconcileCheckpoint(unittest.TestCase):
    """The 16C checkpoint table: coverage AND correctness, pooled AND macro."""

    def _entries(self, band_ok):
        ent, truth = [], {}
        for i in range(30):
            for band, ok in band_ok.items():
                key = ("p%d" % i, "%s-%d" % (band, i))
                ent.append({"player": key[0], "ts": key[1], "domain": "duel",
                            "confidence": band, "primaryHash": "A",
                            "altHashes": ["B"]})
                truth[key] = "A" if ok(i) else "C"
        return ent, truth

    def test_reports_share_not_only_accuracy(self):
        """A band at 95% matters only alongside how often it fires."""
        from ml.production import shadow
        ent, truth = self._entries({"high": lambda i: True,
                                    "low": lambda i: False})
        res = shadow.reconcile(ent, truth)
        self.assertAlmostEqual(res["bands"]["high"]["share"], 0.5, places=3)
        self.assertEqual(res["bands"]["high"]["accuracy"], 1.0)
        self.assertEqual(res["bands"]["low"]["accuracy"], 0.0)

    def test_reports_player_macro_alongside_pooled(self):
        from ml.production import shadow
        ent, truth = self._entries({"high": lambda i: i % 2 == 0})
        res = shadow.reconcile(ent, truth)
        b = res["bands"]["high"]
        self.assertIn("accuracyMacro", b)
        self.assertEqual(b["players"], 30)

    def test_one_heavy_player_cannot_dominate_the_macro(self):
        from ml.production import shadow
        ent, truth = [], {}
        for j in range(200):                       # one player, always right
            k = ("heavy", "h%d" % j)
            ent.append({"player": k[0], "ts": k[1], "domain": "duel",
                        "confidence": "high", "primaryHash": "A", "altHashes": []})
            truth[k] = "A"
        for i in range(9):                         # nine players, always wrong
            k = ("p%d" % i, "x%d" % i)
            ent.append({"player": k[0], "ts": k[1], "domain": "duel",
                        "confidence": "high", "primaryHash": "A", "altHashes": []})
            truth[k] = "C"
        res = shadow.reconcile(ent, truth)["bands"]["high"]
        self.assertGreater(res["accuracy"], 0.9, "pooled is carried by the heavy player")
        self.assertLess(res["accuracyMacro"], 0.2, "macro must not be")

    def test_ordering_verdict_detects_a_break(self):
        from ml.production import shadow
        ent, truth = self._entries({"high": lambda i: False,
                                    "low": lambda i: True})
        report = shadow.reconcile_report({"duel": shadow.reconcile(ent, truth)})
        self.assertIn("ORDERING BROKEN", report)

    def test_ordering_verdict_accepts_a_healthy_ladder(self):
        from ml.production import shadow
        ent, truth = self._entries({"high": lambda i: i % 10 != 0,
                                    "medium": lambda i: i % 3 != 0,
                                    "low": lambda i: i % 5 == 0})
        report = shadow.reconcile_report({"duel": shadow.reconcile(ent, truth)})
        self.assertIn("ORDERING HOLDS", report)

    def test_unreconciled_entries_are_ignored(self):
        from ml.production import shadow
        ent = [{"player": "p", "ts": "t", "domain": "duel",
                "confidence": "high", "primaryHash": "A", "altHashes": []}]
        self.assertEqual(shadow.reconcile(ent, {})["total"], 0)


class Reconciliation(unittest.TestCase):
    """Temporal discipline for matching a prediction to what actually happened."""

    def _play(self, day, extra):
        return DeckPlay(battle_time="202608%02dT120000.000Z" % day, mode="Ladder",
                        cards=tuple("c%d" % i for i in range(7)) + (extra,))

    def _entry(self, anchor_day=10, **kw):
        from ml.production import shadow
        e = {"player": "p1", "ts": "T1", "domain": "duel",
             "anchorTs": "202608%02dT120000.000Z" % anchor_day,
             "confidence": "high", "primaryHash": shadow.deck_hash(["a"]),
             "altHashes": []}
        e.update(kw)
        return e

    def test_matches_the_first_strictly_later_battle(self):
        from ml.production import shadow
        plays = {"p1": {"duel": [self._play(8, "x"), self._play(11, "y"),
                                 self._play(12, "z")]}}
        out = shadow.outcomes_from_history([self._entry()], plays)
        self.assertEqual(out[("p1", "T1")],
                         shadow.deck_hash(list(self._play(11, "y").cards)))

    def test_a_battle_at_the_same_timestamp_is_not_next(self):
        from ml.production import shadow
        plays = {"p1": {"duel": [self._play(10, "x")]}}
        self.assertEqual(shadow.outcomes_from_history([self._entry()], plays), {})

    def test_earlier_battles_are_never_matched(self):
        from ml.production import shadow
        plays = {"p1": {"duel": [self._play(1, "x"), self._play(9, "y")]}}
        self.assertEqual(shadow.outcomes_from_history([self._entry()], plays), {})

    def test_no_subsequent_battle_yields_nothing(self):
        from ml.production import shadow
        self.assertEqual(
            shadow.outcomes_from_history([self._entry()], {"p1": {"duel": []}}), {})

    def test_missing_anchor_is_skipped(self):
        from ml.production import shadow
        plays = {"p1": {"duel": [self._play(11, "y")]}}
        self.assertEqual(
            shadow.outcomes_from_history([self._entry(anchorTs="")], plays), {})

    def test_a_malformed_deck_is_not_reconciled(self):
        from ml.production import shadow
        bad = DeckPlay(battle_time="20260811T120000.000Z", mode="Ladder",
                       cards=("a", "a", "b"))
        self.assertEqual(
            shadow.outcomes_from_history([self._entry()], {"p1": {"duel": [bad]}}), {})

    def test_domains_do_not_cross(self):
        from ml.production import shadow
        plays = {"p1": {"competitive": [self._play(11, "y")]}}
        self.assertEqual(shadow.outcomes_from_history([self._entry()], plays), {})

    def test_players_do_not_cross(self):
        from ml.production import shadow
        plays = {"p2": {"duel": [self._play(11, "y")]}}
        self.assertEqual(shadow.outcomes_from_history([self._entry()], plays), {})

    def test_duplicate_entries_each_resolve(self):
        from ml.production import shadow
        plays = {"p1": {"duel": [self._play(11, "y")]}}
        out = shadow.outcomes_from_history(
            [self._entry(), self._entry(ts="T2")], plays)
        self.assertEqual(len(out), 2)

    def test_reconcile_from_db_requires_a_loader(self):
        from ml.production import shadow
        self.assertIn("error", shadow.reconcile_from_db([self._entry()]))

    def test_reconcile_from_db_uses_the_injected_loader(self):
        from ml.production import shadow
        plays = [self._play(11, "y")]
        res = shadow.reconcile_from_db([self._entry()], loader=lambda p, d: plays)
        self.assertEqual(res["duel"]["total"], 1)


class BandCalibration(unittest.TestCase):
    """Phase 17A. Thresholds re-cut on measured production outcomes."""

    def test_duel_and_competitive_are_calibrated_separately(self):
        from ml.production import calibration as C
        self.assertNotEqual(C.thresholds("duel"), C.thresholds("competitive"))

    def test_competitive_thresholds_were_deliberately_left_alone(self):
        """Equal tertiles measured 93.3/92.4/82.3 — no separation. The old cuts
        are the only ones that discriminate on competitive."""
        from ml.production import calibration as C
        self.assertEqual(C.thresholds("competitive"), (0.15, 0.45))

    def test_duel_high_is_now_rare_and_honest(self):
        from ml.production import calibration as C
        self.assertEqual(C.band("duel", 0.004), "high")
        self.assertEqual(C.band("duel", 0.02), "medium")   # was "high" before
        self.assertEqual(C.band("duel", 0.10), "low")      # was "high" before

    def test_unknown_domain_falls_back_to_the_shipped_cuts(self):
        from ml.production import calibration as C
        self.assertEqual(C.thresholds("nonsense"), C.FALLBACK)

    def test_a_missing_artifact_degrades_to_previous_behaviour(self):
        from ml.production import calibration as C
        old_path, old_cal, old_loaded = C.ARTIFACT, C._cal, C._loaded
        try:
            C.ARTIFACT, C._cal, C._loaded = "/nonexistent.json", None, False
            self.assertEqual(C.thresholds("duel"), C.FALLBACK)
        finally:
            C.ARTIFACT, C._cal, C._loaded = old_path, old_cal, old_loaded

    def test_published_accuracy_matches_the_artifact(self):
        """policy.BAND_ACCURACY must not drift from the calibration it describes."""
        from ml.production import calibration as C, policy
        for domain in ("practice", "competitive"):
            for b in ("high", "medium", "low"):
                self.assertEqual(policy.BAND_ACCURACY[domain][b],
                                 C.expected_accuracy(domain, b),
                                 "%s/%s drifted" % (domain, b))

    def test_competitive_low_reports_None_not_a_fake_number(self):
        from ml.production import calibration as C
        self.assertIsNone(C.expected_accuracy("competitive", "low"))


class Checkpoint19C(unittest.TestCase):
    """Phase 19C. The checkpoint must refuse to conclude on thin evidence, and
    must grade live traffic against the calibration we actually ship."""

    def _play(self, day, extra="x"):
        return DeckPlay(battle_time="202608%02dT120000.000Z" % day, mode="Ladder",
                        cards=tuple("c%d" % i for i in range(7)) + (extra,))

    def _entries(self, tags, band="high", domain="duel", degraded=False):
        from ml.production import shadow
        return [{"player": shadow._hash(t), "ts": "2026-08-19T00:%02d:00Z" % (i % 60),
                 "domain": domain, "anchorTs": "20260810T120000.000Z",
                 "confidence": band, "degraded": degraded, "reason": "",
                 "latencyMs": 100 + i,
                 "primaryHash": shadow.deck_hash(list(self._play(11).cards)),
                 "altHashes": []} for i, t in enumerate(tags)]

    def test_a_thin_population_refuses_to_conclude(self):
        from ml.production import shadow
        tags = ["#T%d" % i for i in range(10)]
        ck = shadow.checkpoint(tags, lambda t, d: [self._play(11)],
                               self._entries(tags))
        self.assertFalse(ck["duel"]["enoughPlayers"])
        txt = shadow.checkpoint_report(ck)
        self.assertIn("INSUFFICIENT EVIDENCE", txt)
        self.assertNotIn("ORDERING HOLDS", txt)

    def test_enough_players_permits_a_conclusion(self):
        from ml.production import shadow
        tags = ["#T%d" % i for i in range(120)]
        ck = shadow.checkpoint(tags, lambda t, d: [self._play(11)],
                               self._entries(tags))
        self.assertTrue(ck["duel"]["enoughPlayers"])
        self.assertGreaterEqual(ck["duel"]["population"]["playersWithOutcome"], 100)

    def test_the_comparison_column_quotes_the_SHIPPED_calibration(self):
        """reconcile_report used the retired Phase 14 numbers, which would have
        manufactured a drift signal out of our own stale constant."""
        from ml.production import shadow, policy
        import inspect
        src = inspect.getsource(shadow.reconcile_report)
        self.assertIn("policy.BAND_ACCURACY", src)
        self.assertNotIn("0.957", src)
        self.assertNotIn("0.873", src)
        self.assertEqual(policy.BAND_ACCURACY["practice"]["high"], 0.921)

    def test_ordering_uses_player_macro_not_pooled(self):
        from ml.production import shadow
        bands = {"high": {"accuracy": 0.9, "accuracyMacro": 0.4},
                 "low": {"accuracy": 0.1, "accuracyMacro": 0.8}}
        holds, have = shadow.band_ordering(bands)
        self.assertFalse(holds, "pooled was used instead of macro")

    def test_broken_ordering_says_recalibrate_not_retrain(self):
        from ml.production import shadow
        tags = ["#T%d" % i for i in range(120)]
        ents = self._entries(tags[:60], band="high")
        ents += self._entries(tags[60:], band="low")
        # make the LOW band right and HIGH band wrong -> inverted
        for e in ents:
            if e["confidence"] == "high":
                e["primaryHash"] = "wrong-hash"
        ck = shadow.checkpoint(tags, lambda t, d: [self._play(11)], ents)
        txt = shadow.checkpoint_report(ck)
        self.assertIn("ORDERING BROKEN", txt)
        self.assertIn("Recalibration is the response", txt)

    def test_latency_and_degradation_are_reported(self):
        from ml.production import shadow
        tags = ["#T%d" % i for i in range(30)]
        ents = self._entries(tags)
        ents[0]["degraded"] = True
        ents[0]["reason"] = "no established shell"
        ck = shadow.checkpoint(tags, lambda t, d: [self._play(11)], ents)
        d = ck["duel"]
        self.assertGreater(d["latency"]["p95"], 0)
        self.assertEqual(d["degraded"]["n"], 1)
        self.assertIn("no established shell", d["degraded"]["reasons"])

    def test_domains_are_reported_separately(self):
        from ml.production import shadow
        tags = ["#T%d" % i for i in range(20)]
        ents = self._entries(tags, domain="duel")
        ents += self._entries(tags, domain="competitive")
        ck = shadow.checkpoint(tags, lambda t, d: [self._play(11)], ents)
        self.assertEqual(set(ck), {"duel", "competitive"})
        self.assertEqual(ck["duel"]["observations"], 20)
        self.assertEqual(ck["competitive"]["observations"], 20)

    def test_a_duplicate_outcome_is_not_double_counted(self):
        from ml.production import shadow
        tags = ["#T1"]
        ents = self._entries(tags) * 3          # same player, same ts, 3 rows
        ck = shadow.checkpoint(tags, lambda t, d: [self._play(11)], ents)
        self.assertEqual(ck["duel"]["population"]["playersObserved"], 1)


class TagReconciliation(unittest.TestCase):
    """Reconciling from a tag list WITHOUT weakening the privacy model."""

    def _play(self, day, extra="x"):
        return DeckPlay(battle_time="202608%02dT120000.000Z" % day, mode="Ladder",
                        cards=tuple("c%d" % i for i in range(7)) + (extra,))

    def _entries(self, tags):
        from ml.production import shadow
        # `ts` is wall-clock in the real recorder and must NOT be derived from
        # the tag — an earlier fixture built "T" + tag and leaked it into the
        # entry, which the no-raw-tag assertion below correctly caught.
        return [{"player": shadow._hash(t), "ts": "2026-08-19T00:%02d:00Z" % i,
                 "domain": "duel",
                 "anchorTs": "20260810T120000.000Z", "confidence": "high",
                 "primaryHash": shadow.deck_hash(list(self._play(11).cards)),
                 "altHashes": []} for i, t in enumerate(tags)]

    def test_hash_is_recomputed_not_stored(self):
        """The log holds no raw tag; the caller supplies them at reconcile time."""
        from ml.production import shadow
        ent = self._entries(["#AAA"])
        self.assertNotIn("#AAA", json.dumps(ent))
        res = shadow.reconcile_from_tags(["#AAA"], lambda t, d: [self._play(11)], ent)
        self.assertEqual(res["duel"]["total"], 1)

    def test_a_wrong_tag_list_reconciles_nothing(self):
        from ml.production import shadow
        ent = self._entries(["#AAA"])
        res = shadow.reconcile_from_tags(["#ZZZ"], lambda t, d: [self._play(11)], ent)
        self.assertEqual(res["duel"]["total"], 0)
        self.assertEqual(res["duel"]["population"]["unmappedHashes"], 1)

    def test_three_populations_are_tracked_separately(self):
        """Observed, resolvable and with-outcome diverge; waiting on the first
        would wait on inactive accounts forever."""
        from ml.production import shadow
        ent = self._entries(["#A", "#B", "#C"])
        ent.append({"player": "unmapped", "ts": "TX", "domain": "duel",
                    "anchorTs": "20260810T120000.000Z", "confidence": "low",
                    "primaryHash": "zz", "altHashes": []})

        def loader(tag, domain):
            return [self._play(11)] if tag in ("#A", "#B") else [self._play(9)]

        pop = shadow.reconcile_from_tags(["#A", "#B", "#C"], loader,
                                         ent)["duel"]["population"]
        self.assertEqual(pop["playersObserved"], 4)
        self.assertEqual(pop["playersResolvable"], 3)
        self.assertEqual(pop["playersWithOutcome"], 2)

    def test_a_failing_loader_does_not_abort_the_run(self):
        from ml.production import shadow
        def boom(tag, domain):
            raise RuntimeError("db down")
        res = shadow.reconcile_from_tags(["#A"], boom, self._entries(["#A"]))
        self.assertEqual(res["duel"]["total"], 0)

    def test_population_line_is_readable(self):
        from ml.production import shadow
        res = shadow.reconcile_from_tags(["#A"], lambda t, d: [self._play(11)],
                                         self._entries(["#A"]))["duel"]
        line = shadow.population_line(res)
        for word in ("observed", "resolvable", "outcomes", "reconciled"):
            self.assertIn(word, line)


class VersionStamping(unittest.TestCase):
    def test_every_record_carries_a_version_block(self):
        from ml.production import shadow
        self.assertEqual(set(shadow.VERSIONS),
                         {"model", "features", "policy", "candidates",
                      "calibration"})

    def test_anchor_is_battle_time_format_not_wall_clock(self):
        """Matching wall-clock against battle_time silently finds nothing.

        THIS TEST USED TO os.remove() THE PRODUCTION LOG. Running the suite is
        what destroyed the 1,277 observations collected in 16C. It now writes
        to a temp file and never touches the real one.
        """
        from ml.production import shadow
        import tempfile as _tf, os as _os
        d = _tf.mkdtemp()
        old = shadow.LOG_PATH
        shadow.LOG_PATH = _os.path.join(d, "shadow-log.jsonl")
        try:
            r = P.predict("#A", "competitive", history())
            shadow.record("#A", "competitive", r, 10, 5, 1.0,
                          anchor_ts="20260810T120000.000Z")
            e = shadow.load(shadow.LOG_PATH)[-1]
        finally:
            shadow.LOG_PATH = old
        self.assertIn("T", e["anchorTs"])
        self.assertNotIn("-", e["anchorTs"])
        self.assertIn("-", e["ts"])
        self.assertIn("versions", e)
        self.assertIn("id", e)


class ShadowPrivacy(unittest.TestCase):
    def test_tag_is_hashed_not_stored(self):
        from ml.production import shadow
        h = shadow._hash("#ABC123")
        self.assertNotIn("ABC123", h)
        self.assertEqual(len(h), 16)

    def test_deck_hash_is_order_independent(self):
        from ml.production import shadow
        self.assertEqual(shadow.deck_hash(["b", "a"]), shadow.deck_hash(["a", "b"]))

    def test_recorded_entry_holds_no_card_names(self):
        from ml.production import shadow
        r = P.predict("#A", "competitive", history())
        import json as _j
        entry = {"primaryHash": shadow.deck_hash(r.primary_deck),
                 "altHashes": [shadow.deck_hash(a["cards"]) for a in r.alternatives]}
        blob = _j.dumps(entry)
        for card in ("hog", "cannon", "knight", "musketeer"):
            self.assertNotIn(card, blob)


class OutputContract(unittest.TestCase):
    def test_no_model_internals_leak_to_the_payload(self):
        d = P.predict("#A", "competitive", history()).as_dict()
        blob = json.dumps(d).lower()
        for banned in ("logistic", "weight", "score", "feature", "logit"):
            self.assertNotIn(banned, blob)

    def test_alternatives_carry_readable_evidence(self):
        r = P.predict("#A", "competitive", history())
        for a in r.alternatives:
            self.assertTrue(a["evidence"])
            self.assertTrue(all(isinstance(e, str) for e in a["evidence"]))

    def test_confidence_is_a_band_not_a_number(self):
        r = P.predict("#A", "competitive", history())
        self.assertIn(r.primary_confidence, ("high", "medium", "low"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
