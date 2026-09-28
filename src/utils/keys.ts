/**
 * Small keyboard helpers shared by the command palette, the shortcut sheet and
 * the deck tools' undo. NO IMPORTS.
 */

/** A Mac, iPhone or iPad, where the command key is ⌘ rather than Ctrl. */
export function isMacLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The modifier as the reader's keyboard labels it. */
export function modLabel(): string {
  return isMacLike() ? '⌘' : 'Ctrl';
}

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'password', 'url', 'tel', 'number', 'date']);

/**
 * True when a keystroke belongs to a field the reader is typing in. A
 * shortcut must never fire there: "t" is a letter in a deck name, and Ctrl-Z
 * in a text box is the browser's own text undo, which is the one the reader
 * means while typing.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return TEXT_INPUTS.has(((el as HTMLInputElement).type || 'text').toLowerCase());
  return false;
}

/** Ctrl-Z / ⌘-Z undo, Shift+Ctrl-Z / Ctrl-Y / Shift+⌘-Z redo; null otherwise. */
export function undoKeyOf(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): 'undo' | 'redo' | null {
  if (e.altKey || !(e.ctrlKey || e.metaKey)) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && e.ctrlKey && !e.metaKey) return 'redo';
  return null;
}
