import { useEffect, useState } from 'react';
import { useFlightStore, type Flight } from '../../state/flightStore';
import styles from './FlightLayer.module.css';

/**
 * One card in flight. It mounts at the source rect, then flips to the
 * destination transform on the next frame so the browser has a from-state to
 * transition out of — the CSS equivalent of the spring this used to run.
 */
function FlightCard({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMoving(true));
    // Safety net: `transitionend` never fires if the transition is suppressed
    // (prefers-reduced-motion) or interrupted, and a flight that never settles
    // would be a card stuck on top of the page forever.
    const timer = window.setTimeout(onDone, 600);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [onDone]);

  const { from, to } = flight;
  const transform = moving
    ? `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${to.w / from.w}, ${to.h / from.h})`
    : 'translate(0, 0) scale(1, 1)';

  return (
    <img
      src={flight.src}
      alt=""
      className={styles.flight}
      style={{
        left: from.x,
        top: from.y,
        width: from.w,
        height: from.h,
        transform,
        opacity: moving ? 0.9 : 1,
      }}
      // Both transform and opacity transition; only settle up on the one that
      // defines the flight, or the card would be removed twice.
      onTransitionEnd={(e) => {
        if (e.propertyName === 'transform') onDone();
      }}
    />
  );
}

export function FlightLayer() {
  const flights = useFlightStore((s) => s.flights);
  const remove = useFlightStore((s) => s.remove);

  return (
    <div className={styles.layer} aria-hidden="true">
      {flights.map((f) => (
        <FlightCard key={f.id} flight={f} onDone={() => remove(f.id)} />
      ))}
    </div>
  );
}
