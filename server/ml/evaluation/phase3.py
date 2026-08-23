"""Phase 3 — the substitution ablation study.

    python -m ml.evaluation.phase3 --dump --players 400
    python -m ml.evaluation.phase3 --report

CHANGE EVENTS ONLY. Phase 2's cache stored booleans, which cannot answer a
card-level question, so this makes its own — one row per edit, carrying the
prefix evidence each rung of the ladder needs.

Also reports the duel churn drift flagged at the end of Phase 2 (test-window
change rate 47.1% against 34.5% over the whole Phase 1 window), because the
duel substitution numbers cannot be read without knowing whether that is real.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import json
import os
import sys
import time

from .. import config
from .. import dataset as ds
from .. import substitution as S
from . import metrics as M
from . import significance as sig

RESULTS_DIR = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "results")
CACHE = os.path.join(RESULTS_DIR, "phase3-edits.jsonl.gz")
TRAIN_FRAC = 0.7


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------

def _edit_context(cluster) -> tuple[list, list]:
    """Every prior edit in this shell, with the context it happened under.

    `prior_edits` is (outgoing, incoming) pairs for the transition rung.
    `prior_edit_ctx` carries the same edits plus the conditions the contextual
    rungs ablate over — all read from the play BEFORE the edit, so nothing here
    is knowable only in hindsight.
    """
    pairs, ctx = [], []
    for i in range(1, len(cluster)):
        a, b = cluster[i - 1], cluster[i]
        out = sorted(a.card_set - b.card_set)
        inc = sorted(b.card_set - a.card_set)
        if not inc:
            continue
        pairs.append([out, inc])
        ctx.append({"out": out, "in": inc,
                    "opp_wc": a.opponent_win_condition or "",
                    "opp_hash": ",".join(sorted(a.opponent_cards)) if a.opponent_cards else "",
                    "result": (a.result or "").lower()})
    return pairs, ctx


def dump(players: int, path: str = CACHE) -> int:
    con, db = ds.connect()
    if con is None:
        print("no database resolved", file=sys.stderr)
        return 2
    print("database: %s" % db, flush=True)
    os.makedirs(RESULTS_DIR, exist_ok=True)

    tags = ds.eligible_players(con, players)
    written = steps = 0
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
                        steps += 1
                        if not ex.changed:
                            continue
                        cluster = ex.cluster_history
                        prev = ex.previous
                        counts: collections.Counter = collections.Counter()
                        for p in cluster:
                            counts.update(p.card_set)
                        # Recency, which an aggregate count cannot express: a
                        # card fielded 40 times but absent for the last 15
                        # outings is not as "stable" as one fielded 12 times in
                        # the last 12. E2 is built on exactly this difference.
                        recent = {}
                        for w in (5, 10, 20):
                            rc: collections.Counter = collections.Counter()
                            for p in cluster[-w:]:
                                rc.update(p.card_set)
                            recent[str(w)] = dict(rc)
                        last_seen, streak = {}, {}
                        for card in prev.card_set:
                            for back, p in enumerate(reversed(cluster)):
                                if card in p.card_set:
                                    last_seen[card] = back
                                    break
                            else:
                                last_seen[card] = len(cluster)
                            run = 0
                            for p in reversed(cluster):
                                if card in p.card_set:
                                    run += 1
                                else:
                                    break
                            streak[card] = run
                        pairs, ctx = _edit_context(cluster)
                        fh.write(json.dumps({
                            "tag": ex.player_tag,
                            "domain": ex.domain,
                            "ts": ex.timestamp,
                            "prev_deck": sorted(prev.card_set),
                            "outgoing": sorted(ex.outgoing),
                            "incoming": sorted(ex.incoming),
                            "n_changes": ex.n_changes,
                            "cluster_size": len(cluster),
                            "cluster_card_counts": dict(counts),
                            "recent_counts": recent,
                            "last_seen": last_seen,
                            "streak": streak,
                            "prior_edits": pairs,
                            "prior_edit_ctx": ctx,
                            # Conditions at prediction time, from the last play.
                            "opp_wc": prev.opponent_win_condition or "",
                            "opp_hash": (",".join(sorted(prev.opponent_cards))
                                         if prev.opponent_cards else ""),
                            "result": (prev.result or "").lower(),
                        }) + "\n")
                        written += 1
            print("  %d/%d players, %d edits of %d steps (%.0fs)"
                  % (min(start + config.PLAYER_BATCH, len(tags)), len(tags),
                     written, steps, time.time() - t0), flush=True)
    print("wrote %d edit rows to %s" % (written, path))
    return 0


def load(path: str = CACHE) -> list[dict]:
    out = []
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            out.append(json.loads(line))
    return out


# --------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------

def score_ranker(ranker, events: list[dict]) -> dict:
    """Per-incoming-card ranking metrics, kept per player for bootstrapping."""
    per: dict = {k: collections.defaultdict(list)
                 for k in ("top-1", "top-3", "top-5", "mrr", "ndcg")}
    for ev in events:
        ranked = ranker.rank(ev)
        for card in ev["incoming"]:
            rel = {card}
            tag = ev["tag"]
            per["top-1"][tag].append(M.top_k(ranked, rel, 1))
            per["top-3"][tag].append(M.top_k(ranked, rel, 3))
            per["top-5"][tag].append(M.top_k(ranked, rel, 5))
            per["mrr"][tag].append(M.reciprocal_rank(ranked, rel))
            per["ndcg"][tag].append(M.ndcg(ranked, rel, 10))
    return {k: dict(v) for k, v in per.items()}


def _macro(per_player: dict) -> float:
    return M.mean([M.mean(v) for v in per_player.values() if v])


def temporal_split(events: list[dict], frac: float = TRAIN_FRAC):
    ordered = sorted(events, key=lambda e: e["ts"])
    cut = int(len(ordered) * frac)
    return ordered[:cut], ordered[cut:]


def churn_drift(events: list[dict]) -> list[str]:
    """Duel edits per month, to test the Phase 2 drift observation.

    This cache holds only CHANGE events, so it cannot show a rate on its own.
    What it can show is whether edit VOLUME and edit SHAPE move over time; the
    rate itself is reported by the Phase 2 harness.
    """
    out = ["", "-" * 72, "DUEL EDIT DRIFT (Phase 2 flagged 47.1% test vs 34.5% overall)",
           "-" * 72]
    by_month: dict = collections.defaultdict(list)
    for ev in events:
        if ev["domain"] != "duel":
            continue
        by_month[ev["ts"][:6]].append(ev)
    out.append("%-8s %8s %10s %10s %10s"
               % ("month", "edits", "players", "1-card", "2-card"))
    for month in sorted(by_month):
        rows = by_month[month]
        ones = sum(1 for r in rows if r["n_changes"] == 1)
        out.append("%-8s %8d %10d %9.1f%% %9.1f%%"
                   % (month, len(rows), len({r["tag"] for r in rows}),
                      100.0 * ones / len(rows),
                      100.0 * (len(rows) - ones) / len(rows)))
    out.append("Volume and shape only. A rising edit COUNT with steady shape is")
    out.append("consistent with composition change rather than behavioural drift.")
    return out


def report(events: list[dict], bootstrap: int) -> str:
    out: list[str] = []
    add = out.append
    train, test = temporal_split(events)
    stats = S.GlobalStats().fit(train)

    add("=" * 72)
    add("OPPONENT INTELLIGENCE ENGINE - PHASE 3  (substitution ablation)")
    add("=" * 72)
    add("edit events %d   train %d   test %d   (chronological %d%%)"
        % (len(events), len(train), len(test), int(TRAIN_FRAC * 100)))
    add("train %s .. %s   test %s .. %s"
        % (train[0]["ts"][:8], train[-1]["ts"][:8],
           test[0]["ts"][:8], test[-1]["ts"][:8]))

    for domain in config.DOMAINS:
        subset = [e for e in test if e["domain"] == domain]
        if not subset:
            continue
        cards = sum(len(e["incoming"]) for e in subset)
        ones = sum(1 for e in subset if e["n_changes"] == 1)
        add("")
        add("-" * 72)
        add("DOMAIN: %s   edits %d   incoming cards %d   1-card %.1f%% / 2-card %.1f%%"
            % (domain.upper(), len(subset), cards,
               100.0 * ones / len(subset), 100.0 * (len(subset) - ones) / len(subset)))
        add("-" * 72)
        add("%-20s %8s %8s %8s %8s %8s"
            % ("Model", "top-1", "top-3", "top-5", "MRR", "NDCG"))

        scored = {}
        for cls in S.LADDER:
            ranker = cls(stats)
            per = score_ranker(ranker, subset)
            scored[ranker.name] = per
            add("%-20s %7.1f%% %7.1f%% %7.1f%% %8.3f %8.3f"
                % (ranker.name, 100 * _macro(per["top-1"]),
                   100 * _macro(per["top-3"]), 100 * _macro(per["top-5"]),
                   _macro(per["mrr"]), _macro(per["ndcg"])))

        add("")
        add("THE OUTGOING-CARD ABLATION  (paired on players)")
        for metric in ("top-1", "top-3"):
            d = sig.paired_delta(scored["S2 +outgoing"][metric],
                                 scored["S1 player"][metric], iters=bootstrap)
            add("  %-6s S2 - S1: %+.2f pts [%+.2f, %+.2f]  n=%d"
                % (metric, 100 * d.point, 100 * d.low, 100 * d.high, d.n))
            add("  %-6s %s" % ("", sig.verdict(d, "S2 (+outgoing)", "S1 (player)")))

        add("")
        add("CONTEXT RUNGS vs S2  (paired on players, top-3)")
        for name in ("S3 +opp archetype", "S4 +opp deck", "S5 +prev result"):
            d = sig.paired_delta(scored[name]["top-3"],
                                 scored["S2 +outgoing"]["top-3"], iters=bootstrap)
            add("  %-20s %+.2f pts [%+.2f, %+.2f]   %s"
                % (name, 100 * d.point, 100 * d.low, 100 * d.high,
                   sig.verdict(d, name, "S2")))

        # How much of the S2 oracle is reachable?
        exits = S.ExitRanker()
        hit1 = collections.defaultdict(list)
        hit2 = collections.defaultdict(list)
        for ev in subset:
            ranked = exits.rank(ev)
            rel = set(ev["outgoing"])
            hit1[ev["tag"]].append(M.top_k(ranked, rel, 1))
            hit2[ev["tag"]].append(M.top_k(ranked, rel, 2))
        add("")
        add("EXIT PREDICTION (how reachable is the S2 oracle?)")
        add("  least-stable-first: top-1 %.1f%%   top-2 %.1f%%"
            % (100 * _macro(hit1), 100 * _macro(hit2)))
        add("  S2 is handed the true exit; production must predict it, so its")
        add("  advantage is an upper bound scaled by roughly this hit rate.")

    out.extend(churn_drift(events))
    add("")
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 3")
    ap.add_argument("--dump", action="store_true")
    ap.add_argument("--players", type=int, default=config.DEFAULT_PLAYERS)
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--bootstrap", type=int, default=600)
    ap.add_argument("--cache", default=CACHE)
    args = ap.parse_args(argv)

    if args.dump:
        return dump(args.players, args.cache)
    if args.report:
        if not os.path.exists(args.cache):
            print("no cache — run --dump first", file=sys.stderr)
            return 2
        print(report(load(args.cache), args.bootstrap))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
