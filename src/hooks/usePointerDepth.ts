import { useEffect, type RefObject } from 'react';

/**
 * Writes where the pointer is over `ref` as `--px` / `--py` (-1..1, 0 at the
 * centre) so CSS can shift layers by different amounts and a flat picture
 * reads as a scene with depth. The landing hero uses it: the painted castles
 * move a few pixels one way, the king twice as far the other.
 *
 * - **A mouse or trackpad only** (`hover: hover` and `pointer: fine`). A phone
 *   has no pointer resting over the page to follow, and tilting a scene on a
 *   finger drag would fight the scroll.
 * - **Off under reduced motion**, and the properties stay unset, so every
 *   layer sits at rest.
 * - **One write a frame at most** (requestAnimationFrame), and nothing
 *   re-renders: the values go straight onto the element's style.
 * - Back to 0 when the pointer leaves, and CSS eases the return.
 */
export function usePointerDepth(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof window.matchMedia !== 'function') return;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!fine.matches || reduced.matches) return;

    let frame = 0;
    let x = 0;
    let y = 0;
    const write = () => {
      frame = 0;
      el.style.setProperty('--px', x.toFixed(3));
      el.style.setProperty('--py', y.toFixed(3));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(write);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      schedule();
    };
    const onLeave = () => {
      x = 0;
      y = 0;
      schedule();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
      el.style.removeProperty('--px');
      el.style.removeProperty('--py');
    };
  }, [ref, enabled]);
}
