"""How a tag gets into the collection without anyone searching for it.

Two sources, one sink, and no new way to write anything.

    top 2000 of ranked  ─┐
                         ├─> tag_requests ──> the bot's drain ──> tracked_players
    opponents we met    ─┘   (tracking.py)     (bot.py:5030)

THE SINK IS THE POINT. `tracking.py` explains at length why this service does
not INSERT into the bot's `tracked_players` — every database the bot owns is
opened `mode=ro`, and that guarantee is worth more than the one statement it
would save. Nothing here changes that. Both recruiters end at
`tracking.bulk_request()`, which writes to `server/.tracking.db`, our own file;
the bot's `drain_tag_requests()` picks the tags up at the top of its next poll,
validates each one through `clashdb.add_tracked_player`, and skips anything it
is already collecting. That skip is the "same tag does nothing" half of this,
and it already existed — this module only has to stop putting known tags in
front of it.

So there is NO bot edit here, and that is deliberate rather than lucky: the bot
runs as a live process on the VPS with one backup, and a feature that can be
built entirely on this side of the queue should be.

THE SKIP HAPPENS THREE TIMES, on purpose:

  1. here, against `tracked_players` — so we do not queue what is collected
  2. here, against `tag_requests`   — so we do not requeue what is waiting
  3. in the bot's drain             — because (1) is a snapshot, and a tag can
                                      be enrolled between our read and its

Only (3) is load-bearing for correctness. (1) and (2) exist so the queue stays
the size of the work actually outstanding: without them a two-hourly harvest
rewrites the same two thousand rows forever, and `PRUNE_ABOVE` — which is what
stops the drain's oldest-first LIMIT from freezing behind finished rows — is
tuned for a queue of searches, not of a leaderboard.

WHAT THIS COSTS, WHICH IS THE REASON FOR THE CEILING
----------------------------------------------------
Every tag enrolled here is a player the bot polls every two hours, forever,
into a database on retention of 304 days. The measured figure in the root
README is ~105 GB at steady state for 3,278 tracked players — call it ~32 MB
per player per year of retention. The top 2000 is therefore a known, bounded
~64 GB; opponent harvesting is NOT bounded by anything in its own definition,
because every player polled produces up to 25 more opponents every two hours.
Left open it does not grow the collection, it detonates it.

There is also, today, **no backup of the VPS database** — the root README calls
that the largest single exposure on the project. Tripling the thing that is not
backed up is not a decision this module gets to make quietly, so:

  * `CEILING` caps tracked + queued outright. Past it recruiting stops and says
    so; it does not trim silently to fit.
  * opponents need `OPP_MIN_SIGHTINGS` before they count as anything. Met once
    in two days is a stranger; met twice is somebody playing in the same water.
  * `OPP_MAX` caps how many new opponents one run may add, so growth per day
    has a stated maximum instead of an emergent one.
  * the background loop is **off unless `CLASH_RECRUIT=on`**. Same convention
    as `CLASH_OIE=off`: code that changes what the service costs ships dark and
    is turned on by someone who has read what it costs. The functions run on
    demand from the CLI at the bottom of this file regardless.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import clash_data as cd
import tracking

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

#: `off` (default) / `on`. Only the background loop reads this.
ENABLED = os.getenv("CLASH_RECRUIT", "off").strip().lower()

#: Seconds between background runs. Two hours by default because that is the
#: bot's poll interval — running more often cannot produce more opponents, it
#: can only rescan the same battles.
REFRESH_SECONDS = int(os.getenv("CLASH_RECRUIT_REFRESH", "7200"))

#: How many ranked players to take. 2000 is the ask; the endpoint serves it.
TOP_N = int(os.getenv("CLASH_RECRUIT_TOP", "2000"))

#: Rankings page size. `limit=2000` was measured returning 2000 in one request,
#: so this could be one call — it pages anyway because a server-side cap on
#: `limit` is exactly the kind of thing that changes without notice, and the
#: cursor path is already proven (4 x 500 in 14.1 s).
PAGE = int(os.getenv("CLASH_RECRUIT_PAGE", "1000"))

#: Days of stored battles to read opponents out of. Small on purpose: the point
#: is to catch who is being played against NOW, and the window is a scan.
OPP_DAYS = int(os.getenv("CLASH_RECRUIT_OPP_DAYS", "2"))

#: Times an opponent must appear in that window before it is worth collecting
#: their history. One sighting is a stranger in a ladder queue.
OPP_MIN_SIGHTINGS = int(os.getenv("CLASH_RECRUIT_OPP_MIN", "2"))

#: The most new opponents a single run may queue.
OPP_MAX = int(os.getenv("CLASH_RECRUIT_OPP_MAX", "500"))

#: Hard cap on tracked + queued. See the header. 12,000 is ~4x the current
#: population and ~385 GB at the current retention, which is a number someone
#: should have to raise deliberately.
CEILING = int(os.getenv("CLASH_RECRUIT_CEILING", "12000"))

SEASONS_PATH = "/locations/global/seasons"
RANKINGS_PATH = "/locations/global/pathoflegend/%s/rankings/players"


# --------------------------------------------------------------------------
# The Clash Royale API
# --------------------------------------------------------------------------

def _get(path: str, **params):
    """-> (status, decoded) or ('ERR', repr). Never raises.

    Same headers as `clash_data.cr_profile`, including the User-Agent, which is
    not decoration: the RoyaleAPI proxy answers 403 to urllib's default agent,
    and that failure reads as a bad token.
    """
    if not cd.CR_TOKEN:
        return "NOKEY", None
    url = cd.CR_API_BASE.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": "Bearer " + cd.CR_TOKEN,
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (RoyalArena analytics)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except Exception as exc:  # noqa: BLE001
        return "ERR", repr(exc)[:200]


def current_season() -> str | None:
    """The newest season id the rankings endpoint will actually answer for.

    **DO NOT COMPUTE THIS FROM THE CLOCK.** Measured on 2026-08-28: the current
    calendar month `2026-08` returns `404 notFound` while `2026-07` returns a
    full board. A `time.strftime("%Y-%m")` would therefore 404 every single run,
    and it would do it silently, because a recruiter that finds no players and
    a recruiter that asked the wrong question look identical from the outside.

    So the list is asked for and the newest entry used. It carries duplicates
    (every id appeared twice in the observed payload), hence the set.
    """
    status, data = _get(SEASONS_PATH)
    if status != 200 or not isinstance(data, dict):
        return None
    ids = sorted({str(x.get("id")) for x in (data.get("items") or []) if x.get("id")})
    if not ids:
        return None
    # Newest first, then walk back: the newest LISTED season answered in the
    # probe, but a list that runs one ahead of the rankings would otherwise
    # strand this permanently on a 404.
    for sid in reversed(ids[-6:]):
        status, _ = _get(RANKINGS_PATH % urllib.parse.quote(sid), limit=1)
        if status == 200:
            return sid
    return None


def leaderboard_tags(limit: int = TOP_N, season: str | None = None) -> list[str]:
    """The top `limit` players of ranked (Path of Legends), in rank order.

    Ranked is Path of Legends, and its board is
    `/locations/global/pathoflegend/<season>/rankings/players`. The older
    `/locations/global/rankings/players` still answers 200 and returns **zero
    items** — it is the retired trophy ladder, and reading it would report a
    working recruiter that recruits nobody.

    Returns [] on any failure rather than raising: a run that could not reach
    the API must be a no-op, not an outage.
    """
    season = season or current_season()
    if not season:
        return []
    path = RANKINGS_PATH % urllib.parse.quote(season)

    out: list[str] = []
    seen: set[str] = set()
    after = None
    while len(out) < limit:
        params = {"limit": min(PAGE, limit - len(out))}
        if after:
            params["after"] = after
        status, data = _get(path, **params)
        if status != 200 or not isinstance(data, dict):
            break
        items = data.get("items") or []
        if not items:
            break
        for item in items:
            norm = cd.normalize_tag(item.get("tag") or "")
            # The board is a public list of real accounts and every observed
            # tag normalised cleanly, but this is still the boundary between
            # someone else's JSON and our queue.
            if norm and norm not in seen:
                seen.add(norm)
                out.append(norm)
        after = ((data.get("paging") or {}).get("cursors") or {}).get("after")
        if not after:
            break
    return out[:limit]


# --------------------------------------------------------------------------
# Opponents already in the database
# --------------------------------------------------------------------------

def _cutoff(days: int) -> str:
    """`battle_time` is `YYYYMMDDThhmmss.sssZ`, so a string bound is a date
    bound — the same trick the trend query uses to stay on its index."""
    return time.strftime("%Y%m%dT%H%M%S.000Z",
                         time.gmtime(time.time() - max(1, days) * 86400))


def opponent_tags(days: int = OPP_DAYS,
                  min_sightings: int = OPP_MIN_SIGHTINGS,
                  limit: int = OPP_MAX) -> list[tuple[str, int]]:
    """Players our tracked players have actually faced. -> [(tag, sightings)].

    This needs no CR API call at all, which is the nice part: `battles` already
    stores `opponent_tag` for every row, so the people worth collecting next are
    sitting in the database we already have. Every tracked player's last two
    days of opponents is one indexed range scan.

    HOT TIER ONLY. `tier_windows` exists to let a long window reach into the
    archive; a two-day window never does, and there is no archive on the VPS at
    all. Reading the hot tier directly is the honest shape here.

    Ordered by sightings desc so a truncating `limit` keeps the most-met
    players rather than an arbitrary slice.
    """
    path = cd.resolve_db_path()
    if not path:
        return []
    try:
        con = cd.connect(path)
    except Exception:
        return []
    try:
        rows = con.execute(
            "SELECT opponent_tag, count(*) AS n FROM battles "
            "WHERE battle_time >= ? AND opponent_tag IS NOT NULL "
            "AND opponent_tag != '' "
            "GROUP BY opponent_tag HAVING n >= ? "
            "ORDER BY n DESC LIMIT ?",
            (_cutoff(days), max(1, min_sightings), max(1, limit) * 4),
        ).fetchall()
    except Exception:
        return []
    finally:
        con.close()

    out: list[tuple[str, int]] = []
    for r in rows:
        norm = cd.normalize_tag(r["opponent_tag"] or "")
        if norm:
            out.append((norm, r["n"]))
    return out


# --------------------------------------------------------------------------
# The sink
# --------------------------------------------------------------------------

def enqueue(tags, source: str, ceiling: int = CEILING) -> dict:
    """Queue tags we are not already collecting or already holding.

    Returns a report rather than a count because every number in it answers a
    different operational question, and the one people actually want after a
    run is `skippedTracked` — it is what says the harvest has converged.
    """
    tags = [t for t in dict.fromkeys(tags) if t]
    tracked = tracking.bot_tracked_set()
    queued = tracking.queued_tags()

    fresh = [t for t in tags if t not in tracked and t not in queued]
    skipped_tracked = sum(1 for t in tags if t in tracked)
    skipped_queued = sum(1 for t in tags if t in queued)

    # The ceiling counts what the collection will BE, not what it is: a queued
    # tag is an enrolled tag that has not happened yet, and letting the queue
    # run past the cap just moves the breach two hours into the future.
    room = ceiling - (len(tracked) + len(queued))
    capped = False
    if room <= 0:
        fresh = []
        capped = True
    elif len(fresh) > room:
        fresh = fresh[:room]
        capped = True

    added = tracking.bulk_request(fresh, source) if fresh else 0
    return {
        "source": source,
        "considered": len(tags),
        "added": added,
        "skippedTracked": skipped_tracked,
        "skippedQueued": skipped_queued,
        "cappedByCeiling": capped,
        "tracked": len(tracked),
        "queued": len(queued) + added,
        "ceiling": ceiling,
    }


# --------------------------------------------------------------------------
# A run
# --------------------------------------------------------------------------

_state: dict = {"lastRunAt": None, "lastRun": None, "runs": 0, "error": None}
_state_lock = threading.Lock()


def run_once(top: int = TOP_N,
             opponents: bool = True,
             leaderboard: bool = True,
             days: int = OPP_DAYS,
             min_sightings: int = OPP_MIN_SIGHTINGS,
             opp_max: int = OPP_MAX) -> dict:
    """One pass of both recruiters. Never raises.

    Leaderboard first: it is a fixed, known, bounded population, so if the
    ceiling is going to bite it should bite the unbounded source rather than
    the one that was explicitly asked for.
    """
    report: dict = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    if leaderboard:
        try:
            tags = leaderboard_tags(top)
            report["leaderboard"] = enqueue(tags, "leaderboard")
            report["leaderboard"]["fetched"] = len(tags)
        except Exception as exc:  # noqa: BLE001
            report["leaderboard"] = {"error": type(exc).__name__}

    if opponents:
        try:
            met = opponent_tags(days, min_sightings, opp_max)
            report["opponents"] = enqueue([t for t, _ in met[:opp_max]], "opponent")
            report["opponents"]["eligible"] = len(met)
        except Exception as exc:  # noqa: BLE001
            report["opponents"] = {"error": type(exc).__name__}

    with _state_lock:
        _state["lastRunAt"] = report["at"]
        _state["lastRun"] = report
        _state["runs"] += 1
    return report


def state() -> dict:
    """Operational summary for `/api/analytics/status`. Counts only.

    Deliberately carries **no tags**. `/status` is the one unauthenticated
    route, and a list of who this service has decided to start collecting is a
    log of people, which is the same reason the metrics counters are not keyed
    by route.
    """
    with _state_lock:
        last = _state["lastRunAt"]
        runs = _state["runs"]
    added = None
    if _state["lastRun"]:
        added = sum(v.get("added", 0) for v in _state["lastRun"].values()
                    if isinstance(v, dict))
    try:
        queued = tracking.queue_depth()
    except Exception:
        queued = None
    return {
        "enabled": ENABLED == "on",
        "lastRunAt": last,
        "runs": runs,
        "lastAdded": added,
        "queued": queued,
        "ceiling": CEILING,
    }


def start_background() -> None:
    """Timer loop, only when `CLASH_RECRUIT=on`. See the header for why off."""
    if ENABLED != "on":
        return

    def loop():
        # A first run at startup would collide with the meta and counter
        # rollups, which are the two things a fresh process actually needs to
        # finish. Recruiting is never urgent — the drain is two-hourly anyway.
        time.sleep(120)
        while True:
            try:
                run_once()
            except Exception:  # noqa: BLE001
                pass
            time.sleep(max(300, REFRESH_SECONDS))

    threading.Thread(target=loop, daemon=True, name="recruit").start()


# --------------------------------------------------------------------------
# CLI — the on-demand half, which works whether or not the loop is enabled
# --------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    """python server/recruit.py [--top N] [--no-opponents] [--no-leaderboard]
                                [--days N] [--min-sightings N] [--dry-run]"""
    args = list(argv)

    def opt(name: str, default: int) -> int:
        if name in args:
            i = args.index(name)
            try:
                return int(args[i + 1])
            except (IndexError, ValueError):
                print("%s needs a number" % name, file=sys.stderr)
                raise SystemExit(2)
        return default

    top = opt("--top", TOP_N)
    days = opt("--days", OPP_DAYS)
    minsight = opt("--min-sightings", OPP_MIN_SIGHTINGS)
    oppmax = opt("--opp-max", OPP_MAX)
    do_lb = "--no-leaderboard" not in args
    do_opp = "--no-opponents" not in args

    if "--dry-run" in args:
        # Reads everything, queues nothing. The useful part is the skip counts:
        # they say whether a real run would do anything at all.
        tracked = tracking.bot_tracked_set()
        queued = tracking.queued_tags()
        if do_lb:
            tags = leaderboard_tags(top)
            new = [t for t in tags if t not in tracked and t not in queued]
            print("leaderboard: fetched %d, %d new, %d already tracked, "
                  "%d already queued" % (len(tags), len(new),
                                         sum(1 for t in tags if t in tracked),
                                         sum(1 for t in tags if t in queued)))
        if do_opp:
            met = opponent_tags(days, minsight, oppmax)
            new = [t for t, _ in met if t not in tracked and t not in queued]
            print("opponents  : %d eligible (>=%d sightings in %dd), %d new"
                  % (len(met), minsight, days, len(new)))
        print("collection : %d tracked + %d queued, ceiling %d"
              % (len(tracked), len(queued), CEILING))
        return 0

    report = run_once(top=top, opponents=do_opp, leaderboard=do_lb,
                      days=days, min_sightings=minsight, opp_max=oppmax)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
