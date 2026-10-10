/**
 * The arithmetic and the labels of "Bring this against them" — the Deck
 * Counter's list of what to play against one player — and of the per-archetype
 * chips Team Analysis draws under every suggested deck.
 *
 * TYPE IMPORTS ONLY, so it is testable without React (the rule `tiers.ts`,
 * `duelFigures.ts` and `squadParse.ts` follow).
 */
import type { BalanceMark, PlaysFamily, TeamRecommendation } from '../state/analyticsClient';

export type BringView = 'best' | 'family' | 'card';

/** The three readings of one rated pool, in the order they are drawn.
 *
 *  SHORT ON PURPOSE. As "Best counters / By their archetype / By counter
 *  card" the strip was wider than the 300px a phone gives this block, and the
 *  third tab sat cut off inside the strip's own scroller — the one reading the
 *  account holder asked for by name, behind a swipe nothing announced. */
export const BRING_VIEWS: { id: BringView; label: string }[] = [
  { id: 'best', label: 'Best' },
  { id: 'family', label: 'By archetype' },
  { id: 'card', label: 'By card' },
];

/** Chips drawn under one deck, at most. Their six most played archetypes: a
 *  seventh is under one game in twenty and would wrap the row on a phone. */
export const MAX_CHIPS = 6;

/** A rate at or above this is drawn as a matchup they lose. The server's own
 *  `team_scout.ANSWERED`. */
export const CHIP_OK = 50;

/** `77%` — a share of 0..1 as a whole percentage, and `<1%` rather than `0%`
 *  for something they do play. */
export function shareLabel(share: number): string {
  const p = share * 100;
  if (p > 0 && p < 1) return '<1%';
  return `${Math.round(p)}%`;
}

/** The tooltip of one family on the "Likely to bring" strip: the history the
 *  chance was read from. `played` is absent from a server before brain 4.0. */
export function playsTitle(
  p: Pick<PlaysFamily, 'games' | 'decks' | 'played' | 'duelGames'>,
): string {
  const bits = [`${p.games} games`, `${p.decks} ${p.decks === 1 ? 'list' : 'lists'}`];
  if (p.played !== undefined && p.played !== null) {
    bits.unshift(`${shareLabel(p.played)} of their games`);
  }
  if (p.duelGames) bits.push(`${p.duelGames} duel ${p.duelGames === 1 ? 'game' : 'games'}`);
  return bits.join(' · ');
}

/** Balance marks drawn on one deck, at most: nerfs first (they are in the
 *  figure), then the newest. */
export const MAX_BALANCE_MARKS = 2;

const BALANCE_GLYPH: Record<BalanceMark['kind'], string> = {
  nerf: '▼',
  buff: '▲',
  rework: '↻',
  new: '★',
};
const BALANCE_WORD: Record<BalanceMark['kind'], string> = {
  nerf: 'Nerfed',
  buff: 'Buffed',
  rework: 'Reworked',
  new: 'New',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `6 Oct` from `2026-10-06`; the string itself when it is not a date. */
export function patchDay(date: string): string {
  const parts = date.split('-');
  if (parts.length !== 3 || parts.some((p) => !p || Number.isNaN(Number(p)))) return date;
  const month = MONTHS[Number(parts[1]) - 1];
  return month ? `${Number(parts[2])} ${month}` : date;
}

export interface BalanceChip {
  card: string;
  kind: BalanceMark['kind'];
  glyph: string;
  /** `Royal Ghost — Nerfed 6 Oct`, with the form when it is not the base card. */
  title: string;
}

/** The marks for one deck's row. `nameOf` turns a card key into its name. */
export function balanceChips(
  deck: Pick<TeamRecommendation, 'balance'>,
  nameOf: (key: string) => string,
): BalanceChip[] {
  const rows = [...(deck.balance ?? [])];
  rows.sort(
    (a, b) =>
      Number(b.kind === 'nerf') - Number(a.kind === 'nerf') || b.date.localeCompare(a.date),
  );
  return rows.slice(0, MAX_BALANCE_MARKS).map((m) => ({
    card: m.card,
    kind: m.kind,
    glyph: BALANCE_GLYPH[m.kind] ?? '•',
    title:
      `${nameOf(m.card)}${m.form === 'base' ? '' : ` (${m.form})`} — ` +
      `${BALANCE_WORD[m.kind] ?? 'Changed'} ${patchDay(m.date)}`,
  }));
}

export interface FamilyChip {
  family: string;
  name: string;
  rate: number;
  /** The deck wins this matchup. */
  ok: boolean;
  /** The deck is the list's best counter to this family. */
  answer: boolean;
}

/**
 * A deck's rate against each archetype they play, in THEIR order of play.
 *
 * A family the deck has no measured rate against is LEFT OUT, never drawn as
 * 50 — the rule the server applies to the headline. `skip` drops one family:
 * on a per-archetype list the big figure already is that family's rate.
 */
export function familyChips(
  deck: Pick<TeamRecommendation, 'vs' | 'answers'>,
  plays: Pick<PlaysFamily, 'family' | 'name'>[],
  skip?: string,
): FamilyChip[] {
  const vs = deck.vs ?? {};
  const out: FamilyChip[] = [];
  for (const p of plays) {
    if (out.length >= MAX_CHIPS) break;
    if (p.family === skip) continue;
    const rate = vs[p.family];
    if (rate === undefined || rate === null) continue;
    out.push({
      family: p.family,
      name: p.name,
      rate,
      ok: rate >= CHIP_OK,
      answer: Boolean(deck.answers?.includes(p.family)),
    });
  }
  return out;
}

/**
 * The `[family, name]` pairs a Team Analysis folder labels its chips with.
 *
 * `plays` since brain 3.0 — what they play, most played first, in BOTH modes.
 * A match plan from an older server has only `squadCover`, which carries the
 * same pairs in the same order; a folder with neither draws no chips.
 */
export function chipLabels(folder: {
  plays?: Pick<PlaysFamily, 'family' | 'name'>[];
  squadCover?: { archetype: string; name: string }[];
}): [string, string][] | undefined {
  if (folder.plays?.length) return folder.plays.slice(0, MAX_CHIPS).map((p) => [p.family, p.name]);
  if (folder.squadCover?.length) return folder.squadCover.map((c) => [c.archetype, c.name]);
  return undefined;
}
