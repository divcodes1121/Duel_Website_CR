import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useBuilderStore } from '../../state/store';
import { getTotalCardsUsed } from '../../state/deckUtils';
import type { SavedDeckSet } from '../../types/deck';
import styles from './Library.module.css';

interface LibraryModalProps {
  onClose: () => void;
}

function entryCardCount(entry: SavedDeckSet): number {
  if (entry.mode === 'solo') return entry.solo ? getTotalCardsUsed(entry.solo) : 0;
  return (
    (entry.blue ? getTotalCardsUsed(entry.blue) : 0) +
    (entry.red ? getTotalCardsUsed(entry.red) : 0)
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LibraryModal({ onClose }: LibraryModalProps) {
  const library = useBuilderStore((s) => s.library);
  const sets = useBuilderStore((s) => s.sets);
  const loadSaved = useBuilderStore((s) => s.loadSaved);
  const renameSaved = useBuilderStore((s) => s.renameSaved);
  const deleteSaved = useBuilderStore((s) => s.deleteSaved);
  const resetAll = useBuilderStore((s) => s.resetAll);
  const mode = useBuilderStore((s) => s.mode);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function handleLoad(entry: SavedDeckSet) {
    const targetHasCards =
      entry.mode === 'solo'
        ? getTotalCardsUsed(sets.solo) > 0
        : getTotalCardsUsed(sets.blue) > 0 || getTotalCardsUsed(sets.red) > 0;
    if (targetHasCards && !window.confirm(`Load "${entry.name}" and replace your current decks?`)) {
      return;
    }
    loadSaved(entry.id);
    onClose();
  }

  function handleNewBlank() {
    const currentHasCards =
      mode === 'solo'
        ? getTotalCardsUsed(sets.solo) > 0
        : getTotalCardsUsed(sets.blue) > 0 || getTotalCardsUsed(sets.red) > 0;
    if (currentHasCards && !window.confirm('Start a new blank set? Your current decks will be cleared (save them first if needed).')) {
      return;
    }
    resetAll();
    onClose();
  }

  function commitRename(id: string) {
    renameSaved(id, draftName);
    setRenamingId(null);
  }

  // Portal to <body>: escapes the header's backdrop-filter stacking context.
  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <motion.div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.dialogTitle}>My Decks</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {library.length === 0 ? (
          <p className={styles.empty}>No saved decks yet — build something and hit Save.</p>
        ) : (
          <ul className={styles.list}>
            {library.map((entry) => (
              <motion.li
                key={entry.id}
                className={styles.row}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              >
                <div className={styles.rowInfo}>
                  {renamingId === entry.id ? (
                    <input
                      className={styles.nameInput}
                      value={draftName}
                      autoFocus
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => commitRename(entry.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(entry.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <span className={styles.rowName}>{entry.name}</span>
                  )}
                  <span className={styles.rowMeta}>
                    <span className={styles.modeChip} data-mode={entry.mode}>
                      {entry.mode === 'solo' ? 'Solo' : 'Blue vs Red'}
                    </span>
                    {entryCardCount(entry)} cards · {formatDate(entry.savedAt)}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => handleLoad(entry)}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => {
                      setDraftName(entry.name);
                      setRenamingId(entry.id);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className={`${styles.ghostButton} ${styles.dangerButton}`}
                    onClick={() => {
                      if (window.confirm(`Delete "${entry.name}"?`)) deleteSaved(entry.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </motion.li>
            ))}
          </ul>
        )}

        <div className={styles.modalFooter}>
          <button type="button" className={styles.ghostButton} onClick={handleNewBlank}>
            + New blank set
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
