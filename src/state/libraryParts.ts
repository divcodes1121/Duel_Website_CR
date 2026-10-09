/**
 * libraryParts.ts — the saved library, cut into parts.
 *
 * NO IMPORTS, like `syncPolicy.ts` and `tiers.ts`: these are the decisions that
 * lose saved decks when they are wrong, and they are tested without a browser,
 * a store or a network.
 *
 * WHY THE LIBRARY IS IN PARTS AT ALL (2026-10-09). Every saved set used to
 * travel and be stored as part of ONE document: one `localStorage` value in
 * the browser, one Redis value on the account, the second capped at 1 MB —
 * about 500 saved duels, with nothing on screen saying so when it filled. An
 * account at 225 sets asked for no ceiling. A single document cannot give
 * that: a request has a size limit however it is compressed. So the library
 * is a list of parts, each small enough to store and send on its own, and the
 * number of parts is what grows.
 *
 * Both halves use the same parts — the browser's storage (`deckStorage.ts`)
 * and the account's (`deckSync.ts` <-> `api/decks.ts`) — because they need the
 * same two properties:
 *
 *   1. SAVING ONE SET TOUCHES ONE PART. A saved set goes on the FRONT of the
 *      library, so the parts are cut from the BACK: every part is full except
 *      the first, and a new set only ever changes that first one. Cut from the
 *      front, each save would shift every boundary and rewrite all of it.
 *   2. A PART IS NAMED BY ITS CONTENT. Its id is a hash of its JSON, so "is
 *      this part already stored" is a lookup, an unchanged part is never
 *      written or uploaded twice, and a part read back can be checked against
 *      the name it was asked for by.
 */

/**
 * Saved sets a part holds.
 *
 * 200 five-deck Versus sets are ~450 kB of JSON: ~110 kB gzipped for the
 * account (a request cap is 1 MB), ~60 kB of characters in `localStorage`, and
 * ~15-30 ms to compress on a desktop — the cost of one save.
 *
 * **MIRRORED AS `LIBRARY_PART_MAX` IN `api/decks.ts`**, which refuses a larger
 * part and cannot import this (see the note there).
 * `tests/deckSyncV2.test.ts` holds the two equal.
 */
export const LIBRARY_PART_SIZE = 200;

/**
 * The library cut into parts, in library order.
 *
 * Cut from the back: the LAST part and every part but the first are full; the
 * first holds the remainder. 225 sets are `[25, 200]`, and a 226th makes it
 * `[26, 200]` with the second part untouched.
 */
export function partition<T>(library: readonly T[], size: number = LIBRARY_PART_SIZE): T[][] {
  const out: T[][] = [];
  const n = library.length;
  if (n === 0 || size < 1) return out;
  const head = n % size || size;
  out.push(library.slice(0, head));
  for (let i = head; i < n; i += size) out.push(library.slice(i, i + size));
  return out;
}

/**
 * A part's name: 64 bits of hash over its JSON, then its length.
 *
 * NOT CRYPTOGRAPHIC, and it does not need to be. Ids are only ever compared
 * within one account's own parts, so there is nobody to forge one against; the
 * job is telling a few dozen parts apart, and two different parts sharing 64
 * bits AND a length is not a thing that happens. It has to be synchronous —
 * the browser's storage is written inside a store update — which rules out
 * `crypto.subtle`.
 *
 * **DUPLICATED IN `api/decks.ts`**, which checks every uploaded part against
 * the id it arrived under. `tests/deckSyncV2.test.ts` holds the two functions
 * to the same answers.
 */
export function partId(json: string): string {
  let h1 = 0xdeadbeef ^ json.length;
  let h2 = 0x41c6ce57 ^ json.length;
  for (let i = 0; i < json.length; i++) {
    const ch = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(h2)}${hex(h1)}${json.length.toString(36)}`;
}

/** What a part id looks like — the server's own check, restated. */
export const PART_ID = /^[0-9a-f]{16}[0-9a-z]{1,8}$/;

export interface LibraryPart<T> {
  id: string;
  members: readonly T[];
}

/** A part's stored form: the JSON its id is the hash of. */
export function partJson(members: readonly unknown[]): string {
  return JSON.stringify(members);
}

/* ONE ANSWER PER PART, REMEMBERED. Naming a part means serialising 200 saved
 * sets, and both stores ask for every part's name on every change. Keyed on a
 * part's LAST member — the one fixed point of a part cut from the back — and
 * confirmed member by member, so a hit means these exact objects in this exact
 * order.
 *
 * Sound for the reason `duelImport.ts`'s signature cache is: a saved set is
 * never edited in place. The store replaces it. */
const NAMED = new WeakMap<object, { members: readonly unknown[]; id: string }>();

function same(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* THE PARTS THIS TAB HAS IN HAND, BY NAME: the ones the library in memory is
 * made of, plus any just read from storage. It is what lets a page load ask
 * the account for the list of part names and download ONLY the parts it does
 * not already hold — on an ordinary reload, none. Without it every load
 * fetched the whole library again, which at a few thousand sets is megabytes
 * a visit.
 *
 * A part is its content, so one held under a name IS the part of that name:
 * what came from storage was checked against its id when it was read, and what
 * was cut here was named by hashing it. Replaced whenever the library is cut
 * again, so it never holds more than the library does. */
let HELD = new Map<string, readonly object[]>();

/** The members of a part this tab already holds, if it does. */
export function heldPart(id: string): readonly object[] | undefined {
  return HELD.get(id);
}

/** Does this tab hold any part at all? (A new device does not.) */
export function holdsParts(): boolean {
  return HELD.size > 0;
}

/**
 * Record a part's id for members just read from storage or from the account,
 * so the first save after a load does not serialise the whole library to
 * rediscover names it was handed.
 */
export function rememberPart(members: readonly object[], id: string): void {
  if (members.length === 0) return;
  NAMED.set(members[members.length - 1], { members, id });
  HELD.set(id, members);
}

/** The library as named parts. Only a part that changed is serialised. */
export function partsOf<T extends object>(
  library: readonly T[],
  size: number = LIBRARY_PART_SIZE,
): LibraryPart<T>[] {
  const parts = partition(library, size).map((members) => {
    const anchor = members[members.length - 1];
    const hit = NAMED.get(anchor);
    if (hit && same(hit.members, members)) return { id: hit.id, members };
    const id = partId(partJson(members));
    NAMED.set(anchor, { members, id });
    return { id, members };
  });
  // Only the default cut is what both stores keep; a caller asking for another
  // size is asking a question, not describing the library.
  if (size === LIBRARY_PART_SIZE) HELD = new Map(parts.map((p) => [p.id, p.members]));
  return parts;
}
