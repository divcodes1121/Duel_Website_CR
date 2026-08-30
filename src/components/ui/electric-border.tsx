import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { pixelRatio, reducedMotion, runLoop } from '../../three/runtime';
import './electric-border.css';

/**
 * VENDORED from React Bits — `ElectricBorder`, the JavaScript + CSS variant.
 * https://reactbits.dev  ·  inspired by @BalintFerenczy
 * https://codepen.io/BalintFerenczy/pen/KwdoyEN
 *
 * A rounded-rectangle path walked at ~one sample every 2 px and displaced by
 * fractal noise, stroked onto a 2D canvas, with three static blurred layers
 * under it for the glow. The noise and the path maths below are the upstream
 * component and are unchanged — that is the thing being vendored.
 *
 * ── SIX DEVIATIONS, ALL DELIBERATE ────────────────────────────────────────
 *
 * 1. **TYPESCRIPT.** The registry ships JSX. `noUnusedLocals` is on here.
 *
 * 2. **THE LOOP IS `runLoop`, NOT A BARE `requestAnimationFrame`.** Upstream
 *    animates for as long as the component is mounted, whether or not anybody
 *    can see it. This project's WebGL layers are all gated on an
 *    IntersectionObserver and on `visibilitychange`, for the reason written at
 *    the top of `three/runtime.ts`: a loop nobody can see is pure cost, and an
 *    unconditional one is what got motion banned project-wide once already.
 *    `runLoop` also caps `delta` at 50 ms, so a backgrounded tab does not
 *    resume by integrating ten seconds of noise in one frame.
 *
 * 3. **`prefers-reduced-motion` RENDERS NO CANVAS AT ALL**, rather than a
 *    slower one — rule 3 of `three/runtime.ts`. The wrapper still paints its
 *    static border, so the box it decorates keeps its edge and its colour and
 *    simply stops moving.
 *
 * 4. **THE PURE MATHS IS AT MODULE SCOPE.** Upstream wraps five pure functions
 *    in `useCallback` and then lists them in the effect's dependency array.
 *    They close over nothing, so the callbacks exist only to be stable — and
 *    this project has already been burned once by a value in a dep array that
 *    was a new identity every render (see the `TopSearch` note in the README).
 *    Hoisting them out deletes the question.
 *
 * 5. **DPR IS `pixelRatio()`**, the shared cap of 2. Upstream caps at 2 as
 *    well; using the shared helper means one place decides.
 *
 * 6. **`borderOffset` IS 40, NOT 60.** It is the transparent margin the canvas
 *    needs so a displaced stroke is not clipped. The displacement is bounded:
 *    the octave amplitudes are a geometric series summing to ~3.24x `chaos`,
 *    so the stroke never leaves ~`chaos * 3.24 * 60` px of the path — 24 px at
 *    the default. 40 clears that with room; 60 was clearing 16% more pixels
 *    every frame for margin that is always transparent.
 *
 * The CSS deviates once more, and says so in its own file.
 */

/* ------------------------------------------------------- the upstream maths */

function random(x: number): number {
  return (Math.sin(x * 12.9898) * 43758.5453) % 1;
}

function noise2D(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;

  const a = random(i + j * 57);
  const b = random(i + 1 + j * 57);
  const c = random(i + (j + 1) * 57);
  const d = random(i + 1 + (j + 1) * 57);

  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);

  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

function octavedNoise(
  x: number,
  octaves: number,
  lacunarity: number,
  gain: number,
  baseAmplitude: number,
  baseFrequency: number,
  time: number,
  seed: number,
  baseFlatness: number,
): number {
  let y = 0;
  let amplitude = baseAmplitude;
  let frequency = baseFrequency;

  for (let i = 0; i < octaves; i += 1) {
    let octaveAmplitude = amplitude;
    if (i === 0) octaveAmplitude *= baseFlatness;
    y += octaveAmplitude * noise2D(frequency * x + seed * 100, time * frequency * 0.3);
    frequency *= lacunarity;
    amplitude *= gain;
  }

  return y;
}

interface Point {
  x: number;
  y: number;
}

function getCornerPoint(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  arcLength: number,
  progress: number,
): Point {
  const angle = startAngle + progress * arcLength;
  return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
}

