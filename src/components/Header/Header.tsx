import { useState } from 'react';
import { useThemeStore } from '../../state/themeStore';
import { useBuilderStore } from '../../state/store';
import { getTotalCardsUsed } from '../../state/deckUtils';
import styles from './Header.module.css';

export function Header() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const duelDeckSet = useBuilderStore((s) => s.duelDeckSet);
  const resetAll = useBuilderStore((s) => s.resetAll);
  const [justSaved, setJustSaved] = useState(false);

  const totalUsed = getTotalCardsUsed(duelDeckSet);

  // Decks persist to localStorage automatically on every change; the Save
  // button exists as an explicit reassurance and simply confirms that state.
  function handleSave() {
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1600);
  }

  function handleReset() {
    if (window.confirm('Reset all 4 decks? This clears every card.')) {
      resetAll();
    }
  }

  return (
    <header className={styles.header}>
      <button
        type="button"
        className={styles.brand}
        onClick={() => {
          window.location.hash = '';
        }}
        title="Back to Royal Arena"
      >
        <span className={styles.logoMark} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
          </svg>
        </span>
        <div className={styles.brandText}>
          <h1 className={styles.title}>Royal Duels</h1>
          <span className={styles.subtitle}>Duel Deck Builder</span>
        </div>
      </button>

      <div className={styles.actions}>
        <span
          className={`${styles.counter} ${totalUsed === 32 ? styles.counterFull : ''}`}
          title="Unique cards used across all 4 decks"
        >
          <span className={styles.counterValue}>{totalUsed}</span>
          <span className={styles.counterMax}>/ 32 cards</span>
        </span>

        <button type="button" className={styles.glassButton} onClick={handleSave}>
          {justSaved ? 'Saved ✓' : 'Save'}
        </button>

        <button
          type="button"
          className={`${styles.glassButton} ${styles.danger}`}
          onClick={handleReset}
        >
          Reset
        </button>

        <button
          type="button"
          className={styles.themeToggle}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle theme"
        >
          <span className={styles.themeIcon} data-active={theme === 'light'}>
            ☀
          </span>
          <span className={styles.themeIcon} data-active={theme === 'dark'}>
            ☾
          </span>
        </button>

        <span className={styles.avatar} title="Profile" aria-label="Profile placeholder">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12zm0 2c-3.7 0-8 1.9-8 5v1h16v-1c0-3.1-4.3-5-8-5z" />
          </svg>
        </span>
      </div>
    </header>
  );
}
