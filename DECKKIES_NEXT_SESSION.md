# NEXT SESSION — Coach Roster: the player dashboard

Everything below is live and verified unless it says otherwise. `CLAUDE.md`
carries the full reasoning; this is the short version plus what to do next.

## Where things stand

| | |
|---|---|
| Coach tabs | **6**: Overview · Against the field · Arsenal · Opponent · Battles · Decks played |
| Deleted | Match plans, Results, Opponents ledger (8 files, 45 tests) |
| Merged | Scout + "Against an opponent" → one `opponent` tab, one tag, scout first |
| Charts | Gradient bars/columns/ring, filled area under the win-rate line, gated glow |
| Migration 006 | **APPLIED, verified 8/8.** `linked_user_id` + 4 functions. **No UI reads it.** |
| Migration 007 | **WRITTEN, NOT APPLIED.** `is_coach` + `admin_set_coach` + `admin_list_users` v2 |
| Tests | 931 vitest, 45 Python (coach_daily), route count 24 |

## Do these three things, in order

### 1. Run migration 007

`supabase/007_coach_flag.sql` in the SQL editor at
`https://supabase.com/dashboard/project/idmwbxnldtzkxspxwsxn/sql/new`.

Until it runs, the console's Coach dropdown is inert and only admins reach the
roster — which is today's behaviour, so nothing is broken by the delay.

**Verify after:** sign in as the account holder and call
`admin_list_users` over REST; every row should carry `is_coach: false`.
`scratchpad/check006.py` from the last session is the pattern — it signs in
with `DK_EMAIL`/`DK_PASS` and calls RPCs directly, which exercises the grant
and the definer path in one go.

### 2. The coach's "link account" control

`006` gives you `coach_link_player(p_player_id uuid, p_email text)` and
`coach_unlink_player(p_player_id uuid)`. Nothing calls them yet.

Put it on the player page (`PlayerOverview.tsx`'s `CoachControls` is the
obvious home, beside Edit / Archive / Remove). Type an email → link → the row
shows linked / not linked. Errors are already worded by the function: *"that
player is not on your roster"*, *"no account has signed up with that email
yet"* — relay them, do not invent your own.

The roster rows currently read: Kuru `#QUV0Q9RLU`, NannoS `#PL0P9VP28`,
Pulsar `#9GPCRCJLP`, RIZAL `#JQ08QP9G`, T3kT0n1k `#2JUPU0LPV`,
CAPTAIN FROZE `#292L2PJJ9` — **none linked**.

### 3. The player dashboard

A signed-in player whose account is linked opens their own dashboard.

- Read `my_coach_players()` → they are on a roster (and whose).
- Read `my_coach_decks()` → the decks their coach approved.
- Everything else is the public analytics API, which already answers for any
  tag: `PlayerDashboard.tsx` and `TodayTab.tsx` are the shapes to reuse.
- **No Scout.** That is a separate grant, deliberately deferred.
- **A coach may be one of their own players**: they link their own email, keep
  the coach panel, and their dashboard is a tab on it.

## Rules this work must not break

- **`my_coach_players()` does not return `notes`.** Coach notes are written
  about a player expecting they are not reading them. It is not a UI choice a
  screen may reverse.
- **`is_coach` / `linked_user_id` are read as `=== true` / non-null, never
  truthy-checked.** Both are absent on an older database and **nobody may gain
  access by a column failing to arrive.**
- **Never mount `CardLibrary` / `CardGrid` / `useFilteredCards` outside the
  builder** — they write `useBuilderStore` and would mutate the account's real
  saved decks.
- **Every battle figure comes from `coach_intel`.** `/api/analytics/counter/`
  has NO mode filter (872 battles where coach_intel reports 710) and
  `/cards/` is only safe at `mode=ranked`.
- The roster screen reads no analytics API except behind a button.
- No score, no readiness, no grade — counts, fractions and measured rates.

## Traps that cost time last session

- **Assert declared SQL types against the real table, not just the grammar.**
  `pglast` parsed a function clean that Postgres rejected: `cards` is `text[]`
  not jsonb, `comfort` is `smallint` not integer.
- **The Supabase SQL editor runs a whole script in ONE transaction** — a
  failure at statement 9 rolls back statement 1.
- **Put the test suite's own exit code in the chain.** A `&&` behind a `grep`
  reports the grep's result; a red suite scrolled past and got committed.
- **Write commit messages to a file and use `git commit -F`.** Backticks in a
  `-m "..."` argument are shell-expanded and leave holes in the message.
- **Chrome serialises `color-mix` as `color(srgb r g b / a)`, not `rgba(...)`.**
  Parse the alpha.
- **Set the theme BEFORE navigating**, then assert `data-theme` — otherwise a
  probe measures the previous theme and reports confidently wrong colours.
- **A hash-only `page.goto` is a fragment navigation**: set the hash, then
  `reload()`, or every selector reads zero and reports zeros as passes.
- **`innerText` returns nothing on SVG.** Use `textContent`.
- **`[class*=deckItem]` also matches `deckItemHead`** — counts double.
- Verifying signed-in claims a device slot: seed
  `localStorage['dekkies-device-kind'] = 'mobile'` so the desktop session
  survives.

## Known-open, not blocking

- **The "notes are hidden" check passed vacuously** — no rows existed, so no
  columns to inspect. Genuinely proven only once somebody is linked.
- **Meta trends are stored and unread.** `?movement=` answers from
  2026-09-30ish (day 1 was 2026-09-23); nothing calls it yet. Wiring it into
  `coach_daily.field_threats()` is the obvious next engine change.
- **Progress over time is not stored.** The dashboard reads *now*, never
  *then*. Needs a nightly `coach_player_snapshot`.
- Web push (13b) untouched — needs a service worker this site deliberately
  lacks.
