/**
 * All Duels — the small decisions the screen makes, kept where they can be
 * tested.
 *
 * NO IMPORTS, like `tiers.ts`, `pageWindow.ts` and `datePresets.ts`: nothing
 * here needs a store, a Supabase client or the card catalogue, so none of it
 * should need one to be checked.
 */

/** Duels a page. Ten is a screenful of scrolling; the others are for reading
 *  a lot of them. The server caps a page at 50 (`duel_feed.MAX_PER_PAGE`). */
export const DUEL_FEED_PER_PAGE = [10, 20, 50] as const;

export const DUEL_FEED_DEFAULT_PER_PAGE = 10;

/** How many cards the filter takes: a deck is eight, so a ninth could match
 *  nothing. The server's own cap (`duo_pairs.MAX_FILTER_CARDS`). */
export const DUEL_FEED_MAX_CARDS = 8;

/** `20261005T024430.000Z` -> the instant, or null for anything else. */
export function parseBattleTime(raw: string | null | undefined): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(raw ?? '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `5 Oct 2026, 08:14` in the reader's own time zone — the battle log's form,
 *  with the year, because a 90-day window can cross one. */
export function duelStamp(raw: string | null | undefined): string {
  const d = parseBattleTime(raw);
  if (!d) return raw || '—';
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${day}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** `2026-09-06` -> `6 Sep 2026`. */
export function windowDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A tag the way a player types it. */
export function shownTag(tag: string | null | undefined): string {
  const t = (tag ?? '').trim();
  if (!t) return '';
  return t.startsWith('#') ? t : `#${t}`;
}

/** What a player is called on the row: their name, or their tag when no name
 *  was ever stored. */
export function playerLabel(p: { tag: string; name: string | null }): string {
  return p.name?.trim() || shownTag(p.tag) || 'Unknown';
}

/**
 * Does this deck hold EVERY picked card?
 *
 * The server's rule, restated for one purpose: marking WHICH deck of a matched
 * duel is the reason it matched. A duel is on a filtered page because one deck
 * in it runs all the cards; the other five are just the rest of the duel.
 * Nothing picked is nothing to mark.
 */
export function deckHolds(cards: readonly string[], picked: readonly string[]): boolean {
  return picked.length > 0 && picked.every((c) => cards.includes(c));
}

const nf = new Intl.NumberFormat('en-US');

/**
 * The one line under the title: how many duels the window holds, or how many
 * of them the card filter kept — AND WHAT THEY ARE.
 *
 * The page is called All Duels and lists friendly duels that went to the third
 * game (`duel_feed.MODE` / `GAMES` on the server; a test holds this wording to
 * those two constants). The name says less than that, so the line under it
 * says the rest: it is the one place a reader learns why a war duel or a 2-0
 * is not here.
 */
export function feedCount(r: { total: number; windowDuels: number; cards: readonly string[] }): string {
  const what = (n: number) => `${nf.format(n)} friendly duel${n === 1 ? '' : 's'} played to three games`;
  if (r.cards.length) return `${nf.format(r.total)} of ${what(r.windowDuels)}`;
  return what(r.windowDuels);
}

/** `1–10 of 79,544` for the footer; empty when there is nothing to count. */
export function pageRange(r: { page: number; perPage: number; total: number }): string {
  if (r.total <= 0) return '';
  const first = (r.page - 1) * r.perPage + 1;
  const last = Math.min(r.page * r.perPage, r.total);
  return `${nf.format(first)}–${nf.format(last)} of ${nf.format(r.total)}`;
}

/**
 * A refusal from the admin route, worded.
 *
 * The same gate as the console's tracking view and the roster's intel route,
 * so the same four sentences. `kind` and `message` are `AnalyticsError`'s: the
 * gate's reason code arrives as the message of a `server` error.
 */
export function duelFeedProblem(kind: string, message: string): string {
  if (kind === 'offline') return message;
  if (kind === 'not_found') {
    return 'The analytics server does not have the All Duels route yet — its server half has not been deployed.';
  }
  switch (message) {
    case 'unauthorized':
      return 'The analytics server could not verify your session. Sign out and in again.';
    case 'forbidden':
      return 'The analytics server says this account is not an admin.';
    case 'not_configured':
      return 'The analytics server is not configured to check admin access (SUPABASE_URL / SUPABASE_ANON_KEY).';
    case 'unavailable':
      return 'The analytics server could not reach Supabase to check admin access. Try again in a moment.';
    default:
      return 'Could not read the duels. Try again in a moment.';
  }
}
