/**
 * THE DRAWING SURFACE — primitives only, and no decisions.
 *
 * Everything in this file takes coordinates it was given and puts ink there.
 * Nothing in it chooses a column count, a font size or a page break; that all
 * happens in `fit.ts` and `sections.ts` before a single primitive is called.
 * The split is what makes the measure-then-commit pipeline possible at all: a
 * component that decides while it draws cannot be measured before it draws.
 *
 * EVERY PRIMITIVE RECORDS THE RECTANGLE IT DREW. That is not bookkeeping — it
 * is how the audit gets real coordinates instead of the engine's opinion of
 * them. A check that reads the same numbers the layout produced would confirm
 * the layout's own arithmetic; a check that reads what was committed can catch
 * the layout being wrong. This is the second reading described in `audit.ts`,
 * and it only works if recording is automatic rather than remembered.
 */

import type { jsPDF } from 'jspdf';
import { pdfSafe, type ReportHue } from '../analyticsReport';
import { CARD_RATIO, FRAME, MARGIN, PAGE_H, PAGE_W, PT, TYPE } from './geometry';
import { hueColor, mix, type Palette, type RGB } from './palette';
import type { Box } from './audit';

type Doc = jsPDF;

export interface TextStyle {
  size: number;
  bold?: boolean;
  track?: number;
  color?: RGB;
  align?: 'left' | 'center' | 'right';
  /** Uppercase the string before drawing. The reference sets every label and
   *  every title in caps; doing it here means a caller cannot forget. */
  caps?: boolean;
}

/**
 * THE WIDTH TRACKING ADDS, and it is not what it looks like.
 *
 * MEASURED, off a rendered PDF rather than reasoned about, because both of the
 * plausible answers were wrong. jsPDF's `charSpace` is in the DOCUMENT'S UNIT
 * — millimetres here, not points — and PDF's `Tc` operator adds it after EVERY
 * glyph including the last, so the width added is `track x length`, not
 * `track x (length - 1) x mm-per-point`.
 *
 * The proof: "DUEL ANALYSIS" at 17 pt with `track: 1.1` drew 61.51 mm and my
 * model said 52.04, so the section bar wrote CONTINUED across the final S. The
 * shortfall was 9.47 mm; `1.1 x 13 - 1.1 x 12 x 0.3528` is 9.64 and
 * `1.1 x 12 - ...` is 8.54, which is how the trailing gap was identified.
 *
 * `getTextWidth` knows nothing about any of this — a fact that has already
 * cost this project a word running into the plate beside it.
 */
function trackWidth(text: string, track: number | undefined): number {
  return (track ?? 0) * text.length;
}

let GStateCtor: typeof import('jspdf').GState | null = null;
export function setGState(g: typeof import('jspdf').GState) {
  GStateCtor = g;
}

/**
 * The surface. One per document.
 */
export class Surface {
  readonly doc: Doc;

  readonly p: Palette;

  /** Card art, keyed by URL, already downscaled. Null means the art is
   *  missing and the tile falls back to a named placeholder. */
  readonly tiles: Map<string, string | null>;

  /** Boxes committed on the page currently being drawn. */
  boxes: Box[] = [];

  constructor(doc: Doc, p: Palette, tiles: Map<string, string | null>) {
    this.doc = doc;
    this.p = p;
    this.tiles = tiles;
  }

  /* ------------------------------------------------------------ recording */

  box(b: Box): void {
    this.boxes.push(b);
  }

  resetBoxes(): void {
    this.boxes = [];
  }

  /* ----------------------------------------------------------- primitives */

  private applyText(s: TextStyle): void {
    const { doc } = this;
    doc.setFont('helvetica', s.bold ? 'bold' : 'normal');
    doc.setFontSize(s.size);
    const c = s.color ?? this.p.text;
    doc.setTextColor(c[0], c[1], c[2]);
  }

