"""Checks for Coach Duel rooms (`coach_room.py`): two coaches online.

A stand-in brain, a fake clock and a temp SQLite file; nothing reads the
bot's database. Run: python server/test_coach_room.py
"""

from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import coach_room as cr  # noqa: E402

PASSED = FAILED = 0


def check(name, cond):
    global PASSED, FAILED
    if cond:
        PASSED += 1
    else:
        FAILED += 1
        print("FAIL:", name)


def raises(code, fn):
    try:
        fn()
    except cr.RoomError as e:
        return e.code == code
    return False


CARDS = ["c%02d" % i for i in range(60)]


def deck(i):
    return CARDS[i * 8:(i + 1) * 8]


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


class FakeBrain(cr.Brain):
    def __init__(self, matchup=0.70):
        self.matchup = matchup
        self.reads = 0
        self.shifts = []
        self.fail = None

    def read(self, room):
        self.reads += 1
        if self.fail:
            raise self.fail
        return {"blue": {"name": "Blue Player", "pool": [{"cards": deck(6), "deckName": "B pool"}]},
                "red": {"name": "Red Player", "pool": [{"cards": deck(5), "deckName": "R pool"}]}}

    def referee(self, room, blue, red):
        return self.matchup

    def shift(self, m, prev, game):
        self.shifts.append((prev, game))
        return m

    def deck_row(self, cards):
        return {"deckName": "Deck " + cards[0]}

    def next_options(self, room, seat, decks):
        return [{"cards": deck(7), "seat": seat, "played": len(decks)}]

    def name(self, tag):
        return {"#BLUE": "Blue Name", "#RED": "Red Name"}.get(tag)


class Draws:
    def __init__(self, *xs):
        self.xs = list(xs) or [0.5]

    def __call__(self):
        return self.xs.pop(0) if len(self.xs) > 1 else self.xs[0]


def make(matchup=0.70, draws=(0.5,), spawn_now=True):
    tmp = tempfile.mkdtemp()
    clock = Clock()
    brain = FakeBrain(matchup)
    pending = []
    spawn = (lambda fn: fn()) if spawn_now else pending.append
    rooms = cr.Rooms(cr.Store(os.path.join(tmp, "rooms.db")), brain, clock=clock,
                     rng=Draws(*draws), spawn=spawn, known=lambda: set(CARDS))
    return rooms, clock, brain, pending


A, B = "user-a", "user-b"
SA, SB, SA2 = "seat-aaaaaaaaaaaaaaaa", "seat-bbbbbbbbbbbbbbbb", "seat-cccccccccccccccc"


def started(settings=None, **kw):
    rooms, clock, brain, pending = make(**kw)
    v = rooms.create(A, SA, "#BLUE", settings or cr.settings_from(3, False, "mu", 3, 30))
    rid = v["id"]
    rooms.join(rid, B, SB, "#RED")
    return rooms, clock, brain, rid


# ── settings ──
s = cr.settings_from(5, True, "roll", 2, 15)
check("clock 2 min = 120 s", s["clock"] == 120)
check("bo 5 kept", s["bo"] == 5 and s["all"] is True and s["luck"] == "roll" and s["days"] == 15)
check("every clock choice maps", [cr.settings_from(clock=m)["clock"] for m in (2, 3, 4, 5)] == [120, 180, 240, 300])
check("seconds accepted too", cr.settings_from(clock=240)["clock"] == 240)
d = cr.settings_from(7, None, "fav", 9, 999)
check("unknown settings fall back", (d["bo"], d["luck"], d["clock"], d["days"]) == (3, "mu", 180, 30))
check("junk settings fall back", cr.settings_from("x", None, None, "y", "z")["clock"] == 180)

# ── ids and seats ──
check("valid id", cr.valid_id("abcdefgh23") == "abcdefgh23")
check("an id with a 0 is refused", cr.valid_id("abcdefgh20") == "")
check("short id refused", cr.valid_id("abc") == "")
check("seat token shape", cr.valid_seat(SA) == SA and cr.valid_seat("short") == "" and cr.valid_seat("x" * 20 + "!") == "")

