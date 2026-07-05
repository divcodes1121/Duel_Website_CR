import cardsRaw from './cards.json';
import cardMetaRaw from './cardMeta.json';
import type { Card, CardType } from '../types/card';

const VALID_TYPES: CardType[] = ['Troop', 'Building', 'Spell'];

interface RawCard {
  key: string;
  name: string;
  sc_key: string;
  elixir: number;
  type: string;
  rarity: string;
  arena: number;
  description: string;
  id: number;
  evolved_spells_sc_key?: string;
  is_evolved?: boolean;
}

interface RawCardMeta {
  can_evolve: boolean;
  can_be_hero: boolean;
  is_champion: boolean;
  is_win_condition: boolean;
}

const CARD_META = cardMetaRaw as Record<string, RawCardMeta>;

export const CARDS: Card[] = (cardsRaw as RawCard[])
  .filter((c): c is RawCard & { type: CardType } => VALID_TYPES.includes(c.type as CardType))
  .map((c) => {
    const meta = CARD_META[c.key];
    return {
      key: c.key,
      name: c.name,
      scKey: c.sc_key,
      elixir: c.elixir,
      type: c.type,
      rarity: c.rarity as Card['rarity'],
      arena: c.arena,
      description: c.description,
      id: c.id,
      isEvolved: !!c.is_evolved,
      evolvedSpellsScKey: c.evolved_spells_sc_key ?? '',
      canEvolve: meta?.can_evolve ?? false,
      canBeHero: meta?.can_be_hero ?? false,
      isChampion: meta?.is_champion ?? false,
      isWinCondition: meta?.is_win_condition ?? false,
    };
  });

export const CARDS_BY_KEY: Map<string, Card> = new Map(CARDS.map((c) => [c.key, c]));

export function getCardIconUrl(key: string): string {
  return `${import.meta.env.BASE_URL}assets/cards/${key}.png`;
}

export function getEvolutionIconUrl(key: string): string {
  return `${import.meta.env.BASE_URL}assets/evolutions/${key}.png`;
}

export function getHeroIconUrl(key: string): string {
  return `${import.meta.env.BASE_URL}assets/heroes/${key}.png`;
}
