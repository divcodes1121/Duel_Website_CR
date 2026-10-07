"""Fit the duel read (`duel_read.py`) on every stored duel.

    python3 duel_read_train.py            # fit, report, write .duel_read.json
    python3 duel_read_train.py --report   # fit and report only

Run by `after_poll.py` after the duel index is updated, so the read learns from
each poll's duels. Reads the duel index's own file (`duel_index.PATH`,
read-only) and writes only the artifact.

WHAT IT FITS, one set per stage (before game 1 / after one reveal / after two)
  * RANKING: twelve weights of a conditional logit — for each past decision,
    the deck the player really brought against the other decks they could
    legally have brought;
  * SHARPNESS: three weights scaling those scores by how much the player
    rotates (their own new-deck rate, their share of friendly duels). Fitted on
    everyone at one scale the read printed 75% for a first pick that scrim
    players went on to bring 55% of the time;
  * NEW DECK: seven weights of a logistic for "the next deck is one not seen in
    the window". Without it the probabilities sum to one over seen decks and a
    first pick printed 96% for something that happened 64% of the time.

EVERY ROW IS BLIND BY CONSTRUCTION: the features of a decision are counted from
that player's duels that started before it, and nothing else.

WHAT IT REPORTS, into the artifact: fitted on the first 80% of duels by time and
scored on the rest — how often the first pick and the top three hold the exact
deck, beside the same figures for a plain count of plays (what the read
replaced), for everyone and for friendly duels, and whether the first pick's
printed probability is what happened.
"""

from __future__ import annotations

import calendar
import json
import math
import os
import random
import sqlite3
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import duel_read as dr  # noqa: E402

DAY = 86400.0

#: The window a decision's history is read over. The read is used at 7, 15 and
#: 30 days; it is fitted at the longest so every feature has its full range.
WINDOW_DAYS = 30

#: Decisions kept per stage for one fit. More did not move a weight in the
#: second decimal; this keeps the run inside a few minutes on the server.
MAX_ROWS = 100_000

EPOCHS = 5
LR = 0.05
L2 = 1e-4

#: Share of duels, oldest first, the reported fit is trained on.
REPORT_SPLIT = 0.8

#: The friendly-duel mode, lower-cased (`duel_combos.NATIVE_DUEL_MODES`).
FRIENDLY_MODE = "duel_1v1_friendly"

#: NAMED GROUPS OF PLAYERS THE HOLDOUT IS ALSO REPORTED FOR — `{"crl": ["#TAG",
#: ...]}` in a file that is NOT in the repository (it holds player tags; the
#: repository is public). The read is fitted on every duel and was asked to be
#: judged on the players with coaches, so the fit says how it does on them
#: after every poll. Only counts and rates are ever written out, never a tag.
COHORTS_PATH = os.environ.get("CLASH_DUEL_COHORTS") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".duel_cohorts.json")
#: Names the two built-in groups own.
RESERVED_COHORTS = ("all", "friendly")


def load_cohorts(path: str = COHORTS_PATH) -> dict:
    """`{name: set of tags}` from the cohort file, or `{}`. A missing or
    unreadable file is no cohort, never an error: the fit must not depend on
    a list somebody keeps by hand."""
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError):
        return {}
    out = {}
    for name, tags in (raw.items() if isinstance(raw, dict) else []):
        name = str(name).strip().lower()
        if not name.isidentifier() or name in RESERVED_COHORTS or not isinstance(tags, list):
            continue
        found = {str(t).strip().upper() for t in tags if str(t).strip()}
        if found:
            out[name] = found
    return out


def _epoch(bt: str) -> float:
    return float(calendar.timegm(time.strptime(bt[:15], "%Y%m%dT%H%M%S")))


def read_index(path: str):
    """Yield `(battle_time, round, a_tag, b_tag, a_deck, b_deck, winner, mode)`."""
    con = sqlite3.connect("file:" + path.replace("\\", "/") + "?mode=ro", uri=True, timeout=60)
    try:
        yield from con.execute(
            "SELECT battle_time, round, a_tag, b_tag, a_deck, b_deck, winner, mode FROM games "
            "ORDER BY battle_time, a_tag, b_tag, round")
    finally:
        con.close()


