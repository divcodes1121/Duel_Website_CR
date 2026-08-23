"""Phase 2 — the change/edit model benchmark.

    python -m ml.evaluation.phase2 --dump --players 400      # extract once
    python -m ml.evaluation.phase2 --report                  # train + evaluate

FEATURES ARE CACHED TO DISK ON PURPOSE. Phase 1 measured the database read at
78% of a 28.6-minute run, and Phase 2 needs many training passes over the same
examples. Extraction is the "offline feature computation" half of the
architecture; everything after it runs from the cache in seconds.

Uses Phase 1's dataset, splits and significance machinery unchanged.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import json
import os
import sys
import time

from .. import change_detector as CD
from .. import config
from .. import dataset as ds
from .. import features as F
from . import metrics as M
from . import significance as sig
from . import splits

RESULTS_DIR = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "results")
CACHE = os.path.join(RESULTS_DIR, "phase2-features.jsonl.gz")

#: Fraction of examples (chronologically) used for training.
TRAIN_FRAC = 0.7


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------

def dump(players: int, path: str = CACHE) -> int:
    """Walk the database once and cache one row per prediction example.

    A row carries the feature vector, the label, and whether each Phase 1
    baseline got the deck right — which is everything the gated experiment
    needs, so the card lists never have to be stored.
    """
    con, db = ds.connect()
    if con is None:
        print("no database resolved", file=sys.stderr)
        return 2
    print("database: %s" % db, flush=True)
    os.makedirs(RESULTS_DIR, exist_ok=True)

    tags = ds.eligible_players(con, players)
    written = 0
    t0 = time.time()
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        for start in range(0, len(tags), config.PLAYER_BATCH):
            batch = tags[start:start + config.PLAYER_BATCH]
            plays_by_key = ds.load_plays(con, batch)
            for domain in config.DOMAINS:
                for tag in batch:
                    plays = plays_by_key.get((tag, domain), [])
                    if len(plays) < config.MIN_PLAYER_BATTLES:
                        continue
                    for ex in ds.iter_examples(tag, plays, domain):
                        truth = ex.truth.card_set
                        rec = splits.recent(ex)
                        mod = splits.modal(ex)
                        fh.write(json.dumps([
                            ex.player_tag, ex.domain, ex.timestamp,
                            F.label(ex),
                            M.exact(rec, truth), M.exact(mod, truth),
                            round(M.jaccard(rec, truth), 4),
                            round(M.jaccard(mod, truth), 4),
                            M.exact_at_k(splits.recent_ranked(ex, 3), truth, 3),
                            M.exact_at_k(splits.modal_ranked(ex, 3), truth, 3),
                            [round(v, 5) for v in F.extract(ex)],
                        ]) + "\n")
                        written += 1
            print("  %d/%d players, %d rows (%.0fs)"
                  % (min(start + config.PLAYER_BATCH, len(tags)), len(tags),
                     written, time.time() - t0), flush=True)
    print("wrote %d rows to %s" % (written, path))
    return 0


def load(path: str = CACHE) -> list[dict]:
    rows = []
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            (tag, domain, ts, label, rec_e1, mod_e1, rec_j, mod_j,
             rec_e3, mod_e3, feats) = json.loads(line)
            rows.append({"tag": tag, "domain": domain, "ts": ts,
                         "label": label, "rec_e1": rec_e1, "mod_e1": mod_e1,
                         "rec_j": rec_j, "mod_j": mod_j,
                         "rec_e3": rec_e3, "mod_e3": mod_e3, "x": feats})
    return rows


def temporal_split(rows: list[dict], frac: float = TRAIN_FRAC):
    """Train on the chronologically EARLIER examples, test on the later.

    A random split would put a player's later behaviour in training and their
    earlier behaviour in test, which is time travel dressed as a shuffle.
    """
    ordered = sorted(rows, key=lambda r: r["ts"])
    cut = int(len(ordered) * frac)
    return ordered[:cut], ordered[cut:]


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------

def score(model, rows: list[dict]) -> dict:
    """P(change) quality, pooled (micro) and per player (for bootstrap)."""
    probs, labels = [], []
    per_player_brier: dict = collections.defaultdict(list)
    per_player_hit: dict = collections.defaultdict(list)
    for r in rows:
        dist = model.predict(r["x"])
        p_change = 1.0 - dist.get(0, 0.0)
        y = 1 if r["label"] else 0
        probs.append(p_change)
        labels.append(y)
        per_player_brier[r["tag"]].append((p_change - y) ** 2)
        per_player_hit[r["tag"]].append(
            1.0 if (p_change >= 0.5) == bool(y) else 0.0)
    p, rec, f1 = M.prf_at(probs, labels, 0.5)
    return {
        "n": len(rows),
        "positive_rate": (sum(labels) / len(labels)) if labels else 0.0,
        "precision": p, "recall": rec, "f1": f1,
        "pr_auc": M.pr_auc(probs, labels),
        "roc_auc": M.roc_auc(probs, labels),
        "brier": M.brier(probs, labels),
        "per_player_brier": dict(per_player_brier),
        "per_player_hit": dict(per_player_hit),
        "probs": probs, "labels": labels,
    }


def gated(model, rows: list[dict], threshold: float) -> dict:
    """Recent when a change looks unlikely, Modal when it looks likely.

    The alternative is Modal on purpose: Phase 1 showed Recent scores 0% on
    change events while Modal scores 15-20%, so Modal is the only pool that
    exists before a substitution model is built.
    """
    e1 = collections.defaultdict(list)
    ja = collections.defaultdict(list)
    e1_change = collections.defaultdict(list)
    switched = 0
    for r in rows:
        p_change = 1.0 - model.predict(r["x"]).get(0, 0.0)
        use_modal = p_change >= threshold
        switched += use_modal
        hit = r["mod_e1"] if use_modal else r["rec_e1"]
        jac = r["mod_j"] if use_modal else r["rec_j"]
        e1[r["tag"]].append(hit)
        ja[r["tag"]].append(jac)
        if r["label"]:
            e1_change[r["tag"]].append(hit)
    return {"e1": dict(e1), "jaccard": dict(ja), "e1_change": dict(e1_change),
            "switch_rate": switched / len(rows) if rows else 0.0}


def _macro(per_player: dict) -> float:
    return M.mean([M.mean(v) for v in per_player.values() if v])


def _baseline_pools(rows: list[dict], key: str) -> dict:
    out = collections.defaultdict(list)
    for r in rows:
        out[r["tag"]].append(r[key])
    return dict(out)


def report(rows: list[dict], bootstrap: int) -> str:
    out: list[str] = []
    add = out.append
    train, test = temporal_split(rows)
    add("=" * 72)
    add("OPPONENT INTELLIGENCE ENGINE - PHASE 2  (change & edit model)")
    add("=" * 72)
    add("rows %d   train %d   test %d   (chronological %d%% split)"
        % (len(rows), len(train), len(test), int(TRAIN_FRAC * 100)))
    add("train window %s .. %s" % (train[0]["ts"][:8], train[-1]["ts"][:8]))
    add("test  window %s .. %s" % (test[0]["ts"][:8], test[-1]["ts"][:8]))

    models = [CD.B0AlwaysNoChange(), CD.B1LifetimeChurn(), CD.B2RecentChurn()]
    t0 = time.time()
    m2 = CD.M2ChangeModel().fit([r["x"] for r in train],
                                [r["label"] for r in train])
    add("M2 trained on %d rows in %.1fs" % (len(train), time.time() - t0))
    models.append(m2)

    for domain in ("overall",) + config.DOMAINS:
        subset = test if domain == "overall" else [r for r in test
                                                   if r["domain"] == domain]
        if not subset:
            continue
        add("")
        add("-" * 72)
        add("DOMAIN: %s      test rows %d      change rate %.1f%%"
            % (domain.upper(), len(subset),
               100.0 * sum(1 for r in subset if r["label"]) / len(subset)))
        add("-" * 72)
        add("%-22s %7s %7s %7s %7s %7s %7s"
            % ("Model", "prec", "recall", "F1", "PR-AUC", "ROC-AUC", "Brier"))
        scored = {}
        for model in models:
            s = score(model, subset)
            scored[model.name] = s
            add("%-22s %7.3f %7.3f %7.3f %7.3f %7.3f %7.3f"
                % (model.name, s["precision"], s["recall"], s["f1"],
                   s["pr_auc"], s["roc_auc"], s["brier"]))
        add("no-skill PR-AUC = positive rate = %.3f"
            % scored[models[0].name]["positive_rate"])

        # Paired bootstrap on Brier, M2 vs the best baseline.
        base = min((m for m in models[1:3]),
                   key=lambda m: scored[m.name]["brier"])
        d = sig.paired_delta(scored[base.name]["per_player_brier"],
                             scored[m2.name]["per_player_brier"],
                             iters=bootstrap)
        add("Brier delta (%s - M2): %+.4f [%+.4f, %+.4f]  n=%d"
            % (base.name, d.point, d.low, d.high, d.n))
        add("  %s" % sig.verdict(d, "M2 (lower Brier)", base.name))

    # ------------------------------------------------------------ gated test
    add("")
    add("-" * 72)
    add("SECONDARY EXPERIMENT - gated predictor (Recent unless change likely)")
    add("-" * 72)
    for domain in config.DOMAINS:
        subset = [r for r in test if r["domain"] == domain]
        if not subset:
            continue
        rec_e1 = _baseline_pools(subset, "rec_e1")
        mod_e1 = _baseline_pools(subset, "mod_e1")
        rec_j = _baseline_pools(subset, "rec_j")
        chg = [r for r in subset if r["label"]]
        rec_e1_chg = _baseline_pools(chg, "rec_e1") if chg else {}
        mod_e1_chg = _baseline_pools(chg, "mod_e1") if chg else {}
        add("")
        add("%s  (test rows %d)" % (domain.upper(), len(subset)))
        add("%-26s %9s %9s %9s %7s" % ("Strategy", "exact@1", "jaccard",
                                       "chg-only", "switch"))
        add("%-26s %8.1f%% %9.3f %8.1f%% %7s"
            % ("Recent alone", 100 * _macro(rec_e1), _macro(rec_j),
               100 * _macro(rec_e1_chg) if chg else 0.0, "-"))
        add("%-26s %8.1f%% %9.3f %8.1f%% %7s"
            % ("Modal alone", 100 * _macro(mod_e1),
               _macro(_baseline_pools(subset, "mod_j")),
               100 * _macro(mod_e1_chg) if chg else 0.0, "-"))
        best = None
        for thr in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
            g = gated(m2, subset, thr)
            add("%-26s %8.1f%% %9.3f %8.1f%% %6.1f%%"
                % ("gated @ %.1f" % thr, 100 * _macro(g["e1"]),
                   _macro(g["jaccard"]), 100 * _macro(g["e1_change"]),
                   100 * g["switch_rate"]))
            if best is None or _macro(g["e1"]) > _macro(best[1]["e1"]):
                best = (thr, g)
        if best:
            d = sig.paired_delta(best[1]["e1"], rec_e1, iters=bootstrap)
            add("best gate %.1f vs Recent: %+.2f pts [%+.2f, %+.2f]"
                % (best[0], 100 * d.point, 100 * d.low, 100 * d.high))
            add("  %s" % sig.verdict(d, "gated", "Recent alone"))

    # -------------------------------------------------------- error analysis
    add("")
    add("-" * 72)
    add("ERROR ANALYSIS")
    add("-" * 72)
    add("M2 strongest weights toward CHANGE (standardized units):")
    for name, w in m2.top_weights(10):
        add("   %-26s %+.3f" % (name, w))

    duel = [r for r in test if r["domain"] == "duel"]
    if duel:
        s = score(m2, duel)
        add("")
        add("Duel P(change) by decile of predicted probability:")
        pairs = sorted(zip(s["probs"], s["labels"]))
        bucket = max(1, len(pairs) // 10)
        for i in range(0, len(pairs), bucket):
            chunk = pairs[i:i + bucket]
            if len(chunk) < bucket // 2:
                continue
            add("   pred %.3f-%.3f   actual %.3f   n=%d"
                % (chunk[0][0], chunk[-1][0],
                   sum(c[1] for c in chunk) / len(chunk), len(chunk)))
    add("")
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 2")
    ap.add_argument("--dump", action="store_true")
    ap.add_argument("--players", type=int, default=config.DEFAULT_PLAYERS)
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--bootstrap", type=int, default=1000)
    ap.add_argument("--cache", default=CACHE)
    args = ap.parse_args(argv)

    if args.dump:
        return dump(args.players, args.cache)
    if args.report:
        if not os.path.exists(args.cache):
            print("no cache — run --dump first", file=sys.stderr)
            return 2
        rows = load(args.cache)
        print(report(rows, args.bootstrap))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
