import { gunzipB64, gzipB64 } from './deckCodec';
import {
  heldPart,
  holdsParts,
  partId,
  partJson,
  partsOf,
  rememberPart,
  type LibraryPart,
} from './libraryParts';

/**
 * deckSync.ts — reading and writing an account's decks, with the saved library
 * in parts (`api/decks.ts` describes the protocol and why it exists).
 *
 * WHAT THIS FILE HAS TO GUARANTEE, because each of these has cost somebody
 * their saved decks before:
 *
 *   * A READ IS WHOLE OR IT FAILED. A library missing one part is not "found
 *     with fewer sets" — the store would adopt it and the next save would push
 *     the loss back up. Every part is checked against its name; anything short
 *     of all of them is `failed`, and the caller does nothing with `failed`.
 *   * A PUSH LANDED OR IT DID NOT. `ok` only after the commit is accepted.
 *     Uploaded parts with no commit are nothing at all.
 *   * THE WHOLE DOCUMENT STILL REPLACES THE WHOLE DOCUMENT. Parts are how it
 *     travels, not a merge. `syncPolicy.ts` decides what may replace what, as
 *     before.
 *
 * A READ DOWNLOADS ONLY WHAT THIS TAB DOES NOT HOLD. A part is named by its
 * content, and the browser stores the library in the same parts, so the head's
 * list of names says exactly which ones are new here. An ordinary reload is
 * one small request; a set saved on another device is one part.
 *
 * The transport is passed in, so all of it runs in a test against the real
 * route function with no network (`tests/deckSyncV2.test.ts`).
 */

/** One call to `/api/decks`. `null`: no session, or the request never arrived. */
export type DeckTransport = (
  method: 'GET' | 'PUT',
  query: string,
  body?: unknown,
) => Promise<{ status: number; json: unknown } | null>;

/** The synced document. Structural — `syncClient.ts` owns the real type. */
export interface DeckDocument {
  sets: unknown;
  library: object[];
  deckSlotCount?: unknown;
  paletteFolders?: unknown;
}

export type DeckRead<D extends DeckDocument> =
  | { status: 'found'; data: D }
  | { status: 'empty' }
  | { status: 'failed' };

export type DeckPush =
  | { ok: true }
  /** `full`: the account is at its saved-set limit. Anything else: `failed`. */
  | { ok: false; reason: 'full' | 'failed' };

const FAILED = { status: 'failed' } as const;
const NOT_PUSHED: DeckPush = { ok: false, reason: 'failed' };

/** Parts fetched or uploaded at once. */
const AT_ONCE = 4;

async function each<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, run));
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The saved sets in a part as it arrived, or null unless it is exactly the
 *  part that was asked for. */
function openPart(gz: unknown, id: string): object[] | null {
  if (typeof gz !== 'string') return null;
  try {
    const json = gunzipB64(gz);
    if (partId(json) !== id) return null;
    const members: unknown = JSON.parse(json);
    return Array.isArray(members) ? (members as object[]) : null;
  } catch {
    return null;
  }
}

export interface DeckSync<D extends DeckDocument> {
  read(): Promise<DeckRead<D>>;
  push(doc: D): Promise<DeckPush>;
}

/** The parts a tab already holds, by id. In the app that is what
 *  `libraryParts.ts` has in hand; a test stands in for a particular device. */
export interface HeldParts {
  get(id: string): readonly object[] | undefined;
  any(): boolean;
}

const IN_HAND: HeldParts = { get: heldPart, any: holdsParts };

