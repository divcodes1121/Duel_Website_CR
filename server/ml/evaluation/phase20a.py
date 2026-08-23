"""Phase 20A - can knowing the OPPONENT tell X which deck to bring?

    python -m ml.evaluation.phase20a --report --tags tags.json --players 400

WHY THIS IS A DIFFERENT QUESTION. Phases 1-18 asked "what deck will Y bring",
and hit hard ceilings: a switched-to deck is one Y has played only 38-50% of the
time, and a novel one usually cannot be built from what Y has shown. This asks
something narrower and, on the face of it, easier: given Y, which of X's OWN
decks should X play? X's decks are a handful of known objects rather than an
open space, so the answer is a choice among ~5-40 options, not a construction.

THE METHODOLOGICAL PROBLEM, STATED UP FRONT. This is COUNTERFACTUAL. We observe
the deck X actually played and whether they won; we never observe what would have
happened had they played a different one. So "the recommendation is better"
cannot be measured directly, and any harness that claims to has smuggled in an
assumption.

What CAN be measured, leak-free:

  * fit a matchup table on a player's EARLIER battles;
  * on their LATER battles, look only at games X actually played;
  * compare the realised win rate of games where X happened to play the
    recommended deck against games where X played their default.

That is an OBSERVATIONAL comparison, and it is confounded: X may choose a
particular deck precisely when they feel the matchup is good. The report says so
rather than quietly reporting a lift. Coverage is reported for the same reason —
a recommendation that only applies to 3% of games is not a product even if the
3% wins more.

THE ORACLE ARM matters most. It uses Y's TRUE deck, which is known in the row.
If the matchup response is unpredictable even with the opponent handed to us,
then adding Y-prediction error on top cannot rescue it, and the whole branch
closes without building anything.
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

#: A (deck, opponent-archetype) cell needs this many games before its win rate
#: is allowed to steer a recommendation. Phase 3 and 4 both lost time to a
#: single observation scoring 1.0 and outranking a well-supported alternative.
MIN_CELL_GAMES = 5

#: A player needs this many battles in a domain to be evaluated at all.
MIN_PLAYER_BATTLES = 40

#: Duels forbid card reuse across the loadout. A recommendation that repeats a
#: card X has already fielded is ILLEGAL, not merely worse — `coach.py` uses the
#: same rule (RECOMMEND_MAX_SHARED = 0), learned by recommending a Golem deck
#: that repeated Lightning and Baby Dragon.
DUEL_MAX_SHARED = 0


def classify_domain(game_mode):
    if not game_mode:
        return None
    if game_mode.lower() in META_MODES:
        return "competitive"
    if is_duel_like_mode(game_mode):
        return "duel"
    return None


def deck_key(card_json):
    """Sorted 8 cards, or None. 16/24-card duel loadouts are not decks."""
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


class Battle:
    __slots__ = ("ts", "domain", "deck", "opp_arch", "opp_deck", "won")

    def __init__(self, ts, domain, deck, opp_arch, opp_deck, won):
        self.ts, self.domain, self.deck = ts, domain, deck
        self.opp_arch, self.opp_deck, self.won = opp_arch, opp_deck, won


def load(con, tags, chunk=60):
    """(tag, domain) -> chronological battles. One batched query per chunk."""
    out = collections.defaultdict(list)
    for i in range(0, len(tags), chunk):
        part = list(tags[i:i + chunk])
        q = ("select player_tag, game_mode, battle_time, player_card_keys, "
             "       opponent_win_condition, opponent_card_keys, result "
             "from battles where player_tag in (%s)" % ",".join(["?"] * len(part)))
        for tag, mode, ts, mine, owc, theirs, res in con.execute(q, part):
            dom = classify_domain(mode)
            if dom is None or not res or res == "draw":
                continue
            deck = deck_key(mine)
            if deck is None:
                continue
            out[(tag, dom)].append(Battle(ts, dom, deck, owc or "",
                                          deck_key(theirs), res == "win"))
    for k in out:
        out[k].sort(key=lambda b: b.ts)
    return out


class MatchupTable:
    """X's win rate per (own deck, opponent key), fitted on EARLIER battles only."""

    def __init__(self, battles, key):
        self.cell = collections.defaultdict(lambda: [0, 0])   # wins, games
        self.deck_games = collections.Counter()
        for b in battles:
            k = key(b)
            if k is None:
                continue
            c = self.cell[(b.deck, k)]
            c[0] += b.won
            c[1] += 1
            self.deck_games[b.deck] += 1

    def default_deck(self):
        """What X plays when nothing is chosen for them — the baseline to beat."""
        if not self.deck_games:
            return None
        return self.deck_games.most_common(1)[0][0]

    def recommend(self, opp_key, legal=None):
        """Best-supported deck against this opponent, or None.

        Returns the deck with the highest win rate among cells clearing
        MIN_CELL_GAMES. `legal` filters to decks the duel rules still permit.
        """
        best, best_rate = None, -1.0
        for (deck, k), (wins, games) in self.cell.items():
            if k != opp_key or games < MIN_CELL_GAMES:
                continue
            if legal is not None and not legal(deck):
                continue
            rate = wins / games
            if rate > best_rate:
                best, best_rate = deck, rate
        return best

    def ranked(self, opp_key, limit=3, legal=None):
        rows = [(w / g, d) for (d, k), (w, g) in self.cell.items()
                if k == opp_key and g >= MIN_CELL_GAMES
                and (legal is None or legal(d))]
        rows.sort(reverse=True)
        return [d for _r, d in rows[:limit]]


