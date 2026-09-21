import type { TeamChurn, TeamThreat } from '../../../state/analyticsClient';
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
 * THE KINDS ARE DRAWN AND LABELLED SEPARATELY, and that is the whole honesty of
 * it. A generated deck shown as observed would be a claim that somebody watched
 * them play it. Every row says which kind it is and how confident that is, and
 * a variant names the deck it came from.
 */
export function Threats({
  threats,
  churn,
  title = 'Likely to bring',
}: {
  threats: TeamThreat[];
  churn?: TeamChurn;
  title?: string;
}) {
  if (!threats.length) return null;
  return (
    <div className={styles.threats}>
      <h5 className={styles.threatsTitle}>
        {title}
        {churn && (
          <span
            className={styles.threatsNote}
            title={
              churn.evidence === 'thin'
                ? 'Too little play to measure how much they switch, so the projection is deliberately wider than their history.'
                : churn.evidence === 'none'
                  ? 'No play at all to measure. The projection is as wide as it gets.'
                  : 'Measured from how their own play is spread across decks.'
            }
          >
            {churn.evidence === 'measured'
              ? `${Math.round(100 * churn.switch)}% chance of something off-book`
              : 'little history — projection widened'}
          </span>
        )}
      </h5>
      <ul className={styles.threatList}>
        {threats.map((t) => (
          <li key={t.key} className={styles.threatRow} data-evidence={t.evidence}>
            {/* NEVER "0%" FOR SOMETHING THAT IS ON THE LIST. A sub-1% share
                rounded to zero, and "0% · Hog Rider · seen playing · 9 battles"
                reads as a deck they will not bring rather than a small one. */}
            <span className={styles.threatLike}>
              {t.likelihood > 0 && t.likelihood < 0.005 ? '<1%' : `${(100 * t.likelihood).toFixed(0)}%`}
            </span>
            <span className={styles.threatBody}>
              <span className={styles.threatName}>
                {t.name || t.archetype}
                <em className={styles.threatKind} data-evidence={t.evidence}>
                  {THREAT_LABEL[t.evidence] ?? t.evidence}
                </em>
              </span>
              {/* THE EVIDENCE, NEVER DRESSED UP. An observed deck quotes the
                  battles it was seen in; a variant names its parent and how
                  many cards it shares; an inferred entry says plainly that it
                  has never been seen. */}
              <span className={styles.threatWhy}>
                {t.evidence === 'OBSERVED'
                  ? `${t.observedCount} battle${t.observedCount === 1 ? '' : 's'} on record`
                  : t.evidence === 'VARIANT'
                    ? `${t.overlap ?? 0} of 8 cards shared with ${t.basisName || 'a deck they play'} — never seen from them`
                    : t.why === 'own_archetype'
                      ? 'An archetype they play, in a configuration not seen from them'
                      : 'Widely played, and nothing in their history rules it out'}
              </span>
            </span>
            <span className={styles.threatConf} data-conf={t.confidence}>
              {t.confidence}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
