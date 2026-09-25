import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { TEAM_SAVE_ID, TEAM_SAVE_MAX, teamSaveRoute, type TeamSaveKV } from '../api/decks';
import type { TeamRecommendation, TeamReport } from '../src/state/analyticsClient';
import { canGzip, gunzipText, gzipText } from '../src/utils/gzipText';
import {
  compactReport,
  MAX_SAVES,
  mergeSaves,
  newSaveId,
  SAVE_ID,
  saveCounts,
  saveMode,
  stubOf,
  type SavedTeamAnalysis,
  type TeamSaveMeta,
} from '../src/state/teamSaveRules';

/* Shaped like `team_analysis.analyze` emits it: a `matchups` table of one row
 * per projected threat on every recommendation — which is what made a saved
 * 10v10 board ~4.6 MB. */
const HOG = ['hog-rider', 'musketeer', 'ice-golem', 'ice-spirit', 'skeletons', 'cannon', 'fireball', 'the-log'];

const matchups = Array.from({ length: 12 }, (_, i) => ({
  threat: `t${i}`,
  archetype: 'hog',
  name: 'Hog Rider',
  share: 8,
  likelihood: 0.08,
  winRate: 55.1,
  games: 8390,
  source: 'archetype',
  sourceText: 'Measured on this archetype against theirs',
  evidence: 'OBSERVED',
}));

const rec = (over: Partial<TeamRecommendation> = {}): TeamRecommendation =>
  ({
    cards: HOG,
    art: {},
    archetype: 'hog',
    name: 'Hog 2.6',
    expectedWinRate: 61.2,
    spreadCovered: 100,
    score: 61.2,
    matchups,
    owner: { tag: '#B1', name: 'Ravi' },
    comfort: { games: 40, wins: 24, winRate: 60, useRate: 30, bonus: 1.2 },
    type: 'ROBUST',
    confidence: 'known',
    explanation: 'Holds up against Royal Hogs and the close variants of it — measured against 100% of their projected pool.',
    brain: 'team-scout-2.0',
    ...over,
  }) as TeamRecommendation;

function report(players: number, mode: 'squads' | 'scout' = 'squads'): TeamReport {
  const member = (i: number, side: string) => ({ tag: `#${side}${i}`, name: `${side}${i}`, basis: 'stored' });
  const blue = mode === 'scout' ? [] : Array.from({ length: players }, (_, i) => member(i, 'B'));
  const red = Array.from({ length: players }, (_, i) => member(i, 'R'));
  return {
    mode,
    blue,
    red,
    days: 30,
    folders: red.map((r) => ({
      player: { ...r, battles: 100, winRate: 50 },
      theirDecks: [],
      spread: [],
      threats: [],
      recommended: Array.from({ length: 7 }, () => rec()),
      perPlayer: blue.map((b) => ({
        owner: { tag: b.tag, name: b.name },
        basis: 'stored',
        decks: Array.from({ length: 7 }, () => rec()),
        considered: 7,
        reason: null,
      })),
      considered: 7,
      reason: null,
    })),
    pool: { reason: null },
    rejected: { blue: [], red: [] },
  } as unknown as TeamReport;
}

