import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useBuilderStore, type DuelOwner } from '../../state/store';
import { DUEL_DECK_COUNT, type BuilderMode, type Deck, type PlayerId } from '../../types/deck';
import { DeckPanel } from './DeckPanel';
import { CrownCounter } from './CrownCounter';
import { SavedGroups } from './SavedGroups';
import { CardPickerDrawer } from '../CardPicker/CardPickerDrawer';
import { FlightLayer } from '../FlightLayer/FlightLayer';
import { WinConFilter, deckMatchesFilter } from '../WinConFilter/WinConFilter';
import styles from './DuelDeckBuilder.module.css';

/** Reveal / hide extra deck slots for a duel collection (3 up to 5, serially). */
function DeckSlotControls({ owner }: { owner: DuelOwner }) {
  const count = useBuilderStore((s) => s.deckSlotCount[owner]);
  const sets = useBuilderStore((s) => s.sets);
  const addDeckSlot = useBuilderStore((s) => s.addDeckSlot);
  const removeDeckSlot = useBuilderStore((s) => s.removeDeckSlot);

  const canAdd = count < DUEL_DECK_COUNT;
  const canRemove = count > 3;
  if (!canAdd && !canRemove) return null;

  function handleRemove() {
    const lastDeck = sets[owner].decks[count - 1];
    const hasCards = lastDeck.slots.some((k) => k !== null);
    if (
      hasCards &&
      !window.confirm(`Remove "${lastDeck.name}"? Its ${lastDeck.slots.filter(Boolean).length} cards will be cleared.`)
    ) {
      return;
    }
    removeDeckSlot(owner);
  }

  return (
    <div className={styles.slotControls}>
      {canAdd && (
        <motion.button
          type="button"
          className={styles.addSlot}
          onClick={() => addDeckSlot(owner)}
          whileHover={{ scale: 1.01, y: -2 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        >
          <span className={styles.addSlotPlus} aria-hidden="true">
            +
          </span>
          Add deck slot ({count}/{DUEL_DECK_COUNT})
        </motion.button>
      )}
      {canRemove && (
        <motion.button
          type="button"
          className={`${styles.addSlot} ${styles.removeSlot}`}
          onClick={handleRemove}
          whileHover={{ scale: 1.01, y: -2 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        >
          <span className={styles.addSlotPlus} aria-hidden="true">
            –
          </span>
          Remove deck slot
        </motion.button>
      )}
    </div>
  );
}

const MODES: { id: BuilderMode; label: string }[] = [
  { id: 'solo', label: 'Solo' },
  { id: 'versus', label: 'Versus' },
];

const PLAYERS: { id: PlayerId; label: string }[] = [
  { id: 'blue', label: 'Blue Player' },
  { id: 'red', label: 'Red Player' },
];

export function DuelDeckBuilder() {
  const sets = useBuilderStore((s) => s.sets);
  const mode = useBuilderStore((s) => s.mode);
  const setMode = useBuilderStore((s) => s.setMode);
  const deckSlotCount = useBuilderStore((s) => s.deckSlotCount);
  const clearSelection = useBuilderStore((s) => s.clearSelection);
  const setDeckCrowns = useBuilderStore((s) => s.setDeckCrowns);
  const [winFilter, setWinFilter] = useState<string[]>([]);

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

  const filtering = winFilter.length > 0;
  /** Decks keep their slot positions — matches glow, the rest just fade back. */
  const matches = (deck: Deck) => deckMatchesFilter(deck.slots, winFilter);

  const visibleDecks = (owner: DuelOwner) => sets[owner].decks.slice(0, deckSlotCount[owner]);
  const matchCount = mode === 'solo'
    ? visibleDecks('solo').filter(matches).length
    : visibleDecks('blue').filter(matches).length + visibleDecks('red').filter(matches).length;
  const totalDecks = mode === 'solo'
    ? deckSlotCount.solo
    : deckSlotCount.blue + deckSlotCount.red;

  return (
    <div className={styles.builder}>
      <div className={styles.modeBar}>
        <div className={styles.modeTabs}>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${styles.modeTab} ${mode === m.id ? styles.modeTabActive : ''}`}
              onClick={() => setMode(m.id)}
            >
              {mode === m.id && (
                <motion.span
                  layoutId="mode-indicator"
                  className={styles.modeIndicator}
                  transition={{ type: 'spring', stiffness: 480, damping: 34 }}
                />
              )}
              <span className={styles.modeLabel}>{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.scrollArea}>
        <div className={styles.winconWrap}>
          <WinConFilter selected={winFilter} onToggle={toggleWinCon} onClear={() => setWinFilter([])}>
            {filtering && (
              <span className={styles.winconCount}>
                {matchCount} of {totalDecks} decks
              </span>
            )}
          </WinConFilter>
        </div>

        {mode === 'solo' ? (
          <div className={styles.panels}>
            {sets.solo.decks.slice(0, deckSlotCount.solo).map((deck, i) => {
              const match = matches(deck);
              return (
                <motion.div
                  key={deck.id}
                  className={filtering && match ? styles.deckMatch : undefined}
                  initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
                  animate={{ opacity: filtering && !match ? 0.35 : 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ type: 'spring', stiffness: 240, damping: 26, delay: Math.min(i, 3) * 0.07 }}
                >
                  <DeckPanel owner="solo" deckIndex={i} deck={deck} />
                </motion.div>
              );
            })}
            <DeckSlotControls owner="solo" />
          </div>
        ) : (
          <div className={styles.versusColumns}>
            {PLAYERS.map((player, colIndex) => (
              <div key={player.id} className={styles.playerColumn} data-owner={player.id}>
                <motion.div
                  className={styles.playerHeader}
                  data-owner={player.id}
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 240, damping: 26, delay: colIndex * 0.08 }}
                >
                  <span className={styles.playerDot} data-owner={player.id} />
                  {player.label}
                </motion.div>
                {sets[player.id].decks.slice(0, deckSlotCount[player.id]).map((deck, i) => {
                  const match = matches(deck);
                  const crowns = (
                    <CrownCounter
                      value={deck.crowns ?? 0}
                      onChange={(c) => setDeckCrowns(player.id, i, c)}
                      side={player.id}
                      deckName={deck.name}
                    />
                  );
                  return (
                    <motion.div
                      key={deck.id}
                      className={styles.duelRow}
                      initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
                      animate={{ opacity: filtering && !match ? 0.35 : 1, y: 0, filter: 'blur(0px)' }}
                      transition={{
                        type: 'spring',
                        stiffness: 240,
                        damping: 26,
                        delay: 0.08 + Math.min(i, 3) * 0.06 + colIndex * 0.05,
                      }}
                    >
                      {/* Crowns sit on the inner edge of each column, flanking the VS divider. */}
                      {player.id === 'red' && crowns}
                      <div className={`${styles.duelPanel} ${filtering && match ? styles.deckMatch : ''}`}>
                        <DeckPanel owner={player.id} deckIndex={i} deck={deck} />
                      </div>
                      {player.id === 'blue' && crowns}
                    </motion.div>
                  );
                })}
                <DeckSlotControls owner={player.id} />
              </div>
            ))}

            <div className={styles.vsDivider}>
              {/* Sticky so it stays between the players while scrolling a tall column. */}
              <span className={styles.vsBadge}>VS</span>
              <span className={styles.vsLine} aria-hidden="true" />
            </div>
          </div>
        )}

        <SavedGroups mode={mode} winFilter={winFilter} />
      </div>
      <CardPickerDrawer />
      <FlightLayer />
    </div>
  );
}