# ── art ──
art = cr.parse_art("c00:evolution,c01:hero,c02:hero,zz:evolution,c03:evolution,c04:evolution,c05:wizard", deck(0))
check("art keeps deck cards and known forms", set(art) <= set(deck(0)) and "zz" not in art and "c05" not in art)
check("art: one hero, two evolutions", list(art.values()).count("hero") == 1 and list(art.values()).count("evolution") == 2)

# ── create / join ──
rooms, clock, brain, pending = make(spawn_now=False)
v = rooms.create(A, SA, "#BLUE", cr.settings_from(3, False, "mu", 4, 30))
rid = v["id"]
check("created waiting", v["phase"] == "waiting" and v["you"] == "blue" and not v["joinable"])
check("room carries its clock", v["settings"]["clock"] == 240)
other = rooms.get(rid, B, SB)
check("a stranger sees a joinable room", other["joinable"] and other["you"] is None)
check("the host's player is shown to the guest", other["blue"]["tag"] == "#BLUE" and other["red"] is None)
check("the host's player is named before the read", other["blue"]["name"] == "Blue Name")
check("own room with the same seat refused", raises("own_room", lambda: rooms.join(rid, A, SA, "#RED")))
check("the same player refused", raises("same_player", lambda: rooms.join(rid, B, SB, "#BLUE")))
check("no seat token refused", raises("bad_seat", lambda: rooms.join(rid, B, "", "#RED")))
check("unknown room", raises("no_room", lambda: rooms.get("zzzzzzzzzz", B)))
check("malformed room id", raises("no_room", lambda: rooms.get("../../etc", B)))
j = rooms.join(rid, B, SB, "#RED")
check("joined -> reading", j["phase"] == "reading" and j["you"] == "red")
check("the guest's player is named on joining", j["red"]["name"] == "Red Name")
check("one read started", len(pending) == 1)
rooms.get(rid, B, SB)
check("a poll while reading does not start a second read", len(pending) == 1)
check("a third coach finds it full", raises("room_full", lambda: rooms.join(rid, "user-c", SA2, "#THIRD")))
check("a retried join is fine", rooms.join(rid, B, SB, "#RED")["you"] == "red")
pending.pop()()
v = rooms.get(rid, A, SA)
check("read done -> playing", v["phase"] == "playing" and len(v["games"]) == 1)
check("names from the read", v["blue"]["name"] == "Blue Player" and v["red"]["name"] == "Red Player")
check("game 1 deadline = now + clock", v["games"][0]["deadline"] - v["games"][0]["start"] == 240_000)
check("each coach gets only their own pool", v["pool"][0]["deckName"] == "B pool"
      and rooms.get(rid, B, SB)["pool"][0]["deckName"] == "R pool")

# the same account on two devices may hold both seats (testing alone)
rooms2, *_ = make()
v2 = rooms2.create(A, SA, "#BLUE", cr.settings_from())
check("same account, other device joins", rooms2.join(v2["id"], A, SA2, "#RED")["you"] == "red")
check("the seat token decides the seat", rooms2.get(v2["id"], A, SA)["you"] == "blue"
      and rooms2.get(v2["id"], A, SA2)["you"] == "red")
check("same account, no token: no seat (ambiguous)", rooms2.get(v2["id"], A, "")["you"] is None)

# ── blind lock-in ──
rooms, clock, brain, rid = started()
check("the brain was read once", brain.reads == 1)
rooms.lock(rid, A, SA, deck(0), "c00:evolution")
vb = rooms.get(rid, A, SA)
vr = rooms.get(rid, B, SB)
check("blue sees its own deck", vb["games"][0]["blue"]["cards"] == deck(0))
check("red sees only that blue locked in", vr["games"][0]["blue"] == {"locked": True})
check("red's slot empty", vr["games"][0]["red"] is None)
check("no result yet", vb["games"][0]["result"] is None)
check("a retried lock is fine", rooms.lock(rid, A, SA, deck(0))["games"][0]["blue"]["cards"] == deck(0))
check("a second deck refused", raises("already_locked", lambda: rooms.lock(rid, A, SA, deck(1))))
check("the lock names its game", rooms.lock(rid, A, SA, deck(0), "", 1)["games"][0]["blue"]["cards"] == deck(0))
check("a stranger cannot lock", raises("not_seated", lambda: rooms.lock(rid, "user-x", SA2, deck(1))))
check("seven cards refused", raises("bad_deck", lambda: rooms.lock(rid, B, SB, deck(1)[:7])))
check("an unknown card refused", raises("bad_deck", lambda: rooms.lock(rid, B, SB, deck(1)[:7] + ["nope"])))
clock.t += 30
v = rooms.lock(rid, B, SB, deck(0))  # the other side may bring the same cards
g1 = v["games"][0]
check("both in -> decided", g1["result"] is not None)
check("both decks revealed", g1["blue"]["cards"] == deck(0) and g1["red"]["cards"] == deck(0))
check("art kept", g1["blue"]["art"] == {"c00": "evolution"})
check("deck name from the brain", g1["blue"]["deckName"] == "Deck c00")
check("70% wins outright under mu", g1["result"]["winner"] == "blue" and g1["result"]["rolled"] is False)
check("matchup in percent", g1["result"]["matchup"] == 70.0)
check("game 2 opened after the reveal", len(v["games"]) == 2
      and v["games"][1]["start"] == round((clock.t + cr.REVEAL_S) * 1000))
