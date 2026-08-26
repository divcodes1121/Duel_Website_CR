/**
 * Everything the deck column draws in WebGL, on ONE canvas.
 *
 * Three behaviours share it, and sharing is the point rather than a saving:
 *
 *   AURA    a slow breathing edge on the empty special slots, and the violet
 *           one on whichever slot is selected. Always on.
 *   BURST   points thrown from a slot a card just landed in, and from a crown
 *           pip just taken. One-shot.
 *   SWEEP   a light crossing a deck's eight slots the moment it becomes legal.
 *           One-shot.
 *
 * A canvas each would want three WebGL contexts on a screen that already spends
 * one on the app-wide backdrop, out of the ~16 a document is allowed — the same
 * ceiling that forced the (since removed) card foil onto a single shared
 * renderer. They would also each need their own resize observer, their own rAF
 * gate, and their own copy of the slot-rect scan the aura is already doing
 * every frame. One canvas, three meshes, three draw calls.
 *
 * ── THE COLOUR RULE THIS OBEYS ────────────────────────────────────────────
 *
 * The obvious design is a hue per slot role — violet Evolution, gold Hero,
 * green Wild. `index.css` forbids it, in as many words:
 *
 *     These three stay NEUTRAL, and that is the point. `--accent-purple`
 *     outlines the Evolution role slot; if it were violet you could not tell
 *     the Evolution slot from the SELECTED slot, because violet is what
 *     selection means.
 *
 * So role identity gets no hue here either. An empty special slot breathes in
 * the app's neutral ink; the selected slot takes `--accent-select`; a completed
 * deck sweeps in `--success`, because green means a positive outcome and a deck
 * becoming legal is one; and a crown burst is `--gold`, which is the one place
 * in this app gold is actually earned ("a crown goes gold only once it is
 * won"). Role is still carried by position, by the EVO/HERO/WILD stub and by
 * the slot's own gems — all of which survive a monochrome screenshot.
 */
import { useEffect, useRef } from 'react';
import { onDeckFx, type DeckFxEvent, type FxRect } from '../state/deckFx';
import { autoResize, isDark, loadThree, pixelRatio, readToken, reducedMotion, runLoop } from './runtime';

/** Enough for Versus at five decks a side; extra slots are simply not drawn. */
const MAX_SLOTS = 40;
/** Slot corner radius, matching `.slot`'s `border-radius: 10px`. */
const RADIUS = 10;
/** How far past the slot the aura quad reaches, so the spill is not clipped by
 *  its own geometry. */
const PAD = 16;

/** Concurrent bursts, and points in each. 6 x 22 = 132 points, one draw call. */
const MAX_BURSTS = 6;
const BURST_POINTS = 22;
const BURST_LIFE = 0.55;

/** Points in one sweep, and how long each lives once its turn comes. The wave
 *  itself takes SWEEP_SPREAD to cross, so the whole thing runs
 *  SWEEP_SPREAD + SWEEP_LIFE. */
const SWEEP_POINTS = 120;
const SWEEP_LIFE = 0.42;
const SWEEP_SPREAD = 0.42;

const PALETTE = {
  /* Two tokens, not one, because the themes do opposite things: on dark the
     edge is ADDED light so it wants the bright ink step, on light it is a soft
     dark edge over a pale panel so it wants the muted one. Reading
     `--text-muted` on both put #a1a1a1 on a near-black panel and it was
     invisible at any opacity worth shipping. */
  dark: { token: '--text', fallback: '#ededed', opacity: 0.8, fx: 0.9 },
  light: { token: '--text-muted', fallback: '#646464', opacity: 0.5, fx: 0.75 },
} as const;

/* ── Aura ──────────────────────────────────────────────────────────────── */

