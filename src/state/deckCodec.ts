import { deflateSync, gunzipSync, gzipSync, inflateSync, strFromU8, strToU8 } from 'fflate';

/**
 * deckCodec.ts — a part of the saved library, made small. Two forms, one for
 * each place it is kept (`libraryParts.ts` says what a part is).
 *
 * SYNCHRONOUS, WHICH IS WHY IT IS `fflate` AND NOT `CompressionStream`. The
 * browser's own gzip is a stream and answers in a promise; the deck store is
 * written to `localStorage` inside a store update and read back before the
 * first render, and neither can wait. `fflate` was already in the tree (jsPDF
 * depends on it) and measured ~15-30 ms for a 200-set part. `lz-string` packs
 * the same text into the same number of characters and took ~140 ms.
 */

function toBase64(bytes: Uint8Array): string {
  // Chunked: `String.fromCharCode(...bytes)` on a large array overflows the
  // argument limit.
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Text -> gzip -> base64: the form a part travels to the account in.
 *  `api/decks.ts` inflates it with `node:zlib`. */
export function gzipB64(text: string): string {
  return toBase64(gzipSync(strToU8(text), { level: 6, mtime: 0 }));
}

/** The reverse. Throws on anything that is not gzip — the caller decides what
 *  an unreadable part means, and it is never "an empty one". */
export function gunzipB64(b64: string): string {
  return strFromU8(gunzipSync(fromBase64(b64)));
}

/* ── the browser's form ──────────────────────────────────────────────────────
 *
 * `localStorage` holds strings and counts characters, so the bytes are packed
 * FIFTEEN BITS TO A CHARACTER, each offset by 32. Every character then falls
 * in 0x0020-0x801F: never a control character, never half of a surrogate pair
 * (those start at 0xD800), so the string is valid text in every browser's
 * storage. Base64 would spend a character on six bits; this spends it on
 * fifteen. Measured: 1,000 five-deck sets are 2.25 M characters of JSON and
 * ~0.30 M stored this way (`tests/deckStorage.test.ts` holds the figure).
 *
 * The byte length leads the string (`<base36>:`), because fifteen does not
 * divide eight and the last character carries padding.
 */

function pack15(bytes: Uint8Array): string {
  const pieces: string[] = [];
  const buf = new Uint16Array(0x4000);
  let n = 0;
  let acc = 0;
  let bits = 0;
  const flush = () => {
    pieces.push(String.fromCharCode.apply(null, buf.subarray(0, n) as unknown as number[]));
    n = 0;
  };
  for (let i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    if (bits >= 15) {
      bits -= 15;
      buf[n++] = ((acc >>> bits) & 0x7fff) + 32;
      acc &= (1 << bits) - 1;
      if (n === buf.length) flush();
    }
  }
  if (bits > 0) buf[n++] = ((acc << (15 - bits)) & 0x7fff) + 32;
  if (n > 0) flush();
  return `${bytes.length.toString(36)}:${pieces.join('')}`;
}

function unpack15(packed: string): Uint8Array | null {
  const colon = packed.indexOf(':');
  if (colon < 1 || colon > 12) return null;
  const head = packed.slice(0, colon);
  if (!/^[0-9a-z]+$/.test(head)) return null;
  const length = parseInt(head, 36);
  if (!Number.isSafeInteger(length) || length < 0) return null;
  // A character carries under two bytes. A length the text cannot hold is a
  // damaged header, and must not be allowed to allocate what it claims.
  if (length > (packed.length - colon) * 2) return null;
  const out = new Uint8Array(length);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = colon + 1; i < packed.length && o < length; i++) {
    const v = packed.charCodeAt(i) - 32;
    if (v < 0 || v > 0x7fff) return null;
    acc = (acc << 15) | v;
    bits += 15;
    while (bits >= 8 && o < length) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  return o === length ? out : null;
}

/** Text -> deflate -> packed characters: the form a part is kept in here. */
export function packText(text: string): string {
  return pack15(deflateSync(strToU8(text), { level: 6 }));
}

/** The reverse, or null for anything that does not unpack cleanly. A part that
 *  will not read is a part that is missing; it is never read as empty. */
export function unpackText(packed: string): string | null {
  try {
    const bytes = unpack15(packed);
    return bytes ? strFromU8(inflateSync(bytes)) : null;
  } catch {
    return null;
  }
}
