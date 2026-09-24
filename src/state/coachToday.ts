/**
 * THE ROSTER'S DAY — one line per player, from the field plan.
 *
 * NO IMPORTS, the `tiers.ts` rule. What a coach is told about five players at
 * once is exactly the part that must be testable without a store or a client.
 *
 * ── IT IS LOADED ON DEMAND, AND THAT IS THE CONTRACT, NOT A PREFERENCE ─────
 *
 * `coachOverview.ts` states plainly that **nothing on the roster summary reads
 * the analytics API** — "fetching each player's battle intelligence to build a
 * roster summary would put one expensive database scan per player behind a
 * screen nobody asked to be expensive". That rule still holds. This board is
 * therefore a BUTTON on that screen rather than part of its load: a coach who
 * wants the day's plans asks for them, and the overview stays as cheap as it
 * was. Measured live: five brief plans in parallel, 2.4 s, 8.8 kB each.
 *
 * ── A ROW MUST NOT CLAIM MORE THAN ITS PLAN DOES ───────────────────────────
 *
 * The field plan reports `basis` and `tailoredPicks` precisely because the
 * weighting usually moves the ORDER rather than the SET — measured across the
 * live roster it changes 0 to 1 of 7 picks. A board that printed every row
 * identically would turn that honest engine into a claim it never made, so
 * each row carries its own `kind` and the summary counts them apart.
 */

export type TodayKind =
  /** Their own record moved the ranking, and at least one pick is here because of it. */
  | 'tailored'
  /** Weighted, but the same decks the field alone suggests — order only. */
  | 'ordered'
  /** They have history; none of it clears the evidence floor. */
  | 'field'
  /** Nothing stored for them yet. */
  | 'new'
  /** The plan could not be read. NOT the same as having no plan. */
  | 'failed';

export interface TodayPlanInput {
  basis: 'weighted' | 'unweighted' | 'no_history' | 'none';
  battles: number;
  tailoredPicks: number;
  recommendations: {
    key: string;
    name: string;
    expectedWinRate: number;
    cards?: string[];
    /** The seating the SERVER computed. Carried through, because the board
     *  draws these cards and without it every one renders in its base form. */
    art?: Record<string, 'evolution' | 'hero'>;
    artInferred?: boolean;
    fromWeighting?: boolean;
  }[];
  weighted: { archetype: string; name: string; battles: number; winRate: number; deficit: number }[];
  /** The best deck built from cards THIS player already runs. One entry in
   *  `brief`, which is what a roster row draws. */
  closest?: {
    key: string;
    name: string;
    expectedWinRate: number;
    cards?: string[];
    art?: Record<string, 'evolution' | 'hero'>;
    artInferred?: boolean;
    affinity?: { shared: number; of: number; deckBattles: number; familiar: boolean };
  }[];
}

export interface TodayRow {
  tag: string;
  label: string;
  kind: TodayKind;
  /** The one deck to put in front of them, or null when there is no plan. */
  pick: {
    key: string;
    name: string;
    expectedWinRate: number;
    cards: string[];
    /* THE TYPE USED TO DROP THESE, so the board could not draw an evolution,
       a hero or a champion even though the server had seated them — the art
       was on the payload and thrown away one type earlier. */
    art?: Record<string, 'evolution' | 'hero'>;
    artInferred?: boolean;
    /** Cards shared with one of their own decks, and how much they play it.
     *  Present only when the pick IS one of theirs. */
    shared?: number;
    deckBattles?: number;
  } | null;
  /** What the weighting moved toward, worst first. Empty is a real answer. */
  workOn: string[];
  /** One short sentence. Never an adjective the plan cannot carry. */
  note: string;
  tailoredPicks: number;
  /** Where the pick came from. `their-deck` is the only one that is about
   *  this player rather than about the field. */
  source: 'their-deck' | 'field';
}

/** Plans that could not be read are their own kind — a coach must be able to
 *  tell "no plan" from "we could not ask". */
