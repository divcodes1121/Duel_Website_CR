/**
 * The shared replay library, from the browser's side (`api/replays.ts`).
 *
 * Reads (which of a player's battles have a replay, and a replay) are an
 * admin's while `REPLAYS_FOR` is 'admin'; writes always are. One import per
 * battle, after which it plays from our server — no RoyaleAPI, no file.
 *
 * `/api/*` does not run under `vite dev`, so locally every read answers
 * "nothing shared" and every write reports itself unreachable; the screen
 * falls back to the copy kept in this browser.
 */

import type { Replay } from '../utils/replayParse';
import { coachToken } from './coachToken';

/** WHO WATCHES: 'admin' (2026-11-13, "revert back to only admin") or
 *  'everyone'. Same as the server's `REPLAYS_READ_BY` (test-held). */
export const REPLAYS_FOR: 'admin' | 'everyone' = 'admin';

/** Same as the server's `REPLAYS_PER_PLAYER` (a test holds them equal). */
export const REPLAYS_PER_PLAYER = 25;

const TAG = /^[0289PYLQGRJCUV]{3,14}$/;
const STAMP = /^\d{8}T\d{6}$/;

function bareTag(t: string): string | null {
  const s = String(t ?? '').trim().replace(/^%23/i, '').replace(/^#/, '').toUpperCase();
  return TAG.test(s) ? s : null;
}

/**
 * The key of a battle: both tags sorted, no '#', and Supercell's stamp to the
 * second. Same rule as the server's `battleKey` (a test holds them equal).
 */
export function battleKeyFor(a: string, b: string, battleTime: string): string | null {
  const x = bareTag(a);
  const y = bareTag(b);
  const stamp = String(battleTime ?? '').slice(0, 15);
  if (!x || !y || x === y || !STAMP.test(stamp)) return null;
  const [p, q] = x < y ? [x, y] : [y, x];
  return `${p}~${q}~${stamp}`;
}

/** The battles of a player that have a shared replay. Empty on any failure. */
/** The sign-in header a read carries while reads are an admin's; null when
 *  such a read cannot be made (no session). */
async function readHeaders(): Promise<Record<string, string> | null> {
  if (REPLAYS_FOR === 'everyone') return {};
  const token = await coachToken();
  return token ? { Authorization: `Bearer ${token}` } : null;
}

export async function fetchPlayerReplays(tag: string): Promise<string[]> {
  const t = bareTag(tag);
  if (!t) return [];
  const headers = await readHeaders();
  if (!headers) return [];
  try {
    const res = await fetch(`/api/replays?player=${t}`, { headers });
    if (!res.ok) return [];
    const json = (await res.json()) as { battles?: unknown };
    return Array.isArray(json.battles) ? json.battles.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export async function fetchSharedReplay(key: string): Promise<Replay | null> {
  const headers = await readHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`/api/replays?key=${encodeURIComponent(key)}`, { headers });
    if (!res.ok) return null;
    const json = (await res.json()) as { replay?: Replay };
    return json.replay && json.replay.v === 1 ? json.replay : null;
  } catch {
    return null;
  }
}

export type ShareProblem =
  | 'unreachable'
  | 'sign_in'
  | 'admins_only'
  | 'other_players'
  | 'too_old'
  | 'library_full'
  | 'bad_replay';

/** One line each, said to the admin who imported. */
export const SHARE_PROBLEM_TEXT: Record<ShareProblem, string> = {
  unreachable: 'Kept in this browser only — the shared library could not be reached.',
  sign_in: 'Kept in this browser only — sign in again to share it.',
  admins_only: 'Kept in this browser only — only an admin can share a replay.',
  other_players: 'Not shared: that replay is of two other players.',
  too_old: `Not shared: it is older than both players’ ${REPLAYS_PER_PLAYER} newest replays.`,
  library_full: 'Not shared: the shared library is full.',
  bad_replay: 'Not shared: the replay could not be stored.',
};

export async function shareReplay(key: string, replay: Replay): Promise<{ ok: true } | { ok: false; reason: ShareProblem }> {
  const token = await coachToken();
  if (!token) return { ok: false, reason: 'sign_in' };
  try {
    const res = await fetch(`/api/replays?key=${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ replay }),
    });
    if (res.ok) return { ok: true };
    const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    if (error && error in SHARE_PROBLEM_TEXT) return { ok: false, reason: error as ShareProblem };
    return { ok: false, reason: res.status === 404 ? 'unreachable' : 'bad_replay' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

export async function unshareReplay(key: string): Promise<boolean> {
  const token = await coachToken();
  if (!token) return false;
  try {
    const res = await fetch(`/api/replays?key=${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
