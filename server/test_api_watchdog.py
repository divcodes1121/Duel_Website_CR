"""test_api_watchdog.py — the policy that decides when royalweb is restarted.

    python server/test_api_watchdog.py

The watchdog restarts a service on a production box, so what matters most is
when it must NOT: one slow answer, the bot's deliberate maintenance window, a
missing database file, or a restart that already happened minutes ago. The
probe itself is exercised against a real local HTTP server on an ephemeral
port. Nothing here calls systemd.
"""

from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import api_watchdog as wd  # noqa: E402

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ok  ", name)
    else:
        failed += 1
        print("  FAIL", name, detail)


OK = {"ok": True, "hot": True, "why": "answered"}
NO_DB = {"ok": True, "hot": False, "why": "answered"}
DOWN = {"ok": False, "hot": None, "why": "TimeoutError"}

print("what counts as a fault")
check("healthy reading is fine", wd.unhealthy(OK, True, False) is None)
check("no answer is a fault", wd.unhealthy(DOWN, True, False) is not None)
check("db unreadable while the file exists is a fault",
      wd.unhealthy(NO_DB, True, False) is not None)
check("db unreadable during the bot's maintenance window is NOT a fault",
      wd.unhealthy(NO_DB, True, True) is None)
check("db unreadable when there is no file is NOT a fault (nothing a restart fixes)",
      wd.unhealthy(NO_DB, False, False) is None)
check("an older API that does not report hot is fine",
      wd.unhealthy({"ok": True, "hot": None, "why": "answered"}, True, False) is None)

print("when it restarts")
a, s = wd.decide(None, {"bad": 1}, 1000)
check("a healthy reading clears the count", a == "healthy" and s["bad"] == 0, str(s))
a, s = wd.decide("x", {}, 1000)
check("ONE bad reading only watches", a == "watching" and s["bad"] == 1, a)
a, s = wd.decide("x", s, 1120)
check("the second in a row restarts", a == "restart", a)
check("a restart is recorded and resets the count",
      s.get("lastRestart") == 1120 and s["bad"] == 0 and s["restarts"] == 1, str(s))
a, s2 = wd.decide("x", s, 1240)
a, s2 = wd.decide("x", s2, 1360)
check("no second restart inside the gap", a == "holding", a)
a, s3 = wd.decide("x", dict(s2, bad=1), 1120 + wd.MIN_RESTART_GAP_S + 1)
check("after the gap it may restart again", a == "restart", a)
a, s4 = wd.decide("x", {"bad": 0}, 1000)
a, s4 = wd.decide(None, s4, 1120)
a, s4 = wd.decide("x", s4, 1240)
check("bad, good, bad is not two in a row", a == "watching", a)
orig = {"bad": 1}
wd.decide("x", orig, 5)
check("input state untouched", orig == {"bad": 1}, str(orig))


print("the probe, against a real server")
replies = {"code": 200, "body": {"hot": {"available": True}}}


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(replies["body"]).encode()
        self.send_response(replies["code"])
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_address[1]}/api/analytics/status"
try:
    r = wd.probe(url, 5)
    check("a healthy API reads ok with hot", r["ok"] and r["hot"] is True, str(r))
    replies["body"] = {"hot": {"available": False}}
    r = wd.probe(url, 5)
    check("hot false is read as hot false", r["ok"] and r["hot"] is False, str(r))
    replies["code"] = 503
    r = wd.probe(url, 5)
    check("a 503 is no answer", not r["ok"] and "503" in r["why"], str(r))
finally:
    srv.shutdown()
r = wd.probe(url, 2)
check("a closed port is no answer", not r["ok"], str(r))

print("state survives a write and a bad file")
import tempfile  # noqa: E402

p = os.path.join(tempfile.mkdtemp(), "sub", "state.json")
wd._save_state({"bad": 1, "lastRestart": 7}, p)
check("state round-trips", wd._load_state(p) == {"bad": 1, "lastRestart": 7})
with open(p, "w") as f:
    f.write("{not json")
check("a corrupt state file reads as empty, not a crash", wd._load_state(p) == {})

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
