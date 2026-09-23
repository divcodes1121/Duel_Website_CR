import { create } from 'zustand';

import { supabase } from './supabase';
import { useCoachArsenal } from './coachArsenalStore';
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
  // ONE QUERY. Match plans and results were removed from the product, so the
  // two reads that fed them are gone with the counts they produced.
  const decks = await db.from('coach_decks').select('player_id, status');
  if (decks.error) throw new Error(decks.error.message);

  return {
    players,
    decks: (decks.data ?? []).map((d) => ({ playerId: d.player_id as string, status: d.status as string })),
  };
}

/** With no Supabase the three stores hold memory repositories, so the same
 *  summary is built from what they already have — the local preview behaves
 *  like production instead of showing an empty screen. */
async function fromMemory(players: readonly RosterPlayer[]): Promise<OverviewInput> {
  // ONE STORE. Plans and results were removed from the product, so the two
  // loads that fed their counts are gone with them.
  const arsenal = useCoachArsenal.getState();
  await Promise.all(players.map((p) => arsenal.load(p.id)));
  const decks = Object.values(useCoachArsenal.getState().byPlayer).flat();
  return {
    players,
    decks: decks.map((d) => ({ playerId: d.playerId, status: d.status })),
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
