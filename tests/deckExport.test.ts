import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DECKS_PER_PAGE,
  countDecks,
  sectionRows,
  lastSections,
  lastSetCount,
  limitSetCount,
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
  /* Keyed on the TIER now, not a hardcoded username. The old gate was
     `['royal20']` checked against the test store, which silently became
     "nobody" when real accounts landed and that store stopped being read. */
  it('allows paid tiers', () => {
    expect(canExportDecks('pro')).toBe(true);
    expect(canExportDecks('admin')).toBe(true);
  });

  it('allows the trial, because three days is meant to be the whole product', () => {
    expect(canExportDecks('trial')).toBe(true);
  });

  it('refuses free and signed-out visitors', () => {
    expect(canExportDecks('free')).toBe(false);
    expect(canExportDecks('anon')).toBe(false);
    expect(canExportDecks(null)).toBe(false);
    expect(canExportDecks(undefined)).toBe(false);
    expect(canExportDecks('')).toBe(false);
  });

  it('does not accept an old username as a tier', () => {
    expect(canExportDecks('royal20')).toBe(false);
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

  it('numbers the live set and each saved solo group in report order', () => {
    const solo = setOf('Solo', [filledDeck('A')]);
    const saved: SavedDeckSet[] = [
      { id: '1', name: 'Ladder', mode: 'solo', solo: setOf('Ladder', [filledDeck('L', 24)]), savedAt: '' },
      { id: '2', name: 'Duels', mode: 'versus', blue: setOf('b', []), red: setOf('r', []), savedAt: '' },
    ];
    const sections = buildSoloSections(solo, 1, saved);
    expect(sections.map((s) => s.heading)).toEqual(['Deck Set 1', 'Deck Set 2']);
  });

  it('takes saved groups oldest first — the bottom of the library list', () => {
    const solo = setOf('Solo', []);
    const group = (id: string, deck: string, offset: number): SavedDeckSet => ({
      id,
      name: id,
      mode: 'solo',
      solo: setOf(id, [filledDeck(deck, offset)]),
      savedAt: '',
    });
    // The library is newest first, so the last entry is the oldest set.
    const sections = buildSoloSections(solo, 0, [group('new', 'N', 0), group('mid', 'M', 8), group('old', 'O', 16)]);
    expect(sections.map((s) => s.entries[0].deck.name)).toEqual(['O', 'M', 'N']);
    expect(sections.map((s) => s.heading)).toEqual(['Deck Set 1', 'Deck Set 2', 'Deck Set 3']);
  });
});

describe('buildVersusSections', () => {
  it('titles every set "Duel Deck N" in report order, ignoring the saved name', () => {
    const blue = setOf('Blue', [filledDeck('B1')]);
    const red = setOf('Red', [filledDeck('R1', 8)]);
    const saved: SavedDeckSet[] = [
      { id: '1', name: 'Duel Deck 58', mode: 'versus', blue: setOf('b', [filledDeck('X', 16)]), red: setOf('r', [filledDeck('Y', 24)]), savedAt: '' },
    ];
    const sections = buildVersusSections(blue, red, 1, 1, saved);
    expect(sections.map((s) => s.heading)).toEqual(['Duel Deck 1', 'Duel Deck 2']);
  });

  it('walks saved versus groups oldest first, so "first N" takes the earliest sets', () => {
    const empty = setOf('Live', []);
    const group = (name: string, deck: string, offset: number): SavedDeckSet => ({
      id: name,
      name,
      mode: 'versus',
      blue: setOf(name, [filledDeck(deck, offset)]),
      red: setOf(name, [filledDeck(`${deck}r`, offset + 8)]),
      savedAt: '',
    });
    // Library order is newest first: "Duel Deck 3" was saved most recently.
    const sections = buildVersusSections(empty, empty, 0, 0, [
      group('Duel Deck 3', 'C', 0),
      group('Duel Deck 2', 'B', 16),
      group('Duel Deck 1', 'A', 32),
    ]);
    expect(sections.map((s) => s.heading)).toEqual(['Duel Deck 1', 'Duel Deck 2', 'Duel Deck 3']);
    const firstDeckOf = (s: ExportSection) => sectionRows(s)[0].deck.name;
    expect(sections.map(firstDeckOf)).toEqual(['A', 'B', 'C']);
    // Picking two sets yields the two oldest, not the two most recent.
    expect(limitSetCount(sections, 2).map(firstDeckOf)).toEqual(['A', 'B']);
  });

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

  it('fits three decks per page, so a three-deck set owns a sheet', () => {
    const pages = paginate([deckSection('Solo', 9)]);
    expect(DECKS_PER_PAGE).toBe(3);
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.deckEntries.length)).toEqual([3, 3, 3]);
    expect(pages.map((p) => p.startIndex)).toEqual([1, 4, 7]);
  });

  it('lays a duel set out as stacked deck rows, blue then red', () => {
    // A set of 3 duels prints as 6 rows, three to a sheet.
    const pages = paginate([pairSection('Blue vs Red', 3)]);
    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.deckEntries.length)).toEqual([3, 3]);
    expect(pages[0].deckEntries.map((e) => e.deck.name)).toEqual(['B0', 'R0', 'B1']);
    expect(pages[1].deckEntries.map((e) => e.deck.name)).toEqual(['R1', 'B2', 'R2']);
  });

  it('quotes the duel count in the banner even though rows are decks', () => {
    const [page] = paginate([pairSection('Blue vs Red', 3)]);
    expect(page.kind).toBe('pairs');
    expect(page.sectionTotal).toBe(3);
  });

  it('skips the missing side of a half-filled duel', () => {
    const section: ExportSection = {
      kind: 'pairs',
      heading: 'Blue vs Red',
      entries: [{ blue: filledDeck('B0', 0), red: null }, { blue: null, red: filledDeck('R1', 8) }],
    };
    const [page] = paginate([section]);
    expect(page.deckEntries.map((e) => e.deck.name)).toEqual(['B0', 'R1']);
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
    expect(pages.map((p) => p.deckEntries.length)).toEqual([3, 2]);
  });

  it('returns no pages for no sections', () => {
    expect(paginate([])).toEqual([]);
  });

});

