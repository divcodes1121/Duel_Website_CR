# DECKKIES BRAIN — PHASE 14

## Saved Duels: `111 → 112 → refresh → 111`

```
Date        2026-09-17
Mode        Bug fix. Local code only. Nothing deployed, no production user data
            touched, no migration run.
Repository  main @ a9cdbb7 (the timestamp commit, untouched) + this fix, uncommitted
Status      PASS — root cause proven by measurement, fixed, regression-tested
```

---

# 1. Exact reported bug

The account holder has **111 saved Duel sets**. Saving a new one shows **112** in the
UI. After a page refresh the count is **111** again and the new set is gone. The
original 111 persist correctly, every time. It is not `111 → 11`; it is
`111 → 112 → refresh → 111`.

# 2. Reproduction

Reproduced in a model of the real save/sync/refresh loop, driven by the real payload
shapes (`tests/syncPolicy.test.ts`, first test):

```
seed 111 saved sets, in sync with the remote copy
save set #112      -> local = 112,  PUT returns 413,  push() === false
                      (the client ignored that result entirely)
refresh            -> pull remote (111) and adopt it
                   -> local = 111,  set #112 gone
```

The reproduction fails against the old cap and the old load policy, and passes against
the new ones, so the test would have caught this before it shipped.

# 3. Expected behaviour

111 + 1 = 112 persisted, surviving refresh, hard refresh, navigation and reopening;
then 113, cumulatively, with no previously saved Duel ever disappearing.

# 4. Actual behaviour

The 112th set was written correctly to local state **and to localStorage**, then
destroyed on the next page load by a remote copy that never received it.

# 5. Root cause

**Two defects, and only the pair produces data loss.**

**(a) The sync payload cap was smaller than a real collection.**
`api/decks.ts` enforced `MAX_BODY_BYTES = 250_000` and answered **413** above it. A
saved versus set is **~2,216 bytes** of JSON (13 UUIDs, two 5-deck collections, 80 card
keys), so the whole payload — `{sets, library, deckSlotCount, paletteFolders}` —
crosses 250 kB at **~110 saved sets**:

| saved sets | payload bytes | verdict |
|---:|---:|---|
| 100 | 227,309 | accepted |
| **110** | ~249,546 | **the last size that fits** |
| **111** | **251,762** | **413 Payload too large** |
| 112 | 253,985 | 413 |

The reported failure sits exactly on the measured boundary.

**(b) The failure was silent, and the load path then overwrote the newer local data.**
`pushRemoteDecks` was `Promise<void>` and never looked at the response, so a 413 was
indistinguishable from success. Meanwhile `hydrateFromRemote` — which runs on **every
page load**, not only at sign-in — replaced local state with the remote blob
unconditionally. The persist middleware then wrote that loss back over the good
localStorage copy.

So the remote froze at the last blob that fitted, and every subsequent refresh restored
the app to it. **(a) stopped the write; (b) deleted the record of it.**

Against the prompt's case list this is **Case A and Case D together**: the write was
failing *and* a later initialisation overwrote the collection with the previous 111.

# 6. Persistence layer

Two layers, both involved:

| layer | what | key |
|---|---|---|
| browser | zustand `persist` → `localStorage` | `royal-duels-builder`, version 9 |
| cloud | Upstash Redis via `PUT/GET /api/decks` | `deck-data:user:<supabase user id>` |

The browser copy is written synchronously on every change and was **always correct**.
The cloud copy is the one that stalled — and because it is adopted on load, it wins.

# 7. Save flow

```
SavedGroups / builder header "Save"
  → useBuilderStore.saveCurrent(name)            store.ts:488
      library: [entry, ...state.library]         prepend, immutable, id = crypto.randomUUID()
  → persist middleware writes localStorage        royal-duels-builder   ✅ 112 here
  → useBuilderStore.subscribe (library changed)   store.ts:1008
  → schedulePush()  → 1.5 s debounce → pushRemoteDecks(currentSyncPayload())
  → PUT /api/decks  → 413 once the payload passed the cap   ❌ silently ignored
```

`saveCurrent` was never at fault: it prepends immutably and assigns a fresh UUID.

# 8. Load flow

```
page load
  → zustand persist rehydrates from localStorage → merge() → 112   ✅ still correct here
  → accountStore restores the Supabase session, becomes `ready`
  → hydrateFromRemote(userId)                      store.ts:975
      → GET /api/decks → the frozen blob (111)
      → useBuilderStore.setState({ library: remote.library ?? [] })   ❌ 112 → 111
  → persist writes 111 back to localStorage        ❌ the good local copy is gone
```

# 9. Why 112 disappears after refresh

