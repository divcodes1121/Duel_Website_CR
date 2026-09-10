# Phase 2 — the bot-side change

**APPLIED AND VERIFIED IN PRODUCTION, 2026-09-10.** It edits
`/opt/clashbot/clashdb.py`, which is the Discord bot's codebase and is **not in
this repository** — so this file is the only record of it here, and it is a
record rather than a plan.

Backup: `/opt/clashbot/clashdb.py.bak-20260910-pre2v2`. Rollback is restoring
that one file and restarting `clashbot`.

**Verified over a full 4,910-player startup sync immediately after the
restart:** 3,633 new rows in `battles`, **0 of them TeamVsTeam**, 13 modes
still landing, and 1,164 fresh 2v2 payloads still reaching `battle_raw`. The
scheduled job then folded them into +1,295 pairs / +2,266 occurrences /
+577 participants, with the retained population still 1,000 and 0 enrolled.

---

## The whole change

Three lines of guard and a six-line helper, in `save_battles`.

```diff
@@ clashdb.py — module level, beside the other mode predicates
+#: WHAT COUNTS AS 2v2. Mirrors `battle_modes._DUO_MARKERS` in the website's
+#: `server/`, and `test_battle_modes.py` over there asserts the two agree —
+#: the same arrangement `test_tracking.py` already uses to pin this project's
+#: drain batch size against the bot's. Two projects, one definition, and a
+#: test that fails when they diverge.
+DUO_MARKERS = ("teamvsteam", "2v2")
+
+
+def is_duo_mode(game_mode: str) -> bool:
+    """True for a two-against-two battle."""
+    m = (game_mode or "").lower()
+    return any(marker in m for marker in DUO_MARKERS)

@@ clashdb.py save_battles(), ~line 1447
                 game_mode = b.get("gameMode", {}).get("name", "unknown")
 
+                # 2v2 NEVER BECOMES A BATTLES ROW.
+                #
+                # THE GUARD IS HERE, BEFORE THE TWO LINES BELOW IT, AND THAT
+                # POSITION IS THE POINT. `team[0]` and `opponent[0]` throw away
+                # the teammate and the second opponent, which is exactly what
+                # turns a four-player battle into a row that looks like a duel
+                # between two people — structurally identical to a ladder row,
+                # so nothing downstream can tell them apart afterwards.
+                #
+                # The payload still reaches `battle_raw` through its own writer
+                # (bot.py), which is the authoritative source the website's
+                # `duo_pairs` reconstructs the real teammate pairs from.
+                #
+                # `duel_timeline` needs no guard: `save_duel_timeline` filters
+                # on `is_competitive_practice_match`, which matches only
+                # "friendly" and "clanmate", so TeamVsTeam has never entered it.
+                if is_duo_mode(game_mode):
+                    continue
+
                 team = b.get("team", [{}])[0]
                 opponent = b.get("opponent", [{}])[0]
```

That is the entire production change. Nothing else in the bot is touched.

---

## What it costs, stated rather than discovered later

**Display names from 2v2 payloads stop being captured.** `save_battles` ends
with `_upsert_name(cur, player_tag, ...)` and `_upsert_name(cur, opponent_tag,
...)`, and a `continue` skips them.

That is acceptable and close to intended: of the 866,226 people seen in 2v2,
**863,887 are untracked** and the whole point of the bounded policy is that we
are not spending resources on them. Tracked players keep getting their names
from their own 1v1 battles. The pair board shows tags, not names.

**A stale comment in that function claims `battle_raw` "only keeps duel
battles now".** It does not — `battle_raw` holds 1,080,046 `TeamVsTeam`
payloads, measured 2026-09-10. Do not act on that comment; it predates whatever
changed the raw writer.

---

## Deployment order, which was not "just apply the guard"

Applying this first would have stopped 2v2 entering `battles` while nothing was
aggregating it, leaving `battle_raw` as the only record until somebody ran a
migration by hand. `battle_raw` has its own retention policy, so that window
was a real risk of permanent loss.

The sequence actually followed, in this order:

1. **Deploy the website's analytics half** — `battle_modes.py`, `duo_pairs.py`
   and the updated `duel_combos.py` to `/opt/royalweb/server/`, with the usual
   md5-against-HEAD drift check and `*.bak-<date>` backups.
2. **Build the collection there**: `python3 duo_pairs.py --migrate`
   (~20 minutes) then `--reconcile`.
3. **Schedule `duo_pairs.update()`** — a systemd timer or cron, hourly is
   ample. It is an index seek on `ix_raw_stored`, not the four-minute scan the
   full run pays. **There is currently no cron and no systemd timer on this
   box at all**, so this is a new unit, not an edit to an existing one.
4. **Only then apply this patch**, back up `clashdb.py` as
   `clashdb.py.bak-<date>-pre2v2`, and restart the bot.
5. **Verify** on the next poll: a new 2v2 arrives, a pair appears or increments
   in `duo_pairs`, participant counts advance, and **no row appears in
   `battles`**. Then verify a normal 1v1 still lands in `battles` unchanged.

Rollback at any point is restoring one file and restarting.

---

## Why promotion stays off through all of it

`CLASH_DUO_PROMOTE` is `off`, so no participant is enrolled by either path.
The mechanism is built and tested; 7,083 candidates would take the roster from
4,910 to the 12,000 ceiling, which is +144% and roughly 380 GB a year at steady
state against a database with no backup. That is a separate decision from
routing 2v2 correctly, and this patch does not make it.
