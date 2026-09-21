import styles from './SuggestHeading.module.css';

/** The heading's words, exported so a test and both screens share one string. */
export const DECKKIES_SUGGEST = 'What Deckkies Suggest To Play';

/**
 * THE HIGHLIGHTED HEADING OVER DECKKIES' OWN SUGGESTIONS.
 *
 * Asked for by name (2026-09-21) on both screens that rank decks against an
 * opponent — Team Analysis and the Coach Roster's What-to-play tab — so it is
 * one component rather than two headings that drift apart. It sits over a list
 * that is no longer "the decks this player happens to play": the player's own
 * decks and the strongest real decks from the wider player base are ranked
 * TOGETHER, and the heading is what says whose suggestion the list is.
 *
 * HIGHLIGHTED BY A VIOLET BAR AND A TINT, NOT A SLAB. Text stays `--text` on a
 * 12% wash, so it clears contrast in both themes without a white-on-colour
 * fill; the bar is `--solid-violet`, a bare graphic mark.
 */
export function SuggestHeading() {
  /* NO SUBTITLE. It carried "against the whole roster", "for each of your
     players, against …" and a count of own vs outside decks; the account
     holder asked for the explanatory text to go (2026-09-21). */
  return (
    <h4 className={styles.head}>
      <span className={styles.title}>{DECKKIES_SUGGEST}</span>
    </h4>
  );
}
