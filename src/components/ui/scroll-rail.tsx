import { useEffect } from 'react';

import './scroll-rail.css';
import {
  MARK_OFFSET,
  MIN_RAIL,
  POINTER_SPRING,
  PROX_PEAK,
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
  type Placement,
  type RailVariant,
  type ScrollMetrics,
  type Spring,
} from './scrollRailGeometry';

/**
 * THE SCROLL RAIL — the site's scroller, on every screen, mounted once.
 *
 * A column of ticks down the right edge of whatever scrolls. The whole column
 * stands for the whole content; the run of lit ticks is the part on screen.
 * Ticks rise toward the pointer like a dock, a heading in the content becomes a
 * longer tick you can press to go there, and the lit run drags like a thumb.
 *
 * PORTED FROM Ruixen UI's "Chapter Scrubber" (MIT,
 * `ruixen.com/r/chapter-scrubber.json`): the tick rail, the raised-cosine wave
 * and its two springs are that component's. It is a list of chapters you pick
 * from; this is a scrollbar, so the rest is new. Deviations:
 *
 * 1. NO `motion`, NO TAILWIND. The source is 37 `useTransform`s per rail on
 *    `motion/react` values. This is plain DOM written from one rAF loop that
 *    only runs while something is moving, so a resting page costs nothing.
 * 2. IT DRIVES A REAL SCROLLER. The source reports a hovered chapter. Here the
 *    lit run is `scrollTop`, a press scrolls, a drag scrubs, and the wheel
 *    still works with the pointer over the rail.
 * 3. THE SCROLLING ITSELF IS NATIVE. Nothing here replaces the browser's
 *    scroll: wheel, touch, keyboard, `scrollIntoView`, find-in-page and the
 *    rest all behave exactly as before. The rail is drawn BESIDE the scroller,
 *    in a fixed layer, and only reads and writes `scrollTop`.
 * 4. ONE HOST, NO WRAPPERS. Rails attach themselves to anything that scrolls
 *    vertically, so no screen had to be rewired and a new screen gets one for
 *    free. `data-no-rail` on a scroller opts it out.
 * 5. MARKS ARE THE PAGE'S OWN HEADINGS (`h1`–`h3`, or anything carrying
 *    `data-rail-mark="Name"`), not a list handed in.
 * 6. NOT IN THE ACCESSIBILITY TREE. The source is a `listbox` with roving
 *    focus. A scrollbar is not a tab stop — the scroller is already keyboard
 *    scrollable — so the layer is `aria-hidden` and takes no focus.
 * 7. TOUCH GETS AN INDICATOR, NOT A CONTROL. On a coarse pointer the rail shows
 *    while the page moves and fades after, and takes no input: a strip down the
 *    right edge of a phone would eat the edge of every swipe.
 * 8. REDUCED MOTION keeps the wave's shape and drops its easing (the source
 *    does the same), and a press jumps instead of gliding.
 */

const IDLE_MS = 1100;
const DISPOSE_MS = 600;
const TRACK_MS = 700;
const REFRESH_MS = 120;
const OPT_OUT = 'data-no-rail';
/** The lower layer's z-index. Must match `.srail-layer` in scroll-rail.css. */
const UNDER_Z = 150;
/** What counts as a control when deciding whether the strip steps aside. */
const CONTROLS =
  'button, a[href], input, select, textarea, summary, label, [role="button"], [role="tab"], [role="option"], [role="switch"], [role="menuitem"]';
const MARK_SELECTOR = '[data-rail-mark], h1, h2, h3';
const MARK_SCAN = 120;

interface Drag {
  id: number;
  /** Where on the lit window it was grabbed, as a fraction of the rail. */
  grab: number;
  y: number;
  moved: boolean;
  /** A section mark under the press, when the press landed on the lit run. */
  pending: Mark | null;
}

type RailState = 'hidden' | 'rest' | 'active';

