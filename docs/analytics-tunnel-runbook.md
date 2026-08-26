# Analytics transport — configuration and runbook

## THE TUNNEL IS SUPERSEDED (2026-08-26)

The analytics service no longer runs at home behind a Cloudflare tunnel. It runs
on a **Contabo VPS** behind **Caddy**, on a domain we own. Everything below the
next section is the tunnel's record, kept because most of what it proved still
holds — the auth gate, the CORS rule, the leakage audit and the rate-limit
behaviour are properties of `server/app.py`, not of the transport.

```
browser
  → api.deckkies.com                    Caddy, TLS from Let's Encrypt
  → header_up X-Analytics-Key           the edge authenticates to the origin
  → 127.0.0.1:8787                      server/app.py (systemd: royalweb)
  → /var/clashbot/battles.db            SQLite, mode=ro

browser                                 (the Coach's opponent read only)
  → Vercel /api/analytics/opponent-read/<tag>    same origin, no key
  → Vercel function                              adds X-Analytics-Key
  → ANALYTICS_ORIGIN = https://api.deckkies.com
  → the same Caddy → app.py path
```

**Why the edge injects the key.** The browser calls `api.deckkies.com` directly
for the shareable analytics and sends no headers, so something has to
authenticate to the origin. That is only safe because the origin is unreachable
any other way: `app.py` binds `127.0.0.1:8787` and `ufw` allows nothing but
22/80/443. The key protects the origin; the rate limiter is what protects the
service from the public.

**`CLASH_TRUSTED_PROXY=1` is required here, and it was not under the tunnel.**
The limiter keys on the client address, and behind any reverse proxy every
request arrives from loopback — one shared bucket for the whole internet, which
is the failure the tunnel section documents below. With the flag set, `app.py`
reads the first entry of `X-Forwarded-For`, which Caddy sets. Spoofing it would
mean reaching 8787 directly, which the firewall and the loopback bind prevent.

### Where things live on the VPS

| | |
|---|---|
| host | `169.58.237.142` (Contabo Cloud VPS 6, Ubuntu 24.04, EU) |
| bot code | `/opt/clashbot` — venv at `/opt/clashbot/venv` |
| API code | `/opt/royalweb/server` — **no venv, `app.py` is pure stdlib** |
| data | `/var/clashbot/battles.db` |
| API env | `/etc/royalweb.env` (root-only; holds `CLASH_API_KEY`) |
| bot env | `/opt/clashbot/.env` (loaded by `load_dotenv()`, NOT by systemd) |
| units | `clashbot.service`, `royalweb.service`, `caddy.service` |
| logs | `/var/log/clashbot/{bot,api}.log` |

**The bot unit must not use `EnvironmentFile`.** `/opt/clashbot/.env` is written
`KEY = value` with spaces around the `=`; python-dotenv accepts that and systemd
does not — systemd would take the name as `KEY ` and pass nothing, silently.
`WorkingDirectory=/opt/clashbot` is what lets `load_dotenv()` find it.

**`CLASH_ARCHIVE_DB_PATH` is set explicitly empty.** `clash_data.py` defaults it
to `H:\ClashArchive\archive.db`, and the startup banner prints whatever it
resolves — on Linux that is a path that cannot exist, pointing at a volume
nobody should go looking for. There is no archive tier on the VPS by design.

### Reading the API key back

It is generated on the box and deliberately never leaves it in plain sight:

```bash
ssh -i ~/.ssh/clashbot root@169.58.237.142 'grep CLASH_API_KEY /etc/royalweb.env'
```

That value is what `CLASH_API_KEY` must be set to in Vercel's environment, next
to `ANALYTICS_ORIGIN=https://api.deckkies.com`. Neither may ever be renamed to
`VITE_*` — Vite inlines any `VITE_` variable into the browser bundle at build
time, so the naming convention IS the boundary.

---

## The tunnel, as it was (historical)

Phase 24C, step 4. How the hosted site reached the analytics service running on
a machine at home, and how to take it away again.

```
browser
  → Vercel  /api/analytics/opponent-read/<tag>      same origin, no key
  → Vercel function                                 adds X-Analytics-Key
  → Cloudflare Tunnel                               TLS terminated at the edge
  → 127.0.0.1:8787                                  server/app.py
  → SQLite on H:
```

