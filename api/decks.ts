import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * The largest sync payload this endpoint accepts.
 *
 * WAS 250_000, AND IT SILENTLY DELETED SAVED DUELS. A saved duel set is ~2.2 kB
 * of JSON, so a library of ~110 filled the old cap; every PUT after that
 * answered 413, the client ignored the response, and the remote copy froze at
 * the last blob that fitted. Because every page load replaces local state with
 * the remote blob, the next refresh then overwrote the newly saved set with the
 * stale copy — reported as "111 saved duels, save one, it shows 112, refresh and
 * it is 111 again".
 *
 * 1 MB is ~450 saved sets, inside the most restrictive documented Upstash REST
 * request limit and well inside Vercel's 4.5 MB body limit. The client now
 * checks the response, so passing this cap stops sync loudly instead of eating
 * data: `src/state/syncPolicy.ts` keeps local state and retries rather than
 * adopting a remote blob that is missing changes.
 *
 * Mirrored as `SYNC_MAX_BYTES` in `src/state/syncPolicy.ts` — it cannot be
 * imported across that boundary (Node ESM does not resolve extensionless
 * relative imports here, see the auth note below), and `tests/syncPolicy.test.ts`
 * asserts the two numbers agree.
 *
 * SINCE 2026-10-09 THE SAVED LIBRARY IS NOT INSIDE IT. ~450 sets was still a
 * ceiling, and an account reached 225 and asked for none. The library travels
 * and is stored in parts now (see "THE DECK DOCUMENT, WITH THE LIBRARY IN
 * PARTS" below), and this cap is what it always should have been: a limit on
 * one request — the head (boards, Deck's Home, Counter Palette), one saved
 * team analysis, and the whole document of a tab still running the old client.
 */
const MAX_BODY_BYTES = 1_000_000;

/* ---------------------------------------------------------------- auth ----
 *
 * INLINED, NOT IMPORTED FROM `./_auth`, and this cost a broken production
 * deploy to learn. package.json is `"type": "module"`, so Vercel runs these
 * functions as ESM -- and Node ESM does NOT resolve extensionless relative
 * imports. `import { callerFrom } from './_auth'` typechecks perfectly, because
 * tsconfig.api.json uses `moduleResolution: "Bundler"`, and then fails at
 * module load with an uncatchable FUNCTION_INVOCATION_FAILED. Same class of
 * trap as the JSON-import one already recorded in CLAUDE.md, and the reason
 * `api/analytics/opponent-read/[tag].ts` keeps everything in one file too.
 *
 * REPLACES `sha256(username:password)`. That worked while there were twenty
 * fixed accounts whose hashes could be inlined here, and stopped working the
 * moment real signup existed -- there is no list to check a new user against.
 * It was also poor on its own terms: a password derivative used as a bearer
 * credential never expires and cannot be revoked.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';

/* Module scope so a warm container reuses it: the JWKS is then fetched once per
   container rather than once per request, and re-fetched only when a token
   arrives bearing an unseen `kid` -- which is what lets Supabase rotate keys
   without a redeploy here. */
const jwks = SUPABASE_URL
  ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  : null;

async function callerFrom(req: VercelRequest): Promise<string | null> {
  if (!jwks) return null;
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${SUPABASE_URL}/auth/v1`,
      /* Supabase puts `authenticated` in `aud` for a signed-in user. Pinning it
         stops a token minted for another audience being replayed here. */
      audience: 'authenticated',
    });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    /* Expired, wrong signature, wrong issuer, malformed -- all one answer. The
       difference is only useful to someone probing. */
    return null;
  }
}

/**
 * Cross-device deck sync.
 *
 * AUTHENTICATION MOVED FROM A PASSWORD HASH TO A SUPABASE TOKEN. This file used
 * to hold the twenty test accounts' `sha256(username:password)` values inline
 * and treat a matching hash as proof of identity. That could not survive real
 * signup — there is no list to check a new user against — and the scheme was
 * poor on its own terms: a password derivative used as a bearer credential
 * never expires and cannot be revoked.
 *
 * Storage is now keyed by the Supabase user id. Ids are stable for the life of
 * an account and are not secret, which is the right shape for a storage key;
 * the old key was a secret, so anyone who read it out of a log had the data.
 */

// The Vercel Marketplace Upstash integration injects KV_REST_API_URL/TOKEN.
// (Redis.fromEnv() only reads UPSTASH_REDIS_REST_*, which it does NOT create.)
const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) redis = new Redis({ url: redisUrl!, token: redisToken! });
  return redis;
}

const keyFor = (userId: string) => `deck-data:user:${userId}`;

/**
 * The previous value of a user's deck blob, kept for `SHADOW_DAYS`.
 *
 * **THE LAST LINE OF DEFENCE, AND IT EXISTS BECAUSE THE CLIENT ALREADY LOST AN
 * ACCOUNT'S LIBRARY ONCE.** A client bug replaced 150 saved duel sets with an
 * empty payload; the client fix stops that particular path, but "the client
 * pushed something wrong" is a category, not a single bug, and there was no
 * copy of what it overwrote. One extra key makes every such loss recoverable
 * by reading it back.
 *
 * It is NOT a backup system and must not be sold as one: one version deep,
 * best-effort, and only written when the incoming payload would DESTROY saved
 * work. That is the case worth paying a write for.
 */
const shadowKeyFor = (userId: string) => `deck-data:user:${userId}:prev`;

/** How long a shadow copy lives. Long enough to notice and ask. */
const SHADOW_SECONDS = 60 * 60 * 24 * 30;

/** Saved sets in a blob, or 0 for anything unreadable. */
export function libraryCount(blob: unknown): number {
  const lib = (blob as { library?: unknown } | null)?.library;
  return Array.isArray(lib) ? lib.length : 0;
}

/**
 * Is this PUT about to destroy saved work?
 *
 * Exported so the decision can be tested without a Redis or a request. Only
 * a SHRINK counts: a normal save adds or edits and is not worth a second
 * write, while every loss so far has had this shape.
 */
export function shouldKeepShadow(existing: unknown, incoming: unknown): boolean {
  if (existing == null) return false;
  return libraryCount(existing) > libraryCount(incoming);
}

/**
 * The pre-Supabase storage key for an account, so its decks can be claimed.
 *
 * The twenty test logins are gone, which means the decks saved under them are
 * unreachable — the key WAS the credential, so without the password nothing can
 * name them. This lets someone who still knows an old username and password
 * copy that data onto their new account, once. It is the migration path for
 * real data, not a second way in: it can only ever WRITE to the caller's own
 * verified key, and it never returns the legacy blob to an unauthenticated
 * caller.
 */
function legacyKey(username: string, password: string): string {
  const hash = createHash('sha256')
    .update(`${username.trim().toLowerCase()}:${password.trim()}`)
    .digest('hex');
  return `deck-data:${hash}`;
}

/* ── SAVED TEAM ANALYSES (`?doc=team-saves`) ─────────────────────────────────
 *
 * Team Analysis saves used to live only in the browser that made them, so a
 * phone never showed a board saved on the desktop (2026-09-21). They are kept
 * here now, per account.
 *
 * ONE RECORD PER SAVE PLUS A HASH INDEX, NOT ONE DOCUMENT. A compacted 10v10
 * board is ~0.7 MB and twelve of them would blow the 1 MB request cap above;
 * the index is what the list needs and is a few hundred bytes a save. `HSET`
 * and `HDEL` touch one field each, so two devices saving at once cannot
 * overwrite each other's index entry the way a read-modify-write would.
 *
 * THIS FILE CANNOT IMPORT FROM `src/` (see the auth note), so the cap and the
 * id shape are restated here and `tests/teamSaves.test.ts` asserts they match
 * `src/state/teamSaveRules.ts`.
 *
 * The route is a function of a tiny KV interface rather than of Upstash
 * directly, so the whole contract is tested against an in-memory store. */

export const TEAM_SAVE_MAX = 12;
export const TEAM_SAVE_ID = /^t[a-z0-9]{6,24}$/;

export interface TeamSaveKV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
  del(key: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, unknown> | null>;
  hset(key: string, value: Record<string, unknown>): Promise<unknown>;
  hdel(key: string, field: string): Promise<unknown>;
}

interface TeamSaveMeta {
  id: string;
  name: string;
  savedAt: string;
  mode: 'scout' | 'squads';
  players: number;
  folders: number;
}

const teamIndexKey = (userId: string) => `team-saves:user:${userId}`;
const teamSaveKey = (userId: string, id: string) => `team-save:user:${userId}:${id}`;

function isMeta(x: unknown): x is TeamSaveMeta {
  if (!x || typeof x !== 'object') return false;
  const m = x as TeamSaveMeta;
  return typeof m.id === 'string' && typeof m.name === 'string' && typeof m.savedAt === 'string';
}

/** The record to store and its index entry — or null when the body is not a save. */
/**
 * The most a compressed report may expand to. A real 12v12 is ~0.9 MB of
 * JSON; this is headroom, and it is what stops a small crafted body from
 * inflating into gigabytes inside the function (`maxOutputLength` makes
 * `gunzipSync` throw instead).
 */
const TEAM_SAVE_MAX_INFLATED = 16_000_000;

/**
 * The report inside a save body — plain, or gzipped and base64'd.
 *
 * COMPRESSED SINCE THE CAP WENT TO TWELVE A SIDE (2026-09-21). A compacted
 * 12v12 report is ~858 kB of JSON, 14% under the 1 MB request cap, and any
 * new field would have pushed it over — at which point the save stays on the
 * device that made it, which is the bug this sync exists to fix. Gzipped it is
 * ~56 kB (15x), so the cap stops being a number anybody has to watch.
 *
 * PLAIN IS STILL ACCEPTED: the saves synced before this change are stored
 * that way, and a browser without `CompressionStream` sends that way.
 */
function reportOf(b: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof b.reportGz === 'string') {
    if (b.reportGz.length > MAX_BODY_BYTES) return null;
    try {
      const text = gunzipSync(Buffer.from(b.reportGz, 'base64'), {
        maxOutputLength: TEAM_SAVE_MAX_INFLATED,
      }).toString('utf8');
      const parsed: unknown = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  const r = b.report as Record<string, unknown> | null | undefined;
  return r && typeof r === 'object' ? r : null;
}

function teamSaveFrom(body: unknown, id: string): { record: Record<string, unknown>; meta: TeamSaveMeta } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.id !== id) return null;
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) return null;
  if (typeof b.savedAt !== 'string' || Number.isNaN(Date.parse(b.savedAt))) return null;
  if (typeof b.blueText !== 'string' || typeof b.redText !== 'string') return null;
  const r = reportOf(b);
  if (!r) return null;
  if (!Array.isArray(r.folders) || !Array.isArray(r.blue) || !Array.isArray(r.red)) return null;
  const gz = typeof b.reportGz === 'string';
  return {
    // Only the fields a save has. Anything else a client sends is not stored.
    // A compressed report is STORED compressed: the index needs its counts,
    // which were read above; nothing server-side needs the rest.
    record: {
      id, name: b.name, savedAt: b.savedAt, blueText: b.blueText, redText: b.redText,
      ...(gz ? { reportGz: b.reportGz } : { report: r }),
    },
    meta: {
      id,
      name: b.name,
      savedAt: b.savedAt,
      mode: r.mode === 'scout' ? 'scout' : 'squads',
      players: r.blue.length + r.red.length,
      folders: r.folders.length,
    },
  };
}

export async function teamSaveRoute(
  method: string | undefined,
  id: string | null,
  body: unknown,
  userId: string,
  kv: TeamSaveKV,
): Promise<{ status: number; json: unknown; allow?: string }> {
  const index = teamIndexKey(userId);
  if (id !== null && !TEAM_SAVE_ID.test(id)) return { status: 400, json: { error: 'Bad id' } };

  if (method === 'GET') {
    if (id === null) {
      const all = (await kv.hgetall(index)) ?? {};
      const saves = Object.values(all)
        .filter(isMeta)
        .sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
      return { status: 200, json: { saves } };
    }
    const data = await kv.get(teamSaveKey(userId, id));
    return { status: 200, json: { found: data != null, data: data ?? null } };
  }

  if (id === null) return { status: 400, json: { error: 'Missing id' } };

  if (method === 'PUT') {
    if (JSON.stringify(body ?? {}).length > MAX_BODY_BYTES) {
      return { status: 413, json: { error: 'Payload too large' } };
    }
    const parsed = teamSaveFrom(body, id);
    if (!parsed) return { status: 400, json: { error: 'Not a saved analysis' } };
    const all = (await kv.hgetall(index)) ?? {};
    if (!(id in all) && Object.keys(all).length >= TEAM_SAVE_MAX) {
      return { status: 409, json: { error: 'full' } };
    }
    // Record FIRST, index second: an index entry must never point at nothing.
    await kv.set(teamSaveKey(userId, id), parsed.record);
    await kv.hset(index, { [id]: parsed.meta });
    return { status: 200, json: { ok: true } };
  }

  if (method === 'PATCH') {
    const name = (body as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 60) {
      return { status: 400, json: { error: 'Bad name' } };
    }
    const record = await kv.get(teamSaveKey(userId, id));
    if (!record || typeof record !== 'object') return { status: 404, json: { error: 'Not found' } };
    const next = { ...(record as Record<string, unknown>), name: name.trim() };
    const parsed = teamSaveFrom(next, id);
    if (!parsed) return { status: 404, json: { error: 'Not found' } };
    await kv.set(teamSaveKey(userId, id), parsed.record);
    await kv.hset(index, { [id]: parsed.meta });
    return { status: 200, json: { ok: true } };
  }

  if (method === 'DELETE') {
    // Index first, so a half-finished delete leaves an orphan record nobody
    // lists rather than a listed save that cannot be opened.
    await kv.hdel(index, id);
    await kv.del(teamSaveKey(userId, id));
    return { status: 200, json: { ok: true } };
  }

  return { status: 405, json: { error: 'Method not allowed' }, allow: 'GET, PUT, PATCH, DELETE' };
}

function redisKV(): TeamSaveKV {
  const r = getRedis();
  return {
    get: (k) => r.get(k),
    set: (k, v) => r.set(k, v),
    del: (k) => r.del(k),
    hgetall: (k) => r.hgetall(k),
    hset: (k, v) => r.hset(k, v),
    hdel: (k, f) => r.hdel(k, f),
  };
}

/* ── THE DECK DOCUMENT, WITH THE LIBRARY IN PARTS (`?v=2`) ───────────────────
 *
 * An account's decks were ONE Redis value capped at `MAX_BODY_BYTES`: the
 * working boards, Deck's Home, the Counter Palette and every saved set. At
 * ~2 kB a saved duel that is ~500 sets, and past it the client's upload was
 * refused with nothing on screen saying so. An account at 225 asked for no
 * ceiling (2026-10-09). One value cannot have none — a request has a size
 * limit however it is compressed — so the saved library moved out of it:
 *
 *   deck-data:user:<id>:v2          the HEAD: everything except the library,
 *                                   plus the ordered list of library parts
 *   deck-part:user:<id>:<part id>   one part: up to 200 saved sets, gzipped
 *   deck-parts:user:<id>            a hash, part id -> how many sets it holds
 *   deck-data:user:<id>:v2:prev     the previous head, when a commit shrank
 *                                   the library (`shadowKeyFor`'s job, here)
 *
 * A PART IS NAMED BY ITS CONTENT (`partId`), so a part that has not changed is
 * not sent again: saving one duel uploads one part and then the head.
 *
 * WHAT STAYS THE SAME, deliberately: a push still replaces the whole document
 * and the last one wins. `syncPolicy.ts`, the pending flag and the shadow copy
 * were each written after a real loss and none of them needed to change.
 *
 * ── THE RULES THAT KEEP IT WHOLE ────────────────────────────────────────────
 *
 *  1. A HEAD NEVER NAMES A PART THAT IS NOT STORED. The commit checks, and
 *     answers 409 with the missing ids so the client uploads them and retries.
 *  2. COMMITS AND THEIR CLEAN-UP RUN ONE AT A TIME per account (`lockKey`).
 *     Without that, one device's clean-up could delete a part another device's
 *     commit had just named.
 *  3. A PART IS CHECKED AGAINST ITS NAME on upload, and by the client again on
 *     the way back.
 *  4. PARTS THE SHADOW HEAD NAMES ARE KEPT for as long as it lives.
 *
 * ── HOW MANY ───────────────────────────────────────────────────────────────
 *
 * `SAVED_SET_LIMIT` for everyone, none for an admin. Asked for in those words:
 * "unlimited for my account, which is admin ... 1000 saved decks for everyone".
 * The limit is what stops an account filling the database, so it is enforced
 * HERE and not only on the screen; who is an admin is asked of Supabase with
 * the caller's own token (`adminCheck`), and only when a request is over a
 * limit, so an ordinary save costs no extra round trip.
 *
 * ── THE OLD CALLS STILL WORK ────────────────────────────────────────────────
 *
 * A tab opened before this shipped runs the old client until it is reloaded.
 * Its GET is answered with the document in the old shape, assembled from the
 * parts (or refused when that would be too big to send — which that client
 * reads as "could not read" and changes nothing). Its PUT is stored the old
 * way and becomes the account's document again. The old value is kept for
 * `V1_KEEP_SECONDS` after an account first moves, as what a rollback would
 * read.
 */

/** Saved sets an account may hold, unless it is an admin's.
 *  Mirrored as `SAVED_SET_LIMIT` in `src/state/tiers.ts`; a test holds them equal. */
export const SAVED_SET_LIMIT = 1000;

/** Saved sets one part may hold. `LIBRARY_PART_SIZE` in `src/state/libraryParts.ts`. */
export const LIBRARY_PART_MAX = 200;

/** A part on the wire: base64 of gzip. A real one is ~110-150 kB. */
const PART_MAX_GZ = 900_000;
/** What a part may inflate to — headroom over a real ~450 kB, and the stop on
 *  a small body crafted to expand into gigabytes. */
const PART_MAX_INFLATED = 4_000_000;
/**
 * Parts a capped account may have stored at once: five hold a full library,
 * five more the shadow head's, and the rest is room for an upload in flight.
 * Past it an upload is refused, so a part nobody commits cannot be used to
 * fill the database.
 */
const PARTS_CAPPED = 24;
/** A sanity ceiling for an account with no limit: a million saved sets. */
const PARTS_ABSOLUTE = 5_000;
/** Compressed parts sent along with the head, so an ordinary library arrives
 *  in one response (Vercel caps a response at 4.5 MB). */
const INLINE_BUDGET = 3_000_000;
/** The most an old client's GET is assembled to. */
const LEGACY_ASSEMBLE_MAX = 3_500_000;
const V1_KEEP_SECONDS = 60 * 60 * 24 * 90;
const LOCK_SECONDS = 15;

export const PART_ID = /^[0-9a-f]{16}[0-9a-z]{1,8}$/;

/**
 * A part's name. **DUPLICATED FROM `src/state/libraryParts.ts`** (this file
 * cannot import from `src/`, see the auth note); `tests/deckSyncV2.test.ts`
 * holds the two to the same answers.
 */
export function partId(json: string): string {
  let h1 = 0xdeadbeef ^ json.length;
  let h2 = 0x41c6ce57 ^ json.length;
  for (let i = 0; i < json.length; i++) {
    const ch = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(h2)}${hex(h1)}${json.length.toString(36)}`;
}

export interface DeckKV {
  get(key: string): Promise<unknown>;
  mget(keys: string[]): Promise<unknown[]>;
  /** `false` only when `nx` was asked for and the key already existed. */
  set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<boolean>;
  del(keys: string[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, unknown> | null>;
  hset(key: string, value: Record<string, unknown>): Promise<unknown>;
  hdel(key: string, fields: string[]): Promise<unknown>;
}

/**
 * The old single value as it was at the moment an account first moved to
 * parts, kept WITH NO EXPIRY and never read by this code.
 *
 * Asked for before this shipped: "I don't want to lose my saved sets ... make
 * sure of that." The old key itself is kept 90 days as what a rollback would
 * read; this is the copy that does not depend on anybody noticing within 90
 * days. Written once (`nx`), so a later move — after an old tab had put the
 * old shape back — cannot replace the first snapshot with a newer one. It is
 * at most 1 MB an account.
 */
const preMoveKey = (userId: string) => `deck-backup:user:${userId}:before-parts`;

const headKey = (userId: string) => `deck-data:user:${userId}:v2`;
const headShadowKey = (userId: string) => `deck-data:user:${userId}:v2:prev`;
const partKey = (userId: string, id: string) => `deck-part:user:${userId}:${id}`;
const partIndexKey = (userId: string) => `deck-parts:user:${userId}`;
const lockKey = (userId: string) => `deck-lock:user:${userId}`;

interface DeckHead {
  v: 2;
  sets: unknown;
  deckSlotCount?: unknown;
  paletteFolders?: unknown;
  library: { parts: { id: string; n: number }[]; count: number };
  at: string;
}

function asHead(x: unknown): DeckHead | null {
  const h = x as DeckHead | null;
  if (!h || typeof h !== 'object' || h.v !== 2) return null;
  if (!h.library || !Array.isArray(h.library.parts)) return null;
  return h;
}

const headIds = (h: DeckHead | null): string[] => (h ? h.library.parts.map((p) => p.id) : []);

/**
 * A compressed part opened: its saved sets and how long its JSON is — or null
 * for anything that is not a part. With an `id`, the content must hash to it.
 */
function inflatePart(gz: unknown, id?: string): { sets: unknown[]; chars: number } | null {
  if (typeof gz !== 'string' || gz.length === 0 || gz.length > PART_MAX_GZ) return null;
  try {
    const text = gunzipSync(Buffer.from(gz, 'base64'), {
      maxOutputLength: PART_MAX_INFLATED,
    }).toString('utf8');
    if (id !== undefined && partId(text) !== id) return null;
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? { sets: parsed, chars: text.length } : null;
  } catch {
    return null;
  }
}

export interface DeckRequest {
  method: string | undefined;
  /** `?v=2`: the caller speaks the library-in-parts protocol. */
  v2: boolean;
  /** `?part=<id>`: this request is about one part. */
  part: string | null;
  /** `?bare=1` on a read: the head only, no parts riding along — the caller
   *  already holds parts and will ask for the ones it lacks. */
  bare?: boolean;
  body: unknown;
}

type RouteAnswer = { status: number; json: unknown; allow?: string };

/**
 * `/api/decks`, as a function of a small KV interface, so the whole contract —
 * both protocols and the move between them — is tested against an in-memory
 * store (`tests/deckSyncV2.test.ts`).
 */
export async function deckRoute(
  req: DeckRequest,
  userId: string,
  kv: DeckKV,
  /** Is the caller an admin? Only asked when a request is over a limit. */
  isAdmin: () => Promise<boolean>,
): Promise<RouteAnswer> {
  const v1Key = keyFor(userId);
  const { method, v2, part, body } = req;
  if (part !== null && !PART_ID.test(part)) return { status: 400, json: { error: 'Bad part id' } };

  /* ── reading ─────────────────────────────────────────────────────────── */

  if (method === 'GET') {
    if (v2 && part !== null) {
      const rec = (await kv.get(partKey(userId, part))) as { gz?: unknown } | null;
      const gz = rec && typeof rec === 'object' && typeof rec.gz === 'string' ? rec.gz : null;
      return { status: 200, json: { found: gz !== null, gz } };
    }

    const head = asHead(await kv.get(headKey(userId)));

    if (v2) {
      if (!head) {
        const data = await kv.get(v1Key);
        return { status: 200, json: data != null ? { found: true, v: 1, data } : { found: false } };
      }
      // As many parts as fit ride along; the client asks for the rest. A
      // caller that holds parts already says so (`bare`) and gets none: on an
      // ordinary reload it needs none, and sending them anyway was the whole
      // library downloaded again on every page load.
      const inline: Record<string, string> = {};
      let spent = req.bare ? INLINE_BUDGET : 0;
      const ids = headIds(head);
      for (let i = 0; i < ids.length && spent < INLINE_BUDGET; i += 8) {
        const batch = ids.slice(i, i + 8);
        const recs = await kv.mget(batch.map((id) => partKey(userId, id)));
        for (let j = 0; j < batch.length; j++) {
          const gz = (recs[j] as { gz?: unknown } | null)?.gz;
          if (typeof gz !== 'string') continue;
          if (spent + gz.length > INLINE_BUDGET) {
            spent = INLINE_BUDGET;
            break;
          }
          inline[batch[j]] = gz;
          spent += gz.length;
        }
      }
      return {
        status: 200,
        json: {
          found: true,
          v: 2,
          data: {
            sets: head.sets,
            deckSlotCount: head.deckSlotCount,
            paletteFolders: head.paletteFolders,
          },
          library: head.library,
          inline,
        },
      };
    }

    // An old client. No head: exactly what it has always been given.
    if (!head) {
      const data = await kv.get(v1Key);
      return { status: 200, json: { found: data != null, data: data ?? null } };
    }
    // A head: the same document in the old shape, if it can be sent at all.
    const library: unknown[] = [];
    let size = 0;
    const ids = headIds(head);
    for (let i = 0; i < ids.length; i += 8) {
      const batch = ids.slice(i, i + 8);
      const recs = await kv.mget(batch.map((id) => partKey(userId, id)));
      for (let j = 0; j < batch.length; j++) {
        const opened = inflatePart((recs[j] as { gz?: unknown } | null)?.gz);
        if (!opened) return { status: 409, json: { error: 'unavailable' } };
        size += opened.chars;
        if (size > LEGACY_ASSEMBLE_MAX) return { status: 409, json: { error: 'upgrade_required' } };
        for (const s of opened.sets) library.push(s);
      }
    }
    return {
      status: 200,
      json: {
        found: true,
        data: {
          sets: head.sets,
          library,
          deckSlotCount: head.deckSlotCount,
          paletteFolders: head.paletteFolders,
        },
      },
    };
  }

  /* ── one part, uploaded ──────────────────────────────────────────────── */

  if (method === 'PUT' && v2 && part !== null) {
    const gz = (body as { gz?: unknown } | null)?.gz;
    if (typeof gz !== 'string') return { status: 400, json: { error: 'Not a library part' } };
    if (gz.length > PART_MAX_GZ) return { status: 413, json: { error: 'Part too large' } };
    const sets = inflatePart(gz, part)?.sets;
    if (
      !sets ||
      sets.length === 0 ||
      sets.length > LIBRARY_PART_MAX ||
      !sets.every((s) => s !== null && typeof s === 'object' && !Array.isArray(s))
    ) {
      return { status: 400, json: { error: 'Not a library part' } };
    }
    const index = (await kv.hgetall(partIndexKey(userId))) ?? {};
    if (!(part in index)) {
      const have = Object.keys(index).length;
      if (have >= PARTS_ABSOLUTE || (have >= PARTS_CAPPED && !(await isAdmin()))) {
        return { status: 413, json: { error: 'too_many_parts' } };
      }
    }
    // Record FIRST, index second: the index must never name a part that is
    // not stored — the commit trusts it.
    await kv.set(partKey(userId, part), { gz });
    await kv.hset(partIndexKey(userId), { [part]: sets.length });
    return { status: 200, json: { ok: true } };
  }

  /* ── the commit ──────────────────────────────────────────────────────── */

  if (method === 'PUT' && v2) {
    const b = (body ?? {}) as {
      sets?: unknown;
      deckSlotCount?: unknown;
      paletteFolders?: unknown;
      library?: { parts?: unknown };
    };
    if (JSON.stringify(b).length > MAX_BODY_BYTES) {
      return { status: 413, json: { error: 'Payload too large' } };
    }
    const ids = b.library?.parts;
    if (
      !b.sets ||
      typeof b.sets !== 'object' ||
      !Array.isArray(ids) ||
      ids.length > PARTS_ABSOLUTE ||
      !ids.every((id): id is string => typeof id === 'string' && PART_ID.test(id))
    ) {
      return { status: 400, json: { error: 'Not a deck document' } };
    }

    if (!(await kv.set(lockKey(userId), '1', { nx: true, ex: LOCK_SECONDS }))) {
      return { status: 423, json: { error: 'busy' } };
    }
    try {
      const index = (await kv.hgetall(partIndexKey(userId))) ?? {};
      const missing = [...new Set(ids.filter((id) => !(id in index)))];
      if (missing.length > 0) return { status: 409, json: { error: 'missing_parts', missing } };

      const parts = ids.map((id) => ({ id, n: Number(index[id]) || 0 }));
      const count = parts.reduce((sum, p) => sum + p.n, 0);
      if (count > SAVED_SET_LIMIT && !(await isAdmin())) {
        return { status: 413, json: { error: 'library_full', limit: SAVED_SET_LIMIT } };
      }

      const before = asHead(await kv.get(headKey(userId)));
      const beforeV1 = before ? null : await kv.get(v1Key);

      /* KEEP WHAT IS ABOUT TO BE DESTROYED — the same rule, and the same
         best-effort, as the old PUT below: only a commit that SHRINKS the
         library, and a failure here never fails the save. */
      try {
        if (before && before.library.count > count) {
          await kv.set(headShadowKey(userId), before, { ex: SHADOW_SECONDS });
        } else if (beforeV1 != null && libraryCount(beforeV1) > count) {
          await kv.set(shadowKeyFor(userId), beforeV1, { ex: SHADOW_SECONDS });
        }
        // The account's first commit in parts: its old value, kept for good,
        // BEFORE the head that supersedes it is written.
        if (!before && beforeV1 != null) await kv.set(preMoveKey(userId), beforeV1, { nx: true });
      } catch {
        /* ignore */
      }

      const head: DeckHead = {
        v: 2,
        sets: b.sets,
        deckSlotCount: b.deckSlotCount,
        paletteFolders: b.paletteFolders,
        library: { parts, count },
        at: new Date().toISOString(),
      };
      await kv.set(headKey(userId), head);

      // Housekeeping from here: the document is stored, nothing below may
      // fail the request.
      try {
        if (!before && beforeV1 != null) {
          /* The account's first commit in parts. The old value is what a
             rollback of this endpoint would read, so it is kept — for a
             while, not for ever. */
          await kv.expire(v1Key, V1_KEEP_SECONDS);
        }
        // Most commits leave nothing behind, and then the shadow is not read.
        const named = new Set(ids);
        const unnamed = Object.keys(index).filter((id) => !named.has(id));
        const kept =
          unnamed.length > 0
            ? new Set(headIds(asHead(await kv.get(headShadowKey(userId)))))
            : new Set<string>();
        const orphans = unnamed.filter((id) => !kept.has(id));
        if (orphans.length > 0) {
          // Index first: a part nobody lists is harmless, a listed part that
          // is gone is the one thing rule 1 forbids.
          await kv.hdel(partIndexKey(userId), orphans);
          await kv.del(orphans.map((id) => partKey(userId, id)));
        }
      } catch {
        /* ignore */
      }
      return { status: 200, json: { ok: true, count } };
    } finally {
      try {
        await kv.del([lockKey(userId)]);
      } catch {
        /* It expires on its own. */
      }
    }
  }

  /* ── an old client's whole-document PUT ──────────────────────────────── */

  if (method === 'PUT') {
    const payload = body ?? {};
    if (JSON.stringify(payload).length > MAX_BODY_BYTES) {
      return { status: 413, json: { error: 'Payload too large' } };
    }

    /* KEEP WHAT IS ABOUT TO BE DESTROYED. Only when the incoming payload
       holds FEWER saved sets than the stored one — a normal save adds or
       edits and is not worth a second write, while a shrink is the shape
       every loss so far has had. Deleting decks on purpose still works; the
       previous version is simply recoverable for a month afterwards.

       Best-effort on purpose: a failure here must never fail the user's
       save. Losing the shadow copy is a smaller harm than refusing to
       store the work they just did. */
    let head: DeckHead | null = null;
    try {
      head = asHead(await kv.get(headKey(userId)));
      if (head) {
        if (head.library.count > libraryCount(payload)) {
          await kv.set(headShadowKey(userId), head, { ex: SHADOW_SECONDS });
        }
      } else {
        const existing = await kv.get(v1Key);
        if (shouldKeepShadow(existing, payload)) {
          await kv.set(shadowKeyFor(userId), existing, { ex: SHADOW_SECONDS });
        }
      }
    } catch {
      /* ignore — see above */
    }

    await kv.set(v1Key, payload);
    /* The old shape is the account's document again. The parts stay where
       they are: the shadow head may name them, and the next commit in parts
       clears whatever nothing names. */
    if (head) await kv.del([headKey(userId)]);
    return { status: 200, json: { ok: true } };
  }

  /* POST = claim decks saved under a pre-Supabase login. Deliberately
     refuses to overwrite: someone who has already built decks on the new
     account should not lose them to a stale import they half-remember. */
  if (method === 'POST') {
    const { username, password } = (body ?? {}) as { username?: string; password?: string };
    if (!username || !password) {
      return { status: 400, json: { error: 'Username and password required' } };
    }
    if ((await kv.get(v1Key)) != null || (await kv.get(headKey(userId))) != null) {
      return { status: 409, json: { error: 'This account already has synced decks' } };
    }
    const legacy = await kv.get(legacyKey(username, password));
    if (legacy == null) {
      /* One answer for "no such login" and "that login had nothing", so this
         cannot be used to test whether an old username and password work. */
      return { status: 404, json: { error: 'Nothing found for that login' } };
    }
    await kv.set(v1Key, legacy);
    return { status: 200, json: { ok: true, claimed: true } };
  }

  return { status: 405, json: { error: 'Method not allowed' }, allow: 'GET, PUT, POST' };
}

function redisDeckKV(): DeckKV {
  const r = getRedis();
  return {
    get: (k) => r.get(k),
    mget: (keys) => (keys.length > 0 ? r.mget(...keys) : Promise.resolve([])),
    set: async (k, v, opts) => {
      const o: Record<string, unknown> = {};
      if (opts?.ex) o.ex = opts.ex;
      if (opts?.nx) o.nx = true;
      const res = await (Object.keys(o).length > 0 ? r.set(k, v, o as never) : r.set(k, v));
      return res !== null;
    },
    del: (keys) => (keys.length > 0 ? r.del(...keys) : Promise.resolve(0)),
    expire: (k, s) => r.expire(k, s),
    hgetall: (k) => r.hgetall(k),
    hset: (k, v) => r.hset(k, v),
    hdel: (k, fields) => (fields.length > 0 ? r.hdel(k, ...fields) : Promise.resolve(0)),
  };
}

/* ── who is an admin ─────────────────────────────────────────────────────────
 *
 * Asked of Supabase, with the caller's own token, through the one function
 * that defines a tier (`effective_tier`, 001/002 — it is what makes the owner
 * an admin whatever a row says). The publishable key is the same one the
 * browser holds; nothing secret is added to this function's environment.
 *
 * FAILS CLOSED: no key, Supabase unreachable or any other answer reads as "not
 * an admin", so the limit applies. For an admin over the limit that refuses
 * the upload, and `syncPolicy` then keeps the browser's copy and retries — a
 * delay, not a loss.
 *
 * Remembered per warm container, briefly: a "yes" for five minutes, a "no" for
 * one, so a promotion is felt within the minute.
 */

const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  '';

const adminSeen = new Map<string, { admin: boolean; until: number }>();

async function adminCheck(userId: string, token: string): Promise<boolean> {
  const hit = adminSeen.get(userId);
  if (hit && hit.until > Date.now()) return hit.admin;
  let admin = false;
  try {
    if (SUPABASE_URL && SUPABASE_KEY) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/effective_tier`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uid: userId }),
      });
      admin = res.ok && (await res.json()) === 'admin';
    }
  } catch {
    admin = false;
  }
  adminSeen.set(userId, { admin, until: Date.now() + (admin ? 300_000 : 60_000) });
  return admin;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!redisUrl || !redisToken) {
      res.status(500).json({ error: 'Sync storage is not configured' });
      return;
    }

    const userId = await callerFrom(req);
    if (!userId) {
      res.status(401).json({ error: 'Invalid credential' });
      return;
    }
    if (req.query?.doc === 'team-saves') {
      const id = typeof req.query.id === 'string' ? req.query.id : null;
      const out = await teamSaveRoute(req.method, id, req.body, userId, redisKV());
      if (out.allow) res.setHeader('Allow', out.allow);
      res.status(out.status).json(out.json);
      return;
    }

    /* The token again, for the one question only Supabase can answer. It was
       verified a few lines up; `callerFrom` hands back the id alone. */
    const token = String(req.headers?.authorization ?? '').slice('Bearer '.length).trim();
    const out = await deckRoute(
      {
        method: req.method,
        v2: req.query?.v === '2',
        part: typeof req.query?.part === 'string' ? req.query.part : null,
        bare: req.query?.bare === '1',
        body: req.body,
      },
      userId,
      redisDeckKV(),
      () => adminCheck(userId, token),
    );
    if (out.allow) res.setHeader('Allow', out.allow);
    res.status(out.status).json(out.json);
  } catch {
    /* No `detail`. An earlier version returned `err.message`, which shipped an
       absolute filesystem path to the browser on a storage failure. */
    res.status(500).json({ error: 'Sync failed' });
  }
}
