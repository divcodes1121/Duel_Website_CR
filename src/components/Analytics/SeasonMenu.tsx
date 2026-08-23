import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SEASONS, type Season } from './playerData';
import styles from './SeasonMenu.module.css';

/* The season control, as a glass dropdown rather than a native <select>.
 *
 * A native select cannot be styled where it matters: the OPEN list is drawn by
 * the operating system, so it ignored the theme entirely — a white Windows
 * popup over the dark app, in the app's own font nowhere. Everything else in
 * this chrome that opens a list (the profile menu, the wild-variant picker)
 * already builds its own panel, so this is the third instance of a pattern
 * rather than a new idea.
 *
 * ANCHORED OFF THE TRIGGER'S RECT, measured at open time, and portalled to
 * <body>. Both halves are load-bearing: the header and several panels carry
 * `backdrop-filter`, each of which creates a stacking context that traps a
 * positioned child, so a menu rendered in place is clipped by its own toolbar.
 *
 * RIGHT-ALIGNED to the trigger. This control sits at the right end of the query
 * row, so a left-aligned panel wider than the button would hang off the window
 * on a narrow one.
 */

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path d="M7 10l5 5 5-5z" />
    </svg>
  );
}

function TickIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.4-1.4z" />
    </svg>
  );
}

interface Pos {
  top: number;
  right: number;
}

export function SeasonMenu({
  value,
  onChange,
  className,
}: {
  value: Season;
  onChange: (s: Season) => void;
  className?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const open = pos !== null;

  function toggle() {
    if (open) {
      setPos(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right) });
  }

  function pick(s: Season) {
    onChange(s);
    setPos(null);
    // Focus goes back to the trigger, or a keyboard user is dropped at the top
    // of the document every time they change the window.
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setPos(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setPos(null);
      triggerRef.current?.focus();
    }
    // The panel is anchored to a rect measured once, so anything that moves the
    // trigger has to close it rather than leave it floating somewhere the
    // button no longer is. `capture` catches the analytics panel scrolling,
    // which does not bubble to window.
    function onMove() {
      setPos(null);
    }

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${className ?? ''}`}
        data-open={open || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Season: ${value}`}
        onClick={toggle}
      >
        {value}
        <span className={styles.chevron}>
          <ChevronIcon />
        </span>
      </button>

      {createPortal(
        open && pos ? (
          <div
            ref={menuRef}
            className={styles.menu}
            style={{ top: pos.top, right: pos.right }}
            role="listbox"
            aria-label="Season"
          >
            {SEASONS.map((s) => (
              <button
                key={s}
                type="button"
                className={styles.option}
                role="option"
                aria-selected={s === value}
                onClick={() => pick(s)}
              >
                <span className={styles.tick}>
                  <TickIcon />
                </span>
                {s}
              </button>
            ))}
          </div>
        ) : null,
        document.body,
      )}
    </>
  );
}
