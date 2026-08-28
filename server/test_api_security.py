"""Phase 24C, step 2 — the security boundary in front of the analytics API.

These are END-TO-END over real HTTP rather than unit calls into the handler.
The controls being tested are header-level and status-level, and a unit test
that calls `check_auth` directly would pass just as happily against a server
that never called it.

Every test reloads `app` with its own environment, because the boundary is
configured from env at import time. The reload also gives each test a fresh
rate limiter, which is what keeps them independent.

    python server/test_api_security.py
"""
from __future__ import annotations

import contextlib
import importlib
import inspect
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app as app_module  # noqa: E402
import clash_data as cd  # noqa: E402

KEY = "test-key-8e2f1a4c9b7d"
ORIGIN = "https://royal-duels.vercel.app"

#: Routing needs no database for these: an unknown path under the prefix falls
#: through to the 404 at the end of `_route`, which proves the gate let it past
#: without any handler touching the H: volume.
PAST_GATE = "/api/analytics/definitely-not-a-route"

ENV_KEYS = ("CLASH_API_KEY", "CLASH_API_ALLOW_ANONYMOUS", "CLASH_ALLOWED_ORIGIN",
            "CLASH_RATE_LIMIT", "CLASH_RATE_WINDOW", "CLASH_TRUSTED_PROXY",
            "CLASH_API_HOST", "CLASH_API_PORT")


@contextlib.contextmanager
def configured(**env):
    """Reload `app` under a specific environment, then put it back."""
    saved = {k: os.environ.get(k) for k in ENV_KEYS}
    for k in ENV_KEYS:
        os.environ.pop(k, None)
    for k, v in env.items():
        os.environ[k] = str(v)
    try:
        yield importlib.reload(app_module)
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        importlib.reload(app_module)


@contextlib.contextmanager
def serving(mod):
    """The reloaded handler on an ephemeral loopback port."""
    mod.Handler.log_message = lambda *a, **k: None   # 73 tests of noise
    srv = ThreadingHTTPServer(("127.0.0.1", 0), mod.Handler)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        yield "http://127.0.0.1:%d" % srv.server_address[1]
    finally:
        srv.shutdown()
        srv.server_close()
        thread.join(timeout=5)


