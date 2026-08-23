"""Phase 19B — the async boundary between the Coach and the engine.

The engine is an ADDITIVE enhancement over a spinning disk that can take
seconds. Every test here exists to prove one thing: nothing the engine does —
being slow, failing, being disabled, or returning junk — can degrade or delay
the Coach's primary answer.
"""
import json
import os
import sys
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import coach
from ml.production import policy


class _Mode:
    """Swap the module-level flag, which is read at import time."""

    def __init__(self, mode):
        self.mode = mode

    def __enter__(self):
        self.old = coach._OIE_MODE
        coach._OIE_MODE = self.mode

    def __exit__(self, *a):
        coach._OIE_MODE = self.old


class _Observe:
    """Replace the single production entry point into the engine."""

    def __init__(self, fn):
        self.fn = fn

    def __enter__(self):
        self.old = coach.observe
        coach.observe = self.fn

    def __exit__(self, *a):
        coach.observe = self.old


def _read(**kw):
    base = {"primary": {"cards": ["a"] * 8, "confidence": "high",
                        "basis": "recent"},
            "changeProbability": 0.02, "alternatives": [], "note": "",
            "degraded": False}
    base.update(kw)
    return base


class AlternativeCaps(unittest.TestCase):
    """Less confidence must never surface MORE alternatives.

    The previous rule capped `high` at 2 and left `low` at 3 — the inverse of
    its own docstring, so the least trustworthy band showed the longest list.
    """

    def _result(self, band, n):
        return policy.PredictionResult(
            primary_deck=["a"] * 8, primary_confidence=band,
            change_probability=0.1,
            alternatives=[{"cards": ["b"] * 8, "out": [], "in": [],
                           "confidence": "low", "evidence": []}
                          for _ in range(n)])

    def test_high_caps_at_two(self):
        r = policy.cap_alternatives(self._result("high", 5))
        self.assertEqual(len(r.alternatives), 2)

    def test_medium_caps_at_one(self):
        r = policy.cap_alternatives(self._result("medium", 5))
        self.assertEqual(len(r.alternatives), 1)

    def test_low_shows_none(self):
        r = policy.cap_alternatives(self._result("low", 5))
        self.assertEqual(len(r.alternatives), 0)

    def test_caps_are_monotonic(self):
        caps = [len(policy.cap_alternatives(self._result(b, 9)).alternatives)
                for b in ("high", "medium", "low")]
        self.assertEqual(caps, sorted(caps, reverse=True))
        self.assertEqual(caps, [2, 1, 0])

    def test_an_unknown_band_surfaces_nothing(self):
        r = policy.cap_alternatives(self._result("bogus", 5))
        self.assertEqual(len(r.alternatives), 0)

    def test_fewer_alternatives_than_the_cap_is_left_alone(self):
        r = policy.cap_alternatives(self._result("high", 1))
        self.assertEqual(len(r.alternatives), 1)


class FeatureFlag(unittest.TestCase):
    def test_off_reports_disabled_and_never_calls_the_engine(self):
        calls = []
        with _Mode("off"), _Observe(lambda t: calls.append(t) or _read()):
            out = coach.opponent_read("#T")
        self.assertFalse(out["enabled"])
        self.assertIsNone(out["read"])
        self.assertEqual(calls, [], "the engine ran while switched off")

    def test_shadow_reports_disabled_to_the_client(self):
        """Shadow observes; it does not surface. The client must see exactly
        what it sees when the flag is off."""
        with _Mode("shadow"), _Observe(lambda t: _read()):
            out = coach.opponent_read("#T")
        self.assertFalse(out["enabled"])
        self.assertIsNone(out["read"])

    def test_on_returns_the_read(self):
        with _Mode("on"), _Observe(lambda t: _read()):
            out = coach.opponent_read("#T")
        self.assertTrue(out["enabled"])
        self.assertEqual(out["read"]["primary"]["confidence"], "high")

    def test_off_and_shadow_are_indistinguishable_to_the_client(self):
        with _Mode("off"), _Observe(lambda t: _read()):
            a = coach.opponent_read("#T")
        with _Mode("shadow"), _Observe(lambda t: _read()):
            b = coach.opponent_read("#T")
        self.assertEqual(a, b)


