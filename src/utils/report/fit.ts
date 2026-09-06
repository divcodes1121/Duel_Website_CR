/**
 * THE LAYOUT DECISION LAYER — the part that chooses, rather than the part that
 * draws.
 *
 * NO IMPORTS beyond `geometry`, which has none itself. This is the whole
 * argument for the file existing: the decisions in here are the ones that make
 * a page look designed or look generated, they are pure arithmetic over
 * measured numbers, and they must be testable without a jsPDF instance, a
 * browser, or card art.
 *
 * THE RULE THE WHOLE FILE SERVES: content determines layout. A component does
 * not state how many columns it has; it states what it is made of and what it
 * needs to stay readable, and `chooseGrid` answers the question against the
 * room actually available. The same block of 24 pairs therefore comes out
 * eight across on a full page and four across in a half-width column, without
 * either call site knowing the other exists.
 */

import { CARD_MIN, FILL_MIN, clamp, itemWidth } from './geometry';

/* ------------------------------------------------------------------ atoms */

/**
 * AN ATOM IS THE SMALLEST THING THAT MAY NOT BE SPLIT ACROSS A PAGE BREAK.
 *
 * Not a block and not a line — a block is usually several atoms (a heading, a
 * row, a row, a row) and splitting one of THOSE is exactly the failure the
 * brief names. A deck card cut in half at the fold, a series row whose score
 * is on the next sheet, a chart with its axis orphaned: all of them are one
 * atom that was allowed to divide.
 *
 * `h` is MEASURED, never estimated. That is the single property this whole
 * system rests on, and the reason the type has no `estimate` field to fall
 * back to — a renderer that may guess a height will guess, and the guesses are
 * what produce stranded headings and half-empty sheets.
 */
export interface Atom {
  /** Measured height in millimetres. */
  h: number;
  /**
   * This atom introduces the one after it and must not be the last thing on a
   * page. A heading, a column header, a context line. Chains nest: three atoms
   * each keeping with the next travel as a unit of four.
   */
  keepWithNext?: boolean;
  /** For diagnostics and the audit's messages. */
  kind?: string;
  /** Anything the caller wants back on the far side of packing. */
  payload?: unknown;
}

/* ------------------------------------------------------------------ grids */

export interface GridSpec {
  /** How many items are being laid out. */
  count: number;
  /** The width they have to share. */
  width: number;
  /** Height available on the first page, and on any page after it. */
  first: number;
  rest: number;
  /** Horizontal and vertical gaps. */
  gap: number;
  rowGap: number;
  /** Item width bounds. Below `min` the engine paginates instead. */
  min: number;
  ideal: number;
  max: number;
  /** A row's height for a given item width — the caller owns this, because
   *  only it knows how much type sits under the art. */
  rowHeight: (itemW: number) => number;
  /** Column counts to consider. Defaults to everything that clears `min`. */
  allow?: number[];
}

export interface GridPlan {
  cols: number;
  itemW: number;
  rowH: number;
  /** How many items are on each row — not always `cols`, see `balanceRows`. */
  rows: number[];
  /** Rows that fit on the first page, and on each page after. */
  rowsFirst: number;
  rowsRest: number;
  pages: number;
  /** 0..1, how close the item is to `ideal`. The legibility half of the score. */
  legibility: number;
  /** 0..1, how much of the last page's height is used. */
  fill: number;
  score: number;
}

/**
 * SPREAD THE LAST ROW RATHER THAN ORPHANING IT.
 *
 * Nine items in eight columns is a row of eight and a row of one, and the one
 * reads as a mistake — the eye asks what happened to the other seven. Evenly
 * distributed it is 5 and 4, which reads as a deliberate two-row block.
 *
 * ONLY WHEN THE ORPHAN IS ACTUALLY SMALL. Twenty-five items in eight columns
 * is 8/8/8/1, and rebalancing all four rows to 7/6/6/6 makes every row on the
 * page looser to fix one. The rule is that a last row under half the column
 * count gets balanced and anything above it is left alone, because a last row
 * of five out of eight already reads as a row.
 */
