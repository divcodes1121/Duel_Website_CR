import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccountStore } from '../../state/accountStore';
import { useBuilderStore } from '../../state/store';
import {
  buildHomeSections,
  buildSoloSections,
  buildVersusSections,
  countEntries,
  exportFileName,
  limitSections,
  limitSetCount,
  sectionRows,
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

/** Rows a section prints — a three-duel set is six decks. */
function sectionCount(section: ExportSection): number {
  return sectionRows(section).length;
}

export function ExportDialog({ source, onClose }: ExportDialogProps) {
  /* The @handle printed on the report. It was the test gate's username, which
     is always null now — so the field defaulted to "@royal" for everyone and
     quietly stopped being the person's own name. */
  const handleName = useAccountStore(
    (st) => st.profile?.display_name ?? st.profile?.player_tag ?? st.email?.split('@')[0] ?? null,
  );
  const sets = useBuilderStore((s) => s.sets);
  const mode = useBuilderStore((s) => s.mode);
  const deckSlotCount = useBuilderStore((s) => s.deckSlotCount);
  const library = useBuilderStore((s) => s.library);

  const [handle, setHandle] = useState(`@${handleName ?? 'royal'}`);
  const [includeSaved, setIncludeSaved] = useState(true);
  const [exportAll, setExportAll] = useState(true);
  /** Kept as text so the field can be cleared mid-typing without snapping back. */
  const [limitText, setLimitText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const savedForMode = useMemo(
    () => library.filter((e) => e.mode === mode && (mode === 'solo' ? e.solo : e.blue && e.red)),
    [library, mode],
  );

  const isVersus = source === 'duels' && mode === 'versus';

  const allSections = useMemo<ExportSection[]>(() => {
    const saved = includeSaved ? savedForMode : [];
    if (source === 'home') return buildHomeSections(sets.home.decks);
    if (mode === 'solo') return buildSoloSections(sets.solo, deckSlotCount.solo, saved);
    return buildVersusSections(sets.blue, sets.red, deckSlotCount.blue, deckSlotCount.red, saved);
  }, [source, mode, sets, deckSlotCount, savedForMode, includeSaved]);

  // Royal Duels is picked in whole sets — one live set or saved group counts as
  // 1 however many decks it holds, and a set is never split. Deck's Home has no
  // sets to speak of, so there the unit stays a single deck.
  const bySet = source === 'duels';
  const available = bySet ? allSections.length : countEntries(allSections);
  const unit = bySet ? (isVersus ? 'duel sets' : 'deck sets') : 'decks';
  // An empty or out-of-range box falls back to everything, so the preview and
  // the download always agree with what the number actually means.
  const parsedLimit = Number.parseInt(limitText, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), Math.max(available, 1))
    : available;

  const sections = useMemo(() => {
    if (exportAll) return allSections;
    return bySet ? limitSetCount(allSections, limit) : limitSections(allSections, limit);
  }, [allSections, bySet, exportAll, limit]);

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
      handle: handle.trim() || `@${handleName ?? 'royal'}`,
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
      <div
        className={`${libStyles.dialog} ${styles.dialog}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={libStyles.dialogTitle}>Export deck report</h2>
        <p className={libStyles.dialogHint}>
          {isVersus
            ? 'A printable PDF of your Blue vs Red duel sets — every deck on its own row, linked straight into Clash Royale.'
            : 'A printable PDF of your decks — one set per page, each deck linked straight into Clash Royale.'}
        </p>

        {available === 0 ? (
          <p className={styles.emptyNote}>Nothing to export yet — place some cards first.</p>
        ) : (
          <ul className={styles.sectionList}>
            {sections.map((section, i) => (
              <li key={`${section.heading}-${i}`} className={styles.sectionRow}>
                <span className={styles.sectionName}>{section.heading}</span>
                <span className={styles.sectionCount}>{sectionCount(section)} decks</span>
              </li>
            ))}
          </ul>
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

        {available > 0 && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>
              How many {unit} — {available} available
            </span>
            <div className={styles.limitRow}>
              <button
                type="button"
                className={styles.limitChip}
                data-active={exportAll}
                disabled={busy}
                onClick={() => setExportAll(true)}
              >
                All {available}
              </button>
              <button
                type="button"
                className={styles.limitChip}
                data-active={!exportAll}
                disabled={busy}
                onClick={() => setExportAll(false)}
              >
                First
              </button>
              <input
                className={styles.limitInput}
                type="number"
                min={1}
                max={available}
                inputMode="numeric"
                value={exportAll ? '' : limitText}
                placeholder={String(available)}
                disabled={busy || exportAll}
                onChange={(e) => setLimitText(e.target.value)}
                // Typing a number is the intent — switch off "All" for them.
                onFocus={() => setExportAll(false)}
              />
              <span className={styles.limitSuffix}>of {available}</span>
            </div>
          </div>
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
      </div>
    </div>,
    document.body,
  );
}
