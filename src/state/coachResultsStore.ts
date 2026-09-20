import { create } from 'zustand';

import { supabase } from './supabase';
import { normalizeTag } from './coachRoster';
import {
  ResultError,
  cleanNewResult,
  explainResultError,
  memoryResultRepo,
  sortResults,
  type MatchOutcome,
  type MatchResult,
  type NewMatchResult,
  type PlayedSlot,
  type ResultRepo,
} from './coachResults';

/**
 * Match results: Supabase in production, memory locally.
 *
 * THE DATABASE IS THE BOUNDARY, as everywhere else here. `coach_match_results`
 * answers only an admin and only their own rows, and refuses a deck that is
 * not eight distinct cards, a crown count outside 0–3 and a result that is
 * not win/loss/draw.
 *
 * A RESULT MAY HAVE NO PLAN. The foreign key is MATCH SIMPLE, so a null
 * `plan_id` is simply not checked — a match that just happened can be
 * recorded without inventing a preparation for it after the fact.
 */

interface Row {
  id: string;
  player_id: string;
  plan_id: string | null;
  opponent_tag: string;
  deck_played: string[];
  played_slot: string | null;
  result: string;
  player_crowns: number | null;
  opponent_crowns: number | null;
  notes: string | null;
  played_at: string;
  test_mode: boolean;
  created_at: string;
}

const COLUMNS =
  'id, player_id, plan_id, opponent_tag, deck_played, played_slot, result, player_crowns, opponent_crowns, notes, played_at, test_mode, created_at';

const fromRow = (r: Row): MatchResult => ({
  id: r.id,
  playerId: r.player_id,
  planId: r.plan_id,
  opponentTag: r.opponent_tag,
  deckPlayed: r.deck_played ?? [],
  playedSlot: (r.played_slot as PlayedSlot) ?? null,
  result: r.result as MatchOutcome,
  playerCrowns: r.player_crowns,
  opponentCrowns: r.opponent_crowns,
  notes: r.notes,
  playedAt: r.played_at,
  testMode: Boolean(r.test_mode),
  createdAt: r.created_at,
});

function supabaseRepo(): ResultRepo {
  const db = supabase!;
  const table = () => db.from('coach_match_results');
  return {
    kind: 'supabase',
    async list(playerId) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('player_id', playerId)
        .order('played_at', { ascending: false });
      if (error) throw explainResultError(error.code, error.message);
      return sortResults((data as Row[]).map(fromRow));
    },
    async add(playerId, r) {
      const { data, error } = await table()
        .insert({
          player_id: playerId,
          plan_id: r.planId ?? null,
          opponent_tag: r.opponentTag,
          deck_played: r.deckPlayed,
          played_slot: r.playedSlot ?? null,
          result: r.result,
          player_crowns: r.playerCrowns ?? null,
          opponent_crowns: r.opponentCrowns ?? null,
          notes: r.notes ?? null,
          played_at: r.playedAt ?? new Date().toISOString(),
          test_mode: r.testMode ?? false,
        })
        .select(COLUMNS)
        .single();
      if (error) throw explainResultError(error.code, error.message);
      return fromRow(data as Row);
    },
    async remove(id) {
      const { error } = await table().delete().eq('id', id);
      if (error) throw explainResultError(error.code, error.message);
    },
  };
}

const repo: ResultRepo = supabase ? supabaseRepo() : memoryResultRepo();

interface ResultState {
  byPlayer: Record<string, MatchResult[]>;
  loading: Record<string, boolean>;
  error: string | null;
  repoKind: ResultRepo['kind'];
  load: (playerId: string, force?: boolean) => Promise<void>;
  add: (playerId: string, result: NewMatchResult) => Promise<MatchResult>;
  remove: (playerId: string, id: string) => Promise<void>;
}

export const useCoachResults = create<ResultState>()((set, get) => ({
  byPlayer: {},
  loading: {},
  error: null,
  repoKind: repo.kind,

  async load(playerId, force = false) {
    if (!force && get().byPlayer[playerId]) return;
    set((s) => ({ loading: { ...s.loading, [playerId]: true }, error: null }));
    try {
      const rows = await repo.list(playerId);
      set((s) => ({ byPlayer: { ...s.byPlayer, [playerId]: rows } }));
    } catch (e) {
      set({ error: e instanceof ResultError ? e.message : 'Could not read the recorded matches.' });
    } finally {
      set((s) => ({ loading: { ...s.loading, [playerId]: false } }));
    }
  },

  async add(playerId, result) {
    const clean = cleanNewResult(result, normalizeTag);
    const saved = await repo.add(playerId, clean);
    set((s) => ({
      byPlayer: { ...s.byPlayer, [playerId]: sortResults([...(s.byPlayer[playerId] ?? []), saved]) },
    }));
    return saved;
  },

  async remove(playerId, id) {
    await repo.remove(id);
    set((s) => ({
      byPlayer: { ...s.byPlayer, [playerId]: (s.byPlayer[playerId] ?? []).filter((r) => r.id !== id) },
    }));
  },
}));
