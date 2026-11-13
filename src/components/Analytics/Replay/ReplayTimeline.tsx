import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CARDS_BY_KEY, getCardIconUrl } from '../../../data/cards';
import type { Replay, ReplayEvent, ReplaySide } from '../../../utils/replayParse';
import { cardName, clock } from '../../../utils/replayModel';
import styles from './Replay.module.css';

/**
 * THE TIMELINE: every play pinned to its moment, red's above the clock and
 * blue's below it — the same way round as the board, so a reader's eye moves
 * between them without turning anything over.
 *
 * It is also the scrubber. Press anywhere on the strip (not on a pin) and drag
 * to move the replay; press a pin to jump to that play. The strip is a slider
 * to assistive tech, and the board's own keys move it.
 *
 * Pins that would overlap stack into a second or third row, decided against
 * the strip's measured width, so a burst of plays stays readable rather than
 * drawing one card over another.
 */

const PIP = 24;
const GAP = 3;
const MAX_ROWS = 3;

function rowsFor(events: ReplayEvent[], duration: number, width: number): Map<number, number> {
  const out = new Map<number, number>();
  const lastX: number[] = [];
  for (const e of events) {
    const x = (e.t / duration) * width;
    let row = 0;
    while (row < MAX_ROWS - 1 && lastX[row] != null && x - lastX[row] < PIP + GAP) row += 1;
    lastX[row] = x;
    out.set(e.n, row);
  }
  return out;
}

export function ReplayTimeline({
  replay,
  t,
  onSeek,
}: {
  replay: Replay;
  t: number;
  onSeek: (t: number, e?: ReplayEvent) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const d = replay.duration;

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bySide = useMemo(() => {
    const pick = (s: ReplaySide) => replay.events.filter((e) => e.side === s);
    return { blue: pick('blue'), red: pick('red') };
  }, [replay]);
  const rows = useMemo(
    () => ({ blue: rowsFor(bySide.blue, d, width), red: rowsFor(bySide.red, d, width) }),
    [bySide, d, width],
  );
  const used = (s: ReplaySide) => Math.max(1, ...[...rows[s].values()].map((r) => r + 1));
  const laneH = (s: ReplaySide) => used(s) * (PIP + GAP) + GAP;

  const ticks = useMemo(() => {
    const step = d > 240 ? 60 : 30;
    const out: number[] = [];
    for (let s = 0; s <= d; s += step) out.push(s);
    return out;
  }, [d]);

  const timeAt = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(d, Math.max(0, ((clientX - r.left) / r.width) * d));
  };

  const dragging = useRef(false);

  const pins = (side: ReplaySide) =>
    bySide[side].map((e) => {
      const row = rows[side].get(e.n) ?? 0;
      const known = CARDS_BY_KEY.has(e.key);
      const label = `${clock(e.t)} · ${cardName(e.key)}${e.kind === 'ability' ? ' ability' : ''}`;
      return (
        <button
          key={e.n}
          type="button"
          className={styles.tlPin}
          data-side={side}
          data-kind={e.kind}
          data-past={e.t <= t ? '' : undefined}
          style={
            side === 'red'
              ? { left: `${(e.t / d) * 100}%`, bottom: `${GAP + row * (PIP + GAP)}px` }
              : { left: `${(e.t / d) * 100}%`, top: `${GAP + row * (PIP + GAP)}px` }
          }
          title={label}
          aria-label={label}
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={() => onSeek(e.t, e)}
        >
          {known ? <img src={getCardIconUrl(e.key)} alt="" draggable={false} loading="lazy" /> : <span>{cardName(e.key)[0]}</span>}
          {e.kind === 'ability' && <i aria-hidden="true" className={styles.tlBolt} />}
        </button>
      );
    });

  return (
    <div className={styles.timeline}>
      <div
        ref={trackRef}
        className={styles.tlTrack}
        role="slider"
        tabIndex={0}
        aria-label="Replay position"
        aria-valuemin={0}
        aria-valuemax={Math.round(d)}
        aria-valuenow={Math.round(t)}
        aria-valuetext={`${clock(t)} of ${clock(d)}`}
        onPointerDown={(ev) => {
          if (ev.button !== 0) return;
          dragging.current = true;
          ev.currentTarget.setPointerCapture(ev.pointerId);
          onSeek(timeAt(ev.clientX));
        }}
        onPointerMove={(ev) => {
          if (dragging.current) onSeek(timeAt(ev.clientX));
        }}
        onPointerUp={(ev) => {
          dragging.current = false;
          if (ev.currentTarget.hasPointerCapture(ev.pointerId)) ev.currentTarget.releasePointerCapture(ev.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <div className={styles.tlLane} data-side="red" style={{ height: laneH('red') }}>
          {pins('red')}
        </div>
        <div className={styles.tlAxis}>
          <div className={styles.tlDone} style={{ width: `${(t / d) * 100}%` }} />
          {ticks.map((s) => (
            <span key={s} className={styles.tlTick} style={{ left: `${(s / d) * 100}%` }}>
              {clock(s)}
            </span>
          ))}
        </div>
        <div className={styles.tlLane} data-side="blue" style={{ height: laneH('blue') }}>
          {pins('blue')}
        </div>
        <div className={styles.tlHead} style={{ left: `${(t / d) * 100}%` }} aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
