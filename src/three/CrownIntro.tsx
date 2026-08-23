/**
 * The login crown: tumbles in, settles, catches one glint, and stops.
 *
 * The only piece here with no ongoing loop. `runLoop`'s frame callback returns
 * `false` once the animation is done, which tears the rAF down for good — after
 * about three seconds this canvas costs exactly nothing, which is the right
 * trade for something on a screen you pass through rather than sit on.
 *
 * The crown is built from primitives rather than loaded as a model: a glTF
 * would be another asset to host, version and keep in sync with the brand mark,
 * and at this size a band with five spikes is indistinguishable from one.
 */
import { useEffect, useRef, useState } from 'react';
import { loadThree, pixelRatio, reducedMotion, runLoop } from './runtime';

const SETTLE = 1.5;   // seconds of tumble
const GLINT = 2.4;    // when the specular sweep crosses
const END = 3.4;      // stop rendering entirely

/** Ease-out-back: overshoots slightly, which is what makes it feel like weight. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

interface Props {
  /** The flat mark. Shown until WebGL takes over, and whenever it cannot. */
  children: React.ReactNode;
  size?: number;
}

export function CrownIntro({ children, size = 74 }: Props) {
  const hostRef = useRef<HTMLSpanElement>(null);
  // The 3D crown has gaps between its spikes, and the flat icon behind it was
  // showing through them. It stays mounted (it is the fallback) but goes
  // transparent the moment the canvas is actually drawing.
  const [live, setLive] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || reducedMotion()) return;

    let cleanup: (() => void) | null = null;
    let disposed = false;

    void loadThree().then((THREE) => {
      if (disposed || !host) return;
      let renderer: import('three').WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      } catch {
        return;
      }
      renderer.setPixelRatio(pixelRatio());
      renderer.setSize(size, size, false);
      Object.assign(renderer.domElement.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        display: 'block',
      });
      host.appendChild(renderer.domElement);
      setLive(true);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
      camera.position.set(0, 0.1, 4.4);

      const gold = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#f2c14e'),
        metalness: 0.95,
        roughness: 0.25,
      });
      const jewel = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#3b6fe0'),
        metalness: 0.3,
        roughness: 0.15,
        emissive: new THREE.Color('#122a6b'),
        emissiveIntensity: 0.5,
      });

      const crown = new THREE.Group();

      // The band.
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.0, 0.62, 40, 1, true), gold);
      band.position.y = -0.35;
      crown.add(band);

      // Rim, so the band does not end in a visible paper edge.
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.99, 0.075, 12, 40), gold);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = -0.66;
      crown.add(rim);

      // Five spikes with a jewel on each.
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const r = 0.78;
        const tall = i % 2 === 0;
        const h = tall ? 0.95 : 0.66;

        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.26, h, 16), gold);
        spike.position.set(Math.cos(a) * r, 0.06 + h / 2 - 0.35, Math.sin(a) * r);
        crown.add(spike);

        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), jewel);
        ball.position.set(Math.cos(a) * r, 0.06 + h - 0.3, Math.sin(a) * r);
        crown.add(ball);
      }

      scene.add(crown);

      scene.add(new THREE.AmbientLight(0xffffff, 1.15));
      const key = new THREE.DirectionalLight(0xfff2d0, 2.6);
      key.position.set(2, 3, 3);
      scene.add(key);
      const back = new THREE.DirectionalLight(0x86a8ff, 1.5);
      back.position.set(-2.5, -1, -2);
      scene.add(back);
      // Moved during the glint, then parked.
      const glint = new THREE.PointLight(0xffffff, 0, 8);
      glint.position.set(-3, 1.6, 2.4);
      scene.add(glint);

      const stop = runLoop(host, (t) => {
        if (t >= END) {
          // One last frame at the resting pose, then never again.
          crown.rotation.set(0, 0, 0);
          crown.position.y = 0;
          crown.scale.setScalar(1);
          glint.intensity = 0;
          renderer.render(scene, camera);
          return false;
        }

        if (t < SETTLE) {
          const p = easeOutBack(Math.min(1, t / SETTLE));
          crown.rotation.y = (1 - p) * Math.PI * 2.1;
          crown.rotation.x = (1 - p) * 0.9;
          crown.rotation.z = (1 - p) * -0.5;
          crown.position.y = (1 - p) * 1.6;
          crown.scale.setScalar(0.55 + p * 0.45);
        } else {
          // A breath of residual sway that decays to nothing by END.
          const decay = Math.max(0, 1 - (t - SETTLE) / (END - SETTLE));
          crown.rotation.y = Math.sin((t - SETTLE) * 3.1) * 0.09 * decay;
          crown.rotation.x = Math.sin((t - SETTLE) * 2.3) * 0.05 * decay;
          crown.position.y = 0;
          crown.scale.setScalar(1);
        }

        // The glint sweeps left to right once, and only once.
        const g = (t - GLINT) / 0.55;
        glint.intensity = g > 0 && g < 1 ? Math.sin(g * Math.PI) * 22 : 0;
        glint.position.x = -3 + g * 6;

        renderer.render(scene, camera);
      });

      cleanup = () => {
        setLive(false);
        stop();
        scene.traverse((o) => {
          const m = o as import('three').Mesh;
          if (m.geometry) m.geometry.dispose();
        });
        gold.dispose();
        jewel.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [size]);

  return (
    <>
      <span
        aria-hidden="true"
        style={{
          display: 'flex',
          opacity: live ? 0 : 1,
          transition: 'opacity var(--dur-2, 200ms) var(--ease, ease)',
        }}
      >
        {children}
      </span>
      <span
        ref={hostRef}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none' }}
      />
    </>
  );
}
