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

/** The two forms the Wild slot can field. */
export type WildVariant = 'evolution' | 'hero';

export interface Deck {
  id: string;
  name: string;
  slots: DeckSlot[];
  /**
   * Which form the Wild slot fields when its card has BOTH an Evolution and a
   * Hero form (Knight, Valkyrie, Musketeer, Wizard) — the player toggles it
   * with the switch on the slot. Absent means the default, 'evolution'. Reset
   * whenever the Wild slot's card changes.
   */
  wildVariant?: WildVariant;
  /**
   * Cards that were already in another deck of the duel collection when they
   * arrived in this one — by a paste, or by reusing a card of a deck hidden
   * with the eye. This deck's copy is the NEWER one, and it is the copy drawn
   * black & white while both decks are in play (`getDuplicateKeys`). The older
   * copy keeps its colour.
   */
  newerCopies?: string[];
  /**
   * @deprecated The same marks before 2026-10-03. For one build a deck shown
   * again with the eye was marked here instead of the deck that had taken its
   * card, so the field no longer says which copy is newer. Still present in
   * stored decks; never read and never written.
   */
  importedDuplicates?: string[];
  /**
   * Crowns this deck won in the duel (0–MAX_CROWNS). Tracked per deck in
   * Versus mode; absent means 0. Lives on the Deck so it travels with saves.
   */
  crowns?: number;
  /**
   * Set aside with the eye button in a duel collection. A hidden deck keeps
   * its eight cards but no longer holds them: they are free for the other
   * decks of the collection. It stays on the board, drawn grey and read-only,
   * and is left out of the counters and the PDF. Absent means in play. Never
   * set in Deck's Home or Counter Palette, whose decks share nothing with
   * each other.
   */
  hidden?: boolean;
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
