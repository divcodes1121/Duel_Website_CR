import { describe, it, expect } from 'vitest';
import {
  createEmptyDuelDeckSet,
  getUsedCardKeys,
  isCardAvailable,
  assignCard,
  clearSlot,
  clearDeck,
  getElixirAverage,
  getCycleCost,
  getTotalCardsUsed,
  validateDuelDeckSet,
  getSlotRoleByPosition,
  getSlotVisualVariant,
  countChampionsInDeck,
  canPlaceCardInSlot,
  canAssignCardToSlot,
  canMoveCard,
  moveCard,
} from '../src/state/deckUtils';
import type { Card } from '../src/types/card';

function makeCard(key: string, elixir: number, overrides: Partial<Card> = {}): Card {
  return {
    key,
    name: key,
    scKey: key,
    elixir,
    type: 'Troop',
    rarity: 'Common',
    arena: 0,
    description: '',
    id: 0,
    isEvolved: false,
    evolvedSpellsScKey: '',
    canEvolve: false,
    canBeHero: false,
    isChampion: false,
    isWinCondition: false,
    ...overrides,
  };
}

const cardsByKey = new Map<string, Card>([
  ['knight', makeCard('knight', 3, { canEvolve: true, canBeHero: true })],
  ['archers', makeCard('archers', 3, { canEvolve: true })],
  ['fireball', makeCard('fireball', 4)],
  ['skeletons', makeCard('skeletons', 1)],
  ['ice-spirit', makeCard('ice-spirit', 1)],
  ['zap', makeCard('zap', 2)],
  ['giant', makeCard('giant', 5, { canBeHero: true })],
  ['minions', makeCard('minions', 3)],
  ['skeleton-king', makeCard('skeleton-king', 4, { isChampion: true, rarity: 'Champion' })],
  ['archer-queen', makeCard('archer-queen', 5, { isChampion: true, rarity: 'Champion' })],
]);

describe('createEmptyDuelDeckSet', () => {
  it('creates 5 decks of 8 empty slots each', () => {
    const set = createEmptyDuelDeckSet('Test');
    expect(set.decks).toHaveLength(5);
    set.decks.forEach((deck) => {
      expect(deck.slots).toHaveLength(8);
      expect(deck.slots.every((s) => s === null)).toBe(true);
    });
  });
});

describe('assignCard / isCardAvailable / getUsedCardKeys', () => {
  it('assigns a card into an empty slot', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'knight');
    expect(set.decks[0].slots[0]).toBe('knight');
  });

  it('prevents the same card from being used in more than one of the 4 decks', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'knight');
    expect(isCardAvailable(set, 1, 'knight')).toBe(false);

    const before = set;
    set = assignCard(set, 1, 0, 'knight'); // should no-op
    expect(set).toBe(before);
    expect(set.decks[1].slots[0]).toBeNull();
  });

  it('allows the same card in the same slot it already occupies (re-assign is a no-op change)', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'knight');
    expect(isCardAvailable(set, 0, 'archers')).toBe(true);
  });

  it('getUsedCardKeys excludes the given deck index', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'knight');
    set = assignCard(set, 1, 0, 'archers');
    expect(getUsedCardKeys(set, 0).has('knight')).toBe(false);
    expect(getUsedCardKeys(set, 0).has('archers')).toBe(true);
    expect(getUsedCardKeys(set).has('knight')).toBe(true);
  });
});

describe('clearSlot / clearDeck', () => {
  it('clears a single slot', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'knight');
    set = clearSlot(set, 0, 0);
    expect(set.decks[0].slots[0]).toBeNull();
    expect(isCardAvailable(set, 1, 'knight')).toBe(true);
  });

  it('clears all slots in a deck', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'knight');
    set = assignCard(set, 0, 1, 'archers');
    set = clearDeck(set, 0);
    expect(set.decks[0].slots.every((s) => s === null)).toBe(true);
  });
});

describe('getElixirAverage', () => {
  it('returns null for an empty deck', () => {
    const set = createEmptyDuelDeckSet('Test');
    expect(getElixirAverage(set.decks[0], cardsByKey)).toBeNull();
  });

  it('computes average to one decimal place', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'knight'); // 3
    set = assignCard(set, 0, 1, 'giant'); // 5
    set = assignCard(set, 0, 2, 'skeletons'); // 1
    expect(getElixirAverage(set.decks[0], cardsByKey)).toBe(3);
  });
});