Because the load path trusted the remote copy more than the local one, and the remote
copy was stale through a failure nothing checked. The 112th set existed in three places
(React state, localStorage, the user's screen) and in none of them after the pull.

# 10. Exact fix

**Three small changes, no redesign.**

1. **`api/decks.ts`** — `MAX_BODY_BYTES` 250,000 → **1,000,000**, with the reasoning
   recorded. ~450 saved sets instead of ~110, inside the most restrictive documented
   Upstash REST request limit and well inside Vercel's 4.5 MB body limit.

2. **`src/state/syncClient.ts`** — `pushRemoteDecks` returns **`Promise<boolean>`**
   (`res.ok`) instead of `Promise<void>`. A rejected push is now a fact the caller has.

3. **`src/state/store.ts`** — a durable "local is ahead" marker and a guarded load:
   - `royal-duels-sync-pending` in localStorage, set when a push is *scheduled* (not
     when it fails — the refresh that matters can land inside the 1.5 s debounce),
     cleared only when a push returns true;
   - `hydrateFromRemote` asks `decideSync(...)` and, when the signed-in account owns
     the local data **and** a change is still unaccepted, **keeps local state and
     retries the push** instead of adopting the remote blob.

4. **`src/state/syncPolicy.ts`** (new) — the decision as a pure, import-free module,
   the pattern `tiers.ts`, `deviceIdentity.ts` and `squadParse.ts` already follow here,
   so it is testable without constructing a Supabase client or subscribing to stores.

**The second half is the real fix.** Raising the cap alone would move the same failure
to whatever the next limit is; the guard means that any failed push — offline, 413,
500, expired token — costs cloud sync until it heals and **never costs data the user
can see**.

# 11. Regression tests

`tests/syncPolicy.test.ts` — **16 tests, all passing**, driving a model of the real
loop (save → local write → size-capped push → refresh → pull → adopt-or-not) with both
the old and new policies:

| group | assertions |
|---|---|
| the reported bug | reproduces `111 → 112 → refresh → 111` against the old cap+policy; fixed under the new; **and survives a push that fails for any reason** (cap set to 0) |
| the acceptance sequence | `111 → save → refresh → 112 → save → refresh → 113 → refresh → 113`; six consecutive refreshes hold at 112; cumulative 1 → 113; no previously saved duel is ever lost |
| the payload cap | the old cap could not hold a real 111-set library; the new one holds 300; **the client constant equals the number the server enforces**, read out of `api/decks.ts`; an unserialisable payload counts as too large |
| `decideSync` | all four branches, including that a different account **always** adopts |
| user isolation | one account's unsynced duels never reach another account's blob |

**A fixture bug was found and fixed while writing these, and it is worth recording**:
the first version used short fake ids (`id-0000001`) where the store uses 36-character
UUIDs. A saved versus set carries 13 of them, so the model measured 214 kB for 111 sets
where production measures 252 kB — putting the whole library *under* the old cap and
making the bug untestable. The ids are UUID-shaped now, and the note is in the file.

Suite totals: **516 vitest tests across 19 files** (was 500/18). `npx tsc -b` clean,
`npm run build` clean.

# 12. Data preservation

**Nothing was deleted, reset or migrated.** No localStorage was cleared, no Redis key
written, no production data touched. The fix is additive: a new localStorage key
(`royal-duels-sync-pending`), a larger server cap, and a load path that now *declines*
to overwrite in one case. On first load after the fix nothing is pending, so the normal
adopt-remote path runs exactly as before and the existing 111 sets load untouched.

The already-lost 112th set is **not recoverable** — it was overwritten in both the
remote blob and localStorage before this phase. Re-saving it now persists correctly.

# 13. User isolation

Unchanged and re-tested. `localOwner()` still resets local decks when a different
account signs in, and the pending marker is cleared at the same moment, so a previous
account's unsynced changes can never be pushed into the new account's key —
`decideSync` returns `adopt-remote` for a different owner regardless of pending state,
which is the branch that keeps that guarantee.

# 14. Files changed

| file | change |
|---|---|
| `api/decks.ts` | cap 250,000 → 1,000,000, with the reasoning |
| `src/state/syncClient.ts` | `pushRemoteDecks` returns whether the PUT landed |
| `src/state/store.ts` | pending marker, `pushNow()`, guarded `hydrateFromRemote` |
| `src/state/syncPolicy.ts` | **new** — `SYNC_MAX_BYTES`, `decideSync`, size helpers |
| `tests/syncPolicy.test.ts` | **new** — 16 regression tests |
| `DECKKIES_BRAIN_PHASE14_SAVED_DUEL_PERSISTENCE.md` | **new** — this artifact |
| `DECKKIES_BRAIN_README.md` | Phase 14 entry |

# 15. Files untouched

`saveCurrent` / `updateSaved` / `loadSaved` and every other store action, the persist
`version`, `migrate` and `merge`, `SavedGroups.tsx`, the builder, Deck's Home, Counter
Palette, duel detection, DuelEngine, duel grouping, battle parsing, Coach Assist, the
prediction engine, the Brain, all 2v2 code (`duo_pairs.py`, `duo_retention.py`), the
timestamp fix `a9cdbb7`, and `CLASH_OIE`.

# 16. Known limitations

1. **A user whose pushes keep failing stops receiving cross-device updates** until one
   succeeds — deliberately. Local data is never discarded; the alternative is the bug
   being fixed here. It self-heals on the first successful push.
2. **Last-write-wins is unchanged.** Two devices editing while one has a stalled push
   can still have the later push overwrite the earlier one. That is the documented sync
   model and this change neither worsens nor fixes it.
3. **The new cap is not infinite.** At ~2.2 kB per set, 1 MB is ~450 saved sets. Past
   that, sync stops *loudly* (local data safe) rather than silently eating saves. A
   real fix for very large collections is per-entry storage, not a bigger blob.
4. **The lost 112th set cannot be recovered** (§12).
5. **Not verified in a browser against production.** The fix is proven by measurement
   and by tests over a model of the loop; confirming it end to end needs a deploy,
   which is not authorised here.

# 17. Deployment status

**NOT DEPLOYED.** Local, uncommitted. Note that this fix needs **both** halves to be
live: the client change ships via a Vercel build from a git push, and the cap lives in
the same serverless function, so one push delivers both. No VPS involvement, no
production database change, no migration.

# 18. Next approval

1. **Commit and deploy the fix** — it is user-facing data loss, so it should go out
   ahead of the 2v2 work. One push to `main` deploys both halves.
2. **Browser verification against production** after the deploy: save a 112th duel,
   hard refresh, confirm it survives, then a 113th.
3. Still pending and untouched: **Brain Phase 13** (dark deployment of the timestamp
   fix) and the **2v2 retention cleanup**, each with its own approval.
