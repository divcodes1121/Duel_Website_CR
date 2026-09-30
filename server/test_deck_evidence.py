"""test_deck_evidence.py — the vetting every suggested deck passes.

    python server/test_deck_evidence.py

Literals and an in-memory SQLite with the bot's three tables; the cache file is
redirected to a temp path, so nothing real is read or written.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import battle_modes as bm  # noqa: E402
import deck_evidence as dev  # noqa: E402

PASS = 0
FAIL = 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


CUT = "20260831T000000.000Z"
FRESH = "20260929T120000.000Z"


def prof(**kw):
    p = {"games": 1000, "pilots": 200, "top": 40, "last": FRESH, "own": 0.95, "sampled": 60}
    p.update(kw)
    return p


print("\nverdict")
check("a real, current, widely played own-deck list passes", dev.verdict(prof(), CUT) is None)
check("two pilots is few_pilots", dev.verdict(prof(pilots=2), CUT) == "few_pilots")
check("fifteen pilots is still few_pilots (the 3M lists the replay showed)",
      dev.verdict(prof(pilots=15, top=100), CUT) == "few_pilots")
check("MIN_PILOTS exactly passes", dev.verdict(prof(pilots=dev.MIN_PILOTS), CUT) is None)
check("one pilot with 96% of the games is one_pilot (the 3 Musketeers list)",
      dev.verdict(prof(pilots=40, games=743, top=711), CUT) == "one_pilot")
check("exactly half is allowed", dev.verdict(prof(games=100, top=50), CUT) is None)
check("no games is few_pilots, never a division by zero", dev.verdict(prof(games=0, top=0), CUT) == "few_pilots")
check("last seen before the cutoff is stale", dev.verdict(prof(last="20260715T160356.000Z"), CUT) == "stale")
check("a mostly-event list is event (the Royale Shuffle decks)",
      dev.verdict(prof(own=0.05, sampled=40), CUT) == "event")
check("own share at the floor passes", dev.verdict(prof(own=dev.MIN_OWN_SHARE), CUT) is None)
check("too few sampled battles cannot condemn a deck", dev.verdict(prof(own=0.0, sampled=2), CUT) is None)
check("an unmeasured share is not judged", dev.verdict(prof(own=None, sampled=0), CUT) is None)
check("cheapest reason first: a one-pilot event deck reads few_pilots",
      dev.verdict(prof(pilots=1, own=0.0), CUT) == "few_pilots")

print("\npilot_adjusted")
check("pilots winning exactly their usual rate add nothing",
      abs(dev.pilot_adjusted([(100, 60, 1100, 660)])) < 1.0, dev.pilot_adjusted([(100, 60, 1100, 660)]))
check("a list its pilots win more with adds points",
      dev.pilot_adjusted([(100, 70, 1100, 570)]) > 15)
check("a strong pilot's record is not the deck's (70% pilot, 70% on it -> ~0)",
      abs(dev.pilot_adjusted([(200, 140, 2200, 1540)])) < 1.5)
check("no games is None", dev.pilot_adjusted([]) is None)
check("a pilot with no other games is shrunk to 50%",
      dev.pilot_adjusted([(10, 5, 10, 5)]) == 0.0)

print("\npublic carries no player")
pub = dev.public(prof(top=40, games=1000, adds=2.5))
check("shares and counts only", set(pub) == {"pilots", "topShare", "ownShare", "adds", "lastSeen", "brain"}, pub)
check("top share is a fraction", pub["topShare"] == 0.04)
check("stamp matches battle_time form", dev.stamp(__import__("datetime").date(2026, 9, 1)) == "20260901T000000.000Z")


print("\nvet_pool on a synthetic database")
tmp = tempfile.mkdtemp()
dev.PATH = os.path.join(tmp, "ev.json")
dev._cache = None
con = sqlite3.connect(":memory:")
con.executescript("""
CREATE TABLE player_deck_agg(player_tag TEXT, deck_hash TEXT, battles INT, wins INT, draws INT,
                             archetype TEXT, last_seen TEXT);
