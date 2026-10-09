import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { packText, unpackText } from './deckCodec';
import { partId, partJson, partsOf, rememberPart } from './libraryParts';

/**
 * deckStorage.ts — where the deck store keeps itself in this browser.
 *
 * IT USED TO BE ONE `localStorage` VALUE, the whole store as JSON, rewritten on
 * every change — placing a card re-serialised every saved set. At ~2 kB a
 * saved duel that is 2.25 MB at a thousand sets, in a ~5 MB allowance shared
 * with saved team analyses (up to 3 MB): the thousandth set would not have
 * fitted, and the write that failed would have thrown out of the store action
 * that made it.
 *
 * NOW THE LIBRARY IS KEPT APART, IN PARTS (`libraryParts.ts`), COMPRESSED
 * (`deckCodec.ts`):
 *
 *   royal-duels-builder          everything else, as before, plus the list of
 *                                part ids — small, and still rewritten on
 *                                every change
 *   royal-duels-lib:<part id>    one part of the library, ~300 characters a
 *                                saved set instead of ~2,250
 *
 * A part is written when it CHANGES. Saving a duel rewrites the first part
 * only; moving a card rewrites none. A thousand sets are ~0.3 MB.
 *
 * ── IT NEVER THROWS, AND IT SAYS WHEN IT COULD NOT KEEP THE LIBRARY ──────────
 *
 * A browser can still run out of room — an account with no ceiling saves until
 * it does. Then the previous list of parts is kept (stale, but whole and
 * consistent), the rest of the store is still written, and `STALE_KEY` is set.
 * `store.ts` reads that flag on the next load: A STALE LOCAL LIBRARY MUST NEVER
 * BE PUSHED OVER THE ACCOUNT'S COPY, which is exactly what a "local has
 * unsynced changes" flag would otherwise make it do. For a signed-in account
 * the account's copy is the record and this is a cache of it.
 *
 * ── THE PREVIOUS FORMAT IS STILL READ ───────────────────────────────────────
 *
 * A value written before this change has `state.library` inline. It is read as
 * it is and rewritten in parts on the first change. Nothing is migrated
 * eagerly and the persist `version` did not move: zustand sees the same slice
 * either way, so no migration can run and none can go wrong.
 *
 * ── NOTHING REPLACES A LIBRARY WITHOUT A COPY BEING KEPT ────────────────────
 *
 * Asked for in so many words before this shipped: "I don't want to lose my
 * saved sets ... make sure of that." Three things, none of which the store has
 * to remember to do:
 *
 *   1. A PART IS READ BACK BEFORE IT IS RELIED ON. It is unpacked and compared
 *      with what was packed, written, and read out of storage again, BEFORE
 *      the main value names it. A part that does not come back identical is a
 *      failed write, and the last good value stays.
 *   2. THE OLD-FORMAT VALUE IS KEPT WHEN IT IS FIRST REPLACED (`BACKUP_KEY`),
 *      byte for byte, for `KEEP_DAYS`. Put back under the main key it is read
 *      exactly as it always was.
 *   3. A LIBRARY ABOUT TO BE REPLACED BY A SHORTER ONE IS KEPT
 *      (`REPLACED_KEY`), the browser's own version of the account's shadow
 *      copy: `store.ts` hands it over before it adopts the account's library.
 *      The last-write-wins sync means a stale tab elsewhere can still shorten
 *      the account's library; this is what makes that recoverable from here.
 *
 * All three are the previous reader's decks to the next person at this
 * browser, so `forget()` removes them on sign-out, with everything else.
 */

/** The slice of the persisted state this module rearranges. */
interface WithLibrary {
  library: object[];
}

/** `localStorage`, or a stand-in with the same five members. */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export const PART_PREFIX = 'royal-duels-lib:';

/** The main value exactly as it was the moment before it was first rewritten
 *  in parts, and when that was. */
export const BACKUP_KEY = 'royal-duels-before-parts';
export const BACKUP_AT_KEY = 'royal-duels-before-parts-at';

/** The library that was here before a shorter one replaced it (packed JSON),
 *  and when. One deep, like the account's shadow copy. */
