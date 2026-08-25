/**
 * The top dock's proximity field — a spring per nav item, driven by how close
 * the pointer is to each one.
 *
 * Adapted from ThreeUI's `AnimatedTopDock`. Three things changed on the way in,
 * and each is a rule this project already holds:
 *
 * 1. **THE LOOP STOPS.** The reference runs `requestAnimationFrame` forever and
 *    checks a dirty flag inside it. `CLAUDE.md` bans exactly that shape — "a
 *    loop nobody can see is still pure waste" — and it is the reason
 *    `three/runtime.ts` gates every WebGL frame on visibility. Here the rAF is
 *    STARTED by an interaction and TEARS ITSELF DOWN the moment every spring
 *    has settled, so a dock nobody is pointing at costs zero frames.
 * 2. **No `keydown` handler.** The reference intercepts Enter and Space and
 *    calls `item.click()`. These are real `<button>` elements, which already
 *    fire `click` on both keys — adding it would fire every nav handler twice.
 * 3. **`reducedMotion()` is the project's, not a local copy.** Same helper the
 *    WebGL layer uses, so there is one definition of "this user does not want
 *    motion" in the codebase.
 *
 * ── ONE DELIBERATE DEVIATION ─────────────────────────────────────────────
 *
 * `CLAUDE.md` says animate transform and opacity only. This writes `width` and
 * `height` per frame, which is a layout pass per frame, and it is kept on
 * purpose: the magnification IS neighbours being pushed aside, and a transform
 * cannot push a sibling. `scale` was the alternative and it distorts the label
 * text, which is the whole content of these items.
 *
 * What made the banned CSS loops expensive was that they were INFINITE and
 * animated `box-shadow`/`filter`, thrashing repaint across the whole page
 * forever. This relayouts six flex children inside one bar, only while the
 * pointer is physically on the dock, and stops when it leaves.
 */
import { reducedMotion } from '../../three/runtime';

export interface TopDockOptions {
  /** Pixels either side of an item's centre that still register as "near". */
  proximity: number;
  /** Spring stiffness and damping. The reference's authored pair — a stiffer
   *  spring overshoots into a wobble, a softer one lags behind the pointer. */
  spring: number;
  damping: number;
  /** Pixels an item gains at full influence. Width is additionally clamped to a
   *  fraction of the item's own width, so "Home" does not grow proportionally
   *  more than "Duel Builder" and unbalance the row. */
  widthGrowth: number;
  heightGrowth: number;
  /** How far the item travels DOWN as it grows. The expansion is one-sided —
   *  the dock's top edge is a straight line and the growth hangs below it. */
  drop: number;
}

export const TOP_DOCK_DEFAULTS: TopDockOptions = {
  /* WIDER THAN THE REFERENCE'S 122, because these items are wider than its.
     Proximity is measured centre-to-centre, so the field has to be read against
     the item pitch, not copied as a number. Its items are 94px wide, so a
     neighbour's centre sits ~97px away and still catches ~0.10 influence. Ours
     run 87-127px, which put the nearest neighbour ~118px out — at 132 that
     measured 0.17px of growth, i.e. one item moving alone with no falloff
     either side, which is not a dock. 210 restores the reference's ratio. */
  proximity: 210,
  spring: 0.19,
  damping: 0.7,
  widthGrowth: 15,
  heightGrowth: 11,
  drop: 3,
};

