/**
 * Coach Assist's counters block: the few words on it, in one place so the
 * screen and the PDF say the same thing. No imports.
 *
 * The block lists decks from OUTSIDE the player's own duel decks — the duel
 * lists of the CRL group and the vetted ladder lists — rated against the read
 * of the opponent's next deck (`server/coach.py` `_counter_rows`, 2026-10-12).
 * Figures only: the reasoning is in the README, not on the screen.
 */

export type CounterOrigin = 'duel' | 'ladder' | null | undefined;

/** Where a counter comes from, as the tag on its row. */
export function counterLabel(origin: CounterOrigin): string {
  return origin === 'duel' ? 'CRL duel list' : 'Meta list';
}

/** The block's heading: what the lists were rated against. Before game 1 that
 *  is their likely opener; after it, the decks they can still bring. */
export function counterHeading(stage: number): string {
  return stage <= 0 ? 'Counters to their likely opener' : 'Counters to what they have left';
}

/** The heading's note: how many lists were rated, against how many of theirs. */
export function counterNote(c: { rated: number; against: number }): string {
  const decks = c.against === 1 ? 'deck' : 'decks';
  return `${c.rated.toLocaleString('en-US')} lists rated · against ${c.against} of their ${decks}`;
}

/** The part of the set's note that says how many of its decks are counters. */
export function setCounterNote(counters?: number | null): string {
  if (!counters) return '';
  return ` · ${counters} counter${counters === 1 ? '' : 's'}`;
}
