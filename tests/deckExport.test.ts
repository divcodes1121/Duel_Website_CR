import { describe, expect, it } from 'vitest';
import {
  DECKS_PER_PAGE,
  PAIRS_PER_PAGE,
  buildContents,
  buildHomeSections,
  buildSoloSections,
  buildVersusSections,
  canExportDecks,
  countEntries,
  exportFileName,
  hasCards,
  limitSections,
  paginate,
  summarize,
  type ExportSection,
} from '../src/utils/deckExport';
import { createEmptyDeck, createEmptyDuelDeckSet } from '../src/state/deckUtils';
import { CARDS } from '../src/data/cards';
import type { Deck, DuelDeckSet, SavedDeckSet } from '../src/types/deck';

/** A deck holding `n` distinct real cards, so elixir stats are meaningful. */
function filledDeck(name: string, offset = 0, n = 8): Deck {
  const deck = createEmptyDeck(name);
  for (let i = 0; i < n; i++) deck.slots[i] = CARDS[(offset + i) % CARDS.length].key;
  return deck;
}

function setOf(name: string, decks: Deck[]): DuelDeckSet {
  return { ...createEmptyDuelDeckSet(name), decks };
}

describe('canExportDecks', () => {
  it('allows royal20 only', () => {
    expect(canExportDecks('royal20')).toBe(true);
    expect(canExportDecks('royal01')).toBe(false);
    expect(canExportDecks('royal2')).toBe(false);
  });

  it('is case and whitespace tolerant', () => {
    expect(canExportDecks(' Royal20 ')).toBe(true);
  });

  it('rejects signed-out users', () => {
    expect(canExportDecks(null)).toBe(false);
    expect(canExportDecks(undefined)).toBe(false);
    expect(canExportDecks('')).toBe(false);
  });
});

describe('hasCards', () => {
  it('is false for an empty deck and true once a card lands', () => {
    expect(hasCards(createEmptyDeck('e'))).toBe(false);
    expect(hasCards(filledDeck('f', 0, 1))).toBe(true);
    expect(hasCards(null)).toBe(false);
  });
});

describe('buildSoloSections', () => {
  it('exports only the revealed decks and skips empty ones', () => {
    const solo = setOf('Solo', [filledDeck('A'), createEmptyDeck('B'), filledDeck('C', 8), filledDeck('D', 16)]);
    const sections = buildSoloSections(solo, 3, []);
    expect(sections).toHaveLength(1);
    expect(sections[0].entries.map((e) => 'deck' in e && e.deck.name)).toEqual(['A', 'C']);
  });

  it('drops the section entirely when nothing is filled', () => {
    const solo = setOf('Solo', [createEmptyDeck('A'), createEmptyDeck('B')]);
    expect(buildSoloSections(solo, 2, [])).toEqual([]);
  });

  it('appends saved solo groups as their own sections', () => {
    const solo = setOf('Solo', [filledDeck('A')]);
    const saved: SavedDeckSet[] = [
      { id: '1', name: 'Ladder', mode: 'solo', solo: setOf('Ladder', [filledDeck('L', 24)]), savedAt: '' },
      { id: '2', name: 'Duels', mode: 'versus', blue: setOf('b', []), red: setOf('r', []), savedAt: '' },
    ];
    const sections = buildSoloSections(solo, 1, saved);
    expect(sections.map((s) => s.heading)).toEqual(['Solo Duel Decks', 'Ladder']);
  });
});

