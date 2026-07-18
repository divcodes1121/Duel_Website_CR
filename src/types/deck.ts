export const DECK_SIZE = 8;
export const DUEL_DECK_COUNT = 5;
/** A duel deck wins at most 3 crowns. */
export const MAX_CROWNS = 3;

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
  /**
   * Cards this deck imported even though another deck in the collection
   * already used them — rendered black & white until the clash is resolved.
   * Only the pasted deck carries the flag, never the original copies.
   */
  importedDuplicates?: string[];
  /**
   * Crowns this deck won in the duel (0–MAX_CROWNS). Tracked per deck in
   * Versus mode; absent means 0. Lives on the Deck so it travels with saves.
   */
  crowns?: number;
}

export interface DuelDeckSet {
  id: string;
  name: string;
  /** Duel collections always hold exactly 4; Deck's Home holds any number. */
  decks: Deck[];
  createdAt: string;
  updatedAt: string;
}

export type PlayerId = 'blue' | 'red';
/**
 * Which deck collection a slot belongs to: the solo builder's, one of the two
 * Versus players', the Deck's Home single-deck workshop (which uses only
 * deck index 0 of its collection, so duel-wide uniqueness never bites there),
 * or the Counter Palette workshop (a live view of the open archetype folder —
 * see `paletteFolders` in the store).
 */
export type DeckOwner = 'solo' | PlayerId | 'home' | 'palette';
export type BuilderMode = 'solo' | 'versus';

export interface SelectedSlot {
  owner: DeckOwner;
  deckIndex: number;
  slotIndex: number;
}

/** A single 8-card deck saved in Deck's Home. */
export interface SavedSingleDeck {
  id: string;
  name: string;
  deck: Deck;
  savedAt: string;
}

/** A named snapshot in the saved-decks library. Solo entries hold `solo`; Versus entries hold `blue` + `red`. */
export interface SavedDeckSet {
  id: string;
  name: string;
  mode: BuilderMode;
  solo?: DuelDeckSet;
  blue?: DuelDeckSet;
  red?: DuelDeckSet;
  savedAt: string;
}
