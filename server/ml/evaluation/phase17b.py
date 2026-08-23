"""Phase 17B - is a switched-to deck one the player already owns, or a new one?

    python -m ml.evaluation.phase17b --report --tags tags.json --players 400

WHY THIS EXISTS. Phase 16C measured, under PRODUCTION semantics ("what deck
comes next"), that when a deck changes it is usually a whole-deck switch rather
than the 1-card edit Phases 8-14 optimised. Before building a ranker over a
player's historical decks, this asks whether the answer is even in that set.

FEASIBILITY MEASUREMENT ONLY. Nothing here trains, ranks with a model, or
touches production. It imports no `ml.production` module - a test asserts that,
because the point is to measure the problem, not the shipped system.

PRODUCTION SEMANTICS, NOT `next-in-cluster`. A step is consecutive plays for one
player in one domain. The `next-in-cluster` framing used through Phase 14 only
ever scored steps where the player stayed on the shell, which is precisely the
case this phase exists to look past.
"""
from __future__ import annotations

import argparse
import collections
import json
import sqlite3
import sys
import time

from meta import META_MODES
from duel_combos import is_duel_like_mode
from . import metrics as M
from . import significance as sig

DOMAINS = ("competitive", "duel")
RECENCY_BUCKETS = ((1, 5, "last 5 outings"), (6, 20, "6-20 outings"),
                   (21, 50, "21-50 outings"), (51, 10 ** 9, "51+ outings"))
VOCAB_BUCKETS = ((2, 3), (4, 6), (7, 10), (11, 10 ** 9))


def classify_domain(game_mode):
    """The repository's own definitions. `lower()` is MANDATORY - comparing raw
    casing against META_MODES silently returned zero steps in Phase 1."""
    if not game_mode:
        return None
    if game_mode.lower() in META_MODES:
        return "competitive"
    if is_duel_like_mode(game_mode):
        return "duel"
    return None


def deck_key(card_json):
    """A deck identity: its sorted 8 cards. Rows that are not exactly 8 cards
    are NOT decks - native duel loadouts carry 16/24 and must not become one."""
    try:
        cards = json.loads(card_json)
    except Exception:
        return None
    if not isinstance(cards, list) or len(cards) != 8:
        return None
    keys = [str(c) for c in cards]
    if len(set(keys)) != 8:
        return None
    return tuple(sorted(keys))


class SwitchEvent:
    """One production step where the deck changed.

    `pool_*` hold ONLY decks strictly before `ts`, and never the truth unless it
    genuinely recurred. Both are contract-tested; they are the two ways this
    measurement could quietly lie.
    """
    __slots__ = ("tag", "domain", "ts", "prev", "truth", "historical",
                 "outings_ago", "pool_recent", "pool_freq", "vocab")

    def __init__(self, tag, domain, ts, prev, truth, historical, outings_ago,
                 pool_recent, pool_freq, vocab):
        self.tag, self.domain, self.ts = tag, domain, ts
        self.prev, self.truth = prev, truth
        self.historical, self.outings_ago = historical, outings_ago
        self.pool_recent = pool_recent
        self.pool_freq = pool_freq
        self.vocab = vocab


def switch_events(tag, domain, plays):
    """Walk one player's ordered plays and emit every switch.

    `plays` is [(battle_time, deck_key)] ascending. History is folded in only
    AFTER a step is emitted, so a deck can never serve as its own precedent.
    """
    out = []
    seen_order = []                       # distinct decks, least-recent first
    counts = collections.Counter()
    last_index = {}
    for i, (ts, deck) in enumerate(plays):
        if i > 0:
            prev = plays[i - 1][1]
            if deck != prev:
                # STRICTLY BEFORE: counts/last_index do not yet include i.
                historical = deck in counts
                ago = (i - last_index[deck]) if historical else None
                # Rank pools EXCLUDE the current deck. A switch means truth is
                # not prev by definition, so leaving prev in guarantees R0 ranks
                # it first and scores 0 at rank 1 by construction - the same
                # trap that made `recent` score 0% on Phase 1 change events.
                recent_pool = [d for d in reversed(seen_order) if d != prev]
                freq_pool = [d for d, _ in counts.most_common() if d != prev]
                out.append(SwitchEvent(tag, domain, ts, prev, deck, historical,
                                       ago, recent_pool, freq_pool, len(counts)))
        if deck in counts:
            seen_order.remove(deck)
        seen_order.append(deck)
        counts[deck] += 1
        last_index[deck] = i
    return out


def recency_bucket(ago):
    for lo, hi, label in RECENCY_BUCKETS:
        if lo <= ago <= hi:
            return label
    return RECENCY_BUCKETS[-1][2]


