/**
 * COACH ROSTER — THE DECK ARSENAL: the pure half.
 *
 * NO SUPABASE IMPORT and no React, the split `coachRoster.ts` already makes:
 * what a deck IS, and what may go in an arsenal, must be testable without a
 * client that wants a native WebSocket.
 *
 * THE ARSENAL IS NOT THE HISTORY, AND THAT IS THE WHOLE POINT OF THIS FILE.
 * `coach_intel` already reports every deck a player has actually played —
 * fifty of them, most played once. That is evidence. An arsenal is a
 * JUDGEMENT: the handful the coach considers this player prepared to take
 * into a match. They are stored separately, they are edited by hand, and a
 * historical deck becomes an arsenal deck only by being CHOSEN (`source:
 * 'history'` records that it came from one). Nothing copies decks in
 * automatically — an arsenal that fills itself is a second history.
 *
 * WHERE THE ENFORCEMENT IS. Nothing here is a security boundary.
 * `supabase/004_coach_roster.sql` refuses a non-admin, a deck that is not
 * eight distinct cards, more than twelve tags, a comfort outside 1–5 and a
 * deck already in that player's arsenal — whatever this file does. These
 * rules exist so the screen can say what is wrong BEFORE a round trip, in the
 * same words the table would have refused it with.
 */

import { CARDS_BY_KEY } from '../data/cards';
import { parseClashRoyaleDeckLink } from '../utils/deckLink';

export { parseClashRoyaleDeckLink };

/** A deck is eight cards here, as everywhere else in this project. */
export const ARSENAL_DECK_SIZE = 8;

/* Limits mirrored from the table's CHECK constraints, so a form stops where
   the database would. `TAG_MAX` is the one this file adds on its own: the
   table caps the NUMBER of tags and says nothing about their length, and a
   400-character "tag" is a note in the wrong field. */
export const DECK_NAME_MAX = 60;
export const ARCHETYPE_MAX = 40;
export const DECK_NOTES_MAX = 4000;
export const TAGS_MAX = 12;
export const TAG_MAX = 24;
export const COMFORT_MIN = 1;
export const COMFORT_MAX = 5;

/** Where a deck came from. Kept apart so "the coach chose this" and "the
 *  engine suggested this" can never be confused later — phases 4 and 5 read
 *  this field. */
export type ArsenalSource = 'manual' | 'link' | 'history' | 'coach_assist' | 'variant';

export const SOURCE_LABEL: Record<ArsenalSource, string> = {
  manual: 'Built by hand',
  link: 'Imported from a deck link',
  history: 'Taken from their battles',
  coach_assist: 'Suggested by Coach Assist',
  variant: 'Variant of another deck',
};

export type ArsenalStatus = 'active' | 'archived';

