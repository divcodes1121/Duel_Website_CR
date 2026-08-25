/**
 * The loading rig: a stepped progress bar, a percentage readout and an elapsed
 * counter, wearing the open section's identity hue.
 *
 * Adapted from ThreeUI's `UplinkLoader`. It replaces the WebGL card fan that
 * used to sit here — see `ReadingState.tsx` for why that went.
 *
 * ── THE PROGRESS IS REAL, AND THIS IS THE WHOLE POINT ─────────────────────
 *
 * The reference drives its bar from a hardcoded keyframe timeline and LOOPS
 * forever: 8.6 s of scripted progress, a hold at 100%, a blank, then a glitch
 * and round again. That is a picture of loading, and dropping it in unchanged
 * would have been worse than the fan it replaced — a bar that reaches 100% and
 * restarts while the server is still reading tells the reader the opposite of
 * the truth.
 *
 * So the timeline is gone. What drives it instead:
 *
 *   ELAPSED      real, from `performance.now()`.
 *   EXPECTED     `state/loadTiming.ts` — the MEDIAN of how long this very
 *                screen actually took on this browser, seeded from the figures
 *                the README measured.
 *   COMPLETION   this component unmounting, which is exactly when the data
 *                arrived. It records the sample that sharpens the next estimate.
 *
 * `fetch` gives no progress events for these calls — the API answers with one
 * JSON body at the end — so those three are ALL the honest inputs that exist.
 *
 * **It never reaches 100% and it never restarts.** The curve saturates:
 * `1 - e^(-k·u)` is monotonic, hits ~85% at the expected duration and then
 * creeps, so a read that overruns keeps moving without ever claiming to be
 * finished. The bar does not fill and then sit at 100% lying; it does not wrap;
 * it simply disappears when the panel it is standing in for arrives.
 *
 * ── WHAT WAS DROPPED FROM THE REFERENCE, AND WHY ──────────────────────────
 *
 * Every infinite animation. The reference runs a procedural film grain
 * regenerating on a 0.6 s step loop, a neon flicker, a diamond pulse and a
 * cap pulse. `CLAUDE.md` bans infinite animation project-wide and is specific
 * about the reason — the old CSS glow loops animated `box-shadow` and `filter`,
 * and that is what made the app lag. A full-viewport animated grain is the
 * worst example of exactly that class. What survives is one-shot only: a tick
 * igniting as it lights, and the plate flashing when the bar completes.
 */
import { useEffect, useRef, useState } from 'react';
import type { FireflyHue } from '../../three/Fireflies';
import { expectedDuration, recordDuration } from '../../state/loadTiming';
import { MIN_LOADING_MS } from '../../hooks/useHeldLoading';
import styles from './UplinkLoader.module.css';

/** Ticks in the bar — the reference's own count, across a bar of about its own
 *  width. An earlier pass cut this to 40 for a 26rem rig, where 56 merged into a
 *  solid rule; the rig is 42rem now and the real number fits. */
const TICKS = 56;
/** Every eighth tick is taller — the reference's scale marks. */
const MARK_EVERY = 8;

/** How often the readout is recomputed while the tab is visible.
 *
 *  NOT `requestAnimationFrame`. The bar is quantised to 40 steps and the
 *  percentage is an integer, so at 60fps the overwhelming majority of frames
 *  would compute the same two values and write nothing. 12/s is past the point
 *  where the counter reads as continuous. */
const INTERVAL_MS = 80;

/**
 * NOTHING IS PACED FASTER THAN FOUR SECONDS.
 *
 * The estimate is a floor, not just a target. A read that comes back in half a
 * second used to send the bar straight to its ceiling and sit there, so the
 * only thing anyone saw was a full gauge blinking once.
 *
 * IT IS THE SAME CONSTANT THE HOLD USES, imported rather than restated. The
 * hold keeps the loading state on screen for `MIN_LOADING_MS`; pacing the ramp
 * to the same number means the bar reaches the top of its travel exactly as the
 * hold expires. Two separate constants would drift, and a bar that leaves at
 * 70% or one that sits full for a second both read as broken.
 */
