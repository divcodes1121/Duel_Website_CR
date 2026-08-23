/* Opponent-read instrumentation — Phase 19B.
 *
 * WHAT IS RECORDED IS A CLOSED LIST, not a filtered one. The shape below has
 * no field that could hold a tag, a card, a deck, an opponent, a model feature
 * or a weight, so there is no code path — present or future — through which one
 * could be added by accident. That is deliberately stricter than scrubbing.
 *
 * `changeProbability` is NOT recorded either. It is a model output, and the
 * server already keeps it inside the shadow log where the privacy boundary was
 * agreed; duplicating it into the browser widens that boundary for no gain.
 *
 * This is a ring buffer in memory. Nothing is transmitted. */

export interface OpponentReadMetric {
  /** 'read' | 'disabled' | 'timeout' | 'error' */
  outcome: string;
  /** Wall time from mount to resolution, milliseconds. */
  requestMs: number;
  /** 'high' | 'medium' | 'low' | null — the band only, never the score. */
  confidence: string | null;
  /** How many configurations were surfaced. Must respect 2/1/0 by band. */
  alternativeCount: number;
  degraded: boolean;
  timedOut: boolean;
  errored: boolean;
}

const MAX_SAMPLES = 50;
const samples: OpponentReadMetric[] = [];

export function pushMetric(m: OpponentReadMetric): void {
  samples.push(m);
  if (samples.length > MAX_SAMPLES) samples.shift();
  // Exposed for the browser verification pass; harmless in production because
  // it holds only the closed shape above.
  (window as unknown as { __oieMetrics?: OpponentReadMetric[] }).__oieMetrics = samples;
}

export function metrics(): OpponentReadMetric[] {
  return samples.slice();
}

export function summary() {
  const n = samples.length || 1;
  return {
    samples: samples.length,
    timeoutRate: samples.filter((s) => s.timedOut).length / n,
    errorRate: samples.filter((s) => s.errored).length / n,
    degradedRate: samples.filter((s) => s.degraded).length / n,
    p50RequestMs: percentile(samples.map((s) => s.requestMs), 0.5),
    p95RequestMs: percentile(samples.map((s) => s.requestMs), 0.95),
  };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(v.length * p))];
}
