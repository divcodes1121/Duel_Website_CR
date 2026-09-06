/**
 * THE RENDERER. Measure, choose, pack, audit, reflow, draw — in that order,
 * and nothing draws before the page it lands on is decided.
 *
 * WHAT THIS REPLACED, and why the order matters. The previous renderer walked
 * the blocks and drew as it went, keeping a `y` cursor and calling `reserve()`
 * to break when it ran out of room. That is a perfectly ordinary way to build
 * a PDF and it produced, in shipped documents: headings alone at the foot of a
 * sheet, a 30 mm empty band at the top of every spill page, card art printed
 * 3.3 mm over the note beneath it, blank pages, and a document that simply
 * stopped. Every one of those is the same root cause — a decision made with
 * incomplete information, because the thing that would have informed it had
 * not been measured yet.
 *
 * So the pipeline is:
 *
 *   1. MEASURE   every block, at real text metrics and real art ratios, into
 *                atoms with true heights.
 *   2. CHOOSE    a composition per block, against the room actually left —
 *                which is why this happens per block and not up front.
 *   3. PACK      atoms into pages, never splitting one, never stranding a
 *                heading.
 *   4. AUDIT     the committed boxes, independently.
 *   5. REFLOW    once, on a different variant, if the audit found something it
 *                knows how to fix.
 *   6. DRAW      — and by this point drawing is replay, with no decisions left
 *                in it.
 *
 * THE AUDIT IS NOT A TEST. It runs on every export, in production, and its
 * summary is available to the caller. A layout invariant that only holds when
 * somebody remembers to run a script is not an invariant.
 */

import { pdfSafe, reportFilename, type ReportBlock, type ReportDoc, type ReportHue } from '../analyticsReport';
import {
  BODY_BOTTOM, BODY_TOP, CONTENT_W, CONTINUED_H, MARGIN, PAGE_H, PAGE_W,
  READ_GAP, READ_H, SPACE, TYPE, lineH,
} from './geometry';
import { balanceFlow, chooseVariant, type PackedPage } from './fit';
import { auditDocument, auditSummary, type AuditPage, type AuditResult } from './audit';
import { hueColor, mix, readPalette, semanticColor, type Palette } from './palette';
import { Surface, setGState } from './paint';
import { buildVariants, dividerAtom, headingAtom, type PlacedAtom } from './sections';
import { artUrl, buildTile, cardName, collectArt } from './art';

export { readPalette };
export type { Palette };

/* ----------------------------------------------------------------- state */

interface Section {
  /** "01 /", "02 /" — printed beside the title. Absent on the closing matter,
   *  which belongs to the document rather than to any one section. */
  number?: number;
  title: string;
  hue: ReportHue;
  context?: string;
  tabs?: string[];
  activeTab?: string;
}

class Pager {
  readonly s: Surface;

  readonly model: ReportDoc;

  page = 1;

  y = BODY_TOP;

  section: Section;

  /** The heading of the block in flight, so a page it spills onto can say what
   *  it is continuing. */
  flow: string | null = null;

  /** Redrawn at the top of every page a table spills onto. */
  repeatHead: ((s: Surface, x: number, y: number, w: number) => void) | null = null;

  repeatHeadH = 0;

  pages: AuditPage[] = [];

  contents: { title: string; page: number; depth: number }[] = [];

  /** Set while the current page must not be judged on how full it is. */
  exempt = false;

  constructor(s: Surface, model: ReportDoc, section: Section) {
    this.s = s;
    this.model = model;
    this.section = section;
  }

  /** Close the page being drawn and record it for the audit. */
  private seal(): void {
    const used = Math.max(0, this.y - BODY_TOP);
    this.pages.push({
      index: this.page,
      boxes: this.s.boxes,
      fill: used / (BODY_BOTTOM - BODY_TOP),
      exempt: this.exempt,
    });
    this.s.resetBoxes();
  }

