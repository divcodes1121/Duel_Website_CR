/**
 * The Top Meta Decks movement badges, from `/api/analytics/meta?movement=7`
 * (`server/meta_history.py`). NO IMPORTS.
 *
 * The server already refuses the four ways a trend lies, and this keeps its
 * word on screen:
 *
 *   * NO BASELINE IS NOT ZERO MOVEMENT. Until a week of daily snapshots exists
 *     the answer is `basis: "none"` with no rows, and the board says that in
 *     words instead of drawing a row of "—".
 *   * A DECK THAT WAS NOT ON THE BOARD DID NOT CLIMB. It is NEW, never "▲ 39
 *     from 51"; 51 is where the board stopped, not where the deck was.
 *   * A DECK THAT LEFT DID NOT FALL TO ZERO. It is listed as having left.
 *   * THE SPAN IS THE ONE USED. The note quotes `comparedWith` and `latest`,
 *     the snapshots actually compared, not the seven days that were asked for.
 */

export interface MovementRow {
  deckHash: string;
  name: string;
  rank: number | null;
  previousRank: number | null;
  rankDelta: number | null;
  entered: boolean;
  left: boolean;
}

export interface Movement {
  basis: 'measured' | 'none';
  reason: string | null;
  snapshots: number;
  latest: string | null;
  comparedWith: string | null;
  daysApart: number | null;
  requestedDays: number;
  rows: MovementRow[];
}

export type Badge =
  | { kind: 'up'; text: string; title: string }
  | { kind: 'down'; text: string; title: string }
  | { kind: 'new'; text: string; title: string }
  | null;

/** The badge for one deck; null when it did not move (or is not known). */
export function badgeOf(row: MovementRow | undefined, m: Movement | null): Badge {
  if (!row || !m || m.basis !== 'measured') return null;
  const since = m.comparedWith ? ` since ${m.comparedWith}` : '';
  if (row.entered) return { kind: 'new', text: 'NEW', title: `Entered the top 50${since}` };
  const d = row.rankDelta;
  if (d === null || d === 0) return null;
  return d > 0
    ? { kind: 'up', text: `▲${d}`, title: `Up ${d} place${d === 1 ? '' : 's'}${since} (was #${row.previousRank})` }
    : { kind: 'down', text: `▼${-d}`, title: `Down ${-d} place${d === -1 ? '' : 's'}${since} (was #${row.previousRank})` };
}

/** Rows by deck, for the board to look its own rows up in. */
export function byDeck(m: Movement | null): Map<string, MovementRow> {
  return new Map((m?.rows ?? []).filter((r) => !r.left).map((r) => [r.deckHash, r]));
}

/** The decks that left the board, best-placed first. */
export function leftTheBoard(m: Movement | null, limit = 5): MovementRow[] {
  if (!m || m.basis !== 'measured') return [];
  return m.rows
    .filter((r) => r.left)
    .sort((a, b) => (a.previousRank ?? 99) - (b.previousRank ?? 99))
    .slice(0, limit);
}

/** The one line under the board's title. */
export function movementNote(m: Movement | null): string | null {
  if (!m) return null;
  if (m.basis === 'measured') {
    return `Movement: ${m.comparedWith} to ${m.latest}${m.daysApart ? ` (${m.daysApart} days)` : ''}.`;
  }
  return `Movement shows once a week of history is stored — ${m.snapshots} of ${m.requestedDays} days so far.`;
}
