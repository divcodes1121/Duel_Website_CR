import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FireflyHue } from '../../three/Fireflies';
import styles from './Filmstrip.module.css';

export interface FilmstripItem {
  /** Stable identity. */
  key: string;
  /** What goes in the media well — for a deck, its eight card icons. */
  media: ReactNode;
  /** The circled number in the footer. Rank on Meta, position elsewhere. */
  index: number | string;
  title: string;
  /** The small tracked line under the title: use/win rates, deck counts. */
  subtitle?: string;
  /**
   * This item's OWN identity hue, overriding the strip's.
   *
   * The analytics areas each wear a different one — the same hue their sidebar
   * row and their block already carry — so the strip cannot have a single
   * colour without throwing that away. Where every item shares a hue (the
   * folders) the strip-level prop is still the shorter way to say it.
   */
  hue?: FireflyHue;
  /** Activating the centred card. Clicking an off-centre card centres it
   *  instead, which is the reference's behaviour and the one people expect. */
  onOpen?: () => void;
  /**
   * This item's own controls — rename, delete, open in game.
   *
   * THEY RENDER UNDER THE STRIP, FOR THE CENTRED ITEM ONLY, and that is a
   * structural decision rather than a layout preference. The card is a button,
   * and a button may not contain buttons: the browser closes the outer one
   * early and the whole card stops working. This project has already been
   * caught by exactly that in the Duel Zone's series row.
   *
   * Putting them below also means one control row instead of one per card,
   * which is what makes a strip of forty saved decks tractable.
   */
  actions?: ReactNode;
}

interface FilmstripProps {
  items: FilmstripItem[];
  /** The section's identity hue, for the index ring and the position dots. */
  hue?: FireflyHue;
  /** Accessible name for the strip. */
  label: string;
  /**
   * Which card the strip opens on.
   *
   * Defaults to the MIDDLE, not the first. Opening on index 0 fans every other
   * card off to one side, so the strip reads as a left-aligned pile rather than
   * as something you are standing in the middle of.
   */
  start?: number;
  /**
   * The `n / total` readout in the corner.
   *
   * Off on the landing screen: the dot rail already says where you are, and two
   * position indicators on one strip is one more than the strip needs.
   */
  counter?: boolean;
}

/* HOW HARD THE STRIP FANS, AND WHY IT IS GENTLER THAN IT LOOKS.
 *
 * A card rotated under perspective projects to a TRAPEZOID, not a rectangle,
 * and past about 30 degrees that trapezoid stops containing the centre of its
 * own bounding box — so the outermost cards became unclickable, and the very
 * last one had no hittable point anywhere inside its box at all. Measured with
 * `elementFromPoint` across a grid: index 6 returned the stage everywhere.
 *
 * These numbers keep every rendered card a comfortable target while still
 * reading as depth. `ROT_PER` is the degrees a card turns per step out;
 * `ANGLE` caps it so the far ones never go steep. */
const DEPTH = 140;
const ROT_PER = 11;
const ANGLE = 26;
/* HOW MANY NEIGHBOURS ARE DRAWN EACH SIDE.
 *
 * Two, and the number is a hit-testing result rather than a taste call.
 * Perspective both shrinks a receding card AND pulls it toward the vanishing
 * point, so the third one out ends up behind the second with its centre
 * covered — measured, `elementFromPoint` never returned it anywhere in its own
 * bounding box. A card that cannot be clicked should not be drawn, so the fan
 * stops at two and the dots reach the rest. */
const VISIBLE = 2;
/** Opacity falls to zero one step BEYOND the last drawn card, so the outermost
 *  one is still clearly visible rather than fading out exactly as it appears. */
const FADE = VISIBLE + 1;

