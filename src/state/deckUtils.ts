import type { Card } from '../types/card';
import { DECK_SIZE, DUEL_DECK_COUNT, type Deck, type DuelDeckSet, type SlotRole } from '../types/deck';

export function createEmptyDeck(name: string): Deck {
  return {
    id: crypto.randomUUID(),
    name,
    slots: Array(DECK_SIZE).fill(null),
  };
}

export function createEmptyDuelDeckSet(name: string): DuelDeckSet {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    decks: [
      createEmptyDeck('Deck 1'),
      createEmptyDeck('Deck 2'),
      createEmptyDeck('Deck 3'),
      createEmptyDeck('Deck 4'),
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function getUsedCardKeys(duelSet: DuelDeckSet, excludeDeckIndex?: number): Set<string> {
  const used = new Set<string>();
  duelSet.decks.forEach((deck, i) => {
    if (i === excludeDeckIndex) return;
    deck.slots.forEach((k) => {
      if (k) used.add(k);
    });
  });
  return used;
}

export function isCardAvailable(duelSet: DuelDeckSet, deckIndex: number, cardKey: string): boolean {
  const usedElsewhere = getUsedCardKeys(duelSet, deckIndex);
  const usedInThisDeck = new Set(
    duelSet.decks[deckIndex].slots.filter((k): k is string => k !== null),
  );
  return !usedElsewhere.has(cardKey) && !usedInThisDeck.has(cardKey);
}

export function assignCard(
  duelSet: DuelDeckSet,
  deckIndex: number,
  slotIndex: number,
  cardKey: string,
): DuelDeckSet {
  if (!isCardAvailable(duelSet, deckIndex, cardKey)) return duelSet;
  const decks = duelSet.decks.map((deck, i) =>
    i !== deckIndex
      ? deck
      : { ...deck, slots: deck.slots.map((s, si) => (si === slotIndex ? cardKey : s)) },
  ) as DuelDeckSet['decks'];
  return { ...duelSet, decks, updatedAt: new Date().toISOString() };
}

export function clearSlot(duelSet: DuelDeckSet, deckIndex: number, slotIndex: number): DuelDeckSet {
  const decks = duelSet.decks.map((deck, i) =>
    i !== deckIndex
      ? deck
      : { ...deck, slots: deck.slots.map((s, si) => (si === slotIndex ? null : s)) },
  ) as DuelDeckSet['decks'];
  return { ...duelSet, decks, updatedAt: new Date().toISOString() };
}

export function clearDeck(duelSet: DuelDeckSet, deckIndex: number): DuelDeckSet {
  const decks = duelSet.decks.map((deck, i) =>
    i !== deckIndex ? deck : { ...deck, slots: Array(DECK_SIZE).fill(null) },
  ) as DuelDeckSet['decks'];
  return { ...duelSet, decks, updatedAt: new Date().toISOString() };
}

export function renameDeck(duelSet: DuelDeckSet, deckIndex: number, name: string): DuelDeckSet {
  const decks = duelSet.decks.map((deck, i) =>
    i !== deckIndex ? deck : { ...deck, name },
  ) as DuelDeckSet['decks'];
  return { ...duelSet, decks, updatedAt: new Date().toISOString() };
}

export function getElixirAverage(deck: Deck, cardsByKey: Map<string, Card>): number | null {
  const filled = deck.slots.filter((k): k is string => k !== null);
  if (filled.length === 0) return null;
  const total = filled.reduce((sum, k) => sum + (cardsByKey.get(k)?.elixir ?? 0), 0);
  return Math.round((total / filled.length) * 10) / 10;
}

/** Standard "cycle cost": sum of the 4 cheapest cards in the deck. */
export function getCycleCost(deck: Deck, cardsByKey: Map<string, Card>): number | null {
  const costs = deck.slots
    .filter((k): k is string => k !== null)
    .map((k) => cardsByKey.get(k)?.elixir ?? 0)
    .sort((a, b) => a - b);
  if (costs.length < 4) return null;
  return costs.slice(0, 4).reduce((a, b) => a + b, 0);
}

export function getTotalCardsUsed(duelSet: DuelDeckSet): number {
  return getUsedCardKeys(duelSet).size;
}

// --- Evolution / Hero / Wild special slots (2026 deck-slot rework) -------
// Fixed by position: slot 1 = Evolution, slot 2 = Hero, slot 3 = Wild. No
// manual assignment — the role a slot plays is purely a function of its index.

/** Which special role a deck slot plays, purely by position (0-indexed). */
export function getSlotRoleByPosition(slotIndex: number): SlotRole {
  if (slotIndex === 0) return 'evolution';
  if (slotIndex === 1) return 'hero';
  if (slotIndex === 2) return 'wild';
  return 'normal';
}

export type SlotVisualVariant = 'base' | 'evolution' | 'hero';

/** Which art variant a slot renders, given the card in it and the slot's positional role. */
export function getSlotVisualVariant(
  deck: Deck,
  slotIndex: number,
  cardsByKey: Map<string, Card>,
): SlotVisualVariant {
  const cardKey = deck.slots[slotIndex];
  const card = cardKey ? cardsByKey.get(cardKey) : undefined;
  if (!card) return 'base';

  const role = getSlotRoleByPosition(slotIndex);
  const isHeroForm = card.canBeHero || card.isChampion;

  if (role === 'evolution') return card.canEvolve ? 'evolution' : 'base';
  if (role === 'hero') return isHeroForm ? 'hero' : 'base';
  if (role === 'wild') {
    if (card.canEvolve) return 'evolution';
    if (isHeroForm) return 'hero';
    return 'base';
  }
  return 'base';
}

export function countChampionsInDeck(deck: Deck, cardsByKey: Map<string, Card>): number {
  return deck.slots.filter((k) => k !== null && cardsByKey.get(k)?.isChampion).length;
}

// ---------------------------------------------------------------------------

export function validateDuelDeckSet(
  duelSet: DuelDeckSet,
  cardsByKey?: Map<string, Card>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (duelSet.decks.length !== DUEL_DECK_COUNT) {
    errors.push(`Expected ${DUEL_DECK_COUNT} decks, found ${duelSet.decks.length}.`);
  }

  duelSet.decks.forEach((deck, i) => {
    const filled = deck.slots.filter((k) => k !== null);
    if (filled.length < DECK_SIZE) {
      errors.push(`${deck.name || `Deck ${i + 1}`} has only ${filled.length}/${DECK_SIZE} cards.`);
    }
  });

  const seen = new Map<string, number>();
  duelSet.decks.forEach((deck, i) => {
    deck.slots.forEach((k) => {
      if (!k) return;
      if (seen.has(k)) {
        errors.push(
          `Card "${k}" appears in both Deck ${seen.get(k)! + 1} and Deck ${i + 1}.`,
        );
      } else {
        seen.set(k, i);
      }
    });
  });

  if (cardsByKey) {
    duelSet.decks.forEach((deck, i) => {
      const deckLabel = deck.name || `Deck ${i + 1}`;
      const championCount = countChampionsInDeck(deck, cardsByKey);
      if (championCount > 1) {
        errors.push(`${deckLabel} has ${championCount} Champions; only 1 is allowed per deck.`);
      }
      deck.slots.forEach((k, slotIndex) => {
        if (!k) return;
        const card = cardsByKey.get(k);
        const role = getSlotRoleByPosition(slotIndex);
        if (card?.isChampion && role !== 'hero' && role !== 'wild') {
          errors.push(`${deckLabel}'s Champion (${card.name}) must be in the 2nd (Hero) or 3rd (Wild) slot.`);
        }
      });
    });
  }

  return { valid: errors.length === 0, errors };
}