export interface ArsenalDeck {
  id: string;
  playerId: string;
  /** Exactly eight distinct card keys, in the order the coach arranged them. */
  cards: string[];
  /** The order-free identity the table computes; two arrangements of one list
   *  are ONE deck. Mirrored by `deckKey()` so the screen can say "already in
   *  their arsenal" without a round trip. */
  deckKey: string;
  name: string | null;
  archetype: string | null;
  comfort: number | null;
  tags: string[];
  status: ArsenalStatus;
  source: ArsenalSource;
  sourceRef: unknown;
  notes: string | null;
  /** The coach's own ranking (migration 005). Lower is higher up. */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewArsenalDeck {
  cards: string[];
  name?: string | null;
  archetype?: string | null;
  comfort?: number | null;
  tags?: string[];
  source?: ArsenalSource;
  sourceRef?: unknown;
  notes?: string | null;
}

export type ArsenalPatch = Partial<
  Pick<ArsenalDeck, 'cards' | 'name' | 'archetype' | 'comfort' | 'tags' | 'status' | 'notes' | 'sortOrder'>
>;

/** The repository the screen talks to — Supabase in production, memory in a
 *  checkout with none configured, exactly as the roster does. */
export interface ArsenalRepo {
  readonly kind: 'supabase' | 'memory';
  list(playerId: string): Promise<ArsenalDeck[]>;
  add(playerId: string, deck: NewArsenalDeck): Promise<ArsenalDeck>;
  update(id: string, patch: ArsenalPatch): Promise<ArsenalDeck>;
  remove(id: string): Promise<void>;
  /** Persist a whole ordering at once — a reorder moves one deck and
   *  renumbers its neighbours, and two half-applied writes would leave an
   *  order nobody chose. */
  reorder(playerId: string, idsInOrder: string[]): Promise<void>;
}

export class ArsenalError extends Error {
  constructor(
    public readonly code:
      | 'invalid_deck'
      | 'unknown_card'
      | 'duplicate'
      | 'too_long'
      | 'too_many_tags'
      | 'bad_comfort'
      | 'not_authorised'
      | 'not_found'
      | 'unknown',
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ArsenalError';
  }
}

/** The table's `coach_deck_key`, in TypeScript: the sorted keys joined by
 *  commas. It must agree with the SQL exactly, or the screen refuses
 *  duplicates the database would accept, or the other way round. */
export function deckKey(cards: readonly string[]): string {
  return [...cards].sort().join(',');
}

/** Eight distinct cards this build knows about. Returns the reason it is not
 *  a deck, or null when it is — the caller decides whether that is an error
 *  or just a disabled button. */
export function deckProblem(cards: readonly string[]): string | null {
  if (cards.length !== ARSENAL_DECK_SIZE) {
    return `A deck is ${ARSENAL_DECK_SIZE} cards — this has ${cards.length}.`;
  }
  if (new Set(cards).size !== cards.length) return 'A deck cannot hold the same card twice.';
  const unknown = cards.filter((c) => !CARDS_BY_KEY.has(c));
  if (unknown.length) {
    // Named rather than counted: it is almost always a card this build has
    // not been told about yet, and the key is what identifies which.
    return `This build does not know ${unknown.join(', ')}.`;
  }
  return null;
}

const clean = (s: string | null | undefined) => (s ?? '').trim() || null;

/** Tags as the table will store them: trimmed, empty ones dropped, compared
 *  case-insensitively so "Primary" and "primary" cannot both be added, and
 *  the coach's own capitalisation kept for the one that wins. */
export function cleanTags(tags: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    if (t.length > TAG_MAX) {
      throw new ArsenalError('too_long', `A tag can be at most ${TAG_MAX} characters — "${t}" is longer.`);
    }
    seen.add(k);
    out.push(t);
  }
  if (out.length > TAGS_MAX) {
    throw new ArsenalError('too_many_tags', `A deck can carry at most ${TAGS_MAX} tags.`);
  }
  return out;
}

/** Suggestions, NOT a closed list. The table stores tags as free text
 *  deliberately: a coach's vocabulary is theirs to grow, and a fixed enum
 *  would need a migration every time they think of one. These are only what
 *  the picker offers first. */
export const TAG_SUGGESTIONS = [
  'Primary',
  'Backup',
  'Tournament',
  'Comfort',
  'Experimental',
  'Anti-Bait',
  'Anti-Beatdown',
  'Anti-Control',
  'Anti-Cycle',
  'Needs practice',
] as const;

/** The two tags the workspace treats as roles rather than labels, so a
 *  reader can see at a glance what this player leads with. They are ordinary
 *  tags in the database — nothing enforces one Primary, because a coach
 *  mid-rethink may legitimately have two for a moment. */
export const ROLE_TAGS = ['Primary', 'Backup'] as const;

export function hasTag(deck: Pick<ArsenalDeck, 'tags'>, tag: string): boolean {
  const k = tag.toLowerCase();
  return deck.tags.some((t) => t.toLowerCase() === k);
}

/** Validate a new deck the way the table will. Returns the cleaned entry, or
 *  throws an `ArsenalError` whose message is the sentence to show. */
