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
