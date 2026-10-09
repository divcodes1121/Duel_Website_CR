import { describe, expect, it } from 'vitest';

import {
  BACKUP_AT_KEY,
  BACKUP_KEY,
  KEEP_DAYS,
  PART_PREFIX,
  REPLACED_AT_KEY,
  REPLACED_KEY,
  STALE_KEY,
  deckStorage,
  type KeyStore,
} from '../src/state/deckStorage';
import type { SavedDeckSet } from '../src/types/deck';
import { savedLibrary, withSaved } from './helpers/savedSets';

/* WHERE THE DECK STORE KEEPS ITSELF IN THE BROWSER (2026-10-09).
 *
 * Asked for: "try to make 1000 saved decks for everyone on the browser one".
 * As one JSON value the store is 2.25 MB at a thousand five-deck sets, in a
 * ~5 MB allowance shared with up to 3 MB of saved team analyses — it would not
 * have fitted, and the write that failed threw out of the store action. The
 * library is now compressed, in parts, beside a small main value.
 *
 * What is pinned here is what would lose saved decks if it broke: that the old
 * format is still read, that a reload gives back exactly what was stored, that
 * running out of room never throws and never leaves storage naming a part it
 * does not hold, and that a library the browser could not keep says so.
 */

const NAME = 'royal-duels-builder';

interface Slice {
  sets: { solo: { id: string } };
  mode: string;
  library: SavedDeckSet[];
  deckSlotCount: { solo: number };
  paletteFolders: unknown[];
}

const slice = (library: SavedDeckSet[], mode = 'solo'): Slice => ({
  sets: { solo: { id: 'board' } },
  mode,
  library,
  deckSlotCount: { solo: 3 },
  paletteFolders: [],
});

/** `localStorage` with a character allowance and a record of what was written. */
function fakeStorage(quota = Number.POSITIVE_INFINITY) {
  const data = new Map<string, string>();
  const writes: string[] = [];
  const used = () => {
    let n = 0;
    for (const [k, v] of data) n += k.length + v.length;
    return n;
  };
  const store: KeyStore & {
    data: Map<string, string>;
    writes: string[];
    used: () => number;
    quota: number;
  } = {
    data,
    writes,
    used,
    quota,
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) {
      const freed = data.has(k) ? k.length + data.get(k)!.length : 0;
      if (used() - freed + k.length + v.length > store.quota) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      data.set(k, v);
      writes.push(k);
    },
    removeItem: (k) => void data.delete(k),
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
  };
  return store;
}

const partKeys = (s: { data: Map<string, string> }) =>
  [...s.data.keys()].filter((k) => k.startsWith(PART_PREFIX));
/** Characters the library itself takes: the main value and its parts, not the
 *  safety copy kept beside them for a month. */
const libraryChars = (s: { data: Map<string, string> }) => {
  let n = 0;
  for (const [k, v] of s.data) if (k === NAME || k.startsWith(PART_PREFIX)) n += k.length + v.length;
  return n;
};
const mainOf = (s: { data: Map<string, string> }) => JSON.parse(s.data.get(NAME)!);
/** What a fresh page load would read. */
const reload = (s: KeyStore) => deckStorage<Slice>(s).getItem(NAME) as { state: Slice; version: number } | null;