def retrieval(events, pool_attr):
    """Recall@k and MRR for one baseline over historical switches. No ML."""
    hits = collections.Counter()
    rr = []
    per_player = collections.defaultdict(list)
    n = 0
    for e in events:
        if not e.historical:
            continue
        n += 1
        pool = getattr(e, pool_attr)
        rr.append(M.reciprocal_rank(pool, [e.truth]))
        for k in (1, 3, 5, 10):
            hits[k] += M.top_k(pool, [e.truth], k)
        per_player[e.tag].append(1.0 if (pool and pool[0] == e.truth) else 0.0)
    return {"n": n, "mrr": M.mean(rr) if rr else 0.0,
            "recall": {k: hits[k] / n for k in (1, 3, 5, 10)} if n else {},
            "per_player": dict(per_player)}


def load_players(con, tags, chunk=60):
    """(tag, domain) -> ordered plays. ONE batched query per chunk of players,
    hitting idx_battles_tag. Never one query per battle."""
    out = collections.defaultdict(list)
    for i in range(0, len(tags), chunk):
        part = list(tags[i:i + chunk])
        q = ("select player_tag, game_mode, battle_time, player_card_keys "
             "from battles where player_tag in (%s)" % ",".join(["?"] * len(part)))
        for tag, mode, ts, cards in con.execute(q, part):
            dom = classify_domain(mode)
            if dom is None:
                continue
            deck = deck_key(cards)
            if deck is None:
                continue
            out[(tag, dom)].append((ts, deck))
    for key in out:
        out[key].sort(key=lambda r: r[0])
    return out


def collect(by_player, min_plays):
    events = collections.defaultdict(list)
    players = collections.defaultdict(set)
    domains_of = collections.defaultdict(set)
    for (tag, dom), plays in by_player.items():
        if len(plays) >= min_plays:
            domains_of[tag].add(dom)
    for (tag, dom), plays in by_player.items():
        if len(plays) < min_plays:
            continue
        players[dom].add(tag)
        events[dom].extend(switch_events(tag, dom, plays))
    return events, players, domains_of


def _rate_ci(events, iters):
    per = collections.defaultdict(list)
    for e in events:
        per[e.tag].append(1.0 if e.historical else 0.0)
    if not per:
        return None, None
    return sig.bootstrap_mean(dict(per), iters=iters), per


