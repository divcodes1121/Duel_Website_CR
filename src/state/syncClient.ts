import type { DeckOwner, DuelDeckSet, SavedDeckSet } from '../types/deck';

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

/** This account's synced deck data, or null if none exists yet / sync is unreachable. */
export async function pullRemoteDecks(credential: string): Promise<SyncPayload | null> {
  const res = await safeFetch('/api/decks', {
    headers: { Authorization: `Bearer ${credential}` },
  });
  if (!res?.ok) return null;
  try {
    const json = await res.json();
    return json?.found ? (json.data as SyncPayload) : null;
  } catch {
    return null;
  }
}

/** Pushes the current deck state to the account's synced storage. Best-effort, never throws. */
export async function pushRemoteDecks(credential: string, payload: SyncPayload): Promise<void> {
  await safeFetch('/api/decks', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