check("game 2 clock = reveal + clock", v["games"][1]["deadline"] - v["games"][1]["start"] == 180_000)
check("next options for the caller", v["next"] and v["next"][0]["seat"] == "red" and v["next"][0]["played"] == 1)
check("a card blue played cannot come back for blue", raises("card_played", lambda: rooms.lock(rid, A, SA, deck(0))))
check("shift told nothing before game 1", brain.shifts[0] == (None, 1))
rooms.lock(rid, A, SA, deck(1))
v = rooms.lock(rid, B, SB, deck(2))
check("shift told blue won game 1", brain.shifts[1] == ("w", 2))
check("2-0 ends a best of 3", v["phase"] == "done" and v["end"]["winner"] == "blue" and v["end"]["reason"] == "score")
check("score 2-0", v["score"] == {"blue": 2, "red": 0})
check("no game 3 opened", len(v["games"]) == 2)
check("a lock after the end refused", raises("not_playing", lambda: rooms.lock(rid, A, SA, deck(3))))

# ── the clock ──
rooms, clock, brain, rid = started()
rooms.lock(rid, A, SA, deck(0))
clock.t += 179
check("still open a second before the deadline", rooms.get(rid, A, SA)["games"][0]["result"] is None)
clock.t += 2
v = rooms.get(rid, B, SB)
r1 = v["games"][0]["result"]
check("red out of time loses the game", r1["winner"] == "blue" and r1["timeout"] == "red")
check("the locked deck is shown", v["games"][0]["blue"]["cards"] == deck(0))
check("red spent no cards", v["games"][0]["red"] is None)
check("a lock for game 1 after its clock is refused", raises("too_late", lambda: rooms.lock(rid, B, SB, deck(1), "", 1)))
check("and nothing was locked for game 2", rooms.get(rid, B, SB)["games"][1]["red"] is None)
check("game 2 opens from the deadline", v["games"][1]["start"] == round((1_000_000 + 180 + cr.REVEAL_S) * 1000))
clock.t = v["games"][1]["deadline"] / 1000 + 1
v = rooms.get(rid, A, SA)
check("nobody locked in -> abandoned", v["phase"] == "done" and v["end"]["reason"] == "abandoned"
      and v["end"]["winner"] is None)

rooms, clock, brain, rid = started()
g = rooms.get(rid, A, SA)["games"][0]
rooms.lock(rid, A, SA, deck(0), "", 1)
clock.t = g["deadline"] / 1000
check("at the deadline a lock is too late", raises("too_late", lambda: rooms.lock(rid, B, SB, deck(0), "", 1)))
check("a lock for a game that is not open is too late", raises("too_late", lambda: rooms.lock(rid, A, SA, deck(0), "", 7)))

# a room nobody read for a long time catches up in one poll
rooms, clock, brain, rid = started(cr.settings_from(5, False, "mu", 2, 30))
rooms.lock(rid, A, SA, deck(0))
clock.t += 10_000
v = rooms.get(rid, A, SA)
check("catch-up: red out of time, then nobody -> abandoned", v["phase"] == "done"
      and v["games"][0]["result"]["timeout"] == "red" and v["end"]["reason"] == "abandoned")

