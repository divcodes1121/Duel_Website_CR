"""Checks for card_matchup_train.py — the design, the fit, the gate, and above
all that the trainer and the runtime agree on what a weight MEANS.

Needs numpy and scipy (the trainer's own dependency). Where they are not
installed — the web service's machine path, a fresh checkout — it says so and
passes nothing: run it with `CLASH_ML_PKGS` pointing at them.

Writes its own temp SQLite file and pickle; nothing touches the real database.
"""
import json
import os
import pickle
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import card_matchup_train as tr
    import numpy as np
except ImportError as exc:  # numpy / scipy not on this machine
    print(f"0 passed, 0 failed (skipped: {exc})")
    sys.exit(0)
import card_matchup as cm  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print(f"FAIL: {name} {detail}")


KEYS = tr.card_keys()
IDX = {k: i for i, k in enumerate(KEYS)}
NC = len(KEYS)
rng = np.random.default_rng(3)

# ── columns ──────────────────────────────────────────────────────────────────
cols = {(lo, hi): tr.pair_index(lo, hi, 7) for lo in range(7) for hi in range(lo + 1, 7)}
check("every pair has its own column, 0 .. n(n-1)/2 - 1",
      sorted(cols.values()) == list(range(21)), str(sorted(cols.values())))
check("the catalogue is sorted, so a lower index is a lower key",
      KEYS == sorted(KEYS) and NC >= 100)


def decks(n, pool=None):
    pool = np.arange(NC) if pool is None else np.asarray(pool)
    return np.array([rng.choice(pool, size=8, replace=False) for _ in range(n)], dtype=np.int16)


# ── THE CROSS-CHECK: a weight the trainer exports is the weight the runtime reads
A, B = decks(300, np.arange(30)), decks(300, np.arange(30))   # 30 cards: decks overlap
X = tr.design(A, B, NC)
theta = np.zeros(X.shape[1] + 1)
theta[:-1] = rng.normal(0, 0.3, X.shape[1])
model = cm.prepare(tr.export(theta, KEYS))
by_design = X @ theta[:-1]
by_runtime = np.array([cm.raw(model, [KEYS[i] for i in a], [KEYS[j] for j in b])
                       for a, b in zip(A, B)])
check("the fixture's decks share cards", any(set(a) & set(b) for a, b in zip(A, B)))
check("design x weights == card_matchup.raw on the exported artifact, every row",
      float(np.abs(by_design - by_runtime).max()) < 2e-3,
      str(float(np.abs(by_design - by_runtime).max())))
check("...and through the prepared-opponent path",
      all(abs(cm.score(cm.vector(model, [KEYS[j] for j in b]), [KEYS[i] for i in a]) - z) < 2e-3
          for a, b, z in zip(A[:50], B[:50], by_design[:50])))
check("the design is antisymmetric: swapping the decks flips the sign",
      float(np.abs(tr.design(B, A, NC) @ theta[:-1] + by_design).max()) < 1e-4)
check("every row has the same number of entries, so nothing is copied to build it",
      X.nnz == len(A) * tr.ROW_NNZ and X.indices.dtype == np.int32)
same = tr.design(A[:5], A[:5], NC) @ theta[:-1]
check("a deck against itself is nothing", float(np.abs(same).max()) < 1e-5, str(same))
big = tr.design(decks(1000), decks(1000), NC)
check("columns stay inside the matrix on the whole catalogue",
      int(big.indices.max()) < big.shape[1] and int(big.indices.min()) >= 0)
exp = tr.export(theta, KEYS)
check("an exported pair key is 'lower|higher'",
      all(k.split("|")[0] < k.split("|")[1] for k in exp["pair"]) and len(exp["pair"]) > 400)

# ── the fit recovers what was planted ────────────────────────────────────────
POOL = np.arange(16)                      # 16 cards, so every pair meets often
TRUE_MAIN = {2: 0.5}
TRUE_PAIR = {(0, 1): 1.2, (3, 5): -0.9}   # card 0 beats card 1; card 5 beats card 3


def truth(a, b):
    z = sum(TRUE_MAIN.get(int(i), 0) for i in a) - sum(TRUE_MAIN.get(int(j), 0) for j in b)
    for i in a:
        for j in b:
            i_, j_ = int(i), int(j)
            if (i_, j_) in TRUE_PAIR:
                z += TRUE_PAIR[(i_, j_)]
            if (j_, i_) in TRUE_PAIR:
                z -= TRUE_PAIR[(j_, i_)]
    return z


def games(n, signal=True, pilot_sd=0.0):
    a, b = decks(n, POOL), decks(n, POOL)
    pil = rng.normal(0, pilot_sd, n) if pilot_sd else np.zeros(n)
    z = np.array([truth(x, y) for x, y in zip(a, b)]) if signal else np.zeros(n)
    y = (rng.random(n) < tr.sig(z + pil)).astype(np.float64)
    return a, b, y, pil


