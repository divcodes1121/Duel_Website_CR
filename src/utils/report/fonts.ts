/**
 * THE EMBEDDED FACES: Inter 400/600 for everything read, Bebas Neue for the
 * titles and figures — the same pairing the site's landing screen uses.
 *
 * Fetched on the first export and kept as base64 for the rest of the session,
 * so a second export does not refetch or re-encode ~80 kB of font. jsPDF
 * writes only the glyphs a document uses (Identity-H subsetting), so the cost
 * in the PDF itself is a few kB.
 *
 * FAILS SOFT. If any file cannot be fetched the report is drawn in jsPDF's
 * built-in Helvetica instead and every string goes through the Latin-1 filter
 * — a plainer document, never a failed export.
 *
 * THE JAPANESE FACES ARE FETCHED ONLY WHEN A DOCUMENT NEEDS THEM. A player's
 * name may be kana or kanji, and a name the fonts cannot draw used to print
 * as the player's tag. Noto Sans JP fills that in — kana is 49 kB, kanji is
 * 2 MB — so the engine asks for exactly the faces the document's own strings
 * call for (`facesNeeded`), and a report with no such name fetches neither.
 * One that fails to arrive is simply not offered: its characters are filtered
 * out as they always were, and the export still succeeds.
 */

import type { jsPDF } from 'jspdf';
import type { ExtraFace, Face, FontRole } from './text';

interface FontFile { file: string; family: string; style: 'normal' | 'bold' }

const FILES: Record<FontRole, FontFile> = {
  body: { file: 'Inter-Regular.ttf', family: 'dkBody', style: 'normal' },
  bodyBold: { file: 'Inter-SemiBold.ttf', family: 'dkBody', style: 'bold' },
  display: { file: 'BebasNeue.ttf', family: 'dkDisplay', style: 'normal' },
};

const EXTRA: Record<ExtraFace, FontFile> = {
  kana: { file: 'NotoSansJP-Kana.ttf', family: 'dkKana', style: 'normal' },
  kanji: { file: 'NotoSansJP-Kanji.ttf', family: 'dkKanji', style: 'normal' },
};

export interface LoadedFonts {
  /** False when Helvetica must stand in for everything. */
  embedded: boolean;
  /** The fallback faces registered on this document. */
  extra: Set<ExtraFace>;
}

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** One font file as base64, or null. A failure is not remembered, so the next
 *  export tries again. */
function fetchFile(file: string): Promise<string | null> {
  const hit = cache.get(file);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(file);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}assets/fonts/report/${file}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`font ${file}: ${res.status}`);
        const b64 = toBase64(await res.arrayBuffer());
        cache.set(file, b64);
        return b64;
      })
      .catch((e) => {
        console.warn(`[report] font ${file} unavailable`, e);
        return null;
      })
      .finally(() => { pending.delete(file); });
    pending.set(file, p);
  }
  return p;
}

/** Register the faces on `doc`: the three the engine always uses, and
 *  whichever of `need` could be fetched. */
export async function loadFonts(doc: jsPDF, need: Iterable<ExtraFace> = []): Promise<LoadedFonts> {
  const wanted = [...new Set(need)];
  const [base, extras] = await Promise.all([
    Promise.all(Object.values(FILES).map((f) => fetchFile(f.file))),
    Promise.all(wanted.map((k) => fetchFile(EXTRA[k].file))),
  ]);
  if (base.some((b) => !b)) {
    console.warn('[report] fonts unavailable, using Helvetica');
    return { embedded: false, extra: new Set() };
  }
  try {
    Object.values(FILES).forEach((f, i) => {
      doc.addFileToVFS(f.file, base[i] as string);
      doc.addFont(f.file, f.family, f.style);
    });
  } catch (e) {
    console.warn('[report] font registration failed, using Helvetica', e);
    return { embedded: false, extra: new Set() };
  }
  const extra = new Set<ExtraFace>();
  wanted.forEach((k, i) => {
    const data = extras[i];
    if (!data) return;
    try {
      doc.addFileToVFS(EXTRA[k].file, data);
      doc.addFont(EXTRA[k].file, EXTRA[k].family, EXTRA[k].style);
      extra.add(k);
    } catch (e) {
      console.warn(`[report] font ${EXTRA[k].file} could not be registered`, e);
    }
  });
  return { embedded: true, extra };
}

/** The jsPDF family and style for a face. */
export function faceOf(face: Face, embedded: boolean): [string, 'normal' | 'bold'] {
  if (!embedded) return ['helvetica', face === 'body' ? 'normal' : 'bold'];
  if (face === 'kana' || face === 'kanji') return [EXTRA[face].family, EXTRA[face].style];
  return [FILES[face].family, FILES[face].style];
}