The Python service is never exposed. `cloudflared` runs on the same machine and
dials loopback, which is also why the service does **not** treat loopback as
trusted — see `server/README.md`.

---

## What has been verified, and what has not

**Verified for real** (2026-08-24, TryCloudflare quick tunnel, edge `bom03`):

| | |
|---|---|
| tunnel → Python | ✅ real HTTPS, valid certificate, QUIC to the edge |
| authentication through the tunnel | ✅ key accepted, missing/invalid → 401 |
| leakage on the public surface | ✅ 9 routes, 0 leaks |
| response contract through the tunnel | ✅ approved fields only |
| CORS through the tunnel | ✅ one origin echoed, foreign origin gets nothing |
| rate limiting through the tunnel | ✅ 120/60 s, and see the caveat below |
| Python stays loopback-only | ✅ bound `127.0.0.1:8787`; LAN address refuses |
| failure when Python stops | ✅ edge returns 502; the proxy answers `disabled` |
| latency | ✅ measured, below |
| named connector installed | ✅ service `cloudflared`, Auto-start, connector registered |

**NOT verified — needs credentials this machine does not have:**

- a public **hostname** for the tunnel (needs a zone on the Cloudflare
  account; the connector is installed and connected, but routes to nothing
  until one is added in the dashboard)
- **Vercel** environment variables and a preview deployment (needs a Vercel login)
- therefore the **real `[tag]` dynamic-route resolution on Vercel**, and the
  full browser → Vercel → tunnel → Python chain

The **remotely-managed** section below describes what is actually installed on
this machine and was executed. The **locally-managed** section after it is
written from the Cloudflare documentation as an alternative and has NOT been
executed — do not follow both.

---

## Quick tunnel (no account) — what was used for testing

```bash
cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
```

Prints a random `https://<words>.trycloudflare.com` URL. No account, no DNS, no
credentials. **Ephemeral**: the hostname changes on every restart, so it is a
test instrument, not a deployment. Do not point a Vercel environment variable
at one and walk away.

---

## Remotely-managed tunnel — what is actually installed

**This is the one in use.** Created in the Cloudflare dashboard (Networks →
Tunnels), which issues a connector token. Ingress lives in the dashboard, *not*
in a local `config.yml` — the `config.yml` in the next section applies only to
the locally-managed alternative, and is kept for reference.

Installed on this machine, 2026-08-24:

```bash
cloudflared.exe service install <TOKEN>
```

Requires an elevated shell. The installer stores the token in
`C:\ProgramData\cloudflared\token` and registers a Windows service:

| | |
|---|---|
| service | `cloudflared` |
| startup | `Auto` — survives a reboot |
| command | `cloudflared.exe tunnel run --token-file C:\ProgramData\cloudflared\token` |
| account | *(the Cloudflare account the tunnel was created under — see the dashboard)* |
| verified | four QUIC endpoints to the edge = connector registered |

The token is **not** on the service command line, so it does not show up in a
process listing. It is readable from `C:\ProgramData\cloudflared\token` by
anyone who can read that directory.

> **A connector token is a credential.** Anyone holding it can run a connector
> for this tunnel. If it has ever been pasted somewhere it should not have been
> — a chat window, a screenshot, a ticket — rotate it in the dashboard and
> re-run `service install` with the new one.

### Routing it (dashboard, not a file)

Tunnel → **Public Hostname** → Add:

| field | value |
|---|---|
| Subdomain | e.g. `analytics` |
| Domain | a zone on this Cloudflare account |
| Path | *(blank)* |
| Type | `HTTP` |
| URL | `127.0.0.1:8787` |

`HTTP` and `127.0.0.1`, not HTTPS and not the LAN address: TLS is terminated at
the Cloudflare edge and the last hop is loopback on this machine, which is the
whole point of the arrangement.

**This step needs a domain on the Cloudflare account.** Without a zone there is
no public hostname to route to, and the tunnel — while connected — is reachable
by nothing.

Under *Additional application settings → Connection*, leave the defaults; the
one worth setting is a connect timeout below the Vercel proxy's own 5 s, so the
proxy is what gives up first and answers `disabled` cleanly rather than
interpreting an edge 502.

### Service management