interface Rail {
  el: HTMLElement;
  root: HTMLDivElement;
  ticksBox: HTMLDivElement;
  glow: HTMLDivElement;
  label: HTMLDivElement;
  labelName: HTMLSpanElement;
  labelPct: HTMLSpanElement;
  hit: HTMLDivElement;
  ticks: HTMLDivElement[];
  /* What is currently written to each tick, so a frame only touches the ticks
     that changed — two or three on a scroll, about a dozen under the wave. */
  drawnScale: string[];
  drawnLit: string[];
  drawnOpacity: string[];
  written: Record<string, string>;
  variant: RailVariant;
  place: Placement;
  top: number;
  height: number;
  metrics: ScrollMetrics;
  marks: Mark[];
  marked: boolean[];
  clips: HTMLElement[];
  row: Spring;
  strength: Spring;
  rowTarget: number;
  strengthTarget: number;
  usable: boolean;
  resting: boolean;
  inside: boolean;
  near: boolean;
  drag: Drag | null;
  touched: number;
  state: RailState;
  dirty: boolean;
  timer: number;
  observer: ResizeObserver | null;
  observed: WeakSet<Element>;
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function read(el: HTMLElement): ScrollMetrics {
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
}

function div(className: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

/** Start the rails. Returns the function that removes every trace of them. */
function startScrollRails(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;

  /* TWO LAYERS, because one z-index cannot be right for both jobs. A page's
     rail has to sit UNDER dialogs, menus and their scrims (a rail drawn over a
     modal reads as still pressable). A rail for a scroller that lives INSIDE
     one of those has to sit over it. */
  const under = div('srail-layer');
  const over = div('srail-layer');
  over.dataset.over = '';
  for (const layer of [under, over]) {
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  const ours = (node: Node | null) => !!node && (under.contains(node) || over.contains(node));

  const rails = new Map<HTMLElement, Rail>();
  const byHit = new WeakMap<Element, Rail>();
  let scrollerCache = new WeakMap<Element, HTMLElement | null>();

  const pointer = { x: -1e4, y: -1e4, live: false };
  let lastTarget: EventTarget | null = null;
  let seenTarget: EventTarget | null = null;
  let hoveredEl: HTMLElement | null = null;
  let frame = 0;
  let lastFrameAt = 0;
  let trackUntil = 0;
  let refreshTimer = 0;
  let pointerPending = false;
  let stopped = false;

  /* ── finding scrollers ───────────────────────────────────────────────── */

  function scrollsY(el: Element): el is HTMLElement {
    if (!(el instanceof HTMLElement) || el.hasAttribute(OPT_OUT)) return false;
    if (el.scrollHeight - el.clientHeight <= 1) return false;
    const flow = getComputedStyle(el).overflowY;
    return flow === 'auto' || flow === 'scroll' || flow === 'overlay';
  }

  function nearestScroller(node: Element | null): HTMLElement | null {
    if (!node) return null;
    const cached = scrollerCache.get(node);
    if (cached !== undefined) return cached;
    let found: HTMLElement | null = null;
    for (let el: Element | null = node; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (scrollsY(el)) {
        found = el;
        break;
      }
    }
    scrollerCache.set(node, found);
    return found;
  }

  /** The outermost scroller above `node` that is big enough to be "the page". */
  function pageScroller(node: Element): HTMLElement | null {
    let found: HTMLElement | null = null;
    for (let el: Element | null = node; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (scrollsY(el) && restsVisible(el.clientWidth, el.clientHeight)) found = el;
    }
    return found;
  }

  function findResting(): Set<HTMLElement> {
    const found = new Set<HTMLElement>();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const [fx, fy] of SAMPLE_POINTS) {
      const stack = document.elementsFromPoint(vw * fx, vh * fy);
      const top = stack.find((node) => !ours(node));
      if (!top) continue;
      const scroller = pageScroller(top);
      if (scroller) found.add(scroller);
    }
    return found;
  }

  /* ── one rail ────────────────────────────────────────────────────────── */

  function adopt(el: HTMLElement): Rail {
    const existing = rails.get(el);
    if (existing) return existing;

    /* Ancestors that clip: the rail must not be drawn where its scroller is
       cut off. Also decides the layer — a scroller outside the app root, under
       a `position: fixed` ancestor, or under anything stacked above the lower
       layer, belongs to an overlay and its rail has to sit over that overlay. */
    const clips: HTMLElement[] = [];
    let elevated = !document.getElementById('root')?.contains(el);
    for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
      const style = getComputedStyle(a);
      if (style.position === 'fixed' || Number(style.zIndex) >= UNDER_Z) elevated = true;
      if (a !== el && style.overflowY !== 'visible' && clips.length < 4) clips.push(a);
    }

    const root = div('srail');
    const glow = div('srail-glow');
    const ticksBox = div('srail-ticks');
    const label = div('srail-label');
    const card = div('srail-label-card');
    const labelName = document.createElement('span');
    labelName.className = 'srail-label-name';
    const labelPct = document.createElement('span');
    labelPct.className = 'srail-label-pct';
    card.append(labelName, labelPct);
    label.appendChild(card);
    const hit = div('srail-hit');
    root.append(glow, ticksBox, label, hit);
    root.dataset.state = 'hidden';

    const rail: Rail = {
      el,
      root,
      ticksBox,
      glow,
      label,
      labelName,
      labelPct,
      hit,
      ticks: [],
      drawnScale: [],
      drawnLit: [],
      drawnOpacity: [],
      written: {},
      variant: 'compact',
      place: { outset: false, anchor: 0, hitLeft: 0, hitRight: 0 },
      top: 0,
      height: 0,
      metrics: read(el),
      marks: [],
      marked: [],
      clips,
      row: { value: 0, velocity: 0 },
      strength: { value: 0, velocity: 0 },
      rowTarget: 0,
      strengthTarget: 0,
      usable: false,
      resting: false,
      inside: false,
      near: false,
      drag: null,
      /* Far in the past, not 0: `performance.now()` is small just after a
         load, and a rail adopted then would read as recently scrolled. */
      touched: -1e9,
      state: 'hidden',
      dirty: true,
      timer: 0,
      observer: null,
      observed: new WeakSet(),
    };

    hit.addEventListener('pointerdown', (e) => onDown(rail, e));
    hit.addEventListener('pointermove', (e) => onDrag(rail, e));
    hit.addEventListener('pointerup', (e) => onUp(rail, e));
    hit.addEventListener('pointercancel', (e) => onUp(rail, e));
    /* THE WHEEL HAS TO BE FORWARDED. The strip lives in a layer outside the
       scroller, so a wheel over it would otherwise scroll nothing at all. */
    hit.addEventListener('wheel', (e) => onWheel(rail, e), { passive: true });
    byHit.set(hit, rail);

    if (typeof ResizeObserver === 'function') {
      rail.observer = new ResizeObserver(() => {
        if (stopped) return;
        layout(rail);
        scheduleRefresh();
        startLoop();
      });
      rail.observer.observe(el);
      rail.observed.add(el);
    }

    (elevated ? over : under).appendChild(root);
    rails.set(el, rail);
    watchChildren(rail);
    dress(rail);
    layout(rail);
    rail.marks = collectMarks(rail);
    applyMarks(rail);
    return rail;
  }

  /* `scrollHeight` changes when the CONTENT grows, which never resizes the
     scroller's own box — so the content's top-level children are observed too. */
  function watchChildren(rail: Rail): void {
    if (!rail.observer) return;
    const kids = rail.el.children;
    const limit = Math.min(kids.length, 60);
    for (let i = 0; i < limit; i++) {
      const kid = kids[i];
      if (rail.observed.has(kid)) continue;
      rail.observed.add(kid);
      rail.observer.observe(kid);
    }
  }

  function dispose(rail: Rail): void {
    window.clearTimeout(rail.timer);
    rail.observer?.disconnect();
    rail.root.remove();
    rails.delete(rail.el);
    if (hoveredEl === rail.el) hoveredEl = null;
  }

  function write(rail: Rail, key: string, value: string, apply: (v: string) => void): void {
    if (rail.written[key] === value) return;
    rail.written[key] = value;
    apply(value);
  }

  function build(rail: Rail, variant: RailVariant, count: number): void {
    rail.variant = variant;
    rail.root.dataset.variant = variant;
    rail.ticksBox.textContent = '';
    rail.ticks = [];
    for (let i = 0; i < count; i++) {
      const tick = div('srail-tick');
      rail.ticksBox.appendChild(tick);
      rail.ticks.push(tick);
    }
    rail.drawnScale = new Array<string>(count).fill('');
    rail.drawnLit = new Array<string>(count).fill('');
    rail.drawnOpacity = new Array<string>(count).fill('');
    delete rail.written.pitch;
    applyMarks(rail);
  }

  /** Measure the scroller and put the rail beside it. */
  function layout(rail: Rail): void {
    const el = rail.el;
    if (!el.isConnected) {
      dispose(rail);
      return;
    }
    const box = el.getBoundingClientRect();
    rail.metrics = read(el);
    const vw = window.innerWidth;
    let top = Math.max(box.top, 0);
    let bottom = Math.min(box.bottom, window.innerHeight);
    for (const clip of rail.clips) {
      const c = clip.getBoundingClientRect();
      top = Math.max(top, c.top);
      bottom = Math.min(bottom, c.bottom);
    }
    const variant = variantFor(box.width, bottom - top, vw - box.right);
    const spec = SPECS[variant];
    const height = bottom - top - spec.pad * 2;
    const usable = canScroll(rail.metrics) && height >= MIN_RAIL && box.width >= 48 && box.right > 0 && box.left < vw;
    const changed = usable !== rail.usable;
    if (changed) {
      rail.usable = usable;
      rail.dirty = true;
    }
    if (!usable) {
      if (changed) sync(rail);
      return;
    }

    const count = tickCount(height, spec.pitch);
    if (count !== rail.ticks.length || variant !== rail.variant) build(rail, variant, count);

    rail.place = placement(box.right, vw, spec);
    rail.root.toggleAttribute('data-outset', rail.place.outset);
    const railTop = top + spec.pad;
    if (railTop !== rail.top || height !== rail.height) rail.dirty = true;
    rail.top = railTop;
    rail.height = height;

    const left = rail.place.anchor - spec.peak;
    write(rail, 'box', `${px(left)}|${px(railTop)}`, () => {
      rail.root.style.transform = `translate3d(${px(left)}, ${px(railTop)}, 0)`;
    });
    write(rail, 'size', `${spec.peak}|${px(height)}|${spec.pad}`, () => {
      rail.root.style.width = `${spec.peak}px`;
      rail.root.style.height = px(height);
      rail.hit.style.top = `${-spec.pad}px`;
      rail.hit.style.bottom = `${-spec.pad}px`;
    });
    write(rail, 'pitch', `${count}|${px(height)}`, () => {
      const pitch = height / count;
      for (let i = 0; i < count; i++) rail.ticks[i].style.top = px((i + 0.5) * pitch);
    });
    /* THE STRIP NEVER WIDENS. It is the gutter, or the lane a native bar would
       have had, and no more: a strip that grew toward the pointer would take
       presses meant for whatever sits beside the rail. */
    write(rail, 'hit', `${px(rail.place.hitLeft - left)}|${px(rail.place.hitRight - rail.place.hitLeft)}`, () => {
      rail.hit.style.left = px(rail.place.hitLeft - left);
      rail.hit.style.width = px(rail.place.hitRight - rail.place.hitLeft);
    });
    if (changed) sync(rail);
  }

  /* A scroller may dress its own rail: a screen with its own palette (the
     field book is paper in both themes) sets `--rail-ink`, `--rail-lit` and
     `--rail-glow` on the element that scrolls, and they are carried across to
     the rail, which lives outside that element and cannot inherit them. */
  function dress(rail: Rail): void {
    const style = getComputedStyle(rail.el);
    for (const name of ['ink', 'lit', 'glow']) {
      const value = style.getPropertyValue(`--rail-${name}`).trim();
      write(rail, `dress-${name}`, value, (v) => {
        if (v) rail.root.style.setProperty(`--srail-${name}`, v);
        else rail.root.style.removeProperty(`--srail-${name}`);
      });
    }
  }

  function collectMarks(rail: Rail): Mark[] {
    if (rail.variant !== 'full' || !rail.usable) return [];
    const el = rail.el;
    const origin = el.getBoundingClientRect().top - el.scrollTop;
    const nodes = el.querySelectorAll<HTMLElement>(MARK_SELECTOR);
    const limit = Math.min(nodes.length, MARK_SCAN);
    const raw: Mark[] = [];
    for (let i = 0; i < limit; i++) {
      const node = nodes[i];
      /* A section that names itself owns the headings inside it: the hero is
         "Search a player", and its own <h1> is not a second section. */
      const owner = node.parentElement?.closest('[data-rail-mark]');
      if (owner && el.contains(owner)) continue;
      const box = node.getBoundingClientRect();
      if (box.height < 1 || box.width < 1) continue;
      const named = node.getAttribute('data-rail-mark');
      raw.push({
        top: box.top - origin,
        label: cleanLabel(named ?? node.getAttribute('aria-label') ?? node.textContent),
        level: named !== null ? 0 : Number(node.tagName.charAt(1)) || 3,
      });
    }
    return pickMarks(raw, rail.metrics, rail.ticks.length);
  }

  function applyMarks(rail: Rail): void {
    const count = rail.ticks.length;
    const marked = new Array<boolean>(count).fill(false);
    for (const mark of rail.marks) marked[markTick(mark.top, rail.metrics, count)] = true;
    for (let i = 0; i < count; i++) {
      if (marked[i] !== !!rail.marked[i]) rail.ticks[i].toggleAttribute('data-mark', marked[i]);
    }
    rail.marked = marked;
    rail.dirty = true;
  }

  /* ── state ───────────────────────────────────────────────────────────── */

  function sync(rail: Rail): void {
    const now = performance.now();
    const holding = rail.drag !== null || rail.near;
    const fresh = now - rail.touched < IDLE_MS;
    let next: RailState = 'hidden';
    if (rail.usable) {
      if (holding || fresh) next = 'active';
      else if (rail.resting || rail.el === hoveredEl) next = 'rest';
    }
    if (next !== rail.state) {
      rail.state = next;
      rail.root.dataset.state = next;
    }
    window.clearTimeout(rail.timer);
    rail.timer = 0;
    if (next === 'active' && !holding) {
      rail.timer = window.setTimeout(() => sync(rail), IDLE_MS - (now - rail.touched) + 20);
    } else if (next === 'hidden' && !rail.resting) {
      rail.timer = window.setTimeout(() => {
        if (rail.state === 'hidden' && !rail.resting && rail.el !== hoveredEl) dispose(rail);
      }, DISPOSE_MS);
    }
  }

  /**
   * Whether a control that is NOT part of this scroller sits under the pointer.
   *
   * The strip is a lane down the scroller's edge, and something from outside
   * can overlap it — the sidebar's collapse button straddles the sidebar's
   * right edge by design. That control keeps its presses: the strip steps
   * aside for it. A control INSIDE the scroller does not win; the lane is
   * where a native scrollbar would have been, and that always outranked the
   * content under it.
   */
  function foreignControl(rail: Rail): boolean {
    const below = document.elementsFromPoint(pointer.x, pointer.y).find((node) => !ours(node));
    const control = below?.closest(CONTROLS);
    return !!control && !rail.el.contains(control) && !control.contains(rail.el);
  }

  function updateProximity(rail: Rail): void {
    const spec = SPECS[rail.variant];
    const count = rail.ticks.length;
    const eligible =
      rail.usable && (rail.resting || rail.el === hoveredEl || rail.drag !== null || rail.state !== 'hidden');
    let s = 0;
    let yielding = false;
    if (rail.drag) s = 1;
    else if (eligible && pointer.live && pointer.y >= rail.top - 12 && pointer.y <= rail.top + rail.height + 12) {
      s = strengthAt(pointer.x, rail.place.hitLeft, rail.place.hitRight, spec.prox);
      if (s >= 1 && foreignControl(rail)) {
        yielding = true;
        s = PROX_PEAK;
      }
    }
    if (rail.root.hasAttribute('data-yield') !== yielding) rail.root.toggleAttribute('data-yield', yielding);
    const was = rail.near;
    rail.strengthTarget = s;
    rail.near = s > 0;
    rail.inside = s >= 1;
    if (s > 0) {
      rail.rowTarget = rowAt(pointer.y, rail.top, rail.height, count);
      /* A wave that starts from wherever the crest last was sweeps the whole
         rail on its way to the pointer. Start it where the pointer is. */
      if (rail.strength.value < 0.02) {
        rail.row.value = rail.rowTarget;
        rail.row.velocity = 0;
      }
      rail.dirty = true;
    }
    const engaged = rail.inside || rail.drag !== null;
    if (rail.root.hasAttribute('data-engaged') !== engaged) rail.root.toggleAttribute('data-engaged', engaged);
    if (was !== rail.near) {
      if (!rail.near) rail.touched = performance.now();
      sync(rail);
    }
  }

  /* ── drawing ─────────────────────────────────────────────────────────── */

  function paint(rail: Rail): void {
    rail.dirty = false;
    const spec = SPECS[rail.variant];
    const count = rail.ticks.length;
    const m = rail.metrics;
    const size = thumbSize(m, count);
    const start = thumbStart(m, count);
    const strength = rail.strength.value;
    const row = rail.row.value;

    for (let i = 0; i < count; i++) {
      const rise = strength > 0.001 ? strength * bump(Math.abs(i - row), spec.radius) : 0;
      const look = tickLook(spec, coverage(i, count, start, size), rise, !!rail.marked[i]);
      const scale = `${(look.length / spec.peak).toFixed(3)}|${look.thick.toFixed(2)}`;
      if (scale !== rail.drawnScale[i]) {
        rail.drawnScale[i] = scale;
        rail.ticks[i].style.transform = `scaleX(${(look.length / spec.peak).toFixed(3)}) scaleY(${look.thick.toFixed(2)})`;
      }
      const lit = look.lit.toFixed(2);
      if (lit !== rail.drawnLit[i]) {
        rail.drawnLit[i] = lit;
        rail.ticks[i].style.setProperty('--lit', lit);
      }
      const opacity = look.opacity.toFixed(2);
      if (opacity !== rail.drawnOpacity[i]) {
        rail.drawnOpacity[i] = opacity;
        rail.ticks[i].style.opacity = opacity;
      }
    }

    write(rail, 'glow', `${px(start * rail.height)}|${px(size * rail.height)}`, () => {
      rail.glow.style.transform = `translate3d(0, ${px(start * rail.height)}, 0)`;
      rail.glow.style.height = px(size * rail.height);
    });

    if (rail.variant === 'full' && (rail.inside || rail.drag !== null)) paintLabel(rail, count);
  }

  /* Hovering, the label previews where a press would land. Dragging, it says
     where the page is. */
  function paintLabel(rail: Rail, count: number): void {
    const m = rail.metrics;
    let name: string;
    let percent: number;
    if (rail.drag?.moved) {
      percent = Math.round(progress(m) * 100);
      name = sectionAt(rail.marks, m.scrollTop + m.clientHeight * 0.3)?.label ?? '';
    } else {
      const f = fractionAt(pointer.y, rail.top, rail.height);
      percent = Math.round(f * 100);
      name = (snapMark(rail.marks, m, count, f) ?? sectionAt(rail.marks, f * m.scrollHeight))?.label ?? '';
    }
    const y = Math.min(Math.max(pointer.y - rail.top, 14), Math.max(14, rail.height - 14));
    write(rail, 'labelY', px(y), (v) => rail.label.style.setProperty('--srail-y', v));
    write(rail, 'labelName', name, (v) => {
      rail.labelName.textContent = v;
      rail.labelName.hidden = v === '';
    });
    write(rail, 'labelPct', `${percent}%`, (v) => {
      rail.labelPct.textContent = v;
    });
  }

  /* ── the loop: runs only while something is moving ───────────────────── */

  function loop(t: number): void {
    frame = 0;
    if (stopped) return;
    const dt = lastFrameAt ? Math.min(0.05, (t - lastFrameAt) / 1000) : 1 / 60;
    lastFrameAt = t;
    const tracking = performance.now() < trackUntil;
    let busy = tracking;
    const still = reducedMotion();

    for (const rail of [...rails.values()]) {
      if (tracking) layout(rail);
      if (!rail.usable || !rails.has(rail.el)) continue;
      let moving = false;
      if (still) {
        if (rail.row.value !== rail.rowTarget || rail.strength.value !== rail.strengthTarget) {
          rail.row.value = rail.rowTarget;
          rail.strength.value = rail.strengthTarget;
          rail.dirty = true;
        }
      } else {
        const rowDone = rail.strengthTarget > 0 ? stepSpring(rail.row, rail.rowTarget, POINTER_SPRING, dt) : true;
        const strengthDone = stepSpring(rail.strength, rail.strengthTarget, STRENGTH_SPRING, dt);
        moving = !rowDone || !strengthDone;
      }
      if (moving) busy = true;
      if (moving || rail.dirty) paint(rail);
    }

    if (busy) frame = requestAnimationFrame(loop);
    else lastFrameAt = 0;
  }

  function startLoop(): void {
    if (!frame && !stopped) frame = requestAnimationFrame(loop);
  }

  /** Keep re-measuring for a moment: entrances and layout shifts move rails. */
  function track(ms: number): void {
    trackUntil = Math.max(trackUntil, performance.now() + ms);
    startLoop();
  }

  /* ── refresh: which scrollers exist, and which are the page ──────────── */

  function scheduleRefresh(): void {
    if (!refreshTimer && !stopped) refreshTimer = window.setTimeout(refresh, REFRESH_MS);
  }

  function refresh(): void {
    refreshTimer = 0;
    if (stopped) return;
    scrollerCache = new WeakMap();
    seenTarget = null;
    for (const rail of [...rails.values()]) if (!rail.el.isConnected) dispose(rail);

    const found = findResting();
    for (const el of found) adopt(el);
    for (const rail of [...rails.values()]) {
      rail.resting = found.has(rail.el);
      watchChildren(rail);
      layout(rail);
      if (!rails.has(rail.el)) continue;
      dress(rail);
      rail.marks = collectMarks(rail);
      applyMarks(rail);
      sync(rail);
    }
    pointerFrame();
    track(TRACK_MS);
  }

  /* ── events ──────────────────────────────────────────────────────────── */

  function onScroll(e: Event): void {
    const target = e.target;
    if (!(target instanceof HTMLElement) || ours(target)) return;
    let rail = rails.get(target);
    if (!rail) {
      if (!scrollsY(target)) return;
      rail = adopt(target);
    }
    rail.metrics = read(target);
    rail.touched = performance.now();
    rail.dirty = true;
    sync(rail);
    for (const other of rails.values()) {
      if (other !== rail && target.contains(other.el)) {
        track(160);
        break;
      }
    }
    startLoop();
  }

  function pointerFrame(): void {
    pointerPending = false;
    if (stopped) return;
    if (lastTarget !== seenTarget) {
      seenTarget = lastTarget;
      let next: HTMLElement | null = null;
      if (pointer.live && lastTarget instanceof Element) {
        next = ours(lastTarget) ? (byHit.get(lastTarget)?.el ?? hoveredEl) : nearestScroller(lastTarget);
      }
      if (next !== hoveredEl) {
        const previous = hoveredEl ? rails.get(hoveredEl) : undefined;
        hoveredEl = next;
        if (previous) sync(previous);
        if (next) sync(adopt(next));
      }
    }
    for (const rail of rails.values()) updateProximity(rail);
    startLoop();
  }

  function queuePointer(): void {
    if (pointerPending) return;
    pointerPending = true;
    requestAnimationFrame(pointerFrame);
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      if (pointer.live) onPointerGone();
      return;
    }
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.live = true;
    lastTarget = e.target;
    queuePointer();
  }

