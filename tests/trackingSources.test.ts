import { describe, expect, it } from 'vitest';

import {
  FAMILIES,
  SITE_FAMILIES,
  SITE_FAMILY_IDS,
  dailyStack,
  familyOf,
  familyTotals,
  formatWait,
  shortDay,
  sourceLabel,
} from '../src/state/trackingSources';

describe('where a queued tag came from', () => {
  it('folds every source the server writes into a family', () => {
    // The strings `server/app.py`, `team_analysis.py`, `recruit.py` and
    // `duo_pairs.py` actually pass to the queue.
    const seen: Record<string, string> = {
      search: 'search',
      duels: 'screens',
      duelzone: 'screens',
      battles: 'screens',
      cards: 'screens',
      counter: 'screens',
      coverage: 'screens',
      coach: 'coach',
      roster: 'coach',
      team: 'coach',
      leaderboard: 'leaderboard',
      '2v2': 'duo',
      opponent: 'opponent',
      direct: 'direct',
    };
    for (const [src, fam] of Object.entries(seen)) expect(familyOf(src)).toBe(fam);
  });

  it('files a source it does not know under Other rather than guessing', () => {
    expect(familyOf('some-new-route')).toBe('direct');
    expect(familyOf(null)).toBe('direct');
    expect(familyOf('')).toBe('direct');
  });

  it('gives the six families the six series slots in order, and Other the neutral', () => {
    // Colour follows the family: a family keeps its slot whatever else is on
    // screen, so a window without a family never repaints the rest.
    expect(FAMILIES.map((f) => f.color)).toEqual([
      'var(--chart-1)',
      'var(--chart-2)',
      'var(--chart-3)',
      'var(--chart-4)',
      'var(--chart-5)',
      'var(--chart-6)',
      'var(--chart-other)',
    ]);
    expect(new Set(FAMILIES.map((f) => f.id)).size).toBe(FAMILIES.length);
  });

  it('counts search, screens and coach tools as asked on the site, and nothing bulk', () => {
    expect([...SITE_FAMILY_IDS]).toEqual(['search', 'screens', 'coach']);
    for (const bulk of ['leaderboard', 'duo', 'opponent', 'direct'] as const) expect(SITE_FAMILIES.has(bulk)).toBe(false);
  });

  it('names the screen behind a source, and passes an unknown one through', () => {
    expect(sourceLabel('duelzone')).toBe('Duel Zone');
    expect(sourceLabel('team')).toBe('Team Analysis');
    expect(sourceLabel('mystery')).toBe('mystery');
  });
});

describe('the daily stack', () => {
  const daily = [
    { day: '2026-09-24', bySource: { duels: 2, direct: 5 } },
    { day: '2026-09-26', bySource: { team: 4, duels: 1, battles: 1, direct: 4 } },
  ];

  it('is one row per day, oldest first, with the empty days filled', () => {
    const rows = dailyStack(daily, 4, '2026-09-26');
    expect(rows.map((r) => r.x)).toEqual(['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
    expect(rows[0].screens).toBe(0);
    expect(rows[2].direct).toBe(0);
  });

  it('adds sources into their family', () => {
    const rows = dailyStack(daily, 4, '2026-09-26');
    expect(rows[3].screens).toBe(2);
    expect(rows[3].coach).toBe(4);
    expect(rows[3].direct).toBe(4);
  });

  it('drops a day outside the window rather than stretching it', () => {
    const rows = dailyStack(daily, 1, '2026-09-26');
    expect(rows).toHaveLength(1);
    expect(familyTotals(rows).screens).toBe(2);
    expect(familyTotals(rows).direct).toBe(4);
  });

  it('survives a bad day string without inventing rows', () => {
    expect(dailyStack(daily, 7, 'not-a-day')).toEqual([]);
  });
});

describe('words', () => {
  it('states a wait at a sensible grain', () => {
    expect(formatWait(20)).toBe('under a minute');
    expect(formatWait(3513)).toBe('59 min');
    expect(formatWait(7500)).toBe('2 h 5 min');
    expect(formatWait(7200)).toBe('2 h');
    expect(formatWait(3 * 86400 + 4 * 3600)).toBe('3 d 4 h');
    expect(formatWait(null)).toBe('—');
    expect(formatWait(-5)).toBe('—');
  });

  it('prints a day in UTC so it cannot slide by a timezone', () => {
    // ICU prints September as "Sep" or "Sept" depending on its version.
    expect(shortDay('2026-09-26')).toMatch(/^26 Sept?$/);
  });
});
