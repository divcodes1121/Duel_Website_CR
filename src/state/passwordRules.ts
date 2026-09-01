/**
 * WHAT COUNTS AS AN ACCEPTABLE PASSWORD, and nothing else.
 *
 * NO IMPORTS, DELIBERATELY, and for the reason `tiers.ts` and `utils/format.ts`
 * are written the same way: these rules used to be an inline `password.length <
 * 8` inside `AuthScreen`, which meant the one part of the auth flow most worth
 * testing exhaustively could not be imported by a test at all — reaching it
 * dragged in a Supabase client that wants a native WebSocket.
 *
 * THE SERVER IS THE REAL BOUNDARY. Supabase enforces its own minimum length and
 * will reject a weak password whatever this file says; everything here decides
 * what to TELL somebody before the round trip, so the message names the actual
 * problem instead of echoing "Password should be at least 6 characters."
 * If the two ever disagree, the server wins and the user sees its message.
 */

/** Supabase's own default floor is 6. Eight is this project's, and it is the
 *  number `AuthScreen` has always used, so signing up is unchanged. */
export const MIN_PASSWORD = 8;

/** Above any plausible typing, and below Supabase's 72-byte bcrypt truncation.
 *  Past 72 bytes the tail is silently ignored, which would mean two different
 *  passwords both signing in — better to refuse than to quietly truncate. */
export const MAX_PASSWORD = 72;

export type PasswordProblem =
  | 'empty'
  | 'too-short'
  | 'too-long'
  | 'mismatch'
  | 'unchanged';

/**
 * Why this password cannot be set, or null when it can.
 *
 * `confirm` is optional so the sign-up field — which has no second box — can
 * use the same function as the two-box reset form. Passing `undefined` skips
 * the match check rather than failing it, which is what "there is no second
 * field" means.
 *
 * `current` is likewise optional: only the signed-in change form has one to
 * compare against, and re-setting the password you already have is a no-op
 * worth naming rather than a success worth reporting.
 */
export function passwordProblem(
  next: string,
  confirm?: string,
  current?: string,
): PasswordProblem | null {
  if (!next) return 'empty';
  /* BYTES, NOT CHARACTERS, because bcrypt's limit is bytes and an emoji is
     four of them. A 30-character password of astral-plane characters is over
     the line while looking well short of it. */
  if (next.length < MIN_PASSWORD) return 'too-short';
  if (new TextEncoder().encode(next).length > MAX_PASSWORD) return 'too-long';
  if (confirm !== undefined && next !== confirm) return 'mismatch';
  if (current !== undefined && current !== '' && next === current) return 'unchanged';
  return null;
}

/** The sentence to show for a problem. One place, so the reset screen and the
 *  account dialog cannot drift into saying different things about one rule. */
export function passwordMessage(problem: PasswordProblem): string {
  switch (problem) {
    case 'empty':
      return 'Enter a new password.';
    case 'too-short':
      return `Passwords need at least ${MIN_PASSWORD} characters.`;
    case 'too-long':
      return `Passwords cannot be longer than ${MAX_PASSWORD} bytes.`;
    case 'mismatch':
      return 'Those two passwords do not match.';
    case 'unchanged':
      return 'That is already your password.';
  }
}

/**
 * A rough strength read, for the meter next to the field.
 *
 * NOT A GATE, and deliberately not dressed as one. It scores length and
 * variety, both of which are weak proxies — "Password1!" scores well and is
 * terrible. It exists so a long passphrase is visibly rewarded over a short
 * mangled word, which is the one thing a meter can honestly encourage. Nothing
 * is refused on this number.
 */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < MIN_PASSWORD) return 0;
  let variety = 0;
  if (/[a-z]/.test(pw)) variety += 1;
  if (/[A-Z]/.test(pw)) variety += 1;
  if (/[0-9]/.test(pw)) variety += 1;
  if (/[^A-Za-z0-9]/.test(pw)) variety += 1;
  /* Length carries more weight than variety, because it is the property that
     actually costs an attacker anything. A 16-character all-lowercase
     passphrase is stronger than eight characters of leetspeak. */
  if (pw.length >= 16 || (pw.length >= 12 && variety >= 3)) return 3;
  if (pw.length >= 12 || variety >= 3) return 2;
  return 1;
}

export const STRENGTH_LABEL: Record<0 | 1 | 2 | 3, string> = {
  0: 'Too short',
  1: 'Weak',
  2: 'Good',
  3: 'Strong',
};