describe('buildVersusSections', () => {
  it('pairs blue against red slot for slot', () => {
    const blue = setOf('Blue', [filledDeck('B1'), filledDeck('B2', 8)]);
    const red = setOf('Red', [filledDeck('R1', 16), filledDeck('R2', 24)]);
    const [section] = buildVersusSections(blue, red, 2, 2, []);
    expect(section.kind).toBe('pairs');
    expect(section.entries).toHaveLength(2);
    const first = section.entries[0];
    expect('blue' in first && first.blue?.name).toBe('B1');
    expect('blue' in first && first.red?.name).toBe('R1');
  });

  it('keeps a half-filled row but drops rows where neither side has cards', () => {
    const blue = setOf('Blue', [filledDeck('B1'), createEmptyDeck('B2'), filledDeck('B3', 8)]);
    const red = setOf('Red', [createEmptyDeck('R1'), createEmptyDeck('R2'), createEmptyDeck('R3')]);
    const [section] = buildVersusSections(blue, red, 3, 3, []);
    expect(section.entries).toHaveLength(2);
    const rows = section.entries as { blue: Deck | null; red: Deck | null }[];
    expect(rows.map((r) => r.blue?.name)).toEqual(['B1', 'B3']);
    expect(rows.every((r) => r.red === null)).toBe(true);
  });

  it('honours each player’s own revealed slot count', () => {
    const blue = setOf('Blue', [filledDeck('B1'), filledDeck('B2', 8), filledDeck('B3', 16)]);
    const red = setOf('Red', [filledDeck('R1', 24), filledDeck('R2', 32), filledDeck('R3', 40)]);
    const [section] = buildVersusSections(blue, red, 3, 1, []);
    expect(section.entries).toHaveLength(3);
    const rows = section.entries as { blue: Deck | null; red: Deck | null }[];
    expect(rows.map((r) => r.red?.name ?? null)).toEqual(['R1', null, null]);
  });
});

describe('buildHomeSections', () => {
  it('collects every non-empty deck under one heading', () => {
    const sections = buildHomeSections([filledDeck('A'), createEmptyDeck('B'), filledDeck('C', 8)]);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('My Decks');
    expect(sections[0].entries).toHaveLength(2);
  });
});

describe('paginate', () => {
  const deckSection = (heading: string, n: number): ExportSection => ({
    kind: 'decks',
    heading,
    entries: Array.from({ length: n }, (_, i) => ({ deck: filledDeck(`D${i}`, i) })),
  });
  const pairSection = (heading: string, n: number): ExportSection => ({
    kind: 'pairs',
    heading,
    entries: Array.from({ length: n }, (_, i) => ({ blue: filledDeck(`B${i}`, i), red: filledDeck(`R${i}`, i + 40) })),
  });

  it('fits four decks per page', () => {
    const pages = paginate([deckSection('Solo', 9)]);
    expect(DECKS_PER_PAGE).toBe(4);
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.deckEntries.length)).toEqual([4, 4, 1]);
    expect(pages.map((p) => p.startIndex)).toEqual([1, 5, 9]);
  });

  it('fits three duel pairs per page', () => {
    const pages = paginate([pairSection('Blue vs Red', 5)]);
    expect(PAIRS_PER_PAGE).toBe(3);
    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.pairEntries.length)).toEqual([3, 2]);
  });

  it('never lets two sections share a page and numbers each section separately', () => {
    const pages = paginate([deckSection('Solo', 2), deckSection('Ladder', 5)]);
    expect(pages.map((p) => p.heading)).toEqual(['Solo', 'Ladder', 'Ladder']);
    expect(pages.map((p) => `${p.pageInSection}/${p.sectionPages}`)).toEqual(['1/1', '1/2', '2/2']);
  });

  it('carries the whole section total onto every one of its pages', () => {
    // The page banner quotes the section size, not how many rows this sheet holds.
    const pages = paginate([deckSection('Solo', 5)]);
    expect(pages.map((p) => p.sectionTotal)).toEqual([5, 5]);
    expect(pages.map((p) => p.deckEntries.length)).toEqual([4, 1]);
  });

  it('returns no pages for no sections', () => {
    expect(paginate([])).toEqual([]);
  });

  describe('buildContents', () => {
    it('points each section at its first page, counting the cover as page 1', () => {
      const sections = [deckSection('Solo', 5), pairSection('Duels', 4)];
      expect(buildContents(sections)).toEqual([
        { heading: 'Solo', page: 2, count: 5 },
        { heading: 'Duels', page: 4, count: 4 },
      ]);
    });

    it('gives same-named sections their own rows', () => {
      const rows = buildContents([deckSection('Ladder', 1), deckSection('Ladder', 1)]);
      expect(rows.map((r) => r.page)).toEqual([2, 3]);
    });
  });
});

