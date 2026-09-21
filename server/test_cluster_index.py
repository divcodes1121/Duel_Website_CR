"""cluster_index: the precomputed path must give the live path's answers EXACTLY.

Runs against a synthetic bot database in a temp directory; nothing touches the
real one. The live answers are computed FIRST, with no index on disk, so the
comparison is between two independent calculations over the same rows — not
between the index and itself.

    python server/test_cluster_index.py
"""
from __future__ import annotations

import os
import random
import shutil
import sqlite3
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clash_data as cd  # noqa: E402
import cluster_index as ci  # noqa: E402
import deck_counter as dcx  # noqa: E402

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


# ── A synthetic bot database ────────────────────────────────────────────────

# Real card keys, so `_archetype_of_hash` classifies them the way it does in
# production: several win conditions, bait markers, miner, and fillers.
WINCONS = [c for c in dcx.WIN_CONDITION_PRIORITY][:10]
FILLER = ["knight", "archers", "fireball", "the-log", "zap", "musketeer",
          "ice-spirit", "skeletons", "valkyrie", "tesla", "cannon", "arrows",
          "bats", "minions", "goblin-gang", "poison", "tornado", "guards",
          "electro-wizard", "mega-minion", "baby-dragon", "inferno-tower"]
POOL = sorted(set(WINCONS + FILLER + ["miner", "goblin-barrel"]))

rng = random.Random(20260921)


def key(cards):
    return ",".join(sorted(set(cards)))


def variant(base, swaps):
    """`base` with `swaps` cards replaced — a sibling at 8 - swaps shared."""
    out = list(base)
    spare = [c for c in POOL if c not in base]
    rng.shuffle(spare)
    for i, pos in enumerate(rng.sample(range(8), swaps)):
        out[pos] = spare[i]
    return out


BASES = [rng.sample(POOL, 8) for _ in range(6)]
DECKS: list[list[str]] = []
for b in BASES:
    DECKS.append(b)
    for swaps in (1, 1, 2, 2, 2, 3, 4):
        DECKS.append(variant(b, swaps))
DECKS += [rng.sample(POOL, 8) for _ in range(40)]
HASHES = sorted({key(d) for d in DECKS})


