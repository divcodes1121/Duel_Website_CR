import { CARDS_BY_KEY } from '../data/cards';
import { getElixirAverage } from '../state/deckUtils';
import type { Deck, DuelDeckSet, SavedDeckSet } from '../types/deck';

/* ------------------------------------------------------------------ access */

/**
 * Deck-report export is an ambassador tool, not a general feature: only these
 * accounts see the button. Kept as a list so widening the roll-out is a
 * one-line change.
 */
export const PDF_EXPORT_USERS = ['royal20'];

export function canExportDecks(user: string | null | undefined): boolean {
  return !!user && PDF_EXPORT_USERS.includes(user.trim().toLowerCase());
}

/* ------------------------------------------------------------------- model */

/** One deck as it appears in the report. */
export interface DeckEntry {
  deck: Deck;
  /** Optional origin note, e.g. the saved group a deck came from. */
  note?: string;
}

/**
 * One Versus row: the same deck slot for both players, printed facing each
 * other. Either side may be missing when the players revealed a different
 * number of deck slots.
 */
export interface PairEntry {
  blue: Deck | null;
  red: Deck | null;
  note?: string;
}

export interface DeckSection {
  kind: 'decks';
  heading: string;
  entries: DeckEntry[];
}

export interface PairSection {
  kind: 'pairs';
  heading: string;
  entries: PairEntry[];
}

export type ExportSection = DeckSection | PairSection;

export interface ExportRequest {
  /** Big cover word, e.g. "ROYAL DUELS". */
  title: string;
  /** Cover strapline, e.g. "SOLO DECK REPORT". */
  subtitle: string;
  /** Ambassador handle stamped on the cover and every footer. */
  handle: string;
  sections: ExportSection[];
  fileName: string;
}

/** A deck only makes the report once it holds at least one card. */
export function hasCards(deck: Deck | null | undefined): boolean {
  return !!deck && deck.slots.some((k) => k !== null);
}

/* -------------------------------------------------------------- pagination */

/** Single-deck rows are full width, so four fit a landscape page. */
export const DECKS_PER_PAGE = 4;
/**
 * Versus rows print blue-vs-red facing each other and are much taller —
 * three pairs per page, as the duel report layout expects.
 */
export const PAIRS_PER_PAGE = 3;

