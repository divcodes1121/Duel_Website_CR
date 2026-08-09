import { create } from 'zustand';

export interface FlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Flight {
  id: number;
  src: string;
  from: FlightRect;
  to: FlightRect;
}

interface FlightState {
  flights: Flight[];
  launch: (src: string, from: FlightRect, to: FlightRect) => void;
  remove: (id: number) => void;
}

/**
 * Card art flying between the picker and a deck slot.
 *
 * Disabled: `launch` is a no-op, so nothing is ever queued and FlightLayer has
 * nothing to draw. The call sites in DeckSlot, CardGrid and CardPickerDrawer are
 * left in place — restoring the effect is re-enabling this one function rather
 * than re-threading it through three components.
 */
export const useFlightStore = create<FlightState>((set) => ({
  flights: [],
  launch: () => {},
  remove: (id) => set((state) => ({ flights: state.flights.filter((f) => f.id !== id) })),
}));

export function rectOf(el: Element): FlightRect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}
