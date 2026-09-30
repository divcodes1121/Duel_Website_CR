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
    artFilled?: string[];
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
    artFilled?: string[];
    affinity?: { shared: number; of: number; deckBattles: number; familiar: boolean };
  }[];
  /** TODAY'S SESSION (`server/coach_session.py`) — the part that changes
   *  daily. Structural copy of `analyticsClient.DailySession`, only the
   *  fields a row reads, because this file takes no imports. */
  session?: {
    day: string;
    since: string;
    focus: {
      name: string;
      why: 'lost_recently' | 'rotation' | 'field_rotation';
      recent: { battles: number; wins: number; losses: number } | null;
      excessLosses?: number;
      rotation: { index: number; of: number; next: string } | null;
    } | null;
    practise: {
      key: string;
      name: string;
      expectedWinRate: number;
      cards?: string[];
      art?: Record<string, 'evolution' | 'hero'>;
      artInferred?: boolean;
      artFilled?: string[];
      vsFocus: { winRate: number };
      source: 'their-cards' | 'field';
      shared?: number | null;
      deckBattles?: number | null;
    } | null;
  } | null;
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
    /** Forms filled in because the deck can field them, not observed. */
    artFilled?: string[];
    /** Cards shared with one of their own decks, and how much they play it.
     *  Present only when the pick IS one of theirs. */
    shared?: number;
    deckBattles?: number;
    /** The pick's rate against today's focus, when it came from the session. */
    vsFocus?: number;
  } | null;
  /** Today's one matchup and why — the line that changes day to day. Null on
   *  an older server or when there is nothing to drill. */
  focus: { name: string; line: string } | null;
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
      tag, label, kind: 'failed', pick: null, workOn: [], tailoredPicks: 0, source: 'field', focus: null,
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
  /* TODAY'S PRACTICE DECK FIRST. `closest[0]` is the best deck from their
     cards against the field over thirty days, and a thirty-day answer barely
     moves: measured, the same deck five days running for seven of eight real
     roster players, which is what "the daily practice does not change" was.
     The session's deck is chosen against TODAY'S matchup, so it moves when
     the focus does. */
  const s = plan.session?.practise;
  const focus = focusLine(plan.session);
  const mine = plan.closest?.[0];
  const top = mine ?? plan.recommendations[0];
  const pick = s
    ? {
        key: s.key,
        name: s.name,
        expectedWinRate: s.expectedWinRate,
        cards: s.cards ?? [],
        art: s.art,
        artInferred: s.artInferred,
        artFilled: s.artFilled,
        shared: s.source === 'their-cards' ? (s.shared ?? undefined) : undefined,
        deckBattles: s.source === 'their-cards' ? (s.deckBattles ?? undefined) : undefined,
        vsFocus: s.vsFocus.winRate,
      }
    : top
      ? {
          key: top.key,
          name: top.name,
          expectedWinRate: top.expectedWinRate,
          cards: top.cards ?? [],
          art: top.art,
          artInferred: top.artInferred,
          artFilled: top.artFilled,
          shared: mine?.affinity?.shared,
          deckBattles: mine?.affinity?.deckBattles,
        }
      : null;
  const source: TodayRow['source'] = s
    ? s.source === 'their-cards' ? 'their-deck' : 'field'
    : mine ? 'their-deck' : 'field';
  const workOn = plan.weighted.slice(0, 3).map((w) => w.name);

  if (!pick) {
    return {
      tag, label, kind: 'failed', pick: null, workOn, tailoredPicks: 0, source: 'field', focus,
      note: 'Nothing in the pool could be ranked against the field today.',
    };
  }

  if (plan.basis === 'no_history') {
    return { tag, label, kind: 'new', pick, workOn: [], tailoredPicks: 0, source, focus,
      note: 'Nothing stored for them yet — this is the field’s answer, not theirs.' };
  }
  if (plan.basis === 'unweighted') {
    return { tag, label, kind: 'field', pick, workOn: [], tailoredPicks: 0, source, focus,
      note: `None of their ${plan.battles.toLocaleString('en-US')} battles gives an archetype enough evidence to weight yet.` };
  }
  /* THE PICK IS ONE OF THEIRS, so the row says why it is theirs rather than
     quoting `tailoredPicks` — a figure about the OTHER list, which measured 0
     for five of six real accounts and made every row read the same. */
  if (source === 'their-deck' && pick) {
    return {
      tag, label, kind: 'tailored', pick, workOn,
      tailoredPicks: plan.tailoredPicks, source, focus,
      note: pick.shared != null && pick.deckBattles != null
        ? `${pick.shared} of 8 cards are in a deck they have played ${pick.deckBattles} times.`
        : 'Built from cards they already play.',
    };
  }
  if (plan.tailoredPicks > 0) {
    return { tag, label, kind: 'tailored', pick, workOn, tailoredPicks: plan.tailoredPicks, source, focus,
      note: `${plan.tailoredPicks} of ${plan.recommendations.length} picks ${plan.tailoredPicks === 1 ? 'is' : 'are'} here because of their own record.` };
  }
  return { tag, label, kind: 'ordered', pick, workOn, tailoredPicks: 0, source, focus,
    note: 'Nothing they play is close to the field’s answers — this is the field’s deck.' };
}

/** `2026-09-30` -> `30 Sep`. Split, never parsed through the local clock, so
 *  a reader west of UTC is not shown the day before. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d || m > 12) return iso;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${MONTHS[m - 1]}`;
}

/** Today's focus as one line of figures. A focus from yesterday's games prints
 *  the counts (evidence); a rotation prints its place in the schedule (a
 *  schedule) — never the one dressed as the other. */
export function focusLine(session: TodayPlanInput['session']): TodayRow['focus'] {
  const f = session?.focus;
  if (!session || !f) return null;
  if (f.why === 'lost_recently' && f.recent) {
    const extra = f.excessLosses != null ? ` · ${f.excessLosses.toFixed(1)} more losses than usual` : '';
    return { name: f.name, line: `${f.recent.wins}–${f.recent.losses} since ${formatDay(session.since)}${extra}` };
  }
  if (f.rotation) {
    const kind = f.why === 'field_rotation' ? 'field rotation' : 'rotation';
    return { name: f.name, line: `${kind} day ${f.rotation.index} of ${f.rotation.of} · next ${f.rotation.next}` };
  }
  return { name: f.name, line: '' };
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
