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
    GET /api/analytics/duels/<tag>         card combinations in duel play
    GET /api/analytics/duelzone/<tag>      duel series log + deck sequence
    GET /api/analytics/cards/<tag>         per-card use/win rates for a player
    GET /api/analytics/counter/<tag>       how a player is beaten, and by what
    GET /api/analytics/deck?cards=         how one pasted deck draws (slots + art)
    GET /api/analytics/matchup?a=&b=       head-to-head for two pasted decks
    GET /api/analytics/counters?deck=      what beats a pasted deck
    GET /api/analytics/coach/predict/<tag> which decks they will bring next
    GET /api/analytics/coach/suggest       what to play, given both tags
    GET /api/analytics/meta                the global leaderboard (snapshot)
    GET /api/analytics/meta/cards          global use/win rate per card, by form
    GET /api/analytics/live/<tag>          the live battlelog, analysed
    GET /api/analytics/track/<tag>         enrol the tag; report its state
    GET /api/analytics/track/pending       tags queued but not yet enrolled

Every handler answers 200 with a useful body or a JSON error; the drive being
unplugged is a normal state, not a failure.
"""

from __future__ import annotations

import hmac
import json
import os
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clash_data as cd  # noqa: E402
import duel_combos as dcx  # noqa: E402
import duel_zone as dz  # noqa: E402
import player_cards as pcards  # noqa: E402
import deck_counter as counter  # noqa: E402
import meta as meta_board  # noqa: E402
import coach  # noqa: E402
import live_player as live  # noqa: E402
import recent_battles as battles  # noqa: E402
import tracking  # noqa: E402
import recruit  # noqa: E402

HOST = os.getenv("CLASH_API_HOST", "127.0.0.1")
PORT = int(os.getenv("CLASH_API_PORT", "8787"))

# ── Security boundary (Phase 24C, step 2) ────────────────────────────────
#
# This process stays bound to loopback and is never exposed directly; what
# reaches it from outside arrives through an authenticated proxy. These
# controls are the last line rather than the only one, and they exist because
# "it only listens on 127.0.0.1" stops being a control the moment a tunnel is
# pointed at it.
#
# WHY LOOPBACK IS NOT TREATED AS TRUSTED: a Cloudflare tunnel runs `cloudflared`
# on THIS machine and dials 127.0.0.1, so every tunnelled request arrives with a
# loopback peer address. An exemption for local clients would wave through
# precisely the traffic that most needs authenticating.
API_KEY = os.getenv("CLASH_API_KEY", "")

# The local-development escape hatch, off by default so a missing key fails
# closed. It has to be TYPED: a developer who is merely inconvenienced invents
# a placeholder key instead, and a placeholder key looks like security from the
# outside while being none.
ALLOW_ANONYMOUS = os.getenv("CLASH_API_ALLOW_ANONYMOUS", "") == "1"

# One exact origin, or none at all. No wildcard, no pattern, no list.
ALLOWED_ORIGIN = os.getenv("CLASH_ALLOWED_ORIGIN", "")

RATE_LIMIT = max(1, int(os.getenv("CLASH_RATE_LIMIT", "120") or "120"))
RATE_WINDOW = max(1, int(os.getenv("CLASH_RATE_WINDOW", "60") or "60"))

# Whether to believe `X-Forwarded-For`. Off by default: anyone who can reach
# this port can also set that header, so honouring it unconditionally hands the
# rate limiter's key to the caller it is meant to limit.
TRUSTED_PROXY = os.getenv("CLASH_TRUSTED_PROXY", "") == "1"

#: The only route that answers without a key: the health check, which reports
#: which databases are readable and nothing whatever about any player.
PUBLIC_PATHS = frozenset({"/api/analytics/status"})

#: Request headers a cross-origin caller may send. This used to be `*`, which
#: pre-authorises every header a browser is willing to attach.
ALLOWED_HEADERS = "Authorization, Content-Type, X-Analytics-Key"

LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")


class RateLimiter:
    """Fixed-window per-client counter: deterministic, bounded, thread-safe.

    Fixed windows rather than a sliding log because the state per client is one
    integer instead of a list of timestamps, and because the verdict for a given
    (client, clock) is the same every time — which is what makes it testable
    without sleeping.

    The table is capped. A spray of one request each from many addresses is the
    normal shape of abuse here, and it is exactly the shape that grows an
    uncapped table until the process dies.
    """

    def __init__(self, limit: int, window: int, max_clients: int = 4096):
        self.limit = limit
        self.window = window
        self.max_clients = max_clients
        self._hits: dict = {}          # client -> (window index, count)
        self._lock = threading.Lock()

    def allow(self, client: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        slot = int(now // self.window)
        with self._lock:
            entry = self._hits.get(client)
            if entry is None:
                if len(self._hits) >= self.max_clients:
                    self._evict(slot)
                self._hits[client] = (slot, 1)
                return True
            bucket, count = entry
            if bucket != slot:                 # a new window; start it over
                self._hits[client] = (slot, 1)
                return True
            if count >= self.limit:
                return False
            self._hits[client] = (bucket, count + 1)
            return True

    def _evict(self, slot: int) -> None:
        """Caller holds the lock. Finished windows first; if that frees nothing,
        drop the oldest half, so the cap is a real bound and not a hope."""
        for c in [c for c, (b, _) in self._hits.items() if b != slot]:
            del self._hits[c]
        if len(self._hits) >= self.max_clients:
            oldest = sorted(self._hits, key=lambda c: self._hits[c][0])
            for c in oldest[: max(1, self.max_clients // 2)]:
                del self._hits[c]


class Metrics:
    """Request counters and a bounded latency sample.

    Deliberately records nothing per-player. A metric keyed by route would carry
    the tag in the path, and a tally of who was looked up is not a metric, it is
    a log of people.
    """

    SAMPLE = 512

    def __init__(self):
        self._lock = threading.Lock()
        self.counts = {"total": 0, "ok": 0, "auth_failed": 0, "rate_limited": 0,
                       "client_error": 0, "server_error": 0}
        self._latency: list = []

    def record(self, outcome: str, ms: float) -> None:
        with self._lock:
            self.counts["total"] += 1
            if outcome in self.counts:
                self.counts[outcome] += 1
            self._latency.append(ms)
            if len(self._latency) > self.SAMPLE:
                del self._latency[: len(self._latency) - self.SAMPLE]

    def snapshot(self) -> dict:
        with self._lock:
            out = dict(self.counts)
            lat = sorted(self._latency)

        def pct(p):
            if not lat:
                return None
            i = min(len(lat) - 1, int(round((p / 100.0) * (len(lat) - 1))))
            return round(lat[i], 1)

        out["latencyMs"] = {"p50": pct(50), "p95": pct(95), "p99": pct(99),
                            "samples": len(lat)}
        return out


LIMITER = RateLimiter(RATE_LIMIT, RATE_WINDOW)
METRICS = Metrics()


def metrics_snapshot() -> dict:
    """Counters for step 7 to surface. Not on any route yet."""
    return METRICS.snapshot()


def presented_key(headers) -> str:
    """The key the caller sent, from either accepted carrier."""
    raw = headers.get("X-Analytics-Key") or ""
    if not raw:
        auth = headers.get("Authorization") or ""
        if auth[:7].lower() == "bearer ":
            raw = auth[7:]
    return raw.strip()


def check_auth(path: str, headers) -> str:
    """'' when the request may proceed, otherwise a short reason code.

    The comparison is `hmac.compare_digest` on bytes, so a wrong key costs the
    same time as a right one and cannot be recovered a byte at a time. Bytes
    rather than str because `compare_digest` refuses non-ASCII strings, and a
    key containing one would otherwise raise instead of failing.
    """
    if path in PUBLIC_PATHS:
        return ""
    if not API_KEY:
        # Fail closed. Not configured is not the same as not required.
        return "" if ALLOW_ANONYMOUS else "auth_not_configured"
    sent = presented_key(headers)
    if not sent:
        return "unauthorized"
    if not hmac.compare_digest(sent.encode("utf-8"), API_KEY.encode("utf-8")):
        return "unauthorized"
    return ""


def refuse_unsafe_bind() -> str:
    """'' when this host/auth combination is safe to start with.

    Serving with no key on a non-loopback interface cannot be a deliberate
    local-dev choice, so it stops the process instead of printing one more
    warning into a scrollback nobody reads.
    """
    if HOST not in LOOPBACK_HOSTS and not API_KEY:
        return ("refusing to start: CLASH_API_HOST=%s is not loopback and "
                "CLASH_API_KEY is not set" % HOST)
    return ""


def security_banner() -> list:
    """The boundary lines main() prints. Returned rather than printed so a test
    can assert the warning actually appears."""
    out = []
    if API_KEY:
        out.append("  auth     : ON (CLASH_API_KEY set, %d chars)" % len(API_KEY))
    elif ALLOW_ANONYMOUS:
        out.append("  auth     : *** DISABLED (CLASH_API_ALLOW_ANONYMOUS=1) ***")
        out.append("             Local development only. Do NOT place this")
        out.append("             process behind a tunnel or proxy in this state.")
    else:
        out.append("  auth     : *** NO CLASH_API_KEY SET ***")
        out.append("             Every route except /api/analytics/status will")
        out.append("             answer 503. Authenticated routes cannot safely")
        out.append("             be exposed without a key.")
        out.append("             Set CLASH_API_KEY=<secret>, or")
        out.append("             CLASH_API_ALLOW_ANONYMOUS=1 for local dev.")
    out.append("  origin   : %s" % (ALLOWED_ORIGIN or "(none set - no CORS headers sent)"))
    out.append("  ratelimit: %d requests / %d s per client" % (RATE_LIMIT, RATE_WINDOW))
    return out


def _sources() -> dict:
    """`cd.sources()` with the filesystem paths removed.

    `/api/analytics/status` is the only route that answers without a key, and
    the raw form of this reports the absolute path and exact byte size of both
    SQLite volumes — a free inventory of the host's drives to anyone who can
    reach the port. The UI reads `available` and nothing else, so redacting the
    path costs nothing downstream. The operator still sees the real paths, on
    stderr at startup, which is where they are useful.
    """
    return {tier: {"available": v["available"], "sizeBytes": v["sizeBytes"]}
            for tier, v in cd.sources().items()}


def _enrol(tag: str) -> dict:
    """Queue a searched tag for collection, and report where it stands.

    Only tags the bot is NOT already polling are queued — `request()` is
    idempotent, but skipping the write for the ~1,460 already-tracked players
    keeps our queue to what it is for, which is the backlog someone still has
    to act on.

    Never raises. Enrolment is a side effect of looking at a screen, so a
    failure here must not be able to take the screen down with it.
    """
    try:
        st = tracking.status(tag)
        if not st["tracked"] and not st["requested"]:
            tracking.request(tag, "search")
            st = tracking.status(tag)
        return st
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return {"tag": tag, "state": "unknown", "tracked": False, "requested": False}


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


def _decks(q: dict, keys: tuple) -> list[list[str]]:
    """The decks already played this duel, in order, from `r1`/`r2`-style params.

    A gap ends the list rather than being skipped: "deck 2 but no deck 1" is not
    a duel state that exists, and silently treating it as "one deck played"
    would answer a different question from the one asked.
    """
    out = []
    for k in keys:
        cards = [c for c in (q.get(k) or [""])[0].split(",") if c]
        if not cards:
            break
        out.append(cards)
    return out


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # Quiet: one line per request, not urllib's default noise.
    def log_message(self, fmt, *args):
        sys.stderr.write("  %s %s\n" % (self.command, self.path))

    #: Set by `_send` so `do_GET` can classify the outcome without every
    #: handler having to report one.
    _status = 200

    def _cors(self):
        """Echo the one configured origin, or send no CORS headers at all.

        `Vary: Origin` matters even though only one origin is ever echoed:
        without it a shared cache can hand the allowed origin's response,
        headers included, to a different one.
        """
        origin = self.headers.get("Origin") or ""
        if ALLOWED_ORIGIN and origin == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
            self.send_header("Vary", "Origin")

    def _send(self, obj, status=200, retry_after=None):
        self._status = status
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        if retry_after is not None:
            self.send_header("Retry-After", str(retry_after))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        """Preflight.

        Answered without a key on purpose: a browser never attaches credentials
        to a preflight, and the preflight carries no data. The GET that follows
        is authenticated exactly like any other. An unknown origin gets 403 and
        no CORS headers, so there is nothing to reflect back.
        """
        origin = self.headers.get("Origin") or ""
        if not ALLOWED_ORIGIN or origin != ALLOWED_ORIGIN:
            self.send_response(403)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", ALLOWED_HEADERS)
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _client(self) -> str:
        """The address rate limiting counts against."""
        if TRUSTED_PROXY:
            fwd = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
            if fwd:
                return fwd
        return self.client_address[0] if self.client_address else "?"

    def _gate(self, path: str) -> bool:
        """True when the request may proceed to routing.

        Authentication first, then the limiter: an unauthenticated caller must
        not be able to spend another caller's budget.
        """
        reason = check_auth(path, self.headers)
        if reason:
            self._outcome = "auth_failed"
            # 503 when the SERVER is misconfigured, 401 when the CALLER is
            # wrong. One status for both sends an operator whose key is missing
            # off to debug a client that is behaving perfectly.
            self._send({"error": reason},
                       503 if reason == "auth_not_configured" else 401)
            return False
        if path not in PUBLIC_PATHS and not LIMITER.allow(self._client()):
            self._outcome = "rate_limited"
            self._send({"error": "rate_limited"}, 429, retry_after=RATE_WINDOW)
            return False
        return True

    def do_GET(self):
        """The security gate. Routing itself is `_route`, unchanged below."""
        self._outcome = ""
        self._status = 200
        started = time.perf_counter()
        try:
            if self._gate(urlparse(self.path).path):
                self._route()
        except Exception:  # noqa: BLE001
            self._outcome = "server_error"
            traceback.print_exc()
            try:
                self._send({"error": "server_error"}, 500)
            except Exception:  # noqa: BLE001
                pass  # the socket is already gone; nothing left to say on it
        finally:
            outcome = self._outcome
            if not outcome:
                outcome = ("server_error" if self._status >= 500 else
                           "client_error" if self._status >= 400 else "ok")
            METRICS.record(outcome, (time.perf_counter() - started) * 1000.0)

    def _route(self):
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/analytics/status":
                # `cardData` rides along because a database that opens is not
                # the same as a service that can answer. The card reference
                # files went missing on the VPS deploy and every screen kept
                # returning 200 with confident, wrong numbers — this is the one
                # unauthenticated probe, so it is where "can this service
                # actually answer" belongs. Booleans and a count, no paths.
                out = _sources()
                out["cardData"] = dcx.card_data_state()
                # Counts only, never tags — see `recruit.state()`. It rides on
                # `/status` for the same reason `cardData` does: "the recruiter
                # is enabled but has never completed a run" is invisible from
                # every other angle, and this is the probe an operator checks.
                out["recruit"] = recruit.state()
                return self._send(out)

            if path == "/api/analytics/meta":
                # Served from a background-computed snapshot: the underlying
                # scan takes ~45 s, so it must never run inside a request.
                # See the long note at the top of meta.py.
                return self._send(meta_board.board())

            # The global card board. Same snapshot as the deck board — the card
            # tallies fall out of the scan it already runs — so this is as cheap
            # as /meta and can never describe a different window from it.
            # Checked BEFORE the per-player `/cards/<tag>` prefix below.
            if path == "/api/analytics/meta/cards":
                return self._send(meta_board.card_board())

            if path == "/api/analytics/suggest":
                return self._send({"tags": cd.suggest_tags(5)})

            if path == "/api/analytics/coverage":
                q = parse_qs(parsed.query)
                raw = (q.get("tag") or [""])[0]
                tag = cd.normalize_tag(raw) if raw else None
                # HOW MANY PLAYERS THE BOT IS COLLECTING. It rides here rather
                # than on `/status` because `/status` is the one route that
                # answers without a key, and the size of the collection is a
                # scale figure about the service rather than a health signal --
                # the same reason the volume paths and byte sizes were taken
                # out of it. This route needs the key.
                return self._send(
                    {
                        "global": cd.coverage(),
                        "player": cd.coverage(tag) if tag else None,
                        "trackedPlayers": cd.tracked_player_count(),
                    }
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
                report["sources"] = _sources()
                return self._send(report)

            if path.startswith("/api/analytics/duelzone/"):
                raw = unquote(path[len("/api/analytics/duelzone/"):])
                tag = cd.normalize_tag(raw)
                if not tag:
                    return self._send({"error": "invalid_tag", "input": raw}, 400)

                q = parse_qs(parsed.query)
                cov = cd.coverage(tag)
                since, until = _window(q, cov)
                # No cap by default: the window the caller picked decides how
                # much there is. `?limit=N` is still there for a caller that
                # wants a preview rather than the lot.
                raw_limit = (q.get("limit") or [""])[0]
                limit = max(1, int(raw_limit)) if raw_limit.isdigit() else None
                report = dz.report(tag, since, until, limit)
                report["coverage"] = cov
                report["window"] = {"from": since, "to": until}
                report["sources"] = _sources()
                # A player with no duels is a real answer, not a 404 — the
                # screen says "no duels in this window" rather than erroring.
                return self._send(report)

            if path.startswith("/api/analytics/battles/"):
                raw = unquote(path[len("/api/analytics/battles/"):])
                tag = cd.normalize_tag(raw)
                if not tag:
                    return self._send({"error": "invalid_tag", "input": raw}, 400)

                q = parse_qs(parsed.query)
                cov = cd.coverage(tag)
                since, until = _window(q, cov)
                # Paged on the server: the window decides the pool, the page
                # decides what crosses the wire. Non-numeric input falls back
                # to the defaults rather than erroring — the page number comes
                # from a URL a reader can edit.
                raw_page = (q.get("page") or [""])[0]
                raw_per = (q.get("per") or [""])[0]
                report = battles.report(
                    tag,
                    since,
                    until,
                    int(raw_page) if raw_page.isdigit() else 1,
                    int(raw_per) if raw_per.isdigit() else battles.PER_PAGE,
                )
                report["coverage"] = cov
                report["window"] = {"from": since, "to": until}
                report["sources"] = _sources()
                # A player with no battles in the window is a real answer, not
                # a 404 — the screen says so and keeps its date control.
                return self._send(report)

            if path == "/api/analytics/matchup":
                q = parse_qs(parsed.query)
                a = [c for c in (q.get("a") or [""])[0].split(",") if c]
                b = [c for c in (q.get("b") or [""])[0].split(",") if c]
                if not a or not b:
                    return self._send({"error": "two_decks_required"}, 400)
                wa = (q.get("wildA") or [""])[0] or None
                wb = (q.get("wildB") or [""])[0] or None
                wa = wa if wa in ("evolution", "hero") else None
                wb = wb if wb in ("evolution", "hero") else None
                out = counter.deck_vs_deck(a, b, wa, wb)
                out["status"] = counter.status()
                return self._send(out)

            # Just "how does this deck draw" — no matchup, no matrix. The paste
            # box calls it on every recognised link so the cards appear in their
            # real slots straight away instead of rearranging on Compare.
            if path == "/api/analytics/deck":
                q = parse_qs(parsed.query)
                deck = [c for c in (q.get("cards") or [""])[0].split(",") if c]
                if not deck:
                    return self._send({"error": "deck_required"}, 400)
                wild = (q.get("wild") or [""])[0] or None
                if wild not in (None, "evolution", "hero"):
                    wild = None
                return self._send(counter.draw_deck(deck, wild))

            # ── Coach Assist ──────────────────────────────────────────────
            # Both windows are STEPWISE, so each answer is its own request and
            # the client holds the flow state. Revealed decks arrive as `r1`/
            # `r2` (prediction) and `m1`/`m2` + `o1`/`o2` (suggestion), each a
            # comma-separated card list — the same encoding the matchup and
            # counters endpoints already use, rather than a second one.
            if path.startswith("/api/analytics/coach/predict/"):
                raw = unquote(path[len("/api/analytics/coach/predict/"):])
                tag = cd.normalize_tag(raw)
                if not tag:
                    return self._send({"error": "invalid_tag", "input": raw}, 400)
                q = parse_qs(parsed.query)
                revealed = _decks(q, ("r1", "r2"))
                # WINDOWED like every other player screen, and through the same
                # `_window` helper -- so `days` counts back from this player's
                # last stored battle rather than from today, and one convention
                # covers the whole API.
                since, until = _window(q, cd.coverage(tag))
                out = coach.predict(tag, revealed, since, until)
                out["sources"] = _sources()
                return self._send(out)

            # PHASE 19B — the opponent read is a SEPARATE request on purpose.
            # It used to be attached to /coach/predict, which made the whole
            # screen wait on a cold spinning-disk read (up to ~2.5 s p95) for a
            # purely additive enhancement. The deck now renders from /predict
            # and the client fetches this afterwards; if it is slow, fails, or
            # is disabled, the Coach is unaffected.
            if path.startswith("/api/analytics/coach/opponent-read/"):
                raw = unquote(path[len("/api/analytics/coach/opponent-read/"):])
                tag = cd.normalize_tag(raw)
                if not tag:
                    return self._send({"error": "invalid_tag", "input": raw}, 400)
                return self._send(coach.opponent_read(tag))

            if path == "/api/analytics/coach/suggest":
                q = parse_qs(parsed.query)
                me = cd.normalize_tag((q.get("me") or [""])[0])
                if not me:
                    return self._send({"error": "invalid_tag",
                                       "input": (q.get("me") or [""])[0]}, 400)
                # The opponent is optional: without a tag the read falls back to
                # meta decks and says so, which is a weaker answer rather than
                # no answer.
                opp = cd.normalize_tag((q.get("opp") or [""])[0]) or ""
                # ONE `days`, TWO WINDOWS. The span is resolved per tag against
                # that player's own coverage, so "30 days" means thirty days of
                # each player's play rather than one calendar range that may be
                # empty for whichever of them stopped playing sooner.
                my_since, my_until = _window(q, cd.coverage(me))
                opp_since, opp_until = (_window(q, cd.coverage(opp)) if opp
                                        else (None, None))
                out = coach.suggest(me, opp, _decks(q, ("m1", "m2")),
                                    _decks(q, ("o1", "o2")),
                                    my_since, my_until, opp_since, opp_until)
                out["sources"] = _sources()
                return self._send(out)

            if path == "/api/analytics/counters":
                q = parse_qs(parsed.query)
                deck = [c for c in (q.get("deck") or [""])[0].split(",") if c]
                if not deck:
                    return self._send({"error": "deck_required"}, 400)
                w = (q.get("wild") or [""])[0] or None
                out = counter.find_counters(deck, w if w in ("evolution", "hero") else None)
                out["status"] = counter.status()
                return self._send(out)

            if path.startswith("/api/analytics/counter/"):
                raw = unquote(path[len("/api/analytics/counter/"):])
                tag = cd.normalize_tag(raw)
                if not tag:
                    return self._send({"error": "invalid_tag", "input": raw}, 400)
                q = parse_qs(parsed.query)
                cov = cd.coverage(tag)
                since, until = _window(q, cov)
                out = counter.player_counter(tag, since, until)
                out["coverage"] = cov
                out["window"] = {"from": since, "to": until}
                out["status"] = counter.status()
                return self._send(out)

            if path.startswith("/api/analytics/cards/"):
                raw = unquote(path[len("/api/analytics/cards/"):])
                tag = cd.normalize_tag(raw)
                if not tag:
                    return self._send({"error": "invalid_tag", "input": raw}, 400)

                q = parse_qs(parsed.query)
                cov = cd.coverage(tag)
                since, until = _window(q, cov)
                mode = (q.get("mode") or ["all"])[0]
                report = pcards.card_board(tag, since, until, mode)
                report["coverage"] = cov
                report["window"] = {"from": since, "to": until}
                report["sources"] = _sources()
                return self._send(report)

            # Queued tags the bot has not enrolled yet. Checked BEFORE the
            # `/track/<tag>` prefix below, since "pending" is not a valid tag.
            if path == "/api/analytics/track/pending":
                return self._send({"pending": tracking.pending()})

            if path.startswith("/api/analytics/track/"):
                raw = unquote(path[len("/api/analytics/track/"):])
                tag = cd.normalize_tag(raw)
                if not tag:
                    return self._send({"error": "invalid_tag", "input": raw}, 400)
                return self._send(_enrol(tag))

            if path.startswith("/api/analytics/live/"):
                raw = unquote(path[len("/api/analytics/live/"):])
                tag = cd.normalize_tag(raw)
                if not tag:
                    return self._send({"error": "invalid_tag", "input": raw}, 400)
                rep = live.report(tag)
                if rep is None:
                    # The API could not be reached — no token, no network, or a
                    # rate limit. Distinct from a player with no recent battles,
                    # which comes back as a real report with `battles: 0`.
                    return self._send(
                        {"error": "live_unavailable", "tag": tag}, 503
                    )
                rep["tracking"] = _enrol(tag)
                rep["profile"] = cd.cr_profile(tag)
                return self._send(rep)

            if path.startswith("/api/analytics/player/"):
                raw = unquote(path[len("/api/analytics/player/"):])
                tag = cd.normalize_tag(raw)
                if not tag:
                    return self._send({"error": "invalid_tag", "input": raw}, 400)

                cov = cd.coverage(tag)
                since, until = _window(parse_qs(parsed.query), cov)
                report = cd.player_report(tag, since, until)

                # SEARCHING A TAG IS WHAT ENROLS IT. Idempotent, and it queues
                # into a file this project owns rather than writing to the bot's
                # database — see tracking.py for why that distinction is the
                # whole design.
                enrolment = _enrol(tag)

                if not report:
                    # Nobody has ever tracked this player, so there is nothing
                    # stored to report on. Rather than a dead screen, answer
                    # from the live battlelog: it is real data about the right
                    # player, it is clearly labelled `basis: "live"`, and the
                    # stored history takes over once the bot catches up.
                    rep = live.report(tag)
                    if rep is None:
                        return self._send(
                            {"error": "not_found", "tag": tag, "tracking": enrolment},
                            404,
                        )
                    rep["tracking"] = enrolment
                    rep["profile"] = cd.cr_profile(tag)
                    rep["coverage"] = cov
                    rep["sources"] = _sources()
                    return self._send(rep)

                return self._send(
                    {
                        "basis": "stored",
                        "player": report["player"],
                        "decks": report["decks"][:10],
                        "trends": report["trends"],
                        "coverage": cov,
                        "window": {"from": since, "to": until},
                        "profile": cd.cr_profile(tag),
                        "tracking": enrolment,
                        "sources": _sources(),
                    }
                )

            return self._send({"error": "not_found"}, 404)
        except Exception:  # noqa: BLE001
            # The traceback goes to stderr, where the operator is. It does NOT
            # go in the body: `str(exc)` for a database failure is an absolute
            # path to the H: volume, and for a decode failure it is a slice of
            # whatever was being parsed.
            traceback.print_exc()
            self._outcome = "server_error"
            return self._send({"error": "server_error"}, 500)


def main():
    unsafe = refuse_unsafe_bind()
    if unsafe:
        print(unsafe, file=sys.stderr)
        raise SystemExit(2)
    src = cd.sources()
    print("Clash analytics API")
    print("  hot      :", src["hot"]["path"], "-", "OK" if src["hot"]["available"] else "MISSING")
    print(
        "  archive  :",
        src["archive"]["path"],
        "-",
        "OK" if src["archive"]["available"] else "not connected (hot tier only)",
    )
    for line in security_banner():
        print(line)
    print("  listening: http://%s:%d" % (HOST, PORT))
    # The meta leaderboard rolls up in the background from here on.
    meta_board.start_background()
    counter.start_background()
    # No-op unless CLASH_RECRUIT=on. It enrols players, which is what the
    # database costs money to hold, so it ships dark like CLASH_OIE.
    recruit.start_background()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
