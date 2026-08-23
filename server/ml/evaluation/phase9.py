"""Phase 9 — player-wide candidate pool. Recall only; no ranking work.

    python -m ml.evaluation.phase9 --report

ONE CHANGE FROM PHASE 8: the entry vocabulary. Everything else — the exit
models, the generators, the metrics — is held fixed so any movement is
attributable to the pool.

LEAKAGE IS HANDLED BY WALK ORDER. Rows are processed strictly in timestamp
order and a row is folded into the vocabulary only AFTER it has been evaluated,
so the pool at T contains only cards observed before T. That is asserted in
`test_ml_vocabulary.py` rather than trusted.
"""
from __future__ import annotations

import argparse
import collections
import os
import sys
import time

from .. import candidates as C
from .. import config
from .. import exit_model as E
from .. import substitution as S
from .. import vocabulary as V
from . import phase7 as P7H
from . import phase7_dump as P7

KS = (3, 10, 25, 50, 100, 250, 500)


def _fmt(rec: dict) -> str:
    return " ".join("%5.1f%%" % (100 * rec[k]) for k in KS)


def study(domain: str, rows, sample: int, out: list[str]) -> None:
    dom = sorted([r for r in rows if r["domain"] == domain], key=lambda r: r["ts"])
    stats_s, _t, _c, test_s = P7H.split4(dom)
    fit_edits = P7H._edit_rows(stats_s)
    if not fit_edits or not test_s:
        return
    exit_model = E.E4Combined(E.PopulationExitStats().fit(fit_edits))
    entry_model = S.S2Transition(S.GlobalStats().fit(fit_edits))

    # Population prior: the cards that most often ENTER a deck, from fit slice.
    pop = collections.Counter()
    for e in fit_edits:
        pop.update(e["incoming"])
    global_prior = [c for c, _ in pop.most_common(30)]

    test_keys = {(r["tag"], r["ts"]) for r in test_s}
    vocab = V.PlayerVocabulary()

    gens = {
        "C1 wide 1-card": C.C1WideOneCard(exit_model, entry_model,
                                          width=8, entry_width=12),
        "C2 2-card": C.C2TwoCard(exit_model, entry_model,
                                 exit_pairs=28, entry_width=8),
        "C4 union": C.C4Union(exit_model, entry_model, cap=500),
    }
    buckets = ("1-card", "2-card")
    #  results[pool][gen][bucket] -> {"hit": Counter, "n": int}
    results: dict = {}
    div: dict = collections.defaultdict(list)
    cost: dict = collections.defaultdict(list)
    seen_count: dict = collections.Counter()
    vocab_sizes = []

    for r in dom:                       # chronological
        key = (r["tag"], r["ts"])
        if key in test_keys:
            prev, nxt = frozenset(r["prev_deck"]), frozenset(r["next_deck"])
            if prev != nxt:
                n_diff = len(nxt - prev)
                bucket = "1-card" if n_diff == 1 else "2-card"
                if n_diff <= 2 and seen_count[bucket] < sample:
                    seen_count[bucket] += 1
                    base = P7.model_view(r)
                    pool = vocab.pool_for(base, global_prior)
                    vocab_sizes.append(vocab.size(r["tag"], r["domain"]))
                    for pool_name, view in (
                            ("shell", base),
                            ("player-wide", dict(base, pool_override=pool))):
                        for gname, gen in gens.items():
                            t0 = time.time()
                            info = gen.recall(view, r["next_deck"], KS)
                            cost[(pool_name, gname)].append(time.time() - t0)
                            slot = results.setdefault(pool_name, {}).setdefault(
                                gname, {}).setdefault(
                                bucket, {"hit": collections.Counter(), "n": 0})
                            slot["n"] += 1
                            for k, ok in info["hits"].items():
                                if ok:
                                    slot["hit"][k] += 1
                            if pool_name == "player-wide" and gname == "C4 union":
                                div[bucket].append(
                                    V.diversity(gen.generate(view), r["prev_deck"]))
        vocab.observe_row(r)

    out.append("")
    out.append("=" * 78)
    out.append("%s   test steps %d   sampled %s"
               % (domain.upper(), len(test_s), dict(seen_count)))
    out.append("   mean player vocabulary at prediction time: %.0f cards"
               % (sum(vocab_sizes) / len(vocab_sizes) if vocab_sizes else 0))
    out.append("=" * 78)

    for bucket in buckets:
        out.append("")
        out.append("%s   candidate recall @k" % bucket.upper())
        out.append("   %-16s %-14s %s"
                   % ("pool", "generator",
                      " ".join("%6s" % ("@%d" % k) for k in KS)))
        for pool_name in ("shell", "player-wide"):
            for gname in gens:
                slot = results.get(pool_name, {}).get(gname, {}).get(bucket)
                if not slot or not slot["n"]:
                    continue
                rec = {k: slot["hit"][k] / slot["n"] for k in KS}
                out.append("   %-16s %-14s %s" % (pool_name, gname, _fmt(rec)))

    out.append("")
    out.append("SEARCH COST (mean ms per step to generate + check)")
    for (pool_name, gname), times in sorted(cost.items()):
        out.append("   %-16s %-14s %6.1f ms" % (pool_name, gname,
                                                1000 * sum(times) / len(times)))

    out.append("")
    out.append("CANDIDATE DIVERSITY (C4 union, player-wide pool)")
    for bucket, rows_ in div.items():
        if not rows_:
            continue
        n = len(rows_)
        out.append("   %-8s candidates %.0f   unique decks %.0f   "
                   "unique entry cards %.0f   unique patterns %.0f"
                   % (bucket,
                      sum(r["n"] for r in rows_) / n,
                      sum(r["unique_decks"] for r in rows_) / n,
                      sum(r["unique_entry_cards"] for r in rows_) / n,
                      sum(r["unique_patterns"] for r in rows_) / n))


def report(rows, sample: int) -> str:
    out = ["=" * 78,
           "OPPONENT INTELLIGENCE ENGINE - PHASE 9  (player-wide candidate pool)",
           "=" * 78,
           "Only the ENTRY VOCABULARY changes. Exit models, generators and",
           "metrics are held fixed so movement is attributable to the pool.",
           "",
           "Phase 8 ceilings — shell pool: 1-card 54.7%/61.2%, 2-card 23.8%/37.4%",
           "                   player-wide: 1-card 89.1%/91.3%, 2-card 78.5%/84.4%"]
    for domain in config.DOMAINS:
        study(domain, rows, sample, out)
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 9")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--sample", type=int, default=600)
    ap.add_argument("--cache", default=P7.CACHE)
    args = ap.parse_args(argv)
    if not args.report:
        ap.print_help()
        return 0
    if not os.path.exists(args.cache):
        print("no cache", file=sys.stderr)
        return 2
    print(report(P7.load(args.cache), args.sample))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