describe('limitSetCount', () => {
  const pairSet = (heading: string, n: number): ExportSection => ({
    kind: 'pairs',
    heading,
    entries: Array.from({ length: n }, (_, i) => ({ blue: filledDeck(`B${i}`, i), red: filledDeck(`R${i}`, i + 40) })),
  });

  it('keeps whole duel sets — three duels in a set count as one', () => {
    const all = [pairSet('Set A', 3), pairSet('Set B', 3), pairSet('Set C', 3)];
    const limited = limitSetCount(all, 2);
    expect(limited.map((s) => s.heading)).toEqual(['Set A', 'Set B']);
    // Two sets of three duels print as twelve deck rows, none of them cut short.
    expect(limited.every((s) => s.entries.length === 3)).toBe(true);
    expect(countDecks(limited)).toBe(12);
  });

  it('returns everything for null or an over-large count, nothing for zero', () => {
    const all = [pairSet('A', 2), pairSet('B', 2)];
    expect(limitSetCount(all, null)).toBe(all);
    expect(limitSetCount(all, 9)).toHaveLength(2);
    expect(limitSetCount(all, 0)).toEqual([]);
  });
});

describe('lastSetCount — the other end of the report, newest first', () => {
  /* Asked for on 2026-10-09 with 259 sets in the dialog and only "First":
     "add an option beside First, 'Last', which will give descending order,
     and naming and numbers will be correct". */
  const empty = setOf('Live', []);
  const group = (name: string, deck: string, offset: number): SavedDeckSet => ({
    id: name,
    name,
    mode: 'versus',
    blue: setOf(name, [filledDeck(deck, offset)]),
    red: setOf(name, [filledDeck(`${deck}r`, offset + 8)]),
    savedAt: '',
  });
  // The library, newest first — as the store keeps it.
  const library = [
    group('Duel Deck 5', 'E', 0),
    group('Duel Deck 4', 'D', 16),
    group('Duel Deck 3', 'C', 32),
    group('Duel Deck 2', 'B', 48),
    group('Duel Deck 1', 'A', 64),
  ];
  const firstDeckOf = (s: ExportSection) => sectionRows(s)[0].deck.name;

  it('takes the most recent sets, in descending order', () => {
    const report = buildVersusSections(empty, empty, 0, 0, library);
    const last = lastSetCount(report, 3);
    expect(last.map(firstDeckOf)).toEqual(['E', 'D', 'C']);
  });

  it('keeps the number each set has in the whole report — it does not start again at 1', () => {
    const report = buildVersusSections(empty, empty, 0, 0, library);
    expect(lastSetCount(report, 3).map((s) => s.heading)).toEqual([
      'Duel Deck 5',
      'Duel Deck 4',
      'Duel Deck 3',
    ]);
    // The same set has the same number from either end.
    const byName = (list: ExportSection[]) => Object.fromEntries(list.map((s) => [firstDeckOf(s), s.heading]));
    expect(byName(lastSetCount(report, 5))).toEqual(byName(limitSetCount(report, 5)));
  });

  it('numbers them as the report does when the board on screen is set 1', () => {
    /* The live board is always the report's first set, so the saved groups sit
       one number on from where they would without it. "Last" must agree with
       "First" and with "All" about that, not invent a third numbering. */
    const blue = setOf('Blue', [filledDeck('LIVE')]);
    const red = setOf('Red', [filledDeck('LIVEr', 8)]);
    const report = buildVersusSections(blue, red, 1, 1, library);
    expect(report).toHaveLength(6);
    const last = lastSetCount(report, 2);
    expect(last.map((s) => s.heading)).toEqual(['Duel Deck 6', 'Duel Deck 5']);
    expect(last.map(firstDeckOf)).toEqual(['E', 'D']);
    // The board is the FIRST set: it is in "Last" only when everything is.
    expect(lastSetCount(report, 5).map(firstDeckOf)).not.toContain('LIVE');
    expect(lastSetCount(report, 6).map(firstDeckOf)).toEqual(['E', 'D', 'C', 'B', 'A', 'LIVE']);
  });

  it('with every set asked for, it is the whole report backwards', () => {
    const report = buildVersusSections(empty, empty, 0, 0, library);
    const all = lastSetCount(report, 99);
    expect(all.map((s) => s.heading)).toEqual([...report].reverse().map((s) => s.heading));
    expect(lastSetCount(report, null)).toEqual(all);
  });

  it('none is none — not the whole report', () => {
    // `slice(-0)` is everything.
    const report = buildVersusSections(empty, empty, 0, 0, library);
    expect(lastSetCount(report, 0)).toEqual([]);
    expect(lastSetCount(report, -3)).toEqual([]);
    expect(lastSetCount([], 4)).toEqual([]);
  });

  it('keeps a set whole and its own decks in their own order', () => {
    const three = (name: string, offset: number): SavedDeckSet => ({
      id: name,
      name,
      mode: 'versus',
      blue: setOf(name, [filledDeck('G1', offset), filledDeck('G2', offset + 8), filledDeck('G3', offset + 16)]),
      red: setOf(name, [filledDeck('G1r', offset + 24), filledDeck('G2r', offset + 32), filledDeck('G3r', offset + 40)]),
      savedAt: '',
    });
    const report = buildVersusSections(empty, empty, 0, 0, [three('newest', 0), three('oldest', 60)]);
    const [newest] = lastSetCount(report, 1);
    expect(newest.entries).toHaveLength(3);
    expect(sectionRows(newest).map((r) => r.deck.name)).toEqual(['G1', 'G1r', 'G2', 'G2r', 'G3', 'G3r']);
  });

  it('leaves the report it was cut from alone', () => {
    const report = buildVersusSections(empty, empty, 0, 0, library);
    const before = report.map((s) => s.heading);
    lastSetCount(report, 3);
    expect(report.map((s) => s.heading)).toEqual(before);
  });

  it('works the same for Solo sets', () => {
    const solo = (name: string, deck: string, offset: number): SavedDeckSet => ({
      id: name,
      name,
      mode: 'solo',
      solo: setOf(name, [filledDeck(deck, offset)]),
      savedAt: '',
    });
    const report = buildSoloSections(setOf('Live', []), 0, [solo('c', 'C', 0), solo('b', 'B', 16), solo('a', 'A', 32)]);
    const last = lastSetCount(report, 2);
    expect(last.map((s) => s.heading)).toEqual(['Deck Set 3', 'Deck Set 2']);
    expect(last.map(firstDeckOf)).toEqual(['C', 'B']);
  });

  it('pages in the order it was asked for', () => {
    const report = buildVersusSections(empty, empty, 0, 0, library);
    expect(paginate(lastSetCount(report, 2)).map((p) => p.heading)).toEqual(['Duel Deck 5', 'Duel Deck 4']);
  });
});

