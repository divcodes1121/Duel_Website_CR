/**
 * Water behind the closing band.
 *
 * Adapted from ThreeUI's `ElementsCollection` / Water. What came across is the
 * TECHNIQUE — a ping-pong wave equation on a float target, then a render pass
 * that reads the height field's gradient to refract, shade crests and strike a
 * specular glint. What did not come across is how the reference ships it.
 *
 * ── NOT AN IFRAME ────────────────────────────────────────────────────────
 *
 * `ElementsBackground` renders a whole HTML document into a sandboxed iframe
 * via `srcDoc`, string-patches its shader source, and drives it with
 * `postMessage`. That is a gallery's answer to running arbitrary demos side by
 * side; here it would mean a second document, a second WebGL context, and a
 * shader this project cannot typecheck, theme, or read a token from. This app
 * already writes raw WebGL2 directly — see `LiquidMetal` — so the effect is
 * written the same way, in one canvas, in this bundle.
 *
 * ── NO LOGO, SO NO SDF ───────────────────────────────────────────────────
 *
 * The reference's water refracts a rasterised brand mark held in a signed
 * distance field. There is no mark to put here: the band's own text sits above
 * this canvas and must stay legible, so the water is the surface alone. That
 * removes the SDF build, the chamfer pass and the contour extraction — most of
 * the reference's CPU work — and leaves the part that reads as water.
 *
 * ── IT OBEYS THE HOUSE RULES ─────────────────────────────────────────────
 *
 * `runLoop` means it does not run while off screen or on a hidden tab.
 * `reducedMotion` means it draws one still frame and stops. Colour comes from
 * `readToken`, so it follows the theme instead of carrying its own palette —
 * the reference is hard-coded to a near-black ground, which would be a hole in
 * the page in light mode.
 *
 * WARNING, and this project has been caught by it three times: THERE ARE NO
 * BACKTICKS IN THE GLSL BELOW. The shaders are template literals and one would
 * end the string, with the error reported dozens of lines away.
 */
import { useEffect, useRef } from 'react';

import { OVERLAY_STYLE, autoResize, isDark, pixelRatio, readToken, reducedMotion, runLoop } from './runtime';

/** Simulation grid. Square regardless of the canvas, so ripples stay round. */
const SIM = 256;

/** Full-screen triangle. No buffers: gl_VertexID is enough for three points. */
const VERT = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/* The wave equation, ping-ponged. r holds this step's height, g the previous
   one, and the next step is the neighbour average minus the previous value --
   the standard discrete form. The 0.985 is loss: without it the pool rings
   forever, which is both wrong and hypnotic in the bad way. */
