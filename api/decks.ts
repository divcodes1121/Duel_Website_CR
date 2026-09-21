import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { createHash } from 'node:crypto';
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
function teamSaveFrom(body: unknown, id: string): { record: Record<string, unknown>; meta: TeamSaveMeta } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.id !== id) return null;
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) return null;
  if (typeof b.savedAt !== 'string' || Number.isNaN(Date.parse(b.savedAt))) return null;
  if (typeof b.blueText !== 'string' || typeof b.redText !== 'string') return null;
  const r = b.report as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== 'object') return null;
  if (!Array.isArray(r.folders) || !Array.isArray(r.blue) || !Array.isArray(r.red)) return null;
  return {
    // Only the fields a save has. Anything else a client sends is not stored.
    record: { id, name: b.name, savedAt: b.savedAt, blueText: b.blueText, redText: b.redText, report: r },
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

    const key = keyFor(userId);

    if (req.method === 'GET') {
      const data = await getRedis().get(key);
      res.status(200).json({ found: data != null, data: data ?? null });
      return;
    }

    if (req.method === 'PUT') {
      const payload = req.body ?? {};
      if (JSON.stringify(payload).length > MAX_BODY_BYTES) {
        res.status(413).json({ error: 'Payload too large' });
        return;
      }
      await getRedis().set(key, payload);
      res.status(200).json({ ok: true });
      return;
    }

    /* POST = claim decks saved under a pre-Supabase login. Deliberately
       refuses to overwrite: someone who has already built decks on the new
       account should not lose them to a stale import they half-remember. */
    if (req.method === 'POST') {
      const { username, password } = (req.body ?? {}) as {
        username?: string;
        password?: string;
      };
      if (!username || !password) {
        res.status(400).json({ error: 'Username and password required' });
        return;
      }
      const existing = await getRedis().get(key);
      if (existing != null) {
        res.status(409).json({ error: 'This account already has synced decks' });
        return;
      }
      const legacy = await getRedis().get(legacyKey(username, password));
      if (legacy == null) {
        /* One answer for "no such login" and "that login had nothing", so this
           cannot be used to test whether an old username and password work. */
        res.status(404).json({ error: 'Nothing found for that login' });
        return;
      }
      await getRedis().set(key, legacy);
      res.status(200).json({ ok: true, claimed: true });
      return;
    }

    res.setHeader('Allow', 'GET, PUT, POST');
    res.status(405).json({ error: 'Method not allowed' });
  } catch {
    /* No `detail`. An earlier version returned `err.message`, which shipped an
       absolute filesystem path to the browser on a storage failure. */
    res.status(500).json({ error: 'Sync failed' });
  }
}