export function cleanNewDeck(
  input: NewArsenalDeck,
  existing: readonly ArsenalDeck[] = [],
): Required<Omit<NewArsenalDeck, 'sourceRef'>> & { sourceRef: unknown } {
  const cards = [...(input.cards ?? [])];
  const problem = deckProblem(cards);
  if (problem) {
    throw new ArsenalError(cards.some((c) => !CARDS_BY_KEY.has(c)) ? 'unknown_card' : 'invalid_deck', problem);
  }

  // The table's unique (player_id, deck_key) would refuse this anyway; saying
  // so here names the deck it collides with, which a 23505 cannot.
  const key = deckKey(cards);
  const clash = existing.find((d) => d.deckKey === key);
  if (clash) {
    throw new ArsenalError(
      'duplicate',
      `Those eight cards are already in this arsenal${clash.name ? ` as "${clash.name}"` : ''}${
        clash.status === 'archived' ? ' (archived — restore it instead)' : ''
      }.`,
    );
  }

  const name = clean(input.name);
  if (name && name.length > DECK_NAME_MAX) {
    throw new ArsenalError('too_long', `A deck name can be at most ${DECK_NAME_MAX} characters.`);
  }
  const archetype = clean(input.archetype);
  if (archetype && archetype.length > ARCHETYPE_MAX) {
    throw new ArsenalError('too_long', `An archetype can be at most ${ARCHETYPE_MAX} characters.`);
  }
  const notes = clean(input.notes);
  if (notes && notes.length > DECK_NOTES_MAX) {
    throw new ArsenalError('too_long', `Notes can be at most ${DECK_NOTES_MAX} characters.`);
  }

  const comfort = input.comfort ?? null;
  if (comfort !== null && (!Number.isInteger(comfort) || comfort < COMFORT_MIN || comfort > COMFORT_MAX)) {
    throw new ArsenalError('bad_comfort', `Comfort is ${COMFORT_MIN} to ${COMFORT_MAX} stars, or left unset.`);
  }

  return {
    cards,
    name,
    archetype,
    comfort,
    tags: cleanTags(input.tags),
    source: input.source ?? 'manual',
    sourceRef: input.sourceRef ?? null,
    notes,
  };
}

/** Postgres / PostgREST codes, worded for this screen. The database is the
 *  authority; this only decides the sentence. */
export function explainArsenalError(code: string | undefined, message: string): ArsenalError {
  switch (code) {
    case '23505':
      return new ArsenalError('duplicate', 'Those eight cards are already in this arsenal.', message);
    case '23514':
      return new ArsenalError('invalid_deck', 'The database refused that deck as malformed.', message);
    case '23503':
      return new ArsenalError('not_found', 'That player is no longer on your roster.', message);
    case '42501':
      return new ArsenalError(
        'not_authorised',
        'The database refused this: Coach Roster is for administrators only.',
        message,
      );
    case '42703':
      // The one failure that is a DEPLOY problem rather than a data problem,
      // so it must not read as "could not save that change".
      return new ArsenalError(
        'unknown',
        'The database has not had migration 005 applied yet, so deck order cannot be saved.',
        message,
      );
    default:
      return new ArsenalError('unknown', 'Could not save that change.', message);
  }
}

/** What to call a deck: the coach's name, else its archetype, else the cards.
 *  Never an empty string — a nameless row in a list is unclickable. */
export function deckLabel(d: Pick<ArsenalDeck, 'name' | 'archetype' | 'cards'>): string {
  const named = d.name?.trim();
  if (named) return named;
  const arch = d.archetype?.trim();
  if (arch) return arch;
  const first = d.cards
    .slice(0, 2)
    .map((c) => CARDS_BY_KEY.get(c)?.name ?? c)
    .join(' + ');
  return first || 'Untitled deck';
}

/** Average elixir, one decimal, over cards this build knows. Null rather than
 *  a wrong average when a card is unknown — a deck's cost is a figure a coach
 *  acts on, and a quietly-low number is worse than none. */
export function averageElixir(cards: readonly string[]): number | null {
  const costs = cards.map((c) => CARDS_BY_KEY.get(c)?.elixir);
  if (costs.some((c) => typeof c !== 'number')) return null;
  const total = (costs as number[]).reduce((a, b) => a + b, 0);
  return Math.round((total / costs.length) * 10) / 10;
}

/** The arsenal in the coach's order: their ranking first, then oldest first
 *  so equal ranks are stable rather than shuffling on every read. */
