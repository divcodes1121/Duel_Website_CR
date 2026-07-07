import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useBuilderStore, type DuelOwner } from '../../state/store';
import { DUEL_DECK_COUNT, type BuilderMode, type PlayerId } from '../../types/deck';
import { DeckPanel } from './DeckPanel';
import { SavedGroups } from './SavedGroups';
import { CardPickerDrawer } from '../CardPicker/CardPickerDrawer';
import { FlightLayer } from '../FlightLayer/FlightLayer';
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') clearSelection();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection]);

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
        {mode === 'solo' ? (
          <div className={styles.panels}>
            {sets.solo.decks.slice(0, deckSlotCount.solo).map((deck, i) => (
              <motion.div
                key={deck.id}
                initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ type: 'spring', stiffness: 240, damping: 26, delay: Math.min(i, 3) * 0.07 }}
              >
                <DeckPanel owner="solo" deckIndex={i} deck={deck} />
              </motion.div>
            ))}
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
                {sets[player.id].decks.slice(0, deckSlotCount[player.id]).map((deck, i) => (
                  <motion.div
                    key={deck.id}
                    initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{
                      type: 'spring',
                      stiffness: 240,
                      damping: 26,
                      delay: 0.08 + Math.min(i, 3) * 0.06 + colIndex * 0.05,
                    }}
                  >
                    <DeckPanel owner={player.id} deckIndex={i} deck={deck} />
                  </motion.div>
                ))}
                <DeckSlotControls owner={player.id} />
              </div>
            ))}
          </div>
        )}

        <SavedGroups mode={mode} />
      </div>
      <CardPickerDrawer />
      <FlightLayer />
    </div>
  );
}
