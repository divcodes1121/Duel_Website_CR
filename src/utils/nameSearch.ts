/* What a search field does with what was typed: a tag opens that player, a
 * name opens the list of players who carry it. No imports, so the rules are
 * tested on their own (`tests/nameSearch.test.ts`).
 *
 * A NAME AND A TAG CAN LOOK ALIKE. Tags use fourteen characters,
 * 0289PYLQGRJCUV, and "PLUGGY" is spelled entirely from them. So the field
 * only treats text as a tag when it says so: a leading `#`, or tag characters
 * with at least one digit in them (fewer than one tag in twenty has none). A
 * look-alike name still offers "Open #PLUGGY" as the dropdown's first row, so
 * nobody is stuck either way.
 */

export const TAG_CHARS = '0289PYLQGRJCUV';
const TAG_BODY = /^[0289PYLQGRJCUV]{3,14}$/;

/** The text as a tag (`#ABC123`), or null if it cannot be one. */
export function asTag(text: string): string | null {
  const t = text.trim().replace(/\s+/g, '').toUpperCase().replace(/^#/, '');
  return TAG_BODY.test(t) ? `#${t}` : null;
}

/** True when Enter should open the tag rather than search names. */
export function isTagIntent(text: string): boolean {
  const raw = text.trim();
  const tag = asTag(raw);
  if (!tag) return false;
  if (raw.startsWith('#')) return true;
  return tag.length >= 7 && /[0289]/.test(tag);
}

/** Where Enter on `text` goes. */
export function searchHash(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  if (isTagIntent(raw)) return `#/player/${encodeURIComponent(asTag(raw)!)}`;
  return `#/search?q=${encodeURIComponent(raw)}`;
}

/** The query a results page was opened with (`#/search?q=sub`). */
export function queryOf(hash: string): string {
  const i = hash.indexOf('?');
  if (i === -1) return '';
  try {
    return new URLSearchParams(hash.slice(i + 1)).get('q') ?? '';
  } catch {
    return '';
  }
}

/** Longest query the server reads; anything longer is not a name. */
export const MAX_QUERY = 32;
/** Characters before the dropdown asks. One letter of a Latin name matches
 *  half the table; one character of a Japanese or Chinese name is often a
 *  quarter of the name. */
export function minChars(text: string): number {
  return /[^\u0000-ɏ]/.test(text) ? 1 : 2;
}

/** Splits `name` around the first case-insensitive occurrence of `query`, for
 *  drawing the match in bold. No occurrence -> the whole name, unmarked. */
export function splitMatch(name: string, query: string): [string, string, string] {
  const q = query.trim().toLowerCase();
  const i = q ? name.toLowerCase().indexOf(q) : -1;
  if (i === -1 || name.toLowerCase().length !== name.length) return [name, '', ''];
  return [name.slice(0, i), name.slice(i, i + q.length), name.slice(i + q.length)];
}

/** Rows in the dropdown. */
export const SUGGEST_LIMIT = 7;
/** Rows on the results page (the server's cap, as on RoyaleAPI). */
export const PAGE_LIMIT = 100;
/** Pause after the last key before asking. The index answers in a few ms, so
 *  this is about not sending a request per letter, not about the server. */
export const DEBOUNCE_MS = 160;

/** "2,655" / "100,000+". */
export function countLabel(total: number, capped: boolean): string {
  return total.toLocaleString('en-US') + (capped ? '+' : '');
}

/** `2026-10-12` -> "12 Oct". Same year as `today` drops the year. */
export function seenLabel(day: string | null, today: Date = new Date()): string {
  if (!day) return '';
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const base = `${d.getUTCDate()} ${month}`;
  return d.getUTCFullYear() === today.getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
}

/** A small answer cache, so backspacing or retyping asks nothing. */
export class AnswerCache<T> {
  private map = new Map<string, T>();
  constructor(private size = 200) {}
  get(key: string): T | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: T): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.size) {
      const first = this.map.keys().next().value as string;
      this.map.delete(first);
    }
  }
}
