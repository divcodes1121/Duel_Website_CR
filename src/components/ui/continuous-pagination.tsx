import { useEffect, useId, useRef, useState, type CSSProperties, type FC, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from 'framer-motion';

import { pageWindow } from '../../utils/pageWindow';
import { cn } from './cn';
import './continuous-pagination.css';

/**
 * VENDORED from watermelon.sh — `ContinuousPagination`.
 * https://registry.watermelon.sh/r/continuous-pagination.json
 *
 * A row of square page buttons with a sliding active slab (one shared
 * `layoutId`, so the slab travels to the page you picked instead of jumping),
 * a spring lift on hover and a squash on press. The markup, the springs and the
 * slab's layering — gradient body, top highlight, bottom inset shade, a sheen
 * across it — are the upstream component.
 *
 * NOT INSTALLED WITH `npx shadcn add`. This project has no `components.json`
 * and no Tailwind, and the CLI would pull in three packages for one pager. The
 * source was ported by hand, the way `glass-dock` and `electric-border` were.
 *
 * ── EIGHT DEVIATIONS, ALL DELIBERATE ──────────────────────────────────────
 *
 * 1. **`framer-motion`, NOT `motion/react`.** Same library, same API (`motion`
 *    is framer-motion's new name). It is already a dependency and already in
 *    the main chunk; a second copy under the new name would be ~40 kB for an
 *    identical import.
 *
 * 2. **THE CHEVRONS ARE INLINE SVG, NOT `lucide-react`.** Two icons are not
 *    worth a dependency, and every other icon in this app is inline SVG.
 *
 * 3. **NO `next-themes`.** Upstream uses it for one thing: a darker hover
 *    shadow on dark. That is a CSS rule keyed off `[data-theme]` now, which is
 *    how this app themes everything, and it removes a JS theme branch that
 *    would otherwise have to agree with the stylesheet.
 *
 * 4. **CONTROLLED.** Upstream keeps the active page in its own state and tells
 *    nobody, which cannot drive a list the server pages — and the server here
 *    CLAMPS a page past the end, so the page shown has to come from outside.
 *    `page` + `onPageChange` make it controlled; `defaultPage` alone still
 *    gives the upstream uncontrolled behaviour.
 *
 * 5. **A WINDOW, NOT EVERY PAGE.** Upstream draws one button per page. The 2v2
 *    board has tens of thousands. `utils/pageWindow.ts` picks first, last and
 *    the pages around the current one, in a FIXED number of slots — so the
 *    control is the same width on every page and the arrows never move out
 *    from under the pointer. The page buttons carry `layout="position"`, so
 *    when the window shifts the numbers slide rather than swap in place.
 *
 * 6. **IT SIZES ITSELF TO ITS CONTAINER.** Upstream is 40px below the `sm`
 *    breakpoint and 64px above. A viewport breakpoint does not describe a
 *    footer that is half the viewport, so the cells are sized from the
 *    component's own width (a container query) between 2rem and upstream's
 *    4rem, and a narrow container drops the neighbouring pages first. Long
 *    page numbers shrink their type down to a 0.7rem floor, and past that the
 *    square widens instead — type smaller than that is a number nobody reads.
 *
 * 7. **THE SHEEN RUNS ONCE.** Upstream sweeps the active slab forever
 *    (`repeat: Infinity`). This project bans infinite animation outright; the
 *    sheen now crosses once, when a page becomes active. Under
 *    `prefers-reduced-motion` there is no sheen and `MotionConfig` switches the
 *    lifts, squashes and slide off.
 *
 * 8. **THE ACTIVE SLAB IS VIOLET, AND EVERY COLOUR IS A TOKEN.** Upstream's
 *    slab is near-black with white type. Here every neutral figure is already
 *    full-contrast white on dark, so a black slab with white type would differ
 *    from its neighbours only by being darker — it reads as a hole. Selection
 *    is violet everywhere in this app, so the slab keeps its authored layering
 *    and is cut from `--solid-violet`, the step graded to carry white type.
 *    Plus what upstream lacks: `<nav>`, `aria-current`, labelled arrows, and
 *    arrows that disable at the ends instead of silently doing nothing.
 */

/* --- Types --- */

export interface ContinuousPaginationProps {
  totalPages?: number;
  /** Uncontrolled starting page, as upstream. Ignored when `page` is set. */
  defaultPage?: number;
  /** Controlled current page. */
  page?: number;
  onPageChange?: (page: number) => void;
  /** Pages drawn either side of the current one when there is room. */
  siblingCount?: number;
  /** Disables every button, e.g. while nothing can be fetched. */
  disabled?: boolean;
  /** The `<nav>`'s accessible name. */
  label?: string;
  className?: string;
}

/* The width the full window needs before the neighbours are dropped: nine
   cells (arrows + seven slots) at a comfortable 2.5rem, with 6px gaps. */
const ROOMY_PX = 9 * 40 + 8 * 6;

const Chevron: FC<{ dir: 'left' | 'right' }> = ({ dir }) => (
  <svg className="cp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6'} />
  </svg>
);

/* --- Sub-Components --- */

interface PageButtonProps {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}

const PageButton: FC<PageButtonProps> = ({ children, onClick, disabled, label }) => (
  <motion.button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    className="cp-cell cp-step"
    whileHover={disabled ? undefined : { scale: 1.08, y: -6 }}
    whileTap={disabled ? undefined : { scale: 0.92 }}
    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
  >
    {children}
  </motion.button>
);

/* --- Main Component --- */

export const ContinuousPagination: FC<ContinuousPaginationProps> = ({
  totalPages = 5,
  defaultPage = 1,
  page,
  onPageChange,
  siblingCount = 1,
  disabled = false,
  label = 'Pagination',
  className,
}) => {
  const [own, setOwn] = useState<number>(defaultPage);
  const total = Math.max(1, Math.floor(totalPages));
  const active = Math.min(Math.max(1, page ?? own), total);
  const reduce = useReducedMotion();
  /* One slab per pager. Upstream's literal `layoutId="active-bg"` is global,
     so two pagers on one screen would fling the slab between each other. */
  const group = useId();

  /* The container decides how many neighbours fit, not the viewport. */
  const rootRef = useRef<HTMLElement>(null);
  const [roomy, setRoomy] = useState(true);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setRoomy(entry.contentRect.width >= ROOMY_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const items = pageWindow(active, total, roomy ? siblingCount : 0);
  /* The longest label on the row, which sizes the type for all of them so a
     row of numbers reads as one size. No grouping separator in the square —
     "59337", as page numbers are usually written; the accessible name keeps
     "59,337". The comma was a sixth character in a square sized for five. */
  const chars = Math.max(1, ...items.map((i) => (typeof i === 'number' ? String(i).length : 1)));

  const paginate = (next: number) => {
    if (disabled || next < 1 || next > total || next === active) return;
    if (page === undefined) setOwn(next);
    onPageChange?.(next);
  };

  return (
    <MotionConfig reducedMotion="user">
      <nav ref={rootRef} className={cn('continuous-pagination', className)} aria-label={label}>
        <div
          className="cp-row"
          style={{ '--cp-cells': items.length + 2, '--cp-chars': chars } as CSSProperties}
        >
          {/* Prev */}
          <PageButton onClick={() => paginate(active - 1)} disabled={disabled || active <= 1} label="Previous page">
            <Chevron dir="left" />
          </PageButton>

          {/* Pages */}
          <LayoutGroup id={group}>
            <div className="cp-pages">
              {items.map((item) => {
                if (typeof item !== 'number') {
                  return (
                    <span key={item} className="cp-cell cp-gap" aria-hidden="true">
                      …
                    </span>
                  );
                }
                const isActive = item === active;
                return (
                  <motion.button
                    key={item}
                    type="button"
                    layout={reduce ? false : 'position'}
                    onClick={() => paginate(item)}
                    disabled={disabled}
                    aria-label={`Page ${item.toLocaleString()}`}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn('cp-cell cp-num', isActive && 'cp-active')}
                    whileHover={!isActive && !disabled ? { y: -6 } : undefined}
                    whileTap={disabled ? undefined : { scale: 0.92 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                  >
                    {/* Active background */}
                    <AnimatePresence>
                      {isActive && (
                        <motion.span
                          layoutId="active-bg"
                          className="cp-slab"
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.9, opacity: 0 }}
                          transition={{ type: 'spring', stiffness: 220, damping: 24, mass: 0.8 }}
                        >
                          <span className="cp-slab-body" />
                          {!reduce && (
                            <motion.span
                              className="cp-sheen"
                              /* skewX here, not in CSS: framer writes the
                                 whole `transform`, so a CSS skew is lost. */
                              initial={{ x: '-100%', skewX: 12 }}
                              animate={{ x: '200%', skewX: 12 }}
                              transition={{ duration: 1.1, delay: 0.2, ease: 'easeInOut' }}
                            />
                          )}
                          <span className="cp-slab-shade" />
                        </motion.span>
                      )}
                    </AnimatePresence>

                    <span className="cp-label">{item}</span>
                  </motion.button>
                );
              })}
            </div>
          </LayoutGroup>

          {/* Next */}
          <PageButton onClick={() => paginate(active + 1)} disabled={disabled || active >= total} label="Next page">
            <Chevron dir="right" />
          </PageButton>
        </div>
      </nav>
    </MotionConfig>
  );
};
