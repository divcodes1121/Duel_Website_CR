/* WHO WON EACH FINISHED GAME, as the Coach Assist route takes it (`res=`).
 *
 * No imports, so it is testable on its own.
 *
 * ONLY GAME 1 IS EVER ASKED. A duel is the first to two of three, so one that
 * is still being played after two games is 1-1: game 2 went the other way from
 * game 1, and asking would be asking for something already known. The answer
 * is from the side of the player being coached — 'w' they won it, 'l' they
 * lost it — and `null` is "not told", which the server weighs as both.
 */

export type GameResult = 'w' | 'l';

/** `''`, `'w'`, `'l'`, `'wl'` or `'lw'` for `games` finished games. */
export function duelResults(wonGame1: GameResult | null, games: number): string {
  if (!wonGame1 || games < 1) return '';
  if (games === 1) return wonGame1;
  return wonGame1 + (wonGame1 === 'w' ? 'l' : 'w');
}

/** `[mine, theirs]` as "1–0"; an en dash, the way a score is written. */
export function scoreLabel(score: readonly [number, number] | null | undefined): string {
  return score ? `${score[0]}–${score[1]}` : '';
}
