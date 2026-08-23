"""Phase 16A — shadow-mode observation.

Shadow answers one question: does the thing measured offline behave the same
way against live Clash Royale history? The offline bands came from a 400-player
cache; production traffic is a different distribution and it gets to disagree.

WHAT IS RECORDED, AND WHAT DELIBERATELY IS NOT. Enough to diagnose a production
problem, and nothing more:

  recorded     a salted tag HASH, domain, history depth, cluster size, change
               probability, confidence band, alternative count, degraded flag
               and reason, latency, and a deck HASH for later reconciliation
  not recorded card lists, deck contents, player tags, opponent identities

The deck hash is what makes accuracy measurable later without ever storing a
deck: a follow-up pass reads what the player actually brought next and compares
hashes. `reconcile()` does that, and it is the only way the live equivalents of
Phase 14's confidence bands can be computed.

The log is append-only JSONL, gitignored, and capped. Nothing here can fail a
request — every entry point swallows its own errors.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import uuid
import time

LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "results")
#: Overridable so a test can NEVER reach the production log. This is not a
#: convenience: `test_anchor_is_battle_time_format_not_wall_clock` called
#: os.remove() on this exact path, and running the suite is what destroyed the
#: 1,277 observations collected in 16C.
LOG_PATH = os.getenv("CLASH_OIE_LOG", os.path.join(LOG_DIR, "shadow-log.jsonl"))

#: Rotate rather than grow without bound. Shadow is a diagnostic, not a warehouse.
MAX_BYTES = 8 * 1024 * 1024

#: Salt so a tag hash is not reversible by hashing the public tag list.
_SALT = os.getenv("CLASH_OIE_SALT", "oie-shadow-v1")

_lock = threading.Lock()

#: Write-path counters. A failure that increments one of these is visible in
#: `write_stats()` instead of vanishing into a bare except.
_stats = {"written": 0, "errors": 0, "lockFailures": 0, "rotateFailures": 0}


def _hash(value: str) -> str:
    return hashlib.sha256((_SALT + "|" + (value or "")).encode()).hexdigest()[:16]


def deck_hash(cards) -> str:
    """Order-independent identity of a deck. Never the cards themselves."""
    return hashlib.sha256(",".join(sorted(cards or [])).encode()).hexdigest()[:16]


#: Stamped on every observation so a mid-experiment change cannot silently mix
#: two systems in one log. Bump whichever part actually changed.
VERSIONS = {
    "model": "m2-change-v1",
    "features": "phase2-21",
    "policy": "phase17a-calibrated",
    "candidates": "c1-wide-playerpool",
    "calibration": "band-calibration-v1",
}


def record(tag: str, domain: str, result, n_plays: int, cluster_size: int,
           latency_ms: float, n_candidates: int = 0,
           anchor_ts: str = "") -> None:
    """Append one observation. Never raises.

    `anchor_ts` is the BATTLE TIME of the play the prediction was made from,
    and it is what makes reconciliation possible. The `ts` field is wall-clock
    observation time in a different format entirely; matching against it would
    compare "2026-08-19T12:00:00Z" with "20260819T120000.000Z" and silently
    find nothing.
    """
    try:
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "anchorTs": anchor_ts or "",
            "versions": dict(VERSIONS),
            "player": _hash(tag),
            "domain": domain,
            "plays": n_plays,
            "clusterSize": cluster_size,
            "candidates": n_candidates,
            "pChange": round(float(result.change_probability), 3),
            "confidence": result.primary_confidence,
            "alternatives": len(result.alternatives),
            "degraded": bool(result.degraded),
            "reason": (result.reason or "")[:80],
            "latencyMs": round(latency_ms, 1),
            "primaryHash": deck_hash(result.primary_deck),
            "altHashes": [deck_hash(a["cards"]) for a in result.alternatives],
        }
        entry["id"] = uuid.uuid4().hex[:16]
        _append(entry)
    except Exception:
        _stats["errors"] += 1


# --------------------------------------------------------------------------
# DURABLE APPEND — Phase 19C-FIX
#
# The 1,277 observations collected in 16C were lost, and the previous
# implementation had two paths that could do it silently:
#
#   * rotation used a FIXED `.1` name, so a second rotation overwrote the
#     first archive with no trace;
#   * the whole body sat inside `except Exception: pass`, so any failure —
#     including a Windows rename against a file another process held open —
#     discarded the record and said nothing.
#
# Three processes were appending to one file during that window (the API
# server, the browser-driven server, the collection script) and the
# `threading.Lock` guarding all of it is per-process, so it coordinated
# nothing across them.
#
# The fix is deliberately small: a cross-process file lock, rotation that
# cannot overwrite, and a rule that a failed lock still writes. An unlocked
# append is far better than a lost observation — O_APPEND is atomic for small
# records on both platforms, so the lock is protecting rotation more than it
# is protecting the append itself.
# --------------------------------------------------------------------------

class _CrossProcessLock:
    """Best-effort exclusive lock. Never blocks a write from happening."""

    def __init__(self, path: str):
        self.path = path + ".lock"
        self.fh = None
        self.held = False

    def __enter__(self):
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            self.fh = open(self.path, "a+b")
            self.fh.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.fh.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(self.fh.fileno(), fcntl.LOCK_EX)
            self.held = True
        except Exception:
            # Contended or unsupported. Proceed WITHOUT the lock rather than
            # dropping the record — that trade is the whole point of this fix.
            self.held = False
            _stats["lockFailures"] += 1
        return self

    def __exit__(self, *_a):
        try:
            if self.held and self.fh is not None:
                self.fh.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(self.fh.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.fh.fileno(), fcntl.LOCK_UN)
        except Exception:
            pass
        finally:
            try:
                if self.fh is not None:
                    self.fh.close()
            except Exception:
                pass
        return False


def _rotate_if_needed() -> None:
    """Rotate to a TIMESTAMPED archive. Never overwrites, never discards."""
    try:
        if not os.path.exists(LOG_PATH):
            return
        if os.path.getsize(LOG_PATH) <= MAX_BYTES:
            return
        stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
        target = "%s.%s" % (LOG_PATH, stamp)
        n = 0
        while os.path.exists(target):        # never clobber an archive
            n += 1
            target = "%s.%s-%d" % (LOG_PATH, stamp, n)
        os.replace(LOG_PATH, target)
    except Exception:
        # Rotation failing must not stop the append. A log that grows past the
        # cap is a far smaller problem than one that loses records.
        _stats["rotateFailures"] += 1


def _append(entry: dict) -> None:
    line = json.dumps(entry) + "\n"
    os.makedirs(LOG_DIR, exist_ok=True)
    with _lock:                                   # threads within this process
        with _CrossProcessLock(LOG_PATH):         # and other processes
            _rotate_if_needed()
            with open(LOG_PATH, "a", encoding="utf-8") as fh:
                fh.write(line)
                fh.flush()
                os.fsync(fh.fileno())
    _stats["written"] += 1


def write_stats() -> dict:
    """Visible counters, so a silent failure stops being silent."""
    return dict(_stats)


def load(path: str = LOG_PATH) -> list:
    try:
        with open(path, encoding="utf-8") as fh:
            return [json.loads(line) for line in fh if line.strip()]
    except Exception:
        return []


def _pct(n: int, d: int) -> str:
    return "%5.1f%%" % (100.0 * n / d) if d else "    n/a"


def report(entries=None) -> str:
    """The shadow report. Distribution and health only — accuracy needs
    `reconcile()`, which requires outcomes that have not happened yet."""
    rows = load() if entries is None else entries
    out = ["=" * 62, "OPPONENT INTELLIGENCE ENGINE - SHADOW REPORT", "=" * 62]
    if not rows:
        out.append("no observations recorded yet")
        return "\n".join(out)

    import collections
    by_domain = collections.defaultdict(list)
    for r in rows:
        by_domain[r.get("domain", "?")].append(r)

    for domain, rs in sorted(by_domain.items()):
        n = len(rs)
        deg = sum(1 for r in rs if r.get("degraded"))
        conf = collections.Counter(r.get("confidence") for r in rs)
        alts = collections.Counter(r.get("alternatives", 0) for r in rs)
        reasons = collections.Counter(r.get("reason") for r in rs if r.get("reason"))
        lat = sorted(r.get("latencyMs", 0.0) for r in rs)
        pch = sorted(r.get("pChange", 0.0) for r in rs)

        def q(vals, f):
            return vals[min(len(vals) - 1, int(f * len(vals)))] if vals else 0.0

        out.append("")
        out.append("DOMAIN: %s" % domain.upper())
        out.append("  predictions        %d" % n)
        out.append("  degraded           %s" % _pct(deg, n))
        out.append("  confidence         high %s  medium %s  low %s"
                   % (_pct(conf["high"], n), _pct(conf["medium"], n),
                      _pct(conf["low"], n)))
        out.append("  alternatives       " + "  ".join(
            "%d:%s" % (k, _pct(alts[k], n)) for k in sorted(alts)))
        out.append("  P(change)          p50 %.3f  p90 %.3f  mean %.3f"
                   % (q(pch, .5), q(pch, .9), sum(pch) / n))
        out.append("  latency ms         p50 %.1f  p95 %.1f  p99 %.1f"
                   % (q(lat, .5), q(lat, .95), q(lat, .99)))
        out.append("  history depth      p50 %d plays"
                   % q(sorted(r.get("plays", 0) for r in rs), .5))
        if reasons:
            out.append("  degradation reasons:")
            for reason, c in reasons.most_common(5):
                out.append("     %-46s %s" % (reason[:46], _pct(c, n)))

    d = drift(rows)
    if d:
        out.append("")
        out.append("DRIFT vs the offline distribution (tolerance %.0f pts)"
                   % (100 * DRIFT_TOLERANCE))
        for domain, info in sorted(d.items()):
            if info["drifted"]:
                out.append("  %s: DRIFTED vs %s -> %s"
                           % (domain.upper(), info["referenceSource"], info["action"]))
                for f in info["flags"]:
                    out.append("     %-10s reference %.3f  live %.3f  (%+.3f)"
                               % (f["metric"], f["reference"], f["live"],
                                  f["live"] - f["reference"]))
            else:
                out.append("  %s: within tolerance (vs %s)"
                           % (domain.upper(), info["referenceSource"]))
        out.append("  Drift triggers EVALUATION, never an automatic retrain.")

    out.append("")
    out.append("Accuracy is NOT in this report. It needs outcomes that have not")
    out.append("happened yet — run reconcile() once the next battles land, which")
    out.append("is what produces the LIVE equivalent of Phase 14's bands.")
    return "\n".join(out)


#: What the offline evaluation saw.
#:
#: CAVEAT, AND IT MATTERS. These come from Phase 14, which scored EVERY
#: prediction step of 400 players — including thin, newly-formed shells. The
#: live path asks a different question: "what will this player bring next,
#: given the shell they are on right now", and a player being actively played
#: is by construction on a settled shell. The populations are not the same, so
#: the detector will report drift on duel from day one and that is a property
#: of this baseline rather than of the traffic.
#:
#: The reference is left MIS-SPECIFIED and labelled rather than quietly widened
#: to stop the alarm: the correct fix is to recompute it on the population the
#: live path actually samples, which needs live outcomes that do not exist yet.
#: Until then, treat a duel drift flag as expected and watch the DELTA over
#: time instead of its absolute value.
REFERENCE = {
    "competitive": {"pChange": 0.098, "high": 0.813, "medium": 0.113, "low": 0.074},
    "duel": {"pChange": 0.469, "high": 0.291, "medium": 0.215, "low": 0.495},
}

#: A band this wide is not "different traffic", it is a reason to look.
DRIFT_TOLERANCE = 0.20


BASELINE_PATH = os.path.join(LOG_DIR, "shadow-baseline.json")

#: A baseline is only worth freezing once it rests on enough INDEPENDENT
#: players. The whole evaluation philosophy here is player-aware, so a
#: thousand predictions from ten players is not a distribution.
BASELINE_MIN_PLAYERS = 100


def capture_baseline(entries=None, path: str = BASELINE_PATH,
                     min_players: int = BASELINE_MIN_PLAYERS) -> dict:
    """Freeze the CURRENT live distribution as the production reference.

    This is what makes drift detection mean the right thing. Comparing live
    traffic against the Phase 14 research distribution answers "does production
    look like our old dataset", which it never will — the research reference
    scored every prediction step including thin shells, while the live path
    only ever asks about a player's settled current shell.

    Comparing a live window against a live BASELINE answers the question that
    actually matters: "has this population changed since we last looked".

    Refuses to freeze a baseline built on too few players, per domain.
    """
    import collections
    rows = load() if entries is None else entries
    by_domain = collections.defaultdict(list)
    for r in rows:
        by_domain[r.get("domain", "?")].append(r)

    out, skipped = {}, {}
    for domain, rs in by_domain.items():
        players = len({r.get("player") for r in rs})
        if players < min_players:
            skipped[domain] = {"players": players, "needed": min_players}
            continue
        n = len(rs)
        conf = collections.Counter(r.get("confidence") for r in rs)
        out[domain] = {
            "players": players, "predictions": n,
            "pChange": round(sum(r.get("pChange", 0.0) for r in rs) / n, 4),
            "high": round(conf["high"] / n, 4),
            "medium": round(conf["medium"] / n, 4),
            "low": round(conf["low"] / n, 4),
            "captured": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    if out:
        try:
            os.makedirs(LOG_DIR, exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(out, fh, indent=1)
        except Exception:
            pass
    return {"captured": out, "skipped": skipped}


def _reference_for(domain: str, path: str = BASELINE_PATH):
    """(reference, source). A frozen production baseline wins over research."""
    try:
        with open(path, encoding="utf-8") as fh:
            base = json.load(fh)
        if domain in base:
            return base[domain], "production-baseline"
    except Exception:
        pass
    ref = REFERENCE.get(domain)
    return (ref, "research-reference") if ref else (None, "none")


def drift(entries=None) -> dict:
    """Has live behaviour moved away from what the model was validated on?

    Phase 4 measured duel churn roughly DOUBLING between July and August, so
    this environment demonstrably drifts. Detection therefore triggers
    EVALUATION, never an automatic retrain: a model refreshed on drifted data
    is not the same thing as a model shown to be better on it.
    """
    import collections
    rows = load() if entries is None else entries
    out = {}
    by_domain = collections.defaultdict(list)
    for r in rows:
        by_domain[r.get("domain", "?")].append(r)

    for domain, rs in by_domain.items():
        ref, ref_source = _reference_for(domain)
        if not ref or not rs:
            continue
        n = len(rs)
        conf = collections.Counter(r.get("confidence") for r in rs)
        live = {"pChange": sum(r.get("pChange", 0.0) for r in rs) / n,
                "high": conf["high"] / n, "medium": conf["medium"] / n,
                "low": conf["low"] / n}
        flags = []
        for key in ("pChange", "high", "medium", "low"):
            if key not in ref:
                continue
            expected = ref[key]
            delta = abs(live[key] - expected)
            if delta > DRIFT_TOLERANCE:
                flags.append({"metric": key, "reference": expected,
                              "live": round(live[key], 3),
                              "delta": round(delta, 3)})
        out[domain] = {"n": n, "live": {k: round(v, 3) for k, v in live.items()},
                       "reference": {k: ref[k] for k in live if k in ref},
                       "referenceSource": ref_source, "flags": flags,
                       "drifted": bool(flags),
                       "action": ("re-evaluate offline against recent data"
                                  if flags else "none")}
    return out


def reconcile(entries, actual_next_hash_by_key) -> dict:
    """Live accuracy per confidence band, from recorded hashes.

    `actual_next_hash_by_key` maps (player, ts) -> the deck hash the player
    actually brought next. Nothing here needs a card list.

    REPORTS SHARE AS WELL AS ACCURACY. A band being 95% accurate is only useful
    alongside how often the system actually earns it: a "high" band that fires
    on 3% of reads is a different product from one that fires on 80%.

    REPORTS PLAYER-MACRO AS WELL AS POOLED, preserving the methodology used
    since Phase 1 — predictions from one player are correlated, and a single
    heavy player must not carry the result.
    """
    import collections
    per_band = collections.defaultdict(lambda: [0, 0])
    per_band_player = collections.defaultdict(lambda: collections.defaultdict(list))
    covered = [0, 0]
    covered_player = collections.defaultdict(list)
    total = 0
    # Kept so Brier and ECE can be computed without re-deriving truth, which is
    # the expensive half of reconciliation.
    scored = []

    for e in entries:
        key = (e.get("player"), e.get("ts"))
        actual = actual_next_hash_by_key.get(key)
        if actual is None:
            continue
        total += 1
        band = e.get("confidence", "?")
        player = e.get("player")
        primary_ok = actual == e.get("primaryHash")
        in_alts = actual in set(e.get("altHashes") or [])

        per_band[band][1] += 1
        per_band[band][0] += primary_ok
        per_band_player[band][player].append(1.0 if primary_ok else 0.0)
        covered[1] += 1
        covered[0] += primary_ok or in_alts
        covered_player[player].append(1.0 if (primary_ok or in_alts) else 0.0)
        scored.append({"player": player, "pChange": e.get("pChange"),
                       "correct": bool(primary_ok), "band": band})

    def macro(by_player):
        means = [sum(v) / len(v) for v in by_player.values() if v]
        return sum(means) / len(means) if means else 0.0

    bands = {}
    for band, (correct, n) in per_band.items():
        bands[band] = {
            "predictions": n,
            "share": (n / total) if total else 0.0,
            "correct": correct,
            "accuracy": (correct / n) if n else 0.0,
            "accuracyMacro": macro(per_band_player[band]),
            "players": len(per_band_player[band]),
        }
    return {
        "total": total,
        "scored": scored,
        "bands": bands,
        "coverage": {"n": covered[1], "covered": covered[0],
                     "rate": (covered[0] / covered[1]) if covered[1] else 0.0,
                     "rateMacro": macro(covered_player)},
    }


def reconcile_report(by_domain: dict) -> str:
    """The checkpoint table: coverage AND correctness, pooled AND macro.

    `by_domain` maps domain -> the dict returned by `reconcile()`.
    """
    # The comparison column must quote the calibration WE SHIP. These were the
    # Phase 14 research figures, which Phase 17A superseded after the 16C
    # backtest showed duel "high" delivering 70.4% rather than 87.3%. Grading
    # live traffic against retired numbers would have manufactured a drift
    # signal out of our own stale constant.
    from . import policy
    ref = {d: dict(v) for d, v in policy.BAND_ACCURACY.items()}
    out = ["=" * 78, "CONFIDENCE VALIDATION - live vs offline", "=" * 78,
           "%-12s %-8s %6s %7s %8s %9s %9s %8s"
           % ("domain", "band", "preds", "share", "correct", "accuracy",
              "macro", "offline")]
    for domain in sorted(by_domain):
        res = by_domain[domain]
        for band in ("high", "medium", "low"):
            b = res["bands"].get(band)
            if not b:
                continue
            off = ref.get(domain, {}).get(band)
            out.append("%-12s %-8s %6d %6.1f%% %8d %8.1f%% %8.1f%% %7s"
                       % (domain, band, b["predictions"], 100 * b["share"],
                          b["correct"], 100 * b["accuracy"],
                          100 * b["accuracyMacro"],
                          ("%.1f%%" % (100 * off)) if off else "-"))
        cov = res["coverage"]
        out.append("%-12s %-8s %6d %6s %8s %8.1f%% %8.1f%%"
                   % (domain, "COVERED", cov["n"], "-", "-",
                      100 * cov["rate"], 100 * cov["rateMacro"]))

    out.append("")
    out.append("THE TEST: does High > Medium > Low survive real traffic?")
    for domain in sorted(by_domain):
        acc = [(b, by_domain[domain]["bands"].get(b, {}).get("accuracyMacro"))
               for b in ("high", "medium", "low")]
        have = [(b, a) for b, a in acc if a is not None]
        ordered = all(a >= c for (_x, a), (_y, c) in zip(have, have[1:]))
        out.append("  %-12s %s" % (domain, "ORDERING HOLDS" if ordered and len(have) > 1
                                   else "ORDERING BROKEN - recalibrate before any UI"))
    out.append("")
    out.append("Recalibration is the correct response to broken ordering.")
    out.append("A new model is not.")
    return "\n".join(out)


# --------------------------------------------------------------------------
# Reconciliation — what did the player ACTUALLY bring next?
# --------------------------------------------------------------------------

def outcomes_from_history(entries, plays_by_key) -> dict:
    """{(player, ts): actual next deck hash} for entries that have one.

    TEMPORAL DISCIPLINE, mirroring the research harness. A prediction is only
    reconciled against a battle that is STRICTLY LATER than the play it was
    anchored to, in the same domain, for the same player. The first such battle
    is the answer; anything after it belongs to a later prediction.

    `plays_by_key` maps player-hash -> {domain: [DeckPlay, ...]} in time order.
    The caller supplies it, so this function needs no database and is testable
    without one.
    """
    out = {}
    for e in entries:
        anchor = e.get("anchorTs") or ""
        if not anchor:
            continue                      # nothing comparable to match against
        player = e.get("player")
        domain = e.get("domain")
        plays = (plays_by_key.get(player) or {}).get(domain) or []
        nxt = None
        for p in plays:
            bt = getattr(p, "battle_time", "")
            if bt > anchor:               # STRICTLY later; ties are not "next"
                nxt = p
                break
        if nxt is None:
            continue                      # no subsequent battle yet
        cards = getattr(nxt, "cards", None)
        if not cards or len(set(cards)) != 8:
            continue                      # malformed / not a deck
        out[(player, e.get("ts"))] = deck_hash(cards)
    return out


def reconcile_from_db(entries=None, loader=None) -> dict:
    """Reconcile the shadow log against the live database, per domain.

    `loader(tag_hash, domain)` is injected so this is testable offline. In
    production it cannot be the real reader — the log stores a salted HASH and
    not the tag, by design — so reconciliation runs from a side map the caller
    holds, or from a re-run that hashes tags as it goes.
    """
    rows = load() if entries is None else entries
    if loader is None:
        return {"error": "a loader is required; the log stores hashed tags"}
    import collections
    by_domain = collections.defaultdict(list)
    for r in rows:
        by_domain[r.get("domain", "?")].append(r)

    out = {}
    for domain, rs in by_domain.items():
        plays_by_key = {}
        for r in rs:
            player = r.get("player")
            if player in plays_by_key:
                continue
            plays_by_key[player] = {domain: loader(player, domain) or []}
        truth = outcomes_from_history(rs, plays_by_key)
        out[domain] = reconcile(rs, truth)
    return out


def reconcile_from_tags(tags, load_plays, entries=None) -> dict:
    """Reconcile the log from a TAG LIST, hashing in-process.

    THE PRIVACY MODEL IS NOT RELAXED TO MAKE THIS CONVENIENT. The log keeps
    only salted hashes and no raw tag is ever written anywhere. Reconciliation
    supplies the tags it already has, this function recomputes `H(salt, tag)`
    with the same salt, and the mapping exists only for the life of the call.

    `load_plays(tag, domain)` is injected — in practice
    `ml.production.source.load_plays` — so the tag never leaves the caller.

    Reports THREE populations separately, because they diverge: a player can be
    observed without having played since, and waiting for every observed player
    to produce an outcome would wait on inactive accounts forever.
    """
    import collections
    rows = load() if entries is None else entries
    by_hash = {_hash(t): t for t in tags}

    by_domain = collections.defaultdict(list)
    for r in rows:
        by_domain[r.get("domain", "?")].append(r)

    out = {}
    for domain, rs in by_domain.items():
        observed = {r.get("player") for r in rs}
        resolvable = {h for h in observed if h in by_hash}

        plays_by_key = {}
        for h in resolvable:
            try:
                plays_by_key[h] = {domain: load_plays(by_hash[h], domain) or []}
            except Exception:
                plays_by_key[h] = {domain: []}

        truth = outcomes_from_history(rs, plays_by_key)
        with_outcome = {p for (p, _ts) in truth}
        res = reconcile(rs, truth)
        res["population"] = {
            "playersObserved": len(observed),
            "playersResolvable": len(resolvable),
            "playersWithOutcome": len(with_outcome),
            "unmappedHashes": len(observed - resolvable),
        }
        out[domain] = res
    return out


def population_line(res: dict) -> str:
    """One line stating which population a checkpoint actually rests on."""
    p = res.get("population") or {}
    return ("players observed %d | resolvable %d | with outcomes %d | "
            "reconciled predictions %d"
            % (p.get("playersObserved", 0), p.get("playersResolvable", 0),
               p.get("playersWithOutcome", 0), res.get("total", 0)))


#: A population-level confidence conclusion is refused below this many
#: independent players per domain. The whole evaluation philosophy has been
#: player-aware since Phase 1, and a thousand predictions from ten players is
#: not a distribution.
MIN_PLAYERS_FOR_CONCLUSION = 100


def checkpoint(tags, load_plays, entries=None) -> dict:
    """The 19C evidence bundle: population, health and confidence, per domain.

    Deliberately assembles rather than recomputes — `reconcile_from_tags` owns
    the hashing and the outcome matching, and duplicating either here is how two
    numbers that must agree stop agreeing.
    """
    import collections
    rows = load() if entries is None else entries
    recon = reconcile_from_tags(tags, load_plays, rows)

    # INTEGRITY GATES. A checkpoint built on a log that lost, duplicated or
    # mixed records is worse than no checkpoint, because it looks like
    # evidence. Verified only when reading the real log — an injected `entries`
    # list has no file behind it.
    integrity = verify_log() if entries is None else {"ok": True, "records": len(rows)}

    by_domain = collections.defaultdict(list)
    for r in rows:
        by_domain[r.get("domain", "?")].append(r)

    out = {}
    for domain, rs in by_domain.items():
        lat = sorted(float(r.get("latencyMs") or 0.0) for r in rs)

        def q(f):
            return lat[min(len(lat) - 1, int(len(lat) * f))] if lat else 0.0

        degraded = [r for r in rs if r.get("degraded")]
        reasons = collections.Counter(r.get("reason", "") for r in degraded)
        band_share = collections.Counter(r.get("confidence", "?") for r in rs)
        res = recon.get(domain, {})
        pop = res.get("population", {})
        stamps = {json.dumps(r.get("versions") or {}, sort_keys=True) for r in rs}
        versions_ok = len(stamps) <= 1
        out[domain] = {
            "integrity": integrity,
            "versionsConsistent": versions_ok,
            "versionStamps": len(stamps),
            "observations": len(rs),
            "population": pop,
            "latency": {"p50": q(0.5), "p95": q(0.95), "p99": q(0.99)},
            "degraded": {"n": len(degraded), "rate": len(degraded) / max(1, len(rs)),
                         "reasons": dict(reasons.most_common(4))},
            "bandShare": {b: band_share[b] / max(1, len(rs))
                          for b in ("high", "medium", "low")},
            "reconciled": res.get("total", 0),
            "scored": res.get("scored", []),
            "bands": res.get("bands", {}),
            "coverage": res.get("coverage", {}),
            "enoughPlayers": pop.get("playersWithOutcome", 0) >= MIN_PLAYERS_FOR_CONCLUSION,
        }
        out[domain]["mayConclude"] = bool(
            integrity.get("ok") and versions_ok and out[domain]["enoughPlayers"])
    return out


def band_ordering(bands: dict):
    """(holds, [(band, macro)]) using PLAYER-MACRO, the project's convention."""
    have = [(b, bands[b]["accuracyMacro"]) for b in ("high", "medium", "low")
            if b in bands]
    if len(have) < 2:
        return None, have
    return all(a >= c for (_x, a), (_y, c) in zip(have, have[1:])), have


