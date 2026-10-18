import { describe, expect, it } from 'vitest';
import {
  DEGRADED_RECHECK_S,
  MIN_PROBE_GAP_MS,
  RETRY_SCHEDULE_S,
  createApiHealth,
  retryDelayS,
  type ProbeResult,
} from '../src/state/apiHealth';

/** A clock and a timer queue the test drives by hand. */
function harness(answers: ProbeResult[]) {
  let t = 1_000_000;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  let probes = 0;
  const h = createApiHealth({
    probe: async () => {
      probes += 1;
      return answers.length > 1 ? answers.shift()! : answers[0];
    },
    now: () => t,
    setTimer: (fn, ms) => {
      timers.push({ at: t + ms, fn, id: ++id });
      return id;
    },
    clearTimer: (x) => {
      const i = timers.findIndex((q) => q.id === x);
      if (i !== -1) timers.splice(i, 1);
    },
  });
  return {
    h,
    probes: () => probes,
    pending: () => timers.length,
    advance: async (ms: number) => {
      t += ms;
      for (const q of timers.filter((q) => q.at <= t)) {
        timers.splice(timers.indexOf(q), 1);
        q.fn();
      }
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe('apiHealth', () => {
  it('starts unknown and a probe that answers makes it up', async () => {
    const x = harness(['up']);
    expect(x.h.getSnapshot().state).toBe('unknown');
    expect(await x.h.confirm()).toBe('up');
    expect(x.pending()).toBe(0);
  });

  it('a dead server is down, timed, and retried on the back-off', async () => {
    const x = harness(['down']);
    await x.h.confirm();
    const s = x.h.getSnapshot();
    expect(s.state).toBe('down');
    expect(s.downSince).not.toBeNull();
    expect(s.nextCheckAt! - s.downSince!).toBe(RETRY_SCHEDULE_S[0] * 1000);
    await x.advance(RETRY_SCHEDULE_S[0] * 1000);
    expect(x.probes()).toBe(2);
    expect(x.h.getSnapshot().checks).toBe(2);
    expect(x.h.getSnapshot().downSince).toBe(s.downSince);
  });

  it('coming back counts a recovery and stops polling', async () => {
    const x = harness(['down', 'up']);
    await x.h.confirm();
    await x.advance(RETRY_SCHEDULE_S[0] * 1000);
    const s = x.h.getSnapshot();
    expect(s.state).toBe('up');
    expect(s.recoveries).toBe(1);
    expect(s.downSince).toBeNull();
    expect(x.pending()).toBe(0);
  });

  it('never down = no recovery counted', async () => {
    const x = harness(['up']);
    await x.h.confirm();
    expect(x.h.getSnapshot().recoveries).toBe(0);
  });

  it('degraded keeps re-checking so its banner clears itself', async () => {
    const x = harness(['degraded', 'up']);
    await x.h.confirm();
    expect(x.h.getSnapshot().state).toBe('degraded');
    await x.advance(DEGRADED_RECHECK_S * 1000);
    expect(x.h.getSnapshot().state).toBe('up');
    expect(x.pending()).toBe(0);
  });

  it('ten callers at once cost one probe', async () => {
    const x = harness(['down']);
    await Promise.all(Array.from({ length: 10 }, () => x.h.confirm()));
    expect(x.probes()).toBe(1);
  });

  it('a second confirm inside the gap reuses the answer; checkNow does not', async () => {
    const x = harness(['up']);
    await x.h.confirm();
    await x.advance(MIN_PROBE_GAP_MS / 2);
    await x.h.confirm();
    expect(x.probes()).toBe(1);
    await x.h.checkNow();
    expect(x.probes()).toBe(2);
  });

  it('a probe that throws counts as down, not as a crash', async () => {
    const h = createApiHealth({
      probe: async () => {
        throw new Error('boom');
      },
      setTimer: () => 0,
      clearTimer: () => {},
    });
    expect(await h.confirm()).toBe('down');
  });

  it('a success while down triggers a probe instead of trusting one response', async () => {
    const x = harness(['down', 'up']);
    await x.h.confirm();
    x.h.sawSuccess();
    await new Promise((r) => setTimeout(r, 0));
    expect(x.probes()).toBe(2);
    expect(x.h.getSnapshot().state).toBe('up');
  });

  it('the back-off holds at its last step', () => {
    expect(retryDelayS(1)).toBe(RETRY_SCHEDULE_S[0]);
    expect(retryDelayS(99)).toBe(RETRY_SCHEDULE_S[RETRY_SCHEDULE_S.length - 1]);
  });
});
