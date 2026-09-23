import { useEffect, useMemo } from 'react';

import { coachHref, playerLabel, type CoachSection, type RosterPlayer } from '../../../state/coachRoster';
import {
  FLAG_ACTION,
  FLAG_LABEL,
  sortOverview,
  totals,
  type AttentionFlag,
  type OverviewRow,
} from '../../../state/coachOverview';
import { useCoachOverview } from '../../../state/coachOverviewStore';
import { ReadingState } from '../../Analytics/ReadingState';
import {
  BadgeIcon,
  CardsIcon,
  ListIcon,
  TargetIcon,
  TrendIcon,
} from '../../Dashboard/icons';
import {
  BarRows,
  ChartCard,
  ChartGrid,
  Dashboard,
  DashboardHeader,
  DashHero,
  InsightCard,
  InsightGrid,
  InsightRow,
  KeyMetricCard,
  MetricGrid,
  ReadoutList,
  ScoreDonut,
  type Bar,
  type DashTone,
} from '../../ui/bionis-dashboard';
import { TodayBoard } from './TodayBoard';
import styles from './CoachRoster.module.css';

/**
 * THE WHOLE ROSTER AT ONCE — what a coach opens first, on the bionis
 * dashboard layout.
 *
 * IT COUNTS; IT DOES NOT RANK, and moving it onto a dashboard did not change
 * that. The order is still the roster's own, so this screen and the rail
 * never disagree about where somebody is, and attention is still flags on a
 * row.
 *
 * **THE RING IS NOT A READINESS SCORE.** The layout this is ported from puts
 * an "Overall Wellness" number out of a hundred at its centre, and a number
 * like that is the one thing this screen's contract forbids: it would invite
 * comparing players who have different amounts of stored history. The ring
 * here measures the COACH'S OWN COVERAGE — how many active players have
 * nothing outstanding — and its caption says so in words. No per-player
 * figure is a score, and nothing is sorted by one.
 *
 * Every chart is a count of something the coach did or did not do. Nothing
 * reads the analytics API; see `coachOverviewStore`.
 */

export function RosterOverview({ players }: { players: RosterPlayer[] }) {
  const rows = useCoachOverview((s) => s.rows);
  const loading = useCoachOverview((s) => s.loading);
  const error = useCoachOverview((s) => s.error);
  const load = useCoachOverview((s) => s.load);

  useEffect(() => {
    void load(players);
  }, [players, load]);

  const sorted = useMemo(() => (rows ? sortOverview(rows) : []), [rows]);
  const sum = useMemo(() => (rows ? totals(rows) : null), [rows]);
  const shape = useMemo(() => (rows ? describe(rows) : null), [rows]);

  if (!rows && loading) {
    return (
      <ReadingState k="coach-overview" hue="violet">
        Reading your roster…
      </ReadingState>
    );
  }

  const clear = sum ? sum.players - sum.needingAttention : 0;

  return (
    <Dashboard className={styles.overview}>
      <DashboardHeader
        title="Your roster"
        subtitle="Counts of your own preparation. Nothing here is a rating of a player."
      />

      {error && <p className={styles.formError}>{error}</p>}

      {sum && shape && (
        <>
          <DashHero
            heading="Where the work is"
            badge={sum.needingAttention === 0 ? 'Nothing outstanding' : `${sum.needingAttention} need something`}
            badgeTone={sum.needingAttention === 0 ? 'good' : 'warn'}
            figure={
              <ScoreDonut
                value={clear}
                max={Math.max(1, sum.players)}
                display={`${clear}/${sum.players}`}
                tone={sum.needingAttention === 0 ? 'good' : 'info'}
                caption={
                  sum.players === 0
                    ? 'No active players yet.'
                    : `${clear} of ${sum.players} active ${sum.players === 1 ? 'player has' : 'players have'} nothing outstanding. This is a count of your preparation, not a rating of anybody.`
                }
              />
            }
          >
            {sum.players === 0
              ? 'Add a player on the left to start.'
              : sum.needingAttention === 0
                ? 'Every active player has decks approved and is being collected.'
                : 'The flags below name what is missing and where to fix it. They are in roster order — nothing is ranked.'}
          </DashHero>

          <MetricGrid>
            <KeyMetricCard
              label="Players"
              value={String(sum.players)}
              note="active on the roster"
              icon={<ListIcon />}
            />
            <KeyMetricCard
              label="With an arsenal"
              value={`${sum.withArsenal} of ${sum.players}`}
              note="have at least one deck approved"
              tone={sum.withArsenal === sum.players ? 'good' : 'neutral'}
              icon={<CardsIcon />}
            />
            <KeyMetricCard
              label="Decks approved"
              value={String(sum.decks)}
              note="across the active roster"
              icon={<TargetIcon />}
            />
            <KeyMetricCard
              label="Needing something"
              value={String(sum.needingAttention)}
              note={sum.needingAttention === 0 ? 'nothing outstanding' : 'flagged on their row below'}
              tone={sum.needingAttention > 0 ? 'warn' : 'good'}
              icon={<TrendIcon />}
            />
          </MetricGrid>

          <ChartGrid>
            {/* THE STEP FUNNEL IS GONE WITH PLANS AND RESULTS. One remaining
                step is not a funnel; a chart of a single bar is decoration. */}
            <ChartCard
              title="What is outstanding"
              note="Every flag on the roster, counted. Each one names an action on the row it belongs to."
              badge={shape.flagTotal === 0 ? 'All clear' : `${shape.flagTotal} in total`}
            >
              <BarRows bars={shape.flags} empty="No flags — nothing is outstanding." />
            </ChartCard>

            <ChartCard
              title="Decks approved"
              note="Per active player. A count of the coach's own work, not a comparison between players."
              badge={`${sum.decks} in total`}
            >
              <BarRows bars={shape.perPlayer} empty="No decks approved yet." />
            </ChartCard>
          </ChartGrid>

          <InsightGrid>
            <InsightCard title="What to do next" icon={<TargetIcon />} tone="info" badge="In workflow order">
              {shape.actions.length === 0 ? (
                <InsightRow
                  title="Nothing outstanding"
                  description="Every active player has decks approved and is being collected."
                  tone="good"
                />
              ) : (
                shape.actions.map((a) => (
                  /* The flag names what is true; the action says where to fix
                     it. Both, or neither. */
                  <InsightRow
                    key={a.flag}
                    title={`${FLAG_LABEL[a.flag]} — ${a.count} ${a.count === 1 ? 'player' : 'players'}`}
                    description={FLAG_ACTION[a.flag]}
                    tone="neutral"
                  />
                ))
              )}
            </InsightCard>

            <InsightCard title="The roster" icon={<BadgeIcon />} tone="neutral" badge="Roster order">
              <ReadoutList
                rows={[
                  { id: 'active', label: 'Active', value: String(sum.players) },
                  { id: 'archived', label: 'Archived', value: String(shape.archived) },
                  { id: 'decks', label: 'Decks approved', value: String(sum.decks) },
                ]}
              />
              <p className={styles.muted}>
                Active players first, then alphabetically — the same order as the rail. Attention is a flag on a row,
                never a higher position.
              </p>
            </InsightCard>
          </InsightGrid>
        </>
      )}

      {sorted.length === 0 ? (
        <section className={styles.notice}>
          <h3>No players yet</h3>
          <p>Add a player on the left to start.</p>
        </section>
      ) : (
        <ul className={styles.arsenalList}>
          {sorted.map((row) => (
            <RosterRow key={row.player.id} row={row} />
          ))}
        </ul>
      )}

      {/* LAST, AND ON DEMAND. Everything above is the coach's own rows, read in
          ONE cheap query; this one calls the analytics service once per
          active player. The contract at the top of `coachOverview.ts` — that
          nothing on this screen reads that API — is kept by making it a button
          rather than part of the load. */}
      <TodayBoard players={players} />
    </Dashboard>
  );
}