describe('the format before this change', () => {
  it('is read exactly as it was written', () => {
    const backend = fakeStorage();
    const state = slice(savedLibrary(30));
    backend.data.set(NAME, JSON.stringify({ state, version: 9 }));
    expect(reload(backend)).toEqual({ state, version: 9 });
    expect(deckStorage<Slice>(backend).isStale()).toBe(false);
  });

  it('is rewritten in parts on the first change, and reads back the same', () => {
    const backend = fakeStorage();
    const state = slice(savedLibrary(225));
    backend.data.set(NAME, JSON.stringify({ state, version: 9 }));
    const before = backend.used();

    const storage = deckStorage<Slice>(backend);
    const loaded = storage.getItem(NAME) as { state: Slice; version: number };
    storage.setItem(NAME, { state: { ...loaded.state, mode: 'versus' }, version: 9 });

    expect(mainOf(backend).state.library).toBeUndefined();
    expect(mainOf(backend).state.libraryParts).toHaveLength(2);
    expect(partKeys(backend)).toHaveLength(2);
    expect(reload(backend)).toEqual({ state: { ...state, mode: 'versus' }, version: 9 });
    // The point of it: the same 225 sets in a fraction of the room.
    expect(libraryChars(backend)).toBeLessThan(before / 5);
  });

  it('a missing value is nothing stored, not an error', () => {
    expect(reload(fakeStorage())).toBeNull();
  });

  it('a value that is not JSON reads as nothing, as it always did', () => {
    const backend = fakeStorage();
    backend.data.set(NAME, '{ not json');
    expect(reload(backend)).toBeNull();
  });
});

describe('a reload gives back what was stored', () => {
  for (const n of [0, 1, 200, 225, 1000]) {
    it(`${n} saved sets`, () => {
      const backend = fakeStorage();
      const state = slice(savedLibrary(n));
      deckStorage<Slice>(backend).setItem(NAME, { state, version: 9 });
      expect(reload(backend)).toEqual({ state, version: 9 });
      expect(partKeys(backend)).toHaveLength(Math.ceil(n / 200));
    });
  }

  it('keeps the library in the order it was saved', () => {
    const backend = fakeStorage();
    const library = savedLibrary(450);
    deckStorage<Slice>(backend).setItem(NAME, { state: slice(library), version: 9 });
    expect(reload(backend)!.state.library.map((e) => e.name)).toEqual(library.map((e) => e.name));
  });
});

describe('a part is written when it changes, and only then', () => {
  it('a change that is not to the library writes the main value alone', () => {
    const backend = fakeStorage();
    const storage = deckStorage<Slice>(backend);
    const library = savedLibrary(450);
    storage.setItem(NAME, { state: slice(library), version: 9 });
    backend.writes.length = 0;

    // Placing a card: a new state object, the SAME library.
    storage.setItem(NAME, { state: slice(library, 'versus'), version: 9 });
    expect(backend.writes).toEqual([NAME]);
  });

  it('saving a set writes one part and the main value', () => {
    const backend = fakeStorage();
    const storage = deckStorage<Slice>(backend);
    const library = savedLibrary(450);
    storage.setItem(NAME, { state: slice(library), version: 9 });
    const before = new Set(partKeys(backend));
    backend.writes.length = 0;

    storage.setItem(NAME, { state: slice(withSaved(library)), version: 9 });
    expect(backend.writes.filter((k) => k.startsWith(PART_PREFIX))).toHaveLength(1);
    expect(backend.writes[backend.writes.length - 1]).toBe(NAME);
    // The two full parts are the same keys as before; the first was replaced.
    const after = partKeys(backend);
    expect(after).toHaveLength(3);
    expect(after.filter((k) => before.has(k))).toHaveLength(2);
  });

  it('after a reload, the first change still writes no part', () => {
    /* What was read back is new objects. Without the names handed over at
       load, the first click after every page load would compress the whole
       library to find out nothing had changed. */
    const backend = fakeStorage();
    deckStorage<Slice>(backend).setItem(NAME, { state: slice(savedLibrary(450)), version: 9 });

    const storage = deckStorage<Slice>(backend);
    const loaded = storage.getItem(NAME) as { state: Slice; version: number };
    backend.writes.length = 0;
    storage.setItem(NAME, { state: { ...loaded.state, mode: 'versus' }, version: 9 });
    expect(backend.writes).toEqual([NAME]);
  });

  it('leaves no part behind that the main value does not name', () => {
    const backend = fakeStorage();
    const storage = deckStorage<Slice>(backend);
    let library = savedLibrary(190);
    for (let i = 0; i < 25; i++) {
      library = withSaved(library);
      storage.setItem(NAME, { state: slice(library), version: 9 });
      const named = mainOf(backend).state.libraryParts.map((id: string) => PART_PREFIX + id);
      expect(partKeys(backend).sort()).toEqual([...named].sort());
    }
    // Deleting a set as well.
    storage.setItem(NAME, { state: slice(library.slice(1)), version: 9 });
    expect(partKeys(backend)).toHaveLength(mainOf(backend).state.libraryParts.length);
  });
});

