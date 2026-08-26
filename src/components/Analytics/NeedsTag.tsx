import { type FormEvent, useState } from 'react';

import styles from './NeedsTag.module.css';

/**
 * "This area needs a player tag."
 *
 * WHY THIS EXISTS AT ALL. Three analytics areas — Duel Analysis, Duel Zone and
 * Coach Assist — describe ONE player's history, and the home route has no
 * player. Reached from the landing gallery they had nothing to draw, and what
 * they drew instead was the Royal Pro gate.
 *
 * That gate was unreachable by anyone it was written for. `sectionAllowed()`
 * sends an anonymous or free visitor to `GateCard` before this point, so the
 * only people who ever got as far as the Pro wall were the ones who already had
 * Pro: a trial, pro or admin account, pressing a block it had paid for, being
 * asked to subscribe. The missing thing was never entitlement. It was a tag.
 *
 * So this asks for the tag, and it is deliberately the SAME ask as the hero's
 * search field rather than a new idea — same placeholder, same chips, same
 * destination — because someone who has already typed a tag once on this page
 * should recognise what is being asked the second time.
 */

interface NeedsTagProps {
  /** The area's name, for the heading. */
  name: string;
  /** What this area does with a tag, in one line. */
  blurb: string;
  /** The route slug: `#/player/<tag>/<slug>`. */
  slug: string;
  /** The area's identity hue, so the prompt wears the colour you pressed. */
  hue?: 'violet' | 'blue' | 'pink' | 'green';
  /** Suggested tags, so the field is answerable without leaving to find one. */
  suggestions?: string[];
  /** What each area gives once a tag is loaded. Three at most; it is a hint. */
  perks?: string[];
}

export function NeedsTag({
  name,
  blurb,
  slug,
  hue = 'violet',
  suggestions = [],
  perks,
}: NeedsTagProps) {
  const [tag, setTag] = useState('');

  /* One place that builds the destination, so the form and the chips cannot
     disagree about where a tag goes. The trailing slash is dropped for the
     overview (slug '') — `#/player/<tag>/` and `#/player/<tag>` parse the same
     here, but only one of them is what every other link on the site writes. */
  const open = (t: string) => {
    const clean = t.trim();
    if (!clean) return;
    window.location.hash = slug
      ? `#/player/${encodeURIComponent(clean)}/${slug}`
      : `#/player/${encodeURIComponent(clean)}`;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    open(tag);
  };

  return (
    <section className={styles.wrap} data-hue={hue}>
      <div className={styles.card}>
        <span className={styles.kicker}>Needs a player tag</span>
        <h1 className={styles.title}>{name}</h1>
        <p className={styles.blurb}>{blurb}</p>

        <form className={styles.form} onSubmit={submit}>
          <input
            className={styles.input}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="Enter player tag..."
            spellCheck={false}
            aria-label={`Player tag for ${name}`}
          />
          <button type="submit" className={styles.go} disabled={!tag.trim()}>
            Open
          </button>
        </form>

        {suggestions.length > 0 && (
          <div className={styles.suggestions}>
            <span className={styles.suggestLabel}>Or try</span>
            {suggestions.map((t) => (
              <button key={t} type="button" className={styles.chip} onClick={() => open(t)}>
                {t}
              </button>
            ))}
          </div>
        )}

        {perks && perks.length > 0 && (
          <ul className={styles.perks}>
            {perks.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
