import { useState } from 'react';
import type { Deck } from '../../types/deck';
import { useBuilderStore } from '../../state/store';
import { DeckSlotGrid } from './DeckSlotGrid';
import { DeckStats } from './DeckStats';
import styles from './DeckPanel.module.css';

interface DeckPanelProps {
  deckIndex: number;
  deck: Deck;
}

export function DeckPanel({ deckIndex, deck }: DeckPanelProps) {
  const renameDeck = useBuilderStore((s) => s.renameDeck);
  const clearDeck = useBuilderStore((s) => s.clearDeck);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(deck.name);

  const filledCount = deck.slots.filter((s) => s !== null).length;

  function commitRename() {
    const trimmed = draftName.trim();
    renameDeck(deckIndex, trimmed || deck.name);
    setIsEditing(false);
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        {isEditing ? (
          <input
            className={styles.nameInput}
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setDraftName(deck.name);
                setIsEditing(false);
              }
            }}
          />
        ) : (
          <h2 className={styles.name}>
            {deck.name}
            <span
              className={`${styles.fillCount} ${filledCount === 8 ? styles.fillCountFull : ''}`}
              title={`${filledCount} of 8 cards placed`}
            >
              {filledCount}/8
            </span>
          </h2>
        )}
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            title="Rename deck"
            onClick={() => {
              setDraftName(deck.name);
              setIsEditing(true);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className={styles.iconButton}
            title="Clear deck"
            onClick={() => clearDeck(deckIndex)}
          >
            Clear
          </button>
        </div>
      </header>
      <DeckSlotGrid deckIndex={deckIndex} deck={deck} />
      <DeckStats deck={deck} />
    </section>
  );
}
