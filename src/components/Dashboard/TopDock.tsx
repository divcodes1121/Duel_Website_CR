/**
 * The top navigation, as a dock.
 *
 * Adapted from ThreeUI's `AnimatedTopDock`: a glass pill whose items expand
 * DOWNWARD on a spring as the pointer nears them, and which answers keyboard
 * focus with the same field. The physics live in `topDockController.ts`; this
 * file is the markup, and the reason the two are split is that the controller
 * is plain DOM — it measures and writes boxes every frame, which is not
 * something React should be re-rendering its way through.
 *
 * ── WHAT CHANGED FROM THE REFERENCE ──────────────────────────────────────
 *
 * **Every colour comes from `index.css`.** The reference hardcodes its palette
 * (`#292929`, `rgba(14,14,14,.86)`, `#e8e8e3`); nothing in this project defines
 * a colour of its own, so the dock is built from `--glass-fill`, `--border`,
 * `--text-muted` and the selection tokens, and it therefore works in both
 * themes with no `[data-theme]` branch of its own.
 *
 * **The active item keeps this app's language, not the reference's.** The
 * reference inverts the current item into a white pill. Here selection is
 * violet — `--accent-select` — and the underline rule that already marked the
 * open section is kept, because `Dashboard.module.css` explains at length why
 * the label stays ink and the RULE carries the meaning. The dock adds a wash
 * behind it so it still reads as a unit inside a glass bar; it does not
 * re-invent the indicator.
 *
 * **The logo is not a dock item.** In the reference the wordmark is the first
 * item in the field. DECKKIES sits outside the nav in its own topbar cell, and
 * pulling it in would have restructured the bar's three-column layout to buy a
 * mark that grows.
 */
import { useEffect, useRef, type ComponentType } from 'react';
import { TOP_DOCK_DEFAULTS, createTopDockController } from './topDockController';
import styles from './TopDock.module.css';

export interface TopDockItem {
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** Whether this is the open top-level destination. */
  active: boolean;
  onSelect: () => void;
}

interface TopDockProps {
  items: TopDockItem[];
}

export function TopDock({ items }: TopDockProps) {
  const rootRef = useRef<HTMLElement>(null);

  /* The controller is built ONCE and never rebuilt when `items` changes.
   *
   * It re-queries `[data-dock-item]` on every measure, and its ResizeObserver
   * fires when the row's box changes — so a label changing or an item's active
   * state flipping is picked up without tearing down the springs. Rebuilding on
   * `items` would reset every item's velocity to zero mid-motion each time the
   * route changed, which is exactly when the pointer is most likely to be on
   * the dock. Same reasoning as the hue ref in `three/Fireflies.tsx`. */
  useEffect(() => createTopDockController(rootRef.current!, () => TOP_DOCK_DEFAULTS), []);

  return (
    <nav
      ref={rootRef}
      className={styles.dock}
      aria-label="Primary"
      data-dock-state="idle"
      data-dock-max="0.00"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            type="button"
            data-dock-item
            className={`${styles.item} ${item.active ? styles.itemActive : ''}`}
            /* `aria-current` rather than `aria-pressed`: these are destinations,
               and the reference's toggle semantics would announce six buttons
               as pressed/unpressed switches. The label is carried in the DOM as
               well as here, so the icon-only narrow layout stays readable to a
               screen reader. */
            aria-current={item.active ? 'page' : undefined}
            aria-label={item.label}
            onClick={item.onSelect}
          >
            <span className={styles.icon} aria-hidden="true">
              <Icon size={16} />
            </span>
            <span className={styles.label}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
