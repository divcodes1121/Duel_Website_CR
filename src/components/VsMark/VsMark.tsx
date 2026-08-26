import styles from './VsMark.module.css';

/**
 * The VS between two decks, with lightning crawling the letters.
 *
 * IT WAS THE BRAND LOGO FOR ONE BUILD, AND THAT WAS THE WRONG OBJECT. The
 * space between two decks is where a reader looks to find out what happened
 * between them; a logo there says whose site it is. The word says what the row
 * means, so the word is what stands there and what the lightning traces.
 *
 * The letters are real text, not something the shader draws: they stay crisp
 * at any size, they take the theme's own ink, and they are still there when
 * WebGL is refused or `prefers-reduced-motion` is set — which is the whole
 * reason the effect can be decoration rather than content.
 *
 * `data-bolt` is the entire contract with `LightningMarks`: that one fixed
 * canvas finds every element carrying it and draws around its box. There is no
 * per-mark canvas and no prop to wire — a page with ten of these still has one
 * WebGL context.
 */
export function VsMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={styles.mark} data-size={size} data-bolt role="img" aria-label="versus">
      <span className={styles.word} aria-hidden="true">
        VS
      </span>
    </span>
  );
}