```bash
sc.exe query cloudflared          # status
sc.exe stop cloudflared           # rollback level 3
sc.exe start cloudflared
cloudflared.exe service uninstall # remove entirely (elevated)
```

### The reboot gap

The tunnel is `Auto`-start. **The Python service is not.** After a reboot the
tunnel comes up and finds nothing on 8787, the edge returns 502, and the proxy
answers `disabled` — the site is fine, but the engine is silently off.

Start it with the stored key:

```bash
CLASH_API_KEY=$(cat ~/.royal-analytics/api.key) \
CLASH_ALLOWED_ORIGIN=https://royal-duels.vercel.app \
python server/app.py
```

The key lives in `C:\Users\<you>\.royal-analytics\api.key`, outside the
repository, and must match the `CLASH_API_KEY` set in Vercel. If persistence
matters, register `app.py` as a scheduled task at logon; that is not done.

---

## Named tunnel — the locally-managed alternative

Kept for reference. Use this only if you would rather hold ingress in a file
than in the dashboard; do **not** mix it with the token-based install above.


### One-time setup

```bash
cloudflared tunnel login                 # opens a browser; pick the zone
cloudflared tunnel create royal-analytics
cloudflared tunnel route dns royal-analytics analytics.<your-domain>
```

`login` writes `~/.cloudflared/cert.pem`. `create` writes
`~/.cloudflared/<TUNNEL-UUID>.json`, which is the tunnel's **credential**.

> **Neither file may ever be committed.** They are outside the repo by default;
> keep them there. `.gitignore` does not protect you from a copy pasted into
> the project directory.

### `~/.cloudflared/config.yml`

```yaml
tunnel: royal-analytics
credentials-file: C:\Users\<you>\.cloudflared\<TUNNEL-UUID>.json

# Sensible for a single origin on a home connection.
originRequest:
  connectTimeout: 10s
  # Longer than the proxy's own 5 s upstream timeout, so the Vercel function is
  # what gives up first and answers `disabled` cleanly, rather than the edge
  # returning a 502 HTML page the proxy then has to interpret.
  tlsTimeout: 10s
  noHappyEyeballs: false
  keepAliveConnections: 4
  keepAliveTimeout: 90s

ingress:
  - hostname: analytics.<your-domain>
    service: http://127.0.0.1:8787
  # Everything else is refused at the edge rather than reaching Python.
  - service: http_status:404
```

### Run it

```bash
cloudflared tunnel run royal-analytics
```

As a Windows service, so it survives a reboot:

```bash
cloudflared service install
```

Restart behaviour: `cloudflared` reconnects on its own when the network drops,
and re-registers four edge connections. If Python is down but the tunnel is up,
the edge answers **502 with an HTML body** — which is why the proxy checks
`response.ok` before it tries to parse anything.

### DNS

`cloudflared tunnel route dns` creates a proxied `CNAME` to
`<TUNNEL-UUID>.cfargotunnel.com`. It must stay **proxied** (orange cloud): grey
would publish the origin. No port forwarding, no firewall rule, no public IP.

### Hardening worth adding once it is named

The key is the control that matters, but the edge can refuse traffic earlier:

- a **WAF rule** allowing only `analytics.<domain>` requests that carry
  `X-Analytics-Key`, or restricted to Vercel's egress ranges;
- **Cloudflare Access** with a service token, so an unauthenticated request is
  rejected at the edge and never reaches the machine at all.

Neither is required for correctness; both reduce what the home connection has
to absorb.

---

## Vercel configuration

Project → Settings → Environment Variables. **Server-only**, and never named
`VITE_*` — Vite inlines any `VITE_` variable into the client bundle at build
time, so the naming convention is the boundary.

| Variable | Value | Notes |
|---|---|---|
| `ANALYTICS_ORIGIN` | `https://analytics.<your-domain>` | origin only, no path |
| `CLASH_API_KEY` | the same secret `server/app.py` runs with | 32+ random bytes |
| `OIE_ALLOWLIST` | one username, e.g. `royal20` | empty means nobody |
| `OIE_RATE_LIMIT` | optional, default `30` | per account per minute |

Generate the key with `python -c "import secrets;print(secrets.token_urlsafe(32))"`.
It goes in Vercel and in the shell that starts `app.py`; nowhere else, and never
into the repository.

Start the service with the matching key:

