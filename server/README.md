# Analytics API (offline)

Serves the website's analytics screens from the Clash_Bot SQLite databases,
read-only. Standard library only — nothing to `pip install`.

```bash
python server/app.py      # http://127.0.0.1:8787
npm run dev               # Vite proxies /api/analytics/* to it
```

Both need to be running. Vite alone will show "Analytics service is not
running" on the analysis screen, which is the intended message rather than a
crash.

## Where this runs now

**Production is a Contabo VPS, not a laptop.** `app.py` runs there as the
`royalweb` systemd unit, bound to `127.0.0.1:8787`, behind Caddy at
`api.deckkies.com`, reading `/var/clashbot/battles.db` with the bot writing to
it on the same box. `docs/analytics-tunnel-runbook.md` is the configuration and
the rollback.

Two things differ from a local run and both are load-bearing:

- **`CLASH_TRUSTED_PROXY=1` is required behind Caddy.** The rate limiter keys on
  the client address, and behind any reverse proxy every request arrives from
  loopback — one shared bucket for the whole internet. With the flag set,
  `app.py` reads the first `X-Forwarded-For` entry. Spoofing it means reaching
  8787 directly, which the loopback bind and `ufw` prevent.
- **There is no archive tier.** `CLASH_ARCHIVE_DB_PATH` is set explicitly empty.
  The default is a Windows path that cannot exist on Linux, and the startup
  banner would print it.

**DEPLOYING `server/` ALONE IS NOT DEPLOYING THE SERVICE.** `duel_combos.py`
reads `../src/data/cards.json` and `../src/data/cardMeta.json` — the website's
own card files — so the directory layout matters: `server/` must sit beside a
`src/data/`. The first VPS deploy copied `server/` on its own, and the loader
swallowed the resulting `FileNotFoundError`, which silently emptied Duel
Analysis's Win Conditions and Spells tabs, blanked the Cards board and made
every Deck Counter row look generic, with no error anywhere. It now warns on
stderr and reports `cardData` in `/api/analytics/status`. Check that field after
any deploy.

### Pushing a change to the VPS

The frontend deploys itself — Vercel builds from `main` in a minute or two.
**This directory does not.** It is copied by hand, so a change here is not live
until you do this, and in the gap between the two the two halves disagree.

```bash
# 1. Has the VPS copy drifted? Compare it to the commit it should already be at.
ssh -i ~/.ssh/clashbot root@<host> 'md5sum /opt/royalweb/server/<file>.py'
git show HEAD:server/<file>.py | md5sum          # must match before you overwrite

# 2. Back up what you are about to replace, named for what it was.
ssh -i ~/.ssh/clashbot root@<host>   'cp -p /opt/royalweb/server/<file>.py /opt/royalweb/server/<file>.py.bak-$(date +%Y%m%d)-<what>'

# 3. Copy, clear the bytecode, restart.
scp -i ~/.ssh/clashbot server/<file>.py root@<host>:/opt/royalweb/server/
ssh -i ~/.ssh/clashbot root@<host>   'rm -rf /opt/royalweb/server/__pycache__ && systemctl restart royalweb'

# 4. Prove it came back, and that it can still read the card files.
curl -s https://api.deckkies.com/api/analytics/status | grep cardData
```

**Step 1 is the one people skip.** The VPS copy can be ahead of `HEAD` — a
hotfix applied there and never committed — and overwriting it silently reverts
that fix. An md5 that matches `HEAD` is the evidence that nothing is being lost;
one that does not is a conversation, not a `scp`.

**Step 4 is not optional either**, for the reason in the paragraph above it: a
service that starts fine and cannot see `../src/data/` answers every request
with plausible, empty data.

The rest of this file describes the model, which did not change with the move.

## Storage tiers

Mirrors the bot's own model (`Clash_Bot/clashdb.py`, `Clash_Bot/archive.py`):

| Tier | Path | Role |
|------|------|------|
| Hot (production) | `/var/clashbot/battles.db` | what the VPS reads. ~18 GB, **304-day (10-month) window** set 2026-08-26 |
| Hot (local default) | `H:\ClashBot\data\battles.db` | rolling window (150 days), ~11.5 GB |
| Archive (local only) | `H:\ClashArchive\archive.db` | every battle ever, ~46 GB |

**The H: copies are the rollback. The drive was unplugged on 2026-08-26 with its
contents intact** — local collection stopped, both Windows scheduled tasks
disabled — and it must not be wiped or reused. It is the only way back if the
migrated copy turns out wrong, and `archive.db` holds 1 May – 1 Jun, a month
that exists in no other copy. The archive was deliberately never migrated (it
grows 480 GB/year at 10,000 players); that is a reason it stays on the drive,
not a reason the drive is disposable.

**Both tiers moved to H: on 2026-08-17**, along with the bot's `RETENTION_DAYS`
going 60 → 150: a five-month window is ~28.5M battles and does not fit on the
internal SSD. Tier 1 was `C:\ClashBot\data\battles.db` before that date.

The archive is still only *opened* when the requested window reaches further
back than the hot tier holds, so normally the 46 GB file is not touched.

The three paragraphs that follow are about the **local** setup, which is now a
development and rollback environment rather than what production reads. They are
kept because that is still where the data is when there is no VPS in the loop.

**What the 2026-08-17 move changed is the failure story.** An unplugged H: used
to cost only the archive, because the hot tier was on C:. Both tiers are one failure
domain now, and the migration deleted the old C: database and the desktop
`battles-pre-retention.db` with it — so a detached drive leaves no database at
all. `resolve_db_path()` returns `None` and the screens show the explicit
"no database" state rather than 500-ing, but nothing answers from an older
local copy any more, because there is no older local copy. Check
`GET /api/analytics/status` for which paths actually resolved.

A candidate database must also *carry the schema*, not merely exist — the
desktop copy still ships a 4 KB `battles.db` stub with no tables in it, and
picking a file by existence alone selects that stub and then fails on every
query. That stub is now the only `.db` left on the internal disk, which is
exactly why `_has_schema()` is not optional.

**Cold reads are much slower on the spinning volume**, and the bot measured it:
SQLite page reads run ~2.4 MB/s at 430–620 IOPS against 104.5 MB/s sequential,
because each 4 KB page costs a seek. The bot repaged its database to 32 KB
pages to close most of the gap. Warm queries match or beat the old SSD; cold
ones do not, so the two background snapshots (meta, counter) matter more than
they used to — they are what keeps a request off the disk.

## Configuration

Every path is an environment variable with a local default. This is the
migration seam — moving to a VPS means setting these, not editing code, and
that turned out to be true when it actually happened: the move set
`CLASH_DB_PATH`, `CLASH_ARCHIVE_DB_PATH` (empty), `CLASH_API_KEY`,
`CLASH_ALLOWED_ORIGIN` and `CLASH_TRUSTED_PROXY` in `/etc/royalweb.env` and
changed no Python at all.

**A `.env` written `KEY = value` works for python-dotenv and silently fails for
systemd** — systemd takes the name as `KEY ` with the trailing space and passes
nothing, no error and no warning. That is why the bot's unit on the VPS must not
use `EnvironmentFile`; `WorkingDirectory` is what lets `load_dotenv()` find and
parse the file the way it was written.

**Do not start a unit in a way that dumps its environment.** `--environ` put
`CLASH_API_KEY` into the journal in plain text on the VPS. The key was
**rotated**, not merely hidden — a leaked secret that is still valid is not a
fixed secret.

| Variable | Default |
|----------|---------|
| `CLASH_DB_PATH` | `H:\ClashBot\data\battles.db` |
| `CLASH_DB_FALLBACK` | Desktop `Clash_Bot/battles-pre-retention.db` |
| `CLASH_ARCHIVE_DB_PATH` | `H:\ClashArchive\archive.db` |
| `CLASH_API_HOST` / `CLASH_API_PORT` | `127.0.0.1` / `8787` |
| `CLASH_OIE` | `off` — also `shadow` / `on` |
| `CLASH_OIE_LOG` | `ml/results/shadow-log.jsonl` |
| `CLASH_OIE_SALT` | `oie-shadow-v1` (tag hashing) |
| `CLASH_OIE_HISTORY_DAYS` | `60` |
| `CLASH_OIE_CACHE_TTL` | `120` seconds |
| `CLASH_DB_MAINTENANCE_FLAG` | `<db dir>/.maintenance` |
| `CLASH_API_KEY` | *(unset — see below)* |
| `CLASH_API_ALLOW_ANONYMOUS` | unset; `1` disables auth for local dev |
| `CLASH_ALLOWED_ORIGIN` | *(unset — no CORS headers sent)* |
| `CLASH_RATE_LIMIT` / `CLASH_RATE_WINDOW` | `120` requests / `60` s per client |
| `CLASH_TRUSTED_PROXY` | unset; `1` believes `X-Forwarded-For` |
| `CLASH_RECRUIT` | **`on` in production since 2026-08-29.** Starts the background recruiter |
| `CLASH_RECRUIT_OPPONENTS` | `off`. The opponent half, separately — it is the unbounded source |
| `CLASH_RECRUIT_TOP` | `2000` ranked players per run |
| `CLASH_RECRUIT_REFRESH` | `7200` seconds, matching the bot's poll |
| `CLASH_RECRUIT_OPP_DAYS` / `_OPP_MIN` / `_OPP_MAX` | `2` days / `2` sightings / `500` per run |
| `CLASH_RECRUIT_CEILING` | `12000` tracked + queued, refused past it |

Client side: `CLASH_API_URL` retargets the Vite proxy, and
`VITE_ANALYTICS_BASE` points a built bundle straight at a remote host. The
browser only ever calls `/api/analytics/*`, so neither the components nor the
client module change when the service moves.

### The security boundary

Phase 24C step 2. The process still binds loopback and is still not exposed
directly — this is the layer underneath whatever proxy eventually sits in
front, not a replacement for it.

**Authentication.** Every route except `/api/analytics/status` needs
`CLASH_API_KEY`, sent as `X-Analytics-Key:` or `Authorization: Bearer`. The
comparison is `hmac.compare_digest` on bytes — bytes because `compare_digest`
refuses a non-ASCII `str`, so a key with an accent in it would raise rather
than simply fail.

A missing key **fails closed**: authenticated routes answer `503
auth_not_configured` and the startup banner says so in six lines. No key is
ever generated; a generated key is one nobody knows they depend on. For local
development set `CLASH_API_ALLOW_ANONYMOUS=1`, which has to be typed — a
developer who is merely inconvenienced invents a placeholder key instead, and a
placeholder key looks like security from the outside while being none.

**Loopback is not trusted, and this is the whole point.** The reverse proxy in
front — Caddy on the VPS today, `cloudflared` before it — runs on the same
machine and dials `127.0.0.1`, so every proxied request arrives with a loopback
peer address. An exemption for local clients would wave through
precisely the traffic the key exists to authenticate. The process does refuse
to *start* unauthenticated on a non-loopback `CLASH_API_HOST`, because that
combination cannot be a deliberate local-dev choice.

**CORS.** `_send` used to emit `Access-Control-Allow-Origin: *` on every
response and `Allow-Headers: *` on every preflight. Now one exact origin from
`CLASH_ALLOWED_ORIGIN` is echoed, with `Vary: Origin` so a shared cache cannot
hand one origin's response to another, and the header allowlist is fixed. A
preflight from an unknown origin is `403` with no CORS headers — there is
nothing to reflect. Preflights themselves are unauthenticated on purpose: a
browser never attaches credentials to one and it carries no data. The `GET`
after it is authenticated normally. None of this affects `npm run dev`, where
Vite proxies server-side and the browser never leaves its own origin.

**In production that value is `https://deckkies.com`, and only that** — which
is worth stating plainly because of how the failure looks from a browser. Any
other host gets no `Access-Control-Allow-Origin` back, the browser drops the
response before the page sees it, and every analytics board renders
**"Analytics service is not running"** while this service is perfectly healthy
and answering. Measured 2026-08-29: `deckkies.com` gets the header,
`www.deckkies.com` and `royal-duels.vercel.app` do not.

So a browser audit of the analytics screens has to run against `deckkies.com`.
Diagnosing from the message alone will send you to `systemctl status royalweb`,
which will be green. `/api/analytics/status` answers any origin — it is a plain
`GET` with no CORS involved from `curl` — so it is the quick way to tell the two
apart: if `/status` returns JSON and the site says the service is down, it is
CORS, not the service. Add a host here only by setting
`CLASH_ALLOWED_ORIGIN`; the code deliberately supports one origin, not a list.

**Rate limiting.** Fixed window per client, `120 / 60 s`, `429` with
`Retry-After` past it. Fixed windows rather than a sliding log because the
state per client is one integer and the verdict for a given (client, clock) is
deterministic, which is what makes it testable without sleeping. The table is
capped at 4,096 clients and evicts finished windows first: a spray of one
request each from many addresses is the normal shape of abuse here, and it is
exactly the shape that grows an uncapped table until the process dies. `/status`
is exempt so the health check answers while the service sheds load, and
authentication runs *before* the limiter so a stranger cannot lock out the real
caller by flooding the port with bad keys.

`X-Forwarded-For` is ignored unless `CLASH_TRUSTED_PROXY=1`. Anyone who can
reach the port can set that header, and honouring it by default hands the
limiter's key to the caller it is meant to limit. Note that behind a tunnel
every request shares one peer address, so per-user limiting belongs at the
proxy; this limit is a backstop.

**Errors say nothing.** The generic handler used to return
`{"error": "server_error", "detail": str(exc)}`. For a database failure that
detail is an absolute path to the `H:` volume; for a decode failure it is a
slice of whatever was being parsed. The body is now the reason code alone and
the traceback goes to stderr, where the operator is.

Two related leaks were closed at the same time. `/api/analytics/status` — the
one unauthenticated route — published the absolute path and exact byte size of
both SQLite volumes, a free inventory of the host's drives to anyone who could
reach the port; `_sources()` strips the paths, and since the UI only ever reads
`available`, nothing downstream noticed. And `deck_counter` and `meta` both
stored `str(exc)` in a `_state["error"]` that is served in a response body;
they now store the exception *type*.

