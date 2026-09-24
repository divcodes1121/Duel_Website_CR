import { describe, expect, it } from 'vitest';

import { libraryCount, shouldKeepShadow } from '../api/decks';

/**
 * THE LAST LINE OF DEFENCE for the deck sync.
 *
 * A client bug replaced an account's 150 saved duel sets with an empty
 * payload and there was no copy of what it overwrote. The client path is
 * fixed, but "the client pushed something wrong" is a CATEGORY, not one bug —
 * so a PUT that shrinks the library now keeps the previous version first.
 */
describe('shouldKeepShadow', () => {
  const lib = (n: number) => ({ library: Array.from({ length: n }, (_, i) => ({ id: i })) });

  it('keeps a copy when a push would empty a real library', () => {
    expect(shouldKeepShadow(lib(150), lib(0))).toBe(true);
  });

  it('keeps one for any shrink, not just to zero', () => {
    expect(shouldKeepShadow(lib(150), lib(149))).toBe(true);
  });

  it('does NOT pay a second write for a normal save', () => {
    expect(shouldKeepShadow(lib(150), lib(151))).toBe(false);
    expect(shouldKeepShadow(lib(150), lib(150))).toBe(false);
  });

  it('has nothing to keep for a first-ever sync', () => {
    expect(shouldKeepShadow(null, lib(3))).toBe(false);
    expect(shouldKeepShadow(undefined, lib(3))).toBe(false);
  });

  it('treats an unreadable stored blob as empty rather than throwing', () => {
    expect(shouldKeepShadow('not json', lib(0))).toBe(false);
    expect(shouldKeepShadow({}, lib(0))).toBe(false);
    expect(libraryCount({ library: 'nope' })).toBe(0);
    expect(libraryCount(null)).toBe(0);
  });

  it('deleting decks on purpose still works — it is kept, not refused', () => {
    // The guard must never REJECT a shrink; the user may genuinely have
    // deleted things. It only makes the previous version recoverable.
    expect(shouldKeepShadow(lib(5), lib(1))).toBe(true);
  });
});
