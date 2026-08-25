/**
 * Fire-and-forget effects on the deck column.
 *
 * A PLAIN MODULE EMITTER, NOT A ZUSTAND STORE, and the distinction is
 * load-bearing rather than stylistic. These are EVENTS: nothing renders from
 * them, nothing reads them back, and there is no "current burst" any component
 * would ever want to know about. Putting them in the builder store would
 * re-render every deck panel and all forty slots on every single card drop — to
 * move some points around on a canvas that is not part of the React tree at
 * all. `dragContext.ts` is the same shape for the same reason.
 *
 * The listener is the WebGL layer in `three/DeckFx.tsx`. If it is not mounted —
 * reduced motion, no GPU, or simply a screen without a deck column — `fire`
 * finds no listeners and the event evaporates, which is the correct behaviour
 * for something purely decorative.
 */

export interface FxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DeckFxEvent =
  /**
   * Points thrown outward from a rect: a card landing in a slot, a crown being
   * taken. The caller passes the rect because it always has the element to
   * hand — see `fxRectOf`.
   */
  | { kind: 'burst'; rect: FxRect; tone?: 'gold' }
  /**
   * A light sweeping the eight slots of one deck, the moment it becomes legal.
   *
   * Identified rather than measured: the caller knows WHICH deck, and the
   * canvas is already reading slot rects every frame, so it can find the eight
   * and take their union itself. That keeps the geometry in the one place that
   * already does geometry.
   */
  | { kind: 'sweep'; deck: string };

type Listener = (event: DeckFxEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe. Returns the unsubscribe, for an effect's cleanup. */
export function onDeckFx(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function fireDeckFx(event: DeckFxEvent): void {
  for (const fn of listeners) fn(event);
}

/** Viewport-space rect of an element. The canvas subtracts its own origin. */
export function fxRectOf(el: Element): FxRect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}