**Metrics** are counted (`total`, `ok`, `auth_failed`, `rate_limited`,
`client_error`, `server_error`, plus a bounded 512-sample latency percentile)
and deliberately carry nothing per-player: a counter keyed by route would carry
the tag in the path, and a tally of who was looked up is not a metric, it is a
log of people. `metrics_snapshot()` exists; nothing surfaces it yet.

`server/test_api_security.py` (73 checks) drives all of this over real HTTP
against a server on an ephemeral port, because these controls are header- and
status-level and a unit test calling `check_auth` directly would pass just as
happily against a server that never called it.


## Endpoints

| Route | Returns |
|-------|---------|
| `GET /api/analytics/status` | which tiers are readable and their sizes, plus `cardData {loaded, count, error}` — **the only unauthenticated route, and the one place that says whether the service can actually answer.** Check it after every deploy |
| `GET /api/analytics/suggest` | a few real tags with the most stored battles |
| `GET /api/analytics/coverage?tag=` | earliest/latest stored day, globally and per player |
| `GET /api/analytics/player/<tag>` | summary, top decks, per-day trends |
| `GET /api/analytics/duels/<tag>` | card combinations in duel play, three tabs |
| `GET /api/analytics/duelzone/<tag>` | duel series log (Bo3/Bo5) + deck sequence |
| `GET /api/analytics/cards/<tag>` | per-card use/win rate + movement (`?mode=`) |
| `GET /api/analytics/counter/<tag>` | which archetypes beat this player |
| `GET /api/analytics/deck?cards=&wild=` | how one pasted deck draws — slots + art (`wild=evolution` or `wild=hero` picks slot 3) |
| `GET /api/analytics/matchup?a=&b=` | head-to-head for two decks (comma-separated keys) |
| `GET /api/analytics/counters?deck=` | what beats a deck |
| `GET /api/analytics/teams?blue=&red=` | **squad vs squad, or one roster scouted** — one folder per opponent: their decks, their archetype spread, **the projected threat space (`threats`), and 5–7 decks that answer it**. With `blue` those come from the squad's own lists; **omit `blue` entirely** and they come from the snapshot's seed pool (~200 real decks), plus an `overall` block ranking the same pool against the whole roster's pooled projection. `mode` says which, and `brain` says which reasoning produced it (`team-scout-2.0`). See `DECKKIES_TEAM_SCOUT.md`. The most expensive route on the service: up to twenty player resolutions, enrolment for the untracked ones, and a profile of every candidate deck. `days` as everywhere else |
| `GET /api/analytics/coach/predict/<tag>` | which decks they open with, or what is left after `r1`/`r2`. Takes `?days=` (15/30/45/60, default 30) like every player screen |
| `GET /api/analytics/coach/field/<tag>` | **what to play with NO OPPONENT** (`coach_daily.py`) — the meta board becomes a threat projection, that projection is reweighted by where this player measurably loses, and `team_scout.score()` ranks ~204 real decks against it. Works because `score()` takes the threat space as an INJECTED parameter and does not know where it came from, so there is no second scorer and no model. `basis` is `weighted` / `unweighted` / `no_history` / `none` and a client must say which. `tailoredPicks` reports how many picks the weighting actually put there, measured by ranking the unweighted projection too — live it is 0-1 of 7, and that is the correct answer rather than a weak one. Costs no database read per candidate; 1.4 s warm. `days` as everywhere else. Returns `families` / `closest` / `learn` / `repertoire` on the full read (not `brief`). **`compare=1`** adds `progress` — this window against the one of the same length before it, recomputed from the rows rather than read from a snapshot table (+~60 ms) |
| `GET /api/analytics/coach/suggest?me=&opp=` | what to play next, given `m1`/`m2` and `o1`/`o2`. One `?days=` resolves to TWO windows, one per tag, each counted from that player's own last battle |
| `GET /api/analytics/meta` | the global meta leaderboard (snapshot) |
| `GET /api/analytics/meta?movement=<days>` | **how that board has MOVED** (`meta_history.py`) — rank and use-rate deltas between the newest stored day and the newest one at or before `days` back. Rides on the `/meta` path deliberately, so the **route count stays 23**. Answers `basis: "none"` with NO rows when there is nothing to compare against, never a list of zeros; a deck absent from the older day carries `entered: true` with a NULL delta rather than a climb from beyond the board's edge, and one that dropped off carries `left: true`. `comparedWith` / `daysApart` describe the snapshots ACTUALLY used, so a missed timer widens the span visibly instead of silently. Reads its own ~18k-row file, not the bot's database |
| `GET /api/analytics/duo-pairs?page=&per=&sort=&cards=` | **the unique DECK PAIRS played in 2v2** (`duo_pairs.py`), 1,483,672 of them. One record per combination of two teammate decks, with an occurrence count, distinct participants, and first/last seen. Reads a LOCAL collection, not `battle_raw` — the migration is a full scan of a 44.7 GB table and is a job. `sort` is a KEY into a closed vocabulary (`played` / `recent` / `first`), never a column, and all three are index reads at 9-15 ms. `cards` is comma-separated card keys, checked against the catalog, ANDed within ONE deck and matched WHOLE — the column is a JSON array so `%"giant"%` has boundaries a bare `%giant%` does not (605,447 pairs against the real Giant's 45,360). An unknown key is dropped rather than refused and the accepted list is echoed back. `q` is the older free-text search over the same columns plus the fingerprints; `cards` wins when both are given |
| `GET /api/analytics/admin/coach/intel/<tag>?days=` | **Coach Roster's player intelligence, ADMIN ONLY** (`coach_intel.py`). One pass over the Recent Battles reader (`recent_battles._read_rows`), so only OWN-DECK 1v1 is counted and 2v2/drafts/events are reported as `hidden` / `hiddenByMode` exactly as the battle log reports them: a zero-filled daily timeline, the last ten results, modes, the player's archetypes and the ones they face, their decks (8 distinct cards, sorted-key identity, top 25 of `decksTotal`) and their opponents (top 50 by meetings of `opponentsTotal`, `opponentsRepeat` met twice or more). **This is the one route with a SECOND gate**: Caddy injects `X-Analytics-Key` on every path, so the key makes every route public; `admin_auth.verify` takes the caller's Supabase access token from `X-Coach-Token` and asks Supabase's own `coach_is_admin()` (migration 004) whether it belongs to an admin — 401 unauthorized, 403 forbidden, 503 not_configured / unavailable, and every failure closes. Verdicts are cached 60 s by token hash, 256 entries. Needs `SUPABASE_URL` + `SUPABASE_ANON_KEY` in the service's environment |

Both `player` and `duels` take the same window: `?days=N`, or `?from=&to=` as
`YYYY-MM-DD`. `days` counts back from the **last battle stored for that player**
rather than from today, so someone who stopped playing a month ago still gets a
populated screen.

Tags are validated against Supercell's 14-symbol alphabet before they reach a
query (same rule as `clashdb.normalize_tag`), so junk never hits the database.

## Battle modes, and the 2v2 pairs (`battle_modes.py`, `duo_pairs.py`)

**MODE DETECTION RUNS BEFORE THE DECK PIPELINE, NOT INSIDE IT.** A `TeamVsTeam`
row stores exactly eight `player_card_keys`, eight `opponent_card_keys` and one
`opponent_tag` — structurally identical to a ladder row across all 1,356,765 of
them — so nothing downstream of the read can tell them apart, and a 2v2 battle
drawn as a duel between two people looks entirely correct.

    raw battles row
      -> is_own_deck_1v1  -> Recent Battles, drawn as deck vs deck
      -> is_duo           -> duo_pairs, folded into unique deck PAIRS
      -> otherwise          counted, named, drawn nowhere

`battle_modes.py` has **no imports at all**, the rule `deck_harmony.py` and
`tiers.ts` follow. `test_battle_modes.py` pins every one of the 32 mode strings
the live database holds, with its row count, taken verbatim from
`SELECT game_mode, COUNT(*) FROM battles GROUP BY game_mode`.

**It is an allowlist on PATTERNS.** `Ranked1v1_NewArena` became
`Ranked1v1_NewArena2` and both are stored in quantity, so an exact-string list —
which is what `meta.META_MODES` is — would drop `Ranked1v1_NewArena3` out of
every player's log in silence on the day a season turned. The cost is paid for
by `summary.hiddenByMode`: the log prints what it refused and names each mode.

### The 2v2 pair collection

**THE UNIT IS A PARTNERSHIP, NOT A DECK.** A 2v2 battle is four players and four
decks, and what a 2v2 player chooses is which two decks go together.

    pair identity = canonical( canonical(deck A), canonical(deck B) )

Order-free at both levels: the eight card keys sort, and the two deck
fingerprints sort. `A + B` and `B + A` are one record.

**IT READS `battle_raw`, NOT `battles`, AND THAT IS WHY IT CAN EXIST AT ALL.** A
`battles` row holds one player deck, one opponent deck and one opponent tag —
**the teammate's deck is in no column of it**. The raw API payload carries
`team: [2 participants]` and `opponent: [2]`, each with eight cards and a tag,
so one battle yields TWO pair records.

**ONE BATTLE IS ONE OCCURRENCE.** 51,671 2v2 rows have a tracked opponent, so
the same battle is stored two or four times. `battle_identity` is built from the
battle's own timestamp and its four sorted tags, and `duo_stage`'s
`PRIMARY KEY (battle_id, side)` enforces the dedup rather than hoping.

### Running it

    python server/duo_pairs.py --coverage    # how much can be reconstructed
    python server/duo_pairs.py --migrate     # build the pair collection
    python server/duo_pairs.py --update      # only payloads stored since
    python server/duo_pairs.py --show 20     # print the top 20 pairs
    python server/duo_pairs.py --cursor      # the mark the bot's raw cap reads

`--update --reconcile` is what `royalweb-duo.timer` runs hourly. A climbing
`--cursor` backlog means the fold has stalled and the raw cap is being held off,
which grows the database — check the timer before anything else.

**PHASES 1 AND 2 ARE LIVE; PHASE 3 IS STILL BLOCKED, AND IT DELETES NOTHING
YET.**

Phase 2 was a change to the BOT (`/opt/clashbot/clashdb.py`, a different
codebase on the same box) and shipped 2026-09-10: over a full 4,910-player
startup sync afterwards, **3,633 new battles and 0 of them 2v2**, with 1,164
fresh 2v2 payloads still reaching `battle_raw` for the fold to read. The hourly
`royalweb-duo.timer` is what consumes them.

**PHASE 2 CREATED A NEW HAZARD AND IT NEEDED ITS OWN FIX.** Once 2v2 stopped
entering `battles`, the `battle_raw` payload became the ONLY copy of a 2v2
battle between arrival and the next hourly fold — and the bot's raw-cap valve
deleted 1,136,571 of them on the restart that deployed the guard. `enforce_raw_cap`
now reads `duo_meta.watermark` and passes it as `stored_through`, so it can only
purge payloads the fold has already consumed. **It caught a real race on its
first run**: 20,116 unprocessed 2v2 payloads sat above the cursor and were
spared while 498,333 at or below it were purged. It fails CLOSED — any error
returns an empty cursor, which means protect everything, so a stalled fold grows
the database instead of losing battles.

The bot reads `duo_meta` out of the SQLite file directly rather than importing
`duo_pairs.py`, which is what makes deploying this module safe.

Phase 3, the historical cleanup, must not be attempted until the aggregates have
been rebuilt — `player_stats_agg` demonstrably counts 2v2 today and
`rebuild_aggregates` has no live caller, so deleting rows now would leave figures
nothing could recompute. 301,488 rows also lost their raw payload before any of
this and can never become pairs; they are reported as `unreconstructable` and no
pair is invented for them.

**COVERAGE IS 78.2%.** Of 1,381,535 2v2 rows, 1,080,047 have a surviving raw
payload and **301,488 do not** — the raw-cap valve purged 1,881,526
`battle_raw` rows on 2026-09-01 and June predates raw collection. Those are
reported as `unreconstructable` and no pair is invented for them.

**IT IS SLOW BECAUSE `battle_raw` IS 44.7 GB AND `game_mode` HAS NO INDEX.** A
single `SELECT DISTINCT game_mode` over it measures **4m05s**, which is why the
mode list is memoised for the life of the process — un-memoised it ran four
times in one migration. Budget tens of minutes for a full run, and never put any
of this on a request.

**THE WATERMARK IS `stored_at`, the arrival time, not `battleTime`.** A battle
that arrives late carrying an old timestamp still has a current `stored_at`;
watermarking on battle time is the fault that left `player_stats_agg` 48% short.

**IF IT REPORTS ZERO PAIRS AND EVERYTHING UNREADABLE, THE CARD DATA IS STALE.**
`duo_pairs` maps the payload's Supercell card ids through
`duel_combos.card_info`, which gained its `id` field in the same change. Against
a host that has not been redeployed every deck resolves to nothing. It raises
`CardDataUnavailable` before the scan starts rather than producing a true
sentence about a completely broken run.

The collection is `server/.duo_pairs.db`, gitignored, and this module is the
only thing that writes to it. The bot's databases stay `mode=ro`.

## Recruiting tags (`recruit.py`)## Recruiting tags (`recruit.py`)

Two ways a player gets collected without anyone searching for them: the top of
the ranked ladder, and the opponents our tracked players are actually meeting.

```bash
python server/recruit.py --dry-run          # reads everything, queues nothing
python server/recruit.py --top 2000         # both sources, for real
python server/recruit.py --no-opponents     # the leaderboard only
python server/test_recruit.py               # 35 checks, no DB and no network
```

**It adds no route and no write.** Both recruiters end at
`tracking.bulk_request()`, which writes `server/.tracking.db` — our file, the
one this service already owned. The bot's `drain_tag_requests()` picks the tags
up at the top of its next two-hourly poll and enrols each through
`clashdb.add_tracked_player`. So `mode=ro` on the bot's databases is untouched,
and **there is no bot edit**: the enrolment door and the skip both already
existed, and all this had to do was stop putting known tags in front of them.

### Ranked is Path of Legends, and the season must be discovered

    GET /locations/global/pathoflegend/<seasonId>/rankings/players?limit=&after=

Measured 2026-08-28, against the live API:

| | |
|---|---|
| `limit=2000` in one request | **200, 2000 items**, ranks 1–2000, elo 3685–2523 |
| paged `4 × 500` via `paging.cursors.after` | 2000 unique tags in 14.1 s |
| every tag through `normalize_tag` | **0 rejected** |
| `/locations/global/rankings/players` | 200 and **zero items** — the retired trophy ladder |
| season `2026-08` (the current month) | **404 `notFound`** |
| season `2026-07` (newest listed) | 200, full board |

That last pair is the trap and it is why `current_season()` asks
`/locations/global/seasons` instead of formatting the clock. A
`time.strftime("%Y-%m")` would 404 on every run, forever, and look exactly like
a leaderboard with nobody on it. The listed ids arrive duplicated, so they are
de-duped, and if the newest listed season 404s anyway it walks back through the
previous five rather than stranding.

It pages even though one request is enough. A server-side cap on `limit` is
precisely the kind of thing that changes without an announcement, and the
cursor path is already proven.

### Opponents come out of the database, not the API

`battles.opponent_tag` is stored on every row, so "who are our players facing"
is one indexed range scan over a two-day window — no CR API call, no rate-limit
budget, and the answer is about the population we actually track. Hot tier
only: a two-day window never reaches the archive, and the VPS has no archive.

### A carriage return in `CR_TOKEN` made the whole thing silent

Found on the first real run against the VPS, and worth writing down because the
failure mode is the one this module's own header warns about.

`/etc/royalweb.env` has **CRLF line endings**. systemd's `EnvironmentFile`
strips the trailing `
`, so the *service* has always been fine — which is why
`cr_profile()` answers correctly in production. But `. /etc/royalweb.env` in a
shell keeps it, and `http.client` refuses to write a header value containing a
carriage return:

    ValueError: Invalid header value b'Bearer eyJ0...
'

Every call raised, `current_season()` returned `None`, `leaderboard_tags()`
returned `[]`, and the run printed **`fetched 0`** with no reason anywhere —
a recruiter that found nobody and a recruiter that could not ask, indistinguishable,
exactly as predicted three paragraphs earlier in this file.

Two fixes, both kept:

* `clash_data._env()` **strips at the point of read**, so no consumer has to
  know. It is not specific to the recruiter — `cr_profile` and `cr_battlelog`
  read the same token.
* `recruit.last_error()` records *why* the last call failed, and both the run
  report and the dry run print it when nothing came back. A count of zero now
  always arrives with a reason attached.

`test_recruit.py` pins both, and pins the mechanism where it actually lives:
`urllib.request.Request()` accepts the bad header happily and `http.client`
rejects it at write time, which is why this surfaced as a network failure rather
than a bad argument.

### The skip, three times

1. against `tracked_players` — do not queue what is already collected
2. against `tag_requests` — do not requeue what is already waiting
3. in the bot's drain — because (1) is a snapshot and a tag can be enrolled
   between our read and its

Only (3) is load-bearing. (1) and (2) keep the queue the size of the work
outstanding: without them a two-hourly harvest rewrites the same two thousand
rows forever, and `PRUNE_ABOVE` is tuned for a queue of searches rather than of
a leaderboard. Verified end to end against the live API — first run `added:
2000`, second run `added: 0, skippedQueued: 2000`.

### What it costs, and why the loop ships off

Every tag enrolled here is a player polled every two hours forever, into a
database on a 304-day retention. The root README measures ~105 GB for 3,278
tracked players — about **32 MB per player per year of retention**. So:

* the top 2000 is a **known, bounded ~64 GB**;
* opponent harvesting is bounded by *nothing in its own definition*, because
  every player polled yields up to 25 more opponents every two hours.

And there is still **no backup of the VPS database**, which the root README
calls the largest single exposure on the project. Growing the unbacked thing is
not a decision this module makes quietly, so it is fenced four ways: a
`CEILING` on tracked + queued that refuses rather than trims, a minimum
sighting count before an opponent counts as anything, a per-run cap on new
opponents, and a background loop that **does nothing unless `CLASH_RECRUIT=on`**
— the same convention as `CLASH_OIE=off`. The CLI runs on demand either way.

`/api/analytics/status` grows a `recruit` block: enabled, last run, runs, last
added, queue depth, ceiling. **Counts only, never tags** — that route is the
unauthenticated one, and a list of who the service decided to start collecting
is a log of people, not a metric. It also does not create the queue file just
by being probed, which is why `queue_depth()` is the one reader here that skips
`_ensure()`.

## Duel combinations (`duel_combos.py`)

A port of the bot's Pair Board (`clashdb.get_card_pair_stats` +
`pdf_pages.pair_board_data`), including its evidence floors (8 decks, 2 shells),
its Wilson confidence tiers, and its card/deck budgets — without those a table
is one heavily-played deck sliced twenty-four ways, because a pair inherits the
record of whole decks.