describe('a saved report is compacted', () => {
  const full = report(5);
  const small = compactReport(full);

  it('keeps the per-threat table on each folder’s top pick — the PDF reads it there', () => {
    for (const f of small.folders) {
      expect(f.recommended[0].matchups).toHaveLength(12);
      expect(f.recommended.slice(1).every((r) => r.matchups === undefined)).toBe(true);
    }
  });

  it('drops it from every per-teammate deck, which nothing reads', () => {
    for (const f of small.folders) for (const p of f.perPlayer) expect(p.decks.every((d) => d.matchups === undefined)).toBe(true);
  });

  it('drops the explanation the screen no longer prints, and the per-row brain', () => {
    const every = small.folders.flatMap((f) => [...f.recommended, ...f.perPlayer.flatMap((p) => p.decks)]);
    expect(every.every((r) => r.explanation === undefined && r.brain === undefined)).toBe(true);
  });

  it('keeps everything a row draws', () => {
    const r = small.folders[0].perPlayer[0].decks[0];
    expect(r).toMatchObject({ cards: HOG, name: 'Hog 2.6', expectedWinRate: 61.2, owner: { name: 'Ravi' } });
    expect(r.comfort?.games).toBe(40);
  });

  it('keeps the squad plan: per-archetype rates, known cards, #1 mark and the coverage strip', () => {
    const plan: TeamReport = {
      ...full,
      folders: full.folders.map((f) => ({
        ...f,
        squadCover: [{ archetype: 'hog', name: 'Hog Rider', likelihood: 0.4, tag: '#P1',
                       player: 'Ravi', deck: 'Hog 2.6', winRate: 61.2, answered: true }],
        perPlayer: f.perPlayer.map((p) => ({
          ...p,
          decks: p.decks.map((d, i) => ({ ...d, vs: { hog: 61.2 }, known: 6,
                                          squadPick: i === 0, covers: i === 0 ? ['hog'] : undefined })),
        })),
      })),
    };
    const kept = compactReport(plan).folders[0];
    expect(kept.squadCover?.[0]).toMatchObject({ archetype: 'hog', answered: true });
    expect(kept.perPlayer[0].decks[0]).toMatchObject({ vs: { hog: 61.2 }, known: 6, squadPick: true, covers: ['hog'] });
  });

  it('is a fraction of the size — the bug was a board too large to store', () => {
    const before = JSON.stringify(full).length;
    const after = JSON.stringify(small).length;
    expect(after).toBeLessThan(before * 0.4);
  });

  it('does not touch the report it was given', () => {
    expect(full.folders[0].perPlayer[0].decks[0].matchups).toHaveLength(12);
  });
});

describe('what a list row reads', () => {
  const save = (over: Partial<SavedTeamAnalysis> = {}): SavedTeamAnalysis => ({
    id: 'tabc12345',
    name: 'vs R0',
    savedAt: '2026-09-21T10:00:00.000Z',
    blueText: '',
    redText: '',
    report: report(3),
    ...over,
  });

  it('counts off the report', () => {
    expect(saveCounts(save())).toEqual({ mode: 'squads', players: 6, folders: 3 });
  });

  it('counts off the stub when the report is on another device', () => {
    const stub = stubOf(save());
    expect(stub.report).toBeUndefined();
    expect(saveCounts(stub)).toEqual({ mode: 'squads', players: 6, folders: 3 });
  });

  it('a save from before the modes existed is a match plan', () => {
    const old = save({ report: { ...report(2), mode: undefined } as TeamReport });
    expect(saveMode(old)).toBe('squads');
  });
});

