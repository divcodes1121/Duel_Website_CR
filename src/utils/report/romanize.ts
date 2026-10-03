/**
 * A NAME IN LATIN LETTERS, when it was not written in them.
 *
 * A report is read by people who may not read the script a player's name is
 * in, so a name in kana or Cyrillic prints twice: as written, and romanised —
 * "こっとん (Kotton)". The first is what the game shows; the second is what
 * a teammate can say out loud and type into a chat.
 *
 * ONLY SCRIPTS THAT ROMANISE BY RULE. Kana (Hepburn) and Cyrillic are sound
 * for sound, so a table is the whole job. Kanji, hanzi and hangul are not: a
 * kanji's reading depends on the word and, in a name, on the person. A wrong
 * reading printed beside a name is worse than none, so a name holding any
 * letter this cannot read returns null and prints as written, beside its tag.
 *
 * NO IMPORTS, so the rules are testable without a font or a document.
 */

const KANA: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'o', ん: 'n', ゔ: 'vu',
  ゕ: 'ka', ゖ: 'ke', ゎ: 'wa',
};

const SMALL_Y: Record<string, string> = { ゃ: 'a', ゅ: 'u', ょ: 'o' };
const SMALL_V: Record<string, string> = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' };
const MACRON: Record<string, string> = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', е: 'e', ё: 'yo', є: 'ye', ж: 'zh',
  з: 'z', и: 'i', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ў: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ђ: 'dj', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', џ: 'dz', ѓ: 'g', ќ: 'k', ѕ: 'dz',
};

/** Katakana to hiragana: the two blocks are 0x60 apart, letter for letter. */
function hira(ch: string): string {
  const cp = ch.codePointAt(0) as number;
  if (cp >= 0x30a1 && cp <= 0x30f6) return String.fromCodePoint(cp - 0x60);
  return ch;
}

const isKana = (ch: string): boolean => {
  const cp = ch.codePointAt(0) as number;
  return (cp >= 0x3041 && cp <= 0x3096) || (cp >= 0x30a1 && cp <= 0x30f6) || cp === 0x30fc;
};

const isLetter = (ch: string): boolean => /[\p{L}\p{N}]/u.test(ch);
const isLatin = (ch: string): boolean => /[\p{Script=Latin}\p{N}]/u.test(ch);

/**
 * KATAKANA THAT IS A FACE, NOT A SYLLABLE. "Danzai ツ" is a smile, and ツ, シ
 * and their kin standing alone between non-kana are drawn, not read — spelling
 * one out would print "Danzai Tsu" beside a name that says no such thing.
 */
const FACES = new Set(['ツ', 'シ', 'ッ', 'ヅ', 'ジ', 'ノ', 'ヾ', 'ゞ']);

/** One kana and the small kana after it, as Latin. Returns [text, consumed]. */
function syllable(chars: string[], i: number): [string, number] {
  const base = KANA[chars[i]];
  if (base === undefined) return ['', 1];
  const next = chars[i + 1];
  const head = base.slice(0, -1);
  const vowel = base.slice(-1);

  if (next && SMALL_Y[next]) {
    const v = SMALL_Y[next];
    if (base === 'shi' || base === 'chi' || base === 'ji') return [head + v, 2];
    if (base.length === 1) return [`${base}y${v}`, 2];
    return [`${head}y${v}`, 2];
  }
  if (next && SMALL_V[next]) {
    const v = SMALL_V[next];
    // Lengthening: まぁ is "taa", not a new syllable.
    if (v === vowel) return [base + v, 2];
    if (base === 'u') return [`w${v}`, 2];
    if (base === 'ku' || base === 'gu') return [`${head}w${v}`, 2];
    if (vowel === 'u' && head) return [head + v, 2]; // fa, va, tsa
    if ((base === 'shi' || base === 'chi' || base === 'ji') && v === 'e') return [head + v, 2];
    if ((base === 'te' || base === 'de') && v === 'i') return [head + v, 2];
    if ((base === 'to' || base === 'do') && v === 'u') return [head + v, 2];
    return [base + v, 2];
  }
  return [base, 1];
}

/** A run of kana as Hepburn, lower case. */
function kanaRun(run: string): string {
  const chars = [...run].map(hira);
  let out = '';
  let double = false;
  for (let i = 0; i < chars.length;) {
    const ch = chars[i];
    if (ch === 'っ') { double = true; i += 1; continue; }
    if (ch === 'ー') {
      const last = out.slice(-1);
      if (MACRON[last]) out = out.slice(0, -1) + MACRON[last];
      i += 1;
      continue;
    }
    let [syl, used] = syllable(chars, i);
    if (!syl && SMALL_V[ch]) syl = SMALL_V[ch];
    if (!syl && SMALL_Y[ch]) syl = `y${SMALL_Y[ch]}`;
    if (double && syl) {
      // っち is "tchi"; every other consonant simply doubles.
      syl = (syl.startsWith('ch') ? 't' : /^[aiueo]/.test(syl) ? '' : syl[0]) + syl;
      double = false;
    }
    out += syl;
    i += used;
  }
  return out;
}

function cyrillic(ch: string): string | undefined {
  const lower = ch.toLowerCase();
  const t = CYRILLIC[lower];
  if (t === undefined) return undefined;
  if (ch !== lower && t) return t[0].toUpperCase() + t.slice(1);
  return t;
}

/**
 * `name` in Latin letters, or null when there is nothing to add: the name is
 * already Latin, or it holds a letter no rule here can read.
 */
export function romanize(name: string | null | undefined): string | null {
  if (!name) return null;
  const chars = [...name.normalize('NFKC')];
  let out = '';
  let converted = false;
  for (let i = 0; i < chars.length;) {
    const ch = chars[i];
    if (isKana(ch)) {
      let j = i;
      while (j < chars.length && isKana(chars[j])) j += 1;
      const run = chars.slice(i, j).join('');
      if (!(run.length === 1 && FACES.has(run))) {
        const latin = kanaRun(run);
        if (latin) {
          // A name's first sound takes a capital; one glued to Latin does not.
          const prev = out.slice(-1);
          out += prev && isLetter(prev) ? latin : latin[0].toUpperCase() + latin.slice(1);
          converted = true;
        }
      }
      i = j;
      continue;
    }
    const cyr = cyrillic(ch);
    if (cyr !== undefined) { out += cyr; converted = true; i += 1; continue; }
    if (ch === '・' || ch === '゠') { out += ' '; i += 1; continue; }
    if (FACES.has(ch)) { i += 1; continue; }
    if (isLetter(ch)) {
      if (!isLatin(ch)) return null;
      out += ch;
    } else if (/[\s\x21-\x7e]/.test(ch)) {
      out += ch;
    }
    i += 1;
  }
  if (!converted) return null;
  const clean = out.replace(/\s+/g, ' ').trim();
  return clean || null;
}

/** ASCII for a filename or a search: macrons folded to their vowels. */
export function asciiFold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}
