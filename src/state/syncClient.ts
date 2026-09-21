import type { DeckOwner, DuelDeckSet, SavedDeckSet } from '../types/deck';
import { supabase } from './supabase';

export interface SyncPayload {
  sets: Record<DeckOwner, DuelDeckSet>;
  library: SavedDeckSet[];
  deckSlotCount: Record<'solo' | 'blue' | 'red', number>;
  /** Counter Palette archetype folders — absent in pre-palette remote blobs. */
  paletteFolders?: DuelDeckSet[];
}

async function safeFetch(input: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(input, init);
  } catch {
    // Offline, or /api isn't available (e.g. local `vite dev` without serverless functions).
    return null;
  }
}

/**
 * The bearer token for `/api/decks`.
 *
 * A SUPABASE ACCESS TOKEN NOW, not `sha256(username:password)`. Fetched fresh
 * on each call rather than captured once, because access tokens expire after an
 * hour and the client refreshes them in the background — a token held in a
 * closure would work for an hour and then silently stop syncing, which is the
 * worst shape of failure for a thing whose whole job is to be invisible.
 */
async function bearer(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** This account's synced deck data, or null if none exists yet / sync is unreachable. */
export async function pullRemoteDecks(): Promise<SyncPayload | null> {
  const token = await bearer();
  if (!token) return null;
  const res = await safeFetch('/api/decks', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res?.ok) return null;
  try {
    const json = await res.json();
    return json?.found ? (json.data as SyncPayload) : null;
  } catch {
    return null;
  }
}

/**
 * Pushes the current deck state to the account's synced storage. Never throws.
 *
 * **RETURNS WHETHER IT LANDED, and that return value is load-bearing.** This
 * used to be `Promise<void>` and ignored the response entirely, so a 413 from
 * the payload cap — or a 500, or an expired token — was indistinguishable from
 * success. The remote copy silently stopped advancing while the app went on
 * replacing local state with it on every load, which deleted saved duels one
 * refresh later. The caller keeps a "not yet accepted" flag on `false` and
 * refuses to adopt the remote blob until a push succeeds.
 */
export async function pushRemoteDecks(payload: SyncPayload): Promise<boolean> {
  const token = await bearer();
  if (!token) return false;
  const res = await safeFetch('/api/decks', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return Boolean(res?.ok);
}

/**
 * Copy decks saved under a pre-Supabase login onto this account, once.
 *
 * The old storage key WAS the credential — sha256 of the username and password
 * — so without them the data cannot even be named, let alone read. This is the
 * only route back to it. Returns null on success, or a message to show.
 */
export async function claimLegacyDecks(
  username: string,
  password: string,
): Promise<string | null> {
  const token = await bearer();
  if (!token) return 'Sign in first.';
  const res = await safeFetch('/api/decks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res) return 'Could not reach sync storage.';
  if (res.ok) return null;
  if (res.status === 409) return 'This account already has synced decks.';
  if (res.status === 404) return 'Nothing found for that login.';
  return 'Could not claim those decks.';
}

/* ── SAVED TEAM ANALYSES ─────────────────────────────────────────────────────
 *
 * Same endpoint, same token, a separate document family (`?doc=team-saves`):
 * an index of every save plus one record per save. One document would not do
 * — twelve compacted boards run to several megabytes, and the deck blob's 1 MB
 * cap is there for a reason recorded in `api/decks.ts`.
 *
 * Every call answers `null`/`false` when there is no session or the endpoint
 * is unreachable (including `vite dev`, where `/api/*` does not run). The
 * caller treats that as "stay local", never as "the account is empty" — an
 * unreachable account read as empty would delete every synced save. */

const TEAM_SAVES = '/api/decks?doc=team-saves';

async function teamSaveCall(
  query: string,
  init: RequestInit = {},
): Promise<Response | null> {
  const token = await bearer();
  if (!token) return null;
  return safeFetch(`${TEAM_SAVES}${query}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

/** The account's index, or null when it could not be read. */
export async function pullTeamSaveIndex(): Promise<unknown[] | null> {
  const res = await teamSaveCall('');
  if (!res?.ok) return null;
  try {
    const json = await res.json();
    return Array.isArray(json?.saves) ? json.saves : null;
  } catch {
    return null;
  }
}

/** One save in full, or null. */
export async function pullTeamSave(id: string): Promise<unknown | null> {
  const res = await teamSaveCall(`&id=${encodeURIComponent(id)}`);
  if (!res?.ok) return null;
  try {
    const json = await res.json();
    return json?.found ? json.data : null;
  } catch {
    return null;
  }
}

/** Upload (or overwrite) one save. Whether the account accepted it. */
export async function pushTeamSave(save: { id: string }): Promise<boolean> {
  const res = await teamSaveCall(`&id=${encodeURIComponent(save.id)}`, {
    method: 'PUT',
    body: JSON.stringify(save),
  });
  return Boolean(res?.ok);
}

export async function renameTeamSave(id: string, name: string): Promise<boolean> {
  const res = await teamSaveCall(`&id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return Boolean(res?.ok);
}

export async function deleteTeamSave(id: string): Promise<boolean> {
  const res = await teamSaveCall(`&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return Boolean(res?.ok);
}
