/**
 * COACH ASSIST'S MATCHUP MAP (2026-11-14): their predicted decks and the
 * server's per-deck answers (`coach.answers`) in the shape the map draws.
 *
 * WHAT IS DIFFERENT FROM TEAM ANALYSIS'S MAP: there, the right-hand column is
 * one list of suggested decks and every family of theirs hangs off it. Here a
 * family of theirs is ONE DECK they are likely to bring, and the right-hand
 * column is worked out FOR THAT DECK — the best list of every win condition
 * against it — so centring the map on another of their decks changes the
 * decks on the right ("not some generalised standard decks"). Each of those
 * carries its rate against their OTHER decks too, which is what the chips
 * under it show.
 *
 * TYPE IMPORTS ONLY, so it is testable without React.
 */
import type { CoachAnswerDeck, CoachAnswers, CoachDeck } from '../state/analyticsClient';
import type { FlowDeck, FlowFamily, FlowThreat } from './matchupFlow';

/** Where a deck on the right comes from, in words (title text, and the pill). */
export const ORIGIN_WORD: Record<string, string> = {
  yours: 'Your duel deck',
  option: 'On your list',
  crl: 'CRL duel list',
  top: 'Top 1k list',
  duel: 'Duel list',
  meta: 'Meta list',
  ladder: 'Meta list',
};

/** The short pill. */
export const ORIGIN_PILL: Record<string, string> = {
  yours: 'Yours',
  option: 'Yours',
  crl: 'CRL duel',
  top: 'Top 1k',
  duel: 'Duel',
};

/** Their decks as the request sends them: cards and the chance of each. The
 *  share of the decks listed (`prob`), which is what every figure on this
 *  screen weighs them by; the read's own `p` when there is no share. */
export function answerInputs(decks: CoachDeck[]): { cards: string[]; weight: number }[] {
  return decks
    .filter((d) => d.cards.length === 8)
    .slice(0, 8)
    .map((d) => ({ cards: d.cards, weight: d.prob ?? d.p ?? 0 }));
}

/** The cache key of one request: same decks, player, spent cards, options and
 *  window = the same answer. */
export function answersKey(
  decks: { cards: string[]; weight: number }[],
  me: string,
  myPlayed: string[][],
  keep: string[][],
  days: number,
): string {
  const deck = (c: string[]) => [...c].sort().join(',');
  return [
    decks.map((d) => `${deck(d.cards)}@${d.weight.toFixed(3)}`).join('|'),
    me,
    myPlayed.map(deck).join('|'),
    keep.map(deck).join('|'),
    days,
  ].join('#');
}

/** Order-free deck identity: the server's `_deck_key`. */
export function deckKeyOf(cards: string[]): string {
  return [...new Set(cards)].sort().join(',');
}

export interface CoachMapSide {
  plays: FlowFamily[];
  threats: FlowThreat[];
  /** Their deck keys in the server's order — the positions of every `vsAt`. */
  keys: string[];
  /** The screen's deck behind each key (its count, whether it is a meta fill). */
  source: Map<string, CoachDeck>;
}

/** Their decks as the map's left column: each deck its own "family", with its
 *  chance from the server (normalised over what was sent). `labels` are the
 *  decks' names, already told apart where two share one. */
export function theirSide(decks: CoachDeck[], ans: CoachAnswers, labels: string[]): CoachMapSide {
  const plays: FlowFamily[] = [];
  const threats: FlowThreat[] = [];
  const keys: string[] = [];
  const source = new Map<string, CoachDeck>();
  for (const t of ans.their) {
    const d = decks[t.at];
    keys.push(t.key);
    if (!d) continue;
    const name = labels[t.at] || d.deckName || d.archetype;
    source.set(t.key, d);
    plays.push({ family: t.key, name, share: t.likelihood, games: d.count ?? 0, decks: 1 });
    threats.push({
      key: t.key,
      cards: d.cards,
      art: d.art,
      artInferred: d.inferredArt,
      archetype: d.archetype,
      name,
      likelihood: t.likelihood,
      observedCount: d.count ?? 0,
      family: t.key,
    });
  }
  return { plays, threats, keys, source };
}

