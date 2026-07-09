import { useState } from 'react';
import { motion } from 'framer-motion';
import { useBuilderStore } from '../../state/store';
import {
  CARDS_BY_KEY,
  getCardIconUrl,
  getEvolutionIconUrl,
  getHeroIconUrl,
} from '../../data/cards';
import { getSlotVisualVariant } from '../../state/deckUtils';
import { deckMatchesFilter } from '../WinConFilter/WinConFilter';
import type { BuilderMode, Deck, PlayerId, SavedDeckSet } from '../../types/deck';
import styles from './SavedGroups.module.css';

/** Same evo/hero art selection the live deck slots use, so previews match. */
function previewIconFor(deck: Deck, slotIndex: number, key: string): string {
  const card = CARDS_BY_KEY.get(key);
  const variant = getSlotVisualVariant(deck, slotIndex, CARDS_BY_KEY);
  if (variant === 'evolution') return getEvolutionIconUrl(key);
  if (variant === 'hero' && card && !card.isChampion) return getHeroIconUrl(key);
  return getCardIconUrl(key);
}

/** Hidden/unused deck slots stay out of the preview; empty groups show deck 1. */
function withCards(decks: Deck[]): Deck[] {
  const filled = decks.filter((d) => d.slots.some((k) => k !== null));
  return filled.length > 0 ? filled : decks.slice(0, 1);
}

function DeckRow({ deck, dim, side }: { deck: Deck; dim?: boolean; side?: PlayerId }) {
  const crowns = deck.crowns ?? 0;

  // Mirror the builder: Blue's crowns sit to the right of its cards, Red's to
  // the left, so the two players' counts face each other across the group.
  // Crownless decks keep an empty slot of the same width, so every card strip
  // in a column stays aligned.
  const badge =
    side &&
    (crowns > 0 ? (
      <span className={styles.crownBadge} data-side={side} title={`${crowns} crowns won`}>
        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true">
          <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
        </svg>
        {crowns}
      </span>
    ) : (
      <span className={styles.crownBadgeSpacer} aria-hidden="true" />
    ));

  return (
    <div className={`${styles.deckRow} ${dim ? styles.deckRowDim : ''}`}>
      <span className={styles.deckRowName}>{deck.name}</span>
      {side === 'red' && badge}
      <div className={styles.deckRowCards}>
        {deck.slots.map((key, i) =>
          key ? (
            <img
              key={i}
              src={previewIconFor(deck, i, key)}
              alt=""
              title={key}
              draggable={false}
              onError={(e) => {
                // A few cards lack special-form art (e.g. Bowler hero) — fall back to base.
                const base = getCardIconUrl(key);
                if (e.currentTarget.src !== new URL(base, window.location.href).href) {
                  e.currentTarget.src = base;
                }
              }}
            />
          ) : (
            <span key={i} className={styles.emptyMini} />
          ),
        )}
      </div>
      {side === 'blue' && badge}
    </div>
  );
}

function GroupCard({
  entry,
  index,
  winFilter,
}: {
  entry: SavedDeckSet;
  index: number;
  winFilter: string[];
}) {
  const loadSaved = useBuilderStore((s) => s.loadSaved);
  const renameSaved = useBuilderStore((s) => s.renameSaved);
  const deleteSaved = useBuilderStore((s) => s.deleteSaved);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(entry.name);

  // While filtering, a saved deck without the selected win condition(s) is
  // rendered black & white so the matching ones stand out.
  const dimmed = (deck: Deck) =>
    winFilter.length > 0 && !deckMatchesFilter(deck.slots, winFilter);

  const savedDate = new Date(entry.savedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  function handleLoad() {
    if (window.confirm(`Load "${entry.name}"? Your current decks will be replaced.`)) {
      loadSaved(entry.id);
      window.scrollTo({ top: 0 });
    }
  }

  function startRename() {
    setDraftName(entry.name);
    setIsRenaming(true);
  }

  function commitRename() {
    renameSaved(entry.id, draftName);
    setIsRenaming(false);
  }

  function handleDelete() {
    if (window.confirm(`Delete the saved group "${entry.name}"?`)) deleteSaved(entry.id);
  }

  return (
    <motion.article
      className={styles.group}
      initial={{ opacity: 0, y: 26, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ type: 'spring', stiffness: 220, damping: 26, delay: Math.min(index, 3) * 0.06 }}
    >
      <header className={styles.groupHeader}>
        <div className={styles.groupTitleWrap}>
          {isRenaming ? (
            <input
              className={styles.groupNameInput}
              value={draftName}
              autoFocus
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setIsRenaming(false);
              }}
            />
          ) : (
            <h3 className={styles.groupName}>{entry.name}</h3>
          )}
          <span className={styles.groupMeta}>Saved {savedDate}</span>
        </div>
        <div className={styles.groupActions}>
          <button type="button" className={styles.groupButton} onClick={handleLoad}>
            Load
          </button>
          <button type="button" className={styles.groupButton} onClick={startRename}>
            Rename
          </button>
          <button
            type="button"
            className={`${styles.groupButton} ${styles.groupButtonDanger}`}
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
      </header>

      {entry.mode === 'solo' && entry.solo ? (
        <div className={styles.groupDecks}>
          {withCards(entry.solo.decks).map((deck) => (
            <DeckRow key={deck.id} deck={deck} dim={dimmed(deck)} />
          ))}
        </div>
      ) : (
        <div className={styles.groupVersus}>
          {(['blue', 'red'] as const).map(
            (side) =>
              entry[side] && (
                <div key={side} className={styles.groupSide} data-owner={side}>
                  <span className={styles.groupSideLabel} data-owner={side}>
                    {side === 'blue' ? 'Blue Player' : 'Red Player'}
                  </span>
                  {withCards(entry[side]!.decks).map((deck) => (
                    <DeckRow key={deck.id} deck={deck} dim={dimmed(deck)} side={side} />
                  ))}
                </div>
              ),
          )}
        </div>
      )}
    </motion.article>
  );
}

/** Saved duel groups for the active tab, shown right below the deck builder. */
export function SavedGroups({ mode, winFilter = [] }: { mode: BuilderMode; winFilter?: string[] }) {
  const library = useBuilderStore((s) => s.library);
  const entries = library.filter((e) => e.mode === mode);

  if (entries.length === 0) return null;

  return (
    <section className={styles.section} aria-label="Saved duel deck groups">
      <h2 className={styles.sectionTitle}>
        Saved Groups
        <span className={styles.sectionCount}>{entries.length}</span>
      </h2>
      {entries.map((entry, i) => (
        <GroupCard key={entry.id} entry={entry} index={i} winFilter={winFilter} />
      ))}
    </section>
  );
}
