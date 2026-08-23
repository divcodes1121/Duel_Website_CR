/**
 * The elixir figure as a glass drop.
 *
 * A real refractive material (`transmission`) needs a render target and
 * something behind the glass to bend; on a transparent 32 px canvas it costs a
 * lot and reads as flat grey. This fakes it instead: a fresnel rim, a moving
 * specular, and a depth gradient through the body, which is what the eye
 * actually uses to call something glass. The surface wobbles on hover and
 * settles again.
 */
import { useEffect, useRef, useState } from 'react';
import { OVERLAY_STYLE, autoResize, loadThree, pixelRatio, reducedMotion, runLoop } from './runtime';

const VERT = `
  // Must match the fragment stage. three defaults vertex shaders to highp; a
  // uniform declared in BOTH stages at different precisions fails validation
  // outright ("Precisions of uniform 'uTime' differ"), and uTime is shared.
  precision mediump float;
  uniform float uTime;
  uniform float uWobble;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vec3 p = position;
    // Taper toward the top so it reads as an elixir DROP rather than a ball.
    // The bottom stays spherical, which is where the weight should look like
    // it is.
    float taper = mix(1.0, 0.42, smoothstep(-0.1, 1.0, p.y));
    p.xz *= taper;
    p.y = p.y * 1.12 + 0.06;

    // Two out-of-phase lobes so it breathes unevenly, like liquid in a skin.
    float w = sin(p.y * 5.0 + uTime * 3.4) * 0.5 + sin(p.x * 4.0 - uTime * 2.7) * 0.5;
    p += normal * w * 0.055 * uWobble;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  precision mediump float;
  uniform vec3 uCore;
  uniform vec3 uEdge;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vec3 n = normalize(vNormal);
    float fres = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 2.2);

    vec3 lightDir = normalize(vec3(0.5, 0.85, 0.7));
    float spec = pow(max(dot(reflect(-lightDir, n), normalize(vView)), 0.0), 42.0);

    // A second, slower highlight drifting across the body reads as the liquid
    // moving inside rather than the surface being polished.
    float inner = pow(max(dot(n, normalize(vec3(sin(uTime * 0.6), 0.6, 0.8))), 0.0), 6.0);

    vec3 col = mix(uCore, uEdge, fres);
    col += vec3(1.0) * spec * 0.9;
    col += uEdge * inner * 0.35;

    gl_FragColor = vec4(col, 0.55 + fres * 0.45);
  }
`;

interface Props {
  /** Rendered underneath, and the only thing shown when WebGL is unavailable. */
  children: React.ReactNode;
}

/**
 * Wraps the flat glyph and measures it. Deliberately NOT given a size prop: the
 * stats row sizes its own icon, and a hard-coded canvas would quietly change
 * that row's height on every deck panel in the app.
 */
export function ElixirOrb({ children }: Props) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const wobbleRef = useRef(0);
  const hoverRef = useRef(false);
  // The glyph underneath showed through the translucent body and read as two
  // overlapping drops. It stays mounted as the fallback and goes transparent
  // once the canvas is drawing.
  const [live, setLive] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || reducedMotion()) return;

    let stop: (() => void) | null = null;
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
      Object.assign(renderer.domElement.style, OVERLAY_STYLE);
      host.appendChild(renderer.domElement);
      setLive(true);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
      camera.position.z = 3;

      const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        uniforms: {
          uTime: { value: 0 },
          uWobble: { value: 0 },
          // The elixir magenta, which is a fixed brand colour in both themes.
          uCore: { value: new THREE.Color('#7b1f6a') },
          uEdge: { value: new THREE.Color('#ff5cf0') },
        },
      });

      const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), material);
      orb.scale.setScalar(0.82);
      scene.add(orb);

      const stopResize = autoResize(host, (w, h) => {
        const d = Math.max(1, Math.min(w, h));
        renderer.setSize(d, d, false);
      });

      const stopLoop = runLoop(host, (elapsed, delta) => {
        const want = hoverRef.current ? 1 : 0;
        wobbleRef.current += (want - wobbleRef.current) * Math.min(1, delta * 6);
        material.uniforms.uTime.value = elapsed;
        material.uniforms.uWobble.value = wobbleRef.current;
        orb.rotation.y = elapsed * 0.35;
        renderer.render(scene, camera);
      });

      stop = () => {
        setLive(false);
        stopLoop();
        stopResize();
        orb.geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
      if (disposed) stop();
    });

    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  return (
    <span
      ref={hostRef}
      style={{ position: 'relative', display: 'inline-flex' }}
      onPointerEnter={() => {
        hoverRef.current = true;
      }}
      onPointerLeave={() => {
        hoverRef.current = false;
      }}
    >
      <span
        style={{
          display: 'flex',
          opacity: live ? 0 : 1,
          transition: 'opacity var(--dur-2, 200ms) var(--ease, ease)',
        }}
      >
        {children}
      </span>
    </span>
  );
}
