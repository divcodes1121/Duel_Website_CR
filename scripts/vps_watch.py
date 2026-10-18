"""vps_watch.py — notice from OUTSIDE that the VPS is down, and start it again.

    python3 scripts/vps_watch.py            # what .github/workflows/vps-watch.yml runs
    python3 scripts/vps_watch.py --dry-run  # probe and say what it would do

WHY IT RUNS SOMEWHERE ELSE (2026-10-18). The VPS received a power-button press
from the hypervisor at 17:16 UTC and shut itself down cleanly. Nothing on the
box can notice that — it is off — so the site sat dead until a person opened
the Contabo panel half an hour later. This runs on GitHub's machines every ten
minutes and asks api.deckkies.com what a visitor asks.

WHAT IT DOES, in order:
  1. Probe the public status route up to PROBES times, PROBE_GAP_S apart. One
     good answer = healthy, exit 0. (A slow minute is not an outage.)
  2. All failed and no Contabo API credentials configured: exit 1. GitHub mails
     the repository owner when a scheduled run fails — that IS the alert.
  3. Credentials configured: read the instance's status from the Contabo API
     (found by its IP, so no instance id has to be copied anywhere).
       - "stopped"  -> START it, then wait for the site to answer.
       - "running"  -> it is on but unreachable. A power-cycle is NOT done by
                       default: it cuts the bot mid-write, and an unreachable
                       box is as often Contabo's network as a hung kernel. Set
                       the repository variable VPS_RESTART_RUNNING=yes to allow
                       it. Either way the run fails so the owner hears of it.
       - anything else (pending_payment, rescue, ...) -> no action, run fails
                       with the status in the log.

Credentials come only from the environment (GitHub secrets) and are never
printed. Contabo API keys live under "API" in the Contabo customer panel.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

STATUS_URL = os.getenv("VPS_STATUS_URL", "https://api.deckkies.com/api/analytics/status")
VPS_IP = os.getenv("VPS_IP", "169.58.237.142")
PROBES = int(os.getenv("VPS_PROBES", "3"))
PROBE_GAP_S = float(os.getenv("VPS_PROBE_GAP", "60"))
PROBE_TIMEOUT_S = 20
BACK_WAIT_S = 8 * 60

TOKEN_URL = "https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token"
API = "https://api.contabo.com/v1/compute/instances"


def log(msg: str) -> None:
    print(msg, flush=True)


def probe() -> bool:
    try:
        req = urllib.request.Request(STATUS_URL, headers={"User-Agent": "deckkies-vps-watch"})
        with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT_S) as res:
            return res.status == 200
    except Exception:
        return False


def site_answers(tries: int, gap: float) -> bool:
    for i in range(tries):
        if probe():
            log(f"probe {i + 1}/{tries}: answered")
            return True
        log(f"probe {i + 1}/{tries}: no answer")
        if i + 1 < tries:
            time.sleep(gap)
    return False


def plan(status: str | None, restart_running: bool) -> str:
    """What to do for a Contabo instance status. PURE — the test holds it."""
    if status == "stopped":
        return "start"
    if status == "running":
        return "restart" if restart_running else "alert"
    return "alert"


def _call(url: str, *, token: str | None = None, data: bytes | None = None,
          form: bool = False, method: str = "GET") -> dict:
    headers = {"User-Agent": "deckkies-vps-watch", "x-request-id": str(uuid.uuid4())}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if data is not None:
        headers["Content-Type"] = (
            "application/x-www-form-urlencoded" if form else "application/json")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = res.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def contabo_token() -> str | None:
    need = ("CONTABO_CLIENT_ID", "CONTABO_CLIENT_SECRET", "CONTABO_API_USER",
            "CONTABO_API_PASSWORD")
    if not all(os.getenv(k) for k in need):
        return None
    form = urllib.parse.urlencode({
        "client_id": os.environ["CONTABO_CLIENT_ID"],
        "client_secret": os.environ["CONTABO_CLIENT_SECRET"],
        "username": os.environ["CONTABO_API_USER"],
        "password": os.environ["CONTABO_API_PASSWORD"],
        "grant_type": "password",
    }).encode()
    return _call(TOKEN_URL, data=form, form=True, method="POST")["access_token"]


def find_instance(token: str, ip: str) -> dict | None:
    page = 1
    while page < 20:
        body = _call(f"{API}?page={page}&size=50", token=token)
        for inst in body.get("data") or []:
            if ((inst.get("ipConfig") or {}).get("v4") or {}).get("ip") == ip:
                return inst
        links = body.get("_links") or {}
        if not links.get("next") or links.get("next") == links.get("self"):
            return None
        page += 1
    return None


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    if site_answers(PROBES, PROBE_GAP_S):
        return 0

    log("::error::api.deckkies.com did not answer any probe")
    try:
        token = contabo_token()
    except Exception as e:
        log(f"::error::Contabo sign-in failed ({type(e).__name__}); check the CONTABO_* secrets")
        return 1
    if token is None:
        log("No Contabo API credentials configured, so nothing can be restarted from here. "
            "Restart the VPS in the Contabo panel, or add the CONTABO_* secrets.")
        return 1

    inst = find_instance(token, VPS_IP)
    if not inst:
        log(f"::error::no Contabo instance with IP {VPS_IP} on this account")
        return 1
    iid, status = inst.get("instanceId"), inst.get("status")
    action = plan(status, os.getenv("VPS_RESTART_RUNNING", "").lower() == "yes")
    log(f"Contabo says the instance is {status!r}; action: {action}")

    if action == "alert":
        if status == "running":
            log("::error::The VPS is on but unreachable. Not power-cycled (set "
                "VPS_RESTART_RUNNING=yes to allow it). Check its VNC console.")
        else:
            log(f"::error::The VPS status is {status!r}; not something to restart.")
        return 1
    if dry:
        log(f"dry run: would {action} instance {iid}")
        return 1

    _call(f"{API}/{iid}/actions/{action}", token=token, data=b"{}", method="POST")
    log(f"asked Contabo to {action} the instance; waiting for the site")
    deadline = time.time() + BACK_WAIT_S
    while time.time() < deadline:
        time.sleep(30)
        if probe():
            # Still a failed run: the owner should hear that it went down even
            # though it is back. The message says it recovered.
            log(f"::warning::The VPS was {status} and was {action}ed; the site answers again.")
            return 1
    log("::error::Asked Contabo to bring it back, but the site still does not answer.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
