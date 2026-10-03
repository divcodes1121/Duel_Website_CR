/**
 * The arithmetic behind the scroll rail (`scroll-rail.tsx`).
 *
 * NO IMPORTS, on purpose — the same arrangement as `dashGeometry.ts` and
 * `utils/pageWindow.ts`. Everything that decides what the rail shows is here,
 * so it can be tested without a browser: how many ticks a rail gets, which of
 * them are lit, how far the wave lifts each one, where a press lands, and
 * which headings become section marks.
 *
 * The rail is a column of ticks standing for the WHOLE scrollable content. The
 * run of lit ticks is the part of it on screen, i.e. the thumb.
 */

export type RailVariant = 'full' | 'compact';

export interface RailSpec {
  /** Target distance between ticks, px. The real pitch is `height / ticks`. */
  pitch: number;
  /** A tick's length at rest, px. */
  rest: number;
  /** A tick's length inside the lit window, px. */
  lit: number;
  /** A tick's length at the crest of the wave, px. Also the rail's own width. */
  peak: number;
  /** How far the wave reaches from the pointer, in ticks. */
  radius: number;
  /** Width of the pressable strip when the rail sits inside its scroller, px. */
  strip: number;
  /** Distance from the strip at which the wave starts to rise, px. */
  prox: number;
  /** Kept clear at each end of the rail, px. */
  pad: number;
}

/* `full` is a page; `compact` is a dropdown list, a dialog body, a textarea.
   The compact rail carries no section marks and no label — a 200px list has no
   sections, and a label beside it would be wider than the list is tall. */
export const SPECS: Record<RailVariant, RailSpec> = {
  full: { pitch: 7, rest: 6, lit: 12, peak: 28, radius: 5, strip: 18, prox: 64, pad: 10 },
  compact: { pitch: 5, rest: 4, lit: 8, peak: 14, radius: 4, strip: 12, prox: 18, pad: 5 },
};

export const MIN_TICKS = 6;
export const MAX_TICKS = 180;
/** The lit window never shrinks below this many ticks, however long the page. */
export const MIN_THUMB_TICKS = 3;
/** A rail shorter than this is not drawn at all. */
export const MIN_RAIL = 48;
/** How strongly the wave rises for a pointer that is near but not on the rail. */
export const PROX_PEAK = 0.55;
/** A press this close to a section mark (in ticks) goes to that section. */
export const SNAP_TICKS = 1;
/** Section marks closer together than this (in ticks) are thinned. */
export const MARK_GAP = 3;
/** More marks than this is a list, not a set of sections. */
export const MAX_MARKS = 12;
/** A jump to a mark stops this far above it, so the heading has air. */
export const MARK_OFFSET = 12;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** One pixel of slack: sub-pixel layout leaves `scrollHeight` a hair over. */
export function canScroll(m: ScrollMetrics): boolean {
  return m.scrollHeight - m.clientHeight > 1;
}

/** A gutter this wide (px) beside a scroller is the shell's page padding. */
export const GUTTER_MIN = 10;
export const GUTTER_MAX = 32;

/**
 * A PAGE gets the full rail; a pane or a popover gets the compact one.
 *
 * A page is big AND ends at the window's right edge (flush, or a gutter away).
 * A big scroller in the middle of a layout — the deck column beside the card
 * library — is a pane: its rail sits over its own content, where an 8px native
 * bar used to be, so it has to stay that slim.
 */
export function variantFor(width: number, height: number, gutter: number): RailVariant {
  return height >= 320 && width >= 420 && gutter <= GUTTER_MAX ? 'full' : 'compact';
}

export function tickCount(railHeight: number, pitch: number): number {
  if (!(railHeight > 0) || !(pitch > 0)) return MIN_TICKS;
  return clamp(Math.round(railHeight / pitch), MIN_TICKS, MAX_TICKS);
}

/** How far down the content the scroller is, 0..1. Overscroll is clamped. */
export function progress(m: ScrollMetrics): number {
  const max = m.scrollHeight - m.clientHeight;
  return max <= 0 ? 0 : clamp(m.scrollTop / max, 0, 1);
}

/** The lit window's share of the rail, floored at `MIN_THUMB_TICKS`. */
export function thumbSize(m: ScrollMetrics, ticks: number): number {
  if (!canScroll(m)) return 1;
  const natural = m.clientHeight / m.scrollHeight;
  const floor = Math.min(1, MIN_THUMB_TICKS / Math.max(1, ticks));
  return clamp(Math.max(natural, floor), 0, 1);
}

/** Where the lit window begins on the rail, 0..1. */
export function thumbStart(m: ScrollMetrics, ticks: number): number {
  return progress(m) * (1 - thumbSize(m, ticks));
}

/** The inverse of `thumbStart`: the scrollTop that puts the window at `start`. */
export function scrollTopForStart(start: number, m: ScrollMetrics, ticks: number): number {
  const span = 1 - thumbSize(m, ticks);
  const p = span <= 0 ? 0 : clamp(start / span, 0, 1);
  return p * Math.max(0, m.scrollHeight - m.clientHeight);
}

