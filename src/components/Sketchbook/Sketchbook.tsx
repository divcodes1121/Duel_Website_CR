/**
 * THE FIELD BOOK — an open sketchbook you turn by hand, with a real loupe.
 *
 * Adapted from ThreeUI's `MengToSketchbookLandingPage`. Three things came
 * across and the rest deliberately did not: the BOOK (a leaf that bends the way
 * paper bends rather than pivoting like a door), the MAGNIFYING GLASS (a real
 * object lying on the page that you pick up and put down), and the painted
 * PAPER GROUND. Its Singapore plates, its portfolio sections, its social bar
 * and its editorial footer are not this page's subject and are not here.
 *
 * ── THE ONE STRUCTURAL DIFFERENCE ────────────────────────────────────────
 * The reference's pages are IMAGES. Every leaf is a chain of nested strips
 * whose faces carry `background-image` with a per-strip `background-position-x`
 * — which is exact, cheap, and only possible because a page is one bitmap.
 *
 * These pages are LIVE DOM: a table computed from the entitlement rules, text
 * that has to be selectable and searchable, and figures counted at render time.
 * A background-image cannot hold any of that. So each strip clips a full-width
 * CLONE of the spread and offsets it, which is the same geometry reached a
 * different way. It costs N copies of one static spread, built at the start of
 * a turn and thrown away at the end — exactly the reference's own lifecycle.
 *
 * That choice is what lets the loupe magnify TEXT rather than a bitmap, so the
 * small print is genuinely sharper under the glass instead of larger and
 * softer. It is the reason this page is worth reading through a magnifier at
 * all.
 *
 * ── HOUSE RULES THIS OBEYS ───────────────────────────────────────────────
 * · NO INFINITE ANIMATION. The reference breathes its scroll cue forever;
 *   `index.css` bans that outright and is specific about why — the old glow
 *   loops animated box-shadow and filter, and that is what made the app lag.
 *   Every frame here is driven by a rAF that TEARS ITSELF DOWN when the spring
 *   settles, the same shape as `topDockController` and `LiquidMetal`.
 * · REDUCED MOTION lands the turn instantly. The book is content, so it still
 *   renders and still turns — only the travel goes.
 * · THE BOOK OPENS PLAIN. An opening riffle — the pages fanning through
 *   themselves once on arrival, motion-blurred, landing on the cover — was
 *   built and REMOVED. It read as a glitch rather than as a book being
 *   opened: eight turns in a second and a half is faster than the eye can
 *   follow, so it looked like the page failing to settle rather than like
 *   paper. Recoverable from dfd93ed if it is ever wanted with a slower
 *   tempo and fewer leaves. The turn machinery it used is untouched — it is
 *   the same code every manual turn runs.
 * · The palette is redefined at PAGE SCOPE on the app's own token names, the
 *   way Duel Analysis already re-skins itself. No component here invents a
 *   colour that is not on the sheet in front of you.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MISSING_ART, PLATES, UNKNOWN_GATED, type Plate } from './plates';
import { ArtSlot } from './ArtSlot';
import { BrushRule, DateStamp, FernCluster, Sprig } from './Botanicals';
import styles from './Sketchbook.module.css';

/**
 * Strips in the bending leaf. The reference uses 18 for a bitmap; each of these
 * carries a cloned SUBTREE, so this is the trade between how smooth the curve is
 * and how much the browser has to build and rasterise for the length of a turn.
 *
 * A PHONE DOES NOT GET A CURL AT ALL — see `COARSE` below.
 */
const N = 12;

/**
 * NO 3D PAGE TURN ON A PHONE, AND THIS WAS NOT THE FIRST ANSWER.
 *
 * Reported as pixel-distorted, oddly-moving page art on mobile, and it was
 * real. Measured mid-turn on an iPhone: the leaf built 26 cloned images, each a
 * 400 kB watercolour, each its own containment context, each blended, all
 * inside a `preserve-3d` chain. Cutting the strips to five and dropping the
 * blend removed 14 of those layers and did NOT fix it — because the giveaway
 * was never the leaf. THE STATIC HALF-PAGES BESIDE IT WERE MUSHY TOO, and they
 * are not rotating at all.
 *
 * That is the tell. Everything inside `.book` sits in one 3D rendering context,
 * so the moment a leaf is in flight the compositor rasterises the WHOLE subtree
 * to a texture and transforms it — picking a raster scale once and reusing it
 * for the length of the turn. On a phone that scale is a fraction of what the
 * page needs, which is exactly what "pixel distorted" looks like. Nothing was
 * slow; it rendered at the wrong resolution.
 *
 * The honest fix on a small screen is not to do it at all. A phone gets a
 * CROSS-FADE: the spread swaps and the new plate fades up over 200ms, which
 * composites on opacity alone, touches no 3D context and cannot be rasterised
 * wrongly. Nobody reads a page mid-turn on a 390px screen, so what is lost is
 * an effect that was not landing anyway. The desktop curl is untouched.
 *
 * Read once — a pointer does not change mid-session — and it is the same test
 * that already decides whether the magnifier exists.
 */
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const SPAN = 0.449; /* gutter → outer edge, as a fraction of the book */
const BETA = 0.6; /* peak curl of the arc, radians */
const MAG = 2.25; /* what the glass is worth */
const TILT_X = 4.5;
const TILT_Y = 7;
const ZOOM_MIN = 0.9;
const ZOOM_MAX = 1.5;
/* A committed turn, flat to flat. Long enough to read as paper, short enough
   that six of them in a row is browsing rather than waiting. */
