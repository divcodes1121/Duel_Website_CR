import { useBuilderStore } from '../../state/store';
import { CardFilterTabs } from './CardFilterTabs';
import { CardFilterControls } from './CardFilterControls';
import { CardGrid } from './CardGrid';
import { useFilteredCards } from './useFilteredCards';
import { useRemoveDrop } from './useRemoveDrop';
import { LayersIcon, ChevronDownIcon } from '../DuelDeckBuilder/icons';
import styles from './CardPicker.module.css';

const OWNER_LABEL = {
  solo: '',
  blue: 'Blue ',
  red: 'Red ',
  home: '',
  palette: '',
} as const;

interface CardLibraryProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * The card pool as a PERMANENT column beside the decks, rather than a drawer
 * sliding up over them.
 *
 * The drawer had to be a drawer when the decks owned the full width: it capped
 * itself at 42vh and covered whatever it opened over, so picking a card for the
 * fourth deck meant scrolling, opening, losing sight of the deck, and scrolling
 * back. A deck row is only eight cards wide, which leaves room for the pool to
 * simply be there — the deck you are filling and the card you are choosing are
 * on screen at the same time, which is the whole point of the layout.
 *
 * It still collapses, because on a narrow window the decks want the width back;
 * `collapsed` is owned by the builder so the workspace grid and this panel can
 * never disagree about which of the two states is live.
 */
export function CardLibrary({ collapsed, onToggle }: CardLibraryProps) {
  const selectedSlot = useBuilderStore((s) => s.selectedSlot);
  const sets = useBuilderStore((s) => s.sets);
  const remove = useRemoveDrop();
  const cards = useFilteredCards();

  const targetDeck = selectedSlot ? sets[selectedSlot.owner].decks[selectedSlot.deckIndex] : null;

  if (collapsed) {
    return (
      <aside className={`${styles.library} ${styles.libraryCollapsed}`}>
        <button
          type="button"
          className={styles.libraryReopen}
          onClick={onToggle}
          title="Show the card library"
          aria-label="Show the card library"
          aria-expanded={false}
        >
          <LayersIcon size={16} />
          <span className={styles.libraryReopenLabel}>Card Library</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`${styles.library} ${remove.over ? styles.libraryRemoveHover : ''}`}
      data-card-library
      {...remove.handlers}
    >
      <header className={styles.libraryHeader}>
        <span className={styles.libraryTitle}>
          <span className={styles.libraryIcon} aria-hidden="true">
            <LayersIcon size={14} />
          </span>
          Card Library
        </span>
        <span className={styles.libraryCount}>{cards.length}</span>
        <button
          type="button"
          className={styles.libraryToggle} data-metal
          onClick={onToggle}
          title="Hide the card library"
          aria-label="Hide the card library"
          aria-expanded
        >
          <span className={styles.libraryToggleIcon}>
            <ChevronDownIcon size={15} />
          </span>
        </button>
      </header>

      <CardFilterControls />
      <CardFilterTabs />

      {/* One line, three states: what a drop would do, what a click would do,
          or that neither is armed yet. It sits above the grid rather than in
          the toolbar because it describes the grid. */}
      {remove.over ? (
        <p className={`${styles.status} ${styles.statusRemove}`}>Drop here to remove the card</p>
      ) : selectedSlot && targetDeck ? (
        <p className={styles.status} data-owner={selectedSlot.owner}>
          Filling {OWNER_LABEL[selectedSlot.owner]}
          <strong>{targetDeck.name}</strong> · slot {selectedSlot.slotIndex + 1} of 8
          <span className={styles.statusHint}>Esc to stop</span>
        </p>
      ) : (
        <p className={`${styles.status} ${styles.statusIdle}`}>
          Pick a slot, or drag a card onto a deck
        </p>
      )}

      <CardGrid />
    </aside>
  );
}
