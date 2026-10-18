/* IS THE ANALYTICS SERVER ANSWERING — and, while it is not, when to ask again.
 *
 * WHY IT EXISTS (2026-10-18). The VPS was powered off from outside for half an
 * hour, and every search on the site sat on a loader for 200+ seconds: the
 * shared fetch had no timeout, so a request to a machine that is off waited
 * for the browser's own TCP give-up. Nothing on screen said the server was
 * down, and nothing noticed when it came back.
 *
 * So a failed or SLOW request now asks one cheap question — does
 * `/api/analytics/status` answer? — and that answer, not the request, decides:
 *
 *   up        the request was just slow (Team Analysis can take 40 s cold);
 *             leave it alone.
 *   degraded  the server answers but cannot read the stored database (the
 *             second fault of that night). Live data still works.
 *   down      nothing answers. The request is abandoned at once, the site
 *             shows the outage page, and this module keeps asking on a
 *             back-off until the server is back.
 *
 * One probe at a time (concurrent callers share it) and never more often than
 * MIN_PROBE_GAP_MS, so a screen firing ten requests at a dead server costs one
 * probe, not ten.
 *
 * NO REACT, NO DOM at import: the clock, timers and the probe are injected, so
 * the whole state machine is tested in node (`tests/apiHealth.test.ts`).
 */

export type ApiState = 'unknown' | 'up' | 'degraded' | 'down';

export interface ApiHealthSnapshot {
  state: ApiState;
  /** When the current outage was first confirmed (ms epoch); null when up. */
  downSince: number | null;
  /** When the next automatic check runs (ms epoch); null when none is due. */
  nextCheckAt: number | null;
  /** Checks made during the current outage, for the "checked N times" line. */
  checks: number;
  /** Bumped every time the server comes back after a confirmed outage, so a
   *  screen can tell "it recovered" from "it was never down". */
  recoveries: number;
}

export type ProbeResult = 'up' | 'degraded' | 'down';

export interface HealthDeps {
  probe: () => Promise<ProbeResult>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/** The back-off while down, in seconds, then the last value repeats. Short at
 *  first because the commonest outage is a restart that takes a minute. */
export const RETRY_SCHEDULE_S = [5, 10, 15, 20, 30];
/** How often a DEGRADED server is re-checked, so its banner clears itself. */
export const DEGRADED_RECHECK_S = 30;
/** Two probes closer than this share one answer. */
export const MIN_PROBE_GAP_MS = 3000;

export function retryDelayS(checks: number): number {
  const i = Math.max(0, Math.min(RETRY_SCHEDULE_S.length - 1, checks - 1));
  return RETRY_SCHEDULE_S[i];
}

export function createApiHealth(deps: HealthDeps) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));

  let snap: ApiHealthSnapshot = {
    state: 'unknown', downSince: null, nextCheckAt: null, checks: 0, recoveries: 0,
  };
  const listeners = new Set<() => void>();
  let inFlight: Promise<ApiState> | null = null;
  let lastProbeAt = 0;
  let timer: unknown = null;

  const emit = (next: Partial<ApiHealthSnapshot>) => {
    snap = { ...snap, ...next };
    listeners.forEach((l) => l());
  };

  const schedule = (seconds: number) => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      void check(true);
    }, seconds * 1000);
    return now() + seconds * 1000;
  };

  const settle = (result: ProbeResult) => {
    const wasDown = snap.state === 'down';
    if (result === 'down') {
      const checks = wasDown ? snap.checks + 1 : 1;
      emit({
        state: 'down',
        downSince: wasDown ? snap.downSince : now(),
        checks,
        nextCheckAt: schedule(retryDelayS(checks)),
      });
      return;
    }
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    emit({
      state: result,
      downSince: null,
      checks: 0,
      recoveries: wasDown ? snap.recoveries + 1 : snap.recoveries,
      nextCheckAt: result === 'degraded' ? schedule(DEGRADED_RECHECK_S) : null,
    });
  };

  /** Ask the server now. `force` skips the shared-answer window (the retry
   *  timer and the "Try now" button use it). */
  function check(force = false): Promise<ApiState> {
    if (inFlight) return inFlight;
    if (!force && lastProbeAt && now() - lastProbeAt < MIN_PROBE_GAP_MS && snap.state !== 'unknown') {
      return Promise.resolve(snap.state);
    }
    lastProbeAt = now();
    inFlight = deps
      .probe()
      .catch((): ProbeResult => 'down')
      .then((result) => {
        settle(result);
        return snap.state;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    getSnapshot: () => snap,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** A request failed or is slow: is the server down? */
    confirm: () => check(false),
    /** The "Try now" button. */
    checkNow: () => check(true),
    /** A real request succeeded. If an outage was on record, confirm it is
     *  over with a probe rather than trusting one response. */
    sawSuccess() {
      if (snap.state === 'down') void check(true);
      else if (snap.state === 'unknown') emit({ state: 'up' });
    },
  };
}

export type ApiHealth = ReturnType<typeof createApiHealth>;

/* ---- the site's own instance ------------------------------------------------ */

const BASE = import.meta.env.VITE_ANALYTICS_BASE ?? '';
export const PROBE_TIMEOUT_MS = 8000;

/** The status route answers without a key and reports `hot.available`. */
async function probeStatus(): Promise<ProbeResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api/analytics/status`, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) return 'down';
    const body = (await res.json().catch(() => null)) as { hot?: { available?: boolean } } | null;
    if (!body) return 'down';
    return body.hot?.available === false ? 'degraded' : 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(t);
  }
}

export const apiHealth = createApiHealth({ probe: probeStatus });
