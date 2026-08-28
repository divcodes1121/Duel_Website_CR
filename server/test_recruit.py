"""Checks over the recruiter. No database, no network.

Both real sources are stubbed at their seams — `_get` for the CR API and
`tracking.bot_tracked_set` / `queued_tags` for the collection — because the
things worth pinning here are the DECISIONS (which season, who is skipped, when
the ceiling bites), and every one of them is reachable without a 43 GB file or a
token.

The queue itself is exercised for real, against a temp SQLite file, since
`bulk_request` is the one new write in the project and "it inserted" is not the
same claim as "it inserted once, idempotently, without moving requested_at".
"""

from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clash_data as cd  # noqa: E402
import recruit  # noqa: E402
import tracking  # noqa: E402


class Stub:
    """Swap module attributes for the duration of a `with`."""

    def __init__(self, module, **attrs):
        self.module, self.attrs, self.old = module, attrs, {}

    def __enter__(self):
        for k, v in self.attrs.items():
            self.old[k] = getattr(self.module, k)
            setattr(self.module, k, v)
        return self.module

    def __exit__(self, *exc):
        for k, v in self.old.items():
            setattr(self.module, k, v)
        return False


def board(n, start=1):
    return {
        "items": [{"tag": "#%s" % _tag(i), "rank": i}
                  for i in range(start, start + n)],
        "paging": {"cursors": {}},
    }


def _tag(i: int) -> str:
    """A tag in Supercell's 14-symbol alphabet, unique per i."""
    chars = "0289PYLQGRJCUV"
    out, n = "", i
    while len(out) < 6:
        out += chars[n % len(chars)]
        n //= len(chars)
    return out


# ---------------------------------------------------------------------------
# The season, which is the thing most likely to silently break
# ---------------------------------------------------------------------------

class SeasonDiscovery(unittest.TestCase):

    def test_the_newest_listed_season_is_used(self):
        calls = []

        def fake(path, **params):
            calls.append(path)
            if path == recruit.SEASONS_PATH:
                return 200, {"items": [{"id": "2026-05"}, {"id": "2026-07"},
                                       {"id": "2026-06"}]}
            return 200, board(1)

        with Stub(recruit, _get=fake):
            self.assertEqual(recruit.current_season(), "2026-07")

    def test_duplicate_season_ids_do_not_confuse_it(self):
        """The observed payload lists every id twice."""
        def fake(path, **params):
            if path == recruit.SEASONS_PATH:
                return 200, {"items": [{"id": "2026-07"}, {"id": "2026-07"},
                                       {"id": "2026-06"}, {"id": "2026-06"}]}
            return 200, board(1)

        with Stub(recruit, _get=fake):
            self.assertEqual(recruit.current_season(), "2026-07")

    def test_it_walks_back_when_the_newest_season_404s(self):
        """MEASURED 2026-08-28: the current calendar month answers 404 while
        the previous one serves a full board. The list can run ahead the same
        way, and stranding on it would be permanent and silent."""
        def fake(path, **params):
            if path == recruit.SEASONS_PATH:
                return 200, {"items": [{"id": "2026-07"}, {"id": "2026-08"}]}
            if "2026-08" in path:
                return 404, None
            return 200, board(1)

        with Stub(recruit, _get=fake):
            self.assertEqual(recruit.current_season(), "2026-07")

    def test_no_season_means_no_tags_rather_than_an_exception(self):
        with Stub(recruit, _get=lambda path, **p: (500, None)):
            self.assertIsNone(recruit.current_season())
            self.assertEqual(recruit.leaderboard_tags(10), [])

    def test_a_token_with_a_carriage_return_still_works(self):
        """REGRESSION, found in production on the first real run.

        /etc/royalweb.env is CRLF. systemd EnvironmentFile strips the trailing
        carriage return, so the SERVICE was always fine; sourcing the same file
        in a shell does not, and urllib refuses to send a header value holding
        one. Every call raised, current_season() returned None, and the run
        printed "fetched 0" with no reason anywhere. clash_data strips at the
        point of read so no consumer has to know.
        """
        import http.client
        import importlib
        dirty = "abc123" + chr(13)
        old = os.environ.get("CR_TOKEN")
        os.environ["CR_TOKEN"] = dirty
        try:
            importlib.reload(cd)
            self.assertEqual(cd.CR_TOKEN, "abc123")
            # Pin the ACTUAL mechanism. Request() does not validate --
            # http.client does, when the header is written -- which is why
            # this surfaced as a live network failure and not a bad argument.
            # putrequest/putheader buffer, so this needs no connection.
            def put(value):
                conn = http.client.HTTPConnection("example.invalid")
                conn.putrequest("GET", "/", skip_host=1,
                                skip_accept_encoding=1)
                conn.putheader("Authorization", "Bearer " + value)

            put(cd.CR_TOKEN)                      # the stripped one is fine
            with self.assertRaises(ValueError):   # the raw one never was
                put(dirty)
        finally:
            if old is None:
                os.environ.pop("CR_TOKEN", None)
            else:
                os.environ["CR_TOKEN"] = old
            importlib.reload(cd)

    def test_a_failed_call_records_why(self):
        """A recruiter that fetched nobody and one that could not ASK must not
        look the same -- which they did, in production, on the first run."""
        with Stub(cd, CR_TOKEN=""):
            recruit._get("/anything")
        self.assertIn("CR_TOKEN", recruit.last_error() or "")

    def test_a_missing_token_is_not_an_error(self):
        with Stub(cd, CR_TOKEN=""):
            status, data = recruit._get("/anything")
        self.assertEqual(status, "NOKEY")
        self.assertIsNone(data)


