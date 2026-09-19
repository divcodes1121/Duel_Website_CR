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
    url, key = _config()
    if not (url and key):
        return "not_configured"
    token = (token or "").strip()
    # A JWT is three base64url segments. Anything else is not worth a request.
    if not token or token.count(".") != 2 or len(token) > 4096:
        return "unauthorized"

    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    hit = _cached(digest)
    if hit:
        return hit

    req = urllib.request.Request(
        url + "/rest/v1/rpc/coach_is_admin",
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
        # 403). Either way the caller is not who they claim to be.
        return "unauthorized" if e.code in (401, 403) else "unavailable"
    except Exception:  # noqa: BLE001 — timeout, DNS, refused: all fail closed
        return "unavailable"

    try:
        is_admin = json.loads(body) is True
    except ValueError:
        return "unavailable"

    verdict = "ok" if is_admin else "forbidden"
    _remember(digest, verdict)
    return verdict


#: HTTP status for each verdict that refuses.
STATUS = {"unauthorized": 401, "forbidden": 403, "not_configured": 503, "unavailable": 503}