# ── no time limit ──
check("0 = no time limit", cr.settings_from(clock=0)["clock"] == 0 and cr.settings_from(clock="0")["clock"] == 0)
rooms, clock, brain, rid = started(cr.settings_from(3, False, "mu", 0, 30))
v = rooms.get(rid, A, SA)
check("no limit: a game has no deadline", v["games"][0]["deadline"] is None)
rooms.lock(rid, A, SA, deck(0), "", 1)
clock.t += 10 * 86400 - 1
v = rooms.get(rid, B, SB)
check("no limit: a game waits for both coaches", v["games"][0]["result"] is None and v["phase"] == "playing")
v = rooms.lock(rid, B, SB, deck(1), "", 1)
check("no limit: decided when both are in", v["games"][0]["result"]["winner"] == "blue")
check("no limit: game 2 has no deadline either", v["games"][1]["deadline"] is None)

# ── luck ──
rooms, clock, brain, rid = started(cr.settings_from(3, False, "roll", 3, 30), matchup=0.60, draws=(0.5, 0.7))
rooms.lock(rid, A, SA, deck(0))
v = rooms.lock(rid, B, SB, deck(0))
check("roll: draw 50 inside 60 -> blue", v["games"][0]["result"]["winner"] == "blue"
      and v["games"][0]["result"]["rolled"] and v["games"][0]["result"]["draw"] == 50.0)
rooms.lock(rid, A, SA, deck(1))
v = rooms.lock(rid, B, SB, deck(1))
check("roll: draw 70 past 60 -> red", v["games"][1]["result"]["winner"] == "red")
check("decide: mu close is rolled", cr.decide("mu", 52, 52, 10) == ("blue", True))
check("decide: mu under 45 loses outright", cr.decide("mu", 40, 40, 1) == ("red", False))
check("decide: exactly 55 is still close", cr.decide("mu", 55, 55, 90)[1] is True)

# ── play all ──
rooms, clock, brain, rid = started(cr.settings_from(3, True, "mu", 3, 30))
for i in range(2):
    rooms.lock(rid, A, SA, deck(i))
    v = rooms.lock(rid, B, SB, deck(i))
check("play all: 2-0 plays on", v["phase"] == "playing" and len(v["games"]) == 3)
rooms.lock(rid, A, SA, deck(2))
v = rooms.lock(rid, B, SB, deck(2))
check("play all: ends after game 3", v["phase"] == "done" and v["score"] == {"blue": 3, "red": 0})

# a best of 5
rooms, clock, brain, rid = started(cr.settings_from(5, False, "mu", 3, 30), matchup=0.3)
for i in range(3):
    rooms.lock(rid, A, SA, deck(i))
    v = rooms.lock(rid, B, SB, deck(i))
check("bo5: red wins 3-0", v["phase"] == "done" and v["end"]["winner"] == "red" and v["need"] == 3)

# ── rematch ──
v = rooms.rematch(rid, A, SA)
check("one coach asking is not enough", v["phase"] == "done" and v["rematch"]["blue"] and not v["rematch"]["red"])
v = rooms.rematch(rid, B, SB)
check("both asked -> a new duel", v["phase"] == "playing" and v["round"] == 1 and len(v["games"]) == 1)
check("rematch: cards are free again", rooms.lock(rid, A, SA, deck(0))["games"][0]["blue"]["cards"] == deck(0))
check("rematch: settings kept", v["settings"]["bo"] == 5)
check("no rematch mid-duel", raises("no_rematch", lambda: rooms.rematch(rid, A, SA)))

# ── leaving ──
v = rooms.leave(rid, B, SB)
check("leaving mid-duel gives it to the other coach", v["phase"] == "done" and v["end"]["winner"] == "blue"
      and v["end"]["reason"] == "left" and v["end"]["left"] == "red")
rooms, clock, brain, pending = make()
v = rooms.create(A, SA, "#BLUE", cr.settings_from())
check("the host closes a waiting room", rooms.leave(v["id"], A, SA)["phase"] == "closed")
check("a closed room cannot be joined", raises("room_closed", lambda: rooms.join(v["id"], B, SB, "#RED")))