  /** Width of a string as it will actually be drawn — sanitised, at the size
   *  and weight given, INCLUDING letterspacing.
   *
   *  `getTextWidth` does not know about `charSpace`, which has already cost
   *  this project a word running into the plate beside it: "RECONSTRUCTED"
   *  measured 11 mm and drew 15. Tracking is added back here so a measurement
   *  is a measurement. */
  width(text: string, s: TextStyle): number {
    const safe = pdfSafe(s.caps ? text.toUpperCase() : text);
    this.applyText(s);
    return this.doc.getTextWidth(safe) + trackWidth(safe, s.track);
  }

  text(text: string, x: number, y: number, s: TextStyle): void {
    if (!text) return;
    const body = s.caps ? text.toUpperCase() : text;
    this.applyText(s);
    const opts: Record<string, unknown> = {};
    if (s.align) opts.align = s.align;
    if (s.track) opts.charSpace = s.track;
    this.doc.text(pdfSafe(body), x, y, opts);
  }

  /** Wrap to `w`, honouring tracking, and return the lines. */
  wrap(text: string, w: number, s: TextStyle): string[] {
    this.applyText(s);
    const track = s.track ?? 0;
    /* Shrink the budget in PROPORTION, because `splitTextToSize` is unaware of
       `charSpace` and the overrun grows with the number of characters on the
       line rather than being a fixed amount. An average Helvetica glyph is
       about half its point size wide; tracking adds `track` to each one, so a
       line fits `avg / (avg + track)` of what jsPDF thinks it does. */
    const avg = s.size * PT * 0.5;
    const est = track > 0 ? Math.max(4, w * (avg / (avg + track))) : w;
    return this.doc.splitTextToSize(pdfSafe(text), est) as string[];
  }

  /** Truncate to fit, measuring what will actually be drawn. */
  clip(text: string, w: number, s: TextStyle): string {
    const safe = pdfSafe(s.caps ? text.toUpperCase() : text);
    if (this.width(safe, { ...s, caps: false }) <= w) return safe;
    let out = safe;
    while (out.length > 1 && this.width(`${out}...`, { ...s, caps: false }) > w) {
      out = out.slice(0, -1);
    }
    return `${out}...`;
  }

  alpha(value: number, draw: () => void): void {
    if (!GStateCtor) {
      draw();
      return;
    }
    this.doc.setGState(new GStateCtor({ opacity: value, 'stroke-opacity': value }));
    draw();
    this.doc.setGState(new GStateCtor({ opacity: 1, 'stroke-opacity': 1 }));
  }

  fill(c: RGB): void { this.doc.setFillColor(c[0], c[1], c[2]); }

  stroke(c: RGB): void { this.doc.setDrawColor(c[0], c[1], c[2]); }

  /* --------------------------------------------------------------- chrome */