  function onPointerGone(): void {
    pointer.live = false;
    lastTarget = null;
    queuePointer();
  }

  function onDown(rail: Rail, e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    rail.hit.setPointerCapture(e.pointerId);
    const count = rail.ticks.length;
    const m = (rail.metrics = read(rail.el));
    const f = fractionAt(e.clientY, rail.top, rail.height);
    const size = thumbSize(m, count);
    const start = thumbStart(m, count);
    const onThumb = f >= start && f <= start + size;
    const snap = rail.variant === 'full' ? snapMark(rail.marks, m, count, f) : null;
    rail.drag = {
      id: e.pointerId,
      grab: onThumb ? f - start : size / 2,
      y: e.clientY,
      moved: false,
      /* ON the lit run a press might be the start of a drag, so nothing moves
         yet — but if it turns out to be a plain click on a mark, the release
         goes to that section. The label was already naming it; a press that
         then did nothing read as the rail being broken. */
      pending: onThumb ? snap : null,
    };
    if (!onThumb) {
      /* A press off the lit run goes there: to the section whose mark it
         landed on, or else so the window is centred on the pointer. */
      const top = snap ? Math.max(0, snap.top - MARK_OFFSET) : scrollTopForStart(f - size / 2, m, count);
      rail.el.scrollTo({ top, behavior: reducedMotion() ? 'instant' : 'smooth' });
    }
    rail.root.toggleAttribute('data-dragging', true);
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.live = true;
    updateProximity(rail);
    sync(rail);
    startLoop();
  }

