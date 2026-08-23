/**
 * Phase 24C, step 3 — the same-origin analytics proxy.
 *
 *   browser → /api/analytics/opponent-read/<tag>   (same origin, no key)
 *           → this function                        (adds X-Analytics-Key)
 *           → ANALYTICS_ORIGIN                     (a tunnel, later)
 *           → 127.0.0.1 Python                     (step 2's boundary)
 *           → SQLite
 *
 * The browser never learns the upstream key or even the upstream hostname.
 * Both come from server-only environment variables — deliberately NOT named
 * `VITE_*`, because Vite inlines anything so prefixed straight into the
 * client bundle.
 *
 * SELF-CONTAINED ON PURPOSE. `api/decks.ts` carries the same duplicated
 * account list for a reason recorded in CLAUDE.md: this project is
 * `"type": "module"`, and a module-load failure inside a Vercel function is an
 * uncatchable FUNCTION_INVOCATION_FAILED with no useful log. A shared import
 * is not worth re-learning that. The pure helpers are exported by name so the
 * tests can reach them without a second file.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * sha256(username:password) → username, mirroring `src/data/users.json`.
 * `api/decks.ts` holds the same hashes as a Set; regenerate both with
 * `scripts/generate-test-users.mjs` if the accounts change.
 */
const ACCOUNTS = new Map<string, string>([
  ['0f9473eb049cd9abafd1dcd6fc4df45437dc33498ecd48ebac1742618394bdb5', 'royal01'],
  ['f6e03fa89d9087a4b6a460a2fc50739a063963c0df6ddb4072af9ec8e0b1375a', 'royal02'],
  ['c38e3af386b22f699fcc3d13935dc501fe23597e84fb9ae93cbbb86adac55a5d', 'royal03'],
  ['2c76d6f28996991db5f7502ae4aa6ade5d5475148c8b7e51c5189fa169368919', 'royal04'],
  ['09aa6805394ef898a036c07a828abcfe2daa7d8a57a0b27724f41b7f77d3a6ab', 'royal05'],
  ['f50489ae47bff97272f947278b02e007cdf3c1e0afc84bf90e1b7ce3a0a4bb2c', 'royal06'],
  ['3b9abd2e66025d95e2f59dc1743417b1d30cb4452aaf25468ca42713345c2610', 'royal07'],
  ['dc8dbf9b58d76c1c03e298b075c60cc063925202523dcf3a5cee3dad05552cb9', 'royal08'],
  ['2bb8c16f262a01de4659e2f50c691ef9bb6a00456d84a61c32a9690c8b5cf4a4', 'royal09'],
  ['2d4b4cf7379ec7358d20cbfacdde8713e3b1178a9f06d5600b9a56ca166fdc6f', 'royal10'],
  ['8b1f5f17ced64767c32a6dc691f40ff84dd583c111a06409160ddcc7404196e6', 'royal11'],
  ['b8b1b002fadd34da35dbc102bb074f62a05476e2df34bb1c7d458aaec57bad20', 'royal12'],
  ['d50e02cc0271b60809eaa9f61297d5c4e4e6cae19fbd79ecf8dbabef9b38ffd9', 'royal13'],
  ['77091351abc868a5b464ba4d1c73c07945bc19a67ec003777337244be2e2435b', 'royal14'],
  ['deb8e4533310eddc4d73190cb4aa8a1673b8a4e6db972ea9c6a7554a36e4ccb8', 'royal15'],
  ['8f34142b691d16ff2c613c89deaf0e9b0cb93708f525e4c1ba69f325daeaaf4b', 'royal16'],
  ['407744fc81fdcf59e175c03e185f9e4210816af2b0472b61f1357f2ddcf874fe', 'royal17'],
  ['a0eaddce2e90242f0f6c11338868a806f52c408b70a029e88d5a5577344c0a71', 'royal18'],
  ['85ed85d7bd0465ab52098d893d7a7be4e39b4ab9cb0bb6f53daae06e39d5c7ac', 'royal19'],
  ['c97204571a25f62d4426a502425998c2c81867c6e2363875f0683814f4bb8a92', 'royal20'],
]);