Three things to know before changing it:

* **It answers from two populations, and says which.** Duels first, always. But
  a pair needs 8 games across 2 decks, so a player with two duels yields dozens
  of observed pairings and ZERO eligible ones — correct, and a useless page. On
  that failure `combo_report` re-asks over the player's non-duel battles
  (`non_duel_decks`) and stamps `basis: "all"`. **Never blended:** a widened
  answer is a different answer, not a better-powered version of the same one.
  Those decks carry `slot: -1`, so the G1/G2/G3 split disappears through the
  existing `0 <= slot < SLOTS` guards rather than being invented — writing `0`
  there would give every ladder match a loadout position, and it would look
  entirely normal. `duels` still reports the real duel count, because that is
  the reason the widening happened.
* **There is no synergy score, and its absence is a measured result.** The
  obvious observed-versus-expected lift was built and tested against a
  permutation null across 14 player shapes in the bot project and came out
  indistinguishable from chance. Don't reinstate one without a fresh, leak-free
  measurement.
* **A native duel is stored as one row carrying the whole loadout** — 16 or 24
  cards, i.e. two or three decks end to end. So the G1/G2/G3 split is read out
  of the data. Friendly practice has no such row, so those duels are rebuilt
  with the bot's `duel_split` rules (>30 min gap closes, card reuse closes, a
  2-0 arms exactly one dead rubber).

The one deliberate divergence: the PDF gives each pair exactly one category,
since it prints all four on one board. Here the same predicates are applied
independently per tab, because an "Evolutions" tab that hides a pairing when a
win condition outranked it is answering a different question from its label.

### `evoCoverage` and `span` exist to explain an empty Evolutions tab

The Evolutions predicate needs both cards to have been **observed** in an
evolution slot — never merely `can_evolve` — and `player_evo` is opportunistic:
it went from ~1% of all stored battles on 20 Jul 2026 to 99% on 5 Aug. A player
whose duels all predate that shows zero, correctly, while their recent ladder
history is full of evolutions.

That is two different emptinesses and `_evo_marks` keeps them apart on purpose
(it returns `None` for "we were never told", distinct from "they ran none"). So
the envelope carries both halves of the explanation:

* `duels.evoCoverage` — share of duel decks whose evolution slots were recorded.
  `0.0` means *not measured*, and the UI renders an em dash rather than a `0`.
* `duels.span` — `{from, to}` ISO days of the **first and last duel row read**,
  not of the player's battles generally. A player can be active today and have
  their last duel months back; when the tab is empty that gap is usually the
  whole story, so the tab quotes it.

`span` comes off `read_duel_rows`, which sorts by `battle_time` — so the ends of
the list *are* the span, with no second query.

```bash
python server/test_duel_combos.py    # 55 checks, no database needed
python server/test_meta.py           # 33 checks, no database needed
python server/test_card_art.py       # 110 checks, no database needed
python server/test_duel_zone.py      # 88 checks, no database needed
python server/test_player_cards.py   # 60 checks, no database needed
python server/test_deck_counter.py   # 58 checks, no database needed
python server/test_coach.py          # 69 checks, no database needed
```

## The Duel Zone (`duel_zone.py`)

Two windows over the same duels, both ported from the bot: the series log
behind `!duels`, and the `!duelspdf` "Deck Sequence Prediction" page.

`duel_combos.read_duel_rows` does the single database read both use, so the
series on screen and the sequence computed from them cannot describe different
duels. While wiring it, `_split_series` was corrected to track **both sides'**
card reuse the way `duel_split.split` does — the earlier copy watched only the
player's, because it had never read the opponent's deck.

**The one divergence from `duel_split`.** Its rule that any repeated card ends a
series cuts real practice data too often — measured, raising the threshold
instead takes series longer than three games from 1.1% to 25.3% while buying
only six points of coverage, i.e. it invents Bo5s. So the rule stays and
`_merge_unfinished` tidies up after it: an undecided tail is folded back into
the series it was cut from (same opponent, inside the gap, total <= 5 games) or
dropped. A duel does not end 1-1. `split_chunk` is the entry point both duel
screens use.

Things to keep, each of which the bot learned the hard way:

* **`bo5` needs a 4th game.** "Someone reached 3 wins" is not evidence — a Bo3
  decided 2-0 whose dead third game is played out reaches 3-0 in three games.
* **A native row has no per-game scoreline.** It stores the *duel's* result, so
  the response sends `playerWins: null` and an empty caption rather than a
  score that would be indistinguishable from a real one.
* **A predicted loadout must be card-disjoint** (`pick_duel_legal_sequence`).
  76% of the bot's rendered triples were impossible before this rule. Returning
  one companion instead of two is correct.
* **Companions rank by co-occurrence with the opener**, weighted `CO_WEIGHT`
  (3). Raw play count makes every row the player's two most-played decks.
* **Observed beats inferred** (`observed_duel_loadout`): ~85% of openers have a
  real 3-game series, and those are card-legal by construction.

**No display caps.** The bot's three (40 openers, 27 rows, four pages) are PDF
page geometry, and a scrolling panel has no pages: the date window decides how
much there is and `report()` returns all of it. `?limit=N` still trims the
series list for a caller that wants a preview. The bot's `count >= 2` filter on
openers is dropped too — the play count is printed beside each row.

**Every deck goes through `clash_data.arrange_deck`**, which owns the slot order
and the art together. Skipping it is what made the sequence board render the
same deck in a different order and with no evolution art beside its own row in
the series log.

**A deck with no record of its own goes through `deck_counter.seater()`** —
seeds, Team Analysis threats and fills, scouting rows, 2v2 pairs. A seed is its
hash split on commas, i.e. ALPHABETICAL, and those decks used to reach the
screen that way with `art: {}` (139 of 199 live decks broke the slot rule,
2026-09-21). `seater()` uses the meta board's observed marks when it holds the
exact list and `arrange_deck`'s capability reading otherwise, and reports which
as `artInferred`. It is a closure so a caller seating hundreds of decks reads
the board once. `duo_pairs` imports it on the read path only — the hourly fold
runs that module as a CLI.

**A pasted link's order is authoritative — pass `trust_order=True`.** A
copyDeck link writes the three special slots first, in slot order, so its first
three IDs already name the evolution, the hero and the wild. Rebuilding them
from capability put Goblins in the hero slot of a Goblin Barrel / Valkyrie /
Princess deck and rendered it as a different deck. It also outranks `marks`:
pooled marks are what everyone's copy of those eight cards was fielded as, and
they were reordering a Battle Ram / Wizard / Elite Barbarians link into Battle
Ram / Elite Barbarians / Wizard. `wild=` overrides slot 3, the only one a link
cannot settle — knight, valkyrie, musketeer and wizard have both forms — and it
is applied on every path, not only this one.

**Pass it the observed marks whenever you have them — they decide.** The second
argument is `{card: 'evolution' | 'hero'}` for what the deck was actually seen
fielding, and it is authoritative: a card nobody was seen bringing specially
renders plain however capable it is. Capability inference is the fallback for a
deck with no record, and callers flag that case with `artInferred`.

This mattered more than it sounds. The argument was accepted and never read, so
every deck was rendered at the maximum loadout its cards permitted — 43 of 50
meta decks drew two evolutions and a hero against 28 played that way, and 19 of
50 renderings contradicted the evidence. Barbarian Barrel can be a hero and is
in eight of the seventeen archetype decks, so it was promoted to the hero slot
in all eight, and every archetype row on the Deck Counter opened with the same
three frames. The game's cap (one mark per slot) still applies on top of
the marks, because a pooled cluster can report three evolutions that no single
player fields.

## The meta leaderboard (`meta.py`)

`/api/analytics/meta` answers in ~4 ms because it never queries live. It cannot:
a `GROUP BY player_deck_hash` over a date window was built and measured first,
and it is not viable at this data size.

| window | via `idx_battles_time` | full table scan |
|---|---|---|
| 7 days | 39.9 s | — |
| 10 days | 48.3 s (49.3 s warm) | 45.1 s |
| 30 days | 76.3 s | — |

The cost is I/O. The index yields rowids in time order and then ~1.4M rows have
to be fetched from a 12.9 GB table whose rows carry two JSON card-list columns.
Warm re-runs do not help, and forcing a sequential scan saves only ~8%.

The normal fix — a covering index on `(battle_time, player_deck_hash)` — **is
not available**, because this process opens the bot's databases `mode=ro`
precisely so it can never modify them. So the rollup runs on a background
thread every `CLASH_META_REFRESH` seconds (default 1800) and requests are served
from the finished snapshot, persisted to `server/.meta_snapshot.json` so a
restart serves the previous numbers immediately. Every response carries
`computedAt` / `ageSeconds`, and the UI prints how old the numbers are rather
than implying they are live.

Four rules decide what lands on the board, and three of them are corrections to
what the first version actually produced:

* **Only competitive 1v1 where the player chose the deck** — ladder, ranked
  1v1, clan-war 1v1, tournaments. 2v2 and the event modes that hand you a deck
  would measure Supercell's choices rather than the player base's.
