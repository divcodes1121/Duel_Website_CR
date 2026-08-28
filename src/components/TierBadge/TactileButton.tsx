/* The Nexus "Tactile Fluidics" button from ThreeUI, ported into this project.
 *
 * Source bundle: https://threeui.com/source-code/tactile-button.json
 *   src/shaders/neuform-isolated/sources/nexus-tactile.html
 *   SHA-256 1811a6408fb09421665d772eca4106162e10bfc038ec948324d0250f5dec9cb4
 * All three bundled files were fetched and hash-verified before this was written.
 *
 * WHY THIS IS A PORT AND NOT THE PACKAGE. `<ShaderButtons variant="tactile-button" />`
 * renders the authored document in a sandboxed `<iframe srcDoc>` and recolours it
 * with a CSS filter. That is right for a documentation preview and wrong for a
 * badge in our top bar: the document pulls Tailwind, GSAP, iconify and Google
 * Fonts off three CDNs, carries a whole demo page (nav, "Viscous Fields.
 * Reengineered.", a GSAP intro timeline, a second full-screen ambient canvas),
 * and an iframe cannot join the host page's focus order. The brief says to build
 * directly in the destination project and not to embed the documentation page,
 * so what is preserved is the BUTTON: its markup structure, its styling, its
 * shader byte-for-byte, its motion, and its interactions.
 *
 * WHAT IS VERBATIM, and must stay so:
 *   - VS and FS, exactly as authored, including the array-of-lines form.
 *   - the uniform set: u_res, u_time, u_level, u_tilt, u_slosh.
 *   - BASE = 0.56, and the resting slosh of 0.4.
 *   - every interaction constant: slosh += |dx| * 2.6 clamped to 1.4, focus
 *     += 0.5, click sets gulp = 1 and slosh += 0.7, tiltTarget = (x-0.5)*2.
 *   - the frame integrator: slosh and gulp decay by exp(-1.5 dt) / exp(-1.1 dt),
 *     tilt and level lerp at dt*5 and dt*5.5, levelTarget = BASE - 0.36*gulp.
 *   - the DPR cap of 2 and the resize-inside-frame behaviour.
 *   - the no-WebGL fallback: the authored CSS gradient, canvas hidden.
 *
 * WHAT IS ADAPTED, and why:
 *   - Tailwind utility classes become a CSS Module, because this project has no
 *     Tailwind. Every value is carried across (250x70, radius 18/19, the 1px
 *     gradient border, both shadows, hover -2px, active +1px and 0.985).
 *     The size is a CSS variable so a top-bar badge can be smaller without the
 *     shader changing — it reads gl_FragCoord/u_res, so it is scale-free.
 *   - the iconify arrow is dropped; a tier badge is a status, not a call to
 *     action, and pulling an icon font CDN for one glyph is not a trade this
 *     project makes.
 *   - REDUCED MOTION. The authored document freezes u_time at 2.0 and clamps
 *     slosh to 0.25, but keeps requestAnimationFrame running forever. This
 *     project's rule (docs/UI.md) is that nothing loops when it cannot be seen
 *     to move, so the frozen frame is drawn ONCE and the loop never starts.
 *     Same picture the author specified, no rAF burning on a still image.
 *
 * ONE CONTEXT PER MOUNTED BADGE, and that is the budget. A browser allows about
 * 16 WebGL contexts and `LiquidMetal` already holds one for every circular
 * control; the tier badge renders once, in the top bar. If this is ever put in a
 * list, share a renderer the way LiquidMetal does — do not mount N of these.
 */

import { useEffect, useRef } from 'react';
import styles from './TactileButton.module.css';

/* Verbatim from nexus-tactile.html. */
const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

