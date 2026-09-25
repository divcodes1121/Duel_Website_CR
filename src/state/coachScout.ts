/**
 * COACH ROSTER — THE OPPONENT SCOUT: the pure half.
 *
 * NO SUPABASE, NO REACT, NO CLIENT, the split the roster and the arsenal
 * already make. Everything here is a reading of payloads the screen already
 * has, and every one of those readings is a claim about a person the coach is
 * about to prepare against — so they are the part worth pinning with tests.
 *
 * A SCOUT READS; IT STORES NOTHING. There is no scout table and no migration
 * for this phase: what a coach learns about an opponent belongs to the match
 * plan they write next (phase 6), not to a cache of other people's habits.
 *
 * TWO FOOTINGS, NEVER BLURRED. A scouted opponent is usually NOT on the
 * roster, so the evidence is one of two very different things:
 *
 *   STORED   the collector has their history — the same own-deck 1v1 counting
 *            every other Coach Roster figure uses, over the chosen window.
 *   LIVE     nobody has ever collected them, so all that exists is the ~25
 *            battles the game's own API will hand back right now.
 *
 * A live scout is a snapshot of this week, not a record, and the screen has to
 * say so. `scoutBasis` is what decides which sentence is shown; it is never
 * inferred from whether a list happens to be empty.
 */

import type { CoachIntel, CoachTally, LiveDeck, PlayerReport } from './analyticsClient';
import { isLiveReport } from './analyticsClient';

export type ScoutBasis = 'stored' | 'live' | 'none';

/** One deck a scouted opponent is known to play, from either footing. */
export interface ScoutDeck {
  key: string;
  cards: string[];
  art?: Record<string, 'evolution' | 'hero'>;
  artInferred?: boolean;
  name: string;
  archetype: string | null;
  battles: number;
  wins: number;
  /** Battle-log format (`20260907T161011.000Z`) or an ISO date, or null. */
  last: string | null;
  /** Which footing this deck came from, printed beside it. */
  basis: Exclude<ScoutBasis, 'none'>;
}

/** What the scout is standing on. `intel` is preferred whenever it holds
 *  battles; a live report is the fallback, and 'none' is a real answer — an
 *  opponent nobody has collected and whose battlelog is empty or private. */
export function scoutBasis(intel: CoachIntel | null, report: PlayerReport | null): ScoutBasis {
  if (intel && intel.summary.battles > 0) return 'stored';
  if (report && isLiveReport(report) && report.battles > 0) return 'live';
  if (report && !isLiveReport(report) && intel) return 'stored';
  return 'none';
}

/** The decks to draw, from whichever footing the scout is on. Never both at
 *  once: two lists counted over different spans, shown together, invite a
 *  comparison that means nothing. */
export function scoutDecks(intel: CoachIntel | null, report: PlayerReport | null, limit = 8): ScoutDeck[] {
  if (intel && intel.decks.length) {
    return intel.decks.slice(0, limit).map((d) => ({
      key: d.key,
      cards: d.cards,
      art: d.art,
      artInferred: d.artInferred,
      name: d.deckName,
      archetype: d.archetype || null,
      battles: d.battles,
      wins: d.wins,
      last: d.last || null,
      basis: 'stored' as const,
    }));
  }
  if (report && isLiveReport(report)) {
    return liveDecks(report.decks, limit);
  }
  return [];
}

/** A live battlelog's decks in the scout's shape. `games` is its battle
 *  count — a different field name for the same quantity, which is exactly the
 *  kind of mismatch that has broken a fixture in this project before. */
export function liveDecks(decks: readonly LiveDeck[], limit = 8): ScoutDeck[] {
  return [...decks]
    .sort((a, b) => b.games - a.games || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))
    .slice(0, limit)
    .map((d) => ({
      key: d.hash,
      cards: d.cards,
      art: d.art,
      artInferred: d.inferredArt,
      name: d.name,
      archetype: d.archetype,
      battles: d.games,
      wins: d.wins,
      last: d.lastSeen,
      basis: 'live' as const,
    }));
}

