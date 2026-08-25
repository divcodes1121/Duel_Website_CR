import type { ReactNode } from 'react';
import { ReadingDeck } from '../../three/ReadingDeck';
import type { FireflyHue } from '../../three/Fireflies';
import styles from './ReadingState.module.css';

interface ReadingStateProps {
  /**
   * The calling screen's own notice class, applied unchanged.
   *
   * Every analytics module has a `.notice` and no two are the same — some
   * `compose` a pane, some a glass panel, the paddings differ, and MetaDecks
   * centres itself with `margin: auto`. Passing it through means this component
   * changes what is INSIDE the box and never the box, so eleven call sites keep
   * the layout they already had.
   */
  className?: string;
  /** The section's identity hue, so the wait wears the screen's own colour. */
  hue?: FireflyHue;
  /**
   * The existing loading copy. Stays mounted — it IS the fallback.
   *
   * Usually one sentence, but the meta board's cold start is a heading plus two
   * paragraphs plus an elapsed-seconds line, so this has to take a block and
   * not just a string.
   */
  children: ReactNode;
}

/**
 * The shared loading state for a slow read.
 *
 * The layout lives on an inner element rather than being merged into the
 * caller's class. Two CSS-module classes on one node have equal specificity, so
 * which of them wins comes down to the order the bundler happens to emit their
 * stylesheets in — fine until it silently is not. An inner wrapper cannot
 * collide with anything.
 *
 * ALWAYS A `div`, never a `p`: four of the call sites were paragraphs, and a
 * `<p>` may not contain a block child. The browser closes it early and the
 * canvas ends up as a SIBLING of the box it was supposed to sit in.
 */
export function ReadingState({ className, hue, children }: ReadingStateProps) {
  return (
    <div className={className}>
      <div className={styles.inner}>
        {/* Sized by the stage, not by the canvas: the canvas is absolutely
            positioned inside it, so a WebGL context that never arrives — no
            GPU, reduced motion, the 16-context ceiling — collapses to nothing
            and leaves the sentence sitting exactly where it does today. */}
        <div className={styles.stage}>
          <ReadingDeck hue={hue} />
        </div>
        {/* A `div`, not a `p`: the meta board passes an `<h2>` and two
            paragraphs, and a `<p>` may not contain them — the browser closes it
            early and the copy escapes the box. */}
        <div className={styles.label}>{children}</div>
      </div>
    </div>
  );
}
