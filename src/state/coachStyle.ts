/**
 * HOW A DECK IS BUILT AGAINST HOW A PLAYER BUILDS — the two lines the coach's
 * "Every way to answer this field" board prints about it.
 *
 * NO IMPORTS, the `tiers.ts` rule: these strings are what a coach reads about
 * a player, so they are testable without a component or a client. The types
 * are structural copies of `analyticsClient.DeckStyleFit` / `PlayStyle`.
 *
 * FIGURES ONLY. The server's `score` orders the rows and is never printed;
 * what is printed is what a reader can check on the card strip beside it.
 */

export interface StyleFitInput {
  spells: [number, number];
  support: [number, number];
  building: 'yours' | 'none' | 'other';
}

export interface StyleRowInput {
  style?: StyleFitInput;
  affinity?: {
    shared: number;
    of: number;
    known: number;
    familiar: boolean;
    knowsCards: boolean;
    deckBattles?: number;
  };
  closestOfFamily?: boolean;
}

/** The older line: how many cards it shares with what they play. Still what a
 *  row says when the server sent no style read (no profile, an older server). */
export function sharedLine(p: StyleRowInput): string | null {
  const a = p.affinity;
  if (!a) return null;
  const bits: string[] = [];
  if (a.familiar) bits.push(`${a.shared}/${a.of} of one deck`);
  else if (a.knowsCards) bits.push(`${a.known}/${a.of} your cards`);
  else return null;
  if (a.familiar && a.deckBattles) bits.push(`${a.deckBattles} games`);
  return p.closestOfFamily ? `Closest yours · ${bits.join(' · ')}` : bits.join(' · ');
}

/** `spells 2/2 · support 3/4 · same building` — of this list's spells and
 *  support cards, how many they play, and whether the building slot is
 *  theirs. A building they do not run is not mentioned: it is not a fact
 *  about them. */
export function styleLine(p: StyleRowInput): string | null {
  const s = p.style;
  if (!s) return sharedLine(p);
  const bits: string[] = [];
  const a = p.affinity;
  if (a?.familiar) bits.push(`${a.shared}/${a.of} of one deck`);
  if (s.spells[1] > 0) bits.push(`spells ${s.spells[0]}/${s.spells[1]}`);
  if (s.support[1] > 0) bits.push(`support ${s.support[0]}/${s.support[1]}`);
  if (s.building === 'yours') bits.push('same building');
  else if (s.building === 'none') bits.push('no building');
  return bits.length ? bits.join(' · ') : null;
}

export interface PlayStyleInput {
  elixir: number | null;
  noBuilding: number;
  packages: { names: string[]; share: number }[];
}

/** A package under this share of their battles is an experiment, not a habit. */
export const PACKAGE_MIN_SHARE = 0.05;

/** `Their spells · Barbarian Barrel + Poison 49% · … · 3.2 elixir · building
 *  in 85%`. Null when there is nothing to say. */
export function packageLine(style: PlayStyleInput | null | undefined, self: boolean): string | null {
  if (!style) return null;
  const packs = style.packages
    .filter((p) => p.share >= PACKAGE_MIN_SHARE)
    .map((p) => `${p.names.length ? p.names.join(' + ') : 'no spell'} ${Math.round(p.share * 100)}%`);
  if (packs.length === 0) return null;
  const bits = [`${self ? 'Your' : 'Their'} spells · ${packs.join(' · ')}`];
  if (style.elixir != null) bits.push(`${style.elixir.toFixed(1)} elixir`);
  bits.push(`building in ${Math.round((1 - style.noBuilding) * 100)}%`);
  return bits.join(' · ');
}