* **A deck needs `CLASH_META_MIN_PLAYERS` (25) distinct players.** Without it
  the board ranked a deck 50th on 1,703 Ladder battles at an **8.5% win rate**
  — 144 wins from 1,703. The stored results are clean (only win/loss/draw), so
  those battles are real; they are just almost all one account grinding one deck
  badly. A use-rate ranking is exactly the shape a single heavy player can
  inject themselves into.

* **Variants merge at 6-of-8 shared cards** (`MERGE_MIN_OVERLAP`, the bot's own
  `COUNTER_MIN_OVERLAP`). Without merging the board printed "Mortar" twice,
  "Bridge Spam" twice and "Royal Giant" twice, and every use rate looked
  impossibly small because one archetype's play was split across dozens of
  one-card tech variants. Only the top `CLASH_META_CANDIDATES` decks are
  clustered — the comparison is quadratic and nothing below the head can reach
  the board anyway.
* **Deck names are qualified by a signature card.** Clustering cannot merge
  genuinely different decks that share a win condition, so "Hog" still appeared
  six times on a fifty-row board. `_deck_name` appends the priciest
  non-win-condition card ("Hog Musketeer", "Hog Earthquake") — which is how
  players name these decks anyway.

Use rate is a share of **every** competitive battle in the window, including
those on decks the floor rejects — it is a share of all play, not of the board.

### Evolution and hero art

Cards are drawn with their evolution or hero art where the deck is actually
fielded that way, and decks are rendered in **payload order**.

Both follow from one measured fact: a deck's first **three** positions are the
special slots (evolution / hero / champion). Of 795 decks whose payload carried
evolution marks, **all 795** had every mark inside slots 0-2 — slot 0 in 791,
slot 1 in 569, slot 2 in 775.

So:

* Art is only ever applied to slots 0-2, and a deck can wear at most two
  evolutions, two heroes and three marks in total — one per slot. That is the
  game's own rule, and it is what stopped a
  cluster's pooled marks drawing a deck with **five** evolved cards.

  **The cap is enforced on the evidence, not on the stored order.** Both art
  lookups used to drop any mark on a card outside the first three entries of
  `decks.cards`. That order is genuine payload order (0 of 20,000 rows are
  merely alphabetical) but it is *one* player's copy, while the marks are pooled
  over everybody running the list — so it deleted 23 real marks across 21 of the
  50 meta decks, and those decks then drew a plain card in a special slot.
  `clash_data.cap_special_marks` now keeps the two most-observed evolutions and
  the most-observed hero (ties on the card key), and `arrange_deck` decides
  which position each one lands in.
* **The three slots are not interchangeable**, and `clash_data.SLOT_ALLOWED`
  states the game's rule (player numbering):

  | slot | may hold |
  |---|---|
  | 1 (index 0) | evolution only |
  | 2 (index 1) | hero or champion — never an evolution |
  | 3 (index 2) | hero, evolution or champion (the "wild" slot) |

  which caps a deck at **two** evolutions. A champion has neither form, so it
  draws as itself — and **it is seated FIRST, in slot 2 or 3**. Measured over
  16,615 real battles holding one: index 1 in 15,063, index 2 in 1,701, never
  lower, never beside more than two marks (evolution / champion / evolution is
  81.3%). It used to be seated only when nothing else wanted those slots, so
  pooled marks naming evolution / hero / evolution drew the champion fourth.

  **The payload does report it, once the level is read.** The old figures here
  — slot 2 "hero 70% / *evolution* 30%", 14% of battles carrying three evolution
  marks — were an artefact of reading `art`, and they are what made the bot's
  `evolution_marks` docstring conclude that "2 evolution slots + 1 other special
  slot" versus "3 special slots" could not be settled from the stored columns.
  By level it settles cleanly: level 1 lands at index 0 or 2 and **never** at
  index 1; level 2 lands at index 1 or 2 and **never** at index 0; and a battle
  carries at most two level-1 marks and one level-2 mark. That is the table
  above, measured.

  So the marks say which cards are special and which form each wears;
  `arrange_deck` decides what position each one lands in, and both the player
  screens and the meta board go through it.
* `decks.cards` is used for display, never `deck_hash`. The hash is alphabetical
  and identifies a deck; splitting it for display scatters the three special
  slots through the row.
* The variant itself is never inferred, and **it is read off the LEVEL, not the
  `art` string** — `clash_data.mark_variant` is the only place that decides.
  `player_evo` stores `[card_key, level, art]`; level 1 is an evolution, level 2
  is a hero. `art` looks like the resolved answer and is a lossy derivation of
  it: measured over 60,000 battles it labels 9.2% of heroes "evolution" and 6.9%
  of evolutions "unknown", 16.1% of all marks wrong or discarded. Reading `art`
  had X-Bow Tesla reporting Tesla, Archers *and* Knight as evolutions at ~100%
  each — three in a deck that can field two, so the hero never survived the cap.
  Level 1 covers exactly the 42 cards that can evolve and level 2 exactly the 16
  that can be a hero, 162,919 marks with no exceptions.

Within those slots a card must still be marked in at least `ART_MIN_SHARE` (25%)
of a deck's sampled battles, because a cluster pools many players' choices. The
art pass reads only the last `CLASH_META_ART_DAYS` (3) days, since it only has
to establish how a deck is currently brought.

| Variable | Default |
|----------|---------|
| `CLASH_META_DAYS` | `10` |
| `CLASH_META_REFRESH` | `1800` (seconds) |
| `CLASH_META_SIZE` | `50` |
| `CLASH_META_MIN_PLAYERS` | `25` |
| `CLASH_META_CANDIDATES` | `600` |
| `CLASH_META_ART_DAYS` | `3` |

### Where the payload says nothing

`player_evo` was only backfilled from 2026-08-05 and covers ~29% of stored
battles, so a deck last played before that has no marks at all — the screen
would show a plain deck for what was obviously an evolution deck. Player reports
therefore fall back to `_inferred_art`, which reads each of the three slots for
its prescribed role. Observed marks always win; inferred decks are flagged
`artInferred` so the UI can say so in the tooltip and a footnote.

A dashed outline was tried as the visual marker and removed: it read as a broken
image rather than as a caveat, on cards that are very likely right.

## The meta over time (`meta_history.py`)

`/api/analytics/meta` is a SNAPSHOT — it recomputes every `CLASH_META_REFRESH`
seconds and keeps nothing — so "Royal Hogs is climbing" was not a sentence this
project could say. `meta_history.py` stores one reading of the board per day in
its **own SQLite file** (`server/.meta_history.db`, gitignored), the same call
`duo_pairs.py` makes: the history must survive independently of the snapshot
that produced it, and a read-write handle to the bot's database is the one
thing this project has never taken. ~50 rows a day, ~18k a year, pruned at
`RETAIN_DAYS` (400).