export const REPLACED_KEY = 'royal-duels-replaced';
export const REPLACED_AT_KEY = 'royal-duels-replaced-at';

/** How long a safety copy is kept. Long enough to notice and ask. */
export const KEEP_DAYS = 30;

/** Set while the library in this browser may be behind, or short of, the one
 *  in memory. Its own key: it is about this browser, and must not travel. */
export const STALE_KEY = 'royal-duels-library-stale';

export interface DeckStorage<S> extends PersistStorage<S> {
  /** Is the library stored here possibly out of date or incomplete? */
  isStale(): boolean;
  /** The library in memory is complete again (it was just replaced from the
   *  account). The next write that succeeds may clear the flag. */
  markWhole(): void;
  /** Another tab may have rewritten storage: check before trusting it. */
  invalidate(): void;
  /** Keep `library`: it is about to be replaced by a shorter one. Best effort,
   *  never throws. */
  keepReplaced(library: readonly object[]): void;
  /** The library last kept that way, if it is still here. */
  replaced(): { at: string; library: object[] } | null;
  /** Remove every safety copy. They are the signed-out reader's decks. */
  forget(): void;
}

export function deckStorage<S extends WithLibrary>(
  backend: KeyStore,
  /** The clock, so a test can let thirty days pass. */
  now: () => number = () => Date.now(),
): DeckStorage<S> {
  /** Part ids known to be stored. */
  let stored = new Set<string>();
  let scanned = false;
  /** The library last written or read, and the part ids it was stored as.
   *  `null` ids: the value on disk holds its library inline (the old format). */
  let lastLibrary: readonly object[] | null = null;
  let lastIds: string[] | null = null;
  /** The value on disk is in the old format (library inline). */
  let inline = false;
  /** The library whose parts last failed to store. */
  let refused: readonly object[] | null = null;
  /** The library read at load was missing a part: what is in memory is short,
   *  and writing it back successfully proves nothing. */
  let short = false;

  const scan = () => {
    const found = new Set<string>();
    for (let i = 0; i < backend.length; i++) {
      const k = backend.key(i);
      if (k && k.startsWith(PART_PREFIX)) found.add(k.slice(PART_PREFIX.length));
    }
    stored = found;
    scanned = true;
  };

  /* THE FLAG IS ALWAYS THERE, '0' OR '1', AND THAT IS THE POINT. It is raised
     at the exact moment storage is full — when a key that did not exist yet
     could not be created. Kept permanently, raising it replaces one character
     with another and needs no room at all. (The first cut created it on
     demand; a test that filled storage to the last character found the flag
     could not be set in the one situation it exists for.) */
  let staleNow = false;
  const setStale = (on: boolean) => {
    staleNow = on;
    const want = on ? '1' : '0';
    try {
      if (backend.getItem(STALE_KEY) !== want) backend.setItem(STALE_KEY, want);
    } catch {
      /* Only reachable when the key never existed and storage was already
         full at the first write this browser ever made. `staleNow` still
         answers for this page; nothing on disk is newer than it was. */
    }
  };
  const reserveFlag = () => {
    try {
      if (backend.getItem(STALE_KEY) === null) backend.setItem(STALE_KEY, '0');
    } catch {
      /* As above. */
    }
  };

  const remove = (...keys: string[]) => {
    for (const k of keys) {
      try {
        backend.removeItem(k);
      } catch {
        /* A copy left behind costs space, never correctness. */
      }
    }
  };

  /** Safety copies past their keep date are cleared when the page loads. */
  const sweep = () => {
    const stale = (atKey: string) => {
      try {
        const at = backend.getItem(atKey);
        return at !== null && !(now() - Date.parse(at) < KEEP_DAYS * 86_400_000);
      } catch {
        return false;
      }
    };
    if (stale(BACKUP_AT_KEY)) remove(BACKUP_KEY, BACKUP_AT_KEY);
    if (stale(REPLACED_AT_KEY)) remove(REPLACED_KEY, REPLACED_AT_KEY);
  };

  const drop = (id: string) => {
    try {
      backend.removeItem(PART_PREFIX + id);
    } catch {
      /* A part left behind costs space, never correctness. */
    }
    stored.delete(id);
  };

  /** One part read back, checked against the id it was stored under. */
  const readPart = (id: string): object[] | null => {
    const packed = backend.getItem(PART_PREFIX + id);
    if (packed === null) return null;
    const json = unpackText(packed);
    if (json === null || partId(json) !== id) return null;
    try {
      const members: unknown = JSON.parse(json);
      return Array.isArray(members) ? (members as object[]) : null;
    } catch {
      return null;
    }
  };

  return {
    getItem(name) {
      let raw: string | null;
      try {
        raw = backend.getItem(name);
      } catch {
        return null;
      }
      if (raw === null) return null;
      let value: StorageValue<S> & { state?: Record<string, unknown> };
      try {
        value = JSON.parse(raw);
      } catch {
        return null;
      }
      const state = value?.state as (Record<string, unknown> & Partial<WithLibrary>) | undefined;
      if (!state || typeof state !== 'object') return value ?? null;

      scan();
      reserveFlag();
      sweep();
      const listed = state.libraryParts;
      if (!Array.isArray(listed)) {
        // The old format: the library is inline and stays as it is.
        inline = true;
        lastIds = null;
        lastLibrary = Array.isArray(state.library) ? state.library : null;
        return value;
      }

      inline = false;
      const ids: string[] = [];
      const library: object[] = [];
      let whole = true;
      for (const id of listed) {
        const members = typeof id === 'string' ? readPart(id) : null;
        if (!members) {
          whole = false;
          continue;
        }
        rememberPart(members, id as string);
        ids.push(id as string);
        for (const m of members) library.push(m);
      }
      delete state.libraryParts;
      state.library = library;
      if (whole) {
        lastLibrary = library;
        lastIds = ids;
      } else {
        // Short. Say so, and remember nothing: the next write stores exactly
        // what is in memory, so what is on disk is at least consistent.
        short = true;
        lastLibrary = null;
        lastIds = null;
        setStale(true);
      }
      return value;
    },

    setItem(name, value) {
      const { library, ...rest } = value.state as S & WithLibrary;
      const main = (ids: string[]) =>
        JSON.stringify({ ...value, state: { ...rest, libraryParts: ids } });
      const written: string[] = [];

      /* A library that would not fit is not tried again until it changes:
         this runs on EVERY store update, and compressing the same parts into
         the same full storage on each click is a freeze per click. */
      if (library !== refused) {
        try {
          if (!scanned) scan();
          reserveFlag();
          let ids = lastIds;
          if (library !== lastLibrary || !ids) {
            const parts = partsOf(library);
            ids = [];
            for (const p of parts) {
              if (stored.has(p.id)) {
                ids.push(p.id);
                continue;
              }
              /* READ BACK BEFORE IT IS RELIED ON. Named from the JSON actually
                 being stored (not from a remembered name), unpacked and
                 compared with it, written, and read out of storage again. Any
                 difference throws, and nothing below this loop runs: the main
                 value goes on naming the parts it named before. */
              const json = partJson(p.members);
              const id = partId(json);
              const packed = packText(json);
              if (unpackText(packed) !== json) throw new Error('part does not unpack');
              backend.setItem(PART_PREFIX + id, packed);
              written.push(id);
              if (backend.getItem(PART_PREFIX + id) !== packed) throw new Error('part not stored');
              stored.add(id);
              ids.push(id);
            }
          }
          if (inline && backend.getItem(BACKUP_KEY) === null) {
            /* The first rewrite in parts. Keep the value it replaces, exactly
               as it is — if there is room; the parts above are already
               verified, so a browser too full for a second copy still moves.

               THE FIRST COPY WINS, for as long as it is kept. The old format
               can come back — a tab still running the old client writes it —
               and the move then happens again. The copy worth having is what
               was here before the new code ever touched it, not whatever was
               here the second time; a real browser check wiped the library on
               purpose, and the copy had already been replaced by the empty
               one. The account's own copy aside is written once for the same
               reason. */
            try {
              const old = backend.getItem(name);
              if (old !== null) {
                backend.setItem(BACKUP_KEY, old);
                backend.setItem(BACKUP_AT_KEY, new Date(now()).toISOString());
              }
            } catch {
              remove(BACKUP_KEY, BACKUP_AT_KEY);
            }
          }
          // The commit: from here the value on disk names these parts.
          backend.setItem(name, main(ids));
          inline = false;
          refused = null;
          lastLibrary = library;
          lastIds = ids;
          if (!short) setStale(false);
          for (const id of [...stored]) if (!ids.includes(id)) drop(id);
          return;
        } catch {
          /* Fall through. Nothing below may throw: this runs inside a store
             update, and an exception here would surface in whatever the user
             had just clicked. */
        }
        refused = library;
        // Take back what this attempt wrote and the committed value never named.
        for (const id of written) if (!lastIds || !lastIds.includes(id)) drop(id);
      }

      if (inline) {
        /* Still in the old format, so the old value is holding the room the
           parts needed. Writing the old format over itself is what this
           browser did yesterday, and loses nothing. */
        try {
          backend.setItem(name, JSON.stringify(value));
          lastLibrary = library;
          lastIds = null;
          if (!short) setStale(false);
          return;
        } catch {
          /* Not even that. Leave the last good value where it is. */
        }
        setStale(true);
        return;
      }

      // Keep the last library that was stored whole; store everything else.
      setStale(true);
      if (lastIds) {
        try {
          backend.setItem(name, main(lastIds));
        } catch {
          /* The last good value stays. */
        }
      }
    },

    removeItem(name) {
      try {
        backend.removeItem(name);
        scan();
        for (const id of [...stored]) drop(id);
        backend.removeItem(STALE_KEY);
      } catch {
        /* Nothing to do about storage that will not delete. */
      }
      remove(BACKUP_KEY, BACKUP_AT_KEY, REPLACED_KEY, REPLACED_AT_KEY);
      lastLibrary = null;
      lastIds = null;
      inline = false;
      short = false;
      refused = null;
      staleNow = false;
    },

    isStale() {
      try {
        return staleNow || backend.getItem(STALE_KEY) === '1';
      } catch {
        return staleNow;
      }
    },

    markWhole() {
      short = false;
    },

    invalidate() {
      // Parts another tab removed are gone whatever this one remembers, and
      // room it freed may be room a refused library now fits in.
      scanned = false;
      lastLibrary = null;
      refused = null;
    },

    keepReplaced(library) {
      if (library.length === 0) return;
      try {
        const json = JSON.stringify(library);
        const packed = packText(json);
        if (unpackText(packed) !== json) return;
        backend.setItem(REPLACED_KEY, packed);
        backend.setItem(REPLACED_AT_KEY, new Date(now()).toISOString());
      } catch {
        /* No room for it. The account's own shadow copy is the other net. */
        remove(REPLACED_KEY, REPLACED_AT_KEY);
      }
    },

    replaced() {
      try {
        const packed = backend.getItem(REPLACED_KEY);
        const at = backend.getItem(REPLACED_AT_KEY);
        if (packed === null || at === null) return null;
        const json = unpackText(packed);
        const library: unknown = json === null ? null : JSON.parse(json);
        return Array.isArray(library) ? { at, library: library as object[] } : null;
      } catch {
        return null;
      }
    },

    forget() {
      remove(BACKUP_KEY, BACKUP_AT_KEY, REPLACED_KEY, REPLACED_AT_KEY);
    },
  };
}

/**
 * The store's storage in a browser, or `undefined` where there is none (the
 * test runner, a browser with storage switched off) — which is what zustand's
 * own default answers there, with the same "storage is unavailable" warning.
 */
export function browserDeckStorage<S extends WithLibrary>(name: string): DeckStorage<S> | undefined {
  let backend: Storage;
  try {
    backend = localStorage;
    if (!backend) return undefined;
  } catch {
    return undefined;
  }
  const storage = deckStorage<S>(backend);
  try {
    /* Two tabs share this storage and each writes its own view of it. When the
       other one writes, what this tab believes is stored may be gone. */
    window.addEventListener('storage', (e) => {
      if (e.storageArea !== backend) return;
      if (e.key === null || e.key === name || e.key.startsWith(PART_PREFIX)) storage.invalidate();
    });
  } catch {
    /* No window: nothing else is writing. */
  }
  return storage;
}