describe('how much fits', () => {
  it('a thousand five-deck sets take about 0.3 MB, where they took 2.25', () => {
    const backend = fakeStorage();
    const state = slice(savedLibrary(1000, 5));
    const asJson = JSON.stringify({ state, version: 9 }).length;
    deckStorage<Slice>(backend).setItem(NAME, { state, version: 9 });
    expect(asJson).toBeGreaterThan(2_200_000);
    expect(backend.used()).toBeLessThan(340_000);
    expect(reload(backend)!.state.library).toHaveLength(1000);
  });

  it('a thousand sets fit beside a full cache of saved team analyses', () => {
    // ~5.2 M characters a site, 3 M of it already taken.
    const backend = fakeStorage(5_200_000);
    backend.data.set('royal-team-saves', 'x'.repeat(3_000_000));
    const storage = deckStorage<Slice>(backend);
    const state = slice(savedLibrary(1000, 5));
    storage.setItem(NAME, { state, version: 9 });
    expect(storage.isStale()).toBe(false);
    expect(reload(backend)!.state.library).toHaveLength(1000);
  });
});

describe('out of room', () => {
  it('never throws, whatever the storage does', () => {
    const backend = fakeStorage(0);
    const storage = deckStorage<Slice>(backend);
    expect(() => storage.setItem(NAME, { state: slice(savedLibrary(50)), version: 9 })).not.toThrow();
    expect(() => storage.setItem(NAME, { state: slice(savedLibrary(51)), version: 9 })).not.toThrow();
    expect(() => storage.removeItem(NAME)).not.toThrow();
  });

  it('keeps the last library it stored whole, stores the rest, and says so', () => {
    const backend = fakeStorage();
    const storage = deckStorage<Slice>(backend);
    const library = savedLibrary(400);
    storage.setItem(NAME, { state: slice(library), version: 9 });
    expect(storage.isStale()).toBe(false);

    // No room for one character more.
    backend.quota = backend.used();
    const more = withSaved(library);
    storage.setItem(NAME, { state: slice(more, 'versus'), version: 9 });

    expect(storage.isStale()).toBe(true);
    const back = reload(backend)!;
    // The library on disk is the last one that fitted — all of it, in order —
    expect(back.state.library).toEqual(library);
    // — and the main value names only parts that are there.
    for (const id of mainOf(backend).state.libraryParts) {
      expect(backend.data.has(PART_PREFIX + id)).toBe(true);
    }
  });

  it('does not compress the same library again on every later change', () => {
    const backend = fakeStorage();
    const storage = deckStorage<Slice>(backend);
    const library = savedLibrary(400);
    storage.setItem(NAME, { state: slice(library), version: 9 });
    backend.quota = backend.used();
    const more = withSaved(library);
    storage.setItem(NAME, { state: slice(more), version: 9 });

    let attempts = 0;
    const real = backend.setItem.bind(backend);
    backend.setItem = (k, v) => {
      if (k.startsWith(PART_PREFIX)) attempts += 1;
      real(k, v);
    };
    for (let i = 0; i < 5; i++) storage.setItem(NAME, { state: slice(more, `m${i}`), version: 9 });
    expect(attempts).toBe(0);
  });

  it('stores the library again once there is room, and stops saying so', () => {
    const backend = fakeStorage();
    const storage = deckStorage<Slice>(backend);
    const library = savedLibrary(400);
    storage.setItem(NAME, { state: slice(library), version: 9 });
    backend.quota = backend.used();
    const more = withSaved(library);
    storage.setItem(NAME, { state: slice(more), version: 9 });
    expect(storage.isStale()).toBe(true);

    backend.quota = Number.POSITIVE_INFINITY;
    const evenMore = withSaved(more);
    storage.setItem(NAME, { state: slice(evenMore), version: 9 });
    expect(storage.isStale()).toBe(false);
    expect(reload(backend)!.state.library).toEqual(evenMore);
  });

  it('still in the old format: it writes the old format, as it did yesterday', () => {
    /* The old value is holding the room the parts need. Writing it over
       itself loses nothing, and is not "stale". */
    const backend = fakeStorage();
    const state = slice(savedLibrary(300));
    backend.data.set(NAME, JSON.stringify({ state, version: 9 }));
    backend.quota = backend.used() + 2_000;

    const storage = deckStorage<Slice>(backend);
    const loaded = storage.getItem(NAME) as { state: Slice; version: number };
    const next = { ...loaded.state, mode: 'versus' };
    storage.setItem(NAME, { state: next, version: 9 });

    expect(storage.isStale()).toBe(false);
    expect(partKeys(backend)).toEqual([]);
    expect(reload(backend)).toEqual({ state: next, version: 9 });
  });
});

