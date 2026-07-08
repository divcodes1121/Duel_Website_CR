import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const MAX_BODY_BYTES = 250_000;

// Account credential hashes — mirrors src/data/users.json. Inlined (not
// imported) on purpose: the project is `"type": "module"`, and a plain JSON
// import from outside the api/ dir throws at module load in Vercel's ESM Node
// runtime (uncatchable FUNCTION_INVOCATION_FAILED). Keep in sync if accounts
// change (regenerate via scripts/generate-test-users.mjs).
const KNOWN_HASHES = new Set<string>([
  '0f9473eb049cd9abafd1dcd6fc4df45437dc33498ecd48ebac1742618394bdb5',
  'f6e03fa89d9087a4b6a460a2fc50739a063963c0df6ddb4072af9ec8e0b1375a',
  'c38e3af386b22f699fcc3d13935dc501fe23597e84fb9ae93cbbb86adac55a5d',
  '2c76d6f28996991db5f7502ae4aa6ade5d5475148c8b7e51c5189fa169368919',
  '09aa6805394ef898a036c07a828abcfe2daa7d8a57a0b27724f41b7f77d3a6ab',
  'f50489ae47bff97272f947278b02e007cdf3c1e0afc84bf90e1b7ce3a0a4bb2c',
  '3b9abd2e66025d95e2f59dc1743417b1d30cb4452aaf25468ca42713345c2610',
  'dc8dbf9b58d76c1c03e298b075c60cc063925202523dcf3a5cee3dad05552cb9',
  '2bb8c16f262a01de4659e2f50c691ef9bb6a00456d84a61c32a9690c8b5cf4a4',
  '2d4b4cf7379ec7358d20cbfacdde8713e3b1178a9f06d5600b9a56ca166fdc6f',
  '8b1f5f17ced64767c32a6dc691f40ff84dd583c111a06409160ddcc7404196e6',
  'b8b1b002fadd34da35dbc102bb074f62a05476e2df34bb1c7d458aaec57bad20',
  'd50e02cc0271b60809eaa9f61297d5c4e4e6cae19fbd79ecf8dbabef9b38ffd9',
  '77091351abc868a5b464ba4d1c73c07945bc19a67ec003777337244be2e2435b',
  'deb8e4533310eddc4d73190cb4aa8a1673b8a4e6db972ea9c6a7554a36e4ccb8',
  '8f34142b691d16ff2c613c89deaf0e9b0cb93708f525e4c1ba69f325daeaaf4b',
  '407744fc81fdcf59e175c03e185f9e4210816af2b0472b61f1357f2ddcf874fe',
  'a0eaddce2e90242f0f6c11338868a806f52c408b70a029e88d5a5577344c0a71',
  '85ed85d7bd0465ab52098d893d7a7be4e39b4ab9cb0bb6f53daae06e39d5c7ac',
  'c97204571a25f62d4426a502425998c2c81867c6e2363875f0683814f4bb8a92',
]);

// The Vercel Marketplace Upstash integration injects KV_REST_API_URL/TOKEN.
// (Redis.fromEnv() only reads UPSTASH_REDIS_REST_*, which it does NOT create.)
const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) redis = new Redis({ url: redisUrl!, token: redisToken! });
  return redis;
}

/**
 * The credential is sha256(username:password), already computed client-side
 * for login (see state/authStore.ts). Requiring it here — and checking it
 * against the known-account hash list — means only someone who knows a real
 * account's password can read or write that account's deck data.
 */
function credentialFrom(req: VercelRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const hash = header.slice('Bearer '.length).trim();
  return /^[a-f0-9]{64}$/i.test(hash) && KNOWN_HASHES.has(hash) ? hash : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!redisUrl || !redisToken) {
      res.status(500).json({ error: 'Sync storage is not configured' });
      return;
    }

    const credential = credentialFrom(req);
    if (!credential) {
      res.status(401).json({ error: 'Invalid credential' });
      return;
    }
    const key = `deck-data:${credential}`;

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

    res.setHeader('Allow', 'GET, PUT');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Sync failed', detail: err instanceof Error ? err.message : String(err) });
  }
}
