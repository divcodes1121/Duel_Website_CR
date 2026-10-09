import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  LIBRARY_PART_MAX,
  SAVED_SET_LIMIT as SERVER_LIMIT,
  deckRoute,
  partId as serverPartId,
  type DeckKV,
} from '../api/decks';
import { createDeckSync, type DeckTransport } from '../src/state/deckSync';
import { LIBRARY_PART_SIZE, partId, partJson, partsOf } from '../src/state/libraryParts';
import { SAVED_SET_LIMIT, savedSetLimit } from '../src/state/tiers';
import type { SavedDeckSet } from '../src/types/deck';
import { savedLibrary, savedSet, withSaved } from './helpers/savedSets';

/* AN ACCOUNT'S DECKS, WITH THE SAVED LIBRARY IN PARTS (2026-10-09).
 *
 * Asked for: "I already have 225 decks ... unlimited for my account, which is
 * admin, store it in cloud so that I don't have to worry about space ... and
 * try to make 1000 saved decks for everyone".
 *
 * The account's decks were one value capped at 1 MB (~500 saved duels). They
 * are now a head plus parts. This file runs the REAL client (`deckSync.ts`)
 * against the REAL route (`deckRoute` in `api/decks.ts`) over an in-memory
 * store — no network, no mock of either side — because this is the code that
 * has lost saved decks three times, each time by one side believing something
 * about the other.
 */

const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';

const V1 = (u: string) => `deck-data:user:${u}`;
const HEAD = (u: string) => `deck-data:user:${u}:v2`;
const HEAD_PREV = (u: string) => `deck-data:user:${u}:v2:prev`;
const INDEX = (u: string) => `deck-parts:user:${u}`;
const PART = (u: string, id: string) => `deck-part:user:${u}:${id}`;
const LOCK = (u: string) => `deck-lock:user:${u}`;
const PRE_MOVE = (u: string) => `deck-backup:user:${u}:before-parts`;

const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

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
      for (const k of keys) {
        data.delete(k);
        ttl.delete(k);
      }
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

interface Doc {
  sets: Record<string, unknown>;
  library: SavedDeckSet[];
  deckSlotCount: Record<string, number>;
  paletteFolders: unknown[];
}

const doc = (library: SavedDeckSet[], board = 'board-1'): Doc => ({
  sets: { solo: { id: board }, blue: {}, red: {}, home: {}, palette: {} },
  library,
  deckSlotCount: { solo: 3, blue: 3, red: 3 },
  paletteFolders: [],
});

/** One browser tab talking to the endpoint, with a log of what it sent.
 *
 *  A NEW device holds no parts. `keep()` gives it the parts of a library, as a
 *  browser that has stored that library has them — the module's own record of
 *  "parts in hand" is one per process and would make every device here look
 *  like the one that pushed. */
function device(kv: DeckKV, opts: { user?: string; admin?: boolean } = {}) {
  const user = opts.user ?? USER;
  const log: string[] = [];
  const inHand = new Map<string, readonly object[]>();
  let before: ((method: string, query: string) => Promise<void> | void) | null = null;
  const call: DeckTransport = async (method, query, body) => {
    await before?.(method, query);
    log.push(`${method} ${query}`);
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
      async () => opts.admin === true,
    );
    return { status: out.status, json: clone(out.json) };
  };
  const sync = createDeckSync<Doc>(call, {
    get: (id) => inHand.get(id),
    any: () => inHand.size > 0,
  });
  return {
    ...sync,
    log,
    call,
    /** This browser now stores `library`: it holds exactly its parts. */
    keep(library: readonly SavedDeckSet[]) {
      inHand.clear();
      for (const p of partsOf(library)) inHand.set(p.id, p.members);
    },
    /** Run something just before each request — another device acting. */
    onRequest(fn: typeof before) {
      before = fn;
    },
    sentParts: () => log.filter((l) => l.startsWith('PUT') && l.includes('part=')).length,
    commits: () => log.filter((l) => l === 'PUT ?v=2').length,
  };
}

