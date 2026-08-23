import { useCallback, useEffect, useState } from 'react';

/* Reveal a section once, when it first scrolls into view.
 *
 * An IntersectionObserver rather than a scroll listener: the browser does the
 * work off the main thread and there is no per-frame callback to throttle. No
 * animation library — the whole job is toggling one attribute and letting CSS
 * own the motion, which keeps the timing in the stylesheet with every other
 * duration.
 *
 * GROUPED, not per element. The returned ref goes on a SECTION and the CSS
 * staggers its children with `nth-child`, because a page where every card fades
 * in on its own schedule is the "chaotic" failure — related content should
 * arrive together. Callers pass one ref per band of the page, not one per card.
 *
 * A CALLBACK REF OVER A STATE NODE, not `useRef` + `useEffect([])`. The bands
 * live inside the home view, which unmounts whenever a tool is opened and
 * mounts again on the way back; an effect with an empty dependency list runs
 * once per DASHBOARD mount, so on the second visit it had already fired and the
 * fresh element never got its attribute at all. Keying the effect to the node
 * means "whenever an element attaches, observe that one".
 *
 * `unobserve` on first intersection: revealing is a one-way trip, so nothing
 * re-animates when you scroll back up.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((n: T | null) => setNode(n), []);

  useEffect(() => {
    if (!node) return;

    // No observer support, or the reader asked for less motion: show it and
    // skip the animation. The content is never gated on the effect.
    const still =
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      node.dataset.reveal = 'in';
      return;
    }

    node.dataset.reveal = 'out';
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.reveal = 'in';
          io.unobserve(e.target);
        }
      },
      // A little before the edge, so a section is already settling by the time
      // it is properly on screen rather than starting the moment it appears.
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [node]);

  return ref;
}
