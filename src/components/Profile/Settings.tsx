import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useAccountStore } from '../../state/accountStore';
import { countries } from '../Auth/countries';
import { normalizeTag } from '../../utils/squadParse';
import { Dropdown } from '../ui/dropdown-menu-14';
import { GlobeIcon } from '../Dashboard/icons';
import styles from './Settings.module.css';

/** What the profile row will actually accept. 001 grants `update` on exactly
 *  five columns and this dialog writes three of them; `role`, `trial_ends_at`
 *  and `is_coach` are not writable over REST at all, so nothing here could
 *  reach them even by mistake. */
const NAME_MAX = 40;

/**
 * ACCOUNT SETTINGS — name, country, player tag.
 *
 * Until this existed the three were asked for ONCE, during onboarding, and
 * then never again: a typo in a player tag was permanent, and the tag is the
 * one field the whole analytics half of the site keys off. Onboarding is also
 * skippable, so an account could simply never have one.
 *
 * IT WRITES THROUGH `saveProfile`, the same store action onboarding uses, so
 * the two doors cannot start disagreeing about what is stored or how a tag is
 * shaped.
 *
 * ── THE TAG IS CHECKED BEFORE IT IS SENT, AND THE MESSAGE NAMES THE RULE ──
 *
 * A Clash Royale tag is `#` plus 5–12 characters from a FOURTEEN-symbol
 * alphabet (0 2 8 9 P Y L Q G R J C U V) — no I, no O, no 1. Those exclusions
 * are exactly the confusable pairs, so the commonest mistake is typing the
 * letter O for a zero and getting a tag that looks right and matches nothing.
 * `normalizeTag` is the same function the roster, the squad parser and the
 * database CHECK all apply, so a tag this dialog accepts is one every other
 * part of the site will too.
 *
 * The error says which characters are legal rather than "invalid tag": the
 * whole difficulty is that the typed thing LOOKS like a tag.
 *
 * Portalled to `document.body`, the project's usual reason: the panels carry
 * `backdrop-filter`, and each of those creates a stacking context that traps a
 * dialog rendered inside it however high its z-index.
 */
export function Settings({ onClose }: { onClose: () => void }) {
  const profile = useAccountStore((s) => s.profile);
  const email = useAccountStore((s) => s.email);
  const saveProfile = useAccountStore((s) => s.saveProfile);

  const list = useMemo(() => countries(), []);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [country, setCountry] = useState(profile?.country ?? '');
  const [tag, setTag] = useState(profile?.player_tag ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* Checked as they type so the state of the field is visible before they
     commit, but it does not BLOCK until submit — validating an incomplete tag
     on the second keystroke shouts at somebody who is still typing. */
  const typed = tag.trim();
  const cleaned = typed ? normalizeTag(typed) : null;
  const tagProblem = typed && !cleaned;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!name.trim()) {
      setError('Pick something to be called.');
      return;
    }
    if (name.trim().length > NAME_MAX) {
      setError(`A name can be at most ${NAME_MAX} characters.`);
      return;
    }
    if (typed && !cleaned) {
      setError(
        'That is not a Clash Royale player tag. It is # followed by 5 to 12 of ' +
          '0 2 8 9 P Y L Q G R J C U V — there is no I, no O and no 1, so a letter O is ' +
          'almost always meant to be a zero.',
      );
      return;
    }

    setBusy(true);
    const err = await saveProfile({
      display_name: name.trim(),
      country: country || null,
      /* CLEARING IT IS ALLOWED and is not the same as leaving it alone: an
         empty field writes null, which is what "I do not want my tag here"
         has to mean. */
      player_tag: cleaned,
      /* PASSED EXPLICITLY. `saveProfile` always writes this key, and while
         supabase-js would drop an `undefined` on its way through JSON, the
         column's meaning is too important to rest on that: it is what stops
         onboarding asking again on every visit. Somebody who skipped the form
         and filled this dialog in HAS now been asked and answered, so an
         absent stamp becomes one. */
      onboarded_at: profile?.onboarded_at ?? new Date().toISOString(),
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setSaved(true);
    window.setTimeout(onClose, 700);
  }

  return createPortal(
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="settings-h">
        <header className={styles.head}>
          <h2 className={styles.title} id="settings-h">
            Account settings
          </h2>
          {email && <p className={styles.sub}>{email}</p>}
        </header>

        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            <span className={styles.label}>Display name</span>
            <input
              ref={first}
              className={styles.input}
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="What to call you"
            />
            <span className={styles.hint}>{name.trim().length}/{NAME_MAX}</span>
          </label>

          <div className={styles.field}>
            <span className={styles.label}>Country</span>
            <Dropdown
              className={styles.dropdown}
              caption="Country"
              icon={<GlobeIcon />}
              heading="Country"
              subheading="Optional — type to find yours"
              searchable
              value={country}
              onChange={setCountry}
              options={[
                { value: '', label: 'Prefer not to say', icon: '—' },
                ...list.map((c) => ({ value: c.code, label: c.name, icon: c.code })),
              ]}
            />
            <span className={styles.hint}>Shown on your profile. Optional.</span>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Player tag</span>
            <input
              className={styles.input}
              data-bad={tagProblem || undefined}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="#2PYLQ0"
              spellCheck={false}
              autoCapitalize="characters"
            />
            {tagProblem ? (
              <span className={styles.bad}>
                Not a valid tag. It is # then 5–12 of <b>0 2 8 9 P Y L Q G R J C U V</b> — no I, no O,
                no 1. A letter O is almost always meant to be a zero.
              </span>
            ) : cleaned && cleaned !== profile?.player_tag ? (
              <span className={styles.ok}>Will be saved as {cleaned}</span>
            ) : (
              <span className={styles.hint}>
                Found in the game under your name. Leave it empty to remove it.
              </span>
            )}
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.row}>
            <button type="submit" className={styles.primary} disabled={busy || saved}>
              {saved ? 'Saved' : busy ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
