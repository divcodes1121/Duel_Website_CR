import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Same stand-ins as deckUndo.test.ts: the store imports the account store and
   the sync client, and neither loads in plain node. The store runs for real. */
vi.mock('../src/state/accountStore', () => ({
  useAccountStore: {
    getState: () => ({ userId: null, ready: true }),
    subscribe: () => () => {},
  },
}));
vi.mock('../src/state/syncClient', () => ({
  pushRemoteDecks: async () => true,
  readRemoteDecks: async () => ({ status: 'missing' }),
}));

import {
  assignCard,
  countActiveDecks,
  createEmptyDeck,
  createEmptyDuelDeckSet,
  getTotalCardsUsed,
  getUsedCardKeys,
  holdsAnyCard,
  isCardAvailable,
  setDeckHidden,
  validateDuelDeckSet,
} from '../src/state/deckUtils';
import { useBuilderStore } from '../src/state/store';
import { buildSoloSections, buildVersusSections, sectionRows } from '../src/utils/deckExport';
import type { Deck, DuelDeckSet } from '../src/types/deck';

/**
 * THE EYE BUTTON. A hidden duel deck keeps its cards and holds none of them:
 * they are free for the rest of the collection. Everything below is that one
 * sentence, checked where it could go wrong — the rule, what coming back does,
 * and the screens that count or print decks.
 */

const deckOf = (name: string, keys: string[]): Deck => ({
  ...createEmptyDeck(name),
  slots: [...keys, ...Array(8 - keys.length).fill(null)],
});
const setOf = (decks: Deck[]): DuelDeckSet => ({ ...createEmptyDuelDeckSet('t'), decks });

describe('a hidden deck holds none of its cards', () => {
  it('frees them for every other deck, and takes them out of the counts', () => {
    let set = createEmptyDuelDeckSet('t');
    set = assignCard(set, 0, 3, 'hog-rider');
    set = assignCard(set, 1, 3, 'golem');
    expect(isCardAvailable(set, 3, 'hog-rider')).toBe(false);

    set = setDeckHidden(set, 0, true);
    expect(set.decks[0].hidden).toBe(true);
    expect(set.decks[0].slots[3]).toBe('hog-rider'); // kept, not cleared
    expect(isCardAvailable(set, 3, 'hog-rider')).toBe(true);
    expect(getUsedCardKeys(set).has('hog-rider')).toBe(false);
    expect(getTotalCardsUsed(set)).toBe(1);

    // And the freed card really can be placed below.
    set = assignCard(set, 3, 3, 'hog-rider');
    expect(set.decks[3].slots[3]).toBe('hog-rider');
  });

  it('still holds its cards for the question "is there anything on the board"', () => {
    const set = setDeckHidden(assignCard(createEmptyDuelDeckSet('t'), 0, 3, 'hog-rider'), 0, true);
    expect(getTotalCardsUsed(set)).toBe(0);
    expect(holdsAnyCard(set)).toBe(true);
    expect(holdsAnyCard(createEmptyDuelDeckSet('t'))).toBe(false);
  });

  it('counts decks in play among the revealed ones only', () => {
    const set = setDeckHidden(createEmptyDuelDeckSet('t'), 1, true);
    expect(countActiveDecks(set, 3)).toBe(2);
    expect(countActiveDecks(set, 5)).toBe(4);
    expect(countActiveDecks(setDeckHidden(set, 4, true), 3)).toBe(2); // deck 5 is not revealed
  });

  it('is not a duplicate in validation', () => {
    const set = setOf([deckOf('A', ['hog-rider']), deckOf('B', ['hog-rider'])]);
    const dup = (s: DuelDeckSet) => validateDuelDeckSet(s).errors.some((e) => e.includes('appears in both'));
    expect(dup(set)).toBe(true);
    expect(dup(setDeckHidden(set, 0, true))).toBe(false);
  });

  it('changes nothing when the deck is already in that state, or is not there', () => {
    const set = createEmptyDuelDeckSet('t');
    expect(setDeckHidden(set, 0, false)).toBe(set);
    expect(setDeckHidden(set, 9, true)).toBe(set);
    const hidden = setDeckHidden(set, 0, true);
    expect(setDeckHidden(hidden, 0, true)).toBe(hidden);
  });

  it('leaves no flag behind when shown again, and touches no other deck', () => {
    const set = createEmptyDuelDeckSet('t');
    const back = setDeckHidden(setDeckHidden(set, 0, true), 0, false);
    expect('hidden' in back.decks[0]).toBe(false);
    expect(back.decks[1]).toBe(set.decks[1]); // same reference: undo snapshots stay cheap
  });
});

describe('a deck that comes back to cards another deck took', () => {
  it('carries the marks itself; the deck that took the card is never marked', () => {
    let set = setOf([deckOf('A', ['hog-rider', 'zap']), deckOf('B', ['golem'])]);
    set = setDeckHidden(set, 0, true);
    set = assignCard(set, 1, 4, 'hog-rider'); // B takes A's card while A is away
    set = setDeckHidden(set, 0, false);
    expect(set.decks[0].importedDuplicates).toEqual(['hog-rider']); // zap is still only A's
    expect(set.decks[1].importedDuplicates).toBeUndefined();
  });

  it('swapping the two back and forth never leaves both copies marked', () => {
    let set = setOf([deckOf('A', ['hog-rider']), deckOf('B', ['golem'])]);
    set = setDeckHidden(set, 0, true);
    set = assignCard(set, 1, 4, 'hog-rider');
    set = setDeckHidden(set, 0, false); // A back: A marked
    set = setDeckHidden(set, 1, true); //  hide B instead: the clash is over
    expect(set.decks[0].importedDuplicates).toBeUndefined();
    set = setDeckHidden(set, 1, false); // B back: B marked, A not
    expect(set.decks[1].importedDuplicates).toEqual(['hog-rider']);
    expect(set.decks[0].importedDuplicates).toBeUndefined();
  });

  it('keeps a paste mark that still describes a clash', () => {
    const pasted = { ...deckOf('B', ['hog-rider', 'golem']), importedDuplicates: ['hog-rider'] };
    const set = setDeckHidden(setOf([deckOf('A', ['hog-rider']), pasted, deckOf('C', ['zap'])]), 2, true);
    expect(set.decks[1].importedDuplicates).toEqual(['hog-rider']);
  });
});