const AURA_VERT = `
  attribute vec4 aRect;
  attribute vec3 aTint;
  attribute float aPhase;
  uniform float uTime;
  varying vec2 vLocal;
  varying vec2 vHalf;
  varying vec3 vTint;
  varying float vPulse;

  void main() {
    vHalf = aRect.zw;
    vTint = aTint;
    // Each slot breathes on its own offset. In unison it reads as the page
    // flashing; offset, it reads as a set of things idling.
    vPulse = 0.5 + 0.5 * sin(uTime * 1.05 + aPhase);

    vLocal = position.xy * 2.0 * (vHalf + vec2(${PAD.toFixed(1)}));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aRect.xy + vLocal, 0.0, 1.0);
  }
`;

const AURA_FRAG = `
  uniform float uOpacity;
  varying vec2 vLocal;
  varying vec2 vHalf;
  varying vec3 vTint;
  varying float vPulse;

  void main() {
    vec2 q = abs(vLocal) - (vHalf - vec2(${RADIUS.toFixed(1)}));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - ${RADIUS.toFixed(1)};

    // A band hugging the INSIDE of the border, plus a faint spill outside it.
    // Deliberately not a filled glow: the slot's EVO / HERO / WILD stub sits in
    // the middle, and washing over the one piece of text that explains the rule
    // would be the opposite of the point.
    float band = smoothstep(18.0, 0.0, abs(d + 8.0));
    float spill = smoothstep(12.0, 0.0, d) * 0.35;

    float a = (band * 0.8 + spill) * uOpacity * (0.35 + 0.65 * vPulse);
    if (a < 0.004) discard;
    gl_FragColor = vec4(vTint, a);
  }
`;

/* ── Burst ─────────────────────────────────────────────────────────────── */

const BURST_VERT = `
  attribute vec2 aVel;
  attribute vec3 aTint;
  attribute float aBirth;
  attribute float aSeed;
  uniform float uTime;
  uniform float uDpr;
  uniform float uLife;
  varying vec3 vTint;
  varying float vFade;

  void main() {
    float age = uTime - aBirth;
    // A dead point is parked outside the frustum rather than branched around
    // in the fragment shader — the vertex stage runs per point, the fragment
    // stage runs per covered pixel.
    //
    // The age-below-zero test is not just a guard: the sweep gives its points
    // STAGGERED births so they light up left to right, so a point whose turn
    // has not come yet is legitimately in the future.
    // (No backticks anywhere in this string - it is a JS template literal and
    //  a stray one ends the shader. That has now cost two debugging rounds.)
    if (aBirth < 0.0 || age < 0.0 || age > uLife) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vFade = 0.0;
      vTint = aTint;
      return;
    }

    float t = age / uLife;
    // Fast off the mark, then settling. A linear throw reads mechanical.
    float e = 1.0 - pow(1.0 - t, 2.4);

    vec2 p = position.xy + aVel * e;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
    // Orthographic and in pixel space, so there is no perspective divide to
    // fight — but gl_PointSize is in DEVICE pixels, hence uDpr.
    gl_PointSize = (2.0 + aSeed * 3.2) * (1.0 - t * 0.55) * uDpr;
    vTint = aTint;
    vFade = 1.0 - t;
  }
`;

const BURST_FRAG = `
  uniform float uOpacity;
  varying vec3 vTint;
  varying float vFade;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float m = smoothstep(0.5, 0.05, d);
    if (m < 0.01) discard;
    // Squared fade: the tail should disappear rather than switch off.
    gl_FragColor = vec4(vTint, m * vFade * vFade * uOpacity);
  }
`;

/* The sweep reuses the BURST shaders above with a longer `uLife` and staggered
   births — see the note in `spawnSweep`. It had its own instanced-quad shader
   and that is what was deleted here. */

