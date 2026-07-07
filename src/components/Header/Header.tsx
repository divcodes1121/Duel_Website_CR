import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useThemeStore } from '../../state/themeStore';
import { useBuilderStore } from '../../state/store';
import { getTotalCardsUsed } from '../../state/deckUtils';
import { DECK_SIZE } from '../../types/deck';
import { SaveDialog } from '../Library/SaveDialog';
import { LibraryModal } from '../Library/LibraryModal';
import { ProfileMenu } from '../Profile/ProfileMenu';
import styles from './Header.module.css';

export function Header() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const sets = useBuilderStore((s) => s.sets);
  const mode = useBuilderStore((s) => s.mode);
  const deckSlotCount = useBuilderStore((s) => s.deckSlotCount);
  const resetAll = useBuilderStore((s) => s.resetAll);
  const maxFor = (owner: 'solo' | 'blue' | 'red') => deckSlotCount[owner] * DECK_SIZE;
  const [justSaved, setJustSaved] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  function flashSaved() {
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1600);
  }

  function handleReset() {
    const what = mode === 'solo' ? 'all solo decks' : "both players' decks";
    if (window.confirm(`Reset ${what}? This clears every card.`)) {
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
        {mode === 'solo' ? (
          <span
            className={`${styles.counter} ${
              getTotalCardsUsed(sets.solo) === maxFor('solo') ? styles.counterFull : ''
            }`}
            title={`Unique cards used across your ${deckSlotCount.solo} decks`}
          >
            <span className={styles.counterValue}>{getTotalCardsUsed(sets.solo)}</span>
            <span className={styles.counterMax}>/ {maxFor('solo')} cards</span>
          </span>
        ) : (
          <>
            <span
              className={`${styles.counter} ${styles.counterBlue}`}
              title={`Unique cards used across Blue's ${deckSlotCount.blue} decks`}
            >
              <span className={styles.counterValue}>{getTotalCardsUsed(sets.blue)}</span>
              <span className={styles.counterMax}>/ {maxFor('blue')}</span>
            </span>
            <span
              className={`${styles.counter} ${styles.counterRed}`}
              title={`Unique cards used across Red's ${deckSlotCount.red} decks`}
            >
              <span className={styles.counterValue}>{getTotalCardsUsed(sets.red)}</span>
              <span className={styles.counterMax}>/ {maxFor('red')}</span>
            </span>
          </>
        )}

        <button type="button" className={styles.glassButton} onClick={() => setSaveOpen(true)}>
          {justSaved ? 'Saved ✓' : 'Save'}
        </button>

        <button
          type="button"
          className={styles.glassButton}
          onClick={() => setLibraryOpen(true)}
        >
          My Decks
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

        <ProfileMenu triggerClassName={styles.avatar} />
      </div>

      <AnimatePresence>
        {saveOpen && <SaveDialog onClose={() => setSaveOpen(false)} onSaved={flashSaved} />}
        {libraryOpen && <LibraryModal onClose={() => setLibraryOpen(false)} />}
      </AnimatePresence>
    </header>
  );
}
