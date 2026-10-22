"""Coach Duel rooms: two coaches online, against each other (2026-10-22).

Asked for: *"a multiplayer mode where 2 coaches can be online at the same time
... sending a request and they can battle each other selecting the players"*,
then *"options before, like 2 / 3 / 4 / 5 mins for selecting a deck, and after
selecting all the settings we make a room and share the link, then the other
coach opens it"*.

THE FLOW
  1. The host picks their player and the settings (best of 3 / 5, stop on a
     win / play all, how a game is decided, the deck clock) -> `create`.
     The screen shows the room's link.
  2. The other coach opens the link, picks their player -> `join`. Both
     players are read in a background thread (`reading`, ~30 s cold).
  3. Each game both coaches lock in a deck BLIND (`lock`): the server holds
     both and shows neither until both are in, or the clock runs out. Then it
     decides the game itself — the matchup between the two decks, moved by
     the game before, and a roll drawn HERE, never in a browser — and opens
     the next game.
  4. At the end, either coach may ask for a rematch; when both have, the room
     starts again with the same settings and players.

THE CLOCK. Each game has a deadline (`clock` seconds after it opens; the
first game opens when both players have been read, a later one `REVEAL_S`
after the result before it, so the result can be looked at). A coach who has
not locked in by then LOSES THAT GAME and spends no cards. If neither coach
locked in, the duel is abandoned: nobody is at the table. The clock is
checked whenever anybody asks about the room (`advance`), so nothing has to
run in the background for it.

WHO IS WHO. Blue is the host, red is whoever joined. A request is placed on a
seat by the seat token its browser made for this room (only its hash is
kept), and failing that by the signed-in account — so a coach can play both
seats from two devices while testing, and a coach who reloads keeps theirs.

THE BRAIN IS PASSED IN (`Brain`), so every rule here runs in a test with a
stand-in: `read` (both players, slow), `referee` (blue's chance with these
two decks), `shift` (the chance moved by the game before), `deck_row` (a
deck's name and seating) and `next_options` (decks still legal for a seat).

STORAGE: one SQLite file of our own (`server/.coach_rooms.db`, gitignored,
env `CLASH_ROOM_DB`), one JSON row per room. Never the bot's database.
Rooms are small; one is deleted two days after it last changed.

STANDARD LIBRARY ONLY.
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import secrets
import sqlite3
import threading
import time
import traceback
from typing import Any, Callable

PATH = os.environ.get("CLASH_ROOM_DB") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".coach_rooms.db")

#: Deck clock choices, seconds ("2 / 3 / 4 / 5 mins"). 0 = no time limit
#: (asked for the same day: "also add a no time option"); a game then waits
#: until both coaches have locked in, and has no deadline.
CLOCKS = (120, 180, 240, 300)
NO_LIMIT = 0
DEFAULT_CLOCK = 180
FORMATS = (3, 5)
#: How a game is decided — the vs-AI screen's two rules (`utils/coachDuel.ts`).
LUCKS = ("mu", "roll")
#: Over this matchup a side wins outright under "mu"; 45-55 is rolled.
MU_DECIDES = 55.0
DAY_CHOICES = (7, 15, 30, 45, 60, 90)
DEFAULT_DAYS = 30
#: A finished game's result stays on screen this long before the next opens.
REVEAL_S = 12.0
#: A room nobody joined closes after this.
JOIN_TTL_S = 30 * 60.0
#: A room is deleted this long after it last changed.
KEEP_S = 2 * 86400.0
ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
ID_LEN = 10
SEAT_MIN, SEAT_MAX = 16, 64
FORMS = ("evolution", "hero")
SEATS = ("blue", "red")

OPEN_PHASES = ("waiting", "reading", "playing")


def _other(seat: str) -> str:
    return "red" if seat == "blue" else "blue"


def _hash(token: str) -> str:
    return hashlib.sha256(("seat|" + token).encode("utf-8")).hexdigest()


def valid_id(raw) -> str:
    s = str(raw or "").strip().lower()
    return s if len(s) == ID_LEN and all(c in ID_ALPHABET for c in s) else ""


def valid_seat(raw) -> str:
    s = str(raw or "").strip()
    ok = SEAT_MIN <= len(s) <= SEAT_MAX and all(c.isalnum() or c in "-_" for c in s)
    return s if ok else ""


def settings_from(bo=None, play_all=None, luck=None, clock=None, days=None) -> dict:
    """The room's settings; anything unknown falls back to the default."""
    try:
        bo = int(bo)
    except (TypeError, ValueError):
        bo = 3
    try:
        clock = int(clock)
    except (TypeError, ValueError):
        clock = DEFAULT_CLOCK
    # The screen sends minutes (2..5) or 0 for no limit; seconds are accepted as well.
    if clock in (2, 3, 4, 5):
        clock *= 60
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = DEFAULT_DAYS
    return {
        "bo": bo if bo in FORMATS else 3,
        "all": bool(play_all),
        "luck": luck if luck in LUCKS else "mu",
        "clock": clock if clock in CLOCKS or clock == NO_LIMIT else DEFAULT_CLOCK,
        "days": days if days in DAY_CHOICES else DEFAULT_DAYS,
    }


