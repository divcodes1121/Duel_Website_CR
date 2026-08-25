/**
 * Eight cards being thumbed through, for the screens that make you wait.
 *
 * WHY THIS EXISTS AT ALL. Every analytics screen answers a slow read — the
 * Coach's `/coach/predict` is 29-57 s, a cold meta rollup is ~166 s on the
 * spinning H: volume, and a cold page on that disk is ~61x slower than the SSD
 * it used to live on. All eleven of those waits rendered as one line of
 * `--text-muted` centred in an empty panel. Thirty seconds of that does not
 * read as slow, it reads as hung, and the difference between the two is the
 * only thing this component is for.
 *
 * It draws what the server is actually doing: reading decks.
 *
 * ONE DRAW CALL. Eight instances of a single plane, laid out and turned
 * entirely in the vertex shader, so nothing is uploaded per frame and there is
 * no per-card CPU work. The rounded corners are an SDF in the fragment shader
 * rather than a texture — the same trade `gl_PointCoord` makes in Fireflies.
 *
 * NO `precision` DECLARATION IN EITHER STAGE, deliberately. `docs/UI.md`
 * records a uniform declared in both stages at different precisions failing
 * program validation outright ("Precisions of uniform 'uTime' differ") and
 * rendering nothing, silently. three prefixes BOTH shaders with the same
 * default, so saying nothing is the one way the two stages cannot disagree.
 */
import { useEffect, useRef } from 'react';
import type { FireflyHue } from './Fireflies';
import {
  OVERLAY_STYLE,
  autoResize,
  isDark,
  loadThree,
  pixelRatio,
  readToken,
  reducedMotion,
  runLoop,
} from './runtime';

/** A duel deck is eight cards, so the hand is eight cards. */
const COUNT = 8;
/** Card art is 302x363; the plates keep that ratio so they read as cards. */
const CARD_W = 0.42;
const CARD_H = CARD_W * (363 / 302);
/** Widest the fan gets, plus margin — what the camera has to frame. */
const FAN_W = 2.55;
const FOV = 40;

/** Per-theme opacity and blend mode. Additive is only correct on black; see
 *  the longer note in Fireflies.tsx, which this follows exactly. */
const PALETTE = {
  dark: { fallback: '#a1a1a1', opacity: 0.5 },
  light: { fallback: '#646464', opacity: 0.72 },
} as const;

const VERT = `
  attribute float aIndex;
  uniform float uTime;
  varying vec2 vUv;
  varying float vFace;

  void main() {
    float i = aIndex;
    // Where this card sits along the fan, -1 (left) to 1 (right).
    float t = (i / ${(COUNT - 1).toFixed(1)}) * 2.0 - 1.0;

    // The riffle is ONE WAVE travelling along the fan rather than every card
    // turning together — that is what reads as a hand being thumbed through
    // instead of a row of shutters. 0.62 rad of lead per card sets the pitch.
    float ph = uTime * 1.6 - i * 0.62;
    // 1.35 rad is 77 degrees, and the amplitude is doing legibility work rather
    // than being a taste: at the 60 degrees this started on, no card ever got
    // thin enough to open a gap and the whole fan read as one solid slab.
    float ang = sin(ph) * 1.35;

    // Turn the plate about its own vertical axis.
    float c = cos(ang);
    float s = sin(ang);
    vec3 p = vec3(position.x * c, position.y, -position.x * s);

    // Lay the fan out: spread, an arc that drops and recedes at the ends, and a
    // small bob in step with the turn so the wave carries vertically too.
    p.x += t * 0.95;
    p.y += -t * t * 0.09 + sin(ph) * 0.07;
    p.z += -abs(t) * 0.10;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vUv = uv;
    // Edge-on cards go dim. That is what sells them as flat plates rather than
    // as blobs that happen to be changing width.
    vFace = abs(c);
  }
`;

