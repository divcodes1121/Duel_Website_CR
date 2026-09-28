import { useEffect, useRef } from 'react';
import { G_WINDOW, shortcutFor, type ShortcutAction } from '../../utils/shortcuts';
import { isEditableTarget } from '../../utils/keys';

/**
 * The shell's keyboard: the table in `utils/shortcuts.ts`, bound once.
 *
 * Ctrl/⌘ K works everywhere, including from inside a text field — reaching
 * the palette from where you are is the point of it, and it toggles, so the
 * same keys close it again.
 *
 * Every other shortcut steps aside when:
 *   * a modifier is held (those belong to the browser and the OS),
 *   * the reader is typing in a field (a letter is a letter),
 *   * any modal dialog is open (a key must not change the page behind it),
 *   * `paused` is set (the palette or the sheet has the keyboard).
 */
export function useGlobalShortcuts(opts: {
  onAction: (action: ShortcutAction) => void;
  paused: boolean;
}) {
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    let gAt = 0;
    function onKey(e: KeyboardEvent) {
      const { onAction, paused } = ref.current;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onAction({ kind: 'palette' });
        return;
      }
      if (paused || e.defaultPrevented || e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;

      const waiting = gAt > 0 && Date.now() - gAt < G_WINDOW;
      const hit = shortcutFor(e.key, waiting);
      gAt = 0;
      if (hit === 'g') {
        gAt = Date.now();
        return;
      }
      if (!hit) return;
      e.preventDefault();
      onAction(hit);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
