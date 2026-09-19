/**
 * COACH ROSTER — the pure half: types, the rules for a roster entry, and an
 * in-memory repository.
 *
 * NO SUPABASE IMPORT, the same split `tiers.ts`, `deviceIdentity.ts` and
 * `squadParse.ts` make, for the same reason: the rules have to be testable
 * without constructing a client that wants a native WebSocket. The Supabase
 * repository lives in `coachRosterStore.ts`; this file only knows the shape.
 *
 * WHERE THE ENFORCEMENT IS. Nothing here is a security boundary. The table
 * (`supabase/004_coach_roster.sql`) refuses a non-admin, a malformed tag and a
 * duplicate on its own, verified row by row in `004_coach_roster_verify.sql`.
 * These checks exist so the screen can say what is wrong BEFORE a round trip,
 * in words, rather than relaying a Postgres error.
 */

import { normalizeTag } from '../utils/squadParse';

export { normalizeTag };

export interface RosterPlayer {
  id: string;
  playerTag: string;
  displayName: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewRosterPlayer {
  playerTag: string;
  displayName?: string | null;
  notes?: string | null;
}

export type RosterPatch = Partial<Pick<RosterPlayer, 'displayName' | 'notes' | 'isActive'>>;

/** The repository the screen talks to. Two implementations: Supabase in
 *  production, memory in a checkout with no Supabase configured. */
export interface RosterRepo {
  /** 'supabase' is the real, RLS-guarded store; 'memory' is a local preview
   *  that saves nothing, and the screen says so. */
  readonly kind: 'supabase' | 'memory';
  list(): Promise<RosterPlayer[]>;
  add(p: NewRosterPlayer): Promise<RosterPlayer>;
  update(id: string, patch: RosterPatch): Promise<RosterPlayer>;
  /** Deletes outright, or — when the player has match history, which the
   *  database protects with ON DELETE RESTRICT — archives instead and says so. */
  remove(id: string): Promise<'deleted' | 'archived'>;
}

/** Limits mirrored from the table's CHECK constraints, so the form can stop
 *  at the same line the database would. */
export const NAME_MAX = 40;
export const NOTES_MAX = 4000;

/** A thrown error with a code the screen can word, and the table's own code
 *  kept for anyone reading the console. */
export class RosterError extends Error {
  constructor(
    public readonly code: 'invalid_tag' | 'duplicate' | 'too_long' | 'not_authorised' | 'not_found' | 'unknown',
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'RosterError';
  }
}

/** Validate a new entry the way the table will. Returns the cleaned entry,
 *  or throws a `RosterError` whose message is the sentence to show. */
export function cleanNewPlayer(p: NewRosterPlayer, existing: RosterPlayer[]): Required<NewRosterPlayer> {
  const tag = normalizeTag(p.playerTag ?? '');
  if (!tag) {
    throw new RosterError(
      'invalid_tag',
      'That is not a Clash Royale player tag — it is # followed by 5 to 12 of 0 2 8 9 P Y L Q G R J C U V.',
    );
  }
  if (existing.some((x) => x.playerTag === tag)) {
    throw new RosterError('duplicate', `${tag} is already on your roster.`);
  }
  const displayName = (p.displayName ?? '').trim() || null;
  const notes = (p.notes ?? '').trim() || null;
  if (displayName && displayName.length > NAME_MAX) {
    throw new RosterError('too_long', `A display name can be at most ${NAME_MAX} characters.`);
  }
  if (notes && notes.length > NOTES_MAX) {
    throw new RosterError('too_long', `Notes can be at most ${NOTES_MAX} characters.`);
  }
  return { playerTag: tag, displayName, notes };
}

/** Postgres / PostgREST codes, worded. The database is the authority; this
 *  only decides what the sentence says. */
export function explainDbError(code: string | undefined, message: string): RosterError {
  switch (code) {
    case '23505':
      return new RosterError('duplicate', 'That player is already on your roster.', message);
    case '23514':
      return new RosterError('invalid_tag', 'The database refused that entry as malformed.', message);
    case '42501':
      return new RosterError(
        'not_authorised',
        'The database refused this: Coach Roster is for administrators only.',
        message,
      );
    default:
      return new RosterError('unknown', 'Could not save that change.', message);
  }
}

/** What to call a player: the coach's name for them, else the tag. */
export function playerLabel(p: Pick<RosterPlayer, 'displayName' | 'playerTag'>): string {
  return p.displayName?.trim() || p.playerTag;
}

/** Active first, then by label, case-insensitive — a roster read top to
 *  bottom, with archived players out of the way at the end. */
export function sortRoster(players: RosterPlayer[]): RosterPlayer[] {
  return [...players].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return playerLabel(a).localeCompare(playerLabel(b), undefined, { sensitivity: 'base' });
  });
}