export function sortArsenal(decks: readonly ArsenalDeck[]): ArsenalDeck[] {
  return [...decks].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** Move one deck up or down within its own status group, returning the new
 *  order as ids. Pure, so the screen can write it optimistically and the
 *  repository can persist exactly what was shown.
 *
 *  It returns the list UNCHANGED at either end rather than wrapping around:
 *  a "move up" that sends the top deck to the bottom looks like a bug even
 *  when it is documented. */
export function reorderDecks(decks: readonly ArsenalDeck[], id: string, direction: -1 | 1): string[] {
  const list = sortArsenal(decks);
  const i = list.findIndex((d) => d.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return list.map((d) => d.id);
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next.map((d) => d.id);
}

/** Filter an arsenal by free text and tags. The text matches the deck's name,
 *  its archetype and its CARD NAMES — a coach looking for "the hog deck"
 *  types a card, not a fingerprint (the same lesson the 2v2 board's search
 *  cost: `hog-rider` found 434,265 pairs and `Hog Rider` found none). */
export function filterArsenal(
  decks: readonly ArsenalDeck[],
  query: string,
  tags: readonly string[] = [],
): ArsenalDeck[] {
  const q = query.trim().toLowerCase();
  const want = tags.map((t) => t.toLowerCase());
  return decks.filter((d) => {
    if (want.length && !want.every((t) => d.tags.some((x) => x.toLowerCase() === t))) return false;
    if (!q) return true;
    if (deckLabel(d).toLowerCase().includes(q)) return true;
    if ((d.archetype ?? '').toLowerCase().includes(q)) return true;
    return d.cards.some((c) => {
      const card = CARDS_BY_KEY.get(c);
      return c.includes(q) || (card?.name ?? '').toLowerCase().includes(q);
    });
  });
}

/** Every tag in use, most-used first, so the filter row offers what this
 *  coach actually writes rather than what this file guessed. */
export function usedTags(decks: readonly ArsenalDeck[]): string[] {
  const count = new Map<string, { label: string; n: number }>();
  for (const d of decks) {
    for (const t of d.tags) {
      const k = t.toLowerCase();
      const hit = count.get(k);
      if (hit) hit.n += 1;
      else count.set(k, { label: t, n: 1 });
    }
  }
  return [...count.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map((x) => x.label);
}

/* ── the in-memory repository ───────────────────────────────────────────── */

/** A local preview that saves nothing, for a checkout with no Supabase. It
 *  applies the same rules the table does — including the per-player duplicate
 *  key — so the screen behaves the same way in both. */
export function memoryArsenalRepo(seed: ArsenalDeck[] = []): ArsenalRepo {
  let rows = [...seed];
  let n = 0;
  const now = () => new Date().toISOString();

  return {
    kind: 'memory',
    async list(playerId) {
      return sortArsenal(rows.filter((d) => d.playerId === playerId));
    },
    async add(playerId, deck) {
      const value = cleanNewDeck(
        deck,
        rows.filter((d) => d.playerId === playerId),
      );
      const stamp = now();
      const row: ArsenalDeck = {
        id: `mem-deck-${++n}`,
        playerId,
        ...value,
        deckKey: deckKey(value.cards),
        status: 'active',
        // New decks land at the bottom of the coach's order, never the top:
        // arriving above decks somebody ranked is the arsenal rearranging
        // itself.
        sortOrder: rows.filter((d) => d.playerId === playerId).length,
        createdAt: stamp,
        updatedAt: stamp,
      };
      rows = [...rows, row];
      return row;
    },
    async update(id, patch) {
      const i = rows.findIndex((d) => d.id === id);
      if (i < 0) throw new ArsenalError('not_found', 'That deck is no longer in the arsenal.');
      const current = rows[i];
      if (patch.cards) {
        const problem = deckProblem(patch.cards);
        if (problem) throw new ArsenalError('invalid_deck', problem);
        const key = deckKey(patch.cards);
        if (rows.some((d) => d.id !== id && d.playerId === current.playerId && d.deckKey === key)) {
          throw new ArsenalError('duplicate', 'Those eight cards are already in this arsenal.');
        }
      }
      const next: ArsenalDeck = {
        ...current,
        ...patch,
        tags: patch.tags ? cleanTags(patch.tags) : current.tags,
        deckKey: patch.cards ? deckKey(patch.cards) : current.deckKey,
        updatedAt: now(),
      };
      rows = rows.map((d) => (d.id === id ? next : d));
      return next;
    },
    async remove(id) {
      rows = rows.filter((d) => d.id !== id);
    },
    async reorder(playerId, idsInOrder) {
      const at = new Map(idsInOrder.map((id, i) => [id, i]));
      rows = rows.map((d) =>
        d.playerId === playerId && at.has(d.id) ? { ...d, sortOrder: at.get(d.id)!, updatedAt: now() } : d,
      );
    },
  };
}
