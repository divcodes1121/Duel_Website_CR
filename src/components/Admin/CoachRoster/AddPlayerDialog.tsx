import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';

import { NAME_MAX, NOTES_MAX, RosterError, normalizeTag } from '../../../state/coachRoster';
import { useCoachRoster } from '../../../state/coachRosterStore';
import { fetchTracking } from '../../../state/analyticsClient';
import styles from './CoachRoster.module.css';

/**
 * Add a player to the roster.
 *
 * THE TAG IS THE IDENTITY; the name is the coach's. A display name is optional
 * and is only a label — nothing resolves a player by it (this project deleted
 * search-by-name on purpose).
 *
 * ADDING ALSO STARTS COLLECTION. After the row is saved, the tag is handed to
 * the existing tracking queue (`/api/analytics/track/<tag>`), the same one a
 * player search enrols through — so a new roster player begins accruing
 * stored battles without a second enrolment path. That call is best effort:
 * the roster entry is what was asked for, and it stands whether or not the
 * queue answers.
 *
 * Portalled to <body>, like every dialog here: a `backdrop-filter` ancestor
 * would otherwise trap it.
 */
export function AddPlayerDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (tag: string) => void;
}) {
  const add = useCoachRoster((s) => s.add);
  const [tag, setTag] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tagRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    tagRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* Said as the tag is typed, so a wrong character is caught at the key
     rather than at Submit. Empty is not an error yet. */
  const normalised = tag.trim() ? normalizeTag(tag) : null;
  const tagHint = !tag.trim()
    ? 'The tag on the player’s profile, with or without the #.'
    : normalised
      ? `Will be added as ${normalised}`
      : 'Not a valid tag yet — # plus 5 to 12 of 0 2 8 9 P Y L Q G R J C U V.';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const row = await add({ playerTag: tag, displayName: name, notes });
      // Best effort — see the header.
      void fetchTracking(row.playerTag).catch(() => undefined);
      onAdded(row.playerTag);
    } catch (err) {
      setError(err instanceof RosterError ? err.message : 'Could not add that player.');
      setBusy(false);
    }
  }

  return createPortal(
    <div className={styles.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className={styles.dialog} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="add-player-title">
        <h2 id="add-player-title" className={styles.dialogTitle}>
          Add a player to Coach Roster
        </h2>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Player tag</span>
          <input
            ref={tagRef}
            className={styles.input}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="#XXXXXXXX"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={Boolean(tag.trim()) && !normalised}
          />
          <span className={styles.hint} data-bad={Boolean(tag.trim()) && !normalised ? '' : undefined}>
            {tagHint}
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Display name (optional)</span>
          <input
            className={styles.input}
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="What you call them"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Coach notes (optional)</span>
          <textarea
            className={styles.textarea}
            value={notes}
            maxLength={NOTES_MAX}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </label>

        {error && <p className={styles.formError}>{error}</p>}

        <div className={styles.dialogActions}>
          <button type="button" className={styles.ghostButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryButton} disabled={busy || !normalised}>
            {busy ? 'Adding…' : 'Add player'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
