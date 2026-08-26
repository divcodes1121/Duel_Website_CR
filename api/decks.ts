import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const MAX_BODY_BYTES = 250_000;

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