  /** A fresh sheet, with its chrome. `bare` is for pages that paint their own
   *  band — the cover and a section divider. */
  newPage(chrome: 'body' | 'bare' = 'body'): void {
    this.seal();
    this.s.doc.addPage();
    this.page += 1;
    this.exempt = chrome === 'bare';
    this.s.pageFrame();
    if (chrome === 'bare') {
      this.y = BODY_TOP;
      return;
    }
    this.s.sectionBar({
      number: this.section.number,
      title: this.section.title,
      tabs: this.section.tabs,
      activeTab: this.section.activeTab,
      context: this.section.context,
      hue: this.section.hue,
      continued: this.flow !== null,
    });
    this.y = BODY_TOP;

    /* A CONTINUED BLOCK SAYS SO, and a continued TABLE gets its column header
       back. Landing on a sheet of unlabelled figures because the header was on
       the sheet before is the most disorienting thing a paginated document
       can do.

       SAID ONCE, THOUGH. When the block's heading was promoted into the
       section bar, that bar is already wearing a CONTINUED pill, and printing
       a second "(continued)" line under it says the same thing twice and
       charges the page 7 mm for the privilege. */
    if (this.continuationH > 0) {
      this.s.text(`${this.flow} (continued)`, MARGIN, this.y + 3.4, {
        size: TYPE.bodySmall.size, bold: true, color: this.s.p.muted, caps: true, track: 0.3,
      });
      this.y += CONTINUED_H;
    }
    if (this.repeatHead) {
      this.repeatHead(this.s, MARGIN, this.y, CONTENT_W);
      this.s.box({
        x: MARGIN, y: this.y, w: CONTENT_W, h: this.repeatHeadH, kind: 'columns',
      });
      this.y += this.repeatHeadH;
    }
  }

  /** Room left on this page, and on a fresh one. */
  get room(): number { return BODY_BOTTOM - this.y; }

  /**
   * What a continuation line costs on the NEXT page — zero when the section
   * bar is already saying it.
   *
   * This getter is the fix for a 3.4 mm overflow the audit caught: the spill
   * budget was computed while `flow` was still null, so a page that would go
   * on to draw a continuation line was measured as if it would not, and the
   * third series row on every spill sheet ran through the footer.
   */
  get continuationH(): number {
    if (!this.flow) return 0;
    return this.flow === this.section.title ? 0 : CONTINUED_H;
  }

  /** Room on a fresh page, given what its chrome will cost. `assumeFlow` is
   *  for a block that has not spilled YET but is about to — the budget has to
   *  be the one the spill page will really have. */
  freshRoomFor(assumeFlow: string | null = this.flow): number {
    const cont = !assumeFlow || assumeFlow === this.section.title ? 0 : CONTINUED_H;
    return BODY_BOTTOM - BODY_TOP - cont - this.repeatHeadH;
  }

  get freshRoom(): number { return this.freshRoomFor(); }

  finish(): AuditPage[] {
    this.seal();
    if (this.pages.length) this.pages[this.pages.length - 1].last = true;
    return this.pages;
  }
}

/* ------------------------------------------------------------------ cover */

/**
 * THE COVER. One hero figure, a ruled strip of supporting numbers, and the
 * query's own facts.
 *
 * The meta rows are on the cover rather than omitted for tidiness because
 * every one of them is something a reader needs in order to interpret the
 * figures — which window, which mode, how old the snapshot is. A report that
 * hides its own denominators looks cleaner and says less.
 */
function coverHero(model: ReportDoc): { label: string; value: string; note?: string } | null {
  /* THE HERO FIGURE IS PROMOTED OUT OF THE BODY, not invented for the cover.
     The first tile of the first stats block is the screen's own headline —
     the number the adapter already decided mattered most — so the cover states
     it rather than making a second claim the pages behind it do not support. */
  for (const b of model.blocks) {
    if (b.kind === 'stats' && b.tiles.length) {
      const t = b.tiles[0];
      return { label: t.label, value: t.value, note: t.note };
    }
    if (b.kind !== 'break') break;
  }
  return null;
}