`deploy/royalweb-meta.{service,timer}` runs `meta_history.py --snapshot` daily
with `RandomizedDelaySec=3600` (the scan reads the bot's 33 GB SQLite on one
spinning volume, and the duo fold and the bot's poll are already on it) and
`Persistent=true` (a missed day is a PERMANENT hole — the board cannot be
recomputed for a day that has passed, because the underlying battles have moved
on). `metaHistory` on `/api/analytics/status` shows the span, so a stalled
timer is visible — it breaks nothing and makes nothing wrong, it just silently
stops the history growing.

**Movement rides on `/api/analytics/meta?movement=<days>`** rather than taking a
route of its own: same subject, same readers, and a second route would have to
be added to `_route`'s count and the auth table for nothing. **The route count
stays 23.**

### The four ways a trend can lie

Each is a named test in `test_meta_history.py` (29 checks, own temp file, no
database opened).

1. **No baseline is not zero movement.** One snapshot answers
   `basis: "none"` with NO rows — the `RETENTION_DAYS` "unknown" rule. A client
   rendering 0% for every deck would state, confidently, that the meta is still.
2. **A deck that was not on the board did not move.** The board is the top
   fifty; entering at rank 12 is not a 39-place climb from 51, because 51 is
   where the board stopped, not where the deck was. `entered: true`, delta null.
   A deck that dropped off carries `left: true`, never "fell to zero use".
3. **A missed timer must not silently change the span.** Asking for 7 days when
   the newest baseline is 11 days old is an 11-day comparison. `comparedWith`
   and `daysApart` always describe the snapshots ACTUALLY used.
4. **A refresh is not a day.** The board recomputes every 30 minutes, so a naive
   append would store 48 readings a day. The primary key is `(day, deck_hash)`
   and a later write REPLACES, so re-running the timer is idempotent.

Two more, from writing it: `snapshot()` **refuses a `building` or empty board**
(storing it would write a day with no decks, which a later comparison reads as
the meta vanishing and returning), and `days or 7` **was a real bug** — 0 is
falsy, so `?movement=0` silently became a seven-day answer instead of clamping.
Absent means default; a supplied 0 clamps like any other out-of-range number.

## A plan against the field (`coach_daily.py`)

Every "what to play" on this site needed an opponent tag, because
`team_scout.threat_space()` builds a projection from ONE player's observed
decks. A coach asking what a player should practise tomorrow has no opponent
to name.

**The module rests on one fact:** `score(rate_for, threats, *, cards,
archetype, fit_games)` takes the threat space as an **injected parameter**. It
reads `archetype`, `likelihood`, `key`, `name` and `evidence` off each entry
and asks the caller's `rate_for` how a candidate does against it — it does not
know or care where the projection came from. So a projection built from the
meta board gets the same tested arithmetic (the four separated signals, the
coverage penalty, the evidence weighting, `diversify()`'s archetype-repeat
rule) with **no second scorer and no model**. Nothing here trains or calls
anything; a test asserts there is no `ml` import.

`field_threats()` turns the top-`MAX_THREATS` meta decks into that shape,
likelihood from use rate, renormalised **only after the cap** (`threat_space`'s
own rule — the cap is a cost bound and drops nothing for being weak). Evidence
is `OBSERVED` because every entry is a real list real players really played;
`observedCount` carries the population's battles, so confidence reads `known`.
A `building` or empty board yields nothing rather than an empty projection.

### The weighting, and the three rules that keep it honest

A pure meta answer tells every player the same thing, which is what a tier list
already is. `deficits()` + `weight_threats()` move mass toward what this player
actually loses to, from `coach_intel.opponentArchetypes` — **own-deck 1v1
only**. `/api/analytics/counter/<tag>` answers a similar question and has **no
mode filter at all** (measured: 872 battles where `coach_intel` reports 710),
so it is deliberately not read here.

1. **A deficit is only real above a floor.** Under `MIN_FACED` an archetype
   gets no adjustment at all, not a small one.
2. **The boost is bounded** by `MAX_BOOST`, or one catastrophic matchup over
   twelve battles swallows the projection.
3. **A strength is never down-weighted.** A deck they beat is still a deck they
   will meet.

### Reserved slots, and why they exist

The first live answer exposed the gap. One roster player's worst matchup by a
distance was Goblin Drill — 22.2% over 18 battles, 38.1 points below their own
rate — and **no Goblin Drill deck is in the meta's top twelve by use rate**, so
their single biggest weakness was absent from the projection and the boost had
nothing to act on. `PRIORITY_SLOTS` admits up to three such archetypes from
below the cut. They are real meta decks, their likelihood is still their own use
rate (rare stays rare), the most-played are never displaced and the projection
does not grow.

### How much of a plan is about the player: measured

`plan()` ranks the **unweighted** projection as well and reports
`tailoredPicks`, with `fromWeighting` on each row. Live across five real
players it is **0 to 1 of 7** — one player gets zero despite eight weighted
matchups, and all five plans together draw on only eleven distinct decks.

That is the correct answer, not a weak one: a rare archetype cannot matter much
in a projection weighted by how often it is **faced**, however badly the player
loses to it. The weighting moves the order and names the matchups; it rarely
changes the deck set. **Raising `MAX_BOOST` would manufacture differentiation
rather than measure it**, so the arithmetic is unchanged and the screen reports
the number instead of implying more.

`ts.explain()` is **not** called: Team Scout's prose was removed on request by
name, and its vocabulary is about an opponent, which a field projection has
none of. The first live run printed one identical sentence under all seven
picks.

**Cost**: the pool is `team_analysis._scout_candidates()` — ~204 real lists
each carrying its own per-archetype record — so 204 decks against 12 threats
costs **no query at all**. The only reads are one `coach_intel` pass and the
already-computed meta snapshot. 1.4 s warm.

### Is the weakness closing? (`?compare=1`)

`progress()` measures this window against **the window of the same length
immediately before it**, recomputed from the battle rows. It is opt-in: it
costs one more `coach_intel` pass (**~60 ms warm**, measured alternated on the
live service — 0.11 s against 0.17 s), and the roster-wide `brief` read fetches
one plan per player and must not pay it per head.

**There is no snapshot table, and the reasoning matters more than the feature.**
`coach_player_snapshot` — one row a day, written by a nightly timer — was the
plan and was dropped for three reasons, each of which applies again to the next
thing somebody wants to remember:

1. **Nothing would have written it.** This service holds the Supabase **anon**
   key, for `admin_auth`'s one RPC gate. Writing coach-owned rows needs the
   **service-role** key, which bypasses RLS on every table in the project — on
   the same box as the bot and the 33 GB database, which still has no backup. A
   daily figure is not worth that blast radius.
2. **A snapshot only holds the days somebody looked.** Recomputation holds every
   day the battles do, and answers for history that **predates the feature**,
   which a snapshot by construction never can. So this works today, over months
   of stored play, instead of being worthless until a timer has run a month.
3. **A stored rate can drift from its own window.** Recomputing from the rows
   *is* the window.

What a snapshot would really buy is what the engine **recommended** on a given
day — the engines move, so that genuinely cannot be recovered later. Different
table, different question.

**The band is Agresti–Caffo, not the plain normal interval.** One success and
one failure are added to each sample before the variance is taken, because the
plain estimate puts the standard error at **zero** whenever a window is all
wins or all losses — a player who went 10/10 and then 9/10 would be credited
with a real ten-point slide. That lopsided small sample is exactly what a floor
of ten battles leaves in. **The change reported is the raw difference and the
band comes from the adjusted rates**: the adjusted rate is a device for
estimating spread, and printing it would be printing a number that is not the
player's record. `COMPARE_Z` is 2.0. **It is a noise band, not a significance
test** — nothing prints a p-value or the word.

**`resolved` needs the gap to close AND the record to rise, and the first
version got that wrong.** A deficit also closes when the player gets worse at
everything else and their overall rate falls to meet a matchup that never
moved. On the gap alone that prints as resolved — the screen congratulating
somebody for a decline. A test caught it. Requiring `direction == 'up'` rather
than merely not-`'down'` is what excludes it, since that case is exactly
`'flat'`; it also implies both windows cleared the floor, so it can never fire
off three battles.

**Both windows must clear the floor** (`COMPARE_MIN` = `MIN_FACED` = 10), and
falling under it is a state rather than a movement of zero: `thin` (faced, but
too few) and `unseen` (not faced at all before). "They stopped meeting this"
and "this did not change" are different facts and only one is about the player.
The reason for an uncomparable window names **which side** is short —
`thin_now` and `thin_before` read completely differently to somebody being
coached.

**The matchup list is the union of both windows' weaknesses**, worst standing
deficit first, so one that has *closed* is still listed. Listing only what is
still wrong would delete the best thing the screen can report, and the player
would see the same three names every week with no record of the one they fixed.

**Measured live, and it changed the UI.** On the real account every one of
eleven matchups came back `flat` — correctly. Over a 30-day window an archetype
is worth 20–60 battles, and telling two rates apart at that size needs 16 to 39
points; a 16.8-point slide against Golem (73.9% over 23, then 57.1% over 21)
sits inside a 27.4-point band. So the card prints **movement only**, with the
rest as one counted line that names what it withheld — the battle log's
hidden-mode rule. The **overall** line is always drawn, because it is the only
figure with enough behind it to move: 437 battles against 489 gives a band of
**6.2** points.

### The answer was generic, and the shape was why

The screen returned seven decks and they were nearly the same seven for every
player. **Measured on the six busiest real accounts:** 42 slots drew on **ten
distinct decks**, any two players shared four to six of seven, **three decks
appeared in every single plan**, and `tailoredPicks` — the engine's own count
of how many picks the weighting put there — was **0 for five of the six**.

That was not a scoring fault. Two causes, both structural:

1. **`diversify()` is a portfolio picker and this is not a portfolio.** Its
   `ARCHETYPE_REPEAT_PENALTY` deliberately spreads picks across archetypes,
   which is right for Team Scout (several answers to one opponent) and here
   collapses 204 decks to "the best deck of each of seven archetypes" — a tier
   list, and a tier list is the same for everyone by construction.
2. **Nothing in the ranking knew what the player plays.** `score()` takes
   `fit_games`; this module passes `None` because the pool is ownerless, so
   the only personal term was the deficit weighting, whose own measurement is
   the 0-of-7 above.

So `plan()` keeps the **whole scored pool** (it used to compute 204 and throw
197 away) and answers three questions instead of one, all from the same
`score()` rows so they cannot disagree about a deck:

| key | what it claims |
| --- | --- |
| `families` | every win condition the field can be answered with, ordered by its **best** deck. The spread is structural instead of enforced by a penalty. |
| `closest` | of those, the ones built from cards they already run. |
| `learn` | one win condition outside their range, chosen by the **biggest single gap it closes** in their record, or `null`. |

**The same six accounts after:** 25 distinct decks across the personal lists,
**mean pairwise overlap 1.00 decks**, and **nothing in every player's list**.

**Affinity is raw shared cards, and the floor was measured.** The pool's
staples are `barbarian-barrel` (34.8% of all 204 decks), `skeletons` (30.9%),
`fireball` (26.0%) and `zap` (21.6%), so three and four shared cards are
reachable by staples alone and say nothing about anybody; `AFFINITY_MIN` is
**5**, the first level that needs a card outside them. The figure reported is
the raw count on purpose — a staple-weighted score would be more correct and
completely uncheckable, where "6 of these 8 cards are in a deck you play" is
confirmed by looking at two card strips.

**`REPERTOIRE_MIN_BATTLES` exists because the live data forced it.** Without a
floor on their OWN decks, one account's closest match was "5 of 8 shared with a
deck you played **3 times**" and another's entire related list came off one-
and two-battle experiments. It is 5, the headline deck block's `DECK_RATE_FLOOR`
reused rather than reinvented.

**`learn` returns `null` rather than inventing a growth suggestion.** A new
archetype costs weeks, so it is only offered when it actually beats the best
thing they can already pilot; with nothing familiar there is no bar and the
copy must not imply one (`beats` is `null` there).

**Two fields were dropped after measuring them.** `spreadCovered` on a family
was **100.0 for all seventeen families on every account** — at the top of a
204-deck pool every family's best deck answers the whole projection, so it is
true and says nothing, and a field that never varies is decoration. And
`affinity.deckCards` was the single largest per-row field while only `closest`
draws it; trimming the family rows took the payload **108.3 kB -> 83.0 kB**.

**`brief` carries none of this** — verified live at **10.2 kB**, unchanged. The
roster-wide read draws one deck per player and would otherwise pay for 68 more
deck rows a head to show none of them.

**It degrades rather than failing the tab.** `recommendations`, `threats` and
`weighted` are complete before the three lists are built, so a fault in them
costs those three lists and nothing else.

**Open, not a bug:** `learn` picked Balloon or Graveyard for all six accounts,
because those are the field's two best families and almost nobody plays them.
The personal part is the filter (they have played it 0 times), and six players
who all ignore the two best archetypes genuinely have the same thing to learn.
Left as an observation rather than manufacturing variety.

### Two signals, and which question each one answers

Personalising this board needed two different measurements, and using one for
both jobs failed twice in ways only live data showed.

| | `affinity.shared` | `affinity.known` |
| --- | --- | --- |
| counts | overlap with the single closest deck they run | cards of the eight they play **anywhere** |
| claims | "you could pilot this today" | "this is built out of your cards" |
| floor | `AFFINITY_MIN` 5 | `KNOWN_MIN` 5 |
| qualifies (6 live accounts) | 0–55 of 204 | 1–161 of 204 |
| drives | the **Closest** list | the family **reserved slots** |

**The board is partitioned on neither of them.** It is partitioned on
`in_range()` — have they actually played this win condition — which is
`worth_learning`'s own test inverted, so "outside their range" means one thing
in the module and the board cannot offer a family as new while also calling it
theirs.

**Three attempts, and the first two are worth keeping because each failed for
a reason that will recur:**

1. **A bounded weight (`FAMILIAR_WEIGHT`, 1.5 points) moved nothing.**
   `personalised` came back 0 or 1 of 17 families on all six accounts and 54
   of ~68 decks sat on every player's board. The gaps between families are
   five points wide. Un-bounding it would rank worse decks above better ones
   on a weak signal — `MAX_BOOST`'s mistake in a second place. It is kept as a
   tiebreak and the payload publishes how little it does.
2. **Grouping on card overlap collapsed.** A player with 25 decks and a
   67-card pool clears "5 of 8 are cards I play" in **all seventeen**
   families, so every chip read `· 12` and every section landed in "Theirs".
   Card overlap is dense precisely because it is a weak claim, which is why it
   cannot decide range.
3. **Reserved slots + a history partition worked.** `FAMILY_FAMILIAR_SLOTS`
   (2 of 4) is `PRIORITY_SLOTS`' answer one level down: the family keeps its
   best answers and reserves room for the ones built from their cards, each
   marked `closestOfFamily` so the screen says why it is there.

**Measured across the six busiest live accounts:**

| | before | after |
| --- | --- | --- |
| decks common to all six, per family | 2–4 of 4 | **1–3 of 4** |
| families identical for everyone | 3 of 17 | **0 of 17** |
| section orders identical | 15 of 15 pairs | **0 of 15** |
| distinct decks across boards | 86 of 408 | **111 of 408** |

### Worth learning is the biggest hole, not the best deck

Reported as *"worth learning is the same for everyone"*. It was: **one
archetype for all six live accounts**. The first fix ranked unfamiliar families
by likelihood-weighted improvement over their own best answer, which made the
FIGURES personal (gain 0.00–4.59) and still left **two distinct archetypes
across five players**.

**Both rankings were then measured against each other on the real roster
before one was picked**, because they disagree for a reason worth stating:

| ranked by | distinct suggestions across 5 players |
| --- | --- |
| total gain across the whole projection | 2 |
| **the biggest single-threat gap it closes** | **3** |

A deck that is a little better at **everything** wins on total gain — and that
is the generically strongest deck, which is the tier list again. Learning a new
archetype is for answering something you **cannot answer at all**, so the
ranking is the largest gap it closes and the total only breaks ties.
`coverage_gain()` returns `(total, hole, covers)`; `fills` names the archetype
that gap is against and leads the card's copy. With no repertoire to compare
against, every candidate scores 0 on both and the expected rate breaks the tie
— the old behaviour, kept deliberately for exactly that case.

**The convergence that remains is the meta's, not the code's.** Two decks
dominate this field and Hog Rider is the commonest threat, so the best answer
to it is the best answer for several people at once. What is personal is the
gap, its size, and whether there is one at all.

**Two of the four slots are still the field's best and are the same for
everyone**, correctly — they are the best answers, and showing a player worse
ones to look personal would invert the point. A player with four decks that
match nothing in the pool gets the field's order throughout, and the copy says
so.

### It moves with the meta, and the screen says when

The pool is `deck_counter.seeds()` out of `.counter_snapshot.json`, rebuilt on
`CLASH_COUNTER_REFRESH` (hourly) from a rolling **10-day** window of real
battles; `_scout_candidates` caches on that snapshot's own `computedAt`, so
the pool invalidates when the meta rebuilds. The player's side is a rolling
30 days. `FreshnessLine` prints `Meta 10d to <date> · <age> · trend off|Nd`,
because a board with no date on it cannot be told from a stuck one. **The
roster's `Today` card draws the same component**, so the two screens cannot
drift on what they claim the answer was computed from.

**How fast each half actually moves, measured rather than promised:**

| half | how it was measured | result |
| --- | --- | --- |
| the **meta** | the stored daily boards, one day apart | **6 of the 12 threats** a plan projects against changed rank; **3 decks entered** the board of 50 and 3 left |
| the **player** | the same 30-day window ending 7 days earlier, board held fixed | the **top pick did not move** for any of 5 accounts; the order moved for **3**, worth-learning for **1** |

That is the correct shape rather than a weak one. The plan changes day to day
and the movement is almost all the field's; a top pick that thrashed daily
would be noise, not intelligence. So the screen names the window and the hour
instead of claiming churn it cannot show.

**`TREND_MIN_DAYS` (3) cannot fire from the production path**, which is worth
knowing before it is read as the real gate. `plan()` asks
`meta_history.movement(TREND_DAYS)` and that takes the newest snapshot **at or
before** `latest - 7`, walking older and never closer, so `daysApart` is always
≥ 7. The live gate is `movement()` answering `basis: "none"` until seven days
are stored — the history began 2026-09-23, so the trend is genuinely off until
**2026-09-30** and the screen says `trend off` truthfully meanwhile. The guard
is defensive depth, reachable only if `TREND_DAYS` is lowered under it.

The 7-day directional weighting (`trend`) reports itself **off** until
`meta_history` holds `TREND_MIN_DAYS`; it began 2026-09-23.

### The copy is figures

No sentence explains a number that is already on screen — the rule already
applied to Team Scout's screens. `54.3% expected against the field` is
`54.3%`; `Closest of this win condition · 8 of 8 cards are in a deck they have
played 17 times` is `Closest yours · 8/8 of one deck · 17 games`; two ISO
ranges are `Last 30d vs previous 30d` with the dates in a `title`. **The
noise band, the counts and every floor still print** — they are what stop a
coach acting on noise. Units are stated once per card rather than on each of
68 rows.

## The card board (`player_cards.py`)

Use rate and win rate for all 123 cards for one player, over a window, with
movement against the equally long window before it. `?mode=` scopes it to
`all` / `ranked` / `duel` / `tournament`; each is a Python predicate over the
stored `game_mode` string, not a SQL clause, for the reason `duel_stats` gives.

* **`battles`, not `player_card_agg`** — the rollup is lifetime-only, so reading
  it would make the date and mode controls decoration.
* **Every card is returned**, including never-played ones. A zero row answers
  "what do they not run"; the UI hides them behind a checkbox.
* **The rank floor is `duel_combos.CONF_MIN_GAMES` (8)**, reused rather than
  reinvented. Below it a card is returned with `tiered: false` and `tier: null`.
* **No card metadata is sent.** Type, elixir, rarity, win-condition, champion
  and evolution live in `src/data/*.json`, which the browser already loads.

### Per-form rates

Each row also carries `forms: {base|evolution|hero: {...}}` — an evolved
Skeletons scored separately from a plain one, with its own use rate, win rate,
evidence tier and Wilson interval.

* **Evolution and hero are separate counters.** `_evo_marks` resolves each mark
  to one or the other, and `_tally` used to add both into `evoRate`. That
  reported eleven cards as evolved on the test account — Berserker at 76.8% —
  none of which can evolve at all.
* **Only marked battles can be split**, and both sides come from that subset.
  Inside a row that carries marks, a card with no mark of its own was fielded
  plain; that is the only place `base` can be counted from. Outside one the form
  is unknown, which is not the same thing.
* **`formCoverage` says how thin that is** — battles, share, and the dates they
  span. On the test account 350 of 2,268 (15.4%), inside an 8-day window against
  a ~50-day history. The screen prints it; a form's win rate must not pass for
  the same kind of number as a card's.
* **A form's use rate is a share of the marked battles**, not of every battle —
  a share of a population the form could not have been observed in would
  understate every one of them by the coverage gap.
* **A card with no marked battles gets no `forms` key at all**, so the client
  can tell "never observed in either form" from "observed, zero".

## The matchup engine (`deck_counter.py`)

Three answers: which archetypes beat a player, a deck-vs-deck head-to-head, and
what counters a given deck. Three measurements shaped all of it.

* **Exact deck-vs-deck is not answerable.** Of 1,961,367 stored pairings only
  0.59% have even 8 games, so matchups are computed at ARCHETYPE level, where
  all 289 cells clear 50 games.
* **The raw table is biased.** `deck_a` is the tracked player's deck and tracked
  players win 58.59% of everything, so read straight every deck counters every
  deck. Cell (A,B) is combined with the reverse of (B,A); the check that this is
  right is that every mirror then lands at exactly 50.0% (raw: bait 58.0%, hog
  58.8%, graveyard 62.5%). `_symmetric()` is the only way a number leaves the
  module — never report a raw cell.
* **No match duration exists** in `battles`, `pair_matchup_agg` or the stored
  payload, so there is no "average match time" anywhere.

**The deck beside a player's matchup row is the one THEY face.** The rows were
always personal — the player's own battles grouped by `opponent_win_condition` —
but the deck came from `_representatives()`, the archetype's most-observed deck
across the whole database, so every account saw the same eight cards for
"X-Bow". `opponent_card_keys` is in the same query, so the list they have
personally met most costs one JSON parse per row. `FACED_MIN_SIGHTINGS` (3)
guards it: below that the "most common" deck is whichever single opponent turned
up twice, and the representative stands in with `deckBasis: "typical"` instead
of `"faced"`. Exactly 8 cards, and an explicit key tiebreak because sighting
counts tie constantly and dict order would reshuffle the drawn deck between two
identical requests.

The matrix costs ~60 s (1.96M pairings joined to a 1.05M-row deck table) and is
a background snapshot on meta.py's pattern, persisted to
`server/.counter_snapshot.json`, refreshed every `CLASH_COUNTER_REFRESH` (3600)
seconds. The per-player half needs no snapshot: `battles.opponent_win_condition`
is stored and 100% populated, so that query is ~40 ms.

Every matchup row carries a real deck of that archetype, taken from the current
meta board rather than invented: its top 50 covers all seventeen archetypes, the
decks are what people are actually running, and the evolution art is already
resolved. `_representatives()` degrades to `{}` while that snapshot builds.

Only archetypes over 50% are returned as counters — ranking the field and taking
the top five hands back a "counter" at 48.3%. Play styles (Beatdown / Control /
Siege / Cycle / Bridge Spam) are an editorial map, because the database stores a
win condition, which is a card and not a play style.

**Pasted decks are arranged before they are returned.** A copy-deck link carries
eight card IDs and nothing else, so `_drawn()` runs them through
`clash_data.arrange_deck` — the same slot rules the meta board and the player
screens use — and the response carries the ordered list plus an `art` map and an
`inferredArt` flag. Without it a pasted deck rendered as eight plain cards next
to a meta deck with its evolutions drawn.

Evidence first, though: `deck_hash` is the sorted card list, so `_board_art()`
checks whether the meta board already covers the pasted deck and uses its
observed marks if so. A pasted meta deck then renders identically to the same
deck one row below, with `inferredArt: false`. Only a deck the board has never
seen falls through to capability inference, and the flag says so.

**Duels are already in every figure.** `pair_matchup_agg` is filled by
`clashdb._accumulate`, which has no game-mode filter — measured, an 8-card duel
battle's deck pair is present 72.7% of the time against 61.3% for a ladder one.
The exception is a native duel row: it holds a 16/24-card loadout and only the
series result, so it can never contribute a deck pair, and `_build_reps` rejects
any hash without exactly seven commas so a loadout is never read as a deck.

Because of that, `_representatives()` no longer reads the meta board's top 50 —
that board excludes duel modes on purpose. Representatives come from the matchup
table itself (`snapshot["reps"]`, the most-observed deck per archetype, the
bot's own rule), so the deck shown and the numbers beside it come from one
population. The board is still asked for observed art.

**The ladder.** `matchup_ladder(cards, archetype, snap)` returns every reading
with evidence behind it, narrowest first: the exact list, then lists one card
different, then two, then the archetype. `deck_vs_deck` ships the whole thing
and takes the first as its headline; `find_counters` walks it per archetype and
labels each row. The two cluster rungs are the bot's `CLUSTER_MIN_OVERLAP = 6`
idea split in two, because 6-of-8 and 7-of-8 are different amounts of "the same
deck".

Costs, and the shape they forced: no index answers "shares six cards with this",
so the 1,054,394 deck hashes are read once at startup on the background thread
(~86 MB, 2.2 s) and the scan is 1.6 s per deck. Both levels share that scan AND
a single TEMP-table join — chunked `IN (...)` was 4.4 s, the join is 1.0 s, and
one pass fills both buckets. `mode=ro` still allows temp tables. Net 15.2 s →
5.5 s cold, 2.1 s cached.

**THAT PATH IS NOW THE FALLBACK: `cluster_index.py` (2026-09-21).** The numbers
above stopped being true as the database grew. Measured on the VPS:

- The vocabulary is **2,772,680** hashes. The Python scan is 2.2 s a deck.
- The join reads ~100,000 pair rows a deck, each a random page read into a
  55 GB file. That is 3 s warm and 13–20 s cold.
- The 32-entry cluster cache cleared itself whole on overflow, so a 5-player
  roster (36 decks, 72 entries) was cold on every request.

Team Analysis took **208 s** for a 5v5, 97% of it here.

The index precomputes it. `.cluster_index.db` is this service's own file,
rebuilt every 4 h by `royalweb-cluster.timer` in ~6 min at 80 MB peak memory.
It holds three tables:

- `deck_arch` is each deck's record per opponent archetype, summed in SQL from
  `pair_matchup_agg` with the bot's database ATTACHed `mode=ro`.
- `card_bits` is one big-integer bitset per card. "Shares 6 of 8" is an OR of
  ANDs, 22 ms instead of 2.2 s.
- `deck` holds stable, append-only ids, so a build can land under a running
  reader.

`_siblings`, `_cluster_all` and `deck_profile` read it first and fall back to
the live path when it is missing, unreadable, or built from a different database
(`meta.source`). The results are **identical**:

- On 12 real decks: sibling counts, games and win rates, with zero difference.
- On a synthetic database: `test_cluster_index.py`, 64 checks, including a
  negative control and a guard on the query plan.

**THE JOIN IS A `CROSS JOIN` ON PURPOSE.** SQLite has no statistics for a fresh
temp table, and with a plain JOIN it scanned all 5.1M `deck_arch` rows: 870 ms a
deck against 14 ms. The test reads the plan, because no equality check can see
this.

Both caches are LRUs now, with a lifetime: exact profiles for an hour, clusters
keyed by index generation for 4 h. `/api/analytics/status` publishes
`clusterIndex` (build time, age, decks, rows, `orphanRows`, build seconds).

Measured after, through the real engine, with 8 worker threads:

| board | fresh process | repeat |
|---|---:|---:|
| 5v5 | 4.6 s | 0.5 s |
| 12v12, 24 real tracked players | 3.0 s | 1.7 s |

A 12v12 of players whose history is not yet in the page cache adds ~5 s of
per-player reads.

**`real_opponents` has no evidence floor, on purpose.** `MIN_GAMES` stops the
screen quoting a win rate off two games; it should not stop it saying the games
happened. A deck that lost 0-3 to a specific list was vanishing behind archetype
rows measured on other decks. That function reports W-L per opposing deck from
two indexed lookups and the UI prints it as a record, never a percentage.

**Every list is returned whole; the client pages it.** `worst` and `best` used
to be `matchups[:5]` and `matchups[-5:]`, which overlap below ten archetypes and
left the screen unable to honour its own "16 analyzed" figure. They now
PARTITION the field on the player's own average (`diff < 0` / `diff >= 0`), so
they cannot overlap and cannot leave a gap. `find_counters` likewise returns
every archetype that beats the deck rather than the first five — a deck with
twelve real counters was reporting five while the style breakdown below it
counted all twelve.


## Team analysis (`team_analysis.py`) and the coaching brain (`team_scout.py`)

Two rosters in, a folder per opponent out — **or one roster in, on its own.**
The scoring rule and its floors are in the module docstring; four things matter
from outside it.

**THE OPPONENT MODEL IS A PROJECTION NOW, NOT A HISTORY.** `team_scout.py` is
the brain: it takes their observed decks and returns a distribution over what
they are LIKELY TO BRING — the decks themselves, real variants of them out of
the seed pool, and archetypes their play implies — summing to 1.0, every entry
labelled `OBSERVED` / `VARIANT` / `INFERRED` and confidence-rated. The
recommendations are scored against that, diversified, and returned 5–7 at a
time. `_spread()` survives as the DISPLAYED archetype breakdown and is still
what the screen draws on the left.

**A MATCH PLAN'S LISTS ARE CHOSEN AS A SQUAD (`team_scout.squad_plan`, brain
2.1, 2026-09-25).** Each teammate's #1 comes from the decks within
`PRIMARY_BAND` (3 pts) of the best available, assigned greedily so the squad's
#1s cover the opponent's archetypes (`cover_gain`, from 50%) and lean on cards
each teammate plays (`KNOWN_WEIGHT` 1.5, floor 5 of 8); no two share a #1
unless the band holds nothing else. The tails are `diversify` on the personal
score with `score_key` / `bonus` / `first` (defaults unchanged, pinned by the
speed-up oracle). Live, 11 folders: every-#1-distinct 0/11 -> 8/11, distinct
decks 117 -> 191 of 378, mean slot rate -0.36 pts. `squadCover` on the folder;
`vs` / `known` / `squadPick` / `covers` on rows. **`score()` is untouched** —
`coach_daily` is its second consumer. Record: `DECKKIES_TEAM_SCOUT.md` §4f.

**`matchups` (the per-threat table) is on each folder's TOP pick only**
(`_evidence_on_top`, 2026-09-21). It was ~4 kB on every recommendation and 80%
of a match plan's payload (live 5v5: 1.08 MB -> 257 kB), and the PDF, its only
reader, prints it for the top pick alone. Per-teammate decks and the roster-wide
list carry none. The client type is optional to match.

**TWELVE A SIDE, AND IT RUNS IN PARALLEL (2026-09-21).** `MAX_SQUAD` is 12;
`test_team_analysis.py` reads the client's copy out of `squadParse.ts`, and the
vitest suite reads this file's copy, so neither can drift alone.

Two fan-outs run on ONE process-wide pool (`_POOL`, `CLASH_TEAM_THREADS`,
default 8), so concurrent big rosters share threads rather than multiplying
them:

- **Player resolution.** 24 players took 180 s serially on a cold cache and
  4.7 s on 8 threads.
- **Deck profiling.** Now an index lookup; see the matchup engine above.

The ranking itself (`team_scout.diversify` / `fills`) was rewritten for speed:

- a running maximum similarity instead of recomputing it against the whole
  chosen list every round;
- near-copy detection by shared six-card subset instead of an intersection
  against every accepted deck.

At 12v12 that removes 310,000 similarity calls and 1.4M set intersections a
request. `test_team_scout.py` keeps the original bodies as oracles and compares
them on 1,500 random pools each. They are identical.

It has **no imports beyond the standard library**, the rule `deck_harmony.py`
and `battle_modes.py` follow, so all 107 of its checks run against literals with
no database. `DECKKIES_TEAM_SCOUT.md` is the design record — read it before
changing a weight, and in particular before raising `SWITCH_MAX` past 0.5, which
would let the model overrule the player's own most-played deck and reopen a
question Phases 4–7 closed with evidence.

**An empty `blue_tags` IS the scouting report**, and that absence is the mode
switch rather than a flag. The two modes take the same inputs minus one, return
the same shape plus one field (`overall`), and publish which they were in
`mode`. So `/api/analytics/teams` simply stopped requiring `blue`: **no new
route**, nothing extra to hand-copy to the VPS, and the route-count tripwire in
`test_api_security.py` stayed at 21 (it is **23** today — `duo-pairs` took the 22nd, Coach Roster's admin intel the 23rd; `duo-pairs` took its
own path on 2026-09-10; see the route table above). It also means the incoherent combination —
a squad pasted *and* scout mode asked for — cannot be expressed.

With no squad to recommend from, the pool is `deck_counter._representatives()`:
the most-observed real deck of each archetype, **not** the meta board's top 50,
for the reason `_build_reps` gives above — the board excludes duel and friendly
modes, and every number scored here comes out of `pair_matchup_agg`, which does
not. Those candidates carry `owner: None` and `comfort: None` (nobody owns an
archetype representative, so there is no tiebreak and no games piloted) and
quote `overallWinRate` instead: the deck's own record across the field, which
is the only thing that separates *beats them* from *beats everybody*.

`_score` is shared between the two modes unchanged. A second scorer for the
second tab would put the fault this module exists to avoid — two places
disagreeing about the same two decks — *inside* one screen.

**`_SCOUT_POOL` is cached on the counter snapshot's `computedAt`, and that is
not only an optimisation.** `_CLUSTER_CACHE` above is 32 entries and clears
itself whole on overflow; seventeen representatives at two cluster levels is
thirty-four. One forward pass costs a single sibling scan per deck and never
returns to one — anything that looped opponents on the outside would rescan
every deck every pass. The key is the snapshot because `reps` lives in it.

**It reuses `deck_counter.matchup_ladder` rather than reimplementing it.** Every
figure a recommendation carries is a rung of that ladder — exact deck vs
archetype, the 7- and 6-card clusters, then the archetype matrix — already
symmetrised, so the 58.59% tracked-player house edge is already out. A second
scorer here would eventually disagree with the Deck Counter about the same two
decks.

**Each candidate's profiles are built once.** `matchup_ladder` reads
`deck_profile` plus two `cluster_profile`s, LRU-cached upstream at 64 and 32
entries. Those sizes are right for a screen looking at one deck and wrong for 40
candidates scored against 8 opponents: looping opponents on the outside evicts
every candidate on every pass. `_Scorecard` does the reads in `__init__` and
`against()` is dictionary lookups. Do not resize the upstream caches to "fix"
this — they are correct for their own screen.

**A rung's denominator is `games`.** `battles` is a field on the profile
WRAPPER, not on a per-archetype record. Reading `battles` gives null on every
rung, and it is invisible until a client formats it — which is exactly how it
shipped for an afternoon, with 59 passing tests, because the fixture had
invented the same wrong name.

**The pool is one candidate per (player, deck) pair.** It used to be
deduplicated across players — a shared list kept for whoever had played it more
— and that made the per-player board impossible: the other teammate could not be
offered the deck they actually play. Dedup happens only WITHIN a player now.
`_DeckProfile` is keyed by the cards and shared by reference, so a list two
teammates both run still costs one set of database reads.

`folders[].perPlayer` is the payload the screen is built from: one entry per
blue player, in roster order, each with that player's own top 3 and a `reason`
when they have none. Every player appears, including one with nothing to offer.

Floors: `MIN_COMFORT_GAMES` 5 (a deck under it is one somebody tried, not one
they play), `MIN_OPPONENT_DECK_GAMES` 2, `MAX_SQUAD` **10** per side, `TOP_N` 3, `SCOUT_TOP_N` 5.
`COMFORT_WEIGHT` is 1.5 points and is a TIEBREAK — sized to lose to any real
matchup difference.

**Measured on production, 2026-08-30, at the new cap:** 10 blue x 2 red, cold,
against the real database — **2m 30s**, 61-deck candidate pool, all ten blue
players resolved `stored`. The blue side is what costs: ten resolutions plus a
profile for every one of the 61 candidates, all built before the first opponent
is scored. Two folders on top of that is cheap, which is the shape the design
predicted and the reason the folder loop is on the inside.

`MAX_SQUAD` was 8 until 2026-08-30. Ten is what people paste: a ranked roster
off a Discord channel is numbered 1 to 10. The cost is mild — the scoring loop
is `blue x red`, so 64 candidate-folder pairs become 100, but that loop reads
memory only because every profile is built once up front (see below). The real
bill is 20 player resolutions instead of 16.

**This file SLICES; the client REFUSES.** `analyze()` takes
`blue_tags[:MAX_SQUAD]`, so a client whose cap is higher than this one does not
get an error — it gets a report with the tail of its roster missing, absent
from `folders` and absent from `rejected`. The two constants are mirrors
(`src/utils/squadParse.ts`) and must move in one change. Because this half is
copied to the VPS by hand while the frontend deploys from `main` in a couple of
minutes, they genuinely do drift between deploys, so the screen reads
`limits.maxSquad` back off the report and names the mismatch. **Raising the cap
is not live until this file is deployed.**

An archetype no rung can answer is renormalised out of the denominator, never
counted as 50%: averaging over an empty set flattens the ranking exactly when
there is least evidence. A candidate that can answer nothing at all scores
`None` and is not listed.

### Cost, measured

| | |
|---|---|
| 2 blue x 2 red, warm | **1.5 s** |
| the same call, cold | **31 s** — the first hit pays for the meta and counter snapshots |
| 3 blue x 1 red, production | 15 candidates in the pool |
| profile reads | 3 per **unique deck**, never per (player, deck) pair |

The cold/warm gap is the whole argument for `_DeckProfile` being built once per
run. The three reads behind each rung (`deck_profile` plus two
`cluster_profile`s) are LRU-cached upstream at **64 and 32 entries** — sizes
chosen for a screen looking at one deck. A 5v5 run has ~40 unique candidate
decks scored against up to 8 opponents; looping opponents on the outside evicts
every candidate on every pass and converts ~240 dictionary lookups into ~240
database reads. On the spinning volume the site used to read from, that is the
difference between a screen and a timeout. **Do not "fix" this by enlarging the
upstream caches** — they are correct for the Deck Counter, and a team run must
not change how that screen behaves afterwards.

### Two logic bugs worth keeping written down

**The pool was deduplicated across players.** A deck two teammates both run was
kept for whoever had played it more. That is right for a single squad-wide top
three — one deck under two names is one option wearing two rows — and it is
wrong the moment the answer is per player, because the other teammate cannot
then be offered the deck they actually play. The split into `_DeckProfile`
(keyed by the eight cards) and `_Candidate` (one per player/deck pair) exists
precisely so the dedupe could be removed **without** paying twice for the reads.

**A loop variable shadowed the opponent's deck list.** In `_folder`:

```python
decks = (opponent.get("decks") or [])[:OPPONENT_DECKS]   # the left side
...
for mate in blue:
    decks = [...]      # <- rebinds the line above
...
"theirDecks": decks,   # <- now the LAST blue player's decks
```

The left half of the board silently showed the wrong team. Caught by the unit
test asserting the left side had two rows — the one fault in this work that an
existing test found before a person did. The loop variable is `own` now.

### `games`, not `battles`

Every rung of the matchup ladder — the exact deck profile, both cluster levels
and the archetype matrix — publishes its denominator as **`games`**. `battles`
exists on the profile **wrapper** (`{"archetypes": ..., "overall": ...,
"battles": n}`) and never on a per-archetype record.

Reading `battles` therefore returns `None` from every real rung, and nothing
notices until a client formats it. It shipped that way for an afternoon with 59
passing checks, because the test fixture had invented the same wrong name the
module was reading. A fixture written from what the consumer expects, rather
than from what the producer emits, pins nothing.

### The evidence floor makes two different decks look identical, correctly

One player can return two decks of the same archetype with the same expected
win rate and the same evidence row. Verified against production: the lists
differ by one card (`royal-ghost` against `elite-barbarians`), **neither clears
the deck-level floor**, so both fall through to `_symmetric` on the archetype
matrix — which cannot distinguish two Bridge Spam decks, by construction.

That is the correct answer rather than a bug, and the payload already says so:
`source` is `archetype` and the denominator is in the tens of thousands. The
comfort tiebreak does the ordering, which is what it is for.

## Safety

Connections open with `mode=ro`, so SQLite itself refuses writes — this process
cannot corrupt the bot's data even by mistake. WAL means these reads never
block the bot's polling writes either.

## Performance note

The trend query pushes its date bound into SQL (`battle_time >= ?`). Because
`battle_time` is `YYYYMMDDThhmmss.sssZ`, a plain string comparison is a correct
date filter and lets SQLite use the `(player_tag, player_deck_hash)` index.
Without that bound the pair of queries took ~17 s; with it, 74 ms cold and
under 10 ms warm.

## Coach Assist (`coach.py`)

**THE TUNER'S "OR BRING ONE OF THESE" IS PERSONAL (2026-09-25).** `tune()`
takes a `profile` from `_playstyle(tag, since, until, hist)` — one
`cd.player_report` read (all stored battles; duel decks added on top) — and
passes compose's WHOLE ranked list through `deck_tuner.personalise`. Only when
`swaps=1`, so the default Coach response pays nothing. Measured on 12 players
vs one opponent: 1 -> 7 distinct lists (as sets), 6 -> 12 distinct decks, mean worst-
matchup -1.0 point. `compose` rows gained `family` and `name`; the loadout is
untouched. See `DECK_TUNER.md` §7.

**`expected.vs` AND `vs` ON COMPOSED/LOADOUT DECKS (2026-09-25).** Per-archetype
chips for the Suggestion screen: `_vs_from_per` (grouped by `_archetype`,
likelihood-weighted, unrecorded archetypes absent) and `_vs_from_record` (a
tuner deck's record against the opponent's archetypes, in `_spread`'s order).
Each row is `{archetype, name, winRate, share}`. Additive; nothing reads the old
fields differently.
Then widened to **five** per deck (`CHIP_ARCHETYPES`) by `_chip_archetypes`:
likely archetypes, then the opponent's other win conditions (`_playstyle` on
the OPPONENT — one extra `player_report` read per suggest), then the meta
board; `other` never. Rows gain `kind` (`likely` / `theirs` / `meta`), and the
payload carries `chipArchetypes`. Off-projection rates: the deck's own record,
then `_symmetric` — deliberately not the cluster rungs.

The bot's duel advisor, in two windows: `!predict`/`!predict2`/`!predict3` (what
they will bring) and `!suggestion` (what you should answer with).

