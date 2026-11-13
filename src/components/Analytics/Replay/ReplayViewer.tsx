import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Replay, ReplayEvent, ReplaySide } from '../../../utils/replayParse';
import {
  SIDES,
  SPEEDS,
  clock,
  cycleAt,
  elixirSeries,
  summarise,
  type Speed,
} from '../../../utils/replayModel';
import { ArenaMap } from './ArenaMap';
import { ReplayTimeline } from './ReplayTimeline';
import { ElixirRace, LaneSplit, PlayLog, SidePanel } from './ReplayParts';
import styles from './Replay.module.css';

/**
 * One replay, played back.
 *
 * THE CLOCK IS OURS, NOT A VIDEO'S. There is no recording to play — the page
 * holds the plays, so "playing" is moving a time forward and drawing what had
 * happened by then. That is why scrubbing is instant, a jump lands exactly on
 * a play, and 8x costs no more than 1x.
 *
 * THE KEYS ARE CLASHBACK'S, so a coach who used one can use the other: Space
 * plays and pauses, left/right move a second, up/down change speed, 1-5 pick
 * 0.5x..8x. Home goes back to the start. They are ignored while typing or
 * while another dialog is open over the board.
 *
 * One animation frame loop, and only while playing.
 */

const FLASH_SECONDS = 1.2;

function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  );
}

export function ReplayViewer({ replay }: { replay: Replay }) {
  const d = replay.duration;
  const [t, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [view, setView] = useState<'recent' | 'all'>('recent');

  const rootRef = useRef<HTMLDivElement>(null);
  const tRef = useRef(0);
  const speedRef = useRef<Speed>(1);
  speedRef.current = speed;

  const setT = useCallback(
    (next: number) => {
      const v = Math.min(d, Math.max(0, next));
      tRef.current = v;
      setTime(v);
    },
    [d],
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // A hidden tab stops frames; do not let the gap become a jump.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const next = tRef.current + dt * speedRef.current;
      if (next >= d) {
        setT(d);
        setPlaying(false);
        return;
      }
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, d, setT]);

  const toggle = useCallback(() => {
    // Play at the end starts again from the top.
    if (!playing && tRef.current >= d - 0.01) setT(0);
    setPlaying(!playing);
  }, [playing, d, setT]);

  const seek = useCallback(
    (to: number, e?: ReplayEvent) => {
      // Landing on a play shows it just placed, so its pin is drawn.
      setT(e ? e.t + 0.001 : to);
    },
    [setT],
  );

  const stepSpeed = useCallback((dir: 1 | -1) => {
    setSpeed((s) => {
      const i = SPEEDS.indexOf(s);
      return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + dir))];
    });
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (typingIn(ev.target)) return;
      // The board lives in a dialog; another dialog opened over it (a card's
      // inspect sheet) takes the keys.
      const root = rootRef.current;
      for (const m of document.querySelectorAll('[aria-modal="true"]')) {
        if (!root || !m.contains(root)) return;
      }
      const k = ev.key;
      if (k === ' ' || k === 'Spacebar') {
        // A focused button would also "click" on Space; the board owns it here.
        ev.preventDefault();
        toggle();
      } else if (k === 'ArrowRight') {
        ev.preventDefault();
        setT(tRef.current + 1);
      } else if (k === 'ArrowLeft') {
        ev.preventDefault();
        setT(tRef.current - 1);
      } else if (k === 'ArrowUp') {
        ev.preventDefault();
        stepSpeed(1);
      } else if (k === 'ArrowDown') {
        ev.preventDefault();
        stepSpeed(-1);
      } else if (k === 'Home') {
        ev.preventDefault();
        setT(0);
      } else if (/^[1-5]$/.test(k)) {
        setSpeed(SPEEDS[Number(k) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, setT, stepSpeed]);

  const series = useMemo(() => elixirSeries(replay), [replay]);
  const cycles = {
    blue: cycleAt(replay, 'blue', t),
    red: cycleAt(replay, 'red', t),
  };
  const summaries = { blue: summarise(replay, 'blue', t), red: summarise(replay, 'red', t) };

  const moment = (side: ReplaySide, kind: 'play' | 'ability'): string | null => {
    for (let i = replay.events.length - 1; i >= 0; i -= 1) {
      const e = replay.events[i];
      if (e.t > t || e.side !== side || e.kind !== kind) continue;
      return t - e.t <= FLASH_SECONDS ? e.key : null;
    }
    return null;
  };

  return (
    <div className={styles.viewer} ref={rootRef}>
      <div className={styles.stage}>
        {SIDES.map((side) => (
          <div key={side} className={styles.stageSide} data-side={side}>
            <SidePanel
              replay={replay}
              side={side}
              cycle={cycles[side]}
              summary={summaries[side]}
              flash={moment(side, 'play')}
              ability={moment(side, 'ability')}
            />
          </div>
        ))}
        <div className={styles.stageBoard}>
          <ArenaMap replay={replay} t={t} view={view} onPick={(e) => seek(e.t, e)} />
        </div>
      </div>

      <div className={styles.transport}>
        <div className={styles.controls}>
          <div className={styles.buttons}>
            <button type="button" className={styles.iconBtn} onClick={() => setT(0)} aria-label="Back to the start" title="Back to the start (Home)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M19 6l-9 6 9 6z" /></svg>
            </button>
            <button type="button" className={styles.iconBtn} onClick={() => setT(tRef.current - 1)} aria-label="Back one second" title="Back one second (←)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 7l-5 5 5 5M18 7l-5 5 5 5" /></svg>
            </button>
            <button
              type="button"
              className={styles.playBtn}
              onClick={toggle}
              aria-label={playing ? 'Pause' : 'Play'}
              aria-pressed={playing}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
            >
              {playing ? (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
              )}
            </button>
            <button type="button" className={styles.iconBtn} onClick={() => setT(tRef.current + 1)} aria-label="Forward one second" title="Forward one second (→)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 7l5 5-5 5M6 7l5 5-5 5" /></svg>
            </button>
            <span className={styles.time} aria-live="off">
              <strong>{clock(t)}</strong> / {clock(d)}
            </span>
          </div>
          <div className={styles.toggles}>
            <div className={styles.segment} role="group" aria-label="Speed">
              {SPEEDS.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={speed === s}
                  onClick={() => setSpeed(s)}
                  title={`${s}x (${i + 1})`}
                >
                  {s}×
                </button>
              ))}
            </div>
            <div className={styles.segment} role="group" aria-label="What the board shows">
              <button type="button" aria-pressed={view === 'recent'} onClick={() => setView('recent')} title="Plays of the last few seconds">
                Recent
              </button>
              <button type="button" aria-pressed={view === 'all'} onClick={() => setView('all')} title="Every play so far, as dots">
                All
              </button>
            </div>
          </div>
        </div>
        <ReplayTimeline replay={replay} t={t} onSeek={seek} />
      </div>

      <div className={styles.lower}>
        <ElixirRace replay={replay} series={series} t={t} />
        <LaneSplit replay={replay} summaries={summaries} />
      </div>
      <PlayLog replay={replay} t={t} onSeek={seek} />
    </div>
  );
}
