/**
 * COACH ROSTER — THE MATCH PLAN: the pure half.
 *
 * NO SUPABASE, NO REACT. The rules about what a plan IS have to be testable
 * without a client, the split every phase here has made.
 *
 * A PLAN IS A DECISION WITH ITS REASONING ATTACHED. Phases 2 to 5 answer
 * questions; this is where the coach commits: against this opponent, this
 * player leads with THIS deck, falls back to that one, and keeps a third in
 * reserve. One deck per slot, because a "backup" that is three decks is not a
 * backup.
 *
 * THE SNAPSHOT IS THE WHOLE POINT OF THE TABLE. `coach_match_plans` carries
 * `recommendations` — every candidate the screen showed when the plan was
 * drawn up, each with its source and its evidence — plus `engine`, which
 * records WHICH engine and window produced them. The engines move on: the
 * matchup snapshot is rebuilt, the window rolls forward, a deck's expected
 * rate changes. Without the freeze, "why did we bring Graveyard that day"
 * becomes unanswerable within a week, and phase 7 could never compare what
 * was recommended against what actually happened.
 *
 * SOURCE IS NEVER INFERRED, and it is the distinction the whole feedback loop
 * rests on: `coach_assist` is the engine's pick, `arsenal` is one the coach
 * had already approved, `manual` is the override the engines never produced,
 * `variant` is a deliberate edit of one of those. A plan that cannot say
 * which is a plan nobody can learn from.
 */

import type { ArsenalDeck } from './coachArsenal';
import { deckKey } from './coachArsenal';
import type { TeamRecommendation } from './analyticsClient';

export const PLAN_SLOTS = ['primary', 'backup', 'alternative'] as const;
export type PlanSlot = (typeof PLAN_SLOTS)[number];

export const SLOT_LABEL: Record<PlanSlot, string> = {
  primary: 'Primary',
  backup: 'Backup',
  alternative: 'Alternative',
};

/** What each slot is FOR, said on the screen — three unexplained boxes are
 *  three guesses. */
export const SLOT_HELP: Record<PlanSlot, string> = {
  primary: 'What they lead with.',
  backup: 'If the primary is answered, or they show something it loses to.',
  alternative: 'Held in reserve — a different shape, not a second version of the primary.',
};

export type PlanStatus = 'draft' | 'confirmed' | 'closed';
export type PlanSource = 'coach_assist' | 'arsenal' | 'manual' | 'variant';

export const PLAN_SOURCE_LABEL: Record<PlanSource, string> = {
  coach_assist: 'The engine suggested it',
  arsenal: 'From their arsenal',
  manual: 'Your own call',
  variant: 'An edit of another deck',
};

export const PLAN_NOTES_MAX = 4000;
export const PLAN_NAME_MAX = 60;
/** The table's own cap on the frozen snapshot, in bytes. */
export const SNAPSHOT_MAX_BYTES = 262144;

export interface PlanDeck {
  id: string;
  planId: string;
  slot: PlanSlot;
  cards: string[];
  source: PlanSource;
  sourceRef: unknown;
  name: string | null;
  createdAt: string;
}

export interface MatchPlan {
  id: string;
  playerId: string;
  opponentTag: string;
  opponentName: string | null;
  /** Frozen: every candidate the screen showed, with its evidence. */
  recommendations: PlanCandidate[];
  /** Which engine and window produced them. */
  engine: PlanEngine | null;
  generatedAt: string | null;
  status: PlanStatus;
  confirmedAt: string | null;
  notes: string | null;
  testMode: boolean;
  createdAt: string;
  updatedAt: string;
  /** Loaded alongside; empty until read. */
  decks: PlanDeck[];
}

/** One candidate as it was when the plan was made. Deliberately flat and
 *  self-describing: it is read back months later by code that must not have
 *  to fetch anything to make sense of it. */
export interface PlanCandidate {
  cards: string[];
  name: string;
  source: PlanSource;
  /** The engine's figures, when it was an engine pick. Null for an arsenal
   *  deck the engine never scored — never a zero, which would read as "it
   *  scored nothing". */
  expectedWinRate: number | null;
  spreadCovered: number | null;
  /** Times the player had played it, when known. */
  played: number | null;
  archetype: string | null;
}

export interface PlanEngine {
  /** The module that produced the ranking, named so a later reader can find
   *  it — not a version number nobody maintains. */
  name: string;
  route: string;
  days: number;
  /** What the ranking was against. */
  opponentTag: string;
  at: string;
}