describe('merging this browser with the account', () => {
  const meta = (id: string, savedAt: string, name = id): TeamSaveMeta => ({
    id,
    name,
    savedAt,
    mode: 'squads',
    players: 4,
    folders: 2,
  });
  const local = (id: string, savedAt: string, synced: boolean): SavedTeamAnalysis => ({
    id,
    name: id,
    savedAt,
    blueText: 'b',
    redText: 'r',
    report: report(2),
    synced,
  });
  const T1 = '2026-09-20T10:00:00.000Z';
  const T2 = '2026-09-21T10:00:00.000Z';

  it('a save made on another device arrives as a stub — the mobile bug', () => {
    const { saves, upload } = mergeSaves([], [meta('tdesk0001', T1, 'vs Ravi')]);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ id: 'tdesk0001', name: 'vs Ravi', synced: true });
    expect(saves[0].report).toBeUndefined();
    expect(saveCounts(saves[0]).folders).toBe(2);
    expect(upload).toEqual([]);
  });

  it('a save never uploaded is kept AND uploaded, not deleted', () => {
    const { saves, upload } = mergeSaves([local('toffl0001', T1, false)], []);
    expect(saves.map((s) => s.id)).toEqual(['toffl0001']);
    expect(upload).toEqual(['toffl0001']);
  });

  it('a synced save missing from the account was deleted elsewhere', () => {
    const { saves } = mergeSaves([local('tgone0001', T1, true)], []);
    expect(saves).toEqual([]);
  });

  it('the account’s name wins — renamed on the other device', () => {
    const { saves } = mergeSaves([local('tsame0001', T1, true)], [meta('tsame0001', T1, 'Renamed')]);
    expect(saves[0].name).toBe('Renamed');
    expect(saves[0].report).toBeDefined();
  });

  it('a newer version on the account makes the local report a stub', () => {
    const { saves, upload } = mergeSaves([local('tupd00001', T1, true)], [meta('tupd00001', T2)]);
    expect(saves[0].savedAt).toBe(T2);
    expect(saves[0].report).toBeUndefined();
    expect(upload).toEqual([]);
  });

  it('a newer version here is re-uploaded', () => {
    const { saves, upload } = mergeSaves([local('tupd00002', T2, false)], [meta('tupd00002', T1)]);
    expect(saves[0].savedAt).toBe(T2);
    expect(upload).toEqual(['tupd00002']);
  });

  it('a pending delete stays deleted while the account still lists it', () => {
    const { saves } = mergeSaves([local('tdel00001', T1, true)], [meta('tdel00001', T1)], ['tdel00001']);
    expect(saves).toEqual([]);
  });

  it('newest first', () => {
    const { saves } = mergeSaves([local('told00001', T1, false)], [meta('tnew00001', T2)]);
    expect(saves.map((s) => s.id)).toEqual(['tnew00001', 'told00001']);
  });
});