describe('a part that will not read back', () => {
  const stored = () => {
    const backend = fakeStorage();
    const library = savedLibrary(450);
    deckStorage<Slice>(backend).setItem(NAME, { state: slice(library), version: 9 });
    return { backend, library };
  };

  it('missing: the library reads short, and is flagged', () => {
    const { backend, library } = stored();
    backend.data.delete(partKeys(backend)[1]);
    const storage = deckStorage<Slice>(backend);
    const back = storage.getItem(NAME) as { state: Slice };
    expect(back.state.library.length).toBe(250);
    expect(back.state.library.length).toBeLessThan(library.length);
    expect(storage.isStale()).toBe(true);
  });

  it('damaged: it is not taken for a part', () => {
    const { backend } = stored();
    const key = partKeys(backend)[0];
    backend.data.set(key, backend.data.get(key)!.slice(0, -40));
    const storage = deckStorage<Slice>(backend);
    expect((storage.getItem(NAME) as { state: Slice }).state.library.length).toBeLessThan(450);
    expect(storage.isStale()).toBe(true);
  });

  it('holding other content than its name says: it is not taken for that part', () => {
    const { backend } = stored();
    const [a, b] = partKeys(backend);
    backend.data.set(a, backend.data.get(b)!);
    const storage = deckStorage<Slice>(backend);
    storage.getItem(NAME);
    expect(storage.isStale()).toBe(true);
  });

  it('writing the short library back does NOT clear the flag', () => {
    /* The flag is what stops `store.ts` pushing this library over the
       account's. Storing a short library successfully proves only that the
       short library is stored. */
    const { backend } = stored();
    backend.data.delete(partKeys(backend)[1]);
    const storage = deckStorage<Slice>(backend);
    const back = storage.getItem(NAME) as { state: Slice; version: number };
    storage.setItem(NAME, { state: { ...back.state, mode: 'versus' }, version: 9 });
    expect(storage.isStale()).toBe(true);
    // And the next page load still knows.
    expect(deckStorage<Slice>(backend).isStale()).toBe(true);
  });

  it('is cleared once the whole library is back in memory and stored', () => {
    const { backend, library } = stored();
    backend.data.delete(partKeys(backend)[1]);
    const storage = deckStorage<Slice>(backend);
    storage.getItem(NAME);
    // `store.ts` adopts the account's copy, then says so.
    storage.markWhole();
    storage.setItem(NAME, { state: slice(library), version: 9 });
    expect(storage.isStale()).toBe(false);
    expect(reload(backend)!.state.library).toEqual(library);
  });
});

