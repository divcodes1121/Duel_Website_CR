import { LayoutGroup, MotionConfig, motion } from 'framer-motion';
import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import styles from './tabs.module.css';

/**
 * THE ONE TAB STRIP. Eleven screens used to draw their own — underlined on
 * Deck Counter, a three-column grid on Duel Analysis, two-line cards on Duel
 * Zone, a white slab on the dashboards, a violet segmented control in the
 * builder — so "which of these is selected" was answered five different ways.
 * This is the builder's answer, because it is the one that already said it with
 * the selection hue: a sunken track and a `--solid-violet` slab that slides to
 * the tab you pick.
 *
 * - **The slab slides** (`layoutId`, scoped per instance with `useId`, so two
 *   strips on one screen never share a slab). One-shot tween, and
 *   `MotionConfig reducedMotion="user"` makes it a jump under reduced motion.
 * - **Keyboard**: arrows, Home and End move the selection and the focus
 *   together; only the selected tab is in the Tab order (roving tabindex), the
 *   pattern `DashTabs` already used.
 * - **On a narrow screen a strip that does not fit scrolls sideways** rather
 *   than wrapping into a stack of half-rows, the edge that has more to show
 *   fades, and picking a tab brings it fully into view. `stretch` strips (equal
 *   tabs across the full width) stack one tab a line instead once they are
 *   narrower than `stackBelow`, measured on the strip's own box, not the
 *   window, because the same strip sits in a narrow column on one screen and a
 *   full page on another.
 * - **Touch**: every tab is at least 40px tall on a coarse pointer.
 */

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  /** A small figure after the label — a count, or a dash for "not measured". */
  count?: ReactNode;
  countTitle?: string;
  /** A second line under the label. Use sparingly; most strips have none. */
  description?: ReactNode;
  title?: string;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Names the strip for a screen reader. */
  label: string;
  size?: 'sm' | 'md';
  /** Equal tabs across the full width. */
  stretch?: boolean;
  /** A stretched strip stacks one tab a line below this width (px). */
  stackBelow?: number;
  className?: string;
  /** Stable ids for the tabs (`<idBase>-tab-<id>`); a generated one otherwise. */
  idBase?: string;
  /** The id of the panel these tabs control, when there is exactly one. */
  panelId?: string;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  size = 'md',
  stretch = false,
  stackBelow = 440,
  className,
  idBase,
  panelId,
}: TabsProps<T>) {
  const own = useId();
  const base = idBase ?? own.replace(/:/g, '');
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const [stacked, setStacked] = useState(false);

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const start = max > 1 && el.scrollLeft > 1;
    const end = max > 1 && el.scrollLeft < max - 1;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
    if (stretch) {
      const next = el.clientWidth < stackBelow;
      setStacked((s) => (s === next ? s : next));
    }
  }, [stretch, stackBelow]);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [measure, items.length]);

  // Bring the picked tab fully into view when the strip scrolls. Scrolls the
  // TRACK only — `scrollIntoView` would also move the page.
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const btn = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!btn) return;
    const pad = 16;
    const left = btn.offsetLeft - pad;
    const right = btn.offsetLeft + btn.offsetWidth + pad;
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
    measure();
  }, [value, measure]);

  const enabled = items.filter((t) => !t.disabled);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = stacked ? ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'] : ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key) || enabled.length === 0) return;
    e.preventDefault();
    const i = Math.max(0, enabled.findIndex((t) => t.id === value));
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? enabled.length - 1 : (i + (back ? -1 : 1) + enabled.length) % enabled.length;
    const id = enabled[next].id;
    onChange(id);
    e.currentTarget.querySelector<HTMLButtonElement>(`#${CSS.escape(`${base}-tab-${id}`)}`)?.focus();
  };

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id={base}>
        <div
          ref={trackRef}
          className={[styles.track, className].filter(Boolean).join(' ')}
          role="tablist"
          aria-label={label}
          aria-orientation={stacked ? 'vertical' : 'horizontal'}
          data-size={size}
          data-stretch={stretch || undefined}
          data-stacked={stacked || undefined}
          data-fade-start={edges.start || undefined}
          data-fade-end={edges.end || undefined}
          onKeyDown={onKey}
          onScroll={measure}
        >
          {items.map((t) => {
            const on = t.id === value;
            return (
              <button
                key={t.id}
                id={`${base}-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={panelId}
                tabIndex={on ? 0 : -1}
                disabled={t.disabled}
                title={t.title}
                className={styles.tab}
                data-described={t.description ? '' : undefined}
                onClick={() => onChange(t.id)}
              >
                {on && (
                  <motion.span
                    layoutId="slab"
                    className={styles.slab}
                    transition={{ type: 'tween', duration: 0.28, ease: [0.22, 0.68, 0.32, 1] }}
                    aria-hidden="true"
                  />
                )}
                {t.icon && (
                  <span className={styles.icon} aria-hidden="true">
                    {t.icon}
                  </span>
                )}
                <span className={styles.text}>
                  <span className={styles.label}>
                    {t.label}
                    {t.count !== undefined && t.count !== null && (
                      <span className={styles.count} title={t.countTitle}>
                        {t.count}
                      </span>
                    )}
                  </span>
                  {t.description && <span className={styles.description}>{t.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}
