export const DECK_SIZE = 8;
export const DUEL_DECK_COUNT = 4;

export type DeckSlot = string | null;

/**
 * Fixed by position (2026 deck-slot rework): slot 1 is always the Evolution
 * slot, slot 2 the Hero/Champion slot, slot 3 the Wild slot (Evolution, Hero,
 * or Champion), and slots 4-8 are plain slots. Not user-assignable.
 */
export type SlotRole = 'evolution' | 'hero' | 'wild' | 'normal';

export interface Deck {
  id: string;
  name: string;
  slots: DeckSlot[];
}

export interface DuelDeckSet {
  id: string;
  name: string;
  decks: [Deck, Deck, Deck, Deck];
  createdAt: string;
  updatedAt: string;
}

export interface SelectedSlot {
  deckIndex: number;
  slotIndex: number;
}
