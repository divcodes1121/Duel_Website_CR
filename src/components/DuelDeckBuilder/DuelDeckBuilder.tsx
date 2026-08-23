import { useEffect, useState } from 'react';
import { useBuilderStore, type DuelOwner } from '../../state/store';
import { DUEL_DECK_COUNT, type BuilderMode, type Deck, type PlayerId } from '../../types/deck';
import { getTotalCardsUsed } from '../../state/deckUtils';
import { DECK_SIZE } from '../../types/deck';
import { DeckPanel } from './DeckPanel';
import { CrownCounter } from './CrownCounter';
import { SavedGroups } from './SavedGroups';
import { DeckWorkspace } from '../DeckWorkspace/DeckWorkspace';
import { WinConFilter, deckMatchesFilter } from '../WinConFilter/WinConFilter';
import { PlusIcon } from './icons';
import styles from './DuelDeckBuilder.module.css';

const MODES: { id: BuilderMode; label: string }[] = [
  { id: 'solo', label: 'Solo' },
  { id: 'versus', label: 'Versus' },
];

const PLAYERS: { id: PlayerId; label: string }[] = [
  { id: 'blue', label: 'Blue' },
  { id: 'red', label: 'Red' },
];

/**
 * The dashed tile that reveals the 4th and 5th duel decks.
 *
 * It is a tile rather than a button in a row of two, because "add" and "remove"
 * are not a pair of equals: adding is how you build the collection, and removing
 * only ever means "drop the last one". Removal moved onto that last deck's own
 * panel, where it acts on a deck you can see instead of on an index.
 */
function AddDeckTile({ owner }: { owner: DuelOwner }) {
  const count = useBuilderStore((s) => s.deckSlotCount[owner]);
  const addDeckSlot = useBuilderStore((s) => s.addDeckSlot);

  if (count >= DUEL_DECK_COUNT) return null;

  return (
    <button type="button" className={styles.addDeck} onClick={() => addDeckSlot(owner)}>
      <span className={styles.addDeckIcon} aria-hidden="true">
        <PlusIcon />
      </span>
      <span className={styles.addDeckLabel}>Add deck</span>
      <span className={styles.addDeckCount}>
        {count} / {DUEL_DECK_COUNT}
      </span>
    </button>
  );
}