export function balanceRows(count: number, cols: number): number[] {
  if (count <= 0 || cols <= 0) return [];
  if (count <= cols) return [count];
  const full = Math.floor(count / cols);
  const rem = count % cols;
  if (rem === 0) return Array<number>(full).fill(cols);
  if (rem * 2 >= cols) {
    const out = Array<number>(full).fill(cols);
    out.push(rem);
    return out;
  }
  // Spread across one more row than a full pack would need.
  const rowCount = full + 1;
  const base = Math.floor(count / rowCount);
  let extra = count % rowCount;
  const out: number[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    out.push(base + (extra > 0 ? 1 : 0));
    if (extra > 0) extra -= 1;
  }
  return out;
}

/**
 * CHOOSE THE COLUMN COUNT. This is the "18 records, therefore three columns
 * rather than two" decision the brief asks for, and it is made by measuring
 * every candidate rather than by a rule of thumb.
 *
 * The score is deliberately NOT "most items per page". Packing hardest always
 * wins that, and packing hardest is how a card board ends up at 6 mm a card.
 * It is a sum of three terms:
 *
 *   PAGES       — dominant. One sheet instead of two is worth more than any
 *                 amount of prettiness, because a reader turns pages.
 *   LEGIBILITY  — how close the item lands to `ideal`, punished hard below it
 *                 and softly above. Being too big is a taste failure; being
 *                 too small is a functional one, and they are not symmetric.
 *   FILL        — a tiebreak only. Two layouts on the same page count, one of
 *                 which leaves a third of the last sheet empty, are not
 *                 equally good — but fill must never outrank legibility, or
 *                 the engine will shrink art to close a gap.
 */
export function chooseGrid(spec: GridSpec): GridPlan | null {
  const { count, width, first, rest, gap, rowGap, min, ideal, max } = spec;
  if (count <= 0 || width <= 0) return null;

  const widest = Math.max(1, Math.floor((width + gap) / (min + gap)));
  const candidates = spec.allow ?? Array.from({ length: widest }, (_, i) => i + 1);

  let best: GridPlan | null = null;
  for (const cols of candidates) {
    if (cols < 1) continue;
    // A grid wider than its content just adds empty columns.
    if (cols > count) continue;
    const raw = itemWidth(width, cols, gap);
    if (raw < min) continue;
    const itemW = Math.min(raw, max);
    const rowH = spec.rowHeight(itemW);
    if (rowH <= 0) continue;

    const rowsFirst = Math.max(0, Math.floor((first + rowGap) / (rowH + rowGap)));
    const rowsRest = Math.max(1, Math.floor((rest + rowGap) / (rowH + rowGap)));
    if (rowsFirst < 1 && rowsRest < 1) continue;

    const rows = balanceRows(count, cols);
    const pages = rowsFirst >= rows.length
      ? 1
      : 1 + Math.ceil((rows.length - rowsFirst) / rowsRest);

    // Legibility: 1 at `ideal`, falling away on both sides, steeply below it.
    const legibility = itemW >= ideal
      ? clamp(1 - ((itemW - ideal) / (max - ideal || 1)) * 0.25, 0, 1)
      : clamp(1 - ((ideal - itemW) / (ideal - min || 1)) ** 1.4, 0, 1);

    // How full the LAST page comes out — the one that can look unfinished.
    const before = rowsFirst + Math.max(0, pages - 2) * rowsRest;
    const lastRows = pages === 1 ? rows.length : Math.max(1, rows.length - before);
    const lastRoom = pages === 1 ? first : rest;
    const fill = clamp((lastRows * (rowH + rowGap) - rowGap) / lastRoom, 0, 1);

    const score = 1000 / pages + legibility * 120 + fill * 18;
    const plan: GridPlan = {
      cols, itemW, rowH, rows, rowsFirst, rowsRest, pages, legibility, fill, score,
    };
    if (!best || plan.score > best.score) best = plan;
  }
  return best;
}

/**
 * The same decision for a grid of CARD ART, where the row height follows from
 * the card and the only free variables are the columns and the caption.
 *
 * Split out because every image component in this document has the same shape
 * — n cards across, art at a fixed ratio, one or two lines of type under it —
 * and letting each one write its own `rowHeight` closure is how two components
 * that should match end up 0.4 mm apart.
 */
export function chooseCardGrid(
  count: number,
  width: number,
  first: number,
  rest: number,
  captionH: number,
  ratio: number,
  opts: { gap?: number; rowGap?: number; min?: number; ideal?: number; max?: number } = {},
): GridPlan | null {
  return chooseGrid({
    count,
    width,
    first,
    rest,
    gap: opts.gap ?? 1.6,
    rowGap: opts.rowGap ?? 3.2,
    min: opts.min ?? CARD_MIN,
    ideal: opts.ideal ?? 15,
    max: opts.max ?? 22,
    rowHeight: (w) => w / ratio + captionH,
  });
}