describe('nothing replaces a library without a copy being kept', () => {
  /* Asked for before this shipped: "I don't want to lose my saved sets which
     are right now in my admin account, make sure of that." */
  const DAY = 86_400_000;

  const oldFormat = (n = 225) => {
    const backend = fakeStorage();
    const state = slice(savedLibrary(n));
    const raw = JSON.stringify({ state, version: 9 });
    backend.data.set(NAME, raw);
    return { backend, state, raw };
  };

  it('the old-format value is kept, byte for byte, when it is first rewritten', () => {
    const { backend, raw } = oldFormat();
    const storage = deckStorage<Slice>(backend);
    const loaded = storage.getItem(NAME) as { state: Slice; version: number };
    expect(backend.data.has(BACKUP_KEY)).toBe(false);

    storage.setItem(NAME, { state: { ...loaded.state, mode: 'versus' }, version: 9 });
    expect(backend.data.get(BACKUP_KEY)).toBe(raw);
    expect(Number.isNaN(Date.parse(backend.data.get(BACKUP_AT_KEY)!))).toBe(false);
  });

  it('put back under the main key, it reads exactly as it did before', () => {
    const { backend, state } = oldFormat();
    const storage = deckStorage<Slice>(backend);
    const loaded = storage.getItem(NAME) as { state: Slice; version: number };
    storage.setItem(NAME, { state: { ...loaded.state, library: [] }, version: 9 });
    expect(reload(backend)!.state.library).toEqual([]);

    // The recovery: one assignment.
    backend.data.set(NAME, backend.data.get(BACKUP_KEY)!);
    expect(reload(backend)).toEqual({ state, version: 9 });
  });

  it('is not overwritten by later changes', () => {
    const { backend, raw } = oldFormat();
    const storage = deckStorage<Slice>(backend);
    const loaded = storage.getItem(NAME) as { state: Slice; version: number };
    storage.setItem(NAME, { state: loaded.state, version: 9 });
    storage.setItem(NAME, { state: { ...loaded.state, library: withSaved(loaded.state.library) }, version: 9 });
    storage.setItem(NAME, { state: { ...loaded.state, library: [] }, version: 9 });
    expect(backend.data.get(BACKUP_KEY)).toBe(raw);
  });

  it('the FIRST copy wins: the old format coming back does not replace it', () => {
    /* Found in a real browser: the library was emptied in the old format on
       purpose, the page moved it to parts again, and the copy that was
       supposed to bring the 225 sets back held the empty library instead. */
    const { backend, raw } = oldFormat();
    const first = deckStorage<Slice>(backend);
    const loaded = first.getItem(NAME) as { state: Slice; version: number };
    first.setItem(NAME, { state: loaded.state, version: 9 });
    expect(backend.data.get(BACKUP_KEY)).toBe(raw);

    // A tab still running the old client writes the old format over it —
    // with nothing in it.
    for (const k of partKeys(backend)) backend.data.delete(k);
    backend.data.set(NAME, JSON.stringify({ state: slice([]), version: 9 }));

    // The next page load moves THAT to parts.
    const second = deckStorage<Slice>(backend);
    const again = second.getItem(NAME) as { state: Slice; version: number };
    second.setItem(NAME, { state: { ...again.state, mode: 'versus' }, version: 9 });
    expect(mainOf(backend).state.libraryParts).toEqual([]);
    // The copy is still the 225 sets.
    expect(backend.data.get(BACKUP_KEY)).toBe(raw);
    backend.data.set(NAME, backend.data.get(BACKUP_KEY)!);
    expect(reload(backend)!.state.library).toHaveLength(225);
  });

  it('a browser with no room for the copy still moves to parts', () => {
    const { backend } = oldFormat(300);
    // Room for the parts, not for a second copy of the old value.
    backend.quota = backend.used() + 150_000;
    const storage = deckStorage<Slice>(backend);
    const loaded = storage.getItem(NAME) as { state: Slice; version: number };
    storage.setItem(NAME, { state: { ...loaded.state, mode: 'versus' }, version: 9 });
    expect(backend.data.has(BACKUP_KEY)).toBe(false);
    expect(backend.data.has(BACKUP_AT_KEY)).toBe(false);
    expect(mainOf(backend).state.libraryParts).toHaveLength(2);
    expect(reload(backend)!.state.library).toHaveLength(300);
  });

  it('a browser that was never in the old format keeps no such copy', () => {
    const backend = fakeStorage();
    deckStorage<Slice>(backend).setItem(NAME, { state: slice(savedLibrary(30)), version: 9 });
    expect(backend.data.has(BACKUP_KEY)).toBe(false);
  });

  it(`is cleared after ${KEEP_DAYS} days, and not a day sooner`, () => {
    const { backend } = oldFormat();
    let clock = Date.parse('2026-10-09T12:00:00Z');
    const first = deckStorage<Slice>(backend, () => clock);
    const loaded = first.getItem(NAME) as { state: Slice; version: number };
    first.setItem(NAME, { state: loaded.state, version: 9 });

    clock += (KEEP_DAYS - 1) * DAY;
    deckStorage<Slice>(backend, () => clock).getItem(NAME);
    expect(backend.data.has(BACKUP_KEY)).toBe(true);

    clock += 2 * DAY;
    deckStorage<Slice>(backend, () => clock).getItem(NAME);
    expect(backend.data.has(BACKUP_KEY)).toBe(false);
    expect(backend.data.has(BACKUP_AT_KEY)).toBe(false);
    // The library itself is untouched by that.
    expect(reload(backend)!.state.library).toHaveLength(225);
  });

  describe('a part is read back before it is relied on', () => {
    /** Storage that quietly keeps something other than what it was given. */
    const lossy = (backend: ReturnType<typeof fakeStorage>) => {
      const real = backend.setItem.bind(backend);
      backend.setItem = (k, v) => real(k, k.startsWith(PART_PREFIX) ? v.slice(0, -1) : v);
    };

    it('from the old format: the old value stays, whole, and nothing is flagged', () => {
      const { backend, state } = oldFormat();
      lossy(backend);
      const storage = deckStorage<Slice>(backend);
      const loaded = storage.getItem(NAME) as { state: Slice; version: number };
      expect(() => storage.setItem(NAME, { state: { ...loaded.state, mode: 'versus' }, version: 9 })).not.toThrow();
      // Never committed to parts it could not read back.
      expect(mainOf(backend).state.libraryParts).toBeUndefined();
      expect(partKeys(backend)).toEqual([]);
      expect(reload(backend)).toEqual({ state: { ...state, mode: 'versus' }, version: 9 });
      expect(storage.isStale()).toBe(false);
    });

    it('already in parts: the last good library stays, and it is flagged', () => {
      const backend = fakeStorage();
      const storage = deckStorage<Slice>(backend);
      const library = savedLibrary(450);
      storage.setItem(NAME, { state: slice(library), version: 9 });
      lossy(backend);
      storage.setItem(NAME, { state: slice(withSaved(library)), version: 9 });
      expect(storage.isStale()).toBe(true);
      expect(reload(backend)!.state.library).toEqual(library);
      for (const id of mainOf(backend).state.libraryParts) {
        expect(backend.data.has(PART_PREFIX + id)).toBe(true);
      }
    });
  });

  describe('the library a shorter one replaced', () => {
    it('is kept, and comes back exactly', () => {
      const backend = fakeStorage();
      const storage = deckStorage<Slice>(backend);
      const library = savedLibrary(226);
      storage.keepReplaced(library);
      const kept = storage.replaced();
      expect(kept?.library).toEqual(library);
      expect(Number.isNaN(Date.parse(kept!.at))).toBe(false);
      // And a later page load can still read it.
      expect(deckStorage<Slice>(backend).replaced()?.library).toHaveLength(226);
    });

    it('takes a fraction of the room the library does as JSON', () => {
      const backend = fakeStorage();
      const library = savedLibrary(226);
      deckStorage<Slice>(backend).keepReplaced(library);
      expect(backend.data.get(REPLACED_KEY)!.length).toBeLessThan(JSON.stringify(library).length / 5);
    });

    it('is one deep: the latest replaces the one before', () => {
      const backend = fakeStorage();
      const storage = deckStorage<Slice>(backend);
      storage.keepReplaced(savedLibrary(10));
      storage.keepReplaced(savedLibrary(40));
      expect(storage.replaced()?.library).toHaveLength(40);
    });

    it('nothing to keep, nothing kept', () => {
      const backend = fakeStorage();
      const storage = deckStorage<Slice>(backend);
      storage.keepReplaced([]);
      expect(storage.replaced()).toBeNull();
      expect(backend.data.size).toBe(0);
    });

    it('no room for it: no throw, and no half of it left behind', () => {
      const backend = fakeStorage(100);
      const storage = deckStorage<Slice>(backend);
      expect(() => storage.keepReplaced(savedLibrary(200))).not.toThrow();
      expect(backend.data.has(REPLACED_KEY)).toBe(false);
      expect(backend.data.has(REPLACED_AT_KEY)).toBe(false);
      expect(storage.replaced()).toBeNull();
    });

    it(`is cleared after ${KEEP_DAYS} days`, () => {
      const backend = fakeStorage();
      let clock = Date.parse('2026-10-09T12:00:00Z');
      const storage = deckStorage<Slice>(backend, () => clock);
      storage.setItem(NAME, { state: slice(savedLibrary(3)), version: 9 });
      storage.keepReplaced(savedLibrary(226));
      clock += (KEEP_DAYS + 1) * DAY;
      const later = deckStorage<Slice>(backend, () => clock);
      later.getItem(NAME);
      expect(later.replaced()).toBeNull();
      expect(backend.data.has(REPLACED_KEY)).toBe(false);
    });
  });

  it('`forget` removes every copy and nothing else', () => {
    const { backend } = oldFormat();
    const storage = deckStorage<Slice>(backend);
    const loaded = storage.getItem(NAME) as { state: Slice; version: number };
    storage.setItem(NAME, { state: loaded.state, version: 9 });
    storage.keepReplaced(savedLibrary(5));
    const library = reload(backend)!.state.library;

    storage.forget();
    for (const k of [BACKUP_KEY, BACKUP_AT_KEY, REPLACED_KEY, REPLACED_AT_KEY]) {
      expect(backend.data.has(k)).toBe(false);
    }
    expect(reload(backend)!.state.library).toEqual(library);
  });
});

