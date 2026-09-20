import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  COACH_SECTIONS,
  RosterError,
  cleanNewPlayer,
  coachHref,
  explainDbError,
  memoryRepo,
  parseCoachRoute,
  playerLabel,
  sortRoster,
  type RosterPlayer,
} from '../src/state/coachRoster';

const player = (over: Partial<RosterPlayer>): RosterPlayer => ({
  id: 'x',
  playerTag: '#2PYLQ0',
  displayName: null,
  notes: null,
  isActive: true,
  createdAt: '2026-09-20T00:00:00Z',
  updatedAt: '2026-09-20T00:00:00Z',
  ...over,
});

describe('a new roster entry', () => {
  it('normalises the tag the way the server does', () => {
    expect(cleanNewPlayer({ playerTag: ' y022grcjq ' }, []).playerTag).toBe('#Y022GRCJQ');
    expect(cleanNewPlayer({ playerTag: '#Y022GRCJQ' }, []).playerTag).toBe('#Y022GRCJQ');
  });

  // The same rule as the table's CHECK and `clash_data.normalize_tag`.
  it('refuses what the database would refuse', () => {
    for (const bad of ['', '#abc', '#2PYL', '#2PYLQ0XXXXXXX', '#2PYLQ0!', '#AAAAAA']) {
      expect(() => cleanNewPlayer({ playerTag: bad }, [])).toThrow(RosterError);
    }
  });

  it('refuses a tag already on the roster, however it was typed', () => {
    const existing = [player({ playerTag: '#Y022GRCJQ' })];
    expect(() => cleanNewPlayer({ playerTag: 'y022grcjq' }, existing)).toThrowError(/already on your roster/);
  });

  it('keeps an empty name and empty notes as null, not as blank strings', () => {
    const c = cleanNewPlayer({ playerTag: '#2PYLQ0', displayName: '   ', notes: '' }, []);
    expect(c.displayName).toBeNull();
    expect(c.notes).toBeNull();
  });

  it('stops at the same length the table stops at', () => {
    expect(() => cleanNewPlayer({ playerTag: '#2PYLQ0', displayName: 'x'.repeat(41) }, [])).toThrowError(/40/);
    expect(cleanNewPlayer({ playerTag: '#2PYLQ0', displayName: 'x'.repeat(40) }, []).displayName).toHaveLength(40);
  });
});

describe('database errors, worded', () => {
  it('names the three the table actually raises', () => {
    expect(explainDbError('23505', 'dup').code).toBe('duplicate');
    expect(explainDbError('23514', 'check').code).toBe('invalid_tag');
    expect(explainDbError('42501', 'rls').code).toBe('not_authorised');
    expect(explainDbError(undefined, 'boom').code).toBe('unknown');
  });

  it('keeps the database message for the console', () => {
    expect(explainDbError('23505', 'duplicate key value').detail).toBe('duplicate key value');
  });
});

describe('the roster list', () => {
  it('calls a player by the coach name, else by the tag', () => {
    expect(playerLabel({ displayName: 'Rahul', playerTag: '#2PYLQ0' })).toBe('Rahul');
    expect(playerLabel({ displayName: '  ', playerTag: '#2PYLQ0' })).toBe('#2PYLQ0');
  });

  it('lists active players first, alphabetically, archived last', () => {
    const out = sortRoster([
      player({ id: 'a', displayName: 'zed' }),
      player({ id: 'b', displayName: 'Old', isActive: false }),
      player({ id: 'c', displayName: 'arjun' }),
    ]);
    expect(out.map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('the route', () => {
  it('round-trips a player and a section through the hash, without the #', () => {
    const href = coachHref('#Y022GRCJQ', 'overview');
    expect(href).toBe('#/admin/coach/Y022GRCJQ/overview');
    expect(parseCoachRoute(href)).toEqual({ tag: '#Y022GRCJQ', section: 'overview' });
  });

  it('keeps every section through the hash, arsenal included', () => {
    for (const section of COACH_SECTIONS) {
      expect(parseCoachRoute(coachHref('#Y022GRCJQ', section)).section).toBe(section);
    }
  });

  it('falls back to no player and Overview for anything it does not recognise', () => {
    expect(parseCoachRoute('#/admin/coach')).toEqual({ tag: null, section: 'overview' });
    expect(parseCoachRoute('#/admin/coach/not-a-tag/nowhere')).toEqual({ tag: null, section: 'overview' });
  });
});

describe('the local preview repository', () => {
  it('applies the table rules: format, and one row per tag', async () => {
    const repo = memoryRepo();
    await repo.add({ playerTag: 'y022grcjq', displayName: 'Rahul' });
    await expect(repo.add({ playerTag: '#Y022GRCJQ' })).rejects.toThrow(/already on your roster/);
    await expect(repo.add({ playerTag: '#bad' })).rejects.toThrow(RosterError);
    expect(await repo.list()).toHaveLength(1);
  });

  it('renames, archives and removes', async () => {
    const repo = memoryRepo();
    const p = await repo.add({ playerTag: '#2PYLQ0' });
    expect((await repo.update(p.id, { displayName: 'Arjun' })).displayName).toBe('Arjun');
    expect((await repo.update(p.id, { isActive: false })).isActive).toBe(false);
    expect(await repo.remove(p.id)).toBe('deleted');
    expect(await repo.list()).toHaveLength(0);
  });

  it('says it is the local preview, so the screen can say it saves nothing', () => {
    expect(memoryRepo().kind).toBe('memory');
  });
});

/* SOURCE CONTRACTS — the suite runs in `node` with no jsdom, so what is pinned
   here is the wiring a careless edit would break silently. */
describe('the admin gate', () => {
  const R = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');
  const app = R('src', 'App.tsx');
  const screen = R('src', 'components', 'Admin', 'CoachRoster', 'CoachRoster.tsx');

  it('routes #/admin/coach BEFORE the #/admin console, or the console would swallow it', () => {
    const coach = app.indexOf("route.startsWith('#/admin/coach')");
    const console_ = app.indexOf("route.startsWith('#/admin')");
    expect(coach).toBeGreaterThan(-1);
    expect(coach).toBeLessThan(console_);
  });

  it('refuses a non-admin on screen — a courtesy on top of the database refusing them', () => {
    expect(screen).toContain("access !== 'admin'");
  });

  it('is lazy, so the public bundle does not carry it', () => {
    expect(app).toMatch(/lazy\(\(\) =>\s*import\('\.\/components\/Admin\/CoachRoster\/CoachRoster'\)/);
  });
});

describe('battle times', () => {
  it('turns the battle log format into something Date.parse reads', async () => {
    const { battleTimeToIso } = await import('../src/state/coachRoster');
    const iso = battleTimeToIso('20260907T161011.000Z');
    expect(iso).toBe('2026-09-07T16:10:11Z');
    expect(Number.isNaN(Date.parse(iso!))).toBe(false);
    expect(battleTimeToIso('garbage')).toBeNull();
    expect(battleTimeToIso(null)).toBeNull();
  });
});
