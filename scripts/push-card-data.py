#!/usr/bin/env python3
"""Push the card manual's data to the analytics server. One command:

    python scripts/push-card-data.py

THE CARD MANUAL IS LIVING DATA. `All_Cards_stats.md` (repository root, kept out
of git) is edited by hand: a card's counters and synergies in its tag block, a
balance patch as a `BALANCE_PATCH` block in Appendix C. This script is how an
edit reaches the brain:

    1. BUILD     scripts/build-card-roles.py  ->  src/data/cardRoles.json
                                                 src/data/cardBalance.json
       It stops on a card key the roster does not have, an unknown vocabulary
       word, or a malformed balance line. Nothing is sent from a manual that
       does not build.
    2. TEST      the three suites that read those files (deck harmony, card
                 counters, card balance). Nothing is sent on a red suite.
    3. SEND      each file goes up beside the live one, is PARSED ON THE SERVER,
                 the live copy is backed up, and only then is it swapped in.
       The roles and the balance log are re-read by the running service within
       half a minute (`card_counters.refresh`, `card_balance._fresh`) — NO
       RESTART. The roster files (`cards.json`, `cardMeta.json`) are sent only
       when they differ, and those DO restart the analytics service: a new
       card changes what the catalogue and the deck links know.
    4. THE MANUAL ITSELF is copied to the server too (`/opt/royalweb/manual/`),
       with the last five copies kept. That is the off-machine copy of a file
       that exists nowhere else.
    5. CONFIRM   the service's status is read back until it reports the new
                 balance date and the new card count.

THE SERVER'S ADDRESS IS NOT IN THIS REPOSITORY (it is public). It is read from
`--host`, then the `DECKKIES_VPS` environment variable, then the first line of
a git-ignored `.vps-host` file at the repository root.

`--dry-run` builds, tests and shows what would be sent. `--no-manual` leaves
the manual itself at home.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")
MANUAL = os.path.join(ROOT, "All_Cards_stats.md")
REMOTE_DATA = "/opt/royalweb/src/data"
REMOTE_MANUAL = "/opt/royalweb/manual"
SERVICE = "royalweb"
STATUS_URL = "https://api.deckkies.com/api/analytics/status"

#: Re-read live by the service; never a restart.
LIVE = ("cardRoles.json", "cardBalance.json")
#: Read once at start-up; sent only when changed, and then the service restarts.
ROSTER = ("cards.json", "cardMeta.json")
SUITES = ("test_deck_harmony.py", "test_counters.py", "test_card_balance.py")
KEEP_BACKUPS = 5


def say(*a) -> None:
    print(*a, flush=True)


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def md5_lf(path: str) -> str:
    """md5 with line endings normalised — this tree is CRLF, the server's is LF."""
    with open(path, "rb") as fh:
        return hashlib.md5(fh.read().replace(b"\r\n", b"\n")).hexdigest()