/* Verbatim from nexus-tactile.html, including the line array and the join. */
const FS = [
  'precision highp float;',
  'uniform vec2 u_res;',
  'uniform float u_time;',
  'uniform float u_level;',
  'uniform float u_tilt;',
  'uniform float u_slosh;',
  /* THE FOUR COLOUR CONSTANTS, LIFTED TO UNIFORMS. Nothing else in this
     shader is touched: same fbm, same surface equation, same depth ramp,
     same falloffs, same vignette. Passing the authored values reproduces the
     authored image exactly, and `AUTHORED_LIQUID` below is those values. */
  'uniform vec3 u_shallow;',
  'uniform vec3 u_deep;',
  'uniform vec3 u_sloshTint;',
  'uniform vec3 u_glowA;',
  'uniform vec3 u_glowB;',
  'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}',
  'float noise(vec2 p){',
  '  vec2 i=floor(p), f=fract(p);',
  '  vec2 u=f*f*(3.0-2.0*f);',
  '  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),',
  '             mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);',
  '}',
  'float fbm(vec2 p){',
  '  float v=0.0; float a=0.5;',
  '  for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.04+vec2(11.3,7.1); a*=0.5; }',
  '  return v;',
  '}',
  'void main(){',
  '  vec2 uv = gl_FragCoord.xy / u_res;',
  '  float ar = u_res.x / u_res.y;',
  '  float x = uv.x * ar;',
  '  float t = u_time;',
  '  float amp = 0.012 + u_slosh * 0.045;',
  '  float surf = u_level',
  '    + u_tilt * (uv.x - 0.5) * 0.34',
  '    + amp * sin(x * 5.1 + t * 4.6)',
  '    + amp * 0.62 * sin(x * 9.7 + t * (-6.8) + 1.7)',
  '    + amp * 0.38 * sin(x * 14.3 + t * 8.9 + 4.2);',
  '  float d = surf - uv.y;',
  '  vec3 col = mix(vec3(0.03, 0.06, 0.1), vec3(0.05, 0.09, 0.15), uv.y);',
  '  col += vec3(0.02, 0.05, 0.1) * pow(max(0.0, 1.0 - abs(uv.y - 0.88) * 6.0), 2.0);',
  '  float inside = smoothstep(0.0, 0.012, d);',
  '  float depth = clamp(d / max(u_level, 0.001), 0.0, 1.0);',
  '  vec3 liq = mix(u_shallow, u_deep, depth);',
  '  float caust = fbm(vec2(x * 4.2, (uv.y + t * 0.14) * 4.2));',
  '  liq *= 0.8 + 0.42 * caust;',
  '  liq += u_sloshTint * pow(max(0.0, d * 3.0), 1.5) * u_slosh;',
  '  col = mix(col, liq, inside);',
  '  col += u_glowA * exp(-abs(d) * 80.0) * 0.85;',
  '  col += u_glowB * exp(-abs(d) * 220.0) * 0.5;',
  '  vec2 e = uv * (1.0 - uv);',
  '  col *= 0.55 + 0.45 * pow(e.x * e.y * 16.0, 0.22);',
  '  gl_FragColor = vec4(col, 1.0);',
  '}',
].join('\n');

/** The four colours exactly as the author wrote them. Passing this renders the
 *  original Nexus button; every tier palette is a substitution for it.
 *
 *  WHY THESE ARE UNIFORMS AND NOT A CSS FILTER. `hue-rotate`/`brightness` were
 *  tried first and are what ThreeUI itself offers, but a filter cannot colour
 *  the body without also dimming the meniscus flare — the two are the same
 *  pixels to it. Getting a DARK green or a wine maroon that way meant
 *  brightness 0.5, which flattened the whole thing. Lifting the colour stops
 *  into the shader separates the two questions: the body takes the brand
 *  colour, the flare stays a bright specular highlight. No filter is applied
 *  any more. */
export const AUTHORED_LIQUID: LiquidPalette = {
  shallow: [0.0, 0.9, 1.0],
  deep: [0.02, 0.15, 0.45],
  sloshTint: [0.02, 0.25, 0.35],
  glowA: [0.4, 0.9, 1.0],
  glowB: [0.8, 0.98, 1.0],
};

export interface LiquidPalette {
  shallow: [number, number, number];
  deep: [number, number, number];
  sloshTint: [number, number, number];
  glowA: [number, number, number];
  glowB: [number, number, number];
}

/* The authored no-WebGL fallback, kept exactly. */
const FALLBACK_BG =
  'linear-gradient(to top, #0284c7 0%, #06b6d4 52%, #a5f3fc 55%, #050b11 56%)';

export interface TactileButtonProps {
  label: string;
  title?: string;
  /** The liquid's four colours. Defaults to exactly what the author wrote. */
  liquid?: LiquidPalette;
  /** ThreeUI's own recolour channel: hue-rotate/saturate/brightness over the
   *  authored cyan. Clamped exactly as NeuformIsolatedEffects clamps them. */
  hue?: number;
  saturation?: number;
  brightness?: number;
  /** Width/height in px. The authored button is 250x70; a badge is smaller,
   *  and the shader is resolution-independent so nothing else changes. */
  width?: number;
  height?: number;
  className?: string;
  onClick?: () => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function TactileButton({
  label,
  title,
  liquid = AUTHORED_LIQUID,
  hue = 0,
  saturation = 1,
  brightness = 1,
  width = 250,
  height = 70,
  className,
  onClick,
}: TactileButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liquidRef = useRef(liquid);
  liquidRef.current = liquid;

  useEffect(() => {
    const btn = btnRef.current;
    const canvas = canvasRef.current;
    if (!btn || !canvas) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gl = canvas.getContext('webgl');

    if (!gl) {
      // Authored fallback, verbatim.
      btn.style.background = FALLBACK_BG;
      canvas.style.display = 'none';
      return;
    }

    function compile(type: number, src: string) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      return s;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const locP = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(locP);
    gl.vertexAttribPointer(locP, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uLevel = gl.getUniformLocation(prog, 'u_level');
    const uTilt = gl.getUniformLocation(prog, 'u_tilt');
    const uSlosh = gl.getUniformLocation(prog, 'u_slosh');
    const uShallow = gl.getUniformLocation(prog, 'u_shallow');
    const uDeep = gl.getUniformLocation(prog, 'u_deep');
    const uSloshTint = gl.getUniformLocation(prog, 'u_sloshTint');
    const uGlowA = gl.getUniformLocation(prog, 'u_glowA');
    const uGlowB = gl.getUniformLocation(prog, 'u_glowB');

    /* The palette is constant for the life of the button, so it is set once
       rather than every frame. `liquidRef` keeps the effect off the palette's
       identity — a new object literal per render must not tear the context
       down and rebuild it. */
    function setPalette() {
      const q = liquidRef.current;
      gl!.uniform3fv(uShallow, q.shallow);
      gl!.uniform3fv(uDeep, q.deep);
      gl!.uniform3fv(uSloshTint, q.sloshTint);
      gl!.uniform3fv(uGlowA, q.glowA);
      gl!.uniform3fv(uGlowB, q.glowB);
    }
    setPalette();

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas!.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas!.clientHeight * dpr));
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
        gl!.viewport(0, 0, w, h);
      }
    }
    window.addEventListener('resize', resize);
    resize();

