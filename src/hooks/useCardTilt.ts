import { useRef } from 'react';
import { useMotionValue, useSpring, useTransform } from 'framer-motion';

/**
 * Cursor-driven 3D tilt + travelling spotlight for a card element.
 * All output is transform/background only, so it never triggers layout.
 */
export function useCardTilt<T extends HTMLElement>(maxAngle = 9, spotStrength = 0.16) {
  const ref = useRef<T>(null);

  const rotateXRaw = useMotionValue(0);
  const rotateYRaw = useMotionValue(0);
  const rotateX = useSpring(rotateXRaw, { stiffness: 180, damping: 22 });
  const rotateY = useSpring(rotateYRaw, { stiffness: 180, damping: 22 });
  const spotX = useMotionValue(50);
  const spotY = useMotionValue(35);
  const spotlight = useTransform(
    [spotX, spotY],
    ([x, y]) =>
      `radial-gradient(420px circle at ${x}% ${y}%, rgba(183, 140, 255, ${spotStrength}), transparent 65%)`,
  );

  function onMouseMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    rotateYRaw.set(px * maxAngle);
    rotateXRaw.set(-py * maxAngle);
    spotX.set((px + 0.5) * 100);
    spotY.set((py + 0.5) * 100);
  }

  function onMouseLeave() {
    rotateYRaw.set(0);
    rotateXRaw.set(0);
    spotX.set(50);
    spotY.set(35);
  }

  return { ref, rotateX, rotateY, spotlight, onMouseMove, onMouseLeave };
}
