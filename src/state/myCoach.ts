import { create } from 'zustand';

import { supabase, isSupabaseConfigured } from './supabase';

/**
 * WHAT A ROSTER PLAYER CAN SEE ABOUT THEMSELVES.
 *
 * Migration 006 gives a linked account two reads, both SECURITY DEFINER and
 * both filtered to `auth.uid()`: `my_coach_players()` and `my_coach_decks()`.
 * The tables underneath stay exactly as 004 wrote them — a player has no
 * policy on `coach_players` at all and never gains one.
 *
 * ── THE ABSENT COLUMN IS A CONTRACT, NOT AN OVERSIGHT ─────────────────────
 *
 * `my_coach_players()` does not return `coach_players.notes`. Those are the
 * coach's working notes ABOUT the player, written in the expectation that the
 * player is not reading them, and handing them over would change what a coach
 * can safely write down. It is enforced in SQL rather than here, so no later
 * screen can quietly reverse it.
 *
 * ── WHY THIS SCREEN CANNOT USE `coach_intel` ─────────────────────────────
 *
 * `/api/analytics/admin/coach/intel/<tag>` is the ONE analytics route with a
 * second gate: it asks Supabase whether the caller is an admin. A player is
 * not, so the richest read on the site is closed to them — correctly, since
 * it is the coach's instrument.
 *
 * What is open is `/api/analytics/coach/field/<tag>`, which computes its own
 * intelligence SERVER-SIDE from the same `coach_intel.report()` and returns a
 * plan. So a player gets the same own-deck-1v1 population and the same
 * arithmetic without ever holding the coach's read. That is the whole reason
 * this dashboard is built on the field plan rather than on the intel.
 */

export interface MyRosterSeat {
  id: string;
  playerTag: string;
  displayName: string | null;
  isActive: boolean;
  coachName: string;
}

export interface MyCoachDeck {
  id: string;
  playerId: string;
  name: string | null;
  archetype: string | null;
  cards: string[];
  comfort: number | null;
  sortOrder: number;
}

interface State {
  /** null = not read yet; [] = read, and they are on nobody's roster. The two
   *  are different answers and the screen says different things about them. */
  seats: MyRosterSeat[] | null;
  decks: MyCoachDeck[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export const useMyCoach = create<State>((set) => ({
  seats: null,
  decks: [],
  loading: false,
  error: null,

  async load() {
    if (!isSupabaseConfigured || !supabase) {
      // A checkout with no Supabase has no roster to be on. Not an error.
      set({ seats: [], decks: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    const db = supabase;
    const [seats, decks] = await Promise.all([
      db.rpc('my_coach_players'),
      db.rpc('my_coach_decks'),
    ]);

    /* A DATABASE STILL ON 005 HAS NEITHER FUNCTION, and PostgREST answers 404
       for a missing RPC. That is "this feature is not deployed", not "you are
       on nobody's roster" — so it is reported as an empty seat list with no
       error rather than as a failure the player can do nothing about. */
    if (seats.error) {
      const missing = /(does not exist|not find)/i.test(seats.error.message);
      set({
        seats: [],
        decks: [],
        loading: false,
        error: missing ? null : seats.error.message,
      });
      return;
    }

    set({
      seats: (seats.data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        playerTag: String(r.player_tag),
        displayName: (r.display_name as string | null) ?? null,
        isActive: Boolean(r.is_active),
        coachName: String(r.coach_name ?? 'Your coach'),
      })),
      decks: ((decks.data ?? []) as Record<string, unknown>[]).map((r): MyCoachDeck => ({
        id: String(r.id),
        playerId: String(r.player_id),
        name: (r.name as string | null) ?? null,
        archetype: (r.archetype as string | null) ?? null,
        cards: (r.cards as string[] | null) ?? [],
        comfort: (r.comfort as number | null) ?? null,
        sortOrder: Number(r.sort_order ?? 0),
      })).sort((a: MyCoachDeck, b: MyCoachDeck) => a.sortOrder - b.sortOrder),
      loading: false,
      error: null,
    });
  },
}));