def host_of(arg: str | None) -> str | None:
    if arg:
        return arg.strip()
    env = os.environ.get("DECKKIES_VPS", "").strip()
    if env:
        return env
    path = os.path.join(ROOT, ".vps-host")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            line = fh.readline().strip()
        return line or None
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--host", help="server address (else DECKKIES_VPS, else .vps-host)")
    ap.add_argument("--user", default="root")
    ap.add_argument("--key", default=os.path.join(os.path.expanduser("~"), ".ssh", "clashbot"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-manual", action="store_true", help="do not copy the manual itself")
    ap.add_argument("--skip-tests", action="store_true")
    a = ap.parse_args()

    py = sys.executable
    say("1. build")
    built = run([py, os.path.join(ROOT, "scripts", "build-card-roles.py")], cwd=ROOT)
    sys.stdout.write(built.stdout)
    if built.returncode != 0:
        sys.stderr.write(built.stderr)
        say("the manual does not build; nothing sent")
        return 1
    checked = run([py, os.path.join(ROOT, "scripts", "build-card-roles.py"), "--check"], cwd=ROOT)
    if checked.returncode != 0:
        sys.stdout.write(checked.stdout + checked.stderr)
        say("the generated files do not match the manual; nothing sent")
        return 1

    roles = json.load(open(os.path.join(DATA, "cardRoles.json"), encoding="utf-8"))
    balance = json.load(open(os.path.join(DATA, "cardBalance.json"), encoding="utf-8"))
    want_roles, want_latest = len(roles["cards"]), balance.get("latest")
    say(f"   {want_roles} cards, {len(balance['patches'])} patches, latest {want_latest}")

    if not a.skip_tests:
        say("2. test")
        for suite in SUITES:
            r = run([py, "-B", os.path.join(ROOT, "server", suite)], cwd=ROOT)
            tail = (r.stdout.strip().splitlines() or [""])[-1]
            say(f"   {suite}: {tail}")
            if r.returncode != 0:
                say("a suite is red; nothing sent")
                return 1

    host = host_of(a.host)
    if not host:
        say("no server address: pass --host, set DECKKIES_VPS, or write it to .vps-host")
        return 1
    target = f"{a.user}@{host}"
    ssh = ["ssh", "-i", a.key, "-o", "ConnectTimeout=20", "-o", "BatchMode=yes", target]
    scp = ["scp", "-q", "-i", a.key, "-o", "ConnectTimeout=20", "-o", "BatchMode=yes"]

    say("3. compare with the server")
    names = LIVE + ROSTER
    got = run(ssh + ["cd %s && for f in %s; do printf '%%s ' $f; "
                     "(tr -d '\\r' < $f | md5sum | cut -d' ' -f1) 2>/dev/null || echo none; done"
                     % (REMOTE_DATA, " ".join(names))])
    if got.returncode != 0:
        sys.stderr.write(got.stderr)
        say("cannot reach the server; nothing sent")
        return 1
    remote = dict(line.split()[:2] for line in got.stdout.strip().splitlines() if len(line.split()) >= 2)
    send = [n for n in names if remote.get(n) != md5_lf(os.path.join(DATA, n))]
    restart = any(n in ROSTER for n in send)
    for n in names:
        say(f"   {n:18} {'CHANGED' if n in send else 'same'}")
    if not send and a.no_manual:
        say("nothing to send")
        return 0
    if a.dry_run:
        say("dry run: would send", ", ".join(send) or "(no data files)",
            "and restart the service" if restart else "with no restart")
        return 0

    stamp = datetime.datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    if send:
        say("4. send")
        up = run(scp + [os.path.join(DATA, n) for n in send] + [f"{target}:/tmp/"])
        if up.returncode != 0:
            sys.stderr.write(up.stderr)
            return 1
        # Parsed on the server, the live copy backed up, then swapped in: a
        # file that does not parse there never replaces one that does.
        steps = ["set -e", f"cd {REMOTE_DATA}"]
        for n in send:
            steps += [
                f"tr -d '\\r' < /tmp/{n} > {n}.new",
                f"python3 -c \"import json,sys; d=json.load(open('{n}.new', encoding='utf-8')); "
                f"sys.exit(0 if d else 1)\"",
                f"[ -f {n} ] && cp -p {n} {n}.bak-{stamp}-manual || true",
                f"mv {n}.new {n}",
                f"rm -f /tmp/{n}",
                f"ls -1t {n}.bak-*-manual 2>/dev/null | tail -n +{KEEP_BACKUPS + 1} | xargs -r rm -f",
            ]
        if restart:
            steps += [f"systemctl restart {SERVICE}", "sleep 3", f"systemctl is-active {SERVICE}"]
        done = run(ssh + ["; ".join(steps)])
        sys.stdout.write(done.stdout)
        if done.returncode != 0:
            sys.stderr.write(done.stderr)
            say("the server refused a file; its live copies are as they were "
                "(any backup taken is beside them)")
            return 1
        say("   sent", ", ".join(send), "- service restarted" if restart else "- no restart needed")

    if not a.no_manual and os.path.exists(MANUAL):
        say("5. the manual itself")
        prep = run(ssh + [f"mkdir -p {REMOTE_MANUAL} && cd {REMOTE_MANUAL} && "
                          f"([ -f All_Cards_stats.md ] && cp -p All_Cards_stats.md "
                          f"All_Cards_stats.{stamp}.md || true) && "
                          f"ls -1t All_Cards_stats.2*.md 2>/dev/null | tail -n +{KEEP_BACKUPS + 1} "
                          f"| xargs -r rm -f"])
        up = run(scp + [MANUAL, f"{target}:{REMOTE_MANUAL}/All_Cards_stats.md"])
        if prep.returncode != 0 or up.returncode != 0:
            sys.stderr.write(prep.stderr + up.stderr)
            say("   the data is live; the manual copy FAILED")
        else:
            say(f"   copied to the server ({os.path.getsize(MANUAL) // 1024} kB), "
                f"last {KEEP_BACKUPS} copies kept")

    say("6. confirm")
    deadline = time.time() + 120
    seen = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(STATUS_URL, timeout=15) as resp:
                seen = (json.load(resp) or {}).get("cardManual")
        except Exception as exc:  # noqa: BLE001 - a restart takes a few seconds
            seen = {"error": str(exc)}
        if seen and seen.get("roles") == want_roles and seen.get("latest") == want_latest:
            say(f"   the service reports {seen['roles']} cards and balance to {seen['latest']}")
            return 0
        time.sleep(6)
    say("   NOT CONFIRMED: the service reports", seen,
        "- expected", {"roles": want_roles, "latest": want_latest})
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
