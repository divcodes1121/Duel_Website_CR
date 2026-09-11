# The raw-cap race, and the interlock that closes it

**APPLIED AND VERIFIED IN PRODUCTION, 2026-09-11.** It edits
`/opt/clashbot/clashdb.py` only — `archive.py` needs no change, because the
fix lives inside `enforce_raw_cap`, which it already calls. That codebase is
the Discord bot's and is not in this repository, so this file is the record.

Backup: `/opt/clashbot/clashdb.py.bak-20260911-121803-prerawcap`. Rollback is
one file and a restart.

**THE DEPLOYMENT ORDER WAS THE WHOLE RISK.** A bot restart triggers startup
maintenance, which is what fires the valve — so the patch had to be installed,
compiled and verified BEFORE the process came back up. Restarting first and
patching after would have run the unguarded path one last time, on 162,013
2v2 payloads.

**IT CAUGHT A REAL CASE ON ITS FIRST RUN.** The startup sync stored 2v2 faster
than the hourly fold consumed it, so when the cap fired there were **20,116
unprocessed 2v2 payloads above the cursor**. The log:

    [RAW CAP] DB over 26.8 GB with archive unavailable — dropping non-duel raw
    [RAW CAP] purging non-duel raw stored at or before
              2026-09-11T09:51:19.322474+00:00 (the 2v2 processing cursor)
    raw={'triggered': True, 'purged': 498333,
         'cursor': '2026-09-11T09:51:19.322474+00:00'}

498,333 rows purged, all at or below the cursor; **0 remained below it and
20,116 2v2 survived above it.** Under the previous code every one of those
would have been deleted with nothing left of them anywhere. The next scheduled
fold then consumed them and the cursor advanced, which is the whole lifecycle:
arrive, be protected, be folded, become purgeable.

---

## What happens today

Phase 2 stopped 2v2 entering `battles`. That left a window in which a 2v2
battle's only copy anywhere is its raw payload — and on 2026-09-10 the bot's
own safety valve deleted 4,763,318 `battle_raw` rows, including all 1,136,571
2v2 payloads then present.

The path is exact, and the code already says what is wrong with it.
`archive.run_two_tier_maintenance`:

```python
raw_cursor = get_meta("flush_raw_stored", "") or ""

if raw_cursor:
    trim_local_raw(days, stored_through=raw_cursor)
    purge_non_duel_raw(stored_through=raw_cursor)      # cursor-bounded, safe
else:
    # "No cursor at all means the archive has never consumed a raw row, so
    #  there is nothing we can prove is safe to delete. Bound by size only."
    enforce_raw_cap(RAW_STAGE_CAP_BYTES)               # unguarded
```

`flush_raw_stored` is **absent** on this host — `CLASH_ARCHIVE_DB_PATH` is
empty and the archive has never run here — so **production takes the `else`
branch on every maintenance run**. That branch's own comment says there is
nothing we can prove is safe to delete, and then it deletes everything anyway,
bounded only by size. `enforce_raw_cap` calls `purge_non_duel_raw(log=log)`
with no cursor, which that function documents as:

> Called with NEITHER, this deletes non-duel raw regardless of whether the
> archive has it — data-losing unless you have just verified the archive is
> fully caught up.

**This was correct when the archive was the only consumer of non-duel raw.**
Phase 2 added a second one and did not tell the valve.

---

## The fix: give that branch a cursor

`purge_non_duel_raw` already takes exactly the parameter needed —
`stored_through`, "the archive's confirmed raw INSERT cursor". The duo
pipeline publishes a cursor with identical semantics: `duo_meta.watermark` in
`/opt/royalweb/server/.duo_pairs.db` is the `stored_at` value it has folded
2v2 payloads through.

So the change is to read that cursor and pass it. No new deletion logic.