/** What an OLD tab (the client before this change) sends and reads. */
const oldClient = (kv: DeckKV, user = USER) => ({
  get: () => deckRoute({ method: 'GET', v2: false, part: null, body: undefined }, user, kv, async () => false),
  put: (body: unknown) => deckRoute({ method: 'PUT', v2: false, part: null, body }, user, kv, async () => false),
});

/** A browser with no part stored: a new device. */
const NOTHING_HELD = { get: () => undefined, any: () => false };

const found = (r: Awaited<ReturnType<ReturnType<typeof device>['read']>>) => {
  if (r.status !== 'found') throw new Error(`expected found, got ${r.status}`);
  return r.data;
};

describe('the two halves agree on the numbers they both hold', () => {
  it('a part is the same size on both sides', () => {
    expect(LIBRARY_PART_MAX).toBe(LIBRARY_PART_SIZE);
  });

  it('the saved-set limit is the same on both sides', () => {
    expect(SERVER_LIMIT).toBe(SAVED_SET_LIMIT);
    expect(SAVED_SET_LIMIT).toBe(1000);
  });

  it('only an admin has no limit', () => {
    expect(savedSetLimit('admin')).toBe(Number.POSITIVE_INFINITY);
    for (const a of ['anon', 'free', 'trial', 'pro'] as const) expect(savedSetLimit(a)).toBe(1000);
  });

  it('a part gets the same name from both', () => {
    for (const text of ['', '[]', partJson(savedLibrary(1)), partJson(savedLibrary(200, 5)), 'ünï ✓ デッキ']) {
      expect(serverPartId(text)).toBe(partId(text));
    }
  });

  it('the old request cap is still what `syncPolicy.test.ts` reads', () => {
    expect(readFileSync(new URL('../api/decks.ts', import.meta.url), 'utf8')).toMatch(
      /const MAX_BODY_BYTES = 1_000_000;/,
    );
  });
});

describe('what was pushed is what is read back', () => {
  it('an account with nothing stored reads as empty', async () => {
    expect(await device(memoryKV()).read()).toEqual({ status: 'empty' });
  });

  for (const n of [0, 1, 225, 1000]) {
    it(`${n} saved sets, on another device`, async () => {
      const kv = memoryKV();
      const sent = doc(savedLibrary(n));
      expect(await device(kv).push(sent)).toEqual({ ok: true });
      expect(found(await device(kv).read())).toEqual(sent);
    });
  }

  it('225 sets are two parts, and the head names them in order', async () => {
    const kv = memoryKV();
    await device(kv).push(doc(savedLibrary(225)));
    const head = kv.data.get(HEAD(USER)) as { library: { parts: { n: number }[]; count: number } };
    expect(head.library.parts.map((p) => p.n)).toEqual([25, 200]);
    expect(head.library.count).toBe(225);
  });

  it('keeps one account out of another', async () => {
    const kv = memoryKV();
    await device(kv).push(doc(savedLibrary(30)));
    expect(await device(kv, { user: OTHER }).read()).toEqual({ status: 'empty' });
    await device(kv, { user: OTHER }).push(doc(savedLibrary(2, 5)));
    expect(found(await device(kv).read()).library).toHaveLength(30);
    for (const key of kv.data.keys()) expect(key.includes(USER) || key.includes(OTHER)).toBe(true);
  });
});

