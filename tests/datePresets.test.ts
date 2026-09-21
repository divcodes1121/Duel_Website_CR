import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { RANGE_PRESETS } from '../src/components/Analytics/playerData';
import { COACH_WINDOWS } from '../src/state/coachRoster';
import { DAY_PRESETS, DEFAULT_DAYS, dayChip, dayLabel } from '../src/utils/datePresets';

/**
 * ONE LIST OF DAY WINDOWS, READ BY EVERY DATE FILTER.
 *
 * There were three and they disagreed — 7/14/30/60/90 on the analytics
 * screens, 15/30/45/60 on Coach Assist, 7/30/90 on the Coach Roster — and Team
 * Analysis had no window at all. The account holder asked for 7, 15, 30, 45,
 * 60 and 90 on every date filter (2026-09-21). A TRIPWIRE, deliberately: a
 * screen that grows its own list again fails here rather than quietly drifting.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the shared day windows', () => {
  it('are exactly 7, 15, 30, 45, 60 and 90, in order', () => {
    expect([...DAY_PRESETS]).toEqual([7, 15, 30, 45, 60, 90]);
    expect(DEFAULT_DAYS).toBe(30);
  });

  it('print as "Last N Days" and "Nd"', () => {
    expect(dayLabel(15)).toBe('Last 15 Days');
    expect(dayChip(45)).toBe('45d');
  });
});

describe('every date filter reads them', () => {
  it('the analytics screens offer all six, then All Data and Custom', () => {
    const days = RANGE_PRESETS.map((r) => r.days);
    expect(days.slice(0, 6)).toEqual([...DAY_PRESETS]);
    expect(days.slice(6)).toEqual([0, -1]);
    // The old list had 14 and no 15 or 45.
    expect(days).not.toContain(14);
  });

  it('the Coach Roster offers all six, then All', () => {
    expect([...COACH_WINDOWS]).toEqual([...DAY_PRESETS, 0]);
  });

  it('Coach Assist reads the shared list instead of its own four', () => {
    const src = read('src/components/Analytics/CoachAssist.tsx');
    expect(src).toMatch(/const HISTORY_DAYS = DAY_PRESETS;/);
    expect(src).not.toMatch(/\[15, 30, 45, 60\]/);
  });

  it('Team Analysis has a window now, and sends it', () => {
    const src = read('src/components/Analytics/TeamAnalysis/TeamAnalysis.tsx');
    expect(src).toMatch(/DAY_PRESETS\.map/);
    // The run passes `days` as the third argument — it used to rely on the
    // client's default of 30 and offer no way to ask for anything else.
    expect(src).toMatch(/red\.members\.map\(\(m\) => m\.tag\),\s*days,\s*\)/);
  });

  it('no screen carries a private list of day windows', () => {
    for (const f of [
      'src/components/Analytics/CoachAssist.tsx',
      'src/components/Analytics/TeamAnalysis/TeamAnalysis.tsx',
      'src/state/coachRoster.ts',
      'src/components/Analytics/playerData.ts',
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\[\s*7\s*,\s*30\s*,\s*90/);
      expect(src, f).not.toMatch(/days:\s*14\b/);
    }
  });
});