GA, GB, GY, _ = games(30_000)
Xg = tr.design(GA, GB, NC)
th = tr.fit(Xg, np.zeros(len(GY)), GY, 1 - GY, NC)
got = cm.prepare(tr.export(th, KEYS))
k = KEYS
check("a planted 'card 0 beats card 1' comes back with its sign and most of its size",
      0.6 < got["x"][k[0]][k[1]] < 1.5, str(got["x"][k[0]].get(k[1])))
check("a planted 'card 5 beats card 3' comes back the right way round",
      got["x"][k[5]][k[3]] > 0.4 and got["x"][k[3]][k[5]] < -0.4, str(got["x"][k[3]].get(k[5])))
check("a planted main effect comes back", 0.25 < got["main"][k[2]] - got["main"][k[7]] < 0.8,
      f"{got['main'].get(k[2])} {got['main'].get(k[7])}")
unplanted = [abs(got["x"][k[i]].get(k[j], 0.0)) for i in range(8, 16) for j in range(i + 1, 16)]
check("pairs nothing was planted on stay small", max(unplanted) < 0.35, str(max(unplanted)))
check("the pilot coefficient is free and starts at 1", abs(th[-1] - 1.0) < 1e-6)

# WHO PLAYED IS NOT CREDITED TO THE CARDS: strong pilots always hold card 9.
n = 20_000
a, b = decks(n, POOL), decks(n, POOL)
strong = np.array([9 in set(x) for x in a]).astype(float) - np.array([9 in set(x) for x in b])
pil = 1.0 * strong                         # holding card 9 = a stronger pilot, nothing else
y = (rng.random(n) < tr.sig(pil)).astype(np.float64)
naive = cm.prepare(tr.export(tr.fit(tr.design(a, b, NC), np.zeros(n), y, 1 - y, NC), KEYS))
fair = cm.prepare(tr.export(tr.fit(tr.design(a, b, NC), pil, y, 1 - y, NC), KEYS))
check("without the pilots' term the card takes the credit",
      naive["main"].get(k[9], 0.0) - naive["main"].get(k[10], 0.0) > 0.4,
      str(naive["main"].get(k[9])))
check("with it the card is worth nothing, which is the truth",
      abs(fair["main"].get(k[9], 0.0) - fair["main"].get(k[10], 0.0)) < 0.2,
      f"{fair['main'].get(k[9])} {fair['main'].get(k[10])}")

nu = tr.fit_nuisance(np.array([1.0, -1.0, 2.0, -2.0] * 500), np.zeros(2000),
                     np.array([1.0, 0.0, 1.0, 0.0] * 500))
check("the nuisance fit gives the pilots' gap a positive weight", nu[0] > 1.0, str(nu))

# ── reading ──────────────────────────────────────────────────────────────────
tmp = tempfile.mkdtemp(prefix="card-matchup-train-test-")
db = os.path.join(tmp, "battles.db")
con = sqlite3.connect(db)
con.execute("create table pair_matchup_agg (deck_a text, deck_b text, a_wins int, a_losses int)")


def key_of(ix):
    return ",".join(sorted(KEYS[int(i)] for i in ix))


LA, LB, LY, _ = games(6000)
rows = [(key_of(x), key_of(y_), int(w), int(1 - w)) for x, y_, w in zip(LA, LB, LY)]
rows += [(key_of(LA[0]), key_of(LB[0]), 30, 10)]                    # a pair with 40 games
rows += [(key_of(LA[1]), key_of(LB[1]), 0, 0)]                      # no decided game
rows += [("not,a,real,deck,of,eight,known,cards", key_of(LB[2]), 1, 0)]
rows += [(",".join(KEYS[:7]), key_of(LB[3]), 1, 0)]                 # seven cards
con.executemany("insert into pair_matchup_agg values (?, ?, ?, ?)", rows)
con.commit()
con.close()
RA, RB, RW, RL, stats = tr.read_ladder(db, IDX)
check("the ladder read keeps every decided pair of two known decks",
      stats["ladderPairs"] == 6001 and stats["ladderGames"] == 6040, str(stats))
check("...and drops the undecided, the unknown and the seven-card rows",
      len(RW) == 6001 and float((RW + RL).sum()) == 6040.0)
_saved_sample = tr.SINGLE_SAMPLE
tr.SINGLE_SAMPLE = 1000
SA, SB, SW, SL, sstats = tr.read_ladder(db, IDX)
tr.SINGLE_SAMPLE = _saved_sample
check("a sample of the single-game pairs stands for all of them, by weight",
      sstats["ladderRows"] == 1001 and abs(float((SW + SL).sum()) - 6040.0) < 1e-6,
      f"{sstats} {float((SW + SL).sum())}")
check("...and the pair with many games is kept whole", float((SW + SL).max()) == 40.0)

