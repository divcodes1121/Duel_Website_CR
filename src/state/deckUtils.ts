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

/**
 * How far card-uniqueness reaches: duel collections forbid a card anywhere in
 * the 4 decks ('collection'); Deck's Home decks are independent, so a card is
 * only blocked within the deck being edited ('deck').
 */
export type UniquenessScope = 'collection' | 'deck';

export function isCardAvailable(
  duelSet: DuelDeckSet,
  deckIndex: number,
  cardKey: string,
  scope: UniquenessScope = 'collection',
): boolean {
  const usedElsewhere =
    scope === 'collection' ? getUsedCardKeys(duelSet, deckIndex) : new Set<string>();
  const usedInThisDeck = new Set(
    duelSet.decks[deckIndex].slots.filter((k): k is string => k !== null),
  );
  return !usedElsewhere.has(cardKey) && !usedInThisDeck.has(cardKey);
}

/**
 * Validates 8 imported card keys and arranges them into legal slots (a
 * champion is moved into the Hero slot, index 1). Cards already used in other
 * decks of the collection are allowed — the UI renders them desaturated so
 * the player can spot and swap the duplicates.
 */
export function validateImportedDeck(
  keys: string[],
  cardsByKey: Map<string, Card>,
): { slots: string[] } | { error: string } {
  if (keys.length !== DECK_SIZE) return { error: 'Invalid deck link' };
  if (new Set(keys).size !== keys.length) return { error: 'Link repeats a card' };

  const cards = keys.map((k) => cardsByKey.get(k));
  if (cards.some((c) => !c)) return { error: 'Invalid deck link' };

  const champions = keys.filter((k) => cardsByKey.get(k)!.isChampion);
  if (champions.length > 1) return { error: 'A deck can only hold one champion' };

  // Champions are only legal in the Hero (1) or Wild (2) slot.
  const ordered = [...keys];
  if (champions.length === 1) {
    const ci = ordered.indexOf(champions[0]);
    if (ci !== 1 && ci !== 2) {
      [ordered[1], ordered[ci]] = [ordered[ci], ordered[1]];
    }
  }

  return { slots: ordered };
}

export function assignCard(
  duelSet: DuelDeckSet,
  deckIndex: number,
  slotIndex: number,
  cardKey: string,
  scope: UniquenessScope = 'collection',
): DuelDeckSet {
  if (!isCardAvailable(duelSet, deckIndex, cardKey, scope)) return duelSet;
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

/** Champions may only occupy the Hero (2nd) or Wild (3rd) slot; other cards go anywhere. */
export function canPlaceCardInSlot(card: Card, slotIndex: number): boolean {
  if (!card.isChampion) return true;
  const role = getSlotRoleByPosition(slotIndex);
  return role === 'hero' || role === 'wild';
}

/**
 * Full validation for putting `card` into a specific slot (click or drag):
 * positional champion rule, per-collection uniqueness, and the 1-champion cap
 * (ignoring whatever currently occupies the target slot, since it's replaced).
 */
export function canAssignCardToSlot(
  duelSet: DuelDeckSet,
  deckIndex: number,
  slotIndex: number,
  card: Card,
  cardsByKey: Map<string, Card>,
  scope: UniquenessScope = 'collection',
): boolean {
  if (!canPlaceCardInSlot(card, slotIndex)) return false;
  if (!isCardAvailable(duelSet, deckIndex, card.key, scope)) return false;
  if (card.isChampion) {
    const deck = duelSet.decks[deckIndex];
    const otherChampions = deck.slots.filter(
      (k, i) => i !== slotIndex && k !== null && cardsByKey.get(k)?.isChampion,
    ).length;
    if (otherChampions >= 1) return false;
  }
  return true;
}

export interface SlotRef {
  deckIndex: number;
  slotIndex: number;
}

/**
 * Whether the card in `from` can move to `to` (swapping with `to`'s occupant,
 * if any) within the same collection. Both cards must be legal in their
 * destination positions and no deck may end up with more than one Champion.
 */
export function canMoveCard(
  duelSet: DuelDeckSet,
  from: SlotRef,
  to: SlotRef,
  cardsByKey: Map<string, Card>,
): boolean {
  if (from.deckIndex === to.deckIndex && from.slotIndex === to.slotIndex) return false;
  const fromKey = duelSet.decks[from.deckIndex]?.slots[from.slotIndex];
  if (!fromKey) return false;
  const fromCard = cardsByKey.get(fromKey);
  if (!fromCard) return false;
  const toKey = duelSet.decks[to.deckIndex]?.slots[to.slotIndex] ?? null;
  const toCard = toKey ? cardsByKey.get(toKey) : undefined;

  if (!canPlaceCardInSlot(fromCard, to.slotIndex)) return false;
  if (toCard && !canPlaceCardInSlot(toCard, from.slotIndex)) return false;

  if (from.deckIndex !== to.deckIndex) {
    const hypothetical = duelSet.decks.map((d) => [...d.slots]);
    hypothetical[from.deckIndex][from.slotIndex] = toKey;
    hypothetical[to.deckIndex][to.slotIndex] = fromKey;
    for (const di of [from.deckIndex, to.deckIndex]) {
      const champions = hypothetical[di].filter(
        (k) => k !== null && cardsByKey.get(k)?.isChampion,
      ).length;
      if (champions > 1) return false;
    }
  }
  return true;
}

/** Move/swap the cards between two slots of the same collection (no-op if invalid). */
export function moveCard(
  duelSet: DuelDeckSet,
  from: SlotRef,
  to: SlotRef,
  cardsByKey: Map<string, Card>,
): DuelDeckSet {
  if (!canMoveCard(duelSet, from, to, cardsByKey)) return duelSet;
  const fromKey = duelSet.decks[from.deckIndex].slots[from.slotIndex];
  const toKey = duelSet.decks[to.deckIndex].slots[to.slotIndex];
  const decks = duelSet.decks.map((deck, di) => {
    if (di !== from.deckIndex && di !== to.deckIndex) return deck;
    const slots = deck.slots.map((k, si) => {
      if (di === from.deckIndex && si === from.slotIndex) return toKey;
      if (di === to.deckIndex && si === to.slotIndex) return fromKey;
      return k;
    });
    return { ...deck, slots };
  }) as DuelDeckSet['decks'];
  return { ...duelSet, decks, updatedAt: new Date().toISOString() };
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
