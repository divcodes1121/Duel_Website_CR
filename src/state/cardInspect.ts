import { useSyncExternalStore } from 'react';
import type { Card } from '../types/card';

/**
 * The card inspect sheet's state and rules (the sheet is
 * `components/CardInspect/CardInspect.tsx`, mounted once in `App`).
 *
 * One card, large, in a sheet — never an effect on a grid. The grid foil was
 * built and removed (`a452525`): at the size a picker draws a card, a moving
 * sheen makes forty cards harder to read, not one card nicer to look at.
 *
 * Opened two ways:
 * - by a Cards screen, which passes the figures it already has for that card
 *   (`record`), so the sheet says what that screen measured and nothing more;
 * - by a click on card art anywhere else (a delegated listener in the sheet),
 *   which knows only the card and the form it was drawn in, so the sheet shows
 *   the catalogue's facts and no record.
 */

export type CardForm = 'base' | 'evolution' | 'hero';

export interface InspectFact {
  label: string;
  value: string;
}

export interface InspectRequest {
  key: string;
  form?: CardForm;
  /** What the opening screen measured for this card, with where it came from. */
  record?: { title: string; facts: InspectFact[] };
}

/** The forms a card has art for: an evolution, and a hero unless it is a
 *  champion (champions take the Hero slot in their own art). */
export function formsOf(card: Pick<Card, 'canEvolve' | 'canBeHero' | 'isChampion'>): CardForm[] {
  const forms: CardForm[] = ['base'];
  if (card.canEvolve) forms.push('evolution');
  if (card.canBeHero && !card.isChampion) forms.push('hero');
  return forms;
}

/** A requested form the card cannot take falls back to its base art. */
export function startingForm(card: Pick<Card, 'canEvolve' | 'canBeHero' | 'isChampion'>, form: CardForm | undefined): CardForm {
  return form && formsOf(card).includes(form) ? form : 'base';
}

/** The catalogue's facts, in reading order. */
export function cardFacts(card: Card): string[] {
  const facts = [`${card.elixir} elixir`, card.rarity, card.type];
  if (card.isWinCondition) facts.push('Win condition');
  if (card.isChampion) facts.push('Champion');
  if (card.canEvolve) facts.push('Has an evolution');
  if (card.canBeHero && !card.isChampion) facts.push('Has a hero form');
  return facts;
}

/**
 * Should a click on card art open the sheet? Not when the art sits inside
 * something that already does a job on click — a button, a link, a tab, a
 * label, or anything that says so with `data-no-inspect` (Duel Analysis's
 * expandable rows) — because opening a sheet over it would take that job away.
 * `closestInteractive` is `el.closest(INTERACTIVE)`; kept a parameter so the
 * rule is testable without a DOM.
 */
export const INTERACTIVE = 'button, a, label, [role="button"], [role="tab"], [role="option"], [data-no-inspect]';

export function shouldInspect(cardKey: string | null | undefined, closestInteractive: unknown): boolean {
  return Boolean(cardKey) && !closestInteractive;
}

/* ── the one open request ────────────────────────────────────────────────── */

let current: InspectRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function openCardInspect(req: InspectRequest): void {
  current = req;
  emit();
}

export function closeCardInspect(): void {
  if (!current) return;
  current = null;
  emit();
}

export function getCardInspect(): InspectRequest | null {
  return current;
}

export function useCardInspect(): InspectRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}
