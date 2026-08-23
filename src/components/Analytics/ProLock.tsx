import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ProContact } from './ProContact';
import styles from './ProLock.module.css';

function LockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </svg>
  );
}

function CrownIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
    </svg>
  );
}

interface ProLockProps {
  /** What is behind the glass. Rendered, blurred, and made unreachable. */
  children: ReactNode;
  title: string;
  blurb: string;
  /** Shown as a short list under the blurb — what the subscription buys. */
  perks?: string[];
  /** `panel` fills a screen; `inline` sits inside one, under unlocked rows. */
  variant?: 'panel' | 'inline';
  /**
   * The gated area's identity hue, so the gate wears the colour of the thing it
   * is gating. The badge and the lock were violet while the CTA was the action
   * maroon, which made one card carry two unrelated colours and matched neither
   * the block you pressed to get here nor the area behind the glass.
   */
  hue?: 'violet' | 'blue' | 'pink' | 'green';
}

/**
 * A Royal Pro gate: the real thing, behind glass.
 *
 * **This is the one place blur comes back.** The app dropped frosted panels
 * everywhere else because a translucent pane refracted whatever scrolled behind
 * it and cost a compositing pass for decoration. Here the blur is not
 * decoration — it IS the message. A locked feature drawn as an empty box says
 * "nothing here"; the same feature drawn as its own real content, out of focus,
 * says "this exists and you cannot read it yet", which is the only honest way to
 * sell something.
 *
 * The preview is rendered from real markup rather than a screenshot so it
 * follows the theme, and it is made genuinely unreachable rather than merely
 * hard to read: `inert` takes it out of the tab order, out of the accessibility
 * tree and out of hit-testing in one property. Blur alone would leave a
 * keyboard user tabbing through controls they cannot see, and `pointer-events:
 * none` alone would leave a screen reader reading content the page is
 * pretending to withhold.
 */
export function ProLock({
  children,
  title,
  blurb,
  perks,
  variant = 'panel',
  hue = 'violet',
}: ProLockProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [contact, setContact] = useState(false);

  // `inert` is a DOM property React 18 does not type on host elements, so it is
  // set here rather than in JSX. Nothing else reproduces what it does.
  useEffect(() => {
    const el = previewRef.current;
    if (el) el.inert = true;
  }, []);

  return (
    <div className={`${styles.lock} ${variant === 'inline' ? styles.lockInline : ''}`}>
      <div ref={previewRef} className={styles.preview} aria-hidden="true">
        {children}
      </div>

      <div className={styles.veil}>
        <div className={styles.card} data-hue={hue}>
          <span className={styles.badge}>
            <CrownIcon />
            Royal Pro
          </span>
          <span className={styles.mark}>
            <LockIcon size={22} />
          </span>
          <h3 className={styles.title}>{title}</h3>
          <p className={styles.blurb}>{blurb}</p>
          {perks && perks.length > 0 && (
            <ul className={styles.perks}>
              {perks.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <button type="button" className={styles.cta} onClick={() => setContact(true)}>
            Subscribe to Royal Pro
          </button>
          <p className={styles.note}>Set up by hand — press it and I will tell you how to reach me.</p>
        </div>
      </div>

      {contact && <ProContact onClose={() => setContact(false)} />}
    </div>
  );
}