describe('a save sends what changed', () => {
  it('nothing changed in the library: the head alone', async () => {
    const kv = memoryKV();
    const d = device(kv);
    const library = savedLibrary(450);
    await d.push(doc(library));
    expect(d.sentParts()).toBe(3);
    d.log.length = 0;

    // A card moved on the board.
    await d.push(doc(library, 'board-2'));
    expect(d.log).toEqual(['PUT ?v=2']);
    expect(found(await device(kv).read()).sets.solo).toEqual({ id: 'board-2' });
  });

  it('one more saved set: one part, then the head', async () => {
    const kv = memoryKV();
    const d = device(kv);
    const library = savedLibrary(450);
    await d.push(doc(library));
    d.log.length = 0;

    const more = withSaved(library);
    await d.push(doc(more));
    expect(d.sentParts()).toBe(1);
    expect(d.commits()).toBe(1);
    expect(found(await device(kv).read()).library).toEqual(more);
  });

  it('a device that has just read knows what the account holds', async () => {
    const kv = memoryKV();
    await device(kv).push(doc(savedLibrary(450)));
    const d = device(kv);
    const read = found(await d.read());
    d.log.length = 0;
    await d.push({ ...read, library: [savedSet(999), ...read.library] });
    expect(d.sentParts()).toBe(1);
  });

  it('parts nothing names any more are cleared away', async () => {
    const kv = memoryKV();
    const d = device(kv);
    let library = savedLibrary(190);
    for (let i = 0; i < 30; i++) {
      library = withSaved(library);
      await d.push(doc(library));
    }
    const head = kv.data.get(HEAD(USER)) as { library: { parts: { id: string }[] } };
    const named = head.library.parts.map((p) => p.id).sort();
    expect(Object.keys(kv.data.get(INDEX(USER)) as object).sort()).toEqual(named);
    const stored = [...kv.data.keys()].filter((k) => k.startsWith(PART(USER, ''))).sort();
    expect(stored).toEqual(named.map((id) => PART(USER, id)));
  });
});

describe('a read downloads only what this browser does not hold', () => {
  /* The browser stores the library in the same parts the account does, so the
     head's list of names says which ones are new here. Before this, every
     page load fetched the whole library again. */
  const stored = async (n: number) => {
    const kv = memoryKV();
    const library = savedLibrary(n);
    await device(kv).push(doc(library));
    const d = device(kv);
    d.keep(found(await d.read()).library);
    d.log.length = 0;
    return { kv, d, library };
  };

  it('a new device is sent the parts with the head: one request', async () => {
    const kv = memoryKV();
    await device(kv).push(doc(savedLibrary(450)));
    const d = device(kv);
    expect(found(await d.read()).library).toHaveLength(450);
    expect(d.log).toEqual(['GET ?v=2']);
  });

  it('an ordinary reload asks for the head and nothing else', async () => {
    const { d, library } = await stored(450);
    const again = found(await d.read());
    expect(d.log).toEqual(['GET ?v=2&bare=1']);
    expect(again.library).toEqual(library);
  });

  it('the account does not send parts nobody asked for', async () => {
    const { kv } = await stored(450);
    const bare = await device(kv).call('GET', '?v=2&bare=1');
    expect((bare!.json as { inline: object }).inline).toEqual({});
    const full = await device(kv).call('GET', '?v=2');
    expect(Object.keys((full!.json as { inline: object }).inline)).toHaveLength(3);
  });

  it('a set saved on another device is one part to fetch', async () => {
    const { kv, d, library } = await stored(450);
    const more = withSaved(library);
    await device(kv).push(doc(more));
    expect(found(await d.read()).library).toEqual(more);
    expect(d.log.filter((l) => l.includes('part='))).toHaveLength(1);
    expect(d.log[0]).toBe('GET ?v=2&bare=1');
  });

  it('a library replaced on another device is fetched whole — nothing held is assumed', async () => {
    const { kv, d } = await stored(450);
    const other = savedLibrary(410, 5);
    await device(kv).push(doc(other));
    expect(found(await d.read()).library).toEqual(other);
    expect(d.log.filter((l) => l.includes('part='))).toHaveLength(3);
  });

  it('a part it lacks that the account has lost is still a failed read', async () => {
    const { kv, d, library } = await stored(450);
    await device(kv).push(doc(withSaved(library)));
    const head = kv.data.get(HEAD(USER)) as { library: { parts: { id: string }[] } };
    kv.data.delete(PART(USER, head.library.parts[0].id));
    expect(await d.read()).toEqual({ status: 'failed' });
  });
});

