# Dekkies

*(formerly Royal Arena — see the note on the name below)*

A Clash Royale companion: deck-building tools plus a player analytics suite
driven by a local battle database of ~3.8 million battles.

Three deck tools (a duel builder, a deck collection, archetype folders) and seven
analytics screens — a global meta board, per-player deck trends, duel card
combinations, a duel series log with a next-deck prediction, a per-card use/win
board, a matchup engine for what beats what, and a mid-duel coach that predicts
the opponent's next deck and ranks yours against it. The duel logic is a port of
a Discord bot's, not a rewrite.

Vite + React 18 + TypeScript, CSS Modules, zustand, hash routing (no router
library). The analytics half is served by a small Python API reading the Discord
bot's SQLite files read-only.

> **Status: shipped.** Production is **[deckkies.com](https://deckkies.com)**,
> deployed by Vercel from `main`, which now tracks `revamp`. The old
> `royal-duels.vercel.app` deployment and its `6ab701d` build are history.
>
> **The analytics half works in production now**, which it did not for most of
> this project's life. `server/app.py` and the battle database run on a Contabo
> VPS behind Caddy at `api.deckkies.com`; the browser talks to that directly for
> shareable analytics and through a same-origin Vercel function for the Coach's
> opponent read. See [The move off the home machine](#the-move-off-the-home-machine).
> A local checkout without `server/app.py` running still shows "Analytics
> service is not running", which remains the intended message rather than a crash.
>
> **Accounts are real.** Sign-up, sign-in, a three-day trial, per-feature gating,
> one desktop and one mobile per account, and an admin console — on Supabase,
> with Row Level Security. The twenty-account SHA-256 test gate is **deleted** —
> store, bundled hashes, generator, login screen and the last consumer (the
> Coach's proxy) all gone.
> See [Accounts, tiers and the gate](#accounts-tiers-and-the-gate).
>
> **The rename is finished, with two keys left behind on purpose.** The shell,
> the landing page, the sign-in card, the browser tab and the PDF export all
> wear **DECKKIES**, matching the domain. What still says `royal-` is the
> persistence keys (`royal-duels-builder`, `royal-duels-theme`, `royal-rail`),
> and `dekkies-device-id` keeps its old spelling for the same reason: renaming
> a storage key orphans what it addresses — every saved deck in every browser,
> or every registered device — unless a migration reads the old key first.

---

---

## Status — 2026-08-26

| | |
|---|---|
| deck tools + analytics screens | shipped |
| Export PDF (print-exact, every section) | shipped |
| Opponent Intelligence Engine | **research CLOSED, model FROZEN**, flagged off (`CLASH_OIE=off`) |
| OIE reconciliation (19D) | **done** — 364 competitive / 151 practice predictions scored against real later battles |
| Phases 20A–21A | **all four branches closed on measurements**, not on effort |
| Phase 22 | final production specification, frozen and tested |
| Phases 23 / 23B | hardened; **browser-verified in all three modes** (off 14/14, shadow 14/14, on 19/19) |
| Phase 24A | local ON soak **PASS** — 80 tags, 0 invariant violations |
| Phase 24B | hosting plan written; deployment **blocked on auth**, not on the model |
| Phase 24C | boundary built: API authenticated, same-origin Vercel proxy, tunnel hop **verified for real** |
| UI | WebGL fireflies behind the whole shell in **both themes**, wearing the open area's hue; the painted login backdrop — see `docs/UI.md` |
| UI — motion pass | **shipped and browser-verified.** The deck column's aura + placement burst + completion sweep, a card ring on the empty paste screens. One canvas per screen plus the backdrop; three.js chunk unchanged |
| UI — top dock | **shipped, 33/33 browser checks.** The top nav is a proximity dock: items expand downward on a spring toward the pointer, and answer keyboard focus with the same field |
| UI — filmstrip | **shipped on the landing screen's seven analytics areas and the Counter Hub folder gallery, 10/10 browser checks.** **Not applied to the meta board or the saved decks** — both would remove function; see the section |
| UI — text contrast | **shipped, swept in a browser.** Every neutral font is now pure white on dark and pure black on light. Coloured ink untouched. 10 screen/theme sweeps report no grey text left |
| UI — theme switch | **shipped, 16/16 browser checks.** Five separate theme buttons became one skeuomorphic toggle: a recessed groove, a raised cap that slides, and `role="switch"` semantics they never had |
| UI — circular buttons | **shipped, verified in a browser.** The 14 circular icon controls take a travelling chromatic rim and a press ripple, adapted from ThreeUI's liquid-metal button. One shared canvas, idle until you touch it |
| UI — primary buttons | **shipped, 14/14 browser checks.** The twelve rectangular solid CTAs share one treatment: a masked gradient edge and a sheen that sweeps on hover, both mixed from `--on-solid` so the file names no colour |
| UI — loading states | **shipped, 23/23 then 16/16 browser checks.** The WebGL card fan is **deleted**; all 12 slow loads now show a measured progress rig that paces itself from how long the screen actually took before |
| accounts | **shipped.** Supabase auth, three-day trial, per-feature gate, onboarding form, one desktop + one mobile per account |
| admin console | **shipped** at `#/admin` — every account and tier, role changes, end-trial, deployment health, storage capacity |
| hosting | **the analytics service left the home machine.** `battles.db`, `server/app.py` and the bot all run on a Contabo VPS behind Caddy at `api.deckkies.com` |
| domain | **`deckkies.com` live**, Vercel apex + `www`, `api.` pointing at the VPS |
| deck sync | **re-keyed to the Supabase user id.** A cross-account leak on shared browsers was found and closed |
| card reference data | **was missing on the VPS and failing silently**, which emptied Win Conditions and Spells, blanked the Cards board and made every Deck Counter row generic. Deployed, and the failure is now reportable: stderr, `/status` `cardData`, and a console tile |
| Duel Analysis | **widens to non-duel battles** when the duel population cannot clear the 8-game floor, stamped `basis: "all"` and with the G1/G2/G3 split withheld rather than zeroed |
| Deck Counter | **draws the deck each player actually faces**, not the archetype's global representative. Three sightings before a list is named; `typical` otherwise |
| retention | **304 days (10 months)**, set 2026-08-26. Projects to ~105 GB at steady state for the 3,278 tracked players |
| H: | **unplugged 2026-08-26**, contents intact. Local collection stopped, both scheduled tasks disabled. It is the only rollback and holds 1 May – 1 Jun, which exists nowhere else |
| tests | **1,260 Python checks** across **35 suites** (504 check-style + 756 unittest), **221 vitest**, `tsc -b` and `npm run build` clean |
| shipped from | `main` at `6bedee0`. `/api/health` reports the deployed commit, so "did it land" has an answer rather than a guess about caching |

**The engine's conclusion is a small one, and that is the result.** Recent is
the prediction; the model layer may add a confidence *word* and a short list of
historical alternatives, and may never replace it. Four separate attempts to
make a bigger claim — exact next-deck retrieval, novel-deck generation,
matchup-response, spell-conditioning — were each measured and each closed.

**Two published numbers are now known to be wrong and are no longer displayed
anywhere.** Competitive `high` claimed 90.5% and measured **69.1%**; the
practice bands do not even ORDER correctly (macro high 65.4% < medium 69.7%).
Confidence therefore ships as High/Medium/Low with no percentage attached, and
the practice domain ships no band at all.

**The domain called `duel` for twenty phases contained no duels.** It is now
`practice`. See [The domain that was never duels](#the-domain-that-was-never-duels).

See [The Opponent Intelligence Engine](#the-opponent-intelligence-engine) and
[Closing the engine: phases 20B–24B](#closing-the-engine-phases-20b24b).

**Three operational notes before running anything:**

- The website and the bot share `battles.db`, and they now share it on the VPS
  rather than on H:. Overlapping readers stop the bot folding its WAL — it
  reached **5.66 GB** once. Drop `/var/clashbot/.maintenance` to make the site
  let go, and delete it afterwards.
- Do **not** repoint the site at `archive.db` to dodge that. It is two days
  stale and would break the OIE experiment outright. There is no archive tier on
  the VPS at all — `CLASH_ARCHIVE_DB_PATH` is set explicitly empty there.
- **H: is shelved, not retired (2026-08-26).** The drive was unplugged with its
  contents intact once the VPS took over: the two local scheduled tasks
  (`ClashBot`, which triggers at LOGON, and `ClashBot-Maintenance`, daily at
  04:00) are **disabled**, and the local `server/app.py` stopped. Disabled
  rather than deleted — re-enabling them is the first move in a rollback.
  `archive.db` and the untouched source `battles.db` are still the only way back
  if the VPS copy turns out wrong, and they hold the **1 May – 1 Jun window that
  exists in no other place** (archive spans 2026-05-01 → 2026-08-25; the VPS hot
  tier starts 2026-06-01). Do not wipe or reuse that drive.

## Table of contents

1. [Running it](#running-it)
2. [What the app is now](#what-the-app-is-now)
3. [Accounts, tiers and the gate](#accounts-tiers-and-the-gate)
4. [The admin console](#the-admin-console)
5. [Where the data comes from](#where-the-data-comes-from)
6. [The analytics API](#the-analytics-api)
7. [Reaching the analytics API from the hosted site](#reaching-the-analytics-api-from-the-hosted-site)
8. [The tunnel, and what was actually proved](#the-tunnel-and-what-was-actually-proved)
9. [The move off the home machine](#the-move-off-the-home-machine)
10. [Top Meta Decks — why it is a snapshot](#top-meta-decks--why-it-is-a-snapshot)
11. [Deck rendering: the three special slots](#deck-rendering-the-three-special-slots)
12. [Duel combinations — the logic and why it looks like that](#duel-combinations--the-logic-and-why-it-looks-like-that)
13. [Duel Zone — the series log and the deck sequence](#duel-zone--the-series-log-and-the-deck-sequence)
14. [Cards — one player's whole card pool](#cards--one-players-whole-card-pool)
15. [Deck Counter — what beats what](#deck-counter--what-beats-what)
16. [Coach Assist — mid-duel help](#coach-assist--mid-duel-help)
17. [Colour: how it was chosen](#colour-how-it-was-chosen)
18. [The UI pass — surfaces, selection and navigation](#the-ui-pass--surfaces-selection-and-navigation)
19. [The display face, and the one property that decides it](#the-display-face-and-the-one-property-that-decides-it)
20. ["Why is Evolutions 0?" — two emptinesses that shared a sentence](#why-is-evolutions-0--two-emptinesses-that-shared-a-sentence)
21. [Duel Analysis, on the Dekkies light system](#duel-analysis-on-the-dekkies-light-system)
22. [The Dekkies redesign — shell first](#the-dekkies-redesign--shell-first)
23. [The deck builder — two columns instead of a drawer](#the-deck-builder--two-columns-instead-of-a-drawer)
24. [The home screen — three real areas, three behind a gate](#the-home-screen--three-real-areas-three-behind-a-gate)
25. [The landing screen, rebuilt](#the-landing-screen-rebuilt)
26. [Tracking a new tag, and the live battlelog](#tracking-a-new-tag-and-the-live-battlelog)
27. [Duel Insights](#duel-insights)
28. [Every deck can be copied and opened in the game](#every-deck-can-be-copied-and-opened-in-the-game)
29. [Exporting a screen as a PDF](#exporting-a-screen-as-a-pdf)
30. [The Opponent Intelligence Engine](#the-opponent-intelligence-engine)
31. [The revamp, in order, with the reasoning](#the-revamp-in-order-with-the-reasoning)
32. [The WebGL layer](#the-webgl-layer)
33. [The top navigation dock](#the-top-navigation-dock)
34. [The primary buttons](#the-primary-buttons)
35. [The theme switch](#the-theme-switch)
36. [The filmstrip](#the-filmstrip)
37. [Things that went wrong and what fixed them](#things-that-went-wrong-and-what-fixed-them)
38. [Testing and verification](#testing-and-verification)
39. [Recent Battles — the raw log](#recent-battles--the-raw-log)
40. [Saving a duel you actually played](#saving-a-duel-you-actually-played)
41. [Two filters and a heading](#two-filters-and-a-heading)
42. [DEKKIES is DECKKIES](#dekkies-is-deckkies)
43. [Project layout](#project-layout)
44. [Deliberately not done](#deliberately-not-done)

---

## Running it

Two processes. The site works without the second one — the analytics screens
show "Analytics service is not running", which is the intended message rather
than a crash — but nothing on those screens will have data.

```bash
npm install
npm run dev              # Vite. Usually :5173; it moves to :5174 if that is taken.
python server/app.py     # the analytics API on :8787. No pip install needed.
```

Vite proxies `/api/analytics/*` to `127.0.0.1:8787` (see `vite.config.ts`), so
the browser only ever talks to its own origin.

```bash
npx tsc -b                        # typecheck
npm run test                      # 239 tests over the deck, duel, export and admin logic
python server/test_duel_combos.py # 39 checks over the duel logic, no DB needed
python server/test_meta.py        # 33 checks over the meta board and card rules
python server/test_card_art.py    # 110 checks over deck arrangement and card art
python server/test_duel_zone.py   # 88 checks over the series and sequence rules
python server/test_player_cards.py # 60 checks over the card board
python server/test_deck_counter.py # 58 checks over the matchup engine
python server/test_coach.py       # 69 checks over the Coach Assist rules
python server/test_live_player.py # 23 checks over the live battlelog reader
python server/test_ml_22_final.py # 66 checks over the FROZEN production contract
python server/test_ml_20d.py      # 27 checks that `practice` excludes real duels
python server/test_ml_21a.py      # 32 checks over the spell feasibility harness
npm run lint
npm run build                     # what Vercel would run
npm run update:cards              # refresh src/data/cards.json from RoyaleAPI
```

### Environment

None of these are required to run the app. Without them it still builds and
mounts — the analytics screens say the service is not running, and with no
Supabase configured the gate opens everything rather than locking a local
checkout out of five screens.

**In `.env.local`, read by the browser.** Both are public by design and both
ship inside the bundle:

| Variable | What it is |
|---|---|
| `VITE_SUPABASE_URL` | the project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the anon/publishable key |
| `VITE_ANALYTICS_BASE` | where the analytics API lives, if not the Vite proxy |

**In Vercel only, never with a `VITE_` prefix.** Vite inlines any `VITE_`
variable into the browser bundle at build time, so **the naming convention is
the security boundary** — renaming one of these to `VITE_*` publishes it:

| Variable | What it is |
|---|---|
| `ANALYTICS_ORIGIN` | `https://api.deckkies.com` |
| `CLASH_API_KEY` | what the Vercel proxy presents to that origin |
| `OIE_ALLOWLIST` | who gets the Coach's opponent read. Empty means nobody |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash, for deck sync |
| `SUPABASE_URL` | used server-side to fetch the JWKS that verifies tokens |

**On the VPS**, in `/etc/royalweb.env` — see the runbook.

`GET /api/health` reports which of these a deployment can actually reach, as
booleans and never as values. It exists because "the JWT check is wrong" and
"the function cannot see its configuration" are indistinguishable from outside,
and one boolean settles it.

**Database setup** is one file: run `supabase/001_accounts.sql` in the Supabase
SQL editor. It is idempotent, so re-running it after an edit is safe.

**Note on the dev server host.** Vite binds IPv6 loopback here, so it answers on
`http://localhost:5174` but *not* on `http://127.0.0.1:5174`. Scripts that hard-code
the IPv4 address get `ERR_CONNECTION_REFUSED` and look like the server is down.

**Note on stale servers.** A dead Vite can leave port 5173 held, so a new one
silently moves to 5174 while your browser keeps loading the old bundle from
5173. If a change "doesn't appear", check which port you are actually on:

```bash
netstat -ano | grep LISTENING | grep -E ":517[0-9]|:8787"
```

---

## What the app is now

Everything lives inside one dashboard shell (top bar, content panel, and a left
sidebar on every screen **except the landing one**). The hash drives what is
open, so links and refreshes work.

| Route | Screen |
|---|---|
| `#/` | Landing — hero search, analytics blocks, tool panels. No sidebar. |
| `#/builder` | Duel deck builder (5 decks × 8 slots, cards unique across the set) |
| `#/decks` | Deck's Home — unlimited auto-saving single decks |
| `#/palette` | Counter Palette — archetype folders of counter decks |
| `#/player/<tag>` | Player analysis — top decks, use/win trends |
| `#/player/<tag>/meta` | **Top Meta Decks** — the global leaderboard (needs no tag) |
| `#/player/<tag>/duels` | **Duel Analysis** — card combinations in duel play |
| `#/player/<tag>/duelzone` | **Duel Zone** — the Bo3/Bo5 series log and the deck sequence |
| `#/player/<tag>/cards` | **Cards** — use rate and win rate for all 122 cards |
| `#/player/<tag>/counter` | **Deck Counter** — player counter, deck vs deck, find counters |
| `#/player/<tag>/coach` | **Coach Assist** — duel prediction and the next-deck suggestion |
| `#/player/<tag>/<slug>` | Deck Analysis (a shell, no data yet) |
| `#/signin` | Sign in / sign up, then the three-step onboarding form |
| `#/admin` | The admin console. Not linked from anywhere a non-admin sees |

The analytics areas are **Search Player · Top Meta Decks · Deck Analysis · Duel
Analysis · Duel Zone · Cards · Deck Counter · Coach Assist**, each with its own
identity hue. The open row takes a violet tint and a 3px bar — violet is
"selected" regardless of the row's identity hue, which stays on its icon tile.
Win Conditions, Champions and Evolutions used to sit there too and are now tabs
on the Cards screen — they were never separate screens, only ways of looking at
one card list.

**They appear in two forms, and only one of them at a time.** On the landing
screen they are a grid of painted blocks under the search; everywhere else they
are the sidebar. A rail of a player's analytics areas, rendered before there is
a player, is navigation to seven screens that all say "search for someone
first" — so the landing screen has no rail at all, and gets the width instead.
Opening an area or loading a tag brings it back. See
[The landing screen, rebuilt](#the-landing-screen-rebuilt).

The brand and the top bar's **Home** both return to the landing screen, from any
screen including a hosted tool and the player view. The top bar also carries a
tag field whose magnifier button opens the analysis for whatever is typed;
⌘K / Ctrl-K focuses it from anywhere. Where the rail does appear it
**collapses** via a chevron on its right edge, which reclaims 226px and spends
it on larger elements rather than more of them; the choice persists, and is
tracked separately from the landing screen's rail-less state so returning from a
tool does not reserve 236px for a sidebar that never renders.

**Top Meta Decks is on the home sidebar only.** It is about the whole player
base rather than the loaded player, so once a tag is open the sidebar lists that
player's own sections and drops it. The `/meta` route still renders, so links
already out there keep working.

The builder tools were previously separate full pages with their own nav bars;
they now render `embedded` inside the dashboard panel, so the chrome stays put
and only the content scrolls.

**Anyone can use the site without an account.** The landing page, Search
Player, Top Meta Decks and Deck Counter are open to everybody; the five deeper
analytics areas are what signing up buys, free for three days. Accounts are real
— Supabase, with Row Level Security — and the twenty-account SHA-256 test gate
that used to stand in front of everything is deleted outright. See
[Accounts, tiers and the gate](#accounts-tiers-and-the-gate).

Deck lists can be **filtered by card**. Pick any cards — win conditions lead the
panel, the full 122 follow — and only decks holding *all* of them stay. On Deck's
Home and the Counter Palette the non-matching rows **collapse** rather than
vanishing, so the list narrows instead of becoming a different list; the duel
builder dims them instead, because its decks are positional and collapsing one
would renumber the rest. See `docs/UI.md`.

---

## Accounts, tiers and the gate

Real accounts, on Supabase. This replaced a client-side gate over twenty fixed
usernames whose SHA-256 hashes were bundled into the JavaScript — fine as a
placeholder, useless the moment anyone could sign themselves up.

Everything below lives in one migration, `supabase/001_accounts.sql`, because a
trial, a Pro badge, an admin console and a device limit are the same thing
wearing four hats: per-user state the browser must not be able to forge.

**The publishable key is public and that is the design.** It ships inside the
JavaScript bundle and anyone can read it out of the network tab. It is only safe
because every table has Row Level Security on with policies keyed to
`auth.uid()`, which comes from a verified JWT and cannot be forged by a client
holding that key. A table with RLS on and no policy denies everything, and each
policy grants the narrowest thing that works. Nothing that IS a secret may ever
be given a `VITE_` prefix — Vite inlines those at build time, so the prefix is
the boundary.

### The site is public and the gate is per-feature

The first build put a sign-in wall in front of the whole app. That was the wrong
reading of the brief and it was corrected: **the landing page is the main page**,
for everybody, signed in or not. Signing in is what happens when someone reaches
for something their tier does not include.

| access | may open |
|---|---|
| `anon` — never signed in | Search Player, Top Meta Decks, Deck Counter |
| `free` — signed up, trial spent | the same three |
| `trial` — first three days | everything **except Coach Assist** |
| `pro` | everything |
| `admin` | everything, plus `#/admin` |

**Coach Assist is the one carve-out from the trial.** A trial is otherwise
"everything, for three days" — but Coach Assist is the deep end (a mid-duel read
of the opponent's next deck, ranked against yours) and it is the reason to
subscribe rather than a sample of what subscribing is like. A trial that
includes it has already given away the thing it exists to sell.
`PRO_ONLY_SECTIONS` holds it, and `isPaid()` is deliberately separate from
`isEntitled()`: a trial HAS the product — the full counter list, the export, no
upgrade nag — without having PAID, and only the carve-out cares about the
difference.

**Two pieces of copy became lies the moment this rule existed, and both were
fixed with it.** The rail told a trial "everything unlocked"; the gate card told
a signed-out visitor that an account opens "{section} — and every other area —
for three days", which for Coach Assist is a promise the product breaks the
moment they take it. A promise the product breaks is worse than a smaller one it
keeps.

`anon` and `free` get the **same** sections deliberately. A lapsed account keeps
"meta and Evo counter"; a visitor who has not signed up has no claim to more
than that, and giving them less would mean the public page is not really public.

**Search Player is free, and that is a judgement rather than a reading of the
brief.** It is the tag overview behind the hero's search field — the landing
page's entire call to action. Gating it would mean a stranger types their tag
into the biggest control on a public page and is handed a paywall, which makes
the search a tease rather than a demonstration. The five deeper areas (Deck
Analysis, Duel Analysis, Duel Zone, Cards, Coach Assist) are what a trial is for.

A closed section renders a `GateCard`, and it asks the right question: `anon`
sees "make an account, three days free", `free` sees "your three days are up".
Showing a stranger an upgrade prompt reads as the site not knowing who you are.

### Two gates predated the tier system and did not consult it

"Pro and admin unlock everything" was true of the routing gate and false in two
other places, both written before tiers existed:

* **The Deck Counter hid every counter past the third from everyone.**
  `CounterLab` sliced its list at `FREE_ROWS = 3` and wrapped the rest in the
  Royal Pro wall — unconditionally. Deck Counter is a *free* section, so every
  tier reaches that screen, which means a trial, pro or admin account was shown
  a paywall over data it already had. Exactly the fault that took the ProLock
  off the home screen, in a second place.
* **The rail asked paying readers to upgrade.** The "Dekkies Pro — Unlock
  exclusive analytics / Upgrade Now" card sat in the sidebar on every screen,
  for every tier. Pro and admin now get a status line and nothing to buy; a
  trial keeps a CTA, because there genuinely is something to do and the
  countdown is the reason to do it.

Both are now `isEntitled(access)` — **one predicate**, because the alternative
is what shipped: three places each deciding for themselves what "has Pro" means,
and two of them not deciding at all.

### A trial has to expire while you are looking at the page

`tier` is derived from `trial_ends_at`, but it was derived *once*, when the
profile loaded. A tab left open across the expiry kept every paid screen until
someone happened to refresh.

The device heartbeat already runs every 60 seconds and on window focus, so it
recomputes the tier too. That costs nothing and needs no network — the timestamp
is already in hand and `tierOf` is a comparison against the clock — and it only
writes when the answer changes, so it does not re-render the app every minute.

### The rules live in `tiers.ts`, with no imports at all

They were in `supabase.ts`, which constructs a Supabase client at module load.
So importing a pure rule to check it dragged in a client that wants a native
WebSocket, and Node 21 does not have one — meaning **the single thing most worth
testing exhaustively could not be imported by a test**. Same extraction, and the
same reason, as `utils/format.ts`. Both modules re-export, so no call site
changed.

`tests/entitlement.test.ts` is now the whole matrix: every tier against all
eight sections, the export gate, both expiry directions, the exact expiry
instant, and that a paid role outranks the clock (a pro whose old trial lapsed
is still pro — the trial is a grant to a *free* account, not a component of a
paid one). 35 checks.

**The TypeScript and the SQL agree, and that was checked rather than assumed.**
`public.effective_tier()` tests `role in ('pro','admin')` before
`trial_ends_at > now()`, and `tierOf()` tests admin, then pro, then the clock —
same order, same semantics.

**The database is still the only real boundary.** Everything above decides what
to *draw*. `api.deckkies.com` serves the shareable analytics to anyone who
calls it — Caddy injects the key, so there is no per-user check on that hop —
which means the analytics gate is a UI affordance, not access control. What IS
enforced server-side: deck sync (Supabase JWT, keyed on the user id), every
`profiles` write (RLS plus column grants), and the Coach's opponent read
(`OIE_ALLOWLIST`, per account, in a Vercel function).

### The trial expires with nothing running

There is no cron, no scheduled job, no "switch the account" task. `trial_ends_at`
is a timestamp and the tier is **derived from it every time it is asked for**:

```sql
when p.role in ('pro','admin') then p.role
when p.trial_ends_at > now()   then 'trial'
else 'free'
```

So it expires exactly on time whether or not anything is awake to notice, and
there is no window in which a job has not run yet and someone still has Pro. The
same function answers for the app, for the policies, and for the admin console,
so "is this person Pro" cannot get three different answers.

`tierOf()` in `src/state/supabase.ts` mirrors it in TypeScript. That copy only
decides what to *draw* — a client that lies to itself about its tier gets a
nicer-looking screen and no extra access, because the data is guarded by the
database's copy.

### One desktop and one mobile, enforced by a primary key

```sql
primary key (user_id, kind)   -- kind in ('desktop','mobile')
```

That constraint *is* the whole enforcement. There is no "how many devices are
signed in" query and no counting, because **counting races** — two simultaneous
logins can both read "one device" and both insert. A second desktop login
upserts onto the same row with a new `device_id`; the previously signed-in
desktop discovers on its next heartbeat that the stored id is no longer its own
and signs itself out. No cron, no reaper.

The heartbeat is 60 seconds plus a `focus` listener, so the common case —
someone comes back to a tab — is checked immediately rather than up to a minute
later. A network failure during that check must **not** sign anyone out: an
offline moment is not an eviction, and treating it as one would throw people out
of their own account on a flaky connection.

Desktop versus mobile is decided by `pointer: coarse` or a 900px width. Coarse
on purpose — a tablet counting as "mobile" is a judgement call, not a bug.

The device id is a `crypto.randomUUID()` in `localStorage`, not a fingerprint.
It survives a refresh, it is per-browser-profile, and clearing site data resets
it, which is the honest behaviour. Fingerprinting would be harder to shake off
and is not something to build into a deck site.

### Three flaws found in this work, each by checking rather than assuming

**Any signed-in user could make themselves an admin.** The RLS policy said "you
may update your own row", and `role` is a column *on* that row — so one `PATCH`
against the public REST endpoint, with a real account's own token, set
`role: 'admin'` and it stuck. This was not a theory; it was tried against this
project and it worked.

The lesson is precise, and it is the one thing to take from this section:
**RLS decides which ROWS may be written. Only a column grant decides which
COLUMNS.**

```sql
revoke update on public.profiles from authenticated;
grant update (display_name, country, player_tag, onboarded_at, updated_at)
  on public.profiles to authenticated;
```

Leaving `role` out of the client's `saveProfile()` is **not** a fix, and the
comment claiming it was is worse than no comment at all — it stops *our* code
from doing it while the endpoint stays open to anyone with a token and a
terminal. `role` and `trial_ends_at` now move only through `admin_set_role()`
and `admin_end_trial()`, which check the caller.

**Supabase's defaults had granted `authenticated` TRUNCATE.** TRUNCATE bypasses
RLS entirely — policies are row filters, and TRUNCATE does not visit rows. Any
signed-in user could have emptied `profiles`. Revoked.

**Deck sync leaked decks between accounts on a shared browser.** Server-side the
isolation was already right: `/api/decks` keys on the Supabase user id taken
from a verified JWT, so no account can name another's storage. Locally it was
not. `royal-duels-builder` is a zustand persist key — per *browser*, and it
survived sign-out:

1. A signs in; decks live in `localStorage`
2. A signs out — the decks stay
3. B signs up on the same browser and sees A's decks
4. B has no remote data, so the "first sync ever" branch pushed what was on
   screen — A's decks — into **B's** cloud storage

Step 4 is a leak that then persists, and it is exactly what a second person
signing up on one laptop triggers. Persisted state is now stamped with its
owning user id and reset on sign-in if it belongs to someone else — **before**
the remote pull, not after. The pull is a round trip, and for that whole window
the previous account's decks would be on screen and editable, and an edit during
it would be pushed to the new account.

### Two more that were not security, just broken

**Logout did nothing.** The profile menu cleared the retired `authStore` while
the session lived in `accountStore`. The sweep that followed found something
worse alongside it: the PDF export gate keyed on the old store's username, so
`canExportDecks` had silently become **nobody** — a feature that had stopped
working for everyone, with no error anywhere.

**`FUNCTION_INVOCATION_FAILED` on every deck sync.** `package.json` is
`"type": "module"`, so Vercel runs the functions as ESM, and **Node ESM does not
resolve extensionless relative imports**. `import { callerFrom } from './_auth'`
typechecks perfectly — `tsconfig.api.json` uses `moduleResolution: "Bundler"` —
and then fails at module load, uncatchably. The auth helper is inlined into
`api/decks.ts` instead. Same class of trap as the JSON-import one already
recorded here.

Debugging it wasted time twice on my own bad theories: the old deployment's 401
body was word-for-word identical to the new code's, so the error said nothing
about which code was running, and I blamed a missing environment variable.
`api/health` — names and booleans, never a value — disproved that in one request
and now exists permanently for exactly that reason.

### Why a password hash was the wrong credential anyway

The retired scheme sent `sha256(username:password)` as a bearer token. Beyond
not scaling past a hardcoded list, a password derivative used as a credential
**never expires and cannot be revoked** — changing it means changing the
password. Supabase tokens are verified locally in the Vercel function with
`jose`, against the JWKS fetched once per warm container and re-fetched only
when a token arrives bearing an unseen `kid`. That is what lets Supabase rotate
signing keys without a redeploy here.

### What is deliberately not built

- **No password is ever created by an admin.** Handing out passwords means
  storing one somewhere it can be read back. People sign themselves up and get
  promoted. The brief asked for admin-created accounts; the honest version needs
  a service-role key held server-side, and it is still open.
- **No presence.** "Users currently online" is not knowable here: there is no
  socket, and a JWT is valid for an hour whether or not its owner is looking at
  the page. Last sign-in and device slots held *are* knowable, so those are what
  the console shows, labelled as what they are rather than dressed up as
  presence.
- **No email confirmation, yet.** Switched off so sign-up works without an SMTP
  provider. It must go back on before real users.
- **Google sign-in is built but hidden.** The button appears when the provider is
  enabled in Supabase; the PKCE flow and hash-callback handling are already in
  place, because the app routes on the hash and so does OAuth's callback.

---

## The admin console

`#/admin`. One screen, because "what is going on" is one question and splitting
it into three would mean checking three places to answer it.

| block | what it answers |
|---|---|
| account tiles | how many accounts, on trial, pro, free; signed in today; device slots held |
| health tiles | the deployed commit and region, analytics API latency, and which integrations this deployment can reach |
| storage meter | `battles.db` against the VPS volume |
| accounts table | every account: name, email, tier, country, tag, last sign-in, devices, and a role control |

**Hiding it is a courtesy, not the boundary.** `admin_list_users()` and
`admin_set_role()` are `security definer` functions that check the *caller* is an
admin before doing anything. A free user who typed the route gets an empty table
and "not authorised", which is the correct answer rather than a leak.

The three data sources load with `Promise.allSettled` and none may sink the
others. The accounts table, the deployment's configuration and the VPS's storage
are independent things, and a console that shows nothing because one of them is
down is worse than one that shows two thirds and says so.

**Access and End trial are two controls, and they were one.** "End trial now"
used to be a fourth `<option>` in the role select, disabled unless the account
was mid-trial — which made the control an admin reaches for most the one thing
they could not click. It is also not a role: a lapsed trial user is still
`free`, so putting it in a list of roles meant choosing it had to leave them on
something.

It is a button now, and **always enabled**. Ending a trial that has already
ended is a no-op — `trial_ends_at = now()` twice is the same answer — and
refusing a click to prevent a harmless no-op is what made it feel blocked. On an
account with no trial running it still does something worth having: it stamps
the trial as spent, so a later role change cannot hand them a fresh three days.

It sets `trial_ends_at = now()`, **not null**: null reads as "never had a
trial", which makes the person indistinguishable from a fresh account. The SQL
needed no change for any of this — `admin_end_trial` never had a guard on the
target.

**The role select says `pro — paid`**, and the tiles say what the two tiers
differ on: a trial is "no Coach Assist", Pro is "paid · full access". Since the
carve-out landed those are not the same product, and an admin granting access
has to be able to see which one they are granting.

Changing a role takes effect on that account's next profile read — a sign-in or
a refresh — and the console says so, because a control that looks instant and is
not is a support question waiting to happen.

**`/api/health` reports names and booleans only** — never a value, never a
length, never a prefix. Whether a deployment has an API key configured is not a
secret; the key is. Same distinction that took the paths and sizes out of
`/api/analytics/status`.

### Three layout bugs, all in the same screen, all the same family

Worth recording together because each one rendered the content and then hid it,
which is the failure mode that reads as "the feature was never built".

**The console did not scroll.** `body` is `overflow: hidden` in this project —
the page never scrolls and every route owns its own scroll region. The console
had `min-height: 100vh` inside a `height: 100%` shell, so everything past the
fold was rendered, clipped and unreachable. It needs
`height: 100%; min-height: 0; overflow-y: auto`.

**Then the accounts table was crushed to the height of its own header.** `.wrap`
is a flex column, and a flex child will not shrink below its automatic minimum
size — normally its content, which is why every stat tile above it kept full
height. But **any `overflow` other than `visible` sets that minimum to zero**,
and the table wrapper had `overflow-x: auto`. It was the one child the flexbox
could squash, so it got the ~40px left over and every account went behind an
inner scrollbar too short to grab. `flex: none` on it.

The corollary bit as well: an `overflow` on that wrapper also makes it the
sticky context, so a sticky `<th>` silently stops pinning to the page. Sideways
scroll is now behind a `max-width: 60rem` media query rather than declared
unconditionally — it is wanted on a phone and it costs the sticky header on a
desktop.

**Every trial read "ends just now".** `ago()` computes `now − date`. Fed a
*future* date it goes negative, every threshold below sixty seconds succeeds,
and it answers "just now" — so thirty accounts with three days left all looked
expired. `until()` is a separate function because `ago()` genuinely cannot do
it, and it rounds **up**: three days minus a few microseconds floors to "in 2d",
so a fresh trial would read as two days the instant it started.

The formatters moved out of `adminStore.ts` into `src/utils/format.ts` to be
testable at all — importing the store constructs a Supabase client at module
load, which wants a WebSocket that Node 21 does not have natively, so the test
died on an import it never used. Six tests now pin the "just now" trap.

---

## Where the data comes from

This is the part worth reading carefully, because the data is not in this repo
and never will be — it is 43 GB of someone else's SQLite.

### The two tiers

Mirrors the storage model the Discord bot (`~/Desktop/Clash_Bot`) already uses,
rather than inventing a second one:

| Tier | Default path | Size | Role |
|---|---|---|---|
| Hot | `H:\ClashBot\data\battles.db` | ~11.5 GB | rolling window (150 days), the bot writes here continuously |
| Archive | `H:\ClashArchive\archive.db` | ~46 GB | every battle ever, never pruned |

**Both tiers moved to H: on 2026-08-17.** The hot tier was
`C:\ClashBot\data\battles.db` until then; the bot's retention window went 60 →
150 days, and at ~190,000 battles/day a five-month window is ~28.5M battles —
28–41 GB for `battles` and its indexes alone, against 47 GB free on a C: that
was already 90% full. The reasoning and the performance measurements are in
`Clash_Bot/CLAUDE.md` → *Everything on H: — the 2026-08-17 move*.

At the time of writing the hot tier holds battles spanning 2026-06-01 to
2026-08-17 across 3,277 tracked players; the archive reaches back to 2026-05-01,
which is the earliest anything exists anywhere (the seed source had already been
pruned).

**There is no longer a local fallback.** A `~/Desktop/Clash_Bot/battles-pre-retention.db`
used to catch the case where the C: install was absent. The migration deleted it
along with the old C: database, so the only `.db` left on the internal disk is
the 4 KB schema-less stub that `_has_schema()` exists to reject. H: is a hard
dependency now — the same conclusion the bot reached, which refuses to start
with `THE H: DRIVE IS NOT CONNECTED` rather than let SQLite create an empty
database and run happily against nothing.

### Three properties that are the whole reason `server/clash_data.py` exists

**1. Every path is an environment variable with a local default.** That is the
migration seam. Moving to a cloud VPS means setting these, not editing code.

| Variable | Default |
|---|---|
| `CLASH_DB_PATH` | `H:\ClashBot\data\battles.db` |
| `CLASH_DB_FALLBACK` | Desktop `Clash_Bot/battles-pre-retention.db` (deleted by the migration — set this if you keep a local copy) |
| `CLASH_ARCHIVE_DB_PATH` | `H:\ClashArchive\archive.db` |
| `CLASH_API_HOST` / `CLASH_API_PORT` | `127.0.0.1` / `8787` |
| `CLASH_META_REFRESH` / `CLASH_COUNTER_REFRESH` | `1800` / `3600` seconds between snapshot rebuilds |
| `CLASH_API_URL` | retargets the Vite proxy |
| `VITE_ANALYTICS_BASE` | points a built bundle straight at a remote host |

The browser only ever calls `/api/analytics/*`, so neither the components nor
the client module change when the service moves.

**2. The archive is never assumed present.** `archive_available()` walks up to
the nearest existing ancestor directory and tests it, with a 30-second cache so
an unplug/replug is noticed without a restart. It is also only *opened* when the
requested window reaches further back than the hot tier holds — so normally the
46 GB file is not touched at all.

**The 2026-08-17 move broke half of this, and it is worth stating plainly.** The
original requirement was *"make sure if the harddisk is not connected then it
takes from local desktop and doesn't break"*, and it was satisfiable while the
hot tier lived on C:. Both tiers are on H: now, and the migration deleted the
old C: database and the desktop pre-retention copy, so there is nothing local
left to fall back to.

What survives is the second half: it still does not break. `resolve_db_path()`
returns `None`, the API answers with an explicit "no database", and the screens
show that state rather than raising or 500-ing. What is gone is the first half —
a detached drive now means no data at all, not older data. If the fallback
behaviour is wanted back it needs a real local copy to fall back to;
`deploy/backup_db.py` on the bot side writes a verified one to the internal
disk, and pointing `CLASH_DB_FALLBACK` at it would restore the original
guarantee.

**3. Connections are strictly read-only** (`mode=ro` URI). SQLite itself refuses
writes, so a bug here can never corrupt the bot's data even by mistake. WAL mode
means these reads never block the bot's polling writes either.

### Picking a database file

A candidate must *carry the schema*, not merely exist. The desktop copy ships a
4 KB `battles.db` stub with no tables in it; selecting a file by existence alone
picks that stub and then every query dies on "no such table". `_has_schema()`
checks for `player_stats_agg`, `player_deck_agg` and `battles` before a
candidate counts as usable.

### The live Clash Royale API

`battles.db` stores match history, not profiles, so trophies, best trophies and
arena come from the live CR API. Credentials are read out of the bot's own
`.env` rather than duplicating a 500-character token into this repo. Everything
about it is best-effort: no token, no network, or a rate limit all return `None`
and the screen falls back to stored crowns. Cached five minutes.

---

## The analytics API

Standard library only, on purpose: no pip install, nothing to build, and it
starts on any machine with Python. It serves JSON over HTTP so the browser talks
to it exactly the way it will talk to a hosted API later.

| Route | Returns |
|---|---|
| `GET /api/analytics/status` | which tiers are readable, and their sizes |
| `GET /api/analytics/suggest` | a few real tags with the most stored battles |
| `GET /api/analytics/coverage?tag=` | earliest/latest stored day, globally and per player |
| `GET /api/analytics/player/<tag>` | summary, top decks, per-day trends |
| `GET /api/analytics/duels/<tag>` | card combinations in duel play |
| `GET /api/analytics/duelzone/<tag>` | the duel series log, and the deck sequence |
| `GET /api/analytics/cards/<tag>` | use/win rate per card, and movement against last window |
| `GET /api/analytics/counter/<tag>` | which archetypes beat this player |
| `GET /api/analytics/deck?cards=&wild=` | how one pasted deck draws — slot order + art |
| `GET /api/analytics/matchup?a=&b=` | head-to-head for two pasted decks |
| `GET /api/analytics/counters?deck=` | what beats a pasted deck |
| `GET /api/analytics/meta` | the global meta leaderboard (snapshot) |
| `GET /api/analytics/meta/cards` | global use/win rate per card, split by form |
| `GET /api/analytics/live/<tag>` | the live Clash Royale battlelog, analysed |
| `GET /api/analytics/track/<tag>` | enrol a searched tag; report its collection state |

Every per-player route takes the same window: `?days=N`, or `?from=&to=` as
`YYYY-MM-DD`. `duelzone` also takes `?limit=` (uncapped by default) and `cards`
takes `?mode=all|ranked|duel|tournament`.

**`days` counts back from the last battle stored for that player, not from
today.** A player who stopped playing a month ago would otherwise be handed an
empty screen with no explanation.

Tags are validated against Supercell's 14-symbol alphabet before they reach a
query (the same rule as `clashdb.normalize_tag`), so junk never hits the
database.

### Why the window has to be real

`days=30` was hardcoded at first. The databases hold 102 days, so the screen was
quietly answering a different question from the one on the label. Now:

- coverage is measured per player and the control reads **"30 of 50 days"**, so
  the gap between what you asked for and what exists is visible;
- presets longer than a player's history are still offered but dimmed with a
  tooltip — hiding them just raises *"why can't I pick 60 days?"*;
- the season control maps to a calendar month and actually drives the query;
- "Current Season" is the month of the latest **stored** battle, not today's.

Deck rows are aggregated from `battles` *inside the window* rather than read
from `player_deck_agg`, which is lifetime-only. That is what makes the date
range mean anything: pick a different window and the ranking, the use rates and
the totals all move with it.

---

## Reaching the analytics API from the hosted site

Phase 24C, step 3. The analytics service runs on a machine under a desk, behind
step 2's key. The site runs on Vercel. Something has to join them without
handing the browser a credential, and this is it:

```
browser  ──►  /api/analytics/opponent-read/<tag>   same origin, no key
         ──►  api/analytics/opponent-read/[tag].ts adds X-Analytics-Key
         ──►  ANALYTICS_ORIGIN                     a tunnel, once step 4 exists
         ──►  127.0.0.1 Python                     step 2's boundary
         ──►  SQLite
```

Only the opponent read goes this way so far — it is the one screen the engine
feeds, and the smallest thing that proves the shape works.

**The browser never holds the key, and cannot be made to.** `ANALYTICS_ORIGIN`
and `CLASH_API_KEY` are read with `process.env` inside the function. Neither is
named `VITE_*`, which matters more than it looks: Vite inlines any `VITE_`
variable straight into the bundle at build time, so the naming convention *is*
the boundary. The build is audited for this — see below.

**This is the one analytics call that ignores `VITE_ANALYTICS_BASE`.** Every
other endpoint can be pointed straight at a remote host with it. Honouring it
here would ask the browser to authenticate to the analytics service directly,
and the browser is exactly who must never be able to.

**No arbitrary upstream.** There is no `?url=`, and the browser contributes
exactly one value: the tag. It is validated against Supercell's 14-symbol
alphabet — an allowlist of characters, not an escape — so traversal and query
injection are unrepresentable rather than encoded away. The origin comes from
the environment, the path is a literal, and the assembled URL is re-parsed and
its origin compared before a socket opens. Nothing of the browser's request is
forwarded: not its cookies, not its headers, not a second `X-Analytics-Key` it
tried to supply.

**Who gets it.** The bearer credential is the same `sha256(username:password)`
the deck sync uses; the proxy maps it to one of the 20 accounts and checks
`OIE_ALLOWLIST`. An empty allowlist means **nobody** — an allowlist that
defaults to everyone is not an allowlist. Not being on it is not an error, it
is `enabled: false`, which is what the client already renders as nothing.

**Rate limit: 30 requests a minute per account**, in the Upstash instance the
project already runs for deck sync, falling back to a per-instance map when
Redis is absent or unreachable. Per account rather than per IP because the
account is the thing being rated and the testers may share a network. It sits
under step 2's 120/60 s, so the proxy sheds first and the Python service
survives. Losing Redis degrades the limiter rather than the feature.

**The response is rebuilt, not forwarded.** Every field is copied by name into
a fresh object, so an unknown key cannot survive by accident. On top of that,
two deliberate rules:

* A payload containing `changeProbability`, `weights`, `features`, `path` and
  friends is **refused entirely**. Those keys mean the thing upstream is not the
  engine this was written against — `changeProbability` was removed in Phase 23
  — and the answer to an unrecognised peer is to stop, not to filter it and
  carry on.
* A payload that is well-formed but breaks a *display* invariant — a degraded
  read carrying alternatives, a band on a domain that must not show one — is
  **corrected**. Those invariants exist so nobody is shown something
  unsupported, and stripping achieves that; refusing would turn a cosmetic
  upstream regression into an outage.

Prose fields are scanned for absolute paths, `.db`, and `Traceback` before they
are allowed through.

**Every failure looks the same from outside.** Upstream 401, 429, 500, a
timeout, a refused connection, unparseable JSON, no origin configured, no key
configured — all of it returns `{enabled: false, read: null}` with a 200. The
Coach renders nothing, which is its correct behaviour when the engine is off.
Distinguishing the causes would publish the state of a private service to
anyone with an account.

### The secret audit

`npm run build` with `CLASH_API_KEY`, `ANALYTICS_ORIGIN` and `OIE_ALLOWLIST`
all set, then `dist/` searched for each name and each value. None appear. The
only related string in the bundle is the same-origin path
`/api/analytics/opponent-read/`, which is the point.

`tests/analyticsProxy.test.ts` (43) covers the boundary with a stubbed `fetch`;
`tests/analyticsProxy.e2e.test.ts` (10) runs the whole chain over real sockets
against a fake upstream, because a stubbed `fetch` proves the logic and not
that a real request carries what we think it carries. Between them they assert
the key is attached on the way out and absent on the way back, in both forms.

### Two things this changed on the way past

`api/` **was never typechecked.** The root `tsconfig.json` referenced only
`app` (src) and `node` (vite.config.ts), so `api/decks.ts` had compiled by hope
since it was written — and a module-level mistake in a Vercel function surfaces
as an uncatchable `FUNCTION_INVOCATION_FAILED` with no useful log, which is the
worst possible place to find one. `tsconfig.api.json` now covers it and is in
the build.

The **Vite dev proxy** forwards `X-Analytics-Key` from the environment (read in
the config, which runs in Node, so it never reaches the bundle) and rewrites
`/api/analytics/opponent-read/` onto the Python route. That is what lets the
client use one URL in both places: in production it hits the Vercel function,
under `vite dev` it hits Python directly.


## The tunnel, and what was actually proved

Phase 24C step 4. The full runbook — named-tunnel config, Vercel variables,
rollback — is `docs/analytics-tunnel-runbook.md`. The summary is that **half of
this was verified against real infrastructure and half could not be.**

`cloudflared` is installed and running as a Windows service (`Auto` start,
token in `C:\ProgramData\cloudflared\token`, four QUIC connections to the
edge). The tunnel→Python hop was then exercised over the public internet
through a TryCloudflare quick tunnel, which needs no account:

| | |
|---|---|
| TLS | ✅ valid certificate, QUIC to the `bom03` edge |
| authentication through the tunnel | ✅ key accepted; missing and invalid both 401 |
| leakage on the public surface | ✅ **9 routes scanned, 0 leaks** |
| `opponent-read` contract end to end | ✅ approved fields only, no `changeProbability`, no percentage |
| CORS through the tunnel | ✅ one origin echoed, foreign origin gets nothing |
| Python stays loopback-only | ✅ bound `127.0.0.1:8787`; the LAN address refuses |
| failure when Python stops | ✅ edge returns 502, the proxy answers `disabled` |

**Not verified, and not claimed:** the Vercel half. There is no Vercel login on
this machine and no linked project, so the environment variables, the preview
deployment, and above all *whether Vercel resolves the `[tag]` dynamic segment*
remain unproven. The end-to-end test simulates the platform's router, which is
not the same thing as the platform.

### Three things the real infrastructure taught

**Cloudflare answers 502 with an HTML body** when the origin is down, not JSON.
The proxy's `response.ok` check catches it before anything tries to parse it —
correct by luck of ordering rather than by design, so it is now pinned by a test.

**`/api/analytics/status` is not a transport probe.** It calls
`os.path.getsize` on the spinning H: volume, so it times the *disk* (p50 166 ms
locally) rather than the network, and the first overhead figure measured with it
was meaningless. Timing an unauthenticated 401, which short-circuits before any
disk access, gives the real number.

| | p50 | p95 |
|---|---:|---:|
| `opponent-read`, direct `127.0.0.1` | 45.8 ms | 51.2 ms |
| `opponent-read`, through the tunnel | 143.6 ms | 1118.8 ms |
| Cloudflare round trip alone | **~119 ms** | |

The engine is the smaller half of the total. The p95 near 1.1 s is transport
variance on a home connection — the direct p95 never leaves 51 ms. **None of
this may be compared with `/coach/predict`** (29–57 s), which is the Coach's own
database read.

**The Python rate limiter is service-wide, not per-user, behind a tunnel.**
Demonstrated rather than assumed: 60 requests direct from localhost then 70
through the tunnel gave **120 × 404 followed by 10 × 429** — one shared bucket,
because `cloudflared` dials `127.0.0.1` and every remote caller therefore
arrives with the same peer address. Per-user limiting is the Vercel proxy's job
(30/minute per account). The Python limit is a backstop.

### Rollback

Six levels, none of which touches an ML artifact and none of which needs a
deployment. Level 1 is emptying `OIE_ALLOWLIST`, which takes seconds and turns
the feature off for everyone; level 6 is `git revert`. At every level Recent
still renders, because the opponent read has always been a separate request that
cannot block it.


## The move off the home machine

For most of this project the analytics half only worked on one laptop, with an
external drive plugged in. It now runs on a **Contabo Cloud VPS 6** (Ubuntu
24.04) behind **Caddy**, on a domain we own.

```
browser
  → api.deckkies.com                    Caddy, TLS from Let's Encrypt
  → header_up X-Analytics-Key           the edge authenticates to the origin
  → 127.0.0.1:8787                      server/app.py (systemd: royalweb)
  → /var/clashbot/battles.db            SQLite, mode=ro

browser                                 (the Coach's opponent read only)
  → deckkies.com/api/analytics/opponent-read/<tag>   same origin, no key
  → Vercel function                                  adds X-Analytics-Key
  → the same Caddy → app.py path
```

`docs/analytics-tunnel-runbook.md` holds the configuration, the unit files, the
firewall rules and the rollback. What follows is what the move actually settled.

### This contradicts an entry in "Deliberately not done", and here is why

That entry said **do not replicate the database to a VPS** — 69.4 GB growing by
~190,000 battles a day, and SQLite has no native replication. That reasoning
still stands and nothing here refutes it.

What changed is that **the bot moved too**. Nothing is replicated: there is one
database, on the VPS, with the bot writing to it and the API reading it
`mode=ro` beside it. The rejected design was two copies and a sync; the built
design is the same "run the service beside the data" the entry recommended, with
the data relocated. Retention is capped at **304 days — 10 months**, set on
2026-08-26 (it was 365 for one day, and 150 before the migration), so it
plateaus. The bot's own sizing put the ceiling near 266 GB at 365 days and
10,000 players; the measurement below is against the 3,278 actually tracked, and
the console's meter is there to catch either being wrong.

There is **no archive tier on the VPS at all**. `CLASH_ARCHIVE_DB_PATH` is set
explicitly empty, because `clash_data.py` defaults it to a Windows path that
cannot exist on Linux and the startup banner would print it.

### The edge injects the key, and that is only safe for one reason

The browser calls `api.deckkies.com` directly for the shareable analytics and
sends no headers, so something has to authenticate to the origin. Caddy does it.
That is only acceptable because **the origin is unreachable any other way**:
`app.py` binds `127.0.0.1:8787` and `ufw` allows nothing but 22, 80 and 443. The
key protects the origin; the rate limiter protects the service from the public.

**`CLASH_TRUSTED_PROXY=1` is required here and was not under the tunnel.** The
limiter keys on the client address, and behind any reverse proxy every request
arrives from loopback — one shared bucket for the entire internet. That failure
was demonstrated on the old tunnel: 60 local plus 70 tunnelled requests gave 120
allowed then 10 × 429, one bucket, because `cloudflared` also dialled loopback.
With the flag set, `app.py` reads the first entry of `X-Forwarded-For`, which
Caddy sets. Spoofing it would mean reaching 8787 directly, which the firewall
and the loopback bind prevent.

### Four things the box taught that reading did not

**Systemd's `--environ` leaked the API key into the journal.** The Caddy unit
was started in a way that dumped its environment, and `CLASH_API_KEY` went into
`journalctl` in plain text, readable by anything that could read the journal.
The key was **rotated**, not just hidden, because a leaked secret that is still
valid is not a fixed secret. `ExecStart` is overridden now.

**A `.env` written `KEY = value` works for python-dotenv and silently fails for
systemd.** systemd takes the name as `KEY ` with the trailing space and passes
nothing — no error, no warning, just an unset variable. The bot unit therefore
must **not** use `EnvironmentFile`; `WorkingDirectory=/opt/clashbot` is what lets
`load_dotenv()` find the file and parse it the way it was written.

**An empty `CLASH_ARCHIVE_DB_PATH` did not disable the archive.** It fell through
to the default rather than to "no archive", which on the VPS would have armed
raw-row deletion against a write to a temporary database. Found before it ran;
fixed on the bot side.

**The password the VPS shipped with is burned.** It was sent over chat to get the
box provisioned, so it must be treated as public regardless of what it is now.
SSH password authentication is disabled and access is by key only.

### What the tunnel work bought, given it was replaced days later

The transport was thrown away. Everything it proved about `server/app.py` was
not, because those are properties of the service rather than of the pipe: the
auth gate, the one-exact-origin CORS rule, the reason-code-only error bodies,
the secret audit that took `str(exc)` out of three response paths, and the
service-wide rate-limit behaviour that is precisely why `CLASH_TRUSTED_PROXY`
exists now. The runbook keeps that record below its superseded notice.

The measured latencies are also still the only comparison available: opponent-
read direct p50 46 ms / p95 51 ms, through the tunnel p50 144 ms / p95 1119 ms.
The p95 spike was home-connection variance, and it is the clearest single
argument for the box the service now runs on.

### How fast the database actually grows, measured

Asked, and worth answering with numbers rather than a feeling. Measured on the
box, 2026-08-26:

| | |
|---|---|
| file | 17.2 GiB — 562,353 pages at 32 KB |
| battles | 7,236,808 rows spanning **86 days** (2026-06-01 → 2026-08-26) |
| retention | **304 days** (10 months), so the window is about a quarter full |
| recent volume | ~158,000 battles/day (five-day mean of complete days) |
| volume | 387 GB, 25 GB used, 363 GB free |
| tracked players | 3,278 |

The heaviest tables are `battles` (4.37 GB), `battle_raw` (2.99 GB) and
`deck_card` with its two indexes (3.94 GB); indexes are roughly a third of the
file.

**Today's figure is not the steady state.** The battle-linear part costs about
1.4 KB per battle, so a full 304-day window at the current rate is ~66 GB, plus
a capped 25 GB of raw payloads and perhaps 15 GB of aggregates — call it
**~105 GB**, a quarter of the volume, reached in roughly seven months. The console
said 266 GB before this was measured; that was an estimate and it was high.

**The figure that scales is the tracked-player count, not time.** Battle volume
is a function of how many tags are enrolled. Doubling 3,278 roughly doubles
everything above, and enrolment is a feature the site offers.

**`battle_raw` is the part that would run away, and it is valved rather than
solved.** Its two pruning paths — `trim_local_raw` and `purge_non_duel_raw` —
both refuse to delete anything without the archive's confirmed insert cursor,
which is correct (rows do not arrive in `battle_time` order, and assuming they
do once left 172,414 battles unarchived). But there is no archive on the VPS, so
there is no cursor, so neither ever runs and raw payloads accumulate at ~0.79
GB/day. `CLASH_RAW_CAP_BYTES=25 GB` catches it: `run_two_tier_maintenance` falls
into a size-bounding branch when the cursor is absent. That is a valve on a pipe
nobody is draining — fine, deliberate, and worth remembering is not the same as
retention working.

A one-day reading of `battle_raw` looks alarming and is not: 183,331 rows landed
on migration day against ~1,000–2,400 on every day before it. That is the
backfill, visible in `stored_at` but not in `battle_time`, and reading the wrong
one of those two columns turns a one-off into a trend.

### Still open on the hosting side

- **H: is unplugged and must not be wiped.** The local `battles.db` and
  `archive.db` are the only way back, and the archive holds a month of battles
  that exists nowhere else. Not migrating the archive was deliberate — it grows
  480 GB/year at 10,000 players — which is not the same as not needing it.
- **There is no backup of the VPS database.** No backup directory, no cron, no
  timer; `deploy/backup_db.py` sits at `/opt/clashbot/deploy/` unscheduled.
  Until it runs, the VPS is a single copy whose only fallback is a drive frozen
  at 26 August.
- **`OIE_ALLOWLIST` is unset**, so the Coach's opponent read degrades to
  `{enabled: false}` for everyone. That is the designed answer, not an error —
  but it means the Coach's engine half is dark in production.
- **The Coach proxy still authenticates with the retired password-hash scheme.**
  It is the last consumer of `authStore`, and that store cannot be deleted until
  it migrates. The empty allowlist is what keeps that harmless for now.

---

## Top Meta Decks — why it is a snapshot

The one screen that is about everybody rather than one player: which decks the
whole base runs, over the last 10 days, ranked by use rate.

**It cannot be queried live.** A `GROUP BY player_deck_hash` over a date window
was built and measured first:

| window | via `idx_battles_time` | full table scan |
|---|---|---|
| 7 days | 39.9 s | — |
| 10 days | 48.3 s (49.3 s warm) | 45.1 s |
| 30 days | 76.3 s | — |

The cost is I/O — the index yields rowids in time order and then ~1.4M rows are
fetched from a 12.9 GB table whose rows carry two JSON card-list columns. The
normal fix, a covering index on `(battle_time, player_deck_hash)`, **is not
available**: this process opens the bot's databases `mode=ro` precisely so it
can never modify them. So a background thread recomputes on a timer and requests
read the finished snapshot in ~3 ms. Every response carries `computedAt`, and
the header prints how old the numbers are instead of implying they are live.

Three rules decide what lands on the board, and two of them are corrections to
what the first version actually produced:

- **Competitive 1v1 only** — ladder, ranked, clan-war 1v1, tournaments. 2v2 and
  the event modes that hand you a deck would measure Supercell's choices.
- **A deck needs 25+ distinct players.** Without it the board ranked a deck 50th
  on 1,703 Ladder battles at an **8.5% win rate** — 144 wins from 1,703. The
  stored results are clean, so those battles are real; they are just almost all
  one account grinding one deck badly. A use-rate ranking is exactly the shape a
  single heavy player can inject themselves into.
- **Variants merge at 6-of-8 shared cards** — the bot's own
  `COUNTER_MIN_OVERLAP`. Without merging the board printed "Mortar" twice,
  "Bridge Spam" twice and "Royal Giant" twice, and every use rate looked
  impossibly small because one archetype's play was split across dozens of
  one-card tech variants.
- **Names are qualified by a signature card.** Merging cannot join genuinely
  different decks that share a win condition, so "Hog" still appeared six times.
  `_deck_name` appends the priciest non-win-condition card — "Hog Musketeer",
  "Hog Earthquake" — which is how players name these decks anyway.

Use rate is a share of **every** competitive battle in the window, including
those on decks the floor rejects — a share of all play, not of the board. The
top 50 covers ~27% of it; Clash Royale's meta is a genuinely long tail across
roughly a million distinct deck lists, so a leading deck at ~2% is the real
number rather than a bug.

---

## Deck rendering: the three special slots

Applies to every screen that draws a deck. One function owns it —
`clash_data.arrange_deck` — and it decides both the ORDER of the cards and which
art each draws.

### The rule

A deck's first three positions are special, in the numbering a player sees:

| slot | may hold |
|---|---|
| 1 | evolution only |
| 2 | hero, champion, or an ordinary card — never an evolution |
| 3 | hero, evolution or champion (the "wild" slot) |

so a deck can wear at most **two evolutions**, at most **two heroes**, and at
most **three marks in total** — one per slot. Those are three separate limits
and all three are needed: two of each is individually legal, but slot 3 is the
single seat the second of each competes for. A champion has neither an evolution
nor a hero form, so wherever one is legal it simply draws as itself.

`arrange_deck` fills as many special slots as it can. The four cards that own
*both* forms — knight, valkyrie, musketeer, wizard — take an evolution slot when
one is free and the hero slot when the evolutions are already spent, because two
evolutions **and** a hero renders more of the same deck than two evolutions and a
gap.

### Why the stored order is rebuilt rather than trusted

The order is not random, but it is not reliable either:

| source | marks inside slots 1-3 |
|---|---|
| `battles.player_card_keys` (per battle) | **1194 / 1194** |
| `decks.cards` (dimension table) | **774 / 1056** |

The per-battle order is perfect; the decks table — which the meta board reads —
loses the arrangement about a quarter of the time. That is exactly why an X-Bow
and a Goblin Drill deck rendered almost entirely plain on the meta board while
the same decks were fine on a player's screen. And the deck *hash* is useless
for display in either case: it is alphabetical, so it identifies a deck without
describing one.

### Why the rule is stated, not inferred

**The bot never settled this, and its own sources disagree.**

| source | says |
|---|---|
| `Clash_Bot/CLAUDE.md` (measured) | marks cap at three per deck; the data *"cannot distinguish"* two evolution slots plus one from three special slots — *"Do NOT add a derived `player_hero` column until something settles which reading is right"* |
| `Clash_Bot/card_art.py` (the code) | checks `can_be_hero` **first** in slots 0 and 1 |
| `Clash_Bot/CLAUDE.md:720` (the docs for that code) | "slots 1-2 render evolution art; slot 3 champion/hero" |

Measured here over ~8,000 recent marked battles: slot 1 evolution **92%**, slot 2
hero **70%** / evolution 30%, slot 3 evolution **83%**, and 14% of single battles
carrying three evolution marks — which is one more than the game allows.

**Every one of those numbers came from reading the `art` string, and they are
artefacts of that.** Re-measured by level ([below](#the-level-says-which-form-it-is-the-art-string-does-not))
the ambiguity is gone: level 1 never appears in slot 2, level 2 never appears in
slot 1, and no battle carries three evolutions. The disagreement between the
bot's three sources was real, but it was a disagreement about a derived field —
the raw one underneath it says the rule above, exactly.

The rule is still *asserted* rather than derived, because it is the game's rule
and should not depend on whichever sample we happen to hold. It now has the
measurement behind it as well.

### Which art a card wears is measured

Never guessed from capability flags. `card_art_profile` reads what each card is
actually brought as across the database. Read by level (below), the four
both-form cards split — knight **75.7% hero**, wizard **71.5%**, valkyrie
**61.9%**, musketeer **36.1%** — while the other twelve hero-capable cards come
back 100% hero, because they have no evolution to be confused with.

Where the payload says nothing — it only covers battles from 2026-08-05, ~29% of
the database — the slots are read positionally and the deck is flagged
`artInferred`, which the tooltip and a footnote say out loud. The Duel Analysis
combos take the same fallback; without it the tab drew art for some players and
not others purely on whether their duels predated the backfill. A combo is a
pair rather than a deck, so there is no slot to reason about there — the only
honest statement is "this card is usually brought as X", which is exactly what
the profile holds. A dashed outline
was tried as the visual marker and removed: it read as a broken image rather than
as a caveat.

An earlier pass here concluded the positional reading was invalid, on a
measurement that checked only the first *two* slots. It was the measurement that
was wrong — all three are special.

### The level says which form it is. The `art` string does not

This is the root cause of every "the hero is missing" report, and it had been
wrong since the first line of art code was written.

`player_evo` stores `[card_key, level, art]`. Every reader in this project used
`art`, because it looks like the answer — the bot resolves it from the payload's
icon URLs, and it holds the literal strings `'evolution'` and `'hero'`. It is a
lossy derivation. Measured over 60,000 recent battles carrying marks, 162,919
marks:

| what the row says | | |
|---|---:|---|
| level 1, `art` "evolution" | 99,423 | 61.0% — correct |
| level 2, `art` "hero" | 37,231 | 22.9% — correct |
| level 2, `art` **"evolution"** | 14,960 | **9.2% — a hero drawn as an evolution** |
| level 1, `art` **"unknown"** | 11,305 | **6.9% — an evolution thrown away** |

**16.1% of all marks were wrong or discarded.**

The symptom the user saw, reported deck by deck: *"the Giant Skeleton deck,
Wizard is in the second slot, still no hero is discovered for it"*, *"X-Bow deck
— Knight is hero, evo Archers and evo Tesla"*, *"Lumber Loon deck — hero Knight,
evo Baby Drag and evo Inferno Drag, can't see that."* All three were right, and
the raw rows say so plainly once you look at the level:

```
X-Bow Tesla, 400 sampled battles, every one identical:
  [['tesla', 1, 'evolution'], ['knight', 2, 'evolution'], ['archers', 1, 'evolution']]
  card order: ['tesla', 'knight', 'archers', 'skeletons', ...]
```

Reading `art`, that is **three evolutions** in a deck that can field two — so
whichever two survived the cap, the hero was never one of them, and slot 2 got
filled with an arbitrary leftover (The Log). Reading `level`, it is Tesla
evolution / **Knight hero** / Archers evolution, which is exactly the deck.

Two independent checks say the level is exact:

* **It is the slot.** Of level-1 marks, 99.8% sit at index 0 or 2 — the two
  evolution slots — and **none** at index 1. Of level-2 marks, 87.1% sit at
  index 1 and 12.7% at index 2 (the wild slot), and **none** at index 0. The two
  levels are perfectly disjoint over the positions each is allowed to occupy.
* **It matches the cards.** Level 1 covers exactly the 42 cards `cardMeta` says
  can evolve, level 2 exactly the 16 it says can be a hero. 162,919 marks, zero
  exceptions in either direction.

It also agrees with the bot, which had said so all along: `evolution_marks`
documents that `evolutionLevel` takes values 1 and 2 and that **level 2 is
served hero art**. The field was in the tuple the whole time, one index away
from the one being read.

`clash_data.mark_variant` is now the only place this decision is made — four
readers had their own copy of `if m[2] in ("evolution", "hero")` and all four
were wrong the same way, which is the argument for it being a function. It
consults `art` only when the level is neither 1 nor 2, so a payload that stops
carrying a usable level degrades to the old reading rather than to nothing.

**How it hid for so long.** The measurement that blessed the old reading is
still quoted a few paragraphs up in the source: all four both-form cards
"fielded as an EVOLUTION 100% of the time", knight 586/586, valkyrie 867/867.
A *unanimous* answer to a question that is genuinely two-sided was the tell, and
it was read as confirmation instead. Re-measured by level, three of the four are
mostly the opposite. Unanimity is evidence about your reading before it is
evidence about the world.

### A pasted link's order IS the answer

Reported from a real paste: a Goblin Barrel / Valkyrie / Princess list came back
with **Goblins in the hero slot** and Valkyrie drawn as an evolution. No card was
missing and none was wrong — the deck simply rendered as a different deck.

| slot | the game draws | we drew |
|---|---|---|
| 1 | Goblin Barrel — evolution | Goblin Barrel — evolution |
| 2 | **Valkyrie — hero** | **Goblins — hero** |
| 3 | **Princess — evolution** | **Valkyrie — evolution** |

The cause is `arrange_deck` doing its job too well. It rebuilds the three
special slots from what each card is *capable* of, which is right for a stored
deck whose order cannot be trusted — but a **copyDeck link writes the three
special slots first, in slot order**. The link already said Goblin Barrel /
Valkyrie / Princess; the rebuild threw that away and preferred Goblins, because
Goblins *can* be a hero and nothing told it otherwise.

`trust_order=True` reads the art off the positions instead. Same link, and the
render now matches the game card for card.

**Slot 3 is the one a link cannot settle.** Four cards — knight, valkyrie,
musketeer, wizard — have both forms, so a link that puts one in the wild slot is
genuinely ambiguous: nothing in the data can say which was meant. Rather than
guess, the paste box offers the choice, as two real cards so the reader is
comparing the pictures they are being asked about. It appears only when the card
actually has both forms. This is the same decision the duel builder already
makes on its own wild slot, which is why it looks familiar.

**And the link outranks pooled marks.** That was the second half of the same
bug, reported separately: a Battle Ram / Wizard / Elite Barbarians link came
back with Elite Barbarians in the *middle* and Wizard third. The deck is on the
meta board, so `arrange_deck` got its marks — and those say Battle Ram and
Wizard are both evolutions, which is what *other people's* copies of those eight
cards were fielded as. Two evolutions and no hero leaves slot 2 to be filled
from the rest, so the order collapsed.

Marks are aggregated across everyone running the list; the link is the deck the
person in front of you built. When they disagree the link wins. Stored decks —
the meta board, the player screens, the Duel Zone — still defer to what was
observed, because there is no link there to trust.

The slot-3 override applies **on every path**, not just this one. It first
shipped inside the trust-order branch alone, so it worked on a deck nobody had
played and did nothing on a deck the board had marks for — which is most of what
anyone pastes. From the outside that is one button that sometimes does nothing.

### Observation beats inference, and for a while it did not

`arrange_deck(cards, marks)` took the observed marks as its second argument and
**never read them**. Every caller was already passing real evidence —
`meta.py` its aggregated `_evo_art` map, `duel_zone.py` the battle's own
`player_evo`, the player screens their per-deck lookup — and the function
derived the whole arrangement from what the cards were *capable* of, then
maximised: two evolutions and a hero wherever the cards allowed it.

The symptom was reported as *"I can see similar decks for all the archetypes"*,
and that is exactly what it was. Measured on the live meta board:

| | rendered | actually observed |
|---|---|---|
| decks drawing 3 special slots | 43 / 50 | 28 / 50 |
| decks drawing a hero | 43 / 50 | 25 / 50 |
| renderings contradicting the evidence | **19 / 50** | — |

The mechanism is one card. **Barbarian Barrel can be a hero and sits in eight of
the seventeen archetype decks**, so it was promoted into the hero slot in all
eight — eight different decks with the same gold card second. Across the whole
board it was drawn as the hero **10 times**. Since the arrangement also *orders*
the deck, every archetype row opened with the identical frame signature:

```
before   all 17 archetypes:  [evolution] [hero] [evolution]
after    E.E ×7   EHE ×8   E.. ×1   EH. ×1
```

The fix is that the marks decide when they exist. A card nobody was seen
fielding specially now stays plain however capable it is; the game's own cap
(one mark per slot: two evolutions, two heroes, three in total) still applies
on top, because a pooled sample can
report three evolutions for a cluster that no single player fields. Barbarian
Barrel is now the hero in 3 archetypes rather than 8, and in those three the
payload says so.

Inference is still there and still correct — it is what a deck with no record
gets, and every caller flags it with `artInferred` so a guess never passes for
an observation. **A pasted deck reaches for evidence first too**: `deck_hash` is
just the sorted card list, so if the meta board already covers the deck its
observed marks are a dictionary hit away, and a pasted meta deck now renders
identically to the same deck in the row beneath it.

The two paths are pinned separately in `test_card_art.py` — thirteen checks on
the observed path including idempotence, the caps, and the rule that an
unobserved staple stays plain.

### Slot 3 takes either form, and the cap said otherwise

Reported immediately after the level fix landed, on a Lava Hound deck whose
slot-3 hero Valkyrie still drew plain: *"why is it fixing one breaking
another?"* — a fair question, and the answer is that the first cap encoded the
wrong rule.

It read "two evolutions and **one** hero", treating slot 3 as an evolution slot.
Slot 3 takes **either**. Measured over 60,000 battles by what the three slots
actually held:

| slot 1 / slot 2 / slot 3 | share |
|---|---:|
| evolution / hero / evolution | 62.96% |
| evolution / — / evolution | 21.60% |
| **evolution / hero / hero** | **9.25%** |
| evolution / hero / — | 2.88% |
| evolution / — / hero | 1.57% |

Two heroes is the third-commonest loadout there is — 5,540 battles — and capping
at one made every one of them undrawable. The real constraint is one mark per
slot: **two evolutions, two heroes, three in total**. `cap_special_marks` now
gives slots 1 and 2 to the strongest of each form outright and lets whatever is
left compete for slot 3, and `arrange_deck` will put a second hero there.

**And the slot a mark was seen in is recorded, so it is used.** Two marks of the
same form cannot be ordered any other way — the deck came out
zap / Valkyrie / Berserker when the player's own sixteen battles say
zap / **Berserker** / Valkyrie, fourteen of them unanimous on the middle card.
The art lookups already read those rows; they were reading past
`player_card_keys`. They now return `{card: slot}` alongside the variant and
`arrange_deck` takes it as `slot_of=`. It only ever reorders cards the marks
already chose — it cannot make a card special — and it moved the special slots
on **15 of 50** meta decks without changing a single mark.

A pasted link passes no `slot_of` and needs none: its card codes *are* the slot
order, and `trust_order=True` already says so.

### A fifth of the marks never reached the renderer

The second defect behind the same report, and independent of the first: even
correctly-read marks were being deleted before anything could draw them.

`arrange_deck` was innocent here too.
Both art lookups (`meta._evo_art`, `clash_data.deck_art`) capped their result by
POSITION: a mark was dropped unless the card sat in the first three entries of
the deck's stored order. The cap itself is right — one mark per slot — but the
*test* was wrong.

`decks.cards` is genuine payload order, not a sorted list (measured: **0 of
20,000** rows are merely alphabetical). But it is **one** player's arrangement,
and the marks are pooled over everybody who played those eight cards. A deck's
habitual hero sitting eighth in the representative's copy is not evidence that
it is not the hero; it is evidence that the representative is not the majority.

Measured on the live board by running the art pass twice, once with the filter
and once without:

| | |
|---|---|
| marks discarded by the positional filter | **23** |
| decks affected | **21 / 50** |
| what was lost | Berserker as a hero ×5, Tesla ×2 and Knight ×2 as evolutions, a Lumberjack evolution, Battle Ram, Zap, Ice Golem… |

So the cap moved to `clash_data.cap_special_marks`, which enforces the same
limit — two evolutions, two heroes, three in total — on the **evidence**
instead: the most-observed
marks win, ties break on the card key so identical data always renders
identically. Position is decided where positions are actually decided, in
`arrange_deck`, which then lifts a late-ordered hero into slot 2 itself.

`_evo_art` still applies `ART_MIN_SHARE` first, because a cluster row pools many
players' choices and a mark seen in under a quarter of sampled battles is not
that deck's habit. Nine checks in `test_card_art.py` pin the cap, the ranking,
the tie-break, and the regression itself.

---

## Duel combinations — the logic and why it looks like that

`server/duel_combos.py` is a port of the bot's Pair Board
(`clashdb.get_card_pair_stats` + `pdf_pages.pair_board_data`). It is a **port,
not a reimplementation** — if the two ever disagreed, the website would start
describing a different set of battles from `!duels` for the same player,
silently and with no error.

A **combo** is two cards fielded in the same deck, in a duel.

### Pairs come from decks, never a second scan

A battle carries exactly one deck, so grouping by deck first and expanding to
pairs afterwards is *lossless* for any card-set question — a pair's game count
is the sum of the battles of every deck holding both cards, which is precisely
what a per-battle scan would return. Going back to `battles` would cost a second
read of the same rows and create a second source of truth.

### The floors, and why a pair needs them

| Floor | Value | Why |
|---|---|---|
| `PAIR_MIN_GAMES` | 8 | `confidence_tier` refuses to tier anything smaller, so a pair below it would be a percentage with no evidence attached |
| `PAIR_MIN_DECKS` | 2 | a pair confined to one deck is not a pairing — it is that deck, named by two of its cards |

Confidence is a 95% Wilson interval; `None` means *the claim is not made at
all*, not "low confidence". A 6-from-6 record is not reported as "100% ± 0%".

### The budgets, which are the whole reason the table is readable

A pair inherits the record of **whole decks**, so a player's most-played deck
contributes all 28 of its pairs with identical game counts. Without a budget the
table is one deck sliced twenty-four ways. Measured in the bot project on real
players: 24 rows drawn from 7 decks, one deck supplying 12 of them, with a
median 85% of each row's games coming from that single deck.

So: a card may appear at most 2 times (relaxing to 3 only for rows it could not
otherwise reach), and a *deck* may dominate at most 2 rows. Selection runs three
sweeps — pairs whose cards are both unused, then those reusing one, then both —
because a plain greedy pass walks the ranking from the top where the pairs share
cards, and spends the budget on the first cards it meets.

### Ranked by evidence, then reach, then volume

- **By games alone** → the grind deck's 28 pairs take the top of every tab.
- **By reach alone** → fixes that and breaks the evidence rule instead: a pair
  in twenty decks played twice each arrives at 21 games carrying a 95% win rate.

So trustworthiness leads, reach orders within each group, volume only breaks
ties — and ties break on the card keys, never on dict iteration order.

### There is no synergy score, and that is a measured result

The obvious metric — a pair's win rate against what each card does apart — was
specified, built and tested in the bot project *before* any of this was drawn:

```
together = wins/games over decks holding BOTH cards
apart    = wins/games over decks holding EXACTLY ONE of them
lift     = wr(together) - wr(apart)
```

Tested against a permutation null (each deck keeps its card set and game count;
which record belongs to which card set is shuffled) across 14 player shapes, the
real spread came out at a **median 1.00× its own null**, below it as often as
above. The null itself put 8–25% of pairs past |z| ≥ 2 where an honest binomial
would put 5% — because battles inside one deck are not independent draws, so the
textbook standard error is simply wrong here.

A "Synergy 78%" computed that way reports **deck clustering as a property of two
cards**. The page states what it can count instead. Do not reinstate a lift
score without a new hypothesis and a fresh leak-free measurement.

### G1/G2/G3 came free from the storage format

The useful discovery: **a native duel is stored as one row carrying the whole
loadout** — 16 or 24 cards, i.e. two or three decks laid end to end. So a duel
deck's position in the loadout is *read* out of the data, not inferred.

Friendly practice has no such row, so those duels are rebuilt with the bot's own
`duel_split` rules, every one of which is measured rather than guessed:

- a >30 minute gap closes a series;
- card reuse closes a series (a duel loadout cannot repeat cards);
- a 2-0 arms **exactly one** dead rubber, then closes — players routinely play
  the decided third game to show their third deck;
- a 2-1 does **not** close: that is the real-Bo5 case, and closing it reported
  one five-game series as a 1-2 plus a fabricated 1-1 tie.

The G1/G2/G3 columns show the share of decks played in *that slot* which carried
the pair — "how much of my G2 is this combo". Not a share of the pair's own
games: the three slots do not hold equal numbers of decks, because a duel
decided 2-0 never fields its third.

### One deliberate divergence from the bot

The PDF assigns each pair **exactly one** category, because it prints all four
on one board and a pair in two buckets would be one fact printed twice. Tabs are
not one board — each tab is its own question, and an "Evolutions (Combo)" tab
that hides Evo Royal Giant because a win condition outranked it is answering a
different question from the one on its label. So the bot's *predicates* are used
unchanged, applied **independently** per tab. A pair may appear under two tabs.

---

## Duel Zone — the series log and the deck sequence

`server/duel_zone.py`, two windows over the same duels: **Recent Duels** (the
series log behind the bot's `!duels`) and **Deck Sequence** (the `!duelspdf`
"Deck Sequence Prediction" page). Both are ports for the same reason
`duel_combos.py` is — a second implementation would eventually describe a
different set of duels from `!duels` for the same player, silently.

**Both halves come from ONE database read.** `duel_combos.read_duel_rows` is
shared, so the series on screen and the sequence computed from them can never
disagree about which duels exist.

### What a series is

Two sources, merged the way `DuelEngine.extract` merges them:

* a **native** duel is one stored row carrying the whole loadout (16 or 24
  cards), so its decks are *read* rather than inferred;
* **friendly practice** stores one row per game, so the series is rebuilt with
  the measured `duel_split` rules — >30 min gap closes, card reuse closes, a 2-0
  arms exactly one dead rubber, a 2-1 does **not** close.

`bo3` vs `bo5` is decided **only by a 4th game**. A Bo3 decided 2-0 whose dead
third game gets played out reaches 3-0 in three games and is still a Bo3.

### The one place this diverges from the bot, and the measurement behind it

The bot's rule is that **any** repeated card ends a series, which is right in
principle — a duel loadout's three decks share no cards at all. Applied to real
practice data it cuts too often, because practice decks brush against each other
constantly (The Log, Zap, Skeletons). Eight consecutive games against one
opponent, decks overlapping by 1-4 cards and never by six, came out as 3 / 3 / 2
with a two-game **1-1** tail — and a duel cannot end 1-1.

The obvious fix, allowing a shared card or two, is wrong. Measured over five
players:

| shared cards to close | coverage | series longer than 3 games |
|---|---|---|
| **1 — the bot's rule, kept** | 66.0% | **1.1%** |
| 2 | 68.9% | 4.3% |
| 3 | 70.4% | 9.9% |
| 6 (a whole deck) | 71.7% | 25.3% |

A genuine Bo5 is roughly 0.3% of this data, so anything past 1 buys a few points
of coverage by **inventing Bo5s**. The rule is right; what it needed was a
tidy-up of the fragments it leaves behind, so `_merge_unfinished` runs after it:

* a series where neither side reached two wins did not finish, so it is folded
  back into the series it was cut from — same opponent, inside the 30-minute
  gap, and only while the total still fits five games;
* one that cannot be folded anywhere is **dropped**, exactly as `_split_series`
  already drops a lone game. Two friendly games that ended 1-1 are not a duel.

On that eight-game set this gives a 1-2 Bo3 followed by a 2-3 Bo5 — two complete
duels, which is what the games were. Across three players it took series ending
on an impossible scoreline from 6.6% to zero.

Both screens go through `duel_combos.split_chunk`, so the pair board and the
Duel Zone cannot disagree about where one duel ends and the next begins.

**A native row shows no scoreline, on purpose.** It stores the *duel's* result,
not each game's, so the screen prints the loadout and the overall outcome and
leaves the score blank. `duel_score_caption(None, None, n)` is `""` for exactly
this case, which is distinct from `"NO RESULT"` — a real scoreless tie.

While porting, `_split_series` was corrected to track **both sides'** card reuse
as `duel_split.split` does. The website's copy only tracked the player's,
because it had never read the opponent's deck; the Duel Zone needs it anyway.

### Why the sequence looks like that

Each step exists because the step before it was not enough:

1. cluster every duel deck at 6-of-8 shared cards, so variants of one deck are
   one opener rather than six;
2. drop one-offs, and drop openers that near-duplicate an earlier one;
3. rank by usage — the deck played 30 times is the one to prepare for;
4. per opener, take the **observed** loadout when a real 3-game series shows one
   (~85% of rows) and only otherwise predict companions.

A predicted pair must be **card-disjoint** from the opener and from each other.
Before that rule existed in the bot, 76% of its rendered triples were
impossible — two decks sharing cards, sometimes the opener predicted as its own
companion. Fewer than two companions is a real answer and is shown as one.

Companions are ranked by **co-occurrence with the opener**, weighted 3× a play
anywhere else. Ranking by raw play count makes every row identical (the
player's two most-played decks); measured leak-free on 839 real 3-game series,
co-occurrence took "names at least one true companion" from 16.6% to 23.6% and
repeated rows from 63% to 8%. The count is printed, because the ranking is
driven by it and the list otherwise looks mis-sorted.

The response still carries whether a row was observed or predicted, but the UI
does not badge it — by request, the rows show the decks and nothing else.

**There are no display caps.** The bot has three — 40 openers clustered, 27
rows, four pages — and every one is PDF page geometry; its own comment records
the layout engine refusing fourteen tiles because four rows need 552px against a
540px band. A scrolling panel has no pages, so the date window decides how much
there is and all of it is drawn: every duel in the window, and every opener.
100 duels is ~187 kB of JSON and ~0.2 s to build. The bot's `count >= 2` filter
on openers is dropped for the same reason — the play count is printed beside
each row, so a deck brought once can be shown and judged rather than hidden.
Near-duplicate openers are still merged, which is one deck said once rather than
one deck hidden.

The window is the six presets plus a **custom From/To range** next to them,
driven by the shared `useDateWindow` hook so the season control and the presets
cannot disagree about which window is live.

### A duel row opens onto the deck you were facing

Each game in **Recent Duels** expands to show the opponent's eight cards. The
row named their archetype and stopped there, which is the wrong half of the
information: a duel forbids card reuse across the three decks, so what they
spent in game 1 is what they cannot bring in game 2, and that is a card list
rather than a label.

Their deck goes through `_deck_view` exactly as the player's does —
`opponent_evo` carries the same `[card, level, art]` triples as `player_evo`, so
one function resolves both sides and the two strips in a row are comparable. The
opponent's strip is aligned to the same vertical as the player's above it, which
needs the identity column to be a fixed track: a flexible one resolves against
whatever else is in *its* row, and the row has three trailing columns the
expanded panel does not.

**Only reconstructed series expand.** A native duel row is one stored row
carrying the loadout and the series result — it has no per-game opponent at all,
so those rows stay inert rather than opening onto an empty panel. Measured on a
96-duel player: 95 expandable games, 97 with nothing to show.

The panel paints its own surface and takes a maroon leading edge. The series
card behind it is washed green on a win and red on a loss, and an expanded panel
inheriting that framed the opponent's deck in green precisely when *you* had
won, which says the wrong thing about whose deck it is.

### Both windows draw a deck the same way

Every deck on both windows goes through `clash_data.arrange_deck`, which owns
the slot ORDER and the evolution/hero art together. The sequence board first
shipped without it — its decks come out of the clusterer rather than off a row —
so the same deck rendered in a different order and with no art at all next to
its own entry in the series log.

Marks are looked up by deck signature out of the rows the report already read,
so an observed evolution still beats an inferred one; a deck with no marks in
`player_evo` is flagged `artInferred` exactly as elsewhere.

### Deck names are qualified

Two openers both reading "Mortar" is the ambiguity `meta._deck_name` was written
for, so that rule moved to `clash_data.deck_name` and both screens use it: the
archetype plus the priciest non-win-condition card, giving "Mortar Rascals" and
"Mortar Lightning". `_archetype_title` also moved there and now consults the
bot's `ARCHETYPE_DISPLAY` map, so "xbow" reads as X-Bow and "bait" as Log Bait
instead of being title-cased. **This renamed rows on the meta board too** —
"Hog Musketeer" is now "Hog Rider Musketeer".

---

## Cards — one player's whole card pool

`server/player_cards.py` behind `#/player/<tag>/cards`. Use rate and win rate
for every card over a date window, plus how each moved against the window
before it.

**It scans `battles`, not `player_card_agg`.** The rollup exists and is one row
per card, but it is lifetime-only — no date column, no game mode. Read from it,
the date control and the mode control would both be decoration, which is the
same failure the deck rows had before they moved onto `battles`. The per-player
index makes the scan ~50 ms, and the previous window costs one more.

**All 122 cards come back, including ones the player has never touched.**
"Which cards do they not play?" is a real question about a card board; a zero
row answers it, and dropping them would quietly turn the board into "cards they
play" while the label says otherwise. The screen hides them by default behind a
checkbox.

**A win rate is only ranked once there is evidence behind it.** The floor is
`duel_combos.CONF_MIN_GAMES` (8) — the pair board's, not a new number — and it
exists for the same reason: without it the top of a "best cards" board is
whatever was played once and won once, and Rage at 100% outranks a card with a
real record. Below the floor a card still appears, marked **thin**, and the
Wilson tier still refuses to tier it.

**The grid sorts by use rate, descending, by default.** It used to open on win
rate, which put that caveat at the top of the screen: even with the floor doing
its job, the highest win rates skew hard toward the thinnest records, so the
first thing you saw was a list of cards this player has barely touched. Use rate
is a plain count, needs no floor, and answers the question a card board is
opened to answer. Win rate is one select away and still ranks evidence-first —
an unranked card never outranks a ranked one however high its percentage reads.

**Movement is against the equally long window immediately before this one.**
"Up 1.3 points" has to be against something. A card the player did not play last
window gets no win-rate delta at all rather than a fall to zero — the comparison
cannot be made, which is different from being made and coming out flat.

**The tile is deliberately small.** 122 cards want a dense grid, so a tile
carries the art, the name and the two rates on ONE line — use rate in the data
blue, win rate in the data green, each printing its own figure. Those are the
app's CVD-validated categorical pair, the same two the duel-analysis meters use;
violet is not an option because it means "selected" everywhere else. The battle
count, both deltas, the Wilson interval and the per-form shares moved into the
tile's tooltip, which is what pays for twelve cards per row instead of seven.
The elixir cost was a badge over the corner of the art and was **removed on
request** — at this density the grid is read as pictures, and the cost is in the
tooltip. The elixir *filter* and *sort* are untouched; it was the printed digit
that was noise.

### An evolved card is a different card, and it is scored as one

The brief: *"the normal Skeletons will have a different use rate and win rate
than evo Skeletons."* Correct, and the board could not say so — every figure was
the card's whole record across all three of its forms.

Three things had to be built for it.

**The Evolutions tab was drawing base art, and there was no Heroes tab at all.**
So the evolution and hero artwork the app ships — 42 and 16 PNGs, matching the
`can_evolve` / `can_be_hero` metadata exactly, checked — appeared nowhere on the
one screen actually about those forms. The tab now decides the art. Measured at
32×32 in linear RGB, no form is close to another: the nearest pair of the 58
differs by **45.5 of 255** mean channel difference, and the four cards with all
three forms (knight, valkyrie, musketeer, wizard) separate by 47.7–53.2. A
`test_card_art.py` check now fails if any special PNG is ever a byte-copy of its
base card.

**Evolved and hero were being added into one counter.** `_evo_marks` resolves
each mark to `'evolution'` or `'hero'` and the card board summed both into
`evoRate`. On real data that produced eleven cards reporting an evolution rate —
Berserker at **76.8% "evolved"** — where every one of the eleven has no
evolution at all. They are two forms, counted separately now.

**A per-form rate can only come from the battles that recorded the form.**
`player_evo` is the only column that says which form was fielded, and on the
test account it covers **350 of 2,268 battles (15.4%)**, all inside an 8-day
window against a ~50-day history. So the split is computed over that subset
alone, and *both* sides of every comparison come from it: within a marked row, a
card carrying no mark was fielded plain, which is the only place "plain" can be
counted from. Outside one the form is unknown, which is not the same as plain.

That subset is small, and the screen says so rather than letting a form's win
rate pass for the same kind of number as a card's. On the test account 22 cards
have been seen in both a special form and a plain one, and 6 clear the 8-battle
floor on both sides — which is enough to answer the question that prompted this:

| | plain | evolved |
|---|---|---|
| Knight | 60.0% (20) | **42.9%** (14) |
| Cannon | 62.1% (66) | 50.0% (10) |
| Tesla | 46.2% (39) | 48.6% (37) |
| Princess | 41.7% (12) | 50.0% (30) |

A form tile prints **the same two figures as every other tab** — use rate and
win rate — and nothing else. It briefly carried a third line: first a delta
("−6.1 vs plain"), then the plain card's own percentage. Both went, and the
delta first, for the better reason: a difference cannot be sanity-checked on its
own, since 6.1 points off 54% and off 12% are not the same claim. The percentage
that replaced it was honest but still a third number competing with the two
being compared, on a 6.1rem tile. The plain record lives in the tooltip, where
it answers *against what?* for the reader who asks. The evidence floor applies
per form, so a form with four battles is marked thin exactly as a card would be,
and the use rate is a share of the form-recording battles, which the footer
states is not comparable with the other tabs'.

**Every filter is client-side.** Card type, elixir, rarity, win-condition,
champion and evolution all come from `cards.json` + `cardMeta.json`, which the
browser already has for the art; the server sends only counts. Shipping the
metadata from the server too would be a second copy, free to disagree with the
one drawing the cards.

**Win Conditions, Champions and Evolutions are no longer sidebar sections.**
They were never separate screens — each is a way of looking at the same card
list — so they are tabs here, beside All / Troops / Buildings / Spells / Heroes.
Three shells that each rendered this board with one filter pre-applied would
have been three places to keep in step.

**On a form tab, the figures follow the form — the filter does not.** The sort
and the bar ruler read the same numbers the tile prints, otherwise "sort by win
rate" would order the grid by a figure that is nowhere on it. But "hide
unplayed" means *never played the card*, not *never recorded in this form*.

That distinction was got wrong first and it showed: making it the latter hid ten
of the forty-two evolution cards, Elite Barbarians among them — 56 battles on
the card, zero of them marked as evolved, so a tab whose entire job is to list
the evolutions dropped it. The reason it is wrong is coverage. `player_evo`
records the form for about a quarter of battles, so "no evolved record" mostly
means *not observed*, not *never evolved*; absence of a mark is not evidence of
absence. All 42 evolutions and all 16 heroes are listed, and a card with no
per-form record says "no evolution data" on its tile — the honest version of
the same fact.

---

## Deck Counter — what beats what

`server/deck_counter.py` behind `#/player/<tag>/counter`, in three tabs: what
beats this **player**, a **deck-vs-deck** head-to-head, and **find counters**
for a pasted deck. The shape of all three is a consequence of what the data
turned out to support, so the measurements come first.

### The number follows the cards — three ways to get one

Deck vs **exact deck** is genuinely unanswerable. `pair_matchup_agg` holds
1,979,822 pairings and they are almost all singletons:

| games behind a pairing | pairings | share |
|---|---|---|
| ≥1 | 1,979,822 | 100% |
| ≥2 | 108,670 | 5.49% |
| ≥4 | 30,263 | 1.53% |
| **≥8** (the evidence floor) | 11,633 | **0.59%** |

A screen promising "62.4% over 284 battles" for two *specific lists* would be
inventing the figure for 99.4% of inputs.

**An earlier pass drew the right measurement and applied it too widely**, and
answered everything at archetype level. That made the screen ignore the cards:
every Hog deck, however built, returned the same row, and swapping a card
changed nothing. Deck vs **archetype** is a different question, and the data
answers it easily — the most-played Hog list appears in 29,562 pairings as
`deck_a` and 20,182 as `deck_b`, **111,663 decided battles for that one list**,
with all seventeen archetypes clearing 697 games against it.

So a matchup is now resolved best-first, and the answer **says which it used**:

| source | what it is | when |
|---|---|---|
| `exact` | these two lists have actually met | 0.59% of pairs |
| `deck` | **this exact list**, against every deck of that archetype | usually |
| `cluster7` | lists **one card different** | the exact list is thin |
| `cluster6` | lists **two cards different** | thinner still |
| `archetype` | archetype vs archetype | a deck nobody has played |

The two middle rungs are the bot's own cluster idea
(`deck_search.DeckArchetypeIndex.wr` backs off pair → cluster → model → global,
where a cluster is every deck sharing `CLUSTER_MIN_OVERLAP = 6` cards). Split in
two here, because "6 of 8" and "7 of 8" are different amounts of *the same
deck* and the reader should see both rather than have one chosen for them.

Change a card and the deck hash changes, so a different set of battles is
counted. Measured on one Hog deck against Golem:

| the list | win rate | battles | source |
|---|---|---|---|
| with Ice Golem | 45.4% | 6,610 | deck |
| Ice Golem → Knight | **37.5%** | 104 | deck |
| Musketeer → Earthquake | 48.7% | 35,387 | archetype (too rare) |

And the counters it finds move with it too — the base list's worst matchup is
Goblin Drill at 73.8% over 3,684 battles; swap Ice Golem for Knight and
Graveyard takes over at 76.3% over 93.

### The deck beside a matchup row is the one THIS player faces

The rows were always personal — they are the player's own battles, grouped by
what they ran into, so "62.5% over 40 battles against Balloon" is theirs. The
DECK drawn beside each row was not. It came from `_representatives()`: the
most-observed deck of that archetype across the whole database. Every account
was shown the same eight cards for "X-Bow", which is what made these rows read
as generic and look interchangeable between players, even though the numbers
never were.

`opponent_card_keys` sits in the same table and the same query, so the deck a
player has personally met most is nearly free. Counting it per archetype gives a
strictly better answer to "what beats me": it is theirs, it is what they will
meet again, and it is the thing the win rate above it was actually measured on.
Two players now see different Golem decks — 13 sightings of one list against 14
of a completely different one.

**Three sightings before it is named** (`FACED_MIN_SIGHTINGS`). Below that, the
"most common" deck is whichever single opponent happened to appear twice, which
is noise wearing the authority of a recommendation. The archetype's
representative stands in there, and the row says `typical` rather than
`faced Nx` — the two are different claims and must not look alike.

**Exactly eight cards.** A 16- or 24-card duel loadout is three decks end to
end, and counting one as "a deck they faced" would draw a deck that never
existed.

**The key tiebreak is not decoration.** Opponent decks tie on sighting count
constantly, and falling through to dict order would reshuffle the drawn deck
between two identical requests — the reshuffle-on-identical-data bug this
project has already shipped twice.

### A floor on rates is not a reason to hide a game

Reported: a Log Bait list that had just lost 0–3 to a specific Lava Hound deck,
pasted into Find Counters — and Lava Hound was nowhere. The table offered
Electro Giant, Mortar and Balloon instead, every row measured on decks *one card
different*.

Traced: that list has **2 stored battles**, both against that one Lava Hound
deck, 1–1. `MIN_GAMES = 8` dropped it, so the archetype row fell back to the
cluster. Which is correct **for a rate** — one win and one loss is not 50% — but
it also deleted the fact that the game happened, and a game that was played is
not an estimate and does not need a sample size.

So the floor stays where it belongs and a second section sits beside it:
**"Decks this list has actually met"**, reporting `1–1 · 2 games` rather than a
percentage, losing records first. Two indexed lookups on `pair_matchup_agg`, so
it costs nothing. The rate table is the estimate; this is the history, and they
answer different questions.

### The ladder is shown, not silently picked

Deck vs Deck prints every rung that has evidence, narrowest first, which is the
only way to tell a thin exact reading from a real one:

| measured on | decks pooled | win rate | battles |
|---|---|---|---|
| this exact deck | 1 | **37.5%** | 104 |
| 1 card different | 1,442 | 45.2% | 7,105 |
| 2 cards different | 4,980 | 44.8% | 8,681 |
| archetype average | every deck | 48.7% | 35,733 |

104 battles said 37.5%; 1,442 near-identical lists say 45.2%. The headline is
still the narrowest reading, but a reader can now see that it is probably noise
— which a single number never admits. Find Deck Counters walks the same ladder
per archetype and labels each row with the rung that answered it.

**Two things make this fast enough to run on a button press.** There is *no
join*: `deck_hash` is the sorted card list, so an opponent's archetype comes off
its own key rather than out of `decks`. Joining 29,562 primary-key lookups into
a 1.05M-row table cost **9.7 s**; deriving them in Python costs ~50 ms and
agrees with the stored column on **400,000 of 400,000** real decks. And
`ix_pair_a` / `ix_pair_b` already exist, so both directions are index scans. A
profile takes ~2 s cold and is cached per deck.

The cluster rungs needed three more optimisations to be usable, and the first
attempt at all of them was 15.2 s:

* **One scan for both levels.** There is no index for "shares six cards with
  this", so finding siblings means looking at all 1,054,394 deck hashes. `>=7`
  is a subset of `>=6`, so the overlap is counted once and bucketed afterwards —
  1.6 s instead of 3.2 s.
* **A TEMP table instead of chunked `IN (...)`.** Aggregating a cluster's pair
  rows was 4.4 s through 900-parameter `IN` chunks and is 1.0 s joined against
  `ix_pair_a`. A `mode=ro` connection can still create temp tables; they live in
  a separate temp database.
* **One join for both levels.** The temp table carries each sibling's overlap
  count, so a single walk fills every bucket — 46,869 rows read once rather than
  39,925 + 46,869.

Together: **15.2 s → 5.5 s cold, 2.1 s cached.** The 1,054,394-hash vocabulary
(~86 MB of strings) is read once on the background thread at startup, so the
first person to paste a deck does not pay the 2.2 s for it.

**It is still symmetrised.** `deck_a` is the tracked player's side, so the
forward rows carry the same house edge as the matrix; the reverse rows are
folded in with wins, losses and crowns swapped. The check is the same one as
before — that Hog list's record across the whole field comes out at **49.9%**,
not 58%.

One consequence worth stating: `mirror` now means *the same eight cards*. It
used to mean "the same archetype", so two different Hog lists were declared a
mirror and handed 50% by construction. Same archetype, different lists is
reported separately.

### Duels count, and so does ladder

The question was whether these screens were reading ladder only. They are not,
and the check is that duel battles are *better* represented than normal ones:
taking recent 8-card battles and asking whether their deck pair exists in
`pair_matchup_agg`,

| | pair present |
|---|---|
| duel battles | **72.7%** |
| ladder battles | 61.3% |

`clashdb._accumulate`, which fills that table, has no game-mode filter at all —
it streams every row of `battles`. So a deck's record here already pools every
1v1 it has played. (Neither rate is 100% because the aggregate is built
incrementally and drawn games never produce a pair row; that applies equally to
both, which is the point of comparing them.)

**One thing genuinely cannot be counted.** A native duel row stores the whole
16- or 24-card loadout in `player_card_keys` plus the *series* result — there is
no per-game scoreline to attribute to a deck pair, the same limit the Duel Zone
already documents. Those hashes are in the table but can never match a pasted
8-card list, and `_build_reps` explicitly rejects anything without exactly seven
commas so a loadout is never mistaken for a deck. In a recent sample that is
2,269 of 10,818 duel rows; the other 8,549 are ordinary 8-card rows and are
fully counted.

**The suggestion had to move to match.** The deck drawn beside each row used to
come from the meta board's top 50 — and that board excludes duel and friendly
modes *by design*, because it answers "what is the ladder running" and duels
have their own screen. So the figures counted duels while the deck printed next
to them was picked from a population that had them removed. Representatives now
come from `pair_matchup_agg` itself, via the bot's own rule (`deck_search`'s
"the most-observed deck of an archetype"), computed in the background snapshot.
The meta board is still asked for *art*, which is the one thing it has that the
pair table does not.

### The raw table is biased, and the mirror test proves it

`deck_a` is the **tracked player's** deck, and tracked players are not a random
sample: they win **58.59%** of all stored battles. Read straight, every deck
counters every deck. The bias shows up where it can be checked — a mirror
matchup must be 50% by symmetry, and the raw table says:

| mirror | raw | symmetrised |
|---|---|---|
| bait vs bait | 58.0% | **50.0%** |
| hog vs hog | 58.8% | **50.0%** |
| graveyard vs graveyard | 62.5% | **50.0%** |

So cell (A,B) is combined with the **reverse** of cell (B,A) and the house edge
cancels. Every mirror then lands at exactly 50.0% — that is the proof the
correction is right, not an assumption — and real matchups come out sane:
X-Bow vs Golem 39.9%, Lava vs X-Bow 42.0%, Graveyard vs Mortar 44.5%.
`_symmetric()` is the only way a matchup number leaves the module; a raw cell is
never reported.

### There is no "average match time" tile

The design has one. No match duration is stored anywhere — not in `battles`,
not in `pair_matchup_agg`, and not in the raw payload, whose keys are `type`,
`battleTime`, `isLadderTournament`, `arena`, `gameMode`, `deckSelection`,
`team`, `opponent`, `isHostedMatch`, `leagueNumber`. The tile is absent rather
than faked.

### A pasted deck is drawn the same way as every other deck

A Clash Royale copy-deck link carries **eight card IDs and nothing else** — no
evolution flag, no hero flag, no slot order. So a pasted deck rendered eight
plain cards while the meta deck beside it on the same screen had its evolutions
and heroes drawn properly.

Pasted decks now go through `clash_data.arrange_deck`, the app's single answer
to "which slots are special" and the same function the meta board, the player
screens and the PDF all use: slot 1 an evolution, slot 2 a hero or champion,
slot 3 the second evolution else a hero else a champion, decided from what the
cards *are* rather than from an order the link does not carry.

This is **inference, and it is labelled as one.** `CardArt` has an `inferred`
flag that says so in the tooltip. It is the correct inference for a legal deck
and the same one the game would make, but a link cannot tell us the player
really brought the evolution. It applies on both tabs, in the paste preview, the
versus panel and all three card-difference columns — the shared column takes
deck A's reading, since a card can legally be the evolution in one deck and
plain in the other and picking a side is honest where merging them is not.

### The paste box draws the deck immediately

The preview used to echo the raw link order in plain art and only take on its
real slots and evolution frames when **Compare** ran — seconds later, after the
reader had already looked at it, so the deck visibly rearranged itself. The
arrangement is a server decision, so the box now asks for it directly on paste
via `GET /api/analytics/deck?cards=`, which touches no database (a dictionary
hit on the meta snapshot plus `arrange_deck`) and lands within a frame or two.
The raw strip still renders while the answer is in flight, because a blank box
for one frame is worse than an unstyled one and because the API being down
should degrade to "your eight cards" rather than to nothing.

### A one-battle deck was allowed to be its own baseline

Counter *advantage* is a row's win rate minus how the target does against the
field. Once that baseline came from the pasted deck's own record, a deck played
once and won once reported **"100.0% over 1 battles"** — and every advantage
became the row's own win rate, "+61.5" against a field the deck had never met.

The per-archetype floor of 8 cannot catch this, because the baseline pools all
seventeen archetypes: every row correctly fell back to the matrix while the
baseline did not. `BASELINE_MIN_BATTLES = 50` is a separate, much higher floor
for exactly that reason — an error in a figure that is subtracted from every row
matters more than an error in one row.

### Every list pages, and the heading states the real count

The tile said "16 matchups analyzed" and the lists underneath offered ten, with
no control anywhere to reach the other six — the number was a claim the page
could not honour. Two faults behind it, both server-side:

* `matchups[:5]` and `matchups[-5:]` for worst and best. Below ten archetypes
  those two slices **overlap**, so the same matchup appeared under both.
* `find_counters` truncated to five, so a deck with twelve real counters
  reported five and the style breakdown disagreed with the table above it.

The server now returns everything and the client pages it, five at a time, which
is where the decision belongs — the component knows how much room it has. Worst
and best **partition** the field on the player's own average (`diff < 0` against
`diff >= 0`) rather than on rank, because that is what makes a matchup a
weakness instead of merely the lower half of a list. On the test account: 7
worst + 10 best = 17 analyzed, no overlap, no gap. Each heading carries the full
count so it describes the list rather than the first page.

### Layout: stacked lists, bigger cards

Worst and best matchups sat in two half-width columns, which is what forced the
deck strip down to 26px and pushed the meter out of the row entirely — a row
carrying eight card images, a name, three figures and two chips does not fit in
half a panel. They are stacked now, at full width, and the cards are 38px with
the meters back. The versus panel's decks are 54px, the target tile's 40px, and
**Compare decks** is centred because it sits under two paste boxes and acts on
both; hanging it off the left tied it visually to Deck A alone.

One sizing note worth keeping: the target tile's cards are 40px rather than 46
because the stat tiles are a `minmax(11rem, 1fr)` auto-fit grid — three across
at 1500px is ~343px inside the padding, and eight 46px cards plus gutters is
396px, which wrapped the eighth onto a line of its own.

### The rows only line up if every column is a definite width

Each row is its own independent CSS grid, so nothing forces one row's tracks to
agree with the next one's — they agree only if every track resolves to the same
width from the rule alone. The last track was `auto`, sized to the evidence chip
inside it, and that chip reads "Low" on one row and "Medium" on the next: 33.8px
against 53.7px. Different leftovers per row meant the flexible name column came
out 101.8 / 118.1 / 121.6px, so **one list had three different left edges for
its card strips**.

The chip column is now fixed at 3.6rem — measured from the widest of its four
labels, 53.7px — leaving the name as the only flexible track, which then
resolves identically everywhere. Verified rather than eyeballed: a browser check
asserts that every list has exactly one distinct deck-start x, across all four
tables.

### The rest of it

* **Only archetypes that actually beat the target are listed.** Ranking the
  field and taking the top five hands back a "counter" at 48.3%, which is the
  opposite of one. A short list is the honest answer, and the screen says how
  many archetypes were weighed to get it.
* **Counter advantage** is measured against how the field does against that
  target, not against 50 — that is what makes it an advantage rather than a
  percentage.
* **The player tab needs no snapshot.** `battles.opponent_win_condition` is
  stored and 100% populated, so that query is ~40 ms and the date window drives
  it directly.
* **The matrix is a background snapshot**, on meta.py's pattern — the join of
  1.96M pairings to a 1.05M-row deck table costs ~60 s, so it can never run
  inside a request. Persisted to `server/.counter_snapshot.json`, refreshed
  hourly (`CLASH_COUNTER_REFRESH`), and every response carries its age.
* **Play styles are editorial and say so.** The database stores a win condition,
  which is a card, not a play style. The seventeen archetypes are mapped to
  Beatdown / Control / Siege / Cycle / Bridge Spam in one place, and the UI
  states the grouping is a judgement call.
* **Every row draws a real deck, and it costs nothing.** A matchup row naming
  "Graveyard" and showing no cards is a row you cannot act on, so each one
  carries eight cards with their evolution art. The decks are not invented per
  archetype: the CURRENT meta board is asked for one. Its top 50 covers all
  seventeen archetypes, every entry is a deck real players are running this
  week, the art is already resolved on it, and it is a snapshot that exists
  either way. While that snapshot is still building the rows simply render
  without art rather than failing.
* **An unknown deck is classified with the bot's own map.** `WIN_CONDITION_MAP`
  and `WIN_CONDITION_PRIORITY` are carried over unchanged, because every stored
  `decks.win_condition` was written by the function that reads them. Checked
  rather than assumed: both tables compare equal to the bot's live source, and
  the two classifiers agree on **5,000 of 5,000** random eight-card decks.
* **Every archetype's deck is its most-played one**, which is the bot's own rule
  for a representative (`deck_search._archetype_representative`: "the
  most-observed deck of an archetype"). The meta board is ranked by use rate and
  all seventeen archetypes appear in its top 50, so the first hit per archetype
  *is* that archetype's most-played deck. Verified: 17 distinct decks, each
  containing its own win condition, average overlap 0.82 of 8 cards.

  When the rows looked alike it was never the deck choice — see
  [Observation beats inference](#observation-beats-inference-and-for-a-while-it-did-not).

---

## Coach Assist — mid-duel help

Two windows over `server/coach.py`, ported from the bot's duel advisor:

| window | the bot | asks | answers |
|---|---|---|---|
| **Duel Prediction** | `!predict` / `!predict2` / `!predict3` | one tag | which decks they open with, and what is still legal after each reveal |
| **Suggestion** | `!suggestion #YOU [#THEM]` | your tag; the opponent comes from the route | the same read, then YOUR still-legal decks ranked by expected win rate |

### The history is windowed — 15, 30, 45 or 60 days

Both windows used to read **everything** stored for a player, which quietly
answers a different question from the one a duel asks: a deck they ran daily six
weeks ago counted exactly as much as the one they ran this morning.

One control in the header governs both, because the prediction and the
suggestion read the same history and letting them disagree about its span would
mean the screen contradicted itself. Default 30 days, matching every other
player screen.

**`days` counts back from that player's last stored battle, not from today** —
the site-wide convention, and the reason someone who stopped a month ago still
gets a populated screen instead of an empty one with no explanation. In Window 2
it is resolved **separately for each of the two tags**, so one "30 days" means
thirty days of *each* player's play rather than one calendar range that may be
empty for whichever of them stopped sooner. Measured on a real pair: at 15 days
the spans came out `08-12 → 08-26` for one player and `08-11 → 08-25` for the
other.

**It changes the answer, which is the point.** For one tracked player:

| window | series | games | top predicted deck |
|---|---:|---:|---|
| 15d | 45 | 132 | mortar / goblinstein / elite-barbarians |
| 30d | 90 | 271 | elite-barbarians / valkyrie / battle-ram |
| 45d | 122 | 357 | baby-dragon / berserker / royal-hogs |
| 60d | 139 | 407 | baby-dragon / berserker / royal-hogs |

**The decks stay the player's own.** Meta filler was already flagged `fill` by
the server and labelled "meta deck" in the UI, and across all four windows above
the fill count was **zero** — these are decks that player actually ran. A
narrower window has less history and so will reach for filler sooner; that stays
visible rather than being smuggled in as a personal read.

**Nothing widens itself.** A 15-day window can legitimately come back thin, and
`summary` (Window 1) and `evidence` (Window 2) report what it actually held, so
a thin answer is visibly thin. There is deliberately no automatic fallback to a
longer span here — unlike Duel Analysis, where the widening is the answer to a
different question. The cap is the control, and silently ignoring it would make
the control a lie.

**A window is not a second database read.** `_history` already cached per
`(tag, since, until)`, so this cost nothing but the plumbing.

### The rule the whole feature rests on

A duel loadout is three decks that **cannot share a card**. That is what makes
any of this predictable: every deck revealed removes eight cards from what a
player can still bring, and by game 3 the field is usually down to a handful of
lists they actually own. Nothing here models a personality — it is the card
constraint plus that player's own history.

### Both windows are interviews, not forms

A duel has a state — nothing played, one deck shown, two shown — and the useful
answer is a *different question* at each one. A single form with every field on
it would ask a coach mid-duel to work out which boxes apply. One question at a
time cannot be got wrong, and the step you are on IS the state of the duel:

```
Duel Prediction   Has the duel started?
                    No             -> their opening decks
                    One game       -> paste their game-1 deck -> game-2 read
                    Two games      -> paste both their decks  -> game-3 read

Suggestion        Who are you coaching?   (the opponent is LOCKED to the tag
                                           this analysis is already open on)
                  How far in are you?  none / 1 game / 2 games
                    -> paste each deck played, yours then theirs, per game
                    -> the recommendation
```

The three stage answers wear a hue each — **green** nothing played, **blue** one
game, **violet** two — and the same stage is the same colour in both windows, so
the mapping is worth learning once. They are three parallel statements about the
state of the duel rather than one recommended action plus alternatives, which is
what a single pink button and two outlines had implied.

The opponent is locked because every other screen in this view is about them;
letting one box disagree would put two different players on one screen with
nothing saying which was which. Change it by searching a different tag.

The flow state lives in the component and nowhere else; the server holds nothing
between calls. A reload therefore lands on question one rather than resuming a
duel that has since finished.

### What the result shows, and what it deliberately does not

Two things were on the prediction screen and were taken off:

* **The stats line** — "ranked by their game-1 picks across 268 ordered duel
  series · 268 series / 800 duel games stored". It described the query rather
  than the answer. What survives is the one caveat that changes what the list
  *means*: when there are too few ordered series, a line says the ranking is
  their overall play rate and not a read on their opening at all.
* **A "6% likely" beside every deck.** The list is already in order and the rank
  says the same thing without asking anyone to compare six small percentages
  mid-duel. Figures stay where the number *is* the answer — the Suggestion's
  expected win rate, and the opponent distribution it is computed against.

Card strips flex to fill their column with a max size rather than sitting at a
fixed width, so the eight cards are as large as the panel allows and never wrap.

### The opening is a different claim from the play rate, and this data supports it

"They open with this" can only be read off series whose game order is real. A
friendly/practice duel stores one row per game, so its order is time order; a
NATIVE duel stores the whole loadout in one row and the bot is explicit that
those 8-card blocks are *"not proven chronological"* — block 1 is not
necessarily game 1.

Measured across the twelve most-played tags:

| | |
|---|---:|
| duel series | 759 |
| reconstructed, i.e. ordered | **718 (94.6%)** |
| full ordered three-game series | 587 |
| native (loadout only) | 41 |

So the opening question is answerable for almost everybody here, which is the
opposite of the bot's situation. Where it is not — under three ordered series —
the screen falls back to overall duel play rate and **says so**, because "what
they open with" and "what they play a lot" are different claims.

### Their real duel loadouts, which are not a prediction at all

Everything else on both windows ranks what a player *could* bring. Once a deck
is pasted, `observed_sequences` goes back through their duel log and returns the
**whole three-deck loadouts they have actually run that contain it** — grouped,
counted, with the win record and the date, and with the pasted deck flagged so
the other two read as the answer.

A duel is not three independent picks; it is one loadout a player builds and
reuses. So the useful reply to "he played this" is the rest of the bag, not a
list of loose candidates the reader has to reassemble.

**It matches the deck anywhere in the loadout, and that correction mattered.**
The first version anchored on game 1, reasoning that "when they *opened* with
this, they followed it with that" is the sharper claim. It is — and it is the
wrong question, because a coach pastes the deck they have just *seen*, which is
game 2 as often as game 1. Measured over 40 decks these players really ran but
not necessarily first:

| | |
|---|---:|
| anchored at game 1 | 62 series found |
| decks that returned **nothing at all** under the anchor | **20 of 40** |
| matched anywhere in the loadout | 224 series |

Every one of those 20 has a recorded loadout. It was reported from the screen as
"he has a duel set where he played this deck" against a blank panel, and that is
exactly what it was.

**Native duels count here too**, which is the other half of the same fix. A
native row stores the whole loadout in one row and the bot records only that its
8-card blocks are *"not proven chronological"*. That makes the **order**
unusable, not the **membership** — and membership is most of the answer. Those
rows are included and flagged, so the UI prints "game order not recorded"
instead of inventing a sequence, and the header counts them separately.

The rest of the rules:

* **Grouped by loadout, ranked by how often.** Series are clustered position by
  position at the project's usual 6-of-8, so a tech swap in one slot does not
  split one habit into two. Each row carries `3× run · 1W–2L · last 11 Aug`,
  which is the difference between "they do this" and "they do this and it works".
* **The representative per slot is their most-played exact list**, never a
  synthetic average — the same rule `cluster_player_decks` follows, because a
  deck that was never played is not a deck they can bring.
* **Where they brought it is stated** — "played it as game 2" — since opening
  with a deck and answering with it in game 3 are different reads.
* **Exact vs variant is labelled.** On one account's top opener only 2 of 7
  matches were card-for-card.
* Above the loadouts, the decks that travel with it are merged across every
  match, which answers "what else is in the bag" in one line.

Two reveals require both decks, consecutively and in order where the order is
known. When nothing matches it says so and states how many duels it searched.

### The model is ours, and it is card-sensitive

The bot scores candidates with a trained gradient-boosted matchup model loaded
from artifacts on disk (`archetype_predictor`, `tree_runtime`) and falls back to
nothing when they are missing. That is not portable into a stdlib-only service,
and it should not be — this project already has a better grounded answer in
`deck_counter`, and it is the one the Deck Counter screen shows.

Expected win rate therefore comes off the evidence ladder — exact pair, this
exact list vs that archetype, lists one and two cards different, archetype vs
archetype — and **every number carries the rung it came from**. Two consequences:

* **it is card-sensitive.** Swap one card and the deck hash changes, so a
  different set of battles is counted. A trained archetype model returns the
  same figure for every Hog list.
* **it is symmetrised.** `_symmetric` cancels the 58.6% tracked-player bias,
  checked by every mirror landing at exactly 50.0%.

**Walked lazily, and that is not a micro-optimisation.** `matchup_ladder` builds
every rung because its caller displays the whole backoff, and the ≥7-card
cluster scan costs **11.6 s cold** against 0.17 s for the deck's own profile.
The Coach asks for a grid of these — six of my decks against three of theirs —
so building rungs nobody reads took `suggest` to **25.7 s**. Stopping at the
first rung with evidence takes it to **2–3 s** and the answer is identical: the
head of the ladder is the reading either way.

### Three rules that keep the advice honest

* **A recommendation is stricter than a prediction.** The companion predictor
  tolerates two shared cards because it reads noisy pooled history; a deck we
  tell someone to play *next* must share **zero** — they physically cannot play
  it otherwise. The bot shipped the looser rule into its recommendations once
  and told a player to bring a Golem deck repeating Lightning and Baby Dragon.
* **An unscorable matchup is dropped, not guessed at 50%.** An invented coin
  flip drags a real edge toward the middle and makes two genuinely different
  candidates look alike. The probability mass that *did* have evidence is
  returned as `weight`, so a reader can discount the figure.
* **Meta decks that top up a thin list are labelled**, and their history keeps
  70% of the probability mass (`OPP_HISTORY_MASS`). "What they play" and "what
  people play" are different claims and the row says which it is.

### What is deliberately not modelled

Counter-sniping — "they just showed Hog, so they will bring the anti-Hog deck".
The bot measured it on 3,569 leak-free trials and it made top-1 accuracy **three
times worse** (8.3% → 2.7%). The deck a player actually brings scores 0.4856
against the opponent's last deck versus 0.4961 for the average deck they could
have brought: players do not counter-pick the previous game. Recency weighting
and per-opponent tendency were tested the same way and neither beat plain usage.

So the read narrates evidence and never invents a tendency. Every line of it is
either a fact we hold or the ranking already computed, and the confidence is
graded out loud — a real edge above 15 points, a slight one above 6, a coin flip
below that.

### Colour, by meaning

Violet the prediction, **pink the opponent's side wherever it appears**, blue
yours and anything stating evidence rather than outcome, green an observed fact
and the recommendation to act on. Blocks carry `data-hue` and resolve one
`--tone` variable that their children read, so a section's identity is set once
at its edge. Level 3 of the ladder — the raw hue — appears only on a rail, a
rank chip, a bar; large surfaces stop at the 8% wash.

---

## Colour: how it was chosen

All colour lives in `src/index.css` as tokens — it is the single source of
truth, and no component defines a colour of its own.

### The neutral ground

Dark is black/grey/white, light is white/black, both derived from published
practice (Radix Colors' 12-step semantics, GitHub Primer, Linear, Vercel) rather
than picked by eye. Two rules from that research drive the values:

- **Never a pure black ground and never pure white text** — the halation makes
  body copy vibrate.
- **Light mode elevates by making the page grey and the card white.** The first
  attempt had a `#FFFFFF` page with `#FBFBFB` cards, i.e. cards *darker* than
  the page they sat on, which is why they read as sunken.

The ladder is shallow and evenly spaced so page, sidebar, card and input are all
separable without any of them being pure black or white:

| | page | panel | nested box | well |
|---|---|---|---|---|
| dark | `#111111` | `#1A1A1A` | `#141414` | `#0D0D0D` |
| light | `#F4F4F6` | `#FFFFFF` | `#F8F8FA` | `#F1F1F4` |

About seven points of 8-bit lightness per rung, in both directions, and the
governing rule is **nesting goes down, never up** — see
[The UI pass](#the-ui-pass--surfaces-selection-and-navigation) for why.

### The five hues

The interface is **primarily neutral**; these are accents distributed across it,
not a theme. One hue means one thing, everywhere:

| Hue | Means | Dark | Light |
|---|---|---|---|
| **violet** | you are here / selected | `#A78BFA` | `#6D28D9` |
| **pink** | the primary thing to click | `#F472B6` | `#C81E69` |
| **blue** | neutral information | `#5B8DEF` | `#1D4ED8` |
| **green** | positive outcome | `#34D399` | `#047857` |
| **red** | negative or destructive | `#F87171` | `#C02618` |

All ten clear **4.5:1 against every surface they sit on**, and both CTA hues
carry white text at 4.5:1+, so a filled button needs no per-theme text colour.
The dark column is re-stepped for the dark ground, never a dimmed light value.

**Three intensity levels**, defined once in `index.css` and mixed against the
card surface so both themes derive from the same ladder:

| Level | Strength | Used for |
|---|---|---|
| 1 — wash | ~8% | hover, icon-tile backgrounds |
| 2 — fill | ~14% | the selected state's background |
| 3 — raw hue | 100% | icons, borders, numbers, meters, buttons |

**The raw hue only ever lands on small things.** That single rule is what keeps
a neutral interface neutral while still reading as coloured — a large surface
never goes past level 2.

**A tint must be mixed against the ground it will actually sit on.** The ladder
above mixes against the card, so a control whose resting fill is
`--surface-sunken` got a step made of two parts: the tint, plus the gap between
the card and the well. In light those cancel — tint and well both go darker. In
dark they compound: the tint goes lighter while the well goes darker. Sampled
off the rendered page in OKLab, one selected control measured **13.9 dE in dark
against 5.7 in light** — the same control reading as a bold slab on one theme
and a whisper on the other, which is exactly what "the themes look different"
meant. `--accent-select-fill-sunken` and friends mix against the sunken surface
instead, and the same control now measures 9.6 / 8.1. Use them only where the
resting background really is sunken; on a card or a glass panel the plain ladder
is already correct.

Not everything needed it, and the measurement said so: the duel series' win and
loss tints sat at 3.1 dE dark against 3.3 light already. Re-grounding those
against the panel pushed the green to 1.48x the light one, so they were put
back.

Two CTAs bend "pink means primary action" on request: the home screen's
**Analyze** button is green and the sidebar's **Upgrade Now** is blue. On that
page hue already reads as identity (each tool panel wears its own), and the
sidebar card is an aside rather than the page's primary action.

Both forced a token that has since become general. **Text on a solid fill of any
hue is `--on-hue`** — `#0B0B0B` in dark, `#FFFFFF` in light. White is unusable
on the dark steps (1.6:1 on the green, 3.3:1 on the blue) precisely *because*
they are bright enough to read as text on a near-black page; against the ground
colour all five clear 6:1. `--success-text` and `--accent-info-text` are now
aliases of it. A filled control never has to know which hue it is wearing, which
is what made a per-section coloured sidebar cheap to build.

| on a solid fill | violet | pink | blue | green | red |
|---|---|---|---|---|---|
| dark, `#0B0B0B` text | 7.3 | 7.5 | 6.1 | 10.3 | 7.2 |
| light, `#FFFFFF` text | 7.10 | 5.46 | 6.70 | 5.48 | 5.95 |

Components opt into a **role**, never a colour: `--accent-select`,
`--accent-action`, `--accent-info`, `--success`, `--error`. `--accent` stays
neutral, because a hue that sometimes means "selected" and sometimes means "bad"
teaches the reader to ignore it.

Identity is a separate axis from selection: sidebar sections and tool panels
wear a hue on their **icon tile** so an area is recognisable at a glance.

Selection used to be violet everywhere regardless of that identity hue. **In the
sidebar it no longer is** — the open row fills solid in its own colour. The
reasoning and the one place the old rule still holds are in
[The UI pass](#the-ui-pass--surfaces-selection-and-navigation).

### Contrast and focus

Every pair was checked numerically. The earlier neutral pass needed
`border-strong` and `rarity-common` nudged after they fell to 2.88:1 and 2.97:1.

There was **no `:focus-visible` rule anywhere** in the codebase and a dozen
`outline: none` declarations removing the browser default, so keyboard users
could not see where they were. `index.css` now carries one global 2px violet
ring at 2px offset. Selected states also carry a leading edge, a border and a
text-colour change, so meaning never rests on hue alone.

### The chart and data colours — a deliberately separate system

**The UI accent system and the data-visualisation palette have different jobs
and must not be merged.** UI colour communicates interface meaning; chart colour
communicates data, and only the latter has to survive being compared without a
label attached. Re-encoding the charts to match the UI hues would trade a real
property for a cosmetic one.

Concretely: the reference dashboard's own blue and violet fail CVD separation —
ΔE **4.5** under deuteranopia and **14.5** even with normal vision, below the 15
floor. Its two middle progress bars are genuinely hard to tell apart. Copying
that would be copying a defect.

Computed with the palette validator, not eyeballed:

| Role | Light | Dark | Kind |
|---|---|---|---|
| Use Rate | `#2a78d6` | `#3987e5` | categorical |
| Win Rate | `#169b6b` | `#199e70` | categorical |
| G1 / G2 / G3 | `#9376d8` `#6a4fbe` `#402f96` | `#cabff8` `#9a8ded` `#6f61d6` | **sequential** |

The two categorical hues pass the lightness band, chroma floor, CVD separation
(ΔE 20.7 protan light / 19.6 deutan dark) and 3:1 contrast in both modes. Their
tritan separation is under the floor, which is legal only with a secondary
encoding — each meter prints its own percentage beside it.

**G1/G2/G3 is a sequential ramp, not three categorical hues.** They are ordered
positions in a loadout, so one hue running light-to-dark says "first, second,
third" where three unrelated colours would only say "three of something".
Lightness is monotonic with even steps (OKLab L 0.636 / 0.514 / 0.392 light,
0.833 / 0.695 / 0.566 dark) and every step clears 3:1.

The dark column is **re-stepped against the dark surface**, never an automatic
flip of the light one.

Two more rules held throughout: categorical hues are assigned in fixed order and
**never cycled** (an early chart put two identical blues on one plot via `i % 8`;
anything past the eighth series now folds into one muted "Other"), and there is
never a dual-axis chart — two measures of different scale get two charts.

---

## The UI pass — surfaces, selection and navigation

The brief was a sweep rather than a feature: *"check the boxes part whatever is
left from page to page, highlight, border etc, in light and dark mode both"*,
plus four specific complaints. Everything below is one of those complaints
traced to its cause.

All of it lands in `src/index.css` where it can — twenty stylesheets reach for
the same tokens, so the fixes that changed a token changed every page at once.

### Glass is gone. Every panel is solid

The whole app was frosted: `--glass-fill` was `rgba(255,255,255,0.05)` in dark
and `rgba(255,255,255,0.66)` in light, over a `backdrop-filter: blur(18px)`.
The request was blunt — *"if the glass panels are not working then make them
solid but with good colour retention"* — and it was right. Three things were
wrong with it:

- **In light it barely was a panel.** 66% white over a near-white page is a
  near-white box, and its `--glass-stroke` was *white at 85%* — a white edge on
  a white surface. Light had boxes with no edges while dark had crisp ones. That
  alone accounts for most of "the themes look different".
- **The fill moved as you scrolled.** A translucent pane refracts whatever is
  behind it, so a sidebar's contrast drifted with the page wash sliding past.
- **It cost a compositing pass per pane**, on a project whose first revamp step
  was removing animation for speed.

The four tokens are now flat colours. Nothing else had to change: a blur behind
an opaque fill paints nothing, so the ~67 `backdrop-filter` declarations still
scattered across 21 component files are inert. They were **left in place on
purpose** — each also creates the stacking context that this app's portalled
menus are already positioned against, and removing them is a z-order change
dressed up as a cleanup.

Two supporting changes:

- **The light page dropped to `#F4F4F6`** from `#FBFBFC`. A white panel needs
  somewhere to be raised *from*, and 1.6% of lightness is not it. Page-to-panel
  is now 11 points of 8-bit lightness in light against 9 in dark — matched.
- **`--shadow` in dark became `0 0 0 0 transparent` instead of `none`.** Panels
  want `box-shadow: var(--shadow), inset 0 1px 0 var(--glass-sheen)` so light
  gets elevation and dark gets its top sheen from one declaration — and `none`
  inside a shadow list is a syntax error that silently drops the whole rule.

### Nesting goes down, never up

This is the rule the solid switch forced, and it is worth stating on its own.

Translucent panes **compound**: glass on glass came out lighter, so a deck panel
inside the builder's panel read as raised without anyone specifying how. Solid
fills do not compound. A nested box painted with the same token as its parent
now paints *exactly* the parent's colour and vanishes, leaving only its border.

Light was already stuck this way even when the glass worked, because there is
nothing above `#FFFFFF` to raise into. So every level of nesting steps **toward
the well** — the one direction both themes can travel equally far:

| | page | panel | nested box | well |
|---|---|---|---|---|
| dark | `#111111` | `#1A1A1A` | `#141414` | `#0D0D0D` |
| light | `#F4F4F6` | `#FFFFFF` | `#F8F8FA` | `#F1F1F4` |

`--surface-nested` is the rung that got added. It exists because the first fix
sent nested boxes straight to `--surface-sunken` and collided with the controls
already living there — a deck slot inside a deck panel came out the exact colour
of the panel. Reclassified accordingly: deck panels, saved groups, palette
folder cards, segmented tab strips and header icon tiles are **nested boxes**;
meter tracks, date inputs and code blocks are **wells** and stayed put.

A related bug in the same family: `--glass-fill-strong` means "one step more
raised than a panel", which in light resolves to `#FFFFFF` — the panel colour.
Every control using it *inside* a panel was invisible in light mode. Those were
regrounded rather than given a new value.

### The sidebar: solid, and a colour per section

*"the left bar when i select options it's like purple but make solid, lets drop
glass panel and colour it with green blue pink different for options."*

The selected row was a 14% violet tint, because violet means "you are here"
everywhere in this app. On a sidebar that rule stopped paying its way. Only one
row can be selected, so there is nothing for the violet to *disambiguate* — and
it discarded the one thing the rail already had, which is that each section owns
an identity hue for its icon tile.

The open row now fills **solid in its own hue**. Duel Analysis lights green,
Cards blue, Deck Counter pink, Search Player violet. You can tell which section
is open from the corner of your eye, which is the actual job of a selected state
in a rail you are not looking at.

- Text is `--on-hue`, so no row has to know its own colour.
- The icon tile inverts on the filled row — a 20% scrim of `--on-hue` with the
  glyph punched out — because a tile cannot wear the same hue as the slab under
  it.
- Hover stays **neutral**. Hover means "clickable", not "selected"; if hover
  were also hue-tinted the two states would compete.
- The old violet leading-edge bar was dropped. Meaning still does not rest on
  hue alone — a filled row differs from its neighbours in lightness and weight,
  which is a difference a monochrome screenshot survives.
- The 4-hue cycle repeats across 7 sections. That is fine and deliberate: every
  tile sits directly beside its own label, and no two *neighbours* share a hue.

**Violet-means-selected still holds everywhere else** — tabs, range chips, the
focus ring, card slots. The sidebar is the exception, with a reason.

### The rail collapses, and the space goes into bigger elements

A round chevron button rides the sidebar's right edge — the same puck as the
theme and notification buttons, so it reads as one of the app's controls rather
than something invented for this panel. Pressing it hides the rail and reclaims
**226px** of the 252px it occupied.

Four things make it work rather than merely function:

- **The button is positioned against `.body`, not the sidebar.** The sidebar is
  `overflow-y: auto`, which clips a child at `right: -14px` and hands you a
  scrollbar instead of a button.
- **It stays put when the rail goes**, tucked against the screen edge with the
  arrow reversed. A control that hides along with the thing it hides is a
  control you cannot undo.
- **The body reserves a ~26px lane for it in the collapsed state.** Floating it
  over the panel instead put it 2px from the header's icon tile — measured, not
  guessed. The lane costs a tenth of what collapsing gained.
- **`--rail` is one variable.** The grid track, the toggle's position and the
  gutter all read it, so collapsing is one declaration instead of three that
  can drift.

**The reclaimed width buys BIGGER elements, not more of them.** This is the part
that needed a decision. The card grid is `repeat(auto-fill, minmax(6.1rem, 1fr))`,
so left alone it would have spent 226px on two extra columns of the same small
tiles — the opposite of the point, which is legibility. The state is therefore
mirrored onto `<html data-rail>` (the `data-theme` pattern, because a CSS module
cannot see a parent's class from another file) and the grid raises its floor to
7.4rem when the rail is closed. Measured at 1500px: a tile goes **100px → 120px**
and its art **70px → 84px**, at the same 11 per row.

6.1rem is still the measured floor from the density work; 7.4rem is above it, so
the two-rates-on-one-line constraint that produced that number is untouched.

The choice persists in `localStorage`, because a collapsed rail is a working
preference and having it spring back on every reload is how a control stops
getting used. Below 860px the rail is already hidden by media query, so the
toggle is hidden too — a button that does nothing on press is worse than none.

### The four cards on the home screen

*"the 4 cards on the main screen in the analyze section are opacity, make them
visible."*

They were at `opacity: 0.4`, which on the frosted panel left four grey smudges
rather than four cards. Now fully opaque, with a soft drop shadow so they sit
*on* the panel instead of floating in it. The composition is held back by size
and corner placement instead, which is the honest way to do it — they are far
enough out of the centre column to sit behind nothing.

### Navigation: Home and the brand actually go home

*"clicking on home doesn't return to the main page, and also clicking on
RoyalArena top doesn't make it return home."*

Two separate faults, and the interesting one is not the route.

**Going home is two things, and only one was wired.** Which screen the home view
shows is `section`, component state that the sidebar and the analytics area
cards both write to. Both Home and the brand moved the URL and nothing else — so
after opening Deck Counter and clicking Home, the route went home and the panel
did not, because `section` still pointed at the area you had just left. You
landed straight back on it. `goHome()` resets the section *and* navigates, and
both controls call it.

**The home route is `#/`, not `''`.** `location.hash = ''` strips the fragment
rather than setting one, so the next attempt to go home was a genuine no-op —
assigning `''` to an already-absent hash changes nothing and fires no
`hashchange`. `#/` matches no route prefix, so it still resolves to the home
view, and it is a real value that can be compared against.

Also fixed while in there:

- **The player view had no Home control at all.** That screen swaps the entire
  nav out for the query row, leaving the brand as the only way back with nothing
  saying so. The row's static "Analytics" chip — decoration restating the screen
  you were already looking at — is now the Home button.
- The top-bar lit item distinguishes **Home** (landing search showing) from
  **Analytics** (an area open), which it previously could not.
- The brand and every chip, icon button and tool panel gained a hover state; the
  hero search field takes its focus ring on the wrapper rather than on the
  borderless input floating inside it.

### One hardcoded colour, and it was the light/dark bug in miniature

`.toolCta` — the call-to-action on each home-screen tool panel — painted
`color: #ffffff` on a background of the tool's identity hue. Correct for all
five hues in light. Wrong for all five in dark, and worst on the green panel at
**1.6:1**: white text on a mint slab. It is now `--on-hue`, never below 6:1.

This was the *only* hardcoded colour left in any component stylesheet, which is
the point — the discipline of keeping colour in tokens is what made the rest of
this pass a handful of edits instead of a survey.

**And the same bug was hiding in a token that claimed to be safe.**
`--accent-action-text` was the literal `#ffffff`, with a comment asserting that
white clears 4.5:1 on both accent hues in light *and* dark. Measured, it does
not:

| | white on it | `--on-hue` on it |
|---|---:|---:|
| pink, light | 5.46:1 | 5.46:1 |
| **pink, dark** | **2.65:1** | **7.43:1** |
| violet, dark | 2.72:1 | 7.23:1 |

A hue light enough to read against a dark page is far too light to carry white
text, so "white works on the brand colour" cannot survive a dark theme whatever
the brand colour is. The token now resolves to `--on-hue`, which fixes **every
filled primary button in the app at once** — ten component stylesheets pair it
with `background: var(--accent-action)` and all ten were failing in dark. Light
is untouched, because `--on-hue` is `#ffffff` there.

Caught by the Coach Assist verification rather than by review: its primary
button is the same pair, and the sweep flagged the *top-bar Search button*
alongside it — which is how a screen-wide check finds a bug that predates the
screen.

### Cards sorts by use rate

*"in the cards section make them descending by use rate, right now its win rate
order."*

Done, and the default was wrong for a reason worth recording: sorting by win
rate put the board's own caveat at the top of it. The highest win rates belong
overwhelmingly to the cards with the fewest battles behind them, so the opening
screen was a list of cards the player has barely touched. Use rate is a count —
no evidence floor needed — and "what do they actually play" is the question a
card board gets opened to answer. Win rate is one select away and still ranks
evidence-first when chosen.

### Card art gets one box, and it is the card's shape

The art PNGs are **not one shape**. A base card is 302×363; the evolution frames
run from 287×384 to 553×793, and the hero frames add a third. Any strip that
sizes a card by width alone therefore reflows the moment a deck fields an
evolution — which is most decks.

Two screens were still doing it, and each got a different symptom:

| screen | rule | what happened |
|---|---|---|
| Top Meta Decks | width only | `align-items` defaulted to `stretch`, so every image in a row grew to the tallest in it. **Seven distinct card heights** on one board, 65.9px to 77.4px, and a plain Arrows drawn **16.2% taller than its own artwork** purely because it sat next to a Lumberjack evolution |
| Player top-10 decks | `aspect-ratio`, no `object-fit` | heights were uniform, but the default `fill` **squashed** off-shape art into the box — Cannon's evolution 5.6% out, Lumberjack 19% |

Both now use what the Deck Counter and Duel Zone strips already used: a box
fixed to the base card's `aspect-ratio: 302 / 363`, `object-fit: contain` so the
art letterboxes inside it instead of stretching, and `align-items: flex-start`
so a row can never resize its own contents. The saved-group previews and the
duel combo pairs were missing the same property and got it too.

**A deck is eight cards on one line, so the strips flex.** The Deck Counter's
were fixed widths with `flex-wrap: wrap`, which is the wrong pair of rules
together: a fixed width has to suit the narrowest column it will ever sit in, and
wrapping to 5 + 3 stops a deck reading as a deck. They are now `flex: 1 1 0` with
`nowrap` and a `max-width` cap, so eight cards take an equal share of whatever
the column has. The matchup-row column also stopped being a fixed `21rem` —
that was what actually capped the size — and became `minmax(21rem, 27rem)`.
Measured: pasted decks **58 → 76px** a card, matchup rows **39.4 → 51.4px**, no
strip on more than one line, no horizontal overflow.

Measured before and after, same probe: **7 heights → 1** (64.9px), and painted
art now matches its own proportions exactly on every screen. The cost is a few
transparent pixels either side of a tall evolution frame, which is the trade the
rest of the app had already made.

### How it was verified

80 assertions, run twice — once per theme — with Playwright against the live
dev server, then the script deleted and the dependency uninstalled per the
project's usual pattern. What they check:

- every large box paints an **opaque** fill, and differs from the page behind it
- **no** element wider than 200px is left with a background alpha between 0.02
  and 0.9 — i.e. no frosted pane survived anywhere
- each of four sidebar sections selects to *its own* hue, matched against the
  computed `--hue-*` token, with `--on-hue` text
- Home, the brand, the brand from inside a hosted tool, and the player view's
  Home chip all return to the landing search, and the hash lands on `#/`
- Cards defaults to `use` and the first 25 tiles run monotonically descending
- four analytics screens have no horizontal overflow

The panel-opacity check failed six times on the first run and all six were the
probe's fault — three screens wrap their panel in a transparent layout div and
the selector grabbed the wrapper. Worth noting because a failing assertion is
not evidence until you have read why it failed.

---

## The display face, and the one property that decides it

Headings are set in **Kids Word**, replacing Subscribe. A swap is one
`@font-face` plus a find-and-replace across seventeen stylesheets, because the
face is only ever named in a font stack — but two things about it are worth
recording, both learned by trying the wrong file first.

**Check the first four bytes.** jsPDF embeds TrueType only; it has no CFF parser.
An OpenType/CFF face (sfnt tag `OTTO`) produces a PDF report with *no headings
and no error* — the export succeeds and the type is simply missing. Of the faces
tried:

| face | sfnt tag | outlines | can the PDF use it? |
|---|---|---|---|
| Relidux `.otf` | `0x00010000` | TrueType *despite the extension* | yes |
| Newscrash `.otf` | `OTTO` | CFF | no |
| Super Jello `.ttf` | `0x00010000` | TrueType | yes |
| Bebas Neue `.ttf` | `0x00010000` | TrueType | yes |
| **Kids Word `.otf`** | `OTTO` | CFF | **no** |

So the report keeps `Subscribe.ttf` and the export and the site currently wear
different display faces. That is a real, visible divergence, and it is recorded
in `pdfRenderer.ts` beside the code that causes it rather than only here.

**A display face is not a fixed width.** The home headline was
`clamp(2.4rem, 5vw, 4.6rem)` with `white-space: nowrap`, tuned to Subscribe. A
face a third wider measured 1040px inside an 880px panel at a 1280px window — it
did not wrap, it ran out the side. It is 4.2vw with `text-wrap: balance` now, and
an overflow sweep across the screens at two widths is what caught it. Bebas Neue
also showed the other end of the same problem: it has **no lowercase at all**, so
anything in the display face renders as caps whatever the string says, including
a deck name someone typed.

Serve any face under a space-free name. The source files are "Super Jello.ttf"
and "Kids Word.otf"; a space in a URL is one percent-encoding mistake away from
a 404 that falls back to Inter and looks like nothing happened.

### Six screens never used the display face at all

`MetaDecks`, `DuelAnalysis`, `DuelZone`, `PlayerCards`, `DeckCounter` and
`CoachAssist` set their headings in `var(--font-display, inherit)` — and
`--font-display` **is not defined anywhere in the project**, so all eighteen of
those declarations have always silently resolved to Inter. They are unaffected by
a font swap because they were never wired to one. Recorded rather than fixed: it
is a decision about which screens carry the display voice, not a bug in the swap.

---

## "Why is Evolutions 0?" — two emptinesses that shared a sentence

Reported against a real tag. The counting was right and the screen was wrong.

`#G9YV9GR8R` has **0.0% evolution coverage**: not one of their 269 duel decks in
the window carries a `player_evo` mark. The Evolutions predicate needs both cards
to have been *observed* in an evolution slot — never merely `can_evolve` — so
zero candidates is the correct answer. The predicate itself is fine, and other
players prove it:

| tag | duels | evo coverage | Win Cons | Spells | Evolutions |
|---|---:|---:|---:|---:|---:|
| `#G9YV9GR8R` | 96 | **0.0%** | 103 | 15 | **0** |
| `#C00CRGG2P` | 94 | 40.6% | 83 | 14 | 25 |
| `#9GJ0Q0LGG` | 74 | 58.2% | 79 | 10 | 19 |

**The bug was what the screen said about it.** An empty tab printed "no
combination clears the evidence floor yet", which claims the pairings existed
and were too thin — so an evolution-heavy player read as someone who fields no
evolutions. Those are different facts, and `_evo_marks` goes out of its way to
keep them apart:

> returns None for "we were never told" precisely so that stays distinct from
> "they ran none"

The data layer preserved the distinction and the UI collapsed it. At 0% coverage
the tab now says the slots were never recorded, that this is missing data rather
than an absence of evolutions, and that the other two tabs are unaffected because
they read the cards themselves — which are always stored. The partial-coverage
caveat is untouched and still fires between 0 and 60%.

**The tab badge shows an em dash, not a 0.** "0" beside Evolutions is a
measurement; "—" is the absence of one. Hovering says which.

### Then: "but I can see evolution combos in his battle history"

The right pushback, and the first explanation was too vague to survive it. The
player *does* have 84 evolution-marked battles. Two facts put them out of reach,
and the message named neither.

**Marks are a date, not a mode.** They ramp from ~1% of all battles on 20 Jul to
99% on 5 Aug — whatever backfill ran, it reached everything at once. So "which
modes record evolutions" is the wrong question; every mode does now.

| | battles | marked |
|---|---:|---:|
| this player, **Friendly** (28 Jun – **26 Jul**) | 423 | **0** |
| this player, **Ranked/Ladder** (29 Jun – **13 Aug**) | 291 | 84 |
| everyone, Friendly, 5–13 Aug | ~29k | ~97% |

**Their duels stop before the marks start.** Duel Analysis reads duel-like modes
only, and every one of this player's duels is reconstructed from Friendly
practice that ended 26 Jul — ten days before evolution slots were stored
everywhere. The evolutions they can see in-app are Ranked and Ladder from August,
which this page correctly does not read: a duel combo is a pairing *within one
duel loadout*, so only duel battles can supply one.

So `duel_decks()` now returns a **`span`** — the battle_time of the first and last
duel row, surfaced as `duels.span.{from,to}` — and the empty tab quotes it: *their
duels run 28 Jun to 26 Jul, and evolution slots were not yet being stored across
that period*, followed by the mode point. A player whose duels reach into August
gets real coverage from the same code (`#C00CRGG2P`, duels to 11 Aug, 34.3%), which
is the check that the span explanation is the true one and not a story fitted to
one tag.

The lesson is the one this file keeps relearning: "the data is missing" is not an
explanation, it is the start of one. The user could see the thing the screen said
did not exist, and they were right — it existed in a mode and a month the page
does not read.

### And then: the same bug in the three places I hadn't looked

Asked again *"why is it still zero"* — with a screenshot that answered its own
question. The tab badge said "—" and the empty table gave the full explanation,
because those are what I had fixed. Directly above them, four stat tiles still
said **`0`**, **"Not enough duels yet"** ×3.

"Not enough duels yet" is a claim about VOLUME, and it is plainly false for a
player with 96 duels and 269 decks. Fixing one instance of a wording bug and
leaving its siblings is worse than not fixing it, because the screen now
contradicts itself and the wrong half is the bigger type.

So `unmeasured` is derived **once** near the top of the component and the five
places that must agree all read it — tab badge, big figure, three tiles, empty
table. The tiles take it as a prop (`TileCombo unmeasured`). Note the badge uses
`evoUnmeasured` rather than `unmeasured`: it renders for every tab id in the
strip, not just the active one, so it cannot depend on `tab`.

Verified with a 12-assertion probe over three tags, including a
coverage-34% player to prove none of the "not recorded" wording leaks into a
tab that has real data, and the Win Conditions tab to prove the evolutions
branch does not touch it.

**Probe note worth keeping:** the login form's username input has no `type`
attribute, so `input[type="text"]` never matches it — the DOM *property* reports
`"text"` by default, which is why dumping `n.type` says "text" and misleads you
into writing a selector that cannot fire. Use `input:not([type="password"])`.
And the form only mounts after the landing intro animation, so `networkidle` is
not enough to wait on.

---

## Duel Analysis, on the Dekkies light system

A visual pass only — no data, no layout, no information architecture moved. Two
things about it are worth recording, because both are places where following the
brief literally would have made the page worse.

**A colour that works as a bar does not automatically work as a number.**
Measured against the white card:

| | contrast on `#FFFFFF` | |
|---|---:|---|
| `#20B875` green | 2.57:1 | fails even the 3:1 bar floor |
| `#3182F6` blue | 3.71:1 | fine as a bar, thin as text |
| `#F05A3A` orange | 3.37:1 | same |
| `#F4C542` yellow | 1.63:1 | a fill only, never ink |

So each hue is two steps. The **fills** keep the briefed values exactly — the
bars are labelled, which is the relief the 3:1 floor allows — and the **figures**
take a darker step of the same hue, so a win rate is still green and now reads at
4.92:1 instead of 2.57.

**G1/G2/G3 became three distinct hues, reversing a documented decision.** They
had been a sequential ramp on the argument that they are ordered positions in a
loadout, so one hue light-to-dark says "first, second, third" where three
unrelated colours only say "three of something". Three is defensible here: the
columns are read *across* a row as much as down, and comparing G1 to G3 on one
combo is comparing categories rather than steps. Run through the palette
validator on the white card, the briefed triple passes — with one condition:

```
lightness band · chroma floor · 3:1 contrast    PASS
worst pair  #3182F6 blue ↔ #7C3AED purple       ΔE 6.4 (deutan)
```

6.4 sits in the 6–8 band, which is legal **only** with a secondary encoding.
There is one — every G column prints its own percentage above its bar and the
legend labels each — so the palette is allowed. Without those figures it would
not be.

**Inactive tabs are neutral; purple always means "selected".** Spells was orange
and Evolutions green whether or not they were chosen, which made three tabs look
like three simultaneous states when only one can be live, and spent the palette's
meaning on decoration. The active treatment is now one treatment, so the colour
answers *which is chosen* rather than *which is this* — and the glow is a 1px
ring plus a 12px lift on the tab itself, never the row or the card.

The brief's surfaces and typography are redefined **at page scope**, on the same
token names the stylesheet already reads. That re-skins this screen and nothing
else: no other page is touched and not one rule below the token block had to
change. The dark block restores the app's own ladder, because the brief is a
light-mode system and an auto-flip of it is exactly the one-theme-only pass this
project keeps getting caught by.

---

## The Dekkies redesign — shell first

The product is **Dekkies** now, and the shell was rebuilt to the new design:

| | before | after |
|---|---|---|
| brand | "Royal Arena", gold crown on a sunken tile | **DECKKIES** (was DEKKIES until 26 Aug), white crown on a solid violet tile |
| nav | Home · Analytics · Deck Builder · Duel Builder · Counter Palette · About | Home · Analytics · **Deck Vault** · Duel Builder · **Counter Hub** · **Meta** |
| tag search | on the landing section, and a row that replaced the nav | always in the chrome, ⌘K from anywhere |
| sidebar selection | a solid slab in the row's own hue | a violet tint with a 3px leading bar |
| upsell | Royal Pro | Dekkies Pro |

**The nav no longer disappears.** It used to be swapped out wholesale for the
player query row, which left every analysis screen with no way to reach Deck
Vault, Duel Builder or Counter Hub without going home first — the same
half-wired navigation the Home button was caught by, in a different costume. The
query row moved into the panel, directly above the screen it drives, and its
Home chip went with the move: that chip existed only because the row had eaten
the nav, so keeping it would have put a second Home three centimetres from the
first.

**Meta was promoted out of the sidebar.** It is about the whole player base
rather than the loaded player, which is why it was already home-only; making it
a top-level destination states the same rule in the nav instead of in a
comment.

**The selected sidebar row went back to a tint.** Solid is the more confident
treatment and it is what the rail wore for a while — but the rail carries six
rows, the icon tile already states each section's identity in colour, and a
solid slab makes the open row the loudest object on a screen whose subject is
the panel beside it. Tint plus a bar says "you are here" without competing, and
the bar is a shape, so meaning still does not rest on colour. The per-section
hue stays on the icon tile, where identity belongs.

**The G1/G2/G3 columns print their figures.** They were bar-only, which made
them the only numbers on a row you had to hover to read, and left three
unlabelled meters sitting beside two labelled ones.

### Not carried over from the mock, and why

* **Coach Assist stays in the sidebar.** The mock's rail does not show it. It is
  a built, working screen, and dropping the only navigation to one is a
  regression rather than a redesign.
* **The three circular buttons beside the season control were not added.** In
  the mock they are refresh, notifications and share; none has a behaviour
  behind it here, and a button that does nothing is worse than no button — the
  same reason the sidebar's Upgrade Now was wired to something real rather than
  left as decoration.
* **The G-bar legend keeps one hue.** G1/G2/G3 are ordered positions in a
  loadout, so they are a sequential ramp light-to-dark rather than three
  categorical colours; that is measured and documented in the colour section.

---

## The deck builder — two columns instead of a drawer

All three deck screens (`#/builder`, `#/decks`, `#/palette`) were one scrolling
column with the card pool in a drawer that slid up over it. Filling a deck was:
scroll to the deck, open the drawer, lose sight of the deck *under* the drawer,
pick a card, scroll back. And because the page scrolled as one piece, the
toolbar, the decks and the pool all moved together, which is what
*"it's so scattered and congested"* was describing.

They now share one shell — `components/DeckWorkspace/` — with the decks on the
left and the card library on the right, each scrolling by itself.

**A deck is eight cards on one line and nothing else**, so the full width was
never the decks' to need. Side by side, the deck being filled and the card being
chosen are on screen together, which is the job.

### What each column had to be told

* **`min-height: 0` on every flex and grid child in the chain.** A flex item
  defaults to `min-height: auto` and refuses to shrink below its content, so
  without it both columns grow to fit all the decks and all 122 tiles, the inner
  `overflow-y: auto` never has anything to do, and the page scrolls as one piece
  again. That one property is the difference between two independent columns and
  the pile they replaced.
* **The library collapses to a 2.9rem spine**, and the state is owned by the
  workspace rather than by the panel — the grid track and the panel's own shape
  are one decision, so they cannot disagree. Collapsing moves the deck column
  from 907px to 1219px, measured.
* **One deck per row, and the rest scrolls.** This was briefly an `auto-fill`
  gallery — two decks abreast, ~48px slots, more decks visible without
  scrolling. Wrong trade, and it was reverted: a deck screen is a place to look
  at and drag onto eight cards, so the cards get the whole column and the slots
  go back to **104px**. Same reasoning as the dashboard rail — reclaimed width
  buys BIGGER elements, not more of them.
* **Versus is always two columns, Blue against Red.** A duel is one collection
  against the other and the comparison is the point, so the sides sit parallel
  with each player's decks stacked down their own side — Deck 1 opposite Deck 1.
  `auto-fit` had been letting a wide deck column collapse them into one track,
  which put Blue's three decks across the top and Red's underneath, reading as
  one long list rather than two sides. They stack only under 62rem, where two
  eight-card rows genuinely do not fit.

### The filter had to shrink, and the deck panel with it

The win-condition filter drew all twenty-one win conditions as permanent 44px
chips. That fitted when a deck screen was one full-width column; beside a card
library it wraps to two lines and becomes the largest thing on the page — a
control for a job most visits do not do, drawn bigger than the decks it filters.
It is one **Filter** button now, and the panel behind it keeps everything: win
conditions first, then all 122 cards, with the search that was already there.
Whatever is selected stays out on the bar as a chip, because a filter you cannot
see is a filter you cannot undo. The panel is **absolutely positioned** — in
flow it pushed the whole workspace down by its own height on every open, which
on a screen whose columns are sized from the space left over is a layout change
rather than a menu.

The deck panel's five text buttons ("Open in Game", "Copy Link", "Import",
"Rename", "Clear") became an icon rail for the same reason — that row was about
a third of the panel's width. Every label survives in `title` and `aria-label`,
and the one primary action keeps its words, in the footer where it reads as the
end of the deck rather than one more control in a row of six.

### What the library gained

Search, an elixir filter and a rarity filter, beside the sort and type tabs it
already had. Search folds case and punctuation on **both** ends — the card key
is already the hyphenated form — so "ELITEbarb" finds Elite Barbarians. All four
filters AND together, and `Reset` lights up only while something is actually
narrowing the list, so the control states whether there is anything to undo
before it is pressed.

The three filter state fields are runtime-only and deliberately outside
`partialize`: a filter is how you are looking at the pool right now, not part of
the collection. **No persist-version bump was needed.**

The type tabs and the mode tabs also had their selected tint re-grounded onto
`--accent-select-fill-sunken`. They sit on a sunken strip and were mixing
against the card, which is the documented way to get a control that reads as a
bold slab in dark and a whisper in light.

---

## The home screen — three real areas, three behind a gate

The home screen's analytics areas were placeholder panels. Four are now real,
and the reason the other three are not is that they are what a subscription is
for.

| area | what it is |
|---|---|
| **Top Meta Decks** | already real — the global leaderboard |
| **Deck Analysis** | paste a deck link → curve, roles, measured win rate, matchup spread |
| **Cards** | use and win rate for every card across the whole player base |
| **Deck Counter** | paste a deck → its three worst matchups; the rest behind the gate |
| Duel Analysis · Duel Zone · Coach Assist | behind the Royal Pro gate |

**The `Analytics` item in the top bar now goes somewhere.** It was a no-op from
the one place people press it most: every analytics area already lives on the
home screen, so `go(HOME)` from the home screen changed nothing and fired no
`hashchange`. It resets the section *and* scrolls back to the top of the home
screen, where the player-tag field and the Analyze button are — the same "going
somewhere is two things" that Home and the brand were caught by. It scrolls to
the search rather than down to the area grid because the areas are reachable
from the rail on every screen, and the field is not.

### Saved Groups is a view, not a footer

The duel builder's saved sets used to render *below* the board, which put them
under three to six deck panels — reaching them meant scrolling past everything
you were working on — and `SavedGroups` returned `null` outright when nothing
was saved, so the one time you most wanted to know where they had gone there was
nothing on screen to find.

A **Build / Saved** switch now sits beside Solo / Versus, and the two are
deliberately separate controls: the mode is *which* collection, the view is
whether you are looking at the board or at what you have saved of it. Saved
fills the same column the board does and scrolls with it, and it says what to do
when it is empty.

**The win-condition filter SELECTS there rather than only dimming.** Below the
builder its job was "show me which of these decks holds Hog Rider", so dimming
the rest was right. As a library its job is "find me the groups with Hog Rider in
them", and a group with no matching deck is not an answer to that — so groups are
filtered out, the count reads "3 of 11", and matching decks are still highlighted
inside the groups that survive.

### The card library is as tall as the panel

It was a toolbar stacked above a two-column workspace, so the library began where
the *decks* began and left a band of empty surface beside the toolbar — a strip
of nothing across the full width of the tallest thing on screen. The workspace is
one grid now: toolbar in row 1, decks in row 2, library spanning both. Measured,
the card grid gets ~50px of height back.

### Gold, and the one hue that is not semantic

Every other colour in this app earns its place by meaning. A crown is gold
because a Clash Royale crown *is* gold, and drawing the one piece of game
iconography in the chrome in the app's near-white made it look like a UI glyph.
This is the game-fidelity call the README defers on for rarity colours, taken
here because the crown is the brand.

**Three steps, not one.** Metal reads as metal because it has a highlight, a body
and a shade; a flat `#FFD700` reads as yellow plastic. `--gold-bright` / `--gold`
/ `--gold-deep` are re-stepped per theme — on white the highlight has to come
down or the shine disappears into the page — and the gradient runs *across* the
shape rather than down it, which is what makes it look struck rather than lit.

That means a real SVG `<linearGradient>`, which means an id, and a fixed id would
be duplicated the moment two crowns are on screen — invalid, and the second crown
inherits the first's stops. `useId` gives each instance its own.

A crown goes gold **only once it is won**: an unlit pip drawn in metal would say
the player has it, and which of the three they took is the counter's whole job.
The brand mark also goes gold on hover rather than violet — violet is what
"selected" means everywhere here, and the brand is never selected.

### Subscribe opens the truth

There is no checkout, so the gate's CTA does not pretend there is. It opens a
glass dialog with the two real ways to reach a person — an `x.com` link that
opens in a new tab with `rel="noopener noreferrer"`, and a `mailto:` with a copy
button beside it. A button opening a checkout that does not exist would be the
one dishonest thing on a screen whose entire argument is that its numbers are
measured. The sidebar's **Upgrade Now** had no handler at all and now opens the
same dialog.

**White text needed a deeper blue.** `--accent-info-text` resolves to `--on-hue`
— near-black on dark — because the dark hues are bright pastels chosen to read as
text on a near-black page, and white on `#5B8DEF` is **3.23:1**. That is a fact
about the step, not about blue: `--accent-info-solid` (`#2A5FC7` dark, `#1D4ED8`
light) carries white at **5.90:1** and **6.70:1**. Same shape as the chart red —
when a hue "cannot" carry the text you want, re-step the hue.

### The Royal Pro gate is the real thing, behind glass

**This is the one place blur comes back**, and it is the only place it earns its
compositing pass. Everywhere else a frosted pane refracted whatever scrolled
behind it and cost a layer for decoration. Here the blur *is* the message: a
locked feature drawn as an empty box says "nothing here", while the same feature
drawn as its own real content, out of focus, says "this exists and you cannot
read it yet" — which is the only honest way to sell something.

The preview is real markup, so it follows the theme, and it is made genuinely
unreachable rather than merely hard to read. `inert` takes it out of the tab
order, out of the accessibility tree and out of hit-testing in one property.
Blur alone leaves a keyboard user tabbing through controls they cannot see;
`pointer-events: none` alone leaves a screen reader reading content the page is
pretending to withhold.

The gate is on the **home screen only**. `#/player/<tag>/duels` and its siblings
still render in full — nothing that already worked stopped working.

### Deck Analysis, and what a "deck rating" is not

There is no score out of ten. What a pasted deck gets is:

- **its curve, roles and cycle**, computed from `cards.json` in the browser,
  which is the copy already loaded to draw the art — a second copy from the
  server would be free to disagree with the one drawing the cards;
- **its measured win rate**, off `deck_counter`'s evidence ladder, printed with
  the rung that answered — "51.0% over 102 battles, lists two cards different"
  is a different claim from the same number off 30,000, and the reader is owed
  which;
- **a matchup spread against all seventeen archetypes**. `find_counters` used to
  return only the ones that beat the deck, which is the right answer to "what do
  I have to fear" and cannot be turned back into "how does this deck do" once
  everything under 50% has been dropped. Those rows are computed either way, so
  `field` costs nothing.

**A thin reading keeps its place and loses its colour.** The spread sorts by win
rate, which is right for a spread — and it put "77.8% over 9 battles" above
"56.1% over 3,684". Both are true; one would not survive being measured again.
Rows under 50 battles are drained to neutral rather than hidden, because a game
that happened is not an estimate and does not need a sample size — the same
argument `real_opponents` makes server-side.

### Every paste box empties itself

There are five of them — Deck Analysis, Deck Counter, the duel builder's import
row, Deck vs Deck and the Coach's interview — and they all behaved slightly
differently. Now they agree:

- **A link is analysed when it is asked for, not on a keystroke.** The two
  screens with an Analyze button used to fire the moment `deck=` appeared in the
  field, which made the button decoration and started a multi-second matchup
  query off a paste. The link now sits there until pressed, so a half-pasted URL
  can be fixed before anything runs.
- **The field empties once the deck lands.** A 200-character URL parked under a
  deck that is already drawn is the longest thing on the screen and says nothing
  the eight cards do not say better — and pasting the next deck meant selecting
  all of it first.
- **The builder's import row stays open** instead of closing itself after a
  beat. Importing three decks in a row was: open, paste, wait for it to close,
  open the next panel.
- **Clearing a deck moved to its own control.** Emptying the box used to be how
  you removed a loaded deck; a box that empties itself cannot mean that any
  more, so Deck vs Deck and the Coach grew a Remove button rather than quietly
  losing the capability.

### A paste screen opens as an invitation, not an unfinished form

Deck Analysis and Deck Counter both opened as a small left-aligned heading, a
thin line of grey copy and a full-width input pinned to the top corner — with
three quarters of the panel empty below it. The one thing being asked for is a
link, so the ask is centred, the type is the display face at a headline size,
and the panel says what it will hand back *before* it is given anything: a row
of chips naming the output. An empty panel that lists its own output is an
invitation; one that lists nothing is a form somebody forgot to finish.

The section's identity hue — the same one its sidebar tile wears — lands on the
icon tile, the kicker, one word of the headline and the chip dots. Nothing
larger: the panel behind them never goes past a level-1 wash, which is the rule
that keeps a neutral interface neutral while still reading as coloured.

`PasteIntro` is shared, because the two screens are the same shape — paste a
deck, get an answer — and two copies of that decision is how they drift apart.
Once a deck IS loaded the hero collapses to `PasteHeader`, one row carrying the
same icon and the same form: the screen now has an answer to show and the ask
should not still be the biggest thing on it.

**Results sit on a measure.** They used to run the full width of the panel,
which at 1920px put a matchup row's label 40rem from its own bar. 78rem for
Deck Analysis and 82rem for Deck Counter, centred — wider than that and the eye
loses the row on the way across.

### The card board is global, and an evolved card is a different card

`/api/analytics/meta/cards`, and it costs **nothing extra to compute**.
`player_deck_hash` is the sorted card list — that is why the hash is useless for
display — so the grouped result the meta board already has is also a complete
per-card tally. Splitting each hash and adding that row's battles and wins to
each of its eight cards is exact, not a sample: every competitive battle in the
window contributes its whole deck. One rollup, two products, and they can never
describe different windows.

It is tallied over the **full** grouped result, not the ranked board: the board
is the top 600 candidates and the 25-player floor has already thrown decks away,
so counting cards there would answer "what is on the leaderboard" while the
label says "what people play".

**The per-form split is the point.** An evolved Skeletons is scored apart from a
plain one, and the difference is not cosmetic — measured on the live data:

| card | plain | evolved | hero |
|---|---:|---:|---:|
| Elite Barbarians | 40.1% (2,242) | **57.6%** (41,100) | — |
| Valkyrie | 51.7% (5,573) | 50.6% (11,252) | **53.4%** (17,410) |
| Berserker | 49.0% (2,196) | — | **54.5%** (46,367) |

Those come out of the art scan the board already runs, with `result` added to
its SELECT — but tallied **before** its two filters. That scan keeps only decks
on the board and caps each at 400 rows, both correct for establishing how a deck
is drawn and both wrong for counting cards, because they would answer "how do
the top decks field this card" while the label says "how does everyone".

Every rule `player_cards.py` established is kept: only marked battles can be
split, both sides come from that subset, a form's use rate is a share of the
marked battles and not of every battle, and a card with no marked battle gets no
`forms` key at all — "never observed in either form" and "observed, zero" are
different claims.

The rollup measures **166 s** with the card board included, on a background
thread every 30 minutes. Coverage for the form half is stated on screen rather
than implied: 222,745 marked battles over 3 days, at the time of writing.

### Every hue has an INK step and a SOLID step

> **Later addition:** blue has a third step, `--hue-blue-deep`, for display type
> and bare graphic marks. The rule the three steps encode is stated in full in
> [A third blue](#a-third-blue-and-the-rule-the-ramps-actually-encode) — it is
> about which **contrast floor** an element has to clear, not about whether it
> is a fill.

Reported as *"in dark mode it looks like the opacity decreased — the left panel
and the fonts are all lighter, and the other colours too"*, against a screenshot
where the primary button was deep and everything else in the same hue was pale.

The cause is that a hue has two jobs that want opposite values, and the dark
theme only had one value:

* **INK** — text, icons, a 1px border. On a near-black page it must clear 4.5:1
  against grounds up to `#202020`, so the dark steps are bright pastels.
* **SOLID** — a filled slab with text on it. It wants the opposite: dark enough
  to carry white.

A slab painted in the ink step is exactly what "dim" was. The five `--solid-*`
tokens are the fill step, and they are **the light theme's own hues, unchanged** —
a light-mode hue is already "dark enough to carry white on a white page", which
is the same requirement a dark-mode fill has. Measured on both grounds:

| | white on it | visible on the `#111` page |
|---|---:|---:|
| violet `#6D28D9` | 7.10 | 2.66 |
| maroon `#96204A` | 8.07 | 2.34 |
| blue `#1D4ED8` | 6.70 | 2.82 |
| green `#047857` | 5.48 | 3.44 |
| red `#C02618` | 5.95 | 3.18 |

So light has one step per hue and dark has two, which is the honest shape: light
needs no pastel because its page is not dark. The selected sidebar row, the
identity tiles and every filled button now take the solid step with `--on-solid`
white — and the rail looks the same weight in either theme.

**Then the same complaint came back about the TEXT**, and the answer was not to
push the ink darker — it cannot go darker, `#96204A` on the page is **2.05:1** —
but to stop the coloured things being ink at all. An audit of every hue-coloured
text node across five screens found exactly three, and each became a fill:

| was | is |
|---|---|
| the section kicker, tinted text | a filled pill |
| the headline accent word, tinted text | a highlighted word (`box-decoration-break: clone`) |
| the Royal Pro badge, tint on tint | a solid badge |

Selected states followed the same rule. A **pill** (the card-library type tabs,
the builder's mode switch, the Cards group tabs, the filter trigger) is a fill,
so it takes the solid step and white text. An **underline tab** (Coach Assist,
Deck Counter, Player Cards, the top bar) is not — its coloured rule is the
indicator — so the label went to full-contrast `--text` and the hue stayed on the
rule. Meaning still never rests on hue alone: the selected label is brighter,
heavier *and* ruled.

The home screen's green **Analyze** button was the same bug in a different hue:
`#34D399` fill with near-black text. It is `--solid-green` with white now, 5.48:1.

**Meter bars deliberately did NOT change.** A bar sitting on a dark track has to
be visible against it, which makes it closer to ink than to a slab — a deep green
bar on `#0D0D0D` is nearly invisible. The rule that fell out of all of this is
the one worth keeping:

> A fill **with text on it** takes the solid step. A fill with **no** text — a
> meter, a bar, a dot — keeps the bright step, because it has to be seen rather
> than read.

Verified by re-running the audit: zero hue-coloured text nodes remain on any of
the five screens, and every filled control measures white-on-solid at 5.48:1 or
better in both themes.

### The action hue is maroon, in two steps

Pink is gone. Maroon cannot be one value the way pink was, because the hue has
two jobs that pull in opposite directions:

| | job | dark | light |
|---|---|---|---|
| `--accent-action` | INK — text, icons, borders, what a wash is mixed from | `#D5639E` | `#96204A` |
| `--accent-action-solid` | FILL — a surface with text on it | `#96204A` | `#96204A` |

On a near-black page ink must clear 4.5:1 against grounds up to `#202020`, which
puts a floor under how dark it can be — a burgundy dark enough to read as
burgundy measures **2.3:1** there and is simply unreadable. A fill wants the
opposite: dark enough to carry white, which `#96204A` does at **8.07:1** in both
themes. Pink got away with a single step only because `--on-hue` (near-black on
dark) was doing the reading; a maroon fill dark enough to *be* maroon needs white
on it instead, so the fill and its text are their own pair. Thirteen filled
primary buttons were repointed at the solid.

**The first dark step was graded wrong, and "it looks dimmed, like the opacity
dropped" was the symptom.** Measured in OKLCH, the four other dark hues sit at
chroma 0.153–0.166; the first maroon came in at **0.121**, 22% under the band. It
was not darker than its neighbours — it was less *saturated* than them, which on
a dark ground reads as washed rather than deep. Lightness was never the problem,
so lightness was not the fix: the step is now C 0.157, in band, at the same
lightness.

There is a hard limit underneath all of it: at the luminance dark-mode ink
requires, a saturated red **is** a rose. The dark theme cannot hold
"maroon-dark" and "as vivid as the rest" in one value. It gets vividness on the
ink step, where the colour is small and has to be legible, and the true maroon on
the fill step, which is where the large coloured surfaces actually are.

Hue 350 on dark rather than the light step's 5, because maroon **is** a dark red
and "the primary thing to click" must never read as "this will destroy
something". Separation from the error red: **ΔE 10.6**, against 7.7 at hue 5 —
where the old pink managed 9.7 and violet-vs-blue, two hues nobody confuses, is
10.0.

### Deck Analysis left the player sidebar

`#/player/<tag>/decks` was only ever the placeholder shell — twelve grey bars and
a note saying no data was wired up — and offering it beside five screens that do
have data is offering a dead end. The **home** Deck Analysis is a real screen and
stays. Both routes still render, so existing links keep working; neither dead end
is advertised. Top Meta Decks is home-only for the opposite reason: it is about
everybody rather than the loaded player.

### The chart palette, and what actually failed the validator

The matchup spread has three states — favourable, unfavourable, and *measured on
too little to trust*. All three were chosen by running the palette validator on
this app's own surfaces, and the first attempt got the diagnosis wrong.

**It was not "red fails". It was that step of red.** The app's UI red on the
dark ground (`#f87171`) is a bright pastel, and against the data green it
separates by **ΔE 2.9 under protanopia** — under the floor, and under even the
6–8 band a secondary encoding is allowed to rescue. That reads as "red and green
cannot be a diverging pair", which is the folklore answer and is wrong here: a
deeper red passes comfortably.

| | light (surface `#f8f8fa`) | dark (surface `#141414`) |
|---|---|---|
| green `--c-win` | `#169b6b` | `#199e70` |
| red `--c-loss` | `#c02618` — ΔE 9.6 deutan | `#d92d20` — ΔE 9.3 deutan |
| amber `--c-thin` | `#a06a00` | `#c58200` |

All clear the lightness band, the chroma floor and 3:1 against their surface.
The chart red is a **re-stepped** red, not the UI's — which is the whole reason
[the two systems are separate](#the-chart-and-data-colours--a-deliberately-separate-system).

**The thin marker carries a hatch, and that is not decoration.** Red against
amber is the pair deuteranopia collapses hardest. Measured across a dozen
candidates, **no light-mode red/amber pair clears the CVD floor on hue alone**
(best 4.9 against a floor of 6), and none clears the 15-point normal-vision
floor either. Dark *does* pass — `#c58200` at ΔE 7.9 deutan and 16.7 normal —
which is exactly the one-theme-only pass this project keeps getting burned by.
So a thin row is amber **and** hatched at 45°: the hue is the quick read, and
the hatch is what survives deuteranopia, a monochrome print and forced-colours
mode, none of which a hue difference does.

Every bar prints its own percentage and its battle count regardless, and on a
thin row the count is the whole point — so the count stops being the quietest
thing in the row.

---

## The landing screen, rebuilt

A visual pass over the landing view: same routes, same store, same search, same
five-hue palette. Four things are worth recording because they are the parts
that were not just CSS.

### The assets existed but nothing pointed at them

`assets/background/` held `light_background.png`, `dark_background.png` and
`king image.jpg` — a matched pair of castle backdrops plus a character — and
**no file in `src/` referenced any of them.** They were staged, not wired. So
"keep the existing backgrounds" meant connecting them for the first time, not
preserving a working setup.

`scripts/build-hero-art.py` turns the three masters into what `public/` serves.
The masters stay untouched and the script is idempotent.

| | before | after |
|---|---:|---:|
| character | 1.0 MB JPG, opaque | **99 kB** WebP, alpha |
| light backdrop | 1.6 MB PNG | **35 kB** WebP |
| dark backdrop | 1.6 MB PNG | **32 kB** WebP |
| total | 4.2 MB | **166 kB** |

### Cutting the character out is not a colour key

The king ships on a flat `(247,247,247)` field: invisible on the light theme, a
white box on the dark one. Two details decide whether the cutout survives both:

* **Flood fill from the border, not a global near-white test.** He holds a pale
  parchment report and the crown has white highlights — a global key punches
  holes straight through them. Only background *connected to the edge* goes.
* **Decontaminate the edge.** An antialiased boundary pixel is already mixed
  with the backdrop (`C = aF + (1-a)BG`), so keying alone leaves a white halo
  that is invisible on light and obvious on dark. Recovering
  `F = (C - (1-a)BG) / a` is what makes one file work on both themes.

### The global motion kill-switch

`index.css` carried this, and it is why the nav had no hover motion and nothing
in the app animated:

```css
*, *::before, *::after { animation: none !important; transition: none !important; }
```

It was written to be reversible — *"reinstating specific motion later is a
decision made here"* — and a request for micro-interactions is that decision.
What it was really protecting against was **continuous** motion: the old landing
page animated `box-shadow` and `filter` in an infinite `alternate`, which
repaints a blurred layer every frame and made the page stutter. Those loops are
gone from the source, not merely suppressed. What the blanket was actually
switching off was nine one-shot entrances and a few dozen hover transitions.

It is now scoped to `prefers-reduced-motion: reduce` — same blanket, same one
place, applied only when the reader has asked for it. The rules that keep it
honest: one-shot only (no `infinite` anywhere), transform and opacity only (both
composited), and short — `--dur-1..4` (140/200/320/560ms) and one `--ease`.

### A reveal must not fight the thing it reveals

The scroll reveal first set `transition: opacity, transform` on `.band > *`.
That is a descendant selector, so it beat `.toolPanel`'s own rule and **silently
replaced every card's hover transition** — the cards still lifted, but over
560ms instead of 320ms, and their background and border stopped transitioning at
all because those legs were no longer in the winning shorthand. Computed style
said `0.56s, 0.56s` where it should have said `0.2s, 0.2s, 0.32s, 0.32s`.

A keyframe animation never touches the `transition` property, so the fix is to
reveal with `animation` and let each card keep its own timing. Fill mode is
`backwards`, not `both`: `forwards` would pin `transform: none` as an
animation-origin value, which outranks ordinary declarations and would have
killed the hover lift on every card for the rest of the session.

`useReveal` uses a **callback ref over a state node**, not `useRef` +
`useEffect([])`. The bands live inside the home view, which unmounts whenever a
tool opens and mounts again on return; an empty-dependency effect runs once per
*Dashboard* mount, so on the second visit it had already fired and the fresh
element never got its attribute.

### Probe notes

Three failures during verification were the probe's fault, not the product's:

* The username input has **no `type` attribute**, so `input[type="text"]` never
  matches — the DOM *property* reports `"text"` by default, which is what makes
  dumping `n.type` misleading. Use `input:not([type="password"])`.
* Playwright's `hover()` **scrolls the element into view first**, so comparing
  `boundingBox` before/after measures the scroll. The first version of the lift
  assertion "passed" on a 226px delta.
* The mouse stays where the last click left it. After the SIGN IN click it sits
  mid-screen, so a scrolled-to card is *already hovered* when the resting
  baseline is measured — the lift then reads as 0px. Park it first.

`fetchPriority` is React 19; on React 18 it falls through to the DOM and warns
on every render. `loading="eager"` does the job here.

### The landing screen has no rail

Follow-up round. Three things were wrong and two of them were the same mistake.

**The sidebar did not belong on the landing screen.** A rail of a player's
analytics areas, rendered before there is a player, is navigation to seven
screens that all say "search for someone first" — and it cost the hero a quarter
of its width. The seven areas are now a grid of centred blocks under the search,
where they can be sized and *described* rather than listed. The rail returns the
moment there is a subject: opening an area, or loading a tag.

`data-landing` on `.body` rather than reusing `data-rail='closed'`, because the
rail's open/closed state is a remembered preference and the landing screen is
not expressing a preference — it has no rail at all. Sharing the attribute would
have meant coming back from a tool with the rail open reserved 236px for a
sidebar that never rendered.

The blocks also moved ABOVE the tool panels. They are the primary navigation of
this screen now, so they cannot sit below three full-bleed slabs.

**The scrim was erasing half the painting.** The backdrop is a matched pair with
castles at BOTH edges, and the first scrim ramped from fully opaque `--glass-fill`
at the left — so the left castle never appeared on the site at all. The artwork
is already low-contrast where the copy sits (both files mist out toward the
centre), so it does not need covering; it needs a floor under the text. The veil
now tops out at 62% instead of 100%, and both castles read in both themes.

The general version of that mistake: a scrim exists to protect legibility, and
its correct strength is the least that achieves it. Starting at "opaque" and
easing outward is how you end up shipping an asset nobody can see.

### Glow, in dark mode only

Requested, and compatible with the history here once one distinction is made.
The lag that got all motion banned came from **animated** glow — `box-shadow`
and `filter` in an infinite `alternate`, repainting a blurred layer every frame.
A **static** glow is painted once and only crossfades on hover. Nothing added
here loops, and a probe asserts it: zero animations with
`iterations === Infinity` anywhere in the document.

It also fills a real gap rather than being decoration. The dark theme sets

```css
--shadow: 0 0 0 0 transparent;   /* a black shadow on a near-black page is invisible */
```

which left dark mode with **no elevation cue at all** on hover — the cards lifted
3px and nothing else changed. Light gets depth from a real shadow; dark now gets
it from the surface appearing to emit its own hue.

**One declaration serves both themes.** `--glow-core` / `--glow-halo` are
*strengths*, mixed per hue at the point of use — the same trick `--edge-strength`
already used:

```css
box-shadow: 0 5px 20px color-mix(in srgb, var(--tile-hue) var(--glow-core), transparent);
```

Light sets them to `0%`, and `color-mix(in srgb, <hue> 0%, transparent)` is
simply transparent. So there is no `[data-theme]` branch per component and no
second set of rules to drift out of step — verified by reading computed style in
both themes: `color(srgb … / 0.3)` on dark, `/ 0)` on light, from the same rule.

Glow is applied where an element already carries a hue — heading blocks, icon
tiles, card hover, focus rings, the active sidebar row, the brand tile, the
primary buttons — so it reinforces the existing identity colours rather than
introducing a new palette. The one persistent glow in the chrome is the open
sidebar row, because "you are here" is a state rather than a reaction; everything
else lights only on hover or focus.

**Grid note:** the seven analytics blocks moved off `auto-fit` to explicit column
counts. Seven is prime, so the only tidy splits are 7 and 4+3, and `auto-fit`
packed six at a lot of common widths — leaving one card marooned on its own row.

### Painted headings, gate hues, and a font that could not go bold

Four small things, three of which were one bug wearing different hats.

**The gate wore two unrelated colours.** A Royal Pro card had a violet badge, a
violet lock ring and a **maroon** CTA — the action colour, applied because it was
a primary button, with no thought for what it was gating. So the colour you
pressed on the home screen was not the colour you landed on. `ProLock` now takes
a `hue` and every coloured part reads one `--gate-*` set, sourced from the same
`SIDE_NAV` entry the block and the sidebar row use. Duel Zone is violet through;
Coach Assist and Duel Analysis are green through. Asserted by comparing the CTA's
computed background to the badge's, per gated area.

**The tool panel headings** got the same painted treatment as the analytics
blocks — white marker lettering on a solid block of the tool's own hue, from
`--tool-solid`. `box-decoration-break: clone`, because these titles are long
enough to wrap and the alternative is one L-shaped slab with a notch in it.

**The display face could not be bolded, and nothing said so.** Every heading
asked for `font-weight: 400`, and `:root` carried `font-synthesis: none`. Kids
Word ships a single cut — so there was no bold file to load AND the browser was
forbidden from making one. Requesting 600 would have changed precisely nothing.

`font-synthesis: weight` re-enables exactly the half that was needed. Italic
synthesis stays off, which is the reason the line was written in the first place:
there is no italic cut either and a mechanically slanted marker face reads as a
rendering fault. The 28 display-heading rules then went to 600. The `@font-face`
block keeps `font-weight: 400` — that describes the FILE, and rewriting it would
have told the browser the single cut was already bold.

**One focus indicator per control.** The top-bar search drew a 3px ring on its
wrapper AND the global `:focus-visible` outline on the input inside it, so
clicking the field produced a visible box-inside-a-box. The wrapper's existing
border now just changes colour, the glow carries it on dark, and the inner
outline is suppressed on that one input. The hero field keeps its ring — it is
the point of that screen — but lost its inner outline too. `:focus-visible`
everywhere else is untouched.

The `⌘K` hint chip in that field became the submit button it was sitting next to:
one magnifier, pressable, opening the analysis for whatever is typed. The leading
decorative magnifier went with it — two on one field, only one of them pressable,
is worse than none. The shortcut still works and is named in the tooltip.

### The closing band, and the scrollbar that went away

**Nothing on the landing page is a written-down number.** The reference mock
ends with "2.31M+ battles analysed" over a sparkline; this ends with a histogram
of the real card list, counted from `CARDS` at render time. If a card is added
the chart moves on its own. That restraint is the whole point of a trust
section — one that opens with a fabricated figure is worse than none, and this
one has to survive a reader checking it.

The three claims beside it are properties of how the thing is built, each
checkable in this repo: `mode=ro` on the database connection, the 8-deck /
2-shell evidence floor, and evolved forms counted as their own cards.

**The chart is a histogram, so height carries the value and colour carries
nothing.** One flat hue, no legend (the title names the series), the count
printed above the tallest bar only, and the whole column as the hit area rather
than the 30px bar.

**The scrollbar is hidden in both themes, and nothing replaces it.** There was
briefly a travelling glow on dark, fed by a `--scroll-progress` custom property.
It is gone, and `useScrollProgress` was deleted with it rather than left
dangling: the page did not need it. The content is its own cue — panels are cut
off mid-card at the fold — and a light tracking down the edge of a three-screen
page is decoration pretending to be a control.

### The ink/solid mix-up, for the third time

"Open Duel Builder", "Open Deck Builder" and "Open Counter Palette" were
`background: var(--tool-hue)` — the INK step, which on dark is the pastel. So
each button became a mint or lilac slab that then needed *dark* text to be
readable, which is precisely the "dim and opaque in dark mode" complaint this
project keeps rediscovering. Measured:

| | dark fill | white on it |
|---|---|---:|
| was `--tool-hue` | `#a78bfa` | **2.72:1** |
| now `--tool-solid` | `#6d28d9` | **7.10:1** |

**The chart bar is the exception, and it is worth knowing why.** It is also a
fill, but it carries no text — and the solid ramp is graded to hold white, which
makes it *dark*. On the dark card `--solid-blue` measures **2.60:1** against the
surface where `--hue-blue` measures **5.39:1**. Applying the "fills use solid"
rule there would have made the bars harder to see, not easier. The rule is
really *fills that carry `--on-solid` text* use the solid ramp; a bare graphic
mark takes whichever step actually contrasts with the surface it sits on.

### A third blue, and the rule the ramps actually encode

"Dominate." and the histogram both read as washed on dark, and the fix was not
the solid ramp. Measured against the dark card:

| blue | vs surface | verdict |
|---|---:|---|
| `--solid-blue` `#1d4ed8` (what light shows) | **2.60** | fails even the 3:1 floor |
| **`--hue-blue-deep` `#2563eb`** | **3.37** | the deepest that clears it |
| `--hue-blue` `#5b8def` | 5.39 | what was there — legible, but pastel |

`--hue-blue` is graded to hold **4.5:1 at 14px**, which is why it is light. At
57px that headroom is wasted: large text and graphic marks only need **3:1**, so
they can spend the difference on saturation. Hence a third step, used only for
24px+/bold type and bare marks — never body copy. Light sets it to `#1d4ed8`,
the value light already showed, so the component needs no theme branch and the
light theme is byte-identical.

So the ramps encode a rule about *what the colour is doing*, not about theme:

* **`--solid-*`** — fills that carry `--on-solid` text. Graded to hold white.
* **`--hue-*`** — ink at body size. Graded to hold 4.5:1.
* **`--hue-blue-deep`** — display type and graphic marks. Graded to hold 3:1.

Reaching for the solid ramp because "it is a fill" is what would have made the
bars *darker than the page*. The question is never which ramp is for fills; it
is which contrast floor this element has to clear.

---

## The revamp, in order, with the reasoning

### 1. Make it fast

The brief: *"we don't need any responsive large elements slowing it down, and
any animations etc cut them down."*

framer-motion was removed entirely — not disabled. It animates by writing inline
styles from JavaScript, so a global CSS `animation: none !important` cannot
touch it; the first attempt looked like a fix and changed nothing, and probing
the page found a mouse-spotlight element still translating 827px.

Measured on direct entry to `#/builder`, before → after:

| | Before | After |
|---|---|---|
| JS | 434.4 kB | 270.5 kB (−38%) |
| CSS | 91.8 kB | 67.3 kB (−27%) |
| Idle main-thread work | 54.6 ms | 1.1 ms (−98%) |
| Style recalcs while idle | 27 | 0 |

*(That −38% is for direct entry. The first measurement navigated via `/`, which
pulls the landing chunk, and showed −1% — worth knowing before quoting a
number.)*

The screens added since have grown the bundle again; the current build is
414.9 kB JS / 149.9 kB CSS (123 kB / 24 kB gzipped), with jsPDF kept as a
dynamic import that is never fetched on load.

Also removed: the global aurora/particle layers, 29 `backdrop-filter` passes
outside the (now deleted) landing, and multi-layer box-shadows. Motion removal
was verified with `document.getAnimations()` returning empty, not by looking.

### 2. Get the neutral ground right

Three palettes were tried and two were wrong. An indigo set, then a warm
espresso set, were both applied against Noguchi Design references before the
verdict came back: *"you have taken wrong colour patterns."* The reset was to a
researched neutral ramp — the section above.

### 3. Rebuild the post-login page as a dashboard

The cinematic landing was deleted (it was being replaced, so it was never worth
optimising). In its place: a top bar, a sidebar of analytics sections, and a
content panel. The three deck tools open *inside* that panel rather than
navigating away, so the chrome stays put.

Glass panels came back at the user's request, on both themes — which required a
page wash behind them, because a `backdrop-filter` over a flat colour has
nothing to refract and just looks like a flat colour. They were later dropped
again for solid surfaces, also at the user's request and for better reasons;
see [step 11](#11-the-ui-pass--drop-the-glass-colour-the-rail-wire-the-nav).
The page wash stayed — it now shows only in the gutters between panels, at half
its old strength in light mode.

### 4. Connect the database

Offline first, with migration to a cloud VPS as an explicit later goal — hence
the environment-variable seam and the HTTP boundary described above. The bot on
the desktop was read for the storage model rather than a new one being invented.

### 5. Player analysis, then Duel Analysis

`#/player/<tag>` first (top decks, use/win trends), then real date windows and
live trophies, then `#/player/<tag>/duels`.

Sidebar sections live in the **URL**, not component state, so an analytics
screen is linkable and survives a refresh. The sidebar is navigation, not a
toggle.

### 6. The five-hue accent system

Target: a premium analytics dashboard with Clash Royale identity — colour
communicating meaning, over a ground that stays neutral.

The root cause of the flatness was narrower than it looked. Every selected state
in the app routed through **one token**, `--accent`, which was `#EDEDED` dark /
`#1A1A1A` light. So a selected sidebar item was literally a solid white slab
with black text, and a selected tab, a selected chip and a primary button were
all the same monochrome block. Fixing it was mostly a token-layer change, not a
thirty-file rewrite.

Worth noting about the reference dashboard this was modelled on: **its selection
states are not coloured either.** Its active sidebar item and active time tab
are subtle grey fills. Its richness comes from colour marking *identity* — one
hue per metric card, per series, per progress bar. Selection here does take a
hue, by choice, but as a level-2 tint rather than the solid slab it replaced.

Then a visual pass, because tokens compiling is not the same as a page looking
right — two things only showed up on screen and are recorded below.

### 7. Duel Zone

The `!duels` series log and the `!duelspdf` deck-sequence page, ported into two
windows over one read. Building it turned up the splitter leaving two-game
`1-1` fragments — a scoreline a duel cannot end on — which is where
`_merge_unfinished` came from, and the measurement that says the reuse threshold
itself must not move.

### 8. Cards, and three sidebar sections that were really filters

Use rate and win rate for all 122 cards per player, with the window and the game
mode actually driving the query. Win Conditions, Champions and Evolutions moved
out of the sidebar and became tabs on it.

### 9. Colour corrections, all measured rather than eyeballed

Analyze went green and Upgrade Now blue on request, which needed two new text
tokens because the dark steps of green and blue cannot carry white. Then the two
themes were sampled pixel-by-pixel and a real asymmetry came out of it — a
selected control reading 2.4x louder in dark than in light. Both are below.

### 10. Deck Counter, designed backwards from the data

The brief came with a three-screen mock. Auditing the database against it first
is what produced the screen that exists: two of the mock's promises could not be
kept (an exact deck-vs-deck record, an average match time) and one of its
implicit assumptions was actively wrong — the stored matchup table is biased
towards whoever was being tracked, so read straight it says everything counters
everything. The section above has the numbers; the point here is that the audit
came before the layout, not after it.

### 11. The UI pass — drop the glass, colour the rail, wire the nav

A sweep rather than a feature: solid panels everywhere, a depth ladder that
behaves the same in both themes, a sidebar that lights each section in its own
colour and collapses out of the way, and Home and the brand actually returning
home. Full reasoning in
[The UI pass](#the-ui-pass--surfaces-selection-and-navigation).

### 12. Deck Counter, rebuilt around the pasted deck

The screen answered every question at archetype level, so the cards you pasted
changed nothing. It now reads the exact list first and widens only as far as it
must — exact pair, this deck, one card different, two cards different,
archetype — and prints which rung answered. Duels were verified to be in the
data already; the *suggested* deck moved to the same population so that it is.
Pasted decks draw their evolutions on paste, every list pages, and the tables
line up. Full reasoning in
[Deck Counter](#deck-counter--what-beats-what).

### 13. Read the level, not the art string

Not a feature at all — a field. Every art lookup in the project read
`player_evo`'s `art` string, which is a derivation that loses 16.1% of what it
derives from; the LEVEL beside it is exact. Heroes stopped disappearing, three
decks stopped claiming three evolutions, and a measurement this file had been
quoting for weeks turned out to be backwards. Full reasoning in
[the level says which form it is](#the-level-says-which-form-it-is-the-art-string-does-not).

### 14. Coach Assist

The bot's duel advisor, in two windows: what they will bring, and what you
should answer with. Both are interviews rather than forms, because a duel has a
state and the useful question is different at each one. Scored on the Deck
Counter's evidence ladder rather than a trained model — card-sensitive, and it
prints which rung answered. Under it sits the thing that is not a prediction at
all: the real three-deck loadouts they have run containing the deck you pasted.
Full reasoning in [Coach Assist](#coach-assist--mid-duel-help).

---

### 15. The deck builder, as two columns

The card pool moved out of a drawer that covered the decks and into a column
beside them, on all three deck screens at once. The filter and the deck panel's
action row both had to shrink to pay for it, and the pool gained search and two
value filters. Full reasoning in
[The deck builder](#the-deck-builder--two-columns-instead-of-a-drawer).

### 16. The home screen, and a gate

Deck Analysis, Cards and Deck Counter became real screens; Duel Analysis, Duel
Zone and Coach Assist went behind a Royal Pro gate that shows the feature
blurred rather than an empty box. The global card board rides on the meta
rollup's existing scan, and the matchup spread's diverging palette was re-poled
to amber after the validator failed red/green in dark mode. Full reasoning in
[The home screen](#the-home-screen--three-real-areas-three-behind-a-gate).

### 17. Evolutions 0, and the message that was the bug

A player showed zero evolution combos while their battle history plainly had
evolutions. The counting was right both times; the explanation was wrong twice.
`duel_decks()` gained a `span` so the tab can quote the dates it found nothing
in, and the four stat tiles stopped saying "not enough duels" about a player
with 96 of them. See
["Why is Evolutions 0?"](#why-is-evolutions-0--two-emptinesses-that-shared-a-sentence).

### 18. The landing screen

The staged backdrop pair and the character were wired up for the first time, the
hero became copy-left/character-right, and the rail left the landing screen for
a grid of painted blocks under the search. The global `animation: none
!important` kill-switch was narrowed to `prefers-reduced-motion`, which is what
made every micro-interaction in the app possible. Then a static per-hue glow for
dark mode, where `--shadow` is transparent by design and there was no elevation
cue at all. Full reasoning in
[The landing screen, rebuilt](#the-landing-screen-rebuilt).

### 19. Painted headings, the gate hue, and a font that could not bold

Analytics blocks and tool titles became white marker lettering on a solid block
of their own hue. The Royal Pro gate stopped mixing a violet badge with a maroon
CTA and now wears the hue of the area it gates. `font-synthesis: none` was
narrowed to `weight`, which is what made `font-weight: 600` do anything at all
on a single-cut display face. The ⌘K chip became the submit button, and the
doubled focus box (wrapper ring + inner outline) collapsed to one indicator.

### 20. A closing band, and three rounds of colour correction

The page got an ending: three checkable claims and a histogram of the real card
list, counted at render time — no invented "battles analysed" figure anywhere.
The scrollbar was hidden, briefly replaced by a scroll-tracking glow, then the
glow was removed too and its hook deleted. Colour was corrected three times over
this stretch, each time the same underlying confusion between the ink and solid
ramps, and it ended with a third blue step and a clearer statement of what the
ramps actually encode.

### 21. Both storage tiers moved to H:, and the site followed

Not a feature — a path. The bot moved its operational database from
`C:\ClashBot\data` to `H:\ClashBot\data` on 2026-08-17 (retention 60 → 150 days,
which no longer fits an internal SSD), and this project's default still pointed
at the old file. It would not have failed: that file was a valid database, so
the site would have served a frozen snapshot indefinitely. One env-backed
default changed, and the two READMEs stopped promising a local fallback that the
migration had deleted. Full reasoning in
[Where the data comes from](#where-the-data-comes-from).

### 22. Copy and Open in Game, on every deck the site draws

The duel builder had both actions; the nine analytics screens that draw decks
had neither, so the deck that beats yours had to be rebuilt by hand. One shared
component, an 8-card guard that keeps it off duel loadouts and partial card
lists without any caller knowing why, and the server's own arrangement used as
the link order. Full reasoning in
[Every deck can be copied and opened in the game](#every-deck-can-be-copied-and-opened-in-the-game).

### 23. Real accounts, and a gate that is per-feature

Supabase replaced the twenty bundled SHA-256 hashes: sign-up, sign-in, a
three-day trial derived from a timestamp rather than switched by a job, an
onboarding form, and one desktop plus one mobile per account enforced by a
primary key. The first cut put a wall in front of the whole site and that was
wrong — the landing page is the main page, and the gate stands in front of five
analytics areas rather than in front of the door. Three flaws came out of this
step, one of them a live privilege escalation. Full reasoning in
[Accounts, tiers and the gate](#accounts-tiers-and-the-gate).

### 24. The admin console

Every account and tier, role changes, end-a-trial, what the deployment can
reach, and how full the database volume is — one screen, because it answers one
question. It shipped with three layout bugs of the same family, each of which
rendered the content and then hid it. See
[The admin console](#the-admin-console).

### 25. Off the home machine, and onto a domain

`battles.db`, `server/app.py` and the bot all moved to a Contabo VPS behind
Caddy; `deckkies.com` and `api.deckkies.com` replaced a `vercel.app` subdomain
and a Cloudflare tunnel. The analytics screens work in production for the first
time. This contradicts an older "deliberately not done" entry and the entry was
right — what changed is that the bot moved too, so nothing is replicated. See
[The move off the home machine](#the-move-off-the-home-machine).

### 26. A card filter that closes rather than empties

Picking cards narrows a deck list to those holding all of them. The
non-matching rows collapse on a measured height instead of unmounting, so the
page does not jump; the duel builder dims instead of collapsing, because its
decks are positional. `docs/UI.md` has the measurement trap and the CSS-module
class-name trap that cost an hour of looking for a bug that was not there.

---

## The WebGL layer

Full detail is in **`docs/UI.md`**. The short version:

**What ships** is four components. Drifting **fireflies** — over the landing
hero, and pinned to the viewport behind the whole signed-in shell — plus the
painted castle backdrop on the login page. A **deck-column layer** carrying
three effects on one canvas. A **card ring** behind the screens that are waiting
to be given something. And **liquid metal** on the circular icon controls.

| | where | what it does |
|---|---|---|
| `Fireflies` | landing hero, app-wide backdrop, login, the Pro gate | ambient; takes the open area's hue everywhere but the landing |
| `DeckFx` | the deck column on all three deck screens | aura on empty special slots · burst on placement · sweep at 8/8 |
| `DeckOrbit` | both paste screens, the empty palette gallery | gives an empty invitation a subject |
| `LiquidMetal` | every circular icon control, app-wide | a travelling chromatic rim on hover and a ripple on press |

`LiquidMetal` is the one piece here that is **raw WebGL2 rather than three.js** —
the reference is, there is no library to defer, and the whole thing is ~10 kB in
the main bundle. `three.module` is unchanged and still absent from it.

**There was a fourth, and it is gone.** `ReadingDeck` drew eight card plates
riffling in a WebGL fan on every slow read. It is deleted, replaced by
`UplinkLoader`, which is DOM and CSS — see
[The loading states](#the-loading-states-were-the-real-gap). The loading screens
therefore pull no three.js at all now and spend none of the ~16 WebGL contexts
a document is allowed.

### The motes reach the foot of the page, and did not used to

The app-wide layer widened its **horizontal** spread for covering a whole
viewport — `4.2` against a hero panel's `2.4` — but its **vertical** span was
left at the panel value, hardcoded in two places: the position buffer and the
shader's `mod`. Motes lived in `y ±1.2` and the edge fade
`smoothstep(1.2, 0.75, …)` reached *zero* at exactly `±1.2`, while the camera
sees `±1.41` at the near depth band and `±1.99` at the far one. The bottom of
every page was simply outside the field.

Measured by diffing consecutive frames, per fifth of the viewport, averaged
over five pairs — changed pixels per 10,000:

| band | before | after |
|---|---:|---:|
| 1 (top) | 26.6 | 21.3 |
| 2 | 36.0 | 38.1 |
| 3 | 50.8 | 30.0 |
| 4 | 21.3 | 38.3 |
| **5 (foot)** | **8.9** | **42.2** |
| foot ÷ page mean | **0.31×** | **1.24×** |

The span is now **one value** feeding both the buffer and the shader — those
two disagreeing is how the bug happened — and the fade is a *fraction* of it
rather than two literals, so widening the band can never leave the fade
behind. `5.6` covers the far band with the fade still ~86% open at the very
edge. The count rose 240 → 520 with it, or the same motes would just be spread
thinner over 2.33× the height. Still one draw call.

**three.js is never in the main bundle.** It is a dynamic import, so it lands in
its own 734 kB chunk (190 kB gzipped) and arrives only when something renders —
exactly the treatment `jspdf` gets. That chunk is byte-identical across all four
components; the main bundle went 518 → 543 kB, and that is the components, not
the library. Verified by grepping the built main chunk for three-internal
strings: zero occurrences.

**One canvas per screen, plus the backdrop.** A browser allows about 16 WebGL
contexts — the ceiling that forced the removed card foil onto a single shared
renderer. `DeckFx` therefore hosts three behaviours rather than being three
components: they already share a renderer, a resize observer, a rAF gate and the
slot-rect scan the aura runs every frame. Measured on the builder: exactly two
canvases.

### The backdrop wears the section's colour

Everywhere except the landing screen, the app-wide fireflies take the open
area's identity hue — the same one its sidebar row and its block already wear.
Measured against the tokens on the live page, all seven areas land within 4–11°
of hue: Deck Analysis and Deck Counter maroon, Cards and Meta blue, Duel
Analysis and Coach Assist green, Duel Zone violet. The deck tools take their own
panel hues.

**The landing stays on the ambient gold/green pair**, deliberately: it is the
one screen with no subject — nothing open, no player loaded — so there is no
identity to wear, and it is where the motes sit over the painted art the warm
gold was chosen for.

Two things make it cheap. The hue is read through a ref and **is not an effect
dependency** — as a dependency, every navigation would dispose a WebGL context
and build a new one, restarting the mote field and spending one of the sixteen.
And the colour **eases** over ~500 ms in the existing loop, because a whole
field cutting from green to maroon in one frame reads as a glitch.

The hue is resolved from `--hue-<name>` at runtime rather than passed as a hex,
so a caller names a role and the theme picks the value — which also keeps these
layers honest about the rule that no component defines a colour of its own. It
is the **ink** step, not the solid one: a mote is a bare graphic mark that has
to be seen against the ground, and the solid ramp is graded to carry white *on*
itself, which would make the motes darker than the dark page.

**The motion ban still holds.** `CLAUDE.md` forbids infinite animation because
the old CSS glow loops animated `box-shadow` and thrashed repaint. A WebGL
canvas is GPU-side and never touches layout, so the reason does not apply — but
a loop nobody can see is still waste, so every frame is gated on an
`IntersectionObserver` and on `document.visibilitychange`.
`prefers-reduced-motion` mounts **no canvas at all**, and every piece keeps the
flat markup it decorates as the fallback.

### Liquid metal on the circular controls

The 14 circular icon buttons — theme, notifications, the avatar, the rail
toggle, the search submit, the library toggle, the modal closes — take a
travelling chromatic rim on hover and a faceted ripple on press, adapted from
ThreeUI's `LiquidMetalButton` (Play Circle).

**Most of the reference could not come across, and the reason is size.** It is a
hero control: its diameter clamps to 72–160px, and the bulk of the effect is an
interior dispersion field — a scalar field painted through a soft plateau once
per wavelength — softened by a half-res gaussian and bloomed through four more
blur passes. Twelve passes a frame.

Every circular button in this app is between 1.1rem and 2.2rem. **18 to 35
pixels.** The interior ribbons would be sub-pixel and the bloom would be
blurring something invisible. What survives the shrink is the part that is a
thin *stroke* rather than an area:

| kept | dropped |
|---|---|
| the travelling chromatic rim, with offsets both across the stroke and along it | the interior dispersion field |
| the faceted press ripple, crest as a cusp rather than a swell | the half-res softening pass |
| the hover / press easing, asymmetric as in the source | the four-pass bloom chain |

**One canvas, not one per button.** The reference gives each button its own
iframe with its own WebGL2 context. A browser allows about 16 per document, and
this project has already paid for that once — the removed card foil had to be
rebuilt onto a single shared renderer because the picker draws 122 tiles. So
this is one canvas that finds every `[data-metal]` control and draws them
instanced, in a single call. Exactly the shape `DeckFx` uses for slot rects.

**It is idle until you touch it, and that came free.** `CLAUDE.md` bans loops
nobody can see; the reference is already built that way, its scene shader
opening with `if(uHover <= 0.0015 …){ o = vec4(0.); return; }`. So the rAF only
spins while something is hovered, pressed, or carrying a live ripple. Measured:
**0 changed pixels** between the resting frame and the frame 1.6 s after the
pointer leaves, with the loop torn down.

**The blend mode is per theme**, the same lesson the fireflies already record:
additive is only correct on black. On a near-white page colour + white clamps to
white and the rim is invisible however far it is turned up, so light paints a
muted rim with normal blending instead. The tint is read from `--text` on dark
and `--text-muted` on light rather than carried as a hex.

Verified by pixel counts, and the isolation matters: comparing two frames **both
under CSS `:hover`** shows 92 changed pixels, which can only be the shader, since
the CSS state is identical in both. A press changes 795 (peak 206) and decays
over the following frames.

#### Four bugs, and one of them made the effect look like it worked

**A `dt` of zero freezes every ease, and the loop then judged itself finished.**
All the easing here is `1 - pow(k, dt)`, and `pow(k, 0)` is 1 — so a first frame
with `dt = 0` produces a step of exactly zero. Nothing eased, so nothing was
drawn, so the liveness test saw an empty draw list and tore the loop down after
a single frame. Measured: **1 frame in 500 ms of hovering.** The fix is a
nominal first `dt` *and* deciding liveness from the input targets rather than
from the eased values — asking "is anything lit yet?" can never start a
fade-in, because on the frame the pointer arrives nothing is lit yet.

**And it looked like it was working the whole time.** The first check compared a
resting frame with a hovered one, saw 3,926 changed pixels, and passed. Those
pixels were the button's own CSS `:hover` background. A verification that
straddles a state change measures everything that changed, not the thing under
test.

**`bindAttribLocation` after `linkProgram` is a silent no-op.** It only takes
effect before linking, so the buffers were pointed at locations 0/1/2 on faith
while the driver assigned whatever it liked. Declare `layout(location = N)` in
the shader instead.

**A backtick inside a GLSL comment ended the shader string — a fourth time**, in
the comment written to explain the fix above, three lines below a warning about
exactly that. Both shaders now carry an assertion in the verification that they
contain no backtick at all.

### The loading states were the real gap

Not a visual complaint. Twelve `Reading…` strings across nine files, each one
line of `--text-muted` centred in an empty panel — against reads that take
**29–57 s** for the Coach and **~166 s** for a cold meta rollup on the spinning
H: volume. Captured in a browser, Player Analysis and Coach Assist were still
showing that single line after nine seconds. A thirty-second wait with no
feedback does not read as slow, it reads as hung.

That was first answered with a WebGL card fan. It proved the tab had not hung
and could say nothing else — and **what a reader wants at second forty is how
much longer**. So the fan was deleted and `UplinkLoader` took its place: a
stepped gauge, a percentage, an elapsed clock and a remaining estimate, adapted
from ThreeUI's `UplinkLoader`. All twelve call sites still collapse onto one
`ReadingState`.

#### The progress is measured, not scripted

The reference drives its bar from a hardcoded keyframe timeline and **loops
forever**: 8.6 s of scripted fill, a hold at 100%, a blank, then round again.
Dropped in unchanged that would have been worse than the fan it replaced — a bar
reaching 100% and restarting while the server is still reading states the
opposite of the truth.

`fetch` reports no progress for these calls; the API answers with one JSON body
at the end. So there are exactly three honest inputs, and the loader uses all
three:

| | |
|---|---|
| **elapsed** | real, from `performance.now()` |
| **expected** | `state/loadTiming.ts` — the **median of how long this screen actually took on this browser**, last five samples, seeded from the figures above |
| **completion** | the component unmounting, which records the sample that sharpens the next estimate |

Measured live: a 6 s stalled load stored **6914 ms** against an observed
**6866 ms**. Loads are keyed per wait, not per screen — the Coach's history read
and its matchup scoring are different costs, and the meta board's cold rollup is
nothing like its warm read.

The curve is **linear across the expected duration then easing**, never reaching
100%: 100 would mean the data is here, and if it were, this component would be
unmounted. A single exponential was tried first and front-loaded badly — the
first second ate a third of the bar. Verified monotonic across twelve samples
(`1 6 11 15 21 25 29 33 37 40 43 46`), never decreasing, never wrapping.

The median is deliberate rather than a mean: a sample is recorded on unmount,
and unmount also happens when a read fails fast or the user navigates away
mid-load. Those land as short outliers that a median of five ignores and a mean
would let drag the whole estimate down.

#### Two floors, from one constant

`MIN_LOADING_MS` is **3 s**, exported by `hooks/useHeldLoading.ts` and imported
by the loader's ramp, so the bar reaches the top of its travel exactly as the
hold expires. Declared separately they would drift, and a bar that leaves at 70%
reads as broken. At that floor the ramp is ~31% a second.

`useHeldLoading` keeps the loading state on screen for that minimum, which
**does delay data that has already arrived**. That is a real cost, taken
deliberately: a loading state that flashes and vanishes reads as a glitch — the
eye registers that *something* happened and cannot tell what. The floor almost
never binds against a 10–160 s read; it binds on a warm cache, which is exactly
the case that looked broken. Measured on an instantly-aborted fetch: **3446 ms**.

The hook takes **the whole guard expression, not a flag**. The meta board's is
`loading && !board`, because it refreshes in the background and must not blank a
populated screen — and `!board` flips at the same instant the data lands, so
holding a bare `loading` would have let the guard fall through anyway.

The one guard deliberately **not** held is the meta board's cold rollup
(`board.building`): a server-side build over millions of rows that reports its
own elapsed seconds, so a 3 s floor there is meaningless.

#### It paints nothing

There was a `className` prop, and every call site handed over its own `.notice`
/ `.empty` / `.loading` — glass surfaces with a border, a fill and a
`backdrop-filter`. The idea was that the component changed what was *inside* the
box and never the box. What it produced was a grey card holding the rig's own
frame, in the middle of an otherwise empty screen, with the app-wide fireflies
stopping dead at its edge.

The prop is gone. `MetaDecks` uses a `.panelBare` for its two loading branches,
and the whole chain from the rig up to `<body>` is transparent — verified
element by element, including that no `backdrop-filter` survives anywhere in it.
The rig is 42 rem, centred horizontally and vertically in the content area
(measured 20 px and 38 px off the middle), and the backdrop runs behind it
unbroken. That is the whole reason `--surface`, `--surface-nested` and
`--glass-fill` were made translucent in the first place.

Vertical centring needed two mechanisms, because the callers disagree about what
they are: `flex: 1` for the ones already flex columns, `min-height: 78vh` for
the plain blocks that would otherwise collapse to the rig's own height. 52vh was
tried and was not enough — the content area starts below the topbar, so a
half-viewport box is centred within itself and still sits in the upper third.

#### The furniture

The reference's rig is more than a bar, and a 42 rem gauge alone read as
floating in an empty box. What is kept: **corner brackets with rotated
diamonds**, **mirrored side rails** — a wire into two caps, then a module with a
hatch, a reticle, an indicator, a slab and four LEDs — a **haze** pooling under
the lit run only, a static **scanline** wash, and a **status line** across the
foot. The right rail is the left one under a single `scaleX(-1)`, exactly as the
reference does it, rather than a second set of offsets to keep in step.

**Every infinite animation was dropped.** The reference runs a procedural film
grain regenerating on a 0.6 s step loop, a neon flicker, a diamond pulse and a
cap pulse. `index.css` bans infinite animation project-wide and is specific
about why — the old CSS glow loops animated `box-shadow` and `filter`, and that
is what made the app lag. A full-viewport animated grain is the worst case of
exactly that class. What survives is one-shot: a tick igniting as it lights, and
the plate flashing when the bar fills. The haze is a gradient sized by a custom
property rather than a blurred div, because `filter: blur()` is the property
those old loops thrashed.

**The status line quotes something true.** The reference prints scripted phases
("SYNCHRONIZING NODE ARRAY"); inventing stages for a database read would be
theatre. It shows the screen's own name and what is left of the measured
estimate, and says `ESTIMATE EXCEEDED` once there is no estimate left to quote.

#### Four things that were not obvious

* **The colour is `--hue-*`, the ink step, never `--solid-*`.** These are bare
  graphic marks that must be seen *against* the panel; the solid ramp is graded
  to carry white *on* itself and would put the lit ticks darker than the dark
  page. All four verified — violet, blue, green, and pink for the maroon
  screens — and re-measured across a theme toggle.
* **Unlit ticks are dim hue, not grey.** A neutral gauge under a coloured one
  read as two unrelated objects. The reference does the same with `--green-dim`.
* **A percentage width cannot size this.** Several callers put the loading state
  inside a flex column with `align-items: center`, which hands children
  `fit-content` — so `min(100%, 42rem)` resolved against a box sized to the
  rig's own content and it shrink-wrapped to **331 px**. The width is stated,
  with `max-width: 100%` to clamp it.
* **A prose measure is not a layout measure.** `MetaDecks`' notice carried
  `max-width: 56ch`, right for its cold-start paragraph and wrong for a gauge:
  it squeezed the rig to **393 px** there while every other screen gave it 672.
  The measure moved onto the copy itself.

**The label is still a `div`, not a `p`.** Four call sites were paragraphs, and
the meta board's cold start passes a heading plus two paragraphs plus a counter.
A `<p>` may not contain those — the browser closes it early and the copy escapes
the box. That counter now reads "Rollup running 48s" rather than "48s elapsed",
because the rig shows an elapsed figure too and the two are different numbers:
one is how long *you* have waited, the other how long the background rollup has
been running.

**It renders under reduced motion**, where the fan did not. The fan was
decoration and hiding it lost nothing; a progress readout is information, and a
reader who does not want animation still wants the number. Only the flashes go.

### The deck column: three effects, one canvas

The builder's resting state is 24 empty boxes and nothing moving. `DeckFx` adds
an **aura** (a slow breathing edge on empty special slots, violet on the
selected one), a **burst** when a card lands, and a **sweep** across a deck's
eight slots the moment it becomes legal.

**Roles get no hue, and that is the rule rather than a preference.** The obvious
design is violet Evolution / gold Hero / green Wild; `index.css` forbids it in
as many words — *"if it were violet you could not tell the Evolution slot from
the SELECTED slot, because violet is what selection means."* So empty specials
breathe in neutral ink, only selection is violet, completion is `--success`
green because a deck becoming legal is a positive outcome, and a crown burst is
gold, which is the one place in this app gold is genuinely earned.

**The burst is the only placement feedback that exists.** `useFlightStore.launch`
is a no-op — the card-in-flight animation is disabled at the store — so nothing
flew from the library to the slot. It also confirms *legality*: an illegal drop
is silently rejected, and without this it looked identical to a legal one.

Effects are fired through a **plain module emitter** (`state/deckFx.ts`), not the
builder store. They are events, not state: nothing renders from them and nothing
reads them back, so putting them in zustand would re-render every deck panel and
all forty slots on each card drop, to move points on a canvas that is not in the
React tree at all. `dragContext.ts` is the same shape for the same reason.

Slots are found by **data attributes**, never by class name — CSS modules hash
those, and `[class*="slot"]` would also catch `slotIcon`, `slotClear`,
`slotStub` and `slotSelected`, which is the substring trap `CLAUDE.md` already
records.

### The sweep that issued its draw call and painted nothing

Worth recording in full, because the diagnosis was expensive and the conclusion
is unresolved.

The sweep began as an instanced quad and never drew a pixel. Bisected all the
way down: the event fired, the listener ran, the union rect was computed
correctly, the program linked with no console error, and `renderer.info`
reported the draw call **issued with its triangles counted**. Yet a hardcoded
400 px quad with a flat opaque fragment was still invisible. Giving it its own
`PlaneGeometry` instead of one shared with the aura, setting
`frustumCulled = false`, and re-uploading its attributes every frame each
changed nothing. The only reading left is that neither `aRect` nor `uv` reached
that one geometry's shader, so every quad rasterised at zero size. **Why was
never established.**

So it was rebuilt on the burst pipeline, which was already measured working —
27,046 changed pixels against a 26 px baseline. The sweep is now a line of
points with **staggered births**: each is born at `clock + its share of the
width × spread`, and the shader parks anything whose birth is still in the
future, so the row lights up left to right with no travelling geometry and no
per-frame work. It measures 272 changed pixels to the left of the burst's reach,
where the quad measured none.

The lesson is the cheap one: `renderer.info` distinguishes *not drawn* from
*drawn and invisible*, and it should have been the first probe rather than the
last.

### The panels had to become translucent

The layer paints on the page at `z-index: 0`, and opaque panels cover nearly the
whole viewport on a tool screen — so at first it only showed in the 16 px
gutters. Three tokens went translucent in both ladders: `--surface`,
`--surface-nested`, `--glass-fill`. **`--surface-strong`, `--surface-sunken`,
`--glass-fill-strong` and `--slot-bg` stay opaque**, because they back the
portal menus and dialogs, which float over arbitrary content.

Two things fell out of that and are worth knowing:

* **A translucent panel over the true-black page composites DARKER than its own
  colour** — 90% of `#202020` is `#1D1D1D`. So making dark panels *lighter*
  meant raising the literal until the composite sat on the rung: panel 40,
  nested 34, raised 46, sunken 28, border 58. `--surface-strong` and `--border`
  both had to move too, or the raised rung would have read as a dent and a
  border on it would have vanished entirely.
* **Light needs a lower opacity than dark** (85% vs 90%). A green mote on a
  near-white page is a far smaller colour difference than a gold one on true
  black, and a tenth of it was invisible.

### Two removed, deliberately

A holographic **card foil** on the picker tiles and a glass **elixir orb** in
the deck stats both worked and were both cut — the card screen read worse with
them than without. A tumbling **login crown** was cut when the painted backdrop
arrived behind it. All three are recoverable from `a452525`; `docs/UI.md` records
what each did and why it went.

### Five things a browser caught that reading did not

Each was written confidently and was wrong: a uniform declared in both shader
stages at different precisions never links; `gl_PointSize` divides by view
depth, so sizes are pre-perspective units and mine rendered as ~600 px blobs
that washed out the hero; translucent 3D over a flat fallback reads as two
overlapping objects; a blanket `.page > *` collapses an absolutely-positioned
layer to zero height; and **setting `data-theme` directly leaves the zustand
store on its old value**, so a `theme === 'dark'` guard stays false, the layer
never mounts, and the check passes against nothing.


## The top navigation dock

The six top-level items — Home, Analytics, Deck Vault, Duel Builder, Counter
Hub, Meta — sit in a glass pill and **expand downward on a spring as the pointer
nears them**, adapted from ThreeUI's `AnimatedTopDock`. Keyboard focus drives the
same field, lighting the focused item fully and its immediate neighbours faintly,
so tabbing through reads as the dock rather than as a separate highlight.

`components/Dashboard/TopDock.tsx` is the markup; `topDockController.ts` is the
physics. They are split because the controller is plain DOM — it measures and
writes boxes every frame, which is not something React should re-render its way
through — and because the controller is built **once** and never rebuilt when the
items change. It re-queries `[data-dock-item]` on every measure and its
`ResizeObserver` catches the rest, so a route change does not reset every spring
to zero velocity at exactly the moment the pointer is most likely to be on it.
Same reasoning as the hue ref in `three/Fireflies.tsx`.

**Three things changed from the reference, and each is a rule this project
already held.**

**The loop stops.** The reference runs `requestAnimationFrame` forever and checks
a dirty flag inside it. That is the shape `index.css` bans, and the reason
`three/runtime.ts` gates every WebGL frame on visibility. Here the rAF is started
by an interaction and tears itself down the moment every spring settles — then it
clears the inline geometry, so a resting dock is pure stylesheet and a later media
query is not fighting stale pixel widths. Verified: **0 style writes in 600 ms at
rest.** The springs snap and zero their velocity inside a threshold, because a
spring converging asymptotically never reaches a frame it can call finished,
which is precisely how the reference ends up needing a permanent loop.

**No `keydown` handler.** The reference intercepts Enter and Space and calls
`item.click()`. These are real `<button>` elements, which already fire `click` on
both — keeping it would have fired every nav handler twice.

**Every colour is a token.** The reference hardcodes its palette; the dock is
built from `--glass-fill`, `--border`, `--text-muted` and the selection tokens,
so it works in both themes with no `[data-theme]` branch of its own.

**The active indicator stayed this app's.** The reference inverts the current
item into a solid white pill. Selection here is violet and is carried by a rule,
for the reason the old `.topNavItem` spelled out — on an underline tab the
coloured *rule* is the indicator, and a pastel label beside a solid sidebar row
is what read as washed. The dock keeps the rule and adds a wash so the item still
reads as one object inside a glass shell. `aria-current="page"` replaced
`aria-pressed`: these are destinations, not toggles.

**The proximity field had to be retuned, and reading the code would not have
caught it.** Proximity is measured centre to centre, so the reference's `122`
cannot be copied: its items are 94 px wide and ours run 87–127 px. At `122` the
falloff measured **0.17 px** on the nearest neighbour — one item moving alone,
which is not a dock. At `210` the profile is **4.17 / 10.98 / 3.66 px** across
three items.

**One deliberate deviation.** It writes `width` and `height` per frame, against
the transform-and-opacity-only rule. The magnification *is* neighbours being
pushed aside and a transform cannot push a sibling; `scale` was the alternative
and it distorts the label text, which is the entire content of these items. What
made the banned CSS loops expensive was being *infinite* and animating
`box-shadow`/`filter` across the whole page. This relayouts six flex children
inside one bar, only while the pointer is physically on the dock.

`.topbar` went to `z-index: 2` for this. It and `.body` were both at `1`, and
with `.body` later in the DOM the content panel painted over the bar — so items
dropping below the topbar's edge were occluded by the page they hang over.

**Below 900 px it is a plain scrolling nav.** A coarse pointer has no hover
position to measure, `prefers-reduced-motion` disables it outright, and under
1000 px the labels go and the dock is icons, with `aria-label` carrying the name
on every item. Verified in all three states.

## The primary buttons

Twelve buttons across the app wear a solid fill and carry `--on-solid` text —
Search, Analyze, the three tool CTAs, Apply on four date pickers, and the paste
and action buttons on the analytics screens. They now share one treatment,
adapted from ThreeUI's `RectangleButtons` family, in
`src/styles/cta.module.css`. Each button opts in with
`composes: cta from '../../styles/cta.module.css'` and keeps everything else it
had.

Two of the family's treatments carry the whole idea:

| | from | what it does |
|---|---|---|
| **the lit edge** | `aster-glass` | a 1px gradient border, bright where light would fall and near-gone on the opposite side |
| **the sheen** | `trochil-signal` | a diagonal wash parked off the left edge that slides across on hover |

Plus the family's lift on hover and return on press.

**The edge is a real gradient border, which is why it is masked.** A
gradient-filled box is clipped against its own content box with
`mask-composite: exclude`, leaving exactly the 1px ring. `border-image` cannot
do this with a border radius. Safari still needs the `-webkit-` pair, and its
keyword is `xor` rather than `exclude`.

### It defines no colour, and that is what let it go on twelve buttons

The reference hardcodes white for both layers — `rgba(255,255,255,.72)` — which
is fine because every one of its variants sits on a dark ground. These buttons
do not agree on a ground: they wear `--solid-maroon`, `--solid-green`,
`--solid-violet` and whatever `--tool-solid` a panel sets, in two themes.

So both layers are mixed from **`--on-solid`**, the token already guaranteed to
read against whichever fill the button wears — and which is theme-scoped
precisely because white is wrong on light-mode green. The edge and the sheen are
the button's own ink at low alpha. No per-button branch, no hue argument, no
`[data-theme]` rule. Shape is inherited the same way: every layer is
`border-radius: inherit`, so a 9px button and a 14px one both get a correct edge
with nothing passed in.

### The stacking is the fiddly part

Both layers are `z-index: -1` under `isolation: isolate`. Within a stacking
context the paint order is: the element's own background, then negative-z
descendants, then inline content — so a negative-z pseudo-element lands **above
the fill and below the label**. That is what makes this work on buttons whose
label is a bare text node.

The obvious alternative — a positive z-index plus `.cta > * { position: relative }`
— silently paints the sheen *over* the text on every button that does not wrap
its label in an element, and half of these do not.

### Two things the browser caught

**A local `:hover` transform quietly overrode the shared one, including under
reduced motion.** `.analyzeButton:hover` restated `transform: translateY(-1px)`,
which beat the shared `-2px` and — because the shared rule drops the lift under
`prefers-reduced-motion` and the local one did not — kept lifting for readers who
had asked for no motion. Measured: the button still moved 364.48 → 363.48 with
`reducedMotion: 'reduce'`. The local transform is gone; colour and glow stay,
since those are the button's identity rather than motion.

**One of the twelve is a `span`, and its hover target is its parent.**
`.toolCta` is a label inside a clickable panel, so the shared `:hover` never
fires for it — the pointer is on `.toolPanel`. Three rules forward the panel's
hover onto the composed pseudo-elements by hand, including the reduced-motion
case. Without them that button had an edge and a dead sheen.

**Four pill-shaped CTAs were deliberately left out** — the Pro gate's Upgrade
Now, the deck panel's launch chip, the library's primary and the login submit.
The brief was rectangles, and a 999px radius is a different shape decision; the
treatment would apply to them unchanged if that is wanted.

## The theme switch

There were **five** theme toggles: a circular icon button in the topbar, a
two-glyph button in the builder header, and three more that were a bare `☾`/`☀`
in a round button. Same job, five shapes, five subscriptions to the theme store.
They are now one `ThemeToggle`, adapted from ThreeUI's `SkeuomorphicToggle`, and
the only thing that differs between call sites is a `size`.

### One knob, and the reference's own proportions

Everything is expressed in units of the track height, exactly as the reference
does it, so a caller sets `--h` and nothing else has to be kept in step:

| | reference | here |
|---|---|---|
| track | 192 × 64 | `3h` wide |
| padding | 6px | `0.094h` |
| cap | 116px | `1.8125h` |
| travel | 64px | **derived**, not restated |

Travel is `--w - 2·--edge - 2·--pad - --thumb`. Deriving it is the point: the
reference hardcodes 64px, and a hardcoded travel silently breaks the moment the
width or the cap changes. Measured on the shipped control: **near gap 3.80px,
far gap 3.80px** — flush at both ends.

It cannot be a percentage. A percentage inside `translateX` resolves against the
**thumb's** width, not the track's.

### Where the depth comes from

Skeuomorphism here is two opposed lighting stories on one control. The track is
a **groove**: shadow inset at the top lip, highlight inset along the bottom. The
cap is a **cap**: highlight along its top edge, shadow cast downward onto the
track it sits in. Pressing tightens the cap's cast shadow, so it settles into
the groove.

The reference hardcodes those as white and black at fixed alphas and ships a
whole second palette to patch between light and dark. This uses **`--highlight`,
which is already theme-scoped** — white at 4.5% on dark, 90% on light — so the
same declarations describe a lit groove in both themes with no `[data-theme]`
branch of its own. That is the single thing that let the depth survive the move
onto this palette.

Checked takes `--accent-select`, because violet is what this app means by "the
state you chose" everywhere else. Its outer bloom is gated on `--glow-core`,
which light sets to 0%.

### It is a switch, and it says so

`role="switch"` with `aria-checked`, which the reference uses and the five old
buttons did not have. Not pedantry: a button announces "Toggle theme" and tells
you nothing about where you are, while a switch announces its state — which for
a control whose whole job is to be in one of two states is the entire message.

**Checked means dark, and the face reads state rather than action.** The toggle
shows DARK when dark mode is on, where the old buttons showed a sun to mean
"clicking gives you light". Both conventions exist in the wild; a switch has to
use the first, or `aria-checked` and the label contradict each other.

Native button keyboard handling is kept rather than reimplemented — Enter and
Space already activate it, and the reference's own `keydown` handler would
double-fire on a real button. The same reasoning as the top dock.

Two consequences worth recording. **The five callers lost their store
subscriptions**, since the toggle subscribes for itself — `tsc` found all ten
dead bindings and the now-unused icon imports. And **the topbar one dropped
`data-metal`**: it had liquid metal while it was a circle, and a 3:1 track is
not one. Verified: no overflow at 1500px or 1180px.

Below 720px the word is dropped and the cap shrinks to a disc — only `--w` and
`--thumb` change and travel re-derives itself.

### Every neutral font is at full contrast now

Asked for directly: **grey text is gone.** `--text` and `--text-muted` are pure
`#ffffff` on dark and pure `#000000` on light. Coloured ink — `--hue-*`,
`--solid-*`, `--on-solid`, the chart series — is untouched.

It was a four-line change because the ink is fully tokenised: a sweep for
hardcoded greys across every module found exactly one `color: #ffffff`, on a
painted tile. The only other place carrying its own ladder was Duel Analysis,
which defines a scoped `--text` / `--text-secondary` / `--text-muted` /
`--text-faint` set for its light brief — all four are flattened to match, or
that one screen would have stayed grey while every other went to full contrast.

**What it costs, stated plainly: `--text-muted` is now the same colour as
`--text`, so the primary/secondary distinction in ink is gone.** Hierarchy has
to come from size, weight and spacing instead. That is the trade the request
makes, not a side effect — and it is worth knowing before someone "fixes" the
muted token back.

**It also closes both of the known contrast failures** recorded under
[Known, measured, and not yet fixed](#known-measured-and-not-yet-fixed): the
Duel Zone pane blurb at 4.19:1 was `--text-muted` on a violet fill, and it is
now black or white on that fill.

#### Opacity is the other way text goes grey

Setting the token is only half of it. Text that is pure white inside a container
at `opacity: 0.7` composites back to grey, and a sweep of the `color` property
alone reports it clean — which the first pass did. A second sweep walking the
ancestor chain and multiplying the effective opacity found five more:

| | | |
|---|---|---|
| `.slotStub` | 0.7 | the EVO / HERO / WILD labels — **raised** |
| `.addDeckCount` | 0.8 | a plain count label — **raised** |
| `.statusKey` | 0.75 | the loader's status label — **raised** |
| `.launch[aria-disabled]` | 0.4 | **left alone** |
| `.reset[aria-disabled]`, `.tileDisabled` | 0.45 | **left alone** |

The last two are deliberate. **On a disabled control the dimming IS the
affordance** — taking it to full contrast would make a dead button look live,
which is a functional regression dressed as a legibility win. Those three are
the only neutral text left below full opacity anywhere in the app.

## The filmstrip

`components/Filmstrip/` is a browsable strip of cards adapted from ThreeUI's
`CharacterCarousel`. A perspective stage, cards pinned to the centre and pushed
apart by transform, and a `--focus` custom property per card driving shadow
depth, inner hairline and media saturation together, so the centred card reads
as the subject and its neighbours fall back. Drag, horizontal wheel, arrow keys,
click-to-centre, position dots.

**The delivery mechanism did not come across.** The reference ships as an iframe
running its own document with its own rAF and a `postMessage` control channel —
a shape that exists so a gallery site can drop an authored page into a box. Here
the cards are this app's own data and have to open this app's own screens, so
there is no iframe, no bridge and no second document. Its palette did not come
across either: the reference is one fixed editorial scheme (`#d8c9ad` paper,
orange indices), and this has two themes and per-section hues, so every value
resolves from a token.

**The loop stops**, like the dock and the metal: the rAF starts on an
interaction and tears itself down once the strip settles on an index. Under
`prefers-reduced-motion` the position snaps instead of easing — the strip is
content, so it still renders and still browses.

**Position is a float in a ref, not in state.** It changes every frame while the
strip moves and every card's transform is written from it directly; in state it
would re-render the strip sixty times a second. `current` *is* state, because it
is what the rest of the UI reads and it changes once per card.

### Where it is used

**The landing screen's seven analytics areas.** They were a seven-across grid,
which on a wide screen made each block a narrow column of clipped blurb and on a
narrow one stacked into a long scroll. As a strip each area is one card at
readable size, wearing its own hue — the same one its sidebar row and its
section carry — through the per-item `hue`, so seven identities are not
flattened into one.

**It opens on Duel Zone**, which is the middle of the seven, so cards fan to
*both* sides and the strip reads as something you are standing in. It carries no
`n / 7` readout — the dot rail already says where you are, and two indicators of
the same thing is one too many. Opening on
the first piled every other card off to one side. The index is found by label
rather than written as a literal, so reordering `SIDE_NAV` cannot silently move
it to an end. The default with no `start` is the middle item, for the same
reason.

**The Counter Hub's folder gallery.** Each card shows the faces of up to four
decks the folder holds, so what you choose between is visible rather than a name
and a count.

**Meta and the saved decks were deliberately left alone, because on both the
carousel would remove function rather than re-skin it:**

* **The meta board is a ranked comparison table.** Its content is read *down*
  the columns — rank, use rate, win rate, across dozens of decks at once. A
  carousel shows one deck at a time, which is the one presentation that makes
  that comparison impossible.
* **The saved decks are editable panels.** `DeckPanel` is where a deck is built
  — cards drag in and out of its slots, and it carries rename, clear, import and
  Open in Game. Collapsing one into a filmstrip card turns an editor into a
  thumbnail.

Both are one call away if browsing matters more than comparing or editing on
those screens, and the component is already general enough to take them.

### Prev / next, and why activation left the click event

Two round glass controls flank the strip: a translucent fill, a 1px gradient
edge masked out of its own content box the way the primary CTAs do it, and a
sheen across the top. Every value is mixed from `--text` and `--highlight`,
both theme-scoped, so the same declarations read as brushed metal on the dark
page and frosted glass on the light one. They carry `data-metal`, so the WebGL
layer adds its travelling chromatic rim on hover on top. Disabled at the ends
rather than wrapping.

They also close a real gap: **only two neighbours a side are drawn**, so the
outermost cards are reached by the arrows or the dots rather than by clicking
something that is not on screen.

**Activation does not use the click event, and that took three attempts to get
right.**

1. The card was a `<button>` with `onClick`. Real clicks did nothing, because
   the stage calls `setPointerCapture` on `pointerdown` to track a drag — and a
   capture retargets the later `pointerup`, so the browser synthesises `click`
   on the stage rather than on the card. **The check passed 7/7 against this**,
   because it used `element.click()`, a synthetic dispatch that skips the
   pointer sequence entirely. A carousel check that never presses a real mouse
   button is testing nothing.
2. Capture was deferred until the pointer had travelled 4px, so a click never
   captures. That fixed five cards of seven. The two furthest still failed:
   a card rotated under perspective projects to a **trapezoid**, and past about
   30 degrees that trapezoid stops containing the centre of its own bounding
   box. Measured with `elementFromPoint` over a grid, the last card had no
   hittable point anywhere inside its box.
3. So activation moved off the click entirely. `pointerdown` lands on the card
   every time; the index is recorded there and acted on at `pointerup` if the
   pointer never travelled. The keyboard gets its own explicit `keydown` for
   Enter and Space. Verified with real `mouse.down()`/`up()`: **5/5 rendered
   cards open, a drag still browses, and a drag opens nothing.**

The fan was softened with it — 11 degrees a step capped at 26, depth 140 — so
every drawn card stays a comfortable target.

### Hover responds, click opens, and hover-to-centre had to be removed

Clicking any card opens it. The reference centres a card on click and opens
nothing, because its cards are portraits with nowhere to go; these are
destinations, so a click that only re-centred left the strip a dead end.

**Centring on hover was built and then taken out, because it walks the strip
along by itself.** Centring the card under the pointer slides that card out from
under the pointer, the next one slides in, its own `pointerenter` fires, and the
strip keeps stepping. Measured: hovering card 2 left the strip resting on card 1.
Hover is now a visual response only — border, name and media saturation, none of
which the controller writes — and browsing is drag, wheel, arrows and the dots.
Keyboard focus *does* centre, because focus does not follow the pointer and
therefore cannot feed back.

### One structural constraint worth knowing

**Items' own controls render UNDER the strip, for the centred item only.** The
card is a `<button>`, and a button may not contain buttons — the browser closes
the outer one early and the whole card stops working, which is exactly the trap
the Duel Zone's series row already hit. So `FilmstripItem.actions` is a slot
below the stage rather than inside the card. It also means one control row
instead of one per card, which is what makes a strip of forty tractable.

The stage is sized `card + 7.5rem`, not `+ 3.5rem`: the card is centred, so only
half the slack sits beneath it, and at 3.5rem the control row overlapped the
card's bottom edge by about 17px.

**And those controls did not work at all at first.** The stage calls
`setPointerCapture` to track a drag, and a pointer capture retargets every later
pointer event — including the `pointerup` that completes a click — at the
capturing element. So Rename, Delete and the position dots received `pointerdown`
and then never saw their own click. The drag now refuses to start on anything
inside `[data-filmstrip-controls]`.

## Things that went wrong and what fixed them

Kept because each one cost time and each one can recur.

**IF AN ELEMENT IN A FLEX COLUMN SCROLLS, IT NEEDS `flex: none`.** Stated as a
rule because it has now been fixed three times in one day, in three files, and
knowing the mechanism did not stop the third.

A flex item will not shrink below its automatic minimum size — normally its
content — but **any `overflow` other than `visible` sets that minimum to zero**.
So the one child that scrolls is the one child the flexbox is free to crush, and
it crushes it to whatever is left over. Every time, the content was present,
correct, and invisible:

| where | scrolled for | crushed to |
|---|---|---|
| admin console, accounts table | `overflow-x` on a wide table | the height of its own `<th>` |
| admin console, storage meter | `overflow: hidden` to clip a ripple | nothing at all |
| dashboard, phone nav strip | `overflow-x` to scroll sideways | 11px, around 38px chips |

The first two were reported by a person looking at the screen. The third was
caught by a browser probe before it shipped, which is the whole argument for the
verification convention.

**The Deck Counter drew no decks on any screen under 1150px.** The rule said
`display: none` on the deck column while the comment directly above it said the
deck "spans the row on its own line rather than squeezing the figures" — it
never did. Measured on an iPhone 13 against production: 120 card images loaded,
**zero rendered**. A comment describing an intention the code does not implement
is worse than no comment, because it stops the next reader looking.

It also silently took the per-player faced-deck labels with it, so the feature
built the day before was invisible on every phone and tablet.

**Below 860px the site had no navigation at all.** `.sidebar` and `.topNav` are
both `display: none` there and nothing replaced them, so once a phone reader was
inside an analytics area the only way to another was the browser's back button.
Nothing errored, nothing looked broken, and the seven areas were simply
unreachable.

**"Not loaded" and "not drawn" are different measurements.** The first probe
counted `img.complete && naturalWidth > 0` and reported `0/10` on the landing,
which looked like broken images and was not — the check ran before the images
finished. What actually mattered was the **rendered box**: `getBoundingClientRect()`
width and height, which found 120 loaded images sitting at 0×0. An image can be
perfectly loaded and perfectly invisible.

**A missing directory broke three screens and nothing reported a fault.** The
worst bug in this project so far, measured by how confident the wrong answers
looked.

`server/duel_combos.py` reads the website's own card files — `cards.json` and
`cardMeta.json` — resolving `_DATA` to `<repo>/src/data`, because the server is
expected to sit inside the checkout. The VPS deploy copied `server/` on its own.
The directory did not exist, `open()` raised `FileNotFoundError`, and this
caught it:

```python
except Exception:
    return
```

`_CARD_INFO` stayed empty. `card_info()` then answered with its default for
every key in the game, and that default says `is_win_condition: False`,
`is_spell: False`, `is_champion: False`, `elixir: 0`. Three screens broke in
three different-looking ways:

| screen | what it showed | why |
|---|---|---|
| Duel Analysis | **Win Conditions and Spells 0 for every player**, Evolutions fine | those two tabs filter on card metadata; Evolutions keys off *observed* evolution slots in the battle data, so it never consulted the missing files |
| Cards | **completely blank**, while still reporting the battle count | `player_cards.py` iterates `dx.card_keys()`, which was `[]`. 1,158 battles, 0 cards |
| Deck Counter | names, styles and average elixir went generic, so every player's rows looked alike | deck naming and `_avg_elixir` both go through `card_info` |

Two things made it survive. The **fallback was plausible**: a card that is not a
win condition and costs 0 elixir is a coherent-looking card, so every payload
was well-formed and every screen rendered. And the **name survived by
coincidence** — the default name is `key.replace("-", " ").title()`, and for
`goblin-barrel` that is exactly "Goblin Barrel", so nothing looked misspelt.

`/status` said the service was healthy, and by its own definition it was: the
database opened. That is the lesson worth keeping — **a database that opens is
not a service that can answer**. `/api/analytics/status` now reports
`cardData: {loaded, count, error}` alongside the storage tiers, the admin
console draws it as a health tile, and the loader prints a named warning to
stderr instead of returning silently. Eleven checks in `test_duel_combos.py`
pin both the working path and, deliberately, the broken one — including
"...and THAT is why every card looked plain".

**A silent default for missing REFERENCE data is not graceful degradation.** It
is a wrong answer delivered confidently, and the only defence is to make the
failure visible. Reference data is not user data: user data can legitimately be
absent, and a card list cannot.

**Deploying `server/` alone is not deploying the service.** `src/data/` goes
with it. That is now in the runbook and in `server/README.md`.

**An undefined custom property does not fall back to something sensible — it
deletes the declaration.** `var(--solid-pink)` where no `--solid-pink` exists is
invalid at computed-value time, and the whole property goes with it. Four
declarations across three files were referencing tokens this project has never
defined, and not one of them looked broken in the source:

| where | wrote | actually rendered |
|---|---|---|
| landing area card, pink | `--area-solid: var(--solid-pink)` | **violet** — the custom property went guaranteed-invalid, so `var(--area-solid, var(--solid-violet))` used its fallback |
| admin console, admin badge | `background: var(--solid-pink)` | **no background**, so `--on-solid` white text sat on the page ground and vanished in light mode |
| admin console, storage bar at >90% | `background: var(--solid-pink)` | **nothing**, at the one fill level the bar exists to warn about |
| sign-in scrim | `color-mix(in srgb, var(--bg) …)` | **nothing** — the card has been sitting straight on the painted backdrop the scrim exists to lift it off |

The pink step in this palette is called `--solid-maroon`, and the neutral ground
is `--bg-1..3` with no bare `--bg`. Both facts were already written down — the
Dashboard's own stylesheet carries a comment saying "`var(--bg, …)` was wrong,
there is no `--bg` token" — and were re-broken anyway, twice, because nothing
enforces them.

Nothing does now either, but the sweep is three lines and worth running after
any palette work: collect every `(--x)` defined by a `:` in `src/**/*.css`,
collect every `var(--x)` used **without** a fallback, and subtract. A fallback
is the difference between a typo and a silent deletion, which is why
`var(--hue-amber, var(--hue-blue))` in the same file is merely odd rather than
broken.

**A gate written before the gate existed will be overtaken by it.** `HomeSection`
wrapped Duel Analysis, Duel Zone and Coach Assist in the Royal Pro upsell. Once
`sectionAllowed()` shipped, anon and free visitors were routed to `GateCard`
*before* that code ran — so the only people who could still reach the "subscribe"
wall were accounts that already had a subscription, pressing a block they had
paid for. It was not a wrong message to the wrong audience; it was a message
that had become impossible to show to its audience. What those screens actually
lack on the home route is a player tag, and `NeedsTag` asks for that instead.

**A flex child with any `overflow` can be crushed to nothing.** The automatic
minimum size of a flex item is its content — *unless* `overflow` is anything but
`visible`, which sets it to zero. So in a flex column, the one child with
`overflow-x: auto` is the one the layout will squash, and it happened to be the
admin console's accounts table: rendered in full, inside a box the height of its
own header row. Sibling tiles kept their height and made it look intentional.
`flex: none`. The corollary is worse, because it is silent: that same `overflow`
makes the element a scroll container, so a sticky `<th>` inside it stops pinning
to the page and simply never sticks.

**A partial blob from the network can unmount the whole app.** Deck hydration
did `sets: remote.sets`, and a remote payload missing one of the five
collections left `sets.home` undefined; the first screen reading
`sets.home.decks` threw, and React unmounted everything. A blank page is the
worst possible response to slightly-wrong stored data. The code already knew
blobs vary — a comment two lines down handles pre-palette blobs having no
`sets.palette` — it just handled that one known gap and assumed every other key
was present. `{...createDefaultSets(), ...remote.sets}` costs nothing and makes
a missing collection fall back to an empty one instead of to `undefined`.

**Importing a module for one pure function runs its whole body.** A test of the
admin console's date formatters imported them from `adminStore.ts`, which
constructs a Supabase client at module load, which wants a native WebSocket that
Node 21 does not have. The test died on machinery it never used. Pure formatters
now live in `src/utils/format.ts` with no imports at all — which is also the
only reason they are testable.

**Hand-editing `localStorage` and reloading is not a fixture.** Three checks
passed "correctly" against state that had already been overwritten: the page
loads, hydration pulls from the cloud, and the value under test is gone before
the assertion runs. Anything that syncs must be driven through the UI, or the
sync has to be understood before the fixture is written.

**`const URL = ...` shadows the global `URL`.** A verify script named its target
`URL`, and every later `new URL(...)` in the same scope threw. The error points
at the construction, not at the declaration.

**A fixed wait loses a race against production.** Verifications timed with
`waitForTimeout` passed locally and failed against the deployed site, where a
cold function is slower than a warm dev server. Wait for the condition, never
for a duration.

**Verify scripts and Playwright must never reach a commit.** Both did once. The
uninstall is not the whole cleanup either — `git checkout -- package.json` after
`npm uninstall` **restores** the dependency line it just removed, so the manifest
has to be checked, not assumed. Both patterns are in `.gitignore` now.

**A fade painted in a surface colour assumes it knows what is behind it.** The
filmstrip's end vignette was a `--surface` gradient laid over the strip, which
is invisible inside a panel of that exact colour and a pale band anywhere else —
on the landing screen it drew over the page and its fireflies. Masking the cards
instead (`mask-image` on the deck) fades them whatever they sit on.

**`element.click()` is not a click.** It dispatches a click event and skips
`pointerdown`, `pointermove` and `pointerup` altogether — so it sails straight
past pointer capture, hit-testing and any drag/click disambiguation. It reported
7/7 on a filmstrip whose cards could not actually be clicked at all. Anything
that involves dragging must be checked with `mouse.down()` / `mouse.up()` at
real coordinates.

**A 3D-rotated element's bounding box is not its hit area.** Under perspective a
rotated card projects to a trapezoid; past roughly 30 degrees the centre of its
axis-aligned bounding box falls outside that trapezoid, and `elementFromPoint`
there returns whatever is behind it. Both the product (which cards to draw) and
the test (where to click) have to account for it.

**A custom property read back through `getComputedStyle` is TEXT, not a
length.** The filmstrip's spacing lives in CSS as `--gap: calc(var(--card-w) *
0.78)`, and `getPropertyValue('--gap')` returns that literal `calc(...)` string
— an unregistered custom property is never resolved. `parseFloat` gave `NaN`,
the `|| 150` fallback swallowed it, and every card was spaced by a hardcoded
150px that silently ignored the phone breakpoint. The fix is a zero-height probe
element with `width: var(--gap)`, whose measured width is the real number.

**A deck preview that calls `getCardIconUrl` directly is wrong for two slots in
every deck.** Slot 0 is Evolution and slot 1 is Hero, and a card in one of them
is drawn with that form's art — which is what `getSlotVisualVariant` decides and
what the live slots use. The filmstrip's folder faces asked for the base icon,
so a folder holding an evolution deck previewed the plain card. The selection
had been a private helper inside `SavedGroups`; it is now
`utils/deckPreview.previewIconFor` with three callers and one implementation.

**A border-box width is not the room a child has to move in.** The theme
toggle's slide overshot its far pad by exactly 2px, because the travel was
computed from the track's width without subtracting the 1px border on each side
— the cap is positioned inside the padding box, the width is a border-box
figure, and the difference is precisely the two edges. It looked almost right,
which is the kind of wrong that ships.

**`composes` is legal only on a rule whose selector is a single local class.**
A script inserted it into `.toolPanel:hover .toolCta { … }` — because it located
the rule with the *first* occurrence of `.toolCta {`, and that is where the first
one is. PostCSS is explicit about it (*"composition is only allowed when selector
is single :local class name"*), but the error names the file with
`undefined:NaN` for a line number, so anchor the search to column 0 and check
the selector before writing.

**Scoping an "already done?" check to the file instead of the rule silently
skips work.** The same script asked whether the file already contained the
`composes:` line. The moment one rule in a file composed, every later rule in
that file matched the identical line and was reported as already done — three
buttons were quietly missed and it read as success.

**A backtick inside a GLSL comment ended the shader string — a third time.**
It is recorded below and in `docs/UI.md`, and it still happened: a comment
reading ``NOT `half` `` (`half` is reserved in GLSL ES, hence `hSpan`) closed the
template literal and `tsc` reported a missing comma dozens of lines away. The
comment now spells the word out and says why there are no backticks in it.

**A CSS rule inside a media query still loses on specificity.** The loader's
`prefers-reduced-motion` block styled `.tick` at (0,1,0) and was silently beaten
by `.tick[data-lead]` at (0,2,0) — being in a media query changes nothing, since
specificity is decided before source order. The rule was dead code for its whole
life. `index.css` clamps every animation to `0.01ms !important` under the same
query so the behaviour was right anyway, which is exactly why nobody would have
noticed. A browser check caught it reporting `animation-name: _ignite_…` under
`reducedMotion: 'reduce'`.

**A flex column with `align-items: center` hands its children `fit-content`.**
So `width: min(100%, 42rem)` on the loading rig resolved against a box sized to
the rig's own content, and it shrink-wrapped to 331 px. A *stated* width makes
`fit-content` compute to 42 rem and the container opens up to hold it.

**A prose measure is not a layout measure.** `MetaDecks`' notice capped itself at
`56ch` — correct for its cold-start paragraph, and it squeezed the loading gauge
to 393 px where every other screen gave it 672. Measure the copy, not the box
that also has to hold a graphic.

**Two loops in one script must not advance the cursor past the wrong thing.**
Twice while scripting these edits, a loop that replaced a guard *before* a tag
then advanced its cursor past the guard — so it found the same tag again, looked
backwards, and failed on text it had just rewritten. Advance past the thing you
searched for, adjusted by the length delta, and make the pass idempotent so a
re-run after a crash is safe.

**A backtick inside a GLSL comment ended the shader string — twice.** The
shaders are JS template literals, so a comment reading ``the `uv` attribute``
terminates the string and Babel reports a missing semicolon dozens of lines
away. It cost two debugging rounds because the second time it looked like the
fix had failed rather than never having compiled. Both shader files now carry a
no-backticks warning beside the comment block.

**A probe that clicked disabled tiles and reported the product broken.** Cards
already used in a duel collection render `aria-disabled="true"` and their click
handler returns early. A verification filling a deck by clicking
`[data-card-key]` blind therefore placed nothing, `filledCount` never moved 7 to
8, no sweep was ever requested — and the probe concluded "the sweep did not
render". Select `[data-card-key][aria-disabled="false"]` and assert the state
transition *before* measuring anything.

**Three ways to measure a one-shot effect, two of which lie.** Diffing
consecutive frames catches a burst, but the burst and the sweep overlap almost
exactly and the card art appearing underneath changes far more pixels than a
translucent band ever will. Separating them in TIME does not fit either — the
burst dies at 550 ms and the band leaves at 740 ms, a 190 ms window narrower
than a Playwright screenshot. What worked was separating them in SPACE: the
burst is thrown from the slot just filled, so anything changing in the left half
of the row is the sweep and nothing else.

**A shared `PlaneGeometry` between two InstancedBufferGeometries.** Assigning
`geometry.attributes.position` from one plane into several geometries looks
free. The second mesh built that way never drew. Not proven to be the cause —
giving each its own plane did not fix it either — but it is now avoided.

**`uLife` became a uniform and one material was left without it.** The point
shader hardcoded its lifetime until the sweep needed to share it. Adding the
uniform to the sweep and forgetting the burst left the burst dividing its age by
an undefined uniform — i.e. by zero. `tsc` caught it only indirectly, as an
unused constant.

**A test deleted the production shadow log — twice.**
`test_ml_production.py` called `os.remove(shadow.LOG_PATH)` on the real path, so
running the test suite destroyed 1,277 collected observations. It was diagnosed
only after catching the log dropping from 79 records to 1 mid-session. The first
hypothesis — concurrent multi-process appends — was wrong; `O_APPEND` was never
the problem. `LOG_PATH` is now overridable via `CLASH_OIE_LOG`, and a guard test
scans every `test_*.py` for anyone doing it again.

**The WAL grew to 5.66 GB and no checkpoint could fold it.** Not a leaked
connection — 28 call sites all close in `finally` blocks — but short read-only
connections that *overlap* under load, leaving no gap for
`wal_checkpoint(TRUNCATE)`. The fix is a scheduled gap: a `.maintenance` flag
file the bot drops, which makes `resolve_db_path()` return `None` so the site
lets go. See `server/README.md`.

**Two performance "fixes" that measured as nothing.** A persistent SQLite
connection with `mmap_size=1G` and a 64 MB cache looked like a **10x p50 win**
(329 ms → 32 ms) when benchmarked across different tag slices. Paired on the same
tags with alternating order it was faster on exactly **20 of 40** — mean
**-8 ms, CI [-37, +21]**. Pure page-cache warming. Narrowing the history window
from 60 to 20 days: rows returned fell 21%, time did not move (**+9 ms, CI
[-29, +47]**), because `idx_battles_tag` is `(player_tag)` only, so every row for
the tag is fetched and `battle_time` filtered afterwards.

**"Duel is slow" was wrong for four phases.** Live shadow reported duel p95
2588 ms against competitive 386 ms. The query never filtered by mode — both
domains read the *same rows* — but the cache was keyed per domain, so every Coach
read ran the identical expensive query twice. Whichever domain went first paid
the cold disk; the second read its rows back from the OS page cache. Measured on
disjoint tag sets, the asymmetry followed the **order**, not the domain, and
inverted exactly when the order did.

**A CSS token that does not exist, caught only by a screenshot.** Five new
dim-text rules used `var(--text-dim)`; this project's token is `--text-muted`.
They fell back to inheriting the block's violet hue. Every text-content assertion
passed regardless — only looking at the rendered output found it, and then only
after misreading a downscaled PNG and having to check computed styles to correct
myself.

**A verification that tested a paywall.** The "Coach Assist" tile on the
analytics home grid is Pro-locked and renders a placeholder; the real interview
only exists in *player* view. A browser check driving the home tile would have
verified a locked panel. The tag matters too — the first one tried was
competitive-only, so the duel Coach correctly had nothing to predict and no deck
ever rendered.

**A readiness check that contradicted its own reconciliation.** `frontier.py`
first compared the global battle frontier against the newest *anchor* in the log
and returned READY when reconciliation had just found zero outcomes. The newest
anchor belongs to one player and the frontier to another, so the comparison was
already true at freeze time. The correct baseline is the frontier as it stood
when the observations were frozen. The disagreement between two checks is what
exposed it.

**The website was reading a database that had been deleted underneath it.** The
bot moved both storage tiers to H: on 2026-08-17; `server/clash_data.py` still
defaulted to `C:\ClashBot\data\battles.db`. The failure mode is the ugly one:
for a while that file still existed and still carried a valid schema, so nothing
raised and nothing 500'd — the site would simply have served a frozen snapshot
forever, answering every question plausibly and none of them currently. It was
only obvious once the file was deleted outright.

The bot had already reasoned this through and built `storage_guard_check()`
against exactly it, refusing to start against a database that has lost most of
its rows. This project has no equivalent, and `/status` reporting the resolved
path is the whole of its defence. **A stale database is more dangerous than a
missing one**, which is why the dead C: file was deliberately NOT added to
`DB_FALLBACKS` when the default moved.

**A `<button>` inside a `<button>`, from adding a control to a row that was
already one.** The Duel Zone's series row is a button that expands to reveal the
opponent's deck, and the deck strip lives inside it — so putting copy/open
buttons in the strip nested them. The browser closes the outer button early
rather than erroring, so the symptom would have been the actions escaping the
row AND the row no longer expanding, neither of which points at nesting. Caught
by reading the JSX before running it. The general shape: adding an action inside
a row means checking what the row itself already is.

**A prop added to a type but not to the destructuring, which then resolved to a
DOM global.** Three local `Strip` components got `name?: string` in their props
type while `name` stayed out of the `{ cards, art, inferred }` list — so `name`
inside the component silently referred to `lib.dom`'s `declare const name: void`.
Three files, same slip, and it is only a type error because that global happens
to be typed `void`; had it been `string` it would have compiled and rendered the
window name in every tooltip. `tsc` caught all three, which is the argument for
running it rather than trusting the edit.

**A property that silently does nothing is the worst kind of bug.** Three
separate instances this cycle, and none of them threw, logged, or failed a
typecheck — each just produced an interface that ignored a correct-looking
declaration:

* `font-weight: 600` on a single-cut display face, under `font-synthesis: none`.
  There is no bold file to load AND the browser is forbidden from making one.
* `fetchPriority` on React 18. It is a React 19 prop; on 18 it falls through to
  the DOM as an unknown attribute and warns on every render.
* `transition` on `.band > *` quietly replacing `.toolPanel`'s own hover
  transition, because a descendant selector outranks a class. The cards still
  animated — at the wrong duration, missing two legs of the shorthand.

The shared shape: CSS and JSX both accept a value, apply their own precedence,
and say nothing. Reading *computed* style is what caught all three — `0.56s`
where `0.2s, 0.2s, 0.32s, 0.32s` was expected is a fact; "the hover looks a bit
slow" is not.

**Fixing half of a wording bug is worse than not fixing it.** The empty
Evolutions tab was corrected in the tab badge and the table while four stat
tiles above it still said "not enough duels" about a player with 96 of them. The
screen then contradicted itself, and the wrong half was in bigger type. When a
message is wrong, grep for its siblings before declaring it fixed — the fix in
that case was to derive the condition **once** and have all five readers share
it.

**A scrim's correct strength is the least that achieves legibility.** The hero
backdrop is a matched pair with castles at *both* edges; the first scrim ramped
from fully opaque and the left castle never appeared on the site at all.
Starting at "opaque" and easing outward is how you ship an asset nobody sees.

**A blurred sibling painted on top of the thing meant to be sharp.** The Royal
Pro gate stacks two children in one grid cell: the real content with
`filter: blur(7px)`, and the card that sells the subscription. The card came out
washed — its Subscribe button rendered a pale pink — while `getComputedStyle`
insisted it was an opaque white card carrying a `#c81e69` button. Both readings
were right. **A `filter` makes an element paint as though it created a stacking
context, which puts it in the positioned paint phase — after every in-flow
sibling.** The veil had been `position: absolute`, which put it in that same
late phase; moving it into the grid cell to stop the card being clipped quietly
demoted it below the blur. `position: relative; z-index: 1` restores the order.

The lesson is the one this project keeps relearning in a new costume:
`getComputedStyle` hands back the declaration, never the composite. What caught
it was a probe that screenshots the button and reads its actual pixels — and the
first version of *that* failed too, because it averaged the white label running
through the middle of the fill and reported a pale pink nothing on screen was.
It samples the dominant colour now.

**A grid row that collapsed to 4.5px, so every tile covered the next one.**
The card grid moved from fixed 62px columns to `minmax(3.4rem, 1fr)` so the
tiles could take whatever width the column had — and the explicit
`grid-auto-rows: 75px` went with the fixed sizing, since row height should
follow from the tile's `aspect-ratio: 302 / 363`. It does not. **An auto row
sizes itself from its items, and an item whose only child is an `<img>` at
`height: 100%` contributes almost nothing to that** — `aspect-ratio` is not
consulted. Measured on the rendered page: rows resolved to **4.53px** while the
tiles themselves were 71px, so each tile overflowed its row and painted over the
one below. Nothing looked wrong, because the tiles were the right size and in
the right places; what was wrong was that the top-left of every tile was covered
by its neighbour, so **clicking Knight hit Dart Goblin**. `grid-auto-rows:
max-content` asks for the item's own resolved height instead. `align-items:
start` goes with it, since a stretched item takes its height from the row.

Worth keeping as a shape: the bug was invisible to the eye and to every
assertion about position or size — it was found because a browser probe tried to
*click* a card and Playwright reported which element intercepted the pointer.
The same trap was live on the deck slot grid and on the filter panel's chip grid,
both of which pair a `1fr` column with an `aspect-ratio` child.

**The archive double-counted every battle.** The archive holds every battle
*including* the ones still sitting in the hot tier, so querying both over the
same dates counts the overlap twice — 70 days reported 4,406 battles against a
lifetime total of 2,070. The window is now partitioned by date: the hot tier
answers from its own earliest row onward, the archive only for what predates it.
Correct at 2,204.

**A trend query took 16,756 ms.** The date bound was being applied in Python.
Pushing it into SQL lets SQLite use the `(player_tag, player_deck_hash)` index —
and because `battle_time` is `YYYYMMDDThhmmss.sssZ`, a plain string comparison
is a correct date filter. 74 ms cold, under 10 ms warm.

**The CR API returned 403 on every call.** Not the token: the RoyaleAPI proxy
rejects urllib's default User-Agent. A browser UA works.

**A popup rendered but its clicks went nowhere.** Every panel carries a
`backdrop-filter`, which creates a stacking context, so a *later* panel painted
over the popup regardless of its own z-index. Raising the ancestor is what
actually fixes it — this bit twice, once on each analytics screen.

**Legend rows were silently disappearing.** `TrendChart` keyed its lines and
legend on the deck *name*, and two decks routinely share an archetype name
("Mortar", "Piggies"). Identity is the deck hash now; the label is only what the
reader sees.

**The invisible hero title.** A bulk token conversion turned `color: #fff` into
`--accent-contrast`, which in dark mode *equals the ground* — so the headline
rendered in exactly the background colour and vanished.

**Decks rendered in alphabetical order.** The deck *hash* is alphabetical — it
identifies a deck without describing one — so using it for display scattered the
three special slots through the row and nothing could be configured. The decks
dimension table is better but not reliable either: measured, the per-battle
`player_card_keys` puts every mark inside slots 1-3 **1194/1194** times, while
`decks.cards` manages **774/1056**. `arrange_deck` rebuilds the order instead of
trusting either.

**Four separate bugs in the evolution art, in one sitting.** Worth listing
because each looked finished before the next appeared: `card_info` never exposed
`can_be_hero`, so the hero branch could not fire at all; collapsing an empty
hero slot shifted the second evolution into slot 2, the one position it may not
occupy; a both-form card always claimed an evolution slot, leaving slot 2 plain
in decks whose only hero-capable cards also evolve; and pooling a merged
cluster's marks drew a deck with five evolutions. Only the first was visible
from the code — the rest needed looking at the rendered page.

**`arrange_deck` was not idempotent, and that is how the sequence board lost its
art.** With two both-form cards in one deck (knight + musketeer), the hero slot
went to `both[-1]` — the last one *as the list happened to arrive*. So arranging
an already-arranged deck swapped the hero and the second evolution back again,
and the same deck rendered one way in the series log and the other on the
sequence board. The hero is now chosen from content (priciest, ties on the key),
so a deck's rendering is a property of its cards and nothing else. The existing
"arrangement is stable under input order" test passed throughout — its fixture
had only one both-form card. Full order-independence is deliberately *not*
asserted: with more evolution-capable cards than slots, which two get the art is
read positionally out of payload order, and that is the documented heuristic.

**A measurement that checked the wrong number of slots.** An early pass
concluded the positional reading was invalid because only 63 of 391 decks had
their marks in the first *two* slots. There are *three* special slots; on that
test it is 795 of 795. The conclusion was confidently wrong and went into a
code comment and both READMEs before it was caught.

**Violet meant two things at once.** Remapping the legacy `--accent-purple`
alias to the new violet made the Evolution *role* slot permanently violet — so
it was indistinguishable from the *selected* slot, because violet is what
selection means. Role identity went back to neutral; `--accent-cyan` and
`--accent-orange` reverted for the same reason, with a separate `--drop-valid`
(green) for a legal drop target. Only caught by looking at the builder.

**A table of good news painted red.** The "bring this against them" rows show
YOUR win rate against each archetype, which is `100 −` the player's. The figures
were flipped for display but the colour still followed the player's own diff, so
a matchup that is 16.9 points in your favour rendered in the error red. The rule
that fixes it is worth stating generally: colour the number that is on screen,
not the one it was derived from.

**An unknown deck resolved to a card key, not an archetype.** `deck_counter`
looks a pasted deck up in the `decks` table and falls back to deriving its
archetype when the exact list has never been stored. The first fallback returned
the priciest win-condition CARD — `hog-rider` — where the whole matchup
vocabulary is archetype keys like `hog`. Every unknown deck therefore matched no
row in the matrix and came back with zero counters, while still displaying a
confident-looking target name. Fixed by carrying over the bot's own
`WIN_CONDITION_MAP` and `WIN_CONDITION_PRIORITY` unchanged, since every stored
`decks.win_condition` was written by the function that reads them.

**A Python edit is not live until the API restarts.** Obvious in hindsight, and
it still cost a debugging round: the fix above was made while `server/app.py`
was already running, so the browser kept getting the old answer and the bug
looked like it had survived the fix. Vite hot-reloads, the analytics API does
not — restart it after touching anything under `server/`.

**Two badges on a 92px tile read as one number.** The card tile carried the
elixir cost pinned to one top corner and the rank to the other, both at
`top: -4px` so they hung outside the tile and broke its border on all 122 cards.
At that width the pair read as a single figure — "6 1", "4 2", "5 3" straight
down the grid. The rank went (it IS the grid order, and it is in the tooltip),
the elixir badge moved inside the art, and the tile got `overflow: hidden` so
nothing can hang off it again. The "THIN" chip went too: a card under the
evidence floor now prints its win rate in the muted neutral instead of the
success hue, which says the same thing without asking for space.

**A percentage overflowed every tile by 8px.** With the two rates on one line
the tiles were pushed to 5.6rem to fit twelve per row — below what the two
figures plus their glyphs actually need, so the win rate hung over the right
edge on every card. 6.1rem is the floor, and it is written down as a floor
rather than a preference; eleven per row is the honest number.

**The elixir badge put the selection hue on 122 tiles at once.** The in-game
elixir drop is purple, so the card tiles copied it — and violet is what
"selected" means everywhere in this app, so every card on the board was wearing
the one colour reserved for the thing you had clicked. It went neutral
(`--overlay-chip`, which exists for a chip sitting on card art). Same class of
mistake as the Evolution slot going violet, and caught the same way: by looking
at the rendered page rather than the stylesheet.

**The two themes disagreed about how loud "selected" is.** Not a hue problem —
every hue was correct and every tint percentage was right. The bug was the mix
GROUND: a level-2 fill mixed against the card, painted onto a control resting on
`--surface-sunken`. See the colour section; the lesson is that a tint has to be
mixed against the surface it lands on, and that this can only be caught by
sampling composited pixels, because `getComputedStyle` hands back the declared
value and every one of these declarations was correct.

**Level 2 is too strong for a large surface.** The duel-analysis tabs are a
third of the page wide, and a 14% fill on something that size reads as a colour
panel rather than an accent. They dropped to level 1 and lean on the border and
text instead. The rule "large surfaces never go past level 2" needs the corollary
"and the wider the surface, the lower the level".

**Three identical CTAs read as one colour.** The home page's three "Open …"
panel buttons were all `--accent-action`, so the page looked entirely pink and
the buttons said nothing about which tool each opened. Each tool panel now wears
its own identity hue. This deliberately bends "pink alone means primary action"
— on those panels the hue reads as identity, and Analyze stays pink as the one
genuine primary action on the page.

**A white edge on a white panel.** Light mode's `--glass-stroke` was
`rgba(255,255,255,0.85)` — literally white — so light-mode boxes had no visible
border at all while dark's were crisp. It survived so long because the token
name says "stroke" and the value was *deliberately* white back when the panel
was frosted and floating over card art. Renaming nothing and reading the value
is what found it.

**Solid panels do not stack the way translucent ones did.** Making the glass
solid instantly hid every nested box, because a translucent pane compounds when
you put one on another and a flat colour does not — a deck panel inside the
builder's panel had been getting its "raised" look for free from the blend. The
fix is the ladder rule (nesting goes *down*), and the reason it has to go down
rather than up is that light has nothing above `#FFFFFF` to raise into.

**A bulk edit hit four things it should not have.** Reclassifying nested boxes
onto the new `--surface-nested` rung was done with a scripted
find-and-replace, which also caught two meter tracks, a date input and a code
block — all genuine wells that belong at the bottom rung, a meter track most of
all, since it is the groove a coloured fill runs in. Caught by having the script
print a count per file and comparing it against what was expected; the one file
whose count did not match was the one file with collateral damage.

**Going home moved the URL and nothing else.** Which screen the home view shows
lives in component state, not the route, so resetting the route left the old
panel on screen. Half-wired navigation is worth watching for anywhere a screen
is chosen by something the URL does not describe — and `location.hash = ''`
strips the fragment rather than setting one, so the *second* attempt was a true
no-op that fired no `hashchange` at all.

**"The evolution and the normal card look the same."** True, and it was a wiring
bug rather than an art one — the Evolutions tab listed the right 42 cards and
asked for base art for every one of them. Worth recording because the report
pointed at the assets and the assets were fine: measured afterwards, the closest
pair of forms differs by 45.5 of 255. The lesson is that "these look identical"
can mean "the same file twice" or "the same request twice", and only one of them
is visible in the folder.

**An argument that was accepted and ignored.** `arrange_deck(cards, marks)` took
observed evidence as a parameter and never read it, deriving everything from
card capability instead. Every caller was already doing its part — fetching the
marks, passing them, flagging the case where it had none — so the whole pipeline
*looked* right at every level except the one that mattered. Nothing failed, no
test caught it, and the output was plausible; it was only wrong. What surfaced
it was a human saying the decks looked alike, which is worth remembering: a
signature that repeats across every row is a symptom of a rule being applied
uniformly, not of the data being uniform. An unused parameter deserves the same
suspicion as an unused variable.

**One counter for two different things.** `_evo_marks` had returned
`'evolution'` or `'hero'` since it was written, and `test_duel_combos.py` even
asserted the distinction — then the card board summed both into `evoRate`. Real
data caught it loudly: eleven cards reporting an evolution rate, Berserker at
76.8%, none of which can evolve at all. A function keeping a distinction is
worth nothing if its caller throws the distinction away, and the caller had no
test of its own until now.

**Two slices of one list, silently overlapping.** `matchups[:5]` and
`matchups[-5:]` are the obvious way to get "worst" and "best", and they are the
same rows whenever the list is shorter than ten. It went unnoticed because the
test account has seventeen archetypes. Partitioning on a real predicate — above
or below the player's own average — cannot overlap by construction.

**Three left edges in one table.** Each row being its own grid means an `auto`
track sized to its own content, so a chip reading "Low" instead of "Medium" on
one row shifted the whole rest of that row by 20px. It is the kind of thing that
looks like a rendering glitch and is really a layout rule: columns line up
across independent grids only when every track has a definite size.

**A scripted CSS edit needs a count per file.** Reclassifying nested boxes onto
`--surface-nested` was a find-and-replace that also caught two meter tracks, a
date input and a code block. The script printed a count per file and compared it
with what was expected; the one file whose count did not match was the one file
with collateral damage. Same technique caught nothing on the four files where
the counts agreed, which is the point.

**Whose data is it?** Two bugs in a row came from the same unasked question.
`arrange_deck` preferred pooled marks over the link a person had just pasted —
marks are aggregated across everyone running those eight cards, the link is the
deck in front of you. And a slot-3 override worked on one code path out of three,
so it silently did nothing for most decks. Both look like "the control is
broken"; both were really "the code picked a different authority than the user
did". When two sources disagree, say out loud which one wins and why.

**One component instance, four different questions.** The Coach's interview
asked for your game-1 deck, then theirs, then your game-2 deck, from the same
`<PasteDeck>` element in the same slot — so React reused the instance and kept
its state. Asked for *their* deck you were shown *yours*, already filled in, and
Continue submitted it a second time. Reported as "it needs to ask what you
played AND what they played", which is exactly what it looked like from outside.
A `key` per question fixes it. The rule: when consecutive steps render the same
component, the step identity has to be in the key, or the component is one
long-lived form wearing different labels.

**A grid row that shifted a whole column left.** Deck rows without a rank number
rendered one fewer child, and a CSS grid places children in order — so the name
went into the 1.6rem rank track, the eight cards into the 11rem name track, and
the wide deck track sat empty. The cards drew at **19.4px**: (176px − 21px of
gutters) / 8, exactly, which is how it was identified. Nothing was missing and
nothing overflowed; one list was just quietly tiny. The empty cell is now always
rendered. Grid children are positional, so an omitted one is not a gap — it is a
shift.

**A comment asserting a measurement nobody had taken.** `--accent-action-text`
was `#ffffff` under a comment reading "both hues carry white text at >=4.5:1 in
light AND dark". White on the dark pink is **2.65:1** — every filled primary
button in the app, ten stylesheets' worth, failing since the dark palette was
written. The comment is what kept it invisible: it reads like the measurement
already happened, so nobody re-ran it, and a reviewer scanning for hardcoded
colours sees a justification rather than a claim. A number written in prose is a
claim; only a number a test or a probe produces is a measurement. This one was
found by a browser sweep over a *new* screen that happened to include the old
button in frame.

**The right field was one index away, for the whole project.** `player_evo`
stores `[card_key, level, art]`; every reader used `art` because it holds the
words "evolution" and "hero" and clearly means to be the answer. It is a
derivation, and it loses 16.1% of what it derives from — 9.2% of heroes come out
labelled "evolution" and 6.9% of evolutions come out "unknown". `level` is
exact: it partitions perfectly by slot and matches the 42 evolution-capable and
16 hero-capable cards with zero exceptions over 162,919 marks. The bot's own
docstring said "level 2 is served hero art" and had said it all along.

Two things kept it hidden. The first is that the wrong reading was *plausible* —
a deck that should have shown two evolutions and a hero showed three evolutions
and no hero, which looks like a missing feature rather than a misread field. The
second is worse: the measurement that blessed it reported all four both-form
cards as evolutions **100% of the time**, and that unanimity was written down as
the finding. A question with two real answers coming back unanimous is a fact
about the reading, not about the world. Nothing surfaced it until someone read
three specific decks off their own screen and said what the cards should be —
three for three, all correct.

**A cap that encoded the rule I had just measured, wrongly.** Having established
that slot 3 is the wild slot and takes either form, I wrote the cap as "two
evolutions and one hero" — which treats slot 3 as an evolution slot, the exact
misreading the paragraph above it warns about. It made
evolution / hero / hero undrawable: 9.25% of all battles, the third-commonest
loadout in the game. Reported within minutes as *"why is it fixing one breaking
another?"*, and correctly. The lesson is narrow and practical: a rule stated in
prose and a rule expressed as constants are two different artefacts, and writing
the prose does not check the constants. The constants needed their own
measurement — one per slot, so two evolutions, two heroes, three in total.

**A cap enforced against the wrong thing.** Both art lookups limited a deck to
its three special slots by dropping any mark on a card outside the first three
entries of the deck's stored order. The limit was right and the order was real
data — but the order belongs to *one* player's copy while the marks are pooled
across everyone running the list, so the two have no authority over each other.
It deleted 23 real marks off 21 of the 50 meta decks, and the only visible
symptom was decks quietly drawing a plain card in a special slot. Worth
remembering as a shape: when a constraint is enforced by proxy, check that the
proxy is measuring the same population the constraint is about. The cap now
ranks the evidence and keeps the top two evolutions and top hero, and position
is decided in the one function that owns positions.

**A row that resizes its own contents.** Card art is not one aspect ratio — the
evolution frames range from 287×384 to 553×793 against a plain card's 302×363 —
and a flex row of images sized by width alone defaults to `align-items:
stretch`. So a plain Arrows rendered 16.2% taller than its own artwork because
of the Lumberjack evolution three cards along. The bug is invisible in any deck
that happens to hold no evolution, and it is a property of the *row*, not of the
card being drawn wrong: the same image was correct one row up. Assets from one
source are not one shape, and a strip that draws mixed art needs a box, not a
width.

**One class, two meanings.** `.two` laid out both the worst/best matchup lists
AND the Deck A / Deck B paste boxes. Stacking the lists to give them full width
therefore stacked the two decks being compared as well — a head-to-head with one
side above the other. The name described a *layout* ("two columns") rather than
a *thing*, so it attracted a second caller whose requirements would later
diverge. The paste boxes now have `.facing`, which describes what they are.

**A number that ignored the input, and a measurement stretched to justify it.**
Every Hog deck returned the same matchup, because everything was answered at
archetype level. The measurement behind that (0.59% of stored pairings reach 8
games) was sound — it just answers "deck vs *exact* deck", and was applied to
"deck vs archetype", which the same table answers easily at 111,663 battles for
one list. A correct measurement can still be the wrong measurement for the
question in front of you.

### A measurement that could not fail, and therefore proved nothing

Phase 20B set out to test whether duel legality forces deck changes. It
reported that inside a run the previous deck retained **0.00 of its 8 cards**,
which looked like a textbook confirmation and was written up as one.

`used_before()` adds `plays[i-1]` to the used-card set whenever the two battles
are linked. The previous deck is therefore always entirely inside it. Feed the
function two linked battles on the SAME deck — a state the rule forbids — and
it still answers 0.00 of 8.

The circularity check had been done, on the wrong half. The run reconstruction
genuinely never looks at a card; the legality step immediately after it puts
the answer in by hand. **A derivation is only as checked as its least-checked
step**, and "I verified this isn't circular" meant "I verified one of the two
places it could be".

It was caught because Phase 20C, built on top of it, produced a signal that
agreed with reality 10.6% of the time. A result that is worse than chance is
usually not a discovery about the world.

### Twenty phases on a domain nobody had looked inside

`is_duel_like_mode` admits any mode containing "friendly". The 8-card guard
drops any row that is not exactly eight distinct cards. Both are correct and
documented, and each was written for a good reason.

Together they mean the engine's `duel` domain admitted friendly practice and
discarded every native duel — 1,238 native rows in one census, of which **zero**
carry 8 cards. Every "duel" number from Phase 14 onward, including the shipped
band accuracies, described practice matches.

No test asserted what the domain CONTAINED. There were tests that it partitioned
correctly, that it dropped loadouts, that modes classified as expected — but
none that looked at the resulting population and asked what was in it. The
fix (`phase20d`) is one census query and a set of tests that pin the composition.

**Test that a filter produces the right POPULATION, not just that it runs.**

### A browser verification that passed against a blank page

The first Phase 23 verify script reported six green checks in a row. The Coach
screen renders nothing until its opening interview question is answered, and the
selector guessed for "content" (`[class*="_block_"]`) matched nothing at that
point — so every assertion was evaluated against an empty page and every one of
them passed.

It surfaced only because a later check needed a bounding box and timed out
waiting for an element that was never going to exist. Dumping the DOM took
thirty seconds and showed a single heading: *"Has the duel started?"*.

**A green check is worthless until you have confirmed it is looking at the
thing it claims to check.** The rewritten script answers the interview, waits
for real blocks, and carries the trap list in its header.

### The payload was wrong and the UI was hiding it

The Phase 24A soak found `degraded: true` responses shipping alternatives. The
spec says a degraded read carries none, and `safe_fallback` honours that — but
the counting-fallback path (M2 artifact missing or feature-order mismatch) sets
the flag and carries on with the list intact.

Nothing was user-visible, because `CoachAssist` does
`read.degraded ? [] : read.alternatives`. So the server contract and the client
disagreed, and the client's compensation made the disagreement invisible.

That arrangement holds exactly as long as there is one client. The service was
about to be exposed to a second. Fixed at the source
(`enforce_degraded_has_no_alternatives`, applied last) and again at
serialisation, with a test that hands `as_dict()` a deliberately dirty object
to prove the boundary holds even when the object does not.

### Three latency claims, withdrawn

The OIE was blamed for the Coach being slow. Measured in the same page loads:
`/coach/predict` **29,042 / 56,744 / 31,209 ms**, `/coach/opponent-read`
**14 / 31 / 15 ms**. The engine is ~2,000x cheaper than the request it was
accused of slowing down; the cost is the database read on the spinning volume.

Also withdrawn: 19B's "shadow observation costs 9.6s against 2.4s", which was a
single sample and measured **-219 ms, CI [-1297, +859]** when paired over 40
tags. And the two "optimisations" that measured as nothing — persistent
connections with mmap (**-8 ms, CI [-37, +21]**) and a narrower history window
(**+9 ms, CI [-29, +47]**), both page-cache warming artefacts.

**A single-sample latency claim is a rumour.** Pair it or drop it.

**Three passes to make one feature usable.** The exact-deck ladder was 15.2 s on
first working version. No single change fixed it: one scan for both cluster
levels instead of two (−1.6 s), a TEMP table instead of chunked `IN (...)`
(4.4 s → 1.0 s), and one join filling both buckets instead of two passes.
5.5 s cold, 2.1 s cached. Worth remembering that "it works, it is just slow" is
usually three separate problems rather than one.

**`better-sqlite3` could not be built** (no prebuild for Node 21, node-gyp
fails) and `node:sqlite` needs Node 22. Hence Python for the data layer, which
also removed the pip-install step entirely.

**The desktop fallback pointed at an empty stub** — see "Picking a database
file" above.

**Two dev-server traps**: Vite binding IPv6-only, and a dead Vite holding 5173
so a new one moves to 5174 while the browser keeps loading the old bundle. Both
are in [Running it](#running-it).

### This pass: what blocked, what fixed it, what came of it

Seven things stopped progress long enough to be worth writing down. Every one
of them looked like something other than what it was.

| deadlock | why it blocked | fix | result |
|---|---|---|---|
| Versus decks overlapped and spilled past their card | each side needs ~390px hard minimum (name + crown + eight 30px tiles) inside `1fr 1fr` tracks; at a 1000px viewport each side had ~190px | stop insisting on two columns — `repeat(auto-fit, minmax(min(390px,100%),1fr))` drops to one full-width column | 0px overflow 760–1440px, tiles 24–30px. **The first fix made it worse**: flexing the cards removed the overflow and shrank them to **1.7px** |
| Seeding a saved group blanked the whole app | a persisted blob missing one of the five collections; the crash guard was written in `migrate`, which zustand only calls when the **stored version differs** | move the guard to `merge`, which runs on every rehydrate | a partial blob now hydrates instead of crashing. The `migrate`/`merge` distinction is the whole lesson |
| The meta filter's dropdown opened off the side of the screen | the panel is 30rem and hangs from `left: 0`; the trigger sat at the right-hand end of a panel header | `align` prop on `WinConFilter` (`start`/`center`/`end`), and the header became a `1fr auto 1fr` **grid** | centred to the pixel at seven widths, 1440 → 390, no overflow. Flex auto-margins were tried first and only centre in the space the neighbours happen to leave |
| One versus heading read as text, the other as a disabled label | `--player-blue` / `--player-red` are not a blue and a red — the palette resolves them to `#e0e0e0` and `#8a8a8a` | both take `--text`; red is right-aligned to its own column | white on dark, black on light. Left-aligned, the red heading's text landed mid-card and captioned the gap between the sides |
| A theme toggle threw on every switch | `DeckFx` wrote `sweepMat.uniforms.uColor.value` and that uniform does not exist; the throw was inside a `MutationObserver`, so nothing unmounted and nothing appeared on screen | delete the dead line | the visible symptom had been the wrong blend mode after a theme change — a colour bug, not a crash. Found only because a probe had `pageerror` wired up |
| "Recent Battles" opened a 250px hole down its own middle | `1fr auto 1fr` tracks with width-capped decks align each deck to the outside of its track | centre the three items as one group instead of laying out tracks | the pair sits together with the VS between them |
| …and then a long opponent name pushed the two decks apart again | a flex item's `auto` basis is max-content, which for that block is the longest **line of text**, not the card grid: "A Rather Long Opponent Name" made the side **538px against a 280px deck** | `flex: 1 1 0` — from a zero basis both sides take an equal share of real space | a name ellipsises inside the block instead of moving the deck |

**Two tripwires fired, and both were supposed to.**
`server/test_api_security.py` pins the number of routes in `_route` so a new
endpoint cannot be added without someone consciously deciding whether it is
authenticated (19 → 20, plus a line asserting the new one 401s), and
`tests/entitlement.test.ts` pins exactly which areas are free. Both were bumped
in the same commit as the change they were guarding, never worked around.

**One deploy trap, and it is structural rather than a mistake.** The Python API
does not ship with the frontend: Vercel builds from GitHub, `server/` runs on
the VPS under `royalweb.service`. A new analytics screen needs both, **and the
API has to land first** — otherwise the area appears in the rail and every
request 404s, which is worse than not shipping it. The order used here was:
back up `app.py`, md5-compare the VPS copy against `git show HEAD~1` to prove
no drift, deploy, restart, verify against the live database, *then* push the
frontend.

**Three verification lessons**, all of which produced a confident wrong answer
first:

* **Measure the text, not the box.** A block-level heading fills its column, so
  its rectangle sits at the column edge whatever the text inside it does —
  which was exactly the thing being tested. A `Range` over the contents gives
  the glyphs.
* **Scope every probe selector.** `input[placeholder^="Search"]` also matches
  the top bar's tag field, and its parent reports a perfectly plausible
  rectangle 193px from where the real panel was. `[aria-current="page"]` also
  matches the top nav, which is earlier in the DOM.
* **A hash-only `page.goto` is a fragment navigation, not a reload.** Seeding
  `localStorage` and then "navigating" to `#/builder` leaves the live store in
  memory, and its next write overwrites the seed. A seeded persist blob also
  needs `version: 9` — without one, zustand runs `migrate` and discards it.

**Result.** Everything above is on `deckkies.com`: the duel-to-builder save,
both card filters, the centred meta control, the versus headings, and Recent
Battles. 239 JS tests and 598 Python checks green, `tsc` and `build` clean, and
each change confirmed against the live bundle rather than against a successful
push.

---

## Testing and verification

1,260 Python checks across 35 suites and 221 vitest tests, none of which open a
database — every Python suite runs on synthetic data or a stubbed reader, so
they pass on a machine with no Clash_Bot install and cannot be broken by
whatever a real player did last week. The vitest side gained the analytics-proxy
suites, the tier-based export gate and the admin console's date formatters.

**`npm run lint` reports 2 errors and 4 warnings, none of them actionable.**
The errors are `react-hooks/rules-of-hooks` flagging `useFont(...)` inside
`pdfRenderer.ts` — a plain helper whose name happens to start with "use", in a
file with no React in it at all. The warnings are two `exhaustive-deps` on the
`win` object in the analytics fetch effects (it is rebuilt every render; the
effect keys on `win.from` / `win.to` deliberately) and two `react-refresh`
notes on files that export a constant beside a component. All predate this work
or are deliberate; there is nothing else.

```bash
npx tsc -b                        # typecheck
npm run test                      # 179 tests — deck logic, links, PDF export, proxy, admin
python server/test_duel_combos.py # 39 checks — duel logic, no database needed
python server/test_meta.py        # 33 checks — meta board + card board, no database
python server/test_card_art.py    # 110 checks — deck arrangement, evolution/hero art
python server/test_duel_zone.py   # 88 checks — series rules, loadout legality, captions
python server/test_player_cards.py # 60 checks — card rates, evidence floor, deltas
python server/test_deck_counter.py # 58 checks — symmetrisation, floors, counters
python server/test_coach.py       # 69 checks — duel legality, odds, the read, the loadouts
npm run build
```

`test_duel_combos.py` runs entirely on synthetic data: no database is opened, so
it passes on a machine with no Clash_Bot install and cannot be broken by
whatever a real player happened to do last week. It covers the parts that are
easy to get quietly wrong — the series rules, the selection budgets, the
evidence floors, and deterministic tiebreaks.

### Browser verification

The convention for UI changes, because a green typecheck says nothing about
whether a page renders:

```bash
npm i -D playwright
# write a verify*.mjs driving the actual flow, run it, read the output
node verify*.mjs
rm verify*.mjs *.png && npm uninstall playwright   # must NOT become a committed dep
git status                                        # and CHECK: see below
```

**Check `package.json` afterwards, every time.** Both a verify script and the
Playwright dependency have reached a commit here. The uninstall is not the whole
cleanup either: running `git checkout -- package.json` after `npm uninstall`
**restores** the dependency line that was just removed. Both patterns are in
`.gitignore` now, which is a backstop and not a substitute for looking.

**A screen behind auth cannot be verified the usual way.** The admin console
needs an admin session, and minting one means promoting an account in the live
database — so it has had no Playwright pass, and its three layout bugs were all
found by a person looking at it. Signing a script in also creates a real account
that then sits in the production accounts table; roughly thirty did, and they
have to be cleaned up by hand. One fixed, reused test account is the answer, and
it is not built yet.

Check the `package-lock.json` diff afterwards and revert it. Chromium is
reliable on this machine; WebKit is flaky.

Verify scripts assert on *values*, not just on elements existing — the point is
to catch a bar that renders at the wrong colour or a filter that changes nothing.

**Assert against the token, not a literal.** The UI pass checked each sidebar
section by reading `--hue-green` off `:root` at runtime and comparing the
computed `backgroundColor` to it. Hardcoding `rgb(52, 211, 153)` would have
passed just as well and would have started lying the moment the palette moved.

**A failing assertion is not evidence until you have read why it failed.** Six
of that run's failures were the probe's, not the product's — three screens wrap
their panel in a transparent layout div and the selector grabbed the wrapper.

Four more traps, each of which produced a confident wrong answer at least once:

* **The username input has no `type` attribute.** `input[type="text"]` matches
  the ATTRIBUTE and so never fires; the DOM *property* reports `"text"` by
  default, which is exactly what makes dumping `n.type` misleading. Use
  `input:not([type="password"])`.
* **The login form mounts after the intro animation**, so `waitUntil:
  'networkidle'` is not enough — wait for the selector.
* **`hover()` scrolls the element into view first**, so comparing `boundingBox`
  before and after measures the SCROLL. A card-lift assertion "passed" on a
  226px delta this way.
* **The mouse stays where the last click left it.** After the SIGN IN click it
  sits mid-screen, so a scrolled-to card is *already hovered* when the resting
  baseline is taken and the lift then measures as 0px. `page.mouse.move(2, 2)`
  first.

**Read computed style with the browser's own serialisation in mind.** Chrome
returns `color(srgb 0 0 0 / 0)` for a `color-mix` result, not `rgba(0, 0, 0, 0)`
— a glow probe matching only `rgba(...)` reported "no glow" on a glow that was
plainly visible in the screenshot. Parse the alpha from either form.

### Verifying colour specifically

Reading `getComputedStyle()` is the whole point: "the CSS compiles" says nothing
about whether a selected item is still a white slab. For any colour change,
assert in **both** `data-theme` values:

- the computed `backgroundColor` / `color` / `borderColor` of a selected sidebar
  item, an active tab, a chosen chip and a primary button — each should be the
  intended hue, not white or black;
- that hover **changes colour** while `document.getAnimations()` stays at `0`,
  which is the no-motion guarantee;
- that tabbing produces a visible focus ring;
- then **screenshot both themes and actually look at them**. Both colour bugs
  above compiled cleanly, passed every test, and were only visible on screen.
  If a panel reads as a rainbow, reduce the colour.

---

## Tracking a new tag, and the live battlelog

**Verified end to end on production, 2026-08-26**, because "I think we built
that" is not the same as knowing:

| step | evidence |
|---|---|
| searching an untracked tag enrols it | `/track/#8L8QQRL28` → `requested: true`, `state: "pending"`, stamped that second |
| it answers immediately, from the CR API | `/player/#8L8QQRL28` → `basis: "live"`, 2 decks — the ~25-battle log, no stored history needed |
| the bot picks the queue up | every tag in `tag_requests` is now in `tracked_players` — "queued but NOT yet tracked: []" |
| the drain is real | `bot.py:5030 drain_tag_requests()`, called at 5076; `CLASH_TRACKING_DB` points at the website's queue |

So the chain a new player actually walks — search a tag, see something at once,
be collected from then on — works. The queue is one small SQLite file the
website writes and the bot reads; the bot's own databases stay `mode=ro` to the
website, which is what keeps a web request from ever touching the collector's
storage.

### Enrolling a burst: what the limits actually are

Asked whether a hundred people searching a hundred new tags at once would all
land as `pending` and all be enrolled on the next drain. They would. Checking it
found two separate ceilings, only one of which the question was about.

| limit | was | now | why it matters |
|---|---|---|---|
| bot drain batch (`CLASH_TAG_DRAIN_BATCH`) | 200 per 2h cycle | **2000** | 1,000 queued tags would have taken **ten hours** to all be picked up, 200 at a time |
| queue pruning | none | `prune_enrolled()` | without it the queue eventually **freezes enrolment entirely** — see below |
| prune cost per search | full scan of `tracked_players` | **once per 60 s** | 1,000 concurrent searches were 1,000 full scans of a growing table |

**Raising the batch is cheap and the arithmetic says so.** Enrolling is an
`INSERT` into `tracked_players`, not an API call. What the newly enrolled
players then cost is one battlelog fetch each on the next poll pass, and that
pass already runs at ~8.6 players/sec — so a thousand extra adds roughly two
minutes to a pass that takes about forty.

**The prune had to be throttled, and it was my own doing.** `prune_enrolled()`
reads every row of `tracked_players` to find which queued tags are finished.
Firing that from `request()` on every search means a thousand simultaneous
searches perform a thousand full scans of a table with thousands of rows —
housekeeping becoming the slowest thing on the path. Once a minute is ample: the
queue only has to stay under the drain batch, and the drain runs every two
hours. The work is idempotent, so a skipped run costs nothing.

### The freeze the question uncovered

The bot drains `SELECT tag FROM tag_requests ORDER BY requested_at LIMIT n`,
skipping tags already in `tracked_players` — and nothing deleted the rows it had
finished with. Once a full batch of lifetime requests had accumulated, all long
since enrolled, **every drain read the same batch of skips and never reached a
newer request.** Enrolment stops permanently, with no error anywhere, while the
site goes on answering "pending" to everybody.

Demonstrated before fixing: 250 queued with the oldest 240 enrolled leaves
**zero** new tags reachable. Pruning the enrolled rows makes all ten visible.

**Cumulative, not concurrent** — which is what makes it nasty. The
hundred-at-once case was always inside one batch and always worked. The queue
merely had to get long enough, and on a public site that is weeks.

`prune_enrolled()` fires from `request()` past `PRUNE_ABOVE = 100`, deliberately
below the bot's batch: pruning only after the queue already exceeds a batch
would be too late to help. It writes nowhere but its own file —
`tracked_players` is read through the same read-only path `bot_tracked()` uses —
and returns 0 rather than raising when no database resolves.

`server/test_tracking.py` (8 checks) pins both the freeze and the fix, and
**hardcodes the bot's 200 rather than importing it**: the suite exists to check
that two separate projects agree about a number, so reading the bot's own value
would defeat the point.

### Still open: the two-hour wait itself

Raising the batch fixes *throughput*, not *latency*. A searched tag still waits
up to two hours, because `drain_tag_requests()` is only called from the
2-hourly poll loop.

The fix is written and not applied: a separate 5-minute loop that drains the
queue and immediately calls `sync_player_safe()` on whatever it just enrolled,
capped per cycle so website traffic cannot run away with the CR API budget. The
bot already has `sync_player_safe(tag, track=False)` for exactly this — it is
documented as the one place every command routes through, and it never raises.

It needs an edit to `bot.py` on the VPS, which is a different project and a
running production process. `bot.py` is backed up (`bot.py.bak-20260826`),
unchanged and verified running.

**`trackedPlayers` is on `/coverage`, not `/status`.** `/status` is the one
route that answers without a key, and how many players the service collects is
a scale figure about the business rather than a health signal — the same
reasoning that took the volume paths and byte sizes out of it. The admin console
reads it as a fourth independent source, allowed to fail without taking the rest
of the console down.



Searching a tag that nobody has ever tracked used to 404. The databases hold
what the bot polled, so a first-time tag has nothing in them — while the game
had been keeping that player's recent battles the whole time.

Two things now happen on a search, and they are deliberately separate.

**The tag is queued for collection, in a file this project owns.** The bot has a
`tracked_players` table it polls, and the obvious implementation is to INSERT
into it. `server/tracking.py` does not. Every connection this API opens to the
bot's databases is `mode=ro`, and that is not a style choice — it is the reason
a bug here cannot corrupt 43 GB of someone else's data, and it is stated as a
guarantee in both READMEs. One read-write handle for one statement removes the
guarantee for the whole process. So the queue is ours (`server/.tracking.db`,
gitignored), the bot's databases stay read-only, and `status()` reports three
distinct states the UI must not merge:

| state | means |
|---|---|
| `tracked` | the bot is collecting; stored history will grow on its own |
| `pending` | we have queued it; **nothing is being collected yet** |
| `unknown` | never searched, never tracked |

**The handoff is not built on the bot side.** A queued tag stays `pending` until
someone adds the drain to the bot's own repository. That is a stated gap rather
than an oversight: writing it from here means writing to the bot's database,
which is the thing the design exists to avoid.

**Meanwhile the screen is filled from the live Clash Royale API.**
`clash_data.cr_battlelog` fetches the endpoint the game already exposes and
`server/live_player.py` analyses it — win rate, decks with their evolution and
hero art, per-card use and win rates, modes, crowns, trophy movement. Three
things are shared with the stored path rather than rebuilt, because a second
copy of any of them is a second source of truth: `mark_variant` decides
evolution vs hero (the live payload carries the same `evolutionLevel` field the
stored `player_evo` triple does), `arrange_deck` owns slot order and art, and
`deck_name` names the deck.

**It is not a second `player_report`, and the screen says so.** The response is
stamped `basis: "live"` and the UI leads with it, because the two are different
kinds of number:

- the window is **fixed**. Supercell serves roughly the last 25 battles and does
  not paginate, so a date control would be a control that changes nothing;
- there is no previous window, so no movement, no deltas, no trends;
- the sample is far under this project's own evidence floor of 8, so every rate
  is an indication rather than a measurement.

Battles the player did not choose the deck for — 2v2, draft, event decks — are
dropped, the same rule the meta board applies, and the count that was dropped is
printed rather than quietly absorbed.

---

## When the duel population cannot fill the page

A pair needs **8 games across 2 decks** before Duel Analysis prints a
percentage — the same floor every other win-rate claim on the site clears. A
player with two duels produces 84 observed pairings and **zero** eligible ones,
so all three tabs come back empty.

That is the correct answer to the narrow question and a useless page. The same
person has 2,212 ordinary battles, and "which two cards do you actually rebuild
around" is answerable from those.

So `combo_report` asks twice: **duels first, always**, and only when that
yields nothing does it re-ask over the player's non-duel battles. The result is
stamped `basis: "duel" | "all"` and the page says which it is showing.

**Never blended.** The two populations are never mixed into one figure — a
widened answer is a different answer, not a better-powered version of the same
one. This is the Deck Counter's matchup ladder applied to a second screen:
narrowest first, widen only on failure, and name the rung.

**`slot` is `-1`, and that is the safety property.** A ladder battle has no
position in a loadout; there is no G1, G2 or G3 for it to belong to. Every slot
consumer already guards on `0 <= slot < SLOTS`, so the split *disappears*
rather than being invented — slot totals stay 0, `perSlot` comes back
`[null, null, null]`, and the client drops the three G-columns, both G-tiles,
the legend dots and the per-slot detail line rather than rendering "G1 0 · G2 0
· G3 0". Writing `0` there instead of `-1` would have manufactured a loadout
position for every ladder match, and it would have looked completely normal.

**The duel counts survive the widening.** `duels` still reports 2, not 0,
because "you have barely any duels" is the *reason* the page widened;
overwriting it with the fallback's own zeros would erase the explanation.

**The 8-card guard is not optional.** Some modes store a 16- or 24-card loadout
in a single row, and expanding pairs across that would pair cards from decks
that never shared a board. Only exact 8-card rows are read — the same guard the
deck-actions component and the OIE both apply.

---

## Duel Insights

At the foot of Duel Analysis, and it reads the **series log**, not the page it
sits on. `DuelReport` is the Pair Board — card combinations — and holds no
series, no games, no results and no opponents, so none of these questions can be
asked of it. `DuelInsights.tsx` loads `/api/analytics/duelzone/<tag>` itself, in
its own effect with its own loading and failure state; the existing fetch, tabs,
filters and table are untouched and lose nothing if it fails.

### The split that shapes every figure

A duel reaches the app in two forms carrying different amounts of information,
and this is storage rather than a gap to be patched:

| | native rows | reconstructed |
|---|---|---|
| what it is | one stored row with the whole loadout | rebuilt from consecutive friendly games |
| per-game `result` | **absent** | present |
| opponent deck | **absent** | present |
| series outcome | present | present |

Measured on a 96-duel player: all 114 native games came back with an empty
result and a null opponent; all 133 reconstructed games had both. So **series
outcomes use every duel, and everything game-level — game 1, deciders,
adaptation, positions, opponents — uses the reconstructed subset only.** The
footer states both counts, because a reader comparing "75 duels" at the top with
"21 of 35" beside a game-1 figure is owed the reason.

### Nothing is claimed below its floor

`duelInsightRules.ts` returns `null` rather than a small-sample percentage, and
the UI renders that as an explicit "Not enough data". Five series for a rate
about series, five games for a rate about games, three uses before a deck can be
called best in a position. A record — "3 of 9" — is always shown, because a
count of things that happened is not an estimate and needs no sample size; only
the percentage is withheld.

The verdicts are the same discipline applied to prose. A 52% win rate produces
no statement at all; the thresholds are what make a sentence worth printing. The
predictability check is the clearest case: on the test player it found 25
different openers with none above 9%, so it says **"hard to prepare for"** — the
opposite of the example the feature was specified with, and the right answer for
that player. A decider is the last game of a series that genuinely went the
distance, so a 2-0 played out to 3-0 is excluded rather than counted as one.

23 checks in `tests/duelInsights.test.ts` pin the native-row exclusion, every
floor, the decider rule and the fact that a coin-flip record produces silence.

---

## The display face, and the dark ground

**Headings are Arial**, a system font. They were Kids Word, a hand-drawn
OpenType/CFF file served from `public/assets/fonts/`, and the swap settles three
things that face was costing:

- **nothing to load** — no webfont request, no `font-display: swap` reflow;
- **real weights** — Kids Word ships ONE cut, which is why `font-synthesis:
  weight` had to be on for `font-weight: 600` to do anything at all. Arial has a
  drawn bold;
- **the PDF matches the screen for free.** jsPDF's built-in Helvetica is
  metrically compatible with Arial, so the export needs no embedded font, no
  conversion step and no check that the embed worked — all three of which the
  CFF face required, having silently failed at it (see below).

Two patterns were in use across the stylesheets — a literal `'Kids Word', Inter,
system-ui, sans-serif` stack and `var(--font-display, inherit)`, the second
resolving to nothing because the variable was never defined. Both now read one
token, `--font-display`, so the display face is a single edit.

**The dark page is `#000`.** The palette notes argue against a pure-black ground
and still do — the argument is about surfaces that carry body text, and the page
carries none. Every surface that does moved up a rung with it (panel `#202020`,
nested `#1A1A1A`, well `#141414`), so no small text is ever set on black, and
page-to-panel went from 9 points of lightness to 32, which is what makes panels
read as raised rather than as a slightly different shade of the background.

---

## Every deck can be copied and opened in the game

The duel builder's deck panel has had **Copy Link** and **Open in Game** since
early on. Every analytics screen drew decks you could only look at — the meta
board, the player's top ten, the Duel Zone's series log, the Deck Counter's
matchup rows, the Coach's recommendation. Finding the deck that beats yours and
then having to rebuild it by hand is the whole feature falling one step short.

`components/DeckActions/` is that pair, sized for a table row. It is wired into
nine screens: Meta Decks, Player Analysis, Duel Zone (the player's deck, the
opponent's, the sequence board and the openers), Deck Counter, Coach Assist,
Counter Lab, Deck Lab, Duel Insights and Live Player.

### The order is the server's, and that is the point

`utils/deckLink.ts` grew `getDeckLinkFromKeys(keys)` beside the existing
`getClashRoyaleDeckLink(deck)`. Analytics decks arrive as `cards: string[]`
already put through `clash_data.arrange_deck`, so the three special slots are
**already first and in slot order** — which is exactly what a `copyDeck` link
encodes. They are passed straight through.

Deriving an order here instead would be
[the "whose data is it?" bug](#a-pasted-links-order-is-the-answer) a third
time: the server has the marks and the slot rules, the component has neither.

### The 8-card guard does the filtering

`DeckActions` renders **nothing** unless there are exactly `DECK_SIZE` known
cards. That one rule is what lets it be dropped into each screen's shared
`Strip` without any caller reasoning about what it is being handed:

* a **native duel row** carries the whole 16- or 24-card loadout in `cards`, so
  those rows get no buttons — correctly, since a loadout is not a deck;
* the Deck Counter's **card-difference columns** (only-in-A, shared, only-in-B)
  are partial lists, and they opt out for free.

A button that silently does nothing is worse than no button — the same rule
that kept the mock's three decorative circles off the season control.

### The row control and the actions cannot nest

The Duel Zone's series row **is** a `<button>` — the whole row expands to show
the opponent's deck — and its card strip is inside it. A `<button>` inside a
`<button>` is invalid HTML: the browser closes the outer one early, so the
actions would have landed outside the row and the row would have stopped
expanding. The strip there takes `actions={false}` and the pair moved into a
new `.gameRow` flex wrapper alongside the button.

Every other strip on the site is inside an `<li>`, a `<td>` or a `<span>`, so
this was the only one. Worth checking for whenever a control is added to a row
that is itself a control.

### Why the chips are neutral at rest

They are square chips with their own border and sunken fill rather than bare
glyphs that appear on hover — a deck row is a dense place, and a floating icon
there reads as decoration while a framed one reads as something to press.

The hue is the interesting restraint. These repeat **once per deck**, so a
fifty-row meta board would put a coloured chip in fifty rows, which is the
"large surfaces stay neutral, and the wider the surface the lower the level"
rule broken fifty times over. So: neutral at rest, neutral on hover, and the
action hue only on the launch chip — the one that leaves the app. The copy chip
flashes green **and swaps its glyph to a tick**, so the confirmation survives a
monochrome screenshot.

`--accent-action-wash-sunken` was added to `index.css` rather than mixed inside
the component, because the chips rest on `--surface-sunken` and a tint has to be
[mixed against the ground it lands on](#the-five-hues). No component defines a
colour of its own, and this one does not either.

**Open in Game copies the link too**, exactly as the builder's footer button
does. The deep link is also the shareable artifact, so the two actions overlap
on purpose.

---

## Exporting a screen as a PDF

"Export PDF" on the analytics screens. The Player Analysis screen already had an
**Export Data** button with no handler behind it — the same decoration the
sidebar's Upgrade Now was caught being — and it is now wired to the real thing.

`analyticsReport.ts` defines one model every screen maps into (stat tiles,
tables, bar charts, deck rows with art, notes) and `analyticsPdf.ts` is the only
thing that draws one. Seven screens would otherwise mean seven copies of
pagination and seven chances for one screen's PDF to drift from another's.
Adding a screen is an adapter of about thirty lines in `reportAdapters.ts`.

**The palette is read off the page, not declared in the renderer.** `index.css`
is this project's single source of colour truth, and a PDF renderer is the most
tempting place to break that rule because jsPDF wants numbers and CSS has
strings — the deck report broke it and carries a hardcoded navy `INK` table that
matches neither theme. This one reads the computed custom properties from
`<html>` at export time through a probe element, so `color-mix` and `color(srgb
…)` are parsed by the browser rather than by a regex. Three things follow: the
report is drawn in the theme the reader currently has on, a palette change
reaches the PDF with no edit, and the colours are exactly the screen's rather
than hand-matched. `--c-use` / `--c-win` were declared on `.page` in four
component modules — each with a comment saying one app should not encode "use
rate" two ways — and are now hoisted to `:root` so that is structurally true.

### The display face silently did not embed (fixed, then obsoleted)

`KidsWord.otf` is OpenType with CFF outlines — file magic `OTTO`. jsPDF's parser
only understands TrueType `glyf` outlines, and it does not say so: `addFont`
succeeds and the failure surfaces once per glyph at draw time as a PubSub error
jsPDF swallows (`Cannot use 'in' operator to search for '0' in undefined at
glyphFor`). The export produced a perfectly valid PDF whose headings were
quietly Helvetica. Measured, the same one-line document was **3,353 bytes with
the OTF against 12,536 with a real TrueType file** — nothing was being embedded.

`scripts/build-pdf-font.py` converts the outlines with cu2qu at one font unit of
tolerance on a 1000-unit em, and the renderer *proved* the embed by measuring a
string rather than trusting `addFont`.

**The site then moved to Arial and all of that came out again** — Helvetica is
built into jsPDF and metrically matches Arial, so there is no font to embed and
nothing to verify. The script is kept, unreferenced: it is the record of how to
bring a custom face back, which is the part that is hard to rediscover.

### The second export: the page exactly as it looks

The report above is a *designed* document — a model, a renderer, one adapter per
screen. Alongside it there is now a second, blunter export: **Export PDF** in the
analytics top bar, which prints the screen you are on, top to bottom, header
included.

It lives in the Dashboard shell rather than in each analytics component, so
every section gets it from one place, in one position, with no chance of a
screen being forgotten.

**It uses the browser's own print engine, not a DOM rasteriser**, and that was a
measured decision rather than a preference. This design uses **43
`backdrop-filter` panels and 97 `color-mix()` values**; html2canvas ignores the
first outright and barely supports the second, so a canvas screenshot would have
rendered the glass flat and the colours wrong. The print engine composites the
real page. The cost is one extra click — the browser dialog, where the
destination is "Save as PDF" — and there is no way to skip that from a web page
without giving up the fidelity that is the whole point.

**The only thing that genuinely needed fixing was scrolling.** The app does not
scroll the document: `.main` and `.body` are `overflow-y: auto` containers, so
`document.body.scrollHeight` sits at the viewport height and a naive print
captures the visible slice only. `src/print.css` unclips them. Measured on three
sections:

| section | on screen | printed | pages |
|---|---|---|---|
| Duel Analysis | 2,933 px | 2,948 px | 8 |
| Cards | 1,170 px | 1,106 px | 3 |
| Duel Zone | 44,822 px | 43,210 px | 79 |

The sidebar is dropped, and that was found by looking at the output rather than
by reasoning: un-pinning it collapsed the two-column layout into a stack, so the
first sheet of every export was a page of navigation links and an "Upgrade Now"
advert before any analysis appeared. Navigation is not content — nobody can
click it in a PDF. The header is deliberately kept, because it carries the brand
and the tag being analysed, which is what makes a printed page identifiable
later.

**The theme follows whatever the reader has on.** Print engines strip dark
backgrounds by default to save ink, so this needed checking rather than
assuming; `print-color-adjust: exact` prevents it, and both themes were verified
to reach the PDF unchanged (`rgb(0,0,0)` stays `rgb(0,0,0)`).

### Tabs, and why only one screen prints all of them

A PDF cannot be clicked, so a tab bar in one is a dead control. Duel Analysis now
prints **all three tabs stacked** — Win Conditions, Spells, Evolutions — each
under its own heading, with every row shown rather than the on-screen top 8.

CSS alone cannot do that: inactive panels are conditionally rendered, so they are
not in the DOM for a stylesheet to reveal. `state/printMode.ts` is a flag the
Export button raises; the component reads it and draws all three. It costs no
extra fetch because `report.tabs` already holds all three — they are slices of
one payload.

Every per-tab value (`t`, `rows`, `slotScale`, `unmeasured`) is derived **inside**
the loop. Leaving them outside would have printed the active tab's numbers under
all three headings — right-looking output, wrong data.

The other tabbed screens deliberately do **not** do this, because their tabs are
not the same kind of thing:

| screen | tabs | printed |
|---|---|---|
| Duel Analysis | three different combo tables from one payload | **all three** |
| Cards | eight *filters* over one list, where "All" is the superset | active tab |
| Deck Counter | three separate tools, two needing pasted decks | active tab |
| Coach Assist | two stateful interviews | active tab |

Printing all eight Cards tabs would repeat the same ~120 cards eight times;
printing Deck Counter's would emit empty "paste a deck here" forms.

### Rates are percent, and getting that wrong is invisible

Every analytics endpoint reports rates on a **0-100 scale** — `/meta` sends
`useRate: 2.13`, `/cards` sends `winRate: 75.0`, `/player` sends `useRate:
19.2`. A `pct()` helper that multiplied by 100 printed a 73.5% win rate as
**7350.0%** in a finished report. Both sides are `number`, so no type system
catches it; only reading the real payload does. `pct()` formats and `frac()`
converts, and the live endpoint was changed to match the convention rather than
the four older endpoints being special-cased around it.

---

## The Opponent Intelligence Engine

Nineteen phases of measurement, and the whole thing reduces to one sentence:

> **The opponent's most recent deck is the prediction. Everything the engine
> adds is a confidence band on that, and a short list of plausible
> alternatives.**

That is a smaller claim than the project started with, and every attempt to make
a bigger one lost to a measurement. What follows is the record, because the
negative results took the most work and are the easiest to accidentally redo.

`CLASH_OIE` gates the whole thing and defaults to **`off`**. Nothing below is
live.

### What it does, and what it refuses to do

| | |
|---|---|
| primary prediction | the most recent deck, **structurally impossible to replace** |
| confidence | `high` / `medium` / `low`, calibrated against real outcomes |
| alternatives | at most 2 / 1 / 0 by band, labelled "plausible configurations" |
| never claims | that it knows the exact next deck |

`ml/production/policy.py` enforces that with `enforce_primary()`, which runs
**last** and unconditionally. Phases 4, 5, 6 and 7 each tried letting a model
overrule the recent deck and each lost, so the production design makes that
outcome unreachable rather than merely unlikely.

### The phases, and what each one settled

| phase | question | answer |
|---|---|---|
| 1 | is `recent` better than the shipped `modal`? | **yes**, +19.0 / +11.1 pts exact@1 (400 players) |
| 2 | can we detect WHEN a deck changes? | **yes** — ROC-AUC 0.932 / 0.803 |
| 3 | does knowing the outgoing card help? | **yes**, +6.9 / +5.0 pts top-1 |
| 3 | does opponent archetype/deck help? | **no** — indistinguishable from zero |
| 4 | chain change to exit to entry, end to end? | **worse than standing still** |
| 5 | expected utility over the chain? | it correctly decides **never edit** |
| 6 | can we rank how predictable an edit is? | yes, but the curve carried a selection oracle |
| 7 | any oracle-free policy that beats Recent? | **no.** The truth was not in the candidate set 80-88% of the time |
| 8-9 | widen candidate generation | shell pool to player-wide pool lifted 1-card recall to **85.8% / 88.6%** |
| 10-11 | rank the candidates | pointwise **fails**, pairwise **fails** — a heuristic first pick is hard to beat |
| 12 | would a hybrid help? | **no** — the rescue cell is 1.4-1.8% |
| 13 | attack exit prediction | plateaus at ~45% / 53% top-1 |
| 14 | what IS shippable? | Recent + confidence band + shortlist |
| 15-16 | production integration + shadow | shipped behind a flag; shadow found 2 real bugs |
| 17A | recalibrate on production semantics | duel `high` was 91% of reads at 70% accuracy — fixed |
| 17B | is a switched-to deck one they have played? | **no** — 50% / 38% historical. Ceiling ~5% / 2% of steps |
| 18 | can a novel deck be generated from history? | **no** — usable recall needs 10^8-10^10 candidates |
| 19A | fix the latency | duplicate reads removed; the rest is disk |
| 19B | UI | async, non-blocking, browser-verified |
| 19C | validate against REAL outcomes | ordering holds, magnitudes wrong |
| 20A | can Y's deck tell X what to bring? | **no** — the ORACLE arm loses to X's default |

### The finding that reframed the product

Phase 14 measured the shortlist adding **+8.4 points** of coverage. Phase 16C
measured it adding **+0.5**. Both were correct, and the difference is the step
definition:

| truth in alternatives, on change steps | production semantics | `next-in-cluster` |
|---|---|---|
| duel | 2.9% | **20.0%** |
| competitive | 7.7% | **40.0%** |

Phases 8-14 stepped `next-in-cluster`, which by construction only ever scores
steps where the player **stayed on the shell** — precisely the case a 1-card
shortlist addresses. Production asks "what deck comes next", full stop. Under
that question the change is usually a whole-deck switch:

| cards shared with the previous deck | duel | competitive |
|---|---|---|
| 8 — no change | 74.2% | 79.1% |
| 7 — the 1-card edit | **2.3%** | **1.8%** |
| 0-3 — whole-deck switch | 22.1% | 15.9% |

So the machinery from Phases 8-14 addresses ~2% of production steps. Not
invalid — correct under its stated frame — but the frame was not the product's.

### Why exact next-deck prediction was stopped

Phases 17B and 18 closed it from both sides, and the numbers are ceilings rather
than model failures:

* **17B** — when a player switches, the deck is one they have played before only
  **49.8%** (competitive) / **38.5%** (duel) of the time. Combined with retrieval
  quality, a perfect historical ranker reaches **~5%** / **~2%** of all steps.
  Retrieval also gets *worse* with more history: R@1 falls from 87.4% at 2-3
  known decks to **24.8%** at 11+, because vocabulary grows faster than the
  return rate.
* **18** — when the deck is genuinely new, only **52.1%** / **61.7%** of them can
  even be *built* from cards the player has fielded before. The one generator
  with real recall (historical fragments, 38-59%) emits **509 million** /
  **9.7 billion** candidates. The cheapest useful operating point still emits
  ~0.9M / ~6.2M for 28-40% recall. For scale, Phases 9-11 already failed to beat
  a heuristic over a pool of 228-495.

More data will not fix this. It raises coverage slightly and the search space
faster.

### Setbacks worth not repeating

* **Class weighting hurt every metric.** Shipped on by standard imbalance
  reasoning; measured, it damaged PR-AUC, ROC-AUC, F1 *and* Brier. Default is
  now off with the measurement in the docstring.
* **A step definition that flattered the model.** See above. The single most
  expensive mistake in the programme.
* **Phase 6's "deployable" result was oracle-gated.** Candidates were only built
  on steps that were genuinely edits, so the policy could only fire on a true
  edit. Re-run honestly it went from +0.0029 Jaccard to **-0.0556**.
* **Sparse data winning twice.** One observed transition scoring probability 1.0;
  one edit outranking a card fielded in 1 of 20 outings. Shrinking the estimate
  is not enough — the blend weights have to be commensurate too.
* **Two bugs only shadow could find.** `cluster_containing()` returned the wrong
  shell on 25% of live reads, and M2 features were computed over a player's
  whole history rather than the shell, so live P(change) sat at **0.994** where
  it should have been 0.020.
* **A test destroyed the experiment.** `os.remove(shadow.LOG_PATH)` in
  `test_ml_production.py` deleted the *production* log, so running the suite
  wiped 1,277 collected observations. Twice. See `test_shadow_durability.py`.
* **Two "fixes" that measured as nothing.** Persistent connections with mmap and
  a bigger cache looked like a 10x win across tag slices; paired on the same
  tags it was **-8 ms, CI [-37, +21]**. Narrowing the history window: **+9 ms,
  CI [-29, +47]**. Both were page-cache warming artifacts.
* **A single-sample latency claim.** 19B reported shadow observation costing
  9.6s against 2.4s. Paired over 40 tags it is **-219 ms, CI [-1297, +859]** —
  no effect at all. Withdrawn.

### The first real accuracy, measured against battles that actually happened

> **SUPERSEDED, AND THE LABEL IS WRONG.** Everything in this section says
> "duel"; Phase 20D established that domain contains no duels and is
> `practice`. The figures below are the FIRST reconciliation (574 predictions);
> the mature one is in
> [The 19D reconciliation, in full](#the-19d-reconciliation-in-full), and it
> reproduced these values on roughly double the sample. Kept because the
> reasoning that follows is still the reasoning that applies.

574 frozen predictions, reconciled against each player's first strictly later
valid 8-card deck. Not a backtest — these were made before the outcomes existed.

**COMPETITIVE — 192 players with outcomes (past the 100 gate)**

| band | share | outcomes | accuracy | 17A claim |
|---|---|---|---|---|
| high | 94.9% | 179 | **71.5%** | 90.5% |
| medium | 4.7% | 12 | 58.3% | 73.3% |
| low | 0.4% | **1** | 0.0% | — |

**DUEL — 73 players with outcomes (gate not met)**

| band | share | outcomes | accuracy | 17A claim |
|---|---|---|---|---|
| high | 27.0% | 5 | **60.0%** | 92.1% |
| medium | 43.4% | 31 | 32.3% | 75.8% |
| low | 29.6% | 37 | 27.0% | 47.3% |

**The ordering holds in both domains. Every single magnitude is below its
published claim** — competitive `high` by 19 points, duel `high` by 32, duel
`medium` by 43. That is systematic, not noise: the bands correctly *rank* how
much to trust a prediction, and the numbers attached to them are wrong.

Two things stop this being a verdict. Competitive `low` rests on **one player**,
so the three-band ordering there is one observation from meaningless. Duel `high`
rests on **five**. And competitive `high` contains 179 of 192 outcomes, so the
band barely discriminates — it just holds nearly everyone.

**Duel went 78 ripened to 73 reconciled**, which is not a contradiction:
ripeness asks whether the player has played again, reconciliation additionally
needs a valid 8-card deck to hash, and a few resolved to native duel loadouts
that are not decks.

### Why re-cutting the bands is not the fix

Reliability on the competitive sample:

| P(Recent correct) bin | outcomes | model claims | reality |
|---|---|---|---|
| 0.8-1.0 | **162 of 167** | 96.7% | **71.6%** |

Brier 0.2588, **ECE 0.2470**. Almost every prediction lands in one bin, where the
score claims 96.7% and delivers 71.6%. Moving thresholds *relabels* predictions;
it cannot repair a score that is overconfident by 25 points. If the mature sample
confirms this, the right lever is a **calibration map on the score** (Platt or
isotonic), not another threshold move — and 167 players is too thin to fit one.

### Why waiting for duel stopped being a plan

The duel ripening rate collapsed rather than held:

| window | duel ripened | rate |
|---|---|---|
| first day | 38 → 54 | ~3/h |
| +6h | 54 → 68 | 0.8/h |
| +20h overnight | 71 → 75 | 0.2/h |
| +27h | 75 → 78 | **0.11/h** |

That last window was the bot's most productive (+236,500 rows), so it is not a
collection problem. The 257 duel anchors split into ~78 belonging to people who
duel regularly — already counted — and ~179 belonging to people who duel
occasionally, who will not produce an outcome on any timescale worth waiting
for. Three successive "about a day away" estimates were all wrong in the same
direction.

### Wave 2 — complete, and what it can and cannot fix

#### Wave 2, and why it is chosen on recency

Re-deriving from current data found **7,006 players with recent duel activity**,
only 169 of them already in the cohort — the pool is far larger than the 755
found three days earlier, because the bot now tracks more tags.

1,084 of them have **>= 10 duel rows in the recent tail**, and those are the ones
collected. The selection is deliberately on RECENCY rather than lifetime volume:
the first cohort proved that infrequent duellers never ripen, so adding players
by raw duel count would mostly add dead anchors. A player with 50 recent duels is
near-certain to duel again within a day; one with 5 may not.

New anchors start unripened by construction, so wave-2 outcomes begin appearing
about a day after collection, not immediately.

### Phase 20A — could the OPPONENT tell X which deck to bring?

A deliberately narrower question than Phases 1-18. Those asked "what deck will Y
bring" and hit ceilings on an open construction problem. This asked: given Y,
which of **X's own** decks should X play? That is a choice among 5-40 known
objects, not a construction, so it had every reason to be easier.

**It is not. The branch is closed.**

| competitive, 76 players | games | win rate | player-macro |
|---|---|---|---|
| X plays their default deck | 2,777 | 58.9% | 58.5% |
| the archetype pick | 1,849 | 60.0% | 62.7% |
| **the exact-deck pick (ORACLE)** | 221 | **48.9%** | 56.4% |
| every test game | 10,514 | 62.2% | 63.2% |

Paired on players: archetype **+1.7 pts [-1.0, +4.6]**, exact-deck
**-1.4 pts [-13.2, +10.8]**. Neither clears zero.

**The oracle arm is what decides it.** Handed Y's TRUE deck — the strongest
information this problem can ever have — the recommendation scored 48.9%, below
X's own default at 58.9% and below the overall test rate of 62.2%. If knowing the
opponent exactly does not beat "play your usual deck", then adding Y-prediction
error on top cannot rescue it. The gate was written for precisely this case.

**Coverage is the second problem.** A supported (deck, exact-opponent-deck) cell
existed for only **5.5%** of competitive test games and **0.0%** of duel ones: a
specific opponent deck rarely recurs often enough for X to have 5+ games against
it. The oracle is not merely unhelpful, it is mostly absent.

**Duels are structurally hostile.** 2.8% archetype coverage, and ZERO test games
where X played the recommended deck. Two causes compound: a duel loadout forbids
card reuse, so the legal set shrinks with every deck already played, and X's duel
decks are card-disjoint by rule — so "X's best deck against golem" is frequently
illegal by the time it would be offered.

**Agreement is low, and that is itself a finding.** The matchup-optimal pick was
what X actually played only 21.6% of the time (Recall@3 31.7%). Players are not
choosing by matchup. That is consistent with the bot's counter-sniping result,
which measured top-1 accuracy falling 8.3% -> 2.7% when it tried.

**Two caveats kept deliberately.** The comparison is COUNTERFACTUAL — we only
ever see the deck X actually played, so these arms compare games where X
*happened* to play the recommendation against games where X played their default.
That is observational and confounded upward: X may pick a deck precisely when the
matchup already looks good. So +1.7 is an upper bound on a signal that already
does not clear zero. And *every test game* (62.2%) beats all three arms, which is
a selection artifact of the arms being subsets, but means no strategy here beats
"whatever X did anyway".

`ml/evaluation/phase20a.py`, `test_ml_20a.py` (22 contract tests). Measurement
only; production, OIE, calibration and the active artifact were untouched.

**Collected: 1,084 players in 67 minutes, zero errors.** The log went from 574 to
**2,476 records**; duel players observed went 318 -> **1,367**, competitive
256 -> **1,067**. Integrity clean, still ONE version stamp, so it remains a
single interpretable experiment.

**But the `high` band will still be short, and that is now measured rather than
feared.** Duel bands across wave 2 came out low 257 / medium 582 / **high 43**
— 4.9%. Even before ripening that is barely at the 30-player support floor, and
only a fraction of anchors ripen within a day, so duel `high` will land around
13-17 outcomes.

The cause is a genuine tension in the selection, not a mistake in it. Anchors
ripen only if the player plays again, so the cohort was chosen for FREQUENT
duellers — and `high` means `P(change) < 0.0061`, a low-churn state that frequent
duellers essentially never occupy. **The property that makes anchors ripen is the
property that starves the top band.** Fixing it needs a third wave selected for
LOW churn, which trades ripening speed for band coverage; it is a different
query, not a different model.

**Foreground latency, measured across 1,084 real requests:** `/coach/predict`
p50 **2,737 ms**, p95 **7,095 ms**, p99 **15,182 ms**. That is the Coach's own
database read on the spinning volume — the OIE engine inside the same requests
ran 7-26 ms. Consistent with the 9.3 s p95 seen in 19B, and the clearest
argument yet for moving to SSD.

### Wave 2 worked, and it proved the diagnosis

Six hours after collection, with the bot mid-pass:

| domain | anchors | ripened | gate |
|---|---|---|---|
| competitive | 926 | **267** | REACHED |
| duel | **1,124** | **156** | **REACHED** |

Duel went from 78 ripened anchors to **156** — past 100 for the first time.

The rate is the interesting part. The original cohort ripened at **0.11/hour**
after four days; wave 2 ripened at roughly **13/hour**. That is a ~100x
difference, and it settles what the earlier stall actually was: **not that
outcomes are rare, but that those specific players had stopped duelling.**
Selecting on recent activity rather than lifetime volume was the whole fix.

It also retires three wrong estimates. "Roughly another day" was said three
times about the original cohort and was wrong each time in the same direction,
because it extrapolated a decaying rate as if it were linear. The lesson is not
to forecast from a saturating curve — measure the population instead.

### The 19D reconciliation, in full

574 predictions grew to 2,476 after wave 2, and reconciling them against each
player's first strictly-later valid deck gave the first honest read on the
bands. Both gates were reached — 344 competitive and 148 practice players with
outcomes, against a floor of 100.

**COMPETITIVE — 364 reconciled**

| band | share | n | pooled | player-macro | 17A claim |
|---|---|---|---|---|---|
| high | 95.7% | 343 | **69.1%** | 68.2% | 90.5% |
| medium | 4.1% | 20 | 55.0% | 55.0% | 73.3% |
| low | 0.2% | **1** | 0.0% | 0.0% | — |

Brier 0.2897, **ECE 0.2806**. The dominant bin holds 356 of 364 predictions,
claims 96.8% and delivers 68.5%.

**PRACTICE — 151 reconciled**

| band | share | n | pooled | 17A claim |
|---|---|---|---|---|
| high | 5.3% | **8** | 62.5% | 92.1% |
| medium | 48.3% | 73 | 35.6% | 75.8% |
| low | 46.4% | 70 | 21.4% | 47.3% |

Brier 0.5723, **ECE 0.6097**.

**The ordering holds and every magnitude is wrong.** That is systematic rather
than noisy: the bands correctly RANK how much to trust a prediction and the
numbers attached to them do not survive contact with reality. Wave 2 roughly
doubled the sample and reproduced each value, so this is not a thin-sample
artefact.

---

## Closing the engine: phases 20B–24B

Four branches were still open after 20A. All four are now closed, and two of
them closed because a measurement of MINE was wrong rather than because the
world was uncooperative. Those are written up first, because they were the
expensive lessons.

### 20B: a mechanism that was a tautology

Practice `high` was failing at ECE 0.6097 while competitive sat at 0.2806, and
the obvious explanation was structural: a duel loadout may not reuse a card, so
"they will bring the same deck" is forbidden by the rules inside a series.

The measurement appeared to confirm it spectacularly — inside a reconstructed
run the previous deck retained **0.00 of its 8 cards**, reported at the time as
"exact disjointness, measured with a run definition that never looks at a card".

**It was true by construction.** `used_before()` unions `plays[i-1]` whenever
the link holds, so the previous deck is ALWAYS fully inside the used-card set.
"C illegal" was the `same_run` flag wearing a different name. Handed two linked
battles on the *identical* deck — which the rule forbids — it still reported
0.00 of 8. The function could not observe a violation with one in front of it.

The run reconstruction was checked for circularity and was clean; the legality
step immediately after it was not. **Checking one half of a two-step derivation
is not checking the derivation.**

What survived: the ASSOCIATION is real. Consecutive same-opponent battles
within 30 minutes change decks 78.4% against 16.5%, with ECE 0.6790 against
0.1252. What did not survive: the stated cause. And 20D later showed the share
itself is sampling-dependent — 20.3% under one sampling, 51.3% under another.

Phase 20D then added the sharper correction: paired on the 203 players who
experience both contexts, the effect is **0.013 [-0.038, 0.062]** — it does not
clear zero. The huge pooled gap is BETWEEN players, not within them. The
context identifies *who* cycles decks, which is a much weaker claim than the
one originally made.

### The domain that was never duels

Phase 20C was meant to validate 20B. Its ex-ante legality signal agreed with
reality **10.6%** of the time — worse than chance — and that is what forced the
audit that found the real problem.

Measured over 400 cohort tags in a 60-day window, the engine's `duel` domain is:

| mode | rows | cards |
|---|---:|---|
| Friendly | 26,718 | 8 |
| Showdown_Friendly | 8,186 | 8 |
| Duel_1v1_Friendly | 404 | **16 / 24** |
| CW_Duel_1v1 | 381 | **16 / 24** |

Two correct decisions combine into a wrong one:

* `duel_combos.is_duel_like_mode` admits any mode containing "friendly",
  because the bot's DuelEngine RECONSTRUCTS duels out of friendly practice.
* `source._rows_to_plays` drops any row that is not exactly 8 distinct cards,
  because a native duel row carries a whole 16/24-card loadout and a loadout is
  not a deck.

Each is right alone. Together they admit practice and discard **every real
duel**. Of 1,238 native duel rows seen in a later census, **zero** carry 8
cards, so the exclusion is structural rather than incidental.

**Every "duel" figure from Phase 14 onward — including 17A's calibration and
19D's shipped band accuracies — describes friendly practice matches.** The
measurements were sound; the label was not. Phase 20D renamed the domain to
`practice` and re-ran the evaluation under it.

The correction barely moved the numbers (ECE 0.6147 → 0.6097, 153 → 151
reconciled) **and that is the point**: native rows were already being dropped,
so relabelling removed only the minor friendly variants. What changed is not
the measurement but what it is a measurement OF.

No test had ever asserted what the domain CONTAINED. That is why it survived
twenty phases.

### 21A: spells, and a substrate nobody had read

The spell hypothesis was the last open idea: after seeing an opponent's deck,
do its SPELLS narrow what they bring next beyond their own history?

Answering it honestly needed real duels, and 20D had just concluded those were
unavailable. They were not. **`battle_raw.raw_json` keeps what `battles` throws
away:**

```
team[0].rounds -> [{cards: [8], crowns, elixirLeaked, towerHitPoints}, ...]
```

Present for BOTH sides, round counts matching, 8 cards per round, each round
carrying its own crowns — across **49,963 native duel payloads** spanning the
full window. So a duel decomposes into ordered games with per-game decks and
per-game results, for both players. 20D's "native duel needs a different
representation" was too pessimistic and is withdrawn; the representation exists,
in a table the OIE had never opened.

That substrate also settles the question 20B botched, properly this time:

> **12,000 loadouts, 21,432 deck pairs, card overlap ZERO in every single one.**
> The duel card-reuse rule is absolute.

**And the spell result is a clean null.** Over 41,980 transitions and 20,702
players, with a 70/30 time split and legality-filtered candidates:

| arm | top-1 | top-3 | MRR |
|---|---|---|---|
| A full (history + cards + spells) | 13.5% | 19.9% | 0.167 |
| B no spells | 13.6% | 19.9% | 0.167 |
| D history only | **13.9%** | 19.9% | 0.169 |
| E spells only | 13.2% | 19.9% | 0.165 |

Paired on players, **A − B = 0.000 [-0.001, 0.001]**. History alone is
marginally the best arm. Spells are, if anything, slightly negative.

Coverage was only 20.4%, which would dilute a real effect toward zero, so the
gate was re-run restricted by candidate-pool size. Top-1 rises to 47.9% once
empty pools are excluded — **and every paired interval still contains zero at
every pool size**, with no trend as the pool grows.

**A second finding matters more.** The right baseline for a ranker over a
legality-filtered pool is not "guess an archetype" but "guess uniformly among
the same legal candidates":

| subset | mean pool | ranker | random-in-pool | delta |
|---|---:|---:|---:|---|
| pool >=1 | 1.89 | 47.9% | 46.2% | +1.7 pts |
| pool >=2 | 2.62 | 37.7% | 34.7% | +3.0 pts |
| pool >=3 | 3.76 | 28.8% | 23.9% | +4.9 pts |
| pool >=5 | 5.84 | 11.7% | 14.5% | **-2.8 pts** |

Almost all the apparent accuracy is the **legality filter**, not prediction.
Once two decks are spent, what a player can legally bring is often one or two
archetypes, and naming one is close to naming the only option. The ranker goes
NEGATIVE at pool >=5 — exactly where ranking would have to do real work.

There is a weak spell association (`earthquake` → goblin-barrel 1.51x,
`goblin-barrel` → hog-rider 1.51x) but entropy barely moves: 4.158 bits
unconditional against 4.109 at best. Real, and far too small to rank with.

**SPELL MATCHUP SIGNAL: FAIL.** The branch is closed.

### 22–23B: freezing it, then hardening it

Phase 22 wrote the production contract down as a document and as tests, and
recorded three known deviations as characterisation tests so the debt could not
be forgotten. Phase 23 paid them:

* **`changeProbability` removed from the payload.** A rounded logistic score is
  a model internal, and it is the same score measured at ECE 0.2806 / 0.6097 —
  both internal AND wrong. It stays in-process for band assignment and the log.
* **`duel` renamed `practice`** without rewriting history: the frozen artifact
  still keys it `duel` and one `ARTIFACT_DOMAIN` mapping absorbs the
  difference, so stored observations remain attributable to the artifact that
  produced them.
* **Practice ships no band**, via `policy.BAND_SUPPORTED`. The alternatives go
  with it, because the 2/1/0 cap is *justified* by the bands meaning
  something — an unranked band cannot license a split.
* **Stale justifications corrected.** `ALTERNATIVE_CAPS` cited "duel high
  92.1%, low 47.3%" as measured fact. The rule is unchanged and still right; it
  now rests on ordering alone.

**23B took a product decision:** the surfaced domain is `competitive`, not
practice. The Coach screen is about duels, so the duel-ish domain looks like the
natural thing to show — but without a validated band, practice carries no
confidence and no alternatives, so surfacing it would ship a panel holding the
recent deck and nothing else. Technically "on", informationally empty. Practice
is still observed and logged; it is simply never displayed. This is not a claim
of native duel support.

### The browser gate, and a verification that lied

All three modes were driven through the real site with Playwright:

| mode | result | panel | endpoint |
|---|---|---|---|
| off | 14/14 | absent | `{enabled:false, read:null}` |
| shadow | 14/14 | absent | disabled; 12 observations recorded |
| on | 19/19 | **present** | qualitative band, 2 alternatives |

Shadow was pointed at a scratch log via `CLASH_OIE_LOG`, and the production log
stayed **byte-identical** — 2,476 records, md5 `f8740be7…` before and after.
That override exists because this log was destroyed twice; this is the first
time it was used deliberately.

**An earlier version of the script passed against an empty page.** The Coach
opens as an INTERVIEW — nothing renders until "Has the duel started?" is
answered — and the first selector guess matched nothing, so every check passed
trivially. It was caught by dumping the DOM instead of trusting the green.
A green verification proves nothing until you have confirmed it is looking at
the thing it claims to check.

**Latency, attributed correctly at last:** in the same page loads,
`/coach/predict` took **29,042 / 56,744 / 31,209 ms** while
`/coach/opponent-read` took **14 / 31 / 15 ms**. The engine is not the Coach's
latency and never was; that cost is the database read on the spinning volume.
Two earlier claims are formally withdrawn — that the OIE makes the Coach slow,
and 19B's single-sample "9.6s vs 2.4s" (paired over 40 tags: -219 ms,
CI [-1297, +859], no effect).

### 24A: the local soak, and the bug it found

80 real tags through `coach.opponent_read`, the function the endpoint calls:

| | |
|---|---|
| requests / successful / failures | 80 / 80 / **0** |
| degraded rate | 11.25% |
| OIE latency | p50 **103 ms**, p95 **1,176 ms**, p99 **1,362 ms** |
| confidence | high 78, medium 2 |
| alternatives | 2→67, 1→2, 0→11 |
| invariant violations | **0** |

Five failure injections — missing artifact, model exception, empty history,
malformed input, `observe` raising — all survived with Recent intact and no
ML-generated primary.

It also found a real contract inconsistency: **`degraded=true` could still
carry alternatives** on the counting-fallback path (the one taken when the M2
artifact is missing). Nothing was user-visible, because the Coach suppressed
them client-side — which is exactly why it needed fixing before a second client
exists. "The payload is wrong and the UI compensates" stops being true the
moment someone writes another consumer. Fixed at the source and again at
serialisation, with a test that hands `as_dict()` a deliberately dirty object.

### 24B: what shipping actually requires

The rollout that was requested could not be run, and the reason is worth
stating plainly: **there is nothing to roll out to.** `main` runs `6ab701d` and
contains **zero** `server/ml` files; `api/` holds only the Upstash deck-sync
function; there is no `/api/analytics` handler, no `vercel.json`, and
`CLASH_OIE` is an environment variable on a local Python process. A staged
percentage rollout needs production traffic reaching a hosted analytics
service, and neither exists.

The full plan is in `server/ml/results/phase24b-hosting-plan.md`. Its
conclusions:

* **Do not move the database.** 69.4 GB growing by ~190k battles/day, over a
  home upload link, with SQLite having no native replication. Run the service
  beside the data and expose it through an authenticated tunnel.
* **An OIE-only extract would be ~1.01 GB**, measured: the engine reads six
  columns over 60 days, which is 6,806,514 rows x 160 bytes, against 17.7 GB
  for `battles.db`. That is the path to an always-on OIE later; it does not
  serve the Coach, the meta board, Deck Counter or Cards.
* **The hard prerequisite is authentication.** `app.py` is a localhost service
  and says so (`CLASH_API_HOST=127.0.0.1`). Exposed unchanged it would be
  unauthenticated, `Access-Control-Allow-Origin: *`, unrate-limited, plaintext
  — a free bulk export of ~3.8M battles of other people's data to anyone who
  finds the hostname.
* **Build an allowlist, not percentages.** Written when the site had 20 fixed
  accounts (long since deleted); a
  percentage of 20 is theatre.

### What the engine actually is, in one table

| | |
|---|---|
| primary | the most recent deck, **structurally unreplaceable** |
| confidence | High / Medium / Low, **as words** — never a number |
| practice confidence | **none** — its bands do not rank |
| alternatives | <=2 / <=1 / 0 by band, competitive only, labelled "not forecasts" |
| never claims | that it knows the exact next deck |

### Future scope, honestly

* **Deploy it, or do not.** The model work is finished. What remains is
  authentication, a tunnel, a merge to `main`, and an allowlist — infrastructure,
  not research.
* **A calibration map on the competitive score** (Platt or isotonic) is the one
  defensible remaining model change, and only on competitive: 364 reconciled
  players is at the ~360 threshold where numbers become worth showing. It must
  NOT be fitted on the practice sample, whose composition is an artefact of when
  collection ran.
* **Native duel prediction** is now a *possible* project rather than a blocked
  one, because `battle_raw.rounds` exists. It needs a loadout representation and
  it is a different research programme, not a fix to this one.
* **Not planned, and now with evidence:** spell-conditioning (21A), matchup
  response (20A), exact retrieval (17B), novel generation (18), the 122-card
  knowledge graph, Markov chains, elixir/cycle models, neural rankers.

---

## Recent Battles — the raw log

A new area directly under Search Player, and the only analytics screen that
does not aggregate. Every other one counts something: the pair board counts
pairings, the meta board ranks decks, the Duel Zone reconstructs series. This
one lists what happened — their deck, the deck they faced, the crowns, the
mode, newest first.

It exists for the reader who does not yet trust an aggregate. A win rate is an
argument; a battle is a fact, and this is the page that shows the facts the
arguments were computed from.

### The row is the design

A battle is a **comparison**, so the two decks sit parallel with the VS between
them, each a 4×2 block in the in-game loadout shape. A comparison you have to
scroll between is not one you can make.

Two things had to be right for that to hold, and both were wrong first.

**The pair is centred as a group, not laid out in `1fr` tracks.** Tracks are the
obvious answer. They are also wrong: the decks are capped in width, so each one
aligned to the outside of its own track and the row opened a 250px hole down
the middle with the VS marooned in it. Three content-sized items centred as a
group put the slack on the *outside*, where it reads as margin.

**A side takes `flex: 1 1 0`, and the zero is the point.** With `auto` the
basis is max-content — which for this block is the longest line of *text* in
it, not the card grid. An opponent called "A Rather Long Opponent Name" made
the side **538px against a 280px deck**, and because both sides did it the pair
filled the row and pushed itself apart. From a zero basis the two take an equal
share of real space and a long name is something that ellipsises inside it. A
name is not a reason for a deck to move.

Below 56rem there is no room for two blocks abreast, so they stack and the VS
becomes a divider rather than a centrepiece. Measured 390–1440px: parallel down
to 1100, **0px overflow at every width**, tiles never below 66px.

Colour stays off the decks entirely. The outcome lives on a 3px leading edge
and a badge, because a battle row is a large surface and a green one would
drown the two decks it exists to show — the same call the Duel Zone's series
cards make.

### Paged on the server

Ten to a page, under the same date control as every other screen. The window
picks the pool, the page picks what crosses the wire: an active player has
hundreds of battles in thirty days (a real tag returned **666 in 30 days, 67
pages**) and each row carries two decks with their art. Sending all of them to
render ten is megabytes for nothing.

Three rules the paging has to keep, each of which fails quietly rather than
loudly:

* **A page past the end clamps, it does not error.** Narrowing the date range
  with page 9 open is the ordinary way to get there, and answering that with an
  error would make the date control able to break the screen. The client adopts
  whatever page the server answered with, so the pager cannot highlight a page
  that does not exist.
* **The summary counts the window, never the page.** A win rate that changed as
  you turned pages would be describing ten battles while sitting under a
  control that says thirty days.
* **Rows are dropped before they are counted.** A deckless row is left out of
  the total as well as the page — otherwise "page 4 of 12" renders empty.

### What it deliberately does not reuse

`duel_combos.read_duel_rows` already reads battles for a tag, and this does not
call it. That function scopes to duel-like modes, which is right for the duel
screens and wrong here: "recent battles" with every ladder game silently
missing is not a battle log.

It *does* reuse `duel_zone._deck_view`, and that is not an accident either.
That function runs `arrange_deck`, which decides slot order as well as
evolution and hero art; a screen that draws a deck without it renders the same
cards in a different order with no art, which is exactly how the sequence board
and the series log once ended up disagreeing about one deck.

A native duel row stays **one row** here rather than being split into games.
The Duel Zone is where a duel becomes a series, and doing it in two places is
how the two would eventually disagree.

### One label that looks like a bug and is not

An unrecognised mode whose name contains "duel" is labelled **"Battle"**, not
"Duel". `is_native_duel` is an allowlist of two verified strings (`cw_duel_1v1`,
`duel_1v1_friendly`) that deliberately fails safe, and a row labelled Duel here
that the Duel Zone does not list would be two screens contradicting each other
over one database row. The raw mode string rides along in `mode` for anyone
checking.

### Free, like the search above it

`Recent Battles` joins `FREE_SECTIONS`. This is the rawest thing the database
holds, and a visitor who types a tag and is told the tag buys them nothing has
been shown a paywall, not a product. What costs money is the *reading* of those
rows, which is every other area.

### Two tripwires fired, and both were meant to

Adding this tripped two tests that exist to be tripped, and both were bumped in
the same commit as the change rather than worked around:

* `server/test_api_security.py` pins the number of routes in `_route`, so a new
  endpoint cannot be added without someone consciously reviewing whether it is
  authenticated. 19 → 20, plus a new line in
  `test_every_other_route_requires_a_key` asserting the new one 401s.
* `tests/entitlement.test.ts` pins exactly which areas are free, so an area
  changing tier is a decision made in a commit rather than inherited from
  wherever someone appended a constant.

### The date presets are the app's, not the ones asked for

The request named 10 / 15 / 30 days. The screen ships the ladder every other
analytics screen already uses — **7 / 14 / 30 / 60 / 90 / All / Custom** —
because two screens disagreeing about "the last two weeks" is a worse problem
than the exact numbers, and the custom picker covers any window either way.
Easy to change if the literal numbers are wanted.

### Deploying it took two pushes, not one

Worth recording because it is a property of this project rather than of this
feature: **the Python API does not ship with the frontend.** Vercel builds from
GitHub; `server/` runs on the Contabo VPS at `/opt/royalweb/` behind
`royalweb.service`. A new analytics screen needs both, and the API has to land
*first* — otherwise the area appears in the rail and every request 404s, which
is worse than not shipping it.

Verified against the real database before the frontend went out: 666 battles,
67 pages, 395W/265L/6D, real deck names, evolution art resolved on both sides,
and 401 without a key.

---

## Saving a duel you actually played

The Duel Zone already knows both loadouts of a duel, game by game: the searched
player's decks, and — where the row stores them — the opponent's. That is
exactly the shape of a Versus save. So each duel in the log now carries a
**Save duel** button that writes the whole thing into the builder's library as
one group, blue for the player and red for whoever they were up against.

A three-game duel becomes three decks a side. Four becomes four. Five becomes
five — and five is where it stops, because a duel collection holds
`DUEL_DECK_COUNT` decks and there is nowhere to put a sixth.

| games in the duel | decks written |
|---|---|
| 3 | 3 blue + 3 red = 6 |
| 4 | 4 + 4 = 8 |
| 5 | 5 + 5 = 10 |

The decks are named `G1…Gn` rather than `Deck 1…n`, because in a duel the game
a deck was fielded in is the useful fact about it. Crowns travel too: a game
whose result is known writes `playerCrowns` and `opponentCrowns` onto the two
decks, so the saved group carries the real scoreline rather than a blank one.

### What counts as a deck

Eight cards, every one of them known. That is the same guard `DeckActions`
uses, and it is what keeps native duel rows out without this code having to
know what a native duel row is.

A native row is one stored row holding a whole 16- or 24-card loadout and no
per-game opponent at all. Its cards fail the count, its opponent is `null`, and
it produces no pair — which is right, because the alternative is a deck built
from the first eight cards of a loadout, and that would look entirely plausible
and be wrong.

Those rows keep the button, **disabled**, saying why. A control that silently
vanishes on some rows and not others reads as a bug; one that explains itself
does not. It is the same call the row expansion already makes — a native row
does not open onto an empty opponent panel either.

### "It already exists"

Pressing Save twice must not quietly add a second copy. A group is the same
group when **every deck on both sides is the same deck**, so the check is a
signature: each deck reduced to its sorted card keys, each side reduced to its
sorted list of those, empty padding contributing nothing.

Three consequences, all deliberate:

* **Game order does not matter.** The same duel re-saved is the same set of
  decks whether or not G1 and G2 come out in the same order.
* **Padding does not matter.** Three real decks in a five-slot collection
  compare equal to three real decks, so a slot count cannot change the answer.
* **The sides are not interchangeable.** The same eight decks with blue and red
  swapped is a different duel — two different people — not a re-save of this
  one.

The refusal names the group that already holds it ("Already saved as Duel Deck
2"), because "it already exists" without saying where is a dead end.

### Naming

`Duel Deck n`, where *n* succeeds the highest number already in the library —
counted from the names, not from the library's length. Counting the length
means deleting group 2 of three hands the next save a name that is already
taken. Groups named some other way are ignored; they are not part of this
sequence.

### Where the logic lives

`src/state/duelImport.ts`, pure, with `tests/duelImport.test.ts` (18 checks)
over it. The store action is four lines and does nothing but call it and
prepend the result. Both rules that carry the feature — what a real deck is,
and what the same duel twice is — fail *quietly* when they are wrong, which is
the argument for testing them away from a component.

---

## Two filters and a heading

### The Meta board's card filter moved to the middle

It was in the top-right stack with the report button and the freshness chip,
and its dropdown is 30rem wide and hung from its own left edge — so opening it
at the right-hand end of a panel header sent it straight off the side of the
screen.

The header is now a `1fr auto 1fr` **grid** rather than a flex row. That is
what actually centres the control: with flex and auto margins it could only be
centred in whatever space the title and the stats happened to leave over, which
moves every time the date range or the battle count changes width. Measured at
seven widths from 1440 down to 390, the trigger's centre and the header's
centre agree to the pixel, with no overflow anywhere. Below 68rem the header
becomes two rows and the filter spans underneath, still centred.

`WinConFilter` grew an `align` prop for this — `start` (the default, and still
right on the deck screens where the bar begins at the left margin), `center`,
and `end`. The panel is the only thing it changes.

### The Duel Zone got the same filter

Both of its windows narrow to the cards you pick, on the same control and the
same `deckMatchesFilter` predicate as everywhere else.

**It matches the player's own decks, not the opponent's.** This is that
player's screen: every row is a deck they brought, and the opponent's list is a
panel you open on one of them. Matching their decks answers "which duels did
they bring Hog Rider to". Matching both sides would make a hit mean two
different things in the same list.

The Deck Sequence window matches an opener **or any of its companions**,
because an opener leads to its companions — filtering to a G2 card and hiding
the very sequence that predicts it would be backwards.

One thing had to be withheld while a filter is on: "Showing the N most recent
of M duels". The server capped what it sent, so that M counts a different set
than the one on screen.

### The versus headings

`BLUE PLAYER` and `RED PLAYER` in a saved group took `--player-blue` and
`--player-red`. Those are not a blue and a red — the palette resolves them to
`#e0e0e0` and `#8a8a8a` in dark, `#1a1a1a` and `#8a8a8a` in light. So one
heading read as text and the other as a disabled grey label, which is not a
distinction either of them means. Both are `--text` now: white on dark, black
on light.

The red heading is also right-aligned. It is a block that fills its column, so
left-aligned its text landed against the middle of the card and read as a
caption for the gap between the two sides rather than for the decks under it.
The deck rows in that column are already mirrored the same way — red's crown
sits to the left of its cards where blue's sits to the right.

**Measure the text, not the box.** The heading's rectangle sits at its column's
edge whatever the text inside it does, which is exactly the bug being checked;
a `Range` over the element's contents gives the glyphs.

---

## DEKKIES is DECKKIES

The domain has always been `deckkies.com`. The brand in the shell, the sign-in
card, the PDF footer and cover, the exported filename prefix and the browser
tab title all said DEKKIES. They now say DECKKIES.

**One thing deliberately did not change:** `DEVICE_KEY = 'dekkies-device-id'`
in `accountStore.ts`. That key is how a browser proves it is a device the
account already registered. Renaming it makes every signed-in device look new
and burns a slot against the device limit — the same reasoning that keeps the
`royal-` persistence keys as they are.

---

## Project layout

```
docs/
  UI.md                       the WebGL layer: what ships, what was removed,
                              the five things a browser had to catch, and how
                              a filtered deck list collapses rather than vanishes
  analytics-tunnel-runbook.md the VPS + Caddy transport that is live, and below
                              a SUPERSEDED notice, the Cloudflare tunnel it
                              replaced — kept because what it proved about
                              app.py is still true

supabase/
  001_accounts.sql            profiles, tiers, the three-day trial, device
                              slots and the three admin functions. Idempotent;
                              run it in the SQL editor. Read the column-grant
                              comment before touching the policies

api/                          Vercel functions. Node ESM: NO extensionless
                              relative imports and NO JSON imports, both of
                              which fail only at runtime
  decks.ts                    deck sync, keyed on the Supabase user id from a
                              locally verified JWT. Auth is inlined on purpose
  health.ts                   which integrations this deployment can reach.
                              Names and booleans, never a value
  analytics/opponent-read/    the Coach's same-origin proxy. Rebuilds the
                              response field by field and fails to
                              {enabled:false} however it fails

src/
  three/                      three.js flourishes. Dynamically imported, gated
                              on visibility and prefers-reduced-motion, never
                              in the main bundle. See docs/UI.md
    runtime.ts                lazy loader, motion gate, DPR cap, resize, and
                              `readToken` — the palette lives in index.css, so
                              a shader resolves a token rather than carrying hex
    Fireflies.tsx             ambient motes; `hue` takes a section's identity
                              colour and eases into it without remounting
    DeckFx.tsx                the deck column's canvas: slot aura + placement
                              burst + completion sweep, three meshes in one
                              context. Read the sweep note before touching it
    DeckOrbit.tsx             a ring of card outlines behind an empty invitation
    LiquidMetal.tsx           the circular icon controls: a chromatic rim and a
                              press ripple. RAW WebGL2, one canvas for all of
                              them, and no frames at all until something is hot
  styles/cta.module.css       the shared primary-button treatment: a masked
                              gradient edge and a hover sheen, both mixed from
                              --on-solid so it names no colour. 12 buttons
                              `composes` it and keep everything else they had
  state/loadTiming.ts         how long each slow screen actually takes on this
                              browser — a median of the last five, seeded from
                              the measured figures. What paces the loader
  state/deckFx.ts             the fire-and-forget event channel for the above.
                              A plain emitter, NOT zustand — see the note in it
  state/supabase.ts           the one client, the tier derivation, and which
                              sections are free. Null when unconfigured, so a
                              checkout without Supabase still runs
  state/accountStore.ts       session, profile, and the device claim. A failed
                              heartbeat must never sign anyone out
  state/gate.ts               who may open what. `anon` and `free` are the same
  state/adminStore.ts         the console's three sources, none allowed to sink
                              the others
  components/Analytics/RecentBattles.tsx
                              the raw battle log. The only analytics screen
                              that lists rather than aggregates
  state/duelImport.ts         a played duel -> a Versus group. What counts as a
                              real deck, and what counts as the same set twice.
                              Pure, so both can be tested without a store
  utils/format.ts             ago / until / bytes. NO imports, deliberately —
                              importing the store to test a date formatter
                              constructs a Supabase client
  App.tsx                     hash routing -> one Dashboard shell
  index.css                   ALL colour AND motion: neutral ladder, 5 hues in
                              two ramps (ink + solid), the three intensity
                              levels, semantic roles, focus ring, the glow
                              strengths, the duration/easing tokens, and the
                              reduced-motion switch. The single source of truth
                              — no component defines a colour of its own.
  hooks/
    useReveal.ts              one-shot scroll reveal per section band
  components/
  utils/deckPreview.ts        the icon a deck slot SHOWS — evolution and hero
                              art for slots 0 and 1. One implementation; three
                              callers, one of which used to get it wrong
    Filmstrip/                a browsable 3D strip of cards. Items' own controls
                              render UNDER it, for the centred item only — a
                              button may not contain buttons
    Auth/                     sign in, sign up, the three-step onboarding form,
                              and the GateCard a locked section renders
    Admin/AdminConsole.tsx    #/admin. Refuses non-admins itself; the database
                              refuses them again
    WinConFilter/FilterSlot.tsx  a deck row that COLLAPSES when filtered out.
                              The height is measured; see docs/UI.md
    Theme/ThemeToggle.tsx     the light/dark switch, shared by all five screens
                              that used to own a copy. One size knob; the rest
                              of the geometry derives from it
    Dashboard/                top bar, sidebar, landing screen, content panel
      Dashboard.tsx           the shell; `landing` decides whether a rail exists
      TopDock.tsx             the top nav as a proximity dock — markup only
      topDockController.ts    its springs. Plain DOM, and the rAF STOPS when
                              they settle; see the note at the top of it
      ClosingBand.tsx         the page ending — three checkable claims plus a
                              histogram counted from CARDS at render time
    Analytics/
      ReadingState.tsx        the one loading state all 12 slow reads share
      UplinkLoader.tsx        the progress rig inside it. Paced from MEASURED
                              load times, never scripted, never reaches 100%
      PlayerAnalysis.tsx      #/player/<tag>
      MetaDecks.tsx           #/player/<tag>/meta — the global leaderboard
      DuelAnalysis.tsx        #/player/<tag>/duels
      DuelZone.tsx            #/player/<tag>/duelzone — series log + sequence
      PlayerCards.tsx         #/player/<tag>/cards — every card, filtered
      DeckCounter.tsx         #/player/<tag>/counter — three matchup tabs
      CoachAssist.tsx         #/player/<tag>/coach — the two duel-coach windows
      DeckLab.tsx             home Deck Analysis — paste a deck, measure it
      CounterLab.tsx          home Deck Counter — three free rows, then the gate
      GlobalCards.tsx         home Cards — every card, across the player base
      ProLock.tsx             the Royal Pro gate: the real thing, behind glass
      DuelInsights.tsx        the interpretation section under Duel Analysis —
                              reads the SERIES log, not the pair board above it
      duelInsightRules.ts     its pure calculations + evidence floors, no UI
      LivePlayer.tsx          a never-tracked tag, from the live CR battlelog
      SeasonMenu.tsx          the season control, as a glass dropdown
      CardArt.tsx             one card icon, evolution/hero art when fielded so
      TrendChart.tsx          inline SVG multi-series chart + crosshair
      playerData.ts           shapes, range presets, useDateWindow hook
    DeckActions/              copy the deck link / open it in Clash Royale, on
                              every screen that draws a deck. Renders nothing
                              unless handed exactly 8 known cards, which is what
                              keeps it off duel loadouts and partial card lists
    DeckWorkspace/            the two-column shell all three deck screens share
    DuelDeckBuilder/          the 5-deck duel builder
    DecksHome/                unlimited single decks
    CounterPalette/           archetype folders
    CardPicker/               the card library column: filters, tabs, grid
  utils/
    analyticsReport.ts        the model every screen exports itself as
    analyticsPdf.ts           draws one, in the palette read off the live page
    reportAdapters.ts         one adapter per screen, pure, no layout
  state/
    store.ts                  builder store (zustand + persist, v9)
    deckUtils.ts              pure deck logic
    analyticsClient.ts        the ONLY thing that knows the API's shape
  data/cards.json             122 cards, vendored from RoyaleAPI/cr-api-data
  data/cardMeta.json          can_evolve / can_be_hero / is_champion / is_win_condition

server/
  app.py                      stdlib HTTP API
  clash_data.py               read-only DB access, tier resolution, CR API
  duel_combos.py              the Pair Board port; owns the shared duel read
  duel_zone.py                the series log and the deck-sequence port
  player_cards.py             per-card use/win rates for one player
  deck_counter.py             the symmetrised archetype matchup matrix
  meta.py                     global meta rollup + the global card board
  coach.py                    duel prediction + the next-deck recommendation
  live_player.py              the live CR battlelog, analysed for a new tag
  tracking.py                 the tag-enrolment queue — the ONLY file this API
                              writes, and it is ours, not the bot's
  test_duel_combos.py         39 checks, no DB
  test_meta.py                33 checks, no DB
  test_card_art.py            110 checks, no DB
  test_duel_zone.py           88 checks, no DB
  test_player_cards.py        60 checks, no DB
  test_deck_counter.py        58 checks, no DB
  test_coach.py               69 checks, no DB
  test_live_player.py         23 checks, no DB and no network
  README.md                   API and storage detail

  ml/evaluation/              the phase harnesses. The ones from this round:
    phase20b.py               duel legality as a mechanism -- WITHDRAWN, its
                              central measurement was a tautology
    phase20c.py               ex-ante legality; exposed 20B rather than
                              confirming it
    phase20d.py               the domain correction. `practice` is defined
                              here, and a census proves no native duel row
                              can enter it
    phase21a.py               spell-conditioned feasibility. Reads
                              `battle_raw.rounds`, the only module that does
    phase22-final-spec.md     THE PRODUCTION CONTRACT. Read this before
                              changing anything in ml/production/
  ml/results/                 gitignored. Phase reports, the shadow log, and
    cohorts/tags*.json        <- NOT derived. The ONLY thing that can
                              reconcile the salted shadow log. 66 KB, and
                              currently unbacked; see the plan below
    phase24b-hosting-plan.md  what deploying actually requires

  test_ml_20b/20c/20d/21a.py  127 checks over the four closed branches
  test_ml_22_final.py         66 checks. The FROZEN CONTRACT, not the
                              implementation -- a failure here means the
                              contract moved

scripts/
  build-pdf-font.py           KidsWord.otf (CFF) -> a TrueType build jsPDF can
                              actually embed. Run once; output is committed.
  build-hero-art.py           masters in assets/ -> what public/ serves:
                              keys the character to alpha, re-encodes to WebP
                              (4.2 MB of PNG -> 166 kB). Idempotent.

assets/                       SOURCE art (masters, never served)
  background/                 light_background.png, dark_background.png,
                              "king image.jpg" — the hero backdrop pair and
                              the character, all three 1.5 MB+ originals
  fonts/                      display faces, incl. the unused trials

public/assets/                what the app actually loads
  background/                 light_background.webp, dark_background.webp,
                              king.webp (alpha) — built by the script above
  cards/ evolutions/ heroes/  card art, plain sRGB, no ICC profile
  fonts/KidsWord.otf          the display face
```

**`analyticsClient.ts` is the seam, and the claim was tested.** It only ever
calls `/api/analytics/*`, so moving the service to a VPS should be a proxy or
base-URL change rather than a code change — and when the service actually moved,
it was: `VITE_ANALYTICS_BASE` and the Vite proxy rewrite, with no screen touched.
The one deliberate exception stayed the exception: `fetchOpponentRead` ignores
the base because it must go through the Vercel proxy that holds the key.

`useDateWindow` is shared by every analytics screen on purpose — six of them
now. Two copies drift, which is exactly how the season selector once shipped
bound to state nobody read. The same rule sent `read_duel_rows` and
`clash_data.tier_windows` to one place each: the pair board and the Duel Zone
must agree about which duels exist, and three readers must agree about how the
hot and archive tiers split a window.

### Known, measured, and not yet fixed

Two light-mode contrast failures found by the screen-wide sweep. Both predate
the screens they sit on and neither is inside a feature that was being changed,
so they are recorded rather than quietly restyled:

| where | measured | what it is |
|---|---:|---|
| Cards board, the rate figures | **3.34–4.16:1** at 10.1px, 96 elements | `--c-use` (#2a78d6) on `--surface-nested` |
| ~~Duel Zone, the pane blurb~~ | ~~4.19:1~~ | **closed.** It was `--text-muted` on a violet fill; that token is pure white / pure black now — see [Every neutral font is at full contrast now](#every-neutral-font-is-at-full-contrast-now) |

The remaining one needs 4.5:1. The fix is a token, not a layout — but it is a
token shared across screens, so it is a palette decision rather than a bug fix,
and it belongs to whoever owns the palette. It is a **coloured** figure, which
is why the full-contrast text pass did not touch it. Dark mode is clean on all
11 screens.

**The deck actions have not had a browser pass.** `npx tsc -b`, all 179 vitest
tests and `npm run build` are green, and the risky shapes were checked by
reading rather than running: no strip is a grid (so the chips cannot shift a
column), every strip's card sizing is scoped to `img` / `.cardImg` / `.rowCard`
(so the chips cannot be handed a `flex: 1 1 0` share), and the one nested-button
case was found and restructured. None of that is a substitute for the
convention — a green typecheck says nothing about whether a page renders, and
the Duel Zone's `.gameRow` restructure is the piece most worth looking at. The
verification also needs `server/app.py` up against a real database — on the VPS
now, where a cold meta rollup is far cheaper than it was on the spinning volume
at home.

### Open on the accounts and hosting work

Recorded as debts rather than plans. Each one is a thing the site does not do
yet, or does in a way that is fine now and will not be later.

| item | state |
|---|---|
| **Email confirmation** | **off.** Sign-up works without an SMTP provider, which is what let this ship — and it means an address is never proved. Must go back on before real users |
| **Google sign-in** | built, hidden. The PKCE flow and hash-callback handling are in place; the button appears when the provider is enabled in Supabase |
| **Admin-created accounts** | not built. Needs `SUPABASE_SERVICE_ROLE_KEY` held server-side. An invite link is the honest shape, not a password |
| **The Coach proxy** | still authenticates with the retired `sha256(username:password)` scheme. It is the last consumer of `authStore`, which cannot be deleted until it migrates |
| **`OIE_ALLOWLIST`** | unset, so the Coach's opponent read degrades to `{enabled:false}` for everyone. Designed behaviour, but the engine half is dark in production |
| **Staging** | there is none. `main` deploys to production, and every fix in this pass was verified against production after the fact |
| **A maintenance screen** | not built. Nothing to show while a deploy is mid-flight |
| **Enrolment latency** | a searched tag waits up to **2 hours** to be collected, because `drain_tag_requests()` only runs inside the 2-hourly poll. The fix — a 5-minute loop that drains and immediately `sync_player_safe()`s what it enrolled — is designed and **not applied**: it needs an edit to `bot.py`, a different project and a live process. `bot.py.bak-20260826` exists; the file is unchanged and running |
| **Thin tags read as broken** | a new player with a handful of battles clears no evidence floor, so Duel Analysis and Deck Counter are correctly empty and *look* faulty. The Deck Counter now says why in its own numbers; Duel Analysis does not yet |
| **The site cannot enforce analytics tiers** | `api.deckkies.com` answers anyone. Making the gate real means routing those calls through a Vercel function that checks the tier, as the Coach's opponent read already does |
| **Signed-in mobile** | unverified. The mobile pass was run signed out, so Cards, Duel Analysis and Duel Zone showed the gate card and their phone layouts have never actually been looked at |
| **No backup of the VPS database** | **the largest single exposure.** No backup directory, no cron, no timer; `deploy/backup_db.py` sits at `/opt/clashbot/deploy/` unscheduled. Cutover checklist item 11 is unmet, and the migration doc says outright there is "no second copy of the active database anywhere" |
| **H:** | unplugged 2026-08-26 with contents intact, and still the only rollback. Frozen at that date, so its value decays daily — which is the argument for the row above. Must not be wiped: `archive.db` holds 1 May – 1 Jun, a month in no other copy |
| **Deploying `server/`** | nothing enforces that `src/data/` goes with it. That omission emptied three screens silently; it is now merely *visible* (a console tile), not prevented |
| **The admin console** | no browser pass. It needs an admin session, and minting one means promoting an account in the live database — so its three layout bugs were all found by a person looking at the screen |
| **Test accounts** | **cleaned up.** ~30 `dekkies.*@gmail.com` accounts from verification runs were deleted by email prefix; the `on delete cascade` took their profiles and device rows with them. The habit that created them is the thing to fix, not the rows |

**The admin console has not had a Playwright pass.** It cannot get one the usual
way: the screen needs an admin session, and creating a throwaway admin means
promoting an account in the live database. The three layout bugs it shipped with
were all found by a person looking at the screen, which is the honest summary of
its verification status — and a fair argument that this is the screen that most
needs a real test account rather than the one that least does.

**Trial length is not configurable.** Three days is `interval '3 days'` inside
`handle_new_user()`. Changing it means a migration, and changing it does not
affect anyone already signed up.
---

## Deliberately not done

Recorded so they are not re-litigated as oversights:

- **Spell-conditioned prediction.** Phase 21A, on the largest population this
  project has ever measured: 41,980 duel transitions across 20,702 players, on
  real duel data rather than practice. Paired top-1 delta between the full arm
  and the no-spells arm is **0.000 [-0.001, 0.001]**, and history-only is
  marginally the BEST arm. Restricting to steps with a real candidate pool does
  not rescue it at any pool size. A weak association exists (earthquake →
  goblin-barrel at 1.51x) and moves entropy by 0.05 bits out of 4.16, which is
  not enough to rank with. Do not reopen this without a different question.

- **Ranking archetypes inside a legal duel pool.** Measured against the right
  baseline — uniform choice among the SAME legal candidates — the ranker adds
  1.7 to 4.9 points at small pools and goes **negative at pool >=5**, which is
  exactly where ranking would have to work. Most of the apparent accuracy was
  the legality filter. Any future duel work should beat random-in-pool before
  it claims anything.

- **Percentage-based rollout.** Written when the site had 20 fixed test
  accounts, where a percentage is theatre. Real signup exists now, so a
  percentage would at least *mean* something — and it is still not worth it,
  because an allowlist (`OIE_ALLOWLIST`) answers "who has this" exactly rather
  than statistically, and that is the question being asked at this size.

- ~~**Replicating the database to a VPS.**~~ **Superseded, and kept because the
  reasoning still holds.** 69.4 GB growing by ~190,000 battles/day, and SQLite
  has no native replication — all true, and nothing about the move refutes it.
  What changed is that the **bot moved too**, so there is no replica: one
  database, on the VPS, written by the bot and read `mode=ro` beside it. That is
  the same "run the service beside the data" this entry recommended, with the
  data relocated. See [The move off the home machine](#the-move-off-the-home-machine).

- **Storing a password an admin can read.** The brief asked for admin-created
  usernames and passwords. Handing someone a password means holding it somewhere
  recoverable, which is the property you spend real effort avoiding everywhere
  else. People sign themselves up; an admin promotes them. The nearest honest
  version — an invite that mints a one-time link — needs a service-role key held
  server-side and is open, not refused.

- **Counting devices to enforce the device limit.** Counting races: two
  simultaneous logins both read "one device" and both insert. `primary key
  (user_id, kind)` makes the second one *replace* the first instead, so the
  limit is a constraint rather than a check.

- **A scheduled job to end trials.** `trial_ends_at` is read on every request and
  the tier is derived from it, so a trial expires on time with nothing running.
  A job would add a window in which it has not fired yet and someone still has
  Pro, in exchange for nothing.

- **Fingerprinting a device.** The device id is a random UUID in `localStorage`,
  so clearing site data resets it and the person signs in again. A fingerprint
  would be harder to shake off, which is the point of one, and that is not a
  trade to make on a deck site.

- **Distinguishing upstream failures in the Coach proxy.** Every failure returns
  `{enabled: false, read: null}` with HTTP 200. Telling a caller *why* publishes
  the private service's state to anyone who probes it.

- **Displaying any band accuracy percentage.** Competitive `high` claims 90.5%
  and measured 69.1%; practice does not order at all. The numbers survive as
  internal diagnostics in `policy.BAND_ACCURACY` and
  `calibration.expected_accuracy()`, and neither may reach a response body or a
  screen. Confidence ships as a word.

- **A confidence band on the practice domain.** Its ordering fails on 11,152
  historical steps with full support in all three bands: player-macro high
  65.4% < medium 69.7% > low 53.5%. A band that does not rank cannot carry a
  label, so `policy.BAND_SUPPORTED` withholds it — and the alternatives with
  it, because the 2/1/0 cap is justified by the bands meaning something.

- **Promoting `band-calibration-v2-candidate.json`.** It exists on disk and a
  test asserts it stays inactive. Fitting a calibration map to the reconciled
  sample would bake the timing of a collection run into shipped calibration.
  Competitive is now at ~360 reconciled players and could support a proper
  Platt/isotonic fit; practice cannot, and must not be pooled with it.

- **Native duel prediction.** No longer blocked — `battle_raw.rounds` holds
  ordered per-game decks and per-game crowns for both sides across ~50,000
  payloads. But it needs a loadout representation rather than a deck one, so it
  is a separate research programme and not a fix to this one.

- **Exact next-deck prediction.** Closed by Phases 17B and 18 on ceilings, not
  model quality: a switched-to deck is one the player has played only 50%/38% of
  the time, and a genuinely new one can be *built* from their own cards only
  52%/62% of the time, at 10^8-10^10 candidates. More data raises the search
  space faster than the coverage.
- **A bigger model for the OIE.** Pointwise ranking, pairwise ranking and a
  hybrid were each measured and each lost to a heuristic first pick. Boosting and
  neural rankers were explicitly not built, because the failure was the objective
  and the candidate set, not nonlinearity.
- **The 122-card knowledge graph, Markov chains, elixir and cycle models.** An
  eventual architecture, not the next experiment. Nothing measured justifies them
  yet.
- **`CLASH_OIE=on` by default.** It stays `off` until the 19C checkpoint
  validates High > Medium > Low against real outcomes.
- **Printing every tab on every screen.** Only Duel Analysis prints all of its
  tabs, because only there are they different views of one payload. Cards would
  repeat the same list eight times; Deck Counter would emit empty forms.

- **The Coach does not model counter-sniping.** "They just showed Hog, so they
  will bring the anti-Hog deck" is the obvious feature and the bot measured it
  on 3,569 leak-free trials: top-1 accuracy 8.3% → 2.7%, three times worse. The
  deck a player actually brings scores 0.4856 against the opponent's last deck
  versus 0.4961 for the average deck they could have brought. Recency weighting
  and per-opponent tendency lost to plain usage the same way. The read narrates
  evidence and invents no tendency.
- **Chart palettes are not merged into the UI accent system.** They are already
  CVD-validated; re-encoding them for visual consistency would trade a real
  property for a cosmetic one. See the colour section.
- **Rarity tokens** (`--rarity-common` … `--rarity-champion`) stay greyscale.
  Clash Royale has canonical rarity colours and adopting them is a reasonable
  follow-up, but that is a call about game fidelity, not UI colour.
- **Versus-mode side colours** (`--player-blue` / `--player-red`) stay neutral
  greys separated by lightness. Making the red side actually red would collide
  with red meaning "negative", which a duel side is not.
- ~~**Motion stays off.**~~ **No longer true, and kept as a record of when it
  changed.** The blanket `animation/transition: none` switch in `index.css`
  now lives inside `@media (prefers-reduced-motion: reduce)`. Motion is on and
  scoped: one-shot only, transform and opacity, on the `--dur-1..4` tokens.
  There is still no `infinite` anywhere — that is what the ban was actually
  for, since the old glow loops animated `box-shadow` and `filter`.
- **`--accent` stays neutral.** It is still correct for high-contrast neutral
  fills. Components opt into `--accent-select` / `--accent-action` / etc. rather
  than every `--accent` being globally swapped for a hue.
- **The duel card-reuse threshold stays at one shared card.** Loosening it buys
  a few points of coverage by inventing Bo5s — 1.1% of series over three games
  becomes 25.3% at six. The table is in the Duel Zone section.
- **A native duel's result is not attributed to its deck pairs.** Those rows
  hold a 16- or 24-card loadout and the *series* outcome, so splitting them into
  decks would manufacture four to nine pair results from one real one. The
  8-card duel rows — 8,549 of 10,818 in a recent sample — are counted in full.
- **Deck B's record is not a rung on the matchup ladder.** It was, briefly. The
  ladder widens deck A instead (exact → 7 cards → 6 cards → archetype), which
  covers strictly more cases and keeps one story: *this deck's evidence,
  widening*. Consulting the other deck as well cost a second profile and made
  the label "measured on" ambiguous about whose deck it meant.
- **`_representatives` does not use the meta board's rankings.** The board
  excludes duel and friendly modes by design; the Deck Counter's numbers do not.
  Representatives come from the matchup table so both halves of a row describe
  the same population. The board is still the source of *art*.
- **The light level-2 fill stays at 14%.** Raising it to 17% would match dark's
  selected-state strength on average, but it drops pink to 4.15:1 and green to
  4.30:1, under the 4.5 floor. Re-grounding the tint fixed it properly instead.
- **The duel series win/loss tints keep the plain wash.** Measured at 3.1 dE
  dark against 3.3 light, they were already balanced; re-grounding them against
  the panel pushed the green to 1.48x the light one.
- **No synergy score**, and no lift metric on the pair board. Measured against a
  permutation null and indistinguishable from chance — see the duel section.
- **No exact deck-vs-deck record.** Only 0.59% of the 1.96M stored pairings
  have 8 games, so a per-deck head-to-head would be invented for almost every
  input. Matchups stay at archetype level, where all 289 cells clear 50 games.
- **No "average match time" tile**, though the design has one: no duration is
  stored in `battles`, in `pair_matchup_agg`, or in the raw payload.
- **A counter list is not padded to five rows.** Ranking the field and taking
  the top five returns a "counter" at 48.3%, which is the opposite of one. Only
  archetypes over 50% are listed, and the screen says how many were weighed.
- **No Grid/List/Compact toggle on the Cards board.** The reference design has
  one; the dense grid is the view the data wants, and a second layout is a
  second thing to keep correct for no question it answers better.

---

Both background rollups persist beside the code — `server/.meta_snapshot.json`
and `server/.counter_snapshot.json` — so a restart serves the previous numbers
immediately instead of a blank screen for a minute. Both are gitignored: they
are derived data, and they are the only files the API writes.

---

This is unofficial fan content, not affiliated with or endorsed by Supercell.
Card data is a vendored snapshot of
[RoyaleAPI/cr-api-data](https://github.com/RoyaleAPI/cr-api-data), refreshable
with `npm run update:cards`; card art is self-hosted in `public/assets/`, not
hotlinked.

Card art must be **plain sRGB** — embedded lcms iCCP profiles made colours look
washed out on wide-gamut phones, so the existing PNGs were normalised (profile
stripped, pixels unchanged). Strip the ICC profile from any new art.

---
