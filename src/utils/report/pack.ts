/**
 * PAGINATION — pure, no imports, so it is tested without a renderer.
 *
 * A block arrives as a list of ATOMS: units that may not be split (a table
 * row, a row of deck cards, one duel series). Each carries its height, the gap
 * it wants above it when something precedes it on the page, and two flags:
 *
 *   keep         this atom must share a page with the next one — a heading
 *                with its first row, a table header with its first line. A
 *                chain of keeps travels as a whole.
 *   breakBefore  this atom opens a new page (a section opener).
 *
 * `contH` is the height of the CONTINUATION heading an atom needs if it has to
 * open a page mid-block: landing on a sheet of table rows with no heading,
 * because the heading was on the sheet before, is the most disorienting thing
 * a paginated document does. The packer reserves the room and marks the
 * placement; the engine draws "<heading> — continued" there.
 *
 * GREEDY, AND THAT IS ENOUGH HERE. Every atom is small against a page (the
 * largest is a five-game series at ~95 mm of a 176 mm body), so a greedy fill
 * wastes at most one atom's height per sheet.
 */

export interface PackItem {
  h: number;
  /** Space above this atom when it is not first on its page. */
  gap: number;
  keep?: boolean;
  breakBefore?: boolean;
  /** Height of the continuation heading, if this atom may open a page
   *  mid-block. Absent on the block's own first atom. */
  contH?: number;
}

export interface Placement {
  /** Index into the input list. */
  item: number;
  y: number;
  /** True for the continuation heading reserved above `item`. */
  cont?: boolean;
}

export interface PackOptions {
  /** Top of the body on every page after the first. */
  top: number;
  bottom: number;
  /** Top of the body on the first page, when something (a hero band) sits
   *  above it. Defaults to `top`. */
  firstTop?: number;
  /** Gap between a continuation heading and the atom under it. */
  contGap?: number;
}

const EPS = 0.01;

export function pack(items: readonly PackItem[], opts: PackOptions): Placement[][] {
  const pages: Placement[][] = [[]];
  const contGap = opts.contGap ?? 2;
  let y = opts.firstTop ?? opts.top;
  let empty = true;

  const newPage = () => {
    pages.push([]);
    y = opts.top;
    empty = true;
  };

  /** Height from `i` to the end of its keep chain, gaps included (the first
   *  atom's own gap excluded). */
  const chainHeight = (i: number): number => {
    let h = items[i].h;
    let j = i;
    while (items[j].keep && j + 1 < items.length && !items[j + 1].breakBefore) {
      j += 1;
      h += items[j].gap + items[j].h;
    }
    return h;
  };

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (it.breakBefore && !empty) newPage();

    const chain = chainHeight(i);
    const gap = empty ? 0 : it.gap;
    const cont = empty && it.contH ? it.contH + contGap : 0;

    if (!empty && y + gap + chain > opts.bottom + EPS) {
      // Would it fit on a fresh page? If not even there, it is placed here
      // and allowed to break inside its chain — nothing better exists.
      const fresh = (it.contH ? it.contH + contGap : 0) + chain;
      if (fresh <= opts.bottom - opts.top + EPS || y + gap + it.h > opts.bottom + EPS) {
        newPage();
        i -= 1;
        continue;
      }
    }

    const page = pages[pages.length - 1];
    if (cont) {
      page.push({ item: i, y, cont: true });
      y += cont;
    }
    page.push({ item: i, y: y + gap });
    y += gap + it.h;
    empty = false;
  }

  // A trailing empty page can only come from a break with nothing after it.
  if (pages.length > 1 && pages[pages.length - 1].length === 0) pages.pop();
  return pages;
}

/** The bottom edge of what is placed on a page, for fill measurements. */
export function pageBottom(page: readonly Placement[], items: readonly PackItem[], contH = 0): number {
  let b = 0;
  for (const p of page) {
    const h = p.cont ? (items[p.item].contH ?? contH) : items[p.item].h;
    b = Math.max(b, p.y + h);
  }
  return b;
}
