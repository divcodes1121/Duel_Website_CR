import type { ReactNode } from 'react';
import { UplinkLoader } from './UplinkLoader';
import type { FireflyHue } from '../../three/Fireflies';
import styles from './ReadingState.module.css';

interface ReadingStateProps {
  /** The section's identity hue, so the wait wears the screen's own colour. */
  hue?: FireflyHue;
  /**
   * Which screen this is, for `state/loadTiming.ts`.
   *
   * Loads are measured and remembered PER KEY, so the bar on Coach Assist is
   * paced against how long the Coach actually takes on this machine rather than
   * against some shared average that would be wrong for every screen at once.
   * Two reads on one screen that differ in cost get their own keys — the
   * Coach's history read and its matchup scoring are not the same wait.
   */
  k: string;
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
 * ── WHAT REPLACED WHAT ────────────────────────────────────────────────────
 *
 * This used to render `three/ReadingDeck` — eight card plates riffling in a
 * WebGL fan. That is gone, and the file with it. The fan was a sign of LIFE: it
 * proved the tab had not hung, which against a 30-160 s read was the whole
 * complaint it was built to answer. What it could never say is the thing a
 * reader actually wants to know at second forty, which is *how much longer*.
 *
 * `UplinkLoader` answers that, and answers it from measurements rather than
 * from a scripted timeline — elapsed time against how long THIS screen took the
 * last few times, recorded on this browser. See the header of `UplinkLoader` for
 * why that is the only honest input available, and `state/loadTiming.ts` for the
 * store behind it.
 *
 * Two consequences worth knowing:
 *
 *   * **It is no longer WebGL**, so it spends none of the ~16 contexts a
 *     document is allowed and does not pull the three.js chunk. A screen that
 *     is only loading now downloads nothing extra at all.
 *   * **It renders under reduced motion**, where the fan did not. The fan was
 *     decoration and hiding it lost nothing; a progress readout is information,
 *     and a reader who does not want animation still wants the number.
 *
 * ── IT PAINTS NOTHING, AND IT USED TO TAKE THE CALLER'S PANEL ────────────
 *
 * There was a `className` prop, and every call site handed over its own
 * `.notice` / `.empty` / `.loading` — glass or pane surfaces with a border and
 * a fill. The idea was that this component changed what was INSIDE the box and
 * never the box, so no screen's layout moved.
 *
 * What that produced was a grey card holding another card: the rig sat in a
 * painted panel, in the middle of an otherwise empty screen, with the app-wide
 * fireflies stopped dead at its edge. The prop is gone. A loading state now
 * paints NO surface of its own and sits directly on the page, so the backdrop
 * runs behind it unbroken — which is the whole reason those three surface
 * tokens were made translucent in the first place.
 *
 * The copy's own colour and size moved here with it, since they used to be
 * inherited from the notice class that is no longer applied.
 *
 * ALWAYS A `div`, never a `p`: four of the call sites were paragraphs, and a
 * `<p>` may not contain a block child. The browser closes it early and the
 * loader ends up as a SIBLING of the box it was supposed to sit in.
 */
export function ReadingState({ hue, k, children }: ReadingStateProps) {
  return (
    <div className={styles.wrap} data-reading>
      <div className={styles.inner}>
        {/* An inline-block stage, so it inherits the caller's `text-align`:
            seven of the twelve centre their notice and three are left-aligned
            blocks in a results flow, where a centred rig over left-aligned copy
            read as a misalignment. */}
        <div className={styles.stage}>
          <UplinkLoader hue={hue} timingKey={k} />
        </div>
        {/* A `div`, not a `p`: the meta board passes an `<h2>` and two
            paragraphs, and a `<p>` may not contain them — the browser closes it
            early and the copy escapes the box. */}
        <div className={styles.label}>{children}</div>
      </div>
    </div>
  );
}