export interface ContentPage {
  kind: 'decks' | 'pairs';
  heading: string;
  /** 1-based page number within this section, and the section's page count. */
  pageInSection: number;
  sectionPages: number;
  /** How many entries the whole section holds — the banner quotes this, not the page's share. */
  sectionTotal: number;
  /** 1-based index of this page's first entry within its section. */
  startIndex: number;
  deckEntries: DeckEntry[];
  pairEntries: PairEntry[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Lay sections out across pages. Sections never share a page, so each one
 * starts on a fresh sheet with its own "page i of j" counter — that is what
 * makes the printed report skimmable.
 */
export function paginate(sections: ExportSection[]): ContentPage[] {
  const pages: ContentPage[] = [];
  for (const section of sections) {
    const perPage = section.kind === 'decks' ? DECKS_PER_PAGE : PAIRS_PER_PAGE;
    const groups = chunk(section.entries as unknown[], perPage);
    groups.forEach((group, i) => {
      pages.push({
        kind: section.kind,
        heading: section.heading,
        pageInSection: i + 1,
        sectionPages: groups.length,
        sectionTotal: section.entries.length,
        startIndex: i * perPage + 1,
        deckEntries: section.kind === 'decks' ? (group as DeckEntry[]) : [],
        pairEntries: section.kind === 'pairs' ? (group as PairEntry[]) : [],
      });
    });
  }
  return pages;
}

/** Total rows across every section — decks in Solo/Home, duel pairs in Versus. */
export function countEntries(sections: ExportSection[]): number {
  return sections.reduce((n, s) => n + s.entries.length, 0);
}

/**
 * Keep only the first `limit` rows overall, walking sections in order: a
 * section is truncated when the budget runs out mid-way and dropped once it
 * is exhausted. `null` (or a limit at/above the total) exports everything.
 */
export function limitSections(sections: ExportSection[], limit: number | null): ExportSection[] {
  if (limit === null) return sections;
  let left = Math.max(0, Math.floor(limit));
  if (left >= countEntries(sections)) return sections;

  const out: ExportSection[] = [];
  for (const section of sections) {
    if (left <= 0) break;
    const take = Math.min(left, section.entries.length);
    out.push(
      section.kind === 'decks'
        ? { kind: 'decks', heading: section.heading, entries: section.entries.slice(0, take) }
        : { kind: 'pairs', heading: section.heading, entries: section.entries.slice(0, take) },
    );
    left -= take;
  }
  return out;
}

/** Cover is page 1, so content pages start at 2. */
export interface ContentsRow {
  heading: string;
  page: number;
  count: number;
}

/**
 * Where each section starts in the finished PDF. Derived from the section
 * sizes rather than by matching page headings, so two saved groups sharing a
 * name still get their own row.
 */
export function buildContents(sections: ExportSection[]): ContentsRow[] {
  const rows: ContentsRow[] = [];
  let page = 2; // page 1 is the cover
  for (const section of sections) {
    if (section.entries.length === 0) continue;
    const perPage = section.kind === 'decks' ? DECKS_PER_PAGE : PAIRS_PER_PAGE;
    rows.push({ heading: section.heading, page, count: section.entries.length });
    page += Math.ceil(section.entries.length / perPage);
  }
  return rows;
}

/* ---------------------------------------------------------------- builders */

/** Drops empty decks and stamps a fallback name on anything left unnamed. */
function toDeckEntries(decks: Deck[], note?: string): DeckEntry[] {
  return decks.filter(hasCards).map((deck) => ({ deck, note }));
}

/**
 * Pair blue's decks against red's slot for slot. Rows where neither player put
 * anything in that slot are dropped; a row with only one side still prints so
 * the mismatch is visible in the report.
 */
function toPairEntries(blue: Deck[], red: Deck[], note?: string): PairEntry[] {
  const rows: PairEntry[] = [];
  const count = Math.max(blue.length, red.length);
  for (let i = 0; i < count; i++) {
    const b = hasCards(blue[i]) ? blue[i] : null;
    const r = hasCards(red[i]) ? red[i] : null;
    if (!b && !r) continue;
    rows.push({ blue: b, red: r, note });
  }
  return rows;
}

function nonEmpty(sections: ExportSection[]): ExportSection[] {
  return sections.filter((s) => s.entries.length > 0);
}

/** Royal Duels, Solo tab: the revealed solo decks plus any saved solo groups. */
export function buildSoloSections(
  solo: DuelDeckSet,
  visibleCount: number,
  savedGroups: SavedDeckSet[],
): ExportSection[] {
  const sections: ExportSection[] = [
    { kind: 'decks', heading: 'Solo Duel Decks', entries: toDeckEntries(solo.decks.slice(0, visibleCount)) },
  ];
  for (const group of savedGroups) {
    if (group.mode !== 'solo' || !group.solo) continue;
    sections.push({
      kind: 'decks',
      heading: group.name,
      entries: toDeckEntries(group.solo.decks, 'Saved group'),
    });
  }
  return nonEmpty(sections);
}

/** Royal Duels, Versus tab: blue-vs-red pairs, live set first then saved groups. */
export function buildVersusSections(
  blue: DuelDeckSet,
  red: DuelDeckSet,
  blueCount: number,
  redCount: number,
  savedGroups: SavedDeckSet[],
): ExportSection[] {
  const sections: ExportSection[] = [
    {
      kind: 'pairs',
      heading: 'Blue vs Red',
      entries: toPairEntries(blue.decks.slice(0, blueCount), red.decks.slice(0, redCount)),
    },
  ];
  for (const group of savedGroups) {
    if (group.mode !== 'versus' || !group.blue || !group.red) continue;
    sections.push({
      kind: 'pairs',
      heading: group.name,
      entries: toPairEntries(group.blue.decks, group.red.decks, 'Saved group'),
    });
  }
  return nonEmpty(sections);
}

/** Deck's Home: one flat section of every saved single deck. */
export function buildHomeSections(decks: Deck[]): ExportSection[] {
  return nonEmpty([{ kind: 'decks', heading: 'My Decks', entries: toDeckEntries(decks) }]);
}

/* ------------------------------------------------------------------- stats */

export interface ExportStats {
  decks: number;
  cards: number;
  avgElixir: string;
  /** Card keys of the three most-used cards, for the cover artwork. */
  topCards: string[];
}

function everyDeck(sections: ExportSection[]): Deck[] {
  const decks: Deck[] = [];
  for (const section of sections) {
    if (section.kind === 'decks') {
      decks.push(...section.entries.map((e) => e.deck));
    } else {
      for (const pair of section.entries) {
        if (pair.blue) decks.push(pair.blue);
        if (pair.red) decks.push(pair.red);
      }
    }
  }
  return decks;
}

export function summarize(sections: ExportSection[]): ExportStats {
  const decks = everyDeck(sections);
  const uses = new Map<string, number>();
  let cards = 0;
  let elixirTotal = 0;
  let elixirCount = 0;

  for (const deck of decks) {
    for (const key of deck.slots) {
      if (!key) continue;
      cards++;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
    const avg = getElixirAverage(deck, CARDS_BY_KEY);
    if (avg !== null) {
      elixirTotal += avg;
      elixirCount++;
    }
  }

  const topCards = [...uses.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([key]) => key);

  return {
    decks: decks.length,
    cards,
    avgElixir: elixirCount > 0 ? (elixirTotal / elixirCount).toFixed(1) : '–',
    topCards,
  };
}

/** `royal-duels-versus-2026-08-01.pdf` */
export function exportFileName(scope: string, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  return `royal-duels-${scope}-${stamp}.pdf`;
}
