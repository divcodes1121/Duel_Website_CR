import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deckRoute, type DeckKV } from '../api/decks';
import type { PlayedGame } from '../src/state/duelImport';
import type { SavedDeckSet } from '../src/types/deck';
import { savedLibrary, savedSet } from './helpers/savedSets';

/* THE WHOLE LOOP, THROUGH PAGE LOADS (2026-10-09).
 *
 * The real store, the real browser storage (`deckStorage.ts`), the real sync
 * policy and client (`syncPolicy.ts`, `deckSync.ts`) and the real endpoint
 * (`deckRoute`) — with a stand-in `localStorage`, an in-memory database and a
 * stand-in account. A "page load" is the store module imported fresh over the
 * same storage, which is what a reload is.
 *
 * The other suites prove each piece. This one is for what has actually lost
 * saved decks here, three times: a failure in the JOIN — a push that did not
 * land followed by a load that trusted the wrong copy. The first test is the
 * account this was built for: 225 sets saved before any of it existed.
 */

const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';

const NAME = 'royal-duels-builder';
const PART_PREFIX = 'royal-duels-lib:';
const OWNER_KEY = 'royal-duels-deck-owner';
const PENDING_KEY = 'royal-duels-sync-pending';
const STALE_KEY = 'royal-duels-library-stale';
const BACKUP_KEY = 'royal-duels-before-parts';
const REPLACED_KEY = 'royal-duels-replaced';

const V1 = `deck-data:user:${USER}`;
const HEAD = `deck-data:user:${USER}:v2`;