describe('getCycleCost', () => {
  it('returns null until at least 4 cards are placed', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'knight');
    set = assignCard(set, 0, 1, 'archers');
    set = assignCard(set, 0, 2, 'skeletons');
    expect(getCycleCost(set.decks[0], cardsByKey)).toBeNull();
  });

  it('sums the 4 cheapest cards once 4+ are placed', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'giant'); // 5
    set = assignCard(set, 0, 1, 'knight'); // 3
    set = assignCard(set, 0, 2, 'skeletons'); // 1
    set = assignCard(set, 0, 3, 'ice-spirit'); // 1
    set = assignCard(set, 0, 4, 'zap'); // 2
    // 4 cheapest: 1 + 1 + 2 + 3 = 7 (giant's 5 excluded)
    expect(getCycleCost(set.decks[0], cardsByKey)).toBe(7);
  });
});

describe('getTotalCardsUsed', () => {
  it('counts unique cards used across all 4 decks', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'knight');
    set = assignCard(set, 1, 0, 'archers');
    set = assignCard(set, 2, 0, 'fireball');
    expect(getTotalCardsUsed(set)).toBe(3);
  });
});

describe('validateDuelDeckSet', () => {
  it('flags decks with fewer than 8 cards', () => {
    const set = createEmptyDuelDeckSet('Test');
    const result = validateDuelDeckSet(set);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(5);
  });

  it('passes for 5 full decks with no cross-deck duplicates', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = {
      ...set,
      decks: set.decks.map((deck, di) => ({
        ...deck,
        slots: Array.from({ length: 8 }, (_, si) => `card-${di}-${si}`),
      })) as typeof set.decks,
    };
    const result = validateDuelDeckSet(set);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('flags more than 1 Champion in a deck and a Champion outside the Hero/Wild slot', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 3, 'skeleton-king'); // slot 4 = normal, not Hero/Wild
    set = assignCard(set, 0, 1, 'archer-queen'); // slot 2 = Hero, OK
    const result = validateDuelDeckSet(set, cardsByKey);
    expect(result.errors.some((e) => e.includes('only 1 is allowed'))).toBe(true);
    expect(result.errors.some((e) => e.includes('must be in the 2nd (Hero) or 3rd (Wild) slot'))).toBe(
      true,
    );
  });
});

describe('getSlotRoleByPosition', () => {
  it('slot 1 is evolution, slot 2 is hero, slot 3 is wild, the rest are normal', () => {
    expect(getSlotRoleByPosition(0)).toBe('evolution');
    expect(getSlotRoleByPosition(1)).toBe('hero');
    expect(getSlotRoleByPosition(2)).toBe('wild');
    for (let i = 3; i < 8; i++) {
      expect(getSlotRoleByPosition(i)).toBe('normal');
    }
  });
});

describe('getSlotVisualVariant (automatic, by position)', () => {
  it('slot 1 shows Evolution art only if the card can evolve', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'archers'); // canEvolve: true
    expect(getSlotVisualVariant(set.decks[0], 0, cardsByKey)).toBe('evolution');

    set = clearSlot(set, 0, 0);
    set = assignCard(set, 0, 0, 'fireball'); // no special eligibility
    expect(getSlotVisualVariant(set.decks[0], 0, cardsByKey)).toBe('base');
  });

  it('slot 2 shows Hero art only if the card can be a hero or champion', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 1, 'giant'); // canBeHero: true
    expect(getSlotVisualVariant(set.decks[0], 1, cardsByKey)).toBe('hero');

    set = clearSlot(set, 0, 1);
    set = assignCard(set, 0, 1, 'archers'); // canEvolve only, not hero-eligible
    expect(getSlotVisualVariant(set.decks[0], 1, cardsByKey)).toBe('base');
  });

  it('slot 3 (wild) prefers Evolution over Hero when a card supports both', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 2, 'knight'); // canEvolve + canBeHero
    expect(getSlotVisualVariant(set.decks[0], 2, cardsByKey)).toBe('evolution');
  });

  it('slot 3 (wild) falls back to Hero when only hero-eligible', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 2, 'giant'); // canBeHero only
    expect(getSlotVisualVariant(set.decks[0], 2, cardsByKey)).toBe('hero');
  });

  it('slots 4-8 are always base art regardless of eligibility', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 3, 'knight'); // eligible for everything, but normal slot
    expect(getSlotVisualVariant(set.decks[0], 3, cardsByKey)).toBe('base');
  });
});

describe('canPlaceCardInSlot', () => {
  it('restricts champions to the Hero (2nd) and Wild (3rd) slots', () => {
    const champion = cardsByKey.get('skeleton-king')!;
    expect(canPlaceCardInSlot(champion, 0)).toBe(false);
    expect(canPlaceCardInSlot(champion, 1)).toBe(true);
    expect(canPlaceCardInSlot(champion, 2)).toBe(true);
    for (let i = 3; i < 8; i++) {
      expect(canPlaceCardInSlot(champion, i)).toBe(false);
    }
  });

  it('places non-champions anywhere', () => {
    const knight = cardsByKey.get('knight')!;
    for (let i = 0; i < 8; i++) {
      expect(canPlaceCardInSlot(knight, i)).toBe(true);
    }
  });
});

