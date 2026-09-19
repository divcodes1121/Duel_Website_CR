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
  /** Meetings before an opponent is "repeat". */
  opponent: 3,
  /** Days without a deck, with history behind it, before it is "unused". */
  staleDays: 14,
} as const;

const pct = (w: number, n: number) => (n ? (w / n) * 100 : 0);
const f1 = (x: number) => `${x.toFixed(1)}%`;
const record = (t: InsightTally) =>
  `${t.wins}W ${t.losses}L${t.draws ? ` ${t.draws}D` : ''}`;

export function buildInsights(intel: InsightIntel, decks: InsightDeck[]): Insight[] {
  const out: Insight[] = [];
  const total = intel.summary;
  if (total.battles < FLOORS.window) return out;
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
    });
  }

  // Decks that do better or worse than the player usually does.
  for (const d of decks) {
    if (d.battles < FLOORS.deck) continue;
    const rate = pct(d.wins, d.battles);
    const gap = rate - overall;
    if (Math.abs(gap) < FLOORS.deckGap) continue;
    out.push({
      id: `deck-${d.name}-${gap > 0 ? 'up' : 'down'}`,
      kind: gap > 0 ? 'strength' : 'weakness',
      text:
        gap > 0
          ? `${d.name} wins more often than they do overall: ${f1(rate)} against ${f1(overall)}.`
          : `${d.name} wins less often than they do overall: ${f1(rate)} against ${f1(overall)}.`,
      evidence: `${d.battles} battles with it`,
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
          id: `deck-${d.name}-stale`,
          kind: 'note',
          text: `${d.name} has not been played in the last ${days} days of stored battles.`,
          evidence: `${d.battles} battles with it; last ${d.lastSeen.slice(0, 10)}`,
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
    });
  }

  // People they keep meeting.
  for (const o of intel.opponents) {
    if (o.battles < FLOORS.opponent) break; // most-met first, so the rest are fewer
    out.push({
      id: `opp-${o.tag}`,
      kind: 'note',
      text: `Has met ${o.name ? `${o.name} (${o.tag})` : o.tag} ${o.battles} times in this window.`,
      evidence: record(o),
    });
  }

  return out;
}
