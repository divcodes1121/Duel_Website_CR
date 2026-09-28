/**
 * Undo and redo for the three deck tools. NO IMPORTS: the rules are testable
 * without a store, the same arrangement as `tiers.ts` and `deckUtils.ts`.
 *
 * WHY IT EXISTS (2026-09-28). Clear, Reset, removing a deck and deleting a
 * Counter Palette folder were all permanent, and deck edits sync to every
 * device the account uses — so one wrong press was a loss everywhere at once.
 *
 * ── THREE SCOPES, NOT ONE STACK ──────────────────────────────────────────
 *
 * Royal Duels, Deck's Home and Counter Palette each keep their own history.
 * With one shared stack, Ctrl-Z on the duel builder would silently undo an
 * edit made on Deck's Home ten minutes earlier — a change on a screen the
 * reader is not looking at, which is worse than no undo.
 *
 * ── A STEP IS A SNAPSHOT, NOT A DIFF ─────────────────────────────────────
 *
 * Each step keeps the scope's whole state as it was BEFORE the action, and a
 * label saying what the action was. Snapshots are cheap here (a few decks of
 * eight card keys; the store never mutates, so unchanged branches are shared
 * references), and a snapshot cannot be replayed wrongly the way an inverse
 * operation can when the action was one of the conditional ones (a swap, a
 * champion refused, a paste that replaced a deck).
 *
 * RUNTIME ONLY. The history is not persisted — a reload starts clean, like
 * `activeSavedId` — so the persist version does not move.
 */

export type HistoryScope = 'duels' | 'home' | 'palette';

/** Steps kept per scope. Past this the oldest is dropped. */
export const HISTORY_LIMIT = 50;

export interface Step<S> {
  /** What the action did, in the reader's words: "Remove Hog Rider". */
  label: string;
  /** The scope's state as it was before (for undo) or after (for redo). */
  snapshot: S;
}

export interface Stack<S> {
  past: Step<S>[];
  future: Step<S>[];
}

export function emptyStack<S>(): Stack<S> {
  return { past: [], future: [] };
}

/** Which scope a deck owner's edits belong to. */
export function scopeOfOwner(owner: string): HistoryScope {
  if (owner === 'home') return 'home';
  if (owner === 'palette') return 'palette';
  return 'duels';
}

/**
 * Record an action: the state before it goes on the past, and the future is
 * dropped — a new action after an undo starts a new branch, the way every
 * editor does it.
 */
export function record<S>(stack: Stack<S>, step: Step<S>, limit = HISTORY_LIMIT): Stack<S> {
  const past = [...stack.past, step];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

/** Step back: returns the state to restore, or null when there is nothing. */
export function undoStep<S>(
  stack: Stack<S>,
  current: S,
): { stack: Stack<S>; restore: S; label: string } | null {
  const step = stack.past[stack.past.length - 1];
  if (!step) return null;
  return {
    stack: {
      past: stack.past.slice(0, -1),
      future: [...stack.future, { label: step.label, snapshot: current }],
    },
    restore: step.snapshot,
    label: step.label,
  };
}

/** Step forward again: the mirror of `undoStep`. */
export function redoStep<S>(
  stack: Stack<S>,
  current: S,
): { stack: Stack<S>; restore: S; label: string } | null {
  const step = stack.future[stack.future.length - 1];
  if (!step) return null;
  return {
    stack: {
      past: [...stack.past, { label: step.label, snapshot: current }],
      future: stack.future.slice(0, -1),
    },
    restore: step.snapshot,
    label: step.label,
  };
}