/* ── what the dashboard draws ──────────────────────────────────────────── *
 * Derived here rather than in `coachOverview.ts` on purpose: that module is
 * the contract-bearing one and its tests describe exactly what it returns.
 * Everything below is a re-shaping of rows it already produced.
 */

const FLAG_TONE: Record<AttentionFlag, DashTone> = {
  not_collected: 'neutral',
  no_arsenal: 'warn',
};

/** Workflow order, so the list reads as the order the work happens in. */
const FLAG_ORDER: AttentionFlag[] = ['not_collected', 'no_arsenal'];

function describe(rows: readonly OverviewRow[]) {
  const active = rows.filter((r) => r.player.isActive);
  const counted = (f: AttentionFlag) => active.filter((r) => r.flags.includes(f)).length;

  const flags: Bar[] = FLAG_ORDER.map((f) => ({
    label: FLAG_LABEL[f],
    value: counted(f),
    tone: FLAG_TONE[f],
  })).filter((b) => b.value > 0);

  /* Per player, in roster order — the same order the rows below read in, so
     a bar and a row cannot disagree about who is who. NOT sorted by count:
     this screen counts, it does not rank. */
  const perPlayer: Bar[] = active.map((r) => ({
    label: r.player.displayName || r.player.playerTag,
    value: r.arsenal,
    tone: r.arsenal > 0 ? 'info' : 'warn',
  }));

  return {
    flags,
    perPlayer,
    flagTotal: flags.reduce((n, b) => n + b.value, 0),
    actions: FLAG_ORDER.map((f) => ({ flag: f, count: counted(f) })).filter((a) => a.count > 0),
    archived: rows.length - active.length,
  };
}

function RosterRow({ row }: { row: OverviewRow }) {
  const { player } = row;
  return (
    <li className={styles.arsenalItem} data-archived={!player.isActive || undefined}>
      <div className={styles.rosterRow}>
        <a className={styles.rosterLink} href={coachHref(player.playerTag, 'overview')}>
          <span className={styles.deckName}>{playerLabel(player)}</span>
          <span className={styles.oppTag}>{player.playerTag}</span>
          {!player.isActive && <span className={styles.archivedBadge}>Archived</span>}
        </a>

        <span className={styles.rosterFigures}>
          {/* "Last touched" was the newest plan or result timestamp, and both
              are gone — there is no activity clock in the coaching tables any
              more. An invented one would be worse than none. */}
          <CountLink player={player} section="arsenal" n={row.arsenal} one="deck" many="decks" />
          <a className={styles.rowLink} href={coachHref(player.playerTag, 'practise')}>
            Today’s plan →
          </a>
        </span>
      </div>

      {row.flags.length > 0 && (
        <ul className={styles.flagList}>
          {row.flags.map((f) => (
            <li key={f} className={styles.flagRow}>
              <span className={styles.flagLabel}>{FLAG_LABEL[f]}</span>
              <span className={styles.muted}>{FLAG_ACTION[f]}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/* BOTH FORMS ARE PASSED IN. Appending an "s" produced "0 matchs" — English
   plurals are not a rule this component gets to invent. */
function CountLink({
  player,
  section,
  n,
  one,
  many,
}: {
  player: RosterPlayer;
  section: CoachSection;
  n: number;
  one: string;
  many: string;
}) {
  return (
    <a className={styles.rowLink} href={coachHref(player.playerTag, section)}>
      {n} {n === 1 ? one : many}
    </a>
  );
}