    const BASE = 0.56;
    let level = BASE;
    let gulp = 0;
    let slosh = 0.4;
    let tilt = 0;
    let tiltTarget = 0;
    let lastX: number | null = null;
    let last = performance.now();

    const onMove = (e: MouseEvent) => {
      const rect = btn.getBoundingClientRect();
      const x = (e.clientX - rect.left) / Math.max(1, rect.width);
      if (lastX !== null) slosh = Math.min(1.4, slosh + Math.abs(x - lastX) * 2.6);
      lastX = x;
      tiltTarget = Math.max(-1, Math.min(1, (x - 0.5) * 2));
    };
    const onLeave = () => {
      lastX = null;
      tiltTarget = 0;
    };
    const onFocus = () => {
      slosh = Math.min(1.4, slosh + 0.5);
    };
    const onDown = () => {
      gulp = 1;
      slosh = Math.min(1.4, slosh + 0.7);
    };

    /* REDUCED MOTION DRAWS ONE FRAME AND STOPS. The author's values for the
       still image are kept (u_time 2.0, slosh 0.25); what is dropped is the
       rAF that would keep re-drawing an image that never changes. */
    if (reduced) {
      resize();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, 2.0);
      gl.uniform1f(uLevel, BASE);
      gl.uniform1f(uTilt, 0);
      gl.uniform1f(uSlosh, 0.25);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return () => window.removeEventListener('resize', resize);
    }

    btn.addEventListener('mousemove', onMove);
    btn.addEventListener('mouseleave', onLeave);
    btn.addEventListener('focus', onFocus);
    btn.addEventListener('click', onDown);

    let raf = 0;
    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      slosh *= Math.exp(-1.5 * dt);
      gulp *= Math.exp(-1.1 * dt);
      tilt += (tiltTarget - tilt) * Math.min(1, dt * 5);
      const levelTarget = BASE - 0.36 * gulp;
      level += (levelTarget - level) * Math.min(1, dt * 5.5);

      resize();
      gl!.uniform2f(uRes, canvas!.width, canvas!.height);
      gl!.uniform1f(uTime, now / 1000);
      gl!.uniform1f(uLevel, level);
      gl!.uniform1f(uTilt, tilt);
      gl!.uniform1f(uSlosh, slosh);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      btn.removeEventListener('mousemove', onMove);
      btn.removeEventListener('mouseleave', onLeave);
      btn.removeEventListener('focus', onFocus);
      btn.removeEventListener('click', onDown);
      // Hand the context back rather than waiting for GC: the budget is ~16.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  /* NO CSS FILTER. It was here, and it is what dimmed the water: `brightness`
     multiplies the meniscus flare and the body alike, so the only way to reach
     a dark brand colour was to darken the glow with it. The colour now comes
     from the shader's own stops, above. The hue/saturation/brightness props are
     kept on the interface because they are ThreeUI's documented channel, and
     they still apply — on top of the palette, not instead of it. */
  const h = clamp(hue, -180, 180);
  const sat = clamp(saturation, 0, 2);
  const bri = clamp(brightness, 0.35, 1.65);
  const filter =
    h === 0 && sat === 1 && bri === 1
      ? undefined
      : `hue-rotate(${h}deg) saturate(${sat}) brightness(${bri})`;

  return (
    <span
      className={[styles.frame, className].filter(Boolean).join(' ')}
      style={{ ['--tb-w' as string]: `${width}px`, ['--tb-h' as string]: `${height}px` }}
    >
      <button ref={btnRef} type="button" className={styles.button} title={title} onClick={onClick}>
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className={styles.canvas}
          style={filter ? { filter } : undefined}
        />
        <span className={styles.label}>{label}</span>
      </button>
    </span>
  );
}
