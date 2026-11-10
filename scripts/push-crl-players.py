"""Send CRL_Players.txt to the server as the CRL group.

CRL_Players.txt (repo root, git-ignored) is the list of players whose DUEL decks
Deckkies suggests: Team Analysis and the Deck Counter take duel lists only from
their duels, and Coach Assist, Coach Duel and 2v2 Decks read the same list as
"the CRL group". One player per line, `Name #TAG`; anything after `//` is a
note, and a line starting with `//` is skipped.

What this does, in order, and it stops at the first problem:

  1. reads the file: every tag must be a real Clash Royale tag (the letters
     0289PYLQGRJCUV, 3-12 of them); a bad line or a repeated tag is named and
     nothing is sent
  2. reads the server's current group and says who is added and who is removed
  3. writes the new group to `server/.duel_cohorts.json` on the server (mode
     600), keeping the old file beside it as `.bak-<time>` (the newest five
     are kept) and any other group in the file untouched

No restart is needed: Team Analysis rebuilds its pool when the file changes,
and the duel read is refitted on the next poll.

    python scripts/push-crl-players.py              # check, show the change, send
    python scripts/push-crl-players.py --dry-run    # check and show, send nothing

The server address comes from `--host`, then `DECKKIES_VPS`, then the first
line of the git-ignored `.vps-host` file (as `push-card-data.py`).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(ROOT, "CRL_Players.txt")
REMOTE = "/opt/royalweb/server/.duel_cohorts.json"
GROUP = "crl"
KEEP_BACKUPS = 5
#: A group smaller than this is almost certainly a mistake (an emptied file).
MIN_PLAYERS = 10

TAG = re.compile(r"#([0289PYLQGRJCUV]{3,12})\s*$")


def parse(text: str) -> tuple[list[tuple[str, str]], list[str]]:
    """`([(name, #TAG), ...], [problem, ...])` in file order."""
    players: list[tuple[str, str]] = []
    problems: list[str] = []
    seen: dict[str, int] = {}
    for n, raw in enumerate(text.splitlines(), start=1):
        line = raw.split("//", 1)[0].strip()
        if not line:
            continue
        m = TAG.search(line.upper())
        if not m:
            problems.append(f"line {n}: no valid tag at the end: {raw.strip()!r}")
            continue
        tag = "#" + m.group(1)
        name = line[: m.start()].strip() or "?"
        if tag in seen:
            problems.append(f"line {n}: {tag} is already on line {seen[tag]}")
            continue
        seen[tag] = n
        players.append((name, tag))
    return players, problems


def host_of(arg: str | None) -> str | None:
    if arg:
        return arg.strip()
    env = os.environ.get("DECKKIES_VPS", "").strip()
    if env:
        return env
    path = os.path.join(ROOT, ".vps-host")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return fh.readline().strip() or None
    return None


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=120, **kw)


def main() -> int:
    # Names hold kana, emoji and Turkish letters; a Windows console prints
    # them or a "?" instead of stopping the script.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--host")
    ap.add_argument("--user", default="root")
    ap.add_argument("--key", default=os.path.join(os.path.expanduser("~"), ".ssh", "clashbot"))
    ap.add_argument("--file", default=LIST)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if not os.path.exists(a.file):
        print(f"no {a.file}")
        return 1
    players, problems = parse(open(a.file, encoding="utf-8").read())
    if problems:
        print("Fix these lines first; nothing was sent:")
        for p in problems:
            print("  " + p)
        return 1
    if len(players) < MIN_PLAYERS:
        print(f"only {len(players)} players in the file; refusing (at least {MIN_PLAYERS})")
        return 1
    tags = [t for _, t in players]
    print(f"{len(players)} players read from {os.path.basename(a.file)}")

    host = host_of(a.host)
    if not host:
        print("no server address: pass --host, set DECKKIES_VPS, or write it to .vps-host")
        return 1
    ssh = ["ssh", "-o", "ConnectTimeout=15", "-o", "BatchMode=yes", "-i", a.key, f"{a.user}@{host}"]
    got = run(ssh + [f"cat {REMOTE} 2>/dev/null || echo '{{}}'"])
    if got.returncode != 0:
        print("could not read the server's group:", got.stderr.strip())
        return 1
    try:
        current = json.loads(got.stdout or "{}")
    except ValueError:
        print("the server's group file does not parse; nothing sent")
        return 1
    old = set(current.get(GROUP) or [])
    new = set(tags)
    names = dict((t, n) for n, t in players)
    added = [t for t in tags if t not in old]
    removed = sorted(old - new)
    print(f"server has {len(old)}; after this {len(new)}: +{len(added)} added, -{len(removed)} removed")
    for t in added[:40]:
        print(f"  + {names[t]} {t}")
    if len(added) > 40:
        print(f"  + ... and {len(added) - 40} more")
    for t in removed[:40]:
        print(f"  - {t}")
    if len(removed) > 40:
        print(f"  - ... and {len(removed) - 40} more")
    if not added and not removed:
        print("nothing to change")
        return 0
    if a.dry_run:
        print("dry run: nothing sent")
        return 0

    current[GROUP] = sorted(new)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        json.dump(current, fh, indent=1)
        local = fh.name
    try:
        stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
        up = run(["scp", "-o", "ConnectTimeout=15", "-o", "BatchMode=yes", "-i", a.key,
                  local, f"{a.user}@{host}:{REMOTE}.new"])
        if up.returncode != 0:
            print("upload failed:", up.stderr.strip())
            return 1
        swap = (
            f"set -e; python3 -c \"import json; d=json.load(open('{REMOTE}.new')); "
            f"assert len(d['{GROUP}']) == {len(new)}\"; "
            f"chmod 600 {REMOTE}.new; "
            f"if [ -f {REMOTE} ]; then cp -p {REMOTE} {REMOTE}.bak-{stamp}; fi; "
            f"mv {REMOTE}.new {REMOTE}; "
            f"ls -1t {REMOTE}.bak-* 2>/dev/null | tail -n +{KEEP_BACKUPS + 1} | xargs -r rm -f; "
            f"echo ok"
        )
        done = run(ssh + [swap])
        if done.returncode != 0 or "ok" not in done.stdout:
            print("the server refused the new file:", (done.stderr or done.stdout).strip())
            return 1
    finally:
        os.unlink(local)
    print(f"sent: the CRL group is now {len(new)} players (old file kept as .bak-{stamp})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
