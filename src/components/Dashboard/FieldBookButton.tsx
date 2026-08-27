/**
 * THE FIELD BOOK BUTTON — a closed book in the chrome that opens when you
 * reach for it.
 *
 * WHY AN OBJECT AND NOT AN ICON. Every other control in this bar is a glyph in
 * a circle, which is right for a theme switch and wrong for this: the thing it
 * opens is a physical book on a desk, and a button that behaves like one is the
 * only honest preview of that. It is also the whole of the temptation — a
 * cover that swings open under the pointer asks to be pressed in a way a
 * bookmark icon never does, and it costs one rotateY.
 *
 * IT IS BUILT FROM TOKENS AND HAS NO PALETTE OF ITS OWN, so it reads in both
 * themes without a `[data-theme]` branch:
 *   · the cover is `--solid-maroon`, the ACTION step — "the primary thing to
 *     click" — which is graded to carry white and therefore also reads against
 *     both the black landing bar and the raised grey one everywhere else;
 *   · the page block is the parchment the book itself is made of, the one
 *     literal colour here, because the paper IS the product;
 *   · the ribbon is the app's gold, which `index.css` reserves for game
 *     iconography rather than meaning — a bookmark is exactly that sort of
 *     object, and it is the only warm accent in the bar.
 *
 * NO INFINITE ANIMATION. The opening is a hover transition and the arrival
 * shimmer is one-shot, on transform and opacity only.
 */
import styles from './FieldBookButton.module.css';

export function FieldBookButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className={styles.btn}
      onClick={onOpen}
      title="The field book — what the site is, and what a Member and a Pro each get"
      aria-label="Open the field book"
    >
      <span className={styles.book} aria-hidden="true">
        {/* Drawn back to front: the block of paper, then the ribbon marking a
            page inside it, then the cover that swings off the front of both. */}
        <span className={styles.pages}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.ribbon} />
        <span className={styles.cover}>
          <span className={styles.crest} />
        </span>
        <span className={styles.spine} />
      </span>
      {/* THE VISIBLE WORDS ARE THE TEASE; THE ACCESSIBLE NAME IS THE TRUTH.
          "Click me" is an invitation and says nothing about where it goes, which
          is the point on screen and useless to a screen reader — announced on
          its own it is a button that does something unknowable. So the label is
          the curiosity and `aria-label` and `title` carry what it actually
          opens. The two are allowed to differ here precisely because one is
          bait and the other is a destination. */}
      <span className={styles.label}>Click me</span>
      <span className={styles.sheen} aria-hidden="true" />
    </button>
  );
}
