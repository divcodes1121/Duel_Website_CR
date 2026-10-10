/**
 * The arithmetic and the labels of "Bring this against them" — the Deck
 * Counter's list of what to play against one player — and of the per-archetype
 * chips Team Analysis draws under every suggested deck.
 *
 * TYPE IMPORTS ONLY, so it is testable without React (the rule `tiers.ts`,
 * `duelFigures.ts` and `squadParse.ts` follow).
 */
import type { PlaysFamily, TeamRecommendation } from '../state/analyticsClient';

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
