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

let nextId = 1;

/** Transient overlay animations of card art flying between the browser and deck slots. */
export const useFlightStore = create<FlightState>((set) => ({
  flights: [],
  launch: (src, from, to) =>
    set((state) => ({ flights: [...state.flights, { id: nextId++, src, from, to }] })),
  remove: (id) => set((state) => ({ flights: state.flights.filter((f) => f.id !== id) })),
}));

export function rectOf(el: Element): FlightRect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}
