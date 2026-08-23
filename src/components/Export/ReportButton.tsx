import { useState } from 'react';
import { downloadAnalyticsReport } from '../../utils/analyticsPdf';
import type { ReportDoc } from '../../utils/analyticsReport';
import styles from './ReportButton.module.css';

/* "Export PDF" for an analytics screen.
 *
 * The screen passes a THUNK rather than a built document, for two reasons. It
 * keeps the adapter off the render path — nobody who never exports pays to
 * build a report model on every re-render — and it guarantees the export
 * describes the data as it is at the moment of the click, including whatever
 * window, sort and filters are live. That is what makes the export "reactive"
 * rather than a snapshot of whatever the screen looked like when it mounted.
 *
 * `jspdf` is only reached inside `downloadAnalyticsReport`, which imports it
 * dynamically — 390 kB that must never land in the initial bundle.
 */

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 3v10.2l3.6-3.6L17 11l-5 5-5-5 1.4-1.4L12 13.2V3zM5 19h14v2H5z" />
    </svg>
  );
}

export function ReportButton({
  build,
  label = 'Export PDF',
  disabled,
}: {
  build: () => ReportDoc;
  label?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await downloadAnalyticsReport(build());
    } catch (e) {
      setError('Export failed');
      // The message matters for diagnosis and does not belong in the UI.
      console.error('[report] export failed', e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={run}
        disabled={busy || disabled}
        title="Download this screen as a PDF report"
      >
        <DownloadIcon />
        {busy ? 'Building…' : label}
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </>
  );
}
