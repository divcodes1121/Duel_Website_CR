import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  GUTTER_MAX,
  GUTTER_MIN,
  MARK_GAP,
  MAX_MARKS,
  MAX_TICKS,
  MIN_THUMB_TICKS,
  MIN_TICKS,
  POINTER_SPRING,
  PROX_PEAK,
  REST_OPACITY,
  SAMPLE_POINTS,
  SPECS,
  STRENGTH_SPRING,
  bump,
  canScroll,
  cleanLabel,
  coverage,
  fractionAt,
  markTick,
  pickMarks,
  placement,
  progress,
  restsVisible,
  rowAt,
  scrollTopForStart,
  sectionAt,
  snapMark,
  stepSpring,
  strengthAt,
  thumbSize,
  thumbStart,
  tickCount,
  tickLook,
  variantFor,
  wheelPixels,
  type Mark,
  type ScrollMetrics,
} from '../src/components/ui/scrollRailGeometry';

const read = (p: string) => readFileSync(p, 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/* The landing page as measured in a browser at 1440x900. */
const page = (scrollTop = 0): ScrollMetrics => ({ scrollTop, scrollHeight: 3451, clientHeight: 804 });
const TICKS = 112;

describe('how many ticks a rail gets', () => {
  it('is the rail height over the pitch', () => {
    expect(tickCount(784, SPECS.full.pitch)).toBe(TICKS);
  });

  it('is clamped at both ends, and survives nonsense', () => {
    expect(tickCount(10, 7)).toBe(MIN_TICKS);
    expect(tickCount(100000, 7)).toBe(MAX_TICKS);
    expect(tickCount(0, 7)).toBe(MIN_TICKS);
    expect(tickCount(NaN, 7)).toBe(MIN_TICKS);
    expect(tickCount(500, 0)).toBe(MIN_TICKS);
  });
});

describe('the lit run is the part of the page on screen', () => {
  it('needs more than a pixel of overflow to count as scrolling', () => {
    expect(canScroll({ scrollTop: 0, scrollHeight: 801, clientHeight: 800 })).toBe(false);
    expect(canScroll({ scrollTop: 0, scrollHeight: 802, clientHeight: 800 })).toBe(true);
  });

  it('is the visible share of the content, starting at the top', () => {
    expect(thumbSize(page(), TICKS)).toBeCloseTo(804 / 3451, 6);
    expect(thumbStart(page(), TICKS)).toBe(0);
  });

  it('ends exactly at the bottom of the rail when the page is at its end', () => {
    const end = page(3451 - 804);
    expect(thumbStart(end, TICKS) + thumbSize(end, TICKS)).toBeCloseTo(1, 9);
  });

  it('never shrinks below a few ticks, however long the page', () => {
    const long: ScrollMetrics = { scrollTop: 0, scrollHeight: 400000, clientHeight: 800 };
    expect(thumbSize(long, 100)).toBeCloseTo(MIN_THUMB_TICKS / 100, 9);
  });

  it('clamps overscroll instead of drawing past the ends', () => {
    expect(progress(page(-120))).toBe(0);
    expect(progress(page(99999))).toBe(1);
  });

  it('fills the rail when there is nothing to scroll', () => {
    expect(thumbSize({ scrollTop: 0, scrollHeight: 500, clientHeight: 500 }, 50)).toBe(1);
  });

  it('a drag is the exact inverse of the drawing', () => {
    for (const m of [page(0), page(600), page(1900), page(2647), { scrollTop: 90000, scrollHeight: 400000, clientHeight: 800 }]) {
      const back = scrollTopForStart(thumbStart(m, TICKS), m, TICKS);
      expect(back).toBeCloseTo(m.scrollTop, 4);
    }
  });

  it('a drag past either end stops at that end', () => {
    expect(scrollTopForStart(-0.4, page(), TICKS)).toBe(0);
    expect(scrollTopForStart(2, page(), TICKS)).toBeCloseTo(3451 - 804, 6);
  });
});

describe('each tick is lit by how much of it the window covers', () => {
  it('adds up to the size of the window', () => {
    const m = page(613);
    const size = thumbSize(m, TICKS);
    const start = thumbStart(m, TICKS);
    let total = 0;
    for (let i = 0; i < TICKS; i++) total += coverage(i, TICKS, start, size);
    expect(total).toBeCloseTo(size * TICKS, 6);
  });

  it('is partial at the two edges, so the run glides instead of stepping', () => {
    const size = 0.2;
    const first = 20;
    const start = (first + 0.4) / TICKS; // the window begins 40% of the way into tick 20
    expect(coverage(first, TICKS, start, size)).toBeCloseTo(0.6, 6);
    expect(coverage(first + 1, TICKS, start, size)).toBeCloseTo(1, 9);
    expect(coverage(first - 1, TICKS, start, size)).toBe(0);
  });
});

describe('the wave', () => {
  it('is 1 at the pointer, 0 at its radius, and has no seam', () => {
    expect(bump(0, 5)).toBe(1);
    expect(bump(2.5, 5)).toBeCloseTo(0.5, 9);
    expect(bump(5, 5)).toBe(0);
    expect(bump(9, 5)).toBe(0);
    // zero slope at both ends: the first step away from either end is tiny
    expect(1 - bump(0.05, 5)).toBeLessThan(0.001);
    expect(bump(4.95, 5)).toBeLessThan(0.001);
  });

  it('survives a zero radius', () => {
    expect(bump(0, 0)).toBe(0);
  });

  it('is full on the strip and rises toward it, never past the proximity peak', () => {
    const [left, right, prox] = [1424, 1440, SPECS.full.prox];
    expect(strengthAt(1430, left, right, prox)).toBe(1);
    expect(strengthAt(left - prox, left, right, prox)).toBe(0);
    expect(strengthAt(left - prox - 50, left, right, prox)).toBe(0);
    const far = strengthAt(left - 50, left, right, prox);
    const close = strengthAt(left - 5, left, right, prox);
    expect(far).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(far);
    expect(close).toBeLessThanOrEqual(PROX_PEAK);
  });

  it('does not fire for a pointer beyond the rail', () => {
    expect(strengthAt(1460, 1424, 1440, 64)).toBe(0);
  });

  it('puts the crest where the pointer is', () => {
    expect(rowAt(100, 100, 700, 100)).toBe(-0.5);
    expect(rowAt(100 + 3.5, 100, 700, 100)).toBeCloseTo(0, 9);
    expect(rowAt(9999, 100, 700, 100)).toBe(99.5);
    expect(fractionAt(450, 100, 700)).toBeCloseTo(0.5, 9);
    expect(fractionAt(-5, 100, 700)).toBe(0);
  });
});

describe('what a tick looks like', () => {
  const spec = SPECS.full;

  it('rests short and faint', () => {
    const look = tickLook(spec, 0, 0, false);
    expect(look.length).toBe(spec.rest);
    expect(look.opacity).toBeCloseTo(REST_OPACITY, 9);
    expect(look.thick).toBe(1);
  });

  it('is longer and solid inside the window', () => {
    const look = tickLook(spec, 1, 0, false);
    expect(look.length).toBe(spec.lit);
    expect(look.opacity).toBe(1);
  });

  it('a section mark is as long as a lit tick, without being lit', () => {
    const look = tickLook(spec, 0, 0, true);
    expect(look.length).toBe(spec.lit);
    expect(look.lit).toBe(0);
    expect(look.opacity).toBeGreaterThan(0.9);
  });

  it('reaches exactly the peak at the crest and never passes it', () => {
    for (const lit of [0, 0.4, 1]) {
      for (const mark of [false, true]) {
        expect(tickLook(spec, lit, 1, mark).length).toBe(spec.peak);
        expect(tickLook(spec, lit, 0.5, mark).length).toBeLessThan(spec.peak);
      }
    }
  });
});

describe('which rail, and where', () => {
  it('a page gets the full rail: big, and ending at the window edge', () => {
    expect(variantFor(1408, 804, 16)).toBe('full');
    expect(variantFor(1440, 900, 0)).toBe('full');
  });

  it('a pane in the middle of a layout gets the slim one, however big', () => {
    expect(variantFor(792, 659, 361)).toBe('compact');
  });

  it('anything small gets the slim one', () => {
    expect(variantFor(236, 544, 1188)).toBe('compact');
    expect(variantFor(640, 300, 0)).toBe('compact');
    expect(variantFor(358, 700, 16)).toBe('compact'); // a phone
  });

  it('beside a gutter, the rail lives IN the gutter and its strip covers no content', () => {
    const p = placement(1424, 1440, SPECS.full);
    expect(p.outset).toBe(true);
    expect(p.hitLeft).toBe(1424);
    expect(p.hitRight).toBe(1440);
    // resting ticks fit between the page and the window edge
    expect(p.anchor - SPECS.full.rest).toBeGreaterThanOrEqual(1424);
    expect(p.anchor).toBeLessThanOrEqual(1440);
  });

  it('resting ticks fit any gutter the rule accepts', () => {
    for (let gutter = GUTTER_MIN; gutter <= GUTTER_MAX; gutter++) {
      for (const spec of [SPECS.full, SPECS.compact]) {
        const p = placement(1000, 1000 + gutter, spec);
        expect(p.outset).toBe(true);
        expect(p.anchor - spec.rest).toBeGreaterThanOrEqual(1000);
        expect(p.anchor).toBeLessThanOrEqual(1000 + gutter);
      }
    }
  });

  it('otherwise it sits inside the scroller, in a lane as wide as its strip', () => {
    for (const right of [1440, 1079]) {
      const p = placement(right, 1440, SPECS.compact);
      expect(p.outset).toBe(false);
      expect(p.hitRight).toBe(right);
      expect(p.hitRight - p.hitLeft).toBe(SPECS.compact.strip);
      expect(p.anchor).toBeLessThan(right);
    }
  });

  it('only page-sized scrollers keep a rail at rest', () => {
    expect(restsVisible(1408, 804)).toBe(true);
    expect(restsVisible(236, 544)).toBe(true);
    expect(restsVisible(246, 85)).toBe(false);
    expect(restsVisible(120, 600)).toBe(false);
  });

  it('samples nine points, all inside the window', () => {
    expect(SAMPLE_POINTS).toHaveLength(9);
    for (const [x, y] of SAMPLE_POINTS) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1);
    }
  });
});

