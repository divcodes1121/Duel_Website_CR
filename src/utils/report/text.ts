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
 * If the fonts could not be fetched the renderer falls back to jsPDF's
 * built-in Helvetica, which is WinAnsi (Latin-1) only — `latin1()` is that
 * narrower filter, and the one the old renderer used everywhere.
 */

import glyphs from './glyphs.json';

export type FontRole = 'body' | 'bodyBold' | 'display';

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

const HAS: Record<FontRole, (cp: number) => boolean> = {
  body: lookup((glyphs as Record<string, Ranges>).body),
  bodyBold: lookup((glyphs as Record<string, Ranges>).bodyBold),
  display: lookup((glyphs as Record<string, Ranges>).display),
};

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
 *  to load and Helvetica is standing in. */
export function drawable(s: string | null | undefined, role: FontRole, embedded: boolean): string {
  if (!s) return '';
  return filter(String(s), embedded ? HAS[role] : LATIN1);
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
export function printableName(name: string | null | undefined, fallback: string): string {
  if (!name) return fallback;
  const letters = [...name].filter((ch) => /[\p{L}\p{N}]/u.test(ch));
  if (!letters.length) return fallback;
  // Returned CLEANED, not raw: "Danzai ✨" printed as "Danzai ’s decks" and
  // "Danzai : head to head" — the emoji went and the space before it stayed.
  const clean = drawable(name, 'body', true);
  const kept = [...clean].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
  return kept >= 2 && kept / letters.length >= 0.6 ? clean : fallback;
}

/** True when every character of `s` is drawable in `role` as it stands. */
export function isDrawable(s: string, role: FontRole): boolean {
  for (const ch of s) {
    if (!HAS[role](ch.codePointAt(0) as number)) return false;
  }
  return true;
}
