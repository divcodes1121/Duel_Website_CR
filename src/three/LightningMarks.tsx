/**
 * Lightning crawling the Deckkies mark — the VS between two decks.
 *
 * Adapted from ThreeUI's `ElementsCollection` / Lightning. What came across is
 * the TECHNIQUE: rasterise a logo, chamfer it into a signed distance field,
 * then walk fBm-displaced arcs along the |d| = 0 contour so the bolts trace the
 * shape instead of being drawn near it. What did not come across is how the
 * reference ships it, and three things about this app changed the design.
 *
 * ── ONE CANVAS, NOT ONE PER MARK ─────────────────────────────────────────
 *
 * The reference gives each panel its own context. A page of Recent Battles has
 * ten VS marks on it, and a browser allows about sixteen WebGL contexts per
 * document — ten of them for a decoration is most of the budget. So this is
 * ONE fixed canvas that finds every `[data-bolt]` element and draws all of them
 * instanced, which is the shape `LiquidMetal` and `DeckFx` already use here.
 *
 * ── NO STORM BACKDROP ────────────────────────────────────────────────────
 *
 * The reference paints an opaque near-black sky and lights the mark inside it.
 * Dropped into a battle row that is a black rectangle, and in the light theme
 * a black rectangle with the row showing nowhere. This draws ONLY the bolts,
 * premultiplied over a transparent clear, and the logo underneath is a real
 * `<img>` — crisper than an SDF fill and free.
 *
 * ── THE TINT IS A TOKEN, WHICH IS WHAT MAKES LIGHT MODE WORK ─────────────
 *
 * Additive light is invisible on a light background: white plus light is
 * white. `readToken` resolves `--hue-blue` on dark (pale, so it reads as
 * emission) and `--hue-blue-deep` on light (deep, so it reads as a drawn bolt),
 * and normal premultiplied blending then does the right thing in both. That is
 * precisely the case the token reader was written for.
 *
 * ── NO CONTOUR PARTICLES ─────────────────────────────────────────────────
 *
 * The reference throws sparks off the outline. At a 64-96px mark they land
 * within a pixel or two of the edge and read as noise on the logo rather than
 * as sparks, so the particle system — a third of the reference's GPU work — is
 * left out rather than shipped as mush.
 *
 * WARNING, and this project has been caught by it three times: THERE ARE NO
 * BACKTICKS IN THE GLSL BELOW. The shaders are template literals and one would
 * end the string, with the error reported dozens of lines away.
 */
import { useEffect, useRef } from 'react';

import { isDark, pixelRatio, readToken, reducedMotion } from './runtime';

/** The silhouette the field is built from — written by scripts/build-logo.py. */
const MASK_URL = `${import.meta.env.BASE_URL}assets/brand/logo-mask.png`;

/**
 * Field resolution, and how far either side of the edge it measures.
 *
 * The reference uses 512/128. This mark is drawn at under a hundred CSS
 * pixels, so 256 is already several samples per screen pixel, and the chamfer
 * is two sequential passes over the grid in JavaScript — dropping to a quarter
 * of the cells is the difference between a visible hitch on mount and none.
 */
const SDF_SIZE = 256;
const SDF_SPREAD = 64;
const D_RANGE = (SDF_SPREAD * 2) / SDF_SIZE;

/** Marks drawn in one call. Ten battle rows plus the builder, with headroom. */
const MAX = 24;

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aRect;   // centre.xy, half.xy, in device px
layout(location = 2) in float aSeed;
uniform vec2 uRes;
out vec2 vUv;
out float vSeed;
void main(){
  vUv = aCorner;
  vSeed = aSeed;
  vec2 p = aRect.xy + (aCorner - 0.5) * 2.0 * aRect.zw;
  vec2 clip = (p / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

/* The contour walk. `d` is signed distance to the mark in mask-uv units, so
   `abs(d + noise)` is a band that follows the outline however the noise
   displaces it -- that is what makes a bolt trace the shape rather than sit
   beside it. Five layers, coarse to fine, plus a white core and a fork. */
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSDF;
uniform float uTime;
uniform vec3 uTint;
uniform vec3 uHot;
uniform float uGain;
in vec2 vUv;
in float vSeed;
out vec4 frag;

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = r * p * 2.03; a *= 0.5; }
  return v;
}

/* Signed distance, extended analytically past the texture border. Without the
   length() term an out-of-range sample clamps and the field stops growing,
   which draws a rectangle of bolts around the quad instead of around the mark. */
