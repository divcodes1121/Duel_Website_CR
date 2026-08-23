import { useState, type ReactNode } from 'react';
import { CardLibrary } from '../CardPicker/CardLibrary';
import { FlightLayer } from '../FlightLayer/FlightLayer';
import styles from './DeckWorkspace.module.css';

interface DeckWorkspaceProps {
  /** The row above both columns — mode tabs, filters, screen actions. */
  toolbar?: ReactNode;
  /** The decks. Scrolls on its own, independently of the card library. */
  children: ReactNode;
}

/**
 * The two-column shell every deck screen shares: decks on the left, the card
 * library on the right, each scrolling by itself.
 *
 * All three screens used to be one long scrolling column with the pool in a
 * drawer that slid up over it — so filling a deck meant scrolling to it,
 * opening the drawer, losing sight of the deck under the drawer, picking, and
 * scrolling back. And because the page scrolled as one piece, the toolbar, the
 * decks and the pool all moved together and the screen read as a pile.
 *
 * Splitting it fixes both at once. The toolbar is fixed, each column owns its
 * own overflow, and the deck you are filling stays on screen beside the card
 * you are choosing. It is one component rather than three copies because three
 * copies of a grid rule is how the duel builder and Deck's Home end up
 * disagreeing about what a deck screen looks like.
 */
export function DeckWorkspace({ toolbar, children }: DeckWorkspaceProps) {
  /**
   * Owned here so the grid and the panel cannot disagree about which of the two
   * states is live — the column width and the panel's own shape are one
   * decision made in one place.
   */
  const [collapsed, setCollapsed] = useState(false);

  return (
    /* ONE grid, two rows: the toolbar sits in the first, the decks in the
     * second, and the library spans BOTH. It used to be a toolbar stacked above
     * a two-column workspace, which meant the library began where the decks did
     * and left a band of empty panel beside the toolbar — a strip of nothing
     * across the full width of the tallest thing on the screen. Spanning the
     * rows gives the card grid that height back. */
    <div className={styles.shell} data-library={collapsed ? 'closed' : 'open'}>
      {toolbar && <div className={styles.toolbar}>{toolbar}</div>}

      <div className={styles.deckColumn}>{children}</div>

      <div className={styles.libraryCell}>
        <CardLibrary collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </div>

      <FlightLayer />
    </div>
  );
}
