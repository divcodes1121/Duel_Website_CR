/**
 * COACH ROSTER — THE WHOLE ROSTER AT ONCE: the pure half.
 *
 * A coach with eight players cannot open eight workspaces to find out where
 * the work is. This is the one screen that looks across all of them.
 *
 * IT COUNTS; IT DOES NOT RANK. Every column is a count of something the coach
 * did or did not do, and every flag is a FACT with an action attached ("no
 * deck approved yet"), not a judgement about the player and not a score. A
 * roster sorted by a made-up readiness number would invite exactly the
 * comparison this data cannot support: these are different people with
 * different amounts of stored history.
 *
 * NOTHING HERE READS THE ANALYTICS API. Every figure comes from the coaching
 * tables, which are the coach's own rows and cheap to read. Fetching each
 * player's battle intelligence to build a roster summary would put one
 * expensive database scan per player behind a screen nobody asked to be
 * expensive — and the workspace already answers that question properly for the
 * player being looked at.
 *
 * THE ONE EXCEPTION IS A BUTTON. `TodayBoard` reads the field plan once per
 * active player, and only when pressed, which is how it keeps this rule.
 *
 * ── MATCH PLANS AND RESULTS ARE GONE (2026-09-24) ──────────────────────────
 *
 * They were removed from the product on request, and the evidence agreed: the
 * roster read `0 plans · 0 matches · nothing recorded` for every player on it.
 * So this module no longer reads `coach_match_plans` or `coach_match_results`,
 * no longer carries plan or result counts, and its flags are down to the two
 * that describe something real — whether the collector has the player, and
 * whether the coach has approved any decks for them.
 *
 * The tables still exist in migration 004. Dropping them is a separate,
 * deliberate migration and is not worth doing to reclaim nothing.
 */

import type { RosterPlayer } from './coachRoster';

/** One thing that is true about a player's preparation, and worth doing
 *  something about. Ordered by how early it sits in the workflow. */
export type AttentionFlag = 'not_collected' | 'no_arsenal';

export const FLAG_LABEL: Record<AttentionFlag, string> = {
  not_collected: 'Collection has not picked them up yet',
  no_arsenal: 'No deck approved yet',
};

/** What to do about it — the flag says what is true, this says what is next.
 *  A flag with no action is a nag. */
export const FLAG_ACTION: Record<AttentionFlag, string> = {
  not_collected: 'Their battles fill in once the collector reaches them; nothing to do but wait.',
  no_arsenal: 'Approve the decks they are ready to play, in Arsenal.',
};

export interface OverviewRow {
  player: RosterPlayer;
  arsenal: number;
  flags: AttentionFlag[];
}

export interface OverviewInput {
  players: readonly RosterPlayer[];
  /** Minimal rows, from the coaching tables only. */
  decks: readonly { playerId: string; status: string }[];
  /** Tags the collector is known to have. Absent means "not known", which is
   *  NOT the same as "not collected" — so the flag is withheld. */
  trackedTags?: ReadonlySet<string> | null;
}

export function summarise(input: OverviewInput): OverviewRow[] {
  const { players, decks, trackedTags } = input;

  return players.map((player) => {
    const myDecks = decks.filter((d) => d.playerId === player.id && d.status === 'active');

    const flags: AttentionFlag[] = [];
    // Withheld when the tracked set is unknown: absence of knowledge is not
    // evidence that nobody is collecting them.
    if (trackedTags && !trackedTags.has(player.playerTag)) flags.push('not_collected');
    if (myDecks.length === 0) flags.push('no_arsenal');

    return { player, arsenal: myDecks.length, flags };
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
  decks: number;
  needingAttention: number;
}

export function totals(rows: readonly OverviewRow[]): RosterTotals {
  const active = rows.filter((r) => r.player.isActive);
  return {
    players: active.length,
    withArsenal: active.filter((r) => r.arsenal > 0).length,
    decks: active.reduce((n, r) => n + r.arsenal, 0),
    needingAttention: active.filter((r) => r.flags.length > 0).length,
  };
}
