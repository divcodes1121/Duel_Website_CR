import type { Card } from '../types/card';
import type { DuelDeckSet } from '../types/deck';
import { canAssignCardToSlot, type UniquenessScope } from './deckUtils';

/**
 * What a deck is made of, and completing one legally. Pure: no store, no
 * React. The rules live in `deckUtils`; this only asks them.
 */

/** Seven buckets: 1, 2, 3, 4, 5, 6 and 7+ elixir. */
export function elixirCurve(cards: readonly Card[]): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const c of cards) out[Math.min(7, Math.max(1, c.elixir)) - 1]++;
  return out;
}

export interface CardMix {
  winConditions: number;
  spells: number;
  buildings: number;
  troops: number;
}

/** Counted from the catalogue's own flags; no judgement words. */
export function cardMix(cards: readonly Card[]): CardMix {
  return {
    winConditions: cards.filter((c) => c.isWinCondition).length,
    spells: cards.filter((c) => c.type === 'Spell').length,
    buildings: cards.filter((c) => c.type === 'Building').length,
    troops: cards.filter((c) => c.type === 'Troop').length,
  };
}

/** The average-elixir band a filled deck is kept inside. */
export const FILL_ELIXIR = { min: 2.6, max: 4.3 } as const;
const ATTEMPTS = 400;

/**
 * Complete one deck with legal cards, leaving every placed card where it is.
 *
 * What "legal" means is `canAssignCardToSlot` — the same check a click or a
 * drag makes — so the positional champion rule, the champion cap and
 * uniqueness (across the whole collection for duel decks, within the deck for
 * Deck's Home and Counter Palette) cannot be bypassed by the button.
 *
 * What "a deck" means is stricter, because a button that fills slots with
 * anything would be a random-card generator:
 *
 *   * the three special slots are USED — something that evolves in the Evo
 *     slot, a hero or champion in Hero, either in Wild — the same three-slot
 *     rule every deck Deckkies suggests follows;
 *   * at least one win condition and one spell;
 *   * average elixir inside FILL_ELIXIR.
 *
 * Tried ATTEMPTS times with fresh random picks; the first attempt that meets
 * all of it wins, and if none does (the reader's own cards already sit outside
 * the band) the last complete attempt is returned rather than nothing. Null
 * only when no legal card fits an empty slot at all.
 */
export function fillDeck(
  set: DuelDeckSet,
  deckIndex: number,
  catalogue: readonly Card[],
  byKey: Map<string, Card>,
  scope: UniquenessScope,
  rng: () => number = Math.random,
): (string | null)[] | null {
  const base = set.decks[deckIndex];
  if (!base) return null;
  if (base.slots.every((k) => k !== null)) return [...base.slots];

  const heroForm = (c: Card) => c.canBeHero || c.isChampion;
  let lastComplete: (string | null)[] | null = null;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const slots = [...base.slots];
    const view = (): DuelDeckSet => ({
      ...set,
      decks: set.decks.map((d, i) => (i === deckIndex ? { ...d, slots } : d)),
    });
    const put = (i: number, want: (c: Card) => boolean): boolean => {
      if (slots[i] !== null) return true;
      const current = view();
      const pool = catalogue.filter(
        (c) => want(c) && canAssignCardToSlot(current, deckIndex, i, c, byKey, scope),
      );
      if (!pool.length) return false;
      slots[i] = pool[Math.floor(rng() * pool.length)].key;
      return true;
    };
    const firstEmpty = () => slots.findIndex((k, i) => i >= 3 && k === null);
    const placed = () => slots.filter((k): k is string => k !== null).map((k) => byKey.get(k)!).filter(Boolean);

    put(0, (c) => c.canEvolve && !c.isChampion);
    put(1, heroForm);
    put(2, (c) => c.canEvolve || heroForm(c));
    if (!placed().some((c) => c.isWinCondition)) {
      const i = firstEmpty();
      if (i >= 0) put(i, (c) => c.isWinCondition);
    }
    if (!placed().some((c) => c.type === 'Spell')) {
      const i = firstEmpty();
      if (i >= 0) put(i, (c) => c.type === 'Spell');
    }
    for (let i = 0; i < slots.length; i++) put(i, () => true);

    if (slots.some((k) => k === null)) continue;
    lastComplete = slots;
    const cards = placed();
    const avg = cards.reduce((a, c) => a + c.elixir, 0) / cards.length;
    const ok =
      avg >= FILL_ELIXIR.min &&
      avg <= FILL_ELIXIR.max &&
      cards.some((c) => c.isWinCondition) &&
      cards.some((c) => c.type === 'Spell');
    if (ok) return slots;
  }
  return lastComplete;
}
