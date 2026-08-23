/**
 * Phase 24C, step 3 — the same-origin analytics proxy.
 *
 * The upstream is faked throughout; nothing here needs a tunnel, a Python
 * process or a database. What is being tested is the boundary: who may call,
 * what reaches upstream, and what is allowed back out.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import handler, {
  RATE_LIMIT,
  accountFor,
  isAllowed,
  memoryRateLimit,
  normalizeTag,
  resetRateLimiter,
  sanitizeEnvelope,
  sanitizeRead,
  trackedClients,
  upstreamUrl,
} from '../api/analytics/opponent-read/[tag]';

const KEY = 'upstream-secret-do-not-leak';
const ORIGIN = 'https://analytics.example.test';
// royal01's credential, from src/data/users.json.
const CRED = '0f9473eb049cd9abafd1dcd6fc4df45437dc33498ecd48ebac1742618394bdb5';
const CRED20 = 'c97204571a25f62d4426a502425998c2c81867c6e2363875f0683814f4bb8a92';
const TAG = 'Y022GRCJQ';

/** A well-formed upstream read, matching `opponent-read-v2`. */
function goodRead(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    read: {
      primary: { cards: ['knight', 'musketeer'], basis: 'recent', confidence: 'high' },
      alternatives: [{
        cards: ['knight', 'wizard'], out: ['musketeer'], in: ['wizard'],
        confidence: 'medium', evidence: ['played this 4 times last week'],
      }],
      note: '',
      degraded: false,
      bandShown: true,
      ...over,
    },
  };
}

interface FakeRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

function mockRes() {
  const res: FakeRes & { status: (n: number) => typeof res; json: (b: unknown) => void;
    setHeader: (k: string, v: string) => void } = {
    statusCode: 0, body: undefined, headers: {},
    status(n) { res.statusCode = n; return res; },
    json(b) { res.body = b; },
    setHeader(k, v) { res.headers[k] = v; },
  };
  return res;
}

function mockReq(over: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    headers: { authorization: `Bearer ${CRED}` },
    query: { tag: TAG },
    ...over,
  };
}

/** Run the handler with a faked upstream; returns the response and the fetch spy. */
async function call(
  reqOver: Record<string, unknown> = {},
  fetchImpl?: (url: string, init: RequestInit) => Promise<unknown>,
) {
  const spy = vi.fn(fetchImpl ?? (async () => ({
    ok: true, status: 200, json: async () => goodRead(),
  })));
  vi.stubGlobal('fetch', spy);
  const res = mockRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await handler(mockReq(reqOver) as any, res as any);
  return { res, spy };
}

