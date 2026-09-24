import { create } from 'zustand';

import { supabase } from './supabase';
import {
  RosterError,
  cleanNewPlayer,
  explainDbError,
  memoryRepo,
  sortRoster,
  type NewRosterPlayer,
  type RosterPatch,
  type RosterPlayer,
  type RosterRepo,
} from './coachRoster';

/**
 * The Coach Roster's data layer: Supabase in production, memory locally.
 *
 * THE DATABASE IS THE BOUNDARY. Every call below runs with the signed-in
 * user's own token, and `coach_players` answers only an admin, and only with
 * that admin's own rows — enforced by Row Level Security and verified in
 * `supabase/004_coach_roster_verify.sql`. Nothing here filters by coach or
 * checks a role; the table does, and a check here would only be a second
 * opinion that could disagree with it.
 *
 * `coach_id` IS NEVER SENT. It defaults to `auth.uid()` in the table and the
 * policy refuses any other value, so the client has nothing to say about it.
 */

interface Row {
  id: string;
  player_tag: string;
  display_name: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Optional: a database still on 005 does not send it. */
  linked_user_id?: string | null;
}

const COLUMNS = 'id, player_tag, display_name, notes, is_active, created_at, updated_at, linked_user_id';

const fromRow = (r: Row): RosterPlayer => ({
  id: r.id,
  playerTag: r.player_tag,
  displayName: r.display_name,
  notes: r.notes,
  isActive: r.is_active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  linkedUserId: r.linked_user_id ?? null,
});

function supabaseRepo(): RosterRepo {
  const db = supabase!;
  const table = () => db.from('coach_players');
  return {
    kind: 'supabase',
    async list() {
      const { data, error } = await table().select(COLUMNS).order('created_at');
      if (error) throw explainDbError(error.code, error.message);
      return (data as Row[]).map(fromRow);
    },
    async add(p) {
      const { data, error } = await table()
        .insert({ player_tag: p.playerTag, display_name: p.displayName ?? null, notes: p.notes ?? null })
        .select(COLUMNS)
        .single();
      if (error) throw explainDbError(error.code, error.message);
      return fromRow(data as Row);
    },
    async update(id, patch) {
      const row: Partial<Row> = {};
      if ('displayName' in patch) row.display_name = patch.displayName ?? null;
      if ('notes' in patch) row.notes = patch.notes ?? null;
      if ('isActive' in patch) row.is_active = Boolean(patch.isActive);
      const { data, error } = await table().update(row).eq('id', id).select(COLUMNS).single();
      if (error) throw explainDbError(error.code, error.message);
      return fromRow(data as Row);
    },
    /* RPCs, NOT TABLE WRITES. `linked_user_id` is deliberately absent from
       every update grant, so `coach_link_player` is the only door — and its
       guards (you own the row; the account exists) are the whole rule. The
       database words each refusal; those sentences are relayed rather than
       replaced, because a guessed reason can be wrong about which one it was. */
    async link(id, email) {
      const { error } = await db.rpc('coach_link_player', { p_player_id: id, p_email: email });
      if (error) throw new RosterError('unknown', error.message, error.message);
    },
    async unlink(id) {
      const { error } = await db.rpc('coach_unlink_player', { p_player_id: id });
      if (error) throw new RosterError('unknown', error.message, error.message);
    },
    async remove(id) {
      const { error } = await table().delete().eq('id', id);
      if (!error) return 'deleted';
      /* 23503: the player has match plans or results, which the table keeps
         with ON DELETE RESTRICT so outcome history cannot vanish with a
         misclick. Archive instead — the player leaves the active roster and
         the history stays. */
      if (error.code === '23503') {
        const { error: e2 } = await table().update({ is_active: false }).eq('id', id);
        if (e2) throw explainDbError(e2.code, e2.message);
        return 'archived';
      }
      throw explainDbError(error.code, error.message);
    },
  };
}

/* One repository for the page's lifetime. With no Supabase configured the
   gate already answers `admin` locally, and this is the preview store the
   screen labels as unsaved. */
const repo: RosterRepo = supabase ? supabaseRepo() : memoryRepo();

interface RosterState {
  players: RosterPlayer[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  repoKind: RosterRepo['kind'];
  load: () => Promise<void>;
  /** Returns the new player, or throws a `RosterError` with the sentence. */
  add: (p: NewRosterPlayer) => Promise<RosterPlayer>;
  update: (id: string, patch: RosterPatch) => Promise<void>;
  remove: (id: string) => Promise<'deleted' | 'archived'>;
  link: (id: string, email: string) => Promise<void>;
  unlink: (id: string) => Promise<void>;
}

export const useCoachRoster = create<RosterState>()((set, get) => ({
  players: [],
  loaded: false,
  loading: false,
  error: null,
  repoKind: repo.kind,

  async load() {
    set({ loading: true, error: null });
    try {
      set({ players: sortRoster(await repo.list()), loaded: true });
    } catch (e) {
      set({ error: e instanceof RosterError ? e.message : 'Could not load the roster.' });
    } finally {
      set({ loading: false });
    }
  },

  async add(p) {
    // Checked here first so the form can say what is wrong without a round
    // trip; the table checks again and is the one that counts.
    const clean = cleanNewPlayer(p, get().players);
    const row = await repo.add(clean);
    set({ players: sortRoster([...get().players, row]) });
    return row;
  },

  async update(id, patch) {
    const row = await repo.update(id, patch);
    set({ players: sortRoster(get().players.map((p) => (p.id === id ? row : p))) });
  },

  /* RE-READ, NOT PATCH. `coach_link_player` resolves an email to an account
     id, so the client does not know what was written — only the database
     does. Guessing it locally would show a link that might not be the one
     that landed. */
  async link(id, email) {
    await repo.link(id, email);
    set({ players: sortRoster(await repo.list()) });
  },

  async unlink(id) {
    await repo.unlink(id);
    set({ players: sortRoster(await repo.list()) });
  },

  async remove(id) {
    const outcome = await repo.remove(id);
    set({
      players:
        outcome === 'deleted'
          ? get().players.filter((p) => p.id !== id)
          : sortRoster(get().players.map((p) => (p.id === id ? { ...p, isActive: false } : p))),
    });
    return outcome;
  },
}));
