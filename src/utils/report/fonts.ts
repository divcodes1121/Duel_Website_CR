/**
 * THE EMBEDDED FACES: Inter 400/600 for everything read, Bebas Neue for the
 * titles and figures — the same pairing the site's landing screen uses.
 *
 * Fetched on the first export and kept as base64 for the rest of the session,
 * so a second export does not refetch or re-encode ~65 kB of font. jsPDF
 * writes only the glyphs a document uses (Identity-H subsetting), so the cost
 * in the PDF itself is a few kB.
 *
 * FAILS SOFT. If any file cannot be fetched the report is drawn in jsPDF's
 * built-in Helvetica instead and every string goes through the Latin-1 filter
 * — a plainer document, never a failed export.
 */

import type { jsPDF } from 'jspdf';
import type { FontRole } from './text';

const FILES: { role: FontRole; file: string; family: string; style: 'normal' | 'bold' }[] = [
  { role: 'body', file: 'Inter-Regular.ttf', family: 'dkBody', style: 'normal' },
  { role: 'bodyBold', file: 'Inter-SemiBold.ttf', family: 'dkBody', style: 'bold' },
  { role: 'display', file: 'BebasNeue.ttf', family: 'dkDisplay', style: 'normal' },
];

let cache: Map<string, string> | null = null;
let pending: Promise<Map<string, string> | null> | null = null;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function fetchAll(): Promise<Map<string, string> | null> {
  if (cache) return cache;
  if (!pending) {
    const base = `${import.meta.env.BASE_URL}assets/fonts/report/`;
    pending = Promise.all(
      FILES.map(async (f) => {
        const res = await fetch(base + f.file);
        if (!res.ok) throw new Error(`font ${f.file}: ${res.status}`);
        return [f.file, toBase64(await res.arrayBuffer())] as const;
      }),
    )
      .then((pairs) => {
        cache = new Map(pairs);
        return cache;
      })
      .catch((e) => {
        console.warn('[report] fonts unavailable, using Helvetica', e);
        pending = null;
        return null;
      });
  }
  return pending;
}

/** Register the faces on `doc`. Returns false when Helvetica must stand in. */
export async function loadFonts(doc: jsPDF): Promise<boolean> {
  const files = await fetchAll();
  if (!files) return false;
  try {
    for (const f of FILES) {
      doc.addFileToVFS(f.file, files.get(f.file) as string);
      doc.addFont(f.file, f.family, f.style);
    }
    return true;
  } catch (e) {
    console.warn('[report] font registration failed, using Helvetica', e);
    return false;
  }
}

/** The jsPDF family and style for a role. */
export function faceOf(role: FontRole, embedded: boolean): [string, 'normal' | 'bold'] {
  if (!embedded) return ['helvetica', role === 'body' ? 'normal' : 'bold'];
  if (role === 'display') return ['dkDisplay', 'normal'];
  return ['dkBody', role === 'bodyBold' ? 'bold' : 'normal'];
}
