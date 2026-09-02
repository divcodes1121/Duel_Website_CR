/**
 * WHAT'S NEW — the release feed behind the bell in the top bar.
 *
 * NO IMPORTS, DELIBERATELY, the same rule `tiers.ts`, `utils/format.ts`,
 * `state/passwordRules.ts` and `utils/squadParse.ts` follow. This decides what
 * every account is told the product does, and the unread arithmetic decides
 * whether they are told at all — both have to be importable by a test without
 * dragging in a Supabase client that wants a native WebSocket.
 *
 * ── IT IS A FILE, NOT A TABLE ─────────────────────────────────────────────
 *
 * There is no admin screen for this and no row in the database. A release note
 * ships in the same commit as the thing it describes, which is the only
 * arrangement where the two cannot drift: a feature cannot go out unannounced,
 * and an announcement cannot go out for a feature that was reverted. It also
 * costs nothing — no request, no table, no migration — and it is reviewable in
 * a diff like everything else.
 *
 * The cost is that a note cannot be published without a deploy. For a site
 * that deploys from `main` in about two minutes, that is not a cost.
 *
 * ── HOW TO ADD ONE ────────────────────────────────────────────────────────
 *
 *   1. Put it at the TOP of `RELEASES`. The array is newest first and
 *      `unreadCount` reads position, not dates — see the note there.
 *   2. Give it an id that is never reused, and never edit an old one's id.
 *      An id is what a reader's "seen" mark points at; changing one re-notifies
 *      everybody about something they have already read.
 *   3. Write it for somebody who does not know the codebase. "The suggestion
 *      window advances the duel" is a commit subject; "you no longer lose your
 *      pasted decks when a game ends" is a release note.
 *   4. **Never put a figure in it that is not measured.** Same rule as the
 *      landing page's closing band, and for the same reason: this is the one
 *      surface that speaks to every account at once, so an invented number
 *      here is a claim the whole user base is asked to believe.
 */

/** What kind of change this is. Drives a word and a hue, never a filter. */
export type ReleaseKind = 'new' | 'improved' | 'fixed';

export interface Release {
  /**
   * Stable and never reused. This is what a reader's "seen" mark points at, so
   * editing one re-notifies everybody about something they have already read.
   */
  id: string;
  /** ISO day, for display. Ordering comes from the array, not from this. */
  date: string;
  kind: ReleaseKind;
  /** A sentence, not a commit subject. Shown in the list and read first. */
  title: string;
  /**
   * One or two short paragraphs. PLAIN TEXT — no markup, no HTML, nothing to
   * sanitise. A changelog that renders markup is a changelog that has to be
   * trusted, and this one is rendered into every signed-in reader's chrome.
   */
  body: string[];
  /** A hash route to go and look at it, if there is somewhere to look. */
  href?: string;
  /** The link's words. Required whenever `href` is set. */
  hrefLabel?: string;
  /**
   * Which tier this needs, when it needs one.
   *
   * A LABEL, NOT A FILTER. Everybody sees every entry, including things their
   * tier cannot open — a feed that hides what you cannot have is a feed that
   * quietly shrinks the product, and the whole argument for subscribing is
   * knowing what is behind the gate. The badge is how it stays honest.
   */
  needs?: 'trial' | 'pro';
}

/**
 * Newest first. **The order of this array is the chronology**, and
 * `unreadCount` reads position rather than parsing dates — two notes can share
 * a day, and a date comparison would then have to break the tie by something
 * that is not the order they were written in.
 *
 * `tests/releases.test.ts` asserts the dates are non-increasing down the list,
 * so an entry inserted in the wrong place is caught rather than silently
 * mis-counting everybody's unread badge.
 */