/* --------------------------------------------------------------- packing */

export interface PackOptions {
  /** Room on the page the flow starts on. */
  first: number;
  /** Room on every page after it. */
  rest: number;
  /** Gap inserted between atoms. */
  gap?: number;
}

export interface PackedPage {
  atoms: Atom[];
  used: number;
  room: number;
  fill: number;
}

/**
 * PACK ATOMS INTO PAGES.
 *
 * The three rules, and each of them is a bullet from the brief:
 *
 *  1. AN ATOM NEVER SPLITS. If it does not fit in what is left, the whole
 *     thing moves. This is what stops a deck row, a chart or a card being cut
 *     at the fold.
 *  2. A KEEP-WITH-NEXT CHAIN TRAVELS WHOLE. A heading plus the first thing it
 *     introduces is one unit, so a title can never be the last thing on a
 *     sheet. Chains nest: a section header keeping with a column header
 *     keeping with a row moves all three.
 *  3. AN ATOM TALLER THAN A WHOLE PAGE STILL GETS A PAGE rather than looping
 *     for ever. The audit reports it; it must not be silently dropped and it
 *     must not hang the renderer.
 *
 * What this deliberately does NOT do is shrink anything to make it fit.
 * Fitting by shrinking is decided once, up in `chooseGrid`, where the
 * legibility floor lives.
 */
export function packAtoms(atoms: Atom[], opts: PackOptions): PackedPage[] {
  const gap = opts.gap ?? 0;
  const pages: PackedPage[] = [];
  let room = opts.first;
  let cur: Atom[] = [];
  let used = 0;

  const flush = () => {
    pages.push({ atoms: cur, used, room, fill: room > 0 ? used / room : 0 });
    cur = [];
    used = 0;
    room = opts.rest;
  };

  let i = 0;
  while (i < atoms.length) {
    // Gather the keep-with-next chain starting here.
    let end = i;
    while (end < atoms.length - 1 && atoms[end].keepWithNext) end += 1;
    const chain = atoms.slice(i, end + 1);
    const chainH = chain.reduce((s, a) => s + a.h, 0) + gap * (chain.length - 1);
    const fits = used + (cur.length > 0 ? gap : 0) + chainH <= room;

    if (!fits) {
      /* TURN THE PAGE EVEN WHEN NOTHING IS ON THIS ONE YET.

         A flow does not always begin on an empty sheet — it usually begins in
         whatever is left under the block before it — so "the current page is
         empty" is NOT the same question as "this is a whole page". Treating
         them as the same put a chain that needed 100 mm onto the 70 mm left
         under a deck grid, and the only reason it was not visible as an
         overflow is that the variant which won happened to be a smaller one.

         The genuinely oversized atom — one that will not fit a whole page
         either — is still placed rather than looping for ever, and the audit
         reports it. That is the case rule 3 exists for, and it is `room`
         already being a full page that identifies it. */
      const wholePage = cur.length === 0 && room === opts.rest;
      if (!wholePage) {
        flush();
        continue; // re-measure the chain against a fresh page
      }
    }
    if (cur.length > 0) used += gap;
    for (const a of chain) cur.push(a);
    used += chainH;
    i = end + 1;
  }
  if (cur.length > 0 || pages.length === 0) flush();
  return pages;
}

/* -------------------------------------------------------------- variants */

/**
 * A candidate composition for one section, already measured.
 *
 * The engine builds several and keeps one. That is the whole mechanism behind
 * "a KPI-heavy page gets a dashboard composition and a match history gets
 * compact rows" — a section does not pick its shape, it offers the shapes that
 * make sense for its data and the engine measures them.
 */
export interface Variant {
  id: string;
  atoms: Atom[];
  /** 0..1 — how large the imagery and type came out. */
  legibility: number;
  /** Set when a variant states more briefly what the fuller ones draw:
   *  follow-ups named rather than pictured, say. It costs information, so it
   *  is only reached for when the alternative is another sheet. */
  lossy?: boolean;
}

export interface VariantChoice {
  variant: Variant;
  pages: PackedPage[];
  score: number;
}