beforeEach(() => {
  resetRateLimiter();
  process.env.ANALYTICS_ORIGIN = ORIGIN;
  process.env.CLASH_API_KEY = KEY;
  process.env.OIE_ALLOWLIST = 'royal01';
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('accounts and the allowlist', () => {
  it('maps a known credential to its account', () => {
    expect(accountFor({ headers: { authorization: `Bearer ${CRED}` } })).toBe('royal01');
    expect(accountFor({ headers: { authorization: `Bearer ${CRED20}` } })).toBe('royal20');
  });

  it('rejects an unknown, malformed or missing credential', () => {
    expect(accountFor({ headers: {} })).toBeNull();
    expect(accountFor({ headers: { authorization: 'Bearer ' + 'a'.repeat(64) } })).toBeNull();
    expect(accountFor({ headers: { authorization: 'Bearer nope' } })).toBeNull();
    expect(accountFor({ headers: { authorization: CRED } })).toBeNull();
  });

  it('allows only listed accounts, case-insensitively', () => {
    process.env.OIE_ALLOWLIST = 'royal01, ROYAL20 ';
    expect(isAllowed('royal01')).toBe(true);
    expect(isAllowed('royal20')).toBe(true);
    expect(isAllowed('royal02')).toBe(false);
  });

  it('defaults to nobody', () => {
    delete process.env.OIE_ALLOWLIST;
    expect(isAllowed('royal01')).toBe(false);
    process.env.OIE_ALLOWLIST = '';
    expect(isAllowed('royal01')).toBe(false);
    expect(isAllowed(null)).toBe(false);
  });

  it('lets an allowlisted account through to upstream', async () => {
    const { res, spy } = await call();
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
    expect((res.body as { enabled: boolean }).enabled).toBe(true);
  });

  it('answers a non-allowlisted account with enabled:false and calls nothing', async () => {
    process.env.OIE_ALLOWLIST = 'royal20';
    const { res, spy } = await call();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ enabled: false, read: null });
    expect(spy).not.toHaveBeenCalled();
  });

  it('answers 401 with no session, and never calls upstream', async () => {
    const { res, spy } = await call({ headers: {} });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses non-GET methods', async () => {
    const { res, spy } = await call({ method: 'POST' });
    expect(res.statusCode).toBe(405);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('SSRF and upstream construction', () => {
  it('takes the origin only from the environment', () => {
    expect(upstreamUrl('#Y022GRCJQ'))
      .toBe(`${ORIGIN}/api/analytics/coach/opponent-read/%23Y022GRCJQ`);
  });

  it('returns null when no origin is configured', () => {
    delete process.env.ANALYTICS_ORIGIN;
    expect(upstreamUrl('#Y022GRCJQ')).toBeNull();
  });

  it('refuses a non-http origin', () => {
    for (const bad of ['file:///etc/passwd', 'gopher://x', 'not a url', 'ftp://h/']) {
      process.env.ANALYTICS_ORIGIN = bad;
      expect(upstreamUrl('#Y022GRCJQ')).toBeNull();
    }
  });

  it('ignores any browser-supplied url, host or path', async () => {
    const { spy } = await call({
      query: { tag: TAG, url: 'http://169.254.169.254/latest/meta-data/',
               origin: 'http://evil.test', host: 'evil.test' },
    });
    const called = spy.mock.calls[0][0] as string;
    expect(called.startsWith(`${ORIGIN}/api/analytics/coach/opponent-read/`)).toBe(true);
    expect(called).not.toContain('169.254');
    expect(called).not.toContain('evil.test');
  });

  it('cannot be steered by a hostile tag', async () => {
    const hostile = ['../../../../etc/passwd', 'Y022GRCJQ/../../admin',
                     'Y022GRCJQ?x=1', 'Y022GRCJQ#frag', 'http://evil.test/',
                     '//evil.test', 'Y022GRCJQ%2F..%2Fadmin'];
    for (const tag of hostile) {
      const { res, spy } = await call({ query: { tag } });
      expect(res.statusCode, tag).toBe(400);
      expect(spy, tag).not.toHaveBeenCalled();
    }
  });

  it('accepts only the Supercell alphabet', () => {
    expect(normalizeTag('y022grcjq')).toBe('#Y022GRCJQ');
    expect(normalizeTag('#Y022GRCJQ')).toBe('#Y022GRCJQ');
    expect(normalizeTag('%23Y022GRCJQ')).toBe('#Y022GRCJQ');
    for (const bad of ['', 'ABC', 'Y022GRCJQZZZZZZ', 'Y022-GRCJQ', 'IIIII', null, 42]) {
      expect(normalizeTag(bad as unknown)).toBeNull();
    }
  });

  it('forwards no browser headers upstream', async () => {
    const { spy } = await call({
      headers: {
        authorization: `Bearer ${CRED}`,
        cookie: 'session=abc',
        'x-forwarded-for': '10.0.0.1',
        'x-analytics-key': 'attacker-supplied',
        origin: 'https://evil.test',
      },
    });
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual(['Accept', 'X-Analytics-Key']);
    expect(headers['X-Analytics-Key']).toBe(KEY);
    expect(JSON.stringify(headers)).not.toContain('attacker-supplied');
    expect(JSON.stringify(headers)).not.toContain('session=abc');
  });

  it('attaches the key upstream and never returns it', async () => {
    const { res, spy } = await call();
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Analytics-Key']).toBe(KEY);
    const seen = JSON.stringify(res.body) + JSON.stringify(res.headers);
    expect(seen).not.toContain(KEY);
    expect(seen).not.toContain(ORIGIN);
  });

  it('is disabled, not broken, when the key is unset', async () => {
    delete process.env.CLASH_API_KEY;
    const { res, spy } = await call();
    expect(res.body).toEqual({ enabled: false, read: null });
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('upstream failure modes', () => {
  const disabled = { enabled: false, read: null };

  it('upstream 401 → disabled', async () => {
    const { res } = await call({}, async () => ({ ok: false, status: 401, json: async () => ({}) }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(disabled);
  });

  it('upstream 500 → disabled', async () => {
    const { res } = await call({}, async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(res.body).toEqual(disabled);
  });

  it('upstream 429 → disabled', async () => {
    const { res } = await call({}, async () => ({ ok: false, status: 429, json: async () => ({}) }));
    expect(res.body).toEqual(disabled);
  });

  it('network failure → disabled', async () => {
    const { res } = await call({}, async () => { throw new Error('ECONNREFUSED 127.0.0.1:8787'); });
    expect(res.body).toEqual(disabled);
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('a timeout/abort → disabled', async () => {
    const { res } = await call({}, async () => {
      const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e;
    });
    expect(res.body).toEqual(disabled);
  });

  it("Cloudflare's 502 HTML page → disabled", async () => {
    // Observed for real in step 4: with the Python service stopped, the tunnel
    // edge answers 502 with an HTML error page, not JSON. The `ok` check has to
    // catch it before anything tries to parse it as a payload.
    const { res } = await call({}, async () => ({
      ok: false, status: 502,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
      text: async () => '<!DOCTYPE html><title>502: Bad gateway</title>',
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(disabled);
  });

  it('unparseable JSON → disabled', async () => {
    const { res } = await call({}, async () => ({
      ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); },
    }));
    expect(res.body).toEqual(disabled);
  });

  it('leaks no upstream detail in any failure', async () => {
    const modes = [
      async () => { throw new Error(`connect ECONNREFUSED ${ORIGIN}`); },
      async () => ({ ok: false, status: 500, json: async () => ({ detail: 'H:\\ClashBot\\x.db' }) }),
      async () => ({ ok: true, status: 200, json: async () => ({ error: 'Traceback (most recent call last)' }) }),
    ];
    for (const impl of modes) {
      const { res } = await call({}, impl as never);
      const seen = JSON.stringify(res.body);
      expect(seen).toEqual('{"enabled":false,"read":null}');
      expect(seen).not.toContain('H:\\');
      expect(seen).not.toContain('Traceback');
      expect(seen).not.toContain(ORIGIN);
    }
  });
});

// ---------------------------------------------------------------------------

describe('response sanitisation', () => {
  it('passes a well-formed competitive read', () => {
    const clean = sanitizeRead(goodRead().read)!;
    expect(clean.primary.confidence).toBe('high');
    expect(clean.alternatives).toHaveLength(1);
    expect(Object.keys(clean).sort())
      .toEqual(['alternatives', 'bandShown', 'degraded', 'note', 'primary']);
  });

  it('rejects a payload carrying changeProbability', () => {
    const raw = goodRead().read as Record<string, unknown>;
    raw.changeProbability = 0.42;
    expect(sanitizeRead(raw)).toBeNull();
  });

  it('rejects other model internals wherever they appear', () => {
    for (const key of ['weights', 'features', 'logit', 'cluster', 'model', 'path', 'traceback']) {
      const raw = goodRead().read as Record<string, unknown>;
      (raw.primary as Record<string, unknown>)[key] = 'x';
      expect(sanitizeRead(raw), key).toBeNull();
    }
  });

  it('rejects filesystem paths and exception text in prose', () => {
    for (const bad of ['H:\\ClashBot\\data\\battles.db', 'C:/Users/singh/x',
                       '/home/user/battles.db', 'Traceback (most recent call last)',
                       'File "app.py", line 12', 'opened battles.db']) {
      expect(sanitizeRead({ ...goodRead().read, note: bad }), bad).toBeNull();
      const raw = goodRead().read as Record<string, unknown>;
      (raw.alternatives as Record<string, unknown>[])[0].evidence = [bad];
      expect(sanitizeRead(raw), bad).toBeNull();
    }
  });

  it('rejects malformed shapes', () => {
    expect(sanitizeRead(null)).toBeNull();
    expect(sanitizeRead([])).toBeNull();
    expect(sanitizeRead('nope')).toBeNull();
    expect(sanitizeRead({})).toBeNull();
    expect(sanitizeRead({ ...goodRead().read, degraded: 'yes' })).toBeNull();
    expect(sanitizeRead({ ...goodRead().read, primary: { cards: [], basis: 'recent' } })).toBeNull();
    expect(sanitizeRead({ ...goodRead().read,
      primary: { cards: ['../../etc/passwd'], basis: 'recent' } })).toBeNull();
    expect(sanitizeRead({ ...goodRead().read,
      primary: { cards: Array(9).fill('knight'), basis: 'recent' } })).toBeNull();
    expect(sanitizeRead({ ...goodRead().read, alternatives: 'lots' })).toBeNull();
  });

  it('rejects an unknown confidence band', () => {
    const raw = goodRead().read as Record<string, unknown>;
    (raw.primary as Record<string, unknown>).confidence = '90.5%';
    expect(sanitizeRead(raw)).toBeNull();
  });

  it('caps the alternatives list', () => {
    const alt = (goodRead().read.alternatives as unknown[])[0];
    expect(sanitizeRead({ ...goodRead().read, alternatives: Array(4).fill(alt) })).toBeNull();
  });

  it('enforces degraded ⇒ no alternatives', () => {
    const clean = sanitizeRead({ ...goodRead().read, degraded: true })!;
    expect(clean.degraded).toBe(true);
    expect(clean.alternatives).toEqual([]);
  });

  it('enforces practice ⇒ no band and no alternatives', () => {
    const clean = sanitizeRead({ ...goodRead().read, bandShown: false })!;
    expect(clean.bandShown).toBe(false);
    expect(clean.primary.confidence).toBeUndefined();
    expect(clean.alternatives).toEqual([]);
    expect(JSON.stringify(clean)).not.toContain('confidence');
  });

  it('keeps competitive confidence qualitative', () => {
    const clean = sanitizeRead(goodRead().read)!;
    expect(['high', 'medium', 'low']).toContain(clean.primary.confidence);
    expect(JSON.stringify(clean)).not.toMatch(/\d+(\.\d+)?%/);
  });

  it('passes an upstream that is simply switched off', () => {
    expect(sanitizeEnvelope({ enabled: false, read: null })).toEqual({ enabled: false, read: null });
  });

  it('fails closed on a malformed envelope', () => {
    expect(sanitizeEnvelope({ enabled: true, read: { junk: 1 } })).toBeNull();
    expect(sanitizeEnvelope({ read: goodRead().read })).toBeNull();
    expect(sanitizeEnvelope(null)).toBeNull();
  });

  it('does not pass unknown top-level keys through the handler', async () => {
    const { res } = await call({}, async () => ({
      ok: true, status: 200,
      json: async () => ({ ...goodRead(), serverPath: 'H:\\x', debug: { key: KEY } }),
    }));
    expect(Object.keys(res.body as object).sort()).toEqual(['enabled', 'read']);
    expect(JSON.stringify(res.body)).not.toContain('H:\\');
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });
});

// ---------------------------------------------------------------------------

describe('rate limiting', () => {
  it('allows up to the limit, then refuses', () => {
    const key = `k${Math.random()}`;
    for (let i = 0; i < RATE_LIMIT; i++) expect(memoryRateLimit(key, 1_000_000)).toBe(true);
    expect(memoryRateLimit(key, 1_000_000)).toBe(false);
  });

  it('rolls with the window', () => {
    const key = `k${Math.random()}`;
    for (let i = 0; i < RATE_LIMIT; i++) memoryRateLimit(key, 1_000_000);
    expect(memoryRateLimit(key, 1_000_000)).toBe(false);
    expect(memoryRateLimit(key, 1_000_000 + 60_001)).toBe(true);
  });

  it('counts accounts separately', () => {
    const a = `a${Math.random()}`, b = `b${Math.random()}`;
    for (let i = 0; i < RATE_LIMIT; i++) memoryRateLimit(a, 1_000_000);
    expect(memoryRateLimit(a, 1_000_000)).toBe(false);
    expect(memoryRateLimit(b, 1_000_000)).toBe(true);
  });

  it('is bounded under a spray of distinct callers', () => {
    for (let i = 0; i < 5000; i++) memoryRateLimit(`bulk-${i}`, 2_000_000);
    expect(trackedClients()).toBeLessThanOrEqual(512);
    // Same window, so nothing is stale: the table must still not run away.
    for (let i = 0; i < 5000; i++) memoryRateLimit(`bulk2-${i}`, 2_000_000);
    expect(trackedClients()).toBeLessThanOrEqual(512);
    expect(trackedClients()).toBeGreaterThan(0);
  });

  it('returns 429 over HTTP and stops calling upstream', async () => {
    let last: Awaited<ReturnType<typeof call>> | null = null;
    for (let i = 0; i < RATE_LIMIT + 3; i++) last = await call();
    expect(last!.res.statusCode).toBe(429);
    expect(last!.res.body).toEqual({ error: 'rate_limited' });
    expect(last!.res.headers['Retry-After']).toBe('60');
    expect(last!.spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('no CORS on a same-origin route', () => {
  it('sets no Access-Control headers', async () => {
    const { res } = await call({ headers: { authorization: `Bearer ${CRED}`,
                                            origin: 'https://evil.test' } });
    const keys = Object.keys(res.headers).map((k) => k.toLowerCase());
    expect(keys.some((k) => k.startsWith('access-control'))).toBe(false);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});
