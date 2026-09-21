import type { TeamThreat } from '../../../state/analyticsClient';
import styles from './Threats.module.css';

/** What each kind of projected threat is, said once, where it is drawn. */
export const THREAT_LABEL: Record<string, string> = {
  OBSERVED: 'Seen playing',
  VARIANT: 'Close variant',
  INFERRED: 'Plausible',
};

/**
 * WHAT THEY ARE LIKELY TO BRING — the projection, beside the history.
 *
 * TWO SCREENS DRAW THIS, which is why it is its own file: Team Analysis' folders
 * and the Coach Roster's What-to-play tab. Both rank decks against the same
 * projection from `server/team_scout.py`, and both owe the reader a statement
 * of what the ranking was made against. It is Coach Assist's pairing — "what
 * they will bring" beside "what to play" — and a screen with only the second
 * half is a ranking with its reasoning hidden.
 *
 * The decks a player was actually observed playing are a different, smaller
 * thing, drawn elsewhere. This is the threat space the recommendations were
 * scored against: their decks, real variants of those decks, and the
 * archetypes their behaviour implies.
 *
 * THE KINDS ARE LABELLED, and that is the whole honesty of it. A generated
 * deck shown as observed would be a claim that somebody watched them play it.
 */
export function Threats({
  threats,
  title = 'Likely to bring',
}: {
  threats: TeamThreat[];
  title?: string;
}) {
  if (!threats.length) return null;
  /* SHARE, NAME, KIND — and nothing else. The row used to carry a reason line
     ("6 of 8 cards shared with … — never seen from them"), a confidence word
     and a churn note in the heading; the account holder asked for the
     explanatory text to go (2026-09-21). The kind badge is what keeps a
     generated deck from reading as an observed one, so it stays. */
  return (
    <div className={styles.threats}>
      <h5 className={styles.threatsTitle}>{title}</h5>
      <ul className={styles.threatList}>
        {threats.map((t) => (
          <li key={t.key} className={styles.threatRow} data-evidence={t.evidence}>
            {/* NEVER "0%" FOR SOMETHING THAT IS ON THE LIST. A sub-1% share
                rounded to zero reads as a deck they will not bring rather than
                a small one. */}
            <span className={styles.threatLike}>
              {t.likelihood > 0 && t.likelihood < 0.005 ? '<1%' : `${(100 * t.likelihood).toFixed(0)}%`}
            </span>
            <span className={styles.threatName}>
              {t.name || t.archetype}
              <em className={styles.threatKind} data-evidence={t.evidence}>
                {THREAT_LABEL[t.evidence] ?? t.evidence}
              </em>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
