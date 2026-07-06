import { useState } from 'react';
import type { Deck, DeckOwner } from '../../types/deck';
import { useBuilderStore } from '../../state/store';
import { getClashRoyaleDeckLink } from '../../utils/deckLink';
import { DeckSlotGrid } from './DeckSlotGrid';
import { DeckStats } from './DeckStats';
import styles from './DeckPanel.module.css';

interface DeckPanelProps {
  owner: DeckOwner;
  deckIndex: number;
  deck: Deck;
  /** When provided, renders a Delete button (used by Deck's Home to remove a deck slot). */
  onDelete?: () => void;
}

export function DeckPanel({ owner, deckIndex, deck, onDelete }: DeckPanelProps) {
  const renameDeck = useBuilderStore((s) => s.renameDeck);
  const clearDeck = useBuilderStore((s) => s.clearDeck);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(deck.name);

  const filledCount = deck.slots.filter((s) => s !== null).length;
  const deckLink = getClashRoyaleDeckLink(deck);
  const [linkCopied, setLinkCopied] = useState(false);

  function commitRename() {
    const trimmed = draftName.trim();
    renameDeck(owner, deckIndex, trimmed || deck.name);
    setIsEditing(false);
  }

  function openInClashRoyale() {
    if (!deckLink) return;
    // Also put the link on the clipboard so it can be shared directly.
    navigator.clipboard?.writeText(deckLink).catch(() => {});
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1800);
    window.open(deckLink, '_blank', 'noopener');
  }

  return (
    <section className={styles.panel} data-owner={owner}>
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
            className={`${styles.iconButton} ${styles.crButton}`}
            title={
              deckLink
                ? 'Open this deck in Clash Royale — the share link is copied too'
                : 'Fill all 8 slots to open this deck in Clash Royale'
            }
            aria-disabled={!deckLink}
            onClick={openInClashRoyale}
          >
            {linkCopied ? 'Link copied ✓' : 'Open in Game'}
          </button>
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
            onClick={() => clearDeck(owner, deckIndex)}
          >
            Clear
          </button>
          {onDelete && (
            <button
              type="button"
              className={styles.iconButton}
              title="Delete this deck"
              onClick={onDelete}
            >
              Delete
            </button>
          )}
        </div>
      </header>
      <DeckSlotGrid owner={owner} deckIndex={deckIndex} deck={deck} />
      <DeckStats deck={deck} />
    </section>
  );
}