  function onDrag(rail: Rail, e: PointerEvent): void {
    const drag = rail.drag;
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.moved && Math.abs(e.clientY - drag.y) < 3) return;
    drag.moved = true;
    const m = read(rail.el);
    const f = fractionAt(e.clientY, rail.top, rail.height);
    /* `instant`, stated: a scroller with `scroll-behavior: smooth` would
       otherwise ease toward every pointer position and the thumb would trail
       the hand that is holding it. */
    rail.el.scrollTo({ top: scrollTopForStart(f - drag.grab, m, rail.ticks.length), behavior: 'instant' });
  }

  function onUp(rail: Rail, e: PointerEvent): void {
    if (!rail.drag || rail.drag.id !== e.pointerId) return;
    if (rail.hit.hasPointerCapture(e.pointerId)) rail.hit.releasePointerCapture(e.pointerId);
    const { pending, moved } = rail.drag;
    if (pending && !moved && e.type === 'pointerup') {
      rail.el.scrollTo({ top: Math.max(0, pending.top - MARK_OFFSET), behavior: reducedMotion() ? 'instant' : 'smooth' });
    }
    rail.drag = null;
    rail.root.toggleAttribute('data-dragging', false);
    rail.touched = performance.now();
    updateProximity(rail);
    sync(rail);
    startLoop();
  }

  function onWheel(rail: Rail, e: WheelEvent): void {
    if (e.ctrlKey) return;
    rail.el.scrollBy({ top: wheelPixels(e.deltaY, e.deltaMode, rail.el.clientHeight), behavior: 'instant' });
  }

  /* ── wiring ──────────────────────────────────────────────────────────── */

  const onResize = () => {
    scheduleRefresh();
    track(TRACK_MS);
  };
  const mutations = new MutationObserver((list) => {
    for (const record of list) {
      if (!ours(record.target)) {
        scheduleRefresh();
        return;
      }
    }
  });

  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onPointerGone);
  window.addEventListener('blur', onPointerGone);
  window.addEventListener('resize', onResize);
  window.addEventListener('hashchange', scheduleRefresh);
  mutations.observe(document.body, { childList: true, subtree: true });
  scheduleRefresh();

  return () => {
    stopped = true;
    document.removeEventListener('scroll', onScroll, { capture: true });
    document.removeEventListener('pointermove', onPointerMove);
    document.documentElement.removeEventListener('pointerleave', onPointerGone);
    window.removeEventListener('blur', onPointerGone);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('hashchange', scheduleRefresh);
    mutations.disconnect();
    window.clearTimeout(refreshTimer);
    if (frame) cancelAnimationFrame(frame);
    for (const rail of [...rails.values()]) dispose(rail);
    under.remove();
    over.remove();
  };
}

/** Mounted once, beside every route. Renders nothing; the rails are its effect. */
export function ScrollRailHost(): null {
  useEffect(() => startScrollRails(), []);
  return null;
}