const SIM_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec3 uDrop;   // xy in sim space, z = strength
in vec2 vUv;
out vec4 frag;
void main(){
  vec2 s = texture(uState, vUv).rg;
  float l = texture(uState, vUv - vec2(uTexel.x, 0.0)).r;
  float r = texture(uState, vUv + vec2(uTexel.x, 0.0)).r;
  float u = texture(uState, vUv + vec2(0.0, uTexel.y)).r;
  float d = texture(uState, vUv - vec2(0.0, uTexel.y)).r;
  float next = (l + r + u + d) * 0.5 - s.g;
  next *= 0.985;
  if (uDrop.z != 0.0) {
    float dd = distance(vUv, uDrop.xy);
    next += uDrop.z * exp(-dd * dd * 2600.0);
  }
  frag = vec4(next, s.r, 0.0, 1.0);
}`;

/* The surface. Gradient of the height field gives a normal; the normal gives a
   refraction offset, a crest highlight and a specular glint. Everything is
   ADDITIVE over a transparent clear, so the band's own background shows
   through and the text above stays readable. */
const DRAW_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uAspect;
uniform vec3 uTint;
uniform float uGain;
in vec2 vUv;
out vec4 frag;

// Panel uv to the square sim, cover-mapped, so a ripple is a circle on screen
// rather than an ellipse stretched by the band's aspect.
vec2 simUV(vec2 uv){
  float m = max(uAspect, 1.0);
  return 0.5 + (uv - 0.5) * vec2(uAspect, 1.0) / m;
}

void main(){
  vec2 suv = simUV(vUv);
  float hx = texture(uState, suv + vec2(uTexel.x, 0.0)).r
           - texture(uState, suv - vec2(uTexel.x, 0.0)).r;
  float hy = texture(uState, suv + vec2(0.0, uTexel.y)).r
           - texture(uState, suv - vec2(0.0, uTexel.y)).r;
  float h  = texture(uState, suv).r;
  vec2 grad = vec2(hx, hy);
  vec3 nrm = normalize(vec3(-grad * 26.0, 1.0));

  // Crests catch the tint, troughs give it back. Signed, so still water is
  // exactly nothing and the band looks untouched until something moves.
  vec3 col = uTint * clamp(h * 1.7, -0.35, 1.0) * 0.55;
  col += uTint * pow(clamp(h * 2.4, 0.0, 1.0), 2.0) * 0.5;

  vec3 L = normalize(vec3(-0.35, 0.55, 0.75));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  col += pow(max(dot(nrm, H), 0.0), 120.0) * uTint * 1.1;

  // Fade at the edges so the effect ends inside the card instead of cutting
  // off against its border.
  float fade = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x)
             * smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.78, vUv.y);

  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0) * fade * uGain;
  if (a < 0.004) discard;
  frag = vec4(col * fade * uGain, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram();
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  if (!p || !v || !f) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

/** Water inside its host. The host must be `position: relative`. */
export function WaterBand({ hue = '--hue-blue' }: { hue?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, OVERLAY_STYLE);
    host.appendChild(canvas);

    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true });
    // FLOAT TARGETS OR NOTHING. The sim needs somewhere to keep a signed
    // height; without the extension there is no half-float colour buffer and
    // the honest answer is no water rather than a broken one.
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
      canvas.remove();
      return;
    }

    const simProg = link(gl, VERT, SIM_FRAG);
    const drawProg = link(gl, VERT, DRAW_FRAG);
    if (!simProg || !drawProg) {
      canvas.remove();
      return;
    }

    const tex: WebGLTexture[] = [];
    const fbo: WebGLFramebuffer[] = [];
    for (let i = 0; i < 2; i++) {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, SIM, SIM, 0, gl.RG, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      tex.push(t);
      fbo.push(f);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const uSim = {
      state: gl.getUniformLocation(simProg, 'uState'),
      texel: gl.getUniformLocation(simProg, 'uTexel'),
      drop: gl.getUniformLocation(simProg, 'uDrop'),
    };
    const uDraw = {
      state: gl.getUniformLocation(drawProg, 'uState'),
      texel: gl.getUniformLocation(drawProg, 'uTexel'),
      aspect: gl.getUniformLocation(drawProg, 'uAspect'),
      tint: gl.getUniformLocation(drawProg, 'uTint'),
      gain: gl.getUniformLocation(drawProg, 'uGain'),
    };

    /* The tint comes from the palette, not from the shader. Light mode wants a
       far quieter surface: the reference sits on near-black, where a bright
       crest reads as a highlight; on a pale card the same value is a smear. */
    const parse = (css: string): [number, number, number] => {
      const m = css.match(/#([0-9a-f]{6})/i);
      if (!m) return [0.35, 0.62, 0.95];
      const n = parseInt(m[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };
    const tint = parse(readToken(hue, '#5aa2f5'));
    const gain = isDark() ? 1 : 0.45;

    let src = 0;
    let aspect = 1;
    const drops: { x: number; y: number; s: number }[] = [];
    let nextAuto = 0.4;

    const stopResize = autoResize(host, (w, h) => {
      const dpr = pixelRatio();
      canvas.width = Math.max(2, Math.round(w * dpr));
      canvas.height = Math.max(2, Math.round(h * dpr));
      aspect = canvas.width / canvas.height;
    });

    /* Panel uv to sim uv, matching simUV() in the shader exactly. If these two
       disagree the ripple appears somewhere other than the cursor, which is
       the kind of bug that looks like bad input handling. */
    const toSim = (x: number, y: number) => {
      const m = Math.max(aspect, 1);
      return { x: 0.5 + (x - 0.5) * aspect / m, y: 0.5 + (y - 0.5) / m };
    };

    let last: { x: number; y: number; t: number } | null = null;
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      const now = performance.now();
      if (last) {
        const dt = Math.max(8, now - last.t);
        const speed = Math.hypot(x - last.x, y - last.y) / (dt / 1000);
        // Only a MOVING pointer disturbs the surface. A cursor resting on the
        // card should not drill a hole in it.
        if (speed > 0.05 && drops.length < 6) drops.push({ x, y, s: Math.min(speed * 0.10, 0.42) });
      }
      last = { x, y, t: now };
    };
    const onDown = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      drops.push({
        x: (e.clientX - r.left) / r.width,
        y: 1 - (e.clientY - r.top) / r.height,
        s: 0.75,
      });
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerdown', onDown);

    const step = (t: number) => {
      // A slow drip keeps the surface alive when nobody is touching it. Without
      // it the band is a flat rectangle until someone happens to hover.
      if (t > nextAuto) {
        drops.push({ x: 0.12 + Math.random() * 0.76, y: 0.12 + Math.random() * 0.76, s: 0.10 + Math.random() * 0.18 });
        nextAuto = t + 1.4 + Math.random() * 2.6;
      }
      gl.useProgram(simProg);
      gl.viewport(0, 0, SIM, SIM);
      gl.uniform2f(uSim.texel, 1 / SIM, 1 / SIM);
      // Two sub-steps per frame: the wave equation is stable but slow at one,
      // and ripples that crawl read as fog rather than water.
      for (let i = 0; i < 2; i++) {
        const d = drops.shift();
        if (d) {
          const s = toSim(d.x, d.y);
          gl.uniform3f(uSim.drop, s.x, s.y, d.s);
        } else {
          gl.uniform3f(uSim.drop, 0, 0, 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[1 - src]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex[src]);
        gl.uniform1i(uSim.state, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = 1 - src;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      gl.useProgram(drawProg);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex[src]);
      gl.uniform1i(uDraw.state, 0);
      gl.uniform2f(uDraw.texel, 1 / SIM, 1 / SIM);
      gl.uniform1f(uDraw.aspect, aspect);
      gl.uniform3f(uDraw.tint, tint[0], tint[1], tint[2]);
      gl.uniform1f(uDraw.gain, gain);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let stopLoop = () => {};
    if (reducedMotion()) {
      // One drop, a few steps, one frame, then nothing moves again.
      drops.push({ x: 0.5, y: 0.55, s: 0.5 });
      for (let i = 0; i < 24; i++) step(i * 0.016);
    } else {
      stopLoop = runLoop(host, (elapsed) => {
        step(elapsed);
      });
    }

    return () => {
      stopLoop();
      stopResize();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerdown', onDown);
      fbo.forEach((f) => gl.deleteFramebuffer(f));
      tex.forEach((t) => gl.deleteTexture(t));
      gl.deleteProgram(simProg);
      gl.deleteProgram(drawProg);
      canvas.remove();
    };
  }, [hue]);

  return <div ref={hostRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />;
}