export function todayRow(
  tag: string,
  label: string,
  plan: TodayPlanInput | null,
): TodayRow {
  if (!plan || plan.basis === 'none') {
    return {
      tag, label, kind: 'failed', pick: null, workOn: [], tailoredPicks: 0, source: 'field',
      note: 'Their plan could not be worked out just now.',
    };
  }

  /* THE PERSONAL DECK FIRST, AND THIS IS THE WHOLE POINT OF THE ROW.
     It used to be `recommendations[0]` — the diversified top pick, which
     `diversify()` makes the best deck of the strongest archetype, the same
     deck for every player. Six roster rows drew six identical Balloon decks.
     `closest[0]` is the best answer built from cards this player actually
     runs, so it differs by construction; the field's pick is the fallback
     when they have nothing close, which is a real state and is labelled. */
  const mine = plan.closest?.[0];
  const top = mine ?? plan.recommendations[0];
  const source: TodayRow['source'] = mine ? 'their-deck' : 'field';
  const pick = top
    ? {
        key: top.key,
        name: top.name,
        expectedWinRate: top.expectedWinRate,
        cards: top.cards ?? [],
        art: top.art,
        artInferred: top.artInferred,
        shared: mine?.affinity?.shared,
        deckBattles: mine?.affinity?.deckBattles,
      }
    : null;
  const workOn = plan.weighted.slice(0, 3).map((w) => w.name);

  if (!pick) {
    return {
      tag, label, kind: 'failed', pick: null, workOn, tailoredPicks: 0, source: 'field',
      note: 'Nothing in the pool could be ranked against the field today.',
    };
  }

  if (plan.basis === 'no_history') {
    return { tag, label, kind: 'new', pick, workOn: [], tailoredPicks: 0, source,
      note: 'Nothing stored for them yet — this is the field’s answer, not theirs.' };
  }
  if (plan.basis === 'unweighted') {
    return { tag, label, kind: 'field', pick, workOn: [], tailoredPicks: 0, source,
      note: `None of their ${plan.battles.toLocaleString('en-US')} battles gives an archetype enough evidence to weight yet.` };
  }
  /* THE PICK IS ONE OF THEIRS, so the row says why it is theirs rather than
     quoting `tailoredPicks` — a figure about the OTHER list, which measured 0
     for five of six real accounts and made every row read the same. */
  if (source === 'their-deck' && pick) {
    return {
      tag, label, kind: 'tailored', pick, workOn,
      tailoredPicks: plan.tailoredPicks, source,
      note: pick.shared != null && pick.deckBattles != null
        ? `${pick.shared} of 8 cards are in a deck they have played ${pick.deckBattles} times.`
        : 'Built from cards they already play.',
    };
  }
  if (plan.tailoredPicks > 0) {
    return { tag, label, kind: 'tailored', pick, workOn, tailoredPicks: plan.tailoredPicks, source,
      note: `${plan.tailoredPicks} of ${plan.recommendations.length} picks ${plan.tailoredPicks === 1 ? 'is' : 'are'} here because of their own record.` };
  }
  return { tag, label, kind: 'ordered', pick, workOn, tailoredPicks: 0, source,
    note: 'Nothing they play is close to the field’s answers — this is the field’s deck.' };
}

export interface TodaySummary {
  players: number;
  tailored: number;
  ordered: number;
  field: number;
  fresh: number;
  failed: number;
  /** One sentence for the whole roster. Counts only. */
  line: string;
}

export function todaySummary(rows: TodayRow[]): TodaySummary {
  const n = (k: TodayKind) => rows.filter((r) => r.kind === k).length;
  const tailored = n('tailored');
  const ordered = n('ordered');
  const field = n('field');
  const fresh = n('new');
  const failed = n('failed');
  const withPlan = rows.length - failed;

  const parts: string[] = [];
  if (withPlan > 0) parts.push(`${withPlan} of ${rows.length} have a plan for today`);
  if (tailored > 0) parts.push(`${tailored} shaped by their own record`);
  if (ordered > 0) parts.push(`${ordered} re-ordered by it`);
  if (field + fresh > 0) parts.push(`${field + fresh} on the field’s answer alone`);
  if (failed > 0) parts.push(`${failed} could not be read`);

  return {
    players: rows.length,
    tailored, ordered, field, fresh, failed,
    line: parts.length ? `${parts.join(' · ')}.` : 'No active players on the roster.',
  };
}

/** Roster order, then worst-prepared first is DELIBERATELY NOT DONE. The
 *  roster's contract is counts, never a ranking — attention is a flag on a
 *  row, and re-ordering players by how tailored their plan is would invite the
 *  comparison this data cannot support. The caller passes them in roster order
 *  and they stay in it. */
export const TODAY_ORDER = 'roster' as const;
