import { motion } from 'framer-motion';
import { useBuilderStore } from '../../state/store';
import { getCardIconUrl } from '../../data/cards';
import type { BuilderMode, Deck, SavedDeckSet } from '../../types/deck';
import styles from './SavedGroups.module.css';

/** Hidden/unused deck slots stay out of the preview; empty groups show deck 1. */
function withCards(decks: Deck[]): Deck[] {
  const filled = decks.filter((d) => d.slots.some((k) => k !== null));
  return filled.length > 0 ? filled : decks.slice(0, 1);
}

function DeckRow({ deck }: { deck: Deck }) {
  return (
    <div className={styles.deckRow}>
      <span className={styles.deckRowName}>{deck.name}</span>
      <div className={styles.deckRowCards}>
        {deck.slots.map((key, i) =>
          key ? (
            <img key={i} src={getCardIconUrl(key)} alt="" title={key} draggable={false} />
          ) : (
            <span key={i} className={styles.emptyMini} />
          ),
        )}
      </div>
    </div>
  );
}

function GroupCard({ entry, index }: { entry: SavedDeckSet; index: number }) {
  const loadSaved = useBuilderStore((s) => s.loadSaved);
  const deleteSaved = useBuilderStore((s) => s.deleteSaved);

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
          <h3 className={styles.groupName}>{entry.name}</h3>
          <span className={styles.groupMeta}>Saved {savedDate}</span>
        </div>
        <div className={styles.groupActions}>
          <button type="button" className={styles.groupButton} onClick={handleLoad}>
            Load
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
            <DeckRow key={deck.id} deck={deck} />
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
                    <DeckRow key={deck.id} deck={deck} />
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
export function SavedGroups({ mode }: { mode: BuilderMode }) {
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
        <GroupCard key={entry.id} entry={entry} index={i} />
      ))}
    </section>
  );
}
