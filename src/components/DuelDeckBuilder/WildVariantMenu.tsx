import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCardIconUrl, getEvolutionIconUrl, getHeroIconUrl } from '../../data/cards';
import type { Card } from '../../types/card';
import type { WildVariant } from '../../types/deck';
import styles from './WildVariantMenu.module.css';

interface WildVariantMenuProps {
  /** Rect of the slot the menu hangs under, captured when it opened. */
  anchor: DOMRect;
  card: Card;
  current: WildVariant;
  onPick: (variant: WildVariant) => void;
  onClose: () => void;
}

const OPTIONS: { variant: WildVariant; label: string; art: (key: string) => string }[] = [
  { variant: 'evolution', label: 'Evolution', art: getEvolutionIconUrl },
  { variant: 'hero', label: 'Hero', art: getHeroIconUrl },
];

const MENU_WIDTH = 208;

export function WildVariantMenu({ anchor, card, current, onPick, onClose }: WildVariantMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Centred under the slot, nudged back inside the viewport on narrow screens.
  const left = Math.min(
    Math.max(8, anchor.left + anchor.width / 2 - MENU_WIDTH / 2),
    Math.max(8, window.innerWidth - MENU_WIDTH - 8),
  );

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      // The slot itself re-opens the menu on click, so only outside clicks close it.
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    // The panel is anchored to a rect captured at open time — any layout shift
    // would leave it floating in the wrong place, so close instead.
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      className={styles.menu}
      style={{ top: anchor.bottom + 10, left, width: MENU_WIDTH }}
      role="menu"
      aria-label={`${card.name} form`}
    >
      <div ref={menuRef}>
          <span className={styles.arrow} aria-hidden="true" />
          <div className={styles.header}>
            <span className={styles.cardName}>{card.name}</span>
            <span className={styles.hint}>Wild slot — pick a form</span>
          </div>

          {OPTIONS.map(({ variant, label, art }) => (
            <button
              key={variant}
              type="button"
              role="menuitemradio"
              aria-checked={current === variant}
              className={`${styles.option} ${styles[`option-${variant}`]} ${
                current === variant ? styles.optionActive : ''
              }`}
              onClick={() => onPick(variant)}
            >
              <FormThumb src={art(card.key)} fallback={getCardIconUrl(card.key)} alt="" />
              <span className={styles.optionText}>
                <span className={styles.gem} aria-hidden="true">
                  ◆
                </span>
                {label}
              </span>
              {current === variant && (
                <span className={styles.check} aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
      </div>
    </div>,
    document.body,
  );
}

/** A few cards lack special-form art — fall back to the base card icon. */
function FormThumb({ src, fallback, alt }: { src: string; fallback: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <img
      className={styles.thumb}
      src={failed ? fallback : src}
      alt={alt}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
