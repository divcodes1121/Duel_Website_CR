import { describe, expect, it } from 'vitest';

import {
  MAX_PASSWORD,
  MIN_PASSWORD,
  STRENGTH_LABEL,
  passwordMessage,
  passwordProblem,
  passwordStrength,
  type PasswordProblem,
} from '../src/state/passwordRules';

/**
 * The password rules, which are the whole of what the two new doors — the
 * recovery screen and the account dialog — decide for themselves. Everything
 * else about setting a password is Supabase's.
 *
 * This file can exist AT ALL because `passwordRules.ts` has no imports. The
 * rules used to be an inline `password.length < 8` inside `AuthScreen`, and
 * reaching that meant constructing a Supabase client, which wants a native
 * WebSocket that Node does not have. Same extraction and same reason as
 * `tiers.ts` and `utils/format.ts`.
 */

const OK = 'a-good-enough-password';

describe('passwordProblem — the floor', () => {
  it('refuses an empty password as empty, not as too short', () => {
    // Two different messages, because "you left it blank" and "make it longer"
    // are different instructions.
    expect(passwordProblem('')).toBe('empty');
  });

  it(`refuses anything under ${MIN_PASSWORD} characters`, () => {
    expect(passwordProblem('a'.repeat(MIN_PASSWORD - 1))).toBe('too-short');
  });

  it(`accepts exactly ${MIN_PASSWORD} characters`, () => {
    // The boundary is inclusive; an off-by-one here refuses a valid password.
    expect(passwordProblem('a'.repeat(MIN_PASSWORD))).toBeNull();
  });

  it('accepts a long passphrase', () => {
    expect(passwordProblem('correct horse battery staple')).toBeNull();
  });
});

describe('passwordProblem — the ceiling is BYTES, not characters', () => {
  it(`accepts exactly ${MAX_PASSWORD} bytes of ASCII`, () => {
    expect(passwordProblem('a'.repeat(MAX_PASSWORD))).toBeNull();
  });

  it(`refuses ${MAX_PASSWORD + 1} bytes of ASCII`, () => {
    expect(passwordProblem('a'.repeat(MAX_PASSWORD + 1))).toBe('too-long');
  });

  it('counts a multi-byte character as its byte length', () => {
    // THE POINT OF THE WHOLE RULE. bcrypt truncates at 72 BYTES, so a password
    // that looks well short of the limit can be over it — and past the cut the
    // tail is silently ignored, which would mean two different passwords both
    // signing in. 20 four-byte emoji is 80 bytes on a 20-character string.
    const emoji = '🔥'.repeat(20);
    expect(emoji.length).toBeLessThan(MAX_PASSWORD);
    expect(new TextEncoder().encode(emoji).length).toBeGreaterThan(MAX_PASSWORD);
    expect(passwordProblem(emoji)).toBe('too-long');
  });

  it('accepts multi-byte characters that fit', () => {
    expect(passwordProblem('🔥'.repeat(4))).toBeNull(); // 16 bytes, 4 chars
  });
});

describe('passwordProblem — the confirm field', () => {
  it('is skipped when there is no second field', () => {
    // `undefined` means "this form has one box" — sign-up. It must not be read
    // as an empty second box that fails to match.
    expect(passwordProblem(OK, undefined)).toBeNull();
  });

  it('catches a mismatch', () => {
    expect(passwordProblem(OK, `${OK}x`)).toBe('mismatch');
  });

  it('passes a match', () => {
    expect(passwordProblem(OK, OK)).toBeNull();
  });

  it('reports the length problem BEFORE the mismatch', () => {
    // Order matters for the message: telling someone their two short passwords
    // do not match sends them to fix the wrong thing.
    expect(passwordProblem('short', 'different')).toBe('too-short');
  });

  it('treats an empty confirm as a mismatch, not as empty', () => {
    expect(passwordProblem(OK, '')).toBe('mismatch');
  });
});

describe('passwordProblem — reusing the current password', () => {
  it('refuses a new password identical to the old one', () => {
    expect(passwordProblem(OK, OK, OK)).toBe('unchanged');
  });

  it('allows a genuinely new one', () => {
    expect(passwordProblem(OK, OK, 'something-else-entirely')).toBeNull();
  });

  it('is skipped when no current password is supplied', () => {
    // The recovery screen has no current-password field: the whole premise is
    // that the reader does not know it.
    expect(passwordProblem(OK, OK, undefined)).toBeNull();
  });

  it('is skipped when the current password is blank', () => {
    // An empty string is "not supplied", not "the old password was empty" —
    // otherwise the check would fire on a form the user has not filled in.
    expect(passwordProblem(OK, OK, '')).toBeNull();
  });

  it('reports the mismatch BEFORE the reuse', () => {
    expect(passwordProblem(OK, 'typo', OK)).toBe('mismatch');
  });
});

describe('passwordMessage', () => {
  const all: PasswordProblem[] = ['empty', 'too-short', 'too-long', 'mismatch', 'unchanged'];

  it('has a distinct, non-empty sentence for every problem', () => {
    const seen = all.map(passwordMessage);
    expect(seen.every((m) => m.length > 0)).toBe(true);
    expect(new Set(seen).size).toBe(all.length);
  });

  it('quotes the real numbers rather than hardcoding them', () => {
    // If MIN/MAX ever change, the copy must change with them — a message that
    // says "8" while the rule says 10 is worse than no message.
    expect(passwordMessage('too-short')).toContain(String(MIN_PASSWORD));
    expect(passwordMessage('too-long')).toContain(String(MAX_PASSWORD));
  });

  it('ends every sentence with a full stop', () => {
    expect(all.every((p) => passwordMessage(p).endsWith('.'))).toBe(true);
  });
});

describe('passwordStrength', () => {
  it('scores anything under the floor as 0', () => {
    expect(passwordStrength('short')).toBe(0);
    expect(passwordStrength('')).toBe(0);
  });

  it('never scores 0 for a password the rules accept', () => {
    // THE ONE INVARIANT THAT MATTERS: level 0 is drawn in the error colour and
    // labelled "Too short", so anything acceptable scoring 0 would show a
    // refusal beside a password that submits fine.
    const accepted = [
      'a'.repeat(MIN_PASSWORD),
      'correct horse battery staple',
      'Tr0ub4dor&3',
      '🔥'.repeat(4) + 'abcd',
    ];
    for (const pw of accepted) {
      expect(passwordProblem(pw)).toBeNull();
      expect(passwordStrength(pw)).toBeGreaterThan(0);
    }
  });

  it('rewards length over variety', () => {
    // The documented intent: a long plain passphrase beats short leetspeak.
    expect(passwordStrength('aaaaaaaaaaaaaaaa')).toBeGreaterThan(passwordStrength('aB3$abcd'));
  });

  it('reaches the top on a real passphrase', () => {
    expect(passwordStrength('correct horse battery staple')).toBe(3);
  });

  it('stays within 0..3', () => {
    const samples = ['', 'a', 'abcdefgh', 'abcdefghijkl', 'aB3$aB3$aB3$aB3$aB3$', 'x'.repeat(72)];
    for (const pw of samples) {
      const s = passwordStrength(pw);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(3);
    }
  });

  it('has a label for every level it can return', () => {
    for (const level of [0, 1, 2, 3] as const) {
      expect(STRENGTH_LABEL[level]).toBeTruthy();
    }
  });
});