describe('countEntries / limitSections', () => {
  const decks = (heading: string, n: number): ExportSection => ({
    kind: 'decks',
    heading,
    entries: Array.from({ length: n }, (_, i) => ({ deck: filledDeck(`${heading}${i}`, i) })),
  });
  const pairs = (heading: string, n: number): ExportSection => ({
    kind: 'pairs',
    heading,
    entries: Array.from({ length: n }, (_, i) => ({ blue: filledDeck(`B${i}`, i), red: null })),
  });

  it('counts every row across sections', () => {
    expect(countEntries([decks('A', 3), pairs('B', 2)])).toBe(5);
    expect(countEntries([])).toBe(0);
  });

  it('takes the first N rows, truncating the section the budget runs out in', () => {
    const limited = limitSections([decks('A', 3), decks('B', 4)], 5);
    expect(limited.map((s) => s.entries.length)).toEqual([3, 2]);
    expect(countEntries(limited)).toBe(5);
  });

  it('drops sections entirely once the budget is spent', () => {
    const limited = limitSections([decks('A', 4), decks('B', 4)], 2);
    expect(limited.map((s) => s.heading)).toEqual(['A']);
    expect(limited[0].entries.length).toBe(2);
  });

  it('preserves the section kind when truncating pairs', () => {
    const limited = limitSections([pairs('Duels', 5)], 2);
    expect(limited[0].kind).toBe('pairs');
    expect(limited[0].entries).toHaveLength(2);
  });

  it('returns everything for null, or a limit at or above the total', () => {
    const all = [decks('A', 3), decks('B', 2)];
    expect(limitSections(all, null)).toBe(all);
    expect(limitSections(all, 5)).toBe(all);
    expect(limitSections(all, 99)).toBe(all);
  });

  it('yields nothing at all for a zero or negative limit', () => {
    expect(limitSections([decks('A', 3)], 0)).toEqual([]);
    expect(limitSections([decks('A', 3)], -4)).toEqual([]);
  });

  it('shrinks the page count as the limit tightens', () => {
    const all = [decks('A', 9)];
    expect(paginate(all)).toHaveLength(3);
    expect(paginate(limitSections(all, 4))).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('counts decks and cards across both deck and pair sections', () => {
    const sections: ExportSection[] = [
      { kind: 'decks', heading: 'S', entries: [{ deck: filledDeck('A', 0, 8) }] },
      { kind: 'pairs', heading: 'V', entries: [{ blue: filledDeck('B', 8, 8), red: filledDeck('R', 16, 4) }] },
    ];
    const stats = summarize(sections);
    expect(stats.decks).toBe(3);
    expect(stats.cards).toBe(20);
    expect(stats.topCards.length).toBeGreaterThan(0);
  });

  it('reports the most-used cards first', () => {
    const a = createEmptyDeck('a');
    const b = createEmptyDeck('b');
    a.slots[0] = 'hog-rider';
    a.slots[1] = 'fireball';
    b.slots[0] = 'hog-rider';
    const stats = summarize([{ kind: 'decks', heading: 'S', entries: [{ deck: a }, { deck: b }] }]);
    expect(stats.topCards[0]).toBe('hog-rider');
  });

  it('has no elixir average when nothing is placed', () => {
    expect(summarize([]).avgElixir).toBe('–');
  });
});

describe('exportFileName', () => {
  it('stamps the scope and date', () => {
    expect(exportFileName('versus', new Date('2026-08-01T10:00:00Z'))).toBe(
      'royal-duels-versus-2026-08-01.pdf',
    );
  });
});
