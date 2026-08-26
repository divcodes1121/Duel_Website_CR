import { type FormEvent, useMemo, useState } from 'react';

import { Fireflies } from '../../three/Fireflies';
import { useAccountStore } from '../../state/accountStore';
import { countries, guessCountry } from './countries';
import loginStyles from '../Login/Login.module.css';
import styles from './Onboarding.module.css';

/**
 * The three questions asked once, after the first sign-in.
 *
 * SPLIT INTO STEPS RATHER THAN ONE FORM, and the reason is not decoration: this
 * screen stands between someone and the product they have just signed up for.
 * One field at a time, each answerable in a second, reads as a short
 * conversation; the same three stacked in a column reads as paperwork at
 * exactly the moment enthusiasm is highest.
 *
 * THE PLAYER TAG IS THE ONE THAT EARNS ITS PLACE. It is not a demographic
 * question — it is the key every analytics screen in this app is keyed by, so
 * asking for it here is the difference between a working home screen and an
 * empty one. It is still skippable, because a wrong tag is worse than none and
 * some people genuinely do not know theirs yet.
 */
export function Onboarding() {
  const profile = useAccountStore((s) => s.profile);
  const email = useAccountStore((s) => s.email);
  const saveProfile = useAccountStore((s) => s.saveProfile);

  const list = useMemo(() => countries(), []);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [country, setCountry] = useState(profile?.country ?? guessCountry());
  const [tag, setTag] = useState(profile?.player_tag ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const STEPS = ['Your name', 'Where you play', 'Your player tag'];

  function next() {
    setError(null);
    if (step === 0 && !name.trim()) return setError('Pick something to be called.');
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  async function finish(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    /* The tag is normalised here rather than trusted: Supercell writes it with
       a leading # and people paste it both ways, and O/0 confusion is endemic.
       Storing one shape means every screen that reads it gets one shape. */
    const clean = tag.trim().toUpperCase().replace(/^#+/, '').replace(/[^0-9A-Z]/g, '');
    const err = await saveProfile({
      display_name: name.trim(),
      country: country || null,
      player_tag: clean ? `#${clean}` : null,
      /* Stamped whether they filled it in or skipped — the point is that they
         were asked, so we do not ask again on every visit. */
      onboarded_at: new Date().toISOString(),
    });
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div className={loginStyles.page}>
      <Fireflies />

      <div className={loginStyles.scene}>
        <div className={`${loginStyles.card} ${loginStyles.cardEnter} ${styles.card}`}>
          <span className={loginStyles.cardBorder} aria-hidden="true" />

          <p className={styles.eyebrow}>{email}</p>
          <h1 className={loginStyles.title}>{STEPS[step]}</h1>

          <ol className={styles.pips} aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={styles.pip}
                data-state={i < step ? 'done' : i === step ? 'now' : undefined}
              />
            ))}
          </ol>

          <form className={loginStyles.form} onSubmit={step === 2 ? finish : (e) => { e.preventDefault(); next(); }}>
            {step === 0 && (
              <label className={loginStyles.field}>
                <span className={loginStyles.fieldLabel}>Display name</span>
                <input
                  className={loginStyles.input}
                  value={name}
                  autoFocus
                  maxLength={40}
                  placeholder="What should we call you?"
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                />
              </label>
            )}

            {step === 1 && (
              <label className={loginStyles.field}>
                <span className={loginStyles.fieldLabel}>Country</span>
                {/* A native select, not a custom listbox. 200 options with
                    type-ahead is a thing the platform already does better than
                    anything hand-rolled, on every device, including with a
                    screen reader. */}
                <select
                  className={`${loginStyles.input} ${styles.select}`}
                  value={country}
                  autoFocus
                  onChange={(e) => setCountry(e.target.value)}
                >
                  <option value="">Prefer not to say</option>
                  {list.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {step === 2 && (
              <label className={loginStyles.field}>
                <span className={loginStyles.fieldLabel}>Clash Royale player tag</span>
                <input
                  className={loginStyles.input}
                  value={tag}
                  autoFocus
                  spellCheck={false}
                  placeholder="#9GJ0Q0LGG"
                  onChange={(e) => {
                    setTag(e.target.value);
                    setError(null);
                  }}
                />
                <span className={styles.help}>
                  In game: Profile → under your name. This is what every stats
                  screen is keyed by — you can add it later in your profile.
                </span>
              </label>
            )}

            {error && <p className={loginStyles.error}>{error}</p>}

            <div className={styles.row}>
              {step > 0 && (
                <button
                  type="button"
                  className={styles.back}
                  onClick={() => {
                    setError(null);
                    setStep((s) => s - 1);
                  }}
                >
                  Back
                </button>
              )}
              <button type="submit" className={loginStyles.submit} disabled={busy}>
                {busy ? 'Saving…' : step === 2 ? 'Enter the arena' : 'Continue'}
              </button>
            </div>

            {step === 2 && (
              <button type="button" className={styles.skip} onClick={() => void finish()}>
                Skip for now
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