```diff
@@ clashdb.py — beside the other cross-project readers
+#: The website's 2v2 pipeline is now a CONSUMER of non-duel raw. Since the
+#: phase-2 guard, a 2v2 battle is not written to `battles` at all, so between
+#: arrival and the hourly fold its raw payload is the only copy in existence.
+#: This is the same cross-project arrangement as CLASH_TRACKING_DB: the bot
+#: reads a file the website owns, read-only, and fails closed.
+DUO_DB_PATH = os.getenv("CLASH_DUO_DB", "/opt/royalweb/server/.duo_pairs.db")
+
+
+def duo_processed_through():
+    """The stored_at cursor the 2v2 pipeline has folded through.
+
+    Returns "" on ANY failure — missing file, unreadable database, absent key.
+    An empty cursor must be read as "protect everything", which is already how
+    purge_non_duel_raw treats one (`if not stored_through: return 0`).
+    """
+    try:
+        with contextlib.closing(
+                sqlite3.connect("file:%s?mode=ro" % DUO_DB_PATH, uri=True,
+                                timeout=5.0)) as con:
+            row = con.execute(
+                "SELECT v FROM duo_meta WHERE k = 'watermark'").fetchone()
+            return (row[0] if row else "") or ""
+    except Exception:
+        return ""

@@ clashdb.py enforce_raw_cap
 def enforce_raw_cap(cap_bytes, log=lambda *a: None):
     if db_size_bytes() < cap_bytes:
         return {"triggered": False, "purged": 0}
     log("[RAW CAP] DB over %.1f GB with archive unavailable — dropping non-duel raw"
         % (cap_bytes / 1e9))
-    purged = purge_non_duel_raw(log=log)
-    return {"triggered": True, "purged": purged}
+    # THE INTERLOCK. Without a cursor this deletes non-duel raw the 2v2
+    # pipeline has not read yet, and since phase 2 that raw is the only copy
+    # of those battles. An empty cursor protects everything: the database
+    # grows and the cap keeps logging, which is the safe direction to fail.
+    cursor = duo_processed_through()
+    if not cursor:
+        log("[RAW CAP] no 2v2 processing cursor — refusing to purge. "
+            "Check the royalweb-duo timer; the database will grow until it runs.")
+        return {"triggered": True, "purged": 0, "blocked": "no_duo_cursor"}
+    purged = purge_non_duel_raw(log=log, stored_through=cursor)
+    return {"triggered": True, "purged": purged, "cursor": cursor}
```

That is the whole change: one helper, and four lines in the valve.

---

## The hole the pre-deploy review found

The first version of `processed_through()` **advanced past a payload the fold
could not read**, which is the one thing a cursor must never do. A 2v2 payload
with an unknown card id resolves to nothing, the fold skips it, and the cursor
went past it anyway — so the cap would have deleted a battle that had never
been folded, and whose raw copy was its only record.

**This is exactly what already happened once.** When Minion Giant shipped and
this host's card catalog was a commit behind, 81,974 sides read as unresolvable
here. Under that cursor the cap would have deleted every affected battle
instead of waiting for the catalog fix — turning a file copy into permanent
loss.

Two rounds of fix, because the first was also wrong:

1. Hold the cursor at the earliest payload that yielded no pair. **Missed the
   common case**: a payload where only ONE side carries the unknown card still
   yields the other side's pair, so the payload looks handled while half of it
   was dropped. The check is per SIDE now.
2. Hold it only for **retryable** reasons. `unknown_card` is transient — a
   catalog deploy and a re-run clear it. `side_not_two_participants`,
   `not_eight_cards` and `duplicate_cards` are permanent properties of the
   payload, and blocking on those would jam the cursor forever on one
   malformed row, stopping all raw purging and growing the database without
   bound. **A safe direction is not the same as a safe resting place.**

`migrate()` now reports `cursorBlockedAt` and `retryableRefusals`, so a held
cursor is visible and says whether it will clear on its own.

## The refusal classification, reviewed rather than assumed

