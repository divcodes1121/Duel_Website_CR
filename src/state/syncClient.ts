import type { DeckOwner, DuelDeckSet, SavedDeckSet } from '../types/deck';
import { supabase } from './supabase';
import { canGzip, gunzipText, gzipText } from '../utils/gzipText';
import { createDeckSync, type DeckTransport } from './deckSync';

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

/**
 * The outcome of reading this account's synced decks.
 *
 * **`empty` AND `failed` USED TO BE THE SAME VALUE, AND IT COST AN ACCOUNT ITS
 * WHOLE SAVED LIBRARY.** `pullRemoteDecks` returned `null` for a genuine
 * "nothing stored yet" AND for a network error, a non-2xx and an unparseable
 * body alike — so `decideSync` read a failed request as a brand-new account
 * and answered `seed-remote`, which pushes whatever local holds over the
 * remote. On a fresh browser local has just been reset to empty by
 * `hydrateFromRemote`, so ONE failed GET during ONE sign-in replaces the
 * account's library with nothing, and every later sign-in then adopts that
 * emptiness over the good local copy.
 *
 * The three states are distinct now and the caller must answer `failed` by
 * doing NOTHING. Not knowing is not the same as knowing there is nothing.
 */
export type RemoteRead =
  | { status: 'found'; data: SyncPayload }
  | { status: 'empty' }
  | { status: 'failed' };

/**
 * One call to `/api/decks`, for `deckSync.ts`.
 *
 * `null` for everything that is not an answer from the endpoint: no session
 * (a request never made is not an empty account), offline, DNS, CORS, an
 * abort. A status with a body nobody could parse still comes back as that
 * status — the caller only trusts a 200 it can read.
 */
const deckCall: DeckTransport = async (method, query, body) => {
  const token = await bearer();
  if (!token) return null;
  const res = await safeFetch(`/api/decks${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res) return null;
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
};

/**
 * THE SAVED LIBRARY TRAVELS IN PARTS since 2026-10-09 (`deckSync.ts`,
 * `api/decks.ts`): the one-document upload stopped at 1 MB, about 500 saved
 * duels, and said nothing when it did. One session for the tab, because it
 * remembers which parts the account already holds.
 */
const deckSync = createDeckSync<SyncPayload>(deckCall);

/** This account's synced decks. Never conflates "none" with "unreachable",
 *  and never answers with a library that is missing a part. */
export function readRemoteDecks(): Promise<RemoteRead> {
  return deckSync.read();
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
  return (await deckSync.push(payload)).ok;
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

/** One save in full, or null. A compressed report comes back as `report`. */
export async function pullTeamSave(id: string): Promise<unknown | null> {
  const res = await teamSaveCall(`&id=${encodeURIComponent(id)}`);
  if (!res?.ok) return null;
  try {
    const json = await res.json();
    if (!json?.found) return null;
    const data = json.data as Record<string, unknown> | null;
    if (data && typeof data.reportGz === 'string') {
      const { reportGz, ...rest } = data;
      return { ...rest, report: JSON.parse(await gunzipText(reportGz as string)) };
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Upload (or overwrite) one save. Whether the account accepted it.
 *
 * THE REPORT TRAVELS GZIPPED where the browser can do it: a compacted 12v12
 * is ~858 kB of JSON against the endpoint's 1 MB cap, and ~56 kB compressed.
 */
export async function pushTeamSave(save: { id: string; report?: unknown }): Promise<boolean> {
  let body: string;
  try {
    if (canGzip() && save.report !== undefined) {
      const { report, ...rest } = save;
      body = JSON.stringify({ ...rest, reportGz: await gzipText(JSON.stringify(report)) });
    } else {
      body = JSON.stringify(save);
    }
  } catch {
    body = JSON.stringify(save);
  }
  const res = await teamSaveCall(`&id=${encodeURIComponent(save.id)}`, {
    method: 'PUT',
    body,
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