export const RELEASES: Release[] = [
  {
    id: '2026-09-02-scouting-report',
    date: '2026-09-02',
    kind: 'new',
    title: 'Scout one roster without pasting your own',
    body: [
      'Team Analysis now has two tabs. Scouting Report takes a single roster — theirs — and tells you what they actually play and which decks beat it, so you can size up an opponent without having your own squad to hand.',
      'Match Plan is the screen you already know, unchanged: paste both rosters and get a folder per opponent with the decks your own players should answer them with. Your paste carries across when you switch tabs, so scouting a clan and then planning the match against it is one paste rather than two.',
    ],
    href: '#/teams',
    hrefLabel: 'Open Team Analysis',
    needs: 'trial',
  },
  {
    id: '2026-09-01-passwords',
    date: '2026-09-01',
    kind: 'fixed',
    title: 'You can change your password, and a reset link works',
    body: [
      'There is a Change password option in your account menu, and it asks for your current password first so an unattended browser is not enough to take an account over.',
      'Forgot your password now genuinely resets it. It did not before — the emailed link signed you in and left the old password in force, with nothing anywhere able to change it. If you tried that and it seemed to do nothing, this is why.',
    ],
  },
  {
    id: '2026-09-01-coach-continues',
    date: '2026-09-01',
    kind: 'improved',
    title: 'Coach Assist carries on to the next game',
    body: [
      'When the Suggestion window gives you an answer, it now offers to move on to the next game of the duel. Before, the only way forward was Start over, which threw away both tags and every deck you had pasted — at the exact moment a duel was running.',
    ],
    href: '#/',
    hrefLabel: 'Search a player',
    needs: 'pro',
  },
  {
    id: '2026-08-30-team-saves',
    date: '2026-08-30',
    kind: 'new',
    title: 'Save a team analysis and come back to it',
    body: [
      'Finished boards can be saved and reopened later. A restored board says how old its figures are, because nothing in it is recalculated on opening — and it keeps the rosters you pasted, so Re-run measures the same squads against today rather than asking you to type them again.',
    ],
    href: '#/teams',
    hrefLabel: 'Open Team Analysis',
    needs: 'trial',
  },
  {
    id: '2026-08-30-team-pdf',
    date: '2026-08-30',
    kind: 'new',
    title: 'Print a team analysis as a match dossier',
    body: [
      'Export PDF on Team Analysis produces a document rather than a screenshot of the screen: a section for every player on both sides, a heat map of the whole board, head-to-head spreads, and a method section explaining where each number came from. It prints in whichever theme you are reading in.',
    ],
    needs: 'trial',
  },
  {
    id: '2026-08-30-team-open',
    date: '2026-08-30',
    kind: 'improved',
    title: 'Team Analysis is included in the free trial',
    body: [
      'It used to be hidden. Everyone can see it now, and the three-day trial opens it along with Pro — it is the feature most worth trying on a real roster before deciding whether to pay for anything.',
      'Rosters can also be ten players a side, up from eight, because a ranked list off a Discord channel is numbered one to ten. Pasting one with the links still in it works: tags are read out of them.',
    ],
    href: '#/teams',
    hrefLabel: 'Open Team Analysis',
    needs: 'trial',
  },
  {
    id: '2026-08-26-analytics-hosted',
    date: '2026-08-26',
    kind: 'improved',
    title: 'The analytics screens work everywhere now',
    body: [
      'The service behind the meta board, the counters and the duel screens moved onto a server of its own. For most of this site’s life those screens only had data when one particular machine was switched on; they no longer depend on it.',
    ],
  },
];

/** The newest entry's id, or null when the feed is empty. */
export function newestReleaseId(releases: Release[] = RELEASES): string | null {
  return releases.length ? releases[0].id : null;
}

/**
 * How many entries are newer than the one last marked as read.
 *
 * POSITION, NOT DATES. The array is the chronology (see above), so the count
 * is simply how far down the list the seen mark sits.
 *
 * `null` — nobody has read anything on this browser — is **0, not everything**,
 * and that is the load-bearing case. A first-time visitor has no history with
 * this product, and greeting them with a badge saying seven things are new is
 * an announcement about a thing they have never seen. The caller stamps the
 * newest id on first sight instead; see `markSeen` in the store.
 *
 * AN UNRECOGNISED ID IS ALSO 0. A changelog is append-only, so that only
 * happens if history was edited — and in that case the honest count is not
 * knowable. Missing one badge is a smaller failure than showing every reader
 * the whole feed again.
 */
export function unreadCount(seenId: string | null, releases: Release[] = RELEASES): number {
  if (!seenId) return 0;
  const i = releases.findIndex((r) => r.id === seenId);
  return i < 0 ? 0 : i;
}
