/**
 * "Dodge the Arena" — the little three.js game on the error pages.
 *
 * A knight on your half of an arena; the enemy towers lob fireballs (a red
 * ring marks where each lands), from level 3 a Log rolls across a lit lane,
 * and elixir drops are there to collect. The RULES are `arenaRules.ts` (pure,
 * tested); this file only builds the scene and draws what they decide.
 *
 * It inherits `runtime.ts`'s rules, bent in one place on purpose:
 *  1. three.js arrives through `loadThree()`, never in the main bundle — and
 *     this whole component is itself inside the lazy error-page chunk.
 *  2. The loop runs only on screen and in a visible tab (`runLoop`), and the
 *     game clock is the loop's clamped delta, so a hidden tab pauses the game
 *     rather than spawning a minute of fireballs while nobody looks.
 *  3. Reduced motion: the rule elsewhere is "no canvas at all", because those
 *     canvases are decoration. Here the canvas IS the thing offered, so it is
 *     not drawn until the reader presses "Play anyway" — never by itself.
 *
 * The arena's terrain colours are ART, like the painted banners, and are fixed
 * per theme below. The two TEAM colours mean something (you blue, them red) so
 * they come from the `--hue-*` tokens like every other team colour on the site.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  Sprite,
  Texture,
} from 'three';
import { autoResize, isDark, loadThree, pixelRatio, readToken, reducedMotion, runLoop } from './runtime';
import {
  ARENA,
  DROP_LIFETIME_S,
  INVULNERABLE_S,
  LIVES,
  LOG_CROSS_S,
  LOG_WARNING_S,
  MAX_DROPS,
  PICKUP_RADIUS,
  aimAt,
  dropSpot,
  fireballHits,
  flightTime,
  levelFor,
  logGap,
  logHits,
  readBest,
  spawnGap,
  step,
  storeBest,
  volley,
  type Keys,
} from './arenaRules';
import styles from './ArenaGame.module.css';

type Phase = 'loading' | 'ready' | 'playing' | 'over' | 'still' | 'nogl';

interface Hud {
  score: number;
  lives: number;
  level: number;
  best: number;
}

const TERRAIN = {
  dark: {
    grass: ['#1d4a29', '#225430'], river: '#1b4f8e', riverHi: '#2c6fbf', bridge: '#6a4a2c',
    stone: '#59606c', wall: '#383d47', block: '#d9a93e', blockEmissive: '#3b2a06',
    hemiSky: '#9db7ff', hemiGround: '#1a2414', hemi: 0.95, sun: 1.05, shadow: 0.5,
  },
  light: {
    grass: ['#5aa94a', '#63b453'], river: '#3a8ed8', riverHi: '#6cb3f0', bridge: '#8a6238',
    stone: '#a9afba', wall: '#8b929e', block: '#e3b448', blockEmissive: '#000000',
    hemiSky: '#ffffff', hemiGround: '#6a7d52', hemi: 1.1, sun: 1.15, shadow: 0.28,
  },
} as const;

const ELIXIR = '#d946ef';
const FIRE = '#ff7a1a';
const FIRE_GLOW = '#ffb347';

/* The word built in stone blocks in the arena, three blocks wide and five
   tall a letter. It follows the error: "404", "OFF" (server offline), "OOPS". */
const GLYPHS: Record<string, string[]> = {
  '4': ['1.1', '1.1', '111', '..1', '..1'],
  '0': ['111', '1.1', '1.1', '1.1', '111'],
  O: ['111', '1.1', '1.1', '1.1', '111'],
  F: ['111', '1..', '11.', '1..', '1..'],
  P: ['111', '1.1', '111', '1..', '1..'],
  S: ['111', '1..', '111', '..1', '111'],
};

interface Fireball {
  mesh: Group;
  marker: Mesh;
  fill: Mesh;
  from: [number, number, number];
  to: [number, number];
  t: number;
  flight: number;
}
interface Drop {
  mesh: Group;
  shadow: Mesh;
  x: number;
  z: number;
  age: number;
}
interface Log {
  mesh: Group;
  lane: Mesh;
  z: number;
  dir: 1 | -1;
  t: number;
}
interface Shock {
  mesh: Mesh;
  t: number;
}