describe('section marks', () => {
  const mark = (top: number, label: string, level = 2): Mark => ({ top, label, level });

  it('labels are one short line', () => {
    expect(cleanLabel('  Top   10\n Decks ')).toBe('Top 10 Decks');
    expect(cleanLabel(null)).toBe('');
    const long = cleanLabel('The archetype armory and everything else in it', 20);
    expect(long.length).toBeLessThanOrEqual(20);
    expect(long.endsWith('…')).toBe(true);
  });

  it('are sorted, and one without a label is not a mark', () => {
    const out = pickMarks([mark(900, 'B'), mark(100, 'A'), mark(500, '')], page(), TICKS);
    expect(out.map((m) => m.label)).toEqual(['A', 'B']);
  });

  it('too many is a list: the deepest heading level goes first', () => {
    const raw = [
      ...Array.from({ length: 4 }, (_, i) => mark(i * 800, `H2 ${i}`, 2)),
      ...Array.from({ length: 30 }, (_, i) => mark(40 + i * 100, `H3 ${i}`, 3)),
    ];
    const out = pickMarks(raw, page(), TICKS);
    expect(out.length).toBeLessThanOrEqual(MAX_MARKS);
    expect(out.every((m) => m.level === 2)).toBe(true);
  });

  it('fifty headings of one level are no marks at all', () => {
    const raw = Array.from({ length: 50 }, (_, i) => mark(i * 60, `Deck ${i}`, 3));
    expect(pickMarks(raw, page(), TICKS)).toEqual([]);
  });

  it('marks too close together are thinned, keeping the senior one', () => {
    const perTick = 3451 / TICKS;
    const out = pickMarks([mark(1000, 'h3', 3), mark(1000 + perTick, 'named', 0)], page(), TICKS);
    expect(out.map((m) => m.label)).toEqual(['named']);
    const far = pickMarks([mark(1000, 'a'), mark(1000 + perTick * (MARK_GAP + 1), 'b')], page(), TICKS);
    expect(far).toHaveLength(2);
  });

  it('a content position belongs to the last mark above it', () => {
    const marks = [mark(0, 'Search'), mark(700, 'Analytics'), mark(1300, 'Tools')];
    expect(sectionAt(marks, 10)?.label).toBe('Search');
    expect(sectionAt(marks, 700)?.label).toBe('Analytics');
    expect(sectionAt(marks, 1290)?.label).toBe('Analytics');
    // one pixel of slack, so a section scrolled exactly to the top counts as entered
    expect(sectionAt(marks, 1299)?.label).toBe('Tools');
    expect(sectionAt(marks, 5000)?.label).toBe('Tools');
    expect(sectionAt([], 100)).toBeNull();
    expect(sectionAt([mark(400, 'Later')], 100)).toBeNull();
  });

  it('a press snaps to a mark one tick away, and not to one further off', () => {
    const marks = [mark(1300, 'Tools')];
    const at = markTick(1300, page(), TICKS);
    expect(snapMark(marks, page(), TICKS, (at + 0.5) / TICKS)?.label).toBe('Tools');
    expect(snapMark(marks, page(), TICKS, (at + 1.5) / TICKS)?.label).toBe('Tools');
    expect(snapMark(marks, page(), TICKS, (at + 3.5) / TICKS)).toBeNull();
  });

  it('a mark never lands outside the rail', () => {
    expect(markTick(-50, page(), TICKS)).toBe(0);
    expect(markTick(99999, page(), TICKS)).toBe(TICKS - 1);
  });
});