`duel_zone` already ports the deck-ranking half — `predict_companions`,
`observed_duel_loadout`, `rank_companions_by_series` — for its sequence board,
and it is imported rather than re-implemented. This module adds the parts that
belong to the interactive commands: the OPENING distribution, the card and
archetype odds, and the recommendation.

Things to keep:

* **A recommendation is stricter than a prediction.** `RECOMMEND_MAX_SHARED = 0`
  against the predictor's 2. A predicted deck may overlap what was revealed
  because the history is noisy; a deck we tell someone to play next cannot,
  because they physically cannot play it.
* **Only reconstructed series can answer "what do they open with".** A native
  duel row is a loadout, and the bot records that its 8-card blocks are not
  proven chronological. Under `MIN_FIRST_SERIES` ordered series the answer falls
  back to overall play rate and the response says which via `basis`.
* **Expected win rate walks `deck_counter`'s ladder LAZILY.** `matchup_ladder`
  builds every rung for display; the ≥7 cluster scan is 11.6 s cold, and the
  Coach asks for a whole grid. Stopping at the first rung with evidence took
  `suggest` from 25.7 s to 2–3 s with an identical answer.
* **An unscorable pairing is dropped, never scored at 50%**, and the surviving
  probability mass is returned as `weight` so the caller can discount it.
