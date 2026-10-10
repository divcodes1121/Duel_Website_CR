"""card_balance.py — what the balance log says about a deck's record.

The card manual (`All_Cards_stats.md`, Appendix C) carries a dated balance
log, and `scripts/build-card-roles.py` turns it into `src/data/cardBalance.json`.
This module is the brain's reader of that file.

WHY A DATE MATTERS TO A WIN RATE
================================

Every rate Deckkies prints is counted from games already played, and most of a
list's games are older than the newest patch. Measured on the duel index
(2026-10-10, five patches from 4 August to 6 October, the 14 days before a
patch day against the 14 after, the side holding the card when the other side
does not):

    kind of change           cards    change in win rate (points)
    base card nerfed           23     -1.37   [-1.74, -1.00]
    evolution nerfed           10     -1.36   [-1.81, -0.90]
    hero nerfed                 5     -0.75   [-1.31, -0.19]
    base card buffed           28     +0.17   [-0.20, +0.55]
    reworked (any form)        17     no consistent direction
    unchanged cards (control) 84-119 a patch, mean within 0.25 of zero

So a nerf costs the decks holding the card about a point and a half, a buff is
not visible in results, and a rework goes either way. ONLY THE NERF IS APPLIED:
`drag(cards)` is the points a list's stored record overstates it by today.

It fades. A record is counted over a window, and the further behind the patch
is, the more of the window was played after it: the drag falls in a straight
line to nothing `FADE_DAYS` after the patch day.

Both sides of a matchup carry it: our list's drag comes off its rate, and a
drag on THEIR list is added back — a deck they play that was nerfed last week
is a little easier than its record says.

NO DATABASE, NO IMPORTS. The file is re-read when it changes on disk
(`_fresh`, at most every `CHECK_EVERY_S`), so a new balance log pushed to the
server is in use without a restart. Without the file every function answers
"nothing changed".
"""

from __future__ import annotations

import datetime
import json
import os
import threading
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(_HERE, "..", "src", "data", "cardBalance.json")

#: Points of win rate a nerf to this form costs the decks holding the card,
#: as measured above.
NERF_POINTS = {"base": 1.4, "evolution": 1.4, "hero": 0.75}

#: Days after a patch at which its nerf no longer shifts a record: the duel
#: index's own evidence window, by when the record is the patched card's.
FADE_DAYS = 60

#: One deck is never moved by more than this, however many of its cards were
#: nerfed. The measurement is of ONE changed card, and cards nerfed in one
#: patch are often in the same decks (Barbarian Barrel and Skeletons), so each
#: card's figure already holds some of its neighbour's: the largest counts in
#: full and every further card `SECOND_CARD` of its own.
MAX_DRAG = 2.5
SECOND_CARD = 0.5

#: A change is MARKED on a deck (the small arrow on the row) for this long.
MARK_DAYS = 30

#: Seconds between looks at the file's modification time.
CHECK_EVERY_S = 30.0

_lock = threading.Lock()
_state = {"mtime": None, "checked": 0.0, "cards": {}, "latest": None, "patches": 0}


def _read() -> tuple[dict, str | None, int]:
    with open(PATH, encoding="utf-8") as fh:
        doc = json.load(fh)
    cards: dict[str, list] = {}
    for key, rows in (doc.get("cards") or {}).items():
        out = []
        for r in rows or []:
            try:
                day = datetime.date.fromisoformat(r["date"])
            except Exception:  # noqa: BLE001 - a malformed row is not a change
                continue
            out.append((day, r.get("form") or "base", r.get("kind") or ""))
        if out:
            cards[key] = sorted(out)
    return cards, doc.get("latest"), len(doc.get("patches") or [])


def _fresh() -> dict:
    """The current table, re-read when the file has changed."""
    now = time.monotonic()
    st = _state
    if st["mtime"] is not None and now - st["checked"] < CHECK_EVERY_S:
        return st
    with _lock:
        st["checked"] = now
        try:
            mtime = os.path.getmtime(PATH)
        except OSError:
            if st["mtime"] is None:
                st["mtime"] = 0.0
            return st
        if mtime != st["mtime"]:
            try:
                st["cards"], st["latest"], st["patches"] = _read()
            except Exception:  # noqa: BLE001 - keep the last good table
                pass
            st["mtime"] = mtime
    return st


def reload() -> None:
    """Forget the table (tests, and a caller that has just written the file)."""
    with _lock:
        _state.update({"mtime": None, "checked": 0.0, "cards": {}, "latest": None,
                       "patches": 0})


def status() -> dict:
    st = _fresh()
    return {"loaded": bool(st["cards"]), "cards": len(st["cards"]),
            "patches": st["patches"], "latest": st["latest"]}


def _today(as_of) -> datetime.date:
    if isinstance(as_of, datetime.date):
        return as_of
    if isinstance(as_of, str) and as_of:
        try:
            return datetime.date.fromisoformat(as_of[:10])
        except ValueError:
            pass
    return datetime.datetime.utcnow().date()


def card_drag(card: str, as_of=None, table: dict | None = None) -> float:
    """Points one card's nerfs still take off a deck holding it, today."""
    rows = (table if table is not None else _fresh()["cards"]).get(card)
    if not rows:
        return 0.0
    today = _today(as_of)
    total = 0.0
    # One patch moves a card once: two forms nerfed together are one change to
    # the decks holding it (measured as such), so the larger figure stands.
    per_patch: dict = {}
    for day, form, kind in rows:
        if kind != "nerf":
            continue
        age = (today - day).days
        if age < 0 or age >= FADE_DAYS:
            continue
        pts = NERF_POINTS.get(form, 0.0) * (1.0 - age / float(FADE_DAYS))
        if pts > per_patch.get(day, 0.0):
            per_patch[day] = pts
    for pts in per_patch.values():
        total += pts
    return total


def drag(cards, as_of=None) -> float:
    """Points a LIST's stored record overstates it by today (0 or more)."""
    table = _fresh()["cards"]
    if not table:
        return 0.0
    each = sorted((card_drag(c, as_of, table) for c in set(cards or ()) if c in table),
                  reverse=True)
    if not each or each[0] <= 0:
        return 0.0
    total = each[0] + SECOND_CARD * sum(each[1:])
    return round(min(MAX_DRAG, total), 2)


def marks(cards, as_of=None) -> list[dict]:
    """The cards of a list changed in the last `MARK_DAYS`, newest first:
    `[{card, kind, form, date}]`, one row a card (its newest change)."""
    table = _fresh()["cards"]
    if not table:
        return []
    today = _today(as_of)
    out = []
    for c in sorted(set(cards or ())):
        best = None
        for day, form, kind in table.get(c) or ():
            age = (today - day).days
            if 0 <= age < MARK_DAYS and kind in ("nerf", "buff", "rework", "new"):
                if best is None or day >= best[0]:
                    best = (day, form, kind)
        if best:
            out.append({"card": c, "kind": best[2], "form": best[1],
                        "date": best[0].isoformat()})
    out.sort(key=lambda m: (m["date"], m["card"]), reverse=True)
    return out