def players_of(games) -> dict:
    """tag -> that player's duels, oldest first, in `duel_read`'s history shape."""
    duels: dict[tuple, dict] = {}
    for bt, rnd, a, b, da, db, w, mode in games:
        key = (bt, a, b)
        e = duels.get(key)
        if e is None:
            e = duels[key] = {"t": _epoch(bt), "a": a, "b": b, "g": [],
                              "friendly": (mode or "").lower() == FRIENDLY_MODE}
        e["g"].append((int(rnd), tuple(da.split(",")), tuple(db.split(",")), int(w)))
    out: dict[str, list] = defaultdict(list)
    for e in sorted(duels.values(), key=lambda x: (x["t"], x["a"], x["b"])):
        g = sorted(e["g"])
        out[e["a"]].append({"t": e["t"], "friendly": e["friendly"],
                            "decks": [x[1] for x in g], "won": [x[3] == 1 for x in g]})
        out[e["b"]].append({"t": e["t"], "friendly": e["friendly"],
                            "decks": [x[2] for x in g], "won": [x[3] == 2 for x in g]})
    return out


def tagged_decisions(players: dict, lo: float, hi: float):
    """`(tag, decision)` for every decision of `decisions`, in its order."""
    for tag, ds in players.items():
        for j, cur in enumerate(ds):
            now = cur["t"]
            if now < lo or now >= hi:
                continue
            hist = [h for h in ds[:j] if now - WINDOW_DAYS * DAY <= h["t"] < now]
            if not hist:
                continue
            for stage in range(len(cur["decks"])):
                lost = bool(stage) and not cur["won"][stage - 1]
                yield tag, (min(stage, 2), hist, cur["decks"][:stage], frozenset(cur["decks"][stage]),
                            now, lost, cur["friendly"])


def decisions(players: dict, lo: float, hi: float):
    """Every `(stage, history, revealed, truth, now, lost, friendly duel)` with
    `lo <= now < hi`, for a player who has any history in the window."""
    for _tag, d in tagged_decisions(players, lo, hi):
        yield d


def _fit_logit(rows, nf: int, seed: int = 7) -> list[float]:
    """Conditional logit by Adagrad. `rows` = [(candidate features, truth index, ...)]."""
    n = 0
    sq = [0.0] * nf
    mean = [0.0] * nf
    for row in rows:
        for x in row[0]:
            n += 1
            for i in range(nf):
                mean[i] += x[i]
                sq[i] += x[i] * x[i]
    mean = [m / max(1, n) for m in mean]
    std = [max(1e-6, math.sqrt(max(0.0, s / max(1, n) - m * m))) for s, m in zip(sq, mean)]
    w = [0.0] * nf
    g2 = [1e-8] * nf
    rnd = random.Random(seed)
    order = list(range(len(rows)))
    for _ep in range(EPOCHS):
        rnd.shuffle(order)
        for r in order:
            X, y = rows[r][0], rows[r][1]
            Z = [[x[i] / std[i] for i in range(nf)] for x in X]
            sc = [sum(w[i] * z[i] for i in range(nf)) for z in Z]
            m = max(sc)
            ex = [math.exp(s - m) for s in sc]
            tot = sum(ex)
            for i in range(nf):
                g = -Z[y][i] + sum(e / tot * z[i] for e, z in zip(ex, Z)) + L2 * w[i]
                g2[i] += g * g
                w[i] -= LR * g / math.sqrt(g2[i])
    return [wi / s for wi, s in zip(w, std)]


def _fit_sharpness(rows, w, seed: int = 7) -> list[float]:
    """The scale on the scores, `exp(theta . context)`, with the ranking weights
    held fixed. `rows` = [(candidate features, truth index, context)]."""
    nf = len(dr.SHARPNESS_FEATURES)
    theta = [0.0] * nf
    g2 = [1e-8] * nf
    rnd = random.Random(seed)
    order = list(range(len(rows)))
    for _ep in range(EPOCHS):
        rnd.shuffle(order)
        for r in order:
            X, y, ctx = rows[r]
            sc = [sum(a * b for a, b in zip(w, x)) for x in X]
            kappa = math.exp(max(-3.0, min(3.0, sum(a * b for a, b in zip(theta, ctx)))))
            m = max(sc)
            ex = [math.exp(kappa * (s - m)) for s in sc]
            tot = sum(ex)
            # d(loss)/d(kappa) = E[score] - score of the truth
            dk = sum(e / tot * s for e, s in zip(ex, sc)) - sc[y]
            for i in range(nf):
                g = dk * kappa * ctx[i] + L2 * theta[i]
                g2[i] += g * g
                theta[i] -= LR * g / math.sqrt(g2[i])
    return theta


