/**
 * THE MATCHUP MAP — the arithmetic behind the chain drawn from one of their
 * decks to the decks that answer it, or from one suggested deck to everything
 * they play (2026-11-10).
 *
 * HOW A FIGURE ON THE MAP IS MADE, which is the whole point of drawing it:
 *
 *   their list      one deck they really played, with the chance they bring it
 *                   (`threats[].likelihood`, the whole array sums to 1)
 *   list rate       the suggested deck's rate against that one list
 *                   (`vsLists[key][0]`), off a rung of the evidence ladder:
 *                   these two exact lists, this list's version, this exact
 *                   list, lists one card different, two, the archetype
 *   family rate     the likelihood-weighted mean of the list rates of one of
 *                   their families — the `vs` chip ("Drill 64%")
 *   headline        every family's rate weighted by the chance they bring it
 *
 * TYPE IMPORTS ONLY, so it is testable without React.
 */
import type { PlaysFamily, TeamRecommendation, TeamThreat } from '../state/analyticsClient';

/* WHAT THE MAP READS, and nothing more (2026-11-14): Team Analysis and the
   Deck Counter hand it their own rows; Coach Assist builds these from its
   predicted decks and `coach.answers` (`utils/coachFlow.ts`). */
export type FlowFamily = Pick<PlaysFamily, 'family' | 'name' | 'share' | 'games' | 'decks'>;
export type FlowThreat = Pick<
  TeamThreat,
  'key' | 'cards' | 'art' | 'artInferred' | 'archetype' | 'name' | 'likelihood' | 'observedCount' | 'family'
>;
export type FlowDeck = Pick<
  TeamRecommendation,
  'key' | 'cards' | 'art' | 'artInferred' | 'artFilled' | 'name' | 'expectedWinRate' | 'vs' | 'vsLists' | 'vsAt'
>;

/** What the map is centred on: one of their families, or one of our decks. */
export type FlowFocus = { side: 'their'; id: string } | { side: 'ours'; id: string };

/** A rate at or above this is a matchup won comfortably. The server's own
 *  `team_scout.GOOD_RATE`; 50 is `ANSWERED`. */
export const FLOW_STRONG = 55;
export const FLOW_EVEN = 50;

export type FlowTone = 'win' | 'even' | 'lose';

export function flowTone(rate: number): FlowTone {
  if (rate >= FLOW_STRONG) return 'win';
  if (rate >= FLOW_EVEN) return 'even';
  return 'lose';
}

/** The rung of the evidence ladder a rate came off, in words. The keys are
 *  `deck_counter.SOURCE_*` and `matchup_fusion`'s `version`, verbatim. */
export const SOURCE_WORD: Record<string, string> = {
  exact: 'These two exact lists',
  version: 'Lists within 1 card',
  deck: 'Your list vs their archetype',
  cluster7: '1 card different',
  cluster6: '2 cards different',
  archetype: 'Archetype average',
};

/** Strongest rung first — the order `team_scout.SOURCE_STRENGTH` grades them. */
export const SOURCE_ORDER = ['exact', 'version', 'deck', 'cluster7', 'cluster6', 'archetype'];

export function sourceWord(source: string | null | undefined): string {
  return (source && SOURCE_WORD[source]) || 'Measured';
}

/** One of their lists inside a family, as a link reads it. */
export interface FlowList {
  key: string;
  name: string;
  cards: string[];
  art: TeamThreat['art'];
  artInferred?: boolean;
  /** Its share of the FAMILY's chance, 0..1. */
  within: number;
  games: number;
  /** The suggested deck's rate against it, and where that came from. Null
   *  when the server sent no per-list rates (before 2026-11-10). */
  rate: number | null;
  source: string | null;
  evidence: number;
}

export interface TheirNode {
  family: string;
  name: string;
  /** The chance they bring it, 0..1. */
  share: number;
  games: number;
  decks: number;
  /** Their lists of it, most likely first. Empty without `threats`. */
  lists: FlowList[];
}

export interface OurNode {
  id: string;
  rank: number;
  deck: FlowDeck;
}

/** One deck of ours against one family of theirs. */
export interface FlowLink {
  family: string;
  deckId: string;
  rate: number;
  tone: FlowTone;
  /** The rung behind most of the family's chance, and the games behind all
   *  of it. Null / 0 without `vsLists`. */
  source: string | null;
  games: number;
  /** The family's lists, each with this deck's rate against it. */
  lists: FlowList[];
}

export function deckId(d: Pick<TeamRecommendation, 'key' | 'cards'>): string {
  return d.key ?? d.cards.join(',');
}

/** The rung carrying the most of a family's chance; the stronger rung on a tie. */
export function dominantSource(lists: Pick<FlowList, 'within' | 'source' | 'rate'>[]): string | null {
  const mass = new Map<string, number>();
  for (const l of lists) {
    if (l.rate === null || !l.source) continue;
    mass.set(l.source, (mass.get(l.source) ?? 0) + l.within);
  }
  let best: string | null = null;
  let bestMass = -1;
  for (const s of [...SOURCE_ORDER, ...mass.keys()]) {
    const m = mass.get(s);
    if (m !== undefined && m > bestMass + 1e-9) {
      best = s;
      bestMass = m;
    }
  }
  return best;
}

export interface FlowModel {
  their: TheirNode[];
  ours: OurNode[];
  /** Decks left out by `limit`, to say so and offer them. */
  hidden: number;
  /** Null when the deck has no measured rate against that family — never 50. */
  link(family: string, id: string): FlowLink | null;
}

/** Families drawn on the left, at most — the chips' own limit. */
export const FLOW_MAX_FAMILIES = 10;

