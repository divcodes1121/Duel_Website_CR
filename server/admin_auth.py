"""Is this caller an administrator? Asked of Supabase, never decided here.

The analytics API's key (`CLASH_API_KEY`) says only that a request came
through the edge — Caddy injects it on EVERY path, so it is not a user
identity and every other route is public by construction. The Coach Roster's
routes are admin-only, so they need a second gate that knows WHO is asking.

HOW. The browser sends its Supabase access token in `X-Coach-Token` (not in
`Authorization`, which this service already reads as a carrier for the
analytics key — one header meaning two things is how a check ends up reading
the wrong one). This module posts to Supabase's `rpc/coach_is_admin` WITH
THAT TOKEN. The function is migration 004's own admin test —
`effective_tier(auth.uid()) = 'admin'` — so "who is an admin" is decided in
exactly one place, the same place the coaching tables' Row Level Security
asks, and this service cannot disagree with it.

  valid token, admin      -> 'ok'
  valid token, not admin  -> 'forbidden'      (403)
  missing / bad / expired -> 'unauthorized'   (401)
  not configured          -> 'not_configured' (503) — fail CLOSED
  Supabase unreachable    -> 'unavailable'    (503) — fail CLOSED

STANDARD LIBRARY ONLY, like the rest of `server/`: `urllib`, no SDK.

A verdict is cached for a minute under a hash of the token, so switching
between roster players does not cost a Supabase round trip per click. Only
'ok' and 'forbidden' are cached — a transient failure is never remembered.
Bounded, so a flood of distinct junk tokens cannot grow it without limit.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.request

HEADER = "X-Coach-Token"

CACHE_SECONDS = 60
CACHE_MAX = 256
TIMEOUT_SECONDS = 5

_cache: dict[str, tuple[float, str]] = {}
_lock = threading.Lock()


def _config() -> tuple[str, str]:
    """Read at CALL time, not import time, so a test can set it per case and a
    restart is the only thing an operator has to do after editing the env."""
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_ANON_KEY") or ""
    return url, key


def configured() -> bool:
    url, key = _config()
    return bool(url and key)


def _cached(digest: str) -> str | None:
    with _lock:
        hit = _cache.get(digest)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        if hit:
            _cache.pop(digest, None)
    return None


def _remember(digest: str, verdict: str) -> None:
    with _lock:
        if len(_cache) >= CACHE_MAX:
            # Oldest-expiring first; a full sweep of 256 is nothing.
            for k, _ in sorted(_cache.items(), key=lambda kv: kv[1][0])[: CACHE_MAX // 4]:
                _cache.pop(k, None)
        _cache[digest] = (time.monotonic() + CACHE_SECONDS, verdict)


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def verify(token: str | None) -> str:
    """One of 'ok', 'forbidden', 'unauthorized', 'not_configured', 'unavailable'."""
    return _ask(token, "coach_is_admin", "")


def coach(token: str | None) -> str:
    """Like `verify`, but 'ok' for anyone who may use Coach Roster: an admin,
    or a Pro account with Coach = Yes (migration 008's `coach_may_coach`, the
    same test the roster tables' Row Level Security asks). For the coach intel
    route only — the console's routes stay on `verify`.

    A database still on 007 has no `coach_may_coach` (PostgREST answers 404);
    that falls back to the admin test, so deploying this before the migration
    keeps today's behaviour instead of shutting admins out."""
    verdict = _ask(token, "coach_may_coach", "coach:")
    return verify(token) if verdict == "missing" else verdict


def _ask(token: str | None, fn: str, prefix: str) -> str:
    url, key = _config()
    if not (url and key):
        return "not_configured"
    token = (token or "").strip()
    # A JWT is three base64url segments. Anything else is not worth a request.
    if not token or token.count(".") != 2 or len(token) > 4096:
        return "unauthorized"

    digest = prefix + hashlib.sha256(token.encode("utf-8")).hexdigest()
    hit = _cached(digest)
    if hit:
        return hit

    req = urllib.request.Request(
        url + "/rest/v1/rpc/" + fn,
        data=b"{}",
        method="POST",
        headers={
            "apikey": key,
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as r:
            body = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        # PostgREST answers a bad or expired JWT with 401 (and some setups
        # 403). Either way the caller is not who they claim to be. 404 = the
        # function is not in this database yet (only `coach` acts on it).
        if e.code in (401, 403):
            return "unauthorized"
        return "missing" if e.code == 404 and prefix else "unavailable"
    except Exception:  # noqa: BLE001 — timeout, DNS, refused: all fail closed
        return "unavailable"

    try:
        is_admin = json.loads(body) is True
    except ValueError:
        return "unavailable"

    verdict = "ok" if is_admin else "forbidden"
    _remember(digest, verdict)
    return verdict


def _subject(token: str) -> str | None:
    """The account id (`sub`) in a JWT's payload. Read ONLY after `verify`
    said 'ok': Supabase checked the signature, so the payload is what it
    issued. Nothing here checks a signature."""
    import base64
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        sub = json.loads(base64.urlsafe_b64decode(part.encode("ascii"))).get("sub")
    except Exception:  # noqa: BLE001 - not a JWT payload we can read
        return None
    return sub if isinstance(sub, str) and 0 < len(sub) <= 128 else None


#: The tiers that open a paid area (2026-10-22, Coach Duel released): the
#: three-day trial, Pro and admin. `effective_tier` answers 'free' once a
#: trial has run out, so a lapsed trial is refused here without a date check.
PAID_TIERS = ("trial", "pro", "admin")


def paid(token: str | None) -> str:
    """Like `verify`, but 'ok' for any PAID account: trial, pro or admin.

    Posts to `rpc/effective_tier` — migration 001's one definition of a tier,
    the same function the site's gate reads — WITH THE CALLER'S TOKEN, asking
    for the token's own `sub`. PostgREST checks the token's signature before
    the function runs (a bad or expired one is 401), so the account asked
    about is the caller's own. One of 'ok', 'forbidden', 'unauthorized',
    'not_configured', 'unavailable'; cached like `verify`, apart from it."""
    url, key = _config()
    if not (url and key):
        return "not_configured"
    token = (token or "").strip()
    if not token or token.count(".") != 2 or len(token) > 4096:
        return "unauthorized"

    digest = "paid:" + hashlib.sha256(token.encode("utf-8")).hexdigest()
    hit = _cached(digest)
    if hit:
        return hit

    req = urllib.request.Request(
        url + "/rest/v1/rpc/effective_tier",
        data=json.dumps({"uid": _subject(token)}).encode("utf-8"),
        method="POST",
        headers={
            "apikey": key,
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as r:
            body = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return "unauthorized" if e.code in (401, 403) else "unavailable"
    except Exception:  # noqa: BLE001 — timeout, DNS, refused: all fail closed
        return "unavailable"

    try:
        tier = json.loads(body)
    except ValueError:
        return "unavailable"

    verdict = "ok" if tier in PAID_TIERS else "forbidden"
    _remember(digest, verdict)
    return verdict


def identify(token: str | None, need: str = "admin") -> tuple[str, str | None]:
    """(verdict, account id) — the gate's verdict, and on 'ok' who it is.

    Coach Duel rooms need to know WHICH account is asking, not only that it may
    (2026-10-22). `need` is "admin" (`verify`) or "paid" (`paid`: trial, pro or
    admin — Coach Duel since its release the same day). A token whose payload
    carries no readable `sub` (only a test stand-in) is named by a hash of the
    token, so it is still one caller."""
    verdict = paid(token) if need == "paid" else verify(token)
    if verdict != "ok":
        return verdict, None
    token = (token or "").strip()
    return "ok", _subject(token) or "tok:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:24]


#: HTTP status for each verdict that refuses.
STATUS = {"unauthorized": 401, "forbidden": 403, "not_configured": 503, "unavailable": 503}
