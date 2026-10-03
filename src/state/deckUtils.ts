import type { Card } from '../types/card';
import {
  DECK_SIZE,
  DUEL_DECK_COUNT,
  type Deck,
  type DuelDeckSet,
  type SlotRole,
  type WildVariant,
} from '../types/deck';

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
    decks: Array.from({ length: DUEL_DECK_COUNT }, (_, i) => createEmptyDeck(`Deck ${i + 1}`)),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The cards a collection's decks hold between them. A deck hidden with the eye
 * button holds none of its own: this is the ONE place that rule lives, and
 * availability, the counters and the Versus ribbons all read it from here.
 */
export function getUsedCardKeys(duelSet: DuelDeckSet, excludeDeckIndex?: number): Set<string> {
  const used = new Set<string>();
  duelSet.decks.forEach((deck, i) => {
    if (i === excludeDeckIndex || deck.hidden) return;
    deck.slots.forEach((k) => {
      if (k) used.add(k);
    });
  });
  return used;
}

/** Whether any deck holds a card at all — hidden decks included, unlike the count above. */
export function holdsAnyCard(duelSet: DuelDeckSet): boolean {
  return duelSet.decks.some((deck) => deck.slots.some((k) => k !== null));
}

/** How many of the first `revealed` decks are in play, i.e. not hidden. */
export function countActiveDecks(duelSet: DuelDeckSet, revealed = duelSet.decks.length): number {
  return duelSet.decks.slice(0, revealed).filter((deck) => !deck.hidden).length;
}

/**
 * Hide a duel deck (its cards become free for the rest of the collection) or
 * show it again. No-op when the deck is already in that state.
 *
 * ONLY THE FLAG MOVES. Which copy of a shared card is the newer one is decided
 * when a card ARRIVES in a deck (`markNewerCopies`), not here — so hiding a
 * deck and showing it again can never change which of two copies is grey.
 */
export function setDeckHidden(duelSet: DuelDeckSet, deckIndex: number, hidden: boolean): DuelDeckSet {
  const target = duelSet.decks[deckIndex];
  if (!target || !!target.hidden === hidden) return duelSet;
  const decks = duelSet.decks.map((deck, i) => {
    if (i !== deckIndex) return deck;
    const next = { ...deck };
    if (hidden) next.hidden = true;
    else delete next.hidden;
    return next;
  });
  return { ...duelSet, decks, updatedAt: new Date().toISOString() };
}

/* --- Two decks, one card: which copy is the newer one --------------------
 * A duel collection may briefly hold a card twice: a pasted deck may repeat
 * one, and a deck hidden with the eye frees its cards for another deck and can
 * then be shown again. The NEWER copy is the one drawn black and white; the
 * copy that was there first keeps its colour. "Newer" is recorded when the
 * card arrives (`Deck.newerCopies`) and read back by `getDuplicateKeys`. */

/** `deck` with its newer-copy marks replaced — the same object when nothing changed. */
function withNewerCopies(deck: Deck, marks: string[]): Deck {
  const had = deck.newerCopies ?? [];
  if (had.length === marks.length && had.every((k, i) => k === marks[i])) return deck;
  const next = { ...deck };
  if (marks.length > 0) next.newerCopies = marks;
  else delete next.newerCopies;
  return next;
}

/**
 * `next` is deck `deckIndex` after an edit. A card that ARRIVED in it while
 * another deck of the collection — in play or hidden — already held it is
 * marked: this deck's copy is the newer one. A mark stays with a card that
 * stayed and goes with a card that left.
 */
export function markNewerCopies(duelSet: DuelDeckSet, deckIndex: number, next: Deck): Deck {
  const prev = duelSet.decks[deckIndex];
  const before = new Set(prev?.slots ?? []);
  const elsewhere = new Set<string>();
  duelSet.decks.forEach((deck, i) => {
    if (i === deckIndex) return;
    deck.slots.forEach((k) => {
      if (k) elsewhere.add(k);
    });
  });
  const kept = (prev?.newerCopies ?? []).filter((k) => before.has(k) && next.slots.includes(k));
  const arrived = next.slots.filter(
    (k): k is string => k !== null && !before.has(k) && elsewhere.has(k),
  );
  return withNewerCopies(next, [...kept, ...arrived]);
}

