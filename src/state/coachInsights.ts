/**
 * COACH ROSTER — INSIGHTS: factual observations, each traceable to numbers.
 *
 * NO IMPORTS, like `tiers.ts` and `coachRoster.ts`: what a coach is TOLD about
 * a player is the part most worth testing, and it must be testable without a
 * store or a client.
 *
 * THE RULES, and the reason there are floors at all. An insight is a sentence
 * a coach will act on, so each one:
 *
 *   1. is a COUNT or a RATIO of stored battles — never a model output, a
 *      score, or an adjective the data cannot support ("dominant", "weak");
 *   2. carries its evidence (`n`, the figures it compares) so the screen can
 *      show where it came from;
 *   3. appears only above an EVIDENCE FLOOR. A deck played 4 times at 100% is
 *      not "their best deck", and a sentence that says so is a claim the next
 *      four battles will take back. Below a floor the observation is simply
 *      not made — silence is the honest answer to thin data.
 *
 * A comparison is always against the player's OWN rate over the SAME window,
 * never against a population, so "better" means better than they usually do.
 *
 * ── THERE IS A CEILING NOW, AND IT IS AS LOAD-BEARING AS THE FLOORS ────────
 *
 * Measured live on the production roster (2026-09-23): one player's Overview
 * printed THIRTY bullets. A list that long is not read, so the floors were
 * protecting the truth of each sentence while the sheer count destroyed the
 * usefulness of all of them. `MAX_INSIGHTS` caps it at five, chosen by
 * `weight` — evidence times effect size, nudged by how actionable the kind is.
 *
 * ── A DECK IS ITS CARDS, NEVER ITS NAME ────────────────────────────────────
 *
 * `deckName` is GENERATED from archetype plus a key card, and it is NOT
 * unique: measured on one real player, 20 of 49 names covered more than one
 * distinct eight-card list and "Mortar Rascals" alone covered NINE. Keying
 * insights by name therefore produced, live, three bullets naming one deck
 * with opposite verdicts (54.1% "less often", 75.5% and 70.6% "more often") —
 * which reads as a broken screen rather than as three different decks.
 *
 * So `InsightDeck.key` (the sorted card list) is the identity, ids are built
 * from it, and `deckKey` rides along so the screen can look the deck up and draw
 * its strip — with its real art — beside the sentence. Two decks that share a
 * name are then visibly two decks.
 */

