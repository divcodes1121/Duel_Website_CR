"""db_backup.py — a verified, compressed copy of the bot's database, every day.

Until 2026-09-29 the VPS had NO backup of `/var/clashbot/battles.db`: three
one-off copies taken before cleanups (152 GB) sat on the SAME disk, 12-19 days
stale, which protected against a bad delete and against nothing else — a lost
disk or a lost VPS takes them with it. This job replaces them.

WHAT ONE RUN DOES, and each step must pass before the next one starts:

  1. **space check** — the snapshot needs the database's size again, free, plus
     headroom. Short of that it REFUSES rather than filling the disk the bot
     writes to;
  2. **snapshot + check + compress**, one of two ways:
     * `stream` (the default, once `tools/dbstream` is built): ONE read
       transaction runs `quick_check` (`integrity_check` with `--full`) and
       then emits every page of that same snapshot into zstd. No uncompressed
       copy ever touches the disk, so it needs room for ~1/6 of the database —
       which is what keeps backups possible at a full ten-month window
       (~260 GB on a 387 GB disk);
     * `copy` (fallback, or `--copy`): SQLite's online backup API into a temp
       file, the check on the COPY, then zstd. Needs the database's size free.
     Either way the bot keeps writing (WAL) and the result is exactly the
     database as of one moment. (A plain file copy of a live SQLite database
     is not a backup — it can be torn mid-write.);
  3. **verify the archive** — `zstd -t` re-reads it end to end, and a SHA-256
     is taken of the compressed file;
  5. **extras** — everything else that cannot be rebuilt: the bot's code and
     `.env`, `/etc/royalweb.env`, the Caddyfile, the systemd units, and this
     service's own irreplaceable state (`.tracking.db`, `.meta_history.db`,
     `.duo_pairs.db`, `.data_ledger.db`, `ml/results/`, the sampler state).
     The derived indexes (`.cluster_index.db`, `.duel_index.db`) are left out
     on purpose — they rebuild from the database in minutes;
  6. **prune** — only now, older copies IN ITS OWN DIRECTORY beyond `KEEP` are
     removed. The newest verified copy is never a candidate, and nothing
     outside `BACKUP_DIR` is ever touched.

OFF THE BOX. A copy on the same disk is a rollback, not a backup. The machine
that pulls it (`deploy/pull-backup.ps1`) re-hashes what it received and then
calls `--mark-pulled NAME SHA256`; the ledger records that only when the hash
matches, and the console shows how long ago an off-box copy was last confirmed.

    python3 db_backup.py --run [--full] [--copy]
    python3 db_backup.py --status
    python3 db_backup.py --mark-pulled NAME SHA256 [--host LABEL]
"""

from __future__ import annotations

import argparse
import contextlib
import datetime
import glob
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import data_ledger as ledger     # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.getenv("CLASH_DB_PATH", "/var/clashbot/battles.db")
BACKUP_DIR = os.getenv("CLASH_BACKUP_DIR", "/var/backups/deckkies")

#: Verified copies kept ON THE BOX. One is enough: it is a fast local rollback,
#: and the real backup is the off-box one. Each is ~10 GB compressed.
KEEP = max(1, int(os.getenv("CLASH_BACKUP_KEEP", "1")))

#: Free space the run must leave untouched beyond the snapshot itself, so a
#: backup can never be what fills the disk under the bot.
HEADROOM = int(os.getenv("CLASH_BACKUP_HEADROOM_BYTES", str(20 * 1024 ** 3)))

ZSTD_LEVEL = os.getenv("CLASH_BACKUP_ZSTD_LEVEL", "3")