def parse_art(raw, cards: list) -> dict:
    """`card:form` pairs for this deck only; at most one hero, two evolutions."""
    out: dict[str, str] = {}
    for part in str(raw or "").split(","):
        k, _, form = part.partition(":")
        if k in cards and form in FORMS and k not in out:
            out[k] = form
    hero = [k for k, f in out.items() if f == "hero"][:1]
    evo = [k for k, f in out.items() if f == "evolution"][:2]
    return {k: out[k] for k in hero + evo}


# ── the brain (passed in) ───────────────────────────────────────────────────

class Brain:
    """What the rooms need from Coach Duel. The real one is `live_brain()`;
    tests pass a stand-in."""

    def read(self, room: dict) -> dict:
        """Read both players. Returns {"blue": {name, pool}, "red": {...}}."""
        raise NotImplementedError

    def referee(self, room: dict, blue: list, red: list) -> float:
        """Blue's chance (0..1) with these two decks."""
        raise NotImplementedError

    def shift(self, matchup: float, prev_blue: str | None, game: int) -> float:
        return matchup

    def deck_row(self, cards: list) -> dict:
        return {"deckName": None}

    def next_options(self, room: dict, seat: str, decks: list) -> list:
        return []

    def name(self, tag: str) -> str | None:
        """The player's in-game name, cheaply, for the plate before the read."""
        return None


class _Rated(Brain):
    """`brain` with one pairing's matchup already worked out."""

    def __init__(self, brain: Brain, blue: list, red: list, matchup: float):
        self.brain, self.pair, self.matchup = brain, (list(blue), list(red)), matchup

    def referee(self, room, blue, red):
        if (list(blue), list(red)) == self.pair:
            return self.matchup
        return self.brain.referee(room, blue, red)

    def shift(self, matchup, prev_blue, game):
        return self.brain.shift(matchup, prev_blue, game)


# ── the rules (pure, on a room dict) ────────────────────────────────────────

class RoomError(Exception):
    """A request the room refuses; `code` is what the screen words."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def new_room(rid: str, uid: str, seat_token: str, tag: str, settings: dict, now: float,
             name: str | None = None) -> dict:
    return {
        "id": rid, "created": now, "updated": now, "version": 1,
        "settings": dict(settings), "phase": "waiting", "round": 0,
        "blue": {"uid": uid, "seat": _hash(seat_token), "tag": tag, "name": name,
                 "pool": [], "next": []},
        "red": None,
        "games": [], "rematch": {"blue": False, "red": False},
        "end": None, "error": None,
    }


def seat_of(room: dict, uid: str, seat_token: str = "") -> str | None:
    """Which seat this caller holds: by the seat token, else by the account
    when only one seat is theirs."""
    h = _hash(seat_token) if seat_token else None
    for s in SEATS:
        side = room.get(s)
        if side and h and side.get("seat") == h:
            return s
    mine = [s for s in SEATS if room.get(s) and room[s].get("uid") == uid]
    return mine[0] if len(mine) == 1 else None


def score(room: dict) -> dict:
    out = {"blue": 0, "red": 0}
    for g in room["games"]:
        w = (g.get("result") or {}).get("winner")
        if w in out:
            out[w] += 1
    return out


def need(room: dict) -> int:
    return room["settings"]["bo"] // 2 + 1


def _finished(room: dict) -> str | None:
    """The duel's winner once it is over, else None."""
    s = score(room)
    done = [g for g in room["games"] if g.get("result")]
    bo = room["settings"]["bo"]
    if not room["settings"]["all"]:
        for seat in SEATS:
            if s[seat] >= need(room):
                return seat
    if len(done) >= bo:
        return "blue" if s["blue"] > s["red"] else "red"
    return None


