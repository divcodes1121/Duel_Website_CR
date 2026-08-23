import type { ComponentType, ReactNode } from 'react';
import styles from './PasteIntro.module.css';

interface PasteIntroProps {
  /** Identity colour — the section's own, from the sidebar. */
  hue: 'violet' | 'pink' | 'blue' | 'green';
  icon: ComponentType<{ size?: number }>;
  /** The section's name, small above the headline. */
  kicker: string;
  title: ReactNode;
  blurb: string;
  /** What the screen will actually give you, once it has a deck. */
  chips?: string[];
  /** The paste form. */
  children: ReactNode;
}

/**
 * The opening state of a screen that needs a deck before it can say anything.
 *
 * Both paste screens opened as a small left-aligned heading, a thin line of
 * grey copy and a full-width input pinned to the top corner — which reads as an
 * unfinished form rather than as an invitation, and left three quarters of the
 * panel empty below it. The one thing being asked for is a link, so the ask is
 * centred, the type is the display face, and the panel says what it will give
 * back before it is given anything.
 *
 * Shared because the two screens are the same shape — paste a deck, get an
 * answer — and two copies of that decision is how they would drift apart.
 */
export function PasteIntro({ hue, icon: Icon, kicker, title, blurb, chips, children }: PasteIntroProps) {
  return (
    <div className={styles.intro} data-hue={hue}>
      <span className={styles.mark} aria-hidden="true">
        <Icon size={26} />
      </span>

      <span className={styles.kicker}>{kicker}</span>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.blurb}>{blurb}</p>

      <div className={styles.form}>{children}</div>

      {chips && chips.length > 0 && (
        <ul className={styles.chips}>
          {chips.map((c) => (
            <li key={c} className={styles.chip}>
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The same identity, compact, for once a deck is actually loaded. */
export function PasteHeader({
  hue,
  icon: Icon,
  title,
  children,
}: {
  hue: PasteIntroProps['hue'];
  icon: ComponentType<{ size?: number }>;
  title: string;
  /** The paste form, now a row beside the heading rather than the whole page. */
  children: ReactNode;
}) {
  return (
    <header className={styles.header} data-hue={hue}>
      <span className={styles.headerMark} aria-hidden="true">
        <Icon size={17} />
      </span>
      <h1 className={styles.headerTitle}>{title}</h1>
      <div className={styles.headerForm}>{children}</div>
    </header>
  );
}
