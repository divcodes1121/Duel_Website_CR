/**
 * The arithmetic behind the Recent Battles form strip. No imports.
 *
 * COUNTED, NEVER SCORED. The strip is the last results in order and the run
 * the newest of them belongs to — the form guide every football site prints.
 * It does not say whether the player is "on form"; it says what happened.
 */

export type Result = 'win' | 'loss' | 'draw';

/** How many results the strip shows: two pages of the log. */
export const FORM_SIZE = 20;

/** A run shorter than this is not called a streak. One win is a result. */
export const STREAK_MIN = 2;

export interface Form<T extends { result: Result }> {
  /** Oldest first, so the strip reads left to right like the calendar. */
  ordered: T[];
  wins: number;
  losses: number;
  draws: number;
  /** Over decided games (draws excluded), as the log's own header counts
   *  them; null when nothing was decided. */
  winRate: number | null;
  /** The run the NEWEST result belongs to, or null under `STREAK_MIN`. */
  streak: { result: Result; length: number } | null;
}

/** `newestFirst` is the order the battle log arrives in. */
export function formOf<T extends { result: Result }>(newestFirst: readonly T[]): Form<T> {
  const recent = newestFirst.slice(0, FORM_SIZE);
  const count = (r: Result) => recent.filter((b) => b.result === r).length;
  const wins = count('win');
  const losses = count('loss');
  const draws = count('draw');
  let length = 0;
  const head = recent[0]?.result;
  while (length < recent.length && recent[length].result === head) length++;
  return {
    ordered: [...recent].reverse(),
    wins,
    losses,
    draws,
    winRate: wins + losses ? (wins / (wins + losses)) * 100 : null,
    streak: head && length >= STREAK_MIN ? { result: head, length } : null,
  };
}

/** "4-win streak", "3-loss run", "2 draws in a row". */
export function streakLabel(s: { result: Result; length: number }): string {
  if (s.result === 'win') return `${s.length}-win streak`;
  if (s.result === 'loss') return `${s.length}-loss run`;
  return `${s.length} draws in a row`;
}

/** Which page of the log (1-based) holds the battle at `newestIndex`. */
export function pageOf(newestIndex: number, perPage: number): number {
  return Math.floor(Math.max(0, newestIndex) / Math.max(1, perPage)) + 1;
}