def checkpoint_report(ck: dict) -> str:
    """The 19C report. States what it may and may not conclude."""
    from . import policy
    o = ["=" * 78, "PHASE 19C - SHADOW CHECKPOINT", "=" * 78]
    for domain in sorted(ck):
        d = ck[domain]
        p = d["population"]
        o += ["", "=" * 78, "DOMAIN: %s" % domain.upper(), "=" * 78,
              "POPULATION",
              "   players observed      %d" % p.get("playersObserved", 0),
              "   players resolvable    %d" % p.get("playersResolvable", 0),
              "   players with outcomes %d" % p.get("playersWithOutcome", 0),
              "   observations          %d" % d["observations"],
              "   reconciled            %d" % d["reconciled"],
              "",
              "HEALTH",
              "   latency p50/p95/p99   %.0f / %.0f / %.0f ms"
              % (d["latency"]["p50"], d["latency"]["p95"], d["latency"]["p99"]),
              "   degraded              %d (%.1f%%)"
              % (d["degraded"]["n"], 100 * d["degraded"]["rate"])]
        for reason, n in (d["degraded"]["reasons"] or {}).items():
            if reason:
                o.append("      %-38s %d" % (reason[:38], n))
        # SCORE-LEVEL CALIBRATION, which band cuts cannot fix. If the raw
        # score is overconfident, moving thresholds relabels predictions rather
        # than repairing the claim attached to them.
        scored = d.get("scored") or []
        if scored:
            from . import recalibrate as RC
            o += ["", "SCORE CALIBRATION (the raw P(change), independent of cuts)",
                  "   Brier %.4f   ECE %.4f   n=%d"
                  % (RC.brier(scored), RC.ece(scored), len(scored)),
                  "   %-12s %6s %12s %10s" % ("bin", "n", "claimed", "actual")]
            for b in RC.reliability(scored):
                o.append("   %-12s %6d %11.1f%% %9.1f%%"
                         % (b["bin"], b["n"], 100 * b["meanConfidence"],
                            100 * b["accuracy"]))
        o += ["", "CONFIDENCE",
              "   %-8s %8s %8s %10s %12s %10s" % ("band", "share", "n", "pooled",
                                                  "player-macro", "17A")]
        for band in ("high", "medium", "low"):
            b = d["bands"].get(band)
            share = 100 * d["bandShare"].get(band, 0.0)
            ref = policy.BAND_ACCURACY.get(domain, {}).get(band)
            reftxt = ("%.1f%%" % (100 * ref)) if ref is not None else "n/a"
            if not b:
                o.append("   %-8s %7.1f%% %8s %10s %12s %10s"
                         % (band, share, "-", "-", "-", reftxt))
                continue
            # `n` is the OUTCOME count, not the observation count. A band can
            # fire often and still be resting on a handful of real outcomes,
            # and only the second number licenses an accuracy claim.
            o.append("   %-8s %7.1f%% %8d %9.1f%% %11.1f%% %10s"
                     % (band, share, b["predictions"], 100 * b["accuracy"],
                        100 * b["accuracyMacro"], reftxt))

        holds, have = band_ordering(d["bands"])
        o.append("")
        if not d.get("integrity", {}).get("ok", True):
            o.append("   VERDICT: LOG INTEGRITY FAILED - %s"
                     % "; ".join(d["integrity"].get("problems", [])))
            o.append("   No conclusion is drawn from a log that cannot be trusted.")
        elif not d.get("versionsConsistent", True):
            o.append("   VERDICT: MIXED VERSION STAMPS (%d distinct) - the log "
                     "describes more than one system." % d.get("versionStamps", 0))
            o.append("   No conclusion is drawn. Separate the runs or recollect.")
        elif not d["enoughPlayers"]:
            o.append("   VERDICT: INSUFFICIENT EVIDENCE - %d players with outcomes, "
                     "%d required." % (p.get("playersWithOutcome", 0),
                                       MIN_PLAYERS_FOR_CONCLUSION))
            o.append("   No population-level confidence conclusion is drawn.")
        elif holds is None:
            o.append("   VERDICT: INSUFFICIENT BANDS to test ordering.")
        elif holds:
            o.append("   ORDERING HOLDS: %s"
                     % " > ".join("%s %.1f%%" % (b, 100 * a) for b, a in have))
        else:
            o.append("   ORDERING BROKEN: %s"
                     % " / ".join("%s %.1f%%" % (b, 100 * a) for b, a in have))
            o.append("   STOP. Recalibration is required before ON rollout.")
            o.append("   Recalibration is the response - not a new model.")
    return "\n".join(o)


