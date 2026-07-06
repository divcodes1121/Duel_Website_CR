import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useBuilderStore } from '../../state/store';
import type { BuilderMode, PlayerId } from '../../types/deck';
import { DeckPanel } from './DeckPanel';
import { CardPickerDrawer } from '../CardPicker/CardPickerDrawer';
import { FlightLayer } from '../FlightLayer/FlightLayer';
import styles from './DuelDeckBuilder.module.css';

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
            {sets.solo.decks.map((deck, i) => (
              <motion.div
                key={deck.id}
                initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ type: 'spring', stiffness: 240, damping: 26, delay: i * 0.07 }}
              >
                <DeckPanel owner="solo" deckIndex={i} deck={deck} />
              </motion.div>
            ))}
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
                {sets[player.id].decks.map((deck, i) => (
                  <motion.div
                    key={deck.id}
                    initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{
                      type: 'spring',
                      stiffness: 240,
                      damping: 26,
                      delay: 0.08 + i * 0.06 + colIndex * 0.05,
                    }}
                  >
                    <DeckPanel owner={player.id} deckIndex={i} deck={deck} />
                  </motion.div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <CardPickerDrawer />
      <FlightLayer />
    </div>
  );
}
