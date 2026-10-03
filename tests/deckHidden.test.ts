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
  clearSlot,
  countActiveDecks,
  createEmptyDeck,
  createEmptyDuelDeckSet,
  getDuplicateKeys,
  getTotalCardsUsed,
  getUsedCardKeys,
  holdsAnyCard,
  isCardAvailable,
  moveCard,
  setDeckHidden,
  validateDuelDeckSet,
} from '../src/state/deckUtils';
import { useBuilderStore } from '../src/state/store';
import { buildSoloSections, buildVersusSections, sectionRows } from '../src/utils/deckExport';
import type { Deck, DuelDeckSet } from '../src/types/deck';

/**
 * THE EYE BUTTON. A hidden duel deck keeps its cards and holds none of them:
 * they are free for the rest of the collection. Everything below is that one
 * sentence, checked where it could go wrong — the rule, which of two copies is
 * drawn grey once both decks are in play, and the screens that count or print
 * decks.
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

/**
 * TWO DECKS IN PLAY, ONE CARD: THE NEWER COPY IS THE GREY ONE.
 *
 * Asked for in those words, after one build greyed the OLDER deck (the one
 * shown again) instead. `grey(set, i)` is what the slot draws black and white.
 */
const grey = (set: DuelDeckSet, i: number) => [...getDuplicateKeys(set, i)].sort();

