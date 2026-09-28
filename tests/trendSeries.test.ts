import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DECK_RATE_FLOOR } from '../src/state/coachScout';
import {
  TREND_MIN_DAYS,
  TREND_MIN_GAMES,
  distinctDeckLabels,
  foldMean,
  gapUnplayed,
  trendOf,
} from '../src/utils/trendSeries';

describe('gapUnplayed', () => {
  it('turns a day with no games into a gap, not a 0% win rate', () => {
    expect(gapUnplayed([60, 0, 50], [10, 0, 5])).toEqual([60, null, 50]);
  });

  it('keeps a real 0% — a day the deck was played and lost every game', () => {
    expect(gapUnplayed([0, 100], [4, 2])).toEqual([0, 100]);
  });

  it('treats a missing or non-finite use value as unplayed', () => {
    expect(gapUnplayed([50, 50, Number.NaN], [3])).toEqual([50, null, null]);
  });
});

describe('trendOf', () => {
  it('compares the later half of the played days with the earlier half', () => {
    // Played days in order: 40 60 | 70 90 -> 80 - 50 = 30.
    expect(trendOf([40, null, 60, null, null, 70, 90])).toBe(30);
  });

  it('leaves an odd middle day out of both halves', () => {
    // 40 60 [1000] 70 90: the middle day must not move the answer.
    expect(trendOf([40, 60, 1000, 70, 90])).toBe(30);
  });

  it('does not read a deck played less often lately as a deck getting worse', () => {
    // A steady 60% deck, played every day early and on two days late. The old
    // column averaged the unplayed days in as zeros and printed a fall.
    const win = [60, 60, 60, 60, 60, 60, null, null, null, 60, null, 60];
    expect(trendOf(win)).toBe(0);
    const zeros = win.map((v) => v ?? 0);
    const third = 4;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(zeros.slice(-third)) - avg(zeros.slice(0, third))).toBe(-30);
  });

  it('answers for a deck played only in the middle of the window', () => {
    // Players rotate decks; a thirds-of-the-window rule withheld this one.
    expect(trendOf([null, null, null, 50, 50, 70, 70, null, null, null])).toBe(20);
  });

  it('withholds the trend below two played days a half', () => {
    expect(TREND_MIN_DAYS).toBe(2);
    expect(trendOf([50, null, 70, null, 90])).toBeNull();
    expect(trendOf([50, 60, 70, 80])).toBe(20);
  });

  it('withholds rather than invents on a series too short to split', () => {
    expect(trendOf([])).toBeNull();
    expect(trendOf([55])).toBeNull();
  });
});

describe('trendOf with per-day game counts', () => {
  it('pools each half by games, so a one-game day cannot swing it', () => {
    // Earlier: 10 games at 80% and 1 game at 0%. Later: 10 games at 80% and
    // 1 game at 100%. Days alone say 40 -> 90, a 50-point climb; the games
    // say 72.7% -> 81.8%, about nine points.
    const win = [80, 0, 80, 100];
    const games = [10, 1, 10, 1];
    expect(trendOf(win)).toBe(50);
    expect(trendOf(win, games)).toBe(9.1);
  });

  it('withholds a half under the five-game floor the site uses for any deck rate', () => {
    expect(TREND_MIN_GAMES).toBe(DECK_RATE_FLOOR);
    expect(trendOf([50, 60, 70, 80], [2, 2, 2, 2])).toBeNull();
    expect(trendOf([50, 60, 70, 80], [3, 3, 3, 3])).toBe(20);
  });

  it('treats a game count of zero as a gap even where the rate reads 0', () => {
    expect(gapUnplayed([0, 0, 50], [0, 0, 0], [0, 3, 2])).toEqual([null, 0, 50]);
  });
});

describe('foldMean', () => {
  it('averages only the series that have a value that day', () => {
    expect(foldMean([[40, null, null], [60, 80, null]])).toEqual([50, 80, null]);
  });

  it('returns an empty series for nothing to fold', () => {
    expect(foldMean([])).toEqual([]);
  });
});

describe('distinctDeckLabels', () => {
  const name = (k: string) => k.replace(/(^|-)(\w)/g, (_, s, c) => `${s ? ' ' : ''}${c.toUpperCase()}`);

  it('leaves a unique name alone', () => {
    expect(distinctDeckLabels([{ name: 'Hog Rider', cards: ['hog-rider'] }], name)).toEqual(['Hog Rider']);
  });

  it('names the first card, in seated order, that no other deck of that name runs', () => {
    const decks = [
      { name: 'Giant', cards: ['giant', 'sparky', 'zap'] },
      { name: 'Giant', cards: ['giant', 'balloon', 'zap'] },
      { name: 'Royal Hogs', cards: ['royal-hogs'] },
    ];
    expect(distinctDeckLabels(decks, name)).toEqual(['Giant + Sparky', 'Giant + Balloon', 'Royal Hogs']);
  });

  it('needs the card to be absent from EVERY other same-named deck', () => {
    const decks = [
      { name: 'Royal Hogs', cards: ['royal-hogs', 'earthquake', 'fire-spirit'] },
      { name: 'Royal Hogs', cards: ['royal-hogs', 'earthquake', 'goblin-cage'] },
      { name: 'Royal Hogs', cards: ['royal-hogs', 'fire-spirit', 'goblin-cage'] },
    ];
    // Deck 1's earthquake is in deck 2 and its fire spirit in deck 3.
    expect(distinctDeckLabels(decks, name)).toEqual(['Royal Hogs #1', 'Royal Hogs #2', 'Royal Hogs #3']);
  });

  it('never returns two equal labels for the decks it was given', () => {
    const decks = [
      { name: 'Mortar', cards: ['mortar', 'miner'] },
      { name: 'Mortar', cards: ['mortar', 'miner', 'bats'] },
    ];
    const labels = distinctDeckLabels(decks, name);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(['Mortar #1', 'Mortar + Bats']);
  });
});

describe('the screen and the PDF share the rule', () => {
  it('both call gapUnplayed and distinctDeckLabels', () => {
    for (const file of ['src/components/Analytics/PlayerAnalysis.tsx', 'src/utils/reportAdapters.ts']) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).toContain('gapUnplayed(');
      expect(src, file).toContain('distinctDeckLabels(');
    }
  });

  it('the chart lifts its pen at a gap instead of drawing to zero', () => {
    const src = readFileSync('src/components/Analytics/TrendChart.tsx', 'utf8');
    expect(src).toContain('pen = false');
    expect(src).not.toMatch(/points\[i\]\s*\?\?\s*0/);
  });
});
