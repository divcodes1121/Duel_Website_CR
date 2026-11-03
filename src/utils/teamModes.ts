/**
 * Team Analysis' "They play" (2026-11-03): an opponent deck's games by kind,
 * as one line — "58 ranked · 9 ladder · 12 friendly · 3 duel".
 *
 * No imports, so it is testable without the screen. Ranked is Path of
 * Legends, ladder is trophy road, duel a native friendly duel; `other` is
 * only present when a player had no ranked or friendly games in the window
 * and every own-deck game was read instead.
 */

export type ModeKind = 'ranked' | 'ladder' | 'friendly' | 'duel' | 'other';

export const MODE_ORDER: readonly ModeKind[] = ['ranked', 'ladder', 'friendly', 'duel', 'other'];

/** "58 ranked · 9 ladder · 12 friendly", kinds with no games left out, in
 *  `MODE_ORDER`. Empty string for nothing (an older server sends no split). */
export function modeSplit(modes: Partial<Record<ModeKind, number>> | null | undefined): string {
  if (!modes) return '';
  return MODE_ORDER.filter((k) => (modes[k] ?? 0) > 0)
    .map((k) => `${modes[k]} ${k}`)
    .join(' · ');
}

/** "77% of games" from a 0..100 share; "<1% of games" for a share that
 *  rounds to nothing but is not nothing. */
export function gamesLabel(share: number | null | undefined): string {
  if (share === null || share === undefined) return '';
  if (share > 0 && share < 0.5) return '<1% of games';
  return `${Math.round(share)}% of games`;
}
