/**
 * Cards orbiting a tilted ellipse, for the screens that are waiting to be given
 * something.
 *
 * Two of them are genuinely empty by design and say so in one paragraph:
 *
 *   · Deck Analysis and Deck Counter open as a centred ask with roughly 500px
 *     of untouched panel beneath the chips — `PasteIntro`, shared by both.
 *   · The Counter Palette gallery before any folder exists, which is a real
 *     invitation ("create a folder and fill it") on an otherwise blank page.
 *
 * These are silhouettes, not card art: no texture to fetch, no atlas to build,
 * one instanced draw call, and — the part that matters — the panel behind an
 * ask must never go past a level-1 wash, which is the rule that keeps a neutral
 * interface neutral. A ring of real Clash Royale art at readable opacity would
 * be the loudest thing on a screen whose job is to be an empty invitation.
 *
 * No `precision` declaration in either stage, deliberately: `docs/UI.md`
 * records a uniform declared in both stages at different precisions failing
 * program validation outright and rendering nothing, silently. three prefixes
 * both shaders with the same default, so saying nothing is the one way they
 * cannot disagree.
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

/** A deck is eight cards, so the ring is eight cards. */
const DEFAULT_COUNT = 8;
/** Card art is 302x363; the plates keep that ratio so they read as cards.
 *  SMALL, deliberately: the first pass drew each card ~200px tall, which made
 *  the ring the loudest thing on a panel whose whole job is to be an empty
 *  invitation. At this size they read as cards behind the ask rather than as
 *  rectangles in front of it. */
const CARD_W = 0.13;
const CARD_H = CARD_W * (363 / 302);
const RING = 1.3;
const FOV = 42;

const PALETTE = {
  dark: { fallback: '#a1a1a1', opacity: 0.22 },
  light: { fallback: '#646464', opacity: 0.16 },
} as const;

const VERT = `
  attribute float aIndex;
  uniform float uTime;
  uniform float uCount;
  varying vec2 vUv;
  varying float vDepth;

  void main() {
    // Position on the ring, advancing slowly. One revolution is about 40s —
    // fast enough to be alive, slow enough that it is never the thing you are
    // looking at.
    float a = (aIndex / uCount) * 6.2831853 + uTime * 0.16;

    // A tilted ellipse: wide in x, shallow in y, real depth in z. The tilt is
    // what makes it read as a ring seen edge-on rather than as a circle.
    vec3 c = vec3(cos(a) * ${RING.toFixed(2)}, sin(a) * 0.20, sin(a) * 0.55);

    // Each card faces the viewer but leans with its place on the ring, so the
    // far side of the ring shows its cards at an angle.
    float lean = cos(a) * 0.55;
    float cl = cos(lean);
    float sl = sin(lean);
    vec3 p = vec3(position.x * cl, position.y, -position.x * sl) + c;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vUv = uv;
    // Far cards recede. 0 at the back of the ring, 1 at the front.
    vDepth = 0.5 + 0.5 * sin(a);
  }
`;

const FRAG = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vDepth;

  void main() {
    // Rounded-rect SDF in UV space: a few instructions instead of a texture.
    vec2 q = abs(vUv - 0.5) - vec2(0.37, 0.39);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.105;

    // An OUTLINE, not a filled plate. A ring of solid cards behind a headline
    // competes with it; a drawn edge sits behind it.
    float edge = smoothstep(0.028, 0.0, abs(d + 0.014));
    float fill = smoothstep(0.012, -0.02, d) * 0.16;
    float m = edge * 0.85 + fill;
    if (m < 0.006) discard;

    gl_FragColor = vec4(uColor, m * uOpacity * (0.35 + 0.65 * vDepth));
  }
`;

interface Props {
  /** The section's identity hue, resolved from `--hue-<name>` so the ring
   *  wears the colour of the screen it is inviting you into. */
  hue?: FireflyHue;
  /** How many cards on the ring. Eight is a deck; the palette gallery asks for
   *  fewer, because it is inviting a FOLDER rather than a deck. */
  count?: number;
}

export function DeckOrbit({ hue, count = DEFAULT_COUNT }: Props = {}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    // Reduced motion mounts no canvas — the copy it decorates is the fallback
    // and is already on screen.
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
        return;
      }
      renderer.setPixelRatio(pixelRatio());
      Object.assign(renderer.domElement.style, OVERLAY_STYLE);
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);

      const plane = new THREE.PlaneGeometry(CARD_W, CARD_H);
      const geom = new THREE.InstancedBufferGeometry();
      geom.index = plane.index;
      geom.attributes.position = plane.attributes.position;
      geom.attributes.uv = plane.attributes.uv;
      geom.instanceCount = count;
      geom.setAttribute(
        'aIndex',
        new THREE.InstancedBufferAttribute(
          new Float32Array(Array.from({ length: count }, (_, i) => i)),
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
        // A card on the far side of the ring shows its back.
        side: THREE.DoubleSide,
        // Additive is only correct on black — see the long note in Fireflies.
        blending: pal0.dark ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uTime: { value: 0 },
          uCount: { value: count },
          uColor: { value: new THREE.Color(pal0.color) },
          uOpacity: { value: pal0.opacity },
        },
      });
      scene.add(new THREE.Mesh(geom, material));

      const applyPalette = () => {
        const pal = paletteNow();
        (material.uniforms.uColor.value as import('three').Color).set(pal.color);
        material.uniforms.uOpacity.value = pal.opacity;
        material.blending = pal.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
        material.needsUpdate = true;
      };
      const themeWatch = new MutationObserver(applyPalette);
      themeWatch.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });

      stopResize = autoResize(host, (w, h) => {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        /* Frame the whole ring however narrow the panel gets. A fixed camera z
           clipped the outer cards the moment the window came down to tablet
           width, which on these two screens is a common size rather than an
           edge case. */
        const halfFov = Math.tan((FOV * Math.PI) / 360);
        camera.position.z = Math.max(2.6, (RING * 2 + CARD_W) / (2 * halfFov * camera.aspect));
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
      if (cleanup) {
        cleanup();
      } else {
        stopLoop?.();
        stopResize?.();
      }
    };
  }, [hue, count]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}
    />
  );
}