const initial = useBuilderStore.getState();
const S = () => useBuilderStore.getState();

describe('the eye in the store', () => {
  beforeEach(() => {
    useBuilderStore.setState(initial, true);
  });

  it('hides a deck, lets a deck below reuse its card, and undoes both by name', () => {
    S().assignCardAt('solo', 0, 3, 'hog-rider');
    S().assignCardAt('solo', 2, 3, 'hog-rider'); // refused: deck 1 holds it
    expect(S().sets.solo.decks[2].slots[3]).toBeNull();

    S().setDeckHidden('solo', 0, true);
    S().addDeckSlot('solo');
    S().assignCardAt('solo', 3, 3, 'hog-rider');
    expect(S().sets.solo.decks[3].slots[3]).toBe('hog-rider');
    expect(S().sets.solo.decks[0].slots[3]).toBe('hog-rider');

    expect(S().undo('duels')).toBe('Add Hog Rider');
    expect(S().undo('duels')).toBe('Add a deck slot');
    expect(S().undo('duels')).toBe('Hide Deck 1');
    expect(S().sets.solo.decks[0].hidden).toBeUndefined();
    expect(S().redo('duels')).toBe('Hide Deck 1');
    expect(S().sets.solo.decks[0].hidden).toBe(true);
  });

  it('records nothing for a press that changed nothing', () => {
    S().setDeckHidden('solo', 0, false);
    expect(S().history.duels.past).toHaveLength(0);
  });

  it('drops a selection inside the deck it hides, and leaves any other alone', () => {
    S().assignCardAt('solo', 0, 3, 'hog-rider');
    S().selectSlot('solo', 0, 4);
    S().setDeckHidden('solo', 0, true);
    expect(S().selectedSlot).toBeNull();

    S().selectSlot('solo', 1, 2);
    S().setDeckHidden('solo', 0, false);
    expect(S().selectedSlot).toEqual({ owner: 'solo', deckIndex: 1, slotIndex: 2 });
  });

  it('keeps each Versus player’s hidden decks to themselves', () => {
    S().assignCardAt('blue', 0, 3, 'hog-rider');
    S().setDeckHidden('blue', 0, true);
    expect(S().sets.blue.decks[0].hidden).toBe(true);
    expect(S().sets.red.decks[0].hidden).toBeUndefined();
  });

  it('a removed deck slot comes back open, not folded', () => {
    S().addDeckSlot('solo');
    S().assignCardAt('solo', 3, 3, 'hog-rider');
    S().setDeckHidden('solo', 3, true);
    S().removeDeckSlot('solo');
    S().addDeckSlot('solo');
    const deck = S().sets.solo.decks[3];
    expect(deck.hidden).toBeUndefined();
    expect(deck.slots.every((k) => k === null)).toBe(true);
  });

  it('travels with a saved group and comes back hidden on Load', () => {
    S().assignCardAt('solo', 0, 3, 'hog-rider');
    S().setDeckHidden('solo', 0, true);
    S().saveCurrent('With one away');
    S().resetAll();
    S().loadSaved(S().library[0].id);
    expect(S().sets.solo.decks[0].hidden).toBe(true);
    expect(S().sets.solo.decks[0].slots[3]).toBe('hog-rider');
  });
});

describe('the PDF report leaves a hidden deck out', () => {
  const full = (name: string, first: string) =>
    deckOf(name, [first, 'a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k, i) => (i === 0 ? k : `${first}-${k}`)));

  it('solo', () => {
    const solo = setDeckHidden(setOf([full('A', 'hog-rider'), full('B', 'golem'), full('C', 'miner')]), 1, true);
    const rows = buildSoloSections(solo, 3, []).flatMap(sectionRows);
    expect(rows.map((r) => r.deck.name)).toEqual(['A', 'C']);
  });

  it('versus: the other player’s deck in that slot still prints', () => {
    const blue = setDeckHidden(setOf([full('B1', 'hog-rider'), full('B2', 'golem')]), 0, true);
    const red = setOf([full('R1', 'miner'), full('R2', 'x-bow')]);
    const rows = buildVersusSections(blue, red, 2, 2, []).flatMap(sectionRows);
    expect(rows.map((r) => r.deck.name)).toEqual(['R1', 'B2', 'R2']);
  });
});

describe('where the eye is offered', () => {
  it('only on a duel collection, never on Deck’s Home or Counter Palette', () => {
    /* Their decks are independent (`scopeFor` answers 'deck'), so hiding one
       would free nothing. The panel is shared by all three tools, so this is
       the line that keeps the button out of the other two. */
    const src = readFileSync('src/components/DuelDeckBuilder/DeckPanel.tsx', 'utf8');
    expect(src).toMatch(/duelOwner = owner === 'solo' \|\| owner === 'blue' \|\| owner === 'red' \? owner : null/);
    expect(src).toMatch(/\{duelOwner && \(/);
  });
});