def _fit_binary(rows, nf: int, seed: int = 7) -> list[float]:
    """Plain logistic regression by Adagrad. `rows` = [(features, 0 | 1)]."""
    w = [0.0] * nf
    g2 = [1e-8] * nf
    rnd = random.Random(seed)
    order = list(range(len(rows)))
    for _ep in range(EPOCHS):
        rnd.shuffle(order)
        for r in order:
            x, y = rows[r]
            p = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, sum(a * b for a, b in zip(w, x))))))
            for i in range(nf):
                g = (p - y) * x[i] + L2 * w[i]
                g2[i] += g * g
                w[i] -= LR * g / math.sqrt(g2[i])
    return w


def gather(players: dict, lo: float, hi: float, seed: int = 7):
    """Training rows for the fits, capped per stage by an even sample."""
    rank_rows = {0: [], 1: [], 2: []}
    new_rows = {0: [], 1: [], 2: []}
    for stage, hist, revealed, truth, now, lost, friendly in decisions(players, lo, hi):
        feats = dr.candidates(hist, revealed, now, lost)
        new_rows[stage].append((dr.novelty_features(hist, revealed, now, len(feats), friendly),
                                0 if truth in feats else 1))
        if len(feats) >= 2 and truth in feats:
            keys = list(feats)
            rank_rows[stage].append(([feats[k] for k in keys], keys.index(truth),
                                     dr.sharpness_features(hist, friendly)))
    rnd = random.Random(seed)
    for table in (rank_rows, new_rows):
        for s in table:
            if len(table[s]) > MAX_ROWS:
                table[s] = rnd.sample(table[s], MAX_ROWS)
    return rank_rows, new_rows


def fit(players: dict, lo: float, hi: float) -> dict:
    rank_rows, new_rows = gather(players, lo, hi)
    out = {"weights": {}, "sharpness": {}, "novelty": {}, "rows": {}}
    for s in (0, 1, 2):
        out["rows"][s] = [len(rank_rows[s]), len(new_rows[s])]
        if len(rank_rows[s]) >= 200:
            out["weights"][s] = _fit_logit(rank_rows[s], len(dr.FEATURES))
            out["sharpness"][s] = _fit_sharpness(rank_rows[s], out["weights"][s])
        else:
            out["weights"][s] = list(dr.DEFAULT_WEIGHTS[s])
            out["sharpness"][s] = list(dr.DEFAULT_SHARPNESS[s])
        out["novelty"][s] = (_fit_binary(new_rows[s], len(dr.NOVELTY_FEATURES))
                             if len(new_rows[s]) >= 200 else list(dr.DEFAULT_NOVELTY[s]))
    return out


def _counts_top(hist, revealed) -> list[frozenset]:
    """What the read replaced: legal decks by plays, one row a deck."""
    used = frozenset().union(*[frozenset(r) for r in revealed]) if revealed else frozenset()
    plays: dict[frozenset, int] = {}
    for h in hist:
        for d in h["decks"]:
            k = frozenset(d)
            if not (k & used):
                plays[k] = plays.get(k, 0) + 1
    out: list[frozenset] = []
    for d, _n in sorted(plays.items(), key=lambda kv: (-kv[1], ",".join(sorted(kv[0])))):
        if any(len(d & o) >= dr.SAME_DECK for o in out):
            continue
        out.append(d)
        if len(out) >= 3:
            break
    return out


