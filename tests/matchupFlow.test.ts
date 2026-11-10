import { describe, expect, it } from 'vitest';
import type { PlaysFamily, TeamRecommendation, TeamThreat } from '../src/state/analyticsClient';
import {
  buildFlow,
  chainFor,
  deckId,
  dominantSource,
  firstLink,
  flowTone,
  sourceWord,
  validFocus,
  wirePath,
} from '../src/utils/matchupFlow';

const cards = (p: string) => Array.from({ length: 8 }, (_, i) => `${p}-${i}`);

const plays: PlaysFamily[] = [
  { family: 'hog', archetype: 'hog', name: 'Hog Rider', share: 0.6, games: 300, decks: 3 },
  { family: 'drill', archetype: 'drill', name: 'Goblin Drill', share: 0.4, games: 100, decks: 1 },
];

function threat(key: string, family: string, likelihood: number): TeamThreat {
  return {
    key, family, likelihood, cards: cards(key), art: {}, archetype: family, name: key,
    evidence: 'observed', observedCount: 10, wins: 5, winRate: 50, lastSeen: null,
    similarityToObserved: 1, basis: null, confidence: 'known',
  } as TeamThreat;
}

const threats = [threat('h1', 'hog', 0.4), threat('h2', 'hog', 0.2), threat('d1', 'drill', 0.4)];

function deck(key: string, vs: Record<string, number>, vsLists?: TeamRecommendation['vsLists']) {
  return { key, cards: cards(key), art: {}, name: key, archetype: 'x', avgElixir: 3,
    owner: null, comfort: null, expectedWinRate: 60, spreadCovered: 100, score: 0, vs, vsLists,
  } as unknown as TeamRecommendation;
}

const decks = [
  deck('a', { hog: 58, drill: 70 }, { h1: [60, 'version', 100], h2: [54, 'deck', 40], d1: [70, 'cluster7', 20] }),
  deck('b', { hog: 49 }),
];

describe('the matchup map', () => {
  it('reads their families in their order, with their lists most likely first', () => {
    const m = buildFlow(plays, threats, decks);
    expect(m.their.map((t) => t.family)).toEqual(['hog', 'drill']);
    expect(m.their[0].lists.map((l) => l.key)).toEqual(['h1', 'h2']);
    expect(m.their[0].lists[0].within).toBeCloseTo(2 / 3);
  });

  it('a link carries the deck\'s own family rate, and each list\'s rung', () => {
    const l = buildFlow(plays, threats, decks).link('hog', 'a')!;
    expect(l.rate).toBe(58);
    expect(l.tone).toBe('win');
    expect(l.source).toBe('version');
    expect(l.games).toBe(140);
    expect(l.lists.map((x) => x.rate)).toEqual([60, 54]);
  });

  it('a family with no measured rate has no link — never 50', () => {
    const m = buildFlow(plays, threats, decks);
    expect(m.link('drill', 'b')).toBeNull();
    expect(chainFor(m, { side: 'ours', id: 'b' }).map((l) => l.family)).toEqual(['hog']);
  });

  it('centred on their deck, the chain runs in the order of our decks', () => {
    const m = buildFlow(plays, threats, decks);
    expect(chainFor(m, { side: 'their', id: 'hog' }).map((l) => l.deckId)).toEqual(['a', 'b']);
    expect(firstLink(m, { side: 'their', id: 'hog' })?.deckId).toBe('a');
    expect(firstLink(m, { side: 'ours', id: 'a' })?.family).toBe('hog');
  });

  it('works without per-list rates (an older server)', () => {
    const m = buildFlow(plays, undefined, [deck('a', { hog: 52 })]);
    const l = m.link('hog', 'a')!;
    expect(l.source).toBeNull();
    expect(l.lists).toEqual([]);
    expect(l.tone).toBe('even');
  });

  it("reads a Team Analysis row's rates by position in the threats (vsAt)", () => {
    const d = deck('t', { hog: 58 });
    (d as TeamRecommendation).vsAt = [[60, 'version', 100], null, [70, 'cluster6', 9]];
    const m = buildFlow(plays, threats, [d]);
    const l = m.link('hog', 't')!;
    expect(l.lists.map((x) => x.rate)).toEqual([60, null]);
    expect(l.source).toBe('version');
    expect(m.link('drill', 't')).toBeNull();
  });

  it('draws the first N decks, plus the one it was opened on at its own rank', () => {
    const many = Array.from({ length: 14 }, (_, i) => deck(`k${i}`, { hog: 55 }));
    const m = buildFlow(plays, threats, many, { limit: 10, keep: 'k12' });
    expect(m.ours.map((o) => o.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13]);
    expect(m.hidden).toBe(3);
    expect(buildFlow(plays, threats, many).hidden).toBe(0);
  });

  it('falls back to the most likely family when the focus is gone', () => {
    const m = buildFlow(plays, threats, decks);
    expect(validFocus(m, { side: 'ours', id: 'zzz' })).toEqual({ side: 'their', id: 'hog' });
    expect(validFocus(m, { side: 'ours', id: deckId(decks[1]) })).toEqual({ side: 'ours', id: 'b' });
  });

  it('tones, words and wires', () => {
    expect([flowTone(55), flowTone(50), flowTone(49.9)]).toEqual(['win', 'even', 'lose']);
    expect(sourceWord('cluster7')).toBe('1 card different');
    expect(sourceWord('cluster6')).toBe('2 cards different');
    expect(sourceWord(null)).toBe('Measured');
    expect(dominantSource([
      { within: 0.5, source: 'deck', rate: 50 },
      { within: 0.5, source: 'version', rate: 50 },
    ])).toBe('version');
    expect(wirePath(0, 0, 100, 50)).toBe('M0,0 C50,0 50,50 100,50');
    expect(wirePath(10, 0, 40, 100, 'v').startsWith('M10,0 C10,')).toBe(true);
  });
});
