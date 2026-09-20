import { create } from 'zustand';

import { supabase } from './supabase';
import {
  ArsenalError,
  cleanNewDeck,
  cleanTags,
  deckProblem,
  explainArsenalError,
  memoryArsenalRepo,
  sortArsenal,
  type ArsenalDeck,
  type ArsenalPatch,
  type ArsenalRepo,
  type ArsenalSource,
  type NewArsenalDeck,
} from './coachArsenal';

/**
 * The Deck Arsenal's data layer: Supabase in production, memory locally.
 *
 * THE DATABASE IS THE BOUNDARY, exactly as in `coachRosterStore.ts`. Every
 * call runs with the signed-in user's own token; `coach_decks` answers only
 * an admin, only for their own rows, and refuses a deck that is not eight
 * distinct cards or one already in that player's arsenal. Nothing here
 * filters by coach — the table does, and a second opinion could disagree.
 *
 * `coach_id` IS NEVER SENT (it defaults to `auth.uid()`), and neither is
 * `deck_key` — the table GENERATES it from the cards, which is what makes the
 * duplicate rule impossible to talk your way around from a client.
 *
 * DECKS ARE KEPT PER PLAYER, not in one flat list: an arsenal is read while
 * looking at one player, and holding every player's decks in one store would
 * mean a roster of twenty reads twenty arsenals nobody opened.
 */

