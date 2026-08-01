import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useAuthStore } from '../../state/authStore';
import { useBuilderStore } from '../../state/store';
import {
  buildHomeSections,
  buildSoloSections,
  buildVersusSections,
  exportFileName,
  paginate,
  summarize,
  type ExportRequest,
  type ExportSection,
} from '../../utils/deckExport';
import libStyles from '../Library/Library.module.css';
import styles from './ExportDialog.module.css';

/** Which page opened the dialog — decides what gets swept into the report. */
export type ExportSource = 'duels' | 'home';

interface ExportDialogProps {
  source: ExportSource;
  onClose: () => void;
}

function sectionCount(section: ExportSection): number {
  return section.entries.length;
}

export function ExportDialog({ source, onClose }: ExportDialogProps) {
  const authUser = useAuthStore((s) => s.user);
  const sets = useBuilderStore((s) => s.sets);
  const mode = useBuilderStore((s) => s.mode);
  const deckSlotCount = useBuilderStore((s) => s.deckSlotCount);
  const library = useBuilderStore((s) => s.library);

  const [handle, setHandle] = useState(`@${authUser ?? 'royal'}`);
  const [includeSaved, setIncludeSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const savedForMode = useMemo(
    () => library.filter((e) => e.mode === mode && (mode === 'solo' ? e.solo : e.blue && e.red)),
    [library, mode],
  );

  const isVersus = source === 'duels' && mode === 'versus';

  const sections = useMemo<ExportSection[]>(() => {
    const saved = includeSaved ? savedForMode : [];
    if (source === 'home') return buildHomeSections(sets.home.decks);
    if (mode === 'solo') return buildSoloSections(sets.solo, deckSlotCount.solo, saved);
    return buildVersusSections(sets.blue, sets.red, deckSlotCount.blue, deckSlotCount.red, saved);
  }, [source, mode, sets, deckSlotCount, savedForMode, includeSaved]);

  const stats = useMemo(() => summarize(sections), [sections]);
  const pageCount = useMemo(() => paginate(sections).length + 1, [sections]);
  const empty = sections.length === 0;

  const title = source === 'home' ? "Deck's Home" : 'Royal Duels';
  const subtitle =
    source === 'home'
      ? 'Deck Collection Report'
      : isVersus
        ? 'Versus Duel Report'
        : 'Solo Deck Report';
  const scope = source === 'home' ? 'decks-home' : isVersus ? 'versus' : 'solo';

  async function handleDownload() {
    if (empty || busy) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    const request: ExportRequest = {
      title,
      subtitle,
      handle: handle.trim() || `@${authUser ?? 'royal'}`,
      sections,
      fileName: exportFileName(scope),
    };
    try {
      // Loaded on demand so the PDF engine never ships in the main bundle.
      const { downloadDeckReport } = await import('../../utils/pdfRenderer');
      await downloadDeckReport(request, { onProgress: setProgress });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the PDF.');
      setBusy(false);
    }
  }

  return createPortal(
    <div className={libStyles.overlay} onClick={busy ? undefined : onClose}>
      <motion.div
        className={`${libStyles.dialog} ${styles.dialog}`}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      >
        <h2 className={libStyles.dialogTitle}>Export deck report</h2>
        <p className={libStyles.dialogHint}>
          {isVersus
            ? 'A printable PDF of your Blue vs Red duels — three matchups per page, each deck linked straight into Clash Royale.'
            : 'A printable PDF of your decks, each one linked straight into Clash Royale.'}
        </p>

        {empty ? (
          <p className={styles.emptyNote}>
            Nothing to export yet — place some cards first.
          </p>
        ) : (
          <>
            <ul className={styles.sectionList}>
              {sections.map((section, i) => (
                <li key={`${section.heading}-${i}`} className={styles.sectionRow}>
                  <span className={styles.sectionName}>{section.heading}</span>
                  <span className={styles.sectionCount}>
                    {sectionCount(section)} {section.kind === 'pairs' ? 'duels' : 'decks'}
                  </span>
                </li>
              ))}
            </ul>

            <div className={styles.statRow}>
              <span>
                <strong>{stats.decks}</strong> decks
              </span>
              <span>
                <strong>{stats.cards}</strong> cards
              </span>
              <span>
                <strong>{pageCount}</strong> pages
              </span>
              <span className={styles.statMuted}>A4 landscape</span>
            </div>
          </>
        )}

        {source === 'duels' && savedForMode.length > 0 && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={includeSaved}
              onChange={(e) => setIncludeSaved(e.target.checked)}
              disabled={busy}
            />
            <span>
              Include saved groups <em>({savedForMode.length})</em>
            </span>
          </label>
        )}

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Your handle — stamped on every page</span>
          <input
            className={libStyles.nameInput}
            value={handle}
            disabled={busy}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@yourhandle"
            spellCheck={false}
          />
        </label>

        {busy && (
          <div className={styles.progressWrap}>
            <div className={styles.progressTrack}>
              <div className={styles.progressBar} style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className={styles.progressText}>
              {progress < 0.85 ? 'Loading card art…' : 'Laying out pages…'}
            </span>
          </div>
        )}

        {error && <p className={styles.errorNote}>{error}</p>}

        <div className={libStyles.dialogActions}>
          <button type="button" className={libStyles.ghostButton} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={libStyles.primaryButton}
            onClick={handleDownload}
            disabled={empty || busy}
          >
            {busy ? 'Building…' : 'Download PDF'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
