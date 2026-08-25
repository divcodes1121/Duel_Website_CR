import { useState } from 'react';
import { useBuilderStore } from '../../state/store';
import { getCardIconUrl } from '../../data/cards';
/* One implementation, three callers — see the note in the module. */
import { previewIconFor } from '../../utils/deckPreview';
import { deckMatchesFilter } from '../WinConFilter/WinConFilter';
import type { BuilderMode, Deck, PlayerId, SavedDeckSet } from '../../types/deck';
import styles from './SavedGroups.module.css';


/** Hidden/unused deck slots stay out of the preview; empty groups show deck 1. */
function withCards(decks: Deck[]): Deck[] {
  const filled = decks.filter((d) => d.slots.some((k) => k !== null));
  return filled.length > 0 ? filled : decks.slice(0, 1);
}

function DeckRow({ deck, dim, side }: { deck: Deck; dim?: boolean; side?: PlayerId }) {
  const crowns = deck.crowns ?? 0;

  // Mirror the builder: Blue's crowns sit to the right of its cards, Red's to
  // the left, so the two players' counts face each other across the group.
  // A crownless deck shows a red struck-through crown with 0 rather than a gap,
  // which also keeps every card strip in a column aligned.
  const badge = side && (
    <span
      className={`${styles.crownBadge} ${crowns === 0 ? styles.crownBadgeZero : ''}`}
      data-side={side}
      title={crowns === 0 ? 'No crowns won' : `${crowns} crowns won`}
    >
      {crowns === 0 ? (
        <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
          <path
            d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"
            fill="currentColor"
            opacity="0.5"
          />
          <path
            d="M4.5 4.5 L19.5 19.5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true">
          <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
        </svg>
      )}
      {crowns}
    </span>
  );

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
  winFilter,
}: {
  entry: SavedDeckSet;
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
    <article className={styles.group}>
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
    </article>
  );
}

/** Every deck a saved group holds, across both sides for a versus set. */
function groupDecks(entry: SavedDeckSet): Deck[] {
  if (entry.mode === 'solo') return entry.solo?.decks ?? [];
  return [...(entry.blue?.decks ?? []), ...(entry.red?.decks ?? [])];
}

/**
 * Saved duel groups for the active mode — its own view, not a footer.
 *
 * This used to render below the builder, which put it under three to six deck
 * panels: reaching it meant scrolling past the entire board, and it returned
 * `null` outright when there was nothing saved, so the one time you most wanted
 * to know where it had gone there was nothing on screen to find. It now fills
 * the same area the board does and says so when it is empty.
 *
 * The win-condition filter SELECTS here rather than only dimming. Below the
 * builder its job was "show me which of these decks holds Hog Rider", so
 * dimming the rest was right; as a library its job is "find me the groups with
 * Hog Rider in them", and a group with no matching deck is not an answer to
 * that. Matching decks are still highlighted inside the groups that survive.
 */
export function SavedGroups({ mode, winFilter = [] }: { mode: BuilderMode; winFilter?: string[] }) {
  const library = useBuilderStore((s) => s.library);
  const all = library.filter((e) => e.mode === mode);
  const filtering = winFilter.length > 0;
  const entries = filtering
    ? all.filter((e) => groupDecks(e).some((d) => deckMatchesFilter(d.slots, winFilter)))
    : all;

  return (
    <section className={styles.section} aria-label="Saved duel deck groups">
      <h2 className={styles.sectionTitle}>
        Saved Groups
        <span className={styles.sectionCount}>
          {filtering ? `${entries.length} of ${all.length}` : all.length}
        </span>
      </h2>

      {all.length === 0 ? (
        <p className={styles.empty}>
          Nothing saved for {mode === 'solo' ? 'Solo' : 'Versus'} yet. Build a set on the Build
          tab and press <strong>Save</strong> — it lands here, and loading one puts it straight
          back into the builder.
        </p>
      ) : entries.length === 0 ? (
        <p className={styles.empty}>
          None of your {all.length} saved {mode === 'solo' ? 'Solo' : 'Versus'} group
          {all.length === 1 ? '' : 's'} holds every card in the filter. Clear it, or pick fewer
          cards.
        </p>
      ) : (
        entries.map((entry) => (
          <GroupCard key={entry.id} entry={entry} winFilter={winFilter} />
        ))
      )}
    </section>
  );
}