describe('two tabs', () => {
  it('puts back parts another tab removed, once it is told storage changed', () => {
    const backend = fakeStorage();
    const mine = deckStorage<Slice>(backend);
    const library = savedLibrary(450);
    mine.setItem(NAME, { state: slice(library), version: 9 });

    // Another tab stores ITS library, which clears mine away.
    const theirs = deckStorage<Slice>(backend);
    theirs.setItem(NAME, { state: slice(savedLibrary(3, 5)), version: 9 });
    expect(partKeys(backend)).toHaveLength(1);

    // The `storage` event, then any change at all in this tab.
    mine.invalidate();
    mine.setItem(NAME, { state: slice(library, 'versus'), version: 9 });
    expect(reload(backend)!.state.library).toEqual(library);
    expect(mine.isStale()).toBe(false);
  });
});

describe('clearing', () => {
  it('removes the main value, every part and the flag', () => {
    const backend = fakeStorage();
    const storage = deckStorage<Slice>(backend);
    storage.setItem(NAME, { state: slice(savedLibrary(450)), version: 9 });
    backend.data.set(STALE_KEY, '1');
    backend.data.set('royal-duels-theme', 'dark');
    storage.removeItem(NAME);
    expect([...backend.data.keys()]).toEqual(['royal-duels-theme']);
  });
});
