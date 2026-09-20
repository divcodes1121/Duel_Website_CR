import { create } from 'zustand';

import { supabase } from './supabase';
import { normalizeTag } from './coachRoster';
import {
  PlanError,
  cleanNewPlan,
  explainPlanError,
  memoryPlanRepo,
  sortPlans,
  type MatchPlan,
  type NewMatchPlan,
  type NewPlanDeck,
  type PlanCandidate,
  type PlanDeck,
  type PlanEngine,
  type PlanPatch,
  type PlanRepo,
  type PlanSlot,
  type PlanSource,
  type PlanStatus,
} from './coachPlans';

/**
 * Match plans: Supabase in production, memory locally.
 *
 * THE DATABASE IS THE BOUNDARY, as in every other phase here. `coach_match_
 * plans` and `coach_plan_decks` answer only an admin, only for their own
 * rows, and refuse a malformed opponent tag, a deck that is not eight
 * distinct cards and a second deck in one slot. Nothing below filters by
 * coach.
 *
 * TWO TABLES, READ IN TWO QUERIES rather than an embedded join: PostgREST's
 * nesting would tie this read to the exact foreign-key names, which is a
 * needless second thing to keep in step with the migration.
 */

interface PlanRow {
  id: string;
  player_id: string;
  opponent_tag: string;
  opponent_name: string | null;
  recommendations: PlanCandidate[] | null;
  engine: PlanEngine | null;
  generated_at: string | null;
  status: string;
  confirmed_at: string | null;
  notes: string | null;
  test_mode: boolean;
  created_at: string;
  updated_at: string;
}

interface DeckRow {
  id: string;
  plan_id: string;
  slot: string;
  cards: string[];
  source: string;
  source_ref: unknown;
  name: string | null;
  created_at: string;
}

const PLAN_COLUMNS =
  'id, player_id, opponent_tag, opponent_name, recommendations, engine, generated_at, status, confirmed_at, notes, test_mode, created_at, updated_at';
const DECK_COLUMNS = 'id, plan_id, slot, cards, source, source_ref, name, created_at';

const fromDeckRow = (r: DeckRow): PlanDeck => ({
  id: r.id,
  planId: r.plan_id,
  slot: r.slot as PlanSlot,
  cards: r.cards ?? [],
  source: r.source as PlanSource,
  sourceRef: r.source_ref ?? null,
  name: r.name,
  createdAt: r.created_at,
});

const fromPlanRow = (r: PlanRow, decks: PlanDeck[]): MatchPlan => ({
  id: r.id,
  playerId: r.player_id,
  opponentTag: r.opponent_tag,
  opponentName: r.opponent_name,
  recommendations: r.recommendations ?? [],
  engine: r.engine ?? null,
  generatedAt: r.generated_at,
  status: (r.status as PlanStatus) ?? 'draft',
  confirmedAt: r.confirmed_at,
  notes: r.notes,
  testMode: Boolean(r.test_mode),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  decks,
});

