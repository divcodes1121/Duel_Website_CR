/**
 * TEXT THE EMBEDDED FONTS CAN ACTUALLY DRAW.
 *
 * A character with no glyph prints as an empty box, and a Clash Royale name is
 * as likely as not to carry an emoji, a crown or a CJK character. A box in a
 * name reads as corruption, so every string is filtered against the code
 * points the font it will be drawn in REALLY holds — `glyphs.json` is written
 * by `scripts/build-report-fonts.py` from the subset files themselves, so this
 * list cannot drift from the fonts.
 *
 * Unsupported characters are not simply dropped: NFKD first (an accent the
 * subset lacks degrades to its base letter, a fullwidth digit to a digit),
 * then a small punctuation map, then removal. Whitespace is collapsed after,
 * so a stripped emoji does not leave a double space in a name.
 *
 * A character the role's own font lacks may still be drawn by another: Inter
 * draws Cyrillic for a Bebas heading, and two Noto Sans JP files draw kana and
 * kanji. `faceFor` is the order they are tried in.
 *
 * If the fonts could not be fetched the renderer falls back to jsPDF's
 * built-in Helvetica, which is WinAnsi (Latin-1) only — `latin1()` is that
 * narrower filter, and the one the old renderer used everywhere.
 */

import glyphs from './glyphs.json';
import { romanize } from './romanize';

export type FontRole = 'body' | 'bodyBold' | 'display';

/**
 * THE FACES A NAME MAY NEED BEYOND THE THREE ABOVE. Fetched only when a
 * document holds a character they cover — see `fonts.ts`.
 */
export type ExtraFace = 'kana' | 'kanji';
export type Face = FontRole | ExtraFace;

type Ranges = number[][];

function lookup(ranges: Ranges): (cp: number) => boolean {
  return (cp) => {
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [a, b] = ranges[mid];
      if (cp < a) hi = mid - 1;
      else if (cp > b) lo = mid + 1;
      else return true;
    }
    return false;
  };
}

/** The kanji face is 6,355 scattered code points, kept as one bit each. */
function bitLookup(set: { from: number; to: number; bits: string }): (cp: number) => boolean {
  const raw = atob(set.bits);
  return (cp) => {
    if (cp < set.from || cp > set.to) return false;
    const i = cp - set.from;
    return (raw.charCodeAt(i >> 3) & (1 << (i & 7))) !== 0;
  };
}

const G = glyphs as unknown as Record<FontRole | 'kana', Ranges> & {
  kanji: { from: number; to: number; bits: string };
};

const HAS: Record<Face, (cp: number) => boolean> = {
  body: lookup(G.body),
  bodyBold: lookup(G.bodyBold),
  display: lookup(G.display),
  kana: lookup(G.kana),
  kanji: bitLookup(G.kanji),
};

/**
 * WHERE A CHARACTER IS LOOKED FOR, IN ORDER. The role's own face first. Bebas
 * has no Cyrillic, so a heading falls to Inter before it falls to Japanese.
 */
const CHAIN: Record<FontRole, Face[]> = {
  body: ['body', 'kana', 'kanji'],
  bodyBold: ['bodyBold', 'kana', 'kanji'],
  display: ['display', 'bodyBold', 'kana', 'kanji'],
};

export const EXTRA_FACES: ExtraFace[] = ['kana', 'kanji'];
const ALL_EXTRA: ReadonlySet<ExtraFace> = new Set(EXTRA_FACES);

/** The face that draws `cp` in `role`, or null when none loaded holds it. */
export function faceFor(cp: number, role: FontRole, extra: ReadonlySet<ExtraFace> = ALL_EXTRA): Face | null {
  for (const f of CHAIN[role]) {
    if ((f === 'kana' || f === 'kanji') && !extra.has(f)) continue;
    if (HAS[f](cp)) return f;
  }
  return null;
}

/** Which of the extra faces `text` needs — what the engine fetches. */
export function facesNeeded(text: string): Set<ExtraFace> {
  const need = new Set<ExtraFace>();
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x3000) continue;
    if (HAS.kana(cp)) need.add('kana');
    else if (HAS.kanji(cp)) need.add('kanji');
    if (need.size === EXTRA_FACES.length) break;
  }
  return need;
}

/** Punctuation mapped rather than dropped when a font lacks it. The en dash
 *  matters most: dropping it turned a "2–1" score into "21". */
