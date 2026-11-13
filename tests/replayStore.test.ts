import { describe, expect, it, vi } from 'vitest';

// The browser store reads the sign-in token through the Supabase client,
// which cannot start under node; nothing here needs a token.
const auth = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('../src/state/coachToken', () => ({ coachToken: async () => auth.token }));
import {
  REPLAYS_MAX_TOTAL,
  REPLAYS_PER_PLAYER,
  REPLAYS_READ_BY,
  battleKey,
  cleanReplay,
  parseKey,
  replayRoute,
  type ReplayKV,
} from '../api/replays';
import {
  REPLAYS_FOR,
  REPLAYS_PER_PLAYER as CLIENT_PER_PLAYER,
  battleKeyFor,
  fetchPlayerReplays,
  shareReplay,
} from '../src/state/replayStore';
import type { Replay } from '../src/utils/replayParse';

describe('the browser side', () => {
  it('shares with the admin’s token, and says why when it cannot', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let answer: Response = new Response(JSON.stringify({ saved: true }), { status: 200 });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return answer;
    });
    try {
      auth.token = null;
      expect(await shareReplay('K', {} as Replay)).toEqual({ ok: false, reason: 'sign_in' });
      expect(calls).toHaveLength(0);

      auth.token = 'tok';
      expect(await shareReplay('A~B~20261113T082741', { v: 1 } as Replay)).toEqual({ ok: true });
      expect(calls[0].url).toBe('/api/replays?key=A~B~20261113T082741');
      expect(calls[0].init?.method).toBe('PUT');
      expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({ replay: { v: 1 } });

      answer = new Response(JSON.stringify({ error: 'too_old' }), { status: 409 });
      expect(await shareReplay('K', { v: 1 } as Replay)).toEqual({ ok: false, reason: 'too_old' });
      answer = new Response('<html>404</html>', { status: 404 });
      expect(await shareReplay('K', { v: 1 } as Replay)).toEqual({ ok: false, reason: 'unreachable' });

      // Reads carry the admin's token, and are not made without one.
      answer = new Response(JSON.stringify({ battles: ['K1'] }), { status: 200 });
      calls.length = 0;
      expect(await fetchPlayerReplays('#2PP')).toEqual(['K1']);
      expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      auth.token = null;
      calls.length = 0;
      expect(await fetchPlayerReplays('#2PP')).toEqual([]);
      expect(calls).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
      auth.token = null;
    }
  });
});

/* The shared replay library (api/replays.ts). Invented players and tags. */

function memoryKV(): ReplayKV & { data: Map<string, string> } {
  // Values pass through JSON, as they do through Upstash.
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => (data.has(k) ? JSON.parse(data.get(k)!) : null),
    set: async (k, v) => void data.set(k, JSON.stringify(v)),
    del: async (k) => void data.delete(k),
  };
}

const ADMIN = { signedIn: true, isAdmin: async () => true };
const MEMBER = { signedIn: true, isAdmin: async () => false };
const NOBODY = { signedIn: false, isAdmin: async () => false };
const ADMIN_READ = ADMIN;

function replay(blue = '#PQ8RJ2Y0', red = '#9CVL2URG', plays = 20) {
  return {
    v: 1,
    id: 'abc',
    battleTag: 'X1',
    url: 'https://royaleapi.com/replay?tag=X1',
    battleTime: 1762992000,
    modeId: 72000201,
    flipped: false,
    duration: 60,
    players: {
      blue: { side: 'blue', name: 'Ember', tag: blue, crowns: 1, deck: [{ key: 'hog-rider', level: 14, form: null }], tower: null, towersLeft: null },
      red: { side: 'red', name: 'Sora', tag: red, crowns: 0, deck: [{ key: 'golem', level: 13, form: null }], tower: null, towersLeft: null },
    },
    events: Array.from({ length: plays }, (_, i) => ({
      n: i, tick: 100 + i * 40, t: (100 + i * 40) / 20, side: i % 2 ? 'red' : 'blue', kind: 'play',
      key: i % 2 ? 'golem' : 'hog-rider', form: null, x: 3.5, y: 14, elixir: 4,
    })),
  };
}

const A = 'PQ8RJ2Y0';
const B = '9CVL2URG';
const stamp = (i: number) => `202611${String(1 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}0000`;

