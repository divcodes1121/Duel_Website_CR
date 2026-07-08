import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useBuilderStore } from '../../state/store';
import styles from './Library.module.css';

interface SaveDialogProps {
  onClose: () => void;
  onSaved: () => void;
}

export function SaveDialog({ onClose, onSaved }: SaveDialogProps) {
  const mode = useBuilderStore((s) => s.mode);
  const library = useBuilderStore((s) => s.library);
  const activeSavedId = useBuilderStore((s) => s.activeSavedId);
  const saveCurrent = useBuilderStore((s) => s.saveCurrent);
  const updateSaved = useBuilderStore((s) => s.updateSaved);

  // The loaded set we could update in place — only if it still exists and
  // belongs to the current tab's mode.
  const activeEntry =
    library.find((e) => e.id === activeSavedId && e.mode === mode) ?? null;

  // When updating an existing set is on the table, start in "choose" mode; the
  // name field only appears once the user opts to save a fresh copy.
  const [savingAsNew, setSavingAsNew] = useState(!activeEntry);
  const [name, setName] = useState(
    activeEntry ? `${activeEntry.name} (copy)` : `Saved Duel Deck ${library.length + 1}`,
  );

  function handleUpdate() {
    updateSaved();
    onSaved();
    onClose();
  }

  function handleSaveNew() {
    saveCurrent(name);
    onSaved();
    onClose();
  }

  // Portal to <body>: the header's backdrop-filter creates a stacking context
  // that would otherwise trap the overlay beneath the builder content.
  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <motion.div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      >
        {activeEntry && !savingAsNew ? (
          <>
            <h2 className={styles.dialogTitle}>Save changes</h2>
            <p className={styles.dialogHint}>
              You loaded <strong>“{activeEntry.name}”</strong>. Update it with your changes, or
              keep it and save a separate copy?
            </p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.ghostButton} onClick={() => setSavingAsNew(true)}>
                Save as new
              </button>
              <button type="button" className={styles.primaryButton} onClick={handleUpdate}>
                Update “{activeEntry.name}”
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.dialogTitle}>{activeEntry ? 'Save as new set' : 'Save deck set'}</h2>
            <p className={styles.dialogHint}>
              Saving your current {mode === 'solo' ? 'Solo decks' : 'Blue & Red decks'} as a new set.
            </p>
            <input
              className={styles.nameInput}
              value={name}
              autoFocus
              onFocus={(e) => e.target.select()}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveNew();
                if (e.key === 'Escape') onClose();
              }}
              placeholder="Deck set name"
            />
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => (activeEntry ? setSavingAsNew(false) : onClose())}
              >
                {activeEntry ? 'Back' : 'Cancel'}
              </button>
              <button type="button" className={styles.primaryButton} onClick={handleSaveNew}>
                Save
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