# ---------------------------------------------------------------------------
# The leaderboard read
# ---------------------------------------------------------------------------

class Leaderboard(unittest.TestCase):

    def test_it_pages_until_it_has_the_asked_for_count(self):
        pages = []

        def fake(path, **params):
            if path == recruit.SEASONS_PATH:
                return 200, {"items": [{"id": "2026-07"}]}
            pages.append(params)
            start = 1 + sum(1 for p in pages[:-1]) * 100
            d = board(100, start=start)
            d["paging"] = {"cursors": {"after": "cur%d" % len(pages)}}
            return 200, d

        with Stub(recruit, _get=fake, PAGE=100):
            tags = recruit.leaderboard_tags(250)
        self.assertEqual(len(tags), 250)
        self.assertEqual(len(set(tags)), 250, "tags must be unique")
        # The last page asks only for what is left, never a full page over.
        self.assertEqual(pages[-1]["limit"], 50)

    def test_it_stops_when_the_cursor_runs_out(self):
        def fake(path, **params):
            if path == recruit.SEASONS_PATH:
                return 200, {"items": [{"id": "2026-07"}]}
            return 200, board(40)          # no `after`

        with Stub(recruit, _get=fake):
            self.assertEqual(len(recruit.leaderboard_tags(2000)), 40)

    def test_an_empty_page_stops_it(self):
        """`/locations/global/rankings/players` answers 200 with zero items.
        A recruiter that loops on that never returns."""
        def fake(path, **params):
            if path == recruit.SEASONS_PATH:
                return 200, {"items": [{"id": "2026-07"}]}
            return 200, {"items": [], "paging": {"cursors": {"after": "x"}}}

        with Stub(recruit, _get=fake):
            self.assertEqual(recruit.leaderboard_tags(2000), [])

    def test_junk_tags_from_the_api_never_reach_the_queue(self):
        def fake(path, **params):
            if path == recruit.SEASONS_PATH:
                return 200, {"items": [{"id": "2026-07"}]}
            return 200, {"items": [{"tag": "#Y022GRCJQ"}, {"tag": "#####"},
                                   {"tag": ""}, {"tag": "#ZZZZZZ"}],
                         "paging": {"cursors": {}}}

        with Stub(recruit, _get=fake):
            tags = recruit.leaderboard_tags(10)
        self.assertEqual(tags, ["#Y022GRCJQ"])

    def test_tags_are_normalised(self):
        def fake(path, **params):
            if path == recruit.SEASONS_PATH:
                return 200, {"items": [{"id": "2026-07"}]}
            return 200, {"items": [{"tag": "y022grcjq"}],
                         "paging": {"cursors": {}}}

        with Stub(recruit, _get=fake):
            self.assertEqual(recruit.leaderboard_tags(10), ["#Y022GRCJQ"])


