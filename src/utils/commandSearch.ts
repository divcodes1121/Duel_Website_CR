/**
 * How the command palette matches what was typed. NO IMPORTS.
 *
 * Three rules, each from what makes a palette trustworthy:
 *
 *   * THE MATCHED LETTERS ARE MARKED. Fuzzy matching forgives "dz" for Duel
 *     Zone, and without the letters shown a fuzzy ranking reads as arbitrary.
 *   * GROUPS KEEP THEIR ORDER. Rows re-rank within a group as you type, but a
 *     group never jumps above another, so the eye learns where things live.
 *   * A TAG IS ALWAYS OFFERED. Anything tag-shaped becomes "Open the analysis
 *     for #…" at the top, because the tag being looked up is usually one this
 *     site has never seen — the same reason the top bar's pill submits on
 *     Enter.
 */

export interface Searchable {
  group: string;
  label: string;
  /** A second line, also searched, weighted below the label. */
  sub?: string;
  /** Extra words that should find this row but are not shown. */
  keywords?: string;
}

export interface Match<T> {
  item: T;
  /** Indexes into `label` to mark. */
  idx: number[];
  /** Indexes into `sub` to mark (only when the label did not match). */
  subIdx: number[];
  score: number;
}

/** The tag alphabet, the same one `normalizeTag` and the server use. */
const TAG_BODY = /^[0289PYLQGRJCUV]{5,12}$/;

/** '#y022grcjq' / 'Y022GRCJQ' -> '#Y022GRCJQ', or null. */
export function tagFromQuery(raw: string): string | null {
  const body = raw.trim().replace(/^#+/, '').toUpperCase();
  return TAG_BODY.test(body) ? `#${body}` : null;
}

const wordStart = (t: string, i: number) => i === 0 || /[^a-z0-9]/.test(t[i - 1]);

/**
 * Where `query` occurs in `text`: a contiguous run scores highest (more so at
 * a word start), then letters in order anywhere, better the closer together
 * and the more of them start words. null when the letters are not all there.
 */
export function fuzzy(
  query: string,
  text: string,
  contiguousOnly = false,
): { score: number; idx: number[] } | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, idx: [] };
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) {
    return {
      score: 200 - at + (wordStart(t, at) ? 60 : 0),
      idx: Array.from({ length: q.length }, (_, j) => at + j),
    };
  }
  if (contiguousOnly) return null;
  const idx: number[] = [];
  let j = 0;
  for (let i = 0; i < t.length && j < q.length; i++) {
    if (q[j] === ' ') {
      j++;
      i--;
      continue;
    }
    if (t[i] === q[j]) {
      idx.push(i);
      j++;
    }
  }
  if (j < q.length) return null;
  const starts = idx.filter((i) => wordStart(t, i)).length;
  return { score: 100 - (idx[idx.length - 1] - idx[0]) + starts * 25, idx };
}

/**
 * The rows to show for `query`, grouped in `groupOrder`. With no query every
 * row shows in its given order; with one, rows that do not match drop out and
 * the rest sort by score within their group.
 */
export function searchCommands<T extends Searchable>(
  items: readonly T[],
  query: string,
  groupOrder: readonly string[],
): Match<T>[] {
  const q = query.trim();
  const out: Match<T>[] = [];
  for (const group of groupOrder) {
    const inGroup = items.filter((i) => i.group === group);
    if (!q) {
      out.push(...inGroup.map((item) => ({ item, idx: [], subIdx: [], score: 0 })));
      continue;
    }
    const scored: Match<T>[] = [];
    for (const item of inGroup) {
      const onLabel = fuzzy(q, item.label);
      if (onLabel) {
        scored.push({ item, idx: onLabel.idx, subIdx: [], score: onLabel.score + 100 });
        continue;
      }
      /* A description and the hidden keywords must match as a RUN. Letters
         scattered through a sentence matched almost anything — "the" found
         Deck Counter through "whaT beats tHis playEr" — and the marks landed
         on random letters, which reads as a broken search. */
      const onSub = item.sub ? fuzzy(q, item.sub, true) : null;
      if (onSub) {
        scored.push({ item, idx: [], subIdx: onSub.idx, score: onSub.score - 50 });
        continue;
      }
      const onWords = item.keywords ? fuzzy(q, item.keywords, true) : null;
      if (onWords) scored.push({ item, idx: [], subIdx: [], score: onWords.score - 100 });
    }
    scored.sort((a, b) => b.score - a.score);
    out.push(...scored);
  }
  return out;
}

/** Splits `text` into runs, marking the indexes in `idx`, for rendering. */
export function markRuns(text: string, idx: readonly number[]): { text: string; mark: boolean }[] {
  const set = new Set(idx);
  const runs: { text: string; mark: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const mark = set.has(i);
    const last = runs[runs.length - 1];
    if (last && last.mark === mark) last.text += text[i];
    else runs.push({ text: text[i], mark });
  }
  return runs;
}
