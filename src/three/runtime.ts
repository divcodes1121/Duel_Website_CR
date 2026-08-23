/**
 * Shared plumbing for the WebGL flourishes.
 *
 * Three rules the rest of `src/three/` inherits from here, all of them from
 * mistakes this project has already made once:
 *
 * 1. **three.js is never in the main bundle.** It is ~150 kB gzipped, which is
 *    a third of the app. `loadThree()` is a dynamic import, so it arrives only
 *    when something actually renders — exactly the treatment `jspdf` gets.
 * 2. **Nothing loops off-screen.** `index.css` used to carry an unconditional
 *    infinite animation and it was the cause of the lag that got motion banned
 *    project-wide. A WebGL canvas is GPU-side and does not thrash layout the
 *    way the old `box-shadow` loops did, but a loop nobody can see is still
 *    pure cost, so every renderer here is gated on an IntersectionObserver.
 * 3. **`prefers-reduced-motion` means no canvas at all**, not a slower one.
 *    Every component falls back to the flat markup it decorates.
 */

type Three = typeof import('three');

let pending: Promise<Three> | null = null;

/** three.js, fetched on first use and shared by every component after that. */
export function loadThree(): Promise<Three> {
  if (!pending) pending = import('three');
  return pending;
}

export function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The active theme, read the way `themeStore` writes it. */
export function isDark(): boolean {
  if (typeof document === 'undefined') return false;
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return true;
  if (attr === 'light') return false;
  // "system" stamps no attribute — fall through to the media query.
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/**
 * Device pixel ratio, capped.
 *
 * Uncapped, a 3× phone renders nine times the pixels for a flourish nobody is
 * looking closely at, and it is the single easiest way to make a small canvas
 * cost more than the page around it.
 */
export function pixelRatio(): number {
  return Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
}

/**
 * Run `frame` on rAF, but only while `el` is on screen and the tab is visible.
 *
 * Returns a stop function. `frame` receives seconds since start and seconds
 * since the previous frame; returning `false` stops the loop for good, which
 * is how the one-shot pieces (the crown) go quiet without a caller polling
 * them.
 */
export function runLoop(
  el: Element,
  frame: (elapsed: number, delta: number) => void | boolean,
): () => void {
  let raf = 0;
  let visible = false;
  let finished = false;
  let start = 0;
  let last = 0;

  const tick = (now: number) => {
    if (finished) return;
    if (!start) start = now;
    const elapsed = (now - start) / 1000;
    const delta = last ? (now - last) / 1000 : 0;
    last = now;
    if (frame(elapsed, Math.min(delta, 0.05)) === false) {
      finished = true;
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const play = () => {
    if (raf || finished || !visible || document.hidden) return;
    last = 0; // a resumed loop must not integrate the time it spent paused
    raf = requestAnimationFrame(tick);
  };
  const pause = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      visible ? play() : pause();
    },
    { rootMargin: '80px' },
  );
  io.observe(el);

  const onVisibility = () => (document.hidden ? pause() : play());
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    finished = true;
    pause();
    io.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/** Keep a renderer and camera matched to their container's box. */
export function autoResize(
  el: HTMLElement,
  apply: (width: number, height: number) => void,
): () => void {
  const measure = () => {
    const { width, height } = el.getBoundingClientRect();
    if (width > 0 && height > 0) apply(width, height);
  };
  measure();
  const ro = new ResizeObserver(measure);
  ro.observe(el);
  return () => ro.disconnect();
}

/** Canvas styling every overlay here wants: fill the host, ignore the mouse. */
export const OVERLAY_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  inset: '0',
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  display: 'block',
};