/* ── the route ─────────────────────────────────────────────────────────────
 *
 * `#/admin/coach/<TAG>/<section>`. The URL carries the player and the section
 * so a refresh keeps both, and switching player keeps the section — Rahul →
 * Opponents, then Arjun → Opponents, without resetting to Overview. The tag is
 * written without its '#', which would otherwise start a second fragment. */

export const COACH_ROUTE = '#/admin/coach';
export const COACH_SECTIONS = ['overview'] as const;
export type CoachSection = (typeof COACH_SECTIONS)[number];

export function parseCoachRoute(hash: string): { tag: string | null; section: CoachSection } {
  const rest = hash.startsWith(COACH_ROUTE) ? hash.slice(COACH_ROUTE.length) : '';
  const [, rawTag = '', rawSection = ''] = rest.split('/');
  const tag = rawTag ? normalizeTag(decodeURIComponent(rawTag)) : null;
  const section = (COACH_SECTIONS as readonly string[]).includes(rawSection)
    ? (rawSection as CoachSection)
    : 'overview';
  return { tag, section };
}

export function coachHref(tag: string | null, section: CoachSection = 'overview'): string {
  if (!tag) return COACH_ROUTE;
  return `${COACH_ROUTE}/${encodeURIComponent(tag.replace(/^#/, ''))}/${section}`;
}

/* ── the in-memory repository ──────────────────────────────────────────────
 *
 * For a checkout with no Supabase configured — where the gate already answers
 * `admin` so the whole site can be looked at locally. It saves nothing beyond
 * the page's lifetime and the screen says so; it exists so the UI can be seen
 * and exercised without a production admin session. It applies the same rules
 * the table does (tag format, one row per tag), so behaviour does not diverge
 * between the two. */

export function memoryRepo(seed: RosterPlayer[] = []): RosterRepo {
  let rows = [...seed];
  let n = 0;
  const now = () => new Date().toISOString();
  return {
    kind: 'memory',
    async list() {
      return [...rows];
    },
    async add(p) {
      const clean = cleanNewPlayer(p, rows);
      const t = now();
      const row: RosterPlayer = {
        id: `local-${++n}-${Date.now()}`,
        playerTag: clean.playerTag,
        displayName: clean.displayName,
        notes: clean.notes,
        isActive: true,
        createdAt: t,
        updatedAt: t,
      };
      rows = [...rows, row];
      return row;
    },
    async update(id, patch) {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) throw new RosterError('not_found', 'That player is no longer on your roster.');
      const next = { ...rows[i], ...patch, updatedAt: now() };
      rows = rows.map((r, j) => (j === i ? next : r));
      return next;
    },
    async remove(id) {
      rows = rows.filter((r) => r.id !== id);
      return 'deleted';
    },
  };
}

/** '20260907T161011.000Z' (the battle log's own format) -> an ISO string
 *  `Date.parse` can read, or null. The stored decks carry this format, and
 *  `Date.parse` returns NaN on it — which `ago()` would print as "NaNd ago". */
export function battleTimeToIso(raw: string | null | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(raw ?? '');
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}
