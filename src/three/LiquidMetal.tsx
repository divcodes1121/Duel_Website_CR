/**
 * Liquid metal on the circular icon buttons — one canvas for all of them.
 *
 * Adapted from ThreeUI's `LiquidMetalButton` (Play Circle). Two things about
 * this app decided what could come across and what could not.
 *
 * ── SIZE ─────────────────────────────────────────────────────────────────
 *
 * The reference is a hero control: its diameter clamps to 72-160px, and the
 * bulk of the effect is an interior dispersion field — a scalar field painted
 * through a soft plateau once per wavelength — softened by a half-res gaussian
 * and then bloomed through four more blur passes. Twelve passes a frame.
 *
 * Every circular button in this app is between 1.1rem and 2.2rem. That is
 * 18-35px, so the interior ribbons would be sub-pixel and the bloom would be
 * blurring a thing you cannot see. What survives the shrink is the part that is
 * a THIN STROKE rather than an area: the travelling chromatic rim, the pointer
 * bloom, and the press ripple. Those are kept, close to source. The field and
 * the bloom chain are not.
 *
 * ── CONTEXT BUDGET ───────────────────────────────────────────────────────
 *
 * The reference gives each button its own iframe with its own WebGL2 context.
 * A browser allows about 16 per document, and this project has already paid for
 * that once — the removed card foil had to be rebuilt onto a single shared
 * renderer because the picker draws 122 tiles. The builder screen alone puts
 * dozens of circles on screen.
 *
 * So this is ONE canvas that finds every `[data-metal]` button and draws all of
 * them, instanced. Exactly the shape `DeckFx` already uses for slot rects, and
 * for the same reason.
 *
 * ── AND IT IS IDLE UNTIL YOU TOUCH IT ────────────────────────────────────
 *
 * `CLAUDE.md` bans loops nobody can see. That costs nothing here, because the
 * reference is already built that way: its scene shader opens with
 * `if(uHover <= 0.0015 || pill <= 0.0015){ o = vec4(0.); return; }` — an
 * unhovered button draws nothing at all. So the rAF only spins while something
 * is hovered, pressed, or still carrying a live ripple, and tears down when the
 * last of those settles.
 *
 * WARNING, and this project has now been caught by it three times: THERE ARE NO
 * BACKTICKS IN THE GLSL COMMENTS BELOW. These shaders are template literals and
 * one would end the string, with the error reported dozens of lines away.
 */
import { useEffect, useRef } from 'react';
import { autoResize, isDark, pixelRatio, readToken, reducedMotion } from './runtime';

/** Buttons drawn at once. More than this on screen and the rest go unlit —
 *  they are decoration, and a hard cap is cheaper than a growing buffer. */
const MAX = 24;
/** Concurrent press ripples, so a quick double-tap overlaps instead of cutting
 *  the first one off. The reference keeps three for the same reason. */
const RIPPLES = 3;
/** How far past the button edge the quad reaches, in button radii, so the
 *  bloom is not clipped by its own geometry. */
const PAD = 1.15;
/** Seconds a ripple lives. Past this its slot is free again. */
const RIPPLE_LIFE = 1.6;

const VERT = `#version 300 es
/* LOCATIONS ARE DECLARED HERE, not bound from JS. The gl.bindAttribLocation
   call only takes effect if it runs BEFORE linking; called after, as this was
   first written, it silently does nothing and the buffers end up pointed at
   whatever locations the driver happened to assign.
   (No backticks in this comment. See the warning at the top of the file — it
   was written three lines above and then broken by this very edit.) */
layout(location = 0) in vec2 aCorner;   // unit quad, -1..1
layout(location = 1) in vec4 aRect;     // centre xy (px, y-down), radius, unused
layout(location = 2) in vec4 aState;    // hover, press, seed, draw index
out vec2 vLocal;                        // px from the circle centre
out float vRadius;
out vec4 vState;
uniform vec2 uRes;

void main() {
  vRadius = aRect.z;
  vState = aState;
  vLocal = aCorner * vRadius * ${PAD.toFixed(2)};
  vec2 px = aRect.xy + vLocal;
  // Pixel space, y down, to clip space.
  gl_Position = vec4((px / uRes) * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}
`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vRadius;
in vec4 vState;
out vec4 o;

uniform float uTime;
uniform float uStroke;    // rim half-width, device px
uniform vec3 uTint;       // the theme's base ink for the rim
uniform float uGain;
uniform vec4 uRip[${RIPPLES}];   // x, y (px from centre), birth, owner index