describe('a read is whole or it failed', () => {
  const pushed = async (n = 450) => {
    const kv = memoryKV();
    await device(kv).push(doc(savedLibrary(n)));
    const head = kv.data.get(HEAD(USER)) as { library: { parts: { id: string }[] } };
    return { kv, ids: head.library.parts.map((p) => p.id) };
  };

  it('a part the head names is gone: failed, never a shorter library', async () => {
    const { kv, ids } = await pushed();
    kv.data.delete(PART(USER, ids[1]));
    expect(await device(kv).read()).toEqual({ status: 'failed' });
  });

  it('a part holds something other than its name says: failed', async () => {
    const { kv, ids } = await pushed();
    kv.data.set(PART(USER, ids[1]), kv.data.get(PART(USER, ids[2])));
    expect(await device(kv).read()).toEqual({ status: 'failed' });
  });

  it('a part is not gzip at all: failed', async () => {
    const { kv, ids } = await pushed();
    kv.data.set(PART(USER, ids[0]), { gz: 'bm90IGd6aXA=' });
    expect(await device(kv).read()).toEqual({ status: 'failed' });
  });

  it('a library that is not the length the head recorded: failed', async () => {
    /* Every part is present and is what its name says — and the total is
       still wrong. Nothing adopts a library the head did not count. */
    const { kv } = await pushed();
    const head = kv.data.get(HEAD(USER)) as { library: { count: number } };
    kv.data.set(HEAD(USER), { ...head, library: { ...head.library, count: head.library.count + 1 } });
    expect(await device(kv).read()).toEqual({ status: 'failed' });
  });

  it('a part that is not the size the head recorded for it: failed', async () => {
    /* One part a set short, another a set long: THE TOTAL STILL ADDS UP, so
       only the count kept per part can see it. */
    const { kv } = await pushed();
    const head = kv.data.get(HEAD(USER)) as { library: { parts: { id: string; n: number }[]; count: number } };
    const parts = head.library.parts.map((p, i) =>
      i === 1 ? { ...p, n: p.n - 1 } : i === 2 ? { ...p, n: p.n + 1 } : p,
    );
    kv.data.set(HEAD(USER), { ...head, library: { parts, count: head.library.count } });
    expect(await device(kv).read()).toEqual({ status: 'failed' });
  });

  it('a head that carries no counts at all still cannot yield a shorter library', async () => {
    /* The counts are a second net, not the first. With them stripped — a head
       from some other writer — a missing part must still fail the read on its
       own, and not come back as "found, with fewer sets". */
    const { kv, ids } = await pushed();
    const head = kv.data.get(HEAD(USER)) as { library: { parts: { id: string }[] } };
    kv.data.set(HEAD(USER), { ...head, library: { parts: head.library.parts.map((x) => ({ id: x.id })) } });
    kv.data.delete(PART(USER, ids[1]));
    expect(await device(kv).read()).toEqual({ status: 'failed' });
  });

  it('the endpoint did not answer: failed', async () => {
    const sync = createDeckSync<Doc>(async () => null, NOTHING_HELD);
    expect(await sync.read()).toEqual({ status: 'failed' });
    expect(await sync.push(doc(savedLibrary(3)))).toEqual({ ok: false, reason: 'failed' });
  });

  it('an error status is failed, not empty', async () => {
    for (const status of [401, 409, 429, 500, 502]) {
      const sync = createDeckSync<Doc>(async () => ({ status, json: { error: 'x' } }), NOTHING_HELD);
      expect(await sync.read()).toEqual({ status: 'failed' });
    }
  });

  it('another device committed between the head and its parts: it reads again', async () => {
    /* The reader has a head naming three parts. Before it fetches them,
       another device saves one more set: the first part is replaced and the
       old one cleared away. The honest answers are the new document or
       `failed` — never the old head with a part missing. */
    const kv = memoryKV();
    const old = savedLibrary(450);
    await device(kv).push(doc(old));
    const next = doc(withSaved(old), 'board-2');
    const r = await readWithoutInline(kv, () => device(kv).push(next).then(() => undefined));
    expect(found(r)).toEqual(next);
  });
});

/** A read where no part rides along with the first head, so each is its own
 *  request — and something happens right after that head is fetched. */