* **No counter-sniping.** Measured by the bot on 3,569 leak-free trials: top-1
  accuracy 8.3% → 2.7%. Recency and per-opponent tendency lost to plain usage
  too. `_read` narrates evidence and invents no tendency.
* **`observed_sequences` is a record, not a ranking.** It returns the whole
  three-deck loadouts the player has really run that CONTAIN the pasted deck,
  grouped and counted with their win record. Matched anywhere in the loadout,
  not anchored to game 1 — anchoring left 20 of 40 real decks showing nothing.
  Native rows are included for membership and flagged `ordered: false`, because
  their 8-card blocks are not proven chronological.
* **`_history` is cached for 120 s.** Both windows are stepwise and every step
  asks the same question of the same tag; the read is ~3–6 s uncached.

## The Opponent Intelligence Engine (`ml/`)

Research package plus a production boundary. Nineteen phases of it are written
up in the root README; this is the operational half.

```
ml/
├── evaluation/       the phase harnesses (phase2.py … phase18.py)
├── production/       the only code the API is allowed to call
│   ├── policy.py         seven safety rules, each with a test
│   ├── predictor.py      predict() — the single entry point
│   ├── calibration.py    confidence bands, versioned
│   ├── recalibrate.py    fits new bands from REAL outcomes (offline)
│   ├── source.py         ordered per-battle plays, cached
│   ├── shadow.py         observation log + reconciliation
│   └── frontier.py       the cheap readiness check
└── artifacts/        offline-trained JSON. Production NEVER fits.
```

**Production scores; it does not train.** `policy.forbid_training()` replaces
`fit` with a raise on every loaded model, and the change model ships as a JSON
artifact whose `feature_names` must match at load time — a reordered feature list
silently invalidates every weight, and refusing is the difference between a
degraded read and a confidently wrong one.

### Modes

`CLASH_OIE` — `off` (default) / `shadow` / `on`.

| mode | Coach payload | shadow log | UI |
|---|---|---|---|
| `off` | unchanged | nothing | nothing |
| `shadow` | unchanged | records | nothing |
| `on` | unchanged | records | fetched separately |

**The prediction moment is the request, not a placeholder (2026-09-15,
deployed 2026-09-18).** `predict()` used to build its example with `timestamp="9999"`,
which `features._parse` cannot read, so `log_hours_since_change` and
`log_hours_since_last_play` were 0 on every live read. It now passes the
caller's `cutoff_ts` when given, else `_request_stamp()` — the wall clock **in
UTC**, formatted like `battle_time` (`20260915T120500.000Z`). UTC is
load-bearing: `battle_time` is UTC and the parser ignores the `Z`, so a local
stamp would shift every gap by the host's offset without an error. No weight,
feature order, calibration cut, cap or candidate changed; the recent-deck
primary is identical under any stamp; bands and therefore the number of shown
alternatives do move, and that cost was measured and accepted (Brain Phases 8b,
8c, 10). **Feature 9 is served as 0** (committed `ce85bca`): `features.extract` is
unchanged, and `_change_probability` scores `_served_vector(example)`, a COPY with
`log_hours_since_change` zeroed (`SERVED_AS_ZERO`). Brain Phase 20 RQ3: macro Brier -0.0137
[-0.0186, -0.0089], ROC-AUC -0.0029 [-0.0077, +0.0020] on a later window; offline equivalence
exact on 357,426 + 196,781 reads. `VERSIONS["features"]` is `phase2-21-reqstamp-utc-x9zero`. Tests pin
`_request_stamp` rather than reading the calendar. **Deployed as `ce85bca`
(2026-09-18, R1 dark), and `CLASH_OIE=shadow` since 2026-09-18 21:29 UTC (R3)**,
logging to `shadow-log-r3-ce85bca.jsonl`. `on` is a separate approval.

**The Coach never waits for the engine.** It used to attach the read inline, so
a cold spinning-disk read delayed the whole screen for a purely additive
enhancement. Now `GET /api/analytics/coach/opponent-read/<tag>` is its own
request, and in `shadow` the observation runs on a daemon thread purely to fill
the log.


### The domain is `practice`, and it contains no duels

PHASE 20D. `is_duel_like_mode` admits any mode containing "friendly" because
the bot's DuelEngine reconstructs duels out of practice; `_rows_to_plays` drops
any row that is not exactly 8 distinct cards because a native duel row is a
16/24-card loadout. Both are right. Together they admit practice and discard
every real duel -- of 1,238 native rows in one census, ZERO carry 8 cards.