# ---------------------------------------------------------------------------
# The skip, which is the half the ask was actually about
# ---------------------------------------------------------------------------

class Skipping(unittest.TestCase):

    def enqueue(self, tags, tracked=(), queued=(), ceiling=100000, added=None):
        recorded = {}

        def bulk(ts, source):
            recorded["tags"] = list(ts)
            recorded["source"] = source
            return len(list(ts))

        with Stub(tracking,
                  bot_tracked_set=lambda: set(tracked),
                  queued_tags=lambda: set(queued),
                  bulk_request=bulk):
            out = recruit.enqueue(tags, "test", ceiling=ceiling)
        out["_written"] = recorded.get("tags", [])
        return out

    def test_an_already_tracked_tag_is_skipped(self):
        out = self.enqueue(["#A", "#B"], tracked=["#A"])
        self.assertEqual(out["_written"], ["#B"])
        self.assertEqual(out["skippedTracked"], 1)
        self.assertEqual(out["added"], 1)

    def test_an_already_queued_tag_is_skipped(self):
        out = self.enqueue(["#A", "#B"], queued=["#B"])
        self.assertEqual(out["_written"], ["#A"])
        self.assertEqual(out["skippedQueued"], 1)

    def test_a_converged_harvest_writes_nothing(self):
        """The steady state: every tag on the board is already collected."""
        out = self.enqueue(["#A", "#B", "#C"], tracked=["#A", "#B", "#C"])
        self.assertEqual(out["_written"], [])
        self.assertEqual(out["added"], 0)
        self.assertEqual(out["skippedTracked"], 3)

    def test_duplicates_within_one_batch_collapse(self):
        out = self.enqueue(["#A", "#A", "#B"])
        self.assertEqual(out["_written"], ["#A", "#B"])
        self.assertEqual(out["considered"], 2)

    def test_empties_are_dropped(self):
        out = self.enqueue(["#A", "", None])
        self.assertEqual(out["_written"], ["#A"])


# ---------------------------------------------------------------------------
# The ceiling
# ---------------------------------------------------------------------------

class Ceiling(unittest.TestCase):

    def enqueue(self, tags, tracked=(), queued=(), ceiling=10):
        return Skipping.enqueue(Skipping(), tags, tracked, queued, ceiling)

    def test_it_counts_queued_as_already_spent(self):
        """A queued tag is an enrolled tag that has not happened yet. Counting
        only `tracked` would let the queue run past the cap and breach it two
        hours later instead of now."""
        out = self.enqueue(["#A", "#B"],
                           queued=["#Q%d" % i for i in range(9)], ceiling=10)
        self.assertEqual(len(out["_written"]), 1)
        self.assertTrue(out["cappedByCeiling"])

    def test_a_full_collection_queues_nothing(self):
        out = self.enqueue(["#A"], tracked=["#T%d" % i for i in range(10)],
                           ceiling=10)
        self.assertEqual(out["_written"], [])
        self.assertTrue(out["cappedByCeiling"])
        self.assertEqual(out["added"], 0)

    def test_under_the_ceiling_nothing_is_capped(self):
        out = self.enqueue(["#A", "#B"], ceiling=1000)
        self.assertFalse(out["cappedByCeiling"])
        self.assertEqual(len(out["_written"]), 2)

    def test_it_truncates_rather_than_refusing_the_whole_batch(self):
        out = self.enqueue(["#A", "#B", "#C", "#D"],
                           queued=["#Q%d" % i for i in range(8)], ceiling=10)
        self.assertEqual(len(out["_written"]), 2)


# ---------------------------------------------------------------------------
# The queue write itself, for real
# ---------------------------------------------------------------------------