def evaluate_player(battles, domain, split=0.7):
    """Fit on the first `split` of a player's battles, score on the rest."""
    n = len(battles)
    cut = int(n * split)
    train, test = battles[:cut], battles[cut:]
    if len(train) < MIN_CELL_GAMES * 2 or not test:
        return None

    by_arch = MatchupTable(train, lambda b: b.opp_arch or None)
    by_deck = MatchupTable(train, lambda b: b.opp_deck)
    default = by_arch.default_deck()
    if default is None:
        return None

    # In duels a recommendation may not repeat a card X has already fielded in
    # the loadout. Applied at RECOMMENDATION time, so an illegal deck is never
    # offered rather than being offered and later filtered.
    used = set()
    if domain == "duel":
        for b in train[-3:]:
            used.update(b.deck)
    legal = (lambda d: len(set(d) & used) <= DUEL_MAX_SHARED) if domain == "duel" else None

    out = {
        "default": [0, 0],        # wins, games where X played their default
        "arch": [0, 0],           # ... where X played the archetype pick
        "exact": [0, 0],          # ... where X played the exact-deck pick
        "arch_cov": [0, 0],       # a recommendation existed / test games
        "exact_cov": [0, 0],
        "arch_r1": [0, 0], "arch_r3": [0, 0],   # agreement with what X chose
        "overall": [0, 0],
    }
    for b in test:
        out["overall"][0] += b.won
        out["overall"][1] += 1
        if b.deck == default:
            out["default"][0] += b.won
            out["default"][1] += 1

        ra = by_arch.recommend(b.opp_arch or None, legal)
        out["arch_cov"][1] += 1
        if ra is not None:
            out["arch_cov"][0] += 1
            if b.deck == ra:
                out["arch"][0] += b.won
                out["arch"][1] += 1
        top3 = by_arch.ranked(b.opp_arch or None, 3, legal)
        if top3:
            out["arch_r1"][1] += 1
            out["arch_r3"][1] += 1
            out["arch_r1"][0] += (b.deck == top3[0])
            out["arch_r3"][0] += (b.deck in top3)

        # ORACLE: Y's true deck, which is known in the row.
        re_ = by_deck.recommend(b.opp_deck, legal) if b.opp_deck else None
        out["exact_cov"][1] += 1
        if re_ is not None:
            out["exact_cov"][0] += 1
            if b.deck == re_:
                out["exact"][0] += b.won
                out["exact"][1] += 1
    return out


