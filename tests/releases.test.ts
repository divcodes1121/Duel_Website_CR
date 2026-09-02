import { describe, expect, it } from 'vitest';

import {
  RELEASES,
  newestReleaseId,
  unreadCount,
  type Release,
} from '../src/content/releases';

/**
 * THE FEED IS THE ONE SURFACE THAT SPEAKS TO EVERY ACCOUNT AT ONCE.
 *
 * Two things are worth pinning. The arithmetic, because it decides whether
 * anybody is told anything — and its two silent cases (a reader with no mark,
 * and a mark that no longer exists) are both "say nothing", which is exactly
 * the shape of bug that never gets reported. And the CONTENT, because an entry
 * inserted in the wrong place miscounts every reader's badge, and a link with
 * no words is a dead end on a panel whose whole job is to hand somebody off to
 * the thing being announced.
 */

const feed = (...ids: string[]): Release[] =>
  ids.map((id, i) => ({
    id,
    date: `2026-09-${String(20 - i).padStart(2, '0')}`,
    kind: 'new' as const,
    title: id,
    body: ['x'],
  }));

describe('unreadCount', () => {
  it('counts the entries above the seen mark', () => {
    const f = feed('c', 'b', 'a');
    expect(unreadCount('a', f)).toBe(2);
    expect(unreadCount('b', f)).toBe(1);
    expect(unreadCount('c', f)).toBe(0);
  });

  it('A READER WITH NO MARK IS TOLD NOTHING, not everything', () => {
    /* The load-bearing case. A first-time visitor greeted with "7 new things"
       is being told about a product they have never used, and it is how a
       badge stops meaning anything. The store stamps them silently instead. */
    expect(unreadCount(null, feed('c', 'b', 'a'))).toBe(0);
  });

  it('treats an unrecognised mark as nothing rather than as everything', () => {
    /* Only possible if history was edited — a changelog is append-only. The
       honest count is then unknowable, and missing one badge is a far smaller
       failure than re-announcing the entire feed to every reader. */
    expect(unreadCount('deleted-entry', feed('c', 'b', 'a'))).toBe(0);
  });

  it('is 0 on an empty feed whatever the mark says', () => {
    expect(unreadCount('anything', [])).toBe(0);
    expect(newestReleaseId([])).toBeNull();
  });
});

describe('the shipped feed', () => {
  it('is ordered newest first', () => {
    /* THE ARRAY IS THE CHRONOLOGY — `unreadCount` reads position, not dates —
       so an entry inserted in the wrong place does not look wrong, it silently
       gives every reader the wrong badge. */
    const dates = RELEASES.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('has no duplicate ids', () => {
    /* An id is what a reader's seen mark points at. Two entries sharing one
       means `findIndex` answers for whichever came first and the count is
       wrong from then on. */
    const ids = RELEASES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has a real date, a title and a body', () => {
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(`${r.date}T00:00:00`).getTime())).toBe(false);
      expect(r.title.trim().length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(0);
      expect(r.body.every((p) => p.trim().length > 0)).toBe(true);
    }
  });

  it('never ships a link without words, or words without a link', () => {
    // The panel renders the pair or neither; half of one is a dead control.
    for (const r of RELEASES) {
      expect(Boolean(r.href)).toBe(Boolean(r.hrefLabel));
    }
  });

  it('links only to routes this app actually has', () => {
    /* A release note is read by every account at once, so a link that goes
       nowhere is a dead end shown to everybody. `App.tsx` routes on the hash,
       and these are the prefixes it knows. */
    const ROUTES = ['#/', '#/builder', '#/decks', '#/palette', '#/teams', '#/guide'];
    for (const r of RELEASES) {
      if (!r.href) continue;
      expect(ROUTES).toContain(r.href);
    }
  });

  it('is written for a reader, not as a commit log', () => {
    // A title that is a sentence, not a subject line: no leading verb-colon
    // shorthand, and long enough to say something.
    for (const r of RELEASES) {
      expect(r.title.length).toBeGreaterThan(12);
      expect(r.title).not.toMatch(/^(feat|fix|chore|docs|refactor)\b/i);
    }
  });

  it('states a tier only where one is really needed', () => {
    for (const r of RELEASES) {
      if (r.needs) expect(['trial', 'pro']).toContain(r.needs);
    }
  });
});
