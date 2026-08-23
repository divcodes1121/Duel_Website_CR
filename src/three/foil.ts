/**
 * Holographic foil, for whichever card is under the cursor.
 *
 * ONE renderer, module-level, moved between hosts — not one per card. The
 * picker draws 122 tiles; 122 WebGL contexts would exhaust the browser's limit
 * (~16) long before it finished rendering, and only one card can be hovered
 * anyway. `attachFoil` re-parents the single canvas into the hovered tile and
 * `detachFoil` takes it away again.
 *
 * The tile keeps its `<img>` underneath the whole time. If WebGL is missing, a
 * texture 404s, or the reader prefers reduced motion, nothing mounts and the
 * flat image is simply what stays on screen.
 */
import { OVERLAY_STYLE, loadThree, pixelRatio, reducedMotion } from './runtime';

type Three = typeof import('three');

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * The sheen is a soft diagonal band whose position is driven by tilt, tinted
 * by a cosine palette so it reads as interference rather than a grey gloss.
 * It is multiplied by the texture's own alpha, so it never paints outside the
 * card's rounded frame.
 */
const FRAG = `
  precision mediump float;
  uniform sampler2D uMap;
  uniform vec2 uTilt;
  uniform float uStrength;
  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    if (tex.a < 0.01) discard;

    float band = vUv.x + vUv.y;
    float centre = 1.0 + uTilt.x * 1.15 - uTilt.y * 0.55;
    float sheen = smoothstep(0.55, 0.0, abs(band - centre));
    sheen = pow(sheen, 1.6);

    vec3 hue = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + band * 1.25 + uTilt.x * 0.8));

    // A cool rim on the edge the card is tilting away from, which is what sells
    // the plane as having thickness rather than being a decal.
    vec2 c = vUv - 0.5;
    float rim = smoothstep(0.34, 0.5, max(abs(c.x), abs(c.y)));

    vec3 col = tex.rgb + hue * sheen * uStrength + vec3(0.55, 0.75, 1.0) * rim * uStrength * 0.25;
    gl_FragColor = vec4(col, tex.a);
  }
`;

interface Rig {
  THREE: Three;
  renderer: import('three').WebGLRenderer;
  scene: import('three').Scene;
  camera: import('three').PerspectiveCamera;
  mesh: import('three').Mesh;
  material: import('three').ShaderMaterial;
  canvas: HTMLCanvasElement;
}

let rig: Rig | null = null;
let building: Promise<Rig | null> | null = null;
const textures = new Map<string, import('three').Texture>();

/** Current host, so a fast pointer crossing several tiles cannot double-attach. */
let host: HTMLElement | null = null;
let raf = 0;
const tilt = { x: 0, y: 0 };
const target = { x: 0, y: 0 };
let strength = 0;
let leaving = false;

async function build(): Promise<Rig | null> {
  const THREE = await loadThree();
  let renderer: import('three').WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    return null; // no WebGL — the flat image is the fallback, and it is fine
  }
  renderer.setPixelRatio(pixelRatio());

  const canvas = renderer.domElement;
  Object.assign(canvas.style, OVERLAY_STYLE, { zIndex: '2' });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  camera.position.z = 4.2;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    uniforms: {
      uMap: { value: null },
      uTilt: { value: new THREE.Vector2() },
      uStrength: { value: 0 },
    },
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), material);
  scene.add(mesh);

  return { THREE, renderer, scene, camera, mesh, material, canvas };
}

function textureFor(THREE: Three, src: string): Promise<import('three').Texture | null> {
  const cached = textures.get(src);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      src,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        textures.set(src, tex);
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
}

function frame() {
  raf = 0;
  if (!rig || !host) return;

  // Critically damped-ish easing: the tilt chases the pointer rather than
  // snapping, which is most of what makes it feel like an object.
  tilt.x += (target.x - tilt.x) * 0.18;
  tilt.y += (target.y - tilt.y) * 0.18;
  const wanted = leaving ? 0 : 1;
  strength += (wanted - strength) * 0.14;

  rig.mesh.rotation.y = tilt.x * 0.42;
  rig.mesh.rotation.x = -tilt.y * 0.42;
  rig.mesh.position.z = strength * 0.18;
  (rig.material.uniforms.uTilt.value as { set: (x: number, y: number) => void }).set(tilt.x, tilt.y);
  rig.material.uniforms.uStrength.value = strength * 0.5;

  rig.renderer.render(rig.scene, rig.camera);

  if (leaving && strength < 0.01) {
    teardown();
    return;
  }
  raf = requestAnimationFrame(frame);
}

function teardown() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (rig && rig.canvas.parentElement) rig.canvas.parentElement.removeChild(rig.canvas);
  host = null;
  leaving = false;
}

function onPointerMove(e: { clientX: number; clientY: number }) {
  if (!host) return;
  const r = host.getBoundingClientRect();
  target.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  target.y = ((e.clientY - r.top) / r.height) * 2 - 1;
}

/** Light this element up. Safe to call repeatedly; safe to call before three loads. */
export function attachFoil(el: HTMLElement, src: string): void {
  if (reducedMotion()) return;
  host = el;
  leaving = false;

  const start = (r: Rig) => {
    if (host !== el) return; // the pointer already moved on while we loaded
    rig = r;
    const box = el.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) return;

    r.renderer.setSize(box.width, box.height, false);
    r.camera.aspect = box.width / box.height;
    r.camera.updateProjectionMatrix();
    // Fill the frustum at z=0, so the plane lines up with the <img> beneath it.
    const h = 2 * Math.tan((r.camera.fov * Math.PI) / 180 / 2) * r.camera.position.z;
    r.mesh.scale.set(h * r.camera.aspect, h, 1);

    el.appendChild(r.canvas);
    void textureFor(r.THREE, src).then((tex) => {
      if (host !== el || !tex) return;
      r.material.uniforms.uMap.value = tex;
    });

    if (!raf) raf = requestAnimationFrame(frame);
  };

  if (rig) {
    start(rig);
    return;
  }
  if (!building) building = build();
  void building.then((r) => r && start(r));
}

/** Ease back to flat, then remove the canvas. */
export function detachFoil(el: HTMLElement): void {
  if (host !== el) return;
  leaving = true;
  target.x = 0;
  target.y = 0;
  if (!raf && rig) raf = requestAnimationFrame(frame);
}

export const foilPointerMove = onPointerMove;