cache = os.path.join(tmp, "duel_games.pkl")
G = [("20261001T000000.000Z", 0, "#A", "#B", [KEYS[i] for i in GA[0]], [KEYS[i] for i in GB[0]], 0.5, 2.0, 1),
     ("20261001T000000.000Z", 1, "#A", "#B", [KEYS[i] for i in GA[1]], [KEYS[i] for i in GB[1]], 0.0, 0.0, 1),
     ("20261002T000000.000Z", 0, "#B", "#A", [KEYS[i] for i in GA[2]], [KEYS[i] for i in GB[2]], 1.0, 0.0, 0),
     ("20261003T000000.000Z", 0, "#A", "#C", ["no-such-card"] * 8, [KEYS[i] for i in GB[3]], 0.0, 0.0, 1)]
with open(cache, "wb") as f:
    pickle.dump({"games": list(reversed(G))}, f)
DA, DB, DY, DP, DV = tr.read_duels(IDX, cache)
check("duel games come back oldest first, the unreadable one dropped",
      len(DY) == 3 and list(DY) == [1.0, 1.0, 0.0])
check("the first game knows nothing of either pilot", DP[0] == 0.0)
check("the second already knows the first: the winner is ahead", DP[1] > 0.0, str(DP))
check("...from whichever side they are stored on", DP[2] < 0.0, str(DP))
check("the level term is THEIR deficit minus ours", list(DV) == [1.5, 0.0, -1.0], str(DV))
check("no cache is no duels, not an error", tr.read_duels(IDX, os.path.join(tmp, "missing.pkl")) is None)
_cut = tr.read_duels(IDX, cache, before="20261002")
check("a replay's cut keeps only the duel games before it", len(_cut[2]) == 2 and list(_cut[2]) == [1.0, 1.0])

# ── the gate, end to end ─────────────────────────────────────────────────────


def write_cache(signal):
    a, b, y, _p = games(8000, signal=signal)
    gs = [(f"202610{1 + i // 800:02d}T{i % 800:06d}.000Z", 0, f"#P{i % 400}", f"#Q{i % 399}",
           [KEYS[c] for c in x], [KEYS[c] for c in y_], 0.0, 0.0, int(w))
          for i, (x, y_, w) in enumerate(zip(a, b, y))]
    with open(cache, "wb") as f:
        pickle.dump({"games": gs}, f)


out = os.path.join(tmp, "card_matchup.json")
os.environ["CLASH_DB_PATH"] = db
tr.DUEL_CACHE = cache
_saved_path, cm.PATH = cm.PATH, out
_saved_read = tr.read_duels
tr.read_duels = lambda idx, path=None, before=None: _saved_read(idx, cache, before)
try:
    write_cache(signal=True)
    code = tr.main([])
    body = json.load(open(out, encoding="utf-8")) if os.path.exists(out) else {}
    check("with a real signal the model is saved", code == 0 and body.get("brain") == cm.BRAIN, str(code))
    check("...with what it measured on the games it had not seen",
          body.get("meta", {}).get("holdout", {}).get("gain", 0) >= tr.MIN_GAIN
          and body["meta"]["holdout"]["n"] == 1600 and body["meta"]["duelGames"] == 8000
          and body["meta"]["ladderGames"] == 6040, str(body.get("meta")))
    loaded = cm.load(out)
    check("...and the runtime reads it: card 0 beats card 1",
          loaded is not None and loaded["x"][k[0]][k[1]] > 0.4, str(loaded and loaded["x"][k[0]].get(k[1])))
    before = open(out, encoding="utf-8").read()
    check("--report scores and saves nothing", tr.main(["--report"]) == 0
          and open(out, encoding="utf-8").read() == before)
    other = os.path.join(tmp, "replay.json")
    code = tr.main(["--before=20261006", "--out=" + other])
    rb = json.load(open(other, encoding="utf-8")) if os.path.exists(other) else {}
    check("--before / --out fit on the earlier duels only and write elsewhere",
          code == 0 and rb.get("meta", {}).get("duelsBefore") == "20261006"
          and 0 < rb["meta"]["duelGames"] < 8000
          and open(out, encoding="utf-8").read() == before, str(rb.get("meta")))

    # No signal anywhere: the gate refuses and the model in place stands.
    con = sqlite3.connect(db)
    con.execute("delete from pair_matchup_agg")
    NA, NB, NY, _ = games(6000, signal=False)
    con.executemany("insert into pair_matchup_agg values (?, ?, ?, ?)",
                    [(key_of(x), key_of(y_), int(w), int(1 - w)) for x, y_, w in zip(NA, NB, NY)])
    con.commit()
    con.close()
    write_cache(signal=False)
    code = tr.main([])
    check("a fit that adds nothing over who is playing is NOT saved (exit 2)", code == 2, str(code))
    check("...and the model in place is untouched", open(out, encoding="utf-8").read() == before)
finally:
    cm.PATH = _saved_path
    tr.read_duels = _saved_read

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