describe('the account endpoint (`/api/decks?doc=team-saves`)', () => {
  function memoryKV(): TeamSaveKV & { data: Map<string, unknown> } {
    const data = new Map<string, unknown>();
    const clone = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    return {
      data,
      get: async (k) => clone(data.get(k)) ?? null,
      set: async (k, v) => void data.set(k, clone(v)),
      del: async (k) => void data.delete(k),
      hgetall: async (k) => (data.has(k) ? clone(data.get(k)) : null),
      hset: async (k, v) => void data.set(k, { ...((data.get(k) as object) ?? {}), ...clone(v) }),
      hdel: async (k, f) => {
        const h = { ...((data.get(k) as Record<string, unknown>) ?? {}) };
        delete h[f];
        data.set(k, h);
      },
    };
  }
  const body = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    name: 'vs Ravi',
    savedAt: '2026-09-21T10:00:00.000Z',
    blueText: 'Ravi #Y022GRCJQ',
    redText: '#2PP0PYLQ',
    report: compactReport(report(2)),
    ...over,
  });

  it('mirrors the client’s cap and id shape — the file cannot import them', () => {
    expect(TEAM_SAVE_MAX).toBe(MAX_SAVES);
    expect(TEAM_SAVE_ID.source).toBe(SAVE_ID.source);
    for (let i = 0; i < 20; i++) expect(newSaveId()).toMatch(TEAM_SAVE_ID);
  });

  it('put, list, fetch, rename, delete', async () => {
    const kv = memoryKV();
    expect((await teamSaveRoute('PUT', 'tabc12345', body('tabc12345'), 'u1', kv)).status).toBe(200);

    const list = await teamSaveRoute('GET', null, null, 'u1', kv);
    expect(list.json).toEqual({
      saves: [{ id: 'tabc12345', name: 'vs Ravi', savedAt: '2026-09-21T10:00:00.000Z', mode: 'squads', players: 4, folders: 2 }],
    });

    const one = (await teamSaveRoute('GET', 'tabc12345', null, 'u1', kv)).json as { found: boolean; data: { redText: string } };
    expect(one.found).toBe(true);
    expect(one.data.redText).toBe('#2PP0PYLQ');

    expect((await teamSaveRoute('PATCH', 'tabc12345', { name: 'Final' }, 'u1', kv)).status).toBe(200);
    const renamed = (await teamSaveRoute('GET', null, null, 'u1', kv)).json as { saves: TeamSaveMeta[] };
    expect(renamed.saves[0].name).toBe('Final');
    const record = (await teamSaveRoute('GET', 'tabc12345', null, 'u1', kv)).json as { data: { name: string } };
    expect(record.data.name).toBe('Final');

    expect((await teamSaveRoute('DELETE', 'tabc12345', null, 'u1', kv)).status).toBe(200);
    expect((await teamSaveRoute('GET', null, null, 'u1', kv)).json).toEqual({ saves: [] });
    expect(((await teamSaveRoute('GET', 'tabc12345', null, 'u1', kv)).json as { found: boolean }).found).toBe(false);
  });

  it('one account cannot see another’s saves', async () => {
    const kv = memoryKV();
    await teamSaveRoute('PUT', 'tabc12345', body('tabc12345'), 'u1', kv);
    expect((await teamSaveRoute('GET', null, null, 'u2', kv)).json).toEqual({ saves: [] });
    expect(((await teamSaveRoute('GET', 'tabc12345', null, 'u2', kv)).json as { found: boolean }).found).toBe(false);
  });

  it('refuses a thirteenth save, but not an update to one of twelve', async () => {
    const kv = memoryKV();
    const ids = Array.from({ length: TEAM_SAVE_MAX }, (_, i) => `tcap${String(i).padStart(5, '0')}`);
    for (const id of ids) expect((await teamSaveRoute('PUT', id, body(id), 'u1', kv)).status).toBe(200);
    expect((await teamSaveRoute('PUT', 'tcapextra1', body('tcapextra1'), 'u1', kv)).status).toBe(409);
    expect((await teamSaveRoute('PUT', ids[0], body(ids[0], { name: 'again' }), 'u1', kv)).status).toBe(200);
  });

  it('an id is never free text — it becomes part of a storage key', async () => {
    const kv = memoryKV();
    for (const bad of ['../x', 'tABC12345', 't1', 'x12345678', 'tabc:123']) {
      expect((await teamSaveRoute('GET', bad, null, 'u1', kv)).status).toBe(400);
    }
  });

  it('refuses a body that is not a save, or claims another id', async () => {
    const kv = memoryKV();
    expect((await teamSaveRoute('PUT', 'tabc12345', body('tother0001'), 'u1', kv)).status).toBe(400);
    expect((await teamSaveRoute('PUT', 'tabc12345', { ...body('tabc12345'), report: null }, 'u1', kv)).status).toBe(400);
    expect((await teamSaveRoute('PUT', 'tabc12345', { ...body('tabc12345'), name: '' }, 'u1', kv)).status).toBe(400);
    expect((await teamSaveRoute('PUT', 'tabc12345', null, 'u1', kv)).status).toBe(400);
  });

  it('stores only a save’s own fields', async () => {
    const kv = memoryKV();
    await teamSaveRoute('PUT', 'tabc12345', { ...body('tabc12345'), synced: true, extra: 'x' }, 'u1', kv);
    const got = ((await teamSaveRoute('GET', 'tabc12345', null, 'u1', kv)).json as { data: object }).data;
    expect(Object.keys(got).sort()).toEqual(['blueText', 'id', 'name', 'redText', 'report', 'savedAt']);
  });

  it('refuses a body over the 1 MB cap with 413', async () => {
    const kv = memoryKV();
    const huge = body('tabc12345', { blueText: 'x'.repeat(1_000_001) });
    expect((await teamSaveRoute('PUT', 'tabc12345', huge, 'u1', kv)).status).toBe(413);
  });

  it('a compacted 12v12 match plan fits one request even uncompressed', () => {
    // The fallback path, for a browser without CompressionStream. A real
    // 12v12 measured 858 kB here on 2026-09-21 — which is why it is gzipped.
    const big = compactReport(report(12));
    expect(JSON.stringify(body('tabc12345', { report: big })).length).toBeLessThan(1_000_000);
  });

  it('a GZIPPED report is accepted, stored compressed, and counted', async () => {
    const kv = memoryKV();
    const rep12 = compactReport(report(12));
    const plain = JSON.stringify(rep12);
    const reportGz = await gzipText(plain);
    expect(reportGz.length).toBeLessThan(plain.length / 5);

    const { report: _drop, ...rest } = body('tabc12345');
    void _drop;
    const out = await teamSaveRoute('PUT', 'tabc12345', { ...rest, reportGz }, 'u1', kv);
    expect(out.status).toBe(200);

    const list = (await teamSaveRoute('GET', null, null, 'u1', kv)).json as { saves: TeamSaveMeta[] };
    expect(list.saves[0]).toMatchObject({ players: 24, folders: 12, mode: 'squads' });

    const got = ((await teamSaveRoute('GET', 'tabc12345', null, 'u1', kv)).json as { data: Record<string, unknown> }).data;
    expect(got.report).toBeUndefined();
    expect(JSON.parse(await gunzipText(got.reportGz as string))).toEqual(rep12);

    // Rename keeps it compressed.
    expect((await teamSaveRoute('PATCH', 'tabc12345', { name: 'Final' }, 'u1', kv)).status).toBe(200);
    const renamed = ((await teamSaveRoute('GET', 'tabc12345', null, 'u1', kv)).json as { data: Record<string, unknown> }).data;
    expect(renamed).toMatchObject({ name: 'Final', reportGz });
  });

  it('refuses garbage and a zip bomb instead of inflating it', async () => {
    const kv = memoryKV();
    const { report: _drop, ...rest } = body('tabc12345');
    void _drop;
    expect((await teamSaveRoute('PUT', 'tabc12345', { ...rest, reportGz: 'not-gzip' }, 'u1', kv)).status).toBe(400);
    // 40 MB of zeros compresses to ~40 kB — the server must stop at its ceiling.
    const bomb = gzipSync(Buffer.alloc(40_000_000)).toString('base64');
    expect(bomb.length).toBeLessThan(1_000_000);
    expect((await teamSaveRoute('PUT', 'tabc12345', { ...rest, reportGz: bomb }, 'u1', kv)).status).toBe(400);
  });

  it('renaming a save that is not there is a 404', async () => {
    expect((await teamSaveRoute('PATCH', 'tabc12345', { name: 'x' }, 'u1', memoryKV())).status).toBe(404);
  });

  it('names what it allows', async () => {
    const out = await teamSaveRoute('POST', 'tabc12345', null, 'u1', memoryKV());
    expect(out.status).toBe(405);
    expect(out.allow).toContain('PATCH');
  });
});