export interface NewMatchPlan {
  opponentTag: string;
  opponentName?: string | null;
  recommendations?: PlanCandidate[];
  engine?: PlanEngine | null;
  generatedAt?: string | null;
  notes?: string | null;
  testMode?: boolean;
}

export type PlanPatch = Partial<Pick<MatchPlan, 'notes' | 'status' | 'testMode' | 'opponentName'>>;

export interface NewPlanDeck {
  slot: PlanSlot;
  cards: string[];
  source: PlanSource;
  sourceRef?: unknown;
  name?: string | null;
}

export interface PlanRepo {
  readonly kind: 'supabase' | 'memory';
  list(playerId: string): Promise<MatchPlan[]>;
  create(playerId: string, plan: NewMatchPlan): Promise<MatchPlan>;
  update(id: string, patch: PlanPatch): Promise<MatchPlan>;
  remove(id: string): Promise<void>;
  /** One deck per slot: setting a slot that is taken REPLACES it, which is
   *  what the table's unique (plan_id, slot) enforces anyway. */
  setDeck(planId: string, deck: NewPlanDeck): Promise<PlanDeck>;
  clearDeck(planId: string, slot: PlanSlot): Promise<void>;
}

export class PlanError extends Error {
  constructor(
    public readonly code: 'invalid_tag' | 'invalid_deck' | 'too_long' | 'not_authorised' | 'not_found' | 'unknown',
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'PlanError';
  }
}

export function explainPlanError(code: string | undefined, message: string): PlanError {
  switch (code) {
    case '23514':
      return new PlanError('invalid_deck', 'The database refused that plan as malformed.', message);
    case '23503':
      return new PlanError('not_found', 'That player is no longer on your roster.', message);
    case '42501':
      return new PlanError('not_authorised', 'The database refused this: Coach Roster is for administrators only.', message);
    default:
      return new PlanError('unknown', 'Could not save that plan.', message);
  }
}

/**
 * Freeze what the screen was showing.
 *
 * BOTH SOURCES, EACH LABELLED. The engine's picks and the coach's approved
 * decks are different evidence about the same decision, and a snapshot that
 * kept only the engine's would make every plan look engine-driven in
 * hindsight — which is exactly the question phase 7 exists to answer.
 */
export function buildSnapshot(
  recs: readonly TeamRecommendation[],
  arsenal: readonly ArsenalDeck[],
  playedByKey: ReadonlyMap<string, number> | null,
): PlanCandidate[] {
  const out: PlanCandidate[] = [];
  const seen = new Set<string>();

  for (const r of recs) {
    const key = deckKey(r.cards);
    seen.add(key);
    out.push({
      cards: [...r.cards],
      name: r.name,
      source: 'coach_assist',
      expectedWinRate: r.expectedWinRate,
      spreadCovered: r.spreadCovered,
      played: r.comfort?.games ?? playedByKey?.get(key) ?? null,
      archetype: r.archetype ?? null,
    });
  }

  for (const d of arsenal) {
    if (d.status !== 'active' || seen.has(d.deckKey)) continue;
    out.push({
      cards: [...d.cards],
      name: d.name ?? d.archetype ?? 'Arsenal deck',
      source: 'arsenal',
      // NULL, not 0: the engine never scored this deck, which is not the same
      // as scoring it at nothing.
      expectedWinRate: null,
      spreadCovered: null,
      played: playedByKey?.get(d.deckKey) ?? null,
      archetype: d.archetype,
    });
  }

  return out;
}

/** The table caps the frozen snapshot; a plan must not fail to save because
 *  the arsenal grew. Trims the unscored tail first — the engine's picks are
 *  the part phase 7 compares against. */
export function fitSnapshot(candidates: PlanCandidate[], maxBytes = SNAPSHOT_MAX_BYTES): PlanCandidate[] {
  const size = (c: PlanCandidate[]) => JSON.stringify(c).length;
  if (size(candidates) <= maxBytes) return candidates;
  const kept = [...candidates];
  while (kept.length > 1 && size(kept) > maxBytes) {
    const i = kept.map((c) => c.source).lastIndexOf('arsenal');
    kept.splice(i >= 0 ? i : kept.length - 1, 1);
  }
  return kept;
}

const clean = (s: string | null | undefined) => (s ?? '').trim() || null;

