"""Train the card matchup model (`card_matchup.py`).

    python3 card_matchup_train.py            # holdout, then fit on everything and save
    python3 card_matchup_train.py --report   # holdout only, nothing saved
    python3 card_matchup_train.py --before=20261001 --out=/tmp/m.json
                                             # for a replay: only duel games before
                                             # that day, written somewhere else

WHAT IT READS, all read-only:

  * `pair_matchup_agg` in the bot's database — every deck pair the ladder has
    produced with its wins and losses (8.0M pairs, 10.6M games on 2026-10-11).
    One sequential pass, ~100 s.
  * `.duel_games.pkl` — every stored duel game with both pilots and both
    decks' card levels, which `duel_model_train.py` keeps current after each
    poll. No duel cache = a ladder-only fit, and the report says so.

THE FIT is the one the holdout chose (`brain-evidence/counter_ml_20261011/`):
logistic regression over card presence and card-against-card, antisymmetric;
a duel game weighted `DUEL_ALPHA` ladder games; and for duel games a fixed
nuisance term — the pilots' running records and the card-level gap, fitted
first with no deck in it — so who flew a deck and at what levels is not
credited to its cards. The ladder has no pilots in this table; its
matchmaking pairs players of like standing, which is the same reason the
fused rate reads it unadjusted.

94% OF THE LADDER'S PAIRS ARE ONE GAME. All pairs with two or more games are
used; of the single-game pairs a random `SINGLE_SAMPLE` are, weighted up to
stand for all of them. That is the configuration that was measured.

BEFORE ANYTHING IS SAVED the same recipe is fitted without the newest
`HOLDOUT_SHARE` of duel games and scored on them. A model that does not beat
"who is playing" alone by `MIN_GAIN` of log loss is NOT saved, the artifact in
place stands, and the exit code is 2 — a broken read should cost a day of
freshness, not the figure on the screen.

NEEDS numpy AND scipy, which the web service does not: they live in their own
directory (`CLASH_ML_PKGS`, default /opt/royalweb/mlpkgs — `pip install
--target`, nothing system-wide) and only this script puts it on its path.
3.4 GB of memory at its peak and 8 minutes at low priority (measured
2026-10-11); meant for a timer.
"""
from __future__ import annotations

import collections
import json
import os
import pickle
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_PKGS = os.environ.get("CLASH_ML_PKGS") or "/opt/royalweb/mlpkgs"
if os.path.isdir(_PKGS) and _PKGS not in sys.path:
    sys.path.insert(0, _PKGS)
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402
import scipy.sparse as sp  # noqa: E402
from scipy.optimize import minimize  # noqa: E402

import card_matchup as cm  # noqa: E402

#: Penalties on a card's own weight and on a card-against-card weight, and the
#: weight of a duel game in ladder games. Chosen on the tuning week.
L_MAIN = 1.0
L_PAIR = 300.0
DUEL_ALPHA = 10.0
#: Single-game ladder pairs used (of ~7.5M), weighted up to stand for all.
SINGLE_SAMPLE = 1_500_000
#: Games of prior behind a pilot's running record (`duel_model.PRIOR`).
PILOT_PRIOR = 20.0
#: The newest share of duel games held out before a save, and the least the
#: model must add over "who is playing" there (the lab measured 0.03).
HOLDOUT_SHARE = 0.2
MIN_GAIN = 0.005
MAXITER = 150

DUEL_CACHE = os.path.join(HERE, ".duel_games.pkl")
#: Non-zeros a row: 8 + 8 presence, 8 x 8 card against card.
ROW_NNZ = 80


def card_keys() -> list[str]:
    with open(os.path.join(ROOT, "src", "data", "cards.json"), encoding="utf-8") as f:
        return sorted(c["key"] for c in json.load(f))


def sig(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))


def pair_index(lo, hi, nc):
    """Column of the pair (lo < hi) among the nc*(nc-1)/2 pairs."""
    return lo * nc - lo * (lo + 1) // 2 + (hi - lo - 1)