class ObservationIsFireAndForget(unittest.TestCase):
    def test_the_coach_does_not_wait_for_a_slow_engine(self):
        """THE resilience contract. Phase 19A measured cold reads at ~2.5 s
        p95; the Coach must not pay that."""
        started = threading.Event()

        def slow(tag):
            started.set()
            time.sleep(3.0)
            return _read()

        with _Mode("shadow"), _Observe(slow):
            t0 = time.time()
            coach._observe_opponent("#T")
            elapsed = time.time() - t0
        self.assertTrue(started.wait(2.0), "observation never started")
        self.assertLess(elapsed, 0.5,
                        "the Coach blocked on the engine for %.2fs" % elapsed)

    def test_an_exploding_engine_cannot_reach_the_coach(self):
        def boom(tag):
            raise RuntimeError("engine on fire")

        with _Mode("shadow"), _Observe(boom):
            coach._observe_opponent("#T")      # must not raise
            time.sleep(0.2)

    def test_on_mode_does_not_double_record(self):
        """In `on` the endpoint performs the read; observing from the Coach too
        would count every player twice in the shadow log."""
        calls = []
        with _Mode("on"), _Observe(lambda t: calls.append(t) or _read()):
            coach._observe_opponent("#T")
            time.sleep(0.2)
        self.assertEqual(calls, [])

    def test_off_mode_observes_nothing(self):
        calls = []
        with _Mode("off"), _Observe(lambda t: calls.append(t) or _read()):
            coach._observe_opponent("#T")
            time.sleep(0.2)
        self.assertEqual(calls, [])

    def test_shadow_mode_does_observe(self):
        done = threading.Event()
        with _Mode("shadow"), _Observe(lambda t: done.set() or _read()):
            coach._observe_opponent("#T")
            self.assertTrue(done.wait(2.0), "shadow recorded nothing")


class FailureDegradesToRecent(unittest.TestCase):
    def test_engine_failure_yields_a_null_read_not_an_error(self):
        def boom(tag):
            raise RuntimeError("db gone")

        with _Mode("on"), _Observe(boom):
            out = coach.opponent_read("#T")
        self.assertTrue(out["enabled"])
        self.assertIsNone(out["read"], "a failure must degrade, not propagate")

    def test_a_none_read_is_reported_as_null(self):
        with _Mode("on"), _Observe(lambda t: None):
            out = coach.opponent_read("#T")
        self.assertIsNone(out["read"])

    def test_degraded_reads_still_carry_the_recent_deck(self):
        deck = ["card%d" % i for i in range(8)]
        r = policy.safe_fallback(deck, "no established shell")
        self.assertEqual(r.primary_deck, deck)
        self.assertEqual(r.alternatives, [])
        self.assertTrue(r.degraded)
        self.assertEqual(r.basis, "recent")

    def test_the_response_is_json_serialisable(self):
        with _Mode("on"), _Observe(lambda t: _read()):
            json.dumps(coach.opponent_read("#T"))


class NoInternalsLeak(unittest.TestCase):
    FORBIDDEN = ("logistic", "weight", "logit", "feature", "score",
                 "m2-change", "sigmoid", "coefficient")

    def test_the_payload_exposes_no_model_internals(self):
        alt = {"cards": ["b"] * 8, "out": ["x"], "in": ["y"],
               "confidence": "medium",
               "evidence": ["this player has made this swap 4 times before"]}
        with _Mode("on"), _Observe(lambda t: _read(alternatives=[alt])):
            blob = json.dumps(coach.opponent_read("#T")).lower()
        for word in self.FORBIDDEN:
            self.assertNotIn(word, blob, "%r leaked to the client" % word)

    def test_evidence_is_plain_language(self):
        from ml import shortlist
        src = open(shortlist.__file__, encoding="utf-8").read()
        self.assertIn("has made this swap", src)


class CoachPayloadRegression(unittest.TestCase):
    def test_predict_no_longer_carries_an_inline_read(self):
        """The whole point of 19B: the read is fetched separately, so it can
        never delay the deck."""
        import inspect
        src = inspect.getsource(coach.predict)
        self.assertNotIn('out["opponentRead"]', src)
        self.assertIn("_observe_opponent", src)

    def test_observe_is_the_single_entry_point(self):
        import inspect
        for fn in (coach._safe_observe, coach.opponent_read):
            self.assertIn("observe", inspect.getsource(fn))


if __name__ == "__main__":
    unittest.main(verbosity=1)