#: Irreplaceable files that are not the bot's database. Globs, all optional.
EXTRA_FILES = [
    "/etc/royalweb.env",
    "/etc/caddy/Caddyfile",
    "/etc/systemd/system/royalweb*.service",
    "/etc/systemd/system/royalweb*.timer",
    "/etc/systemd/system/clashbot*.service",
    "/var/lib/royalweb-sampler",
    os.path.join(HERE, "ml", "results"),
]
#: This service's own SQLite state, copied with the backup API (never cp).
EXTRA_DBS = [".tracking.db", ".meta_history.db", ".duo_pairs.db", ".data_ledger.db"]
BOT_DIR = os.getenv("CLASH_BOT_DIR", "/opt/clashbot")
_BOT_SKIP = ("__pycache__", "venv", "logs", ".db", ".db-wal", ".db-shm", ".png")

COUNT_TABLES = ("battles", "battle_raw", "duel_timeline", "tracked_players", "player_stats_agg")

#: The streaming helper (tools/dbstream.c, built by tools/build-dbstream.sh).
DBSTREAM = os.path.join(HERE, "tools", "dbstream")

#: A stream needs room only for its output. zstd -3 measured ~6x on this
#: database; budgeting a third of the file leaves a wide margin.
STREAM_BUDGET = 3


def _stamp() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%MZ")


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _sqlite_copy(src_path: str, dst_path: str) -> None:
    """Consistent copy of a live SQLite file via the online backup API."""
    src = sqlite3.connect("file:%s?mode=ro" % src_path, uri=True, timeout=60.0)
    try:
        dst = sqlite3.connect(dst_path)
        try:
            src.backup(dst)          # pages=-1: one read transaction, one snapshot
        finally:
            dst.close()
    finally:
        src.close()


def _check(path: str, full: bool) -> tuple[str, dict]:
    con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    try:
        pragma = "integrity_check" if full else "quick_check"
        rows = [r[0] for r in con.execute("PRAGMA %s" % pragma).fetchmany(20)]
        result = "ok" if rows == ["ok"] else "; ".join(rows)
        counts = {}
        have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for t in COUNT_TABLES:
            if t in have:
                counts[t] = con.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
        if "battles" in have:
            lo, hi = con.execute("SELECT MIN(battle_time), MAX(battle_time) FROM battles").fetchone()
            counts["oldest_battle"], counts["newest_battle"] = lo, hi
        return result, counts
    finally:
        con.close()


def _counts(path: str) -> dict:
    """Row counts and the battle span, read just before a stream starts (the
    stream's own snapshot is a moment later, so these are 'at start')."""
    con = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=60.0)
    try:
        have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        out = {t: con.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
               for t in COUNT_TABLES if t in have}
        if "battles" in have:
            out["oldest_battle"], out["newest_battle"] = con.execute(
                "SELECT MIN(battle_time), MAX(battle_time) FROM battles").fetchone()
        return out
    finally:
        con.close()


