import { describe, expect, it } from 'vitest';

import { clampTip, gaugeArc, shareOf, tipAbove } from '../src/components/ui/dashGeometry';
import { DASH, facedBars, facedRateBars, recordLine } from '../src/state/coachDashboard';

describe('tooltip placement', () => {
  it('centres on the anchor when there is room', () => {
    expect(clampTip(200, 100, 400)).toBe(150);
  });
  it('pins to the edge it would cross', () => {
    expect(clampTip(10, 100, 400)).toBe(4);
    expect(clampTip(395, 100, 400)).toBe(296);
  });
  it('pins left when wider than its box — the title survives', () => {
    expect(clampTip(50, 500, 300)).toBe(4);
  });
  it('flips below only when there is no room above', () => {
    expect(tipAbove(100, 60)).toBe(true);
    expect(tipAbove(40, 60)).toBe(false);
  });
});

describe('gauge', () => {
  it('a half arc is half a circumference long', () => {
    expect(gaugeArc(100, 100, 50, 180).length).toBeCloseTo(Math.PI * 50);
  });
  it('starts at nine o\'clock and ends at three for a half arc', () => {
    expect(gaugeArc(100, 100, 50, 180).d).toBe('M 50.00 100.00 A 50 50 0 0 1 150.00 100.00');
  });
  it('clamps a share and survives a zero maximum', () => {
    expect(shareOf(5, 0)).toBe(1);
    expect(shareOf(-1, 10)).toBe(0);
    expect(shareOf(15, 10)).toBe(1);
    expect(shareOf(0, 0)).toBe(0);
  });
});

const a = (name: string, battles: number, wins: number, draws = 0) => ({
  name,
  battles,
  wins,
  losses: battles - wins - draws,
  draws,
});

describe('bar tooltips never state a rate the matchup cards withheld', () => {
  it('prints the rate only past the floor', () => {
    expect(recordLine(a('Hog', DASH.matchupBattles, 6))).toContain('60.0% won');
    expect(recordLine(a('Hog', DASH.matchupBattles - 1, 6))).toContain('too few to rate');
    expect(recordLine(a('Hog', 1, 1))).toBe('1 battle · 1W 0L · too few to rate');
  });

  it('facedBars carries the record line as its detail', () => {
    expect(facedBars([a('Hog', 25, 10)], 100)[0].detail).toBe(recordLine(a('Hog', 25, 10)));
  });

  it('the rate view keeps the share view\'s order and drops the unjudged', () => {
    const rows = [a('Hog', 40, 30), a('Golem', 3, 0), a('Miner', 20, 5), a('X-Bow', 15, 9)];
    const bars = facedRateBars(rows, 60);
    expect(bars.map((b) => b.label)).toEqual(['Hog', 'Miner', 'X-Bow']);
    expect(bars.map((b) => b.tone)).toEqual(['good', 'bad', 'neutral']);
    expect(bars[1].detail).toContain('-35.0 vs their 60.0%');
  });

  it('uses the matchup cards\' own gaps for its tones', () => {
    const overall = 50;
    const at = (wins: number) => facedRateBars([a('A', 100, wins)], overall)[0].tone;
    expect(at(50 - DASH.matchupGap)).toBe('warn');
    expect(at(50 - DASH.severeGap)).toBe('bad');
    expect(at(50 - DASH.matchupGap + 1)).toBe('neutral');
    expect(at(50 + DASH.matchupGap)).toBe('good');
  });
});