def report(by_player, bootstrap=1000):
    o = ["=" * 76, "PHASE 20A - MATCHUP RESPONSE FEASIBILITY", "=" * 76,
         "Question: given opponent Y, can we tell X which of X's OWN decks to",
         "bring? A choice among known decks, not a construction.",
         "",
         "COUNTERFACTUAL WARNING. We only ever see the deck X actually played.",
         "The win rates below compare games where X HAPPENED to play the",
         "recommended deck against games where X played their default. That is",
         "observational and confounded - X may pick a deck precisely when the",
         "matchup already looks good. Read it as an upper bound on the signal,",
         "not as a measured lift.", ""]

    for domain in ("competitive", "duel"):
        rows = [v for (t, d), v in by_player.items() if d == domain and v]
        if not rows:
            continue
        agg = collections.defaultdict(lambda: [0, 0])
        per = collections.defaultdict(lambda: collections.defaultdict(list))
        for i, r in enumerate(rows):
            for k, (w, g) in r.items():
                agg[k][0] += w
                agg[k][1] += g
                if g:
                    per[k][i].append(w / g)

        def rate(k):
            w, g = agg[k]
            return (w / g) if g else 0.0

        def macro(k):
            v = [M.mean(x) for x in per[k].values() if x]
            return M.mean(v) if v else 0.0

        o += ["=" * 76, "%s   %d players" % (domain.upper(), len(rows)), "=" * 76,
              "%-34s %8s %9s %11s" % ("strategy", "games", "win rate", "macro"),
              "%-34s %8d %8.1f%% %10.1f%%"
              % ("X plays their default deck", agg["default"][1],
                 100 * rate("default"), 100 * macro("default")),
              "%-34s %8d %8.1f%% %10.1f%%"
              % ("...the archetype pick", agg["arch"][1],
                 100 * rate("arch"), 100 * macro("arch")),
              "%-34s %8d %8.1f%% %10.1f%%"
              % ("...the exact-deck pick (ORACLE)", agg["exact"][1],
                 100 * rate("exact"), 100 * macro("exact")),
              "%-34s %8d %8.1f%% %10.1f%%"
              % ("every test game", agg["overall"][1],
                 100 * rate("overall"), 100 * macro("overall")), ""]

        o.append("COVERAGE - did a supported recommendation exist at all?")
        for k, label in (("arch_cov", "archetype"), ("exact_cov", "exact deck")):
            w, g = agg[k]
            o.append("   %-22s %6.1f%% of test games (%d of %d)"
                     % (label, 100 * (w / g if g else 0), w, g))
        o.append("")

        o.append("AGREEMENT - is what X actually played the top pick?")
        for k, label in (("arch_r1", "Recall@1"), ("arch_r3", "Recall@3")):
            w, g = agg[k]
            o.append("   %-22s %6.1f%%   (n=%d)"
                     % (label, 100 * (w / g if g else 0), g))
        o.append("")

        # The comparison that decides it, paired on players.
        for k, label in (("arch", "archetype pick"), ("exact", "exact-deck pick")):
            a = {str(i): v for i, v in per[k].items()}
            b = {str(i): v for i, v in per["default"].items() if str(i) in a}
            a = {i: v for i, v in a.items() if i in b}
            if len(a) < 5:
                o.append("   %-22s too few players with both arms (%d)"
                         % (label, len(a)))
                continue
            d = sig.paired_delta(a, b, iters=bootstrap)
            o.append("   %-22s vs default: %+.1f pts [%+.1f, %+.1f]  %s"
                     % (label, 100 * d.point, 100 * d.low, 100 * d.high,
                        "SIGNIFICANT" if d.excludes_zero() else "not significant"))
        o.append("")

    o += ["=" * 76, "GATE", "=" * 76,
          "Matchup response is worth building only if the ORACLE arm - where Y's",
          "true deck is handed to us - clearly beats X's default. If it does not,",
          "adding Y-prediction error on top cannot rescue it.", ""]
    return "\n".join(o)


def main(argv=None):
    ap = argparse.ArgumentParser(description="OIE Phase 20A feasibility")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--tags", default="")
    ap.add_argument("--players", type=int, default=400)
    ap.add_argument("--bootstrap", type=int, default=1000)
    args = ap.parse_args(argv)
    if not args.report:
        ap.print_help()
        return 0
    if not args.tags:
        print("--tags <json list> required", file=sys.stderr)
        return 2

    import clash_data as cd
    path = cd.resolve_db_path()
    if not path:
        print("no database", file=sys.stderr)
        return 2
    tags = json.load(open(args.tags))[:args.players]
    t0 = time.time()
    con = sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)
    battles = load(con, tags)
    tdb = time.time() - t0

    out = {}
    for (tag, dom), bs in battles.items():
        if len(bs) < MIN_PLAYER_BATTLES:
            continue
        out[(tag, dom)] = evaluate_player(bs, dom)
    print(report(out, args.bootstrap))
    print("   db read %.0fs   total %.0fs" % (tdb, time.time() - t0))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
