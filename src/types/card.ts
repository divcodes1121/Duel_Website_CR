export type CardType = 'Troop' | 'Building' | 'Spell';
export type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Champion';

export interface Card {
  key: string;
  name: string;
  scKey: string;
  elixir: number;
  type: CardType;
  rarity: Rarity;
  arena: number;
  description: string;
  id: number;
  isEvolved: boolean;
  evolvedSpellsScKey: string;
  /** Eligible for the deck's single Evolution Slot. */
  canEvolve: boolean;
  /** Eligible for the deck's Hero Slot (Heroes and Champions both qualify). */
  canBeHero: boolean;
  /** Champion card — at most 1 per deck, must occupy the Hero or Wild slot. */
  isChampion: boolean;
  /** Card that directly damages the tower/wins the game (used for deck-archetype info, not enforced). */
  isWinCondition: boolean;
}
