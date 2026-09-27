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

/** The label a duel-chosen row wears, or null when the ladder brain chose it. */
export function duelPickLabel(rec: Pick<TeamRecommendation, 'duelPick'>): string | null {
  return rec.duelPick ? 'Duel pick' : null;
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