def verify_log(path: str = LOG_PATH) -> dict:
    """Integrity report. FAILS LOUDLY rather than letting a corrupt log through.

    A checkpoint built on a log that has silently lost or duplicated records is
    worse than no checkpoint, because it looks like evidence.
    """
    out = {
        "path": path, "exists": os.path.exists(path), "sizeBytes": 0,
        "records": 0, "malformed": 0, "malformedLines": [],
        "duplicateIds": 0, "missingIds": 0, "withoutAnchor": 0,
        "earliest": "", "latest": "", "versionStamps": {},
        "archives": [], "ok": False, "problems": [],
    }
    if not out["exists"]:
        out["problems"].append("log does not exist")
        return out
    out["sizeBytes"] = os.path.getsize(path)

    seen_ids, dupes = set(), 0
    times = []
    stamps = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for i, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    out["malformed"] += 1
                    if len(out["malformedLines"]) < 5:
                        out["malformedLines"].append(i)
                    continue
                out["records"] += 1
                rid = rec.get("id")
                if not rid:
                    out["missingIds"] += 1
                elif rid in seen_ids:
                    dupes += 1
                else:
                    seen_ids.add(rid)
                if not rec.get("anchorTs"):
                    out["withoutAnchor"] += 1
                if rec.get("ts"):
                    times.append(rec["ts"])
                key = json.dumps(rec.get("versions") or {}, sort_keys=True)
                stamps[key] = stamps.get(key, 0) + 1
    except Exception as exc:
        out["problems"].append("unreadable: %s" % type(exc).__name__)
        return out

    out["duplicateIds"] = dupes
    out["versionStamps"] = stamps
    if times:
        times.sort()
        out["earliest"], out["latest"] = times[0], times[-1]
    try:
        base = os.path.basename(path)
        out["archives"] = sorted(f for f in os.listdir(os.path.dirname(path) or ".")
                                 if f.startswith(base + ".") and not f.endswith(".lock"))
    except Exception:
        pass

    if out["malformed"]:
        out["problems"].append("%d malformed record(s)" % out["malformed"])
    if dupes:
        out["problems"].append("%d duplicate observation id(s)" % dupes)
    out["ok"] = not out["problems"]
    return out


def verify_report(v: dict) -> str:
    o = ["SHADOW LOG INTEGRITY", "  path        %s" % v["path"],
         "  exists      %s" % v["exists"],
         "  size        %d bytes" % v["sizeBytes"],
         "  records     %d" % v["records"],
         "  malformed   %d %s" % (v["malformed"],
                                  v["malformedLines"] or ""),
         "  duplicates  %d" % v["duplicateIds"],
         "  no id       %d  (records written before 19C-FIX)" % v["missingIds"],
         "  no anchor   %d" % v["withoutAnchor"],
         "  window      %s -> %s" % (v["earliest"] or "-", v["latest"] or "-"),
         "  versions    %d distinct" % len(v["versionStamps"]),
         "  archives    %s" % (", ".join(v["archives"]) or "none")]
    o.append("  STATUS      %s" % ("OK" if v["ok"] else
                                   "CORRUPT - " + "; ".join(v["problems"])))
    return "\n".join(o)
