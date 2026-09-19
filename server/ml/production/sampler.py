"""R3 labelled shadow sampler.

Implements `brain-evidence/r3_sampler_design/PREREGISTRATION.md` (binding). It
makes SHADOW-ONLY predictions for a seeded random sample of tracked players at
seeded random moments, through the SAME `predictor.predict_for_tag` the Coach
observer calls, and records them `origin="sampler"` in a log of its own.

    python3 -B -m ml.production.sampler create    # once: frame, seed, schedule
    python3 -B -m ml.production.sampler tick      # every 5 min (systemd timer)
    python3 -B -m ml.production.sampler status    # counts only, never outcomes

WHAT IT MUST NEVER DO, and how each is prevented:
  write a database     - every connection it opens is `mode=ro`; the engine's
                         reads go through `cd.connect`, also `mode=ro`
  enrol a player       - it never imports `tracking` and never speaks HTTP
  answer a user        - no socket, no route; a oneshot process that exits
  store a raw tag      - players are re-derived from (seed, frame rowids) and
                         written only as the salted hash `shadow` already uses
  mix with organic     - its own `CLASH_OIE_LOG`, set before `shadow` is imported
  retry, or run twice  - a moment is attempted once; oneshot unit + flock

Any preregistered stop condition writes a STOPPED marker and disables the timer.
Nothing restarts it: a human must.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import os
import random
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request

# ---- preregistered constants (P3-P7, P12). Changing one is an Amendment. ----
N_PLAYERS = 520
K_MOMENTS = 4
WINDOW_S = 7 * 86400
MIN_SPACING_S = 86400
HORIZON_S = 7 * 86400
OBSERVED_UNTIL_S = 14 * 86400
DOMAIN = "competitive"
MAX_PER_TICK = 20
MAX_PER_HOUR = 60
MAX_PER_DAY = 600
TICK_BUDGET_S = 240
LATE_S = 30 * 60
STATUS_SLOW_S = 2.0
P95_LIMIT_MS = 5000.0
P95_WINDOW = 20
MEM_MIN_BYTES = 500 * 1024 * 1024
DISK_MIN_BYTES = 500 * 1024 * 1024      # brief section 14 ("free disk"); stricter, added
INELIGIBLE_MAX = 0.20
INELIGIBLE_MIN_MOMENTS = 100
ZERO_ELIGIBLE_MAX = 0.15
ZERO_ELIGIBLE_AFTER_S = 3 * 86400
OVERRUNS_MAX = 3
ERROR_FLOOR = 5
PREREG_SHA256 = "4c8a88dd7767d0fc7715c8954ce4ca3f3172b94dd5a78b08b1cacb9c7e2c0245"
#: brain-evidence/r3_sampler_run/AMENDMENT_1.md (approved 2026-09-19): the P12 database-write
#: MECHANISM only; rule and threshold unchanged.
AMENDMENT_1_SHA256 = "bd5b304e390c3f28b38d6ee5456adfb3ffc22cbcb2e3e94462216824495e4e6d"

STATE_DIR = os.getenv("CLASH_SAMPLER_DIR", "/var/lib/royalweb-sampler")
ENV_FILE = os.getenv("CLASH_SAMPLER_ENVFILE", "/etc/royalweb.env")
SERVER_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TIMER = "royalweb-sampler.timer"

ELIGIBLE = "eligible"
STATUSES = (ELIGIBLE, "no_record", "degraded", "no_stamp", "frame_changed", "failed",
            "identity_fail", "missed")


# --------------------------------------------------------------------------- helpers
def stamp(sec: float) -> str:
    return time.strftime("%Y%m%dT%H%M%S", time.gmtime(int(sec))) + ".000Z"


def stamp_epoch(s: str) -> int:
    return calendar.timegm(time.strptime(s[:15], "%Y%m%dT%H%M%S"))


def read_env_file(path: str = ENV_FILE) -> dict:
    out = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    out[k.strip()] = v.strip()
    except OSError:
        pass
    return out


def connect_ro(db_path: str) -> sqlite3.Connection:
    """The ONLY way this module opens the database. SQLite refuses any write."""
    return sqlite3.connect("file:%s?mode=ro" % db_path.replace("\\", "/"), uri=True, timeout=10)


def derive_schedule(seed: int, frame_rowids, n: int, k: int, t0: int,
                    window_s: int = WINDOW_S, spacing_s: int = MIN_SPACING_S):
    """[(rowid, [moment epochs])], a pure function of its arguments (P3, P4).

    Simple random sample without replacement over the frame ORDERED BY rowid,
    then k moments uniform over the window, >= spacing apart (redraw until so).
    """
    rng = random.Random(seed)
    frame = sorted(frame_rowids)
    chosen = rng.sample(frame, n)
    out = []
    for rowid in chosen:
        while True:
            ts = sorted(t0 + int(rng.random() * window_s) for _ in range(k))
            if all(b - a >= spacing_s for a, b in zip(ts, ts[1:])):
                break
        out.append((rowid, ts))
    return out


def schedule_sha(schedule) -> str:
    return hashlib.sha256(json.dumps(schedule, separators=(",", ":")).encode()).hexdigest()


def frame_sha(rowids) -> str:
    return hashlib.sha256(",".join(str(r) for r in sorted(rowids)).encode()).hexdigest()


def _load_jsonl(path):
    out = []
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        out.append({"_malformed": True})
    except OSError:
        pass
    return out


def _append(path, obj):
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(obj, sort_keys=True) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


# --------------------------------------------------------------------------- system probes
class System:
    """Every side effect outside this process, in one place so tests replace it."""

    def __init__(self, env: dict):
        self.env = env

    def _show(self, unit, prop):
        try:
            return subprocess.run(["systemctl", "show", "-p", prop, "--value", unit],
                                  capture_output=True, text=True, timeout=10).stdout.strip()
        except Exception:
            return ""

    def service_pid(self, unit):
        v = self._show(unit, "MainPID")
        return int(v) if v.isdigit() else None

    def service_nrestarts(self, unit):
        v = self._show(unit, "NRestarts")
        return int(v) if v.isdigit() else None

    def journal_errors(self, hours: int):
        """royalweb journal lines mentioning error/traceback/exception in the last `hours`."""
        try:
            out = subprocess.run(["journalctl", "-u", "royalweb", "--since", "%d hours ago" % hours,
                                  "--no-pager",
                                  "-o", "cat"], capture_output=True, text=True, timeout=30).stdout
        except Exception:
            return None
        return sum(1 for line in out.splitlines()
                   if any(w in line.lower() for w in ("error", "traceback", "exception")))

    def status_probe(self):
        port = self.env.get("CLASH_API_PORT") or "8787"
        t = time.time()
        try:
            with urllib.request.urlopen("http://127.0.0.1:%s/api/analytics/status" % port,
                                        timeout=10) as r:
                ok = r.status == 200
        except Exception:
            ok = False
        return ok, time.time() - t

    def loadavg(self):
        return os.getloadavg()[0]

    def cpus(self):
        return os.cpu_count() or 1

    def mem_available(self):
        try:
            with open("/proc/meminfo") as fh:
                for line in fh:
                    if line.startswith("MemAvailable:"):
                        return int(line.split()[1]) * 1024
        except OSError:
            pass
        return None

    def disk_free(self, path):
        try:
            return shutil.disk_usage(path).free
        except OSError:
            return None

    def disable_timer(self):
        try:
            subprocess.run(["systemctl", "disable", "--now", TIMER], capture_output=True, timeout=30)
            return True
        except Exception:
            return False


# --------------------------------------------------------------------------- cohort
class Cohort:
    def __init__(self, state_dir: str, cohort_id: str):
        self.dir = state_dir
        self.id = cohort_id
        self.config_path = os.path.join(state_dir, cohort_id + ".json")
        self.stats_path = os.path.join(state_dir, cohort_id + ".stats.jsonl")
        self.stopped_path = os.path.join(state_dir, cohort_id + ".STOPPED")
        self.complete_path = os.path.join(state_dir, cohort_id + ".COMPLETE")
        self.cfg = None

    @staticmethod
    def active(state_dir: str):
        try:
            with open(os.path.join(state_dir, "ACTIVE"), encoding="utf-8") as fh:
                cid = fh.read().strip()
            return Cohort(state_dir, cid) if cid else None
        except OSError:
            return None

    def load(self):
        with open(self.config_path, encoding="utf-8") as fh:
            self.cfg = json.load(fh)
        return self.cfg

    @property
    def log_path(self):
        return self.cfg["paths"]["log"]

    def moments(self):
        """[(key, player_hash, rowid, index, scheduled_epoch)] in schedule order."""
        out = []
        for sel in self.cfg["selection"]:
            for i, t in enumerate(sel["moments"]):
                out.append(("%s:%d" % (sel["player"], i), sel["player"], sel["rowid"], i, t))
        return out


def create(state_dir: str, db_path: str, sysio: System, now: float | None = None,
           log_dir: str | None = None, organic_log: str = "", seed: int | None = None,
           hash_fn=None, t0: int | None = None) -> Cohort:
    """Fix the cohort BEFORE any observation (P3): frame, seed, schedule, baselines."""
    now = int(now or time.time())
    t0 = int(t0 or (now - now % 300 + 300))           # the next 5-minute boundary
    os.makedirs(state_dir, mode=0o700, exist_ok=True)
    if Cohort.active(state_dir) is not None:
        raise SystemExit("a cohort is already ACTIVE; one cohort per approval")
    cohort_id = "r3s-" + time.strftime("%Y%m%dT%H%MZ", time.gmtime(t0))
    con = connect_ro(db_path)
    try:
        r0 = con.execute("SELECT MAX(rowid) FROM tracked_players").fetchone()[0]
        rows = con.execute("SELECT rowid, tag FROM tracked_players WHERE rowid <= ? ORDER BY rowid",
                           (r0,)).fetchall()
        assert con.total_changes == 0
    finally:
        con.close()
    rowids = [r for r, _t in rows]
    tag_of = dict(rows)
    seed = seed if seed is not None else secrets.randbits(32)
    schedule = derive_schedule(seed, rowids, N_PLAYERS, K_MOMENTS, t0)
    if hash_fn is None:
        from . import shadow
        hash_fn = shadow._hash
    selection = [{"rowid": r, "player": hash_fn(tag_of[r]), "moments": ts} for r, ts in schedule]
    errs24 = sysio.journal_errors(24)
    base_hourly = (errs24 or 0) / 24.0
    log_dir = log_dir or os.path.join(SERVER_DIR, "ml", "results")
    cfg = {
        "cohort": cohort_id, "createdAt": stamp(now), "T0": t0, "T0Stamp": stamp(t0),
        "windowEnd": t0 + WINDOW_S, "windowEndStamp": stamp(t0 + WINDOW_S),
        "observedUntil": stamp(t0 + OBSERVED_UNTIL_S), "horizonS": HORIZON_S,
        "n": N_PLAYERS, "k": K_MOMENTS, "minSpacingS": MIN_SPACING_S, "domain": DOMAIN,
        "seed": seed, "bootstrapSeed": secrets.randbits(32), "splitSeed": secrets.randbits(32),
        "R0": r0, "M": len(rowids), "frameSha256": frame_sha(rowids),
        "inclusionProbability": N_PLAYERS / len(rowids),
        "selection": selection, "scheduleSha256": schedule_sha(schedule),
        "limits": {"perTick": MAX_PER_TICK, "perHour": MAX_PER_HOUR, "perDay": MAX_PER_DAY,
                   "tickBudgetS": TICK_BUDGET_S, "retries": 0},
        "baseline": {"clashbotPid": sysio.service_pid("clashbot"),
                     "royalwebPid": sysio.service_pid("royalweb"),
                     "royalwebNRestarts": sysio.service_nrestarts("royalweb"),
                     "journalErrors24h": errs24,
                     "errorThresholdPerHour": max(ERROR_FLOOR, 3 * base_hourly)},
        "paths": {"log": os.path.join(log_dir, "shadow-log-sampler-%s.jsonl" % cohort_id),
                  "organicLog": organic_log},
        "preregistrationSha256": PREREG_SHA256,
        # AMENDMENT 1 (approved): the P12 database-write rule is checked by mode=ro plus
        # total_changes == 0 on every sampler-owned connection; data_version is recorded
        # per tick for information only (it moves for the BOT's commits, never ours).
        "dbWriteCheck": "amendment-1: mode=ro + total_changes==0; data_version informational",
        "amendment1": AMENDMENT_1_SHA256,
    }
    c = Cohort(state_dir, cohort_id)
    fd = os.open(c.config_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=1)
    with open(os.path.join(state_dir, "ACTIVE"), "w", encoding="utf-8") as fh:
        fh.write(cohort_id)
    c.cfg = cfg
    return c


# --------------------------------------------------------------------------- stop conditions
def _stop(c: Cohort, sysio: System, reason: str, now: float):
    with open(c.stopped_path, "w", encoding="utf-8") as fh:
        json.dump({"reason": reason, "at": stamp(now)}, fh)
    disabled = sysio.disable_timer()
    _append(c.stats_path, {"type": "stop", "at": stamp(now), "reason": reason,
                           "timerDisabled": disabled})
    return "STOPPED: " + reason


def _p95(values):
    v = sorted(values)
    return v[min(len(v) - 1, int(0.95 * len(v)))] if v else 0.0


def check_stop(c: Cohort, sysio: System, stats, now: float, tags=None, status=None):
    """The preregistered stop conditions (P12). Returns a reason, or None."""
    b = c.cfg["baseline"]
    if sysio.service_pid("clashbot") != b["clashbotPid"]:
        return "clashbot PID changed"
    if sysio.service_pid("royalweb") != b["royalwebPid"]:
        return "royalweb restarted (MainPID changed)"
    nr = sysio.service_nrestarts("royalweb")
    if nr is not None and b["royalwebNRestarts"] is not None and nr > b["royalwebNRestarts"]:
        return "royalweb NRestarts increased"
    if status is not None:
        ok, lat = status
        if not ok:
            return "/status failed"
        ticks = [s for s in stats if s.get("type") == "tick"]
        if lat > STATUS_SLOW_S and ticks and (ticks[-1].get("statusLatencyS") or 0) > STATUS_SLOW_S:
            return "/status slower than 2 s twice in a row"
    if sysio.loadavg() > 2 * sysio.cpus():
        return "load average above 2 x cores"
    mem = sysio.mem_available()
    if mem is not None and mem < MEM_MIN_BYTES:
        return "MemAvailable below 500 MB"
    for p in {c.dir, os.path.dirname(c.log_path)}:
        free = sysio.disk_free(p)
        if free is not None and free < DISK_MIN_BYTES:
            return "free disk below 500 MB"
    errs = sysio.journal_errors(1)
    if errs is not None and errs > b["errorThresholdPerHour"]:
        return "royalweb errors above 3x baseline"
    # log separation, schema, ids
    recs = _load_jsonl(c.log_path)
    if any(r.get("_malformed") for r in recs):
        return "malformed record in sampler log"
    if any(r.get("origin") != "sampler" or r.get("cohort") != c.id or r.get("schema") != 3
           for r in recs):
        return "non-sampler / wrong-cohort / wrong-schema record in sampler log"
    ids = [r.get("id") for r in recs]
    if len(ids) != len(set(ids)):
        return "duplicate record ids"
    organic = c.cfg["paths"].get("organicLog") or ""
    if organic and os.path.exists(organic) and os.path.abspath(organic) != os.path.abspath(c.log_path):
        with open(organic, encoding="utf-8", errors="replace") as fh:
            if '"origin": "sampler"' in fh.read():
                return "sampler record found in the organic log"
    if tags:
        blobs = []
        for p in (c.log_path, c.stats_path, c.config_path):
            try:
                with open(p, encoding="utf-8", errors="replace") as fh:
                    blobs.append(fh.read())
            except OSError:
                pass
        text = "\n".join(blobs)
        for t in tags:
            # "#TAG" anywhere, or the bare TAG as a whole token (a bare tag can be
            # all digits, and must not match inside an epoch or a count).
            if t and (t in text or re.search(r"(?<![0-9A-Za-z])%s(?![0-9A-Za-z])"
                                             % re.escape(t.lstrip("#")), text)):
                return "raw tag found in sampler files"
    moments = [s for s in stats if s.get("type") == "moment" and s.get("status") != "missed"]
    by_player = {}
    for m in moments:
        by_player.setdefault(m["player"], []).append(m["executedAt"])
    for ts in by_player.values():
        ts.sort()
        if any(b2 - a < MIN_SPACING_S for a, b2 in zip(ts, ts[1:])):
            return "more than one observation per player within 24 h"
    if any(m.get("dbWrite") for m in moments):
        return "database write by the sampler (total_changes on its own connection)"
    if any(m.get("status") == "identity_fail" for m in moments):
        return "served-score identity check failed"
    if len(moments) >= INELIGIBLE_MIN_MOMENTS:
        bad = sum(1 for m in moments if m.get("status") != ELIGIBLE)
        if bad / len(moments) > INELIGIBLE_MAX:
            return "more than 20% of moments ineligible or failed"
    if now - c.cfg["T0"] >= ZERO_ELIGIBLE_AFTER_S:
        good = {m["player"] for m in moments if m.get("status") == ELIGIBLE}
        if (len(c.cfg["selection"]) - len(good)) / len(c.cfg["selection"]) > ZERO_ELIGIBLE_MAX:
            return "more than 15% of selected players with 0 eligible moments after day 3"
    lat = [m["latencyMs"] for m in moments if isinstance(m.get("latencyMs"), (int, float))][-P95_WINDOW:]
    if len(lat) >= P95_WINDOW and _p95(lat) > P95_LIMIT_MS:
        return "sampler p95 latency above 5 s"
    ticks = [s for s in stats if s.get("type") == "tick"][-OVERRUNS_MAX:]
    if len(ticks) == OVERRUNS_MAX and all(t.get("overrun") for t in ticks):
        return "3 consecutive overrunning ticks"
    return None


# --------------------------------------------------------------------------- one moment
def execute_moment(c: Cohort, db_path: str, rowid: int, player: str, index: int,
                   scheduled: int, hash_fn, predictor, now_fn=time.time) -> dict:
    """Attempt ONE moment, once. Never raises; never retries."""
    from . import shadow
    started = now_fn()
    rec = {"type": "moment", "key": "%s:%d" % (player, index), "player": player, "moment": index,
           "scheduledAt": scheduled, "executedAt": int(started),
           "late": int(started) - scheduled > LATE_S, "status": "failed", "latencyMs": None,
           "recordId": None, "identity": None}
    try:
        con = connect_ro(db_path)
        try:
            row = con.execute("SELECT tag FROM tracked_players WHERE rowid = ?", (rowid,)).fetchone()
            if con.total_changes != 0:
                rec["dbWrite"] = True
                raise RuntimeError("write on a read-only connection")
        finally:
            con.close()
        tag = row[0] if row else None
        if not tag or hash_fn(tag) != player:
            rec["status"] = "frame_changed"
            return rec
        cap = {}

        def extra(result):
            served = predictor.last_served()
            st = predictor.last_stamp()
            fields = {"origin": "sampler", "cohort": c.id, "moment": index,
                      "scheduledAt": stamp(scheduled),
                      "horizonUntil": shadow._stamp_plus(st, HORIZON_S) if st else ""}
            if served is None:
                return fields
            model = predictor._load_change_model()
            p_served = 1.0 - model.predict(served).get(0, 0.0)
            cap["identity"] = p_served == result.change_probability
            cf = list(served)
            cf[predictor.F.FEATURE_NAMES.index("log_hours_since_last_play")] = 0.0
            fields["pChangeExact"] = result.change_probability
            fields["pChange9999Exact"] = 1.0 - model.predict(cf).get(0, 0.0)
            return fields

        before = os.path.getsize(c.log_path) if os.path.exists(c.log_path) else 0
        predictor.predict_for_tag(tag, DOMAIN, record_shadow=True, measurement_extra=extra)
        new = []
        if os.path.exists(c.log_path):
            with open(c.log_path, encoding="utf-8") as fh:
                fh.seek(before)
                new = [json.loads(x) for x in fh if x.strip()]
        rec["identity"] = cap.get("identity")
        if not new:
            rec["status"] = "no_record"
        else:
            r = new[-1]
            rec["recordId"] = r.get("id")
            rec["latencyMs"] = r.get("latencyMs")
            if cap.get("identity") is False:
                rec["status"] = "identity_fail"
            elif r.get("degraded"):
                rec["status"] = "degraded"
            elif not r.get("requestStamp"):
                rec["status"] = "no_stamp"
            else:
                rec["status"] = ELIGIBLE
    except Exception as exc:
        rec["status"] = "failed"
        rec["error"] = type(exc).__name__
    if rec["latencyMs"] is None:
        rec["latencyMs"] = round(1000.0 * (now_fn() - started), 1)
    return rec


# --------------------------------------------------------------------------- tick
def tick(state_dir: str, env: dict, sysio: System, db_path: str, hash_fn=None, predictor=None,
         now_fn=time.time) -> str:
    if env.get("CLASH_OIE_SAMPLER", "off") != "on":
        return "disabled (kill switch)"
    c = Cohort.active(state_dir)
    if c is None:
        return "no active cohort"
    if os.path.exists(c.stopped_path):
        return "stopped"
    if os.path.exists(c.complete_path):
        return "complete"
    c.load()
    lock = _lock(os.path.join(state_dir, "tick.lock"))
    if lock is False:
        return "busy"
    watch = None
    try:
        if predictor is None:
            from . import predictor as predictor_mod
            predictor = predictor_mod
        if hash_fn is None:
            from . import shadow
            hash_fn = shadow._hash
        start = now_fn()
        stats = _load_jsonl(c.stats_path)
        tags, wrote = _selected_tags(c, db_path)
        if wrote:
            return _stop(c, sysio, "database write by the sampler (total_changes on its own "
                                   "connection)", start)
        watch = connect_ro(db_path)
        dv0 = watch.execute("PRAGMA data_version").fetchone()[0]
        status = sysio.status_probe()
        reason = check_stop(c, sysio, stats, start, tags=tags, status=status)
        if reason:
            return _stop(c, sysio, reason, start)
        done = {s["key"] for s in stats if s.get("type") == "moment"}
        pending = [m for m in c.moments() if m[0] not in done]
        if start >= c.cfg["windowEnd"]:
            for key, player, _rowid, idx, t in pending:
                _append(c.stats_path, {"type": "moment", "key": key, "player": player,
                                       "moment": idx, "scheduledAt": t, "executedAt": None,
                                       "status": "missed", "late": None, "latencyMs": None})
            with open(c.complete_path, "w", encoding="utf-8") as fh:
                json.dump({"at": stamp(start), "missed": len(pending)}, fh)
            disabled = sysio.disable_timer()
            _append(c.stats_path, {"type": "complete", "at": stamp(start), "missed": len(pending),
                                   "timerDisabled": disabled})
            return "complete: window closed, %d missed" % len(pending)
        due = sorted((m for m in pending if m[4] <= start), key=lambda m: m[4])
        executed = [s for s in stats if s.get("type") == "moment" and s.get("executedAt")]
        hour = sum(1 for s in executed if s["executedAt"] > start - 3600)
        day = sum(1 for s in executed if s["executedAt"] > start - 86400)
        n, overrun = 0, False
        for key, player, rowid, idx, t in due:
            if n >= MAX_PER_TICK or hour + n >= MAX_PER_HOUR or day + n >= MAX_PER_DAY:
                break
            if now_fn() - start > TICK_BUDGET_S:
                overrun = True
                break
            rec = execute_moment(c, db_path, rowid, player, idx, t, hash_fn, predictor, now_fn)
            _append(c.stats_path, rec)
            n += 1
            if rec["status"] == "identity_fail":
                break
        elapsed = now_fn() - start
        overrun = overrun or elapsed > TICK_BUDGET_S
        dv_moved = watch.execute("PRAGMA data_version").fetchone()[0] != dv0
        own_write = watch.total_changes != 0
        _append(c.stats_path, {"type": "tick", "at": stamp(start), "executed": n, "due": len(due),
                               "elapsedS": round(elapsed, 2), "overrun": overrun,
                               "statusOk": status[0], "statusLatencyS": round(status[1], 3),
                               # informational (Amendment 1): other connections committed
                               "dataVersionMoved": dv_moved})
        if own_write:
            return _stop(c, sysio, "database write by the sampler (total_changes on its own "
                                   "connection)", now_fn())
        reason = check_stop(c, sysio, _load_jsonl(c.stats_path), now_fn(), tags=tags)
        if reason:
            return _stop(c, sysio, reason, now_fn())
        return "ok: executed %d of %d due" % (n, len(due))
    finally:
        try:
            watch.close()
        except Exception:
            pass
        _unlock(lock)


def _selected_tags(c: Cohort, db_path: str):
    """The selection's raw tags, IN MEMORY ONLY, for the leak scan."""
    rowids = [s["rowid"] for s in c.cfg["selection"]]
    con = connect_ro(db_path)
    try:
        out = []
        for i in range(0, len(rowids), 500):
            chunk = rowids[i:i + 500]
            out += [r[0] for r in con.execute(
                "SELECT tag FROM tracked_players WHERE rowid IN (%s)" % ",".join("?" * len(chunk)),
                chunk)]
        return out, con.total_changes != 0
    finally:
        con.close()