def _open_game(room: dict, now: float, delay: float = 0.0) -> None:
    start = now + delay
    room["games"].append({
        "no": len(room["games"]) + 1, "start": start,
        "deadline": start + room["settings"]["clock"] if room["settings"]["clock"] else None,
        "blue": None, "red": None, "result": None,
    })


def _spent(room: dict, seat: str) -> set:
    out: set = set()
    for g in room["games"]:
        d = g.get(seat)
        if d and g.get("result"):
            out.update(d["cards"])
    return out


def _played(room: dict, seat: str) -> list:
    return [g[seat]["cards"] for g in room["games"] if g.get(seat) and g.get("result")]


def _end(room: dict, winner: str | None, reason: str, now: float) -> None:
    room["phase"] = "done"
    room["end"] = {"winner": winner, "reason": reason, "at": now}
    room["rematch"] = {"blue": False, "red": False}


def decide(luck: str, matchup: float, chance: float, draw: float) -> tuple[str, bool]:
    """(winner, rolled). Percents; `draw` uniform in [0, 100)."""
    if luck == "mu":
        if matchup > MU_DECIDES:
            return "blue", False
        if matchup < 100 - MU_DECIDES:
            return "red", False
    return ("blue" if draw < chance else "red"), True


def _resolve(room: dict, game: dict, brain: Brain, rng: Callable[[], float], now: float) -> None:
    """Both decks are in, or the clock ran out: decide the game."""
    b, r = game.get("blue"), game.get("red")
    if b is None and r is None:
        game["result"] = {"winner": None, "timeout": "both", "at": now}
        _end(room, None, "abandoned", now)
        return
    if b is None or r is None:
        late = "blue" if b is None else "red"
        game["result"] = {"winner": _other(late), "timeout": late, "at": now,
                          "matchup": None, "chance": None, "draw": None, "rolled": False}
    else:
        m = min(max(float(brain.referee(room, b["cards"], r["cards"])), 1e-6), 1 - 1e-6)
        prev = None
        done = [g for g in room["games"] if g.get("result") and g is not game]
        if done:
            w = done[-1]["result"].get("winner")
            prev = "w" if w == "blue" else "l" if w == "red" else None
        c = min(max(float(brain.shift(m, prev, game["no"])), 1e-6), 1 - 1e-6)
        draw = float(rng()) * 100.0
        winner, rolled = decide(room["settings"]["luck"], 100 * m, 100 * c, draw)
        game["result"] = {"winner": winner, "timeout": None, "at": now,
                          "matchup": round(100 * m, 1), "chance": round(100 * c, 1),
                          "draw": round(draw, 2), "rolled": rolled}
    champ = _finished(room)
    if champ:
        _end(room, champ, "score", now)
        return
    # The decks still legal for each seat are worked out OUTSIDE the room's
    # lock (`Rooms._fill_next`); until then each seat has none.
    for seat in SEATS:
        room[seat]["next"] = []
    _open_game(room, now, REVEAL_S)


def advance(room: dict, now: float, brain: Brain, rng: Callable[[], float],
            resolve_both: bool = True) -> bool:
    """Apply the clock. True when the room changed.

    `resolve_both=False` leaves a game both coaches locked in for the lock
    request to decide (it rates the matchup outside the room's lock, so a
    slow read never holds the other coach's screen); past its deadline it is
    decided here whatever the flag."""
    changed = False
    if room["phase"] == "waiting" and now - room["created"] > JOIN_TTL_S:
        room["phase"] = "closed"
        room["end"] = {"winner": None, "reason": "expired", "at": now}
        return True
    if room["phase"] != "playing":
        return False
    # Normally one game at most; a loop so a long-unread room catches up.
    for _ in range(len(room["games"]) + 6):
        if room["phase"] != "playing" or not room["games"]:
            break
        g = room["games"][-1]
        if g.get("result"):
            break
        both = g.get("blue") is not None and g.get("red") is not None
        late = g["deadline"] is not None and now >= g["deadline"]
        if (both and resolve_both) or late:
            _resolve(room, g, brain, rng, min(now, g["deadline"]) if not both else now)
            changed = True
            continue
        break
    return changed


