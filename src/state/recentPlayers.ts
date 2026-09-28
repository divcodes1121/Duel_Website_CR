import { useSyncExternalStore } from 'react';
import { normalizeTag } from '../utils/squadParse';

/**
 * The last players this browser opened.
 *
 * A returning visitor used to retype their own tag on every visit: the landing
 * screen offers the popular tags from `/suggest` and nothing of theirs. This
 * remembers the last `RECENT_MAX` players whose analysis actually LOADED — a
 * tag is recorded by the screen that got an answer for it, never by the
 * route, so a mistyped tag that found nobody does not sit in the list.
 *
 * PER BROWSER, IN `localStorage`, AND NEVER SENT ANYWHERE. It is a convenience
 * for whoever is at this keyboard, like the remembered rail, so it is not
 * synced with the account and a private window starts empty. Every read and
 * write is guarded: storage can be absent or throw, and the list is then just
 * empty.
 */

export interface RecentPlayer {
  /** Normalised, with the `#`. */
  tag: string;
  /** The in-game name when the screen knew it; null otherwise. */
  name: string | null;
  /** When it was last opened, ms since the epoch. */
  at: number;
}

export const RECENT_KEY = 'royal-recent-players';
export const RECENT_MAX = 8;

/**
 * The list with `entry` at the front: one row per tag, newest first, at most
 * `max`. A known name is kept when the newer visit did not carry one, because
 * "#ABC" is a worse label than the name we already had for the same player.
 */
export function pushRecent(
  list: readonly RecentPlayer[],
  entry: RecentPlayer,
  max = RECENT_MAX,
): RecentPlayer[] {
  const tag = normalizeTag(entry.tag);
  if (!tag) return list.slice(0, max);
  const previous = list.find((p) => p.tag === tag);
  const name = entry.name?.trim() || previous?.name || null;
  return [{ tag, name, at: entry.at }, ...list.filter((p) => p.tag !== tag)].slice(0, max);
}

/** A stored value, validated field by field. Anything malformed is dropped. */
export function parseRecent(raw: string | null): RecentPlayer[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: RecentPlayer[] = [];
    for (const row of data) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const tag = typeof r.tag === 'string' ? normalizeTag(r.tag) : null;
      if (!tag || out.some((p) => p.tag === tag)) continue;
      out.push({
        tag,
        name: typeof r.name === 'string' && r.name.trim() ? r.name : null,
        at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0,
      });
    }
    return out.slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ store */

const listeners = new Set<() => void>();
let cache: RecentPlayer[] | null = null;

function read(): RecentPlayer[] {
  if (cache) return cache;
  try {
    cache = parseRecent(localStorage.getItem(RECENT_KEY));
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: RecentPlayer[]) {
  cache = next;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* Storage refused (private mode, quota). The list still lives in memory
       for this tab, which is all a convenience owes anyone. */
  }
  listeners.forEach((l) => l());
}

/** Record a player whose screen just loaded. */
export function rememberPlayer(tag: string, name: string | null): void {
  const current = read();
  const next = pushRecent(current, { tag, name, at: Date.now() });
  // Nothing new (same player, same name, already first): skip the write and
  // the re-render.
  const same =
    next.length === current.length &&
    next[0]?.tag === current[0]?.tag &&
    next[0]?.name === current[0]?.name;
  if (same && current[0] && Date.now() - current[0].at < 60_000) return;
  write(next);
}

/** Empty the list. The reader's own control, beside the chips. */
export function clearRecent(): void {
  write([]);
}

/** Take one player off the list. */
export function forgetPlayer(tag: string): void {
  const norm = normalizeTag(tag);
  write(read().filter((p) => p.tag !== norm));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab opened a player: pick it up.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== RECENT_KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const EMPTY: RecentPlayer[] = [];

/** The list, newest first, re-rendering when it changes in any tab. */
export function useRecentPlayers(): RecentPlayer[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