describe('the wheel and the springs', () => {
  it('reads a wheel in pixels whatever unit it came in', () => {
    expect(wheelPixels(100, 0, 800)).toBe(100);
    expect(wheelPixels(3, 1, 800)).toBe(120);
    expect(wheelPixels(1, 2, 800)).toBeCloseTo(720, 9);
  });

  it('both springs arrive, settle, and say so', () => {
    for (const cfg of [POINTER_SPRING, STRENGTH_SPRING]) {
      const s = { value: 0, velocity: 0 };
      let done = false;
      let frames = 0;
      while (!done && frames < 600) {
        done = stepSpring(s, 1, cfg, 1 / 60);
        frames++;
      }
      expect(done).toBe(true);
      expect(s.value).toBe(1);
      expect(s.velocity).toBe(0);
      expect(frames).toBeLessThan(120); // under two seconds
    }
  });

  it('the pointer spring does not overshoot the cursor', () => {
    const s = { value: 0, velocity: 0 };
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      stepSpring(s, 40, POINTER_SPRING, 1 / 60);
      peak = Math.max(peak, s.value);
    }
    expect(peak).toBeLessThan(40 * 1.03);
  });

  it('a late frame does not throw the value away', () => {
    const s = { value: 0, velocity: 0 };
    for (let i = 0; i < 40; i++) stepSpring(s, 1, POINTER_SPRING, 0.25);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(s.value).toBeCloseTo(1, 2);
  });
});