  /**
   * THE FRAME. Every page is drawn inside one bracketed panel, and it is the
   * whole reason the document reads as a DOCUMENT rather than as blocks on a
   * background. Drawn by the page opener, so a section added later inherits it
   * without knowing it exists — chrome that has to be remembered is chrome
   * that eventually is not.
   */
  pageFrame(): void {
    const { doc, p } = this;
    this.fill(p.page);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

    // A hair off the page colour, so the edge is felt rather than seen. On a
    // light theme `sunken` is a hair darker and it inverts correctly with no
    // per-theme branch.
    this.fill(p.sunken);
    this.stroke(p.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(FRAME, FRAME, PAGE_W - FRAME * 2, PAGE_H - FRAME * 2, 3, 3, 'FD');

    // Corner brackets: four L-shaped rules, inside the panel edge. They are
    // the single most recognisable thing about this report's identity.
    const L = 14;
    const i = FRAME + 4;
    const r = PAGE_W - FRAME - 4;
    const b = PAGE_H - FRAME - 4;
    this.stroke(p.borderStrong);
    doc.setLineWidth(0.6);
    const bracket = (x: number, y: number, dx: number, dy: number) => {
      doc.line(x, y, x + dx * L, y);
      doc.line(x, y, x, y + dy * L);
    };
    this.alpha(0.85, () => {
      bracket(i, i, 1, 1);
      bracket(r, i, -1, 1);
      bracket(i, b, 1, -1);
      bracket(r, b, -1, -1);
    });

    // The ghost crown, bottom right. Barely there on purpose: a watermark that
    // can be read is a watermark competing with the data.
    this.alpha(p.dark ? 0.05 : 0.035, () => {
      this.fill(p.text);
      this.crown(PAGE_W - 58, PAGE_H - 44, 42);
    });
  }

  /**
   * THE CROWN, as ONE CLOSED PATH.
   *
   * Drawn as three overlapping triangles first, which is the obvious way and
   * produces a mountain range: filled triangles union, so the valleys between
   * the points never get cut out and the mark reads as hills. A crown needs
   * the dips, so the outline is walked as a single polygon — up to a point,
   * down to a valley, up to the next — and closed along the band.
   */
  crown(x: number, y: number, w: number): void {
    const h = w * 0.62;
    // Fractions of the box: peaks at 0.06 / 0.5 / 0.94, valleys at 0.27 / 0.73.
    const pts: [number, number][] = [
      [0, 1], [0.05, 0.30], [0.27, 0.62], [0.5, 0.06],
      [0.73, 0.62], [0.95, 0.30], [1, 1],
    ];
    const abs = pts.map(([fx, fy]) => [x + fx * w, y + fy * h] as [number, number]);
    const deltas = abs.slice(1).map(([ax, ay], i) => [ax - abs[i][0], ay - abs[i][1]]);
    this.doc.lines(deltas, abs[0][0], abs[0][1], [1, 1], 'F', true);
  }

  /**
   * THE SECTION BAR — the numbered title, the tab strip, and the rule under
   * them. Level 1 and level 2 of the hierarchy, drawn together because their
   * spacing relationship is the thing that makes the page look composed.
   */
  sectionBar(opts: {
    number?: number;
    title: string;
    tabs?: string[];
    activeTab?: string;
    context?: string;
    hue?: ReportHue;
    continued?: boolean;
  }): void {
    const { doc, p } = this;
    const top = 16;
    let x = MARGIN;

    if (opts.number !== undefined) {
      const n = `${String(opts.number).padStart(2, '0')} /`;
      this.text(n, x, top + 1, {
        size: TYPE.label.size, bold: true, track: TYPE.label.track, color: p.muted,
      });
      x += this.width(n, { size: TYPE.label.size, bold: true, track: TYPE.label.track }) + 5;
    }

    const title = opts.continued ? `${opts.title}` : opts.title;
    this.text(title, x, top + 4.5, {
      size: TYPE.title.size, bold: true, track: TYPE.title.track, color: p.text, caps: true,
    });
    const titleW = this.width(title, {
      size: TYPE.title.size, bold: true, track: TYPE.title.track, caps: true,
    });

    if (opts.continued) {
      this.text('CONTINUED', x + titleW + 4, top + 4.5, {
        size: TYPE.label.size, bold: true, track: TYPE.label.track, color: p.muted,
      });
    }

    // Tab pills, right-aligned. They say what this page is a view OF, which is
    // the piece of context a spill page otherwise loses.
    if (opts.tabs?.length) {
      let tx = PAGE_W - MARGIN;
      for (const tab of [...opts.tabs].reverse()) {
        const style = { size: TYPE.label.size, bold: true, track: TYPE.label.track };
        const tw = this.width(tab, { ...style, caps: true }) + 7;
        const active = tab === opts.activeTab;
        tx -= tw;
        this.fill(active ? p.nested : p.page);
        this.stroke(active ? p.borderStrong : p.border);
        doc.setLineWidth(0.25);
        doc.roundedRect(tx, top - 3.4, tw, 6.6, 3.3, 3.3, 'FD');
        this.text(tab, tx + tw / 2, top + 1.1, {
          ...style, color: active ? p.text : p.muted, align: 'center', caps: true,
        });
        tx -= 2.4;
      }
    }

    // The rule, and the context line sitting on it.
    const ruleY = top + 9.5;
    this.stroke(p.border);
    doc.setLineWidth(0.3);
    this.alpha(0.7, () => doc.line(MARGIN, ruleY, PAGE_W - MARGIN, ruleY));

    if (opts.context) {
      this.text(opts.context, MARGIN, ruleY + 4.6, {
        size: TYPE.context.size, bold: true, track: TYPE.context.track,
        color: p.muted, caps: true,
      });
    }

    // The hue's own mark: a short accent under the number, so the section's
    // identity colour is present without tinting anything that carries data.
    if (opts.hue && opts.hue !== 'neutral') {
      this.fill(hueColor(p, opts.hue, true));
      doc.rect(MARGIN, top + 6.2, 16, 0.8, 'F');
    }
  }

  footer(text: { left: string; centre: string; right: string }): void {
    const { p } = this;
    const y = PAGE_H - 10;
    const style = {
      size: TYPE.footer.size, bold: true, track: TYPE.footer.track, color: p.muted,
      caps: true as const,
    };
    this.text(text.left, MARGIN, y, style);
    this.text(text.centre, PAGE_W / 2, y, { ...style, align: 'center' });
    this.text(text.right, PAGE_W - MARGIN, y, { ...style, align: 'right' });
  }

  /* ------------------------------------------------------------- surfaces */

  /** A compact analytical module: the container everything else sits in. */
  module(x: number, y: number, w: number, h: number, opts: {
    accent?: RGB;
    ground?: RGB;
    kind?: string;
    /** A 1.6 mm cap of the accent along the top edge. */
    cap?: boolean;
  } = {}): void {
    const { doc, p } = this;
    this.fill(opts.ground ?? p.nested);
    this.stroke(opts.accent ?? p.border);
    doc.setLineWidth(opts.accent ? 0.45 : 0.25);
    doc.roundedRect(x, y, w, h, 2.2, 2.2, 'FD');
    if (opts.cap && opts.accent) {
      this.fill(opts.accent);
      doc.roundedRect(x, y, w, 1.4, 0.7, 0.7, 'F');
    }
    this.box({ x, y, w, h, kind: opts.kind ?? 'module' });
  }

  /** A small uppercase label — level 2 of the hierarchy. */
  label(text: string, x: number, y: number, opts: {
    color?: RGB; align?: 'left' | 'center' | 'right';
  } = {}): void {
    this.text(text, x, y, {
      size: TYPE.label.size, bold: true, track: TYPE.label.track,
      color: opts.color ?? this.p.muted, align: opts.align, caps: true,
    });
  }

  /**
   * A METER — the reference's micro bar, and the workhorse of the whole
   * document. Label left, value right, a track with a proportional fill under
   * them.
   *
   * The value's colour carries the meaning and the bar carries the magnitude,
   * which is why they are separate arguments: a 43% win rate over nine games
   * is drawn short AND red, but a 43% over four hundred is short and red for a
   * different reason, and only the caller knows which.
   */
  meter(x: number, y: number, w: number, opts: {
    label: string;
    value: string;
    fraction: number;
    color: RGB;
    /** Drained: true but too thin to rank on. */
    thin?: boolean;
  }): number {
    const { doc, p } = this;
    const H = 4.4;
    const labelStyle = { size: 4.9, bold: true, track: 0.35, color: p.muted, caps: true as const };
    this.text(opts.label, x, y, labelStyle);
    this.text(opts.value, x + w, y, {
      size: 5.4, bold: true, color: opts.thin ? p.muted : opts.color, align: 'right',
    });
    const trackY = y + 1.1;
    this.fill(mix(p.border, p.nested, 0.8));
    doc.roundedRect(x, trackY, w, 1.05, 0.5, 0.5, 'F');
    const f = Math.max(0, Math.min(1, opts.fraction));
    if (f > 0) {
      this.fill(opts.thin ? p.muted : opts.color);
      doc.roundedRect(x, trackY, Math.max(0.8, w * f), 1.05, 0.5, 0.5, 'F');
    }
    return H;
  }

  /**
   * A CARD TILE. Art at its true aspect ratio, never stretched, with a named
   * placeholder when the art is missing — a card that cannot be drawn must
   * still be identifiable, or a deck silently becomes seven cards.
   */
  cardTile(x: number, y: number, w: number, url: string, name: string): void {
    const { doc, p } = this;
    const h = w / CARD_RATIO;
    const data = this.tiles.get(url);
    if (data) {
      doc.addImage(data, 'JPEG', x, y, w, h, url, 'FAST');
    } else {
      this.fill(p.sunken);
      this.stroke(p.border);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, y, w, h, 0.8, 0.8, 'FD');
      this.text(this.clip(name, w - 1, { size: 4.2 }), x + w / 2, y + h / 2, {
        size: 4.2, color: p.muted, align: 'center',
      });
    }
    this.box({ x, y, w, h, kind: 'card', imageW: w, nested: true });
  }

