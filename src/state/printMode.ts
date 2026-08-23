import { create } from 'zustand';

/* Print mode — "render everything, not just what I'm looking at".
 *
 * A screen's tabs are alternative views of ONE payload: Duel Analysis fetches
 * `report.tabs` containing win-conditions, spells and evolutions together, and
 * the tab bar only chooses which slice to draw. On paper that choice makes no
 * sense — a PDF you cannot click should carry all three.
 *
 * CSS alone cannot do this. The inactive panels are conditionally rendered, so
 * they are not in the DOM for a stylesheet to reveal; the component has to
 * decide to draw them. This flag is how it is told.
 *
 * It is deliberately a store rather than a prop: the button lives in the
 * Dashboard shell and the tabs live several levels down inside whichever
 * section is open, and threading a prop through every analytics screen to
 * support printing would put print plumbing in components that otherwise have
 * nothing to do with it.
 */

interface PrintModeState {
  /** True only while a PDF export is being prepared. */
  printing: boolean;
  setPrinting: (v: boolean) => void;
}

export const usePrintMode = create<PrintModeState>((set) => ({
  printing: false,
  setPrinting: (v) => set({ printing: v }),
}));

/** Read-only helper for components that only need the flag. */
export const useIsPrinting = () => usePrintMode((s) => s.printing);
