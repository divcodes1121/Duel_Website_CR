import { useState } from 'react';
import { useThemeStore } from '../../state/themeStore';
import { useBuilderStore } from '../../state/store';
import { useAuthStore } from '../../state/authStore';
import { getTotalCardsUsed } from '../../state/deckUtils';
import { DECK_SIZE } from '../../types/deck';
import { SaveDialog } from '../Library/SaveDialog';
import { LibraryModal } from '../Library/LibraryModal';
import { ExportDialog } from '../Export/ExportDialog';
import { ProfileMenu } from '../Profile/ProfileMenu';
import { canExportDecks } from '../../utils/deckExport';
import styles from './Header.module.css';

/**
 * `embedded` drops the brand, theme toggle and profile menu — the dashboard
 * top bar already carries those — and keeps what is specific to the builder:
 * the unique-card counters, Save, My Decks, Export PDF and Reset.
 */
export function Header({ embedded = false }: { embedded?: boolean } = {}) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const sets = useBuilderStore((s) => s.sets);
  const mode = useBuilderStore((s) => s.mode);
  const deckSlotCount = useBuilderStore((s) => s.deckSlotCount);
  const resetAll = useBuilderStore((s) => s.resetAll);
  const authUser = useAuthStore((s) => s.user);
  const maxFor = (owner: 'solo' | 'blue' | 'red') => deckSlotCount[owner] * DECK_SIZE;
  const [justSaved, setJustSaved] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const canExport = canExportDecks(authUser);

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
    <header className={styles.header} data-embedded={embedded || undefined}>
      {!embedded && (
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
      )}

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

        {canExport && (
          <button
            type="button"
            className={styles.glassButton}
            title={`Download a PDF report of your ${mode === 'solo' ? 'Solo decks' : 'Blue vs Red duels'}`}
            onClick={() => setExportOpen(true)}
          >
            Export PDF
          </button>
        )}

        <button
          type="button"
          className={`${styles.glassButton} ${styles.danger}`}
          onClick={handleReset}
        >
          Reset
        </button>

        {!embedded && (
          <>
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
          </>
        )}
      </div>

      {saveOpen && <SaveDialog onClose={() => setSaveOpen(false)} onSaved={flashSaved} />}
      {libraryOpen && <LibraryModal onClose={() => setLibraryOpen(false)} />}
      {exportOpen && <ExportDialog source="duels" onClose={() => setExportOpen(false)} />}
    </header>
  );
}
