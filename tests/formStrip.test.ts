import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { FORM_SIZE, STREAK_MIN, formOf, pageOf, streakLabel, type Result } from '../src/utils/formStrip';

/** Newest first, as the log arrives: 'WWL' is a win, then a win, then a loss. */
const log = (s: string) =>
  s.split('').map((c, i) => ({ id: String(i), result: ({ W: 'win', L: 'loss', D: 'draw' } as const)[c as 'W'] as Result }));

describe('formOf', () => {
  it('draws the strip oldest first', () => {
    expect(formOf(log('WLD')).ordered.map((b) => b.result)).toEqual(['draw', 'loss', 'win']);
  });

  it('counts the run the NEWEST result belongs to', () => {
    expect(formOf(log('WWWWLWW')).streak).toEqual({ result: 'win', length: 4 });
    expect(formOf(log('LLLW')).streak).toEqual({ result: 'loss', length: 3 });
  });

  it('does not call one result a streak', () => {
    expect(STREAK_MIN).toBe(2);
    expect(formOf(log('WL')).streak).toBeNull();
  });

  it('takes at most the newest FORM_SIZE', () => {
    const f = formOf(log('L' + 'W'.repeat(30)));
    expect(FORM_SIZE).toBe(20);
    expect(f.ordered).toHaveLength(20);
    expect(f.losses).toBe(1);
    expect(f.ordered[f.ordered.length - 1].result).toBe('loss');
  });

  it('rates over decided games, the way the log header does', () => {
    const f = formOf(log('WWWLD'));
    expect([f.wins, f.losses, f.draws]).toEqual([3, 1, 1]);
    expect(f.winRate).toBe(75);
    expect(formOf(log('DD')).winRate).toBeNull();
  });

  it('is empty for an empty log', () => {
    const f = formOf([]);
    expect(f.ordered).toEqual([]);
    expect(f.streak).toBeNull();
  });
});

describe('streakLabel', () => {
  it('names each kind of run', () => {
    expect(streakLabel({ result: 'win', length: 4 })).toBe('4-win streak');
    expect(streakLabel({ result: 'loss', length: 3 })).toBe('3-loss run');
    expect(streakLabel({ result: 'draw', length: 2 })).toBe('2 draws in a row');
  });
});

describe('pageOf', () => {
  it('finds the log page that holds a battle', () => {
    expect(pageOf(0, 10)).toBe(1);
    expect(pageOf(9, 10)).toBe(1);
    expect(pageOf(10, 10)).toBe(2);
    expect(pageOf(19, 10)).toBe(2);
  });
});

describe('the strip on the screen', () => {
  it('reads the newest battles itself, not whatever page the log is on', () => {
    const src = readFileSync('src/components/Analytics/RecentBattles.tsx', 'utf8');
    expect(src).toContain('fetchRecentBattles(tag, win, 1, FORM_SIZE)');
    expect(src).toContain('<FormStrip');
  });

  it('carries each result as a letter as well as a hue', () => {
    const src = readFileSync('src/components/Analytics/FormStrip.tsx', 'utf8');
    expect(src).toContain("LETTER = { win: 'W', loss: 'L', draw: 'D' }");
  });
});
