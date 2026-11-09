import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bySlot } from '../src/utils/duelSlots';
import { DUEL_ANALYSIS_DAY_PRESETS, DUEL_ANALYSIS_DEFAULT_DAYS } from '../src/utils/datePresets';

const rows = [
  { name: 'a', slotShare: [2, 9, 1], useRate: 5 },
  { name: 'b', slotShare: [8, 1, 3], useRate: 4 },
  { name: 'c', slotShare: [5, 5, 9], useRate: 9 },
  { name: 'd', slotShare: [5, 0, 0], useRate: 1 },
];

describe('bySlot', () => {
  it('orders by G1 usage', () => {
    expect(bySlot(rows, 0).map((r) => r.name)).toEqual(['b', 'c', 'd', 'a']);
  });
  it('orders by G2 and G3 when switched', () => {
    expect(bySlot(rows, 1).map((r) => r.name)).toEqual(['a', 'c', 'b', 'd']);
    expect(bySlot(rows, 2).map((r) => r.name)).toEqual(['c', 'b', 'a', 'd']);
  });
  it('breaks a tie on the overall use rate', () => {
    expect(bySlot(rows, 0).slice(1, 3).map((r) => r.name)).toEqual(['c', 'd']);
  });
  it('does not reorder its input', () => {
    bySlot(rows, 2);
    expect(rows.map((r) => r.name)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('Duel Analysis windows', () => {
  it('are 7, 15, 28, 45 and 60 days, opening on 28', () => {
    expect([...DUEL_ANALYSIS_DAY_PRESETS]).toEqual([7, 15, 28, 45, 60]);
    expect(DUEL_ANALYSIS_DEFAULT_DAYS).toBe(28);
  });
  it('are chips on the screen, and the table is ordered by a slot switch', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/Analytics/DuelAnalysis.tsx'), 'utf8');
    expect(src).toContain('DUEL_ANALYSIS_DAY_PRESETS.map');
    expect(src).toContain('bySlot(t.rows, slot)');
    expect(src).toMatch(/useState<SlotId>\('g1'\)/);
    expect(src).not.toContain('rangePop');
  });
});
