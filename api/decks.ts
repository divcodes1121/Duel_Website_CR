import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import users from '../src/data/users.json';

const MAX_BODY_BYTES = 250_000;
const KNOWN_HASHES = new Set((users as { hash: string }[]).map((u) => u.hash));

// Reads KV_REST_API_URL/TOKEN (Vercel Marketplace Upstash integration) with
// automatic fallback to UPSTASH_REDIS_REST_URL/TOKEN.
const redis = Redis.fromEnv();

/**
 * The credential is sha256(username:password), already computed client-side
 * for login (see state/authStore.ts). Requiring it here — and checking it
 * against the same bundled hash list — means only someone who knows a real
 * account's password can read or write that account's deck data, without a
 * separate session/token system. Consistent with this project's existing
 * "test gate, not real security" model.
 */
function credentialFrom(req: VercelRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const hash = header.slice('Bearer '.length).trim();
  return /^[a-f0-9]{64}$/i.test(hash) && KNOWN_HASHES.has(hash) ? hash : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const credential = credentialFrom(req);
  if (!credential) {
    res.status(401).json({ error: 'Invalid credential' });
    return;
  }
  const key = `deck-data:${credential}`;

  if (req.method === 'GET') {
    const data = await redis.get(key);
    res.status(200).json({ found: data != null, data: data ?? null });
    return;
  }

  if (req.method === 'PUT') {
    const payload = req.body ?? {};
    if (JSON.stringify(payload).length > MAX_BODY_BYTES) {
      res.status(413).json({ error: 'Payload too large' });
      return;
    }
    await redis.set(key, payload);
    res.status(200).json({ ok: true });
    return;
  }

  res.setHeader('Allow', 'GET, PUT');
  res.status(405).json({ error: 'Method not allowed' });
}