  /**
   * A KPI. Level 3 over level 2: the figure large, its label small and
   * uppercase beneath, an optional note under that, and a rule down the left
   * edge in the accent.
   *
   * The rule rather than a box is the reference's own choice and it is the
   * right one — four boxed KPIs read as four cards competing with the data
   * below them, four ruled figures read as one strip of context.
   */
  kpi(x: number, y: number, w: number, opts: {
    label: string; value: string; note?: string; accent?: RGB; size?: number;
    /** Set when this KPI sits inside another component's box, so the audit
     *  does not read the legitimate containment as an overlap. */
    nested?: boolean;
  }): number {
    const { doc, p } = this;
    const size = opts.size ?? TYPE.metricSmall.size;
    const accent = opts.accent ?? p.border;
    const valueH = size * PT;
    this.fill(accent);
    doc.rect(x, y, 0.8, valueH + 4.6, 'F');
    const tx = x + 3.4;
    this.text(this.clip(opts.value, w - 4, { size, bold: true }), tx, y + valueH, {
      size, bold: true, color: opts.accent ?? p.text,
    });
    this.label(this.clip(opts.label, w - 4, { size: TYPE.label.size, bold: true, caps: true }),
      tx, y + valueH + 3.6);
    let h = valueH + 4.6;
    if (opts.note) {
      this.text(this.clip(opts.note, w - 4, { size: 5, bold: true, caps: true }),
        tx, y + valueH + 7.2, {
          size: 5, bold: true, track: 0.4, color: p.muted, caps: true,
        });
      h += 3;
    }
    this.box({ x, y, w, h, kind: 'kpi', fontSize: TYPE.label.size, nested: opts.nested });
    return h;
  }

