import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SHORTCUTS, type Shortcut } from '../../utils/shortcuts';
import { modLabel } from '../../utils/keys';
import styles from './CommandPalette.module.css';

/**
 * Every keyboard shortcut, on "?" or from the palette.
 *
 * GENERATED FROM `utils/shortcuts.ts`, the same table the key handler reads,
 * so it can never list a key that does nothing or miss one that does.
 * Nobody uses a shortcut they cannot discover; this is where they are found.
 */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  /* Through a ref, so the effect below depends on `open` alone. With the
     callback as a dependency an inline handler would re-run it every render,
     and each re-run hands focus away and back. */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      } else if (e.key === 'Tab') {
        // One control in the sheet; keep focus on it.
        e.preventDefault();
        closeButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      returnTo.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const mod = modLabel();
  const groups: Shortcut['group'][] = ['Anywhere', 'Go to', 'In the deck tools'];

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`${styles.dialog} ${styles.sheet}`} role="dialog" aria-modal="true" aria-labelledby="shortcut-sheet-title">
        <div className={styles.sheetHead}>
          <h2 id="shortcut-sheet-title" className={styles.sheetTitle}>
            Keyboard shortcuts
          </h2>
          <button ref={closeButton} type="button" className={styles.sheetClose} onClick={onClose}>
            Close
          </button>
        </div>
        <div className={styles.sheetBody}>
          {groups.map((g) => (
            <section key={g} className={styles.sheetGroup}>
              <h3 className={styles.group}>{g}</h3>
              <ul className={styles.sheetList}>
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <li key={s.label} className={styles.sheetRow}>
                    <span>{s.label}</span>
                    <span className={styles.keys}>
                      {s.keys.map((k, i) => (
                        <kbd key={i} className={styles.kbd}>
                          {k === 'Mod' ? mod : k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className={styles.sheetNote}>
            Single-key shortcuts wait while you are typing in a field, so a letter in a deck name
            stays a letter. The “G then …” pairs need the second key within about a second.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
