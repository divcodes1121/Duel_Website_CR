import { forwardRef, useState } from 'react';

import styles from './PasswordInput.module.css';

/** Open eye / struck-through eye. 24x24 on a 1.7 stroke, matching the nav and
 *  menu glyphs so it sits level with the rest of the interface's line icons. */
function EyeIcon({ shown }: { shown: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.9" />
      {/* THE SLASH MEANS "HIDDEN", WHICH IS THE CURRENT STATE, not the action.
          Both readings exist in the wild and they are opposites, so the button
          also carries a real `aria-label` that says what pressing it DOES —
          the icon alone cannot disambiguate itself. */}
      {!shown && <path d="M4 20 20 4" />}
    </svg>
  );
}

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** The host's own input class — `Login.module.css` or the dialog's. */
  className?: string;
};

/**
 * A password field with a reveal toggle.
 *
 * ONE COMPONENT FOR ALL SIX FIELDS — sign-in's one, the reset screen's two and
 * the change dialog's three — because the alternative is what this codebase
 * keeps re-learning: six copies of a control become six slightly different
 * controls, and here they would differ in the one place it matters, which is
 * whether the icon means "hidden" or "press to hide".
 *
 * THE INPUT'S LOOK STILL BELONGS TO THE HOST. The two screens are styled by
 * different sheets — `Login.module.css` on the card, `ChangePassword.module.css`
 * in the dialog — so the class comes in as a prop and this file adds only the
 * right-hand padding that stops the text running under the button. Composing
 * both on one element is what keeps the field identical to its neighbours while
 * the eye is identical everywhere.
 *
 * WHY REVEALING IS WORTH HAVING AT ALL: a masked field is the reason people pick
 * shorter, simpler passwords and the reason they mistype the confirmation box.
 * The strength meter beside it encourages a long passphrase, and a long
 * passphrase typed blind is a long passphrase typed wrong.
 *
 * PER FIELD, NOT ONE SWITCH FOR THE FORM. A single toggle revealing all three
 * boxes in the change dialog would expose the current password while somebody
 * is only checking they typed the new one correctly — more on screen than was
 * asked for, in the one dialog most likely to be open in a shared room.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { className = '', ...rest },
  ref,
) {
  const [shown, setShown] = useState(false);

  return (
    <span className={styles.wrap}>
      <input
        {...rest}
        ref={ref}
        /* The whole mechanism. `autoComplete` is passed through untouched by the
           spread, so a password manager still recognises the field in either
           state. */
        type={shown ? 'text' : 'password'}
        className={`${className} ${styles.input}`}
      />
      <button
        type="button"
        className={styles.eye}
        /* SAYS WHAT THE PRESS DOES, which is the half the icon cannot carry.
           `aria-pressed` is deliberately not used: this is not a toggle button
           reporting a sticky state to a screen reader, it is a control whose
           label changes, and announcing both would read as contradictory. */
        aria-label={shown ? 'Hide password' : 'Show password'}
        title={shown ? 'Hide password' : 'Show password'}
        /* KEEPS THE CARET WHERE IT WAS. Without this the mousedown moves focus
           to the button, so the field loses its cursor position and a reader
           mid-word has to click back into place to carry on typing. */
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShown((s) => !s)}
      >
        <EyeIcon shown={shown} />
      </button>
    </span>
  );
});