/**
 * The cards of deck `deckIndex` drawn black and white: cards another deck IN
 * PLAY also holds, where this deck's copy is not the one that keeps its colour.
 *
 * Exactly one copy of a shared card stays in colour — the oldest. That is the
 * holder with no newer-copy mark; with several unmarked holders, or none (decks
 * edited by an older build carry no marks), it is the one highest on the
 * board, since a second version of a deck is built below the first. So a clash
 * always shows, and never as every copy grey.
 *
 * A hidden deck is grey as a whole and takes no part: its cards are free, so
 * the deck that reuses one is in colour until the hidden deck is shown again.
 */
export function getDuplicateKeys(duelSet: DuelDeckSet, deckIndex: number): Set<string> {
  const out = new Set<string>();
  const deck = duelSet.decks[deckIndex];
  if (!deck || deck.hidden) return out;
  for (const k of deck.slots) {
    if (!k || out.has(k)) continue;
    const holders: number[] = [];
    duelSet.decks.forEach((d, i) => {
      if (!d.hidden && d.slots.includes(k)) holders.push(i);
    });
    if (holders.length < 2) continue;
    const original =
      holders.find((i) => !duelSet.decks[i].newerCopies?.includes(k)) ?? holders[0];
    if (original !== deckIndex) out.add(k);
  }
  return out;
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
 * Validates 8 imported card keys and arranges them into legal slots (champions
 * are moved into the Hero slot 1 and, for a second one, the Wild slot 2).
 * Cards already used in other decks of the collection are allowed — the UI
 * renders them desaturated so the player can spot and swap the duplicates.
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
  if (champions.length > MAX_CHAMPIONS_PER_DECK) {
    return { error: `A deck can only hold ${MAX_CHAMPIONS_PER_DECK} champions` };
  }

  // Champions are only legal in the Hero (1) and Wild (2) slots. Any champion
  // already sitting in one stays put; the rest swap into the remaining free
  // champion slot(s). Indices are captured up front, and each swap only touches
  // a champion slot and one misplaced slot, so they never interfere.
  const ordered = [...keys];
  const CHAMPION_SLOTS = [1, 2];
  const isChampion = (k: string) => cardsByKey.get(k)!.isChampion;
  const freeChampionSlots = CHAMPION_SLOTS.filter((i) => !isChampion(ordered[i]));
  const misplaced = ordered
    .map((_, i) => i)
    .filter((i) => isChampion(ordered[i]) && !CHAMPION_SLOTS.includes(i));

  misplaced.forEach((from, n) => {
    const target = freeChampionSlots[n];
    [ordered[target], ordered[from]] = [ordered[from], ordered[target]];
  });

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
  const decks = duelSet.decks.map((deck, i) => {
    if (i !== deckIndex) return deck;
    const next = withWildChoiceReset(
      { ...deck, slots: deck.slots.map((s, si) => (si === slotIndex ? cardKey : s)) },
      slotIndex,
    );
    // Only a duel collection shares cards; there, a card taken from a hidden
    // deck is the newer copy of it.
    return scope === 'collection' ? markNewerCopies(duelSet, i, next) : next;
  }) as DuelDeckSet['decks'];
  return { ...duelSet, decks, updatedAt: new Date().toISOString() };
}

export function clearSlot(duelSet: DuelDeckSet, deckIndex: number, slotIndex: number): DuelDeckSet {
  const decks = duelSet.decks.map((deck, i) =>
    i !== deckIndex
      ? deck
      : // Nothing arrives on a clear; this only lets the card's mark leave with it.
        markNewerCopies(
          duelSet,
          i,
          withWildChoiceReset(
            { ...deck, slots: deck.slots.map((s, si) => (si === slotIndex ? null : s)) },
            slotIndex,
          ),
        ),
  ) as DuelDeckSet['decks'];
  return { ...duelSet, decks, updatedAt: new Date().toISOString() };
}