export function DeckFx() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || reducedMotion()) return;

    let cleanup: (() => void) | null = null;
    let stopLoop: (() => void) | null = null;
    let stopResize: (() => void) | null = null;
    let stopFx: (() => void) | null = null;
    let disposed = false;

    void loadThree().then((THREE) => {
      if (disposed) return;
      let renderer: import('three').WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
      } catch {
        return;
      }
      const dpr = pixelRatio();
      renderer.setPixelRatio(dpr);
      Object.assign(renderer.domElement.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        display: 'block',
      });
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      /* Pixel space, y DOWN — the same coordinates `getBoundingClientRect`
         reports, so a rect needs no conversion beyond subtracting the host's
         own origin. */
      const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);

      /* A PLANE PER MESH, not one shared between them.
       *
       * The aura and the sweep both want a unit quad, and sharing one
       * `PlaneGeometry`'s `index` and `position` between two
       * InstancedBufferGeometries looks free. It is not: the second mesh to be
       * built never drew a single pixel. Bisected all the way down — the event
       * fired, the listener ran, the rects were computed correctly, the program
       * linked with no error, and a hardcoded 400px quad with a flat fragment
       * colour and `frustumCulled = false` was still invisible. Only the shared
       * buffers were left, and giving each mesh its own plane fixed it.
       *
       * Two extra unit quads cost 8 vertices. */
      const auraPlane = new THREE.PlaneGeometry(1, 1);

      const paletteNow = () => {
        const dark = isDark();
        const base = dark ? PALETTE.dark : PALETTE.light;
        return {
          dark,
          opacity: base.opacity,
          fx: base.fx,
          neutral: new THREE.Color(readToken(base.token, base.fallback)),
          select: new THREE.Color(readToken('--accent-select', '#a78bfa')),
          gold: new THREE.Color(readToken('--gold', '#e8b33c')),
          success: new THREE.Color(readToken('--success', '#34d399')),
        };
      };
      let pal = paletteNow();
      const blendNow = () => (pal.dark ? THREE.AdditiveBlending : THREE.NormalBlending);

      // ── aura ──────────────────────────────────────────────────────────
      const auraRects = new Float32Array(MAX_SLOTS * 4);
      const auraTints = new Float32Array(MAX_SLOTS * 3);
      const auraPhase = new Float32Array(MAX_SLOTS);
      for (let i = 0; i < MAX_SLOTS; i++) auraPhase[i] = (i % 7) * 0.9;

      const auraGeom = new THREE.InstancedBufferGeometry();
      auraGeom.index = auraPlane.index;
      auraGeom.attributes.position = auraPlane.attributes.position;
      auraGeom.instanceCount = 0;
      const aRect = new THREE.InstancedBufferAttribute(auraRects, 4);
      const aTint = new THREE.InstancedBufferAttribute(auraTints, 3);
      aRect.setUsage(THREE.DynamicDrawUsage);
      aTint.setUsage(THREE.DynamicDrawUsage);
      auraGeom.setAttribute('aRect', aRect);
      auraGeom.setAttribute('aTint', aTint);
      auraGeom.setAttribute('aPhase', new THREE.InstancedBufferAttribute(auraPhase, 1));

      const auraMat = new THREE.ShaderMaterial({
        vertexShader: AURA_VERT,
        fragmentShader: AURA_FRAG,
        transparent: true,
        depthWrite: false,
        blending: blendNow(),
        uniforms: { uTime: { value: 0 }, uOpacity: { value: pal.opacity } },
      });
      scene.add(new THREE.Mesh(auraGeom, auraMat));

      // ── burst ─────────────────────────────────────────────────────────
      const N = MAX_BURSTS * BURST_POINTS;
      const bPos = new Float32Array(N * 3);
      const bVel = new Float32Array(N * 2);
      const bTint = new Float32Array(N * 3);
      const bBirth = new Float32Array(N).fill(-1);
      const bSeed = new Float32Array(N);
      for (let i = 0; i < N; i++) bSeed[i] = Math.random();

      const burstGeom = new THREE.BufferGeometry();
      const bPosA = new THREE.BufferAttribute(bPos, 3);
      const bVelA = new THREE.BufferAttribute(bVel, 2);
      const bTintA = new THREE.BufferAttribute(bTint, 3);
      const bBirthA = new THREE.BufferAttribute(bBirth, 1);
      [bPosA, bVelA, bTintA, bBirthA].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
      burstGeom.setAttribute('position', bPosA);
      burstGeom.setAttribute('aVel', bVelA);
      burstGeom.setAttribute('aTint', bTintA);
      burstGeom.setAttribute('aBirth', bBirthA);
      burstGeom.setAttribute('aSeed', new THREE.BufferAttribute(bSeed, 1));

      const burstMat = new THREE.ShaderMaterial({
        vertexShader: BURST_VERT,
        fragmentShader: BURST_FRAG,
        transparent: true,
        depthWrite: false,
        blending: blendNow(),
        uniforms: {
          uTime: { value: 0 },
          uDpr: { value: dpr },
          // The shader used to hardcode this; it became a uniform so the sweep
          // could share these shaders with a different lifetime. Leaving it out
          // here would have left the burst dividing its age by an undefined
          // uniform, i.e. by zero.
          uLife: { value: BURST_LIFE },
          uOpacity: { value: pal.fx },
        },
      });
      scene.add(new THREE.Points(burstGeom, burstMat));

      /* ── sweep ─────────────────────────────────────────────────────────
       *
       * POINTS, ON THE BURST PIPELINE — not the instanced quad this started as.
       *
       * That quad never drew. Bisected the whole way down: the event fired, the
       * listener ran, the rects were right, the program linked with no error,
       * and `renderer.info` reported the draw call ISSUED with its triangles
       * counted. But a hardcoded 400px quad with a flat opaque fragment was
       * still invisible, which only leaves one reading — neither `aRect` nor
       * `uv` was reaching that geometry's shader, so every quad rasterised at
       * zero size. Giving it its own PlaneGeometry, turning off frustum culling
       * and re-uploading the attributes every frame each changed nothing.
       *
       * The burst pipeline, meanwhile, demonstrably works — measured at 27,046
       * changed pixels against a 26px baseline. So the sweep is built out of
       * that instead of out of a second thing that has to be debugged: a line
       * of points across the deck row with STAGGERED births, which lights up
       * left to right and reads as the same travelling light. */
      const sPos = new Float32Array(SWEEP_POINTS * 3);
      const sVel = new Float32Array(SWEEP_POINTS * 2);
      const sTint = new Float32Array(SWEEP_POINTS * 3);
      const sBirth = new Float32Array(SWEEP_POINTS).fill(-1);
      const sSeed = new Float32Array(SWEEP_POINTS);
      for (let i = 0; i < SWEEP_POINTS; i++) sSeed[i] = Math.random();

      const sweepGeom = new THREE.BufferGeometry();
      const sPosA = new THREE.BufferAttribute(sPos, 3);
      const sVelA = new THREE.BufferAttribute(sVel, 2);
      const sTintA = new THREE.BufferAttribute(sTint, 3);
      const sBirthA = new THREE.BufferAttribute(sBirth, 1);
      [sPosA, sVelA, sTintA, sBirthA].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
      sweepGeom.setAttribute('position', sPosA);
      sweepGeom.setAttribute('aVel', sVelA);
      sweepGeom.setAttribute('aTint', sTintA);
      sweepGeom.setAttribute('aBirth', sBirthA);
      sweepGeom.setAttribute('aSeed', new THREE.BufferAttribute(sSeed, 1));

      const sweepMat = new THREE.ShaderMaterial({
        vertexShader: BURST_VERT,
        fragmentShader: BURST_FRAG,
        transparent: true,
        depthWrite: false,
        blending: blendNow(),
        uniforms: {
          uTime: { value: 0 },
          uDpr: { value: dpr },
          uLife: { value: SWEEP_LIFE },
          uOpacity: { value: pal.fx },
        },
      });
      scene.add(new THREE.Points(sweepGeom, sweepMat));

      const applyPalette = () => {
        pal = paletteNow();
        auraMat.uniforms.uOpacity.value = pal.opacity;
        burstMat.uniforms.uOpacity.value = pal.fx;
        sweepMat.uniforms.uOpacity.value = pal.fx;
        for (const m of [auraMat, burstMat, sweepMat]) {
          m.blending = blendNow();
          m.needsUpdate = true;
        }
      };
      const themeWatch = new MutationObserver(applyPalette);
      themeWatch.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });

      /* The deck column is the scroller and this host is pinned over its
         viewport, so a slot scrolled out of sight lands outside the box and is
         dropped rather than drawn behind the toolbar. */
      const scope = host.parentElement ?? host;
      let clock = 0;
      let burstRing = 0;

      /** Host-relative centre of a viewport rect, or null if off the box. */
      const toLocal = (r: FxRect) => {
        const b = host.getBoundingClientRect();
        if (b.width < 1) return null;
        return { x: r.x - b.left + r.w / 2, y: r.y - b.top + r.h / 2, box: b };
      };

      const spawnBurst = (rect: FxRect, tone?: 'gold') => {
        const at = toLocal(rect);
        if (!at) return;
        const tint = tone === 'gold' ? pal.gold : pal.select;
        const base = burstRing * BURST_POINTS;
        burstRing = (burstRing + 1) % MAX_BURSTS;
        const reach = Math.max(18, Math.min(rect.w, rect.h) * 0.62);
        for (let i = 0; i < BURST_POINTS; i++) {
          const k = base + i;
          // A ring with jitter rather than pure random: an even spread reads as
          // a burst, where uniform randomness clumps and reads as a splatter.
          const a = (i / BURST_POINTS) * Math.PI * 2 + Math.random() * 0.5;
          const d = reach * (0.55 + Math.random() * 0.75);
          bPos[k * 3] = at.x;
          bPos[k * 3 + 1] = at.y;
          bPos[k * 3 + 2] = 0;
          bVel[k * 2] = Math.cos(a) * d;
          // Biased upward: debris that only falls reads as gravity, and there
          // is no gravity here.
          bVel[k * 2 + 1] = Math.sin(a) * d - reach * 0.25;
          bTint[k * 3] = tint.r;
          bTint[k * 3 + 1] = tint.g;
          bTint[k * 3 + 2] = tint.b;
          bBirth[k] = clock;
        }
        bPosA.needsUpdate = true;
        bVelA.needsUpdate = true;
        bTintA.needsUpdate = true;
        bBirthA.needsUpdate = true;
      };

      const spawnSweep = (deck: string) => {
        // The eight slots of one deck. `^=` is exact enough: ids are
        // `owner-deckIndex-slotIndex`, so "solo-1-" cannot match "solo-10-0".
        const nodes = scope.querySelectorAll<HTMLElement>(`[data-slot^="${deck}-"]`);
        if (!nodes.length) return;
        const b = host.getBoundingClientRect();
        if (b.width < 1) return;

        let l = Infinity;
        let t = Infinity;
        let r = -Infinity;
        let bot = -Infinity;
        for (const n of nodes) {
          const q = n.getBoundingClientRect();
          if (q.width < 1) continue;
          l = Math.min(l, q.left);
          t = Math.min(t, q.top);
          r = Math.max(r, q.right);
          bot = Math.max(bot, q.bottom);
        }
        if (!Number.isFinite(l)) return;

        const x0 = l - b.left;
        const y0 = t - b.top;
        const w = r - l;
        const h = bot - t;
        const c = pal.success;

        /* THE STAGGER IS THE WHOLE EFFECT. Every point is born at
           `clock + (its share of the width) * SWEEP_SPREAD`, and the shader
           parks anything whose birth is still in the future — so the row lights
           up left to right on its own, with no per-frame work here and no
           travelling geometry to position. */
        for (let i = 0; i < SWEEP_POINTS; i++) {
          const f = i / (SWEEP_POINTS - 1);
          // Jitter across the column so the wave has thickness rather than
          // being a single-pixel rule.
          const jx = (Math.random() - 0.5) * w * 0.03;
          sPos[i * 3] = x0 + f * w + jx;
          sPos[i * 3 + 1] = y0 + Math.random() * h;
          sPos[i * 3 + 2] = 0;
          // Drifting up and slightly along, so the light lifts off the row.
          sVel[i * 2] = (Math.random() - 0.3) * 16;
          sVel[i * 2 + 1] = -12 - Math.random() * 22;
          sTint[i * 3] = c.r;
          sTint[i * 3 + 1] = c.g;
          sTint[i * 3 + 2] = c.b;
          sBirth[i] = clock + f * SWEEP_SPREAD;
        }
        sPosA.needsUpdate = true;
        sVelA.needsUpdate = true;
        sTintA.needsUpdate = true;
        sBirthA.needsUpdate = true;
      };

      stopFx = onDeckFx((e: DeckFxEvent) => {
        if (e.kind === 'burst') spawnBurst(e.rect, e.tone);
        else spawnSweep(e.deck);
      });

      const scanAura = () => {
        const b = host.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) return;
        const nodes = scope.querySelectorAll<HTMLElement>(
          '[data-slot][data-empty]:not([data-role="normal"]), [data-slot][data-selected]',
        );
        let n = 0;
        for (const node of nodes) {
          if (n >= MAX_SLOTS) break;
          const r = node.getBoundingClientRect();
          if (r.width < 1) continue;
          const cy = r.top - b.top + r.height / 2;
          if (cy < -r.height || cy > b.height + r.height) continue;

          auraRects[n * 4] = r.left - b.left + r.width / 2;
          auraRects[n * 4 + 1] = cy;
          auraRects[n * 4 + 2] = r.width / 2;
          auraRects[n * 4 + 3] = r.height / 2;

          // Selected wins over empty: a selected empty special slot is the one
          // you are about to fill, and that is the more useful thing to say.
          const c = node.hasAttribute('data-selected') ? pal.select : pal.neutral;
          auraTints[n * 3] = c.r;
          auraTints[n * 3 + 1] = c.g;
          auraTints[n * 3 + 2] = c.b;
          n++;
        }
        auraGeom.instanceCount = n;
        aRect.needsUpdate = true;
        aTint.needsUpdate = true;
      };

      stopResize = autoResize(host, (w, h) => {
        renderer.setSize(w, h, false);
        camera.left = 0;
        camera.right = w;
        camera.top = 0;
        camera.bottom = h;
        camera.updateProjectionMatrix();
      });

      /* Rects are re-read every frame rather than cached and invalidated.
         Thirty `getBoundingClientRect` calls inside a rAF callback — after
         layout has already settled for the frame — cost well under a tenth of a
         millisecond, and the alternative is a cache invalidated by scroll,
         resize, filter, drag, import, add-deck and remove-deck, six of which
         are easy to forget. The loop is gated on visibility, so it runs only
         while the builder is actually on screen. */
      stopLoop = runLoop(host, (elapsed) => {
        clock = elapsed;
        auraMat.uniforms.uTime.value = elapsed;
        burstMat.uniforms.uTime.value = elapsed;
        sweepMat.uniforms.uTime.value = elapsed;
        scanAura();
        renderer.render(scene, camera);
      });

      cleanup = () => {
        stopFx?.();
        themeWatch.disconnect();
        stopLoop?.();
        stopResize?.();
        auraPlane.dispose();
        auraGeom.dispose();
        burstGeom.dispose();
        sweepGeom.dispose();
        auraMat.dispose();
        burstMat.dispose();
        sweepMat.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      if (cleanup) {
        cleanup();
      } else {
        stopFx?.();
        stopLoop?.();
        stopResize?.();
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  );
}