describe('the rail in the codebase', () => {
  /* Comments stripped: the stylesheet's header NAMES the tokens it does not
     use, and a check for their absence must read the rules, not the prose. */
  const css = read('src/components/ui/scroll-rail.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const tsx = read('src/components/ui/scroll-rail.tsx');
  const index = read('src/index.css');

  it('the geometry has no imports, so it can be tested without a browser', () => {
    expect(read('src/components/ui/scrollRailGeometry.ts')).not.toMatch(/^\s*import\s/m);
  });

  it('is mounted once, beside every route', () => {
    expect(read('src/App.tsx')).toMatch(/<ScrollRailHost \/>/);
    const mounts = walk('src')
      .filter((p) => p.endsWith('.tsx'))
      .filter((p) => /<ScrollRailHost\b/.test(read(p)));
    expect(mounts).toHaveLength(1);
  });

  it('runs no animation library and never loops', () => {
    expect(tsx).not.toMatch(/from ['"](framer-motion|motion\/react|gsap)['"]/);
    expect(css).not.toMatch(/infinite/);
    expect(css).not.toMatch(/@keyframes/);
  });

  it('takes its colour from the tokens: theme ink, and the selection violet as a mark', () => {
    expect(css).toMatch(/var\(--srail-ink, var\(--text\)\)/);
    expect(css).toMatch(/var\(--srail-lit, var\(--hue-violet\)\)/);
    expect(css).not.toMatch(/--solid-/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('glows only through the dark-only strength token', () => {
    expect(css).toMatch(/color-mix\(in srgb, var\(--hue-violet\) var\(--glow-core\), transparent\)/);
  });

  it('the lower layer sits under dialogs, and the code agrees with the stylesheet', () => {
    const z = Number(/\.srail-layer \{[^}]*z-index: (\d+)/.exec(css)![1]);
    const underZ = Number(/const UNDER_Z = (\d+)/.exec(tsx)![1]);
    expect(z).toBe(underZ);
    expect(z).toBeLessThan(200);
    const over = Number(/\.srail-layer\[data-over\] \{[^}]*z-index: (\d+)/.exec(css)![1]);
    expect(over).toBeGreaterThan(1300);
  });

  it('is an indicator on touch, and absent from print', () => {
    expect(css).toMatch(/@media \(pointer: coarse\)[\s\S]*?\.srail-hit \{\s*pointer-events: none/);
    expect(css).toMatch(/@media print[\s\S]*?\.srail-layer \{\s*display: none/);
  });

  it('is not in the accessibility tree', () => {
    expect(tsx).toMatch(/setAttribute\('aria-hidden', 'true'\)/);
    expect(tsx).not.toMatch(/tabIndex|tabindex/);
  });

  it('the native vertical bar is off everywhere; the sideways one is kept', () => {
    expect(index).toMatch(/::-webkit-scrollbar \{\s*width: 0;\s*height: 8px;/);
    expect(index).toMatch(/@supports not selector\(::-webkit-scrollbar\) \{\s*\* \{\s*scrollbar-width: none;/);
    expect(index).toMatch(/@media \(pointer: coarse\) \{\s*\* \{\s*scrollbar-width: none;/);
  });

  it('nothing brings a native bar back beside the rail', () => {
    /* `scrollbar-width: thin` outranks ::-webkit-scrollbar in Chromium, so one
       stray declaration draws the browser's bar next to the rail. The only
       place it may appear is the Firefox-only block that restores a SIDEWAYS
       bar, which the rail does not cover. */
    const guarded = /@supports not selector\(::-webkit-scrollbar\) \{[\s\S]*?\n\}/g;
    const offenders = walk('src')
      .filter((p) => p.endsWith('.css'))
      .filter((p) => /scrollbar-width:\s*thin|scrollbar-color:/.test(read(p).replace(guarded, '')));
    expect(offenders).toEqual([]);
  });

  it('the landing page names its sections for the rail', () => {
    const dash = read('src/components/Dashboard/Dashboard.tsx');
    expect(dash).toMatch(/data-rail-mark="Search a player"/);
    expect(dash).toMatch(/data-rail-mark="Analytics"/);
    expect(dash).toMatch(/data-rail-mark=\{f\.kicker\}/);
    expect(read('src/components/Dashboard/ClosingBand.tsx')).toMatch(/data-rail-mark="Coming soon"/);
  });

  it('the field book dresses its own rail, because it is paper in both themes', () => {
    const book = read('src/components/Sketchbook/Sketchbook.module.css');
    expect(book).toMatch(/--rail-ink: var\(--ink\)/);
    expect(book).toMatch(/--rail-lit: var\(--earth\)/);
    expect(book).toMatch(/--rail-glow: transparent/);
  });
});
