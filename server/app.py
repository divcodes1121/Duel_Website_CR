"""
app.py — the local analytics API.

Standard library only, on purpose: no pip install, nothing to build, and it
starts on any machine that has Python. It serves JSON over HTTP so the browser
talks to it exactly the way it will talk to a hosted API later — the migration
is a base-URL change, not a rewrite.

    python server/app.py            # http://127.0.0.1:8787

Endpoints
    GET /api/analytics/status              which databases are readable
    GET /api/analytics/suggest             a few real tags to click
    GET /api/analytics/player/<tag>        summary + decks + trends

Every handler answers 200 with a useful body or a JSON error; the drive being
unplugged is a normal state, not a failure.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clash_data as cd  # noqa: E402
import duel_combos as dcx  # noqa: E402
import meta as meta_board  # noqa: E402

HOST = os.getenv("CLASH_API_HOST", "127.0.0.1")
PORT = int(os.getenv("CLASH_API_PORT", "8787"))


def _window(q: dict, cov: dict) -> tuple[str | None, str | None]:
    """The (since, until) a request asks for.

    An explicit from/to wins; otherwise `days` counts back from the LAST BATTLE
    WE HOLD rather than from today. A player who stopped playing a month ago
    would otherwise be handed an empty screen and no explanation.
    """
    since = (q.get("from") or [""])[0] or None
    until = (q.get("to") or [""])[0] or None
    if not since and cov["end"]:
        import datetime as _dt

        days = max(1, min(4000, int((q.get("days") or ["30"])[0])))
        end = _dt.date.fromisoformat(cov["end"])
        since = (end - _dt.timedelta(days=days - 1)).isoformat()
        until = until or cov["end"]
    return since, until


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # Quiet: one line per request, not urllib's default noise.
    def log_message(self, fmt, *args):
        sys.stderr.write("  %s %s\n" % (self.command, self.path))

    def _send(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # The Vite dev server proxies to us, but allow direct calls too.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/analytics/status":
                return self._send(cd.sources())

            if path == "/api/analytics/meta":
                # Served from a background-computed snapshot: the underlying
                # scan takes ~45 s, so it must never run inside a request.
                # See the long note at the top of meta.py.
                return self._send(meta_board.board())

            if path == "/api/analytics/suggest":
                return self._send({"tags": cd.suggest_tags(5)})

            if path == "/api/analytics/coverage":
                q = parse_qs(parsed.query)
                raw = (q.get("tag") or [""])[0]
                tag = cd.normalize_tag(raw) if raw else None
                return self._send(
                    {"global": cd.coverage(), "player": cd.coverage(tag) if tag else None}
                )

            if path.startswith("/api/analytics/duels/"):
                raw = unquote(path[len("/api/analytics/duels/"):])
                tag = cd.normalize_tag(raw)
                if not tag:
                    return self._send({"error": "invalid_tag", "input": raw}, 400)

                cov = cd.coverage(tag)
                since, until = _window(parse_qs(parsed.query), cov)
                report = dcx.combo_report(tag, since, until)
                if not report:
                    return self._send({"error": "not_found", "tag": tag}, 404)
                report["coverage"] = cov
                report["window"] = {"from": since, "to": until}
                report["sources"] = cd.sources()
                return self._send(report)

            if path.startswith("/api/analytics/player/"):
                raw = unquote(path[len("/api/analytics/player/"):])
                tag = cd.normalize_tag(raw)
                if not tag:
                    return self._send({"error": "invalid_tag", "input": raw}, 400)

                cov = cd.coverage(tag)
                since, until = _window(parse_qs(parsed.query), cov)
                report = cd.player_report(tag, since, until)
                if not report:
                    return self._send({"error": "not_found", "tag": tag}, 404)

                return self._send(
                    {
                        "player": report["player"],
                        "decks": report["decks"][:10],
                        "trends": report["trends"],
                        "coverage": cov,
                        "window": {"from": since, "to": until},
                        "profile": cd.cr_profile(tag),
                        "sources": cd.sources(),
                    }
                )

            return self._send({"error": "not_found"}, 404)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            return self._send({"error": "server_error", "detail": str(exc)}, 500)


def main():
    src = cd.sources()
    print("Clash analytics API")
    print("  hot      :", src["hot"]["path"], "-", "OK" if src["hot"]["available"] else "MISSING")
    print(
        "  archive  :",
        src["archive"]["path"],
        "-",
        "OK" if src["archive"]["available"] else "not connected (hot tier only)",
    )
    print("  listening: http://%s:%d" % (HOST, PORT))
    # The meta leaderboard rolls up in the background from here on.
    meta_board.start_background()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