/** Decks drawn on the right before "Show all": a teammate's list in a match
 *  plan runs to 24-29, and the Deck Counter's is ten. */
export const FLOW_MAX_DECKS = 10;

export function buildFlow(
  plays: FlowFamily[],
  threats: FlowThreat[] | undefined,
  decks: FlowDeck[],
  /** Draw the first `limit` decks, plus `keep` wherever it sits in the list
   *  (the deck the map was opened on). Ranks stay the list's own. */
  opts: { limit?: number; keep?: string } = {},
): FlowModel {
  const byFamily = new Map<string, FlowThreat[]>();
  /* A Team Analysis row carries its rates by position in `threats` (`vsAt`),
     the Deck Counter's keyed by list (`vsLists`). */
  const position = new Map((threats ?? []).map((t, i) => [t.key, i]));
  for (const t of threats ?? []) {
    const f = t.family ?? t.archetype;
    if (!f) continue;
    const list = byFamily.get(f) ?? [];
    list.push(t);
    byFamily.set(f, list);
  }

  const their: TheirNode[] = plays.slice(0, FLOW_MAX_FAMILIES).map((p) => {
    const ts = [...(byFamily.get(p.family) ?? [])].sort(
      (a, b) => b.likelihood - a.likelihood || a.key.localeCompare(b.key),
    );
    const total = ts.reduce((n, t) => n + t.likelihood, 0);
    return {
      family: p.family,
      name: p.name,
      share: p.share,
      games: p.games,
      decks: p.decks,
      lists: ts.map((t) => ({
        key: t.key,
        name: t.name,
        cards: t.cards,
        art: t.art,
        artInferred: t.artInferred,
        within: total > 0 ? t.likelihood / total : 1 / ts.length,
        games: t.observedCount,
        rate: null,
        source: null,
        evidence: 0,
      })),
    };
  });

  const all: OurNode[] = decks.map((d, i) => ({ id: deckId(d), rank: i + 1, deck: d }));
  const limit = opts.limit ?? Infinity;
  const ours = all.filter((o, i) => i < limit || o.id === opts.keep);
  const deckById = new Map(ours.map((o) => [o.id, o.deck]));
  const nodeByFamily = new Map(their.map((n) => [n.family, n]));
  const memo = new Map<string, FlowLink | null>();

  function link(family: string, id: string): FlowLink | null {
    const k = `${family}\u0000${id}`;
    if (memo.has(k)) return memo.get(k) ?? null;
    const deck = deckById.get(id);
    const node = nodeByFamily.get(family);
    const rate = deck?.vs?.[family];
    let out: FlowLink | null = null;
    if (deck && node && rate !== undefined && rate !== null) {
      const lists = node.lists.map((l) => {
        const at = position.get(l.key);
        const v = deck.vsLists?.[l.key] ?? (at === undefined ? null : deck.vsAt?.[at] ?? null);
        return v ? { ...l, rate: v[0], source: v[1], evidence: v[2] } : { ...l };
      });
      out = {
        family,
        deckId: id,
        rate,
        tone: flowTone(rate),
        source: dominantSource(lists),
        games: lists.reduce((n, l) => n + (l.rate === null ? 0 : l.evidence), 0),
        lists,
      };
    }
    memo.set(k, out);
    return out;
  }

  return { their, ours, hidden: all.length - ours.length, link };
}

/** The links the map draws for a focus, in the order of the OTHER column —
 *  so a matchup node sits on the row of the deck it leads to. */
export function chainFor(model: FlowModel, focus: FlowFocus): FlowLink[] {
  if (focus.side === 'their') {
    return model.ours
      .map((o) => model.link(focus.id, o.id))
      .filter((l): l is FlowLink => l !== null);
  }
  return model.their
    .map((t) => model.link(t.family, focus.id))
    .filter((l): l is FlowLink => l !== null);
}

/** The link to open first: the best answer to one of their decks, or — for a
 *  deck of ours — the matchup against what they bring most. */
export function firstLink(model: FlowModel, focus: FlowFocus): FlowLink | null {
  const chain = chainFor(model, focus);
  if (chain.length === 0) return null;
  if (focus.side === 'their') {
    return chain.reduce((a, b) => (b.rate > a.rate ? b : a));
  }
  return chain[0];
}

/** A focus that still exists in this model, else the most likely family. */
export function validFocus(model: FlowModel, focus: FlowFocus | null): FlowFocus | null {
  if (focus?.side === 'their' && model.their.some((t) => t.family === focus.id)) return focus;
  if (focus?.side === 'ours' && model.ours.some((o) => o.id === focus.id)) return focus;
  if (model.their[0]) return { side: 'their', id: model.their[0].family };
  if (model.ours[0]) return { side: 'ours', id: model.ours[0].id };
  return null;
}

/**
 * A wire between two ports: a horizontal S-curve (`dir: 'h'`, the wide map)
 * or one that leaves downwards and arrives from the left (`'v'`, a phone).
 */
export function wirePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dir: 'h' | 'v' = 'h',
): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  if (dir === 'v') {
    const dy = Math.max(24, (y2 - y1) * 0.55);
    return `M${r(x1)},${r(y1)} C${r(x1)},${r(y1 + dy)} ${r(x2 - 28)},${r(y2)} ${r(x2)},${r(y2)}`;
  }
  const dx = Math.max(28, Math.abs(x2 - x1) * 0.5);
  return `M${r(x1)},${r(y1)} C${r(x1 + dx)},${r(y1)} ${r(x2 - dx)},${r(y2)} ${r(x2)},${r(y2)}`;
}
