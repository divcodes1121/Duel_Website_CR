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

const DEFAULT_COUNT = 130;

/**
 * Per-theme colour, opacity and blend mode.
 *
 * ADDITIVE IS ONLY CORRECT ON BLACK. On the dark page (--bg-1 is true #000)
 * adding warm gold reads as light. On the light page, colour + near-white
 * clamps to white, so an additive mote is invisible no matter how bright it is
 * turned up — light has to paint a warm amber over the page with normal
 * blending instead.
 */
const PALETTE = {
  dark: { color: '#ffdd94', opacity: 0.78 },
  // Light is the brand green -- `--hue-green` / `--solid-green` in light theme,
  // the same deep forest "Dominate." is set in. Amber read as warm dust; green
  // reads as the site. Higher opacity than it looks like it needs because most
  // of these are seen THROUGH a 90% panel, which leaves a tenth of them.
  light: { color: '#047857', opacity: 0.95 },
} as const;

/** The four identity hues a section can own, as they are named in `index.css`. */
export type FireflyHue = 'violet' | 'blue' | 'green' | 'pink';

interface Props {
  /** How many motes. The app-wide layer covers far more area than a hero
   *  panel does, so it wants more of them to read as anything at all. */
  count?: number;
  /** `fixed` pins the layer to the viewport instead of the parent box, for the
   *  app-wide backdrop that has to sit behind a scrolling shell. */
  fixed?: boolean;
  /**
   * Tint the motes with a section's identity hue instead of the ambient
   * gold/green pair.
   *
   * Resolved from `--hue-<name>` at runtime rather than taken as a hex, so the
   * caller names a ROLE and the theme decides the value — and so this layer
   * still defines no colour of its own. Both steps happen to suit their own
   * blend mode: the dark `--hue-*` values are bright pastels, which is what
   * additive on black wants, and the light ones are deep, which is what normal
   * blending on white wants.
   */
  hue?: FireflyHue;
  /** Scales the palette's opacity. A layer sitting behind blurred content can
   *  afford less than one over a painted hero. */
  intensity?: number;
}