"Safe to move the cursor past" and "successfully incorporated" are related but
not the same claim. The cursor may pass a payload that can never be read,
provided the refusal is recorded and nothing is recoverable from the raw copy.

| reason | class | what would make it processable | raw needed? | jams cursor if blocking? |
|---|---|---|---|---|
| `unknown_card:<id>` | **retryable** | a card-catalog deploy — a file copy | **yes**, the payload must be re-read | no, clears on its own |
| `side_not_two_participants:<n>` | permanent | nothing; the payload has the participants it has | no | **yes, forever** |
| `not_eight_cards:<n>` | permanent | nothing, short of a payload-shape change | no | **yes, forever** |
| `duplicate_cards:<n>` | permanent | nothing; a repeated card is not a deck | no | **yes, forever** |

`unknown_card` is the only one where a future deploy changes the answer, and it
is not theoretical: it is what 81,974 sides hit in September when this host's
catalog was a commit behind. The others describe the payload itself.

**The residual risk, stated rather than buried.** If Supercell ever changed the
payload shape — a ninth card slot, say — `not_eight_cards` would become a
code-fixable condition while still classified permanent, and the cursor would
walk past those payloads before the code caught up. The mitigation is that such
a change is systemic rather than occasional: `unresolvedReasons` would show a
mass refusal on the very first run, which is a different signal from the
handful these reasons normally produce. Reclassifying on that evidence is a
one-line change; blocking on it pre-emptively costs a permanent jam on any one
malformed row.

## Why a lagging cursor is safe, and an absent one is safer

`_stage` reads `WHERE stored_at > watermark ORDER BY stored_at` and advances
its high-water mark for every row it reads. `stored_at` is set at INSERT, so it
orders with insertion. A row inserted while a fold is running is not in that
fold's read snapshot — but its `stored_at` is later than every row that is, so
it lands above the new watermark and the next run collects it.

**The cursor can lag reality. It cannot overstate it.** That is the only
property the interlock needs.

If the duo timer stops, the cursor stops advancing, nothing is purged, and the
database grows — loudly, since the cap fires and logs every run. That is the
correct direction to fail: growth is recoverable, deletion is not.

---

## What this does NOT do

* **It does not disable or weaken the cap.** The valve still fires at the same
  size and still purges; it purges only what has been consumed.
* **It does not require unlimited 2v2 raw retention.** A folded payload becomes
  purgeable on the next run — usually within the hour.
* **It does not change deduplication.** Battle identity stays timestamp plus
  four sorted participant tags; nothing about this touches it.
* **It does not touch duel raw.** `purge_non_duel_raw` has only ever operated
  on non-duel modes, and this narrows what it may take, never widens it.
* **It does not attempt recovery.** The 1,136,571 payloads already purged are
  gone; those battles stay classified as unreconstructable and no pair is
  invented for them.

---

## A narrower variant, and why it is not the recommendation

The cursor gates ALL non-duel raw, not just 2v2 — so if the duo job stalls,
ladder raw also stops being purged even though `battles` still holds every one
of those battles in full.

The surgical alternative is to exempt only unprocessed 2v2 inside
`purge_non_duel_raw`:

```sql
AND (lower(game_mode) NOT LIKE '%teamvsteam%' OR stored_at <= :duo_cursor)
```

It is better behaved under a stalled fold, and it is more new logic in the
function whose failure mode is silent data loss. The recommendation is the
simple version first, on the grounds that the duo job runs hourly and a stall
is visible in the cap's own log line; the narrower form is worth revisiting if
stalls turn out to be common.

---

## Verifying it after deployment

```
python3 /opt/royalweb/server/duo_pairs.py --cursor
```

prints the cursor and how many 2v2 raw rows sit above it. Zero unprocessed
means the fold is keeping up. A number that climbs across runs means the cap is
being held off — check the `royalweb-duo` timer before anything else.
