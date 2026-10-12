/**
 * How a player plays, on Coach Assist: the few words of the win-condition
 * profile, in one place so the screen and the PDF say the same thing.
 * No imports.
 *
 * The server sends, for each player, every win condition they fielded in their
 * own window with its share of their games and their win rate with it, and a
 * tag from their duel record with it (`server/coach.py` `_win_con_profile`,
 * `server/player_skill.py`, 2026-10-12). Figures and one-word tags only.
 */

export type WinConUse = 'main' | 'regular' | 'rare';
export type WinConTag = 'strong' | 'even' | 'weak' | null | undefined;

export interface WinConFigures {
  name: string;
  games: number;
  wins: number;
  share: number;
  winRate: number;
  decks: number;
  duelGames: number;
  use: WinConUse;
  skill: { games: number; wins: number; expected: number; perGame: number; tag: WinConTag } | null;
}

/** A row's own win condition as the coached player plays it. */
export interface RowWinCon {
  name: string;
  share?: number;
  winRate?: number;
  games?: number;
  use?: WinConUse;
  tag?: WinConTag;
  new?: boolean;
}

const pct = (share: number) => `${Math.round(share * 100)}%`;

/** How much of their play a win condition is, as a word. */
export function useLabel(use: WinConUse): string {
  return use === 'main' ? 'Main' : use === 'regular' ? 'Regular' : 'Rare';
}

/** The tag a duel record earns: only the two that say something.
 *
 *  NOT "Strong" / "Weak". The tag is their record with the win condition
 *  against what each of those duel games should have gone, so a very good
 *  player can be UNDER it at 67% won — staged, a profile read "66.7% won" beside
 *  a tag that would have said Weak. The words say what was measured. */
export function skillLabel(tag: WinConTag): string | null {
  return tag === 'strong' ? 'Above expected' : tag === 'weak' ? 'Below expected' : null;
}

/** `68% of games · 60.0% won` */
export function winConLine(w: Pick<WinConFigures, 'share' | 'winRate'>): string {
  return `${pct(w.share)} of games · ${w.winRate.toFixed(1)}% won`;
}

/** The tooltip: the counts behind the two figures, and the duel record the
 *  tag comes from when there is one. */
export function winConTitle(w: WinConFigures): string {
  const parts = [
    `${w.wins} won of ${w.games} games`,
    `${w.decks} ${w.decks === 1 ? 'deck' : 'decks'}`,
  ];
  if (w.skill)
    parts.push(`duels: ${w.skill.wins} won of ${w.skill.games}, ${w.skill.expected.toFixed(1)} expected`);
  return parts.join(' · ');
}

/** The heading's note for one player: `88 games · 53.4% won`. */
export function profileNote(p: { games: number; winRate: number }): string {
  return `${p.games.toLocaleString('en-US')} games · ${p.winRate.toFixed(1)}% won`;
}

/** What a deck row says about its own win condition for the coached player:
 *  `your Hog Rider · 60.0% won · 68% of games · above expected`, or
 *  `Mortar: new for you`. */
export function rowWinCon(w: RowWinCon | null | undefined): string {
  if (!w) return '';
  if (w.new || w.winRate === undefined || w.share === undefined) return `${w.name}: new for you`;
  const tag = skillLabel(w.tag);
  return [`your ${w.name}`, `${w.winRate.toFixed(1)}% won`, `${pct(w.share)} of games`, tag ? tag.toLowerCase() : '']
    .filter(Boolean)
    .join(' · ');
}
