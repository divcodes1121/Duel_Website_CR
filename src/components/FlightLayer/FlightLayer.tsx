import { motion } from 'framer-motion';
import { useFlightStore } from '../../state/flightStore';

const layerStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  pointerEvents: 'none',
  zIndex: 60,
};

export function FlightLayer() {
  const flights = useFlightStore((s) => s.flights);
  const remove = useFlightStore((s) => s.remove);

  return (
    <div style={layerStyle} aria-hidden="true">
      {flights.map((f) => (
        <motion.img
          key={f.id}
          src={f.src}
          alt=""
          style={{ position: 'absolute', left: 0, top: 0, borderRadius: 8, objectFit: 'contain' }}
          initial={{ x: f.from.x, y: f.from.y, width: f.from.w, height: f.from.h, opacity: 1 }}
          animate={{ x: f.to.x, y: f.to.y, width: f.to.w, height: f.to.h, opacity: 0.9 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28, mass: 0.7 }}
          onAnimationComplete={() => remove(f.id)}
        />
      ))}
    </div>
  );
}