const FRAG = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFace;

  void main() {
    // Rounded-rect SDF in UV space: a few instructions instead of a texture.
    vec2 q = abs(vUv - 0.5) - vec2(0.37, 0.39);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.105;

    float body = smoothstep(0.010, -0.010, d);
    if (body < 0.01) discard;

    // A brighter rim just inside the edge, so a card reads as a plate with a
    // frame rather than as a rounded smudge.
    float rim = smoothstep(0.055, 0.0, abs(d + 0.028));

    float shade = 0.34 + 0.66 * vFace;
    gl_FragColor = vec4(uColor * (shade + rim * 0.85), body * uOpacity * (0.30 + 0.70 * shade));
  }
`;

interface Props {
  /** The section's identity hue, resolved from `--hue-<name>` so the wait
   *  wears the colour of the screen it is holding up. Neutral when absent. */
  hue?: FireflyHue;
}

export function ReadingDeck({ hue }: Props = {}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    // Reduced motion mounts NO canvas — the caller's text is the fallback and
    // is already on screen, so there is nothing to stand in for.
    if (!host || reducedMotion()) return;

    let cleanup: (() => void) | null = null;
    let stopLoop: (() => void) | null = null;
    let stopResize: (() => void) | null = null;
    let disposed = false;

    void loadThree().then((THREE) => {
      if (disposed) return;
      let renderer: import('three').WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      } catch {
        // No WebGL context available (or the 16-per-document ceiling is hit).
        // The label underneath is still the real loading state.
        return;
      }
      renderer.setPixelRatio(pixelRatio());
      Object.assign(renderer.domElement.style, OVERLAY_STYLE);
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);

      /* An InstancedBufferGeometry borrowing one plane's attributes: eight
         cards, one buffer, one draw call. `instanceCount` is what makes the
         single `aIndex` attribute fan out into eight plates. */
      const plane = new THREE.PlaneGeometry(CARD_W, CARD_H);
      const geom = new THREE.InstancedBufferGeometry();
      geom.index = plane.index;
      geom.attributes.position = plane.attributes.position;
      geom.attributes.uv = plane.attributes.uv;
      geom.instanceCount = COUNT;
      geom.setAttribute(
        'aIndex',
        new THREE.InstancedBufferAttribute(
          new Float32Array(Array.from({ length: COUNT }, (_, i) => i)),
          1,
        ),
      );

      const paletteNow = () => {
        const dark = isDark();
        const base = dark ? PALETTE.dark : PALETTE.light;
        return {
          dark,
          color: readToken(hue ? `--hue-${hue}` : '--text-muted', base.fallback),
          opacity: base.opacity,
        };
      };

      const pal0 = paletteNow();
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        // A turning plate shows its back for half of every cycle.
        side: THREE.DoubleSide,
        blending: pal0.dark ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(pal0.color) },
          uOpacity: { value: pal0.opacity },
        },
      });

      scene.add(new THREE.Mesh(geom, material));

      // The theme can change mid-read; without this the cards keep whichever
      // palette they were born with. Same watch Fireflies carries.
      const applyTheme = () => {
        const pal = paletteNow();
        (material.uniforms.uColor.value as import('three').Color).set(pal.color);
        material.uniforms.uOpacity.value = pal.opacity;
        material.blending = pal.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
        material.needsUpdate = true;
      };
      const themeWatch = new MutationObserver(applyTheme);
      themeWatch.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });

      stopResize = autoResize(host, (w, h) => {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        /* Pull back far enough that the whole fan is framed. A fixed camera z
           clipped the outer cards the moment the panel got narrow — which is
           every screen at tablet width, and the two paste screens always. */
        const halfFov = Math.tan((FOV * Math.PI) / 360);
        camera.position.z = Math.max(1.55, FAN_W / (2 * halfFov * camera.aspect));
        camera.updateProjectionMatrix();
      });

      stopLoop = runLoop(host, (elapsed) => {
        material.uniforms.uTime.value = elapsed;
        renderer.render(scene, camera);
      });

      cleanup = () => {
        themeWatch.disconnect();
        stopLoop?.();
        stopResize?.();
        plane.dispose();
        geom.dispose();
        material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      // Unmounting before `loadThree()` resolves is the common case on a fast
      // read — there is no renderer to tear down, only the observers.
      if (cleanup) {
        cleanup();
      } else {
        stopLoop?.();
        stopResize?.();
      }
    };
  }, [hue]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    />
  );
}
