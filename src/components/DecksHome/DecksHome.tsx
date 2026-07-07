import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useBuilderStore } from '../../state/store';
import { useThemeStore } from '../../state/themeStore';
import { CARDS, getCardIconUrl } from '../../data/cards';
import { DeckPanel } from '../DuelDeckBuilder/DeckPanel';
import { CardPickerDrawer } from '../CardPicker/CardPickerDrawer';
import { FlightLayer } from '../FlightLayer/FlightLayer';
import { ProfileMenu } from '../Profile/ProfileMenu';
import libStyles from '../Library/Library.module.css';
import styles from './DecksHome.module.css';

/** Every win-condition card, cheap to expensive — the deck filter chips. */
const WIN_CONDITIONS = CARDS.filter((c) => c.isWinCondition).sort(
  (a, b) => a.elixir - b.elixir || a.name.localeCompare(b.name),
);

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
  const [winFilter, setWinFilter] = useState<string[]>([]);

  function toggleWinCon(key: string) {
    setWinFilter((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  // Multi-select is an AND: a deck must hold every selected win condition.
  const visibleDecks = homeDecks
    .map((deck, index) => ({ deck, index }))
    .filter(({ deck }) => winFilter.every((k) => deck.slots.includes(k)));

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

          <div className={styles.winconBar} role="group" aria-label="Filter decks by win condition">
            {WIN_CONDITIONS.map((card) => {
              const active = winFilter.includes(card.key);
              return (
                <motion.button
                  key={card.key}
                  type="button"
                  className={`${styles.winconChip} ${active ? styles.winconChipActive : ''}`}
                  title={`${card.name} decks`}
                  aria-pressed={active}
                  onClick={() => toggleWinCon(card.key)}
                  whileHover={{ y: -3, scale: 1.06 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 20 }}
                >
                  <img src={getCardIconUrl(card.key)} alt={card.name} draggable={false} />
                </motion.button>
              );
            })}
            <AnimatePresence>
              {winFilter.length > 0 && (
                <motion.button
                  type="button"
                  className={styles.winconClear}
                  onClick={() => setWinFilter([])}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.15 }}
                >
                  Clear ×
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {visibleDecks.map(({ deck, index }, i) => (
            <motion.div
              key={deck.id}
              initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ type: 'spring', stiffness: 240, damping: 26, delay: Math.min(i, 4) * 0.05 }}
            >
              <DeckPanel
                owner="home"
                deckIndex={index}
                deck={deck}
                onDelete={() => handleDelete(index)}
              />
            </motion.div>
          ))}

          {winFilter.length > 0 && visibleDecks.length === 0 && (
            <motion.p
              className={styles.noMatches}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
            >
              No decks with{' '}
              {winFilter
                .map((k) => WIN_CONDITIONS.find((c) => c.key === k)?.name ?? k)
                .join(' + ')}{' '}
              yet.
            </motion.p>
          )}

          {winFilter.length === 0 && (
            <motion.button
              type="button"
              className={styles.addDeck}
              onClick={addHomeDeck}
              whileHover={{ scale: 1.01, y: -2 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            >
              <span className={styles.addDeckPlus}>+</span>
              Add deck
            </motion.button>
          )}
        </section>
      </div>

      <CardPickerDrawer />
      <FlightLayer />
    </div>
  );
}