def design(A, B, nc):
    """The antisymmetric design, one row a game: +1 for each of A's cards, -1
    for each of B's, and for every card of A against every card of B the pair's
    column, +1 when A's card sorts first and -1 otherwise.

    EVERY ROW HAS EXACTLY `ROW_NNZ` ENTRIES, so the matrix is filled in place
    with no intermediate copy. A card both decks hold appears as +1 and -1 in
    one column (they sum to nothing, as they should), and its own "pair" is an
    explicit zero.
    """
    n = len(A)
    indices = np.empty(n * ROW_NNZ, dtype=np.int32)
    data = np.empty(n * ROW_NNZ, dtype=np.float32)
    ind = indices.reshape(n, ROW_NNZ)
    dat = data.reshape(n, ROW_NNZ)
    for s in range(0, n, 200_000):
        a, b = A[s:s + 200_000].astype(np.int64), B[s:s + 200_000].astype(np.int64)
        m = len(a)
        ind[s:s + m, 0:8] = a
        ind[s:s + m, 8:16] = b
        dat[s:s + m, 0:8] = 1.0
        dat[s:s + m, 8:16] = -1.0
        I = np.repeat(a[:, :, None], 8, axis=2).reshape(m, 64)
        J = np.repeat(b[:, None, :], 8, axis=1).reshape(m, 64)
        lo, hi = np.minimum(I, J), np.maximum(I, J)
        same = I == J
        col = nc + pair_index(lo, np.where(same, lo + 1, hi), nc)
        col[same] = 0
        ind[s:s + m, 16:] = col
        dat[s:s + m, 16:] = np.where(same, 0.0, np.where(I < J, 1.0, -1.0))
    # int32 while it fits, so scipy does not widen (and copy) the indices.
    indptr = np.arange(0, (n + 1) * ROW_NNZ, ROW_NNZ,
                       dtype=np.int32 if (n + 1) * ROW_NNZ < 2 ** 31 else np.int64)
    return sp.csr_matrix((data, indices, indptr), shape=(n, nc + nc * (nc - 1) // 2))


def fit(X, off, wins, losses, nc, start=None, maxiter=MAXITER):
    """Minimise sum(-wins log p - losses log(1-p)) + penalties, with
    p = sig(X b + g * off). `g` is free and unpenalised. Returns theta = b + [g]."""
    n_feat = X.shape[1]
    pen = np.full(n_feat, L_PAIR, dtype=np.float64)
    pen[:nc] = L_MAIN
    tot = wins + losses
    Xt = X.T

    def f(theta):
        b, g = theta[:-1], theta[-1]
        p = sig(X @ b + g * off)
        ll = -(wins * np.log(np.clip(p, 1e-12, 1)) + losses * np.log(np.clip(1 - p, 1e-12, 1))).sum()
        d = tot * p - wins
        grad = np.empty_like(theta)
        grad[:-1] = Xt @ d + pen * b
        grad[-1] = (d * off).sum()
        return ll + 0.5 * (pen * b * b).sum(), grad

    if start is None:
        start = np.zeros(n_feat + 1)
        start[-1] = 1.0
    return minimize(f, start, jac=True, method="L-BFGS-B",
                    options={"maxiter": maxiter, "maxcor": 20}).x


def fit_nuisance(pilot, level, y):
    """Who is playing and at what levels, with no deck in it: two weights."""
    Z = np.column_stack([pilot, level])

    def f(b):
        p = sig(Z @ b)
        return (-(y * np.log(np.clip(p, 1e-12, 1)) + (1 - y) * np.log(np.clip(1 - p, 1e-12, 1))).sum(),
                Z.T @ (p - y))

    return minimize(f, np.array([1.0, 0.5]), jac=True, method="L-BFGS-B").x


def log_loss(p, y):
    p = np.clip(p, 0.01, 0.99)
    return float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())


# ── Reading ──────────────────────────────────────────────────────────────────


def read_ladder(db_path: str, idx: dict, seed: int = 11):
    """`(A, B, wins, losses, stats)` — the ladder pair table as arrays, every
    pair with 2+ games and a weighted sample of the single-game pairs."""
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        n_max = con.execute("select max(rowid) from pair_matchup_agg").fetchone()[0] or 0
        A = np.zeros((n_max, 8), dtype=np.int16)
        B = np.zeros((n_max, 8), dtype=np.int16)
        W = np.zeros(n_max, dtype=np.float64)
        L = np.zeros(n_max, dtype=np.float64)
        cache: dict[str, tuple] = {}

        def deck(s):
            v = cache.get(s)
            if v is None:
                try:
                    v = tuple(idx[k] for k in s.split(","))
                except KeyError:
                    v = ()
                if len(v) != 8 or len(set(v)) != 8:
                    v = ()
                # A SMALL CACHE ON PURPOSE. Most of the 8M pairs hold a deck
                # seen once; remembering three million of them was 1.2 GB for
                # a 25-second saving, on a box whose page cache the API needs.
                if len(cache) < 300_000:
                    cache[s] = v
            return v

        n = 0
        for da, db_, w, l in con.execute(
                "select deck_a, deck_b, a_wins, a_losses from pair_matchup_agg"):
            w, l = w or 0, l or 0
            if w + l <= 0:
                continue
            a, b = deck(da), deck(db_)
            if not a or not b:
                continue
            A[n] = a; B[n] = b; W[n] = w; L[n] = l
            n += 1
    finally:
        con.close()
    A, B, W, L = A[:n], B[:n], W[:n], L[:n]
    g = W + L
    multi = np.flatnonzero(g >= 2)
    single = np.flatnonzero(g == 1)
    take = single
    if len(single) > SINGLE_SAMPLE:
        take = np.random.default_rng(seed).choice(single, size=SINGLE_SAMPLE, replace=False)
    up = len(single) / max(1, len(take))
    pick = np.concatenate([multi, take])
    wt = np.concatenate([np.ones(len(multi)), np.full(len(take), up)])
    stats = {"ladderPairs": int(n), "ladderGames": int(g.sum()), "ladderRows": int(len(pick))}
    return A[pick], B[pick], W[pick] * wt, L[pick] * wt, stats


def read_duels(idx: dict, path: str | None = None, before: str | None = None):
    """`(A, B, y, pilot, level)` oldest first, or None without the cache.
    `pilot` is the logit gap of the two running records BEFORE the game;
    `level` is their mean card-level deficit minus ours. `before` keeps only
    games played before that battle time (a replay's cut)."""
    try:
        with open(path or DUEL_CACHE, "rb") as f:
            games = pickle.load(f)["games"]
    except (OSError, EOFError, ValueError, KeyError, pickle.UnpicklingError):
        return None
    games = sorted((g for g in games if not before or g[0] < before), key=lambda g: (g[0], g[1]))
    rec = collections.defaultdict(lambda: [0, 0])
    A, B, Y, P, V = [], [], [], [], []
    for _bt, _rnd, ta, tb, da, db_, fa, fb, y in games:
        ra, rb = rec[ta], rec[tb]
        sa = (ra[1] + PILOT_PRIOR / 2) / (ra[0] + PILOT_PRIOR)
        sb = (rb[1] + PILOT_PRIOR / 2) / (rb[0] + PILOT_PRIOR)
        ra[0] += 1; ra[1] += y
        rb[0] += 1; rb[1] += 1 - y
        try:
            a, b = [idx[k] for k in da], [idx[k] for k in db_]
        except KeyError:
            continue
        if len(set(a)) != 8 or len(set(b)) != 8:
            continue
        A.append(a); B.append(b); Y.append(y)
        P.append(cm.logit(sa) - cm.logit(sb))
        V.append(float(fb or 0.0) - float(fa or 0.0))
    if not A:
        return None
    return (np.array(A, dtype=np.int16), np.array(B, dtype=np.int16),
            np.array(Y, dtype=np.float64), np.array(P), np.array(V))


# ── The fit ──────────────────────────────────────────────────────────────────


def assemble(ladder, duels, nc):
    """One design and its targets from the two sources. `duels` may be None.
    Returns `(X, offset, wins, losses, nuisance weights or None)`."""
    LA, LB, LW, LL = ladder
    if duels is None:
        return design(LA, LB, nc), np.zeros(len(LW)), LW, LL, None
    DA, DB, y, pilot, level = duels
    nu = fit_nuisance(pilot, level, y)
    X = design(np.vstack([LA, DA]), np.vstack([LB, DB]), nc)
    off = np.concatenate([np.zeros(len(LW)), pilot * nu[0] + level * nu[1]])
    wins = np.concatenate([LW, DUEL_ALPHA * y])
    losses = np.concatenate([LL, DUEL_ALPHA * (1 - y)])
    return X, off, wins, losses, nu


def export(theta, keys: list[str]) -> dict:
    """The weights as the artifact stores them: `main[card]` and
    `pair["a|b"]` with a < b, positive = a beats b."""
    nc = len(keys)
    b = theta[:-1]
    main = {keys[i]: round(float(b[i]), 5) for i in range(nc) if abs(b[i]) >= 1e-5}
    pair = {}
    for lo in range(nc):
        base = nc + pair_index(lo, lo + 1, nc)
        row = b[base:base + nc - lo - 1]
        for k in np.flatnonzero(np.abs(row) >= 1e-5):
            pair[keys[lo] + "|" + keys[lo + 1 + int(k)]] = round(float(row[k]), 5)
    return {"main": main, "pair": pair}


def holdout(ladder, duels, nc):
    """Fit without the newest duel games and score them. Returns
    `(report, theta)`; `theta` warm-starts the final fit."""
    DA, DB, y, pilot, level = duels
    cut = int(len(y) * (1 - HOLDOUT_SHARE))
    train = (DA[:cut], DB[:cut], y[:cut], pilot[:cut], level[:cut])
    X, off, wins, losses, nu = assemble(ladder, train, nc)
    theta = fit(X, off, wins, losses, nc)
    del X
    Xt = design(DA[cut:], DB[cut:], nc)
    who = pilot[cut:] * nu[0] + level[cut:] * nu[1]
    m = Xt @ theta[:-1]
    yt = y[cut:]
    base, with_model = log_loss(sig(who), yt), log_loss(sig(who + m), yt)
    return {"n": int(len(yt)), "who": round(base, 4), "model": round(with_model, 4),
            "cardsOnly": round(log_loss(sig(m), yt), 4), "gain": round(base - with_model, 4),
            "nuisance": [round(float(x), 3) for x in nu]}, theta


def save(body: dict, path: str | None = None) -> None:
    path = path or cm.PATH
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    os.replace(tmp, path)


def main(argv: list[str]) -> int:
    t0 = time.time()
    db = os.environ.get("CLASH_DB_PATH") or "/var/clashbot/battles.db"
    keys = card_keys()
    idx = {k: i for i, k in enumerate(keys)}
    nc = len(keys)
    *ladder, stats = read_ladder(db, idx)
    print(json.dumps({"ladder": stats, "seconds": round(time.time() - t0)}), flush=True)
    before = next((a.split("=", 1)[1] for a in argv if a.startswith("--before=")), None)
    out = next((a.split("=", 1)[1] for a in argv if a.startswith("--out=")), None)
    duels = read_duels(idx, before=before)
    meta = dict(stats, duelGames=int(len(duels[2])) if duels else 0, cards=nc)
    if before:
        meta["duelsBefore"] = before
    start = None
    if duels is not None and len(duels[2]) >= 5000:
        report, start = holdout(ladder, duels, nc)
        meta["holdout"] = report
        print(json.dumps({"holdout": report, "seconds": round(time.time() - t0)}), flush=True)
        if report["gain"] < MIN_GAIN:
            print(f"model adds {report['gain']} over who is playing (< {MIN_GAIN}) - NOT saved")
            return 2
    else:
        meta["holdout"] = None
        print("no duel games to hold out: a ladder-only fit, unscored", flush=True)
    if "--report" in argv:
        return 0
    X, off, wins, losses, _nu = assemble(ladder, duels, nc)
    theta = fit(X, off, wins, losses, nc, start=start, maxiter=MAXITER if start is None else 80)
    meta["trainedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    meta["seconds"] = round(time.time() - t0)
    body = {"brain": cm.BRAIN, "meta": meta, **export(theta, keys)}
    save(body, out)
    print(json.dumps({"saved": out or cm.PATH, "main": len(body["main"]), "pair": len(body["pair"]),
                      "seconds": meta["seconds"]}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