def join(room: dict, uid: str, seat_token: str, tag: str, now: float, name: str | None = None) -> None:
    if room["phase"] != "waiting":
        if seat_of(room, uid, seat_token) == "red":
            return  # already in (a retried request)
        raise RoomError("room_full" if room["phase"] in ("reading", "playing", "done") else "room_closed")
    if room["blue"]["seat"] == _hash(seat_token):
        raise RoomError("own_room")
    if tag == room["blue"]["tag"]:
        raise RoomError("same_player")
    room["red"] = {"uid": uid, "seat": _hash(seat_token), "tag": tag, "name": name,
                   "pool": [], "next": []}
    room["phase"] = "reading"


def finish_read(room: dict, got: dict, now: float) -> None:
    """The background read is done: names and pools in, game 1 opens."""
    if room["phase"] != "reading":
        return
    for s in SEATS:
        side = got.get(s) or {}
        room[s]["name"] = side.get("name") or room[s].get("name") or room[s]["tag"]
        room[s]["pool"] = list(side.get("pool") or [])[:40]
        room[s]["next"] = []
    room["phase"] = "playing"
    _open_game(room, now)


def fail_read(room: dict, code: str, now: float) -> None:
    if room["phase"] == "reading":
        room["phase"] = "error"
        room["error"] = code
        room["end"] = {"winner": None, "reason": "error", "at": now}


def lock(room: dict, seat: str, cards: list, art: dict, row: dict, now: float, known: set | None,
         game_no: int | None = None) -> None:
    """`game_no` is the game the screen is locking in for. A lock that
    arrives after that game's clock ran out is refused, never moved on to the
    next game (the poll that ran the clock out also opened game N+1)."""
    g = room["games"][-1] if room["games"] else None
    if game_no is not None and (g is None or g["no"] != game_no):
        raise RoomError("too_late")
    if room["phase"] != "playing":
        raise RoomError("not_playing")
    if g.get("result"):
        raise RoomError("not_playing")
    if g["deadline"] is not None and now >= g["deadline"]:
        raise RoomError("too_late")
    cards = list(dict.fromkeys(cards))
    if len(cards) != 8 or (known is not None and any(c not in known for c in cards)):
        raise RoomError("bad_deck")
    if set(cards) & _spent(room, seat):
        raise RoomError("card_played")
    if g.get(seat) is not None:
        if g[seat]["cards"] == cards:
            return  # a retried request
        raise RoomError("already_locked")
    g[seat] = {"cards": cards, "art": art, "deckName": row.get("deckName"), "at": now}


def ask_rematch(room: dict, seat: str, now: float) -> None:
    if room["phase"] != "done" or (room["end"] or {}).get("reason") in ("error", "expired"):
        raise RoomError("no_rematch")
    room["rematch"][seat] = True
    if all(room["rematch"].values()) and room.get("red"):
        room["round"] += 1
        room["games"] = []
        room["end"] = None
        room["rematch"] = {"blue": False, "red": False}
        for s in SEATS:
            room[s]["next"] = []
        room["phase"] = "playing"
        _open_game(room, now)


def leave(room: dict, seat: str, now: float) -> None:
    if room["phase"] == "waiting":
        room["phase"] = "closed"
        room["end"] = {"winner": None, "reason": "closed", "at": now}
    elif room["phase"] in ("reading", "playing"):
        _end(room, _other(seat), "left", now)
        room["end"]["left"] = seat


def view(room: dict, seat: str | None, now: float) -> dict:
    """The room as THIS caller may see it: the other seat's deck for the game
    being played is never sent, only whether it is locked in; only the
    caller's own Coach Assist decks are sent."""
    games = []
    for g in room["games"]:
        row = {"no": g["no"], "start": round(g["start"] * 1000), "deadline": None if g["deadline"] is None else round(g["deadline"] * 1000),
               "result": g.get("result")}
        for s in SEATS:
            d = g.get(s)
            if d is None:
                row[s] = None
            elif g.get("result") or s == seat:
                row[s] = {"cards": d["cards"], "art": d.get("art") or {}, "deckName": d.get("deckName"),
                          "locked": True}
            else:
                row[s] = {"locked": True}
        games.append(row)
    sides = {}
    for s in SEATS:
        side = room.get(s)
        sides[s] = None if not side else {"tag": side["tag"], "name": side.get("name") or side["tag"]}
    mine = room.get(seat) if seat else None
    return {
        "id": room["id"], "phase": room["phase"], "version": room["version"],
        "now": round(now * 1000), "you": seat, "settings": room["settings"], "round": room["round"],
        "blue": sides["blue"], "red": sides["red"],
        "games": games, "score": score(room), "need": need(room),
        "rematch": room["rematch"], "end": room["end"], "error": room["error"],
        "pool": (mine or {}).get("pool") or [], "next": (mine or {}).get("next") or [],
        "joinable": room["phase"] == "waiting" and seat is None,
        "revealS": REVEAL_S,
    }