const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function fakeLocalStorage() {
  const data = new Map<string, string>();
  const store = {
    data,
    quota: Number.POSITIVE_INFINITY,
    used() {
      let n = 0;
      for (const [k, v] of data) n += k.length + v.length;
      return n;
    },
    getItem: (k: string) => data.get(k) ?? null,
    setItem(k: string, v: string) {
      const freed = data.has(k) ? k.length + data.get(k)!.length : 0;
      if (store.used() - freed + k.length + v.length > store.quota) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
  };
  return store;
}
type FakeStorage = ReturnType<typeof fakeLocalStorage>;

function memoryKV() {
  const data = new Map<string, unknown>();
  const ttl = new Map<string, number>();
  const kv: DeckKV & { data: Map<string, unknown>; ttl: Map<string, number> } = {
    data,
    ttl,
    get: async (k) => clone(data.get(k)) ?? null,
    mget: async (keys) => keys.map((k) => clone(data.get(k)) ?? null),
    set: async (k, v, opts) => {
      if (opts?.nx && data.has(k)) return false;
      data.set(k, clone(v));
      if (opts?.ex) ttl.set(k, opts.ex);
      else ttl.delete(k);
      return true;
    },
    del: async (keys) => {
      for (const k of keys) data.delete(k);
    },
    expire: async (k, s) => {
      if (data.has(k)) ttl.set(k, s);
    },
    hgetall: async (k) => (data.has(k) ? (clone(data.get(k)) as Record<string, unknown>) : null),
    hset: async (k, v) => void data.set(k, { ...((data.get(k) as object) ?? {}), ...clone(v) }),
    hdel: async (k, fields) => {
      const h = { ...((data.get(k) as Record<string, unknown>) ?? {}) };
      for (const f of fields) delete h[f];
      data.set(k, h);
    },
  };
  return kv;
}
type MemoryKV = ReturnType<typeof memoryKV>;

/** The network between this browser and the endpoint. */
interface Net {
  /** Requests never arrive. */
  offline: boolean;
  /** Every request sent, as `METHOD ?query`. */
  log: string[];
  admin: boolean;
  /** How long each request takes, in (fake) milliseconds. */
  delay: number;
  /** Commits in the air right now, and requests that started during one. */
  committing: number;
  crossed: number;
}

const settle = () => vi.advanceTimersByTimeAsync(0);
/** Past the store's 1.5 s push debounce. */
const afterDebounce = () => vi.advanceTimersByTimeAsync(1700);

/** One page load: the store imported fresh over this browser's storage. */
async function load(storage: FakeStorage, kv: MemoryKV, net: Net, signedInAs: string | null) {
  vi.resetModules();
  (globalThis as { localStorage?: unknown }).localStorage = storage;

  type Account = { userId: string | null; ready: boolean };
  let state: Account = { userId: null, ready: false };
  const listeners = new Set<(s: Account, p: Account) => void>();
  const account = {
    getState: () => state,
    subscribe: (fn: (s: Account, p: Account) => void) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    setState(patch: Partial<Account>) {
      const prev = state;
      state = { ...state, ...patch };
      for (const fn of [...listeners]) fn(state, prev);
    },
  };

  vi.doMock('../src/state/accountStore', () => ({ useAccountStore: account }));
  vi.doMock('../src/state/syncClient', async () => {
    // The real client, with the real endpoint where `fetch` would be.
    const { createDeckSync } = await import('../src/state/deckSync');
    const sync = createDeckSync<{ sets: unknown; library: object[] }>(async (method, query, body) => {
      const user = state.userId;
      if (!user || net.offline) return null;
      net.log.push(`${method} ${query}`);
      // A push is its parts and THEN its commit, so nothing of the next push
      // may start while a commit is still on its way.
      if (net.committing > 0) net.crossed += 1;
      const commit = method === 'PUT' && query === '?v=2';
      if (commit) net.committing += 1;
      try {
        if (net.delay > 0) await new Promise((done) => setTimeout(done, net.delay));
        const out = await deckRoute(
          {
            method,
            v2: /[?&]v=2(&|$)/.test(query),
            part: /[?&]part=([^&]+)/.exec(query)?.[1] ?? null,
            bare: /[?&]bare=1(&|$)/.test(query),
            body: clone(body),
          },
          user,
          kv,
          async () => net.admin,
        );
        return { status: out.status, json: clone(out.json) };
      } finally {
        if (commit) net.committing -= 1;
      }
    });
    return {
      readRemoteDecks: () => sync.read(),
      pushRemoteDecks: async (payload: { sets: unknown; library: object[] }) =>
        (await sync.push(payload)).ok,
    };
  });

  const { useBuilderStore } = await import('../src/state/store');
  // The session is restored (or found to be absent), as Supabase does it.
  account.setState({ ready: true, userId: signedInAs });
  await settle();
  return {
    S: () => useBuilderStore.getState(),
    signOut: async () => {
      account.setState({ userId: null });
      await settle();
    },
    signIn: async (id: string) => {
      account.setState({ userId: id });
      await settle();
    },
  };
}

/** A played duel, in the shape the Save duel button hands over. */
function duel(n: number): PlayedGame[] {
  const s = savedSet(n);
  return [0, 1, 2].map((i) => ({
    cards: s.blue!.decks[i].slots as string[],
    opponent: { cards: s.red!.decks[i].slots as string[] },
  }));
}

/** What the store kept in this browser before this change: one JSON value.
 *  (The boards are left out; the store fills in empty ones, as it does for any
 *  stored value missing a collection.) */
function oldFormat(storage: FakeStorage, library: SavedDeckSet[], owner = USER) {
  storage.data.set(
    NAME,
    JSON.stringify({
      state: {
        mode: 'versus',
        library,
        deckSlotCount: { solo: 3, blue: 3, red: 3 },
        paletteFolders: [],
      },
      version: 9,
    }),
  );
  storage.data.set(OWNER_KEY, owner);
}

/** What the account held before this change: one value. */
function oldAccount(kv: MemoryKV, library: SavedDeckSet[]) {
  kv.data.set(V1, {
    library,
    deckSlotCount: { solo: 3, blue: 3, red: 3 },
    paletteFolders: [],
  });
}

/**
 * A browser that has an account's library STORED IN PARTS: one browser seeds
 * the account, a second signs in and takes it down. (The first is still in the
 * old format — a load that changes nothing writes nothing.)
 */
async function syncedBrowser(count: number) {
  const kv = memoryKV();
  const seed = fakeLocalStorage();
  oldFormat(seed, savedLibrary(count));
  await load(seed, kv, net(), USER);
  await afterDebounce();
  const storage = fakeLocalStorage();
  const page = await load(storage, kv, net(), USER);
  await afterDebounce();
  return { storage, kv, page };
}

const net = (over: Partial<Net> = {}): Net => ({
  offline: false,
  log: [],
  admin: false,
  delay: 0,
  committing: 0,
  crossed: 0,
  ...over,
});
/** Does this browser think it holds changes the account has not accepted? */
const pending = (s: FakeStorage) => s.data.get(PENDING_KEY) === '1';
const partKeys = (s: FakeStorage) => [...s.data.keys()].filter((k) => k.startsWith(PART_PREFIX));
const accountCount = (kv: MemoryKV) =>
  (kv.data.get(HEAD) as { library?: { count?: number } } | undefined)?.library?.count;
const names = (lib: readonly SavedDeckSet[]) => lib.map((e) => e.name);

const realLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.doUnmock('../src/state/accountStore');
  vi.doUnmock('../src/state/syncClient');
  if (realLocalStorage) Object.defineProperty(globalThis, 'localStorage', realLocalStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('a load that changes nothing', () => {
  it('writes nothing — an old-format browser stays as it is until something changes', async () => {
    const storage = fakeLocalStorage();
    const kv = memoryKV();
    oldFormat(storage, savedLibrary(60));
    const before = storage.data.get(NAME);
    const page = await load(storage, kv, net(), USER);
    await afterDebounce();
    // The account was empty, so this browser's copy seeded it...
    expect(accountCount(kv)).toBe(60);
    // ...and the browser's own copy was not touched.
    expect(storage.data.get(NAME)).toBe(before);
    expect(partKeys(storage)).toEqual([]);

    page.S().saveDuelPlayed(duel(900), Number.POSITIVE_INFINITY);
    expect(partKeys(storage)).toHaveLength(1);
    expect(JSON.parse(storage.data.get(NAME)!).state.library).toBeUndefined();
  });
});

describe('225 sets saved before any of this existed', () => {
  const start = () => {
    const storage = fakeLocalStorage();
    const kv = memoryKV();
    const library = savedLibrary(225);
    oldFormat(storage, library);
    oldAccount(kv, library);
    return { storage, kv, library };
  };

  it('are all there after the first load, in the order they were saved', async () => {
    const { storage, kv, library } = start();
    const page = await load(storage, kv, net({ admin: true }), USER);
    expect(names(page.S().library)).toEqual(names(library));
    expect(page.S().library).toEqual(library);
  });

  it('that load writes nothing to the account', async () => {
    const { storage, kv } = start();
    const n = net({ admin: true });
    await load(storage, kv, n, USER);
    await afterDebounce();
    expect(n.log.filter((l) => l.startsWith('PUT'))).toEqual([]);
    expect(kv.data.has(HEAD)).toBe(false);
  });

  it('are stored in this browser in parts from then on, in a fraction of the room', async () => {
    const { storage, kv } = start();
    const before = storage.used();
    await load(storage, kv, net({ admin: true }), USER);
    const main = JSON.parse(storage.data.get(NAME)!);
    expect(main.state.library).toBeUndefined();
    expect(main.state.libraryParts).toHaveLength(2);
    expect(partKeys(storage)).toHaveLength(2);
    const inParts =
      storage.data.get(NAME)!.length + partKeys(storage).reduce((n, k) => n + storage.data.get(k)!.length, 0);
    expect(inParts).toBeLessThan(before / 5);
  });

  it('and the value they were stored in before is kept beside them, untouched', async () => {
    const { storage, kv } = start();
    const original = storage.data.get(NAME)!;
    await load(storage, kv, net({ admin: true }), USER);
    expect(storage.data.get(BACKUP_KEY)).toBe(original);
  });

  it('the account’s old value is copied aside for good at the first save', async () => {
    const { storage, kv, library } = start();
    const page = await load(storage, kv, net({ admin: true }), USER);
    page.S().saveDuelPlayed(duel(900), Number.POSITIVE_INFINITY);
    await afterDebounce();
    const kept = kv.data.get(`deck-backup:user:${USER}:before-parts`) as { library: unknown[] };
    expect(kept.library).toEqual(library);
    expect(kv.ttl.has(`deck-backup:user:${USER}:before-parts`)).toBe(false);
  });

  it('saving one more: 226 here, 226 on the account, 226 after a reload', async () => {
    const { storage, kv, library } = start();
    const n = net({ admin: true });
    const page = await load(storage, kv, n, USER);

    expect(page.S().saveDuelPlayed(duel(900), Number.POSITIVE_INFINITY)).toMatchObject({ ok: true });
    expect(page.S().library).toHaveLength(226);
    await afterDebounce();
    expect(accountCount(kv)).toBe(226);
    expect(pending(storage)).toBe(false);
    // The old value is still there, as the copy a rollback would read.
    expect((kv.data.get(V1) as { library: unknown[] }).library).toHaveLength(225);
    expect(kv.ttl.get(V1)).toBe(60 * 60 * 24 * 90);

    n.log.length = 0;
    const again = await load(storage, kv, n, USER);
    expect(again.S().library).toHaveLength(226);
    expect(names(again.S().library).slice(1)).toEqual(names(library));
    await afterDebounce();
    // A reload sends nothing, and fetches nothing it already has: the head
    // alone, because every part it names is stored in this browser.
    expect(n.log).toEqual(['GET ?v=2&bare=1']);
  });

  it('a set saved on the phone costs the desktop one part on its next load', async () => {
    const { storage, kv } = start();
    const desk = await load(storage, kv, net({ admin: true }), USER);
    desk.S().saveDuelPlayed(duel(900), Number.POSITIVE_INFINITY);
    await afterDebounce();

    const phone = await load(fakeLocalStorage(), kv, net({ admin: true }), USER);
    phone.S().saveDuelPlayed(duel(901), Number.POSITIVE_INFINITY);
    await afterDebounce();

    const n = net({ admin: true });
    const again = await load(storage, kv, n, USER);
    expect(again.S().library).toHaveLength(227);
    expect(again.S().library[0].name).toBe('Duel Deck 227');
    expect(n.log.filter((l) => l.includes('part='))).toHaveLength(1);
  });

  it('and they are on another device', async () => {
    const { storage, kv } = start();
    const page = await load(storage, kv, net({ admin: true }), USER);
    page.S().saveDuelPlayed(duel(900), Number.POSITIVE_INFINITY);
    await afterDebounce();

    const phone = await load(fakeLocalStorage(), kv, net({ admin: true }), USER);
    expect(phone.S().library).toHaveLength(226);
    expect(phone.S().library[0].name).toBe('Duel Deck 226');
  });
});

describe('past the old ceiling', () => {
  it('an admin keeps saving past 500, and past 1,000', async () => {
    const storage = fakeLocalStorage();
    const kv = memoryKV();
    const library = savedLibrary(1199);
    oldFormat(storage, library);
    const n = net({ admin: true });
    // Nothing on the account yet: this browser's copy seeds it.
    const page = await load(storage, kv, n, USER);
    await afterDebounce();
    expect(accountCount(kv)).toBe(1199);

    page.S().saveDuelPlayed(duel(5000), Number.POSITIVE_INFINITY);
    await afterDebounce();
    expect(accountCount(kv)).toBe(1200);

    const phone = await load(fakeLocalStorage(), kv, net({ admin: true }), USER);
    expect(phone.S().library).toHaveLength(1200);
    // Six full parts, well inside what a browser allows. (The old-format
    // value kept beside them for a month is not the library's own size.)
    expect(partKeys(storage)).toHaveLength(6);
    const inParts =
      storage.data.get(NAME)!.length + partKeys(storage).reduce((n, k) => n + storage.data.get(k)!.length, 0);
    expect(inParts).toBeLessThan(500_000);
  });

  it('for everyone else the account refuses the 1,001st, and this browser keeps it', async () => {
    /* The screen stops a save at the limit before it happens. This is the
       endpoint holding the same line if something gets past the screen — and
       the sync policy then keeping the browser's copy instead of adopting the
       account's shorter one. */
    const storage = fakeLocalStorage();
    const kv = memoryKV();
    oldFormat(storage, savedLibrary(1000));
    const n = net();
    const page = await load(storage, kv, n, USER);
    await afterDebounce();
    expect(accountCount(kv)).toBe(1000);

    page.S().saveDuelPlayed(duel(5000), Number.POSITIVE_INFINITY);
    await afterDebounce();
    expect(accountCount(kv)).toBe(1000);
    expect(pending(storage)).toBe(true);

    const again = await load(storage, kv, n, USER);
    expect(again.S().library).toHaveLength(1001);
    expect(accountCount(kv)).toBe(1000);
  });
});

describe('a push that did not land', () => {
  it('is not lost by the next load, and lands when the account can be reached', async () => {
    const storage = fakeLocalStorage();
    const kv = memoryKV();
    const n = net();
    const page = await load(storage, kv, n, USER);
    page.S().saveDuelPlayed(duel(1), Number.POSITIVE_INFINITY);
    await afterDebounce();
    expect(accountCount(kv)).toBe(1);

    n.offline = true;
    page.S().saveDuelPlayed(duel(2), Number.POSITIVE_INFINITY);
    await afterDebounce();
    expect(accountCount(kv)).toBe(1);
    expect(pending(storage)).toBe(true);

    // Reload while still offline: the read fails, nothing changes.
    const offline = await load(storage, kv, n, USER);
    expect(offline.S().library).toHaveLength(2);

    n.offline = false;
    const online = await load(storage, kv, n, USER);
    await afterDebounce();
    expect(online.S().library).toHaveLength(2);
    expect(accountCount(kv)).toBe(2);
    expect(pending(storage)).toBe(false);
  });

  it('while the account cannot be read, edits are kept here and nothing is sent', async () => {
    const storage = fakeLocalStorage();
    const kv = memoryKV();
    const first = await load(storage, kv, net(), USER);
    first.S().saveDuelPlayed(duel(1), Number.POSITIVE_INFINITY);
    await afterDebounce();

    const n = net({ offline: true });
    const page = await load(storage, kv, n, USER);
    n.offline = false; // The read already failed; the page does not know better.
    page.S().saveDuelPlayed(duel(2), Number.POSITIVE_INFINITY);
    await afterDebounce();
    expect(n.log).toEqual([]);
    expect(accountCount(kv)).toBe(1);
    expect(page.S().library).toHaveLength(2);
  });

  it('a save made while a push is still going out is sent after it, not across it', async () => {
    /* A push is several requests now. On a slow connection the next change's
       timer fires while one is in flight; two at once could land out of order
       and leave the account on the older state with nothing marked pending. */
    const storage = fakeLocalStorage();
    const kv = memoryKV();
    const n = net();
    const page = await load(storage, kv, n, USER);
    await afterDebounce();
    n.delay = 1200;
    n.log.length = 0;

    page.S().saveDuelPlayed(duel(1), Number.POSITIVE_INFINITY);
    // Its push starts at 1.5 s and takes 2.4 s (one part, then the commit).
    await vi.advanceTimersByTimeAsync(1700);
    page.S().saveDuelPlayed(duel(2), Number.POSITIVE_INFINITY);
    page.S().saveDuelPlayed(duel(3), Number.POSITIVE_INFINITY);
    // The second timer fires mid-push.
    await vi.advanceTimersByTimeAsync(1600);
    expect(pending(storage)).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(accountCount(kv)).toBe(3);
    expect(pending(storage)).toBe(false);
    // The second push waited for the first to be answered before sending anything.
    expect(n.crossed).toBe(0);
    expect(n.log.filter((l) => l === 'PUT ?v=2')).toHaveLength(2);
  });
});

describe('a library this browser could not keep', () => {
  /** 300 sets, synced, in parts — then this browser loses one of its parts
   *  while a "local has unsynced changes" flag is set. */
  const broken = async () => {
    const { storage, kv } = await syncedBrowser(300);
    expect(accountCount(kv)).toBe(300);
    const parts = partKeys(storage);
    expect(parts).toHaveLength(2);
    // The 200-set part: what is left reads back as the newest 100.
    storage.data.delete(parts[1]);
    storage.data.set(PENDING_KEY, '1');
    return { storage, kv };
  };

  it('is NEVER pushed over the account’s copy, pending flag or not', async () => {
    /* Without the stale flag this is the old bug with a new cause: "local is
       ahead" would push a library 200 sets short over the whole one. */
    const { storage, kv } = await broken();
    const n = net();
    const page = await load(storage, kv, n, USER);
    await afterDebounce();
    expect(accountCount(kv)).toBe(300);
    expect(n.log.filter((l) => l.startsWith('PUT'))).toEqual([]);
    // The account's whole library is what the page has, and what is stored.
    expect(page.S().library).toHaveLength(300);
    expect(storage.data.get(STALE_KEY)).toBe('0');
    expect((await load(storage, kv, net(), USER)).S().library).toHaveLength(300);
  });

  it('changes nothing when the account cannot be read either', async () => {
    const { storage, kv } = await broken();
    const n = net({ offline: true });
    const page = await load(storage, kv, n, USER);
    await afterDebounce();
    expect(page.S().library).toHaveLength(100);
    expect(accountCount(kv)).toBe(300);
    expect(storage.data.get(STALE_KEY)).toBe('1');
  });

  it('control: a WHOLE local copy with unsynced changes is still kept and pushed', async () => {
    /* The same set-up without the lost part. If this did not push, the test
       above would pass for the wrong reason. */
    const storage = fakeLocalStorage();
    const kv = memoryKV();
    oldFormat(storage, savedLibrary(300));
    const n = net();
    const first = await load(storage, kv, n, USER);
    await afterDebounce();
    n.offline = true;
    first.S().saveDuelPlayed(duel(900), Number.POSITIVE_INFINITY);
    await afterDebounce();
    expect(accountCount(kv)).toBe(300);
    expect(pending(storage)).toBe(true);

    n.offline = false;
    const page = await load(storage, kv, n, USER);
    await afterDebounce();
    expect(page.S().library).toHaveLength(301);
    expect(accountCount(kv)).toBe(301);
  });

  it('out of room: the page keeps working, and the account still gets the save', async () => {
    const storage = fakeLocalStorage();
    const kv = memoryKV();
    oldFormat(storage, savedLibrary(300));
    const page = await load(storage, kv, net(), USER);
    await afterDebounce();

    storage.quota = storage.used();
    expect(() => page.S().saveDuelPlayed(duel(900), Number.POSITIVE_INFINITY)).not.toThrow();
    expect(page.S().library).toHaveLength(301);
    await afterDebounce();
    expect(accountCount(kv)).toBe(301);
    expect(storage.data.get(STALE_KEY)).toBe('1');

    // The reload has a 300-set copy here and 301 on the account: it takes the account's.
    storage.quota = Number.POSITIVE_INFINITY;
    const again = await load(storage, kv, net(), USER);
    expect(again.S().library).toHaveLength(301);
    expect(storage.data.get(STALE_KEY)).toBe('0');
  });
});

describe('a shorter library arriving from the account', () => {
  /* Sync is last write wins. A tab left open on another device can push an
     older library with fewer sets, and the next load here adopts it — that is
     how it has always worked, and why the endpoint keeps a shadow copy. This
     is the same net in the browser. */
  const shortened = async () => {
    const { storage, kv, page } = await syncedBrowser(226);
    const full = page.S().library;
    // An old tab elsewhere writes the account back to 220 sets.
    await deckRoute(
      {
        method: 'PUT',
        v2: false,
        part: null,
        body: { library: savedLibrary(220), deckSlotCount: { solo: 3, blue: 3, red: 3 }, paletteFolders: [] },
      },
      USER,
      kv,
      async () => false,
    );
    return { storage, kv, full };
  };

  it('is adopted — and the longer one it replaced is kept in this browser', async () => {
    const { storage, kv, full } = await shortened();
    const page = await load(storage, kv, net(), USER);
    expect(page.S().library).toHaveLength(220);

    const { deckStorage } = await import('../src/state/deckStorage');
    const kept = deckStorage(storage).replaced();
    expect(kept?.library).toHaveLength(226);
    expect(kept?.library).toEqual(full);
  });

  it('the account’s own shadow copy has it too, with every part it names', async () => {
    const { kv } = await shortened();
    const prev = kv.data.get(`deck-data:user:${USER}:v2:prev`) as {
      library: { count: number; parts: { id: string }[] };
    };
    expect(prev.library.count).toBe(226);
    for (const p of prev.library.parts) {
      expect(kv.data.has(`deck-part:user:${USER}:${p.id}`)).toBe(true);
    }
  });

  it('a library that only grew keeps no such copy', async () => {
    const { storage, kv } = await syncedBrowser(226);
    const phone = await load(fakeLocalStorage(), kv, net(), USER);
    phone.S().saveDuelPlayed(duel(901), Number.POSITIVE_INFINITY);
    await afterDebounce();
    const page = await load(storage, kv, net(), USER);
    expect(page.S().library).toHaveLength(227);
    expect(storage.data.has(REPLACED_KEY)).toBe(false);
  });

  it('signing out removes the copies with everything else', async () => {
    const { storage, kv } = await shortened();
    const page = await load(storage, kv, net(), USER);
    expect(storage.data.has(REPLACED_KEY)).toBe(true);
    await page.signOut();
    expect(storage.data.has(REPLACED_KEY)).toBe(false);
    expect(storage.data.has(BACKUP_KEY)).toBe(false);
  });
});

describe('whose decks are in this browser', () => {
  it('signing out removes the old-format copy as well', async () => {
    const storage = fakeLocalStorage();
    const kv = memoryKV();
    oldFormat(storage, savedLibrary(225));
    oldAccount(kv, savedLibrary(225));
    const page = await load(storage, kv, net(), USER);
    expect(storage.data.has(BACKUP_KEY)).toBe(true);
    await page.signOut();
    expect(storage.data.has(BACKUP_KEY)).toBe(false);
    expect([...storage.data.keys()].filter((k) => k.includes('before-parts') || k.includes('replaced'))).toEqual([]);
  });

  it('signing out removes the library’s parts, not just the list', async () => {
    const { storage, kv, page } = await syncedBrowser(450);
    expect(partKeys(storage)).toHaveLength(3);

    await page.signOut();
    expect(page.S().library).toEqual([]);
    expect(partKeys(storage)).toEqual([]);
    expect(storage.data.get(OWNER_KEY) ?? null).toBeNull();
    // Still on the account.
    expect(accountCount(kv)).toBe(450);
  });

  it('the next account to sign in here gets its own, and never the last one’s', async () => {
    const { kv, page } = await syncedBrowser(450);
    await page.signOut();

    await page.signIn(OTHER);
    await afterDebounce();
    expect(page.S().library).toEqual([]);
    page.S().saveDuelPlayed(duel(7), Number.POSITIVE_INFINITY);
    await afterDebounce();
    expect((kv.data.get(`deck-data:user:${OTHER}:v2`) as { library: { count: number } }).library.count).toBe(1);
    expect(accountCount(kv)).toBe(450);
  });
});