describe('deck-scoped uniqueness (Deck\'s Home)', () => {
  it('allows the same card in another deck when scope is "deck"', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'knight');
    expect(isCardAvailable(set, 1, 'knight', 'deck')).toBe(true);
    expect(isCardAvailable(set, 1, 'knight', 'collection')).toBe(false);
  });

  it('still blocks duplicates within the same deck under "deck" scope', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'knight');
    expect(isCardAvailable(set, 0, 'knight', 'deck')).toBe(false);
  });
});

describe('canAssignCardToSlot', () => {
  it('allows replacing the deck champion with another champion in the same slot', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 1, 'skeleton-king');
    const queen = cardsByKey.get('archer-queen')!;
    expect(canAssignCardToSlot(set, 0, 1, queen, cardsByKey)).toBe(true);
  });

  it('blocks a second champion in a different slot of the same deck', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 1, 'skeleton-king');
    const queen = cardsByKey.get('archer-queen')!;
    expect(canAssignCardToSlot(set, 0, 2, queen, cardsByKey)).toBe(false);
  });

  it('blocks cards already used elsewhere in the collection', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 0, 'knight');
    const knight = cardsByKey.get('knight')!;
    expect(canAssignCardToSlot(set, 1, 0, knight, cardsByKey)).toBe(false);
  });
});

describe('canMoveCard / moveCard', () => {
  it('moves a card into an empty slot', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 3, 'fireball');
    expect(canMoveCard(set, { deckIndex: 0, slotIndex: 3 }, { deckIndex: 0, slotIndex: 5 }, cardsByKey)).toBe(true);
    set = moveCard(set, { deckIndex: 0, slotIndex: 3 }, { deckIndex: 0, slotIndex: 5 }, cardsByKey);
    expect(set.decks[0].slots[3]).toBeNull();
    expect(set.decks[0].slots[5]).toBe('fireball');
  });

  it('swaps two occupied slots', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 3, 'fireball');
    set = assignCard(set, 0, 4, 'zap');
    set = moveCard(set, { deckIndex: 0, slotIndex: 3 }, { deckIndex: 0, slotIndex: 4 }, cardsByKey);
    expect(set.decks[0].slots[3]).toBe('zap');
    expect(set.decks[0].slots[4]).toBe('fireball');
  });

  it('moves across decks of the same collection', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 3, 'fireball');
    set = moveCard(set, { deckIndex: 0, slotIndex: 3 }, { deckIndex: 2, slotIndex: 6 }, cardsByKey);
    expect(set.decks[0].slots[3]).toBeNull();
    expect(set.decks[2].slots[6]).toBe('fireball');
  });

  it('rejects moving a champion into a normal slot', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 1, 'skeleton-king');
    expect(canMoveCard(set, { deckIndex: 0, slotIndex: 1 }, { deckIndex: 0, slotIndex: 4 }, cardsByKey)).toBe(false);
    const before = set;
    set = moveCard(set, { deckIndex: 0, slotIndex: 1 }, { deckIndex: 0, slotIndex: 4 }, cardsByKey);
    expect(set).toBe(before);
  });

  it('rejects a swap that would push a champion into an illegal slot', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 1, 'skeleton-king');
    set = assignCard(set, 0, 4, 'fireball');
    // Fireball (slot 5) -> hero slot is fine, but Skeleton King -> slot 5 is not.
    expect(canMoveCard(set, { deckIndex: 0, slotIndex: 4 }, { deckIndex: 0, slotIndex: 1 }, cardsByKey)).toBe(false);
  });

  it('allows swapping a champion between hero and wild slots', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 1, 'skeleton-king');
    expect(canMoveCard(set, { deckIndex: 0, slotIndex: 1 }, { deckIndex: 0, slotIndex: 2 }, cardsByKey)).toBe(true);
  });

  it('rejects a cross-deck move that gives a deck two champions', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 1, 'skeleton-king');
    set = assignCard(set, 1, 1, 'archer-queen');
    // Move Skeleton King into deck 2's wild slot -> deck 2 would hold 2 champions.
    expect(canMoveCard(set, { deckIndex: 0, slotIndex: 1 }, { deckIndex: 1, slotIndex: 2 }, cardsByKey)).toBe(false);
  });
});

describe('countChampionsInDeck', () => {
  it('counts champion cards placed in a deck', () => {
    let set = createEmptyDuelDeckSet('Test');
    set = assignCard(set, 0, 1, 'skeleton-king');
    set = assignCard(set, 0, 3, 'fireball');
    expect(countChampionsInDeck(set.decks[0], cardsByKey)).toBe(1);
  });
});