def fetch(base, path=PAST_GATE, headers=None, method="GET"):
    """(status, headers, body-text). A 4xx is an answer here, not an error."""
    req = urllib.request.Request(base + path, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")


def keyed(key=KEY):
    return {"X-Analytics-Key": key}


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

class Authentication(unittest.TestCase):

    def test_valid_key_passes_the_gate(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            status, _, _ = fetch(base, headers=keyed())
            # 404 from the router, NOT 401 from the gate.
            self.assertEqual(status, 404)

    def test_missing_key_is_401(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            status, _, body = fetch(base)
            self.assertEqual(status, 401)
            self.assertEqual(json.loads(body)["error"], "unauthorized")

    def test_wrong_key_is_401(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            status, _, _ = fetch(base, headers=keyed(KEY + "x"))
            self.assertEqual(status, 401)

    def test_prefix_of_the_real_key_is_401(self):
        """A truncated key must not pass. `compare_digest` is length-aware."""
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            status, _, _ = fetch(base, headers=keyed(KEY[:-1]))
            self.assertEqual(status, 401)

    def test_bearer_carrier_also_accepted(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            status, _, _ = fetch(base, headers={"Authorization": "Bearer " + KEY})
            self.assertEqual(status, 404)

    def test_comparison_is_timing_safe(self):
        """The check must go through `hmac.compare_digest`, on bytes.

        Asserted on the source because there is no black-box test for a timing
        side channel that is not itself a flaky benchmark.
        """
        src = inspect.getsource(app_module.check_auth)
        self.assertIn("hmac.compare_digest", src)
        self.assertNotIn("==", src.split("compare_digest")[1].split("\n")[0])
        self.assertIn('encode("utf-8")', src)

    def test_non_ascii_key_does_not_raise(self):
        """`compare_digest` refuses non-ASCII str; we hand it bytes."""
        with configured(CLASH_API_KEY="ke\u00fd-\u00e9") as mod, serving(mod) as base:
            self.assertEqual(fetch(base, headers=keyed("wrong"))[0], 401)
            self.assertEqual(fetch(base, headers=keyed("ke\u00fd-\u00e9"))[0], 404)

    def test_status_is_the_only_public_route(self):
        self.assertEqual(set(app_module.PUBLIC_PATHS), {"/api/analytics/status"})

    def test_status_answers_without_a_key(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            status, _, body = fetch(base, "/api/analytics/status")
            self.assertEqual(status, 200)
            self.assertIn("hot", json.loads(body))

    def test_every_other_route_requires_a_key(self):
        """Sampled across the real route table, not just the 404 path."""
        routes = ["/api/analytics/suggest", "/api/analytics/meta",
                  "/api/analytics/meta/cards", "/api/analytics/coverage",
                  "/api/analytics/player/%23Y022GRCJQ",
                  "/api/analytics/duels/%23Y022GRCJQ",
                  "/api/analytics/coach/predict/%23Y022GRCJQ",
                  "/api/analytics/coach/opponent-read/%23Y022GRCJQ",
                  "/api/analytics/track/pending",
                  "/api/analytics/battles/%23Y022GRCJQ",
                  "/api/analytics/deck?cards=knight"]
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            for path in routes:
                with self.subTest(path=path):
                    self.assertEqual(fetch(base, path)[0], 401)


class FailClosed(unittest.TestCase):
    """No key configured is not the same as no key required."""

    def test_no_key_configured_refuses_authenticated_routes(self):
        with configured() as mod, serving(mod) as base:
            status, _, body = fetch(base)
            self.assertEqual(status, 503)
            self.assertEqual(json.loads(body)["error"], "auth_not_configured")

    def test_no_key_configured_still_serves_status(self):
        with configured() as mod, serving(mod) as base:
            self.assertEqual(fetch(base, "/api/analytics/status")[0], 200)

    def test_loopback_is_not_a_free_pass(self):
        """These requests come FROM 127.0.0.1 and are still refused.

        This is the point of the control: `cloudflared` runs on this machine
        and dials loopback, so a local-means-trusted exemption would wave
        through every tunnelled request.
        """
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            self.assertEqual(fetch(base)[0], 401)

    def test_startup_warning_when_no_key(self):
        with configured() as mod:
            banner = "\n".join(mod.security_banner())
            self.assertIn("NO CLASH_API_KEY SET", banner)
            self.assertIn("503", banner)

    def test_anonymous_opt_in_is_explicit_and_off_by_default(self):
        with configured() as mod:
            self.assertFalse(mod.ALLOW_ANONYMOUS)
        with configured(CLASH_API_ALLOW_ANONYMOUS="1") as mod:
            self.assertTrue(mod.ALLOW_ANONYMOUS)
            self.assertIn("DISABLED", "\n".join(mod.security_banner()))

    def test_anonymous_opt_in_serves_requests(self):
        with configured(CLASH_API_ALLOW_ANONYMOUS="1") as mod, serving(mod) as base:
            self.assertEqual(fetch(base)[0], 404)

    def test_no_key_is_generated(self):
        """A generated key is a key nobody knows they are relying on."""
        with configured() as mod:
            self.assertEqual(mod.API_KEY, "")
        src = inspect.getsource(app_module)
        for forbidden in ("secrets.token", "uuid4", "os.urandom"):
            self.assertNotIn(forbidden, src)


class Binding(unittest.TestCase):

    def test_default_host_is_loopback(self):
        with configured() as mod:
            self.assertEqual(mod.HOST, "127.0.0.1")

    def test_no_wildcard_bind_anywhere_in_the_source(self):
        self.assertNotIn("0.0.0.0", inspect.getsource(app_module))

    def test_refuses_to_start_unauthenticated_on_a_public_interface(self):
        with configured(CLASH_API_HOST="192.168.1.50") as mod:
            self.assertIn("refusing to start", mod.refuse_unsafe_bind())

    def test_public_interface_with_a_key_is_allowed(self):
        with configured(CLASH_API_HOST="192.168.1.50", CLASH_API_KEY=KEY) as mod:
            self.assertEqual(mod.refuse_unsafe_bind(), "")

    def test_loopback_without_a_key_still_starts(self):
        """It starts, and then refuses every authenticated route."""
        with configured() as mod:
            self.assertEqual(mod.refuse_unsafe_bind(), "")


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

class Cors(unittest.TestCase):

    def test_allowed_origin_is_echoed(self):
        with configured(CLASH_API_KEY=KEY, CLASH_ALLOWED_ORIGIN=ORIGIN) as mod, \
                serving(mod) as base:
            _, h, _ = fetch(base, headers={**keyed(), "Origin": ORIGIN})
            self.assertEqual(h.get("Access-Control-Allow-Origin"), ORIGIN)
            self.assertEqual(h.get("Vary"), "Origin")

    def test_other_origin_gets_no_cors_headers(self):
        with configured(CLASH_API_KEY=KEY, CLASH_ALLOWED_ORIGIN=ORIGIN) as mod, \
                serving(mod) as base:
            _, h, _ = fetch(base, headers={**keyed(), "Origin": "https://evil.example"})
            self.assertIsNone(h.get("Access-Control-Allow-Origin"))

    def test_near_miss_origins_are_rejected(self):
        """Exact match, not prefix or suffix."""
        near = [ORIGIN + ".evil.example", "https://evil." + ORIGIN[8:],
                ORIGIN + "/", ORIGIN.replace("https", "http"), ORIGIN.upper()]
        with configured(CLASH_API_KEY=KEY, CLASH_ALLOWED_ORIGIN=ORIGIN) as mod, \
                serving(mod) as base:
            for origin in near:
                with self.subTest(origin=origin):
                    _, h, _ = fetch(base, headers={**keyed(), "Origin": origin})
                    self.assertIsNone(h.get("Access-Control-Allow-Origin"))

    def test_no_allowed_origin_configured_means_no_cors_at_all(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            _, h, _ = fetch(base, headers={**keyed(), "Origin": ORIGIN})
            self.assertIsNone(h.get("Access-Control-Allow-Origin"))

    def test_wildcard_origin_is_unreachable(self):
        """Neither configured nor reflected. The old code sent `*` always."""
        self.assertNotIn('"Access-Control-Allow-Origin", "*"',
                         inspect.getsource(app_module))
        with configured(CLASH_API_KEY=KEY, CLASH_ALLOWED_ORIGIN=ORIGIN) as mod, \
                serving(mod) as base:
            for origin in ("*", "null"):
                _, h, _ = fetch(base, headers={**keyed(), "Origin": origin})
                self.assertNotEqual(h.get("Access-Control-Allow-Origin"), "*")
                self.assertIsNone(h.get("Access-Control-Allow-Origin"))

    def test_origin_is_never_echoed_when_it_is_the_wildcard(self):
        with configured(CLASH_API_KEY=KEY, CLASH_ALLOWED_ORIGIN="*") as mod, \
                serving(mod) as base:
            # Even a misconfigured `*` only matches a literal `*` Origin header,
            # which no browser sends -- it cannot become "any origin".
            _, h, _ = fetch(base, headers={**keyed(), "Origin": "https://evil.example"})
            self.assertIsNone(h.get("Access-Control-Allow-Origin"))


class Preflight(unittest.TestCase):

    def test_allowed_origin_preflight_is_204(self):
        with configured(CLASH_API_KEY=KEY, CLASH_ALLOWED_ORIGIN=ORIGIN) as mod, \
                serving(mod) as base:
            status, h, _ = fetch(base, headers={"Origin": ORIGIN}, method="OPTIONS")
            self.assertEqual(status, 204)
            self.assertEqual(h.get("Access-Control-Allow-Origin"), ORIGIN)

    def test_preflight_needs_no_key(self):
        """A browser never attaches credentials to a preflight, and the
        preflight carries no data. The GET after it is still authenticated."""
        with configured(CLASH_API_KEY=KEY, CLASH_ALLOWED_ORIGIN=ORIGIN) as mod, \
                serving(mod) as base:
            self.assertEqual(
                fetch(base, headers={"Origin": ORIGIN}, method="OPTIONS")[0], 204)
            # ...and the real request is not let through by it.
            self.assertEqual(fetch(base, headers={"Origin": ORIGIN})[0], 401)

    def test_unknown_origin_preflight_is_403(self):
        with configured(CLASH_API_KEY=KEY, CLASH_ALLOWED_ORIGIN=ORIGIN) as mod, \
                serving(mod) as base:
            status, h, _ = fetch(base, headers={"Origin": "https://evil.example"},
                                 method="OPTIONS")
            self.assertEqual(status, 403)
            self.assertIsNone(h.get("Access-Control-Allow-Origin"))

    def test_allowed_headers_are_a_fixed_list(self):
        with configured(CLASH_API_KEY=KEY, CLASH_ALLOWED_ORIGIN=ORIGIN) as mod, \
                serving(mod) as base:
            _, h, _ = fetch(base, headers={"Origin": ORIGIN}, method="OPTIONS")
            allowed = h.get("Access-Control-Allow-Headers")
            self.assertNotEqual(allowed, "*")
            self.assertIn("X-Analytics-Key", allowed)
            self.assertEqual(h.get("Access-Control-Allow-Methods"), "GET, OPTIONS")

    def test_no_wildcard_header_list_in_the_source(self):
        self.assertNotIn('"Access-Control-Allow-Headers", "*"',
                         inspect.getsource(app_module))


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

class RateLimiting(unittest.TestCase):

    def limiter(self, limit=5, window=60, max_clients=4096):
        return app_module.RateLimiter(limit, window, max_clients)

    def test_allows_up_to_the_limit(self):
        rl = self.limiter(limit=5)
        self.assertTrue(all(rl.allow("a", now=100.0) for _ in range(5)))

    def test_rejects_past_the_limit(self):
        rl = self.limiter(limit=5)
        for _ in range(5):
            rl.allow("a", now=100.0)
        self.assertFalse(rl.allow("a", now=100.0))

    def test_window_rolls(self):
        rl = self.limiter(limit=2, window=60)
        rl.allow("a", now=100.0)
        rl.allow("a", now=100.0)
        self.assertFalse(rl.allow("a", now=100.0))
        self.assertTrue(rl.allow("a", now=160.0))

    def test_clients_are_independent(self):
        rl = self.limiter(limit=1)
        self.assertTrue(rl.allow("a", now=100.0))
        self.assertFalse(rl.allow("a", now=100.0))
        self.assertTrue(rl.allow("b", now=100.0))

    def test_deterministic_for_a_given_clock(self):
        a = [self.limiter(limit=3).allow("x", now=100.0) for _ in range(1)]
        rl1, rl2 = self.limiter(limit=3), self.limiter(limit=3)
        seq1 = [rl1.allow("x", now=100.0) for _ in range(6)]
        seq2 = [rl2.allow("x", now=100.0) for _ in range(6)]
        self.assertEqual(seq1, seq2)
        self.assertEqual(seq1, [True, True, True, False, False, False])
        self.assertTrue(a[0])

    def test_memory_is_bounded(self):
        rl = self.limiter(limit=10, max_clients=64)
        for i in range(5000):
            rl.allow("client-%d" % i, now=100.0)
        self.assertLessEqual(len(rl._hits), 64)

    def test_stale_windows_are_evicted_first(self):
        rl = self.limiter(limit=10, window=60, max_clients=8)
        for i in range(8):
            rl.allow("old-%d" % i, now=100.0)
        rl.allow("fresh", now=1000.0)
        self.assertIn("fresh", rl._hits)
        self.assertLessEqual(len(rl._hits), 8)

    def test_concurrent_requests_do_not_over_admit(self):
        """The count under 32 threads must be exactly the limit, not about it."""
        rl = self.limiter(limit=50, window=3600)
        results = []
        lock = threading.Lock()

        def hammer():
            mine = [rl.allow("shared", now=100.0) for _ in range(20)]
            with lock:
                results.extend(mine)

        threads = [threading.Thread(target=hammer) for _ in range(32)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(results), 640)
        self.assertEqual(sum(results), 50)

    def test_http_rate_limit_returns_429(self):
        with configured(CLASH_API_KEY=KEY, CLASH_RATE_LIMIT="5",
                        CLASH_RATE_WINDOW="3600") as mod, serving(mod) as base:
            codes = [fetch(base, headers=keyed())[0] for _ in range(8)]
            self.assertEqual(codes[:5], [404] * 5)
            self.assertEqual(codes[5:], [429] * 3)

    def test_429_carries_retry_after(self):
        with configured(CLASH_API_KEY=KEY, CLASH_RATE_LIMIT="1",
                        CLASH_RATE_WINDOW="3600") as mod, serving(mod) as base:
            fetch(base, headers=keyed())
            status, h, body = fetch(base, headers=keyed())
            self.assertEqual(status, 429)
            self.assertEqual(h.get("Retry-After"), "3600")
            self.assertEqual(json.loads(body)["error"], "rate_limited")

    def test_status_is_not_rate_limited(self):
        """The health check must answer while the service is shedding load."""
        with configured(CLASH_API_KEY=KEY, CLASH_RATE_LIMIT="1",
                        CLASH_RATE_WINDOW="3600") as mod, serving(mod) as base:
            fetch(base, headers=keyed())
            self.assertEqual(fetch(base, headers=keyed())[0], 429)
            for _ in range(5):
                self.assertEqual(fetch(base, "/api/analytics/status")[0], 200)

    def test_unauthenticated_requests_cannot_spend_the_budget(self):
        """Auth runs before the limiter, so a stranger cannot lock out the
        real caller by flooding the port with bad keys."""
        with configured(CLASH_API_KEY=KEY, CLASH_RATE_LIMIT="3",
                        CLASH_RATE_WINDOW="3600") as mod, serving(mod) as base:
            for _ in range(20):
                self.assertEqual(fetch(base, headers=keyed("wrong"))[0], 401)
            self.assertEqual(fetch(base, headers=keyed())[0], 404)

    def test_default_limit_does_not_block_normal_use(self):
        with configured() as mod:
            self.assertGreaterEqual(mod.RATE_LIMIT, 60)
            self.assertEqual(mod.RATE_WINDOW, 60)

    def test_forwarded_for_is_ignored_unless_a_proxy_is_declared(self):
        """Otherwise the caller picks its own rate-limit key."""
        with configured(CLASH_API_KEY=KEY, CLASH_RATE_LIMIT="2",
                        CLASH_RATE_WINDOW="3600") as mod, serving(mod) as base:
            codes = [fetch(base, headers={**keyed(),
                                          "X-Forwarded-For": "10.0.0.%d" % i})[0]
                     for i in range(5)]
            self.assertEqual(codes, [404, 404, 429, 429, 429])

    def test_forwarded_for_is_honoured_when_declared(self):
        with configured(CLASH_API_KEY=KEY, CLASH_RATE_LIMIT="2",
                        CLASH_RATE_WINDOW="3600", CLASH_TRUSTED_PROXY="1") as mod, \
                serving(mod) as base:
            codes = [fetch(base, headers={**keyed(),
                                          "X-Forwarded-For": "10.0.0.%d" % i})[0]
                     for i in range(5)]
            self.assertEqual(codes, [404] * 5)


# ---------------------------------------------------------------------------
# Error handling and leakage
# ---------------------------------------------------------------------------

SECRET_MESSAGE = "H:\\ClashBot\\data\\battles.db is locked by pid 4131"


class ErrorHandling(unittest.TestCase):

    @contextlib.contextmanager
    def exploding(self):
        """Force the generic handler by making a route raise."""
        original = cd.suggest_tags

        def boom(*_a, **_k):
            raise RuntimeError(SECRET_MESSAGE)

        cd.suggest_tags = boom
        try:
            yield
        finally:
            cd.suggest_tags = original

    def test_unexpected_error_is_a_generic_500(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base, \
                self.exploding():
            status, _, body = fetch(base, "/api/analytics/suggest", keyed())
            self.assertEqual(status, 500)
            self.assertEqual(json.loads(body), {"error": "server_error"})

    def test_500_leaks_no_exception_text(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base, \
                self.exploding():
            _, _, body = fetch(base, "/api/analytics/suggest", keyed())
            for fragment in ("H:\\", "battles.db", "pid 4131", "RuntimeError",
                             "Traceback", "app.py", "clash_data"):
                self.assertNotIn(fragment, body)

    def test_500_leaks_no_traceback(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base, \
                self.exploding():
            _, _, body = fetch(base, "/api/analytics/suggest", keyed())
            self.assertNotIn("File \"", body)
            self.assertNotIn("line ", body)
            self.assertEqual(len(body), len('{"error": "server_error"}'))

    def test_no_detail_field_in_the_source(self):
        self.assertNotIn('"detail": str(exc)', inspect.getsource(app_module))

    def test_the_public_status_route_leaks_no_filesystem_paths(self):
        """The one unauthenticated route used to publish both volume paths."""
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            _, _, body = fetch(base, "/api/analytics/status")
            payload = json.loads(body)
            for tier in ("hot", "archive"):
                self.assertNotIn("path", payload[tier])
                self.assertIn("available", payload[tier])
            for fragment in ("H:\\", "H:/", ".db", "ClashBot", "ClashArchive",
                             "C:\\", "Users"):
                self.assertNotIn(fragment, body)

    def test_the_secret_never_appears_in_any_response(self):
        paths = [PAST_GATE, "/api/analytics/status", "/api/analytics/deck"]
        with configured(CLASH_API_KEY=KEY, CLASH_ALLOWED_ORIGIN=ORIGIN) as mod, \
                serving(mod) as base:
            for path in paths:
                for hdrs in (keyed(), keyed("wrong"), {}):
                    status, h, body = fetch(base, path, hdrs)
                    self.assertNotIn(KEY, body)
                    self.assertNotIn(KEY, json.dumps(h))
                    self.assertIsInstance(status, int)

    def test_the_key_is_never_logged(self):
        src = inspect.getsource(app_module)
        for line in src.split("\n"):
            if "print(" in line or "log_message" in line or "stderr.write" in line:
                self.assertNotIn("API_KEY", line, "the key must never be printed")
        # The banner reports its LENGTH, which is enough to tell "set" from
        # "set to something surprising" without publishing the value.
        with configured(CLASH_API_KEY=KEY) as mod:
            banner = "\n".join(mod.security_banner())
            self.assertNotIn(KEY, banner)
            self.assertIn(str(len(KEY)), banner)

    def test_error_bodies_are_reason_codes_not_prose(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            for hdrs, expected in ((None, "unauthorized"), (keyed("no"), "unauthorized")):
                _, _, body = fetch(base, headers=hdrs)
                self.assertEqual(json.loads(body), {"error": expected})

    def test_background_workers_report_type_not_message(self):
        """`deck_counter` and `meta` serve `_state["error"]` in a response."""
        for name in ("deck_counter", "meta"):
            mod = importlib.import_module(name)
            src = inspect.getsource(mod)
            self.assertNotIn('_state["error"] = str(exc)', src, name)
            self.assertIn('_state["error"] = type(exc).__name__', src, name)


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

class MetricsRecording(unittest.TestCase):

    def test_outcomes_are_counted(self):
        with configured(CLASH_API_KEY=KEY, CLASH_RATE_LIMIT="2",
                        CLASH_RATE_WINDOW="3600") as mod, serving(mod) as base:
            fetch(base, headers=keyed("wrong"))          # auth_failed
            fetch(base, headers=keyed())                 # client_error (404)
            fetch(base, headers=keyed())                 # client_error (404)
            fetch(base, headers=keyed())                 # rate_limited
            snap = mod.metrics_snapshot()
            self.assertEqual(snap["total"], 4)
            self.assertEqual(snap["auth_failed"], 1)
            self.assertEqual(snap["rate_limited"], 1)
            self.assertEqual(snap["client_error"], 2)
            self.assertEqual(snap["server_error"], 0)

    def test_server_errors_are_counted(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            original = cd.suggest_tags
            cd.suggest_tags = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x"))
            try:
                fetch(base, "/api/analytics/suggest", keyed())
            finally:
                cd.suggest_tags = original
            self.assertEqual(mod.metrics_snapshot()["server_error"], 1)

    def test_latency_percentiles_are_reported(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            for _ in range(5):
                fetch(base, headers=keyed())
            lat = mod.metrics_snapshot()["latencyMs"]
            self.assertEqual(lat["samples"], 5)
            for p in ("p50", "p95", "p99"):
                self.assertIsInstance(lat[p], float)
            self.assertLessEqual(lat["p50"], lat["p99"])

    def test_latency_sample_is_bounded(self):
        m = app_module.Metrics()
        for i in range(5000):
            m.record("ok", float(i))
        self.assertEqual(m.snapshot()["latencyMs"]["samples"], m.SAMPLE)
        self.assertEqual(m.snapshot()["total"], 5000)

    def test_metrics_record_no_player_data(self):
        """A per-tag counter is not a metric; it is a log of who was looked up."""
        snap = app_module.Metrics().snapshot()
        self.assertEqual(set(snap) - {"latencyMs"},
                         {"total", "ok", "auth_failed", "rate_limited",
                          "client_error", "server_error"})
        body = inspect.getsource(app_module.Metrics.record)
        self.assertEqual(list(inspect.signature(app_module.Metrics.record)
                              .parameters), ["self", "outcome", "ms"])
        self.assertNotIn("tag", body)
        self.assertNotIn("path", body)

    def test_metrics_are_not_on_a_public_route(self):
        """Step 7 decides how to surface these. Until then they are internal."""
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            _, _, body = fetch(base, "/api/analytics/status")
            self.assertNotIn("auth_failed", body)


# ---------------------------------------------------------------------------
# The response contract, unchanged by this step
# ---------------------------------------------------------------------------

class PayloadContract(unittest.TestCase):
    """Re-asserted at the boundary. `test_ml_22_final.py` owns these rules;
    this checks the step-2 patch did not disturb them."""

    def read(self, **kw):
        from ml.production import policy
        base = dict(primary_deck=["a"] * 8, primary_confidence="high",
                    change_probability=0.42,
                    alternatives=[{"cards": ["b"] * 8, "out": ["a"], "in": ["b"],
                                   "confidence": "medium", "evidence": ["e"]}],
                    note="", domain="competitive")
        base.update(kw)
        return policy.PredictionResult(**base).as_dict()

    def test_approved_fields_only(self):
        payload = self.read()
        self.assertEqual(set(payload),
                         {"primary", "alternatives", "note", "degraded", "bandShown"})
        self.assertEqual(set(payload["primary"]), {"cards", "basis", "confidence"})

    def test_change_probability_is_absent(self):
        self.assertNotIn("changeProbability", json.dumps(self.read()))

    def test_degraded_has_zero_alternatives(self):
        self.assertEqual(self.read(degraded=True)["alternatives"], [])

    def test_practice_shows_no_band_and_no_alternatives(self):
        payload = self.read(domain="practice")
        self.assertNotIn("confidence", payload["primary"])
        self.assertEqual(payload["alternatives"], [])
        self.assertFalse(payload["bandShown"])

    def test_competitive_confidence_is_qualitative(self):
        payload = self.read(domain="competitive")
        self.assertEqual(payload["primary"]["confidence"], "high")
        self.assertTrue(payload["bandShown"])

    def test_no_band_percentage_crosses_the_boundary(self):
        body = json.dumps(self.read()) + json.dumps(self.read(domain="practice"))
        for pct in ("90.5", "0.905", "92.1", "0.921", "73.3", "47.3", "0.42"):
            self.assertNotIn(pct, body)


# ---------------------------------------------------------------------------
# The routing surface is unchanged
# ---------------------------------------------------------------------------

class RoutingUnchanged(unittest.TestCase):

    def test_no_new_routes_were_added(self):
        src = inspect.getsource(app_module.Handler._route)
        routes = [l.strip() for l in src.split("\n")
                  if l.strip().startswith(("if path ==", "if path.startswith("))]
        # BACK TO 20 on 28 Aug 2026: `/api/analytics/search` (find a player by
        # name) was added and removed the same day - the field that used it
        # fires a request per debounced keystroke on every screen, and the
        # traffic was not worth saving someone typing a tag. 20 is the count
        # from `/api/analytics/battles/<tag>`. Bumping this number is the POINT
        # of the test rather than a chore around it - it is a tripwire, so the
        # change belongs in the same commit as the route, beside the auth test
        # above.
        self.assertEqual(len(routes), 20)

    def test_only_get_and_options_are_served(self):
        served = [n for n in dir(app_module.Handler) if n.startswith("do_")]
        self.assertEqual(sorted(served), ["do_GET", "do_OPTIONS"])

    def test_unsupported_methods_are_refused(self):
        with configured(CLASH_API_KEY=KEY) as mod, serving(mod) as base:
            for method in ("POST", "PUT", "DELETE", "PATCH"):
                with self.subTest(method=method):
                    status, _, _ = fetch(base, headers=keyed(), method=method)
                    self.assertEqual(status, 501)

    def test_the_gate_runs_before_every_route(self):
        """`do_GET` must not be able to reach `_route` without `_gate`."""
        src = inspect.getsource(app_module.Handler.do_GET)
        self.assertIn("_gate", src)
        self.assertIn("if self._gate(", src)
        self.assertIn("self._route()", src)


if __name__ == "__main__":
    unittest.main(verbosity=2)