describe('lastSections — the same, counted in decks (Deck’s Home)', () => {
  const home = (n: number) =>
    buildHomeSections(Array.from({ length: n }, (_, i) => filledDeck(`Deck ${i + 1}`, i * 3)));
  const names = (list: ExportSection[]) => list.flatMap((s) => sectionRows(s).map((r) => r.deck.name));

  it('takes the decks added last, newest first', () => {
    // A new deck goes on the END of the Deck's Home list.
    expect(names(lastSections(home(6), 3))).toEqual(['Deck 6', 'Deck 5', 'Deck 4']);
  });

  it('with every deck asked for, it is the whole list backwards', () => {
    expect(names(lastSections(home(4), 99))).toEqual(['Deck 4', 'Deck 3', 'Deck 2', 'Deck 1']);
    expect(names(lastSections(home(4), null))).toEqual(['Deck 4', 'Deck 3', 'Deck 2', 'Deck 1']);
  });

  it('none is none', () => {
    expect(lastSections(home(4), 0)).toEqual([]);
    expect(lastSections(home(4), -1)).toEqual([]);
  });

  it('keeps the section’s heading and kind', () => {
    const [section] = lastSections(home(4), 2);
    expect(section.kind).toBe('decks');
    expect(section.heading).toBe('My Decks');
  });

  it('runs back through more than one section, cutting the one the count ends in', () => {
    const many: ExportSection[] = [
      { kind: 'decks', heading: 'A', entries: [{ deck: filledDeck('a1') }, { deck: filledDeck('a2', 8) }] },
      { kind: 'decks', heading: 'B', entries: [{ deck: filledDeck('b1', 16) }, { deck: filledDeck('b2', 24) }] },
    ];
    const last = lastSections(many, 3);
    expect(last.map((s) => s.heading)).toEqual(['B', 'A']);
    expect(names(last)).toEqual(['b2', 'b1', 'a2']);
    expect(countEntries(last)).toBe(3);
  });

  it('leaves the list it was cut from alone', () => {
    const all = home(5);
    lastSections(all, 2);
    expect(names(all)).toEqual(['Deck 1', 'Deck 2', 'Deck 3', 'Deck 4', 'Deck 5']);
  });
});

