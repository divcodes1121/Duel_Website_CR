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
import { createRemoteJWKSet, jwtVerify } from 'jose';

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/*
 * SUPABASE TOKENS, NOT sha256(username:password).
 *
 * This file used to carry the twenty test accounts inline -- a Map of
 * sha256(username:password) to "royal01".."royal20", mirroring
 * `src/data/users.json`. That scheme is gone from the whole project: it could
 * not describe anyone who signed themselves up, and a password derivative used
 * as a bearer credential never expires and cannot be revoked without changing
 * the password.
 *
 * VERIFIED LOCALLY, exactly as `api/decks.ts` does it, and INLINED for the same
 * reason: package.json is `"type": "module"`, so Vercel runs these as ESM, and
 * Node ESM does not resolve extensionless relative imports. A shared `./_auth`
 * typechecks under `moduleResolution: "Bundler"` and then dies at module load
 * with an uncatchable FUNCTION_INVOCATION_FAILED.
 */

function supabaseUrl(): string {
  return process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
}

/* CACHED, BUT NOT BUILT AT MODULE LOAD. A warm container still fetches the
   JWKS once rather than per request -- and re-fetches only when a token
   arrives bearing an unseen `kid`, which is what lets Supabase rotate signing
   keys without a redeploy here. Doing it lazily rather than at import time
   also means the environment can be set by a test before first use, which an
   eager `const` at module scope makes impossible. */
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let _jwksFor = '';

function keys(): ReturnType<typeof createRemoteJWKSet> | null {
  const url = supabaseUrl();
  if (!url) return null;
  if (!_jwks || _jwksFor !== url) {
    _jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
    _jwksFor = url;
  }
  return _jwks;
}

/** The signed-in account id, from the same bearer token `api/decks.ts` uses. */
export async function accountFor(
  req: Pick<VercelRequest, 'headers'>,
): Promise<string | null> {
  const jwks = keys();
  if (!jwks) return null;
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${supabaseUrl()}/auth/v1`,
      /* Supabase puts `authenticated` in `aud` for a signed-in user. Pinning it
         stops a token minted for another audience being replayed here. */
      audience: 'authenticated',
    });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    /* Expired, wrong signature, wrong issuer, malformed -- one answer. The
       difference is only useful to someone probing. */
    return null;
  }
}

/**
 * Who may reach the engine, from `OIE_ALLOWLIST`.
 *
 * NOW A LIST OF SUPABASE USER IDS OR EMAILS, not usernames -- there are no
 * usernames any more. Both are accepted because a uuid is what the system
 * knows and an email is what a person can actually paste into Vercel; the
 * caller passes whichever it has.
 *
 * Empty means NOBODY, and that is deliberate: the engine is off, and an
 * allowlist that defaults to everyone is not an allowlist.
 */
export function isAllowed(account: string | null): boolean {
  if (!account) return false;
  const raw = process.env.OIE_ALLOWLIST ?? '';
  const allowed = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(account.toLowerCase());
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

    // `await` now: the token is verified against Supabase's JWKS rather than
    // looked up in a Map of twenty hardcoded hashes.
    const account = await accountFor(req);
    if (!account) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    // Not on the list is not an error — it is the feature being off for you,
    // which is exactly what `enabled: false` already means to the client.
    if (!isAllowed(account)) {
      res.status(200).json(DISABLED);
      return;
    }

    if (!(await sharedRateLimit(account))) {
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