async function readWithoutInline(kv: DeckKV, afterHead: () => Promise<void>) {
  let first = true;
  const sync = createDeckSync<Doc>(async (method, query, body) => {
    const out = await deckRoute(
      {
        method,
        v2: true,
        part: /[?&]part=([^&]+)/.exec(query)?.[1] ?? null,
        bare: /[?&]bare=1(&|$)/.test(query),
        body: clone(body),
      },
      USER,
      kv,
      async () => false,
    );
    const json = clone(out.json) as Record<string, unknown>;
    if (method === 'GET' && query === '?v=2') {
      if (first) {
        first = false;
        delete json.inline;
        await afterHead();
      }
    }
    return { status: out.status, json };
  }, NOTHING_HELD);
  return sync.read();
}

describe('the account never names a part it does not hold', () => {
  it('a commit naming an unknown part is refused with the ids', async () => {
    const kv = memoryKV();
    const id = partId(partJson(savedLibrary(3)));
    const out = await device(kv).call('PUT', '?v=2', { sets: {}, library: { parts: [id] } });
    expect(out).toEqual({ status: 409, json: { error: 'missing_parts', missing: [id] } });
    expect(kv.data.has(HEAD(USER))).toBe(false);
  });

  it('the client sends what is missing and the push still lands', async () => {
    /* This tab believes the account holds its parts; another device's commit
       has cleared them away. */
    const kv = memoryKV();
    const d = device(kv);
    const library = savedLibrary(450);
    await d.push(doc(library));
    // A LARGER library, so no shadow copy is holding this tab's parts.
    await device(kv).push(doc(savedLibrary(460, 5)));
    d.log.length = 0;

    expect(await d.push(doc(library, 'board-9'))).toEqual({ ok: true });
    expect(d.commits()).toBe(2);
    expect(d.sentParts()).toBe(3);
    expect(found(await device(kv).read())).toEqual(doc(library, 'board-9'));
  });

  it('two devices, last one wins, and what it wrote is whole', async () => {
    const kv = memoryKV();
    const a = device(kv);
    const b = device(kv);
    const mine = doc(savedLibrary(230));
    const theirs = doc(savedLibrary(410, 5), 'board-b');
    await a.push(mine);
    await b.push(theirs);
    await a.push(mine);
    expect(found(await device(kv).read())).toEqual(mine);
    await b.push(theirs);
    expect(found(await device(kv).read())).toEqual(theirs);
  });

  it('a commit waits its turn, and gives up rather than write over a held lock', async () => {
    const kv = memoryKV();
    const d = device(kv);
    await d.push(doc(savedLibrary(3)));
    // Another commit is in progress...
    kv.data.set(LOCK(USER), '1');
    let asked = 0;
    d.onRequest((method, query) => {
      if (method === 'PUT' && query === '?v=2') {
        asked += 1;
        // ...and finishes while this one is waiting.
        if (asked === 2) kv.data.delete(LOCK(USER));
      }
    });
    expect(await d.push(doc(savedLibrary(4)))).toEqual({ ok: true });
    expect(asked).toBe(2);
    expect(kv.data.has(LOCK(USER))).toBe(false);
  });

  it('releases its lock when it refuses', async () => {
    const kv = memoryKV();
    await device(kv).call('PUT', '?v=2', { sets: {}, library: { parts: ['0123456789abcdefzz'] } });
    expect(kv.data.has(LOCK(USER))).toBe(false);
  });
});