export function cleanNewPlan(p: NewMatchPlan, normaliseTag: (t: string) => string | null): Required<Pick<NewMatchPlan, 'opponentTag'>> & NewMatchPlan {
  const tag = normaliseTag(p.opponentTag ?? '');
  if (!tag) {
    throw new PlanError(
      'invalid_tag',
      'That is not a Clash Royale player tag — # followed by 5 to 12 of 0 2 8 9 P Y L Q G R J C U V.',
    );
  }
  const notes = clean(p.notes);
  if (notes && notes.length > PLAN_NOTES_MAX) {
    throw new PlanError('too_long', `Notes can be at most ${PLAN_NOTES_MAX} characters.`);
  }
  return {
    ...p,
    opponentTag: tag,
    opponentName: clean(p.opponentName),
    notes,
    recommendations: fitSnapshot(p.recommendations ?? []),
    testMode: p.testMode ?? false,
  };
}

/** Newest first — a plan list is read to find the one you are about to play. */
export function sortPlans(plans: readonly MatchPlan[]): MatchPlan[] {
  return [...plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export function deckInSlot(plan: Pick<MatchPlan, 'decks'>, slot: PlanSlot): PlanDeck | null {
  return plan.decks.find((d) => d.slot === slot) ?? null;
}

/**
 * A plan can be confirmed once it has a primary.
 *
 * THE OTHER TWO SLOTS ARE NOT REQUIRED. A coach who has decided what to lead
 * with has made the decision the plan exists to record; refusing to confirm
 * until three boxes are full would teach them to fill boxes.
 */
export function canConfirm(plan: Pick<MatchPlan, 'decks' | 'status'>): boolean {
  return plan.status !== 'confirmed' && deckInSlot(plan, 'primary') !== null;
}

/** What the plan is missing, in words, or null when it is ready. */
export function planGap(plan: Pick<MatchPlan, 'decks'>): string | null {
  return deckInSlot(plan, 'primary') ? null : 'Pick a primary deck before confirming — that is the decision this plan records.';
}

/** One line for a plan row: who it is against and where it stands. */
export function planLabel(plan: Pick<MatchPlan, 'opponentName' | 'opponentTag'>): string {
  return plan.opponentName?.trim() || plan.opponentTag;
}

export const STATUS_LABEL: Record<PlanStatus, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  closed: 'Closed',
};

/* ── the in-memory repository ───────────────────────────────────────────── */

export function memoryPlanRepo(seed: MatchPlan[] = []): PlanRepo {
  let rows = [...seed];
  let n = 0;
  const now = () => new Date().toISOString();
  const find = (id: string) => {
    const p = rows.find((x) => x.id === id);
    if (!p) throw new PlanError('not_found', 'That plan no longer exists.');
    return p;
  };

  return {
    kind: 'memory',
    async list(playerId) {
      return sortPlans(rows.filter((p) => p.playerId === playerId)).map((p) => ({ ...p, decks: [...p.decks] }));
    },
    async create(playerId, plan) {
      const stamp = now();
      const row: MatchPlan = {
        id: `mem-plan-${++n}`,
        playerId,
        opponentTag: plan.opponentTag,
        opponentName: plan.opponentName ?? null,
        recommendations: plan.recommendations ?? [],
        engine: plan.engine ?? null,
        generatedAt: plan.generatedAt ?? null,
        status: 'draft',
        confirmedAt: null,
        notes: plan.notes ?? null,
        testMode: plan.testMode ?? false,
        createdAt: stamp,
        updatedAt: stamp,
        decks: [],
      };
      rows = [...rows, row];
      return { ...row };
    },
    async update(id, patch) {
      const p = find(id);
      const next: MatchPlan = {
        ...p,
        ...patch,
        confirmedAt: patch.status === 'confirmed' ? (p.confirmedAt ?? now()) : p.confirmedAt,
        updatedAt: now(),
      };
      rows = rows.map((x) => (x.id === id ? next : x));
      return { ...next };
    },
    async remove(id) {
      rows = rows.filter((x) => x.id !== id);
    },
    async setDeck(planId, deck) {
      const p = find(planId);
      const row: PlanDeck = {
        id: `mem-plandeck-${++n}`,
        planId,
        slot: deck.slot,
        cards: [...deck.cards],
        source: deck.source,
        sourceRef: deck.sourceRef ?? null,
        name: deck.name ?? null,
        createdAt: now(),
      };
      // One deck per slot, as the table's unique (plan_id, slot) enforces.
      const decks = [...p.decks.filter((d) => d.slot !== deck.slot), row];
      rows = rows.map((x) => (x.id === planId ? { ...x, decks, updatedAt: now() } : x));
      return row;
    },
    async clearDeck(planId, slot) {
      const p = find(planId);
      rows = rows.map((x) =>
        x.id === planId ? { ...x, decks: p.decks.filter((d) => d.slot !== slot), updatedAt: now() } : x,
      );
    },
  };
}