describe('the export dialog’s count picker', () => {
  /* Read off the source — this suite runs in node with no DOM. */
  const dialog = readFileSync(
    join(process.cwd(), 'src', 'components', 'Export', 'ExportDialog.tsx'),
    'utf8',
  ).replace(/\r\n/g, '\n');

  it('offers All, First and Last, in that order', () => {
    const at = (needle: string) => dialog.indexOf(needle);
    expect(at("onClick={() => setPick('all')}")).toBeGreaterThan(0);
    expect(at("onClick={() => setPick('first')}")).toBeGreaterThan(at("onClick={() => setPick('all')}"));
    expect(at("onClick={() => setPick('last')}")).toBeGreaterThan(at("onClick={() => setPick('first')}"));
  });

  it('Last takes from the end, in sets for Royal Duels and in decks for Deck’s Home', () => {
    expect(dialog).toContain('bySet ? lastSetCount(allSections, limit) : lastSections(allSections, limit)');
    expect(dialog).toContain('bySet ? limitSetCount(allSections, limit) : limitSections(allSections, limit)');
  });

  it('the number box is live for First and for Last, and off for All', () => {
    expect(dialog).toContain("disabled={busy || pick === 'all'}");
  });

  it('what is listed in the dialog is what is downloaded', () => {
    // One `sections` value feeds the preview list and the PDF request.
    expect(dialog).toContain('{sections.map((section, i) => (');
    const from = dialog.indexOf('const request: ExportRequest = {');
    const to = dialog.indexOf('fileName: exportFileName(scope)');
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    expect(dialog.slice(from, to)).toContain('\n      sections,\n');
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
  const pairSection2 = (heading: string, n: number): ExportSection => ({
    kind: 'pairs',
    heading,
    entries: Array.from({ length: n }, (_, i) => ({ blue: filledDeck(`B${i}`, i), red: filledDeck(`R${i}`, i + 40) })),
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

  it('counts printed decks separately from rows — a duel is two decks', () => {
    const both = [decks('A', 3), pairSection2('Duels', 2)];
    expect(countEntries(both)).toBe(5);
    expect(countDecks(both)).toBe(7);
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
    expect(paginate(limitSections(all, 3))).toHaveLength(1);
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