describe('battle keys', () => {
  it('both tags sorted, no #, and the stamp to the second; the client builds the same', () => {
    const k = battleKey(`#${A}`, `#${B}`, '20261113T082741.000Z');
    expect(k).toBe(`${B}~${A}~20261113T082741`);
    expect(battleKey(B, A, '20261113T082741.000Z')).toBe(k);
    for (const [a, b, t] of [
      [`#${A}`, `#${B}`, '20261113T082741.000Z'],
      ['#2PP', '#9CVL2URG', '20250101T000000.000Z'],
      ['bad', '#2PP', '20250101T000000.000Z'],
      ['#2PP', '#2PP', '20250101T000000.000Z'],
      ['#2PP', '#9CV', 'yesterday'],
    ]) {
      expect(battleKeyFor(a, b, t), `${a} ${b} ${t}`).toBe(battleKey(a, b, t));
    }
    expect(parseKey(k)).toEqual({ tags: [B, A], stamp: '20261113T082741' });
    expect(parseKey(`${A}~${B}~20261113T082741`)).toBeNull(); // not sorted
    expect(CLIENT_PER_PLAYER).toBe(REPLAYS_PER_PLAYER);
    expect(REPLAYS_FOR).toBe(REPLAYS_READ_BY);
  });
});

describe('cleanReplay', () => {
  it('keeps what a replay is and drops anything else', () => {
    const dirty = { ...replay(), extra: '<script>', players: { ...replay().players, blue: { ...replay().players.blue, evil: 1 } } };
    const clean = cleanReplay(dirty)!;
    expect(clean).not.toBeNull();
    expect('extra' in clean).toBe(false);
    expect('evil' in clean.players.blue).toBe(false);
    expect(clean.events).toHaveLength(20);
  });

  it('refuses what is not a replay', () => {
    expect(cleanReplay(null)).toBeNull();
    expect(cleanReplay({ ...replay(), v: 2 })).toBeNull();
    expect(cleanReplay({ ...replay(), events: [] })).toBeNull();
    expect(cleanReplay({ ...replay(), events: [{ side: 'green', kind: 'play', key: 'x', tick: 1 }] })).toBeNull();
    expect(cleanReplay({ ...replay(), url: 'https://evil.example/' })!.url).toBeNull();
  });
});