describe('gzip, browser half and server half', () => {
  const text = JSON.stringify({ a: 'é ✓ 🏆', n: Array.from({ length: 5000 }, (_, i) => i) });

  it('round-trips through the browser helpers', async () => {
    expect(await gunzipText(await gzipText(text))).toBe(text);
  });

  it('the browser compresses what node:zlib reads, and the reverse', async () => {
    expect(gunzipSync(Buffer.from(await gzipText(text), 'base64')).toString('utf8')).toBe(text);
    expect(await gunzipText(gzipSync(Buffer.from(text, 'utf8')).toString('base64'))).toBe(text);
  });

  it('is available where the suite runs, as in every current browser', () => {
    expect(canGzip()).toBe(true);
  });
});

describe('the saved list on screen', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

  it('is always there, even empty — a phone with no local saves showed nothing', () => {
    const src = read('src/components/Analytics/TeamAnalysis/TeamSaves.tsx');
    expect(src).not.toMatch(/if \(!saves\.length\) return null/);
    expect(src).toMatch(/Saved analyses/);
  });

  it('syncs with the account when it mounts', () => {
    expect(read('src/components/Analytics/TeamAnalysis/TeamSaves.tsx')).toMatch(/void sync\(\)/);
  });

  it('never tells anyone a board is too large to store in the browser', () => {
    expect(read('src/components/Analytics/TeamAnalysis/TeamAnalysis.tsx')).not.toMatch(/too large to store in the browser/);
  });
});