describe('what an uploaded part has to be', () => {
  const put = (kv: DeckKV, id: string, gz: unknown, admin = false) =>
    device(kv, { admin }).call('PUT', `?v=2&part=${id}`, { gz });
  const gz = (text: string) => gzipSync(text).toString('base64');

  it('its content under its own name', async () => {
    const kv = memoryKV();
    const json = partJson(savedLibrary(3));
    expect((await put(kv, partId(json), gz(json)))?.status).toBe(200);
    // The same bytes under another name.
    expect((await put(kv, partId(`${json} `), gz(json)))?.status).toBe(400);
  });

  it('a list of saved sets, and no more than a part holds', async () => {
    const kv = memoryKV();
    for (const text of ['{}', '[]', '[1,2]', '[null]', partJson(savedLibrary(LIBRARY_PART_MAX + 1))]) {
      expect((await put(kv, partId(text), gz(text)))?.status).toBe(400);
    }
    const full = partJson(savedLibrary(LIBRARY_PART_MAX, 5));
    expect((await put(kv, partId(full), gz(full)))?.status).toBe(200);
  });

  it('gzip, and a well-formed id', async () => {
    const kv = memoryKV();
    expect((await put(kv, '0123456789abcdefzz', 'bm90IGd6aXA='))?.status).toBe(400);
    expect((await put(kv, '0123456789abcdefzz', 12))?.status).toBe(400);
    expect((await put(kv, '../../etc', gz('[]')))?.status).toBe(400);
    expect((await put(kv, 'UPPERCASEUPPERCAS', gz('[]')))?.status).toBe(400);
  });

  it('not one that inflates far past a real part', async () => {
    const kv = memoryKV();
    const bomb = `[${JSON.stringify({ pad: 'x'.repeat(5_000_000) })}]`;
    expect((await put(kv, partId(bomb), gz(bomb)))?.status).toBe(400);
  });

  it('a capped account cannot pile up parts it never commits', async () => {
    const kv = memoryKV();
    let refused = 0;
    for (let i = 0; i < 40; i++) {
      const json = partJson([savedSet(i + 1)]);
      if ((await put(kv, partId(json), gz(json)))?.status === 413) refused += 1;
    }
    expect(refused).toBe(16);
    expect(Object.keys(kv.data.get(INDEX(USER)) as object)).toHaveLength(24);
  });

  it('an admin can', async () => {
    const kv = memoryKV();
    for (let i = 0; i < 40; i++) {
      const json = partJson([savedSet(i + 1)]);
      expect((await put(kv, partId(json), gz(json), true))?.status).toBe(200);
    }
  });
});

describe('how many', () => {
  it('a thousand sets, for anyone', async () => {
    const kv = memoryKV();
    const sent = doc(savedLibrary(SAVED_SET_LIMIT, 5));
    expect(await device(kv).push(sent)).toEqual({ ok: true });
    expect(found(await device(kv).read()).library).toHaveLength(1000);
  });

  it('a thousand and one is refused — and what was there stays', async () => {
    const kv = memoryKV();
    const d = device(kv);
    const at = doc(savedLibrary(SAVED_SET_LIMIT));
    await d.push(at);
    expect(await d.push(doc(withSaved(at.library)))).toEqual({ ok: false, reason: 'full' });
    expect(found(await device(kv).read())).toEqual(at);
  });

  it('no limit for an admin: five thousand sets, there and back', async () => {
    const kv = memoryKV();
    const d = device(kv, { admin: true });
    const sent = doc(savedLibrary(5000, 5));
    expect(JSON.stringify(sent).length).toBeGreaterThan(11_000_000);
    expect(await d.push(sent)).toEqual({ ok: true });
    expect(d.sentParts()).toBe(25);

    const reader = device(kv, { admin: true });
    const back = found(await reader.read());
    expect(back.library).toHaveLength(5000);
    expect(back).toEqual(sent);
    // Too much to ride along with the head: the rest was asked for by name.
    expect(reader.log.filter((l) => l.startsWith('GET ?v=2&part=')).length).toBeGreaterThan(0);

    // And one more save is still one part.
    d.log.length = 0;
    await d.push(doc(withSaved(sent.library, 5)));
    expect(d.sentParts()).toBe(1);
  });

  it('no request is larger than the endpoint accepts', async () => {
    const kv = memoryKV();
    let largest = 0;
    const sync = createDeckSync<Doc>(async (method, query, body) => {
      largest = Math.max(largest, JSON.stringify(body ?? null).length);
      const out = await deckRoute(
        { method, v2: true, part: /[?&]part=([^&]+)/.exec(query)?.[1] ?? null, body: clone(body) },
        USER,
        kv,
        async () => true,
      );
      return { status: out.status, json: clone(out.json) };
    }, NOTHING_HELD);
    await sync.push(doc(savedLibrary(1200, 5)));
    expect(largest).toBeLessThan(400_000);
  });

  it('the head is still held to the old cap, without the library in it', async () => {
    const kv = memoryKV();
    const huge = { sets: { solo: { pad: 'x'.repeat(1_100_000) } }, library: { parts: [] } };
    expect((await device(kv).call('PUT', '?v=2', huge))?.status).toBe(413);
  });
});

