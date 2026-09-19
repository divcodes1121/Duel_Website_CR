/**
 * After a page turn, bring the top of the list back into view — but only if
 * the reader has scrolled past it.
 *
 * The pager sits at the FOOT of a list, so the click that asks for page 2 is
 * made with the reader at the bottom of page 1. Swap the rows in place and
 * they are now at the bottom of page 2, having skipped every row they asked
 * for. Scrolling unconditionally is wrong the other way: on a short page whose
 * top is already visible it would yank the panel header out of view for
 * nothing.
 *
 * "Past it" is measured against the nearest ancestor that actually scrolls,
 * not the window — every route here owns its own scroll region (`body` is
 * `overflow: hidden`), and below 62rem that region is `.main` instead of the
 * screen's own `.page`. Asking the DOM which one it is keeps this correct on
 * both sides of that breakpoint.
 */
export function revealListTop(el: HTMLElement | null): void {
  if (!el) return;

  let region: HTMLElement | null = el.parentElement;
  while (region) {
    const { overflowY } = getComputedStyle(region);
    if (/(auto|scroll)/.test(overflowY) && region.scrollHeight > region.clientHeight) break;
    region = region.parentElement;
  }
  const visibleTop = region ? region.getBoundingClientRect().top : 0;
  if (el.getBoundingClientRect().top >= visibleTop) return;

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
}
