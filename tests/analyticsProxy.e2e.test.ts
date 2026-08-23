/**
 * Phase 24C, step 3 — end to end over real sockets.
 *
 * The unit tests stub `fetch`, which proves the handler's logic but not that a
 * real request carries what we think it carries. This runs the whole chain:
 *
 *   fetch() as the browser  →  a server that routes like Vercel does
 *                           →  this project's function
 *                           →  a real HTTP "upstream" standing in for the
 *                              tunnel and the Python service
 *
 * No tunnel, no Python, no database. What it establishes is the two claims the
 * architecture rests on: the key is attached on the way OUT, and nothing about
 * the upstream comes back IN.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import handler from '../api/analytics/opponent-read/[tag]';

const KEY = 'e2e-upstream-key-4f2a9c';
const CRED = '0f9473eb049cd9abafd1dcd6fc4df45437dc33498ecd48ebac1742618394bdb5'; // royal01
const TAG = 'Y022GRCJQ';

/** Every request the fake upstream received, for inspection afterwards. */
const seenUpstream: { url: string; headers: Record<string, string | string[] | undefined> }[] = [];

let upstream: Server;
let proxy: Server;
let proxyBase = '';

/**
 * What the Python service would answer, plus junk that must not survive:
 * a model internal, an absolute path and the key itself.
 */
const UPSTREAM_BODY = {
  enabled: true,
  read: {
    primary: { cards: ['knight', 'musketeer', 'fireball'], basis: 'recent', confidence: 'high' },
    alternatives: [],
    note: 'Showing the most recent deck.',
    degraded: false,
    bandShown: true,
  },
  serverPath: 'H:\\ClashBot\\data\\battles.db',
  echoedKey: KEY,
};

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

beforeAll(async () => {
  upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
    seenUpstream.push({ url: req.url ?? '', headers: req.headers });
    if (req.headers['x-analytics-key'] !== KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(UPSTREAM_BODY));
  });
  const upstreamPort = await listen(upstream);

  // Stands in for Vercel's router: matches the dynamic segment and hands the
  // function a `query.tag`, exactly as the platform does.
  proxy = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const m = /^\/api\/analytics\/opponent-read\/(.+)$/.exec(url.pathname);
    if (!m) {
      res.writeHead(404).end();
      return;
    }
    const vercelReq = {
      method: req.method,
      headers: req.headers,
      query: { tag: decodeURIComponent(m[1]) },
    };
    const vercelRes = {
      status(code: number) { res.statusCode = code; return this; },
      setHeader(k: string, v: string) { res.setHeader(k, v); return this; },
      json(body: unknown) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(vercelReq as any, vercelRes as any);
  });
  const proxyPort = await listen(proxy);
  proxyBase = `http://127.0.0.1:${proxyPort}`;

  process.env.ANALYTICS_ORIGIN = `http://127.0.0.1:${upstreamPort}`;
  process.env.CLASH_API_KEY = KEY;
  process.env.OIE_ALLOWLIST = 'royal01';
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

afterAll(async () => {
  await new Promise((r) => upstream.close(r));
  await new Promise((r) => proxy.close(r));
});

/** A browser request: same-origin path, session credential, nothing else. */
function browserFetch(tag = TAG, headers: Record<string, string> = {}) {
  return fetch(`${proxyBase}/api/analytics/opponent-read/${encodeURIComponent(tag)}`, {
    headers: { Authorization: `Bearer ${CRED}`, ...headers },
  });
}

describe('browser → proxy → upstream, over real sockets', () => {
  it('returns a sanitised read', async () => {
    const res = await browserFetch();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['enabled', 'read']);
    expect(body.enabled).toBe(true);
    expect(body.read.primary.cards).toEqual(['knight', 'musketeer', 'fireball']);
    expect(body.read.primary.confidence).toBe('high');
  });

  it('attaches the key on the way out', async () => {
    seenUpstream.length = 0;
    await browserFetch();
    expect(seenUpstream).toHaveLength(1);
    expect(seenUpstream[0].headers['x-analytics-key']).toBe(KEY);
    expect(seenUpstream[0].url).toBe('/api/analytics/coach/opponent-read/%23Y022GRCJQ');
  });

  it('never returns the key, the path or the upstream host', async () => {
    const res = await browserFetch();
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('H:\\');
    expect(text).not.toContain('battles.db');
    expect(text).not.toContain('echoedKey');
    expect(text).not.toContain('127.0.0.1');
    expect(text).not.toContain(process.env.ANALYTICS_ORIGIN!);
    // And nothing in the headers either.
    expect(JSON.stringify([...res.headers])).not.toContain(KEY);
  });

  it('forwards nothing of the browser request but the tag', async () => {
    seenUpstream.length = 0;
    await browserFetch(TAG, {
      Cookie: 'session=super-secret',
      'X-Forwarded-For': '10.1.2.3',
      'X-Analytics-Key': 'attacker-supplied-key',
      Origin: 'https://evil.test',
    });
    const sent = seenUpstream[0].headers;
    expect(sent['x-analytics-key']).toBe(KEY);      // ours, not theirs
    expect(sent.cookie).toBeUndefined();
    expect(sent.origin).toBeUndefined();
    expect(sent['x-forwarded-for']).toBeUndefined();
  });

  it('sends no CORS headers on the same-origin route', async () => {
    const res = await browserFetch();
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('401s a browser with no session, and calls nothing upstream', async () => {
    seenUpstream.length = 0;
    const res = await fetch(`${proxyBase}/api/analytics/opponent-read/${TAG}`);
    expect(res.status).toBe(401);
    expect(seenUpstream).toHaveLength(0);
  });

  it('is disabled for an account off the allowlist', async () => {
    process.env.OIE_ALLOWLIST = 'royal20';
    seenUpstream.length = 0;
    const res = await browserFetch();
    expect(await res.json()).toEqual({ enabled: false, read: null });
    expect(seenUpstream).toHaveLength(0);
    process.env.OIE_ALLOWLIST = 'royal01';
  });

  it('degrades to disabled when upstream rejects the key', async () => {
    process.env.CLASH_API_KEY = 'the-wrong-key';
    const res = await browserFetch();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, read: null });
    process.env.CLASH_API_KEY = KEY;
  });

  it('degrades to disabled when upstream is unreachable', async () => {
    const saved = process.env.ANALYTICS_ORIGIN;
    // Port 1 is reserved and refuses immediately.
    process.env.ANALYTICS_ORIGIN = 'http://127.0.0.1:1';
    const res = await browserFetch();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, read: null });
    process.env.ANALYTICS_ORIGIN = saved;
  });

  it('rejects a hostile tag before any socket opens', async () => {
    seenUpstream.length = 0;
    const res = await browserFetch('..%2F..%2Fadmin');
    expect(res.status).toBe(400);
    expect(seenUpstream).toHaveLength(0);
  });
});