CREATE TABLE player_stats_agg(player_tag TEXT PRIMARY KEY, battles INT, wins INT);
CREATE TABLE battles(player_tag TEXT, player_deck_hash TEXT, game_mode TEXT);
""")
H = {n: ",".join(sorted(f"{n}{i}" for i in range(8))) for n in ("real", "event", "solo", "old", "next", "spare")}


def add(h, pilots, per, mode, last=FRESH, wins_frac=0.55):
    for i in range(pilots):
        tag = f"#{h[:3]}{i}"
        con.execute("INSERT INTO player_deck_agg VALUES(?,?,?,?,0,'x',?)",
                    (tag, h, per, int(per * wins_frac), last))
        con.execute("INSERT OR REPLACE INTO player_stats_agg VALUES(?,?,?)", (tag, per * 5, per * 5 // 2))
        for _ in range(per):
            con.execute("INSERT INTO battles VALUES(?,?,?)", (tag, h, mode))


add(H["real"], 30, 5, "Ranked1v1_NewArena2")
add(H["event"], 60, 1, "RR_Rage_Friendly")
add(H["solo"], 30, 1, "Ladder")
con.execute("INSERT INTO player_deck_agg VALUES('#SOLO', ?, 200, 150, 0, 'x', ?)", (H["solo"], FRESH))
add(H["old"], 30, 5, "Ladder", last="20260701T000000.000Z")
add(H["next"], 30, 5, "Ladder")
add(H["spare"], 30, 5, "Ladder")
H["thin"] = ",".join(sorted(f"thin{i}" for i in range(8)))
add(H["thin"], 10, 5, "Ladder")
pool = {"hog": [{"hash": H[n], "cards": H[n].split(","), "games": 999 - i}
                for i, n in enumerate(("event", "solo", "old", "thin", "real", "next", "spare"))]}
now = time.mktime((2026, 9, 30, 12, 0, 0, 0, 0, 0))
out, rep = dev.vet_pool(con, pool, 2, is_own_deck=bm.is_own_deck_1v1, now=now)
kept = [d["hash"] for d in out["hog"]]
check("keeps exactly `keep` decks, skip-and-replace", kept == [H["real"], H["next"]], kept)
check("the event deck is refused as event", rep["rejected"]["event"] == 1, rep)
check("the one-pilot deck is refused", rep["rejected"]["one_pilot"] == 1, rep)
check("the stale deck is refused", rep["rejected"]["stale"] == 1, rep)
check("the ten-pilot deck is refused as few_pilots", rep["rejected"]["few_pilots"] == 1, rep)
check("a deck past `keep` is never vetted (spare)", dev.known(H["spare"]) is None)
check("kept decks carry their evidence", out["hog"][0]["evidence"]["pilots"] == 30
      and out["hog"][0]["evidence"]["ownShare"] == 1.0, out["hog"][0].get("evidence"))
check("the verdicts are cached for request-time reads",
      dev.known(H["event"])["verdict"] == "event" and dev.known(H["real"])["verdict"] is None)
check("no player tag reaches the cache", "#" not in open(dev.PATH, encoding="utf-8").read())

sampled_first = rep["sampled"]
out2, rep2 = dev.vet_pool(con, pool, 2, is_own_deck=bm.is_own_deck_1v1, now=now + 60)
check("a second build within the TTL samples nothing again", rep2["sampled"] == 0 and sampled_first > 0, rep2)
check("and decides the same", [d["hash"] for d in out2["hog"]] == kept)
out3, rep3 = dev.vet_pool(con, pool, 2, is_own_deck=bm.is_own_deck_1v1, now=now + dev.CACHE_TTL + 60)
check("past the TTL it measures again", rep3["sampled"] > 0, rep3)
check("a stale-rejected deck is never cached as measured",
      (dev.known(H["old"]) or {}).get("measured") is False, dev.known(H["old"]))


print("\nnothing here calls a model or the network")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "deck_evidence.py"), encoding="utf-8").read()
check("no ml import", "import ml" not in src and "from ml" not in src)
check("no network", "urlopen" not in src and "requests." not in src)
check("no write to the bot's database", "INSERT" not in src and "UPDATE " not in src and "DELETE" not in src)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
