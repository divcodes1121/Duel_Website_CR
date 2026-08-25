import { useEffect, useRef, useState } from 'react';

/**
 * The floor, in milliseconds.
 *
 * `UplinkLoader` already paces its BAR so a quick read does not blink once at
 * the ceiling, but pacing the bar does nothing if the bar is on screen for
 * 300 ms. This is the other half: the loading state itself stays up for at
 * least this long.
 *
 * ONE CONSTANT, IMPORTED BY BOTH. `UplinkLoader` paces its ramp to this same
 * number, so the bar arrives at the top of its travel just as the hold expires.
 * If the two were declared separately they would drift, and a bar that leaves
 * at 70% or one that sits full for a second both look like a mistake.
 */
export const MIN_LOADING_MS = 3_000;

/**
 * Hold a loading condition true for a minimum time.
 *
 * ── THIS DELAYS REAL DATA, ON PURPOSE ────────────────────────────────────
 *
 * That is worth stating plainly, because it is the one thing here with a cost.
 * When a read comes back in 400 ms this keeps the panel behind the loader for
 * the remaining ~3.6 s. The reason is that a loading state which flashes and
 * vanishes reads as a glitch rather than as a stage — the eye registers that
 * *something* happened and cannot tell what, which is worse than either showing
 * it properly or not showing it at all.
 *
 * The analytics reads this fronts are 10-160 s against a 22 GB SQLite on a
 * spinning volume, so the floor almost never binds in practice; it binds on a
 * warm cache, which is exactly the case that looked broken.
 *
 * ── PASS THE WHOLE CONDITION, NOT JUST A FLAG ────────────────────────────
 *
 * Give this the exact expression that means "show the loader" — `loading` on
 * most screens, but `loading && !board` on the meta board, which refreshes in
 * the background and must not blank a populated screen to do it. The hook holds
 * THAT, so when the condition goes false because the data landed, the loader
 * still finishes its minimum. Holding a bare `loading` flag would not have
 * worked there: `!board` flips at the same instant and the guard would fall
 * through regardless of what the flag said.
 *
 * Call it unconditionally at the top of a component, above any early return —
 * it is a hook, and the twelve callers all return early further down.
 */
export function useHeldLoading(active: boolean, minMs: number = MIN_LOADING_MS): boolean {
  const [held, setHeld] = useState(active);
  /* When the current spell of loading began. Zero means "not loading", which is
     also what stops a screen that never loaded at all from being held. */
  const startedAt = useRef(active ? performance.now() : 0);

  useEffect(() => {
    if (active) {
      if (!startedAt.current) startedAt.current = performance.now();
      setHeld(true);
      return;
    }

    if (!startedAt.current) {
      setHeld(false);
      return;
    }

    const remaining = minMs - (performance.now() - startedAt.current);
    if (remaining <= 0) {
      startedAt.current = 0;
      setHeld(false);
      return;
    }

    const timer = window.setTimeout(() => {
      startedAt.current = 0;
      setHeld(false);
    }, remaining);
    /* Cleared on unmount and on a re-entry into loading, so navigating away
       mid-hold does not leave a timer to fire into a dead component. */
    return () => window.clearTimeout(timer);
  }, [active, minMs]);

  return held;
}