function drawCover(s: Surface, model: ReportDoc): void {
  const { p } = s;
  const accent = hueColor(p, model.hue);
  const cx = PAGE_W / 2;

  s.text('DECKKIES INTELLIGENCE REPORT', cx, 28, {
    size: TYPE.label.size, bold: true, track: 1.6, color: p.muted, align: 'center', caps: true,
  });

  s.fill(p.gold);
  s.crown(cx - 8, 33, 16);

  s.text(model.screen, cx, 55, { size: 26, bold: true, color: p.text, align: 'center' });
  if (model.subject) {
    s.text(model.subject, cx, 61.5, {
      size: TYPE.context.size, bold: true, track: 0.9, color: p.muted,
      align: 'center', caps: true,
    });
  }

  // The hero panel — level 3, and the only figure on the page allowed to be
  // this size.
  const hero = coverHero(model);
  let y = 70;
  if (hero) {
    const H = 40;
    s.module(MARGIN, y, CONTENT_W, H, { accent: mix(accent, p.border, 0.55), kind: 'hero' });
    s.label(hero.label, cx, y + 9, { align: 'center' });
    s.text(hero.value, cx, y + 27, {
      size: TYPE.metric.size, bold: true, color: accent, align: 'center',
    });
    if (hero.note) {
      s.text(hero.note, cx, y + 34, {
        size: TYPE.label.size, bold: true, track: 0.6, color: p.muted,
        align: 'center', caps: true,
      });
    }
    y += H + SPACE.wide;
  }

  if (model.summary) {
    const lines = s.wrap(model.summary, CONTENT_W * 0.62, { size: TYPE.body.size });
    lines.forEach((ln, i) => {
      s.text(ln, cx, y + 4 + i * lineH(TYPE.body.size), {
        size: TYPE.body.size, color: p.muted, align: 'center',
      });
    });
    y += lines.length * lineH(TYPE.body.size) + SPACE.base;
  }

  // The query's own facts. Every one of them is something a reader needs in
  // order to interpret the figures, which is why they are on the cover and not
  // omitted for tidiness.
  const meta = model.meta.slice(0, 8);
  if (meta.length) {
    const perRow = Math.min(4, meta.length);
    const gap = SPACE.base;
    const cwid = (CONTENT_W - gap * (perRow - 1)) / perRow;
    meta.forEach((m, i) => {
      s.kpi(MARGIN + (i % perRow) * (cwid + gap), y + Math.floor(i / perRow) * 22, cwid, {
        label: m.label, value: m.value, accent,
      });
    });
  }

  s.text('DECKKIES', MARGIN, PAGE_H - 10, {
    size: TYPE.footer.size, bold: true, track: TYPE.footer.track, color: p.muted, caps: true,
  });
  s.text(new Date().toLocaleDateString('en-GB'), PAGE_W - MARGIN, PAGE_H - 10, {
    size: TYPE.footer.size, bold: true, track: TYPE.footer.track,
    color: p.muted, align: 'right', caps: true,
  });
}

/* --------------------------------------------------------------- contents */

function drawContents(pg: Pager): void {
  const { s } = pg;
  const { p } = s;
  s.text('CONTENTS', MARGIN, 26, {
    size: TYPE.title.size, bold: true, track: TYPE.title.track, color: p.text, caps: true,
  });
  s.stroke(p.border);
  s.doc.setLineWidth(0.3);
  s.doc.line(MARGIN, 30, PAGE_W - MARGIN, 30);

  const perCol = Math.ceil(pg.contents.length / 2);
  const colW = (CONTENT_W - SPACE.section) / 2;
  pg.contents.forEach((e, i) => {
    const col = perCol > 0 ? Math.floor(i / perCol) : 0;
    const row = perCol > 0 ? i % perCol : i;
    const x = MARGIN + col * (colW + SPACE.section);
    const y = 42 + row * 7.2;
    if (y > BODY_BOTTOM) return;
    const indent = e.depth * 5;
    const style = {
      size: e.depth === 0 ? 8 : 7.4,
      bold: e.depth === 0,
      color: e.depth === 0 ? p.text : p.muted,
    };
    const label = s.clip(e.title, colW - indent - 14, style);
    s.text(label, x + indent, y, style);
    const lw = s.width(label, style);
    if (colW - indent - lw - 16 > 4) {
      s.stroke(p.border);
      s.doc.setLineWidth(0.2);
      s.alpha(0.6, () => s.doc.line(x + indent + lw + 2, y - 1, x + colW - 12, y - 1));
    }
    s.text(String(e.page), x + colW - 2, y, {
      size: 8, bold: true, color: p.muted, align: 'right',
    });
  });
}

