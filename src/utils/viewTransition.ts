/**
 * A route change as a short cross-fade (the View Transitions API).
 *
 * NO IMPORTS, so a test can drive it without a browser. `flushSync` is passed
 * IN by the caller: the transition snapshots the page before and after the
 * callback, and React must have committed the new screen by the time the
 * callback returns or the "after" picture is the old screen again.
 *
 * Instant instead of animated, in every case where a fade would cost more than
 * it says:
 * - the browser has no `startViewTransition` (Firefox today);
 * - the reader asked for reduced motion;
 * - the tab is hidden (nothing to look at, and Chrome skips it anyway);
 * - a transition is already running — a second click during the 200 ms fade
 *   jumps straight to where it was going rather than queueing another fade.
 *
 * The fade itself is CSS (`::view-transition-*` in index.css): 180 ms, opacity
 * only, and the top bar has its own `view-transition-name` so the chrome holds
 * still while the screen under it changes.
 */

type StartViewTransition = (cb: () => void) => { finished: Promise<void> };

let running = false;

export function withViewTransition(update: () => void, doc: Document | undefined = globalThis.document): void {
  const start = (doc as unknown as { startViewTransition?: StartViewTransition } | undefined)?.startViewTransition;
  const reduced =
    typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc || typeof start !== 'function' || reduced || doc.visibilityState === 'hidden' || running) {
    update();
    return;
  }
  running = true;
  try {
    const t = start.call(doc, update);
    t.finished.then(
      () => (running = false),
      () => (running = false),
    );
  } catch {
    running = false;
    update();
  }
}