So the domain formerly called `duel` is `practice`, and every "duel" figure
from Phase 14 onward describes friendly practice. The FROZEN calibration
artifact still keys it `duel`; `calibration.ARTIFACT_DOMAIN` maps one to the
other so stored observations stay attributable to the artifact that produced
them. Do not rewrite the artifact.

### What may be displayed

`policy.BAND_SUPPORTED` decides, per domain, whether a confidence band may be
SERIALISED at all:

* **competitive** -- yes. Its ordering held against real outcomes
  (68.2% > 55.0% > 0.0%, Phase 19D).
* **practice** -- no. Measured over 11,152 historical steps with full support
  in all three bands, player-macro runs high 65.4% < medium 69.7% > low 53.5%.
  A band that does not rank is decoration. The alternatives are withheld with
  it, because the 2/1/0 cap is justified by the bands meaning something.

`policy.BAND_ACCURACY` and `calibration.expected_accuracy()` are INTERNAL
DIAGNOSTICS. Both are disproved -- competitive `high` claims 90.5% and measured
69.1% -- and neither may reach a response body or a screen. Confidence ships as
a word.

### `opponent-read-v2`

    GET /api/analytics/coach/opponent-read/<tag>
    -> {"enabled": bool, "read": null | {primary, alternatives, note,
                                         degraded, bandShown}}

`enabled` is false in every mode but `on`. `coach.SURFACED_DOMAIN` is
**competitive** on a product decision: practice without a band carries nothing
the Coach does not already show.

Two invariants worth knowing before touching this:

* **`degraded: true` implies `alternatives: []`**, enforced last in
  `predict()` AND again in `as_dict()`. The counting-fallback path used to
  break this and the UI hid it client-side; that stops working the moment a
  second client exists.
* **`changeProbability` is not in the payload.** It is a logistic score, and it
  is the same score measured at ECE 0.2806 competitive / 0.6097 practice.

### Native duels are readable, just not here

`battle_raw.raw_json` carries `team[0].rounds` -- ordered per-game decks with
per-game crowns, for BOTH sides, across ~50,000 native duel payloads. It is
what makes real duel analysis possible and it is what `phase21a.py` reads. The
production engine does NOT read it: `battles` flattens a duel to a 16/24-card
loadout and the 8-card guard drops it. Measured on that substrate, the duel
card-reuse rule is absolute -- 21,432 deck pairs, zero overlap.

### The shadow log, and how it was lost twice

`ml/results/shadow-log.jsonl`. Salted tag hash, domain, history depth, cluster
size, change probability, confidence band, latency, and a deck **hash** — never
card lists, deck contents, player tags or opponent identities. The deck hash is
what makes live accuracy measurable later without ever storing a deck.

1,277 collected observations were destroyed, and the cause was not exotic:

```python
# test_ml_production.py — deleted the PRODUCTION log
if _os.path.exists(shadow.LOG_PATH):
    _os.remove(shadow.LOG_PATH)
```

Running the test suite wiped the experiment. Two other paths could have lost
records silently: rotation used a **fixed `.1` name**, so a second rotation
overwrote its own archive, and the whole write sat inside `except: pass`.

Fixed, smallest mechanism first — `LOG_PATH` is overridable via `CLASH_OIE_LOG`
so a test can never reach production, archives are timestamped and never clobber,
a cross-process lock guards rotation, every record carries a unique `id`, and
`write_stats()` exposes `written / errors / lockFailures / rotateFailures` so a
failure stops being silent. **A failed lock still writes** — losing a record is
worse than an unlocked append.

`test_shadow_durability.py` covers concurrent threads, four concurrent
*processes*, restart mid-collection, rotation, malformed trailing records, and a
guard that scans every `test_*.py` for anyone deleting the production log again.

### Reconciliation, without raw tags

`verify_log()` reports records, malformed lines, duplicate ids, anchor coverage
and version-stamp count, and marks the log CORRUPT rather than letting it
through. `checkpoint()` refuses a population conclusion on **integrity failure**,
**mixed version stamps**, or **fewer than 100 players with outcomes per domain**.

The log holds only salted hashes and cannot reverse them, so
`reconcile_from_tags(tags, load_plays)` takes the tag list the caller already
has, recomputes `H(salt, tag)` in-process, and never writes a raw tag anywhere.
A wrong tag list reconciles *nothing* rather than reconciling wrongly.

Three populations are reported separately because they diverge — waiting for
every observed player to produce an outcome waits on inactive accounts forever:

```
players observed | resolvable | with outcomes | reconciled predictions
```

### Shadow schema 2: the three clocks (R3 measurement, 2026-09-18 UTC)

A schema-1 record could not be scored against "what they bring next from the
request": it did not hold the stamp the model used, when the rows behind it were
read, or whether the player was tracked, and `outcomes_from_history` keys on
`(player, ts)`, which **collides for two observations in one second — 110 of the
2,620 records in the phase2-21 log**. Schema 2 adds, on every record, `schema: 2`
and:

| field | what it is |
|---|---|
| `requestedAt` | request clock, taken before the read |
| `visibleAsOf` | when the database RETURNED the rows. A cache hit or probe-extended lease keeps the ORIGINAL read's time — that is when the visible set was fixed |
| `readPath` | `miss` / `hit` / `probe` / `uncached` |
| `latestVisibleBattle`, `visibleRows` | newest battle_time among all rows read, and how many |
| `requestStamp` | the exact `timestamp` the model scored (x10's "now"); `""` if it fell back before scoring |
| `tracked` | `True` / `False` / `None` — `None` is a failed lookup, never "untracked" (`source.tracked_state`, not `tracking.bot_tracked`, which says False on failure) |

The hooks are thread-local (`source.last_read()`, `predictor.last_stamp()`)
because the observer runs one daemon thread per request; nothing in the engine
reads them back. `shadow._measurement` whitelists and shape-checks every field,
so no caller can route a raw tag into the log. `VERSIONS` did NOT move: the
prediction is byte-identical, only the record grew.

`outcomes_v2(entries, plays_by_key, observed_until, target)` joins on the record
`id`, gives EVERY record one status (`scored`, `censored`, `malformed_outcome`,
`ambiguous_outcome` — one instant, two different decks — `unresolvable`,
`missing_fields`, `order_violation`, `ambiguous_id`), and takes a
required data horizon so "not yet" is never scored as wrong. **T1** is the first
battle after `requestStamp`; **T2** the first after `anchorTs` (schema 1's target,
which can land before the request when the read was stale — `t2BeforeRequest`).
A schema-2 record must satisfy `anchorTs <= latestVisibleBattle <= visibleAsOf
<= requestStamp` and `requestedAt <= requestStamp`, or it is excluded. Schema-1
records still flow through every existing function unchanged; T1 refuses them.
`reconcile_v2` adds the status census and `playersScored` against the same
100-player gate. The contract is `brain-evidence/r3_measurement/MEASUREMENT_CONTRACT.md`;
`test_ml_shadow_measurement.py` (14 tests) pins it, and every mutation in
`brain-evidence/r3_measurement/mutation_tests.py` fails the suite.

### The labelled sampler (R3, schema 3)

Organic Coach traffic is ~0.5 new subjects a day, so the preregistered sampler
(`brain-evidence/r3_sampler_design/PREREGISTRATION.md`) makes shadow-only
predictions for a seeded random 520 of `tracked_players`, 4 moments each over 7
days, through the SAME `predictor.predict_for_tag` the Coach observer calls.
`ml/production/sampler.py`, run by `deploy/royalweb-sampler.{service,timer}`
(oneshot every 5 min, nice 19, idle IO, no retries).

- **Its own log**, `ml/results/shadow-log-sampler-<cohort>.jsonl`, set before
  `shadow` is imported; every record `origin: "sampler"`, schema 3. The Coach
  path now writes `origin: "coach"`. Schema 1/2 records have no `origin` and all
  predate the sampler.
- **The paired baseline is one extra `model.predict`** on a copy of the served
  vector with x10 also zeroed — exactly the `"9999"` engine (x9 = x10 = 0).
  `predictor.last_served()` hands the copy over; `measurement_extra` lets the
  sampler add fields after the prediction is final, and may never overwrite the
  measured clocks.
- **Every record carries `horizonUntil`** (request stamp + 7 d); `outcomes_v2`
  censors beyond it, and `max_after_s` gives the 24 h sensitivity.
- **It cannot write the database, enrol anyone or answer anyone**: `mode=ro`
  connections only, no `tracking` import, no socket, no route.
- **Every preregistered stop condition** writes `<cohort>.STOPPED` and disables
  the timer; nothing restarts it. Kill switch `CLASH_OIE_SAMPLER=on|off` in the
  unit.
- `test_ml_sampler.py` (53 tests) pins it; mutation tests in
  `brain-evidence/r3_sampler_run/`.
- **Amendment 1 (approved 2026-09-19) replaced one broken MECHANISM, nothing
  else.** P12 checked "database writes by the sampler" with `PRAGMA
  data_version`, which moves only for OTHER connections' commits and never for
  a connection's own: it could not see a sampler write, and during a bot poll it
  moved 172 times in 180 s. The rule is now enforced by `mode=ro` plus
  `total_changes == 0` on every sampler-owned connection (any non-zero = stop);
  `data_version` is logged per tick as `dataVersionMoved`, information only.
  The gate, population, randomization and outcome are untouched.

### What the checkpoint reports, and why each column is there

`checkpoint_report()` prints, per domain: population (observed / resolvable /
with outcomes / reconciled), latency percentiles, degraded rate with reasons,
**score calibration (Brier, ECE, a reliability curve by bin)**, and then per
band its share, **outcome count**, pooled accuracy, player-macro accuracy and the
shipped 17A claim.

Two of those columns exist because of specific mistakes:

**Outcome count is not observation count.** Competitive `high` fires on 94.9% of
reads but rested on 179 real outcomes; `low` fired on 0.4% and rested on **one**.
Only the second number licenses an accuracy claim, and a report showing share
alone invites quoting a band built on a coin flip.

**Score calibration is separate from the bands.** Band cuts decide which label a
prediction gets; they cannot change whether the underlying score is honest. On
the first real sample the score claimed 96.7% in the bin holding 162 of 167
predictions and delivered 71.6% — **ECE 0.247**. No choice of thresholds repairs
that, so the report shows it separately rather than letting a monotonic band
table imply the model is calibrated.

The metrics skip rows without a numeric score rather than raising. A checkpoint
exists to survive bad data and say so.

### Ripeness before reconciliation

Reconciliation is expensive — it loads full history per player, ~15 minutes on a
spinning volume. Most of the time it is not worth running, because the answer is
gated on how many anchors have RIPENED, and that is answerable far more cheaply.

A ripeness check asks only "what is this player's newest battle per mode",
one batched `MAX(battle_time)` query per 60 tags. ~5 minutes against ~15, and it
does not score anything — it only says whether the expensive run is worth doing.

**The tag list matters.** Ripeness resolves hashed players by recomputing
`H(salt, tag)` over a supplied tag list, so a wave of players collected under a
new tag file is invisible until that file is included. Wave 2 initially reported
zero ripened anchors for 1,084 real players purely because the checker had not
been told about `tags_wave2.json`.

**What it measured, and why it settles an argument.** The original duel cohort
ripened at 0.11/hour after four days; wave 2, selected on RECENT duel activity
rather than lifetime volume, ripened at roughly 13/hour. The earlier stall was
never that outcomes are rare — those particular players had simply stopped
duelling.

### `frontier.py` — why row count is the wrong signal

An outcome is a battle **strictly later** than a prediction's anchor. Between two
checkpoint runs the database grew by **43,698 rows and produced zero outcomes**,
because those rows were historical backfill: the count climbed while
`MAX(battle_time)` stood still.

So readiness is one indexed lookup:

```sql
SELECT MAX(battle_time) FROM battles;
```

~70 ms, against ~12 minutes for a full reconciliation. Poll it; reconcile only
when it moves past the freeze point.

An earlier version compared the frontier against the newest *anchor* and returned
READY when reconciliation had just found zero — the newest anchor belongs to one
player and the global frontier to another, so the comparison was already true at
freeze time. The baseline is the frontier **as it stood when the observations
were frozen**.

### Running the bot and the site together

The bot writes `battles.db`; this service reads it. They coexist fine for normal
use — the WAL only becomes a problem when overlapping readers leave no gap for a
TRUNCATE checkpoint (see below), and casual browsing does not do that. A bulk
collection run does.

The ideal configuration while an experiment is ripening is **bot only**: stop
the API, let the bot own the file, and its checkpoints fold cleanly. Confirm
with:

```powershell
try { $f=[IO.File]::Open('H:\ClashBot\data\battles.db','Open','ReadWrite','None'); $f.Close(); 'FREE' } catch { 'HELD' }
```

`HELD` while the bot is running is correct and expected — it is the writer. It
is only a problem when something else is holding it and the WAL is climbing.

## The WAL deadlock

`battles.db` is WAL, and a WAL cannot be reset while any reader holds a snapshot.
This service opens read-only, short-lived connections and closes every one of
them — 28 call sites, all in `finally` blocks — but under load those connections
**overlap**, so there is never a gap, and `PRAGMA wal_checkpoint(TRUNCATE)` folds
nothing however often the bot retries. The WAL reached **5.66 GB**, at which point
every query on both projects crawls.

The fix is not fewer connections. It is a scheduled gap:

```
H:\ClashBot\data\.maintenance
```

While that file exists, `resolve_db_path()` returns `None` and every screen
reports "no database" — a path this codebase already handles everywhere, because
an unplugged H: does exactly the same thing. The bot creates it, checkpoints, and
deletes it. No restart on either side.

**Do not point this service at `archive.db` to dodge the problem.** Measured:
the archive ends `20260818T184047Z` against the live database's
`20260820T154231Z` and holds 5,744,095 rows against 6,164,558. It starts earlier,
which is where "more history" comes from, but it is **two days stale** — the
site would show nothing recent and the OIE experiment, whose anchors are by
definition the newest battles, would break entirely.