export type CoachFlowDeck = FlowDeck & {
  key: string;
  origin: CoachAnswerDeck['origin'];
  familyName: string;
  keep?: boolean;
  count?: number;
};

/** One answer row as the map's deck: its rates keyed by their deck. */
export function toFlowDeck(row: CoachAnswerDeck, keys: string[]): CoachFlowDeck {
  const vs: Record<string, number> = {};
  const vsLists: Record<string, [number, string | null, number]> = {};
  keys.forEach((k, i) => {
    const v = row.vsAt[i];
    if (v) {
      vs[k] = v[0];
      vsLists[k] = v;
    }
  });
  return {
    key: row.key,
    cards: row.cards,
    art: row.art,
    artInferred: row.artInferred,
    artFilled: row.artFilled,
    name: row.name,
    expectedWinRate: row.expectedWinRate,
    vs,
    vsLists,
    origin: row.origin,
    familyName: row.familyName,
    keep: row.keep,
    count: row.count,
  };
}

/** The right-hand column for ONE deck of theirs: the best list of each win
 *  condition against it, best first — plus `extra` (a deck the map was opened
 *  on) wherever it is not already, AT ITS OWN PLACE by its rate against that
 *  deck (appended at the end it read "#23", a rank it holds at nothing). */
export function decksFor(ans: CoachAnswers, keys: string[], theirKey: string, extra?: string): CoachFlowDeck[] {
  const i = keys.indexOf(theirKey);
  const idx = i >= 0 ? ans.answers[i] ?? [] : [];
  const out = idx.map((j) => ans.decks[j]).filter(Boolean).map((r) => toFlowDeck(r, keys));
  if (extra && !out.some((d) => d.key === extra)) {
    const row = ans.decks.find((r) => r.key === extra);
    if (row) {
      const d = toFlowDeck(row, keys);
      const rate = d.vs?.[theirKey];
      const at = rate === undefined ? -1 : out.findIndex((o) => (o.vs?.[theirKey] ?? -Infinity) < rate);
      out.splice(at < 0 ? out.length : at, 0, d);
    }
  }
  return out;
}

/** The deck of theirs whose answers fill the column when the map opens on one
 *  of OUR decks: the one it plays worst against, so the column shows what else
 *  answers that deck; the most likely when it has no rate. */
export function columnFor(ans: CoachAnswers, keys: string[], ourKey: string): string | null {
  const row = ans.decks.find((r) => r.key === ourKey);
  if (!row) return keys[0] ?? null;
  let worst: string | null = null;
  let low = Infinity;
  keys.forEach((k, i) => {
    const v = row.vsAt[i];
    if (v && v[0] < low) {
      low = v[0];
      worst = k;
    }
  });
  return worst ?? keys[0] ?? null;
}

/** A deck's rates against their decks OTHER than `focus`, in their order. */
export function otherRates(
  deck: FlowDeck,
  keys: string[],
  focus: string | null,
): { key: string; rate: number }[] {
  return keys
    .filter((k) => k !== focus && deck.vs?.[k] !== undefined)
    .map((k) => ({ key: k, rate: deck.vs![k] }));
}

/** The win-condition card a chip shows for one of their decks: the priciest
 *  win condition, else the priciest card (`clash_data.deck_title`'s rule). */
export function winConCard(
  cards: string[],
  info: (key: string) => { elixir: number; isWinCondition: boolean } | undefined,
): string | null {
  let best: { key: string; win: boolean; elixir: number } | null = null;
  for (const c of cards) {
    const i = info(c);
    if (!i) continue;
    const cand = { key: c, win: i.isWinCondition, elixir: i.elixir };
    if (
      !best ||
      (cand.win && !best.win) ||
      (cand.win === best.win && (cand.elixir > best.elixir || (cand.elixir === best.elixir && c < best.key)))
    ) {
      best = cand;
    }
  }
  return best?.key ?? null;
}