float sdf(vec2 uv){
  vec2 m = 0.5 + (uv - 0.5) * 1.18;
  vec2 mc = clamp(m, 0.0, 1.0);
  float d = (texture(uSDF, vec2(mc.x, 1.0 - mc.y)).r - 0.5) * ${D_RANGE.toFixed(4)};
  return d + length(m - mc);
}

/* Fades the quad's own edges so a bolt cannot end in a hard straight line. */
float edgeFade(vec2 uv){
  return smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x)
       * smoothstep(0.0, 0.08, uv.y) * smoothstep(1.0, 0.92, uv.y);
}

void main(){
  float t = uTime + vSeed * 7.3;
  float d = sdf(vUv);
  vec2 pp = vUv;
  float fade = edgeFade(vUv);

  /* OUTSIDE THE MARK, NOT ACROSS IT.
     The reference draws its logo INSIDE the effect, so bolts crossing the
     glyph are part of the picture. Here the logo is a real image underneath
     and has to stay readable: with the arcs free to run anywhere the contour
     goes they scribbled over the D and through the crown, and the mark stopped
     being a mark.

     The gate below is gentle, because the real work is done by the
     displacement in the loop: abs(n) is always positive, so d - abs(n) * k
     puts each arc's zero crossing OUTSIDE the silhouette by construction.
     Gating a symmetric displacement instead threw away half of every arc,
     which is what made the first quiet version nearly invisible. */
  fade *= smoothstep(-0.035, 0.004, d);

  float lit = 0.0;
  vec3 col = vec3(0.0);

  /* THREE layers, not five. Five all firing at once read as static rather
     than as strikes — at this size the finest two land inside a pixel of the
     coarser ones and only add density. */
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    float layer = fi / 2.0;
    float coarse = fbm(pp * mix(4.0, 11.0, layer) + vec2(t * (1.3 + fi * 0.78), fi * 17.7)) - 0.5;
    float detail = fbm(pp * mix(17.0, 27.0, layer) + vec2(-t * (2.9 + fi * 0.55), fi * 31.7)) - 0.5;
    float n = coarse * mix(0.82, 0.58, layer) + detail * mix(0.18, 0.36, layer);
    float e = abs(d - abs(n) * mix(0.062, 0.028, layer) - 0.004);
    /* SPARSE IN TIME, AND ALONG THE CONTOUR.
       A per-layer flash lights the WHOLE outline at once, which draws a second
       jagged D around the real one and reads as a sketch rather than as
       lightning. arcMask is low-frequency noise in panel space, so only
       stretches of the contour are lit at any moment and the arcs have ends.

       NOT CALLED "patch". That is a RESERVED WORD in GLSL ES 3.0 (it is a
       tessellation qualifier), so the shader failed to compile, the catch
       removed the canvas, and the effect simply was not there — no error in
       the console, nothing on screen, and a component that looked fine. */
    float fl = hash21(vec2(floor(t * (5.0 + fi * 3.4)), fi + vSeed));
    fl = mix(0.10, 1.0, smoothstep(0.32, 0.95, fl));
    float arcMask = smoothstep(0.40, 0.74, fbm(pp * (2.1 + fi * 1.3) + vec2(t * (0.85 + fi * 0.5), fi * 5.1 + vSeed)));
    float width = mix(0.0036, 0.0017, layer);
    float bolt = pow(width / (e + mix(0.0015, 0.0009, layer)), mix(1.38, 1.66, layer)) * fl * arcMask;
    bolt = min(bolt, 5.0) * fade;
    col += bolt * mix(uTint, uHot, pow(layer, 0.75));
    lit += bolt;
  }

  // One brighter channel, rarer still, so a real strike still reads as one.
  float n0 = fbm(pp * 6.5 + vec2(t * 2.8, 7.7)) - 0.5;
  n0 += (fbm(pp * 23.0 + vec2(-t * 4.1, 18.2)) - 0.5) * 0.22;
  float e0 = abs(d - abs(n0) * 0.05 - 0.003);
  float corefl = smoothstep(0.55, 0.98, hash21(vec2(floor(t * 6.0), 11.0 + vSeed)));
  float coreMask = smoothstep(0.46, 0.80, fbm(pp * 2.6 + vec2(t * 1.15, 21.0 + vSeed)));
  float core = min(pow(0.0017 / (e0 + 0.0009), 1.7), 7.0) * corefl * coreMask * fade;
  col += core * uHot;
  lit += core;

  // A faint rim so the mark reads as charged between strikes. Held tight to
  // the edge and weak: at 0.35 it was a halo, which flattened the crown's gold.
  float rim = exp(-max(d, 0.0) / 0.016) * 0.30 * fade;
  col += rim * uTint;
  lit += rim;

  float a = clamp(lit * 0.62 * uGain, 0.0, 1.0);
  col = col / (1.0 + col * 0.35);
  frag = vec4(col * a * uGain, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || 'shader failed';
    gl.deleteShader(sh);
    throw new Error(log);
  }
  return sh;
}

