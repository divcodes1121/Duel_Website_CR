import { useEffect, useRef, useState } from 'react';
import { getDeckLinkFromKeys } from '../../utils/deckLink';
import { CheckIcon, LaunchIcon, LinkIcon } from '../DuelDeckBuilder/icons';
import styles from './DeckActions.module.css';

/**
 * Copy-link + open-in-game for any deck the site draws.
 *
 * The duel builder's DeckPanel has had these two actions since early on; every
 * analytics screen drew decks you could look at and not act on. This is that
 * pair, sized to sit beside a table row rather than inside a panel header, so
 * one implementation serves the meta board, the player screens, the Duel Zone,
 * the Deck Counter, the Coach and the live battlelog.
 *
 * Three things it deliberately does NOT do:
 *
 * - It does not reorder the deck. Analytics decks arrive already arranged by
 *   `clash_data.arrange_deck`, so their order IS the slot order a copyDeck link
 *   wants. Re-deriving one here would be the "whose data is it?" bug again.
 * - It does not render at all when the deck cannot produce a link — a native
 *   duel row carries a 16/24-card loadout, and a button that silently does
 *   nothing is worse than no button.
 * - It does not claim COPY LINK put the deck in the game. Open in Game copies
 *   the link too, exactly as the builder does, because the deep link is also
 *   the shareable artifact.
 */

interface DeckActionsProps {
  /** Card keys in the order the deck should be written — server order. */
  cards: readonly string[];
  /** Names the deck in the tooltips, so a row of these is distinguishable. */
  name?: string;
  /** `sm` for dense table rows, `md` beside a full deck panel. */
  size?: 'sm' | 'md';
  className?: string;
}

export function DeckActions({ cards, name, size = 'sm', className }: DeckActionsProps) {
  const link = getDeckLinkFromKeys(cards);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  // The flash is a timeout, and a row can unmount while it is pending — a
  // filter change or a page step drops the whole table. Clearing on unmount is
  // what stops setState firing into a component that is gone.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!link) return null;

  const label = name ? `${name} deck link` : 'deck link';

  function flash() {
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  function copy(e: React.MouseEvent) {
    // Deck rows are frequently clickable themselves (Duel Zone expands, the
    // Coach selects), so these must never reach the row behind them.
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard?.writeText(link!).catch(() => {});
    flash();
  }

  function open(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard?.writeText(link!).catch(() => {});
    flash();
    window.open(link!, '_blank', 'noopener');
  }

  return (
    <span
      className={`${styles.actions} ${className ?? ''}`}
      data-size={size}
      /* The strip sits inside labels and headings on some screens; keep the
         buttons out of any text flow they land in. */
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={styles.button}
        title={copied ? 'Copied' : `Copy the ${label}`}
        aria-label={`Copy the ${label}`}
        data-flash={copied || undefined}
        onClick={copy}
      >
        {copied ? <CheckIcon size={size === 'sm' ? 12 : 14} /> : <LinkIcon size={size === 'sm' ? 12 : 14} />}
      </button>

      <button
        type="button"
        className={`${styles.button} ${styles.launch}`}
        title={`Open this deck in Clash Royale — the ${label} is copied too`}
        aria-label="Open this deck in Clash Royale"
        onClick={open}
      >
        <LaunchIcon size={size === 'sm' ? 12 : 14} />
      </button>
    </span>
  );
}