# ── storage ─────────────────────────────────────────────────────────────────

class Store:
    """One JSON row per room. A lock per room serialises its changes; the
    file is opened per call (rooms change a few times a minute)."""

    def __init__(self, path: str = PATH):
        self.path = path
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()
        self._ready = False

    def _db(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        if not self._ready:
            con.execute("CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, host TEXT, "
                        "phase TEXT, updated REAL, data TEXT)")
            con.execute("CREATE INDEX IF NOT EXISTS rooms_host ON rooms(host, phase)")
            self._ready = True
        return con

    def lock_for(self, rid: str) -> threading.Lock:
        with self._guard:
            if len(self._locks) > 512:
                for k in [k for k, v in self._locks.items() if not v.locked()][:256]:
                    self._locks.pop(k, None)
            return self._locks.setdefault(rid, threading.Lock())

    def load(self, rid: str) -> dict | None:
        con = self._db()
        try:
            row = con.execute("SELECT data FROM rooms WHERE id = ?", (rid,)).fetchone()
        finally:
            con.close()
        return json.loads(row[0]) if row else None

    def save(self, room: dict, now: float) -> None:
        room["updated"] = now
        room["version"] = int(room.get("version", 0)) + 1
        con = self._db()
        try:
            con.execute("INSERT OR REPLACE INTO rooms (id, host, phase, updated, data) VALUES (?, ?, ?, ?, ?)",
                        (room["id"], room["blue"]["uid"], room["phase"], now,
                         json.dumps(room, separators=(",", ":"))))
        finally:
            con.close()

    def exists(self, rid: str) -> bool:
        con = self._db()
        try:
            return con.execute("SELECT 1 FROM rooms WHERE id = ?", (rid,)).fetchone() is not None
        finally:
            con.close()

    def waiting_of(self, uid: str) -> list[str]:
        con = self._db()
        try:
            return [r[0] for r in con.execute("SELECT id FROM rooms WHERE host = ? AND phase = 'waiting'", (uid,))]
        finally:
            con.close()

    def prune(self, now: float) -> int:
        con = self._db()
        try:
            return con.execute("DELETE FROM rooms WHERE updated < ?", (now - KEEP_S,)).rowcount
        finally:
            con.close()


# ── the service: what the route calls ───────────────────────────────────────

class Rooms:
    def __init__(self, store: Store, brain: Brain, *, clock: Callable[[], float] = time.time,
                 rng: Callable[[], float] | None = None,
                 spawn: Callable[[Callable[[], None]], None] | None = None,
                 known: Callable[[], set | None] | None = None):
        self.store = store
        self.brain = brain
        self.clock = clock
        self.rng = rng or random.SystemRandom().random
        self.spawn = spawn or (lambda fn: threading.Thread(target=fn, daemon=True).start())
        self.known = known or (lambda: None)
        self._reading: set[str] = set()
        self._rlock = threading.Lock()

    def _name(self, tag: str) -> str | None:
        try:
            return self.brain.name(tag)
        except Exception:  # noqa: BLE001 - the plate falls back to the tag
            return None

    def _new_id(self) -> str:
        for _ in range(20):
            rid = "".join(secrets.choice(ID_ALPHABET) for _ in range(ID_LEN))
            if not self.store.exists(rid):
                return rid
        raise RoomError("busy")

    def _with(self, rid: str, fn: Callable[[dict, float], Any], brain: Brain | None = None,
              resolve_both: bool = False) -> dict:
        rid = valid_id(rid)
        if not rid:
            raise RoomError("no_room")
        with self.store.lock_for(rid):
            room = self.store.load(rid)
            if room is None:
                raise RoomError("no_room")
            now = self.clock()
            changed = advance(room, now, brain or self.brain, self.rng, resolve_both)
            # `fn` returns False for a read; anything else changed the room.
            out = fn(room, now)
            if changed or out is not False:
                self.store.save(room, now)
        # Outside the room's lock: the read takes that lock to write its result.
        if self._ensure_read(room):
            room = self.store.load(rid) or room  # a read that ran at once
        if self._fill_next(room):
            room = self.store.load(rid) or room
        return room

    def _fill_next(self, room: dict) -> bool:
        """After a game, the decks still legal for each seat (outside the
        lock; once per game). True when they were stored."""
        if room["phase"] != "playing" or not room["games"] or len(room["games"]) < 2:
            return False
        mark = "%d:%d" % (room["round"], len(room["games"]))
        if room.get("nextFor") == mark:
            return False
        key = room["id"] + "|" + mark
        with self._rlock:
            if key in self._reading:
                return False
            self._reading.add(key)
        try:
            got = {}
            for seat in SEATS:
                try:
                    got[seat] = list(self.brain.next_options(room, seat, _played(room, seat)) or [])[:6]
                except Exception:  # noqa: BLE001 - the options are extra
                    traceback.print_exc()
                    got[seat] = []

            def store(r, now):
                if "%d:%d" % (r["round"], len(r["games"])) != mark:
                    return False
                for seat in SEATS:
                    r[seat]["next"] = got[seat]
                r["nextFor"] = mark

            rid = valid_id(room["id"])
            with self.store.lock_for(rid):
                cur = self.store.load(rid)
                if cur is None:
                    return False
                now = self.clock()
                changed = advance(cur, now, self.brain, self.rng, False)
                if store(cur, now) is not False or changed:
                    self.store.save(cur, now)
            return True
        finally:
            with self._rlock:
                self._reading.discard(key)

    def _ensure_read(self, room: dict) -> bool:
        """Start the read for a room in `reading` that nobody is reading (a
        join, or a restart in the middle of one). True when one was started."""
        if room["phase"] != "reading":
            return False
        rid = room["id"]
        with self._rlock:
            if rid in self._reading:
                return False
            self._reading.add(rid)

        def run():
            try:
                try:
                    got = self.brain.read(room)
                    code = None
                except RoomError as e:
                    got, code = None, e.code
                except Exception:  # noqa: BLE001 - told to the screen as a failed read
                    traceback.print_exc()
                    got, code = None, "read_failed"
                with self.store.lock_for(rid):
                    cur = self.store.load(rid)
                    if cur is None:
                        return
                    now = self.clock()
                    if got is not None:
                        finish_read(cur, got, now)
                    else:
                        fail_read(cur, code or "read_failed", now)
                    self.store.save(cur, now)
            finally:
                with self._rlock:
                    self._reading.discard(rid)

        self.spawn(run)
        return True

    # -- actions --

    def create(self, uid: str, seat_token: str, tag: str, settings: dict) -> dict:
        seat_token = valid_seat(seat_token)
        if not seat_token:
            raise RoomError("bad_seat")
        if not tag:
            raise RoomError("invalid_tag")
        now = self.clock()
        self.store.prune(now)
        # A new room closes the host's rooms nobody joined yet.
        for old in self.store.waiting_of(uid):
            try:
                self._with(old, lambda r, n: leave(r, "blue", n))
            except RoomError:
                pass
        room = new_room(self._new_id(), uid, seat_token, tag, settings, now, self._name(tag))
        with self.store.lock_for(room["id"]):
            self.store.save(room, now)
        return view(room, "blue", now)

    def get(self, rid: str, uid: str, seat_token: str = "") -> dict:
        room = self._with(rid, lambda r, n: False)
        return view(room, seat_of(room, uid, valid_seat(seat_token)), self.clock())

    def join(self, rid: str, uid: str, seat_token: str, tag: str) -> dict:
        seat_token = valid_seat(seat_token)
        if not seat_token:
            raise RoomError("bad_seat")
        if not tag:
            raise RoomError("invalid_tag")
        name = self._name(tag)
        room = self._with(rid, lambda r, n: join(r, uid, seat_token, tag, n, name))
        return view(room, seat_of(room, uid, seat_token), self.clock())

    def _seated(self, rid: str, uid: str, seat_token: str, fn) -> dict:
        seat_token = valid_seat(seat_token)
        holder: dict = {}

        def act(room, now):
            seat = seat_of(room, uid, seat_token)
            if seat is None:
                raise RoomError("not_seated")
            holder["seat"] = seat
            return fn(room, seat, now)

        room = self._with(rid, act)
        return view(room, holder.get("seat"), self.clock())

    def lock(self, rid: str, uid: str, seat_token: str, cards: list, art_raw: str = "",
             game_no: int | None = None) -> dict:
        cards = [c for c in cards if c]
        try:
            row = self.brain.deck_row(cards) if len(cards) == 8 else {}
        except Exception:  # noqa: BLE001 - the name is extra
            row = {}
        known = self.known()
        art = parse_art(art_raw, cards)

        def act(room, seat, now):
            lock(room, seat, cards, art, row, now, known, game_no)

        out = self._seated(rid, uid, seat_token, act)
        # Both decks in: rate the pairing here, outside the room's lock, then
        # decide the game under it with that figure.
        room = self.store.load(valid_id(rid))
        g = room["games"][-1] if room and room["games"] else None
        if g and not g.get("result") and g.get("blue") and g.get("red"):
            b, r = g["blue"]["cards"], g["red"]["cards"]
            try:
                m = float(self.brain.referee(room, b, r))
            except Exception:  # noqa: BLE001 - decided under the lock instead
                traceback.print_exc()
                m = None
            rated = _Rated(self.brain, b, r, m) if m is not None else None
            room = self._with(rid, lambda rm, n: False, brain=rated, resolve_both=True)
            seat_token = valid_seat(seat_token)
            return view(room, seat_of(room, uid, seat_token), self.clock())
        return out

    def rematch(self, rid: str, uid: str, seat_token: str) -> dict:
        return self._seated(rid, uid, seat_token, ask_rematch)

    def leave(self, rid: str, uid: str, seat_token: str) -> dict:
        return self._seated(rid, uid, seat_token, leave)


# ── the real brain ──────────────────────────────────────────────────────────

class LiveBrain(Brain):
    """Coach Duel's own reads and referee. The two sides are kept per room
    for the room's life (Coach Duel's own cache forgets after ten minutes,
    and a best of 5 with five-minute clocks runs longer than that)."""

    KEEP = 64

    def __init__(self, window_for: Callable[[str, int], tuple]):
        self.window_for = window_for
        self._sides: dict[tuple, tuple[float, tuple]] = {}
        self._lock = threading.Lock()

    def _key(self, room: dict) -> tuple:
        return (room["blue"]["tag"], room["red"]["tag"], room["settings"]["days"])

    def _pair(self, room: dict) -> tuple:
        import coach_duel as cdu
        k = self._key(room)
        with self._lock:
            hit = self._sides.get(k)
            if hit:
                self._sides[k] = (time.time(), hit[1])
                return hit[1]
        bt, rt, days = k
        bw, rw = self.window_for(bt, days), self.window_for(rt, days)
        b = cdu._side_cached(bt, rt, bw, rw, None)
        r = cdu._side_cached(rt, bt, rw, bw, None)
        pair = (b, r)
        with self._lock:
            if len(self._sides) >= self.KEEP:
                for old in sorted(self._sides, key=lambda x: self._sides[x][0])[: self.KEEP // 2]:
                    self._sides.pop(old, None)
            self._sides[k] = (time.time(), pair)
        return pair

    def read(self, room: dict) -> dict:
        import coach_duel as cdu
        b, r = self._pair(room)
        if b.get("win") is None and r.get("win") is None:
            raise RoomError("no_brain")
        ss = room["id"]
        return {
            "blue": {"name": b.get("name"), "pool": cdu._you_pool(b, ss)},
            "red": {"name": r.get("name"), "pool": cdu._you_pool(r, ss)},
        }

    def referee(self, room: dict, blue: list, red: list) -> float:
        import coach_duel as cdu
        b, r = self._pair(room)
        return float(cdu._referee(b["win"], r["win"])(blue, red))

    def shift(self, matchup: float, prev_blue, game: int) -> float:
        import duel_plan as dp
        return float(dp.shifted(matchup, prev_blue, game))

    def deck_row(self, cards: list) -> dict:
        import coach_duel as cdu
        return cdu._deck_row(cards)

    def name(self, tag: str) -> str | None:
        import clash_data
        return clash_data.player_name(tag)

    def next_options(self, room: dict, seat: str, decks: list) -> list:
        import coach_duel as cdu
        b, r = self._pair(room)
        mine, theirs = (b, r) if seat == "blue" else (r, b)
        return cdu._next_options(mine, theirs, decks, room["id"])