const MIN_EXPECTED_MS = MIN_LOADING_MS;

/**
 * The curve, and why it is not the single exponential it started as.
 *
 * `1 - e^(-1.9u)` is smooth and asymptotic, which is right for the tail and
 * wrong for the beginning: it front-loads, so the first second ate a third of
 * the bar and the rest crawled. What is wanted is a STEADY fill for as long as
 * the estimate holds, and a creep once it does not.
 *
 * So it is linear to `RAMP_TO` across the expected duration — at the three
 * second floor that is 0.94/3 ≈ 31% a second — and then eases from there toward
 * `CEIL`, never reaching it. 100% would mean the
 * data is here, and if the data were here this component would be unmounted.
 */
const RAMP_TO = 0.94;
const CEIL = 0.99;
const TAIL_K = 0.9;

interface UplinkLoaderProps {
  /** The section's identity hue, resolved from `--hue-<name>` in the CSS. */
  hue?: FireflyHue;
  /** Which screen this is, for the timing store. Loads are measured per key. */
  timingKey: string;
}

export function UplinkLoader({ hue, timingKey }: UplinkLoaderProps) {
  const [elapsed, setElapsed] = useState(0);

  /* Read ONCE per mount rather than per render: the estimate is written back on
     unmount, and re-reading it live would let this load's own sample move the
     target the bar is travelling toward. */
  const expected = useRef(0);
  if (expected.current === 0) {
    expected.current = Math.max(MIN_EXPECTED_MS, expectedDuration(timingKey));
  }

  useEffect(() => {
    const started = performance.now();
    let id = 0;

    const update = () => setElapsed(performance.now() - started);
    const start = () => {
      if (!id) id = window.setInterval(update, INTERVAL_MS);
    };
    const stop = () => {
      if (id) window.clearInterval(id);
      id = 0;
    };
    /* A hidden tab is not watching a progress bar, and browsers throttle the
       timer anyway. `update()` on the way back in catches the readout up in one
       step rather than letting it crawl. */
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        update();
        start();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      /* UNMOUNT IS COMPLETION. Every one of the twelve call sites renders this
         while and only while its read is in flight, so the time this component
         existed for IS the load. `recordDuration` filters the implausible and
         the store takes a median, which is what absorbs the unmounts that were
         really a navigation or a fast failure. */
      recordDuration(timingKey, performance.now() - started);
    };
  }, [timingKey]);

  const u = elapsed / expected.current;
  const progress =
    u <= 1
      ? RAMP_TO * u
      : RAMP_TO + (CEIL - RAMP_TO) * (1 - Math.exp(-(u - 1) * TAIL_K));
  /* The ceiling is the curve's, not a clamp bolted on top — `Math.min(99, …)`
     was what made a fast read park on 99 and look stuck. */
  const pct = Math.floor(progress * 100);
  const lit = Math.min(TICKS, Math.round(progress * TICKS));
  const seconds = Math.floor(elapsed / 1000);
  /* Past the expectation the honest thing is to say so rather than to keep
     implying the estimate still holds. */
  const over = elapsed > expected.current * 1.25;
  /* Remaining, from the same measured estimate the bar is paced by — so the
     status line says something true rather than repeating the percentage in
     words. Once it is overrun there is no estimate left to quote. */
  const remaining = Math.max(0, Math.ceil((expected.current - elapsed) / 1000));

  return (
    /* `data-uplink*` are the stable hooks. CSS modules hash class names, and
       `[class*="tick"]` would also catch a `tickMark` or a `ticker` — the
       substring trap `CLAUDE.md` records. Attributes are how everything else in
       this codebase is found: `data-slot`, `data-card-key`, `data-dock-item`. */
    <div className={styles.rig} data-uplink data-hue={hue} aria-hidden="true">
      <div className={styles.scan} />

      {/* Four corner brackets, each with the reference's rotated diamond. All
          static geometry — the reference pulses the diamonds on a 3.2s infinite
          loop and that is the one thing from it this project cannot have. */}
      <div className={styles.frame}>
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <i key={c} className={`${styles.corner} ${styles[c]}`}>
            <i className={styles.diamond} />
          </i>
        ))}
      </div>

      <div className={styles.head}>
        <div className={styles.plate} data-full={lit >= TICKS || undefined}>
          <span className={styles.num} data-uplink-pct>{pct}</span>
          <span className={styles.unit}>%</span>
        </div>
        <div className={styles.meta}>
          <span className={styles.kicker}>READING</span>
          <span className={styles.clock}>
            {seconds}s{over ? ' · longer than usual' : ''}
          </span>
        </div>
      </div>

      {/* THE BAR, FLANKED BY THE REFERENCE'S SIDE RAILS.
          A wire, two caps and a module — hatch, reticle, indicator, slab and
          four LEDs — mirrored on the right by a single `scaleX(-1)`, which is
          how the reference does it too. Pure geometry: it exists to give the
          gauge somewhere to be plugged into, and it is what stops a wide rig
          reading as a bar floating in an empty box. */}
      <div className={styles.deck}>
        <div className={styles.rail}>
          <i className={styles.wire} />
          <i className={`${styles.cap} ${styles.capA}`} />
          <i className={`${styles.cap} ${styles.capB}`} />
          <div className={styles.module}>
            <i className={styles.hatch} />
            <i className={styles.reticle} />
            <i className={styles.pip} />
            <i className={styles.slab} />
            <i className={styles.led} />
            <i className={styles.led} />
            <i className={styles.led} />
            <i className={styles.led} />
          </div>
        </div>

        <div className={styles.barWrap}>
          {/* The reference's haze: a soft pool of light under the LIT run only,
              widened by the same fraction the bar is filled. It is a gradient
              sized by a custom property, so advancing the bar costs one style
              write and no extra element. */}
          <i
            className={styles.haze}
            style={{ '--lit': `${(lit / TICKS) * 100}%` } as React.CSSProperties}
          />
          <div className={styles.bar}>
        {Array.from({ length: TICKS }, (_, i) => (
          <i
            key={i}
            data-uplink-tick
            className={`${styles.tick} ${(i + 1) % MARK_EVERY === 0 ? styles.mark : ''}`}
            data-on={i < lit || undefined}
            /* The LEADING tick, which ignites as it lights. The attribute moves
               to a different DOM node each time the bar advances, and landing on
               a new node is what restarts the one-shot animation — no class
               juggling and no forced reflow, which is how the reference has to
               do it from plain JS. */
            data-lead={i === lit - 1 || undefined}
          />
            ))}
          </div>
        </div>

        {/* The right rail is the left one mirrored, exactly as the reference
            does it — one `scaleX(-1)` rather than a second set of offsets to
            keep in step. */}
        <div className={`${styles.rail} ${styles.railRight}`}>
          <i className={styles.wire} />
          <i className={`${styles.cap} ${styles.capA}`} />
          <i className={`${styles.cap} ${styles.capB}`} />
          <div className={styles.module}>
            <i className={styles.hatch} />
            <i className={styles.reticle} />
            <i className={styles.pip} />
            <i className={styles.slab} />
            <i className={styles.led} />
            <i className={styles.led} />
            <i className={styles.led} />
            <i className={styles.led} />
          </div>
        </div>
      </div>

      {/* The reference prints a scripted phase here ("SYNCHRONIZING NODE
          ARRAY"). Inventing stages for a database read would be theatre, so
          this quotes the one thing actually known that the bar does not already
          show: what is left of the measured estimate. Once that is overrun
          there is no estimate to quote, and it says so. */}
      <div className={styles.status}>
        <span className={styles.statusKey}>{timingKey.replace(/-/g, ' ')}</span>
        <span className={styles.statusVal}>
          {over ? 'ESTIMATE EXCEEDED' : remaining > 0 ? `~${remaining}s REMAINING` : 'ANY MOMENT'}
        </span>
      </div>
    </div>
  );
}