/** The signed-in account, from the same bearer credential `api/decks.ts` uses. */
export function accountFor(req: Pick<VercelRequest, 'headers'>): string | null {
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const hash = header.slice('Bearer '.length).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  return ACCOUNTS.get(hash) ?? null;
}

/**
 * Who may reach the engine, from `OIE_ALLOWLIST` (comma-separated usernames).
 *
 * Empty means NOBODY. That is the deliberate default: the engine is off, and
 * an allowlist that defaults to everyone is not an allowlist. Step 5 widens
 * this; step 3 only has to prove the gate exists and holds.
 */
export function isAllowed(username: string | null): boolean {
  if (!username) return false;
  const raw = process.env.OIE_ALLOWLIST ?? '';
  const allowed = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(username.toLowerCase());
}

// ---------------------------------------------------------------------------
// The one piece of browser input
// ---------------------------------------------------------------------------

/**
 * The 14-symbol Supercell alphabet, matching `clash_data.normalize_tag`.
 *
 * This is the ONLY value the browser contributes to the upstream URL, so it is
 * validated against an allowlist of characters rather than escaped. A tag that
 * does not match this shape cannot exist, so rejecting it costs nothing and
 * makes path traversal and query injection unrepresentable rather than merely
 * encoded away.
 */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const body = raw.trim().replace(/^%23/i, '').replace(/^#/, '').toUpperCase();
  if (body.length < 5 || body.length > 12) return null;
  if (!/^[0289PYLQGRJCUV]+$/.test(body)) return null;
  return `#${body}`;
}

/**
 * The upstream URL, built entirely server-side.
 *
 * There is no `?url=` parameter and no way for the browser to influence the
 * host: the origin comes from the environment, the path is a literal, and the
 * only interpolated value has already been reduced to 5–12 characters of a
 * 14-symbol alphabet. The re-parse at the end is belt and braces — if anything
 * ever made the assembled URL point somewhere else, the origin check catches
 * it before a request goes out.
 */
export function upstreamUrl(tag: string): string | null {
  const origin = (process.env.ANALYTICS_ORIGIN ?? '').trim();
  if (!origin) return null;
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;

  const url = new URL(
    `/api/analytics/coach/opponent-read/${encodeURIComponent(tag)}`,
    base,
  );
  if (url.origin !== base.origin) return null;
  return url.toString();
}

// ---------------------------------------------------------------------------
// Response sanitisation
// ---------------------------------------------------------------------------

export interface OpponentAlternative {
  cards: string[];
  out: string[];
  in: string[];
  confidence: string;
  evidence: string[];
}

export interface OpponentRead {
  primary: { cards: string[]; confidence?: string; basis: string };
  alternatives: OpponentAlternative[];
  note: string;
  degraded: boolean;
  bandShown: boolean;
}

const BANDS = new Set(['high', 'medium', 'low']);
const CARD = /^[a-z0-9-]{1,40}$/;
const MAX_ALTERNATIVES = 3;

/**
 * Keys that must never appear anywhere in an upstream payload.
 *
 * Rebuilding the response field by field already means an unknown key cannot
 * be copied through. This is the second question: if one of these is PRESENT,
 * the thing upstream is not the engine this proxy was written against —
 * `changeProbability` was removed in Phase 23 — and the right response to an
 * unrecognised peer is to stop, not to filter it and carry on.
 */
const FORBIDDEN_KEYS = new Set([
  'changeprobability', 'weights', 'features', 'featurenames', 'logit', 'logits',
  'score', 'scores', 'probability', 'artifact', 'model', 'modelversion',
  'cluster', 'clusters', 'rows', 'battles', 'path', 'dbpath', 'apikey',
  'traceback', 'detail', 'bandaccuracy', 'expectedaccuracy',
]);

/** Text that means something internal has leaked into a user-facing string. */
const LEAK = /([A-Za-z]:[\\/])|(\/(?:home|root|var|usr|etc|proc)\/)|(\.db\b)|(\.sqlite)|Traceback|File "|Exception|__pycache__/i;

function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => hasForbiddenKey(v, depth + 1));
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) return true;
    if (hasForbiddenKey(v, depth + 1)) return true;
  }
  return false;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  if (value.length > max) return null;
  if (LEAK.test(value)) return null;
  return value;
}

