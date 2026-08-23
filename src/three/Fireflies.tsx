/**
 * Drifting fireflies, with a little parallax.
 *
 * Used over the landing hero and over the login backdrop. The painted art
 * underneath stays exactly as it is — this is a transparent layer above it, not
 * a reconstruction of the scene. Re-rendering painted art in WebGL would lose
 * everything that makes it look painted; adding light in front of it costs one
 * draw call.
 *
 * The motes sit on three depth bands and the camera shifts a few hundredths of
 * a unit with the pointer, so the bands separate as you move. That is the whole
 * trick: parallax reads as depth far more cheaply than anything geometric.
 */
import { useEffect, useRef } from 'react';
import { OVERLAY_STYLE, autoResize, isDark, loadThree, pixelRatio, reducedMotion, runLoop } from './runtime';

const COUNT = 90;

const VERT = `
  attribute float aSize;
  attribute float aPhase;
  attribute float aDrift;
  uniform float uTime;
  uniform float uScale;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    // Slow vertical rise with a lateral sway; motes wrap rather than respawn,
    // so there is no popping and no allocation per frame.
    p.y = mod(p.y + uTime * aDrift + aPhase, 2.4) - 1.2;
    p.x += sin(uTime * 0.35 + aPhase * 6.28) * 0.06;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / -mv.z;

    // Fade at the top and bottom of the band so nothing has a hard edge.
    vAlpha = smoothstep(1.2, 0.75, abs(p.y)) * (0.35 + 0.65 * fract(aPhase * 3.7));
  }
`;

const FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    // Round, soft-edged points. gl_PointCoord saves us a texture entirely.
    float d = length(gl_PointCoord - 0.5);
    float mask = smoothstep(0.5, 0.12, d);
    mask *= mask;
    if (mask < 0.01) discard;
    gl_FragColor = vec4(uColor, mask * vAlpha * uOpacity);
  }
`;

export function Fireflies() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || reducedMotion()) return;

    let stopLoop: (() => void) | null = null;
    let stopResize: (() => void) | null = null;
    let cleanup: (() => void) | null = null;
    let disposed = false;
    const pointer = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    // On the hero's parent, so moving anywhere over the banner drives it.
    const surface = host.parentElement ?? host;
    surface.addEventListener('pointermove', onMove);

    void loadThree().then((THREE) => {
      if (disposed) return;
      let renderer: import('three').WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
      } catch {
        return;
      }
      renderer.setPixelRatio(pixelRatio());
      Object.assign(renderer.domElement.style, OVERLAY_STYLE);
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
      camera.position.z = 3;

      const positions = new Float32Array(COUNT * 3);
      const sizes = new Float32Array(COUNT);
      const phases = new Float32Array(COUNT);
      const drifts = new Float32Array(COUNT);
      for (let i = 0; i < COUNT; i++) {
        // Three depth bands. Far motes are smaller, slower and dimmer, which is
        // what makes the parallax legible instead of looking like noise.
        const band = i % 3;
        positions[i * 3] = (Math.random() * 2 - 1) * 2.4;
        positions[i * 3 + 1] = Math.random() * 2.4 - 1.2;
        positions[i * 3 + 2] = -0.4 - band * 0.7;
        // Pixels, near band first. gl_PointSize divides by view depth, so
        // these are pre-perspective units: keep them near 1 and let uScale do
        // the work, or a near mote fills the banner.
        sizes[i] = (band === 0 ? 2.1 : band === 1 ? 1.45 : 0.95) * (0.75 + Math.random() * 0.5);
        phases[i] = Math.random();
        drifts[i] = 0.035 + Math.random() * 0.05 - band * 0.008;
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
      geom.setAttribute('aDrift', new THREE.BufferAttribute(drifts, 1));

      const dark = isDark();
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uScale: { value: 10 },
          // Warm gold catching torchlight in dark; in light the backdrop is
          // pale and additive white would vanish, so it goes cooler and dimmer.
          uColor: { value: new THREE.Color(dark ? '#ffd27a' : '#7ea6e8') },
          // Additive on a near-black hero climbs fast -- this is deliberately
          // low. Motes should be noticed on the second look, not the first.
          uOpacity: { value: dark ? 0.42 : 0.3 },
        },
      });

      const points = new THREE.Points(geom, material);
      scene.add(points);

      // The palette is chosen per theme, and the theme can change while this is
      // mounted -- themeStore stamps `data-theme` on <html>. Without this the
      // motes keep whichever colour they were born with, which is how they
      // ended up cold blue on a dark hero the first time.
      const applyTheme = () => {
        const d = isDark();
        (material.uniforms.uColor.value as import('three').Color).set(d ? '#ffd27a' : '#7ea6e8');
        material.uniforms.uOpacity.value = d ? 0.42 : 0.3;
      };
      const themeWatch = new MutationObserver(applyTheme);
      themeWatch.observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-theme'],
      });

      stopResize = autoResize(host, (w, h) => {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        material.uniforms.uScale.value = Math.min(h, 520) * 0.021 * pixelRatio();
      });

      stopLoop = runLoop(host, (elapsed, delta) => {
        eased.x += (pointer.x - eased.x) * Math.min(1, delta * 2.2);
        eased.y += (pointer.y - eased.y) * Math.min(1, delta * 2.2);
        material.uniforms.uTime.value = elapsed;
        camera.position.x = eased.x * 0.16;
        camera.position.y = -eased.y * 0.1;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      });

      cleanup = () => {
        themeWatch.disconnect();
        stopLoop?.();
        stopResize?.();
        geom.dispose();
        material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      surface.removeEventListener('pointermove', onMove);
      cleanup ? cleanup() : (stopLoop?.(), stopResize?.());
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
    />
  );
}
