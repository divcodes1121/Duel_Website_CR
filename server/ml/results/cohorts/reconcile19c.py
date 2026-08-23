"""19C/19D reconciliation — the shadow log against REAL later battles.

Supersedes the scratchpad's checkpoint19c.py / final19c.py, both of which
loaded only tags_duel/tags_comp/tags and would therefore have reconciled the
ORIGINAL cohort alone. Wave 2's 1,084 players hash to nothing without
tags_wave2.json, and the failure is silent: unresolved hashes are simply not
counted, so the run reports a small clean-looking answer instead of an error.
That is the exact trap the READMEs record, and it was still live in the runner.

Two changes make it unrepeatable:

* every cohort file is REQUIRED. A missing one raises instead of being
  swallowed by `except Exception: pass`.
* the resolution rate is printed before any scoring, so a tag list that does
  not cover the log is visible in seconds rather than after a 15-minute run.

Extra tags are free: a tag that matches no anchor costs one hash and is
dropped, so over-supplying the list can only help.

    python server/ml/results/cohorts/reconcile19c.py
"""
import collections
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..", "..")))

from ml.production import shadow, source  # noqa: E402

COHORTS = (
    "tags_duel.json",
    "tags_comp.json",
    "tags.json",
    "tags_wave2.json",
    "tags_duel_wave2.json",
)


def load_tags():
    tags, seen = [], set()
    for name in COHORTS:
        path = os.path.join(HERE, name)
        if not os.path.exists(path):
            raise SystemExit(
                "MISSING COHORT %s\n"
                "Reconciliation cannot resolve players whose tag list is absent, "
                "and it would report a smaller answer rather than fail." % path
            )
        before = len(tags)
        for t in json.load(open(path)):
            if t not in seen:
                seen.add(t)
                tags.append(t)
        print("  %-24s %5d tags (+%d new)" % (name, len(json.load(open(path))), len(tags) - before))
    return tags


def main():
    print("cohorts")
    tags = load_tags()
    print("  %-24s %5d unique\n" % ("TOTAL", len(tags)))

    rows = shadow.load()
    hashes = {shadow._hash(t) for t in tags}
    anchors = {(r["player"], r["domain"]) for r in rows if r.get("anchorTs")}
    resolvable = {a for a in anchors if a[0] in hashes}

    per_domain = collections.Counter(d for _h, d in anchors)
    per_domain_ok = collections.Counter(d for _h, d in resolvable)
    print("log: %d records, %d anchors" % (len(rows), len(anchors)))
    for dom in sorted(per_domain):
        got, tot = per_domain_ok[dom], per_domain[dom]
        print("  %-12s %4d/%4d anchors resolvable (%.1f%%)"
              % (dom, got, tot, 100.0 * got / tot if tot else 0.0))

    if not resolvable:
        raise SystemExit("\nNO anchors resolve to a supplied tag — wrong cohort files. Stopping.")
    if len(resolvable) < 0.5 * len(anchors):
        print("\nWARNING: under half of anchors resolve. Expect an understated answer.")

    print("\nreconciling (loads full history per player; minutes, not seconds)...\n")
    source.clear_cache()
    t0 = time.time()
    ck = shadow.checkpoint(tags, lambda tag, dom: source.load_plays(tag, dom), rows)
    print(shadow.checkpoint_report(ck))

    print()
    print("=" * 78)
    print("PER-BAND PLAYER COUNTS")
    print("=" * 78)
    for dom in sorted(ck):
        bands = ck[dom]["bands"]
        print("   %-12s %s" % (dom, {k: v.get("players") for k, v in sorted(bands.items())} or "none"))

    elapsed = time.time() - t0
    print("\nreconciliation took %.0fs" % elapsed)

    out = os.path.join(HERE, "checkpoint-19d.json")
    json.dump({d: {k: v for k, v in c.items() if k != "integrity"} for d, c in ck.items()},
              open(out, "w"), indent=1, default=str)
    print("wrote %s" % out)


if __name__ == "__main__":
    main()