function cleanCards(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: string[] = [];
  for (const c of value) {
    if (typeof c !== 'string' || !CARD.test(c)) return null;
    out.push(c);
  }
  return out;
}

/**
 * Rebuild the read from scratch, or refuse it.
 *
 * Two different failure modes, handled differently on purpose:
 *
 *   - a MALFORMED payload (wrong types, bad card keys, forbidden keys, leaked
 *     text) returns null, and the caller answers `disabled`. Fail closed.
 *   - a payload that is well-formed but violates a DISPLAY invariant — a
 *     degraded read carrying alternatives, a band on a domain that must not
 *     show one — is corrected here. Those invariants exist so the user is not
 *     shown something unsupported, and stripping achieves that. Refusing the
 *     whole read would turn a cosmetic upstream regression into an outage.
 */
export function sanitizeRead(raw: unknown): OpponentRead | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (hasForbiddenKey(raw)) return null;

  const r = raw as Record<string, unknown>;
  const primaryRaw = r.primary;
  if (!primaryRaw || typeof primaryRaw !== 'object' || Array.isArray(primaryRaw)) return null;
  const p = primaryRaw as Record<string, unknown>;

  const cards = cleanCards(p.cards, 8);
  if (!cards || cards.length === 0) return null;

  const basis = cleanText(p.basis, 40);
  if (basis === null || !/^[a-z-]{1,40}$/.test(basis)) return null;

  if (typeof r.degraded !== 'boolean' || typeof r.bandShown !== 'boolean') return null;
  const note = cleanText(r.note ?? '', 400);
  if (note === null) return null;

  const degraded = r.degraded;
  const bandShown = r.bandShown;

  const primary: OpponentRead['primary'] = { cards, basis };
  if (bandShown) {
    // Absent is legal; present-but-not-a-band is not.
    if (p.confidence !== undefined) {
      if (typeof p.confidence !== 'string' || !BANDS.has(p.confidence)) return null;
      primary.confidence = p.confidence;
    }
  }

  let alternatives: OpponentAlternative[] = [];
  if (r.alternatives !== undefined) {
    if (!Array.isArray(r.alternatives)) return null;
    if (r.alternatives.length > MAX_ALTERNATIVES) return null;
    for (const aRaw of r.alternatives) {
      if (!aRaw || typeof aRaw !== 'object' || Array.isArray(aRaw)) return null;
      const a = aRaw as Record<string, unknown>;
      const aCards = cleanCards(a.cards, 8);
      const out = cleanCards(a.out, 8);
      const inn = cleanCards(a.in, 8);
      if (!aCards || !out || !inn) return null;
      if (typeof a.confidence !== 'string' || !BANDS.has(a.confidence)) return null;
      if (!Array.isArray(a.evidence) || a.evidence.length > 6) return null;
      const evidence: string[] = [];
      for (const e of a.evidence) {
        const text = cleanText(e, 200);
        if (text === null) return null;
        evidence.push(text);
      }
      alternatives.push({ cards: aCards, out, in: inn, confidence: a.confidence, evidence });
    }
  }

  // The display invariants, enforced here rather than trusted.
  if (degraded || !bandShown) alternatives = [];
  if (!bandShown) delete primary.confidence;

  return { primary, alternatives, note, degraded, bandShown };
}

/** The whole `{enabled, read}` envelope. Null means answer `disabled`. */
export function sanitizeEnvelope(raw: unknown): { enabled: boolean; read: OpponentRead | null } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== 'boolean') return null;
  if (!r.enabled || r.read === null || r.read === undefined) {
    return { enabled: false, read: null };
  }
  const read = sanitizeRead(r.read);
  if (!read) return null;
  return { enabled: true, read };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Per ACCOUNT, not per IP: the account is the thing being rated, and the 20
 * testers may well share a network.
 *
 * 30 requests a minute is generous for a human answering the Coach's interview
 * one question at a time, and it sits well under step 2's 120/60 s backstop, so
 * the proxy is what sheds first and the Python service is what survives.
 */
export const RATE_LIMIT = Number(process.env.OIE_RATE_LIMIT ?? 30);
export const RATE_WINDOW_S = 60;

const memoryHits = new Map<string, { slot: number; count: number }>();
const MAX_TRACKED = 512;

