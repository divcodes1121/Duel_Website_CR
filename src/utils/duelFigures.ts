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
  // Brain 5.0 (2026-10-14): every pool list is one the CRL group brought to
  // duels in the window or one of the window's most played lists, and the
  // pill says which — the words Coach Assist's counters already use.
  // 6.1 (2026-10-23): lists the live top 1,000 ranked players use.
  if (rec.origin === 'top') return 'Top 1k list';
  if (rec.origin === 'crl') return 'CRL duel list';
  if (rec.origin === 'meta') return 'Meta list';
  return rec.origin === 'duel' || rec.duelPick ? 'Duel deck' : null;
}

/**
 * The tooltip of a `CRL duel list` pill: what the group did with the list in
 * the window — `Brought to 12 duel games by 3 CRL players · 8 won`. Undefined
 * on a row that carries no such record.
 */
export function crlTitle(rec: Pick<TeamRecommendation, 'crl'>): string | undefined {
  const c = rec.crl;
  if (!c || !c.games) return undefined;
  const players = `${c.pilots} CRL player${c.pilots === 1 ? '' : 's'}`;
  return `Brought to ${c.games.toLocaleString('en-US')} duel game${c.games === 1 ? '' : 's'} by ${players} · ${c.wins} won`;
}

/**
 * `Used by 32 of the top 1,000 players · 1,222 ranked games · 52% won` — or
 * undefined on a row the top 1,000 did not use (6.1).
 */
export function topTitle(rec: Pick<TeamRecommendation, 'top'>): string | undefined {
  const t = rec.top;
  if (!t || !t.games) return undefined;
  const won = Math.round((100 * t.wins) / t.games);
  return (
    `Used by ${t.players.toLocaleString('en-US')} of the top 1,000 players · ` +
    `${t.games.toLocaleString('en-US')} ranked game${t.games === 1 ? '' : 's'} · ${won}% won`
  );
}

/**
 * 7.1: `Played in 212 duel games by 18 players in the window · 57% won` — a
 * list from the window's duels (clan-war and friendly, anybody's). Undefined
 * on a row that carries no such record.
 */
export function duelListTitle(rec: Pick<TeamRecommendation, 'duelList'>): string | undefined {
  const d = rec.duelList;
  if (!d || !d.games) return undefined;
  const won = Math.round((100 * d.wins) / d.games);
  return (
    `Played in ${d.games.toLocaleString('en-US')} duel game${d.games === 1 ? '' : 's'} ` +
    `by ${d.pilots.toLocaleString('en-US')} players in the window · ${won}% won`
  );
}

/** The pill's tooltip: the top players' use, the CRL group's, the window's duels. */
export function originTitle(
  rec: Pick<TeamRecommendation, 'top' | 'crl' | 'duelList'>,
): string | undefined {
  const parts = [topTitle(rec), crlTitle(rec), duelListTitle(rec)].filter(Boolean);
  return parts.length ? parts.join('\n') : undefined;
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