export interface HeadToHead extends CoachTally {
  /** From the ROSTER PLAYER's point of view: their wins, their losses. */
  tag: string;
  name: string | null;
  last: string;
}

/**
 * What this player's own battles say about this opponent.
 *
 * IT COMES FROM THE PLAYER'S INTEL, NOT THE OPPONENT'S, and the direction is
 * the whole point: `wins` is the roster player's wins. Reading it off the
 * opponent's own record would give their wins against everybody, or — worse,
 * because it looks right — their record inverted.
 *
 * Null when they have not met in the window. That is not a zero: "0–0" reads
 * as a played, drawn history.
 */
export function headToHead(playerIntel: CoachIntel | null, opponentTag: string): HeadToHead | null {
  if (!playerIntel) return null;
  const want = opponentTag.toUpperCase();
  const hit = playerIntel.opponents.find((o) => o.tag.toUpperCase() === want);
  return hit ? { ...hit } : null;
}

/** The opponents worth offering as scout candidates: most-met first, and only
 *  those met more than once. A one-off meeting is not a rivalry, and a list of
 *  fifty strangers is not a shortlist. */
export function scoutCandidates(intel: CoachIntel | null, limit = 12): HeadToHead[] {
  if (!intel) return [];
  return intel.opponents.filter((o) => o.battles > 1).slice(0, limit).map((o) => ({ ...o }));
}

/**
 * How much of a scout's evidence to trust, in words rather than a score.
 *
 * NO CONFIDENCE PERCENTAGE — this project withholds a band it cannot support
 * (see the OIE's `policy.BAND_SUPPORTED`), and a scout over nine battles has
 * no business printing "87% confident". A count and a sentence, or nothing.
 */
export const SCOUT_THIN = 15;

export function evidenceNote(basis: ScoutBasis, battles: number, windowLabel: string): string {
  if (basis === 'none') {
    return 'Nothing is stored for this tag, and their battlelog is empty or closed. Nothing below is a claim about how they play.';
  }
  if (basis === 'live') {
    return `Read live from their last ${battles} battle${battles === 1 ? '' : 's'} — the game hands back about 25, so this is this week, not a record.`;
  }
  return battles < SCOUT_THIN
    ? `${battles} stored 1v1 battle${battles === 1 ? '' : 's'} in ${windowLabel} — too few to read a habit into. Widen the window.`
    : `${battles} stored 1v1 battles in ${windowLabel}.`;
}

/** A deck's win rate, or null under a floor. The floor is the same idea as
 *  the insights': a deck played twice has no rate worth printing beside one
 *  played forty times. */
export const DECK_RATE_FLOOR = 5;

/** Meetings before a HEAD-TO-HEAD rate is printed. A different quantity from
 *  `DECK_RATE_FLOOR` and deliberately lower: a deck's rate is a claim about a
 *  deck, of which a player has many, while this is a claim about one pairing,
 *  and three meetings is the least that is not a coin toss reported as a
 *  record. It lived as a bare `3` written twice in `ScoutTab`, which is how a
 *  floor drifts from the sentence that explains it. */
export const H2H_FLOOR = 3;

/** The head-to-head rate, or null under the floor. */
export function h2hRate(h: Pick<HeadToHead, 'battles' | 'wins'>): number | null {
  return h.battles >= H2H_FLOOR ? (h.wins / h.battles) * 100 : null;
}

export function deckRate(d: Pick<ScoutDeck, 'battles' | 'wins'>): number | null {
  return d.battles >= DECK_RATE_FLOOR ? (d.wins / d.battles) * 100 : null;
}

/** Their most-played win condition, when it clears a share worth naming.
 *  Returns the archetype and its share, or null — the screen says nothing
 *  rather than naming whatever happens to be first in a thin list. */
export const LEAD_SHARE = 30;

export function leadArchetype(intel: CoachIntel | null): { name: string; share: number; battles: number } | null {
  if (!intel || intel.summary.battles < SCOUT_THIN) return null;
  const top = intel.archetypes[0];
  if (!top) return null;
  const share = (top.battles / intel.summary.battles) * 100;
  return share >= LEAD_SHARE ? { name: top.name, share, battles: top.battles } : null;
}