/**
 * Two-pass chamfer, forward then backward.
 *
 * An exact euclidean transform is not worth it here: the field is only read
 * within a few hundredths of the edge, where chamfer's error is under a pixel,
 * and it is the difference between one linear pass and a full Felzenszwalb.
 */
function chamfer(d: Float32Array, n: number) {
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + D1);
      if (y > 0) {
        v = Math.min(v, d[i - n] + D1);
        if (x > 0) v = Math.min(v, d[i - n - 1] + D2);
        if (x < n - 1) v = Math.min(v, d[i - n + 1] + D2);
      }
      d[i] = v;
    }
  }
  for (let y = n - 1; y >= 0; y--) {
    for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x;
      let v = d[i];
      if (x < n - 1) v = Math.min(v, d[i + 1] + D1);
      if (y < n - 1) {
        v = Math.min(v, d[i + n] + D1);
        if (x < n - 1) v = Math.min(v, d[i + n + 1] + D2);
        if (x > 0) v = Math.min(v, d[i + n - 1] + D2);
      }
      d[i] = v;
    }
  }
}

let fieldPromise: Promise<Uint8Array> | null = null;

/** The mark's signed distance field, built once and shared by every mount. */
function loadField(): Promise<Uint8Array> {
  if (fieldPromise) return fieldPromise;
  fieldPromise = new Promise<Uint8Array>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = SDF_SIZE;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('no 2d context'));
      // Inset, so the outline has field on both sides of it at the border.
      const pad = SDF_SIZE * 0.1;
      ctx.drawImage(img, pad, pad, SDF_SIZE - pad * 2, SDF_SIZE - pad * 2);
      const data = ctx.getImageData(0, 0, SDF_SIZE, SDF_SIZE).data;

      const n = SDF_SIZE * SDF_SIZE;
      const out = new Float32Array(n);
      const inn = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const inside = data[i * 4 + 3] > 127;
        out[i] = inside ? 0 : 1e9;
        inn[i] = inside ? 1e9 : 0;
      }
      chamfer(out, SDF_SIZE);
      chamfer(inn, SDF_SIZE);

      const enc = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const d = out[i] - inn[i]; // positive outside, negative inside
        enc[i] = Math.max(0, Math.min(255, Math.round((0.5 + (0.5 * d) / SDF_SPREAD) * 255)));
      }
      resolve(enc);
    };
    img.onerror = () => reject(new Error('mask failed to load'));
    img.src = MASK_URL;
  });
  return fieldPromise;
}

/**
 * Mount once per route. Every `[data-bolt]` element on the page gets lightning
 * drawn over it; nothing else is touched, and nothing runs when none is on
 * screen.
 */
export function LightningMarks() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    // Reduced motion gets the plain logo underneath and nothing else. A slower
    // storm is still a storm.
    if (!host || reducedMotion()) return;

    let disposed = false;
    let cleanup = () => {};

    loadField()
      .then((field) => {
        if (disposed || !hostRef.current) return;
        cleanup = start(hostRef.current, field);
      })
      .catch(() => {
        /* No mask, no lightning. The logo is already drawn in the DOM. */
      });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return <div ref={hostRef} aria-hidden="true" />;
}