describe('a shrinking library leaves the previous one recoverable', () => {
  it('keeps the previous head, and the parts it names, for a month', async () => {
    const kv = memoryKV();
    const d = device(kv);
    const big = savedLibrary(450);
    await d.push(doc(big));
    const before = clone(kv.data.get(HEAD(USER))) as { library: { parts: { id: string }[] } };

    await d.push(doc(big.slice(0, 5)));
    expect(kv.data.get(HEAD_PREV(USER))).toEqual(before);
    expect(kv.ttl.get(HEAD_PREV(USER))).toBe(60 * 60 * 24 * 30);
    for (const p of before.library.parts) expect(kv.data.has(PART(USER, p.id))).toBe(true);
    // ...and it is not what a reader gets.
    expect(found(await device(kv).read()).library).toHaveLength(5);
  });

  it('a save that adds or edits keeps no copy', async () => {
    const kv = memoryKV();
    const d = device(kv);
    const library = savedLibrary(40);
    await d.push(doc(library));
    await d.push(doc(withSaved(library)));
    expect(kv.data.has(HEAD_PREV(USER))).toBe(false);
  });
});

describe('an account stored the old way', () => {
  const legacy = () => doc(savedLibrary(225));

  it('is read as it is', async () => {
    const kv = memoryKV();
    kv.data.set(V1(USER), legacy());
    expect(found(await device(kv).read())).toEqual(legacy());
  });

  it('moves to parts on its first push, and the old value is kept for 90 days', async () => {
    const kv = memoryKV();
    kv.data.set(V1(USER), legacy());
    const d = device(kv);
    const read = found(await d.read());
    await d.push({ ...read, library: [savedSet(226), ...read.library] });

    expect(kv.data.get(V1(USER))).toEqual(legacy());
    expect(kv.ttl.get(V1(USER))).toBe(60 * 60 * 24 * 90);
    expect(found(await device(kv).read()).library).toHaveLength(226);
  });

  it('is also copied aside for good, before anything supersedes it', async () => {
    /* "I don't want to lose my saved sets which are right now in my admin
       account, make sure of that." The 90-day key is what a rollback reads;
       this copy has no expiry and nothing ever reads or rewrites it. */
    const kv = memoryKV();
    kv.data.set(V1(USER), legacy());
    await device(kv).push(doc(savedLibrary(3)));
    expect(kv.data.get(PRE_MOVE(USER))).toEqual(legacy());
    expect(kv.ttl.has(PRE_MOVE(USER))).toBe(false);
  });

  it('that copy is the FIRST move’s, whatever happens to the account afterwards', async () => {
    const kv = memoryKV();
    kv.data.set(V1(USER), legacy());
    const d = device(kv);
    await d.push(legacy());
    // An old tab puts the old shape back, with something else in it...
    await oldClient(kv).put(doc(savedLibrary(2, 5), 'old-tab'));
    // ...and the account moves to parts a second time.
    const again = device(kv);
    await again.read();
    await again.push(doc(savedLibrary(4)));
    expect(kv.data.get(PRE_MOVE(USER))).toEqual(legacy());
  });

  it('an account that was never stored the old way has no such copy', async () => {
    const kv = memoryKV();
    await device(kv).push(doc(savedLibrary(30)));
    expect(kv.data.has(PRE_MOVE(USER))).toBe(false);
  });

  it('later pushes do not keep extending that 90 days', async () => {
    const kv = memoryKV();
    kv.data.set(V1(USER), legacy());
    const d = device(kv);
    await d.push(legacy());
    kv.ttl.set(V1(USER), 1234);
    await d.push(doc(withSaved(legacy().library)));
    expect(kv.ttl.get(V1(USER))).toBe(1234);
  });

  it('a first push that would lose sets keeps the old value as the shadow copy', async () => {
    const kv = memoryKV();
    kv.data.set(V1(USER), legacy());
    await device(kv).push(doc(savedLibrary(3)));
    expect(kv.data.get(`${V1(USER)}:prev`)).toEqual(legacy());
  });
});

