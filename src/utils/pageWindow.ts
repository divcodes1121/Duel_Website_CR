/**
 * Which page numbers a pager draws.
 *
 * NO IMPORTS, the same rule `tiers.ts`, `utils/format.ts` and `squadParse.ts`
 * follow: this decides what a reader can reach, and a wrong answer (a page
 * that cannot be clicked to, a gap hiding one page) renders confidently and
 * looks correct. It has to be testable without a component around it.
 *
 * ── THE WINDOW KEEPS A FIXED NUMBER OF SLOTS ──────────────────────────────
 *
 * First page, last page, `siblings` either side of the current one, and a gap
 * wherever pages are skipped — the arrangement MUI's pagination uses. Its one
 * property that matters here: once there are more pages than slots, the
 * number of items is ALWAYS `2 * siblings + 5`, whatever page is current. So
 * the control is the same width on page 1 as on page 30,000, and the prev /
 * next arrows never move out from under a pointer that is clicking them.
 *
 * A gap never stands in for exactly one page. Where only one page would be
 * skipped, that page is drawn instead — an ellipsis hiding a single number is
 * a click the reader could have had for free.
 */

export type PageItem = number | 'start-gap' | 'end-gap';

export function pageWindow(page: number, total: number, siblings = 1): PageItem[] {
  const count = Math.max(0, Math.floor(total));
  if (count === 0) return [];
  const sib = Math.max(0, Math.floor(siblings));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), count);

  // Few enough pages to draw them all.
  if (count <= 2 * sib + 5) {
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  // The run of pages around the current one, pushed off either end so it
  // always holds 2 * sib + 1 numbers.
  const start = Math.max(Math.min(current - sib, count - 2 * sib - 2), 3);
  const end = Math.min(Math.max(current + sib, 2 * sib + 3), count - 2);

  const items: PageItem[] = [1];
  items.push(start > 3 ? 'start-gap' : 2);
  for (let p = start; p <= end; p++) items.push(p);
  items.push(end < count - 2 ? 'end-gap' : count - 1);
  items.push(count);
  return items;
}