function start(host: HTMLDivElement, field: Uint8Array): () => void {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    display: 'block',
    /* 20, AND NOT `auto`.
       The panel body is `z-index: 1` and every analytics panel carries a
       backdrop-filter, so a canvas at `auto` paints UNDERNEATH all of it —
       which is exactly what happened: the shader ran, the marks were found,
       and not one bolt was visible. Above the content, below the popovers
       (the range picker is 60, the profile menu 300) so it cannot cover a
       menu, and `pointer-events: none` keeps it out of the way regardless. */
    zIndex: '20',
  });
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: 'low-power',
  });
  if (!gl) return () => {};
  host.appendChild(canvas);

  const program = gl.createProgram()!;
  try {
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'link failed');
    }
  } catch {
    canvas.remove();
    return () => {};
  }
  gl.useProgram(program);

  const uRes = gl.getUniformLocation(program, 'uRes');
  const uTime = gl.getUniformLocation(program, 'uTime');
  const uTint = gl.getUniformLocation(program, 'uTint');
  const uHot = gl.getUniformLocation(program, 'uHot');
  const uGain = gl.getUniformLocation(program, 'uGain');

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SDF_SIZE, SDF_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, field);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(program, 'uSDF'), 0);

  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const corners = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const rectData = new Float32Array(MAX * 4);
  const rectBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
  gl.bufferData(gl.ARRAY_BUFFER, rectData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  const seedData = new Float32Array(MAX);
  const seedBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
  gl.bufferData(gl.ARRAY_BUFFER, seedData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);
  gl.bindVertexArray(null);

  let tint: [number, number, number] = [0.4, 0.5, 1];
  let hot: [number, number, number] = [1, 1, 1];
  let gain = 1;

  const applyTheme = () => {
    const dark = isDark();
    // Pale on dark so it reads as emission; deep on light so it reads as a
    // drawn bolt. Additive light on white is white, which is why this cannot
    // be one colour with a brightness knob.
    tint = rgb(readToken(dark ? '--hue-blue' : '--hue-blue-deep', dark ? '#93c5fd' : '#1d4ed8'));
    hot = dark ? [1, 1, 1] : rgb(readToken('--hue-violet', '#6d28d9'));
    gain = dark ? 1 : 0.62;
  };
  applyTheme();
  const themeWatch = new MutationObserver(applyTheme);
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let dpr = pixelRatio();
  const resize = () => {
    dpr = pixelRatio();
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  resize();
  window.addEventListener('resize', resize);

  const seeds = new WeakMap<Element, number>();
  let raf = 0;
  let start = 0;

  const draw = (now: number) => {
    raf = 0;
    if (!start) start = now;
    const t = (now - start) / 1000;

    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const marks = document.querySelectorAll<HTMLElement>('[data-bolt]');
    let n = 0;
    for (const el of marks) {
      if (n >= MAX) break;
      const r = el.getBoundingClientRect();
      // Off-screen marks are skipped rather than drawn and clipped: the
      // fragment cost is the whole cost here, and a page of battle rows has
      // most of its marks outside the viewport at any moment.
      if (r.width < 4 || r.bottom < -40 || r.top > window.innerHeight + 40) continue;
      let seed = seeds.get(el);
      if (seed === undefined) {
        seed = Math.random() * 10;
        seeds.set(el, seed);
      }
      // The quad is grown past the mark so bolts have somewhere to go.
      const half = (Math.max(r.width, r.height) / 2) * 1.55 * dpr;
      rectData[n * 4] = (r.left + r.width / 2) * dpr;
      rectData[n * 4 + 1] = (r.top + r.height / 2) * dpr;
      rectData[n * 4 + 2] = half;
      rectData[n * 4 + 3] = half;
      seedData[n] = seed;
      n++;
    }

    if (n > 0) {
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
      gl.uniform3f(uHot, hot[0], hot[1], hot[2]);
      gl.uniform1f(uGain, gain);
      gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, rectData, 0, n * 4);
      gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, seedData, 0, n);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    }

    // Nothing on screen: stop the loop rather than spin on an empty canvas.
    // An IntersectionObserver would need one entry per mark and the marks come
    // and go with the page; a rect test costs less than keeping it in sync.
    if (n > 0 && !document.hidden) raf = requestAnimationFrame(draw);
    else idle();
  };

  let idleTimer = 0;
  const kick = () => {
    if (raf || document.hidden) return;
    raf = requestAnimationFrame(draw);
  };
  /* Poll slowly for a mark scrolling back into view. Twice a second is well
     under a frame's budget and it is the only thing running once the canvas
     goes quiet. */
  function idle() {
    if (idleTimer) return;
    idleTimer = window.setInterval(() => {
      if (document.hidden) return;
      const any = [...document.querySelectorAll<HTMLElement>('[data-bolt]')].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width >= 4 && r.bottom > -40 && r.top < window.innerHeight + 40;
      });
      if (any) {
        window.clearInterval(idleTimer);
        idleTimer = 0;
        kick();
      }
    }, 500);
  }

  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else kick();
  };
  document.addEventListener('visibilitychange', onVisibility);
  kick();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    if (idleTimer) window.clearInterval(idleTimer);
    themeWatch.disconnect();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    gl.deleteTexture(tex);
    gl.deleteProgram(program);
    canvas.remove();
  };
}

/** '#93c5fd' or 'rgb(...)' to 0-1 floats. */
function rgb(value: string): [number, number, number] {
  const v = value.trim();
  if (v.startsWith('#')) {
    const h = v.length === 4
      ? v.slice(1).split('').map((c) => c + c).join('')
      : v.slice(1);
    const int = parseInt(h, 16);
    return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
  }
  const m = v.match(/[\d.]+/g);
  if (m && m.length >= 3) return [+m[0] / 255, +m[1] / 255, +m[2] / 255];
  return [0.4, 0.5, 1];
}