export function DuelDeckBuilder() {
  const sets = useBuilderStore((s) => s.sets);
  const mode = useBuilderStore((s) => s.mode);
  const setMode = useBuilderStore((s) => s.setMode);
  const deckSlotCount = useBuilderStore((s) => s.deckSlotCount);
  const clearSelection = useBuilderStore((s) => s.clearSelection);
  const setDeckCrowns = useBuilderStore((s) => s.setDeckCrowns);
  const removeDeckSlot = useBuilderStore((s) => s.removeDeckSlot);
  const [winFilter, setWinFilter] = useState<string[]>([]);
  /**
   * Which of the two things this screen is: the board, or the library of saved
   * sets. They are the same SHAPE — a duel collection — so they share the deck
   * column rather than the saved sets trailing off the bottom of it, where
   * reaching them meant scrolling past every deck on the board.
   */
  const [view, setView] = useState<'build' | 'saved'>('build');
  const savedCount = useBuilderStore(
    (s) => s.library.filter((e) => e.mode === s.mode).length,
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') clearSelection();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection]);

  function toggleWinCon(key: string) {
    setWinFilter((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  /** Drop the LAST deck of a collection, confirming first if it holds cards. */
  function removeLastDeck(owner: DuelOwner) {
    const count = deckSlotCount[owner];
    const lastDeck = sets[owner].decks[count - 1];
    const cards = lastDeck.slots.filter(Boolean).length;
    if (
      cards > 0 &&
      !window.confirm(`Remove "${lastDeck.name}"? Its ${cards} cards will be cleared.`)
    ) {
      return;
    }
    removeDeckSlot(owner);
  }

  const filtering = winFilter.length > 0;
  /** Decks keep their slot positions — matches stay lit, the rest just fade back. */
  const matches = (deck: Deck) => deckMatchesFilter(deck.slots, winFilter);

  const visibleDecks = (owner: DuelOwner) => sets[owner].decks.slice(0, deckSlotCount[owner]);
  const matchCount = mode === 'solo'
    ? visibleDecks('solo').filter(matches).length
    : visibleDecks('blue').filter(matches).length + visibleDecks('red').filter(matches).length;
  const totalDecks = mode === 'solo'
    ? deckSlotCount.solo
    : deckSlotCount.blue + deckSlotCount.red;

  /** One duel collection: its decks, its crowns, its add tile. */
  function renderCollection(owner: DuelOwner) {
    const count = deckSlotCount[owner];
    const isVersus = owner !== 'solo';

    return (
      <>
        {sets[owner].decks.slice(0, count).map((deck, i) => {
          const match = matches(deck);
          const isLast = i === count - 1;
          return (
            <div
              key={deck.id}
              className={`${styles.deckWrap} ${filtering && !match ? styles.deckDim : ''}`}
            >
              {isVersus && (
                <CrownCounter
                  value={deck.crowns ?? 0}
                  onChange={(c) => setDeckCrowns(owner as PlayerId, i, c)}
                  side={owner as PlayerId}
                  deckName={deck.name}
                  orientation="row"
                />
              )}
              <DeckPanel
                owner={owner}
                deckIndex={i}
                deck={deck}
                /* Only the last deck can be dropped — the store removes from the
                   end, so offering it on deck 2 of 5 would delete deck 5. */
                onDelete={isLast && count > 3 ? () => removeLastDeck(owner) : undefined}
                deleteLabel="Remove this deck slot"
              />
            </div>
          );
        })}
        <AddDeckTile owner={owner} />
      </>
    );
  }

  const toolbar = (
    <>
      <div className={styles.modeTabs} role="tablist" aria-label="Builder mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={`${styles.modeTab} ${mode === m.id ? styles.modeTabActive : ''}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* A separate control from Solo/Versus, because they are different axes:
          the mode is WHICH collection, this is whether you are looking at the
          board or at the sets you have saved of it. */}
      <div className={styles.viewTabs} role="tablist" aria-label="Builder view">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'build'}
          className={`${styles.modeTab} ${view === 'build' ? styles.modeTabActive : ''}`}
          onClick={() => setView('build')}
        >
          Build
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'saved'}
          className={`${styles.modeTab} ${view === 'saved' ? styles.modeTabActive : ''}`}
          onClick={() => setView('saved')}
        >
          Saved
          <span className={styles.viewCount}>{savedCount}</span>
        </button>
      </div>

      <div className={styles.filterSlot}>
        <WinConFilter selected={winFilter} onToggle={toggleWinCon} onClear={() => setWinFilter([])}>
          {filtering && (
            <span className={styles.winconCount}>
              {view === 'saved'
                ? 'filtering saved groups'
                : `${matchCount} of ${totalDecks} decks`}
            </span>
          )}
        </WinConFilter>
      </div>
    </>
  );

  if (view === 'saved') {
    return (
      <DeckWorkspace toolbar={toolbar}>
        <SavedGroups mode={mode} winFilter={winFilter} />
      </DeckWorkspace>
    );
  }

  return (
    <DeckWorkspace toolbar={toolbar}>
      {mode === 'solo' ? (
        <div className={styles.collection}>{renderCollection('solo')}</div>
      ) : (
        /* auto-fit, not a media query: the two players sit side by side when the
           deck column is wide enough for two eight-card rows and stack when it
           is not — which happens when the library collapses, when the dashboard
           rail collapses, or when the window narrows, and no viewport
           breakpoint can see all three of those. */
        <div className={styles.versus}>
          {PLAYERS.map((player) => (
            <section key={player.id} className={styles.playerColumn}>
              <header className={styles.playerHeader} data-owner={player.id}>
                <span className={styles.playerDot} data-owner={player.id} aria-hidden="true" />
                <span className={styles.playerName}>{player.label}</span>
                <span className={styles.playerCount}>
                  {getTotalCardsUsed(sets[player.id])}
                  <span className={styles.playerCountMax}>
                    /{deckSlotCount[player.id] * DECK_SIZE}
                  </span>
                </span>
              </header>
              <div className={styles.collection}>{renderCollection(player.id)}</div>
            </section>
          ))}
        </div>
      )}
    </DeckWorkspace>
  );
}
