import { useEffect, useState } from 'react';
import { useBuilderStore } from '../../state/store';
import { useAuthStore } from '../../state/authStore';
import { DeckPanel } from '../DuelDeckBuilder/DeckPanel';
import { DeckWorkspace } from '../DeckWorkspace/DeckWorkspace';
import { ProfileMenu } from '../Profile/ProfileMenu';
import { ExportDialog } from '../Export/ExportDialog';
import { WinConFilter, deckMatchesFilter, filterCardName } from '../WinConFilter/WinConFilter';
import { FilterSlot } from '../WinConFilter/FilterSlot';
import { canExportDecks } from '../../utils/deckExport';
import libStyles from '../Library/Library.module.css';
import styles from './DecksHome.module.css';
import { ThemeToggle } from '../Theme/ThemeToggle';

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
    </svg>
  );
}

/** `embedded` renders without the page nav — the dashboard shell provides it. */
export function DecksHome({ embedded = false }: { embedded?: boolean } = {}) {
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

  /* Multi-select is an AND: a deck must hold every selected card.
     EVERY deck is kept in the list with a `matches` flag rather than being
     filtered out of it. Dropping non-matching decks from the array unmounts
     them, and an unmounted element cannot animate away — it is simply gone on
     the next frame, taking its space with it. `FilterSlot` collapses instead. */
  const marked = homeDecks.map((deck, index) => ({
    deck,
    index,
    matches: deckMatchesFilter(deck.slots, winFilter),
  }));
  const visibleDecks = marked.filter((d) => d.matches);

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
      {!embedded && (
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
          <ThemeToggle size="1.8rem" />
          <ProfileMenu triggerClassName={styles.themeButton} />
        </div>
      </header>
      )}

      <DeckWorkspace
        toolbar={
          <>
            <h2 className={styles.galleryTitle}>
              My Decks
              <span className={styles.galleryCount}>
                {winFilter.length > 0
                  ? `${visibleDecks.length} / ${homeDecks.length}`
                  : homeDecks.length}
              </span>
            </h2>

            <div className={styles.filterSlot}>
              <WinConFilter
                selected={winFilter}
                onToggle={toggleWinCon}
                onClear={() => setWinFilter([])}
              />
            </div>

            <span className={styles.autoSaveHint}>Decks save automatically</span>

            {/* Hiding the page nav in the dashboard would otherwise take Export
                PDF with it — the one action in there the top bar does not
                already carry. */}
            {embedded && canExport && (
              <button
                type="button"
                className={libStyles.ghostButton}
                title="Download a PDF report of every deck here"
                onClick={() => setExportOpen(true)}
              >
                Export PDF
              </button>
            )}
          </>
        }
      >
        {/* A gallery, not a stack. Deck's Home holds an unlimited number of
            decks, and one per row meant scrolling past four screens of them to
            reach the fifth — so they lay out at as many columns as the deck
            column can give an eight-card row. */}
        <div className={styles.deckGrid}>
          {marked.map(({ deck, index, matches }) => (
            <FilterSlot key={deck.id} show={matches}>
              <DeckPanel
                owner="home"
                deckIndex={index}
                deck={deck}
                onDelete={() => handleDelete(index)}
              />
            </FilterSlot>
          ))}

          {winFilter.length === 0 && (
            <button type="button" className={styles.addDeck} onClick={addHomeDeck}>
              <span className={styles.addDeckPlus}>+</span>
              Add deck
            </button>
          )}
        </div>

        {winFilter.length > 0 && visibleDecks.length === 0 && (
          <p className={styles.noMatches}>
            No decks with {winFilter.map(filterCardName).join(' + ')} yet.
          </p>
        )}
      </DeckWorkspace>

      {exportOpen && <ExportDialog source="home" onClose={() => setExportOpen(false)} />}
    </div>
  );
}