#define PI 3.14159265

// Periodic bump, so a highlight wraps cleanly past angle 0.
float pb(float u, float w) {
  u = fract(u);
  float x = min(u, 1.0 - u);
  return exp(-(x * x) / (w * w));
}

// Three travelling lobes at different speeds and widths. They never quite
// re-align, so the light keeps re-pooling instead of marching evenly.
float rimHot(float s, float t) {
  float v = 0.22;
  v += 0.62 * pb(s - t * 0.070, 0.075);
  v += 0.44 * pb(s + t * 0.044 + 0.41, 0.135);
  v += 0.30 * pb(s - t * 0.024 + 0.73, 0.200);
  return v;
}

// A band riding the circle edge. The offset shifts the band ACROSS the stroke,
// which is what fringes it warm outside and cool inside.
float rimBand(float sd, float off) {
  return 1.0 - smoothstep(0.0, uStroke * 1.05, abs(sd + uStroke * 0.55 + off));
}

void main() {
  float hover = vState.x;
  float press = vState.y;
  float seed = vState.z;

  float d = length(vLocal);
  float sd = d - vRadius;

  // Expanding ring from each press. The wavefront is faceted rather than
  // circular and its crest is a cusp rather than a swell, so it lands as a
  // crease in sheet metal instead of a water ripple.
  float rip = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    if (uRip[i].w < 0.0 || abs(uRip[i].w - vState.w) > 0.5) continue;
    float age = uTime - uRip[i].z;
    if (age < 0.0 || age > ${RIPPLE_LIFE.toFixed(1)}) continue;
    vec2 rp = vLocal - uRip[i].xy;
    float facet = 1.0 + 0.18 * cos(6.0 * atan(rp.y, rp.x) + age * 2.1 + float(i) * 2.4);
    float x = (length(rp) - age * vRadius * 2.4 * facet) / (vRadius * 0.34);
    rip += exp(-pow(abs(x) + 1e-4, 1.15)) * exp(-age * 2.2);
  }

  // Arc-length around the circle, 0..1. For a circle the reference's pill
  // perimeter walk collapses to plain angle, so this is that, unrolled.
  float ang = atan(vLocal.y, vLocal.x);
  float s = fract((ang + PI) / (2.0 * PI) + seed);

  // Pressing lifts the whole outline, and each ripple flares it again as the
  // ring sweeps past, so the rim reports a press twice.
  float lift = 1.0 + press * 0.85 + rip * 1.6;

  // Chromatic offsets: across the stroke AND along it, so the rim fringes
  // red-outside / cyan-inside and its hue also drifts as a highlight slides by.
  // The two together are what read as metal rather than as a moving white dot.
  float chromA = uStroke * 0.42;
  vec3 rim = vec3(
    rimBand(sd,  chromA) * rimHot(s + 0.030, uTime),
    rimBand(sd,  0.0   ) * rimHot(s,         uTime),
    rimBand(sd, -chromA) * rimHot(s - 0.030, uTime)
  );

  // The crest carries a little light of its own, inside the disc only, so it
  // stays legible where the rim is not.
  float inside = 1.0 - smoothstep(-1.0, 1.0, sd);
  vec3 col = rim * lift + vec3(rip * rip) * 0.45 * inside;

  col *= uTint * uGain * hover;

  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  if (a < 0.004) discard;
  o = vec4(col, a);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || 'shader failed');
  }
  return s;
}

interface Slot {
  el: HTMLElement;
  hover: number;
  press: number;
  seed: number;
}

