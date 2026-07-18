import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthStore } from '../../state/authStore';
import { useThemeStore } from '../../state/themeStore';
import { useBuilderStore } from '../../state/store';
import styles from './ProfileMenu.module.css';

function UserIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12zm0 2c-3.7 0-8 1.9-8 5v1h16v-1c0-3.1-4.3-5-8-5z" />
    </svg>
  );
}

interface MenuPos {
  top: number;
  right: number;
}

export function ProfileMenu({ triggerClassName }: { triggerClassName: string }) {
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const library = useBuilderStore((s) => s.library);
  const homeDecks = useBuilderStore((s) => s.sets.home.decks);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const open = pos !== null;

  function toggleOpen() {
    if (open) {
      setPos(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 10, right: Math.max(12, window.innerWidth - rect.right) });
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setPos(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPos(null);
    }
    function onResize() {
      setPos(null);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  function go(hash: string) {
    setPos(null);
    window.location.hash = hash;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        data-open={open || undefined}
        title={`Signed in as ${authUser ?? 'guest'}`}
        aria-label="Profile menu"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <UserIcon />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              className={styles.menu}
              style={{ top: pos.top, right: pos.right }}
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              role="menu"
            >
              <div ref={menuRef}>
              <div className={styles.identity}>
                <span className={styles.bigAvatar}>
                  <UserIcon size={20} />
                </span>
                <div className={styles.identityText}>
                  <span className={styles.username}>{authUser}</span>
                  <span className={styles.accountKind}>Test account</span>
                </div>
              </div>

              <div className={styles.stats}>
                <div className={styles.stat}>
                  <span className={styles.statValue}>{library.length}</span>
                  <span className={styles.statLabel}>Saved duel sets</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statValue}>{homeDecks.length}</span>
                  <span className={styles.statLabel}>Home decks</span>
                </div>
              </div>

              <div className={styles.divider} />

              <button type="button" className={styles.item} role="menuitem" onClick={() => go('')}>
                <span className={styles.itemIcon}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                    <path d="M12 3l9 8h-3v9h-4v-6H10v6H6v-9H3z" />
                  </svg>
                </span>
                Home
              </button>
              <button
                type="button"
                className={styles.item}
                role="menuitem"
                onClick={() => go('#/builder')}
              >
                <span className={styles.itemIcon}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                    <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
                  </svg>
                </span>
                Royal Duels
              </button>
              <button
                type="button"
                className={styles.item}
                role="menuitem"
                onClick={() => go('#/decks')}
              >
                <span className={styles.itemIcon}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                    <path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z" />
                  </svg>
                </span>
                Deck&apos;s Home
              </button>
              <button
                type="button"
                className={styles.item}
                role="menuitem"
                onClick={() => go('#/palette')}
              >
                <span className={styles.itemIcon}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                    <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
                  </svg>
                </span>
                Counter Palette
              </button>
              <button
                type="button"
                className={styles.item}
                role="menuitem"
                onClick={() => {
                  toggleTheme();
                }}
              >
                <span className={styles.itemIcon}>{theme === 'dark' ? '☀' : '☾'}</span>
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>

              <div className={styles.divider} />

              <button
                type="button"
                className={`${styles.item} ${styles.itemDanger}`}
                role="menuitem"
                onClick={() => {
                  setPos(null);
                  logout();
                }}
              >
                <span className={styles.itemIcon}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                    <path d="M10 3h4a2 2 0 0 1 2 2v3h-2V5h-4v14h4v-3h2v3a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm7.5 6l4 3-4 3v-2H12v-2h5.5z" />
                  </svg>
                </span>
                Log out
              </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
