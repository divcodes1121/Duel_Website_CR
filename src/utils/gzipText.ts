/**
 * Text <-> gzip+base64, with the browser's own `CompressionStream`.
 *
 * WHY IT EXISTS: a saved Team Analysis travels to the account as one request,
 * and the endpoint caps a request at 1 MB. A compacted 12v12 report is ~858 kB
 * of JSON — under, by 14% — and would not have stayed under for long. Gzipped
 * it is ~56 kB. `api/decks.ts` inflates it with `node:zlib`.
 *
 * NO IMPORTS, so vitest runs it in Node, which ships the same
 * `CompressionStream` / `DecompressionStream` the browser does.
 *
 * `canGzip()` is checked by the caller: a browser without the API (Safari
 * before 16.4) sends plain JSON, which the endpoint still accepts.
 */

export function canGzip(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

async function pipe(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

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

export async function gzipText(text: string): Promise<string> {
  return toBase64(await pipe(new TextEncoder().encode(text), new CompressionStream('gzip')));
}

export async function gunzipText(b64: string): Promise<string> {
  return new TextDecoder().decode(await pipe(fromBase64(b64), new DecompressionStream('gzip')));
}
