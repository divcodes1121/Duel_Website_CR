import { createContext, createElement, useContext, useEffect, useRef, type ReactNode } from 'react';
import { create } from 'zustand';
import type { ReportDoc } from '../utils/analyticsReport';
import type { DateWindow } from './analyticsClient';

/* ONE EXPORT BUTTON PER SCREEN, WHEREVER IT SITS.
 *
 * The player screens used to carry TWO buttons both labelled "Export PDF": the
 * shell's, which printed the live page through the browser (the laggy,
 * screenshot-like file — Chrome rasterises every glass panel to print it),
 * and some screens' own, which drew a proper report. Which one a reader got
 * depended on which they clicked.
 *
 * Now a screen DECLARES its export — a thunk that builds the whole report,
 * every tab included — and does not decide where the button goes:
 *
 *   * inside the player shell (`ReportHost`), the declaration is handed to the
 *     shell's button in the query row, which sits in the same place on every
 *     section and can also build the full player report;
 *   * anywhere else (Team Analysis, 2v2 Decks, the home boards), the hook
 *     hands back an inline button for the screen's own header.
 *
 * Same button component, same engine, either way.
 */

export type ReportBuild = () => ReportDoc | Promise<ReportDoc>;

export interface ReportSource {
  id: string;
  build: ReportBuild;
  /** The window the screen is showing, so the full player report can read
   *  every other section over the same dates. */
  win?: DateWindow;
}

interface State {
  source: ReportSource | null;
  set: (s: ReportSource) => void;
  clear: (id: string) => void;
}

export const useReportSource = create<State>((set, get) => ({
  source: null,
  set: (source) => set({ source }),
  // Only clears its OWN registration: on a section change the incoming screen
  // may register before the outgoing one's cleanup runs.
  clear: (id) => {
    if (get().source?.id === id) set({ source: null });
  },
}));

const HostContext = createContext(false);

/** Wrap the player shell's screens: exports inside go to the shell button. */
export function ReportHost({ children }: { children: ReactNode }) {
  return createElement(HostContext.Provider, { value: true }, children);
}

export function useInReportHost(): boolean {
  return useContext(HostContext);
}

/**
 * Declare a screen's export. Inside the player shell it is registered with
 * the shell's button; `host` tells the caller whether to render its own.
 * `ready` false withholds it until the screen has data — an export of a
 * loading screen is an empty document.
 */
export function useReportRegistration(opts: {
  id: string;
  build: ReportBuild;
  ready: boolean;
  win?: DateWindow;
}): { host: boolean; build: ReportBuild } {
  const host = useInReportHost();
  const ref = useRef(opts.build);
  ref.current = opts.build;
  const winKey = JSON.stringify(opts.win ?? null);
  const { id, ready } = opts;

  useEffect(() => {
    if (!host || !ready) return undefined;
    const win = winKey === 'null' ? undefined : (JSON.parse(winKey) as DateWindow);
    useReportSource.getState().set({ id, build: () => ref.current(), win });
    return () => useReportSource.getState().clear(id);
  }, [host, ready, id, winKey]);

  const stable = useRef<ReportBuild>(() => ref.current());
  return { host, build: stable.current };
}
