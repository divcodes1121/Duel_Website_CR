import { useEffect, useState } from 'react';
import { useBuilderStore } from '../../state/store';
import { useThemeStore } from '../../state/themeStore';
import { useAuthStore } from '../../state/authStore';
import { DeckPanel } from '../DuelDeckBuilder/DeckPanel';
import { CardPickerDrawer } from '../CardPicker/CardPickerDrawer';
import { FlightLayer } from '../FlightLayer/FlightLayer';
import { ProfileMenu } from '../Profile/ProfileMenu';
import { ExportDialog } from '../Export/ExportDialog';
import { WinConFilter, deckMatchesFilter, filterCardName } from '../WinConFilter/WinConFilter';
import { canExportDecks } from '../../utils/deckExport';
import libStyles from '../Library/Library.module.css';
import styles from './DecksHome.module.css';

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
    </svg>
  );
}

export function DecksHome() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const homeDecks = useBuilderStore((s) => s.sets.home.decks);
  const addHomeDeck = useBuilderStore((s) => s.addHomeDeck);
  const removeHomeDeck = useBuilderStore((s) => s.removeHomeDeck);
  const clearSelection = useBuilderStore((s) => s.clearSelection);
  const authUser = useAuthStore((s) => s.user);
  const [winFilter, setWinFilter] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const canExport = canExportDecks(authUser);

  function toggleWinCon(key: string) {
    setWinFilter((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  // Multi-select is an AND: a deck must hold every selected card.
  const visibleDecks = homeDecks
    .map((deck, index) => ({ deck, index }))
    .filter(({ deck }) => deckMatchesFilter(deck.slots, winFilter));

  // Selections made on other pages must not leak into this picker context.
  useEffect(() => {
    clearSelection();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') clearSelection();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection]);

  function handleDelete(deckIndex: number) {
    const deck = homeDecks[deckIndex];
    const hasCards = deck.slots.some((k) => k !== null);
    if (hasCards && !window.confirm(`Delete "${deck.name}"? Its cards will be lost.`)) {
      return;
    }
    removeHomeDeck(deckIndex);
  }

  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <button
          type="button"
          className={styles.brand}
          onClick={() => {
            window.location.hash = '';
          }}
          title="Back to Royal Arena"
        >
          <span className={styles.logoMark}>
            <CrownIcon />
          </span>
          <div className={styles.brandText}>
            <h1 className={styles.title}>Deck's Home</h1>
            <span className={styles.subtitle}>Your Deck Collection</span>
          </div>
        </button>
        <div className={styles.navActions}>
          <span className={styles.autoSaveHint}>Decks save automatically</span>
          {canExport && (
            <button
              type="button"
              className={libStyles.ghostButton}
              title="Download a PDF report of every deck here"
              onClick={() => setExportOpen(true)}
            >
              Export PDF
            </button>
          )}
          <button
            type="button"
            className={libStyles.ghostButton}
            onClick={() => {
              window.location.hash = '#/builder';
            }}
          >
            Royal Duels →
          </button>
          <button
            type="button"
            className={libStyles.ghostButton}
            onClick={() => {
              window.location.hash = '#/palette';
            }}
          >
            Counter Palette →
          </button>
          <button
            type="button"
            className={styles.themeButton}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>
          <ProfileMenu triggerClassName={styles.themeButton} />
        </div>
      </header>

      <div className={styles.scrollArea}>
        <section className={styles.deckList}>
          <h2 className={styles.galleryTitle}>
            My Decks
            <span className={styles.galleryCount}>
              {winFilter.length > 0 ? `${visibleDecks.length} / ${homeDecks.length}` : homeDecks.length}
            </span>
          </h2>

          <WinConFilter
            selected={winFilter}
            onToggle={toggleWinCon}
            onClear={() => setWinFilter([])}
          />

          {visibleDecks.map(({ deck, index }) => (
            <DeckPanel
              key={deck.id}
              owner="home"
              deckIndex={index}
              deck={deck}
              onDelete={() => handleDelete(index)}
            />
          ))}

          {winFilter.length > 0 && visibleDecks.length === 0 && (
            <p className={styles.noMatches}>
              No decks with {winFilter.map(filterCardName).join(' + ')} yet.
            </p>
          )}

          {winFilter.length === 0 && (
            <button type="button" className={styles.addDeck} onClick={addHomeDeck}>
              <span className={styles.addDeckPlus}>+</span>
              Add deck
            </button>
          )}
        </section>
      </div>

      <CardPickerDrawer />
      <FlightLayer />
      {exportOpen && <ExportDialog source="home" onClose={() => setExportOpen(false)} />}
    </div>
  );
}