export interface InsightTally {
  battles: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface InsightIntel {
  summary: InsightTally;
  form: string[];
  archetypes: (InsightTally & { name: string })[];
  opponentArchetypes: (InsightTally & { name: string })[];
  opponents: (InsightTally & { tag: string; name: string | null })[];
  window: { from: string | null; to: string | null };
}

export interface InsightDeck {
  /** The deck's IDENTITY — its sorted card list. Names collide; this does not. */
  key: string;
  name: string;
  battles: number;
  wins: number;
  /** ISO timestamp of the last battle with it, or null. */
  lastSeen: string | null;
}

export type InsightKind = 'strength' | 'weakness' | 'note';

export interface Insight {
  id: string;
  kind: InsightKind;
  text: string;
  /** The figures behind the sentence, printed beside it. */
  evidence: string;
  /** The deck this is about, by key, so the screen can look it up and draw the
   *  strip WITH ITS ART. Two decks sharing a generated name are then visibly
   *  two decks. Absent when the observation is not about one deck. */
  deckKey?: string;
}

/* The floors. Named so a reader can see what a sentence needed to exist. */
export const FLOORS = {
  /** Battles in the window before anything is said at all. */
  window: 10,
  /** Battles behind an archetype share. */
  archetype: 20,
  /** Battles behind a deck comparison. */
  deck: 15,
  /** Points of difference before a deck is "higher" or "lower". */
  deckGap: 5,
  /** Battles behind a matchup comparison. */
  matchup: 10,
  /** Points of difference before a matchup is called out. */
  matchupGap: 10,
  /** Days without a deck, with history behind it, before it is "unused". */
  staleDays: 14,
} as const;

/** How many survive to the screen. See the ceiling note above. */
export const MAX_INSIGHTS = 5;

/* How much each kind is worth per point of gap per unit of evidence. A
   matchup is what is BEING DONE TO the player and is the most actionable
   thing on the screen; a deck they own is next; context is last. These are
   ordering nudges, not claims about the data. */
const KIND_WEIGHT = {
  matchup: 1.3,
  deck: 1.0,
  form: 0.9,
  stale: 0.5,
  share: 0.35,
} as const;

const pct = (w: number, n: number) => (n ? (w / n) * 100 : 0);
const f1 = (x: number) => `${x.toFixed(1)}%`;
const record = (t: InsightTally) => `${t.wins}W ${t.losses}L${t.draws ? ` ${t.draws}D` : ''}`;

/** Evidence times effect, so a 20-point gap over 12 battles does not outrank a
 *  12-point gap over 300. `sqrt` because the hundredth battle says less about
 *  a rate than the tenth did. */
const weigh = (gap: number, battles: number, k: keyof typeof KIND_WEIGHT) =>
  Math.abs(gap) * Math.sqrt(battles) * KIND_WEIGHT[k];

export function buildInsights(intel: InsightIntel, decks: InsightDeck[]): Insight[] {
  const out: (Insight & { weight: number })[] = [];
  const total = intel.summary;
  if (total.battles < FLOORS.window) return [];
  const overall = pct(total.wins, total.battles);

  // What they play.
  const top = intel.archetypes[0];
  if (top && top.battles >= FLOORS.archetype) {
    const share = pct(top.battles, total.battles);
    out.push({
      id: 'archetype-share',
      kind: 'note',
      text: `${top.name} is their most-played win condition in this window — ${f1(share)} of their battles.`,
      evidence: `${top.battles} of ${total.battles} battles`,
      weight: weigh(share, total.battles, 'share'),
    });
  }

  // Current form, when there is a full ten to speak about.
  if (intel.form.length >= 10) {
    const won = intel.form.slice(0, 10).filter((r) => r === 'win').length;
    out.push({
      id: 'form',
      kind: won * 10 >= overall ? 'strength' : 'weakness',
      text: `Won ${won} of their last 10 battles, against ${f1(overall)} across the window.`,
      evidence: `last 10: ${intel.form.slice(0, 10).map((r) => r[0].toUpperCase()).join('')}`,
      weight: weigh(won * 10 - overall, 10, 'form'),
    });
  }

  // Decks that do better or worse than the player usually does.
  for (const d of decks) {
    if (d.battles < FLOORS.deck) continue;
    const rate = pct(d.wins, d.battles);
    const gap = rate - overall;
    if (Math.abs(gap) < FLOORS.deckGap) continue;
    out.push({
      id: `deck-${d.key}-${gap > 0 ? 'up' : 'down'}`,
      kind: gap > 0 ? 'strength' : 'weakness',
      text:
        gap > 0
          ? `${d.name} wins more often than they do overall: ${f1(rate)} against ${f1(overall)}.`
          : `${d.name} wins less often than they do overall: ${f1(rate)} against ${f1(overall)}.`,
      evidence: `${d.battles} battles with it`,
      deckKey: d.key,
      weight: weigh(gap, d.battles, 'deck'),
    });
  }

  // A deck with real history that has dropped out of use.
  const end = intel.window.to ? Date.parse(`${intel.window.to.slice(0, 10)}T23:59:59Z`) : NaN;
  if (Number.isFinite(end)) {
    for (const d of decks) {
      if (d.battles < FLOORS.deck || !d.lastSeen) continue;
      const days = Math.floor((end - Date.parse(d.lastSeen)) / 86_400_000);
      if (days >= FLOORS.staleDays) {
        out.push({
          id: `deck-${d.key}-stale`,
          kind: 'note',
          text: `${d.name} has not been played in the last ${days} days of stored battles.`,
          evidence: `${d.battles} battles with it; last ${d.lastSeen.slice(0, 10)}`,
          deckKey: d.key,
          weight: weigh(days, d.battles, 'stale'),
        });
      }
    }
  }

  // Matchups: what they struggle or thrive against.
  for (const a of intel.opponentArchetypes) {
    if (a.battles < FLOORS.matchup) continue;
    const rate = pct(a.wins, a.battles);
    const gap = rate - overall;
    if (Math.abs(gap) < FLOORS.matchupGap) continue;
    out.push({
      id: `vs-${a.name}`,
      kind: gap > 0 ? 'strength' : 'weakness',
      text: `Against ${a.name} decks they win ${f1(rate)}, against ${f1(overall)} overall.`,
      evidence: `${a.battles} battles vs ${a.name} · ${record(a)}`,
      weight: weigh(gap, a.battles, 'matchup'),
    });
  }

  /* WHO THEY MET IS NOT AN INSIGHT, and measuring it said so. On the live
     roster eight of one player's thirty bullets were "Has met <stranger> N
     times", and on another the most-met opponent was a DIFFERENT PLAYER ON
     THE SAME ROSTER — an artifact of the coach running practice between their
     own players, not an observation about either of them. The Opponents tab
     is where that ledger belongs, and it has a head-to-head floor already. */

  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_INSIGHTS)
    .map(({ weight: _w, ...i }) => i);
}