/**
 * The local half of the limiter.
 *
 * On its own this is weak — Vercel runs many instances and recycles them, so
 * each cold start forgets everything. It is a backstop for when Redis is not
 * configured or is unreachable, not the primary control.
 */
/** How many clients the local table is holding. Exported for the bound test. */
export function trackedClients(): number {
  return memoryHits.size;
}

/** Clear the local table. Tests only -- a shared module-level map would
 *  otherwise let one test spend another's budget. */
export function resetRateLimiter(): void {
  memoryHits.clear();
}

export function memoryRateLimit(key: string, now = Date.now()): boolean {
  const slot = Math.floor(now / 1000 / RATE_WINDOW_S);
  const entry = memoryHits.get(key);
  if (!entry || entry.slot !== slot) {
    if (memoryHits.size >= MAX_TRACKED) {
      for (const [k, v] of memoryHits) if (v.slot !== slot) memoryHits.delete(k);
      if (memoryHits.size >= MAX_TRACKED) memoryHits.clear();
    }
    memoryHits.set(key, { slot, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

/**
 * The shared counter, in the Upstash instance the project already runs for
 * deck sync. INCR + EXPIRE is one round trip's worth of state and is correct
 * across instances, which the in-memory map cannot be.
 *
 * A Redis failure falls back to the local map rather than failing the request:
 * losing the rate limiter should not take out the feature it protects, and the
 * Python service is still holding its own limit underneath.
 */
async function sharedRateLimit(key: string): Promise<boolean> {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return memoryRateLimit(key);
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url, token });
    const slot = Math.floor(Date.now() / 1000 / RATE_WINDOW_S);
    const bucket = `oie-rate:${key}:${slot}`;
    const count = await redis.incr(bucket);
    if (count === 1) await redis.expire(bucket, RATE_WINDOW_S * 2);
    return count <= RATE_LIMIT;
  } catch {
    return memoryRateLimit(key);
  }
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

/** Everything the browser is ever told when a read cannot be produced. */
const DISABLED = { enabled: false, read: null } as const;

export const UPSTREAM_TIMEOUT_MS = 5000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Same-origin by construction: no CORS headers, deliberately. A browser on
  // another origin has no business here and should be stopped by the absence
  // of permission rather than by a check.
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const username = accountFor(req);
    if (!username) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    // Not on the list is not an error — it is the feature being off for you,
    // which is exactly what `enabled: false` already means to the client.
    if (!isAllowed(username)) {
      res.status(200).json(DISABLED);
      return;
    }

    if (!(await sharedRateLimit(username))) {
      res.setHeader('Retry-After', String(RATE_WINDOW_S));
      res.status(429).json({ error: 'rate_limited' });
      return;
    }

    const raw = (req.query?.tag ?? '') as string | string[];
    const tag = normalizeTag(Array.isArray(raw) ? raw[0] : raw);
    if (!tag) {
      res.status(400).json({ error: 'invalid_tag' });
      return;
    }

    const url = upstreamUrl(tag);
    if (!url) {
      // Nothing configured upstream yet. That is the normal state today.
      res.status(200).json(DISABLED);
      return;
    }

    const key = process.env.CLASH_API_KEY ?? '';
    if (!key) {
      res.status(200).json(DISABLED);
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: Response;
    try {
      // Nothing from the browser's request is forwarded. Not its headers, not
      // its cookies, not its query string — only the tag, already reduced to
      // the Supercell alphabet, and the key the browser never saw.
      upstream = await fetch(url, {
        method: 'GET',
        headers: { 'X-Analytics-Key': key, Accept: 'application/json' },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      // 401/403/429/500 upstream all mean the same thing to the browser: no
      // read. Distinguishing them here would publish the state of the private
      // service to anyone with an account.
      res.status(200).json(DISABLED);
      return;
    }

    let body: unknown;
    try {
      body = await upstream.json();
    } catch {
      res.status(200).json(DISABLED);
      return;
    }

    const clean = sanitizeEnvelope(body);
    res.status(200).json(clean ?? DISABLED);
  } catch {
    // Includes the abort. No message, no cause, no upstream URL.
    res.status(200).json(DISABLED);
  }
}