def score(players: dict, model: dict, lo: float, hi: float, cohorts: dict | None = None) -> dict:
    """Blind accuracy of `model` on decisions in `[lo, hi)`, for everyone, for
    friendly duels (the format coached players prepare for) and for each named
    group in `cohorts` (`{name: set of tags}`) — the decisions of THOSE
    players, whatever the kind of duel. The report holds counts and rates."""
    def blank():
        return {"n": 0, "first": 0, "top3": 0, "countsFirst": 0, "countsTop3": 0, "new": 0, "newSaid": 0.0}

    groups = {str(k): {str(t).upper() for t in v} for k, v in (cohorts or {}).items()
              if str(k) not in RESERVED_COHORTS}
    names = ("all", "friendly") + tuple(sorted(groups))
    acc = {(c, s): blank() for c in names for s in (0, 1, 2)}
    bins: dict[tuple, list] = {}
    for tag, (stage, hist, revealed, truth, now, lost, friendly) in tagged_decisions(players, lo, hi):
        rows = dr.read(hist, revealed, now, lost_prev=lost, friendly_now=friendly,
                       weights=model["weights"][stage],
                       novelty_weights=model["novelty"][stage],
                       sharpness_weights=model["sharpness"][stage])
        sets = [frozenset(r["cards"]) for r in rows[:3]]
        base = _counts_top(hist, revealed)
        seen = {frozenset(d) for h in hist for d in h["decks"]}
        said = dr.novelty(hist, revealed, now, weights=model["novelty"][stage], friendly_now=friendly)
        mine = [g for g, tags in groups.items() if str(tag).upper() in tags]
        for c in (("all", "friendly") if friendly else ("all",)) + tuple(mine):
            a = acc[(c, stage)]
            a["n"] += 1
            if sets:
                a["first"] += sets[0] == truth
                a["top3"] += truth in sets
                b = bins.setdefault((c, min(9, int(rows[0]["p"] * 10))), [0, 0.0, 0])
                b[0] += 1
                b[1] += rows[0]["p"]
                b[2] += sets[0] == truth
            if base:
                a["countsFirst"] += base[0] == truth
                a["countsTop3"] += truth in base
            a["new"] += truth not in seen
            a["newSaid"] += said
    rep: dict = {}
    for c in names:
        part = {}
        for s in (0, 1, 2):
            a = acc[(c, s)]
            n = max(1, a["n"])
            part[str(s)] = {"n": a["n"], "first": round(100 * a["first"] / n, 1),
                            "top3": round(100 * a["top3"] / n, 1),
                            "countsFirst": round(100 * a["countsFirst"] / n, 1),
                            "countsTop3": round(100 * a["countsTop3"] / n, 1),
                            "newDeck": round(100 * a["new"] / n, 1),
                            "newDeckSaid": round(100 * a["newSaid"] / n, 1)}
        part["calibration"] = [{"said": round(100 * p / n, 1), "happened": round(100 * hit / n, 1), "n": n}
                               for (cc, _k), (n, p, hit) in sorted(bins.items()) if cc == c and n >= 50]
        rep[c] = part
    return rep


def run(games, report_only: bool = False, path: str = dr.PATH, cohorts: dict | None = None) -> dict:
    t0 = time.time()
    players = players_of(games)
    if cohorts is None:
        cohorts = load_cohorts()
    times = sorted(d["t"] for ds in players.values() for d in ds)
    if len(times) < 2000:
        print(f"only {len(times) // 2} duels — not fitting")
        return {}
    lo, hi = times[0], times[-1] + 1
    cut = times[int(len(times) * REPORT_SPLIT)]
    part = fit(players, lo, cut)
    holdout = score(players, part, cut, hi, cohorts)
    meta = {
        "duels": len(times) // 2,
        "from": time.strftime("%Y-%m-%d", time.gmtime(lo)),
        "to": time.strftime("%Y-%m-%d", time.gmtime(hi - 1)),
        "testFrom": time.strftime("%Y-%m-%d", time.gmtime(cut)),
        "windowDays": WINDOW_DAYS,
        "holdout": holdout,
    }
    print(json.dumps(meta, indent=1))
    if report_only:
        return {"meta": meta, "model": part}
    final = fit(players, lo, hi)
    meta["rows"] = {str(s): final["rows"][s] for s in final["rows"]}
    meta["trainedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    meta["seconds"] = round(time.time() - t0)
    dr.save(final["weights"], meta, path=path, novelty=final["novelty"], sharpness=final["sharpness"])
    print(f"saved {path} in {meta['seconds']}s")
    return {"meta": meta, "model": final}


def main(argv: list[str]) -> int:
    try:
        import duel_index
        index = duel_index.PATH
    except Exception:  # noqa: BLE001 - the trainer must not need the service's imports
        index = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".duel_index.db")
    index = os.environ.get("CLASH_DUEL_INDEX") or index
    if not os.path.exists(index):
        print(f"no duel index at {index} — nothing to fit")
        return 1
    out = run(read_index(index), report_only="--report" in argv)
    return 0 if out else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
