/**
 * syncPolicy.ts — when a remote deck blob may replace local state, and how big
 * a sync payload is allowed to be.
 *
 * NO IMPORTS, deliberately — the same rule `tiers.ts`, `deviceIdentity.ts`,
 * `squadParse.ts` and `passwordRules.ts` follow. The decisions here could not be
 * tested while they sat inside a module that constructs a Supabase client and
 * subscribes to two stores, and they are exactly the decisions worth testing
 * exhaustively: getting one wrong deletes somebody's saved decks.
 *
 * WHAT WENT WRONG, and why this file exists (2026-09-17):
 *
 * A saved duel set costs ~2.2 kB of JSON, so a library of 111 of them made the
 * sync payload ~252 kB — just past the 250 kB cap `api/decks.ts` enforced. Every
 * PUT from that point on answered **413**, `pushRemoteDecks` ignored the
 * response, and the failure was completely silent. The remote copy stayed frozen
 * at the last blob that fitted.
 *
 * That alone would only have stopped cloud sync. What DELETED the new set is
 * what happened next: every page load pulls the remote blob and overwrote local
 * state with it, so the 112th set — saved, on screen, and correctly written to
 * localStorage — was replaced by the stale 111 on the next refresh, and the
 * persist middleware then wrote that back over the good local copy.
 *
 * So two rules, and the second is the load-bearing one:
 *
 *   1. the cap must fit a real collection (`SYNC_MAX_BYTES`);
 *   2. **a remote blob may never replace local state that has changes the
 *      remote has not accepted yet.** A push can fail for any reason — offline,
 *      a 413, a 500, a dead tunnel — and none of them may cost the user data
 *      they can see on their screen.
 */

/**
 * The largest sync payload `/api/decks` accepts, in bytes of JSON.
 *
 * 1 MB, up from 250 kB. At the measured ~2.2 kB per saved versus set that is
 * roughly 450 saved sets against the ~110 the old cap allowed, and it stays
 * inside the most restrictive documented Upstash REST request limit (1 MB) and
 * well inside Vercel's 4.5 MB body limit.
 *
 * **THIS NUMBER IS DUPLICATED IN `api/decks.ts`.** It cannot be imported there:
 * package.json is `"type": "module"`, Vercel runs `api/` as ESM, and Node ESM
 * does not resolve extensionless relative imports — importing across that
 * boundary typechecks and then fails at module load with an uncatchable
 * FUNCTION_INVOCATION_FAILED. `tests/syncPolicy.test.ts` reads the server file
 * and asserts the two agree, the same arrangement `test_tracking.py` uses to
 * keep this repo and the bot in step.
 */
export const SYNC_MAX_BYTES = 1_000_000;

/** Bytes of JSON a payload will occupy on the wire. */
export function payloadBytes(payload: unknown): number {
  try {
    return JSON.stringify(payload ?? null).length;
  } catch {
    // Circular or otherwise unserialisable: treat as too large rather than
    // claiming it fits and failing at the fetch.
    return Number.POSITIVE_INFINITY;
  }
}

/** Whether a payload is small enough for `/api/decks` to accept. */
export function fitsSyncLimit(payload: unknown): boolean {
  return payloadBytes(payload) <= SYNC_MAX_BYTES;
}

export interface AdoptRemoteInput {
  /** Does the data already in this browser belong to the signing-in account? */
  sameOwner: boolean;
  /** Did the remote pull return a blob? */
  hasRemote: boolean;
  /** Are there local changes the remote has not accepted yet? */
  pendingLocalChanges: boolean;
}

export type SyncAction =
  /** Replace local state with the remote blob. Normal cross-device sync. */
  | 'adopt-remote'
  /** Keep local state and push it up: it is newer than what the remote holds. */
  | 'keep-local-and-push'
  /** Nothing stored remotely yet — seed it from local state. */
  | 'seed-remote';

/**
 * What a sign-in / page load should do with the remote copy.
 *
 * THE ONLY CASE THAT MOVED is `sameOwner && pendingLocalChanges`: it used to
 * adopt the remote unconditionally, which is what deleted a saved set whose push
 * had failed. It keeps local and retries the push instead.
 *
 * A DIFFERENT OWNER ALWAYS ADOPTS, and must: local state has already been reset
 * to empty by the caller at that point, and "pending changes" from the previous
 * account must never be pushed into this one. That is the cross-account leak the
 * owner check exists to prevent, and it outranks keeping unsynced work.
 */
export function decideSync(input: AdoptRemoteInput): SyncAction {
  if (!input.hasRemote) return 'seed-remote';
  if (input.sameOwner && input.pendingLocalChanges) return 'keep-local-and-push';
  return 'adopt-remote';
}
