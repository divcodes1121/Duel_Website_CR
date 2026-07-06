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
  const libraryCount = useBuilderStore((s) => s.library.length);
  const saveCurrent = useBuilderStore((s) => s.saveCurrent);
  const [name, setName] = useState(`Saved Duel Deck ${libraryCount + 1}`);

  function commit() {
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
        <h2 className={styles.dialogTitle}>Save deck set</h2>
        <p className={styles.dialogHint}>
          Saving your current {mode === 'solo' ? 'Solo decks' : 'Blue & Red decks'}.
        </p>
        <input
          className={styles.nameInput}
          value={name}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Deck set name"
        />
        <div className={styles.dialogActions}>
          <button type="button" className={styles.ghostButton} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.primaryButton} onClick={commit}>
            Save
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
