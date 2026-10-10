/**
 * How the duel brain's figures print, on the Team Analysis screen and in its
 * PDF alike — one place, so the two cannot disagree about the same row.
 *
 * Type imports only, so it is testable without React or jsPDF.
 *
 * FIGURES, NEVER SENTENCES: the account holder asked for the explanatory
 * lines to go from this screen (2026-09-21), so a duel figure is a label and a
 * number. What the number is — against an equal opponent, shrunk toward 50/50
 * by 30 games, calibrated on a holdout — lives in `server/duel_brain.py` and
 * the README, not on each of seventy rows.
 */
import type { TeamDuelFigures, TeamRecommendation } from '../state/analyticsClient';

/** The label a duel-chosen row wears, or null when the ladder brain chose it.
 *  Coach Assist's: one of its three options is HELD for a deck proven in duels,
 *  so "pick" is the right word there. */
export function duelPickLabel(rec: Pick<TeamRecommendation, 'duelPick'>): string | null {
  return rec.duelPick ? 'Duel pick' : null;
}

/**
 * `Duel deck` — the label of a list that comes from DUEL play, on Team
 * Analysis and on the Deck Counter's "Bring this against them": a list out of
 * the duel catalogue, or a teammate's own duel deck.
 *
 * Not "pick". Since brain 3.0 nothing is picked by a second brain and held
 * above stronger rows: a duel list is a candidate like any other and is on the
 * list because of its figure. The label says where the list comes from.
 */
export function duelDeckLabel(
  rec: Pick<TeamRecommendation, 'duelPick' | 'origin'>,
): string | null {
  return rec.origin === 'duel' || rec.duelPick ? 'Duel deck' : null;
}

/**
 * `Duel 58.4% · 312` — the duel win rate and the duel games behind it — or
 * null when the row carries no duel figure (too few games is WITHHELD by the
 * server, never sent as 50%).
 */
export function duelChip(d: TeamDuelFigures | null | undefined): string | null {
  if (!d) return null;
  return `Duel ${d.winRate.toFixed(1)}% · ${d.games.toLocaleString('en-US')}`;
}

/** `Duel 58%` — the PDF's one-line option rows have no room for the games. */
export function duelShort(d: TeamDuelFigures | null | undefined): string | null {
  if (!d) return null;
  return `Duel ${Math.round(d.winRate)}%`;
}

/** The hover line: the bound and the record as played. Figures only. */
export function duelTitle(d: TeamDuelFigures | null | undefined): string | undefined {
  if (!d) return undefined;
  return `Duel ${d.winRate.toFixed(1)}% (${d.low.toFixed(1)}–${d.high.toFixed(1)}) · `
    + `${d.games.toLocaleString('en-US')} games · as played ${d.raw.toFixed(1)}%`;
}