/**
 * How much of tick `index`'s cell lies inside the window, 0..1.
 *
 * Continuous, not a yes/no: the ticks at the window's two edges fade in and
 * out as it moves, so the thumb glides instead of stepping one tick at a time.
 */
export function coverage(index: number, ticks: number, start: number, size: number): number {
  const a = index / ticks;
  const b = (index + 1) / ticks;
  const overlap = Math.min(b, start + size) - Math.max(a, start);
  return clamp(overlap * ticks, 0, 1);
}

/**
 * Raised-cosine bump: 1 at the crest, 0 at the radius, zero slope at both
 * ends, so the wave has no seam where it meets the resting ticks. Taken from
 * Ruixen UI's Chapter Scrubber, which this rail is a port of.
 */
export function bump(distance: number, radius: number): number {
  if (!(radius > 0) || distance >= radius) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * (distance / radius)));
}

/** Smoothstep, for the proximity ramp. */
export function ease(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Where along the rail a pointer is, 0..1. */
export function fractionAt(pointerY: number, railTop: number, railHeight: number): number {
  return railHeight <= 0 ? 0 : clamp((pointerY - railTop) / railHeight, 0, 1);
}

/** The pointer's position in tick units — the wave's crest. */
export function rowAt(pointerY: number, railTop: number, railHeight: number, ticks: number): number {
  if (railHeight <= 0 || ticks <= 0) return 0;
  return clamp((pointerY - railTop) / (railHeight / ticks) - 0.5, -0.5, ticks - 0.5);
}

/**
 * How strongly the wave should rise for a pointer at `x`, 0..1.
 *
 * On the strip it is 1. Approaching it, the wave lifts along a smoothstep to
 * `PROX_PEAK` — the rail acknowledges a pointer coming toward it, the way a
 * dock does, without the full crest firing for somebody merely reading near
 * the right edge.
 */
export function strengthAt(x: number, stripLeft: number, stripRight: number, prox: number): number {
  if (x > stripRight + 2) return 0;
  if (x >= stripLeft) return 1;
  const d = stripLeft - x;
  return d >= prox ? 0 : PROX_PEAK * ease(1 - d / prox);
}

export interface TickLook {
  /** Length in px. */
  length: number;
  /** 0..1 — how much of the lit colour shows. */
  lit: number;
  /** 0..1 — the tick's own opacity. */
  opacity: number;
  /** Extra thickness at the crest, as a scale factor. */
  thick: number;
}

/** Opacity of a tick that is neither lit, marked nor lifted. */
export const REST_OPACITY = 0.34;
/** Opacity of a section mark at rest. */
export const MARK_OPACITY = 0.9;

/** What one tick looks like, given the three things acting on it. */
export function tickLook(spec: RailSpec, lit: number, rise: number, mark: boolean): TickLook {
  const base = Math.max(spec.rest + lit * (spec.lit - spec.rest), mark ? spec.lit : 0);
  const length = base + rise * (spec.peak - base);
  const presence = Math.max(lit, rise, mark ? MARK_OPACITY : 0);
  return {
    length,
    lit,
    opacity: REST_OPACITY + (1 - REST_OPACITY) * clamp(presence, 0, 1),
    thick: 1 + rise * 0.4,
  };
}

/* ── placement ─────────────────────────────────────────────────────────── */

export interface Placement {
  /** True when the rail sits in the page gutter beside its scroller. */
  outset: boolean;
  /** Viewport x of the ticks' right-hand ends. */
  anchor: number;
  /** Viewport x of the pressable strip's left and right edges. */
  hitLeft: number;
  hitRight: number;
}

/**
 * Where a rail goes, given its scroller's right edge.
 *
 * A scroller that stops a gutter's width short of the window (the dashboard's
 * panel, with the shell's 1rem padding beside it) gets its rail IN that gutter:
 * nothing clickable lives there, so the strip covers no content at all. Any
 * other scroller gets the rail inside its own right edge, where a native
 * scrollbar would have been.
 */
export function placement(scrollerRight: number, viewportWidth: number, spec: RailSpec): Placement {
  const gutter = viewportWidth - scrollerRight;
  if (gutter >= GUTTER_MIN && gutter <= GUTTER_MAX) {
    return {
      outset: true,
      anchor: scrollerRight + gutter / 2 + spec.rest / 2,
      hitLeft: scrollerRight,
      hitRight: viewportWidth,
    };
  }
  return {
    outset: false,
    anchor: scrollerRight - 4,
    hitLeft: scrollerRight - spec.strip,
    hitRight: scrollerRight,
  };
}

/** Whether a scroller found under a sample point keeps a rail at rest. */
export function restsVisible(width: number, height: number): boolean {
  return height >= 140 && width >= 180;
}

/**
 * The points sampled to find which scrollers are "the page" right now: a 3x3
 * grid, as fractions of the viewport. A modal's scrim covers all nine, so the
 * page behind it stops being found and its rail steps back; a small popover
 * covers one or two and changes nothing.
 */
export const SAMPLE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.18, 0.2], [0.5, 0.2], [0.82, 0.2],
  [0.18, 0.5], [0.5, 0.5], [0.82, 0.5],
  [0.18, 0.8], [0.5, 0.8], [0.82, 0.8],
];

