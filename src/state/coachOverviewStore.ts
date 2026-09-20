import { create } from 'zustand';

import { supabase } from './supabase';
import { useCoachArsenal } from './coachArsenalStore';
import { useCoachPlans } from './coachPlansStore';
import { useCoachResults } from './coachResultsStore';
import { summarise, type OverviewInput, type OverviewRow } from './coachOverview';
import type { RosterPlayer } from './coachRoster';

/**
 * The roster overview's data.
 *
 * THREE QUERIES FOR THE WHOLE ROSTER, not three per player. Row Level
 * Security already scopes every coaching table to the signed-in coach, so
 * "all my decks" is one select — and a coach's own rows are a handful.
 * Reading each player separately would turn an eight-player roster into
 * twenty-four round trips for a screen that shows counts.
 *
 * ONLY THE MINIMAL COLUMNS. This screen never draws a card, so it never asks
 * for one; pulling whole decks to count them would move real weight over the
 * wire for nothing.
 *
 * NO ANALYTICS CALLS AT ALL. Battle intelligence is per player and expensive;
 * a roster summary that quietly fired one scan per player would make the
 * cheapest-looking screen the most costly. `trackedTags` is therefore left
 * null and the "not collected" flag is withheld rather than guessed.
 */

interface State {
  rows: OverviewRow[] | null;
  loading: boolean;
  error: string | null;
  load: (players: readonly RosterPlayer[]) => Promise<void>;
}

async function fromSupabase(players: readonly RosterPlayer[]): Promise<OverviewInput> {
  const db = supabase!;
  const [decks, plans, results] = await Promise.all([
    db.from('coach_decks').select('player_id, status'),
    db.from('coach_match_plans').select('id, player_id, status, test_mode, created_at'),
    db.from('coach_match_results').select('player_id, result, test_mode, plan_id, played_at'),
  ]);
  const firstError = decks.error ?? plans.error ?? results.error;
  if (firstError) throw new Error(firstError.message);

  return {
    players,
    decks: (decks.data ?? []).map((d) => ({ playerId: d.player_id as string, status: d.status as string })),
    plans: (plans.data ?? []).map((p) => ({
      id: p.id as string,
      playerId: p.player_id as string,
      status: p.status as string,
      testMode: Boolean(p.test_mode),
      createdAt: p.created_at as string,
    })),
    results: (results.data ?? []).map((r) => ({
      playerId: r.player_id as string,
      result: r.result as string,
      testMode: Boolean(r.test_mode),
      planId: (r.plan_id as string | null) ?? null,
      playedAt: r.played_at as string,
    })),
    trackedTags: null,
  };
}

/** With no Supabase the three stores hold memory repositories, so the same
 *  summary is built from what they already have — the local preview behaves
 *  like production instead of showing an empty screen. */
async function fromMemory(players: readonly RosterPlayer[]): Promise<OverviewInput> {
  const arsenal = useCoachArsenal.getState();
  const plansStore = useCoachPlans.getState();
  const resultsStore = useCoachResults.getState();
  await Promise.all(
    players.flatMap((p) => [arsenal.load(p.id), plansStore.load(p.id), resultsStore.load(p.id)]),
  );
  const decks = Object.values(useCoachArsenal.getState().byPlayer).flat();
  const plans = Object.values(useCoachPlans.getState().byPlayer).flat();
  const results = Object.values(useCoachResults.getState().byPlayer).flat();
  return {
    players,
    decks: decks.map((d) => ({ playerId: d.playerId, status: d.status })),
    plans: plans.map((p) => ({
      id: p.id,
      playerId: p.playerId,
      status: p.status,
      testMode: p.testMode,
      createdAt: p.createdAt,
    })),
    results: results.map((r) => ({
      playerId: r.playerId,
      result: r.result,
      testMode: r.testMode,
      planId: r.planId,
      playedAt: r.playedAt,
    })),
    trackedTags: null,
  };
}

export const useCoachOverview = create<State>()((set) => ({
  rows: null,
  loading: false,
  error: null,

  async load(players) {
    if (!players.length) {
      set({ rows: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const input = supabase ? await fromSupabase(players) : await fromMemory(players);
      set({ rows: summarise(input) });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Could not read the roster summary.' });
    } finally {
      set({ loading: false });
    }
  },
}));