describe('two decks holding the same card', () => {
  it('nothing is grey while the older deck is hidden: its card is free', () => {
    let set = setOf([deckOf('Old', ['hog-rider', 'zap']), deckOf('New', ['golem'])]);
    set = setDeckHidden(set, 0, true);
    set = assignCard(set, 1, 4, 'hog-rider');
    expect(grey(set, 1)).toEqual([]);
    expect(grey(set, 0)).toEqual([]); // a hidden deck is grey as a whole, not card by card
  });

  it('shown again, the NEW deck’s copy is grey and the old deck keeps its colour', () => {
    let set = setOf([deckOf('Old', ['hog-rider', 'zap']), deckOf('New', ['golem'])]);
    set = setDeckHidden(set, 0, true);
    set = assignCard(set, 1, 4, 'hog-rider');
    set = setDeckHidden(set, 0, false);
    expect(grey(set, 1)).toEqual(['hog-rider']);
    expect(grey(set, 0)).toEqual([]);
  });

  it('the newer one is grey even when it sits ABOVE the older one', () => {
    let set = setOf([deckOf('Upper', ['golem']), deckOf('Lower', ['the-log', 'zap'])]);
    set = setDeckHidden(set, 1, true);
    set = assignCard(set, 0, 4, 'the-log'); // the upper deck takes the lower one's card
    set = setDeckHidden(set, 1, false);
    expect(grey(set, 0)).toEqual(['the-log']);
    expect(grey(set, 1)).toEqual([]);
  });

  it('hiding and showing either deck never changes which copy is the newer', () => {
    let set = setOf([deckOf('Upper', ['golem']), deckOf('Lower', ['the-log'])]);
    set = setDeckHidden(set, 1, true);
    set = assignCard(set, 0, 4, 'the-log');
    set = setDeckHidden(set, 1, false);
    for (const i of [0, 1, 0, 1]) {
      set = setDeckHidden(set, i, true);
      expect(grey(set, 0)).toEqual([]);
      expect(grey(set, 1)).toEqual([]);
      set = setDeckHidden(set, i, false);
      expect(grey(set, 0)).toEqual(['the-log']);
      expect(grey(set, 1)).toEqual([]);
    }
  });

  it('removing either copy ends the clash', () => {
    let set = setOf([deckOf('Old', ['hog-rider']), deckOf('New', ['golem'])]);
    set = setDeckHidden(set, 0, true);
    set = assignCard(set, 1, 4, 'hog-rider');
    set = setDeckHidden(set, 0, false);
    expect(grey(clearSlot(set, 0, 0), 1)).toEqual([]);
    const cleared = clearSlot(set, 1, 4);
    expect(grey(cleared, 0)).toEqual([]);
    expect(cleared.decks[1].newerCopies).toBeUndefined(); // the mark left with the card
  });

  it('exactly one copy keeps its colour, however many decks share the card', () => {
    let set = setOf([deckOf('A', ['hog-rider']), deckOf('B', ['golem']), deckOf('C', ['miner'])]);
    set = setDeckHidden(set, 0, true);
    set = assignCard(set, 1, 4, 'hog-rider');
    set = setDeckHidden(set, 1, true);
    set = assignCard(set, 2, 4, 'hog-rider');
    set = setDeckHidden(setDeckHidden(set, 0, false), 1, false);
    expect([0, 1, 2].map((i) => grey(set, i).length)).toEqual([0, 1, 1]);
  });

  it('with no marks at all, the deck higher on the board keeps the colour', () => {
    // Decks edited by an older build, or marked by the one build that marked
    // the returning deck in a field no longer read.
    const legacy = { ...deckOf('Old', ['hog-rider']), importedDuplicates: ['hog-rider'] };
    const set = setOf([legacy, deckOf('New', ['hog-rider'])]);
    expect(grey(set, 0)).toEqual([]);
    expect(grey(set, 1)).toEqual(['hog-rider']);
  });

  it('a dragged card takes its mark with it', () => {
    const cards = new Map(['hog-rider', 'golem', 'zap'].map((k) => [k, { key: k, isChampion: false }])) as never;
    let set = setOf([deckOf('Old', ['hog-rider']), deckOf('New', ['golem']), deckOf('Third', ['zap'])]);
    set = setDeckHidden(set, 0, true);
    set = assignCard(set, 1, 4, 'hog-rider');
    set = moveCard(set, { deckIndex: 1, slotIndex: 4 }, { deckIndex: 2, slotIndex: 5 }, cards);
    expect(set.decks[1].newerCopies).toBeUndefined();
    expect(set.decks[2].newerCopies).toEqual(['hog-rider']);
    set = setDeckHidden(set, 0, false);
    expect(grey(set, 2)).toEqual(['hog-rider']);
    expect(grey(set, 0)).toEqual([]);
  });

  it('independent decks are never marked: Deck’s Home and Counter Palette share nothing', () => {
    const set = setOf([deckOf('A', ['hog-rider']), deckOf('B', ['golem'])]);
    expect(assignCard(set, 1, 4, 'hog-rider', 'deck').decks[1].newerCopies).toBeUndefined();
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

  it('a pasted deck holds the newer copy of any card another deck has, hidden or not', () => {
    S().assignCardAt('solo', 0, 3, 'hog-rider');
    S().assignCardAt('solo', 1, 3, 'fireball');
    S().setDeckHidden('solo', 0, true);
    const pasted = ['hog-rider', 'musketeer', 'ice-golem', 'ice-spirit', 'skeletons', 'cannon', 'fireball', 'the-log'];
    expect(S().importDeck('solo', 2, pasted)).toBeNull();
    expect([...(S().sets.solo.decks[2].newerCopies ?? [])].sort()).toEqual(['fireball', 'hog-rider']);
    expect(grey(S().sets.solo, 2)).toEqual(['fireball']); // Hog Rider's other holder is hidden
    S().setDeckHidden('solo', 0, false);
    expect(grey(S().sets.solo, 2)).toEqual(['fireball', 'hog-rider']);
    expect(grey(S().sets.solo, 0)).toEqual([]);
    expect(grey(S().sets.solo, 1)).toEqual([]);
  });

  it('the wand marks every card it takes from a hidden deck, and no other', () => {
    for (let round = 0; round < 12; round++) {
      useBuilderStore.setState(initial, true);
      S().fillDeck('solo', 0);
      S().setDeckHidden('solo', 0, true);
      S().fillDeck('solo', 1);
      const [away, built] = S().sets.solo.decks;
      const shared = built.slots.filter((k): k is string => k !== null && away.slots.includes(k)).sort();
      expect([...(built.newerCopies ?? [])].sort()).toEqual(shared);
    }
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

  it('a hidden deck is drawn, read-only — not folded away', () => {
    /* It folded to its header for one build, and the request that followed
       was "hide will not hide but just make it grey". */
    const src = readFileSync('src/components/DuelDeckBuilder/DeckPanel.tsx', 'utf8');
    expect(src).toMatch(/<DeckSlotGrid owner=\{owner\} deckIndex=\{deckIndex\} deck=\{deck\} readOnly=\{hidden\} \/>/);
    expect(src).not.toMatch(/\{!hidden && \(\s*<>\s*<DeckSlotGrid/);
    const css = readFileSync('src/components/DuelDeckBuilder/DeckPanel.module.css', 'utf8');
    expect(css).toMatch(/\.panel\[data-hidden\] \.slot \{\s*filter: grayscale\(1\)/);
  });

  it('black and white is a duel rule: independent decks are never drawn as duplicates', () => {
    const src = readFileSync('src/components/DuelDeckBuilder/DeckSlot.tsx', 'utf8');
    expect(src).toMatch(/\(owner === 'solo' \|\| owner === 'blue' \|\| owner === 'red'\) &&\s*getDuplicateKeys\(/);
  });
});
