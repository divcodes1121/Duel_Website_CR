import { useCallback, useState } from 'react';
import { usePrintMode } from '../../state/printMode';
import styles from './PrintButton.module.css';

/* Export PDF — the page exactly as it appears, top to bottom, header included.
 *
 * This hands the page to the browser's own print engine rather than
 * rasterising the DOM. That is a deliberate choice: the app draws 43
 * `backdrop-filter` panels and 97 `color-mix()` values, and a canvas
 * screenshotter renders the first flat and the second wrong. The print engine
 * composites the real page, so the PDF matches the screen.
 *
 * The cost is one extra click — the browser's dialog, where the destination is
 * "Save as PDF". There is no way to skip that dialog from a web page without
 * giving up the fidelity, which is the whole point of the feature.
 *
 * `print.css` does the real work of unclipping the app's inner scroll
 * containers so the whole page prints rather than the visible slice.
 */

const ICON = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
       strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9V3h12v6" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
    <path d="M6 14h12v7H6z" />
  </svg>
);

export function PrintButton({ label = 'Export PDF' }: { label?: string }) {
  const [busy, setBusy] = useState(false);

  const setPrinting = usePrintMode((s) => s.setPrinting);

  const run = useCallback(() => {
    setBusy(true);
    // Ask every tabbed screen to draw ALL of its tabs, not just the open one.
    // A PDF cannot be clicked, so a tab bar in one is a dead control; the
    // export should carry what the tabs would have shown.
    setPrinting(true);

    // Two frames before printing. The first lets React commit `printing` and
    // mount the extra panels, the second lets the browser lay them out and
    // apply the print stylesheet. Without the wait Chrome snapshots the page
    // mid-reflow and clips it at the old height — the exact bug this feature
    // exists to avoid.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          window.print();
        } finally {
          setPrinting(false);
          setBusy(false);
        }
      });
    });
  }, [setPrinting]);

  return (
    <button
      type="button"
      className={styles.button}
      onClick={run}
      disabled={busy}
      /* The button itself must not appear in its own output. */
      data-noprint
      title="Save this page as a PDF, exactly as it looks"
    >
      {ICON}
      {busy ? 'Preparing…' : label}
    </button>
  );
}
