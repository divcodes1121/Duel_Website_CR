/**
 * Replays the admin has opened, kept in THIS browser, so the Watch button on a
 * Recent Battles row plays straight away the second time.
 *
 * WHY THE FIRST WATCH NEEDS A FILE. A stored battle has no replay in it: the
 * payload's keys are type / battleTime / isLadderTournament / arena / gameMode
 * / deckSelection / team / opponent / isHostedMatch / leagueNumber (measured,
 * `server/deck_counter.py`). Where each card landed exists only on RoyaleAPI's
 * replay page, which refuses automated reads. So the admin saves that page
 * once; what is kept here is the parsed battle (a few kilobytes), never the
 * page, and nothing is sent anywhere.
 *
 * A CONVENIENCE, NOT A RECORD: localStorage, one browser, gone with the site's
 * data. Every read and write is guarded — storage can be missing, full or
 * refused, and the board must work without it.
 */

import { replayTags, type Replay } from '../utils/replayParse';

const KEY = 'deckkies-replays';
export const REPLAY_LIBRARY_MAX = 40;

/** Two stamps further apart than this are two different battles. Wide on
 *  purpose: RoyaleAPI's stamp is ASSUMED to be Supercell's battle time, which
 *  has not been checked against a real page; too tight, and no replay would
 *  ever tie to its row. Two battles between the same two players inside four
 *  minutes is about the tightest a practice series runs. */
export const SAME_BATTLE_SECONDS = 240;

export interface ReplayEntry {
  id: string;
  openedAt: number;
  /** The Recent Battles row it was opened from, when it was. */
  battleId?: string;
  replay: Replay;
}

function valid(x: unknown): x is ReplayEntry {
  if (!x || typeof x !== 'object') return false;
  const e = x as ReplayEntry;
  return (
    typeof e.id === 'string' &&
    typeof e.openedAt === 'number' &&
    !!e.replay &&
    e.replay.v === 1 &&
    Array.isArray(e.replay.events) &&
    !!e.replay.players?.blue &&
    !!e.replay.players?.red
  );
}

export function listReplays(): ReplayEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    return [];
  }
}

function write(list: ReplayEntry[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Newest first; opening one again moves it to the top. */
export function keepReplay(replay: Replay, now = Date.now(), battleId?: string): ReplayEntry[] {
  const old = listReplays();
  const before = old.find((e) => e.id === replay.id);
  const entry: ReplayEntry = { id: replay.id, openedAt: now, replay, battleId: battleId ?? before?.battleId };
  const next = [entry, ...old.filter((e) => e.id !== replay.id)].slice(0, REPLAY_LIBRARY_MAX);
  // Full storage: drop the oldest until it fits, rather than keep nothing.
  let trimmed = next;
  while (!write(trimmed) && trimmed.length > 1) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

export function forgetReplay(id: string): ReplayEntry[] {
  const list = listReplays().filter((e) => e.id !== id);
  write(list);
  return list;
}

const norm = (t: string | null | undefined) => (t ? `#${t.replace(/^#/, '').toUpperCase()}` : null);

/**
 * Is this replay the battle on that row? The same two players, and — when both
 * sides carry a time — within `SAME_BATTLE_SECONDS`. Two friends play many
 * battles against each other, so the players alone are never enough when a
 * time can say otherwise.
 */
export function replayFits(
  replay: Replay,
  battle: { tags: [string, string]; unix: number | null },
): 'same' | 'other-time' | 'other-players' | 'unknown-players' {
  const mine = replayTags(replay).map(norm);
  if (!mine[0] || !mine[1]) return 'unknown-players';
  const want = battle.tags.map(norm);
  const samePlayers = mine.every((t) => want.includes(t)) && want.every((t) => mine.includes(t));
  if (!samePlayers) return 'other-players';
  if (replay.battleTime != null && battle.unix != null && Math.abs(replay.battleTime - battle.unix) > SAME_BATTLE_SECONDS) {
    return 'other-time';
  }
  return 'same';
}

/** The replay kept for a Recent Battles row, if there is one. */
export function findReplayFor(battle: {
  id: string;
  tags: [string, string];
  unix: number | null;
}): ReplayEntry | null {
  const list = listReplays();
  const linked = list.find((e) => e.battleId === battle.id);
  if (linked) return linked;
  // Opened before it was tied to a row: only a replay whose time agrees
  // counts, and the closest one when two do.
  if (battle.unix == null) return null;
  const unix = battle.unix;
  const close = list.filter((e) => e.replay.battleTime != null && replayFits(e.replay, battle) === 'same');
  close.sort((a, b) => Math.abs(a.replay.battleTime! - unix) - Math.abs(b.replay.battleTime! - unix));
  return close[0] ?? null;
}
