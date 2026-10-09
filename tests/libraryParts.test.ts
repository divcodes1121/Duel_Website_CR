import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { gunzipB64, gzipB64, packText, unpackText } from '../src/state/deckCodec';
import {
  LIBRARY_PART_SIZE,
  PART_ID,
  heldPart,
  holdsParts,
  partId,
  partJson,
  partition,
  partsOf,
  rememberPart,
} from '../src/state/libraryParts';

/* The saved library in parts (2026-10-09).
 *
 * Asked for: "I already have 225 decks ... I want to have like unlimited ...
 * and try to make 1000 saved decks for everyone". One document cannot be
 * unlimited, so the library is a list of parts. Two properties carry that and
 * both fail quietly: where the cuts fall (get it wrong and every save rewrites
 * and re-uploads the whole library), and how a part is named (get it wrong and
 * a changed part is taken for one already stored).
 */

const set = (n: number) => ({ id: `id-${n}`, name: `Duel Deck ${n}`, mode: 'versus' });
/** Newest first, as the store keeps it: `library(3)` is sets 3, 2, 1. */
const library = (n: number) => Array.from({ length: n }, (_, i) => set(n - i));

describe('partition — where the cuts fall', () => {
  it('cuts nothing out of nothing', () => {
    expect(partition([])).toEqual([]);
  });

  it('keeps the library whole and in order', () => {
    for (const n of [1, 199, 200, 201, 225, 400, 1000, 1001]) {
      const lib = library(n);
      const parts = partition(lib);
      expect(parts.flat()).toEqual(lib);
      expect(parts.every((p) => p.length >= 1 && p.length <= LIBRARY_PART_SIZE)).toBe(true);
    }
  });

  it('fills every part but the first — it is cut from the back', () => {
    expect(partition(library(225)).map((p) => p.length)).toEqual([25, 200]);
    expect(partition(library(200)).map((p) => p.length)).toEqual([200]);
    expect(partition(library(401)).map((p) => p.length)).toEqual([1, 200, 200]);
    expect(partition(library(1000)).map((p) => p.length)).toEqual([200, 200, 200, 200, 200]);
  });

  it('a new saved set changes the first part and no other', () => {
    /* The store puts a new set on the FRONT. Cut from the front instead, this
       shifts every boundary: one save would rewrite and re-upload all of it. */
    const before = library(225);
    const after = [set(226), ...before];
    const a = partsOf(before);
    const b = partsOf(after);
    expect(b.map((p) => p.members.length)).toEqual([26, 200]);
    expect(b[1].id).toBe(a[1].id);
    expect(b[1].members).toEqual(a[1].members);
    expect(b[0].id).not.toBe(a[0].id);
  });

  it('a full first part starts a new one, leaving the old one as it was', () => {
    const before = library(400);
    const after = [set(401), ...before];
    const a = partsOf(before).map((p) => p.id);
    const b = partsOf(after).map((p) => p.id);
    expect(b).toHaveLength(3);
    expect(b.slice(1)).toEqual(a);
  });

  it('renaming a set changes only the part it is in', () => {
    const before = library(450);
    const after = before.map((s, i) => (i === 300 ? { ...s, name: 'Finals' } : s));
    const a = partsOf(before).map((p) => p.id);
    const b = partsOf(after).map((p) => p.id);
    expect(b.filter((id, i) => id !== a[i])).toHaveLength(1);
    expect(b[0]).toBe(a[0]);
  });
});

describe('partId — a part named by what is in it', () => {
  it('is the same for the same JSON and different for any other', () => {
    const json = partJson(library(200));
    expect(partId(json)).toBe(partId(json));
    expect(partId(json)).not.toBe(partId(json.replace('Duel Deck 7"', 'Duel Deck 8"')));
    expect(partId(json)).not.toBe(partId(`${json} `));
  });

  it('has the shape the server accepts', () => {
    for (const text of ['', '[]', partJson(library(1)), partJson(library(200)), 'ünïcödé ✓']) {
      expect(partId(text)).toMatch(PART_ID);
    }
  });

  it('does not collide over a few thousand different parts', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) seen.add(partId(partJson([set(i)])));
    expect(seen.size).toBe(4000);
  });

  it('survives a round trip through JSON, so a reloaded library keeps its part names', () => {
    /* What is read back from storage or from the account is parsed JSON. If
       re-serialising it gave different text, every part would look new after
       every reload and be written and uploaded again. */
    const members = library(200);
    const json = partJson(members);
    expect(partId(partJson(JSON.parse(json)))).toBe(partId(json));
  });
});

