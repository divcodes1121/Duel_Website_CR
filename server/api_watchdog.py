"""api_watchdog.py — restart the analytics API when it stops doing its job.

    python3 api_watchdog.py            # one check (what the timer runs)
    python3 api_watchdog.py --dry-run  # decide and print, never restart

Run by `royalweb-watchdog.timer` every two minutes on the VPS.

WHY IT EXISTS (2026-10-18). systemd already restarts royalweb when the process
DIES (`Restart=always`). What it cannot see is a process that is alive and
useless: that night the VPS came back from a power-off, royalweb started in the
same second as the bot, its one database check failed while the bot was still
opening a 4.6 GB write-ahead log, and it served "no stored history" for half an
hour with the file intact. `clash_data.SCHEMA_RETRY_S` fixes that particular
cause; this catches the class — a hung server, a stuck pool, any cause nobody
has met yet — by asking the API the question a visitor asks.

WHAT COUNTS AS UNHEALTHY, and the rules that keep it from doing harm:
  * no answer from /api/analytics/status within PROBE_TIMEOUT_S, or not a 200;
  * or the API says `hot.available: false` while the database file EXISTS and
    the bot's maintenance flag is ABSENT. With the flag present the API is
    standing back on purpose (the bot is folding its WAL) and that is correct.
  * It takes CONSECUTIVE_BAD readings in a row (two checks, ~2 minutes apart)
    before anything is restarted — one slow answer under load is not an outage.
  * At most one restart per MIN_RESTART_GAP_S. If a restart did not help, a
    second one in quick succession will not either, and a restart loop would
    hide the real fault behind a service that never stays up.
  * It restarts ROYALWEB ONLY. The bot is the database's one writer; systemd
    already restarts it when it crashes, and killing it mid-write is the one
    thing this box must never do. The bot's state is logged, never acted on.

State lives in STATE_PATH (two numbers and a timestamp, no tags) and every
decision that is not "healthy" is one line in /var/log/clashbot/watchdog.log
(the unit appends stdout there).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

PROBE_URL = os.getenv("CLASH_WATCHDOG_URL", "http://127.0.0.1:8787/api/analytics/status")
PROBE_TIMEOUT_S = float(os.getenv("CLASH_WATCHDOG_TIMEOUT", "25"))
CONSECUTIVE_BAD = 2
MIN_RESTART_GAP_S = 15 * 60
STATE_PATH = os.getenv("CLASH_WATCHDOG_STATE", "/var/lib/royalweb-watchdog/state.json")
DB_PATH = os.getenv("CLASH_DB_PATH", "/var/clashbot/battles.db")
MAINTENANCE_FLAG = os.getenv(
    "CLASH_DB_MAINTENANCE_FLAG", os.path.join(os.path.dirname(DB_PATH) or ".", ".maintenance"))
SERVICE = "royalweb"


def probe(url: str = PROBE_URL, timeout: float = PROBE_TIMEOUT_S) -> dict:
    """One reading: {"ok": bool, "hot": bool | None, "why": str}."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as res:
            if res.status != 200:
                return {"ok": False, "hot": None, "why": f"http {res.status}"}
            body = json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return {"ok": False, "hot": None, "why": f"http {e.code}"}
    except Exception as e:  # refused, timed out, bad JSON
        return {"ok": False, "hot": None, "why": type(e).__name__}
    hot = (body.get("hot") or {}).get("available")
    return {"ok": True, "hot": bool(hot) if hot is not None else None, "why": "answered"}


def unhealthy(reading: dict, db_exists: bool, maintenance: bool) -> str | None:
    """Why this reading is a fault, or None when it is fine.

    PURE: the whole policy about what counts as broken is here, so the test can
    hold it without a server, a database or systemd.
    """
    if not reading.get("ok"):
        return f"no answer ({reading.get('why')})"
    if reading.get("hot") is False and db_exists and not maintenance:
        return "database present but the API cannot read it"
    return None


def decide(fault: str | None, state: dict, now: float) -> tuple[str, dict]:
    """("healthy" | "watching" | "restart" | "holding", new state). PURE."""
    state = dict(state)
    if fault is None:
        state["bad"] = 0
        return "healthy", state
    state["bad"] = int(state.get("bad", 0)) + 1
    if state["bad"] < CONSECUTIVE_BAD:
        return "watching", state
    last = float(state.get("lastRestart", 0) or 0)
    if last and now - last < MIN_RESTART_GAP_S:
        return "holding", state
    state["bad"] = 0
    state["lastRestart"] = now
    state["restarts"] = int(state.get("restarts", 0)) + 1
    return "restart", state


def _load_state(path: str = STATE_PATH) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(state: dict, path: str = STATE_PATH) -> None:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f)
        os.replace(tmp, path)
    except Exception as e:
        print(f"watchdog: could not save state: {e}", file=sys.stderr)


def _service_state(name: str) -> str:
    try:
        out = subprocess.run(["systemctl", "is-active", name],
                             capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    now = time.time()
    reading = probe()
    fault = unhealthy(reading, os.path.exists(DB_PATH), os.path.exists(MAINTENANCE_FLAG))
    action, state = decide(fault, _load_state(), now)
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))

    if action != "healthy" or dry:
        print(f"{stamp} {action} fault={fault!r} bad={state.get('bad')} "
              f"bot={_service_state('clashbot')}", flush=True)
    if action == "restart" and not dry:
        r = subprocess.run(["systemctl", "restart", SERVICE], capture_output=True, text=True)
        print(f"{stamp} restarted {SERVICE} exit={r.returncode} {r.stderr.strip()}", flush=True)
    if not dry:
        _save_state(state)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