  /**
   * THE READ — the insight bar, level 5, and the one line with the standing to
   * say what all of it meant.
   *
   * Visually separated by a full-width accent rule ABOVE it rather than a box
   * around it: a box makes it one more module on a page of modules, and the
   * point of this line is that it is not one of them. The accent is semantic —
   * green for a strength, red for a problem, the section's hue for a neutral
   * observation — so the colour carries the reading before the sentence does.
   */
  readBar(x: number, y: number, w: number, text: string, accent: RGB): number {
    const { doc, p } = this;
    this.fill(accent);
    doc.rect(x, y, w, 0.7, 'F');
    const boxY = y + 2.4;
    const H = 11.4;
    this.fill(mix(p.nested, p.sunken, 0.55));
    doc.roundedRect(x, boxY, w, H, 1.6, 1.6, 'F');
    this.label('THE READ', x + 5, boxY + 6.6, { color: accent });
    const lead = 26;
    this.text(this.clip(text, w - lead - 8, { size: TYPE.read.size }),
      x + lead, boxY + 7.4, { size: TYPE.read.size, color: p.text });
    this.box({ x, y, w, h: H + 2.4, kind: 'read', fontSize: TYPE.read.size });
    return H + 2.4;
  }

  /** A small status chip: "HIGH // 316 GAMES", "MEDIUM // 75 GAMES". */
  chip(x: number, y: number, text: string, accent: RGB): number {
    const { doc, p } = this;
    const style = { size: 5.2, bold: true, track: 0.45, caps: true as const };
    const w = this.width(text, style) + 9;
    const h = 5.4;
    this.fill(mix(accent, p.nested, 0.16));
    doc.roundedRect(x, y, w, h, 2.7, 2.7, 'F');
    this.fill(accent);
    doc.rect(x + 2.6, y + 1.2, 0.7, h - 2.4, 'F');
    this.text(text, x + 5.4, y + 3.7, { ...style, color: accent });
    return w;
  }
}