const VERT = `
  attribute float aSize;
  attribute float aPhase;
  attribute float aDrift;
  uniform float uTime;
  uniform float uScale;
  uniform float uSpan;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    // Named hSpan, NOT the obvious spelling: h-a-l-f is a reserved word in
    // GLSL ES and the program will not compile with it.
    // (And note there are no backticks in this comment. These shaders are JS
    //  template literals, so one would end the string here and the error would
    //  be reported dozens of lines away. This file already warns about that
    //  below; it caught me again anyway.)
    float hSpan = uSpan * 0.5;
    // Slow vertical rise with a lateral sway; motes wrap rather than respawn,
    // so there is no popping and no allocation per frame.
    p.y = mod(p.y + uTime * aDrift + aPhase, uSpan) - hSpan;
    p.x += sin(uTime * 0.35 + aPhase * 6.28) * 0.06;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / -mv.z;

    // Fade at the top and bottom of the band so nothing has a hard edge. It is
    // a FRACTION of the span, not a fixed 1.2/0.75: hardcoding it meant that
    // widening the band for the app-wide layer would have moved the mote field
    // out but left the fade where it was, which is the same bug in reverse.
    vAlpha = smoothstep(hSpan, hSpan * 0.62, abs(p.y)) * (0.35 + 0.65 * fract(aPhase * 3.7));
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

export function Fireflies({ count = DEFAULT_COUNT, fixed = false, hue, intensity = 1 }: Props = {}) {
  const hostRef = useRef<HTMLDivElement>(null);

  /* THE HUE IS READ THROUGH A REF, AND IT IS NOT A DEPENDENCY.
   *
   * The app-wide layer changes hue every time you open a different analytics
   * area. If `hue` were in the effect's dependency list, each of those would
   * dispose a WebGL context and build a new one — re-uploading the geometry,
   * losing the motes' positions so the whole field restarts, and spending a
   * context from the ~16 a document is allowed. The colour is one uniform;
   * swapping it does not need any of that.
   *
   * So the effect below reads `hueRef` and the small effect here pokes the
   * live material instead. `repaint` is null until `loadThree()` resolves,
   * which is correct — `paletteNow()` reads the ref when it does. */
  const hueRef = useRef(hue);
  const repaint = useRef<(() => void) | null>(null);

  useEffect(() => {
    hueRef.current = hue;
    repaint.current?.();
  }, [hue]);

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

      /* THE VERTICAL SPAN, AND WHY THE FIXED LAYER NEEDS ITS OWN.
       *
       * The x spread has always widened for `fixed` (4.2 against 2.4) because
       * that layer covers the whole viewport rather than a hero panel. The Y
       * spread was left at 2.4 — motes lived in y +/-1.2, faded to nothing by
       * +/-1.2, and the camera sees +/-1.41 at the near depth band and +/-1.99
       * at the far one. So the bottom of the page had no motes in it at all:
       * measured, the lowest fifth of the viewport changed 8.9 pixels per 10k
       * between frames against 36-51 in the middle.
       *
       * 5.6 covers the far band's +/-1.99 with the fade still ~86% open at the
       * very edge, so the footer gets motes at close to full strength.
       *
       * It is ONE number feeding both the buffer below and the shader's `mod`,
       * because those two disagreeing is exactly how this bug happened. */
      const ySpan = fixed ? 5.6 : 2.4;

      const positions = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      const phases = new Float32Array(count);
      const drifts = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        // Three depth bands. Far motes are smaller, slower and dimmer, which is
        // what makes the parallax legible instead of looking like noise.
        const band = i % 3;
        positions[i * 3] = (Math.random() * 2 - 1) * (fixed ? 4.2 : 2.4);
        positions[i * 3 + 1] = Math.random() * ySpan - ySpan * 0.5;
        positions[i * 3 + 2] = -0.4 - band * 0.7;
        // Pixels, near band first. gl_PointSize divides by view depth, so
        // these are pre-perspective units: keep them near 1 and let uScale do
        // the work, or a near mote fills the banner.
        sizes[i] = (band === 0 ? 2.4 : band === 1 ? 1.65 : 1.1) * (0.75 + Math.random() * 0.5);
        phases[i] = Math.random();
        drifts[i] = 0.035 + Math.random() * 0.05 - band * 0.008;
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
      geom.setAttribute('aDrift', new THREE.BufferAttribute(drifts, 1));

      /* One place decides colour, opacity and blend mode, because all three are
         per-theme and reading them apart is how the light layer ended up
         additive and therefore invisible the first time. */
      const paletteNow = () => {
        const d = isDark();
        const base = d ? PALETTE.dark : PALETTE.light;
        const h = hueRef.current;
        return {
          dark: d,
          color: h ? readToken(`--hue-${h}`, base.color) : base.color,
          opacity: base.opacity * intensity,
        };
      };

      const pal0 = paletteNow();
      /* The colour the motes are easing TOWARD. Opacity and blend mode snap —
         they only change with the theme, where everything else on screen snaps
         too — but the hue changes on every navigation, and a whole field of
         motes cutting from green to maroon in one frame reads as a glitch. The
         loop below eases into it over about half a second. */
      const target = new THREE.Color(pal0.color);
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: pal0.dark ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uTime: { value: 0 },
          uScale: { value: 10 },
          uSpan: { value: ySpan },
          uColor: { value: new THREE.Color(pal0.color) },
          uOpacity: { value: pal0.opacity },
        },
      });

      const points = new THREE.Points(geom, material);
      scene.add(points);

      // The palette is chosen per theme, and the theme can change while this is
      // mounted -- themeStore stamps `data-theme` on <html>. Without this the
      // motes keep whichever colour they were born with, which is how they
      // ended up cold blue on a dark hero the first time.
      /* Re-reads the palette and hands the loop a new target. Called by the
         theme observer AND by the hue effect above, because both change the
         same three things and neither should have its own copy of this. */
      const applyPalette = () => {
        const pal = paletteNow();
        target.set(pal.color);
        material.uniforms.uOpacity.value = pal.opacity;
        // The blend mode is part of the palette, not a fixed choice -- see the
        // note where it is first set.
        material.blending = pal.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
        material.needsUpdate = true;
      };
      repaint.current = applyPalette;
      const themeWatch = new MutationObserver(applyPalette);
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
        // Ease into the section's hue. `runLoop` clamps delta to 0.05, so this
        // cannot overshoot after the loop has been paused off-screen.
        (material.uniforms.uColor.value as import('three').Color).lerp(
          target,
          Math.min(1, delta * 5),
        );
        camera.position.x = eased.x * 0.16;
        camera.position.y = -eased.y * 0.1;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      });

      cleanup = () => {
        repaint.current = null;
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
    // `hue` is deliberately absent — see the note beside `hueRef` above.
  }, [count, fixed, intensity]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{
        position: fixed ? 'fixed' : 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: fixed ? 0 : 1,
      }}
    />
  );
}