def make_bot(path: str, hashes: list[str], extra_pairs: list[tuple] = ()) -> None:
    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE decks (deck_hash TEXT PRIMARY KEY, cards TEXT, avg_elixir REAL,
                            archetype TEXT, win_condition TEXT, cycle_type TEXT,
                            rarity_score INTEGER);
        CREATE TABLE pair_matchup_agg (
            deck_a TEXT, deck_b TEXT, a_wins INTEGER, a_losses INTEGER,
            a_draws INTEGER, games INTEGER, level_capped INTEGER, last_seen TEXT,
            a_crowns INTEGER DEFAULT 0, b_crowns INTEGER DEFAULT 0,
            a_three INTEGER DEFAULT 0, b_three INTEGER DEFAULT 0,
            first_seen TEXT DEFAULT '', PRIMARY KEY (deck_a, deck_b));
        CREATE INDEX ix_pair_a ON pair_matchup_agg(deck_a);
        CREATE INDEX ix_pair_b ON pair_matchup_agg(deck_b);
        """
    )
    con.executemany("INSERT INTO decks(deck_hash) VALUES (?)", [(h,) for h in hashes])
    r = random.Random(7)
    rows = set()
    for a in hashes:
        for b in r.sample(hashes, 12):
            if a == b or (a, b) in rows:
                continue
            rows.add((a, b))
            w, l, d = r.randint(0, 30), r.randint(0, 30), r.randint(0, 2)
            # Some NULLs, because the live path reads `x or 0` and the build
            # must treat them identically.
            nul = r.random() < 0.05
            con.execute(
                "INSERT INTO pair_matchup_agg (deck_a, deck_b, a_wins, a_losses, a_draws, games,"
                " a_crowns, b_crowns, a_three, b_three) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (a, b, w, l, None if nul else d, w + l + d, r.randint(0, 60),
                 r.randint(0, 60), None if nul else r.randint(0, 9), r.randint(0, 9)))
    for row in extra_pairs:
        con.execute(
            "INSERT INTO pair_matchup_agg (deck_a, deck_b, a_wins, a_losses, a_draws,"
            " games) VALUES (?,?,?,?,?,?)", row)
    con.commit()
    con.close()


TMP = tempfile.mkdtemp(prefix="cluster-index-")
BOT = os.path.join(TMP, "battles.db")
INDEX = os.path.join(TMP, "index.db")
make_bot(BOT, HASHES)

_orig_tiers = cd._tier_paths
cd._tier_paths = lambda: [BOT]
ci.PATH = INDEX


def fresh():
    """Forget everything cached between phases."""
    dcx._VOCAB = None
    dcx._CLUSTER_CACHE.clear()
    dcx._PROFILE_CACHE.clear()
    ci._state.update(builtAt=None, bits=None, names=None, meta={}, checked=0.0)


try:
    # ── 1. The live answers, with no index on disk ──────────────────────────
    print("\nlive baseline")
    fresh()
    check("no index file yet", not os.path.exists(INDEX))
    check("profiles() says None without an index", ci.profiles(BASES[0], dcx.CLUSTER_LEVELS) is None)
    PROBES = BASES + [DECKS[7], DECKS[20], DECKS[-1]]
    LIVE = {key(c): dcx._cluster_all(c) for c in PROBES}
    LIVE_SIBS = {key(c): dcx._siblings(c) for c in PROBES}
    LIVE_EXACT = {key(c): dcx.deck_profile(c) for c in PROBES}
    check("the synthetic data really has siblings at 6 and 7",
          any(n == 7 for s in LIVE_SIBS.values() for n in s.values())
          and any(n == 6 for s in LIVE_SIBS.values() for n in s.values()))
    check("and at least one level with archetype records",
          any(LIVE[k][6]["archetypes"] for k in LIVE))

    # ── 2. Build, then the same questions through the index ─────────────────
    print("\nbuild")
    summary = ci.build(INDEX, BOT)
    check("build reports every deck", summary["decks"] == len(HASHES), str(summary))
    check("build reports rows", summary["rows"] > 0)
    check("no orphan rows in a clean database", summary["orphanRows"] == 0)
    fresh()
    check("the index is usable for the database it summed",
          ci.profiles(BASES[0], dcx.CLUSTER_LEVELS) is not None)

    print("\nexact agreement")
    for c in PROBES:
        k = key(c)
        got = ci.profiles(list(set(c)), dcx.CLUSTER_LEVELS)
        check(f"profiles == live for {k[:40]}", got == LIVE[k],
              f"\n  index {got}\n  live  {LIVE[k]}")
        check(f"siblings == live for {k[:40]}", ci.siblings(c, 6) == LIVE_SIBS[k])

    for c in PROBES:
        check(f"exact == live deck_profile for {key(c)[:40]}",
              ci.exact(c) == LIVE_EXACT[key(c)])
    fresh()
    check("deck_counter.deck_profile answers from the index, identically",
          {key(c): dcx.deck_profile(c) for c in PROBES} == LIVE_EXACT)
    check("a deck the index has never seen -> None, so it is read live",
          ci.exact(["x-bow", "tesla", "knight", "archers", "skeletons",
                    "ice-spirit", "fireball", "the-log"]) is None)

    print("\nquery plan")
    # THE 60x TRAP. With a plain JOIN SQLite scanned every deck_arch row and
    # probed the siblings (870 ms a deck on production); every equality check
    # above would still pass. The plan is the only thing that shows it.
    pc = ci._ro(INDEX)
    pc.execute("CREATE TEMP TABLE s(id INTEGER PRIMARY KEY, n INTEGER NOT NULL)")
    plan = " | ".join(r[3] for r in pc.execute("EXPLAIN QUERY PLAN " + ci._profile_sql(dcx.CLUSTER_LEVELS)))
    pc.close()
    check("siblings are the outer loop and deck_arch is SEARCHED by key",
          plan.startswith("SCAN s") and "SEARCH x USING PRIMARY KEY" in plan, plan)

    fresh()
    via = {key(c): dcx._cluster_all(c) for c in PROBES}
    check("deck_counter._cluster_all now answers from the index, identically",
          via == LIVE)
    check("and it did use the index (no vocabulary was loaded)", dcx._VOCAB is None)
    check("cluster_profile reads the same through the cache",
          dcx.cluster_profile(BASES[0], 7) == LIVE[key(BASES[0])][7])

    # ── 3. It never serves another database's numbers ───────────────────────
    print("\nsource guard")
    other = os.path.join(TMP, "other.db")
    shutil.copy(BOT, other)
    cd._tier_paths = lambda: [other]
    fresh()
    check("a different resolved database -> no index", ci.profiles(BASES[0], dcx.CLUSTER_LEVELS) is None)
    check("and deck_counter falls back to the live path",
          dcx._cluster_all(BASES[0]) == LIVE[key(BASES[0])])
    cd._tier_paths = lambda: [BOT]

    # ── 4. Ids are stable across builds ─────────────────────────────────────
    print("\nstable ids")
    con = sqlite3.connect(INDEX)
    before = dict(con.execute("SELECT hash, id FROM deck"))
    con.close()
    new_decks = [key(variant(BASES[1], 1)) for _ in range(5)]
    new_decks = [h for h in dict.fromkeys(new_decks) if h not in before]
    b2 = sqlite3.connect(BOT)
    b2.executemany("INSERT INTO decks(deck_hash) VALUES (?)", [(h,) for h in new_decks])
    for h in new_decks:
        b2.execute("INSERT INTO pair_matchup_agg (deck_a, deck_b, a_wins, a_losses, a_draws, games)"
                   " VALUES (?, ?, 11, 4, 0, 15)", (h, HASHES[0]))
    b2.commit()
    b2.close()
    time.sleep(1.1)  # builtAt has one-second resolution
    s2 = ci.build(INDEX, BOT)
    con = sqlite3.connect(INDEX)
    after = dict(con.execute("SELECT hash, id FROM deck"))
    con.close()
    check("new decks are appended", s2["newDecks"] == len(new_decks) and len(new_decks) > 0,
          str(s2))
    check("every old deck keeps its id", all(after[h] == i for h, i in before.items()))
    check("new ids come after every old one",
          min(after[h] for h in new_decks) > max(before.values()))

    fresh()
    dcx._VOCAB = None
    gen0 = ci.generation()
    live2 = {}
    # The live path again, over the CHANGED database, with the index hidden.
    ci_path, ci.PATH = ci.PATH, os.path.join(TMP, "absent.db")
    fresh()
    for c in (BASES[1], BASES[0]):
        live2[key(c)] = dcx._cluster_all(c)
    ci.PATH = ci_path
    fresh()
    for c in (BASES[1], BASES[0]):
        check(f"after a rebuild, still == live for {key(c)[:40]}",
              ci.profiles(list(set(c)), dcx.CLUSTER_LEVELS) == live2[key(c)])
    check("a newly loaded build is a new cache generation", ci.generation() > gen0)

    # ── 5. A changed classifier re-classifies every stored deck ─────────────
    print("\nclassifier")
    con = sqlite3.connect(INDEX)
    con.execute("UPDATE meta SET v = 'stale' WHERE k = 'classifier'")
    con.commit()
    con.close()
    time.sleep(1.1)
    s3 = ci.build(INDEX, BOT)
    check("a changed rule re-classifies all of them", s3["reclassified"] == s3["decks"], str(s3))
    check("an unchanged rule re-classifies none",
          (time.sleep(1.1), ci.build(INDEX, BOT))[1]["reclassified"] == 0)

    # ── 6. Orphans are counted, never silent ────────────────────────────────
    print("\norphans")
    bot3 = os.path.join(TMP, "orphan.db")
    make_bot(bot3, HASHES, extra_pairs=[("ghost,deck,not,in,the,decks,table,x", HASHES[0], 3, 1, 0, 4)])
    s4 = ci.build(os.path.join(TMP, "orphan-index.db"), bot3)
    check("a pair row whose deck is missing from `decks` is counted", s4["orphanRows"] == 1, str(s4))

    # ── 7. The pieces ───────────────────────────────────────────────────────
    print("\nbit arithmetic")
    check("_ids reads set bits as 1-based deck ids", ci._ids(0b1011) == [1, 2, 4])
    check("_ids of nothing is nothing", ci._ids(0) == [])
    check("_ids across byte boundaries", ci._ids((1 << 8) | (1 << 17)) == [9, 18])
    masks = [0b1111, 0b0111, 0b0011, 0b0001]
    check("_at_least counts cards held", ci._at_least(masks, 4) == 0b0001
          and ci._at_least(masks, 3) == 0b0011 and ci._at_least(masks, 1) == 0b1111)
    check("_at_least of more cards than asked is nothing", ci._at_least(masks, 5) == 0)
    check("CLUSTER_LEVELS are what the index serves", dcx.CLUSTER_LEVELS == (7, 6))

    print("\nstatus")
    fresh()
    st = ci.status()
    check("status says available with counts and an age",
          st["available"] and st["decks"] == s3["decks"] and st["ageSeconds"] is not None
          and st["ageSeconds"] < 600, str(st))
    check("deck_counter.vocabulary_size() counts from the index",
          dcx.vocabulary_size() == st["decks"] and dcx._VOCAB is None)

    print("\ncache")
    lru = dcx._LRU(3, ttl=60)
    for i in range(4):
        lru[i] = i
    check("an LRU forgets only the oldest entry, never the lot",
          0 not in lru and all(i in lru for i in (1, 2, 3)))
    lru.get(1)
    lru[9] = 9
    check("and a read keeps an entry alive", 1 in lru and 2 not in lru)
    short = dcx._LRU(10, ttl=0.05)
    short["a"] = 1
    time.sleep(0.08)
    check("an entry past its age is gone", "a" not in short)
    check("clear() still works for the suites that call it",
          (lru.clear(), len(lru))[1] == 0)
finally:
    cd._tier_paths = _orig_tiers
    shutil.rmtree(TMP, ignore_errors=True)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