export function LiquidMetal() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || reducedMotion()) return;

    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      display: 'block',
    });
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: 'low-power',
    });
    if (!gl) return;
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
      return;
    }
    gl.useProgram(program);

    const uRes = gl.getUniformLocation(program, 'uRes');
    const uTime = gl.getUniformLocation(program, 'uTime');
    const uStroke = gl.getUniformLocation(program, 'uStroke');
    const uTint = gl.getUniformLocation(program, 'uTint');
    const uGain = gl.getUniformLocation(program, 'uGain');
    const uRip = gl.getUniformLocation(program, 'uRip');

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const rectData = new Float32Array(MAX * 4);
    const stateData = new Float32Array(MAX * 4);
    const rectBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rectData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    const stateBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, stateBuf);
    gl.bufferData(gl.ARRAY_BUFFER, stateData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    gl.enable(gl.BLEND);

    /* THE BLEND MODE IS PART OF THE PALETTE, exactly as it is for the
       fireflies. Additive is only correct on black: adding a warm rim to #000
       reads as light, but on a near-white page colour + white clamps to white
       and the rim is invisible however far it is turned up. Light therefore
       paints a dark rim with normal blending instead. */
    let dark = isDark();
    const applyTheme = () => {
      dark = isDark();
      if (dark) gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      /* Read from the token layer rather than carrying a hex — the same rule
         every other shader in this directory follows. On dark it is the bright
         ink so the additive pass has something to add; on light it is the muted
         one, because a bright rim normal-blended onto white is nothing. */
      const hex = readToken(dark ? '--text' : '--text-muted', dark ? '#ededed' : '#646464');
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
      const rgb = m
        ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
        : [0.93, 0.93, 0.93];
      gl.useProgram(program);
      gl.uniform3f(uTint, rgb[0], rgb[1], rgb[2]);
      gl.uniform1f(uGain, dark ? 1.0 : 1.35);
    };
    applyTheme();
    const themeWatch = new MutationObserver(applyTheme);
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    let dpr = pixelRatio();
    const stopResize = autoResize(host, (w, h) => {
      dpr = pixelRatio();
      canvas.width = Math.max(2, Math.round(w * dpr));
      canvas.height = Math.max(2, Math.round(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    });

    /* ── interaction ───────────────────────────────────────────────────── */

    const slots = new Map<HTMLElement, Slot>();
    const ripples = Array.from({ length: RIPPLES }, () => ({ x: 0, y: 0, born: -99, owner: -1 }));
    let ripNext = 0;
    const ripData = new Float32Array(RIPPLES * 4);
    let pointer: HTMLElement | null = null;
    let held: HTMLElement | null = null;

    const slotFor = (el: HTMLElement): Slot => {
      let s = slots.get(el);
      if (!s) {
        // A per-button phase offset, so two buttons side by side are not
        // running the same highlight in lockstep.
        s = { el, hover: 0, press: 0, seed: Math.random() };
        slots.set(el, s);
      }
      return s;
    };

    const metalUnder = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? target.closest<HTMLElement>('[data-metal]') : null;

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = metalUnder(e.target);
      if (el === pointer) return;
      pointer = el;
      if (el) slotFor(el);
      report();
      kick();
    };
    const report = () => {
      host.dataset.metalState = held ? 'press' : pointer ? 'hot' : 'idle';
    };

    const onDown = (e: PointerEvent) => {
      const el = metalUnder(e.target);
      if (!el) return;
      held = el;
      report();
      slotFor(el);
      const r = el.getBoundingClientRect();
      const slot = ripples[ripNext];
      ripNext = (ripNext + 1) % RIPPLES;
      slot.x = (e.clientX - (r.left + r.width / 2)) * dpr;
      slot.y = (e.clientY - (r.top + r.height / 2)) * dpr;
      slot.born = clock;
      slot.owner = -2; // resolved to the draw index each frame
      (slot as { el?: HTMLElement }).el = el;
      kick();
    };
    const onUp = () => {
      held = null;
      report();
      kick();
    };
    /* Keyboard gets the same treatment, rippling from the centre — otherwise
       the effect is mouse-only, which for a control is a real gap rather than
       a cosmetic one. */
    const onFocus = (e: FocusEvent) => {
      const el = metalUnder(e.target);
      if (el && el.matches(':focus-visible')) {
        pointer = el;
        slotFor(el);
        kick();
      }
    };
    const onBlur = () => {
      pointer = null;
      kick();
    };

    document.addEventListener('pointerover', onOver, { passive: true });
    document.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);

    /* ── the loop, which starts on interaction and stops when it settles ── */

    let raf = 0;
    let clock = 0;
    let last = 0;

    let frames = 0;

    const draw = (now: number) => {
      raf = 0;
      host.dataset.metalFrames = String(++frames);
      /* A NOMINAL FIRST FRAME, NOT ZERO. Every ease here is of the form
         `1 - pow(k, dt)`, and pow(k, 0) is 1, so a dt of 0 gives a step of
         exactly 0: nothing moves. Combined with the liveness test below that
         was fatal — frame one eased nothing, so nothing was drawn, so the loop
         judged itself finished and tore down after a single frame. Measured: 1
         frame in 500ms of hovering, and the rim that looked like it was working
         was the button's own CSS :hover. */
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
      last = now;
      clock += dt;

      /* Liveness is decided by the TARGETS, not by the eased values. Asking
         "is anything lit yet?" cannot start a fade-in, because on the frame the
         pointer arrives nothing is lit yet — that is the whole point of a
         fade-in. */
      let live = pointer !== null || held !== null;
      let n = 0;
      const seen: Slot[] = [];

      for (const slot of slots.values()) {
        const wantHover = slot.el === pointer || slot.el === held ? 1 : 0;
        const wantPress = slot.el === held ? 1 : 0;
        // Asymmetric ease, from the reference: quick to bloom, slower to die.
        const k = wantHover > slot.hover ? 1 - Math.pow(0.0012, dt) : 1 - Math.pow(0.00012, dt);
        slot.hover += (wantHover - slot.hover) * k;
        if (Math.abs(wantHover - slot.hover) < 0.0008) slot.hover = wantHover;
        const pk = wantPress > slot.press ? 1 - Math.pow(1e-9, dt) : 1 - Math.pow(0.004, dt);
        slot.press += (wantPress - slot.press) * pk;
        if (Math.abs(wantPress - slot.press) < 0.002) slot.press = wantPress;

        // Draw it if it is lit OR is about to be: skipping a slot whose target
        // is on would stall it at zero for exactly as long as it is hovered.
        if (slot.hover < 0.002 && slot.press < 0.002 && !wantHover && !wantPress) continue;
        if (!slot.el.isConnected) continue;
        if (n >= MAX) break;

        const r = slot.el.getBoundingClientRect();
        if (r.width < 1) continue;
        rectData[n * 4] = (r.left + r.width / 2) * dpr;
        rectData[n * 4 + 1] = (r.top + r.height / 2) * dpr;
        rectData[n * 4 + 2] = (Math.min(r.width, r.height) / 2) * dpr;
        rectData[n * 4 + 3] = 0;
        stateData[n * 4] = slot.hover;
        stateData[n * 4 + 1] = slot.press;
        stateData[n * 4 + 2] = slot.seed;
        stateData[n * 4 + 3] = n;   // the owner index its ripples are keyed to
        seen.push(slot);
        n++;
        live = true;
      }

      // Ripples carry the index of the button they belong to, resolved here
      // because the draw order changes as buttons come and go.
      for (let i = 0; i < RIPPLES; i++) {
        const rip = ripples[i] as { x: number; y: number; born: number; owner: number; el?: HTMLElement };
        const age = clock - rip.born;
        const owner = rip.el ? seen.findIndex((s) => s.el === rip.el) : -1;
        const alive = owner >= 0 && age >= 0 && age <= RIPPLE_LIFE;
        ripData[i * 4] = rip.x;
        ripData[i * 4 + 1] = rip.y;
        ripData[i * 4 + 2] = rip.born;
        ripData[i * 4 + 3] = alive ? owner : -1;
        if (alive) live = true;
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (n > 0) {
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        gl.uniform1f(uTime, clock);
        // The reference ties its stroke to the button height; at these sizes a
        // proportional stroke vanishes, so it is pinned to device pixels with a
        // floor. Below about 1.2 device px the chromatic offsets land on the
        // same pixel and the fringing disappears entirely.
        gl.uniform1f(uStroke, Math.max(1.35, 1.1 * dpr));
        gl.uniform4fv(uRip, ripData);
        gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, rectData, 0, n * 4);
        gl.bindBuffer(gl.ARRAY_BUFFER, stateBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, stateData, 0, n * 4);

        // ONE call for every lit button. The first version looped, issuing an
        // instanced draw of 1 each time and re-pointing the attribute offsets
        // between them, purely so a `uOwner` uniform could tell each button
        // which ripples were its own. Carrying that index as a per-instance
        // attribute deletes the loop and the offset arithmetic with it.
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      }

      // Settled: drop the frame loop entirely rather than spinning on a canvas
      // that is now empty.
      if (live) raf = requestAnimationFrame(draw);
      else {
        for (const slot of [...slots.values()]) {
          if (slot.hover === 0 && slot.press === 0) slots.delete(slot.el);
        }
        last = 0;
      }
    };

    function kick() {
      if (raf || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(draw);
    }

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else kick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      themeWatch.disconnect();
      stopResize();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 3 }}
    />
  );
}