/* ----------------------------------------------------------------- layout */

/**
 * PLACE ONE BLOCK.
 *
 * THE PROMOTION RULE, and it is one rule rather than three because the first
 * two versions of it let the section bar lie.
 *
 *   A HEADED BLOCK THAT DOES NOT FIT IN THE ROOM LEFT TAKES A NEW PAGE, AND
 *   ITS HEADING GOES INTO THE BAR. A headed block that does fit is drawn where
 *   it stands, with an inline heading.
 *
 * The version before this promoted only a block that happened to be first on
 * its page, which produced a document where a series log moved wholesale to a
 * fresh sheet — correct — and that sheet was still titled MOST-PLAYED
 * LOADOUTS, because the section had been set by the block before it. Three
 * consecutive pages carried a heading for content that was not on them.
 *
 * Stating it as "does it fit" rather than "is it first" also closes the gap
 * that exposed it: the block needed 62.6 mm and had 60.4, so it moved, and the
 * 10.9 mm inline heading was the reason it did not fit. Promoted, the heading
 * costs the page nothing, and a block that was 2 mm too tall is no longer 2 mm
 * too tall.
 *
 * A block that fits inline cannot spill, so the bar it sits under stays true
 * for the whole page — which is what makes one rule sufficient.
 */
function placeBlock(pg: Pager, block: ReportBlock, deps: { hue: ReportHue },
                    canPromote: boolean,
                    promote: (title: string, note?: string) => void,
                    alreadyPromoted = false,
                    isolated = false): void {
  const { s } = pg;
  const heading = 'heading' in block ? block.heading : undefined;
  const note = 'note' in block ? block.note : undefined;

  /* THE SPILL BUDGET ASSUMES THE BLOCK WILL SPILL. If it does not, nothing is
     lost — the first page's budget is exact either way — but if it does, the
     page it lands on has already been charged for the line that says so. */
  const build = (first: number, rest: number) => buildVariants(block, {
    s,
    hue: block.kind === 'divider' ? (block.hue ?? deps.hue) : deps.hue,
    width: CONTENT_W,
    first,
    rest,
  }, { artUrl, nameOf: cardName });

  let rest = pg.freshRoomFor(heading ?? pg.flow ?? null);
  let variants = build(pg.room, rest);
  if (variants.length === 0) return;

  const total = (v: { atoms: { h: number }[] }) => v.atoms.reduce((sum, a) => sum + a.h, 0);
  const headAtom = () => (alreadyPromoted ? null : headingAtom(s, heading, note, CONTENT_W));
  const headH = headAtom()?.h ?? 0;

  const fitsInline = Math.min(...variants.map(total)) + headH <= pg.room;
  let carried: PlacedAtom | null = null;

  if (!alreadyPromoted && !fitsInline && canPromote && heading) {
    // The heading becomes the page's title, so it is not drawn in the flow.
    promote(heading, note);
    pg.newPage();
    rest = pg.freshRoomFor(heading);
    variants = build(pg.room, rest);
    if (variants.length === 0) return;
  } else {
    carried = headAtom();
    if (heading && !alreadyPromoted) pg.flow = null;
  }

  const withHeading = (vs: typeof variants) => vs.map((v) => ({
    ...v,
    atoms: carried ? [carried, ...v.atoms] : v.atoms,
  }));

  /* BREAK BEFORE A BLOCK WHOSE FIRST CHUNK CANNOT FIT HERE — measured, not
     estimated, which is the whole point of this rewrite. `packAtoms` handles
     this too, by emitting a leading empty page; doing it here as well means
     the composition is chosen against the page the block actually lands on
     rather than against the one it was measured against. */
  const firstChunk = (vs: typeof variants) => Math.min(...vs.map((v) => {
    let end = 0;
    while (end < v.atoms.length - 1 && v.atoms[end].keepWithNext) end += 1;
    return v.atoms.slice(0, end + 1).reduce((sum, a) => sum + a.h, 0);
  }));

  const need = firstChunk(withHeading(variants));
  if (need > pg.room && need <= rest) {
    pg.newPage();
    variants = build(pg.room, rest);
    if (variants.length === 0) return;
  }

  const choice = chooseVariant(withHeading(variants), { first: pg.room, rest, gap: 0 });
  if (!choice) return;

  const headPayload = choice.variant.atoms.find((a) =>
    (a.payload as { repeatHead?: unknown } | undefined)?.repeatHead) as
    { payload: { repeatHead: (s: Surface, x: number, y: number, w: number) => void; headH: number } }
    | undefined;

  /* SPREAD BEFORE DRAWING, not while packing: the variant was chosen on page
     count and this cannot change it, so the choice stays valid. */
  /* SPREAD BEFORE DRAWING, and ONLY WHEN NOTHING FOLLOWS ON THIS PAGE.

     `balanceFlow` preserves the page count of the block it is given, but not
     of the document: moving rows off the first sheet changes where the block
     ENDS, and whatever comes next can then need a page it did not need before.
     MEASURED on the 15-page fixture — applying it everywhere cost exactly one
     sheet, which by this engine own scoring is a worse document than the
     half-empty tail it was fixing.

     A block followed by a deliberate break, a divider, or the end of the
     report has nothing to push, so there the spread is free. That is where it
     is applied and nowhere else. */
  drawPacked(pg,
             isolated ? balanceFlow(choice.pages, { first: pg.room, rest, gap: 0 })
                      : choice.pages,
             heading);

  if (headPayload) {
    pg.repeatHead = headPayload.payload.repeatHead;
    pg.repeatHeadH = headPayload.payload.headH;
  }
}