```bash
CLASH_API_KEY=<secret> CLASH_ALLOWED_ORIGIN=https://royal-duels.vercel.app python server/app.py
```

`CLASH_OIE` stays `off` globally. The allowlist is the rollout control.

---

## Measured latency

Real tunnel, 30 samples each, warmed:

| | p50 | p95 | p99 | min |
|---|---:|---:|---:|---:|
| opponent-read, direct `127.0.0.1` | 45.8 ms | 51.2 ms | 51.3 ms | 27.6 ms |
| opponent-read, through the tunnel | 143.6 ms | 1118.8 ms | 1169.7 ms | 127.9 ms |
| transport alone (401 path, direct) | 15.0 ms | 16.4 ms | 20.2 ms | 1.6 ms |
| transport alone (401 path, tunnel) | 133.7 ms | 1084.3 ms | 1241.4 ms | 83.5 ms |

**The Cloudflare round trip is ~119 ms at the median and the engine is the
smaller half of the total.** The p95 near 1.1 s is transport variance on a home
connection, not the engine — the direct p95 is 51 ms and never moves. The
client's 6 s timeout has room, but the Vercel hop is still unmeasured.

Two measurement traps, both hit here:

- **`/status` is not a transport probe.** It calls `os.path.getsize` on the
  spinning H: volume, so it measures the disk (p50 166 ms locally) rather than
  the network. Use the 401 path, which short-circuits before any disk access.
- **Do not compare any of this with `/coach/predict`** (29–57 s). That is the
  Coach's own database read on a spinning volume and has nothing to do with the
  engine or the tunnel.

---

## Rate limiting, and one thing the tunnel breaks

Demonstrated, not assumed: 60 requests direct from localhost, then 70 through
the tunnel, gave **120 × 404 then 10 × 429**.

Both sets landed in the **same bucket**, because `cloudflared` dials 127.0.0.1
and every remote caller therefore shares one peer address. The Python limiter is
a **service-wide backstop**, not a per-user control. Per-user limiting lives in
the Vercel proxy (30/minute per account).

`CLASH_TRUSTED_PROXY=1` would make the Python side read `X-Forwarded-For`
instead — do **not** set it unless the tunnel is configured to send a header
that cannot be spoofed by anyone else who reaches the port.

---

## Rollback

In order of increasing effort. None of it touches an ML artifact, and none
requires a deployment.

1. **Turn it off for everyone** — set `OIE_ALLOWLIST` to empty in Vercel and
   redeploy (or use the dashboard's redeploy). Every account then gets
   `{enabled: false, read: null}` and the panel renders nothing. *Seconds.*
2. **Cut the upstream** — clear `ANALYTICS_ORIGIN`. The proxy answers `disabled`
   without making a request. Same effect, one variable.
3. **Stop the tunnel** — `cloudflared service stop`, or kill the process. The
   proxy sees a failure and answers `disabled`. The site is unaffected.
4. **Stop the analytics service** — the edge returns 502, the proxy answers
   `disabled`.
5. **Remove the Vercel variables** entirely, and `cloudflared tunnel delete
   royal-analytics` plus the DNS record.
6. **Revert the code** — `git revert 42844ef` removes the proxy route and puts
   the client back on the Python path. `git revert f79f8a1` would remove the
   Python authentication too; there is no reason to.

At every level Recent still renders. The opponent read has always been a
separate request that cannot block it, which is the property that makes all of
the above safe.

**`CLASH_OIE` stays `off` throughout.** It is not the rollout control and
turning it on is not part of any step here.

---

## Handover — what needs your credentials

1. `cloudflared tunnel login` — Cloudflare account, choose the zone.
2. `cloudflared tunnel create royal-analytics` + `route dns`.
3. Write `config.yml` from the template above; run the tunnel.
4. Set the four Vercel variables.
5. Deploy `revamp` as a **preview** (`vercel link`, then `vercel` — or push the
   branch, which Vercel builds as a preview automatically).
6. Confirm `/api/analytics/opponent-read/<tag>` resolves `[tag]` on the real
   platform. **This is the one thing the local tests cannot establish**, because
   the dynamic-segment binding is the platform's behaviour, not this code's.

Then the one-account rollout is `OIE_ALLOWLIST=royal20`, sign in as royal20,
open the Coach, and watch.