function getRoundedRectPoint(
  t: number,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
): Point {
  const straightWidth = width - 2 * radius;
  const straightHeight = height - 2 * radius;
  const cornerArc = (Math.PI * radius) / 2;
  const totalPerimeter = 2 * straightWidth + 2 * straightHeight + 4 * cornerArc;
  const distance = t * totalPerimeter;

  let accumulated = 0;

  if (distance <= accumulated + straightWidth) {
    const progress = (distance - accumulated) / straightWidth;
    return { x: left + radius + progress * straightWidth, y: top };
  }
  accumulated += straightWidth;

  if (distance <= accumulated + cornerArc) {
    const progress = (distance - accumulated) / cornerArc;
    return getCornerPoint(left + width - radius, top + radius, radius, -Math.PI / 2, Math.PI / 2, progress);
  }
  accumulated += cornerArc;

  if (distance <= accumulated + straightHeight) {
    const progress = (distance - accumulated) / straightHeight;
    return { x: left + width, y: top + radius + progress * straightHeight };
  }
  accumulated += straightHeight;

  if (distance <= accumulated + cornerArc) {
    const progress = (distance - accumulated) / cornerArc;
    return getCornerPoint(left + width - radius, top + height - radius, radius, 0, Math.PI / 2, progress);
  }
  accumulated += cornerArc;

  if (distance <= accumulated + straightWidth) {
    const progress = (distance - accumulated) / straightWidth;
    return { x: left + width - radius - progress * straightWidth, y: top + height };
  }
  accumulated += straightWidth;

  if (distance <= accumulated + cornerArc) {
    const progress = (distance - accumulated) / cornerArc;
    return getCornerPoint(left + radius, top + height - radius, radius, Math.PI / 2, Math.PI / 2, progress);
  }
  accumulated += cornerArc;

  if (distance <= accumulated + straightHeight) {
    const progress = (distance - accumulated) / straightHeight;
    return { x: left, y: top + height - radius - progress * straightHeight };
  }
  accumulated += straightHeight;

  const progress = (distance - accumulated) / cornerArc;
  return getCornerPoint(left + radius, top + radius, radius, Math.PI, Math.PI / 2, progress);
}

/* ----------------------------------------------------------------- config */

const OCTAVES = 10;
const LACUNARITY = 1.6;
const GAIN = 0.7;
const FREQUENCY = 10;
const BASE_FLATNESS = 0;
const DISPLACEMENT = 60;
/** See deviation 6. */
const BORDER_OFFSET = 40;

export interface ElectricBorderProps {
  children?: ReactNode;
  /** Stroke and glow colour. Any CSS colour — pass a resolved token, not hex. */
  color?: string;
  /** Animation speed multiplier. */
  speed?: number;
  /** Distortion intensity. 0 is a still rounded rectangle. */
  chaos?: number;
  /** Corner radius of the electric path, in pixels. */
  borderRadius?: number;
  className?: string;
  style?: CSSProperties;
}

export function ElectricBorder({
  children,
  color = '#5227FF',
  speed = 1,
  chaos = 0.12,
  borderRadius = 24,
  className,
  style,
}: ElectricBorderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    // Deviation 3: no canvas at all, not a slower one.
    if (reducedMotion()) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = pixelRatio();

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      width = rect.width + BORDER_OFFSET * 2;
      height = rect.height + BORDER_OFFSET * 2;
      dpr = pixelRatio();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    updateSize();

    const draw = (_elapsed: number, delta: number) => {
      timeRef.current += delta * speed;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const borderWidth = width - 2 * BORDER_OFFSET;
      const borderHeight = height - 2 * BORDER_OFFSET;
      if (borderWidth <= 0 || borderHeight <= 0) return;
      const radius = Math.min(borderRadius, Math.min(borderWidth, borderHeight) / 2);

      const perimeter = 2 * (borderWidth + borderHeight) + 2 * Math.PI * radius;
      const sampleCount = Math.max(8, Math.floor(perimeter / 2));

      ctx.beginPath();
      for (let i = 0; i <= sampleCount; i += 1) {
        const progress = i / sampleCount;
        const point = getRoundedRectPoint(
          progress, BORDER_OFFSET, BORDER_OFFSET, borderWidth, borderHeight, radius,
        );
        const nx = octavedNoise(
          progress * 8, OCTAVES, LACUNARITY, GAIN, chaos, FREQUENCY, timeRef.current, 0, BASE_FLATNESS,
        );
        const ny = octavedNoise(
          progress * 8, OCTAVES, LACUNARITY, GAIN, chaos, FREQUENCY, timeRef.current, 1, BASE_FLATNESS,
        );
        const x = point.x + nx * DISPLACEMENT;
        const y = point.y + ny * DISPLACEMENT;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    };

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    const stop = runLoop(container, draw);

    return () => {
      stop();
      observer.disconnect();
    };
  }, [color, speed, chaos, borderRadius]);

  const vars = { '--electric-border-color': color, borderRadius } as CSSProperties;

  return (
    <div ref={containerRef} className={`electric-border ${className ?? ''}`} style={{ ...vars, ...style }}>
      <div className="eb-canvas-container">
        <canvas ref={canvasRef} className="eb-canvas" />
      </div>
      <div className="eb-layers">
        <div className="eb-glow-1" />
        <div className="eb-glow-2" />
        <div className="eb-background-glow" />
      </div>
      <div className="eb-content">{children}</div>
    </div>
  );
}

export default ElectricBorder;