class BulkRequest(unittest.TestCase):

    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        os.remove(self.path)
        self._old = tracking.DB_PATH
        tracking.DB_PATH = self.path
        tracking._ready = False

    def tearDown(self):
        tracking.DB_PATH = self._old
        tracking._ready = False
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(self.path + suffix)
            except OSError:
                pass

    def test_it_inserts_and_reports_only_the_new_rows(self):
        self.assertEqual(tracking.bulk_request(["#A", "#B"], "leaderboard"), 2)
        self.assertEqual(tracking.bulk_request(["#B", "#C"], "leaderboard"), 1)
        self.assertEqual(tracking.queued_tags(), {"#A", "#B", "#C"})

    def test_it_is_idempotent(self):
        tracking.bulk_request(["#A"], "leaderboard")
        self.assertEqual(tracking.bulk_request(["#A"], "leaderboard"), 0)
        self.assertEqual(tracking.queue_depth(), 1)

    def test_requested_at_never_moves(self):
        """The bot drains oldest-first. Bumping this on a re-sighting starves a
        tag behind its own popularity — the same rule `request()` keeps."""
        tracking.bulk_request(["#A"], "leaderboard")
        first = tracking.status("#A")["requestedAt"]
        tracking.bulk_request(["#A"], "opponent")
        self.assertEqual(tracking.status("#A")["requestedAt"], first)

    def test_a_re_sighting_bumps_hits(self):
        tracking.bulk_request(["#A"], "leaderboard")
        tracking.bulk_request(["#A"], "opponent")
        self.assertEqual(tracking.status("#A")["hits"], 2)

    def test_an_empty_batch_is_a_no_op(self):
        self.assertEqual(tracking.bulk_request([], "leaderboard"), 0)
        self.assertEqual(tracking.bulk_request(["", None], "leaderboard"), 0)

    def test_a_queued_tag_reports_pending_not_tracked(self):
        with Stub(tracking, bot_tracked=lambda t: False):
            tracking.bulk_request(["#A"], "leaderboard")
            self.assertEqual(tracking.status("#A")["state"], "pending")


# ---------------------------------------------------------------------------
# Failure is a no-op, everywhere
# ---------------------------------------------------------------------------

class Resilience(unittest.TestCase):

    def test_no_database_means_no_opponents(self):
        with Stub(cd, resolve_db_path=lambda: None):
            self.assertEqual(recruit.opponent_tags(), [])

    def test_run_once_survives_a_failing_source(self):
        def boom(*a, **k):
            raise RuntimeError("nope")

        with Stub(recruit, leaderboard_tags=boom, opponent_tags=boom):
            report = recruit.run_once()
        self.assertEqual(report["leaderboard"]["error"], "RuntimeError")
        self.assertEqual(report["opponents"]["error"], "RuntimeError")

    def test_the_background_loop_stays_off_by_default(self):
        """It enrols players into a database with no backup. Same convention as
        CLASH_OIE: code that changes what the service costs ships dark."""
        self.assertEqual(os.getenv("CLASH_RECRUIT", "off"), "off")
        with Stub(recruit, ENABLED="off"):
            recruit.start_background()   # returns without starting a thread
            self.assertFalse(recruit.state()["enabled"])

    def test_state_carries_no_tags(self):
        """`/status` is unauthenticated. A list of who we decided to collect is
        a log of people, not a metric."""
        with Stub(recruit, ENABLED="off"):
            blob = repr(recruit.state())
        self.assertNotIn("#", blob)
        self.assertIn("ceiling", blob)


# ---------------------------------------------------------------------------
# The module is importable without touching anything it should not
# ---------------------------------------------------------------------------

class Boundaries(unittest.TestCase):

    def test_it_never_opens_the_bot_database_read_write(self):
        src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "recruit.py"), encoding="utf-8").read()
        self.assertNotIn("sqlite3.connect", src,
                         "the bot's databases go through cd.connect (mode=ro), "
                         "and our own file goes through tracking.py")
        self.assertNotIn("import sqlite3", src)
        # The CALL, not the word: the module docstring names
        # `clashdb.add_tracked_player` when explaining what the BOT does with
        # the queue, and a substring check on the bare name matches its own
        # prose. That is the whole reason this assertion was wrong first.
        self.assertNotIn("add_tracked_player(", src)

    def test_importing_it_starts_nothing(self):
        importlib.reload(recruit)
        self.assertEqual(recruit.state()["runs"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
