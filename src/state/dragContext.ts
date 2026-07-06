import type { DeckOwner } from '../types/deck';
import type { FlightRect } from './flightStore';

/**
 * Payload of an in-progress HTML5 drag. dataTransfer can't be read during
 * dragover, so the payload lives in this module singleton for the drag's
 * lifetime (same-window drags only, which is all we support).
 */
export type DragPayload =
  | { type: 'picker'; cardKey: string; sourceRect: FlightRect }
  | {
      type: 'slot';
      owner: DeckOwner;
      deckIndex: number;
      slotIndex: number;
      cardKey: string;
      sourceRect: FlightRect;
    };

let current: DragPayload | null = null;

export function startDrag(payload: DragPayload): void {
  current = payload;
}

export function getDrag(): DragPayload | null {
  return current;
}

export function endDrag(): void {
  current = null;
}