/* ── section marks ─────────────────────────────────────────────────────── */

export interface Mark {
  /** Distance from the top of the scrollable content, px. */
  top: number;
  label: string;
  /** 0 = named by `data-rail-mark`; 1..3 = heading level. Lower wins. */
  level: number;
}

/** Collapse whitespace and cap the length, so a label is always one short line. */
export function cleanLabel(raw: string | null | undefined, max = 30): string {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function markTick(top: number, m: ScrollMetrics, ticks: number): number {
  if (m.scrollHeight <= 0 || ticks <= 0) return 0;
  return clamp(Math.floor((top / m.scrollHeight) * ticks), 0, ticks - 1);
}

/**
 * Which candidate headings become section marks.
 *
 * Three rules, in this order:
 * 1. Too many is a LIST, not a set of sections. While there are more than
 *    `MAX_MARKS`, the deepest heading level is dropped whole. If one level is
 *    left and it is still too many — fifty deck names down a board — there are
 *    no marks at all, because a comb of fifty equal ticks says nothing.
 * 2. Marks closer than `MARK_GAP` ticks are thinned, keeping the more senior.
 * 3. A mark with no label is not a mark.
 */
export function pickMarks(raw: Mark[], m: ScrollMetrics, ticks: number): Mark[] {
  let marks = raw.filter((x) => x.label.length > 0 && x.top >= 0).sort((a, b) => a.top - b.top);
  while (marks.length > MAX_MARKS) {
    const deepest = marks.reduce((d, x) => Math.max(d, x.level), 0);
    const kept = marks.filter((x) => x.level < deepest);
    if (kept.length === 0) return [];
    marks = kept;
  }
  const out: Mark[] = [];
  for (const mark of marks) {
    const prev = out[out.length - 1];
    if (prev && markTick(mark.top, m, ticks) - markTick(prev.top, m, ticks) < MARK_GAP) {
      if (mark.level < prev.level) out[out.length - 1] = mark;
      continue;
    }
    out.push(mark);
  }
  return out;
}

/** The section a content position falls in: the last mark at or above it. */
export function sectionAt(marks: Mark[], contentY: number): Mark | null {
  let found: Mark | null = null;
  for (const mark of marks) {
    if (mark.top <= contentY + 1) found = mark;
    else break;
  }
  return found;
}

/** The mark a press at `fraction` should snap to, if it is close enough. */
export function snapMark(marks: Mark[], m: ScrollMetrics, ticks: number, fraction: number): Mark | null {
  const at = clamp(Math.floor(fraction * ticks), 0, Math.max(0, ticks - 1));
  let best: Mark | null = null;
  let bestGap = SNAP_TICKS + 1;
  for (const mark of marks) {
    const gap = Math.abs(markTick(mark.top, m, ticks) - at);
    if (gap < bestGap) {
      best = mark;
      bestGap = gap;
    }
  }
  return best;
}

/* ── wheel and springs ─────────────────────────────────────────────────── */

/** A wheel event's vertical travel in pixels, whatever unit it arrived in. */
export function wheelPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return deltaY * 40;
  if (deltaMode === 2) return deltaY * pageHeight * 0.9;
  return deltaY;
}

export interface Spring {
  value: number;
  velocity: number;
}

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

/* The source's two springs, unchanged. The pointer one is tight and nearly
   critically damped so the crest feels attached to the cursor; the strength
   one is softer so the wave swells and relaxes. */
export const POINTER_SPRING: SpringConfig = { stiffness: 700, damping: 52, mass: 0.5 };
export const STRENGTH_SPRING: SpringConfig = { stiffness: 260, damping: 30, mass: 0.6 };

/**
 * Advance a spring by `dt` seconds toward `target`. Returns true once settled,
 * at which point it is snapped onto the target so a loop can stop.
 *
 * Sub-stepped at 1/240 s: the pointer spring's damping ratio makes a single
 * 1/60 s semi-implicit step marginal, and a frame that arrives late (a 50 ms
 * `dt`) would otherwise throw the value past its target.
 */
export function stepSpring(s: Spring, target: number, cfg: SpringConfig, dt: number): boolean {
  let left = clamp(dt, 0, 0.1);
  const h = 1 / 240;
  while (left > 1e-6) {
    const step = Math.min(h, left);
    const force = -cfg.stiffness * (s.value - target) - cfg.damping * s.velocity;
    s.velocity += (force / cfg.mass) * step;
    s.value += s.velocity * step;
    left -= step;
  }
  if (Math.abs(s.value - target) < 0.002 && Math.abs(s.velocity) < 0.02) {
    s.value = target;
    s.velocity = 0;
    return true;
  }
  return false;
}