def report(events, players, domains_of, timings, iters):
    o = ["=" * 72, "PHASE 17B - HISTORICAL SWITCH FEASIBILITY", "=" * 72,
         "Production semantics: consecutive plays, same player, same domain.",
         "A SWITCH is a next deck that is not the current deck.",
         "HISTORICAL means that exact deck appeared for this player, in this",
         "domain, strictly before the prediction timestamp.",
         "Retrieval pools EXCLUDE the current deck (see switch_events).", ""]
    pooled_rate = {}
    r0_at3 = {}
    for dom in DOMAINS:
        evs = events.get(dom) or []
        if not evs:
            o += ["=" * 72, "DOMAIN: %s - no events" % dom.upper(), "=" * 72, ""]
            continue
        hist = [e for e in evs if e.historical]
        ci, per = _rate_ci(evs, iters)
        macro = M.mean([M.mean(v) for v in per.values()])
        pooled = len(hist) / len(evs)
        pooled_rate[dom] = pooled
        o += ["=" * 72, "DOMAIN: %s" % dom.upper(), "=" * 72,
              "Players:            %d" % len(players.get(dom, ())),
              "Switch events:      %d" % len(evs),
              "Historical:         %d" % len(hist),
              "Novel:              %d" % (len(evs) - len(hist)),
              "Historical %%:       %.1f%% pooled    %.1f%% player-macro"
              % (100 * pooled, 100 * macro),
              "  95%% CI (player-level bootstrap): [%.1f%%, %.1f%%]"
              % (100 * ci.low, 100 * ci.high), ""]

        o.append("RETURN RECENCY (historical switches, n=%d)" % len(hist))
        rb = collections.Counter(recency_bucket(e.outings_ago) for e in hist)
        for _lo, _hi, label in RECENCY_BUCKETS:
            o.append("   %-16s %8d %6.1f%%"
                     % (label, rb[label], 100 * rb[label] / max(1, len(hist))))
        o.append("")

        o.append("HISTORICAL RETRIEVAL (historical switches only, no ML)")
        o.append("   %-28s %7s %7s %7s %7s %8s %10s"
                 % ("baseline", "R@1", "R@3", "R@5", "R@10", "MRR", "macro R@1"))
        for name, attr in (("R0 most recently played", "pool_recent"),
                           ("R1 most frequently played", "pool_freq")):
            r = retrieval(evs, attr)
            if attr == "pool_recent":
                r0_at3[dom] = r["recall"].get(3, 0.0)
            mac = (M.mean([M.mean(v) for v in r["per_player"].values()])
                   if r["per_player"] else 0.0)
            o.append("   %-28s %6.1f%% %6.1f%% %6.1f%% %6.1f%% %8.3f %9.1f%%"
                     % (name, 100 * r["recall"].get(1, 0), 100 * r["recall"].get(3, 0),
                        100 * r["recall"].get(5, 0), 100 * r["recall"].get(10, 0),
                        r["mrr"], 100 * mac))
        o.append("")

        o.append("PLAYER TYPE")
        o.append("   %-22s %8s %12s %8s %11s"
                 % ("group", "events", "historical", "novel", "avg vocab"))
        for label, pred in (("competitive-only",
                             lambda t: domains_of.get(t) == {"competitive"}),
                            ("duel-capable",
                             lambda t: "duel" in domains_of.get(t, ()))):
            sel = [e for e in evs if pred(e.tag)]
            if not sel:
                o.append("   %-22s %8d %11s %8s %11s"
                         % (label, 0, "-", "-", "-"))
                continue
            h = sum(1 for e in sel if e.historical)
            o.append("   %-22s %8d %11.1f%% %7.1f%% %11.1f"
                     % (label, len(sel), 100 * h / len(sel),
                        100 * (len(sel) - h) / len(sel),
                        M.mean([float(e.vocab) for e in sel])))
        o.append("")

        o.append("DECK VOCABULARY (distinct decks seen strictly before the step)")
        o.append("   %-12s %8s %12s %8s %12s"
                 % ("vocab", "events", "historical", "novel", "R0 R@1"))
        for lo, hi in VOCAB_BUCKETS:
            label = "%d-%s" % (lo, "+" if hi > 1000 else str(hi))
            sel = [e for e in evs if lo <= e.vocab <= hi]
            if not sel:
                continue
            h = sum(1 for e in sel if e.historical)
            r = retrieval(sel, "pool_recent")
            o.append("   %-12s %8d %11.1f%% %7.1f%% %11.1f%%"
                     % (label, len(sel), 100 * h / len(sel),
                        100 * (len(sel) - h) / len(sel),
                        100 * r["recall"].get(1, 0)))
        o.append("")

    o += ["=" * 72, "PERFORMANCE", "=" * 72,
          "   db read      %.1fs" % timings["db"],
          "   processing   %.1fs" % timings["compute"],
          "   total        %.1fs" % timings["total"], ""]

    o += ["=" * 72, "PHASE 17B GATE", "=" * 72]
    for dom in DOMAINS:
        if dom not in pooled_rate:
            continue
        p = pooled_rate[dom]
        h1 = "PASS" if p >= 0.80 else ("PARTIAL" if p >= 0.60 else "FAIL")
        h2 = "PASS" if r0_at3.get(dom, 0) >= 0.50 else "FAIL"
        o.append("%-12s H1 historical return %5.1f%% -> %-8s"
                 "H2 R0 R@3 %5.1f%% -> %s"
                 % (dom, 100 * p, h1, 100 * r0_at3.get(dom, 0), h2))
    o += ["", "RECOMMENDATION"]
    for dom in DOMAINS:
        if dom not in pooled_rate:
            continue
        p, r3 = pooled_rate[dom], r0_at3.get(dom, 0)
        if p >= 0.80 and r3 >= 0.50:
            rec = "build historical-deck ranker"
        elif p >= 0.60:
            rec = "hybrid historical + novel predictor"
        else:
            rec = ("do NOT pursue historical retrieval; "
                   "investigate novel-deck prediction")
        o.append("   %-12s %s" % (dom, rec))
    o += ["", "STOP HERE. The measurement is the deliverable."]
    return "\n".join(o)


def main(argv=None):
    ap = argparse.ArgumentParser(description="OIE Phase 17B feasibility")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--players", type=int, default=400)
    ap.add_argument("--tags", default="")
    ap.add_argument("--min-plays", type=int, default=10)
    ap.add_argument("--bootstrap", type=int, default=1000)
    args = ap.parse_args(argv)
    if not args.report:
        ap.print_help()
        return 0
    if not args.tags:
        print("--tags <json list of player tags> is required", file=sys.stderr)
        return 2

    import clash_data as cd
    path = cd.resolve_db_path()
    if not path:
        print("no database", file=sys.stderr)
        return 2

    tags = json.load(open(args.tags))[:args.players]
    t0 = time.time()
    con = sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)
    tdb = time.time()
    by_player = load_players(con, tags)
    tdb_done = time.time()
    events, players, domains_of = collect(by_player, args.min_plays)
    print(report(events, players, domains_of,
                 {"db": tdb_done - tdb, "compute": time.time() - tdb_done,
                  "total": time.time() - t0}, args.bootstrap))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