const TURN_MS = 620;

type Turn = { dir: 'next' | 'prev'; from: number; to: number; t: number };
/**
 * A LEAF ALWAYS FINISHES ON A CLOCK, never on a spring.
 *
 * A drag-release was a spring, on the reasoning that a reader who let go with
 * momentum should have it honoured. The reasoning was fine and the mechanism
 * was not: a critically damped spring APPROACHES its target and never arrives,
 * so the settle test is a threshold, and from a release part-way through a turn
 * it crawls. Measured — released at t=0.81, the leaf was still at 179.22 of 180
 * degrees 1.6 seconds later, never crossing the threshold, so the page never
 * committed and the book silently refused to turn. Keyboard turns were fine
 * throughout, which is exactly why it survived: they were already tweens.
 *
 * So everything is a tween with a real end, and the release's velocity buys a
 * SHORTER one rather than a different curve. A flick still feels faster than a
 * slow drag; it just also lands.
 */
type Motion = { from: number; target: number; dur: number; t0: number; done?: () => void };

export function Sketchbook() {
  const [idx, setIdx] = useState(0);
  const [zoomPct, setZoomPct] = useState(100);
  const [loupeOn, setLoupeOn] = useState(true);
  const [hinted, setHinted] = useState(false);
  /* Cleared the first time the glass is actually picked up. A label that
     stays after you have learned the thing it teaches is clutter. */
  const [loupeUsed, setLoupeUsed] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const box3dRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const spreadRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const loupeRef = useRef<HTMLDivElement>(null);
  const zoomWrapRef = useRef<HTMLDivElement>(null);
  const zoomInnerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const aboutRef = useRef<HTMLElement>(null);

  /* Everything the animation touches lives in refs. It writes custom properties
     on one node per frame; in state it would re-render the whole book sixty
     times a second to move a transform React is not managing anyway. Same
     reasoning as the filmstrip's float position. */
  const turnRef = useRef<Turn | null>(null);
  const springRef = useRef<Motion | null>(null);
  const stripsRef = useRef<HTMLElement[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const idxRef = useRef(0);
  const view = useRef({ rx: 0, ry: 0, z: 1, trx: 0, try_: 0, tz: 1 });
  const viewActive = useRef(false);
  const loupe = useRef<{ x: number; y: number } | null>(null);
  const grab = useRef<{ cx: number; cy: number; x0: number; y0: number } | null>(null);
  const target = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dir: 'next' | 'prev'; x0: number; y0: number; w: number; moved: number; up: number; vel: number; at: number } | null>(null);

  idxRef.current = idx;
  const M = PLATES.length;
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Two things that are invisible from a screenshot, said out loud in dev.
     A DRIFTED LABEL would render perfectly and be wrong — the access plate
     matches area names against the gate's own lists, so a rename on one side
     only would quietly relabel a free area as locked here and nowhere else.
     OUTSTANDING ART is not a fault at all; the placeholder is a designed state.
     It is printed because "which drawings are still missing" is otherwise a
     question you answer by turning nine pages and looking. */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (UNKNOWN_GATED.length) {
      console.error('[Sketchbook] gated sections missing from AREAS:', UNKNOWN_GATED);
    }
    if (MISSING_ART.length) {
      console.info(
        `[Sketchbook] ${MISSING_ART.length} plate(s) awaiting art in public/assets/guide/: ` +
          MISSING_ART.map((f) => `${f}.png`).join(', '),
      );
    }
  }, []);

  /* ---------------------------------------------------------------- loupe */
  const loupeSize = useCallback(() => {
    const w = bookRef.current?.clientWidth ?? 0;
    return Math.round(Math.max(150, Math.min(250, w * 0.235)));
  }, []);

  /* Mirror whatever the book is showing into the magnified copy. Clones, not a
     second render: the copy must be pixel-identical to what is under the glass,
     and a second React tree could disagree with the first mid-turn. */
  const syncZoom = useCallback(() => {
    const inner = zoomInnerRef.current;
    const book = bookRef.current;
    if (!inner || !book) return;
    inner.textContent = '';
    for (const child of Array.from(book.children)) {
      if ((child as HTMLElement).dataset.zone) continue; /* hit targets need no copy */
      inner.appendChild(child.cloneNode(true));
    }
  }, []);

  const placeLoupe = useCallback(() => {
    const book = bookRef.current;
    const el = loupeRef.current;
    const wrap = zoomWrapRef.current;
    const inner = zoomInnerRef.current;
    if (!book || !el || !wrap || !inner || !loupe.current) return;
    const bw = book.clientWidth;
    const bh = book.clientHeight;
    if (!bw) return;

    const { x: lx, y: ly } = loupe.current;
    const R = loupeSize() / 2;
    const bez = R * 2 * 0.058;
    el.style.setProperty('--lr', `${R * 2}px`);
    el.style.transform = `translate3d(${(lx - R).toFixed(1)}px,${(ly - R).toFixed(1)}px,0)`;

    /* THE MAGNIFIED COPY IS BIGGER THAN THE BOOK, and it has to be.
       `.zoomwrap` used to sit exactly on the book with `overflow: hidden`, so
       the moment the glass reached an edge the half of the lens hanging past
       the paper was CLIPPED — the disc came out cut off by a straight vertical
       line, which read as the magnifier breaking apart at the page sides.
       Nothing was broken; the layer simply ran out.

       So the wrap is inflated by one radius on every side and the mask is
       offset to match. `.zoominner` is inset by the same amount, which puts its
       own box back exactly on the book — so every coordinate below is still in
       plain book pixels and none of the magnification maths had to change. */
    const pad = Math.ceil(R) + 8;
    wrap.style.setProperty('--zpad', `${pad}px`);

    /* Where the paper's edges actually land once the book is scaled. The copy
       fades out as the glass wanders off the sheet, so you are left looking
       through plain glass rather than at a sliver of page on bare desk. */
    const z = view.current.z;
    const cx = bw / 2;
    const cy = bh / 2;
    const x0 = cx + (0 - cx) * z;
    const x1 = cx + (bw - cx) * z;
    const y0 = cy + (0 - cy) * z;
    const y1 = cy + (bh - cy) * z;
    const nx = Math.max(x0, Math.min(lx, x1));
    const ny = Math.max(y0, Math.min(ly, y1));
    const inside =
      lx > x0 && lx < x1 && ly > y0 && ly < y1
        ? Math.min(lx - x0, x1 - lx, ly - y0, y1 - ly)
        : -Math.hypot(lx - nx, ly - ny);
    const k = Math.max(0, Math.min(1, (inside + R * 0.3) / (R * 0.55)));

    wrap.style.opacity = (loupeOn ? k : 0).toFixed(3);
    if (k <= 0.002) return;
    const r = (R - bez).toFixed(1);
    const mask = `radial-gradient(circle ${r}px at ${(lx + pad).toFixed(1)}px ${(ly + pad).toFixed(1)}px,#000 calc(100% - 1px),transparent 100%)`;
    wrap.style.webkitMaskImage = mask;
    wrap.style.maskImage = mask;

    /* The page point beneath the glass, magnified about that same spot, so the
       lens keeps showing MAG times whatever is actually on screen. */
    const px = cx + (lx - cx) / z;
    const py = cy + (ly - cy) / z;
    const s = MAG * z;
    inner.style.transform = `translate(${(lx - px * s).toFixed(1)}px,${(ly - py * s).toFixed(1)}px) scale(${s.toFixed(4)})`;
  }, [loupeOn, loupeSize]);

  const restLoupe = useCallback(() => {
    const book = bookRef.current;
    if (!book) return;
    /* Parked ON the page rather than half off its corner. The reference rests
       its glass at the lower right, which works there because those plates are
       full-bleed paintings — every inch of them has something under it. These
       pages are typeset, so the lower right is usually blank margin, and a
       magnifier resting over blank paper looks like an ornament rather than a
       tool. Here it lands over the right leaf's text block, so its first frame
       shows it doing its job. */
    loupe.current = { x: book.clientWidth * 0.79, y: book.clientHeight * 0.35 };
    placeLoupe();
  }, [placeLoupe]);

  /* ------------------------------------------------------------ the leaf */
  const applyTurn = useCallback((t: number) => {
    const box = box3dRef.current;
    if (!box) return;
    const th = Math.PI * t; /* how far the leaf has swung */
    const beta = BETA * Math.sin(Math.PI * t); /* flat at both ends */
    const D = 180 / Math.PI;
    const tt = th + beta;
    const td = (2 * beta) / N;
    box.style.setProperty('--tt', `${(tt * D).toFixed(2)}deg`);
    box.style.setProperty('--td', `${(td * D).toFixed(3)}deg`);
    box.style.setProperty('--shade', Math.sin(Math.PI * t).toFixed(3));
    const strips = stripsRef.current;
    for (let i = 0; i < strips.length; i++) {
      const l1 = Math.abs(Math.cos(tt - i * td));
      const l2 = Math.abs(Math.cos(tt - (i + 1) * td));
      const st = strips[i].style;
      st.setProperty('--lit', l1.toFixed(3));
      st.setProperty('--a1', ((1 - l1) * 0.62).toFixed(3));
      st.setProperty('--a2', ((1 - l2) * 0.62).toFixed(3));
    }
  }, []);

  /* One clone of the spread, clipped to a window and slid so the window shows
     the requested slice. This is the DOM stand-in for the reference's
     `background-position-x`. */
  const sliceOf = useCallback((plate: number, offsetPx: number, widthPx: number) => {
    const src = spreadRef.current?.querySelector<HTMLElement>(`[data-plate="${plate}"]`);
    const host = document.createElement('div');
    host.className = styles.slice;
    if (!src) return host;
    const copy = src.cloneNode(true) as HTMLElement;
    copy.removeAttribute('data-plate');
    /* THE CLONE INHERITS `hidden`, AND THAT IS WHY THE LEAF DREW NOTHING.
       Only the open plate is visible in the spread; every other one carries
       `hidden`, which `.plate[hidden]` turns into `display: none`. A turn shows
       the page you are LEAVING and the one you are ARRIVING at, and at least
       one of those is always a hidden plate — so the strips were built, the
       geometry was right, the lighting ran, and the whole leaf was
       `display: none`. Content present, correct, and invisible. */
    copy.removeAttribute('hidden');
    copy.removeAttribute('aria-hidden');
    copy.style.width = `${widthPx}px`;
    copy.style.marginLeft = `${offsetPx}px`;
    host.appendChild(copy);
    return host;
  }, []);

  const buildLeaf = useCallback(
    (t: Turn) => {
      const book = bookRef.current;
      const box = box3dRef.current;
      const layers = layersRef.current;
      if (!book || !box || !layers) return;
      const bw = book.clientWidth;
      box.style.setProperty('--bw', `${bw}px`);
      layers.textContent = '';
      stripsRef.current = [];

      const next = t.dir === 'next';
      /* The two halves that stay put: the from-page's outer half on one side,
         the to-page's on the other. */
      const half = (side: 'left' | 'right', plate: number) => {
        const d = document.createElement('div');
        d.className = `${styles.half} ${side === 'left' ? styles.halfLeft : styles.halfRight}`;
        d.appendChild(sliceOf(plate, side === 'left' ? 0 : -bw / 2, bw));
        const g = document.createElement('div');
        g.className = `${styles.gutter} ${side === 'left' ? styles.gutterLeft : styles.gutterRight}`;
        d.appendChild(g);
        return d;
      };
      layers.appendChild(half('left', next ? t.from : t.to));
      layers.appendChild(half('right', next ? t.to : t.from));

      const curl = document.createElement('div');
      curl.className = `${styles.curl} ${next ? styles.curlNext : styles.curlPrev}`;
      curl.style.setProperty('--n', String(N));
      curl.style.setProperty('--span', String(SPAN));
      let host: HTMLElement = curl;
      const sw = (bw * SPAN) / N;
      for (let i = 0; i < N; i++) {
        const s = document.createElement('div');
        s.className = styles.strip;
        /* Where this strip's window sits on each of the two pages it shows. */
        const a = -(bw * 0.5 + i * sw); /* the from-page */
        const b = (i + 1) * sw - bw * 0.5; /* the to-page  */
        const face = (cls: string, plate: number, off: number) => {
          const f = document.createElement('div');
          f.className = `${styles.face} ${cls}`;
          f.appendChild(sliceOf(plate, off, bw));
          const sh = document.createElement('div');
          sh.className = styles.sh;
          const gl = document.createElement('div');
          gl.className = styles.gl;
          f.appendChild(sh);
          f.appendChild(gl);
          return f;
        };
        s.appendChild(face(styles.front, t.from, next ? a : b));
        s.appendChild(face(styles.back, t.to, next ? b : a));
        if (i === N - 1) s.classList.add(styles.edge);
        host.appendChild(s);
        host = s;
        stripsRef.current.push(s);
      }
      layers.appendChild(curl);
      applyTurn(t.t);
    },
    [applyTurn, sliceOf],
  );

  const clearLeaf = useCallback(() => {
    if (layersRef.current) layersRef.current.textContent = '';
    stripsRef.current = [];
    box3dRef.current?.style.setProperty('--shade', '0');
  }, []);

  /* --------------------------------------------------------- the rAF loop */
  const applyView = useCallback(() => {
    const box = box3dRef.current;
    if (!box) return;
    const v = view.current;
    box.style.setProperty('--rx', `${v.rx.toFixed(2)}deg`);
    box.style.setProperty('--ry', `${v.ry.toFixed(2)}deg`);
    box.style.setProperty('--zoom', v.z.toFixed(3));
  }, []);

  const tick = useCallback(
    (now: number) => {
      rafRef.current = null;
      /* No per-frame delta any more: the leaf reads real elapsed time from its
         own start, and the view and loupe eases are proportional steps toward a
         target rather than integrations. Nothing left in this loop needs dt. */
      lastRef.current = now;

      const s = springRef.current;
      const t = turnRef.current;
      if (s && t) {
        /* REAL elapsed time, not accumulated dt. `dt` is clamped to 32ms so a
           backgrounded tab cannot jump the animation on its first frame back —
           correct for that, and wrong for a fixed tempo, because every frame
           slower than the clamp is under-counted and the turn silently runs
           long. Measured in a throttled browser: a 620ms tween took 980ms. */
        const k = Math.min(1, (now - s.t0) / 1000 / s.dur);
        /* ease-out cubic: the leaf leaves fast and lands softly, which is how a
           page dropped from the fingers behaves */
        const e = 1 - Math.pow(1 - k, 3);
        t.t = s.from + (s.target - s.from) * e;
        applyTurn(t.t);
        if (k >= 1) {
          springRef.current = null;
          s.done?.();
        }
      }

      /* the view spring */
      const v = view.current;
      let moving = false;
      for (const [k, tk] of [['rx', 'trx'], ['ry', 'try_'], ['z', 'tz']] as const) {
        const d = (v[tk] as number) - (v[k] as number);
        if (Math.abs(d) > 0.0005) {
          (v[k] as number) = (v[k] as number) + d * 0.14;
          moving = true;
        } else (v[k] as number) = v[tk] as number;
      }
      if (moving) {
        applyView();
        placeLoupe();
      }
      viewActive.current = moving;

      /* the glass easing out of the leaf's way */
      let lmoved = false;
      if (target.current && !grab.current && loupe.current) {
        const dx = target.current.x - loupe.current.x;
        const dy = target.current.y - loupe.current.y;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
          loupe.current = { ...target.current };
          target.current = null;
        } else {
          loupe.current = { x: loupe.current.x + dx * 0.17, y: loupe.current.y + dy * 0.17 };
          lmoved = true;
        }
        placeLoupe();
      }

      /* THE LOOP STOPS. Nothing here spins while the book is at rest. */
      if ((springRef.current || moving || lmoved) && rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    },
    [applyTurn, applyView, placeLoupe],
  );

  const kick = useCallback(() => {
    if (rafRef.current === null) {
      lastRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  /* ------------------------------------------------------- turn control */
  const settle = useCallback(
    (to: number) => {
      turnRef.current = null;
      springRef.current = null;
      clearLeaf();
      /* THE REF IS THE LIVE VALUE; THE STATE IS ONLY FOR RENDERING.
         `setIdx` does not land until the next render, so a second arrow press
         inside the same tick read the OLD index and turned to a page that had
         just been left — four presses advanced two plates. Writing the ref here
         means `startTurn` always reads where the book actually is. */
      idxRef.current = to;
      setIdx(to);
    },
    [clearLeaf],
  );

  const shove = useCallback((dir: 'next' | 'prev') => {
    const book = bookRef.current;
    if (!book || !loupe.current || grab.current) return;
    const bw = book.clientWidth;
    const bh = book.clientHeight;
    const nx = (bw / 2 + (loupe.current.x - bw / 2) / view.current.z) / bw;
    if (nx < 0.02 || nx > 0.98) return; /* already clear of the page */
    target.current = { x: bw * (dir === 'next' ? 0.13 : 0.87), y: bh * 0.83 };
  }, []);

  /** A phone's page change: swap the plate, let it fade up. */
  const swapTo = useCallback(
    (to: number) => {
      const el = spreadRef.current;
      idxRef.current = to;
      setIdx(to);
      if (!el || reduced) return;
      /* Restarted by hand, because re-adding a class React has not re-rendered
         does not replay a CSS animation. */
      el.removeAttribute('data-swap');
      void el.offsetWidth;
      el.setAttribute('data-swap', '');
    },
    [reduced],
  );

  const startTurn = useCallback(
    (dir: 'next' | 'prev', t: number) => {
      springRef.current = null;
      const from = turnRef.current ? turnRef.current.to : idxRef.current;
      shove(dir);
      const to = dir === 'next' ? (from + 1) % M : (from - 1 + M) % M;
      turnRef.current = { dir, from, to, t };
      buildLeaf(turnRef.current);
    },
    [M, buildLeaf, shove],
  );

  /**
   * `fling` is the release speed, and it only shortens the travel. The distance
   * left sets the base duration, so finishing a turn already dragged most of the
   * way does not take as long as one from flat.
   */
  const commit = useCallback(
    (fling?: number) => {
      const t = turnRef.current;
      if (!t) return;
      if (reduced) {
        settle(t.to);
        return;
      }
      const remaining = Math.max(0.3, 1 - t.t);
      const haste = 1 + Math.min(4, fling ?? 0) * 0.45;
      springRef.current = {
        from: t.t,
        target: 1,
        dur: (TURN_MS * remaining) / haste / 1000,
        t0: performance.now(),
        done: () => settle(t.to),
      };
      kick();
    },
    [kick, reduced, settle],
  );

  const cancel = useCallback(() => {
    const t = turnRef.current;
    if (!t) return;
    if (reduced) {
      settle(t.from);
      return;
    }
    const dur = (TURN_MS * Math.max(0.3, t.t)) / 1000;
    springRef.current = { from: t.t, target: 0, dur, t0: performance.now(), done: () => settle(t.from) };
    kick();
  }, [kick, reduced, settle]);

  const step = useCallback(
    (dir: 'next' | 'prev') => {
      setHinted(true);
      const from = turnRef.current ? turnRef.current.to : idxRef.current;
      if (COARSE) {
        swapTo(dir === 'next' ? (from + 1) % M : (from - 1 + M) % M);
        return;
      }
      if (turnRef.current) settle(turnRef.current.to);
      startTurn(dir, 0);
      commit();
    },
    [M, commit, settle, startTurn, swapTo],
  );

  /**
   * THE INDEX IS AT THE FOOT OF THE PAGE AND THE BOOK IS AT THE TOP, so
   * choosing a plate from it used to turn a book nobody could see — the only
   * feedback was a highlight moving on the row you had just clicked. Picking a
   * plate is a request to READ it, so the page comes back up to the book.
   *
   * Scrolled FIRST, and the turn follows. Running them the other way round
   * animates the leaf while it is still off screen, so the reader arrives after
   * the interesting part is over.
   */
  const showBook = useCallback(() => {
    pageRef.current?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, [reduced]);

  const goTo = useCallback(
    (i: number) => {
      setHinted(true);
      showBook();
      if (i === idxRef.current) return;
      const fwd = (i - idxRef.current + M) % M;
      const back = (idxRef.current - i + M) % M;
      if (Math.min(fwd, back) === 1) {
        step(fwd === 1 ? 'next' : 'prev');
        return;
      }
      if (turnRef.current) settle(turnRef.current.to);
      if (COARSE) {
        swapTo(i);
        return;
      }
      setIdx(i);
    },
    [M, settle, showBook, step, swapTo],
  );

  /* --------------------------------------------------------- the pointer */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const zone = (e.target as HTMLElement).closest('[data-zone]');
      setHinted(true);
      if (!zone) return;
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
      const r = bookRef.current!.getBoundingClientRect();
      const dir = (e.clientX - r.left) / r.width > 0.5 ? 'next' : 'prev';
      /* On a phone there is no leaf to drag — the gesture is still read, it is
         just resolved on release rather than followed frame by frame. */
      if (!COARSE) startTurn(dir, 0);
      drag.current = { dir, x0: e.clientX, y0: e.clientY, w: r.width, moved: 0, up: 0, vel: 0, at: performance.now() };
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x0;
      d.moved = Math.max(d.moved, Math.abs(dx));
      d.up = Math.max(d.up, Math.abs(e.clientY - d.y0));
      const raw = (d.dir === 'next' ? -dx : dx) / (d.w * 0.62);
      const t = Math.max(0, Math.min(1, raw));
      const now = performance.now();
      d.vel = (t - (turnRef.current?.t ?? 0)) / Math.max(0.001, (now - d.at) / 1000);
      d.at = now;
      if (turnRef.current) {
        turnRef.current.t = t;
        applyTurn(t);
      }
    };
    const up = () => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      if (COARSE) {
        /* A TAP on the half you want, or a SIDEWAYS swipe — and nothing else.
           This page scrolls vertically and the book fills most of it, so a
           finger flicking the page up starts on the book and ends on it: read
           as a gesture it would turn the page every time someone scrolled.
           A turn therefore needs either almost no travel at all (a tap) or
           horizontal travel that clearly beats the vertical. */
        const tap = d.moved < 10 && d.up < 10;
        const swipe = d.moved >= 34 && d.moved > d.up * 1.4;
        if (tap || swipe) step(d.dir);
        return;
      }
      if (!turnRef.current) return;
      if (d.moved < 6) {
        commit();
        return;
      }
      if (turnRef.current.t > 0.42 || d.vel > 1.1) commit(Math.max(0, Math.min(6, d.vel)));
      else cancel();
    };

    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('dragstart', (e) => e.preventDefault());
    return () => {
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
    };
  }, [applyTurn, cancel, commit, startTurn, step]);

  /* the book leans very slightly toward the pointer */
  useEffect(() => {
    const set = (rx: number, ry: number, z: number) => {
      const v = view.current;
      v.trx = rx;
      v.try_ = ry;
      v.tz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
      setZoomPct(Math.round(v.tz * 100));
      kick();
    };
    const onMove = (e: PointerEvent) => {
      if (grab.current || drag.current) return;
      const book = bookRef.current;
      if (!book) return;
      const r = book.getBoundingClientRect();
      const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 0.62)));
      const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height * 0.9)));
      set(-ny * TILT_X, nx * TILT_Y, view.current.tz);
    };
    const off = () => set(0, 0, view.current.tz);
    addEventListener('pointermove', onMove);
    addEventListener('blur', off);
    return () => {
      removeEventListener('pointermove', onMove);
      removeEventListener('blur', off);
    };
  }, [kick]);

  /* the glass itself */
  useEffect(() => {
    const el = loupeRef.current;
    if (!el) return;
    const down = (e: PointerEvent) => {
      if (!loupeOn || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation(); /* never starts a page turn */
      target.current = null;
      grab.current = { cx: e.clientX, cy: e.clientY, x0: loupe.current!.x, y0: loupe.current!.y };
      el.classList.add(styles.held);
      el.setPointerCapture(e.pointerId);
      setHinted(true);
      setLoupeUsed(true);
    };
    const move = (e: PointerEvent) => {
      const g = grab.current;
      const book = bookRef.current;
      if (!g || !book) return;
      const R = loupeSize() / 2;
      /* The glass carries none of the book's transform, so the cursor maps 1:1. */
      loupe.current = {
        x: Math.max(-R * 0.7, Math.min(book.clientWidth + R * 0.7, g.x0 + (e.clientX - g.cx))),
        y: Math.max(-R * 0.7, Math.min(book.clientHeight + R, g.y0 + (e.clientY - g.cy))),
      };
      placeLoupe();
    };
    const up = () => {
      grab.current = null;
      el.classList.remove(styles.held);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [loupeOn, loupeSize, placeLoupe]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 'next' : 'prev');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [step]);

  /* The spread changed under the glass, so the copy has to be rebuilt and the
     book's own width re-published for the next leaf. */
  useLayoutEffect(() => {
    box3dRef.current?.style.setProperty('--bw', `${bookRef.current?.clientWidth ?? 0}px`);
    syncZoom();
    if (!loupe.current) restLoupe();
    else placeLoupe();
  }, [idx, placeLoupe, restLoupe, syncZoom]);

  useEffect(() => {
    const onResize = () => {
      box3dRef.current?.style.setProperty('--bw', `${bookRef.current?.clientWidth ?? 0}px`);
      restLoupe();
    };
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, [restLoupe]);

  const zoomBy = (f: number) => {
    const v = view.current;
    v.tz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.tz * f));
    setZoomPct(Math.round(v.tz * 100));
    setHinted(true);
    kick();
  };

  /* The page owns its own scroll region — `body` is `overflow: hidden` project
     wide — so this scrolls THAT, not the document. `scrollIntoView` on the band
     would work too and is worse: it picks its own alignment. */
  const scrollOn = () => {
    const region = pageRef.current;
    const band = aboutRef.current;
    if (!region || !band) return;
    region.scrollTo({ top: band.offsetTop - 40, behavior: reduced ? 'auto' : 'smooth' });
  };

  const plate = PLATES[idx];

  return (
    <div className={styles.page} ref={pageRef}>
      <div className={styles.wash} aria-hidden="true" />
      <div className={styles.grain} aria-hidden="true" />

      {/* THE MARGINS. Fixed rather than in flow: they are the room the book is
          lying in, not part of the page's column, so they must not shift when
          the index below scrolls or reflow when a plate changes height. */}
      <FernCluster className={styles.botany + ' ' + styles.botanyTL} />
      <Sprig className={styles.botany + ' ' + styles.botanyTR} />
      <FernCluster className={styles.botany + ' ' + styles.botanyBL} />

      <header className={styles.head}>
        {/* THE WAY OUT, at the far left edge. The wordmark beside it has always
            been a link home, but a wordmark is not a control — nobody reads a
            masthead as a button, and this page is a full-screen object with no
            surrounding chrome to escape through. Absolutely positioned so it
            sits hard against the edge without pushing the centred title off
            centre, which is what putting it in the flex row would have done. */}
        <a className={styles.home} href="#/" aria-label="Back to home">
          <svg viewBox="0 0 16 12" width="11" height="9" fill="none" aria-hidden="true">
            <path d="M7 1 2 6l5 5M2.4 6H15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to home
        </a>
        <a className={styles.brand} href="#/">Deckkies</a>
        <p className={styles.kicker}>A field book &mdash; what the site is, and what a Member and a Pro each get</p>
      </header>

      <div className={styles.wrap}>
        <div className={styles.stage} ref={stageRef}>
          <button className={styles.arrow + ' ' + styles.arrowL} onClick={() => step('prev')} aria-label="Previous plate">
            <svg viewBox="0 0 14 44" width="14" height="44" fill="none" aria-hidden="true">
              <polyline points="11,3 3,22 11,41" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className={styles.box3d} ref={box3dRef}>
            <div className={styles.tilt}>
              <div className={styles.cast + ' ' + styles.castAmbient} aria-hidden="true" />
              <div className={styles.cast + ' ' + styles.castContact} aria-hidden="true" />
              <div className={styles.book} ref={bookRef}>
                {/* The resting spread. During a turn the leaf layer covers it. */}
                <div className={styles.spread} ref={spreadRef}>
                  {PLATES.map((p, i) => (
                    <div
                      key={p.id}
                      className={styles.plate}
                      data-plate={i}
                      data-layout={p.layout}
                      hidden={i !== idx}
                      aria-hidden={i !== idx}
                    >
                      <PlateBody plate={p} />
                    </div>
                  ))}
                </div>
                <div className={styles.layers} ref={layersRef} aria-hidden="true" />

                {/* BOTH DIRECTIONS, AND THE PAPER SAYS SO. The left half takes
                    you back and the right half forward, the way a book already
                    works, and each carries a corner that lifts under the
                    pointer so the affordance is on the page rather than only in
                    the two arrows outside it. */}
                <button className={styles.zone + ' ' + styles.zonePrev} data-zone="prev" aria-label="Previous plate">
                  <span className={styles.corner + ' ' + styles.cornerL} aria-hidden="true" />
                </button>
                <button className={styles.zone + ' ' + styles.zoneNext} data-zone="next" aria-label="Next plate">
                  <span className={styles.corner + ' ' + styles.cornerR} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* The magnified copy: a second version of the book sitting OUTSIDE
                the tilt, masked to the circle the glass is currently over. */}
            <div className={styles.zoomwrap} ref={zoomWrapRef} aria-hidden="true">
              <div className={styles.zoominner} ref={zoomInnerRef} />
            </div>

            {/* The glass lies on the desk, above the tilt, so the lean of the
                page never nudges it. Pick it up and it stays where you put it. */}
            <div className={styles.loupe + (loupeOn ? ' ' + styles.loupeOn : '')} ref={loupeRef}>
              <span className={styles.grip} />
              <span className={styles.ring}>
                <span className={styles.lens} />
              </span>
              {/* IT LOOKS LIKE AN ORNAMENT UNTIL SOMEONE TRIES IT. A real glass
                  lying on a page gives no clue that it can be moved, and the
                  one line of hint under the book was doing all the work. This
                  sits on the object itself and clears the moment it is used. */}
              {!loupeUsed && (
                <span className={styles.loupeTag} aria-hidden="true">
                  Pick me up &middot; drag me over the page
                </span>
              )}
            </div>
          </div>

          <button className={styles.arrow + ' ' + styles.arrowR} onClick={() => step('next')} aria-label="Next plate">
            <svg viewBox="0 0 14 44" width="14" height="44" fill="none" aria-hidden="true">
              <polyline points="3,3 11,22 3,41" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <p className={styles.caption}>{plate.title}</p>

        <div className={styles.controls}>
        <div className={styles.tools} role="group" aria-label="View controls">
          <button className={styles.tool} onClick={() => zoomBy(1 / 1.16)} disabled={zoomPct <= ZOOM_MIN * 100 + 0.5} aria-label="Zoom out">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="8.6" cy="8.6" r="5.6" /><path d="M12.8 12.8 17.4 17.4M6.2 8.6h4.8" /></svg>
          </button>
          <span className={styles.read}>{zoomPct}%</span>
          <button className={styles.tool} onClick={() => zoomBy(1.16)} disabled={zoomPct >= ZOOM_MAX * 100 - 0.5} aria-label="Zoom in">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="8.6" cy="8.6" r="5.6" /><path d="M12.8 12.8 17.4 17.4M6.2 8.6h4.8M8.6 6.2v4.8" /></svg>
          </button>
          <span className={styles.sep} aria-hidden="true" />
          <button
            className={styles.tool + ' ' + styles.toolLoupe}
            aria-pressed={loupeOn}
            aria-label="Magnifying glass"
            onClick={() => {
              setLoupeOn((v) => !v);
              setHinted(true);
            }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="8.8" cy="8.8" r="5.8" /><path d="M13 13l4.4 4.4" /><path d="M6.4 7.2a3.2 3.2 0 0 1 2.4-1.4" opacity=".55" /></svg>
          </button>
        </div>

          <p className={styles.hint + (hinted ? ' ' + styles.hintGone : '')}>
            Drag either page to turn it &middot; Drag the glass across the paper
          </p>
        </div>

        {/* THE ONLY LOOPING ANIMATION IN THE PROJECT, and it is a deliberate
            exception rather than an oversight. `index.css` bans infinite
            animation because the old glow loops animated `box-shadow` and
            `filter` across whole panels, which repaints a blurred layer every
            frame — that is what made the app lag. This is ONE 34px chevron
            moving on `transform` and `opacity`, both composited, touching no
            layout and no paint. It also stops entirely under
            `prefers-reduced-motion`, where it keeps the words and loses the
            travel. A scroll cue that does not move is not a cue. */}
        <button className={styles.scrollCue} onClick={scrollOn} aria-label="Scroll to the notes below">
          <span className={styles.scrollWord}>Scroll down</span>
          <svg className={styles.scrollArrow} viewBox="0 0 44 26" width="34" height="20" fill="none" aria-hidden="true">
            <polyline points="3,4 22,15 41,4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="3,12 22,23 41,12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
          </svg>
        </button>
      </div>

      <BrushRule className={styles.rule} />

      <section className={styles.about} ref={aboutRef}>
        <div>
          <p className={styles.sectionLabel}>About</p>
          <p className={styles.bio}>
            Deckkies is a Clash Royale companion built in two halves. One is a
            workshop &mdash; a duel builder, a vault of decks, folders of counters.
            The other reads a database of millions of stored battles and reports
            what those decks actually did, over a window you choose, with the
            evidence behind every figure stated rather than implied. This book is
            the short version of both: {PLATES.length} plates, a magnifier for the
            small print, and a table of who may open what that is computed from
            the same rule the site itself gates on.
            {/* COUNTED, NOT TYPED. This read "seven plates" for exactly as long
                as there were seven, and went stale the moment two more were
                added — a wrong figure in the one paragraph explaining that this
                site does not print figures it cannot stand behind. */}
          </p>
        </div>
        <Sprig className={styles.bloom} />
      </section>

      <BrushRule className={styles.rule + ' ' + styles.ruleShort} />

      <section className={styles.plates}>
        <p className={styles.sectionLabel}>Plates</p>
        <ol className={styles.index}>
          {PLATES.map((p, i) => (
            <li key={p.id}>
              <button className={styles.plateBtn} aria-current={i === idx} onClick={() => goTo(i)}>
                <span className={styles.n}>{String(i + 1).padStart(2, '0')}</span>
                <span className={styles.t}>{p.title}</span>
                <span className={styles.p}>{p.tab}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <p className={styles.foot}>
        Deckkies &middot; Field book &middot; Unofficial fan content, not affiliated with Supercell
      </p>
    </div>
  );
}

/**
 * One spread, laid out by what the plate IS rather than by a flag per element.
 *
 * `spread` &mdash; the drawing crosses the gutter and the words sit on it, the way
 * the reference's plates do. `split` &mdash; drawing on the left leaf, prose on the
 * right. `text` &mdash; both leaves prose, for the two plates that are a table and a
 * list and would be poorer with a picture competing for the room.
 */
function PlateBody({ plate }: { plate: Plate }) {
  const stamp = <DateStamp date={plate.date} />;

  if (plate.layout === 'spread') {
    return (
      <>
        {plate.art && (
          <div className={styles.artSpread}>
            <ArtSlot art={plate.art} tall />
          </div>
        )}
        <div className={styles.leaf}>
          {plate.legend && <div className={styles.legend}>{plate.legend}</div>}
        </div>
        <div className={styles.spine} aria-hidden="true" />
        <div className={styles.leaf} />
        {stamp}
      </>
    );
  }

  if (plate.layout === 'split') {
    return (
      <>
        <div className={styles.leaf}>{plate.art && <ArtSlot art={plate.art} />}</div>
        <div className={styles.spine} aria-hidden="true" />
        <div className={styles.leaf}>{plate.right}</div>
        {stamp}
      </>
    );
  }

  return (
    <>
      <div className={styles.leaf}>{plate.left}</div>
      <div className={styles.spine} aria-hidden="true" />
      <div className={styles.leaf}>{plate.right}</div>
      {stamp}
    </>
  );
}