/**
 * A browsable strip of cards, adapted from ThreeUI's `CharacterCarousel`.
 *
 * The reference ships this as an iframe running its own document with its own
 * rAF loop and a `postMessage` control channel. That shape exists so a gallery
 * site can drop an arbitrary authored page into a box; it is the wrong shape
 * here, where the cards are this app's own data and have to open this app's own
 * screens. So the geometry and the interaction model came across and the
 * delivery mechanism did not — no iframe, no bridge, no second document.
 *
 * ── THE LOOP STOPS ───────────────────────────────────────────────────────
 *
 * `CLAUDE.md` bans loops nobody can see, and the reference's runs forever. Here
 * the rAF is started by an interaction and tears itself down once the strip has
 * settled on an index — a resting filmstrip costs nothing. Same discipline as
 * `TopDock` and `LiquidMetal`.
 *
 * Under `prefers-reduced-motion` the position SNAPS rather than easing. The
 * strip is content, not decoration, so it still renders and still browses; only
 * the travel between cards is dropped.
 */
export function Filmstrip({ items, hue, label, start, counter = true }: FilmstripProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const initial = Math.max(
    0,
    Math.min(items.length - 1, start ?? Math.floor((items.length - 1) / 2)),
  );
  const [current, setCurrent] = useState(initial);

  /* Position is a FLOAT and lives in a ref, not in state.
   *
   * It changes every frame while the strip is moving, and every card's
   * transform is written from it directly. Putting it in state would re-render
   * the whole strip sixty times a second to move things that are not in the
   * React tree's way — the same reasoning `state/deckFx.ts` records for the
   * deck effects. `current` IS state, because it is the thing the rest of the
   * UI cares about and it changes once per card, not once per frame. */
  const pos = useRef(initial);
  const target = useRef(initial);
  const raf = useRef(0);
  const dragging = useRef(false);
  /* THE GAP IS MEASURED, NOT PARSED.
     `getComputedStyle(el).getPropertyValue('--gap')` returns the literal text
     of an unregistered custom property — `calc(var(--card-w) * 0.78)` — not a
     pixel length, so parseFloat gives NaN and every read silently fell back to
     a hardcoded 150. A probe element sized to `width: var(--gap)` lets the
     browser resolve it and reports the real number, which keeps the CSS as the
     single source of the spacing across both breakpoints. */
  /* The stage's pointer handler activates an item, and it must not re-bind
     every time the items array is rebuilt — so it reads them through a ref. */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const probeRef = useRef<HTMLElement>(null);
  const gapPx = useRef(150);
  const readGap = useCallback(() => {
    const w = probeRef.current?.getBoundingClientRect().width;
    if (w && w > 1) gapPx.current = w;
    return gapPx.current;
  }, []);

  const count = items.length;

  /** Write every card's transform from the current float position. */
  const paint = useCallback(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const cards = deck.children;
    const gap = gapPx.current;
    for (let i = 0; i < cards.length; i++) {
      const el = cards[i] as HTMLElement;
      const offset = i - pos.current;
      const abs = Math.abs(offset);
      const el2 = el;
      if (abs > VISIBLE) {
        el2.style.display = 'none';
        continue;
      }
      el2.style.display = '';
      const focus = Math.max(0, 1 - abs);
      /* Cards fan back in Z and rotate away from the viewer, which is what
         gives the strip its depth. The rotation is clamped so a far card never
         turns edge-on and disappears into a line. */
      const rot = Math.max(-ANGLE, Math.min(ANGLE, -offset * ROT_PER));
      el2.style.transform =
        `translate(-50%, -50%) translateX(${offset * gap}px) ` +
        `translateZ(${-abs * DEPTH}px) rotateY(${rot}deg)`;
      el2.style.opacity = String(Math.max(0, 1 - abs / FADE));
      el2.style.zIndex = String(1000 - Math.round(abs * 10));
      el2.style.setProperty('--focus', focus.toFixed(3));
      el2.dataset.current = abs < 0.5 ? 'true' : 'false';
    }
  }, []);

  const settle = useCallback(() => {
    raf.current = 0;
    const gapTo = target.current - pos.current;
    if (Math.abs(gapTo) < 0.002) {
      pos.current = target.current;
      paint();
      return; // settled: no more frames
    }
    pos.current += gapTo * 0.18;
    paint();
    raf.current = requestAnimationFrame(settle);
  }, [paint]);

  const kick = useCallback(() => {
    if (raf.current || document.hidden) return;
    raf.current = requestAnimationFrame(settle);
  }, [settle]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(count - 1, next));
      target.current = clamped;
      setCurrent(clamped);
      const calm =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (calm) {
        pos.current = clamped;
        paint();
        return;
      }
      kick();
    },
    [count, kick, paint],
  );

  /* The gap is a CSS value, so it is measured rather than duplicated in JS —
     the media query that shrinks the cards on a phone then moves the spacing
     with them and this file never learns about it. */
  useEffect(() => {
    const stage = stageRef.current;
    const deck = deckRef.current;
    if (!stage || !deck) return;
    const measure = () => {
      readGap();
      paint();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [paint, readGap, count]);

  useEffect(() => {
    paint();
  }, [paint, items]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /* ── drag ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let startX = 0;
    let startPos = 0;
    let moved = 0;
    /* Capture is DEFERRED until the pointer has actually travelled. See the
       note in `down`. */
    let captured = false;
    let pressed = -1;
    const DRAG_SLOP = 4;

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      /* NOT ON THE CONTROLS. The stage captures the pointer to track a drag,
         and a capture retargets every later pointer event — including the
         pointerup that would have completed a click — at the stage. So pressing
         Rename, Delete or a position dot did nothing at all: the button never
         saw its own click. Anything inside the action row or the dot rail is
         left alone. */
      const t = e.target as Element | null;
      if (t?.closest('[data-filmstrip-controls]')) return;
      dragging.current = true;
      moved = 0;
      captured = false;
      startX = e.clientX;
      startPos = pos.current;
      /* WHICH CARD WAS PRESSED, decided here and not from the click.
         A card is transformed in 3D, and the browser's click synthesis resolves
         to the common ancestor of the pointerdown and pointerup targets — which
         for a rotated, perspective-projected card is unreliable enough that
         clicking the second neighbour did nothing at all, repeatably. But
         `pointerdown` DOES land on the card every time, so the press is
         recorded here and acted on at pointerup. */
      const card = t?.closest<HTMLElement>('[data-filmstrip-card]');
      pressed = card ? Array.prototype.indexOf.call(card.parentElement!.children, card) : -1;
      /* NO `setPointerCapture` HERE, AND THAT IS THE WHOLE FIX.
         Capturing on pointerdown retargets the later pointerup at the stage,
         and the browser then fires `click` on the common ancestor rather than
         on the card — so a real mouse click on a card did nothing at all. It
         was invisible in testing because the check called `element.click()`,
         which is a synthetic dispatch that skips the pointer sequence entirely
         and therefore passed 7/7 against a broken control.
         Capture is taken below, only once the pointer has moved far enough to
         be a drag rather than a click. */
    };
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const gap = readGap();
      const dx = e.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      if (!captured && moved > DRAG_SLOP) {
        // Now it is a drag: hold the pointer so it can leave the stage.
        stage.setPointerCapture(e.pointerId);
        captured = true;
      }
      if (!captured) return;
      pos.current = Math.max(-0.4, Math.min(count - 0.6, startPos - dx / gap));
      paint();
    };
    const up = (e: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      if (captured) {
        try {
          stage.releasePointerCapture(e.pointerId);
        } catch {
          /* the pointer was already gone */
        }
      }
      captured = false;
      /* Past a few pixels this was a drag, not a click — swallow the click the
         browser is about to fire on whichever card is under the pointer, or
         every swipe would also open something. */
      /* A press that never travelled is an activation, not a drag. */
      if (moved <= DRAG_SLOP && pressed >= 0) {
        itemsRef.current[pressed]?.onOpen?.();
      }
      pressed = -1;
      goTo(Math.round(pos.current));
    };

    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    return () => {
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
    };
  }, [count, goTo, paint, readGap]);

  /* ── wheel and keys ────────────────────────────────────────────────── */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let lock = 0;
    const wheel = (e: WheelEvent) => {
      // Horizontal intent only: a vertical scroll belongs to the page, and
      // hijacking it is the thing everyone hates about carousels.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lock < 220) return;
      lock = now;
      goTo(target.current + (e.deltaX > 0 ? 1 : -1));
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(target.current - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo(target.current + 1);
      }
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    stage.addEventListener('keydown', key);
    return () => {
      stage.removeEventListener('wheel', wheel);
      stage.removeEventListener('keydown', key);
    };
  }, [goTo]);

  if (count === 0) return null;

  return (
    <div
      ref={stageRef}
      className={styles.stage}
      data-filmstrip
      data-hue={hue}
      style={hue ? ({ '--strip-hue': `var(--hue-${hue})` } as React.CSSProperties) : undefined}
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={0}
    >
      {counter && (
        <span className={styles.counter} aria-live="polite">
          {current + 1} / {count}
        </span>
      )}

      {/* PREV / NEXT.
          `data-filmstrip-controls` keeps the drag off them, and `data-metal`
          opts them into the app-wide liquid-metal layer — they are circular
          controls above its 1.7rem floor, so they get the same chromatic rim
          every other icon button has. Disabled at the ends rather than
          wrapping: a strip with a first and a last card should say so. */}
      <button
        type="button"
        className={`${styles.arrow} ${styles.arrowPrev}`}
        data-filmstrip-controls
        data-metal
        aria-label="Previous"
        disabled={current === 0}
        onClick={() => goTo(target.current - 1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5 8 12l7 7" />
        </svg>
      </button>
      <button
        type="button"
        className={`${styles.arrow} ${styles.arrowNext}`}
        data-filmstrip-controls
        data-metal
        aria-label="Next"
        disabled={current === count - 1}
        onClick={() => goTo(target.current + 1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Sized to `var(--gap)` and never painted; see `readGap`. */}
      <i ref={probeRef} className={styles.probe} aria-hidden="true" />

      <div ref={deckRef} className={styles.deck}>
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            className={styles.card}
            data-filmstrip-card
            aria-label={item.title}
            style={
              item.hue ? ({ '--strip-hue': `var(--hue-${item.hue})` } as React.CSSProperties) : undefined
            }
            /* Off-centre cards centre themselves; the centred one opens. That
               is the reference's behaviour and it removes the need for a
               separate hit target. */
            /* HOVER RESPONDS, CLICK OPENS.
               The reference centres a card on click and opens nothing, because
               its cards are portraits with nowhere to go. These are
               destinations, so a click has to take you there or the strip is a
               dead end.
               HOVER DOES NOT RE-CENTRE, and that was tried: centring the card
               under the pointer slides it out from under the pointer, the next
               card slides in, its own enter fires, and the strip walks itself
               along. Measured — hovering card 2 left the strip on card 1. So
               hover is a visual response only (see `.card:hover` in the
               stylesheet) and browsing is drag, wheel, arrows and the dots.
               Keyboard focus DOES centre, because focus does not follow the
               pointer and therefore cannot feed back. */
            onFocus={() => {
              if (i !== current) goTo(i);
            }}
            /* Enter and Space, handled explicitly. A `<button>` synthesises a
               click for both, but there is no `onClick` here any more — the
               pointer path lives on the stage — so this is the keyboard's own
               route in, and `preventDefault` stops Space scrolling the page. */
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              item.onOpen?.();
            }}
          >
            <span className={styles.media} aria-hidden="true">
              {item.media}
            </span>
            <span className={styles.footer}>
              <span className={styles.index}>{item.index}</span>
              <span className={styles.meta}>
                <span className={styles.name}>{item.title}</span>
                {item.subtitle && <span className={styles.sub}>{item.subtitle}</span>}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* The centred item's own controls. See the note on `actions`. */}
      {items[current]?.actions && (
        <div className={styles.actions} data-filmstrip-controls>
          {items[current].actions}
        </div>
      )}

      {/* Position dots double as a jump control. Capped, because a hundred
          saved decks would otherwise draw a hundred dots. */}
      {count <= 12 && (
        <div className={styles.rail} data-filmstrip-controls>
          {items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              className={styles.dot}
              data-on={i === current}
              aria-label={`Go to ${item.title}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