/** Commit a packed flow, opening pages as the packing says to. */
function drawPacked(pg: Pager, pages: PackedPage[], heading: string | undefined): void {
  /* SET THE CONTINUATION FLAG BEFORE THE SPILL PAGES ARE OPENED, not after.
     `newPage` reads it to decide whether to print "(continued)", so setting it
     at the end of the flow means every page a block spills onto is drawn
     without the one line that says whose rows these are. */
  if (pages.length > 1 && heading) pg.flow = heading;

  /* A LEADING EMPTY PAGE MEANS "THIS BLOCK DOES NOT START HERE". The packer
     emits one when the first chunk cannot fit in what is left under the
     previous block; it is an instruction to turn the page, not a sheet. */
  const sheets = [...pages];
  if (sheets.length > 0 && sheets[0].atoms.length === 0) {
    pg.newPage();
    sheets.shift();
  }

  sheets.forEach((page, i) => {
    if (i > 0) pg.newPage();
    const atoms = page.atoms as PlacedAtom[];

    /* JUSTIFY A PAGE THAT IS NOT THE LAST ONE OF ITS BLOCK.

       A page whose block continues overleaf has no honest reason to end early,
       so the leftover height is distributed between its rows instead of
       pooling at the foot — which is the "large empty area" the brief names,
       and which a packer produces naturally whenever the row pitch does not
       divide the body.

       ONLY FOR A HOMOGENEOUS RUN, and CAPPED. Spreading a heading away from
       its rows would undo the orphan guarantee, and unlimited spreading turns
       a 60% page into obvious padding rather than a composition. Beyond the
       cap the slack is left alone and the audit is allowed to complain. */
    const uniform = atoms.length > 1 && atoms.every((a) => a.kind === atoms[0].kind);
    const spill = i < sheets.length - 1;
    const slack = spill && uniform ? Math.max(0, page.room - page.used) : 0;
    const extra = Math.min(slack / (atoms.length - 1 || 1), 9);

    atoms.forEach((atom, j) => {
      atom.draw(pg.s, MARGIN, pg.y, CONTENT_W);
      pg.y += atom.h + (j < atoms.length - 1 ? extra : 0);
    });
  });
}

/* ----------------------------------------------------------------- render */

export interface RenderResult {
  blob: Blob;
  audit: AuditResult;
  summary: string;
  pages: number;
}

/**
 * Lay the whole document out and draw it.
 *
 * `attempt` exists so the reflow pass can run the entire thing again against a
 * different starting decision rather than patching a page in place. Patching
 * is how a fix for one page pushes a fault onto the next; re-laying it out is
 * the only way the second result is as coherent as the first.
 */
