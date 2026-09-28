/**
 * THE KEYBOARD SHORTCUTS, AS ONE TABLE. NO IMPORTS.
 *
 * The key handler, the shortcut sheet and the command palette's key hints all
 * read this list, so the three cannot disagree about what a key does — the
 * sheet is generated from the thing it documents.
 *
 * Every shortcut without a modifier is ignored while the reader is typing in
 * a field (see `isEditableTarget`): "t" is a letter in a deck name. Ctrl/⌘ K
 * is the exception, because reaching the palette from inside a field is the
 * point of it.
 */

/** Where a "G then …" shortcut goes. */
export type GoTarget =
  | 'home'
  | 'meta'
  | 'builder'
  | 'decks'
  | 'palette'
  | 'teams'
  | 'duo'
  | 'counter'
  | 'battles'
  | 'guide';

export type ShortcutAction =
  | { kind: 'palette' }
  | { kind: 'sheet' }
  | { kind: 'rail' }
  | { kind: 'theme' }
  | { kind: 'export' }
  | { kind: 'go'; to: GoTarget };

export interface Shortcut {
  /** Keys as printed on the sheet, in order. "Mod" is Ctrl or ⌘. */
  keys: string[];
  label: string;
  action: ShortcutAction | null;
  /** Which part of the sheet it sits in. */
  group: 'Anywhere' | 'Go to' | 'In the deck tools';
}

export const SHORTCUTS: Shortcut[] = [
  { keys: ['Mod', 'K'], label: 'Open the command palette', action: { kind: 'palette' }, group: 'Anywhere' },
  { keys: ['/'], label: 'Search a player tag or a screen', action: { kind: 'palette' }, group: 'Anywhere' },
  { keys: ['?'], label: 'Show these shortcuts', action: { kind: 'sheet' }, group: 'Anywhere' },
  { keys: ['T'], label: 'Switch between light and dark', action: { kind: 'theme' }, group: 'Anywhere' },
  { keys: ['['], label: 'Fold or open the sidebar', action: { kind: 'rail' }, group: 'Anywhere' },
  { keys: ['E'], label: 'Export this screen as a PDF', action: { kind: 'export' }, group: 'Anywhere' },
  { keys: ['G', 'H'], label: 'Home', action: { kind: 'go', to: 'home' }, group: 'Go to' },
  { keys: ['G', 'M'], label: 'Top Meta Decks', action: { kind: 'go', to: 'meta' }, group: 'Go to' },
  { keys: ['G', 'R'], label: 'Recent Battles', action: { kind: 'go', to: 'battles' }, group: 'Go to' },
  { keys: ['G', 'C'], label: 'Deck Counter', action: { kind: 'go', to: 'counter' }, group: 'Go to' },
  { keys: ['G', 'B'], label: 'Royal Duels', action: { kind: 'go', to: 'builder' }, group: 'Go to' },
  { keys: ['G', 'D'], label: 'Deck’s Home', action: { kind: 'go', to: 'decks' }, group: 'Go to' },
  { keys: ['G', 'P'], label: 'Counter Palette', action: { kind: 'go', to: 'palette' }, group: 'Go to' },
  { keys: ['G', 'T'], label: 'Team Analysis', action: { kind: 'go', to: 'teams' }, group: 'Go to' },
  { keys: ['G', '2'], label: '2v2 Decks', action: { kind: 'go', to: 'duo' }, group: 'Go to' },
  { keys: ['G', 'F'], label: 'The field book', action: { kind: 'go', to: 'guide' }, group: 'Go to' },
  { keys: ['Mod', 'Z'], label: 'Undo the last change', action: null, group: 'In the deck tools' },
  { keys: ['Mod', 'Shift', 'Z'], label: 'Redo it', action: null, group: 'In the deck tools' },
];

/** How long a "G" waits for its second key, in ms. */
export const G_WINDOW = 1200;

/**
 * What an unmodified key does, given whether a "G" is waiting. Returns
 * 'g' when this key STARTS a sequence, the action when it finishes or is a
 * single-key shortcut, and null when it is not a shortcut at all.
 */
export function shortcutFor(key: string, pendingG: boolean): ShortcutAction | 'g' | null {
  const k = key.length === 1 ? key.toUpperCase() : key;
  if (pendingG) {
    const hit = SHORTCUTS.find((s) => s.keys.length === 2 && s.keys[0] === 'G' && s.keys[1] === k);
    return hit?.action ?? null;
  }
  if (k === 'G') return 'g';
  const hit = SHORTCUTS.find((s) => s.keys.length === 1 && s.keys[0] === k);
  return hit?.action ?? null;
}

/** The printed keys for a go-target, for the palette's hints: ['G', 'M']. */
export function keysFor(to: GoTarget): string[] | undefined {
  return SHORTCUTS.find((s) => s.action?.kind === 'go' && s.action.to === to)?.keys;
}
