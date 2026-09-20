/**
 * COACH ROSTER — WHAT TO PLAY: the pure half.
 *
 * NO NEW SCORER. This phase ranks nothing. `server/team_analysis.py` already
 * answers "what should this player bring against this opponent" — spread
 * weighted expected win rate, how much of the opponent's play that figure
 * covers, a practice tiebreak, and a named reason when it can say nothing. It
 * is deployed, tested and used by the public Team Analysis screen. A second
 * ranking living here would be a second opinion that eventually disagrees
 * with the first about the same two players.
 *
 * WHAT THIS PHASE ACTUALLY ADDS IS THE JOIN. The engine's candidate pool is
 * the decks the player HAS PLAYED. The arsenal is the decks the coach has
 * APPROVED. Those are different sets on purpose, and the useful questions
 * live in the overlap:
 *
 *   suggested AND approved    the strongest thing this screen can say
 *   suggested, NOT approved   worth approving — one click, source recorded
 *   approved, NOT suggested   and WHY: either it scored lower, or it has no
 *                             stored play at all and could not be scored
 *
 * THE LAST ONE IS THE HONESTY THAT MATTERS. "The engine did not pick it" and
 * "the engine could not see it" look identical on screen and mean opposite
 * things — the first is evidence against a deck, the second is no evidence at
 * all. `assistRows` separates them and never merges the two.
 *
 * NOTHING HERE INVENTS A FIGURE. Every number shown comes from the engine's
 * own payload or from the stored battle counts; the only things computed here
 * are set membership and ordering.
 */

import type { CoachIntel, TeamRecommendation } from './analyticsClient';
import { deckKey, type ArsenalDeck } from './coachArsenal';

/** Where a row on this screen came from. The spec keeps these apart for the
 *  life of the feature: a coach's choice and an engine's suggestion must
 *  never become indistinguishable once they are both on a match plan. */
export type AssistSource = 'coach_assist' | 'arsenal';

export interface SuggestedDeck {
  key: string;
  rec: TeamRecommendation;
  /** The approved deck holding these same eight cards, if there is one. */
  arsenal: ArsenalDeck | null;
}

/** Why an approved deck is not in the engine's picks. */
export type UnpickedReason = 'scored_lower' | 'never_played';

export interface ArsenalRow {
  deck: ArsenalDeck;
  /** The engine's row for this deck, when it picked it. */
  rec: TeamRecommendation | null;
  /** Stored battles on this deck in the window, from the player's own intel.
   *  Null when their battles have not been read at all. */
  played: number | null;
  /** Only when `rec` is null. */
  reason: UnpickedReason | null;
}

/** The engine's picks, each told whether the coach has already approved it. */
export function suggestedDecks(
  recs: readonly TeamRecommendation[],
  arsenal: readonly ArsenalDeck[],
): SuggestedDeck[] {
  const held = new Map(arsenal.map((d) => [d.deckKey, d]));
  return recs.map((rec) => {
    const key = deckKey(rec.cards);
    return { key, rec, arsenal: held.get(key) ?? null };
  });
}

/**
 * Every approved deck, with the engine's verdict where there is one.
 *
 * ORDER IS THE COACH'S, NOT THE ENGINE'S. The arsenal is ranked by the person
 * who made it; re-sorting it by expected win rate would quietly replace their
 * judgement with a model's, which is the thing this project has refused since
 * the first phase. Suggested decks are marked, not moved.
 */
export function assistRows(
  arsenal: readonly ArsenalDeck[],
  recs: readonly TeamRecommendation[],
  playerIntel: CoachIntel | null,
): ArsenalRow[] {
  const picked = new Map(recs.map((r) => [deckKey(r.cards), r]));
  const played = playerIntel
    ? new Map(playerIntel.decks.map((d) => [deckKey(d.cards), d.battles]))
    : null;

  return arsenal
    .filter((d) => d.status === 'active')
    .map((deck) => {
      const rec = picked.get(deck.deckKey) ?? null;
      const n = played ? (played.get(deck.deckKey) ?? 0) : null;
      return {
        deck,
        rec,
        played: n,
        /* `never_played` is NOT a judgement on the deck. The engine ranks
           decks it has a record for, so a deck with no stored play is
           invisible to it — which is a different sentence from "it scored
           lower", and the screen prints whichever is true. */
        reason: rec ? null : n === 0 ? 'never_played' : n === null ? null : 'scored_lower',
      };
    });
}