function supabaseRepo(): PlanRepo {
  const db = supabase!;
  const plans = () => db.from('coach_match_plans');
  const planDecks = () => db.from('coach_plan_decks');

  return {
    kind: 'supabase',
    async list(playerId) {
      const { data, error } = await plans()
        .select(PLAN_COLUMNS)
        .eq('player_id', playerId)
        .order('created_at', { ascending: false });
      if (error) throw explainPlanError(error.code, error.message);
      const rows = (data ?? []) as PlanRow[];
      if (!rows.length) return [];

      const { data: deckData, error: deckError } = await planDecks()
        .select(DECK_COLUMNS)
        .in('plan_id', rows.map((r) => r.id));
      if (deckError) throw explainPlanError(deckError.code, deckError.message);

      const byPlan = new Map<string, PlanDeck[]>();
      for (const d of (deckData ?? []) as DeckRow[]) {
        const deck = fromDeckRow(d);
        byPlan.set(deck.planId, [...(byPlan.get(deck.planId) ?? []), deck]);
      }
      return sortPlans(rows.map((r) => fromPlanRow(r, byPlan.get(r.id) ?? [])));
    },

    async create(playerId, plan) {
      const { data, error } = await plans()
        .insert({
          player_id: playerId,
          opponent_tag: plan.opponentTag,
          opponent_name: plan.opponentName ?? null,
          recommendations: plan.recommendations ?? [],
          engine: plan.engine ?? null,
          generated_at: plan.generatedAt ?? null,
          notes: plan.notes ?? null,
          test_mode: plan.testMode ?? false,
        })
        .select(PLAN_COLUMNS)
        .single();
      if (error) throw explainPlanError(error.code, error.message);
      return fromPlanRow(data as PlanRow, []);
    },

    async update(id, patch) {
      const row: Record<string, unknown> = {};
      if ('notes' in patch) row.notes = patch.notes ?? null;
      if ('opponentName' in patch) row.opponent_name = patch.opponentName ?? null;
      if ('testMode' in patch) row.test_mode = Boolean(patch.testMode);
      if ('status' in patch) {
        row.status = patch.status;
        // Stamped here rather than by a trigger: the column exists for the
        // moment a coach committed, and only this call knows it happened.
        if (patch.status === 'confirmed') row.confirmed_at = new Date().toISOString();
      }
      const { data, error } = await plans().update(row).eq('id', id).select(PLAN_COLUMNS).single();
      if (error) throw explainPlanError(error.code, error.message);
      const { data: deckData } = await planDecks().select(DECK_COLUMNS).eq('plan_id', id);
      return fromPlanRow(data as PlanRow, ((deckData ?? []) as DeckRow[]).map(fromDeckRow));
    },

    async remove(id) {
      /* The plan's decks go with it — `coach_plan_decks` is ON DELETE CASCADE
         from the plan, while the PLAYER is ON DELETE RESTRICT. Deleting a
         plan is the coach discarding their own preparation; losing a player
         with history is not. */
      const { error } = await plans().delete().eq('id', id);
      if (error) throw explainPlanError(error.code, error.message);
    },

    async setDeck(planId, deck) {
      /* One deck per slot is the table's own unique (plan_id, slot). Delete
         then insert rather than upsert: an upsert needs the conflict target
         spelled out here, which is a second copy of a constraint that already
         exists in the migration. */
      const { error: clearError } = await planDecks().delete().eq('plan_id', planId).eq('slot', deck.slot);
      if (clearError) throw explainPlanError(clearError.code, clearError.message);
      const { data, error } = await planDecks()
        .insert({
          plan_id: planId,
          slot: deck.slot,
          cards: deck.cards,
          source: deck.source,
          source_ref: deck.sourceRef ?? null,
          name: deck.name ?? null,
        })
        .select(DECK_COLUMNS)
        .single();
      if (error) throw explainPlanError(error.code, error.message);
      return fromDeckRow(data as DeckRow);
    },

    async clearDeck(planId, slot) {
      const { error } = await planDecks().delete().eq('plan_id', planId).eq('slot', slot);
      if (error) throw explainPlanError(error.code, error.message);
    },
  };
}

const repo: PlanRepo = supabase ? supabaseRepo() : memoryPlanRepo();

interface PlanState {
  byPlayer: Record<string, MatchPlan[]>;
  loading: Record<string, boolean>;
  error: string | null;
  repoKind: PlanRepo['kind'];
  load: (playerId: string, force?: boolean) => Promise<void>;
  create: (playerId: string, plan: NewMatchPlan) => Promise<MatchPlan>;
  update: (playerId: string, id: string, patch: PlanPatch) => Promise<void>;
  remove: (playerId: string, id: string) => Promise<void>;
  setDeck: (playerId: string, planId: string, deck: NewPlanDeck) => Promise<void>;
  clearDeck: (playerId: string, planId: string, slot: PlanSlot) => Promise<void>;
}

export const useCoachPlans = create<PlanState>()((set, get) => ({
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
      set({ error: e instanceof PlanError ? e.message : 'Could not read the match plans.' });
    } finally {
      set((s) => ({ loading: { ...s.loading, [playerId]: false } }));
    }
  },

  async create(playerId, plan) {
    const clean = cleanNewPlan(plan, normalizeTag);
    const saved = await repo.create(playerId, clean);
    set((s) => ({
      byPlayer: { ...s.byPlayer, [playerId]: sortPlans([...(s.byPlayer[playerId] ?? []), saved]) },
    }));
    return saved;
  },

  async update(playerId, id, patch) {
    const saved = await repo.update(id, patch);
    set((s) => ({
      byPlayer: {
        ...s.byPlayer,
        [playerId]: sortPlans((s.byPlayer[playerId] ?? []).map((p) => (p.id === id ? saved : p))),
      },
    }));
  },

  async remove(playerId, id) {
    await repo.remove(id);
    set((s) => ({
      byPlayer: { ...s.byPlayer, [playerId]: (s.byPlayer[playerId] ?? []).filter((p) => p.id !== id) },
    }));
  },

  async setDeck(playerId, planId, deck) {
    const saved = await repo.setDeck(planId, deck);
    set((s) => ({
      byPlayer: {
        ...s.byPlayer,
        [playerId]: (s.byPlayer[playerId] ?? []).map((p) =>
          p.id === planId ? { ...p, decks: [...p.decks.filter((d) => d.slot !== saved.slot), saved] } : p,
        ),
      },
    }));
  },

  async clearDeck(playerId, planId, slot) {
    await repo.clearDeck(planId, slot);
    set((s) => ({
      byPlayer: {
        ...s.byPlayer,
        [playerId]: (s.byPlayer[playerId] ?? []).map((p) =>
          p.id === planId ? { ...p, decks: p.decks.filter((d) => d.slot !== slot) } : p,
        ),
      },
    }));
  },
}));
