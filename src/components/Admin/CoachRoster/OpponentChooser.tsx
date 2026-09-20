import { useState, type FormEvent } from 'react';

import type { CoachIntel } from '../../../state/analyticsClient';
import { coachHref, normalizeTag, playerLabel, type CoachSection, type RosterPlayer } from '../../../state/coachRoster';
import { scoutCandidates } from '../../../state/coachScout';
import styles from './CoachRoster.module.css';

/**
 * Pick the opponent a section is about: type a tag, or take one of the people
 * this player keeps meeting.
 *
 * SHARED BY THE SCOUT AND BY WHAT-TO-PLAY, which ask the same question of the
 * same evidence. Two copies would drift — and the first thing to drift would
 * be the wording of whose wins the rows are counting, which is the one thing
 * on it that must not be ambiguous.
 *
 * `section` is where a choice lands, so the same control feeds either screen.
 */
export function OpponentChooser({
  player,
  playerIntel,
  section,
  windowLabel,
  title,
  blurb,
}: {
  player: RosterPlayer;
  playerIntel: CoachIntel | null;
  section: CoachSection;
  windowLabel: string;
  title: string;
  blurb: string;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const candidates = scoutCandidates(playerIntel);

  function submit(e: FormEvent) {
    e.preventDefault();
    const tag = normalizeTag(draft);
    if (!tag) {
      setError('That is not a Clash Royale player tag — # followed by 5 to 12 of 0 2 8 9 P Y L Q G R J C U V.');
      return;
    }
    setError(null);
    setDraft('');
    window.location.hash = coachHref(player.playerTag, section, tag);
  }

  return (
    <div className={styles.arsenal}>
      <section className={styles.block}>
        <h3 className={styles.blockTitle}>{title}</h3>
        <p className={styles.muted}>{blurb}</p>
        <form className={styles.scoutForm} onSubmit={submit}>
          <input
            className={styles.input}
            value={draft}
            placeholder="#XXXXXXXX"
            aria-label="Opponent player tag"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className={styles.primaryButton} disabled={!draft.trim()}>
            Go
          </button>
        </form>
        {error && <p className={styles.formError}>{error}</p>}
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>Who {playerLabel(player)} keeps meeting</h3>
          <span className={styles.muted}>{windowLabel}, opponents met more than once</span>
        </div>
        {candidates.length === 0 ? (
          <p className={styles.muted}>
            {playerIntel
              ? 'Nobody in this window has been met twice. Widen the window, or enter a tag directly.'
              : 'Their battles have not been read yet, so there is nobody to suggest. Enter a tag directly.'}
          </p>
        ) : (
          <ul className={styles.metList}>
            {candidates.map((o) => (
              <li key={o.tag}>
                <a className={styles.metRow} href={coachHref(player.playerTag, section, o.tag)}>
                  <span className={styles.metName}>
                    {o.name || o.tag}
                    {o.name && <span className={styles.oppTag}>{o.tag}</span>}
                  </span>
                  {/* Whose wins these are, said on every row. */}
                  <span className={styles.muted}>
                    {o.battles} meeting{o.battles === 1 ? '' : 's'} · {playerLabel(player)} {o.wins}W {o.losses}L
                    {o.draws ? ` ${o.draws}D` : ''}
                  </span>
                  <span className={styles.rowLink}>Open →</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