const PUNCT: Record<string, string> = {
  '–': '-', '—': '-', '−': '-',
  '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"',
  '•': '·', '…': '...', '→': '>', '←': '<', '↑': '+', '↓': '-',
  '▲': '+', '▼': '-', '★': '*', '✓': 'v', '×': 'x',
  ' ': ' ', ' ': ' ', ' ': ' ',
};

const LATIN1 = (cp: number) => cp === 9 || cp === 10 || (cp >= 32 && cp <= 0xff);

function filter(s: string, has: (cp: number) => boolean): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (has(cp)) { out += ch; continue; }
    // Decompose: keep whatever parts of the character the font does hold.
    const flat = ch.normalize('NFKD');
    let kept = '';
    for (const part of flat) {
      const pc = part.codePointAt(0) as number;
      if (pc >= 0x300 && pc <= 0x36f) continue;
      if (has(pc)) kept += part;
    }
    if (kept) { out += kept; continue; }
    const mapped = PUNCT[ch];
    if (mapped !== undefined) {
      // The mapped form must itself be drawable (it always is: ASCII).
      out += mapped;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Clean `s` for drawing in `role`. `embedded` is false when the fonts failed
 *  to load and Helvetica is standing in; `extra` is the fallback faces that
 *  did load (all of them, when the caller cannot know yet). */
export function drawable(
  s: string | null | undefined,
  role: FontRole,
  embedded: boolean,
  extra: ReadonlySet<ExtraFace> = ALL_EXTRA,
): string {
  if (!s) return '';
  return filter(String(s), embedded ? (cp) => faceFor(cp, role, extra) !== null : LATIN1);
}

/** Latin-1 only — what jsPDF's built-in fonts can encode. */
export function latin1(s: string): string {
  return filter(s, LATIN1);
}

/**
 * A player's name if the report can actually print it, else `fallback`
 * (their tag).
 *
 * Filtering alone is not enough: "Потужнi лававод" keeps its single Latin
 * "i" and prints as "I" — a real name reduced to one letter, which reads as
 * a different player. So a name is kept only when most of its letters and
 * digits survive; otherwise the tag, which is always printable, stands in.
 */
/** Separators and spaces at either end of a name, once glyphs were dropped. */
const DANGLING = /^[\s|·•\-_/\\:~.,;]+|[\s|·•\-_/\\:~.,;]+$/gu;

export function printableName(name: string | null | undefined, fallback: string): string {
  if (!name) return fallback;
  const letters = [...name].filter((ch) => /[\p{L}\p{N}]/u.test(ch));
  if (!letters.length) return fallback;
  // Returned CLEANED, not raw: "Danzai ✨" printed as "Danzai ’s decks" and
  // "Danzai : head to head" — the emoji went and the space before it stayed.
  let clean = drawable(name.normalize('NFC'), 'body', true);
  /* A SEPARATOR LEFT HANGING. "傳奇 | Sir✨Jose✨" loses its CJK title and its
     sparkles to the font, and the " | " that divided title from name was left
     leading the line: "| SirJose" in a contents listing. Only when something
     WAS dropped — a name that really starts with a dash keeps it. */
  if (clean !== name) clean = clean.replace(DANGLING, '').replace(/\s{2,}/g, ' ');
  const kept = [...clean].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
  return kept >= 2 && kept / letters.length >= 0.6 ? clean : fallback;
}

/**
 * The name in Latin letters, when it prints in another script — "Kotton"
 * for "こっとん". Null when the name is already Latin, when it could not be
 * printed at all (the tag is standing in), or when no rule can read it.
 */
export function latinName(name: string | null | undefined): string | null {
  if (!name || !printableName(name, '')) return null;
  const latin = romanize(name);
  if (!latin) return null;
  const clean = drawable(latin, 'body', true).replace(DANGLING, '').replace(/\s{2,}/g, ' ');
  return clean.length >= 2 ? clean : null;
}

/**
 * A name as a report introduces a player: as written, then in Latin letters
 * when those differ — "こっとん (Kotton)". A reader who cannot read the
 * first can still say the second.
 */
export function fullName(name: string | null | undefined, fallback: string): string {
  const shown = printableName(name, fallback);
  const latin = latinName(name);
  return latin && latin !== shown ? `${shown} (${latin})` : shown;
}

/** True when every character of `s` is drawable in `role`'s own face. */
export function isDrawable(s: string, role: FontRole): boolean {
  for (const ch of s) {
    if (!HAS[role](ch.codePointAt(0) as number)) return false;
  }
  return true;
}
