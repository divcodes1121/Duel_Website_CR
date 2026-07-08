import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Deck, DeckOwner } from '../../types/deck';
import { useBuilderStore } from '../../state/store';
import { getClashRoyaleDeckLink, parseClashRoyaleDeckLink } from '../../utils/deckLink';
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
  const importDeck = useBuilderStore((s) => s.importDeck);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(deck.name);
  const [importOpen, setImportOpen] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importOk, setImportOk] = useState(false);

  const filledCount = deck.slots.filter((s) => s !== null).length;
  const deckLink = getClashRoyaleDeckLink(deck);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkOnlyCopied, setLinkOnlyCopied] = useState(false);

  function copyDeckLink() {
    if (!deckLink) return;
    navigator.clipboard?.writeText(deckLink).catch(() => {});
    setLinkOnlyCopied(true);
    window.setTimeout(() => setLinkOnlyCopied(false), 1800);
  }

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

  function tryImport(text: string) {
    const keys = parseClashRoyaleDeckLink(text);
    if (!keys) {
      setImportError('Invalid deck link');
      return;
    }
    const error = importDeck(owner, deckIndex, keys);
    if (error) {
      setImportError(error);
      return;
    }
    setImportError(null);
    setImportOk(true);
    window.setTimeout(() => {
      setImportOk(false);
      setImportOpen(false);
      setImportValue('');
    }, 1400);
  }

  function handleImportChange(value: string) {
    setImportValue(value);
    setImportError(null);
    // A deck link is pasted, not typed — import the moment one shows up.
    if (/deck=/i.test(value)) tryImport(value);
  }

  function closeImport() {
    setImportOpen(false);
    setImportValue('');
    setImportError(null);
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
            title={
              deckLink
                ? "Copy this deck's Clash Royale share link"
                : 'Fill all 8 slots to copy the deck link'
            }
            aria-disabled={!deckLink}
            onClick={copyDeckLink}
          >
            {linkOnlyCopied ? 'Copied ✓' : 'Copy Link'}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            title="Paste a Clash Royale deck link to build this deck"
            aria-expanded={importOpen}
            onClick={() => {
              if (importOpen) {
                closeImport();
              } else {
                setImportOpen(true);
              }
            }}
          >
            Import
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
            Rename
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

      <div className={styles.importWrap}>
        <AnimatePresence initial={false}>
          {importOpen && (
            <motion.div
              key="import-row"
              className={styles.importRow}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
              <div className={styles.importInner}>
                <input
                  className={`${styles.importInput} ${importError ? styles.importInputError : ''}`}
                  value={importValue}
                  autoFocus
                  placeholder="Paste a Clash Royale deck link — the deck builds itself"
                  spellCheck={false}
                  onChange={(e) => handleImportChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') tryImport(importValue);
                    if (e.key === 'Escape') closeImport();
                  }}
                />
                {importOk ? (
                  <span className={styles.importOk}>Deck imported ✓</span>
                ) : importError ? (
                  <span className={styles.importErrorText}>{importError}</span>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <DeckSlotGrid owner={owner} deckIndex={deckIndex} deck={deck} />
      <DeckStats deck={deck} />
    </section>
  );
}
