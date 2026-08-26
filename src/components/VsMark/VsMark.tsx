import styles from './VsMark.module.css';

/**
 * The VS between two decks.
 *
 * It has been three things. The brand logo, which was the wrong object — the
 * space between two decks is where a reader looks to find out what happened
 * between them, and a logo there says whose site it is. Then the word with
 * lightning crawling the letters, which was the right object wearing a costume
 * nobody asked it to wear. Now it is the word, drawn large, and nothing else.
 *
 * `src/three/LightningMarks.tsx` is deleted rather than left switched off.
 * What is worth keeping from it is written down in docs/UI.md — four separate
 * ways a shader can run correctly and show nothing — and the code itself would
 * only be a thing to wonder about later.
 */
export function VsMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={styles.mark} data-size={size} role="img" aria-label="versus">
      <span aria-hidden="true">VS</span>
    </span>
  );
}