describe('the route', () => {
  const key = battleKey(A, B, '20261113T082741')!;

  it('admins only, for now: reading and writing both need a signed-in admin', async () => {
    expect(REPLAYS_READ_BY).toBe('admin');
    const kv = memoryKV();
    expect((await replayRoute({ method: 'GET', player: A }, NOBODY, kv)).status).toBe(401);
    expect((await replayRoute({ method: 'GET', player: A }, MEMBER, kv)).status).toBe(403);
    expect((await replayRoute({ method: 'GET', key }, MEMBER, kv)).status).toBe(403);
    expect((await replayRoute({ method: 'GET', player: A }, ADMIN_READ, kv)).json).toEqual({ battles: [] });
    expect((await replayRoute({ method: 'PUT', key, body: { replay: replay() } }, NOBODY, kv)).status).toBe(401);
    expect((await replayRoute({ method: 'PUT', key, body: { replay: replay() } }, MEMBER, kv)).status).toBe(403);
    expect((await replayRoute({ method: 'DELETE', key }, MEMBER, kv)).status).toBe(403);
    expect(kv.data.size).toBe(0);
  });

  it('an admin shares a replay; an admin can then list and read it, never from an edge cache', async () => {
    const kv = memoryKV();
    const put = await replayRoute({ method: 'PUT', key, body: { replay: replay() } }, ADMIN, kv);
    expect(put.status).toBe(200);
    for (const tag of [A, B, `#${A}`]) {
      expect((await replayRoute({ method: 'GET', player: tag }, ADMIN, kv)).json).toEqual({ battles: [key] });
    }
    const got = await replayRoute({ method: 'GET', key }, ADMIN, kv);
    expect(got.status).toBe(200);
    expect((got.json as { replay: { events: unknown[] } }).replay.events).toHaveLength(20);
    expect(got.cache).toBe('private, no-store');
    // Stored compressed, not as the JSON that came in.
    expect(kv.data.get(`replay:${key}`)!.length).toBeLessThan(JSON.stringify(replay()).length);
  });

  it('refuses a bad key, a bad replay and a replay of two other players', async () => {
    const kv = memoryKV();
    expect((await replayRoute({ method: 'PUT', key: 'nope', body: { replay: replay() } }, ADMIN, kv)).status).toBe(400);
    expect((await replayRoute({ method: 'PUT', key, body: { replay: { v: 1 } } }, ADMIN, kv)).status).toBe(400);
    const other = await replayRoute({ method: 'PUT', key, body: { replay: replay('#2PP', '#8QQ') } }, ADMIN, kv);
    expect(other).toMatchObject({ status: 409, json: { error: 'other_players' } });
    expect((await replayRoute({ method: 'GET', key }, ADMIN, kv)).status).toBe(404);
  });

  it(`each player keeps their ${REPLAYS_PER_PLAYER} newest; a replay nobody keeps is deleted`, async () => {
    const kv = memoryKV();
    // A plays 30 different opponents, oldest first.
    const opponents = Array.from({ length: 30 }, (_, i) => ['2PP', '8QQ', 'GRJ', 'LUV', 'CYP', 'V09'][i % 6] + ['2', '8', '9', 'P', 'Y', 'L'][Math.floor(i / 6)]);
    for (let i = 0; i < 30; i += 1) {
      const k = battleKey(A, opponents[i], stamp(i))!;
      const r = await replayRoute({ method: 'PUT', key: k, body: { replay: replay(`#${A}`, `#${opponents[i]}`) } }, ADMIN, kv);
      expect(r.status, `import ${i}`).toBe(200);
    }
    const list = (await replayRoute({ method: 'GET', player: A }, ADMIN, kv)).json as { battles: string[] };
    expect(list.battles).toHaveLength(REPLAYS_PER_PLAYER);
    expect(list.battles[0]).toContain(stamp(29)); // newest first
    // The five oldest are each still kept by their opponent (one replay each).
    const oldest = battleKey(A, opponents[0], stamp(0))!;
    expect((await replayRoute({ method: 'GET', player: opponents[0] }, ADMIN, kv)).json).toEqual({ battles: [oldest] });
    expect((await replayRoute({ method: 'GET', key: oldest }, ADMIN, kv)).status).toBe(200);
    expect(JSON.parse(kv.data.get('replays:total')!)).toBe(30);
  });

  it('two players who meet 30 times keep 25: the 5 oldest are deleted', async () => {
    const kv = memoryKV();
    for (let i = 0; i < 30; i += 1) {
      await replayRoute({ method: 'PUT', key: battleKey(A, B, stamp(i))!, body: { replay: replay() } }, ADMIN, kv);
    }
    expect(((await replayRoute({ method: 'GET', player: B }, ADMIN, kv)).json as { battles: string[] }).battles).toHaveLength(25);
    expect((await replayRoute({ method: 'GET', key: battleKey(A, B, stamp(0))! }, ADMIN, kv)).status).toBe(404);
    expect(JSON.parse(kv.data.get('replays:total')!)).toBe(25);
    expect([...kv.data.keys()].filter((k) => k.startsWith('replay:'))).toHaveLength(25);
    // Older than all 25 kept: refused, nothing written.
    const before = kv.data.size;
    const old = await replayRoute({ method: 'PUT', key: battleKey(A, B, '20250101T000000')!, body: { replay: replay() } }, ADMIN, kv);
    expect(old).toMatchObject({ status: 409, json: { error: 'too_old' } });
    expect(kv.data.size).toBe(before);
  });

  it('the same battle twice is one replay; delete takes it away for everyone', async () => {
    const kv = memoryKV();
    await replayRoute({ method: 'PUT', key, body: { replay: replay() } }, ADMIN, kv);
    await replayRoute({ method: 'PUT', key, body: { replay: replay() } }, ADMIN, kv);
    expect(JSON.parse(kv.data.get('replays:total')!)).toBe(1);
    expect((await replayRoute({ method: 'DELETE', key }, ADMIN, kv)).json).toEqual({ removed: true });
    expect((await replayRoute({ method: 'GET', player: A }, ADMIN, kv)).json).toEqual({ battles: [] });
    expect((await replayRoute({ method: 'GET', key }, ADMIN, kv)).status).toBe(404);
    expect(JSON.parse(kv.data.get('replays:total')!)).toBe(0);
  });

  it(`a full library (${REPLAYS_MAX_TOTAL}) refuses a new battle`, async () => {
    const kv = memoryKV();
    await kv.set('replays:total', REPLAYS_MAX_TOTAL);
    const r = await replayRoute({ method: 'PUT', key, body: { replay: replay() } }, ADMIN, kv);
    expect(r).toMatchObject({ status: 507, json: { error: 'library_full' } });
  });
});