export function ArenaGame({ word = '404' }: { word?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(() => (reducedMotion() ? 'still' : 'loading'));
  const [motionOk, setMotionOk] = useState(() => !reducedMotion());
  const [hud, setHud] = useState<Hud>(() => ({
    score: 0,
    lives: LIVES,
    level: 1,
    best: readBest(safeStorage()),
  }));
  const [toast, setToast] = useState<string | null>(null);
  const [hits, setHits] = useState(0);
  const startRef = useRef<(() => void) | null>(null);
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  const start = useCallback(() => startRef.current?.(), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1300);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !motionOk) return;
    let disposed = false;
    let teardown: (() => void) | null = null;

    void loadThree().then((THREE) => {
      if (disposed) return;
      let renderer: import('three').WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      } catch {
        setPhase('nogl');
        return;
      }
      const theme = isDark() ? TERRAIN.dark : TERRAIN.light;
      const blue = readToken('--hue-blue', '#5b8def');
      const red = readToken('--hue-red', '#f87171');

      renderer.setPixelRatio(pixelRatio());
      renderer.setClearColor(0x000000, 0);
      const canvas = renderer.domElement;
      canvas.className = styles.canvas;
      canvas.setAttribute('aria-hidden', 'true');
      host.prepend(canvas);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 80);
      const lookAt = new THREE.Vector3(0, 0, 0.4);
      const baseOffset = new THREE.Vector3(0, 11.2, 10.4);
      const portraitOffset = new THREE.Vector3(0, 13.6, 5.6);
      const camHome = new THREE.Vector3();

      const disposables: { dispose: () => void }[] = [];
      const keep = <T extends { dispose: () => void }>(x: T): T => {
        disposables.push(x);
        return x;
      };
      const lambert = (color: string, emissive = '#000000') =>
        keep(new THREE.MeshLambertMaterial({ color, emissive }));
      /* `fresh` materials belong to one short-lived thing (a fireball's ring,
         a Log's lane) and are disposed with it; `basic` ones live as long as
         the scene. Keeping the first kind in `disposables` would grow that
         list by two entries a fireball for as long as somebody plays. */
      const fresh = (color: string, opacity = 1, additive = false) =>
        new THREE.MeshBasicMaterial({
          color,
          transparent: opacity < 1 || additive,
          opacity,
          depthWrite: !(opacity < 1 || additive),
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
      const basic = (color: string, opacity = 1, additive = false) =>
        keep(fresh(color, opacity, additive));

      /* ---- light ---------------------------------------------------------- */
      scene.add(new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemi));
      const sun = new THREE.DirectionalLight('#ffffff', theme.sun);
      sun.position.set(4, 10, 6);
      scene.add(sun);

      /* ---- terrain --------------------------------------------------------- */
      const grassTex = keep(stripedTexture(THREE, theme.grass[0], theme.grass[1]));
      /* The near end stops just behind the player's half: anything nearer the
         camera than that is drawn huge and only hides the play. Your own
         towers were cut for the same reason — they covered a quarter of the
         view and you are the blue side anyway. */
      const ground = new THREE.Mesh(
        keep(new THREE.PlaneGeometry(10.4, 14.4)),
        keep(new THREE.MeshLambertMaterial({ map: grassTex })),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.z = -1.2;
      scene.add(ground);

      const riverMat = keep(new THREE.MeshLambertMaterial({ color: theme.river, emissive: '#04122a' }));
      const river = new THREE.Mesh(keep(new THREE.PlaneGeometry(10.4, 1.15)), riverMat);
      river.rotation.x = -Math.PI / 2;
      river.position.set(0, 0.015, 0);
      scene.add(river);
      const ripple = new THREE.Mesh(keep(new THREE.PlaneGeometry(10.4, 0.18)), basic(theme.riverHi, 0.45));
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.set(0, 0.025, 0);
      scene.add(ripple);

      const bridgeGeo = keep(new THREE.BoxGeometry(1.5, 0.16, 1.55));
      const bridgeMat = lambert(theme.bridge);
      for (const x of [-3.4, 3.4]) {
        const b = new THREE.Mesh(bridgeGeo, bridgeMat);
        b.position.set(x, 0.06, 0);
        scene.add(b);
      }

      const wallMat = lambert(theme.wall);
      const wallGeoLong = keep(new THREE.BoxGeometry(0.35, 0.45, 14.4));
      const wallGeoShort = keep(new THREE.BoxGeometry(10.75, 0.45, 0.35));
      for (const x of [-5.37, 5.37]) {
        const w = new THREE.Mesh(wallGeoLong, wallMat);
        w.position.set(x, 0.22, -1.2);
        scene.add(w);
      }
      for (const z of [-8.57, 6.17]) {
        const w = new THREE.Mesh(wallGeoShort, wallMat);
        w.position.set(0, 0.22, z);
        scene.add(w);
      }

      /* ---- towers ---------------------------------------------------------- */
      const stone = lambert(theme.stone);
      const gold = lambert('#f2c14e', isDark() ? '#3a2600' : '#000000');
      const shadowMat = basic('#000000', theme.shadow);
      const shadowGeo = keep(new THREE.CircleGeometry(1, 28));
      const blob = (r: number) => {
        const s = new THREE.Mesh(shadowGeo, shadowMat);
        s.rotation.x = -Math.PI / 2;
        s.scale.setScalar(r);
        s.position.y = 0.02;
        return s;
      };
      const towerBase = keep(new THREE.CylinderGeometry(0.62, 0.74, 1.15, 10));
      const towerBand = keep(new THREE.CylinderGeometry(0.74, 0.74, 0.22, 10));
      const towerRoof = keep(new THREE.ConeGeometry(0.72, 0.75, 10));
      const kingBody = keep(new THREE.BoxGeometry(1.7, 1.35, 1.7));
      const merlon = keep(new THREE.BoxGeometry(0.34, 0.3, 0.34));
      const crownSpike = keep(new THREE.ConeGeometry(0.12, 0.34, 6));
      const crownRing = keep(new THREE.TorusGeometry(0.34, 0.07, 6, 18));

      const launchers: [number, number, number][] = [];
      const princess = (x: number, z: number, team: string) => {
        const g = new THREE.Group();
        const base = new THREE.Mesh(towerBase, stone);
        base.position.y = 0.58;
        const band = new THREE.Mesh(towerBand, lambert(team));
        band.position.y = 1.2;
        const roof = new THREE.Mesh(towerRoof, lambert(team));
        roof.position.y = 1.68;
        g.add(blob(0.95), base, band, roof);
        g.position.set(x, 0, z);
        scene.add(g);
      };
      const king = (z: number, team: string) => {
        const g = new THREE.Group();
        const body = new THREE.Mesh(kingBody, stone);
        body.position.y = 0.68;
        g.add(blob(1.35), body);
        for (const [mx, mz] of [[-0.68, -0.68], [0.68, -0.68], [-0.68, 0.68], [0.68, 0.68]]) {
          const m = new THREE.Mesh(merlon, lambert(team));
          m.position.set(mx, 1.5, mz);
          g.add(m);
        }
        const ring = new THREE.Mesh(crownRing, gold);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 1.55;
        g.add(ring);
        for (let i = 0; i < 5; i += 1) {
          const a = (i / 5) * Math.PI * 2;
          const sp = new THREE.Mesh(crownSpike, gold);
          sp.position.set(Math.cos(a) * 0.34, 1.75, Math.sin(a) * 0.34);
          g.add(sp);
        }
        g.position.set(0, 0, z);
        scene.add(g);
      };
      princess(-3.4, -5.0, red);
      princess(3.4, -5.0, red);
      king(-7.2, red);
      launchers.push([-3.4, 1.9, -5.0], [3.4, 1.9, -5.0], [0, 2.0, -7.2]);

      /* ---- the 404 --------------------------------------------------------- */
      const blockGeo = keep(new THREE.BoxGeometry(0.4, 0.4, 0.4));
      const blockScale = word.length > 3 ? 0.34 / 0.44 : 1;
      const blockMat = lambert(theme.block, theme.blockEmissive);
      const blocks: { mesh: Mesh; y: number; phase: number }[] = [];
      const letters = word.toUpperCase().split('').filter((c) => GLYPHS[c]);
      const cell = letters.length > 3 ? 0.34 : 0.44;
      const digitW = cell * 3;
      const gap = letters.length > 3 ? 0.3 : 0.42;
      const totalW = letters.length * digitW + (letters.length - 1) * gap;
      letters.forEach((ch, di) => {
        GLYPHS[ch].forEach((row, ri) => {
          row.split('').forEach((on, ci) => {
            if (on !== '1') return;
            const m = new THREE.Mesh(blockGeo, blockMat);
            m.scale.setScalar(blockScale);
            const x = -totalW / 2 + di * (digitW + gap) + ci * cell + cell / 2;
            const y = 0.25 + (4 - ri) * cell;
            m.position.set(x, y, -3.3);
            scene.add(m);
            blocks.push({ mesh: m, y, phase: x * 0.9 + ri * 0.4 });
          });
        });
      });
      const plinth = new THREE.Mesh(keep(new THREE.BoxGeometry(totalW + 0.5, 0.12, 0.7)), stone);
      plinth.position.set(0, 0.06, -3.3);
      scene.add(plinth);

      /* ---- the knight ------------------------------------------------------ */
      const knight = new THREE.Group();
      const body = new THREE.Group();
      const steel = lambert('#cfd5de');
      const blueMat = lambert(blue);
      const legGeo = keep(new THREE.BoxGeometry(0.13, 0.28, 0.14));
      const legMat = lambert('#2a2f3a');
      const legL = new THREE.Mesh(legGeo, legMat);
      legL.position.set(-0.1, 0.14, 0);
      const legR = new THREE.Mesh(legGeo, legMat);
      legR.position.set(0.1, 0.14, 0);
      const torso = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.24, 0.3, 0.5, 12)), blueMat);
      torso.position.y = 0.52;
      const head = new THREE.Mesh(keep(new THREE.SphereGeometry(0.19, 14, 10)), lambert('#f1c9a5'));
      head.position.y = 0.92;
      const helmet = new THREE.Mesh(
        keep(new THREE.SphereGeometry(0.215, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
        steel,
      );
      helmet.position.y = 0.95;
      const plume = new THREE.Mesh(keep(new THREE.BoxGeometry(0.07, 0.16, 0.26)), blueMat);
      plume.position.set(0, 1.2, 0.02);
      const sword = new THREE.Mesh(keep(new THREE.BoxGeometry(0.06, 0.62, 0.06)), steel);
      sword.position.set(0.36, 0.62, -0.05);
      sword.rotation.z = -0.25;
      const shield = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 14)), blueMat);
      shield.rotation.z = Math.PI / 2;
      shield.position.set(-0.32, 0.55, 0);
      body.add(legL, legR, torso, head, helmet, plume, sword, shield);
      knight.add(blob(0.5), body);
      scene.add(knight);

      /* ---- shared pieces for things that come and go ----------------------- */
      const glowTex = keep(glowTexture(THREE));
      const glowMat = (color: string, opacity: number) =>
        keep(new THREE.SpriteMaterial({
          map: glowTex,
          color,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: isDark() ? THREE.AdditiveBlending : THREE.NormalBlending,
        }));
      const fireCore = keep(new THREE.SphereGeometry(0.27, 16, 12));
      const fireMat = basic(FIRE);
      const fireGlow = glowMat(FIRE_GLOW, isDark() ? 0.9 : 0.55);
      const ringGeo = keep(new THREE.RingGeometry(0.78, 0.95, 40));
      const fillGeo = keep(new THREE.CircleGeometry(0.95, 40));
      const shockGeo = keep(new THREE.RingGeometry(0.85, 1.0, 40));
      const dropCore = keep(new THREE.SphereGeometry(0.22, 16, 12));
      const dropTip = keep(new THREE.ConeGeometry(0.205, 0.32, 16));
      const dropMat = lambert(ELIXIR, '#5a0f66');
      const dropGlow = glowMat(ELIXIR, isDark() ? 0.7 : 0.35);
      const logGeo = keep(new THREE.CylinderGeometry(0.38, 0.38, 1.1, 16));
      const logMats = [lambert('#7a4b25'), lambert('#c79a62'), lambert('#c79a62')];
      const laneGeo = keep(new THREE.PlaneGeometry(ARENA.maxX - ARENA.minX + 1.6, 1.1));

      /* ---- sparks: one Points cloud, recycled ------------------------------ */
      const SPARKS = 260;
      const sparkPos = new Float32Array(SPARKS * 3);
      const sparkCol = new Float32Array(SPARKS * 3);
      const sparkVel = new Float32Array(SPARKS * 3);
      const sparkLife = new Float32Array(SPARKS);
      const sparkGeo = keep(new THREE.BufferGeometry());
      sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
      sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
      const sparkMat = keep(new THREE.PointsMaterial({
        size: 0.16,
        map: glowTex,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: isDark() ? THREE.AdditiveBlending : THREE.NormalBlending,
      }));
      const sparks: Points = new THREE.Points(sparkGeo, sparkMat);
      sparks.frustumCulled = false;
      scene.add(sparks);
      let sparkNext = 0;
      const tmpColor = new THREE.Color();
      const spark = (x: number, y: number, z: number, color: string, speed: number, life: number) => {
        const i = sparkNext;
        sparkNext = (sparkNext + 1) % SPARKS;
        const a = Math.random() * Math.PI * 2;
        const up = Math.random();
        sparkPos.set([x, y, z], i * 3);
        sparkVel.set([Math.cos(a) * speed * (1 - up * 0.5), up * speed * 1.2, Math.sin(a) * speed * (1 - up * 0.5)], i * 3);
        tmpColor.set(color);
        sparkCol.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
        sparkLife[i] = life;
      };
      for (let i = 0; i < SPARKS; i += 1) sparkPos[i * 3 + 1] = -50;

      /* ---- game state ------------------------------------------------------- */
      const fireballs: Fireball[] = [];
      const drops: Drop[] = [];
      const logs: Log[] = [];
      const shocks: Shock[] = [];
      const keys: Keys = { up: false, down: false, left: false, right: false };
      let mode: 'ready' | 'playing' | 'over' = 'ready';
      let pos: [number, number] = [0, 3.4];
      let vel: [number, number] = [0, 0];
      let target: [number, number] | null = null;
      let score = 0;
      let lives = LIVES;
      let level = 1;
      let invuln = 0;
      let shake = 0;
      let nextFire = 1.2;
      let nextLog = Infinity;
      let nextDrop = 0.4;
      let facing = Math.PI;

      const removeFrom = <T,>(list: T[], item: T) => {
        const i = list.indexOf(item);
        if (i !== -1) list.splice(i, 1);
      };
      const clearField = () => {
        for (const f of fireballs) {
          scene.remove(f.mesh, f.marker, f.fill);
          (f.marker.material as MeshBasicMaterial).dispose();
          (f.fill.material as MeshBasicMaterial).dispose();
        }
        for (const d of drops) scene.remove(d.mesh, d.shadow);
        for (const l of logs) {
          scene.remove(l.mesh, l.lane);
          (l.lane.material as MeshBasicMaterial).dispose();
        }
        for (const s of shocks) {
          scene.remove(s.mesh);
          (s.mesh.material as MeshBasicMaterial).dispose();
        }
        fireballs.length = drops.length = logs.length = shocks.length = 0;
      };

      const publish = () => setHud((h) =>
        h.score === score && h.lives === lives && h.level === level ? h : { ...h, score, lives, level });

      startRef.current = () => {
        clearField();
        pos = [0, 3.4];
        target = null;
        score = 0;
        lives = LIVES;
        level = 1;
        invuln = 0;
        nextFire = 1.0;
        nextLog = logGap(1);
        nextDrop = 0.2;
        mode = 'playing';
        setHud((h) => ({ ...h, score: 0, lives: LIVES, level: 1 }));
        setPhase('playing');
      };

      const spawnDrop = () => {
        const [x, z] = dropSpot(pos, Math.random);
        const g = new THREE.Group();
        const core = new THREE.Mesh(dropCore, dropMat);
        const tip = new THREE.Mesh(dropTip, dropMat);
        tip.position.y = 0.24;
        const glow: Sprite = new THREE.Sprite(dropGlow);
        glow.scale.setScalar(1.15);
        g.add(core, tip, glow);
        g.position.set(x, 0.55, z);
        const sh = blob(0.3);
        sh.position.set(x, 0.02, z);
        scene.add(g, sh);
        drops.push({ mesh: g, shadow: sh, x, z, age: 0 });
      };

      const launch = () => {
        const n = volley(level, Math.random());
        const flight = flightTime(level);
        for (let i = 0; i < n; i += 1) {
          const from = launchers[Math.floor(Math.random() * launchers.length)];
          const to = i === 0
            ? aimAt(pos, vel, flight, Math.random(), Math.random())
            : dropSpot(pos, Math.random, 0.8);
          const g = new THREE.Group();
          const core = new THREE.Mesh(fireCore, fireMat);
          const glow = new THREE.Sprite(fireGlow);
          glow.scale.setScalar(1.6);
          g.add(core, glow);
          g.position.set(...from);
          const marker = new THREE.Mesh(ringGeo, fresh(red, 0.9));
          marker.rotation.x = -Math.PI / 2;
          marker.position.set(to[0], 0.03, to[1]);
          const fill = new THREE.Mesh(fillGeo, fresh(red, 0.12));
          fill.rotation.x = -Math.PI / 2;
          fill.position.set(to[0], 0.028, to[1]);
          fill.scale.setScalar(0.05);
          scene.add(g, marker, fill);
          fireballs.push({ mesh: g, marker, fill, from: [...from], to, t: 0, flight: flight + i * 0.18 });
        }
      };

      const rollLog = () => {
        const z = ARENA.minZ + 0.4 + Math.random() * (ARENA.maxZ - ARENA.minZ - 0.8);
        const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
        const lane = new THREE.Mesh(laneGeo, fresh(red, 0.0));
        lane.rotation.x = -Math.PI / 2;
        lane.position.set(0, 0.026, z);
        const g = new THREE.Group();
        const m = new THREE.Mesh(logGeo, logMats);
        m.rotation.x = Math.PI / 2;
        g.add(m);
        g.position.set(dir === 1 ? ARENA.minX - 1.4 : ARENA.maxX + 1.4, 0.38, z);
        g.visible = false;
        scene.add(lane, g);
        logs.push({ mesh: g, lane, z, dir, t: 0 });
      };

      const hurt = () => {
        if (invuln > 0 || mode !== 'playing') return;
        lives -= 1;
        invuln = INVULNERABLE_S;
        shake = 0.32;
        setHits((n) => n + 1);
        for (let i = 0; i < 22; i += 1) spark(pos[0], 0.6, pos[1], red, 3.2, 0.6);
        publish();
        if (lives <= 0) {
          mode = 'over';
          const best = storeBest(safeStorage(), score);
          setHud((h) => ({ ...h, lives: 0, best }));
          setPhase('over');
        }
      };

      const shockwave = (x: number, z: number) => {
        const m = new THREE.Mesh(shockGeo, fresh(FIRE_GLOW, 0.9, isDark()));
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.04, z);
        scene.add(m);
        shocks.push({ mesh: m, t: 0 });
        for (let i = 0; i < 26; i += 1) spark(x, 0.25, z, i % 3 ? FIRE : FIRE_GLOW, 3.6, 0.7);
      };

      /* ---- input ------------------------------------------------------------ */
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      let pressed = false;
      const aim = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        if (ray.ray.intersectPlane(plane, hit)) target = [hit.x, hit.z];
      };
      const onDown = (e: PointerEvent) => {
        if (mode !== 'playing') return;
        pressed = true;
        canvas.setPointerCapture?.(e.pointerId);
        aim(e);
      };
      const onMove = (e: PointerEvent) => {
        if (pressed) aim(e);
      };
      const onUp = () => {
        pressed = false;
      };
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);

      const KEYMAP: Record<string, keyof Keys> = {
        ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
        ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
      };
      let inView = true;
      const io = new IntersectionObserver(([en]) => {
        inView = en.isIntersecting;
      });
      io.observe(host);
      const typing = (t: EventTarget | null) =>
        t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      const onKey = (down: boolean) => (e: KeyboardEvent) => {
        if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
        const k = KEYMAP[e.code];
        if (k) {
          keys[k] = down;
          if (mode === 'playing' && inView) {
            e.preventDefault();
            target = null;
          }
          return;
        }
        if (down && (e.code === 'Space' || e.code === 'Enter') && mode !== 'playing' && inView &&
          !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) {
          e.preventDefault();
          startRef.current?.();
        }
      };
      const keyDown = onKey(true);
      const keyUp = onKey(false);
      window.addEventListener('keydown', keyDown);
      window.addEventListener('keyup', keyUp);
      const blur = () => {
        keys.up = keys.down = keys.left = keys.right = false;
        pressed = false;
      };
      window.addEventListener('blur', blur);

      /* ---- size -------------------------------------------------------------- */
      const stopResize = autoResize(host, (w, h) => {
        renderer.setSize(w, h, false);
        const aspect = w / h;
        camera.aspect = aspect;
        /* A wide frame looks down the arena at an angle. A narrow (phone)
           frame is too thin for the arena's width at that angle, and simply
           pulling back left a band of nothing below it — so it looks more
           steeply down, which spends the frame's height on the arena's
           length, and pulls back only by what the width still needs. */
        const portrait = Math.min(1, Math.max(0, (1.2 - aspect) / 0.6));
        const offset = baseOffset.clone().lerp(portraitOffset, portrait);
        const fit = Math.min(2.2, Math.max(1, (aspect < 1 ? 0.86 : 1.08) / aspect));
        camHome.copy(offset).multiplyScalar(fit).add(lookAt);
        camera.position.copy(camHome);
        camera.lookAt(lookAt);
        camera.updateProjectionMatrix();
      });

      /* ---- the frame ------------------------------------------------------- */
      let clock = 0;
      const frame = (_elapsed: number, dt: number) => {
        clock += dt;
        if (mode === 'playing') {
          const before = pos;
          pos = step(pos, keys, target, dt);
          vel = dt > 0 ? [(pos[0] - before[0]) / dt, (pos[1] - before[1]) / dt] : [0, 0];
          if (target && pos[0] === target[0] && pos[1] === target[1]) target = null;
          invuln = Math.max(0, invuln - dt);

          nextFire -= dt;
          if (nextFire <= 0) {
            launch();
            nextFire = spawnGap(level) * (0.75 + Math.random() * 0.5);
          }
          nextLog -= dt;
          if (nextLog <= 0) {
            rollLog();
            nextLog = logGap(level) * (0.8 + Math.random() * 0.4);
          }
          nextDrop -= dt;
          if (drops.length < Math.min(MAX_DROPS, 1 + Math.floor(level / 3)) && nextDrop <= 0) {
            spawnDrop();
            nextDrop = 0.9;
          }
        } else {
          vel = [0, 0];
          if (drops.length === 0 && mode === 'ready') spawnDrop();
        }

        // Knight.
        const moving = Math.hypot(vel[0], vel[1]) > 0.3;
        if (moving) facing = Math.atan2(vel[0], vel[1]);
        knight.rotation.y += (facing - knight.rotation.y) * Math.min(1, dt * 12);
        knight.position.set(pos[0], 0, pos[1]);
        body.position.y = moving ? Math.abs(Math.sin(clock * 14)) * 0.08 : Math.sin(clock * 2.2) * 0.015;
        legL.rotation.x = moving ? Math.sin(clock * 14) * 0.6 : 0;
        legR.rotation.x = -legL.rotation.x;
        body.visible = invuln <= 0 || Math.floor(clock * 14) % 2 === 0;

        // Fireballs.
        for (const f of [...fireballs]) {
          f.t += dt;
          const p = Math.min(1, f.t / f.flight);
          const x = f.from[0] + (f.to[0] - f.from[0]) * p;
          const z = f.from[2] + (f.to[1] - f.from[2]) * p;
          const y = f.from[1] * (1 - p) + 0.25 + Math.sin(p * Math.PI) * 3.4;
          f.mesh.position.set(x, y, z);
          f.fill.scale.setScalar(Math.max(0.05, p));
          (f.marker.material as MeshBasicMaterial).opacity = 0.55 + 0.4 * Math.sin(clock * 18);
          if (Math.random() < 0.7) spark(x, y, z, FIRE_GLOW, 0.5, 0.35);
          if (p >= 1) {
            shockwave(f.to[0], f.to[1]);
            if (mode === 'playing' && fireballHits(pos[0], pos[1], f.to[0], f.to[1])) hurt();
            shake = Math.max(shake, 0.12);
            scene.remove(f.mesh, f.marker, f.fill);
            (f.marker.material as MeshBasicMaterial).dispose();
            (f.fill.material as MeshBasicMaterial).dispose();
            removeFrom(fireballs, f);
          }
        }

        // Logs.
        for (const l of [...logs]) {
          l.t += dt;
          const laneMat = l.lane.material as MeshBasicMaterial;
          if (l.t < LOG_WARNING_S) {
            laneMat.opacity = 0.12 + 0.14 * (0.5 + 0.5 * Math.sin(clock * 16));
          } else {
            const p = (l.t - LOG_WARNING_S) / LOG_CROSS_S;
            const span = ARENA.maxX - ARENA.minX + 2.8;
            const x = l.dir === 1 ? ARENA.minX - 1.4 + span * p : ARENA.maxX + 1.4 - span * p;
            l.mesh.visible = true;
            l.mesh.position.x = x;
            l.mesh.rotation.z = -l.dir * (x / 0.38);
            laneMat.opacity = 0.18 * (1 - p);
            if (Math.random() < 0.5) spark(x, 0.05, l.z + (Math.random() - 0.5), '#c79a62', 1.2, 0.4);
            if (mode === 'playing' && logHits(pos[0], pos[1], l.z, x)) hurt();
            if (p >= 1) {
              scene.remove(l.mesh, l.lane);
              laneMat.dispose();
              removeFrom(logs, l);
            }
          }
        }

        // Elixir.
        for (const d of [...drops]) {
          d.age += dt;
          d.mesh.position.y = 0.55 + Math.sin(clock * 3 + d.x) * 0.1;
          d.mesh.rotation.y += dt * 1.6;
          const left = DROP_LIFETIME_S - d.age;
          d.mesh.visible = mode !== 'playing' || left > 1.6 || Math.floor(clock * 10) % 2 === 0;
          const taken = mode === 'playing' &&
            Math.hypot(pos[0] - d.x, pos[1] - d.z) <= PICKUP_RADIUS;
          if (taken || (mode === 'playing' && left <= 0)) {
            if (taken) {
              score += 1;
              for (let i = 0; i < 16; i += 1) spark(d.x, 0.55, d.z, ELIXIR, 2.2, 0.55);
              const lv = levelFor(score);
              if (lv !== level) {
                level = lv;
                setToast(`Level ${lv}`);
              }
              publish();
            }
            scene.remove(d.mesh, d.shadow);
            removeFrom(drops, d);
          }
        }

        // Shockwaves.
        for (const s of [...shocks]) {
          s.t += dt;
          s.mesh.scale.setScalar(0.4 + s.t * 3.2);
          (s.mesh.material as MeshBasicMaterial).opacity = Math.max(0, 0.9 - s.t * 2.4);
          if (s.t > 0.4) {
            scene.remove(s.mesh);
            (s.mesh.material as MeshBasicMaterial).dispose();
            removeFrom(shocks, s);
          }
        }

        // Sparks.
        for (let i = 0; i < SPARKS; i += 1) {
          if (sparkLife[i] <= 0) continue;
          sparkLife[i] -= dt;
          const o = i * 3;
          sparkVel[o + 1] -= 6 * dt;
          sparkPos[o] += sparkVel[o] * dt;
          sparkPos[o + 1] = Math.max(0.03, sparkPos[o + 1] + sparkVel[o + 1] * dt);
          sparkPos[o + 2] += sparkVel[o + 2] * dt;
          if (sparkLife[i] <= 0) sparkPos[o + 1] = -50;
        }
        sparkGeo.attributes.position.needsUpdate = true;
        sparkGeo.attributes.color.needsUpdate = true;

        // The 404 breathes; the river shimmers.
        for (const b of blocks) b.mesh.position.y = b.y + Math.sin(clock * 1.8 + b.phase) * 0.05;
        ripple.position.z = Math.sin(clock * 1.3) * 0.3;
        (ripple.material as MeshBasicMaterial).opacity = 0.3 + 0.15 * Math.sin(clock * 2.1);

        // Camera shake.
        shake = Math.max(0, shake - dt);
        camera.position.set(
          camHome.x + (Math.random() - 0.5) * shake * 0.9,
          camHome.y + (Math.random() - 0.5) * shake * 0.6,
          camHome.z,
        );
        camera.lookAt(lookAt);

        renderer.render(scene, camera);
      };
      const stopLoop = runLoop(host, frame);
      setPhase('ready');

      teardown = () => {
        stopLoop();
        stopResize();
        io.disconnect();
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        window.removeEventListener('keydown', keyDown);
        window.removeEventListener('keyup', keyUp);
        window.removeEventListener('blur', blur);
        clearField();
        disposables.forEach((d) => d.dispose());
        renderer.dispose();
        canvas.remove();
        startRef.current = null;
      };
    });

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [motionOk, word]);

  const controls = coarse ? 'Touch and drag to move' : 'Move with WASD or the arrow keys, or drag';

  return (
    <div
      ref={hostRef}
      className={styles.stage}
      data-phase={phase}
      data-arena-game=""
      data-no-rail=""
      tabIndex={-1}
    >
      {phase !== 'still' && phase !== 'nogl' && (
        <div className={styles.hud} aria-hidden={phase !== 'playing'}>
          <span className={styles.chip} title="Elixir collected">
            <i className={styles.elixirDot} aria-hidden="true" /> {hud.score}
          </span>
          <span className={styles.chip} title="Lives">
            {Array.from({ length: LIVES }, (_, i) => (
              <i key={i} className={styles.heart} data-lost={i >= hud.lives ? '' : undefined} aria-hidden="true" />
            ))}
            <span className="sr-only">{hud.lives} lives</span>
          </span>
          <span className={styles.spacer} />
          <span className={styles.chip}>Lv {hud.level}</span>
          <span className={styles.chip} title="Your best on this browser">Best {hud.best}</span>
        </div>
      )}

      {hits > 0 && <span key={hits} className={styles.hitFlash} aria-hidden="true" />}
      {toast && <span key={toast} className={styles.toast} role="status">{toast}</span>}

      {phase === 'loading' && <div className={styles.card}><p className={styles.small}>Building the arena…</p></div>}

      {phase === 'ready' && (
        <div className={styles.card}>
          <p className={styles.cardTitle}>Dodge the Arena</p>
          <p className={styles.small}>Collect elixir. Dodge the fireballs and the Log.</p>
          <button type="button" className={styles.play} onClick={start}>Play</button>
          <p className={styles.hint}>{controls}</p>
        </div>
      )}

      {phase === 'over' && (
        <div className={styles.card} role="status">
          <p className={styles.cardTitle}>Game over</p>
          <p className={styles.small}>
            {hud.score} elixir · level {hud.level}
            {hud.score > 0 && hud.score >= hud.best ? ' · new best' : ` · best ${hud.best}`}
          </p>
          <button type="button" className={styles.play} onClick={start}>Play again</button>
        </div>
      )}

      {phase === 'still' && (
        <div className={styles.card}>
          <p className={styles.cardTitle}>Dodge the Arena</p>
          <p className={styles.small}>
            A small game lives here. It is off because your device asks for reduced motion.
          </p>
          <button type="button" className={styles.play} onClick={() => setMotionOk(true)}>
            Play anyway
          </button>
        </div>
      )}

      {phase === 'nogl' && (
        <div className={styles.card}>
          <p className={styles.small}>This browser could not start 3D graphics, so the game is off.</p>
        </div>
      )}

      {phase === 'playing' && <p className={styles.controls} aria-hidden="true">{controls}</p>}
    </div>
  );
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Mown-grass stripes for the arena floor, drawn once on a canvas. */
function stripedTexture(THREE: typeof import('three'), a: string, b: string): Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 16; i += 1) {
    g.fillStyle = i % 2 ? a : b;
    g.fillRect(0, i * 16, 64, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** A soft round glow for sprites and sparks. */
function glowTexture(THREE: typeof import('three')): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
