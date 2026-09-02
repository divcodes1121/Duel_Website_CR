import { useEffect } from 'react';
import { create } from 'zustand';
import { newestReleaseId, unreadCount } from '../content/releases';
import { useAccountStore } from './accountStore';

/**
 * WHO HAS READ WHICH RELEASE NOTE.
 *
 * One string per reader: the id of the newest entry they have seen. Everything
 * above it in `RELEASES` is unread, which is the whole arithmetic.
 *
 * ── IT IS KEYED BY ACCOUNT, AND THAT IS NOT PARANOIA ──────────────────────
 *
 * `localStorage` is per BROWSER, and this project has already shipped a bug
 * from forgetting that: `royal-duels-builder` survived a sign-out, so a second
 * person signing up on one laptop saw the first person's decks and then pushed
 * them into their own cloud storage. Read state is not private the way a deck
 * is — nobody is harmed by seeing a changelog twice — but the shape of the
 * mistake is identical, and a stored map keyed by user id costs five lines and
 * cannot make it. A signed-out reader gets the `anon` slot.
 *
 * ── PER BROWSER, NOT PER ACCOUNT, AND THIS IS THE HONEST LIMIT ────────────
 *
 * Nothing here reaches the server, so reading the feed on a laptop does not
 * clear the badge on a phone. That is a real limitation and it is a deliberate
 * trade: the alternative is a column on `profiles`, which needs a migration
 * plus a column grant applied by hand in the Supabase dashboard, and the cost
 * of getting it wrong is that somebody sees a badge twice. The device limit is
 * two per account, so the blast radius is one extra reading.
 *
 * If it is ever moved server-side, `scope` is already the user id — the shape
 * does not change, only where the map is stored.
 *
 * ── FIRST SIGHT IS NOT AN ANNOUNCEMENT ────────────────────────────────────
 *
 * A reader with no stored mark is stamped with the newest id and shown NO
 * badge. Greeting a first-time visitor with "7 new things" is an announcement
 * about a product they have never used, and it teaches them the badge means
 * nothing. `unreadCount` returns 0 for a null mark; `seed()` is what writes it.
 */

const STORAGE_KEY = 'dekkies-seen-release';

/** `{ [userId | 'anon']: releaseId }`. */
type SeenMap = Record<string, string>;

function load(): SeenMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    /* Shape-checked rather than trusted, like `teamSaves.load()`. This value
       can be older than the code reading it, and a junk entry here would make
       every count wrong rather than throw somewhere it could be noticed. */
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SeenMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    // A private window, blocked site data, or a browser that throws on access.
    // No read state is a valid state; it is what a new reader has.
    return {};
  }
}

function write(map: SeenMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* Ignored on purpose, and this is the one place in this project where that
       is right. `teamSaves` reports a failed write because it is losing a
       report somebody asked to keep; losing a read mark costs one duplicate
       badge, and there is no useful thing to tell anybody about it. */
  }
}

interface WhatsNewState {
  seen: SeenMap;
  /** Unread entries for one reader. */
  unread: (scope: string) => number;
  /** Mark everything read for one reader. Called when the panel is opened. */
  markSeen: (scope: string) => void;
  /**
   * Give a reader who has never been here a mark, silently.
   *
   * Separate from `markSeen` because they are different events: one is "you
   * have read this", the other is "you were never going to be told about
   * anything that happened before you arrived". Merging them would mean the
   * first render of the app counts as opening the panel.
   */
  seed: (scope: string) => void;
}

export const useWhatsNew = create<WhatsNewState>((set, get) => ({
  seen: load(),

  unread: (scope) => unreadCount(get().seen[scope] ?? null),

  markSeen: (scope) => {
    const newest = newestReleaseId();
    if (!newest) return;
    const seen = get().seen;
    if (seen[scope] === newest) return;
    const next = { ...seen, [scope]: newest };
    write(next);
    set({ seen: next });
  },

  seed: (scope) => {
    // Only ever writes when there is nothing there. A reader who has read up
    // to an older entry must keep that mark, or opening the app would silently
    // clear their badge.
    if (get().seen[scope]) return;
    get().markSeen(scope);
  },
}));

/**
 * Which reader we are counting for, and their unread total.
 *
 * IT LIVES HERE, NOT BESIDE THE COMPONENT, because two components use it and a
 * file that exports both a hook and components breaks fast refresh. Note this
 * is the one thing in this module that imports `accountStore` — the pure
 * arithmetic is in `content/releases.ts`, which stays importable by a test
 * without constructing a Supabase client.
 *
 * SHARED BY THE TWO ENTRY POINTS ON PURPOSE. The bell in the top bar and the
 * profile menu's row both show this number, and they are on screen at the same
 * time — two counts derived two ways would eventually disagree, and a reader
 * seeing "3" in one place and nothing in the other learns to trust neither.
 */
export function useReleaseFeed() {
  /* THE READ MARK IS PER ACCOUNT, not per browser — see the note in the store.
     `anon` is a scope like any other, so a signed-out reader still gets a
     working badge rather than one that resets on every load. */
  const userId = useAccountStore((s) => s.userId);
  const scope = userId ?? 'anon';

  const unread = useWhatsNew((s) => s.unread(scope));
  const markSeen = useWhatsNew((s) => s.markSeen);
  const seed = useWhatsNew((s) => s.seed);

  /* A READER WHO HAS NEVER BEEN HERE IS STAMPED, SILENTLY. Without this the
     bell greets a first-time visitor with a count of everything ever shipped,
     which is an announcement about a product they have not used yet — and it
     is how a badge stops meaning anything. Keyed on `scope` so signing in for
     the first time seeds that account rather than inheriting `anon`'s mark. */
  useEffect(() => {
    seed(scope);
  }, [scope, seed]);

  return { unread, markRead: () => markSeen(scope) };
}
