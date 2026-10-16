import { beforeEach, describe, expect, it, vi } from 'vitest';

/* SAVED TEAM ANALYSES IN THIS BROWSER (2026-10-17, rosters raised to 20).
   A 12v12 board measured 1.51 M characters compacted; a 20v20 one ~4.7 M, past
   the store's 3 M ceiling, so the report is kept deflate-packed. These drive
   the REAL store against a stubbed localStorage, with the account's transport
   mocked out (nothing is signed in). */

vi.mock('../src/state/syncClient', () => ({
  deleteTeamSave: vi.fn(async () => false),
  pullTeamSave: vi.fn(async () => null),
  pullTeamSaveIndex: vi.fn(async () => null),
  pushTeamSave: vi.fn(async () => false),
  renameTeamSave: vi.fn(async () => false),
}));

const KEY = 'royal-team-saves';
let store: Map<string, string>;

function stubStorage() {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
}

async function freshStore() {
  vi.resetModules();
  return (await import('../src/state/teamSaves')).useTeamSaves;
}

/** A report shaped like the server's, `n` a side, each teammate with ten decks. */
function bigReport(n: number) {
  const tag = (s: string, i: number) => `#${s}${'0289PYLQGRJCUV'[i % 14]}${'0289PYLQGRJCUV'[Math.floor(i / 14)]}PQ`;
  const blue = Array.from({ length: n }, (_, i) => ({ tag: tag('B', i), name: `Blue ${i}` }));
  const red = Array.from({ length: n }, (_, i) => ({ tag: tag('R', i), name: `Red ${i}` }));
  const deck = (k: number) => ({
    key: `deck-${k}`,
    name: `Deck ${k}`,
    cards: ['hog-rider', 'musketeer', 'fireball', 'the-log', 'ice-spirit', 'skeletons', 'cannon', `card-${k % 50}`],
    expectedWinRate: 50 + (k % 17),
    vs: { hog: 55.1, bait: 49.2, bridge: 61.3, cycle: 52.4 },
    note: 'x'.repeat(900),
  });
  return {
    mode: 'squads',
    blue,
    red,
    days: 30,
    folders: red.map((p, f) => ({
      player: p,
      recommended: [deck(f)],
      perPlayer: blue.map((b, i) => ({ owner: b, decks: Array.from({ length: 10 }, (_, d) => deck(f * 1000 + i * 10 + d)) })),
    })),
  } as never;
}

beforeEach(() => stubStorage());

describe('team saves in the browser', () => {
  it('keeps the report packed and reads it back identical after a reload', async () => {
    const s1 = await freshStore();
    const report = bigReport(3);
    const res = s1.getState().save({ name: 'one', blueText: '', redText: '', report } as never);
    expect(res.ok).toBe(true);
    const raw = JSON.parse(store.get(KEY)!);
    expect(raw[0].report).toBeUndefined();
    expect(typeof raw[0].reportPacked).toBe('string');

    const s2 = await freshStore();
    const got = s2.getState().saves[0];
    expect(got.name).toBe('one');
    expect(got.report).toEqual(s1.getState().saves[0].report);
  });

  it('still reads a save written before packing (raw report)', async () => {
    const report = bigReport(2);
    store.set(KEY, JSON.stringify([{ id: 'tabc123', name: 'old', savedAt: '2026-10-01T00:00:00.000Z', report, synced: true }]));
    const s = await freshStore();
    expect(s.getState().saves).toHaveLength(1);
    expect(s.getState().saves[0].report).toEqual(report);
  });

  it('saves a 20v20 board, which raw would not fit', async () => {
    const report = bigReport(20);
    expect(JSON.stringify(report).length).toBeGreaterThan(3_000_000);
    const s = await freshStore();
    expect(s.getState().save({ name: 'big', blueText: '', redText: '', report } as never)).toMatchObject({ ok: true });
    expect(store.get(KEY)!.length).toBeLessThan(3_000_000);
  });

  it('drops an entry whose packed report is damaged and has no counts', async () => {
    store.set(KEY, JSON.stringify([{ id: 'tabc123', name: 'bad', savedAt: '2026-10-01T00:00:00.000Z', reportPacked: 'zz:一' }]));
    const s = await freshStore();
    expect(s.getState().saves).toHaveLength(0);
  });
});
