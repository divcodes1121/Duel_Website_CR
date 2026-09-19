"""Checks for `admin_auth` — the Coach Roster's second gate.

No network beyond loopback: a fake PostgREST on an ephemeral port answers
`rpc/coach_is_admin` by token, and counts how often it is asked, so caching
and fail-closed behaviour are measured rather than assumed.

Run: python server/test_admin_auth.py
"""

from __future__ import annotations

import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import admin_auth as aa  # noqa: E402

PASS = 0
FAIL = 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


CALLS = {"n": 0, "last_apikey": None, "last_path": None}


class Fake(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        CALLS["n"] += 1
        CALLS["last_apikey"] = self.headers.get("apikey")
        CALLS["last_path"] = self.path
        token = (self.headers.get("Authorization") or "")[7:]
        status, body = {
            "a.b.admin": (200, b"true"),
            "a.b.member": (200, b"false"),
            "a.b.boom": (500, b'{"message":"boom"}'),
            "a.b.junk": (200, b"not json"),
        }.get(token, (401, b'{"message":"JWT expired"}'))
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a, **k):
        pass


srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d" % srv.server_address[1]


def env(url=BASE, key="anon-key"):
    aa.clear_cache()
    for k, v in (("SUPABASE_URL", url), ("SUPABASE_ANON_KEY", key)):
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


# --- verdicts -----------------------------------------------------------------

env()
check("an admin token is ok", aa.verify("a.b.admin") == "ok")
check("it asked migration 004's own function", CALLS["last_path"] == "/rest/v1/rpc/coach_is_admin", CALLS["last_path"])
check("with the public key as `apikey`", CALLS["last_apikey"] == "anon-key")
check("a member token is forbidden", aa.verify("a.b.member") == "forbidden")
check("an expired token is unauthorized", aa.verify("a.b.stale") == "unauthorized")
check("a Supabase error is unavailable, not a pass", aa.verify("a.b.boom") == "unavailable")
check("an unreadable answer is unavailable, not a pass", aa.verify("a.b.junk") == "unavailable")

# --- no request for what cannot be a JWT --------------------------------------

env()
before = CALLS["n"]
for bad in (None, "", "   ", "not-a-jwt", "a.b", "a.b.c.d", "x" * 5000):
    check(f"refused without asking: {str(bad)[:12]!r}", aa.verify(bad) == "unauthorized")
check("...and Supabase was never asked", CALLS["n"] == before, f"{CALLS['n'] - before} calls")

# --- fail closed --------------------------------------------------------------

env(url=None)
check("no Supabase URL is not_configured", aa.verify("a.b.admin") == "not_configured")
env(key=None)
check("no Supabase key is not_configured", aa.verify("a.b.admin") == "not_configured")
env(url="http://127.0.0.1:1")  # nothing listens on port 1
check("an unreachable Supabase is unavailable", aa.verify("a.b.admin") == "unavailable")

# --- caching ------------------------------------------------------------------

env()
aa.verify("a.b.admin")
n = CALLS["n"]
check("a second ask within the minute is served from cache", aa.verify("a.b.admin") == "ok" and CALLS["n"] == n)
aa.verify("a.b.member")
n = CALLS["n"]
check("a forbidden verdict is cached too", aa.verify("a.b.member") == "forbidden" and CALLS["n"] == n)
n = CALLS["n"]
aa.verify("a.b.boom")
aa.verify("a.b.boom")
check("a transient failure is NEVER cached", CALLS["n"] == n + 2, f"{CALLS['n'] - n} calls")
n = CALLS["n"]
aa.verify("a.b.stale")
aa.verify("a.b.stale")
check("an unauthorized verdict is not cached either", CALLS["n"] == n + 2)

aa.clear_cache()
for i in range(aa.CACHE_MAX + 50):
    aa._remember(f"k{i}", "ok")
check("the cache is bounded", len(aa._cache) <= aa.CACHE_MAX, str(len(aa._cache)))

check("every refusing verdict has a status", set(aa.STATUS) == {"unauthorized", "forbidden", "not_configured", "unavailable"})

srv.shutdown()
print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