export function clearDeck(duelSet: DuelDeckSet, deckIndex: number): DuelDeckSet {
  const decks = duelSet.decks.map((deck, i) =>
    i !== deckIndex
      ? deck
      : markNewerCopies(
          duelSet,
          i,
          withWildChoiceReset(
            { ...deck, slots: Array(DECK_SIZE).fill(null), crowns: 0 },
            WILD_SLOT_INDEX,
          ),
        ),
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

/** The Wild slot's fixed position — the only slot that can field either form. */
export const WILD_SLOT_INDEX = 2;

/** The form the Wild slot fields when the player hasn't switched it. */
export const DEFAULT_WILD_VARIANT: WildVariant = 'evolution';

/**
 * The Wild slot's form choice belongs to the card sitting in it — replacing,
 * clearing or dragging that card away drops the deck back to the default form.
 */
function withWildChoiceReset(deck: Deck, slotIndex: number): Deck {
  if (slotIndex !== WILD_SLOT_INDEX || deck.wildVariant === undefined) return deck;
  const next = { ...deck };
  delete next.wildVariant;
  return next;
}

/**
 * Whether the Wild slot's card has both an Evolution and a Hero form (Knight,
 * Valkyrie, Musketeer, Wizard) — only then is there anything to switch between.
 */
export function canSwitchWildVariant(deck: Deck, cardsByKey: Map<string, Card>): boolean {
  const cardKey = deck.slots[WILD_SLOT_INDEX];
  const card = cardKey ? cardsByKey.get(cardKey) : undefined;
  if (!card) return false;
  return card.canEvolve && (card.canBeHero || card.isChampion);
}

/** The form the Wild slot is currently fielding (default when never switched). */
export function getWildVariant(deck: Deck): WildVariant {
  return deck.wildVariant ?? DEFAULT_WILD_VARIANT;
}

/** Field a specific form in the Wild slot (no-op if its card has only one). */
export function setWildVariant(
  duelSet: DuelDeckSet,
  deckIndex: number,
  variant: WildVariant,
  cardsByKey: Map<string, Card>,
): DuelDeckSet {
  const deck = duelSet.decks[deckIndex];
  if (!deck || !canSwitchWildVariant(deck, cardsByKey)) return duelSet;
  if (getWildVariant(deck) === variant) return duelSet;
  const decks = duelSet.decks.map((d, i) =>
    i !== deckIndex ? d : { ...d, wildVariant: variant },
  ) as DuelDeckSet['decks'];
  return { ...duelSet, decks, updatedAt: new Date().toISOString() };
}

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
    // Cards with both forms field whichever the player switched to; the rest
    // simply show the one form they have.
    if (card.canEvolve && isHeroForm) return getWildVariant(deck);
    if (card.canEvolve) return 'evolution';
    if (isHeroForm) return 'hero';
    return 'base';
  }
  return 'base';
}

/**
 * Champions live only in the Hero (2nd) and Wild (3rd) slots, so a deck can
 * field at most one in each — two in total.
 */
export const MAX_CHAMPIONS_PER_DECK = 2;

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
 * positional champion rule, per-collection uniqueness, and the champion cap
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
    if (otherChampions >= MAX_CHAMPIONS_PER_DECK) return false;
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
 * destination positions and no deck may exceed the Champion cap.
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
      if (champions > MAX_CHAMPIONS_PER_DECK) return false;
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
  const fromDeck = duelSet.decks[from.deckIndex];
  const toDeck = duelSet.decks[to.deckIndex];
  const fromKey = fromDeck.slots[from.slotIndex];
  const toKey = toDeck.slots[to.slotIndex];
  const acrossDecks = from.deckIndex !== to.deckIndex;
  const decks = duelSet.decks.map((deck, di) => {
    if (di !== from.deckIndex && di !== to.deckIndex) return deck;
    const slots = deck.slots.map((k, si) => {
      if (di === from.deckIndex && si === from.slotIndex) return toKey;
      if (di === to.deckIndex && si === to.slotIndex) return fromKey;
      return k;
    });
    // A move touching this deck's Wild slot swaps out the card the form choice belonged to.
    const touchesWild =
      (di === from.deckIndex && from.slotIndex === WILD_SLOT_INDEX) ||
      (di === to.deckIndex && to.slotIndex === WILD_SLOT_INDEX);
    const moved = withWildChoiceReset({ ...deck, slots }, touchesWild ? WILD_SLOT_INDEX : -1);
    if (!acrossDecks) return moved;
    // A newer-copy mark belongs to the card, so it travels with it: dragging
    // the grey copy of a shared card to another deck must not turn it into
    // the original.
    const [leaving, arriving, source] =
      di === from.deckIndex ? [fromKey, toKey, toDeck] : [toKey, fromKey, fromDeck];
    const marks = (deck.newerCopies ?? []).filter((k) => k !== leaving);
    if (arriving && source.newerCopies?.includes(arriving)) marks.push(arriving);
    return withNewerCopies(moved, marks);
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
    // A hidden deck holds none of its cards, so it cannot repeat one.
    if (deck.hidden) return;
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
      if (championCount > MAX_CHAMPIONS_PER_DECK) {
        errors.push(
          `${deckLabel} has ${championCount} Champions; only ${MAX_CHAMPIONS_PER_DECK} are allowed per deck.`,
        );
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
