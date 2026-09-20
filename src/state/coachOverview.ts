/**
 * COACH ROSTER — THE WHOLE ROSTER AT ONCE: the pure half.
 *
 * A coach with eight players cannot open eight workspaces to find out where
 * the work is. This is the one screen that looks across all of them.
 *
 * IT COUNTS; IT DOES NOT RANK. Every column is a count of something the coach
 * did or did not do — decks approved, plans drafted, matches recorded — and
 * every flag is a FACT with an action attached ("no deck approved yet"), not
 * a judgement about the player and not a score. A roster sorted by a made-up
 * readiness number would invite exactly the comparison this data cannot
 * support: these are eight different people with eight different amounts of
 * stored history.
 *
 * NOTHING HERE READS THE ANALYTICS API. Every figure comes from the coaching
 * tables, which are the coach's own rows and cheap to read in three queries.
 * Fetching each player's battle intelligence to build a roster summary would
 * put one expensive database scan per player behind a screen nobody asked to
 * be expensive — and the workspace already answers that question properly for
 * the player being looked at.
 *
 * THE FLAGS ARE THE WHOLE POINT: they answer "what should I do next", and
 * each one is true or it is absent. None of them is a warning about the
 * player's ability.
 */

import type { RosterPlayer } from './coachRoster';

/** One thing that is true about a player's preparation, and worth doing
 *  something about. Ordered by how early it sits in the workflow. */
export type AttentionFlag =
  | 'not_collected'
  | 'no_arsenal'
  | 'plan_unconfirmed'
  | 'plan_without_result'
  | 'no_plans';

export const FLAG_LABEL: Record<AttentionFlag, string> = {
  not_collected: 'Collection has not picked them up yet',
  no_arsenal: 'No deck approved yet',
  no_plans: 'No match plan yet',
  plan_unconfirmed: 'A plan is still a draft',
  plan_without_result: 'A confirmed plan has no result recorded',
};

/** What to do about it — the flag says what is true, this says what is next.
 *  A flag with no action is a nag. */
export const FLAG_ACTION: Record<AttentionFlag, string> = {
  not_collected: 'Their battles fill in once the collector reaches them; nothing to do but wait.',
  no_arsenal: 'Approve the decks they are ready to play, in Arsenal.',
  no_plans: 'Scout an opponent and save what to play as a plan.',
  plan_unconfirmed: 'Pick a primary deck and confirm it, in Match plans.',
  plan_without_result: 'Record how it went, in Results.',
};

export interface OverviewRow {
  player: RosterPlayer;
  arsenal: number;
  plans: number;
  draftPlans: number;
  confirmedPlans: number;
  results: number;
  wins: number;
  /** Null under the same floor the results screen uses — a roster summary is
   *  the last place to start printing rates off three matches. */
  winRate: number | null;
  lastActivity: string | null;
  flags: AttentionFlag[];
}

export interface OverviewInput {
  players: readonly RosterPlayer[];
  /** Minimal rows, from the coaching tables only. */
  decks: readonly { playerId: string; status: string }[];
  /* `id` is REQUIRED: without it a result could never be matched to its
     plan, and every confirmed plan would flag as having no result — wrong,
     and silently so. */
  plans: readonly { id: string; playerId: string; status: string; testMode: boolean; createdAt: string }[];
  results: readonly { playerId: string; result: string; testMode: boolean; planId: string | null; playedAt: string }[];
  /** Tags the collector is known to have. Absent means "not known", which is
   *  NOT the same as "not collected" — so the flag is withheld. */
  trackedTags?: ReadonlySet<string> | null;
}

/** The same floor the results screen applies. Repeating the number here would
 *  let the two screens disagree about one player. */
export const ROSTER_RATE_FLOOR = 10;

export function summarise(input: OverviewInput): OverviewRow[] {
  const { players, decks, plans, results, trackedTags } = input;

  return players.map((player) => {
    const myDecks = decks.filter((d) => d.playerId === player.id && d.status === 'active');
    const myPlans = plans.filter((p) => p.playerId === player.id && !p.testMode);
    const myResults = results.filter((r) => r.playerId === player.id && !r.testMode);

    const draftPlans = myPlans.filter((p) => p.status === 'draft').length;
    const confirmed = myPlans.filter((p) => p.status === 'confirmed');
    const wins = myResults.filter((r) => r.result === 'win').length;

    /* A confirmed plan with nothing recorded against it is the most useful
       thing this screen can point at: the preparation happened and the loop
       was never closed. */
    const plansWithResults = new Set(myResults.map((r) => r.planId).filter(Boolean) as string[]);
    const openConfirmed = confirmed.filter((p) => !plansWithResults.has(p.id)).length;

    const lastActivity = [
      ...myPlans.map((p) => p.createdAt),
      ...myResults.map((r) => r.playedAt),
    ].sort().pop() ?? null;

    const flags: AttentionFlag[] = [];
    // Withheld when the tracked set is unknown: absence of knowledge is not
    // evidence that nobody is collecting them.
    if (trackedTags && !trackedTags.has(player.playerTag)) flags.push('not_collected');
    if (myDecks.length === 0) flags.push('no_arsenal');
    if (myPlans.length === 0) flags.push('no_plans');
    if (draftPlans > 0) flags.push('plan_unconfirmed');
    if (openConfirmed > 0) flags.push('plan_without_result');

    return {
      player,
      arsenal: myDecks.length,
      plans: myPlans.length,
      draftPlans,
      confirmedPlans: confirmed.length,
      results: myResults.length,
      wins,
      winRate: myResults.length >= ROSTER_RATE_FLOOR ? (wins / myResults.length) * 100 : null,
      lastActivity,
      flags,
    };
  });
}

/**
 * Roster order, not a ranking.
 *
 * Active players first and then alphabetically, exactly as the sidebar reads
 * — a coach comparing this screen with the rail should not have to re-find
 * anybody. Attention is shown by the flags on a row, never by moving it up.
 */
export function sortOverview(rows: readonly OverviewRow[]): OverviewRow[] {
  return [...rows].sort((a, b) => {
    if (a.player.isActive !== b.player.isActive) return a.player.isActive ? -1 : 1;
    const an = (a.player.displayName || a.player.playerTag).toLowerCase();
    const bn = (b.player.displayName || b.player.playerTag).toLowerCase();
    return an.localeCompare(bn);
  });
}

/** One line over the whole roster: what the coach has, not how good it is. */
export interface RosterTotals {
  players: number;
  withArsenal: number;
  openPlans: number;
  results: number;
  needingAttention: number;
}

export function totals(rows: readonly OverviewRow[]): RosterTotals {
  const active = rows.filter((r) => r.player.isActive);
  return {
    players: active.length,
    withArsenal: active.filter((r) => r.arsenal > 0).length,
    openPlans: active.reduce((n, r) => n + r.draftPlans, 0),
    results: active.reduce((n, r) => n + r.results, 0),
    needingAttention: active.filter((r) => r.flags.length > 0).length,
  };
}
