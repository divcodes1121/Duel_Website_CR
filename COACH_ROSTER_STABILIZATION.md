# Coach Roster — stabilization baseline

**Status: phases 1–8 are live in production as of 2026-09-20.** This document
freezes what the system is and what must stay true about it while it is
observed in real use.

**No new feature work is to be started from this document.** It is a baseline
for the eight-phase system as shipped, not a plan. There is no phase 9 here,
and nothing below should be read as proposing one.

**Test baseline:** 153 of the project's 677 vitest checks are the coaching
layer's, across eight files (`tests/coach*.test.ts`) — roster 21, insights 9,
arsenal 31, scout 19, assist 14, plans 22, results 20, overview 17. All green
at `e0b4a7c`. Server-side, the analytics route-count tripwire in
`server/test_api_security.py` stands at **23**; the Coach Roster added exactly
one route (phase 2's intel endpoint) and phases 3–8 added none.

| Phase | What it answers | Route | Live as |
|---|---|---|---|
| 1 | Who do I coach? | `#/admin/coach/<TAG>/overview` | `c3e75f8` |
| 2 | What do they actually do? | `.../battles`, `/decks`, `/cards`, `/opponents` | `ed04b98` |
| 3 | What are they approved to play? | `.../arsenal` | `a1ac2e0` |
| 4 | What does the opponent play? | `.../scout/<OPPONENT>` | `7f54bb2` |
| 5 | What should they bring? | `.../assist/<OPPONENT>` | `a19eea9` |
| 6 | The decision, frozen with its reasoning | `.../plans` | `7cca499` |
| 7 | What happened? | `.../results` | `2ba3f68` |
| 8 | Where is the work, across the roster? | `#/admin/coach` (bare) | `e0b4a7c` |

---

## 1. The workflow, end to end

**roster → player intelligence → arsenal → opponent scout → what to play →
match plan → results → roster overview.**

1. **Roster** (`state/coachRoster.ts`, `coachRosterStore.ts`) — a personal list
   of coached players, each a Clash Royale tag plus a name the coach chose.
   Active and archived; a player with history cannot be deleted out from under
   it (`ON DELETE RESTRICT`), only archived.
2. **Player intelligence** (`server/coach_intel.py`, `state/coachInsights.ts`,
   `IntelCharts.tsx`) — their battles, decks played, cards and opponents, over
   a 7/30/90/all window. **Own-deck 1v1 only**, routed by
   `server/battle_modes.py` before the deck pipeline sees a row; 2v2 and
   event modes are counted and named, never folded in. Insights are
   evidence-floored.
3. **Arsenal** (`state/coachArsenal.ts`, `ArsenalTab.tsx`, `DeckEditorDialog.tsx`)
   — the decks the coach has approved for that player, ranked in the coach's
   own order (`sort_order`, migration 005). Built by hand, pasted as a deck
   link, or taken from the player's own battles. Duplicates refused by deck
   key before a round trip.
4. **Opponent scout** (`state/coachScout.ts`, `ScoutTab.tsx`) — what the
   opponent plays, on one of three footings that are never mixed: `stored`
   (collected history), `live` (their ~25-battle log), `none` (a real answer).
   Head-to-head comes from the **roster player's own** intel, never the
   opponent's.
5. **What to play** (`state/coachAssist.ts`, `AssistTab.tsx`) — the existing
   Team Analysis engine's ranking for that pairing, joined to the arsenal.
   Suggested+approved / suggested-not-approved / approved-not-suggested, with
   the last split into `scored_lower` and `never_played`.
6. **Match plan** (`state/coachPlans.ts`, `PlansTab.tsx`) — primary / backup /
   alternative against one opponent, with **every candidate and the engine
   that produced the ranking frozen alongside** (`recommendations`, `engine`).
   One deck per slot; confirming needs only a primary.
7. **Results** (`state/coachResults.ts`, `ResultsTab.tsx`) — what was actually
   played, with the slot **inferred from the cards** (`inferSlot`), not from
   the coach's memory. Off-plan is announced before saving and given a reason.
8. **Roster overview** (`state/coachOverview.ts`, `RosterOverview.tsx`) — the
   bare route: every player's preparation at a glance, as counts and flags.

---

## 2. Production contracts that must not regress

Each of these is a property the system has today, where it is enforced, and
what its failure would look like.

### 2.1 Admin-only access

- **Client:** `CoachRoster.tsx` refuses anything but `access === 'admin'`, and
  waits for the account to resolve first (`ready && (!userId || profile)`) so
  an admin never sees "Not your roster" for a beat.
- **Database:** every policy in `supabase/004_coach_roster.sql` requires
  `effective_tier(auth.uid()) = 'admin'` **and** `coach_id = auth.uid()`.
  `anon` has no grant at all. Verified live: an anonymous caller on Supabase
  REST is refused `42501` on all five tables.
- **Server:** `server/admin_auth.py` is a second gate on
  `/api/analytics/admin/coach/intel/<tag>` — the browser's Supabase access
  token in `X-Coach-Token`, checked against `rpc/coach_is_admin`. It fails
  closed (401/403/503) and caches 60 s by token hash. Caddy injects
  `X-Analytics-Key` on every path, so that key protects nothing from a
  browser; this module is the protection.
- **Known scope of that gate, stated precisely:** it is admin-gated but **not
  roster-scoped** — an authenticated admin may request intel for any tag, not
  only tags on their own roster. That is deliberate (scouting an arbitrary
  opponent is the point of phase 4) and is recorded here so it is not mistaken
  for a hole later.
- The wider `/api/analytics` surface is **not** per-user authenticated; tier
  gating on the public screens is a UI affordance. The coaching *data* is
  protected by RLS, which is real access control.

### 2.2 Coaching tables stay isolated from player-owned data

Two separate senses, both load-bearing:

- **Storage.** The five coaching tables (`coach_players`, `coach_decks`,
  `coach_match_plans`, `coach_plan_decks`, `coach_match_results`) are the
  coach's own rows in Supabase. They do not touch the bot's SQLite database,
  which this project only ever opens read-only, and they are not the account's
  saved decks.
- **UI.** No coaching component may mount `CardLibrary`, `CardGrid`,
  `useFilteredCards` or `CardFilterTabs`: those read **and write**
  `useBuilderStore` (`selectedSlot`, `sets`, `assignCard`), so a coaching deck
  editor built on them would mutate the account's real saved duel decks, which
  sync across devices. `DeckEditorDialog.tsx` composes `CardTile` plus the
  pure `filterCards` / `sortCards` with local state instead. The only mentions
  of those components anywhere under `components/Admin/CoachRoster/` are in the
  comment explaining why they are not used. **Keep it that way.**
- Children reference parents by **composite** `(id, coach_id)` foreign keys,
  because an FK check runs without RLS and could otherwise attach a deck to
  another coach's player.

### 2.3 The roster overview counts; it never ranks

`sortOverview()` orders active players first and then alphabetically —
**roster order, the same as the rail**, so the two surfaces can never disagree
about where somebody is. Attention is shown by flags on a row, never by moving
the row. A test asserts a fully-flagged player does not rise above an
unflagged one.

### 2.4 No readiness score, and no judgment of a player

There is no composite score anywhere in `coachOverview.ts`, and there must not
be: a score would invite comparing players who have different amounts of
stored history, which is the one comparison this data cannot support.

Every flag is a **fact with an action attached** (`FLAG_LABEL` +
`FLAG_ACTION`); a flag with no action is a nag. A test bans the words *weak,
bad, poor, lazy, behind, failing* from both maps. `not_collected` is
**withheld** when the tracked set is unknown — absence of knowledge is not
evidence.

> **Presentation changed 2026-09-20** (the shared dashboard layout). The
> roster overview now leads with a ring, a metric grid, two charts and three
> insight cards. **Every contract in 2.3 and 2.4 was re-verified in a
> browser against the new screen**: the ring shows the coach's own coverage
> as a fraction (`n/m active players have nothing outstanding`), never a
> score; a check asserts the printed value matches `^\d+/\d+$` and that no
> score, readiness or grade wording appears anywhere on the page; the order
> is still the roster's own. `coachOverview.ts` was not modified, so the
> tests behind these contracts still describe exactly what they described.

### 2.5 Results do not feed recommendations

The learning loop is **read-only by design**. Nothing in `coachResults.ts` or
`coachOverview.ts` is an input to `coachAssist.ts`, to the match-plan
snapshot, or to any engine. With the handful of matches a real coach
accumulates, nothing should be: the floors exist precisely because small
samples mislead. Closing this loop is not a small change and is explicitly
out of scope for the stabilization period.

### 2.6 The win-rate floor stays consistent with Results

- Results: `LEARNING_FLOOR = 10` overall, `SOURCE_FLOOR = 5` per source
  (`state/coachResults.ts`).
- Roster overview: `ROSTER_RATE_FLOOR = 10` (`state/coachOverview.ts`).
- Under a floor there is **no rate at all** — the withheld sentence is printed
  instead. A percentage carrying a caveat gets read as a percentage.

**Watch point, recorded honestly:** these are two constants with the same
value, each tested against itself. Nothing imports one from the other and no
test asserts they are equal, so changing one alone would let the two screens
disagree about the same player without anything failing. If either moves,
move both — or make one import the other.

### 2.7 Test-mode records stay excluded from every figure

`coachResults.learn()` drops a result whose own `testMode` is set **and** one
whose plan is a test plan. `coachOverview.summarise()` filters `!p.testMode`
and `!r.testMode` before counting anything. A result recorded while trying the
tool out is not evidence about the advice, and a figure that quietly includes
it is worse than no figure.

### 2.8 Team Analysis / Coach Assist remain the source of recommendation logic

`AssistTab.tsx` calls `fetchTeamAnalysis([player], [opponent], days)` and reads
`folders[0].perPlayer[0]`. **It ranks nothing itself.** Every figure shown is
the engine's own. A second scorer in the coaching client would eventually
disagree with the public Team Analysis screen about the same two players, and
there would be no way to tell which was right. The match plan freezes the
engine's output; it does not recompute it.

### 2.9 The roster overview performs no analytics scans

`coachOverviewStore.ts` imports `supabase` and three coaching stores, and
nothing else — no `analyticsClient`, no `fetch`, no `/api/analytics`. It reads
**three queries with minimal columns for the whole roster**, not three per
player: RLS already scopes each table to the coach, so "all my decks" is one
select of two columns. Per-player intelligence would be one expensive database
scan per player behind the cheapest-looking screen in the product. This is why
`trackedTags` is passed `null` and the `not_collected` flag is withheld rather
than guessed.

---

## 3. Known limitation — a production verification item, not a bug

**Reload persistence cannot be proven locally.** This checkout has no Supabase
credentials, so `supabase` is null and every coaching store falls back to its
in-memory repository (labelled on screen). Local runs therefore exercise the
pure logic, the components and the memory path — but never the real
repository, the generated `deck_key`, RLS, or anything surviving a page
refresh.

What this means in practice:

- Nothing local can fail in a way that catches a broken Supabase read or write.
- A `page.reload()` in a verify script **wipes the memory roster**, so browser
  checks change a window to force a re-read instead of reloading.
- Consequently, **reload persistence is verified in production, by hand,** per
  the checklist below. It has been confirmed this way for phase 3; phases 6–8
  are covered by the checklist and by the same three-store repository code.

This is a property of the development environment, not a defect in the
application. Do not "fix" it by adding credentials to the repo.

---

## 4. Production smoke test (manual)

Run signed in as the admin account on `https://deckkies.com`. Each step is
pass/fail on its own; note anything that does not match.

| # | Step | Pass looks like |
|---|---|---|
| 1 | **Bare roster route** — open `#/admin/coach` with no player in the URL | The roster overview renders. It does **not** jump to a player. Totals and per-player counts are shown |
| 2 | **Player selection** — pick a player from the sidebar, then use the "My players" heading | The workspace opens on Overview; the heading returns you to the roster |
| 3 | **Arsenal** — add a deck, reorder it, archive and restore one | The deck saves; a duplicate is refused by name; the coach's order survives a reload (step 9) |
| 4 | **Scout** — scout a collected opponent, then an arbitrary tag | The first shows `stored` with decks; the second shows `live` or "Nothing stored". The basis badge and the evidence line agree. Head-to-head is labelled with the roster player's name |
| 5 | **What to play** — open the assist tab for that pairing | Ranked decks with the engine's own figures; approved and suggested decks marked in place, with the arsenal **not** re-sorted |
| 6 | **Match plan** — "Save as match plan", then confirm with a primary | The plan saves with its snapshot; confirming needs only a primary; an unscored arsenal deck reads "never scored", not 0 |
| 7 | **Result recording** — record a match with the planned deck, then with a deck the plan does not name | The dialog announces the matched slot **before** saving; the second is announced as off-plan with a reason |
| 8 | **Roster overview counts and flags** — return to `#/admin/coach` | Counts reflect the work just done; satisfied flags are gone and the next one in the workflow has taken over; no win rate appears under 10 recorded matches, and the screen says why |
| 9 | **Reload persistence** — hard-refresh on each of Arsenal, Match plans and Results | Everything recorded above is still there. This is the step no local run can prove |
| 10 | **Admin isolation** — sign in as a non-admin (or sign out) and open `#/admin/coach` | "Not your roster", with no flash of roster content. A direct anonymous call to the coaching tables over Supabase REST is refused `42501` |

Two things the account holder's session can reach that a local run cannot, and
which are worth re-checking if anything in the auth path changes: an
**authenticated non-admin** receiving 403 from the intel route, and the
**admin 200 path** on the same route.

---

## 5. Scope of this document

This is a stabilization baseline for the current eight-phase system. Its
purpose is to make regressions recognisable while the system is observed in
real use.

- **No new feature work should be started from this document.**
- No phase 9 is proposed, implied, or scheduled here.
- Changes during the stabilization period should be limited to defects found
  against the contracts in section 2 or the checklist in section 4, and each
  should be able to name the contract it restores.

*Written 2026-09-20, against `e0b4a7c` (phase 8) and `869820c` (its docs).*