describe('partsOf — a part is named once', () => {
  it('reuses the name of a part whose members are the same objects', () => {
    const lib = library(450);
    const first = partsOf(lib);
    // A different array of the same sets, as a store update produces.
    const again = partsOf([...lib]);
    expect(again.map((p) => p.id)).toEqual(first.map((p) => p.id));
  });

  it('takes a name it is handed for members it has not seen', () => {
    const members = library(200);
    rememberPart(members, 'ffffffffffffffffzz');
    expect(partsOf(members)[0].id).toBe('ffffffffffffffffzz');
  });

  it('does not trust a remembered name once a member is a different object', () => {
    const members = library(200);
    rememberPart(members, 'ffffffffffffffffzz');
    const edited = members.map((s, i) => (i === 3 ? { ...s, name: 'changed' } : s));
    expect(partsOf(edited)[0].id).toBe(partId(partJson(edited)));
  });
});

describe('the parts a tab has in hand', () => {
  /* What lets a page load download only what it lacks: the account's head
     lists part names, and a part named here is a part already held. */
  it('are the parts of the library it last cut', () => {
    const lib = library(450);
    const parts = partsOf(lib);
    expect(holdsParts()).toBe(true);
    for (const p of parts) expect(heldPart(p.id)).toEqual(p.members);
  });

  it('move on with the library — an old part is not kept for ever', () => {
    const before = partsOf(library(450));
    const after = partsOf([set(451), ...library(450)]);
    // The first part changed; the two full ones are the same parts as before.
    expect(heldPart(before[0].id)).toBeUndefined();
    expect(heldPart(after[0].id)).toEqual(after[0].members);
    expect(after.slice(1).every((p) => heldPart(p.id) !== undefined)).toBe(true);
  });

  it('include a part handed over from storage', () => {
    const members = library(200);
    rememberPart(members, 'aaaaaaaaaaaaaaaazz');
    expect(heldPart('aaaaaaaaaaaaaaaazz')).toBe(members);
  });

  it('are empty once the library is', () => {
    partsOf(library(10));
    partsOf([]);
    expect(holdsParts()).toBe(false);
  });

  it('are not disturbed by a question asked at another size', () => {
    const lib = library(450);
    const parts = partsOf(lib);
    partsOf(lib, 50);
    expect(parts.every((p) => heldPart(p.id) !== undefined)).toBe(true);
  });
});

describe('the two compressed forms', () => {
  const samples = [
    '',
    '[]',
    'a',
    partJson(library(1)),
    partJson(library(200)),
    'Finals — “Bo5” ✓ デッキ колода',
  ];

  it('the account form round-trips, and the server can read it', () => {
    for (const text of samples) {
      const b64 = gzipB64(text);
      expect(gunzipB64(b64)).toBe(text);
      // `api/decks.ts` inflates with node:zlib.
      expect(gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')).toBe(text);
    }
  });

  it('reads what node:zlib wrote', () => {
    const text = partJson(library(200));
    expect(gunzipB64(gzipSync(text).toString('base64'))).toBe(text);
  });

  it('refuses what is not gzip rather than answering with nothing', () => {
    expect(() => gunzipB64('bm90IGd6aXA=')).toThrow();
  });

  it('the browser form round-trips at every length', () => {
    for (const text of samples) expect(unpackText(packText(text))).toBe(text);
    // Fifteen bits do not divide eight: every remainder of the byte length.
    let s = '';
    for (let i = 0; i < 40; i++) {
      s += String.fromCharCode(33 + ((i * 37) % 90));
      expect(unpackText(packText(s))).toBe(s);
    }
  });

  it('the browser form is text any storage will hold', () => {
    /* 0x0020-0x801F: no control character, and never half of a surrogate pair
       (those start at 0xD800), which some storage rewrites or refuses. */
    const packed = packText(partJson(library(200)));
    for (let i = 0; i < packed.length; i++) {
      const c = packed.charCodeAt(i);
      expect(c >= 0x20 && c <= 0x801f).toBe(true);
    }
  });

  it('a damaged value reads as missing, never as empty', () => {
    const packed = packText(partJson(library(50)));
    expect(unpackText('')).toBeNull();
    expect(unpackText('not packed')).toBeNull();
    expect(unpackText(packed.slice(0, packed.length - 20))).toBeNull();
    expect(unpackText(`zz${packed}`)).toBeNull();
  });
});