/**
 * PICK ONE. The same judgement as `chooseGrid`, one level up.
 *
 * The extra term is `lossy`: a variant that drops information to save a page
 * has to beat a faithful one by a whole page before it wins, never on
 * prettiness. That is what stops the engine quietly deciding a reader did not
 * need the follow-up decks drawn.
 */
export function chooseVariant(variants: Variant[], opts: PackOptions): VariantChoice | null {
  let best: VariantChoice | null = null;
  for (const variant of variants) {
    if (variant.atoms.length === 0) continue;
    const pages = packAtoms(variant.atoms, opts);
    const last = pages[pages.length - 1];
    const tail = last ? clamp(last.fill, 0, 1) : 0;
    const penalty = variant.lossy ? 0.6 : 0;
    const score = 1000 / (pages.length + penalty) + variant.legibility * 120 + tail * 18;
    if (!best || score > best.score) best = { variant, pages, score };
  }
  return best;
}

/**
 * SPREAD A SPILLED BLOCK EVENLY INSTEAD OF FILLING FROM THE FRONT.
 *
 * Greedy packing is right for a mixed flow and wrong for a homogeneous one.
 * Eleven series rows over three sheets pack as 5, 5 and 1, and that last sheet
 * — one row under a heading, five sixths of it empty — reads as a mistake in
 * the document rather than as the end of a section. The same eleven rows as
 * 4, 4, 3 fill three sheets that all look deliberate.
 *
 * IT NEVER CHANGES THE PAGE COUNT, which is what makes it safe to apply after
 * the variant has been chosen: the choice was made on page count, and a
 * rebalance that could add a page would invalidate it. It only moves rows
 * backwards into pages that already exist.
 *
 * ONLY FOR A UNIFORM RUN. Atoms of different kinds have different heights, so
 * "an even number each" is not evenness at all; and a keep-with-next chain
 * must not be broken up to make the arithmetic tidy. Both conditions are
 * checked rather than assumed.
 */
export function balanceFlow(pages: PackedPage[], opts: PackOptions): PackedPage[] {
  if (pages.length < 2) return pages;
  const atoms = pages.flatMap((p) => p.atoms);
  if (atoms.length === 0) return pages;

  /* ONLY WHEN THE TAIL IS ACTUALLY BAD. Rebalancing preserves the page count
     of THIS block but not of the document: moving rows off the first page
     pushes where the block ends, and the next block can then need a sheet it
     did not need before. Measured on a 15-page fixture, rebalancing everything
     cost a page. So it is reserved for the case it exists for — a final sheet
     that is mostly empty — and a block whose tail already reads as a page is
     left exactly as the packer produced it. */
  const tail = pages[pages.length - 1];
  if (tail.fill >= FILL_MIN) return pages;

  const kind = atoms[0].kind;
  const h = atoms[0].h;
  const uniform = atoms.every((a) => a.kind === kind && Math.abs(a.h - h) < 0.01
    && !a.keepWithNext);
  if (!uniform || h <= 0) return pages;

  const gap = opts.gap ?? 0;
  const capacity = (room: number) => Math.max(1, Math.floor((room + gap) / (h + gap)));
  const capFirst = capacity(opts.first);
  const capRest = capacity(opts.rest);

  const P = pages.length;
  const out: PackedPage[] = [];
  let i = 0;
  for (let page = 0; page < P; page += 1) {
    const room = page === 0 ? opts.first : opts.rest;
    const cap = page === 0 ? capFirst : capRest;
    const left = P - page;
    // An even share of what remains, never more than this page can hold.
    const take = Math.min(cap, Math.ceil((atoms.length - i) / left));
    const slice = atoms.slice(i, i + take);
    i += take;
    const used = slice.length * h + gap * Math.max(0, slice.length - 1);
    out.push({ atoms: slice, used, room, fill: room > 0 ? used / room : 0 });
  }
  // If anything was left over the rebalance was unsafe; keep the original.
  return i === atoms.length ? out : pages;
}

/* ----------------------------------------------------------- diagnostics */

/** Pages that came out emptier than a page ought to be, ignoring the last one,
 *  which is allowed to end. Read by the audit and by the reflow decision. */
export function underfilled(pages: PackedPage[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pages.length - 1; i += 1) {
    if (pages[i].fill < FILL_MIN) out.push(i);
  }
  return out;
}
