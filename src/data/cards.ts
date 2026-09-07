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

/* CARD ART IS WEBP, NOT PNG, AND THE EXTENSION IS THE WHOLE WIRING.
 *
 * Nothing else in `src/` builds a path into these three directories — the PDF
 * renderer's `utils/report/art.ts` calls straight through to the functions
 * below — so the served format is decided here and in `scripts/build-card-art.py`
 * and nowhere else.
 *
 * WHY IT CHANGED: the PNGs were 46 MB, which was 94% of every Vercel
 * deployment's 53 MB build output, and at ~190 retained deployments that was
 * the entire 10 GB storage allowance. The same art as WebP is 3.3 MB. The
 * script records the measurements and why the width is capped at the 302px
 * card frame.
 *
 * The rest of the served art — the field book plates, the tool panels, the hero
 * backdrop, the brand marks — has been WebP for months. This is the last PNG
 * directory, not a new format for the project to support. */
export function getCardIconUrl(key: string): string {
  return `${import.meta.env.BASE_URL}assets/cards/${key}.webp`;
}

export function getEvolutionIconUrl(key: string): string {
  return `${import.meta.env.BASE_URL}assets/evolutions/${key}.webp`;
}

export function getHeroIconUrl(key: string): string {
  return `${import.meta.env.BASE_URL}assets/heroes/${key}.webp`;
}