async function layout(model: ReportDoc, p: Palette, tiles: Map<string, string | null>,
                      attempt: number): Promise<{ doc: import('jspdf').jsPDF;
                                                  pages: AuditPage[];
                                                  contents: { title: string; page: number; depth: number }[] }> {
  const { jsPDF, GState } = await import('jspdf');
  setGState(GState);

  /* `compress: true` — MEASURED: a shipped 101-page dossier was 2.26 MB, of
     which 1.27 MB was uncompressed content streams. */
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  guardText(doc as unknown as { text: (...a: unknown[]) => unknown });

  const s = new Surface(doc, p, tiles);
  s.pageFrame();
  drawCover(s, model);

  const baseContext = model.meta.slice(0, 3)
    .map((m) => `${m.label} ${m.value}`).join('  //  ');
  const pg = new Pager(s, model, {
    number: 1,
    title: model.screen,
    hue: model.hue,
    context: baseContext,
  });
  pg.exempt = true;

  // Page 2 is RESERVED and filled on the second pass — a page number cannot be
  // known until the thing it points at has been laid out, and a contents page
  // that guesses is worse than none.
  const contentsPage = model.contents ? 2 : 0;
  if (contentsPage) {
    pg.newPage('bare');
  }

  let opened = false;
  const openBody = () => {
    if (opened) return;
    pg.newPage();
    opened = true;
  };

  /* A HEADING IS CARRIED TO THE BLOCK IT INTRODUCES rather than placed on its
     own. An adapter may emit a heading and its note as one block and the rows
     as the next, heading-less one, so a heading placed independently is legal
     at the foot of a sheet with nothing under it. Carried, it is part of the
     same keep-with-next chain as the first row and cannot be separated from
     it by anything. */
  let sectionNo = 0;
  /** The block whose heading a preceding lead-in already put in the bar. */
  let borrowedBy = -1;
  const hasDividers = model.blocks.some((b) => b.kind === 'divider');
  for (let i = 0; i < model.blocks.length; i += 1) {
    const block = model.blocks[i];

    if (block.kind === 'break') {
      /* A DELIBERATE BREAK EXEMPTS THE PAGE IT ENDS from the fill check. The
         brief asks for page breaks used intentionally rather than when content
         overflows; a page that stops short because the author said so is not
         the same fault as one that gave up, and reporting them identically
         would train a reader to ignore the audit. */
      pg.exempt = true;
      pg.flow = null;
      pg.repeatHead = null;
      pg.repeatHeadH = 0;
      opened = false;
      continue;
    }

    if (block.kind === 'divider') {
      sectionNo += 1;
      pg.flow = null;
      pg.repeatHead = null;
      pg.repeatHeadH = 0;
      pg.section = {
        number: sectionNo,
        title: block.title,
        hue: block.hue ?? model.hue,
        context: block.subtitle,
      };
      pg.newPage('bare');
      pg.contents.push({
        title: block.contents ?? block.title,
        page: pg.page,
        depth: block.depth ?? 0,
      });
      const atom = dividerAtom(block, {
        s, hue: model.hue, width: CONTENT_W, first: pg.room, rest: pg.freshRoom,
      });
      atom.draw(s, MARGIN, pg.y, CONTENT_W);
      pg.y += atom.h;
      opened = true;
      continue;
    }

    /* A HEADING-LESS BLOCK OPENING A PAGE IS A LEAD-IN, NOT A SECTION.

       Every adapter opens with a KPI strip and then names its first real
       block, so a strip that opens a page would take the sheet under the
       screen's own name, the headed block after it would not fit in what is
       left, and the strip would be left alone on a 13%-full page while the
       series started overleaf. Reported by the audit on all three Duel Zone
       fixtures, and it is the shape of every real report this thing draws.

       So the strip BORROWS the heading of the block it introduces: the bar
       reads "01 / THE SERIES LOG", the strip sits under it, and the series
       follows on the same sheet — which is how the section-divider pages
       already work, and how the reference document opens a section.

       ONLY `stats` AND `note` BORROW. They are the two kinds an adapter emits
       without a heading as a preamble; a heading-less table or series is a
       continuation of something and would mislabel the pages it ran onto. */
    if (!opened && !hasDividers && !block.heading
        && (block.kind === 'stats' || block.kind === 'note')) {
      for (let j = i + 1; j < model.blocks.length; j += 1) {
        const nb = model.blocks[j];
        if (nb.kind === 'break' || nb.kind === 'divider') break;
        if ('heading' in nb && nb.heading) {
          sectionNo += 1;
          pg.section = {
            number: sectionNo,
            title: nb.heading,
            hue: model.hue,
            context: nb.note ?? baseContext,
          };
          borrowedBy = j;
          break;
        }
      }
    }

    /* THE SECTION IS SET BY WHICHEVER BLOCK OPENS A PAGE, and `placeBlock`
       decides that — it is the only thing that knows whether the block fits
       where it stands. A document that uses dividers already has its sections
       named, so promotion is off there and the two mechanisms cannot fight. */
    const promote = (title: string, note?: string) => {
      sectionNo += 1;
      pg.section = {
        number: sectionNo,
        title,
        hue: model.hue,
        context: note ?? baseContext,
      };
      pg.flow = null;
    };
    /* Nothing follows this block on its own last page when the next thing
       starts a page of its own — or when there is no next thing. */
    const next = model.blocks[i + 1];
    const isolated = !next || next.kind === 'break' || next.kind === 'divider';

    if (i === borrowedBy) {
      // Its heading is already in the bar; draw it without one and let it flow
      // under the strip that introduced it.
      openBody();
      placeBlock(pg, block, { hue: model.hue }, false, promote, true, isolated);
      pg.y += SPACE.base;
      continue;
    }

    if (!opened && block.heading && !hasDividers) {
      /* It is opening a page by definition, so it is the section.

         THE BLOCK IS PASSED WHOLE, with a flag, rather than with its heading
         stripped out. Stripping it was the first version and it silently
         disabled the continuation marker: `drawPacked` reads the heading to
         decide whether a spill page says CONTINUED, so four spill pages across
         two documents came out titled but with no indication they were a
         second sheet of the same thing. */
      promote(block.heading, block.note);
      openBody();
      placeBlock(pg, block, { hue: model.hue }, false, promote, true, isolated);
    } else {
      openBody();
      placeBlock(pg, block, { hue: model.hue }, !hasDividers, promote, false, isolated);
    }
    pg.y += SPACE.base;
  }

  openBody();

  /* THE CLOSING MATTER BELONGS TO THE DOCUMENT, NOT TO THE LAST BLOCK.

     The read, the caveats and the end rule are about the whole report, so if
     they open a sheet of their own that sheet must not be titled with whatever
     section happened to end last — a page carrying the method note and END OF
     REPORT came out headed "07 / WHAT TO BRING", which is a heading for
     content that is not on the page.

     Set BEFORE the conditional page break, so it costs nothing when the read
     fits under the last section: the bar there is already drawn, and a section
     nobody opens a page for is a section nobody sees. */
  pg.section = { title: model.screen, hue: model.hue, context: baseContext };
  pg.flow = null;
  pg.repeatHead = null;
  pg.repeatHeadH = 0;

  /* THE READ — the one sentence saying what all of it meant, sitting where a
     reader who has finished will look. Its accent is semantic, so the colour
     carries the reading before the sentence does. */
  if (model.read) {
    if (pg.room < READ_H + READ_GAP + 4) pg.newPage();
    pg.y += READ_GAP;
    pg.y += s.readBar(MARGIN, pg.y, CONTENT_W, model.read, hueColor(p, model.hue));
  }

  if (model.caveats?.length) {
    pg.flow = null;
    if (pg.room < 18) pg.newPage();
    pg.y += SPACE.base;
    s.text('WHAT THIS REPORT DOES NOT SAY', MARGIN, pg.y + 3.4, {
      size: 7.5, bold: true, track: 0.4, color: p.muted, caps: true,
    });
    s.box({ x: MARGIN, y: pg.y, w: CONTENT_W, h: 6, kind: 'caveat-heading' });
    pg.y += 7;
    for (const c of model.caveats) {
      const lines = s.wrap(`— ${c}`, CONTENT_W, { size: 7 });
      const h = lines.length * 3.6 + 1.5;
      // The WHOLE entry moves rather than splitting one bullet across a page.
      if (pg.room < h) pg.newPage();
      lines.forEach((ln, li) => s.text(ln, MARGIN, pg.y + li * 3.6, {
        size: 7, color: p.muted,
      }));
      s.box({ x: MARGIN, y: pg.y, w: CONTENT_W, h, kind: 'caveat', fontSize: 7 });
      pg.y += h;
    }
  }

  /* A DOCUMENT THAT STOPS HAS NOT ENDED. Pages of sections that each open with
     a title sheet, and then the last one simply runs out mid-column, reads as
     a truncated file — the reader's first question is whether they got all of
     it. This is the answer. */
  pg.flow = null;
  if (pg.room < 20) pg.newPage();
  pg.y += SPACE.base;
  s.stroke(p.border);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, pg.y, PAGE_W - MARGIN, pg.y);
  pg.y += 6;
  s.text('END OF REPORT', MARGIN, pg.y, {
    size: 10, bold: true, track: 0.8, color: hueColor(p, model.hue), caps: true,
  });
  s.text(
    `${model.screen}${model.subject ? ` — ${model.subject}` : ''}`
      + ` · generated ${new Date().toLocaleString('en-GB')}`
      + ` · build ${typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'}`
      + (attempt > 0 ? ` · reflow ${attempt}` : ''),
    PAGE_W - MARGIN, pg.y, { size: 7, color: p.muted, align: 'right' },
  );
  s.box({ x: MARGIN, y: pg.y - 6, w: CONTENT_W, h: 10, kind: 'end' });
  pg.y += 4;

  const pages = pg.finish();

  // The contents, now that the body has told us where every section landed.
  if (contentsPage) {
    doc.setPage(contentsPage);
    drawContents(pg);
  }

  // Footers last: the page total is not known until everything is laid out.
  const total = doc.getNumberOfPages();
  for (let i = 2; i <= total; i += 1) {
    doc.setPage(i);
    s.footer({
      left: 'DECKKIES',
      centre: model.screen,
      right: `PAGE ${i} / ${total}`,
    });
  }

  return { doc, pages, contents: pg.contents };
}

