import { useEffect, useRef, useState } from 'react';
import type { Deck, DeckOwner } from '../../types/deck';
import { DECK_SIZE } from '../../types/deck';
import { useBuilderStore } from '../../state/store';
import { fireDeckFx } from '../../state/deckFx';
import { getClashRoyaleDeckLink, parseClashRoyaleDeckLink } from '../../utils/deckLink';
import { DeckSlotGrid } from './DeckSlotGrid';
import { DeckStats } from './DeckStats';
import {
  LaunchIcon,
  LinkIcon,
  ImportIcon,
  RenameIcon,
  ClearIcon,
  TrashIcon,
  CheckIcon,
  CloseIcon,
} from './icons';
import styles from './DeckPanel.module.css';

interface DeckPanelProps {
  owner: DeckOwner;
  deckIndex: number;
  deck: Deck;
  /** When provided, renders a Delete button (used by Deck's Home to remove a deck slot). */
  onDelete?: () => void;
  /** Wording for that button, when "Delete deck" is not what it does. */
  deleteLabel?: string;
}

/**
 * One deck: a name, eight slots, two figures and the actions that operate on it.
 *
 * The action row is icons now. It used to be five text buttons — "Open in
 * Game", "Copy Link", "Import", "Rename", "Clear" — which is roughly a third of
 * the panel's width spent on labels, and the width is exactly what the new
 * two-column workspace needs: the card library sits beside the decks, so a deck
 * panel is no longer as wide as the screen. Each button keeps its wording in
 * `title` and `aria-label`, and the one primary action keeps its words outright,
 * in the footer where it reads as the end of the deck rather than one more
 * control in a row of six.
 */
export function DeckPanel({ owner, deckIndex, deck, onDelete, deleteLabel }: DeckPanelProps) {
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

  /* A light crosses the eight slots the moment the deck becomes legal.
   *
   * Completing a deck is this screen's whole goal, and until now it was
   * announced by a small counter going 7/8 to 8/8. This marks it.
   *
   * ONLY ON THE TRANSITION, which is what the ref is for. Without it every
   * mount of an already-full deck would sweep — so switching Solo/Versus,
   * opening a palette folder, or loading a saved set would fire three to six
   * sweeps at once for decks the reader did not just finish. `prev` starts
   * undefined, so the first render never counts as a transition. */
  const wasFull = useRef<number | undefined>(undefined);
  useEffect(() => {
    const before = wasFull.current;
    wasFull.current = filledCount;
    if (before !== undefined && before < DECK_SIZE && filledCount === DECK_SIZE) {
      fireDeckFx({ kind: 'sweep', deck: `${owner}-${deckIndex}` });
    }
  }, [filledCount, owner, deckIndex]);
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
    // Empty the field NOW and leave the row open, rather than closing the whole
    // thing after a beat. The old behaviour meant importing three decks in a
    // row was: open, paste, wait for it to close itself, open the next panel.
    // The deck that just landed is visible in the slots above; what the field
    // is for is the next link.
    setImportValue('');
    setImportOk(true);
    window.setTimeout(() => setImportOk(false), 1400);
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

  function startRename() {
    setDraftName(deck.name);
    setIsEditing(true);
  }

  return (
    <section className={styles.panel} data-owner={owner}>
      <header className={styles.header}>
        <span className={styles.index} aria-hidden="true">
          {deckIndex + 1}
        </span>

        {isEditing ? (
          <input
            className={styles.nameInput}
            value={draftName}
            autoFocus
            aria-label="Deck name"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                // Stop it reaching the builder's global handler, which would
                // also drop the slot selection on the way past.
                e.stopPropagation();
                setDraftName(deck.name);
                setIsEditing(false);
              }
            }}
          />
        ) : (
          /* The name is the rename control as well as the label — the pencil is
             still there for anyone looking for a button, but clicking the thing
             you want to change is the shorter path. */
          <button type="button" className={styles.name} onClick={startRename} title="Rename this deck">
            {deck.name}
          </button>
        )}

        <span
          className={`${styles.fillCount} ${filledCount === DECK_SIZE ? styles.fillCountFull : ''}`}
          title={`${filledCount} of ${DECK_SIZE} cards placed`}
        >
          {filledCount}/{DECK_SIZE}
        </span>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconButton} data-metal
            title={
              deckLink
                ? "Copy this deck's Clash Royale share link"
                : 'Fill all 8 slots to copy the deck link'
            }
            aria-label="Copy deck link"
            aria-disabled={!deckLink}
            data-flash={linkOnlyCopied || undefined}
            onClick={copyDeckLink}
          >
            {linkOnlyCopied ? <CheckIcon /> : <LinkIcon />}
          </button>

          <button
            type="button"
            className={styles.iconButton} data-metal
            title="Paste a Clash Royale deck link to build this deck"
            aria-label="Import a deck link"
            aria-expanded={importOpen}
            data-on={importOpen || undefined}
            onClick={() => (importOpen ? closeImport() : setImportOpen(true))}
          >
            <ImportIcon />
          </button>

          <button
            type="button"
            className={styles.iconButton} data-metal
            title="Rename this deck"
            aria-label="Rename this deck"
            onClick={startRename}
          >
            <RenameIcon />
          </button>

          <button
            type="button"
            className={styles.iconButton} data-metal
            title="Clear every card from this deck"
            aria-label="Clear this deck"
            aria-disabled={filledCount === 0}
            onClick={() => filledCount > 0 && clearDeck(owner, deckIndex)}
          >
            <ClearIcon />
          </button>

          {onDelete && (
            <button
              type="button"
              className={`${styles.iconButton} ${styles.iconButtonDanger}`}
              title={deleteLabel ?? 'Delete this deck'}
              aria-label={deleteLabel ?? 'Delete this deck'}
              onClick={onDelete}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </header>

      {importOpen && (
        <div className={styles.importRow}>
          <input
            className={`${styles.importInput} ${importError ? styles.importInputError : ''}`}
            value={importValue}
            autoFocus
            placeholder="Paste a Clash Royale deck link — the deck builds itself"
            spellCheck={false}
            aria-label="Clash Royale deck link"
            onChange={(e) => handleImportChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') tryImport(importValue);
              if (e.key === 'Escape') {
                e.stopPropagation();
                closeImport();
              }
            }}
          />
          {importOk ? (
            <span className={styles.importOk}>Imported ✓</span>
          ) : importError ? (
            <span className={styles.importErrorText}>{importError}</span>
          ) : null}
          <button
            type="button"
            className={styles.importClose}
            onClick={closeImport}
            title="Close"
            aria-label="Close the import field"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      <DeckSlotGrid owner={owner} deckIndex={deckIndex} deck={deck} />

      <footer className={styles.footer}>
        <DeckStats deck={deck} />
        <button
          type="button"
          className={styles.launch}
          title={
            deckLink
              ? 'Open this deck in Clash Royale — the share link is copied too'
              : 'Fill all 8 slots to open this deck in Clash Royale'
          }
          aria-disabled={!deckLink}
          onClick={openInClashRoyale}
        >
          <LaunchIcon size={14} />
          {linkCopied ? 'Link copied' : 'Open in Game'}
        </button>
      </footer>
    </section>
  );
}