describe('a tab still running the client from before this change', () => {
  it('reads the same document, in the shape it expects', async () => {
    const kv = memoryKV();
    const sent = doc(savedLibrary(450));
    await device(kv).push(sent);
    const out = await oldClient(kv).get();
    expect(out.status).toBe(200);
    expect(out.json).toEqual({ found: true, data: sent });
  });

  it('is refused, not handed a partial library, when it would be too big to send', async () => {
    const kv = memoryKV();
    await device(kv, { admin: true }).push(doc(savedLibrary(2500, 5)));
    const out = await oldClient(kv).get();
    // Not a 200: that client reads anything else as "could not read" and
    // changes nothing.
    expect(out.status).toBe(409);
  });

  it('is refused when a part is missing, for the same reason', async () => {
    const kv = memoryKV();
    await device(kv).push(doc(savedLibrary(450)));
    const head = kv.data.get(HEAD(USER)) as { library: { parts: { id: string }[] } };
    kv.data.delete(PART(USER, head.library.parts[0].id));
    expect((await oldClient(kv).get()).status).toBe(409);
  });

  it('an account with nothing still reads as nothing', async () => {
    expect((await oldClient(memoryKV()).get()).json).toEqual({ found: false, data: null });
  });

  it('its save is stored its way and becomes the account’s document', async () => {
    const kv = memoryKV();
    await device(kv).push(doc(savedLibrary(450)));
    const theirs = doc(savedLibrary(451), 'old-tab');
    expect((await oldClient(kv).put(theirs)).status).toBe(200);

    expect(kv.data.has(HEAD(USER))).toBe(false);
    expect(found(await device(kv).read())).toEqual(theirs);
    // And the next push in parts moves it back.
    const d = device(kv);
    await d.read();
    await d.push(doc(withSaved(theirs.library)));
    expect(found(await device(kv).read()).library).toHaveLength(452);
  });

  it('its save that loses sets leaves the previous head recoverable', async () => {
    const kv = memoryKV();
    await device(kv).push(doc(savedLibrary(450)));
    const before = clone(kv.data.get(HEAD(USER))) as { library: { parts: { id: string }[] } };
    await oldClient(kv).put(doc(savedLibrary(2)));
    expect(kv.data.get(HEAD_PREV(USER))).toEqual(before);
    for (const p of before.library.parts) expect(kv.data.has(PART(USER, p.id))).toBe(true);
    // The next push in parts must not clear away what the shadow names.
    const d = device(kv);
    await d.read();
    await d.push(doc(savedLibrary(3)));
    for (const p of before.library.parts) expect(kv.data.has(PART(USER, p.id))).toBe(true);
  });

  it('is still held to 1 MB, as it always was', async () => {
    const kv = memoryKV();
    expect((await oldClient(kv).put(doc(savedLibrary(600, 5)))).status).toBe(413);
  });
});

describe('claiming decks from a pre-Supabase login', () => {
  it('still refuses an account that has decks, stored either way', async () => {
    const kv = memoryKV();
    await device(kv).push(doc(savedLibrary(3)));
    const out = await deckRoute(
      { method: 'POST', v2: false, part: null, body: { username: 'u', password: 'p' } },
      USER,
      kv,
      async () => false,
    );
    expect(out.status).toBe(409);
  });
});

describe('anything else', () => {
  it('is not a method this endpoint has', async () => {
    const out = await deckRoute({ method: 'DELETE', v2: true, part: null, body: null }, USER, memoryKV(), async () => false);
    expect(out.status).toBe(405);
    expect(out.allow).toBe('GET, PUT, POST');
  });

  it('a commit that is not a deck document is refused', async () => {
    const kv = memoryKV();
    for (const body of [null, {}, { sets: {} }, { sets: {}, library: {} }, { sets: {}, library: { parts: ['nope'] } }]) {
      expect((await device(kv).call('PUT', '?v=2', body))?.status).toBe(400);
    }
    expect(kv.data.has(LOCK(USER))).toBe(false);
  });
});