interface Row {
  id: string;
  player_id: string;
  cards: string[];
  deck_key: string;
  name: string | null;
  archetype: string | null;
  comfort: number | null;
  tags: string[] | null;
  status: string;
  source: string;
  source_ref: unknown;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, player_id, cards, deck_key, name, archetype, comfort, tags, status, source, source_ref, notes, sort_order, created_at, updated_at';

const fromRow = (r: Row): ArsenalDeck => ({
  id: r.id,
  playerId: r.player_id,
  cards: r.cards ?? [],
  deckKey: r.deck_key,
  name: r.name,
  archetype: r.archetype,
  comfort: r.comfort,
  tags: r.tags ?? [],
  status: r.status === 'archived' ? 'archived' : 'active',
  source: (r.source as ArsenalSource) ?? 'manual',
  sourceRef: r.source_ref ?? null,
  notes: r.notes,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function supabaseRepo(): ArsenalRepo {
  const db = supabase!;
  const table = () => db.from('coach_decks');
  return {
    kind: 'supabase',
    async list(playerId) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('player_id', playerId)
        .order('sort_order')
        .order('created_at');
      if (error) throw explainArsenalError(error.code, error.message);
      return (data as Row[]).map(fromRow);
    },
    async add(playerId, deck) {
      /* The order a new deck lands in is decided from what is already there,
         so it goes to the BOTTOM of the coach's ranking. Arriving above decks
         somebody ranked is the arsenal rearranging itself. */
      const { data: tail, error: tailError } = await table()
        .select('sort_order')
        .eq('player_id', playerId)
        .order('sort_order', { ascending: false })
        .limit(1);
      if (tailError) throw explainArsenalError(tailError.code, tailError.message);
      const last = (tail as { sort_order: number }[] | null)?.[0]?.sort_order;

      const { data, error } = await table()
        .insert({
          player_id: playerId,
          cards: deck.cards,
          name: deck.name ?? null,
          archetype: deck.archetype ?? null,
          comfort: deck.comfort ?? null,
          tags: deck.tags ?? [],
          source: deck.source ?? 'manual',
          source_ref: deck.sourceRef ?? null,
          notes: deck.notes ?? null,
          sort_order: typeof last === 'number' ? last + 1 : 0,
        })
        .select(COLUMNS)
        .single();
      if (error) throw explainArsenalError(error.code, error.message);
      return fromRow(data as Row);
    },
    async update(id, patch) {
      const row: Record<string, unknown> = {};
      if ('cards' in patch) row.cards = patch.cards;
      if ('name' in patch) row.name = patch.name ?? null;
      if ('archetype' in patch) row.archetype = patch.archetype ?? null;
      if ('comfort' in patch) row.comfort = patch.comfort ?? null;
      if ('tags' in patch) row.tags = patch.tags ?? [];
      if ('status' in patch) row.status = patch.status;
      if ('notes' in patch) row.notes = patch.notes ?? null;
      if ('sortOrder' in patch) row.sort_order = patch.sortOrder;
      const { data, error } = await table().update(row).eq('id', id).select(COLUMNS).single();
      if (error) throw explainArsenalError(error.code, error.message);
      return fromRow(data as Row);
    },
    async remove(id) {
      const { error } = await table().delete().eq('id', id);
      if (error) throw explainArsenalError(error.code, error.message);
    },
    async reorder(playerId, idsInOrder) {
      /* One statement per deck, but only for the decks that MOVED — the
         screen sends the whole order and most of it is unchanged. There is no
         upsert here on purpose: an upsert would need every NOT NULL column
         (the cards among them), so a reorder would rewrite the decks it is
         only renumbering. */
      const current = await this.list(playerId);
      const at = new Map(idsInOrder.map((id, i) => [id, i]));
      const moved = current.filter((d) => at.has(d.id) && at.get(d.id) !== d.sortOrder);
      for (const d of moved) {
        const { error } = await table().update({ sort_order: at.get(d.id)! }).eq('id', d.id);
        if (error) throw explainArsenalError(error.code, error.message);
      }
    },
  };
}

const repo: ArsenalRepo = supabase ? supabaseRepo() : memoryArsenalRepo();

export const arsenalRepoKind = repo.kind;

interface ArsenalState {
  /** Decks by player id. Absent means "never read"; an empty array means
   *  "read, and they have none" — a screen cannot word those the same way. */
  byPlayer: Record<string, ArsenalDeck[]>;
  loading: Record<string, boolean>;
  error: string | null;
  repoKind: ArsenalRepo['kind'];
  load: (playerId: string, force?: boolean) => Promise<void>;
  add: (playerId: string, deck: NewArsenalDeck) => Promise<ArsenalDeck>;
  update: (playerId: string, id: string, patch: ArsenalPatch) => Promise<void>;
  remove: (playerId: string, id: string) => Promise<void>;
  reorder: (playerId: string, idsInOrder: string[]) => Promise<void>;
}

export const useCoachArsenal = create<ArsenalState>()((set, get) => ({
  byPlayer: {},
  loading: {},
  error: null,
  repoKind: repo.kind,

  async load(playerId, force = false) {
    if (!force && get().byPlayer[playerId]) return;
    set((s) => ({ loading: { ...s.loading, [playerId]: true }, error: null }));
    try {
      const decks = await repo.list(playerId);
      set((s) => ({ byPlayer: { ...s.byPlayer, [playerId]: sortArsenal(decks) } }));
    } catch (e) {
      set({ error: e instanceof ArsenalError ? e.message : 'Could not read this arsenal.' });
    } finally {
      set((s) => ({ loading: { ...s.loading, [playerId]: false } }));
    }
  },

  async add(playerId, deck) {
    // Validated against what is already stored, so a duplicate is refused by
    // NAME here rather than as a 23505 from the table.
    cleanNewDeck(deck, get().byPlayer[playerId] ?? []);
    const saved = await repo.add(playerId, deck);
    set((s) => ({
      byPlayer: { ...s.byPlayer, [playerId]: sortArsenal([...(s.byPlayer[playerId] ?? []), saved]) },
    }));
    return saved;
  },

  async update(playerId, id, patch) {
    if (patch.cards) {
      const problem = deckProblem(patch.cards);
      if (problem) throw new ArsenalError('invalid_deck', problem);
    }
    if (patch.tags) cleanTags(patch.tags);
    const saved = await repo.update(id, patch);
    set((s) => ({
      byPlayer: {
        ...s.byPlayer,
        [playerId]: sortArsenal((s.byPlayer[playerId] ?? []).map((d) => (d.id === id ? saved : d))),
      },
    }));
  },

  async remove(playerId, id) {
    await repo.remove(id);
    set((s) => ({
      byPlayer: { ...s.byPlayer, [playerId]: (s.byPlayer[playerId] ?? []).filter((d) => d.id !== id) },
    }));
  },

  async reorder(playerId, idsInOrder) {
    /* Written to the screen first, then to the database. A reorder is a drag
       or a click on an arrow: waiting a round trip to move the row makes the
       control feel broken. The list is re-read on failure rather than left
       showing an order the database refused. */
    const before = get().byPlayer[playerId] ?? [];
    const at = new Map(idsInOrder.map((id, i) => [id, i]));
    set((s) => ({
      byPlayer: {
        ...s.byPlayer,
        [playerId]: sortArsenal(before.map((d) => (at.has(d.id) ? { ...d, sortOrder: at.get(d.id)! } : d))),
      },
    }));
    try {
      await repo.reorder(playerId, idsInOrder);
    } catch (e) {
      set((s) => ({
        byPlayer: { ...s.byPlayer, [playerId]: before },
        error: e instanceof ArsenalError ? e.message : 'Could not save that order.',
      }));
      throw e;
    }
  },
}));