def _lock(path):
    try:
        import fcntl
    except ImportError:                      # not Linux (local tests): oneshot unit guards
        return None
    fh = open(path, "a+")
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fh
    except OSError:
        fh.close()
        return False


def _unlock(fh):
    if fh:
        try:
            fh.close()
        except Exception:
            pass


# --------------------------------------------------------------------------- status
def status_report(state_dir: str) -> dict:
    c = Cohort.active(state_dir)
    if c is None:
        return {"active": None}
    c.load()
    stats = _load_jsonl(c.stats_path)
    moments = [s for s in stats if s.get("type") == "moment"]
    by = {}
    for m in moments:
        by[m["status"]] = by.get(m["status"], 0) + 1
    recs = _load_jsonl(c.log_path)
    return {"cohort": c.id, "T0": c.cfg["T0Stamp"], "windowEnd": c.cfg["windowEndStamp"],
            "observedUntil": c.cfg["observedUntil"], "scheduled": len(c.moments()),
            "attempted": len(moments), "byStatus": by, "records": len(recs),
            "ticks": sum(1 for s in stats if s.get("type") == "tick"),
            "stopped": os.path.exists(c.stopped_path), "complete": os.path.exists(c.complete_path)}


# --------------------------------------------------------------------------- CLI
def main(argv):
    env = read_env_file()
    env.update({k: v for k, v in os.environ.items() if k.startswith("CLASH_OIE_SAMPLER")})
    db_path = env.get("CLASH_DB_PATH", "")
    if env.get("CLASH_OIE_SALT"):
        os.environ["CLASH_OIE_SALT"] = env["CLASH_OIE_SALT"]
    os.environ["CLASH_DB_PATH"] = db_path
    cmd = argv[1] if len(argv) > 1 else ""
    sysio = System(env)
    if cmd == "create":
        c = create(STATE_DIR, db_path, sysio, organic_log=env.get("CLASH_OIE_LOG", ""))
        print(json.dumps({"cohort": c.id, "T0": c.cfg["T0Stamp"], "M": c.cfg["M"],
                          "scheduleSha256": c.cfg["scheduleSha256"]}))
        return 0
    if cmd == "status":
        print(json.dumps(status_report(STATE_DIR), indent=1))
        return 0
    if cmd == "tick":
        c = Cohort.active(STATE_DIR)
        if c is None:
            print("no active cohort")
            return 0
        c.load()
        # BEFORE shadow is imported: this process may only ever write the sampler log.
        os.environ["CLASH_OIE_LOG"] = c.log_path
        from . import shadow
        if os.path.abspath(shadow.LOG_PATH) != os.path.abspath(c.log_path):
            print("refusing: shadow.LOG_PATH is not the sampler log")
            return 1
        print(tick(STATE_DIR, env, sysio, db_path))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
