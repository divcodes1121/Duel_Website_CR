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

import json
import os
import sys
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
import tracking  # noqa: E402

HOST = os.getenv("CLASH_API_HOST", "127.0.0.1")
PORT = int(os.getenv("CLASH_API_PORT", "8787"))


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
                report["sources"] = cd.sources()
                # A player with no duels is a real answer, not a 404 — the
                # screen says "no duels in this window" rather than erroring.
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
                out = coach.predict(tag, revealed)
                out["sources"] = cd.sources()
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
                out = coach.suggest(me, opp, _decks(q, ("m1", "m2")),
                                    _decks(q, ("o1", "o2")))
                out["sources"] = cd.sources()
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
                report["sources"] = cd.sources()
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
                    rep["sources"] = cd.sources()
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
    counter.start_background()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