# ── expiry, replacing, pruning ──
rooms, clock, brain, pending = make()
v = rooms.create(A, SA, "#BLUE", cr.settings_from())
clock.t += cr.JOIN_TTL_S + 1
e = rooms.get(v["id"], B, SB)
check("nobody joined in time -> closed", e["phase"] == "closed" and e["end"]["reason"] == "expired")
check("an expired room cannot be rematched", raises("not_seated", lambda: rooms.rematch(v["id"], B, SB)))
v1 = rooms.create(A, SA, "#BLUE", cr.settings_from())
v2 = rooms.create(A, SA, "#BLUE", cr.settings_from())
check("a new room closes the host's waiting one", rooms.get(v1["id"], A, SA)["phase"] == "closed"
      and rooms.get(v2["id"], A, SA)["phase"] == "waiting")
check("ids differ", v1["id"] != v2["id"])
clock.t += cr.KEEP_S + 10
rooms.create(A, SA, "#BLUE", cr.settings_from())
check("old rooms are deleted", raises("no_room", lambda: rooms.get(v1["id"], A, SA)))

# ── a failed read, and a read lost to a restart ──
rooms, clock, brain, pending = make()
brain.fail = cr.RoomError("no_brain")
v = rooms.create(A, SA, "#BLUE", cr.settings_from())
v = rooms.join(v["id"], B, SB, "#RED")
check("a failed read is an error the screen can word", v["phase"] in ("reading", "error"))
v = rooms.get(v["id"], A, SA)
check("error phase with its code", v["phase"] == "error" and v["error"] == "no_brain")
rooms, clock, brain, pending = make(spawn_now=False)
v = rooms.create(A, SA, "#BLUE", cr.settings_from())
rooms.join(v["id"], B, SB, "#RED")
pending.clear()
rooms._reading.clear()  # what a restart looks like: a room in reading, no thread
rooms.get(v["id"], A, SA)
check("a poll restarts a lost read", len(pending) == 1)
pending.pop()()
check("and the room plays", rooms.get(v["id"], A, SA)["phase"] == "playing")

# ── the file is the state ──
rooms, clock, brain, rid = started()
rooms.lock(rid, A, SA, deck(0))
fresh = cr.Rooms(cr.Store(rooms.store.path), brain, clock=clock, rng=Draws(0.5), spawn=lambda f: f(),
                 known=lambda: set(CARDS))
check("another process reads the same room", fresh.get(rid, B, SB)["games"][0]["blue"] == {"locked": True})
check("and finishes the game", fresh.lock(rid, B, SB, deck(1))["games"][0]["result"]["winner"] == "blue")

# ── slow brain work happens outside the room's lock ──
rooms, clock, brain, rid = started()
held = []
orig_ref, orig_next = brain.referee, brain.next_options
brain.referee = lambda room, b, r: (held.append(rooms.store.lock_for(rid).locked()), orig_ref(room, b, r))[1]
brain.next_options = lambda room, seat, d: (held.append(rooms.store.lock_for(rid).locked()), orig_next(room, seat, d))[1]
rooms.lock(rid, A, SA, deck(0), "", 1)
v = rooms.lock(rid, B, SB, deck(1), "", 1)
check("the game was decided", v["games"][0]["result"]["winner"] == "blue")
check("rated and next decks worked out with the lock free", held and not any(held))
check("next decks stored once per game", len([h for h in held]) == 3)
rooms.get(rid, A, SA)
check("a poll does not work them out again", len(held) == 3)

# a poll never decides a game both coaches locked in (the lock request does);
# past the deadline it does
rooms, clock, brain, rid = started()
def both_in(r, n):
    g = r["games"][-1]
    g["blue"] = {"cards": deck(0), "art": {}, "deckName": None, "at": n}
    g["red"] = {"cards": deck(1), "art": {}, "deckName": None, "at": n}
rooms._with(rid, both_in)
check("a poll leaves it to the lock request", rooms.get(rid, A, SA)["games"][0]["result"] is None)
clock.t += 181
check("past the deadline a poll decides it", rooms.get(rid, A, SA)["games"][0]["result"]["winner"] == "blue")

# ── what a view must never carry ──
rooms, clock, brain, rid = started()
v = rooms.get(rid, B, SB)
flat = str(v)
check("no account ids in a view", A not in flat and B not in flat)
check("no seat hashes in a view", cr._hash(SA) not in flat and cr._hash(SB) not in flat)
check("times in ms", v["now"] == round(clock.t * 1000))

print("%d passed, %d failed" % (PASSED, FAILED))
sys.exit(1 if FAILED else 0)
