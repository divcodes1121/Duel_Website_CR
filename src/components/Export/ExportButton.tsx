import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadAnalyticsReport } from '../../utils/analyticsPdf';
import type { ReportDoc } from '../../utils/analyticsReport';
import { useReportRegistration, type ReportBuild } from '../../state/reportExport';
import type { DateWindow } from '../../state/analyticsClient';
import { beginExport, endExport, isStaleChunkError, reloadPage } from '../../state/staleBuild';
import styles from './ExportButton.module.css';

/* THE EXPORT BUTTON — the only one on the site.
 *
 * It replaces two: the shell's "Export PDF", which printed the live page
 * through the browser (Chrome rasterises every glass panel into a soft-masked
 * bitmap to do that — measured 2.5-8.6 MB and ~430 ms a page to paint), and
 * the per-screen jsPDF button, which drew a proper report but only on some
 * screens. Every export now goes through `report/`, the engine that draws a
 * vector document with opaque, deduplicated art.
 *
 * The build is a THUNK, called at the moment of the click, so the document
 * describes the data as it stands then — window, filters and all — and nobody
 * who never exports pays to build a report model on every render. It may be
 * async, which lets a screen import a large adapter only when pressed.
 *
 * `full` adds a menu: "This page" or the full player report, which reads every
 * section the account may open and binds them into one document. */

export interface FullReport {
  label: string;
  hint: string;
  build: (step: (text: string) => void) => Promise<ReportDoc>;
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function Caret() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ExportButton({
  build,
  full,
  label = 'Export PDF',
  disabled,
}: {
  build?: ReportBuild | null;
  full?: FullReport | null;
  label?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* The page is older than the latest deploy: the export's own files are
     gone from the server, and only a reload can fetch the new ones. */
  const [stale, setStale] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const menuId = useId();

  const run = useCallback(async (make: (step: (t: string) => void) => ReportDoc | Promise<ReportDoc>) => {
    setOpen(false);
    setBusy('Building PDF…');
    setDone(null);
    setError(null);
    setStale(false);
    beginExport();
    try {
      const model = await make((t) => setBusy(t));
      setBusy('Drawing pages…');
      const result = await downloadAnalyticsReport(model);
      setDone(`Saved · ${result.pages} page${result.pages === 1 ? '' : 's'}`);
    } catch (e) {
      console.error('[report] export failed', e);
      if (isStaleChunkError(e)) {
        setStale(true);
      } else {
        // The full message goes in the tooltip, for a reader reporting it;
        // the label stays short.
        setError(`Export failed${(e as Error)?.message ? `: ${String((e as Error).message).slice(0, 160)}` : ''}`);
      }
    } finally {
      endExport();
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (!done) return undefined;
    const t = window.setTimeout(() => setDone(null), 3200);
    return () => window.clearTimeout(t);
  }, [done]);

  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (wrap.current?.contains(t) || menu.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        wrap.current?.querySelector('button')?.focus();
      }
    };
    const shut = () => setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', shut);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', shut);
    };
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open, pos]);

  const canPage = Boolean(build) && !disabled;
  const canFull = Boolean(full);
  const nothing = !canPage && !canFull;
  const text = busy ?? done ?? label;

  const onMain = () => {
    if (full) setOpen((v) => !v);
    else if (build) void run(() => build());
  };

  return (
    <span className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={styles.button}
        data-state={busy ? 'busy' : done ? 'done' : undefined}
        onClick={onMain}
        disabled={Boolean(busy) || nothing}
        aria-haspopup={full ? 'menu' : undefined}
        aria-expanded={full ? open : undefined}
        aria-controls={full && open ? menuId : undefined}
        title={full ? 'Download a PDF report' : 'Download this screen as a PDF report — every tab included'}
      >
        {busy ? <span className={styles.spinner} aria-hidden="true" /> : <DownloadIcon />}
        <span className={styles.label} aria-live="polite">{text}</span>
        {full && !busy && <Caret />}
      </button>
      {error && <span className={styles.error} role="alert" title={error}>Export failed</span>}
      {stale && (
        <span className={styles.stale} role="alert">
          Deckkies was updated since this page opened.
          <button type="button" className={styles.reload} onClick={reloadPage}>
            Reload to export
          </button>
        </span>
      )}
      {open && pos && createPortal(
        <div
          ref={menu}
          id={menuId}
          role="menu"
          className={styles.menu}
          style={{ top: pos.top, right: pos.right }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
            const i = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
            next?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            disabled={!canPage}
            onClick={() => build && void run(() => build())}
          >
            <span className={styles.itemTitle}>This page</span>
            <span className={styles.itemHint}>
              {canPage ? 'Everything on this screen, every tab included' : 'Waiting for this screen to load'}
            </span>
          </button>
          {full && (
            <button type="button" role="menuitem" className={styles.item} onClick={() => void run(full.build)}>
              <span className={styles.itemTitle}>{full.label}</span>
              <span className={styles.itemHint}>{full.hint}</span>
            </button>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}

/**
 * A screen's export, in one line. Inside the player shell the export is
 * handed to the shell's button and this returns null; anywhere else it
 * returns the button for the screen's own header.
 */
export function useScreenExport(opts: {
  id: string;
  build: ReportBuild;
  ready: boolean;
  win?: DateWindow;
}) {
  const { host, build } = useReportRegistration(opts);
  if (host) return null;
  return <ExportButton build={build} disabled={!opts.ready} />;
}
