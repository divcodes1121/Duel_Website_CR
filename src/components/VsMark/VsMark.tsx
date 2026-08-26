import styles from './VsMark.module.css';

/** Both written by scripts/build-logo.py — never hand-edited. */
const LOGO_DARK = `${import.meta.env.BASE_URL}assets/brand/logo-dark.png`;
const LOGO_LIGHT = `${import.meta.env.BASE_URL}assets/brand/logo-light.png`;

/**
 * The Deckkies mark, standing between two decks.
 *
 * WHY THE LOGO AND NOT THE LETTERS. "VS" is a label; the mark is the product
 * saying whose comparison this is, in the one place on the screen that is
 * about two players meeting. The word is still there underneath, small,
 * because a logo does not say "versus" on its own.
 *
 * WHY BOTH VARIANTS, AND NOT ONE. The first build shipped only the dark one,
 * on the reasoning that gold and off-white read on any surface. They do not:
 * on a light battle row the near-white D disappeared completely and the mark
 * was a floating crown. The letter needs the theme's own value, so both
 * variants ship and CSS picks — which is what `build-logo.py` emits them for.
 *
 * Done in CSS rather than from a theme hook so there is no first-paint flash
 * and no subscription; the browser has already resolved `data-theme` (or
 * `prefers-color-scheme`) by the time it paints either image.
 *
 * The brand tile in the topbar takes the other approach — one dark variant on
 * a dark tile — because a tile there is wanted anyway and matches the favicon.
 * Here a dark tile in the middle of a light row would be a hole.
 *
 * `data-bolt` is the whole contract with `LightningMarks`: that one fixed
 * canvas finds every element carrying it and draws lightning around its box.
 * There is no per-mark canvas and no prop to wire — a page with ten of these
 * still has one WebGL context.
 */
export function VsMark({
  size = 'md',
  word = true,
}: {
  size?: 'sm' | 'md' | 'lg';
  /** Off where the surrounding copy already says what the row is. */
  word?: boolean;
}) {
  return (
    <span className={styles.mark} data-size={size} data-bolt role="img" aria-label="versus">
      <img className={`${styles.logo} ${styles.logoLight}`} src={LOGO_LIGHT} alt="" draggable={false} />
      <img className={`${styles.logo} ${styles.logoDark}`} src={LOGO_DARK} alt="" draggable={false} />
      {word && (
        <span className={styles.word} aria-hidden="true">
          VS
        </span>
      )}
    </span>
  );
}
