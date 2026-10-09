import { CARDS } from '../../src/data/cards';
import type { Deck, DuelDeckSet, SavedDeckSet } from '../../src/types/deck';

/* Saved sets the SIZE AND SHAPE of real ones, for the storage and sync tests.
 *
 * `syncPolicy.test.ts` records why this matters: a fixture with short fake ids
 * understated a real set by ~325 characters and put a whole library under a
 * cap it was really over. So: 36-character ids, real card keys, the five-deck
 * collections the builder writes, crowns — and deterministic, so a size a test
 * asserts today is the size it asserts tomorrow.
 */

const KEYS = CARDS.map((c) => c.key);

/** A small deterministic generator; `Math.random` would make sizes drift. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function uuid(next: () => number): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(next() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

function deck(next: () => number, name: string, filled: boolean): Deck {
  if (!filled) return { id: uuid(next), name, slots: Array(8).fill(null) };
  const pool = [...KEYS];
  const slots: string[] = [];
  while (slots.length < 8) slots.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  return { id: uuid(next), name, slots, crowns: Math.floor(next() * 4) };
}

function side(next: () => number, name: string, games: number): DuelDeckSet {
  return {
    id: uuid(next),
    name,
    decks: [0, 1, 2, 3, 4].map((i) =>
      i < games ? deck(next, `G${i + 1}`, true) : deck(next, `Deck ${i + 1}`, false),
    ),
    createdAt: '2026-10-09T10:00:00.000Z',
    updatedAt: '2026-10-09T10:00:00.000Z',
  };
}

/** Saved Versus set number `n`: `games` filled decks a side (3 = a saved
 *  three-game duel, 5 = a full hand-built set). */
export function savedSet(n: number, games = 3): SavedDeckSet {
  const next = rng(n * 7919 + games);
  return {
    id: uuid(next),
    name: `Duel Deck ${n}`,
    mode: 'versus',
    blue: side(next, 'Blue Player', games),
    red: side(next, 'Red Player', games),
    savedAt: '2026-10-09T10:00:00.000Z',
  };
}

/** `count` saved sets, newest first — the order the store keeps them in. */
export function savedLibrary(count: number, games = 3): SavedDeckSet[] {
  return Array.from({ length: count }, (_, i) => savedSet(count - i, games));
}

/** Put one more set on the front, as a save does. */
export function withSaved(library: readonly SavedDeckSet[], games = 3): SavedDeckSet[] {
  return [savedSet(library.length + 1, games), ...library];
}