export function createDeckSync<D extends DeckDocument>(
  call: DeckTransport,
  local: HeldParts = IN_HAND,
): DeckSync<D> {
  /** Part ids the account is believed to hold: what the last read or the last
   *  accepted commit named. A wrong belief costs one 409 and a re-upload. */
  let held = new Set<string>();

  async function readOnce(): Promise<DeckRead<D> | null> {
    /* `bare`: the head without any parts riding along. A tab that already
       holds parts will need few or none of them; a new device holds nothing
       and is better served by one large answer than by a request a part. */
    const res = await call('GET', local.any() ? '?v=2&bare=1' : '?v=2');
    if (!res || res.status !== 200) return FAILED;
    const j = res.json as {
      found?: boolean;
      v?: number;
      data?: Record<string, unknown>;
      library?: { parts?: { id?: unknown; n?: unknown }[]; count?: unknown };
      inline?: Record<string, unknown>;
    } | null;
    if (!j || typeof j !== 'object') return FAILED;
    if (!j.found) {
      held = new Set();
      return { status: 'empty' };
    }
    if (j.v !== 2) {
      // Still the one old value: this account has not been pushed in parts yet.
      held = new Set();
      return j.data && typeof j.data === 'object' ? { status: 'found', data: j.data as unknown as D } : FAILED;
    }

    const listed = j.library?.parts;
    if (!j.data || typeof j.data !== 'object' || !Array.isArray(listed)) return FAILED;
    const ids: string[] = [];
    /** How many sets the head says each part holds. */
    const sizes = new Map<string, number>();
    for (const p of listed) {
      if (!p || typeof p.id !== 'string') return FAILED;
      ids.push(p.id);
      if (typeof p.n === 'number') sizes.set(p.id, p.n);
    }

    /* What this tab holds, taken ONCE. The library can be cut again while the
       parts below are on their way (a save during the read), and a part that
       was "held" when deciding what to fetch must still be in hand when the
       library is put together. */
    const have = new Map<string, readonly object[]>();
    for (const id of new Set(ids)) {
      const members = local.get(id);
      if (members) have.set(id, members);
    }

    const arrived = new Map<string, unknown>(Object.entries(j.inline ?? {}));
    let reachable = true;
    await each(
      [...new Set(ids)].filter((id) => !have.has(id) && !arrived.has(id)),
      async (id) => {
        const r = await call('GET', `?v=2&part=${id}`);
        if (!r || r.status !== 200) {
          reachable = false;
          return;
        }
        arrived.set(id, (r.json as { gz?: unknown } | null)?.gz);
      },
    );
    if (!reachable) return FAILED;

    const library: object[] = [];
    for (const id of ids) {
      const members = have.get(id) ?? openPart(arrived.get(id), id);
      // A part the head names and the account no longer has: the head moved
      // while this was reading it. Say so, and let the caller look again.
      if (!members) return null;
      // The head counted this part when it was committed. A part of another
      // size is not the part it named, whatever its id says.
      const expected = sizes.get(id);
      if (expected !== undefined && expected !== members.length) return null;
      rememberPart(members as object[], id);
      for (const m of members) library.push(m);
    }
    /* AND THE WHOLE THING IS COUNTED. The head records how many saved sets it
       holds; a library that comes out any other length is not adopted. */
    if (typeof j.library?.count === 'number' && j.library.count !== library.length) return null;
    held = new Set(ids);
    return { status: 'found', data: { ...j.data, library } as unknown as D };
  }

  async function upload(part: LibraryPart<object>): Promise<boolean> {
    const r = await call('PUT', `?v=2&part=${part.id}`, { gz: gzipB64(partJson(part.members)) });
    if (r?.status !== 200) return false;
    held.add(part.id);
    return true;
  }

  return {
    async read() {
      // Twice at most: a second device committing between the head and its
      // parts is the one honest reason for a part to be missing.
      for (let attempt = 0; attempt < 2; attempt++) {
        const out = await readOnce();
        if (out) return out;
      }
      return FAILED;
    },

    async push(doc) {
      const { library, ...rest } = doc;
      const parts = partsOf(library);
      const byId = new Map(parts.map((p) => [p.id, p]));

      let sent = true;
      await each(
        [...byId.values()].filter((p) => !held.has(p.id)),
        async (p) => {
          if (sent && !(await upload(p))) sent = false;
        },
      );
      if (!sent) return NOT_PUSHED;

      const commit = { ...rest, library: { parts: parts.map((p) => p.id) } };
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await call('PUT', '?v=2', commit);
        if (!r) return NOT_PUSHED;
        if (r.status === 200) {
          held = new Set(byId.keys());
          return { ok: true };
        }
        const j = r.json as { error?: unknown; missing?: unknown } | null;
        if (r.status === 409 && Array.isArray(j?.missing)) {
          // The account does not hold what this tab thought it did (another
          // device's commit cleared it away). Send those and ask again.
          for (const id of j.missing) {
            const p = typeof id === 'string' ? byId.get(id) : undefined;
            if (!p) return NOT_PUSHED;
            held.delete(p.id);
            if (!(await upload(p))) return NOT_PUSHED;
          }
          continue;
        }
        if (r.status === 423) {
          // Another commit for this account is in progress.
          await wait(250 * (attempt + 1));
          continue;
        }
        if (r.status === 413 && j?.error === 'library_full') return { ok: false, reason: 'full' };
        return NOT_PUSHED;
      }
      return NOT_PUSHED;
    },
  };
}