def _stream(src: str, dst: str, full: bool) -> tuple[str, dict]:
    """dbstream | zstd, checked. Returns (check result, stream facts)."""
    cmd = [DBSTREAM] + (["--full"] if full else []) + [src]
    err_path = dst + ".stderr"
    with open(err_path, "wb") as err:
        producer = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err)
        consumer = subprocess.Popen(["zstd", "-q", "-%s" % ZSTD_LEVEL, "-T4", "-f", "-o", dst],
                                    stdin=producer.stdout)
        producer.stdout.close()      # so zstd sees EOF when dbstream exits
        rc_c = consumer.wait()
        rc_p = producer.wait()
    with open(err_path, encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()
    os.remove(err_path)
    checks = [ln[len("check: "):] for ln in lines if ln.startswith("check: ")]
    result = "ok" if checks == ["ok"] else ("; ".join(checks) or "no check output")
    facts = {}
    for ln in lines:
        if ln.startswith("pages: "):
            parts = ln.split()
            facts = {"pages": int(parts[1]), "page_size": int(parts[3])}
    if rc_p != 0 or rc_c != 0 or result != "ok" or not facts:
        raise RuntimeError("stream failed (dbstream %s, zstd %s): %s"
                           % (rc_p, rc_c, " | ".join(lines[-3:])))
    subprocess.run(["zstd", "-q", "-t", dst], check=True)     # re-read it end to end
    return result, facts


def _zstd(src: str, dst: str) -> None:
    subprocess.run(["zstd", "-q", "-%s" % ZSTD_LEVEL, "-T4", "-f", src, "-o", dst], check=True)
    subprocess.run(["zstd", "-q", "-t", dst], check=True)     # re-read it end to end


def _bot_filter(info: tarfile.TarInfo):
    name = info.name
    if any(part in name.split("/") for part in ("__pycache__", "venv", "venv313", "logs")):
        return None
    if name.endswith(_BOT_SKIP) or ".bak" in os.path.basename(name):
        return None
    return info


def _extras(stamp: str, work: str) -> str:
    """tar.zst of everything irreplaceable that is not the bot's database."""
    staging = os.path.join(work, "extras")
    os.makedirs(os.path.join(staging, "royalweb-state"), exist_ok=True)
    for name in EXTRA_DBS:
        src = os.path.join(HERE, name)
        if os.path.exists(src):
            _sqlite_copy(src, os.path.join(staging, "royalweb-state", name))
    tar_path = os.path.join(work, "extras-%s.tar" % stamp)
    with tarfile.open(tar_path, "w") as tar:
        tar.add(staging, arcname=".")
        if os.path.isdir(BOT_DIR):
            tar.add(BOT_DIR, arcname="opt/clashbot", filter=_bot_filter)
        for pattern in EXTRA_FILES:
            for path in sorted(glob.glob(pattern)):
                tar.add(path, arcname=path.lstrip("/"))
    out = os.path.join(BACKUP_DIR, "extras-%s.tar.zst" % stamp)
    _zstd(tar_path, out)
    os.remove(tar_path)
    os.chmod(out, 0o600)          # it holds the CR token and the analytics key
    return out


def _prune(log) -> list[str]:
    """Remove verified copies beyond KEEP, oldest first — in BACKUP_DIR only."""
    verified = [b for b in ledger.backups() if b["status"] == "verified"]
    removed = []
    for b in verified[KEEP:]:
        for path in (os.path.join(BACKUP_DIR, b["name"] + ".db.zst"),
                     os.path.join(BACKUP_DIR, b["name"].replace("battles-", "extras-") + ".tar.zst"),
                     os.path.join(BACKUP_DIR, b["name"] + ".json")):
            if os.path.dirname(os.path.abspath(path)) != os.path.abspath(BACKUP_DIR):
                raise RuntimeError("refusing to delete outside %s: %s" % (BACKUP_DIR, path))
            if os.path.exists(path):
                os.remove(path)
                removed.append(path)
        ledger.put_backup(b["name"], status="deleted", deleted_at=ledger.now_iso())
        log("pruned %s" % b["name"])
    return removed


def run(full: bool = False, copy: bool = False, log=print) -> dict:
    started = ledger.now_iso()
    stamp = _stamp()
    name = "battles-%s" % stamp
    os.makedirs(BACKUP_DIR, mode=0o700, exist_ok=True)
    db_bytes = os.path.getsize(DB_PATH)
    mode = "stream" if not copy and os.access(DBSTREAM, os.X_OK) else "copy"
    needed = (db_bytes // STREAM_BUDGET if mode == "stream" else db_bytes) + HEADROOM
    free = shutil.disk_usage(BACKUP_DIR).free
    if free < needed:
        detail = {"reason": "not_enough_space", "free": free, "needed": needed, "mode": mode}
        ledger.record_run("backup", started, "refused", detail)
        log("REFUSED: %s free, %s needed (%s)" % (free, needed, mode))
        return {"status": "refused", **detail}

    check_kind = "integrity" if full else "quick"
    ledger.put_backup(name, created_at=started, status="running", db_bytes=db_bytes,
                      mode=mode, check_kind=check_kind)
    work = tempfile.mkdtemp(prefix="deckkies-backup-", dir=BACKUP_DIR)
    zst = os.path.join(BACKUP_DIR, name + ".db.zst")
    try:
        if mode == "stream":
            counts = _counts(DB_PATH)
            log("streaming (%s_check in the same transaction) -> %s" % (check_kind, zst))
            result, facts = _stream(DB_PATH, zst, full)
            counts.update(facts)
            db_bytes = facts["pages"] * facts["page_size"]
        else:
            snap = os.path.join(work, name + ".db")
            log("snapshot -> %s" % snap)
            _sqlite_copy(DB_PATH, snap)
            log("checking (%s_check)" % check_kind)
            result, counts = _check(snap, full)
            if result != "ok":
                raise RuntimeError("the snapshot failed its check: %s" % result)
            db_bytes = os.path.getsize(snap)
            log("compressing -> %s" % zst)
            _zstd(snap, zst)
            os.remove(snap)
        os.chmod(zst, 0o600)
        ledger.put_backup(name, check_result=result, counts=json.dumps(counts), db_bytes=db_bytes)
        sha = _sha256(zst)
        log("extras")
        extras = _extras(stamp, work)
        manifest = {
            "name": name, "created_at": started, "finished_at": ledger.now_iso(), "mode": mode,
            "db": os.path.basename(zst), "sha256": sha, "zst_bytes": os.path.getsize(zst),
            "db_bytes": db_bytes,
            "extras": os.path.basename(extras), "extras_sha256": _sha256(extras),
            "extras_bytes": os.path.getsize(extras), "check": result,
            "check_kind": check_kind, "counts": counts,
        }
        with open(os.path.join(BACKUP_DIR, name + ".json"), "w") as f:
            json.dump(manifest, f, indent=2)
        ledger.put_backup(name, finished_at=manifest["finished_at"], status="verified",
                          zst_bytes=manifest["zst_bytes"], sha256=sha,
                          extras_bytes=manifest["extras_bytes"],
                          extras_sha256=manifest["extras_sha256"])
        removed = _prune(log)
        ledger.record_run("backup", started, "ok", {"name": name, "mode": mode, "removed": removed,
                                                     "zst_bytes": manifest["zst_bytes"]})
        log("done: %s (%s bytes, sha256 %s)" % (name, manifest["zst_bytes"], sha))
        return {"status": "ok", **manifest}
    except Exception as exc:   # noqa: BLE001 — recorded, then re-raised
        ledger.put_backup(name, status="failed", finished_at=ledger.now_iso())
        ledger.record_run("backup", started, "error", {"name": name, "mode": mode,
                                                       "error": type(exc).__name__,
                                                       "message": str(exc)[:300]})
        if os.path.exists(zst):
            os.remove(zst)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)


def status() -> dict:
    latest = next((b for b in ledger.backups() if b["status"] == "verified"), None)
    return {"latest": latest, "backupDir": BACKUP_DIR, "keep": KEEP}


def mark_pulled(name: str, sha256: str, host: str = "") -> dict:
    """Record an off-box copy — only if its hash is the one this box made."""
    b = ledger.get_backup(name)
    if not b or b["status"] != "verified":
        return {"ok": False, "reason": "unknown_or_unverified"}
    if (sha256 or "").lower() != (b["sha256"] or "").lower():
        return {"ok": False, "reason": "sha256_mismatch"}
    ledger.put_backup(name, pulled_at=ledger.now_iso(), pulled_host=host[:60] or None)
    return {"ok": True, "name": name}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--full", action="store_true", help="integrity_check instead of quick_check")
    ap.add_argument("--copy", action="store_true", help="temp-file copy instead of streaming")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--mark-pulled", nargs=2, metavar=("NAME", "SHA256"))
    ap.add_argument("--host", default="")
    args = ap.parse_args()
    if args.run:
        print(json.dumps(run(full=args.full, copy=args.copy), indent=2, default=str))
    elif args.mark_pulled:
        out = mark_pulled(*args.mark_pulled, host=args.host)
        print(json.dumps(out))
        return 0 if out["ok"] else 2
    else:
        print(json.dumps(status(), indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