interface DockItemState {
  element: HTMLElement;
  baseWidth: number;
  baseHeight: number;
  /** Current influence, 0 at rest and 1 directly under the pointer. */
  value: number;
  velocity: number;
  target: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Below this the dock is a plain nav — there is no pointer to be near it. */
const MIN_WIDTH = 900;

export function createTopDockController(
  root: HTMLElement,
  getOptions: () => TopDockOptions,
): () => void {
  /* A coarse pointer has no hover position to measure, and a phone would pay
     for a field it can never drive. Same gate the reference uses. */
  const precision = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  let items: DockItemState[] = [];
  let enabled = false;
  let pointerActive = false;
  let frame = 0;

  const canAnimate = () =>
    !reducedMotion() && precision.matches && window.innerWidth > MIN_WIDTH && root.clientWidth > 0;

  /** Hand an item's geometry back to the stylesheet. */
  const clearStyle = (element: HTMLElement) => {
    element.style.width = '';
    element.style.height = '';
    element.style.transform = '';
    element.dataset.dockNear = 'false';
  };

  /* Base sizes are re-read rather than cached across resizes: these are rem
     paddings around text, so a font-size change or a narrower bar moves them.
     Styles are cleared FIRST and measured in a second pass, or every item after
     the first would be measured against the previous one's inflated box. */
  const measure = () => {
    enabled = canAnimate();
    const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-dock-item]'));
    for (const element of elements) clearStyle(element);

    items = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        element,
        baseWidth: rect.width,
        baseHeight: rect.height,
        value: 0,
        velocity: 0,
        target: 0,
      };
    });

    pointerActive = false;
    cancelAnimationFrame(frame);
    frame = 0;
    root.dataset.dockState = enabled ? 'idle' : 'static';
    root.dataset.dockMax = '0.00';
  };

  const apply = (state: DockItemState, options: TopDockOptions) => {
    const value = clamp(state.value, 0, 1.08);
    /* Clamped to a share of the item's own width so a short label does not
       balloon while a long one barely moves. */
    const extraWidth = Math.min(options.widthGrowth, state.baseWidth * 0.24);
    state.element.style.width = `${(state.baseWidth + extraWidth * value).toFixed(2)}px`;
    state.element.style.height = `${(state.baseHeight + options.heightGrowth * value).toFixed(2)}px`;
    state.element.style.transform = `translateY(${(value * options.drop).toFixed(2)}px)`;
  };

  const draw = () => {
    frame = 0;
    const options = getOptions();
    let moving = false;
    let maxValue = 0;

    for (const state of items) {
      state.velocity += (state.target - state.value) * options.spring;
      state.velocity *= options.damping;
      state.value += state.velocity;
      /* Snap and zero the velocity inside the threshold. Without this the
         spring converges asymptotically and the loop never reaches a frame it
         can call finished, which is precisely how the reference ends up
         needing a permanent rAF. */
      if (Math.abs(state.target - state.value) < 0.001 && Math.abs(state.velocity) < 0.001) {
        state.value = state.target;
        state.velocity = 0;
      } else {
        moving = true;
      }
      apply(state, options);
      maxValue = Math.max(maxValue, state.value);
    }

    root.dataset.dockMax = maxValue.toFixed(2);

    if (moving) {
      frame = requestAnimationFrame(draw);
      return;
    }
    /* Settled. If it settled flat, drop the inline geometry entirely so the
       resting dock is pure stylesheet and a later media query is not fighting
       stale pixel widths. */
    if (items.every((state) => state.target === 0)) {
      root.dataset.dockState = 'idle';
      for (const state of items) clearStyle(state.element);
    }
  };

  const kick = () => {
    if (frame || !enabled || document.hidden) return;
    frame = requestAnimationFrame(draw);
  };

  const setTargets = (clientX: number) => {
    if (!enabled) return;
    const options = getOptions();
    /* Rects are re-read per move rather than cached: the items are being
       resized by this very loop, so a cached centre is a frame stale and the
       field drifts away from the pointer as the dock expands. */
    for (const state of items) {
      const rect = state.element.getBoundingClientRect();
      const centre = rect.left + rect.width * 0.5;
      const proximity = clamp(1 - Math.abs(clientX - centre) / Math.max(1, options.proximity), 0, 1);
      // Smoothstep, so influence eases in at the edge of the field instead of
      // beginning as a straight ramp.
      state.target = proximity * proximity * (3 - 2 * proximity);
      state.element.dataset.dockNear = state.target > 0.08 ? 'true' : 'false';
    }
    pointerActive = true;
    root.dataset.dockState = 'active';
    kick();
  };

  /* Keyboard focus lights the focused item fully and its immediate neighbours
     faintly, so tabbing through reads as the same field the pointer drives
     rather than as a separate highlight. */
  const focusItem = (item: HTMLElement) => {
    if (!enabled) return;
    const index = items.findIndex((state) => state.element === item);
    if (index < 0) return;
    items.forEach((state, itemIndex) => {
      const distance = Math.abs(itemIndex - index);
      state.target = distance === 0 ? 1 : distance === 1 ? 0.24 : 0;
      state.element.dataset.dockNear = state.target > 0.08 ? 'true' : 'false';
    });
    pointerActive = false;
    root.dataset.dockState = 'focus';
    kick();
  };

  const reset = () => {
    pointerActive = false;
    for (const state of items) {
      state.target = 0;
      state.element.dataset.dockNear = 'false';
    }
    kick();
  };

  const onPointerMove = (event: PointerEvent) => setTargets(event.clientX);

  /* A pointer can leave without firing `pointerleave` — dragged out of the
     window, or moved fast enough that the last event lands outside. The bounds
     include the DROPPED items, which hang below the nav's own box. */
  const onWindowPointerMove = (event: PointerEvent) => {
    if (!pointerActive) return;
    const rootRect = root.getBoundingClientRect();
    let bottom = rootRect.bottom;
    for (const state of items) bottom = Math.max(bottom, state.element.getBoundingClientRect().bottom);
    const outside =
      event.clientX < rootRect.left ||
      event.clientX > rootRect.right ||
      event.clientY < rootRect.top ||
      event.clientY > bottom;
    if (outside) reset();
  };

  const onFocusIn = (event: FocusEvent) => {
    const item = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-dock-item]');
    if (item) focusItem(item);
  };

  /* Deferred a frame: during a move between two items inside the dock,
     `activeElement` is transiently `<body>`, and reading it synchronously
     collapses the field between every tab press. */
  const onFocusOut = () =>
    requestAnimationFrame(() => {
      if (!root.contains(document.activeElement)) reset();
    });

  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      kick();
    }
  };

  const resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(root.parentElement ?? root);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerleave', reset);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  window.addEventListener('pointermove', onWindowPointerMove, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  precision.addEventListener('change', measure);
  reduced.addEventListener('change', measure);
  measure();

  return () => {
    cancelAnimationFrame(frame);
    frame = 0;
    resizeObserver.disconnect();
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerleave', reset);
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', onFocusOut);
    window.removeEventListener('pointermove', onWindowPointerMove);
    document.removeEventListener('visibilitychange', onVisibility);
    precision.removeEventListener('change', measure);
    reduced.removeEventListener('change', measure);
    for (const state of items) clearStyle(state.element);
  };
}
