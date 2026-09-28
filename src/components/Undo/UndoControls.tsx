import { useEffect, useRef, useState } from 'react';
import { useBuilderStore } from '../../state/store';
import type { HistoryScope } from '../../state/deckHistory';
import { isEditableTarget, modLabel, undoKeyOf } from '../../utils/keys';
import styles from './UndoControls.module.css';

/**
 * Undo and Redo for one deck tool, as two buttons and the keyboard.
 *
 * ONE PER SCREEN. The keyboard listener lives here, so a screen gets the keys
 * by rendering the buttons and loses them when it is left — Ctrl-Z on the duel
 * builder can never reach Deck's Home's history, because Deck's Home's
 * controls are not mounted.
 *
 * NOT WHILE TYPING. Inside a text field Ctrl-Z is the browser's own text undo,
 * which is the one the reader means; this steps aside for it.
 *
 * WHAT WAS UNDONE IS SAID. The change may be to a deck scrolled out of view, so
 * a quiet line under the buttons names it for a moment ("Undid: Remove Hog
 * Rider") and a screen reader hears the same words.
 */

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </svg>
  );
}

export function UndoControls({ scope }: { scope: HistoryScope }) {
  const stack = useBuilderStore((s) => s.history[scope]);
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const [said, setSaid] = useState<string | null>(null);
  const timer = useRef(0);

  const nextUndo = stack.past[stack.past.length - 1]?.label ?? null;
  const nextRedo = stack.future[stack.future.length - 1]?.label ?? null;
  const mod = modLabel();

  const announce = (text: string) => {
    setSaid(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaid(null), 2400);
  };

  const doUndo = () => {
    const label = undo(scope);
    if (label) announce(`Undid: ${label}`);
  };
  const doRedo = () => {
    const label = redo(scope);
    if (label) announce(`Redid: ${label}`);
  };

  // Read through a ref so the listener is bound once, not on every render.
  const act = useRef({ doUndo, doRedo });
  act.current = { doUndo, doRedo };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || isEditableTarget(e.target)) return;
      const which = undoKeyOf(e);
      if (!which) return;
      e.preventDefault();
      if (which === 'undo') act.current.doUndo();
      else act.current.doRedo();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <span className={styles.wrap}>
      <span className={styles.pair} role="group" aria-label="Undo and redo">
        <button
          type="button"
          className={styles.button}
          onClick={doUndo}
          disabled={!nextUndo}
          aria-label={nextUndo ? `Undo ${nextUndo}` : 'Nothing to undo'}
          title={nextUndo ? `Undo ${nextUndo} (${mod} Z)` : 'Nothing to undo'}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={doRedo}
          disabled={!nextRedo}
          aria-label={nextRedo ? `Redo ${nextRedo}` : 'Nothing to redo'}
          title={nextRedo ? `Redo ${nextRedo} (${mod} Shift Z)` : 'Nothing to redo'}
        >
          <RedoIcon />
        </button>
      </span>
      <span className={styles.said} role="status" aria-live="polite" data-shown={said ? '' : undefined}>
        {said}
      </span>
    </span>
  );
}
