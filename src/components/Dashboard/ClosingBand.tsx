import { useReveal } from '../../hooks/useReveal';
import styles from './ClosingBand.module.css';

/* The foot of the landing screen: a placeholder, and nothing else.
 *
 * IT HAS BEEN FIVE THINGS, which is worth recording because four of them were
 * tried and rejected and the reasons do not overlap:
 *
 *   1. Three claims about this site — "read-only", "measured, or blank",
 *      "every card". A trust badge, and a trust badge is the least interesting
 *      thing you can put at the bottom of a page about Clash Royale. It read
 *      like a compliance notice.
 *   2. Ten computed card facts, three shuffled per visit, plus a histogram of
 *      every card by elixir. Accurate — every figure was COUNTED FROM `CARDS`
 *      AT RENDER TIME, so none of it could go stale and there was no invented
 *      number anywhere on the page. That rule still stands for anything that
 *      returns here. What did for it was position: a reader who has scrolled
 *      past the hero, seven analytics blocks and four tool panels has finished
 *      reading, and a second dense block of statistics asks them to start
 *      again.
 *   3. A painted landscape with the `WaterBand` simulation running over it.
 *   4. The same painting with COMING SOON set into it.
 *   5. This: the words alone on the page's own ground.
 *
 * WHY THE PICTURE CAME BACK OUT. Four painted banners already sit directly
 * above this, and a fifth full-bleed painting at the foot of the same column
 * stops being a finale and becomes one more of them — the page ends by
 * repeating itself. Bare, it reads as what it is: a space that is not filled
 * yet. A placeholder should look like a placeholder.
 *
 * `src/three/WaterBand.tsx` IS NOW UNREFERENCED. Left in the tree rather than
 * deleted because it is a working piece of the `src/three/` set and the next
 * band may want it; nothing ships for it either way, since it was only ever
 * reached through the dynamic import that used to be here.
 */

export function ClosingBand() {
  const reveal = useReveal<HTMLDivElement>();

  return (
    <div className={styles.band} ref={reveal}>
      <section className={styles.card}>
        <p className={styles.soon}>Coming soon...</p>
      </section>
    </div>
  );
}