/** The suggestions the coach has NOT approved — what the "add to arsenal"
 *  offer is made from. */
export function unapproved(suggested: readonly SuggestedDeck[]): SuggestedDeck[] {
  return suggested.filter((s) => !s.arsenal);
}

/**
 * What to store on `coach_decks.source_ref` when a suggestion is approved.
 *
 * IT RECORDS THE CLAIM AND WHAT IT WAS ABOUT: which opponent, over which
 * window, and the two figures the engine actually published. A deck added
 * today because it was expected to win 61% against one opponent should still
 * say so in a month, when the meta has moved and nobody remembers why it is
 * in the arsenal.
 */
export function assistSourceRef(
  rec: TeamRecommendation,
  opponentTag: string,
  days: number,
): Record<string, unknown> {
  return {
    kind: 'coach_assist',
    opponentTag,
    days,
    expectedWinRate: rec.expectedWinRate,
    spreadCovered: rec.spreadCovered,
    archetype: rec.archetype,
    // The field-wide rate is the denominator the headline is missing; it is
    // optional on an older server, so it is stored only when present.
    ...(typeof rec.overallWinRate === 'number' ? { overallWinRate: rec.overallWinRate } : {}),
    at: new Date().toISOString(),
  };
}

/**
 * How much of the opponent's play a figure covers, worded.
 *
 * NEVER A CONFIDENCE SCORE. `spreadCovered` is a real measured quantity — the
 * share of the opponent's decks the matchup evidence actually reached — and
 * saying it plainly is the honest alternative to inventing a certainty.
 */
export const THIN_COVER = 50;

export function coverNote(rec: TeamRecommendation): string {
  const cover = Math.round(rec.spreadCovered);
  /* WHAT THE FIGURE IS MEASURED OVER CHANGED, so the sentence has to.
     It used to be the opponent's observed archetype spread; with the coaching
     brain it is their PROJECTED pool, which also holds real variants of those
     decks and archetypes their play implies. Saying "what they actually play"
     about a number computed over inferred decks would be the one thing this
     feature is built not to do — quietly presenting inference as observation.
     `threatCovered` is the tell: a server predating the brain does not send
     it, and the old sentence is still exactly right there. */
  const projected = rec.threatCovered !== undefined;
  const what = projected ? 'their likely pool' : 'what they actually play';
  return cover >= THIN_COVER
    ? `Covers ${cover}% of ${what}.`
    : `Covers only ${cover}% of ${what} — the rest is unmeasured, not lost.`;
}

/** What a recommendation is FOR, in a coach's words rather than the enum's. */
export const REC_TYPE_NOTE: Record<string, string> = {
  COUNTER: 'Answers what they have been playing',
  ROBUST: 'Holds up across their variants too',
  CONTINGENCY: 'Cover for what they have not shown',
};

/** The engine's empty states, in words. Three different problems; a screen
 *  that prints one sentence for all three tells the coach to do the wrong
 *  thing twice out of three times. */
export function emptyReason(reason: string | null | undefined, playerName: string): string | null {
  switch (reason) {
    case 'no_history':
      return `Nothing is stored for ${playerName} yet, so there is nothing to rank. This fills in as the collector sees their battles.`;
    case 'no_comfort':
      return `${playerName} has stored battles, but no deck played often enough to count as one of theirs. Play a deck a few more times, or approve one in the arsenal.`;
    case 'no_evidence':
      return `${playerName} has decks, but none with a measured record against what this opponent brings. That is missing evidence, not a bad matchup.`;
    case 'no_matchup_data':
      return 'The matchup snapshot on the analytics server is still building. Nothing you did, and it is fixed by waiting rather than by trying again.';
    case 'no_blue_history':
      return `Nothing is stored for ${playerName} yet, so there is nothing to rank.`;
    case 'no_blue_comfort':
      return `Nothing ${playerName} plays often enough to count as one of their decks.`;
    default:
      return null;
  }
}