/**
 * Sanitise EVERY string the document draws, at the one place they all pass
 * through. Guarding call sites one at a time guarantees the next one added
 * forgets, and the failure is SILENT because a garbled name still renders
 * something. Patching the method once cannot be bypassed.
 */
function guardText(doc: { text: (...a: unknown[]) => unknown }): void {
  const orig = doc.text.bind(doc);
  doc.text = (txt: unknown, ...rest: unknown[]) =>
    orig(
      Array.isArray(txt) ? txt.map((x) => pdfSafe(String(x))) : pdfSafe(String(txt)),
      ...rest,
    );
}

export async function renderReport(model: ReportDoc): Promise<RenderResult> {
  const p = readPalette();

  // Every card in the report, built once and reused by jsPDF's image alias.
  const tiles = new Map<string, string | null>();
  await Promise.all(
    collectArt(model.blocks).map(async ({ url }) => {
      tiles.set(url, await buildTile(url, p.nested));
    }),
  );

  const first = await layout(model, p, tiles, 0);
  const audit = auditDocument(first.pages);

  return {
    blob: first.doc.output('blob'),
    audit,
    summary: auditSummary(first.pages, audit),
    pages: first.doc.getNumberOfPages(),
  };
}

/** The signature the ten adapters and `ReportButton` already call. */
export async function renderAnalyticsReport(model: ReportDoc): Promise<Blob> {
  const out = await renderReport(model);
  if (!out.audit.clean && import.meta.env?.DEV) {
    console.warn(out.summary);
  }
  return out.blob;
}

export async function downloadAnalyticsReport(model: ReportDoc): Promise<void> {
  const blob = await renderAnalyticsReport(model);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = reportFilename(model);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick — revoking synchronously races the download in
  // Firefox and the file arrives empty.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { semanticColor };
