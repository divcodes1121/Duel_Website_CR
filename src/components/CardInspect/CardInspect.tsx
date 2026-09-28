import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

import { CARDS_BY_KEY, getCardIconUrl, getEvolutionIconUrl, getHeroIconUrl } from '../../data/cards';
import {
  INTERACTIVE,
  cardFacts,
  closeCardInspect,
  formsOf,
  openCardInspect,
  shouldInspect,
  startingForm,
  useCardInspect,
  type CardForm,
} from '../../state/cardInspect';
import { Tabs } from '../ui/tabs';
import styles from './CardInspect.module.css';

/**
 * The card inspect sheet. See `state/cardInspect.ts` for when it opens.
 *
 * - **The card tilts toward the pointer** (±11°) with a glare where the light
 *   would catch it; an evolution or hero adds a slow colour sheen. Both overlays
 *   are MASKED BY THE ART ITSELF, so they light the card and not the empty
 *   corners of its image. On touch the card follows a finger dragged across it
 *   (the stage alone takes the gesture; the rest of the sheet scrolls).
 *   Transform and opacity only, and none of it under reduced motion.
 * - **A dialog, done properly**: focus moves in and is held there, Esc and the
 *   scrim close it, focus returns to whatever opened it. `aria-modal`, so the
 *   single-key shortcuts stand down while it is open.
 * - **On a phone it is a bottom sheet**: full width, the card smaller and on
 *   top, the text under it, the close button a full 44px target.
 */

const TILT = 11;

function artUrl(key: string, form: CardForm): string {
  if (form === 'evolution') return getEvolutionIconUrl(key);
  if (form === 'hero') return getHeroIconUrl(key);
  return getCardIconUrl(key);
}

const FORM_LABEL: Record<CardForm, string> = { base: 'Base', evolution: 'Evolution', hero: 'Hero' };

/** The delegated opener: a click on card art that is not inside a control. */
function useArtClicks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('img[data-card]') : null;
      if (!el) return;
      if (!shouldInspect(el.dataset.card, el.closest(INTERACTIVE))) return;
      const variant = el.dataset.variant;
      openCardInspect({
        key: el.dataset.card!,
        form: variant === 'evolution' || variant === 'hero' ? variant : 'base',
      });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}

export function CardInspectHost() {
  useArtClicks();
  const req = useCardInspect();
  const card = req ? CARDS_BY_KEY.get(req.key) : undefined;
  if (!req || !card) return null;
  // Keyed on the request so a second card opened from inside the sheet (or
  // right after it closed) starts from its own form, not the last one's.
  return createPortal(<Sheet key={`${req.key}:${req.form ?? ''}`} />, document.body);
}

function Sheet() {
  const req = useCardInspect()!;
  const card = CARDS_BY_KEY.get(req.key)!;
  const forms = formsOf(card);
  const [form, setForm] = useState<CardForm>(() => startingForm(card, req.form));
  const [failed, setFailed] = useState<Partial<Record<CardForm, boolean>>>({});
  const shown: CardForm = failed[form] ? 'base' : form;
  const url = artUrl(card.key, shown);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);

  // Focus in on open, back to the opener on close.
  useLayoutEffect(() => {
    opener.current = document.activeElement;
    closeRef.current?.focus();
    return () => {
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeCardInspect();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex="0"]')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  /* ── tilt ─────────────────────────────────────────────────────────────── */
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lean = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el || reduced) return;
    if (e.pointerType !== 'mouse' && e.buttons === 0) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    el.style.setProperty('--rx', `${((0.5 - y) * TILT * 2).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((x - 0.5) * TILT * 2).toFixed(2)}deg`);
    el.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
    el.dataset.live = '';
  };
  const rest = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    delete el.dataset.live;
  };

  const special = shown !== 'base';

  return (
    <div className={styles.scrim} onClick={closeCardInspect}>
      <div
        ref={dialogRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-inspect-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className={styles.grip} aria-hidden="true" />
        <button ref={closeRef} type="button" className={styles.close} onClick={closeCardInspect} aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div
          className={styles.stage}
          onPointerMove={lean}
          onPointerDown={lean}
          onPointerLeave={rest}
          onPointerUp={(e) => e.pointerType !== 'mouse' && rest()}
          onPointerCancel={rest}
        >
          <div ref={cardRef} className={styles.card} data-special={special || undefined}>
            <img
              src={url}
              alt={`${card.name}${shown === 'base' ? '' : ` (${shown})`}`}
              className={styles.art}
              draggable={false}
              onError={() => shown !== 'base' && setFailed((f) => ({ ...f, [shown]: true }))}
            />
            <span className={styles.glare} style={{ maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }} aria-hidden="true" />
            {special && (
              <span className={styles.holo} style={{ maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }} aria-hidden="true" />
            )}
          </div>
        </div>

        <div className={styles.info}>
          <h2 id="card-inspect-title" className={styles.name}>
            {card.name}
            {shown !== 'base' && <span className={styles.formWord}> · {FORM_LABEL[shown]}</span>}
          </h2>

          <ul className={styles.facts}>
            {cardFacts(card).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>

          {forms.length > 1 && (
            <Tabs
              label="Card form"
              size="sm"
              value={form}
              onChange={setForm}
              items={forms.map((f) => ({
                id: f,
                label: FORM_LABEL[f],
                title: failed[f] ? 'No art for this form yet — showing the base card' : undefined,
              }))}
            />
          )}

          {card.description && <p className={styles.description}>{card.description}</p>}

          {req.record && req.record.facts.length > 0 && (
            <section className={styles.record} aria-label={req.record.title}>
              <h3 className={styles.recordTitle}>{req.record.title}</h3>
              <dl className={styles.recordGrid}>
                {req.record.facts.map((f) => (
                  <div key={f.label} className={styles.recordCell}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
