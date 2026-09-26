import { useMemo, useState } from 'react';

import { useAdminStore, type TrackingRequest } from '../../state/adminStore';
import {
  FAMILIES,
  SITE_FAMILIES,
  SITE_FAMILY_IDS,
  dailyStack,
  familyOf,
  familyTotals,
  formatWait,
  shortDay,
  sourceLabel,
  type SourceFamily,
} from '../../state/trackingSources';
import { ago } from '../../utils/format';
import {
  BarRows,
  ChartCard,
  ChartGrid,
  Dashboard,
  DashTabs,
  KeyMetricCard,
  MetricGrid,
  ReadoutList,
  StackedColumns,
  StatusPill,
  type Trend,
} from '../ui/bionis-dashboard';
import { BoltIcon, ClockIcon, RadarIcon, UsersIcon } from '../ui/dash-icons';
import styles from './ConsoleViews.module.css';

/**
 * THE TRACKING VIEW — who was queued for collection, from which screen, and
 * whether the bot has picked them up.
 *
 * WHY IT EXISTS. Since 2026-09-26 every tag the site is asked about is queued
 * and collected from the next poll. The console could say how many tags were
 * WAITING and nothing else — and the queue is empty most of the time (the bot
 * drains it every two hours), so that one figure was almost always 0. The
 * server now keeps what a prune used to delete (`tag_history`), and the bot's
 * own `tracked_players.added_at` says when each player arrived, so this screen
 * can answer the real questions: who was asked for, where, and how long the
 * wait was.
 *
 * EVERY FIGURE IS THE SERVER'S. Nothing is estimated here: the families are a
 * grouping of the raw sources for colour (`trackingSources.ts`), and a day the
 * bot added nobody is drawn as an empty day, not skipped.
 */

const nf = new Intl.NumberFormat('en-US');

const WINDOWS = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
];

type StateFilter = 'all' | 'waiting' | 'collecting';

/** The bot polls every two hours and drains the queue at the start of each
 *  pass, so a request older than this has missed a poll it should have made. */
const OVERDUE_S = 3 * 3600;

export function TrackingView() {
  const tracking = useAdminStore((s) => s.tracking);
  const days = useAdminStore((s) => s.trackingDays);
  const loading = useAdminStore((s) => s.trackingLoading);
  const error = useAdminStore((s) => s.trackingError);
  const loadTracking = useAdminStore((s) => s.loadTracking);
  const [filter, setFilter] = useState<StateFilter>('all');
  const [view, setView] = useState<'all' | 'site'>('all');

  const rows = useMemo(
    () => (tracking ? dailyStack(tracking.daily, tracking.days, tracking.generatedAt.slice(0, 10)) : []),
    [tracking],
  );
  const totals = useMemo(() => familyTotals(rows), [rows]);
  /* The legend lists the families this window actually holds; each keeps its
     own colour whatever else is present. */
  const series = FAMILIES.filter((f) => totals[f.id] > 0).map((f) => ({ key: f.id, label: f.label, color: f.color }));
  /* ASKED ON THE SITE, ON ITS OWN SCALE. A leaderboard run or a Discord batch
     enrols hundreds in a day and the site's requests are one to fourteen, so
     on one axis the thing this view exists for is a row of flat bars. The tab
     keeps the same families and colours and lets the axis fit them. */
  const siteSeries = series.filter((s) => SITE_FAMILIES.has(s.key as SourceFamily));
  const siteTotal = SITE_FAMILY_IDS.reduce((n, f) => n + totals[f], 0);

  const shown = useMemo(
    () => (tracking ? tracking.requests.filter((r) => filter === 'all' || r.state === filter) : []),
    [tracking, filter],
  );

  const addedTrend: Trend | undefined =
    rows.length > 1
      ? {
          values: rows.map((r) => FAMILIES.reduce((n, f) => n + (Number(r[f.id]) || 0), 0)),
          labels: rows.map((r) => shortDay(String(r.x))),
          format: (v) => `${nf.format(v)} added`,
          min: 0,
          label: 'Players added per day',
        }
      : undefined;

  const oldestWaiting = tracking?.requests
    .filter((r) => r.state === 'waiting')
    .reduce<number | null>((min, r) => {
      const t = Date.parse(r.requestedAt);
      return Number.isNaN(t) ? min : min == null ? t : Math.min(min, t);
    }, null);
  const overdue = oldestWaiting != null && (Date.now() - oldestWaiting) / 1000 > OVERDUE_S;

  return (
    <Dashboard className={loading && tracking ? styles.busy : undefined}>
      {/* THE ONE FILTER ROW, above everything it scopes — the dataviz rule:
          one date range, and every figure below re-read against it. */}
      <div className={styles.filterRow}>
        <DashTabs tabs={WINDOWS} value={String(days)} onChange={(id) => void loadTracking(Number(id))} label="Window" />
        {tracking && (
          <span className={styles.asOf}>
            {loading ? 'Refreshing…' : `Read ${ago(tracking.generatedAt)}`} · whole UTC days, today included
          </span>
        )}
      </div>

      {error && (
        <p className="dk-banner" data-tone="bad">
          {error}
        </p>
      )}
      {tracking && !tracking.botRead && (
        <p className="dk-banner" data-tone="bad">
          The bot’s database could not be read, so no request can be marked as collected — every row below
          says waiting, and that is not known to be true.
        </p>
      )}
      {!tracking && !error && <p className={styles.loading}>Reading the queue…</p>}

      {tracking && (
        <>
          <MetricGrid>
            <KeyMetricCard
              label="Waiting now"
              value={nf.format(tracking.queue.waiting)}
              note={
                tracking.queue.waiting > 0
                  ? 'the bot enrols them at the start of its next poll'
                  : 'every request has been collected'
              }
              icon={<RadarIcon />}
              tone={tracking.queue.waiting > 0 ? 'info' : 'good'}
              status={
                tracking.queue.waiting === 0
                  ? { tone: 'good', label: 'Clear' }
                  : overdue
                    ? { tone: 'warn', label: 'Overdue' }
                    : { tone: 'info', label: 'Queued' }
              }
            />
            <KeyMetricCard
              label={`Added · ${tracking.days} days`}
              value={nf.format(tracking.summary.addedWindow)}
              note={`${nf.format(tracking.tracked)} tracked in all`}
              icon={<UsersIcon />}
              tone="info"
              trend={addedTrend}
            />
            <KeyMetricCard
              label="Added · last 24 h"
              value={nf.format(tracking.summary.added24h)}
              note="players the bot started collecting"
              icon={<BoltIcon />}
              tone="good"
            />
            <KeyMetricCard
              label="Median wait"
              value={formatWait(tracking.summary.medianWaitSeconds)}
              note={
                tracking.summary.waitSample
                  ? `request → enrolled, over ${nf.format(tracking.summary.waitSample)} request${tracking.summary.waitSample === 1 ? '' : 's'}`
                  : 'no request collected in this window yet'
              }
              icon={<ClockIcon />}
              status={
                tracking.summary.medianWaitSeconds == null
                  ? undefined
                  : tracking.summary.medianWaitSeconds > OVERDUE_S
                    ? { tone: 'warn', label: 'Slow' }
                    : { tone: 'good', label: 'Next poll' }
              }
            />
          </MetricGrid>

          <ChartCard
            title="Players added to tracking"
            note="Each day’s new players, by where they were asked for"
            badge={
              view === 'site'
                ? `${nf.format(siteTotal)} asked on the site`
                : `${nf.format(tracking.summary.addedWindow)} in ${tracking.days} days`
            }
            tabs={[
              { id: 'all', label: 'All sources' },
              { id: 'site', label: 'Asked on the site' },
            ]}
            tab={view}
            onTabChange={(t) => setView(t as 'all' | 'site')}
            footer={
              view === 'all' && totals.direct > 0 ? (
                <span>
                  <strong>Other</strong> — {FAMILIES.find((f) => f.id === 'direct')?.note}.
                </span>
              ) : undefined
            }
          >
            {(t) =>
              t === 'site' ? (
                <StackedColumns
                  data={rows}
                  series={siteSeries}
                  xFormat={shortDay}
                  tipTitle={shortDay}
                  totalLabel="Asked on the site"
                  label="Players asked for on the site and added to tracking, per day"
                  height={260}
                  empty="Nobody asked for on the site was added in this window."
                />
              ) : (
                <StackedColumns
                  data={rows}
                  series={series}
                  xFormat={shortDay}
                  tipTitle={shortDay}
                  totalLabel="Added"
                  label="Players added to tracking per day, by source"
                  height={260}
                  empty="The bot added nobody in this window."
                />
              )
            }
          </ChartCard>

          <ChartGrid>
            <ChartCard
              title="Requests by screen"
              note="Tags asked for in this window, from the queue and its history"
              badge={`${nf.format(tracking.summary.requested)} requests`}
            >
              <BarRows
                bars={Object.entries(tracking.bySource)
                  .sort((a, b) => b[1].requested - a[1].requested)
                  .map(([src, b]) => ({
                    label: sourceLabel(src),
                    value: b.requested,
                    display: nf.format(b.requested),
                    detail: `${nf.format(b.collecting)} collecting · ${nf.format(b.waiting)} waiting`,
                    /* The family's colour, as in the legend above — the same
                       source is never two colours on one screen. */
                    color: FAMILIES.find((f) => f.id === familyOf(src))?.color,
                  }))}
                empty="No tag was asked for in this window."
              />
            </ChartCard>

            <ChartCard title="How the queue drains" note="The limits the bot and the recruiter work to">
              <ReadoutList
                rows={[
                  {
                    id: 'batch',
                    label: 'Taken per poll, oldest first',
                    value: tracking.drainBatch != null ? nf.format(tracking.drainBatch) : '—',
                  },
                  {
                    id: 'cap',
                    label: 'Bulk sources may fill',
                    value: tracking.bulkQueueCap != null ? nf.format(tracking.bulkQueueCap) : '—',
                  },
                  { id: 'rows', label: 'Rows in the queue now', value: nf.format(tracking.queue.rows) },
                  { id: 'tracked', label: 'Players the bot collects', value: nf.format(tracking.tracked) },
                ]}
              />
              <p className={styles.small}>
                The recruiter stops at the bulk cap, so a quarter of every poll is always left for tags
                searched on the site — a new tag is collected on the next poll.
              </p>
            </ChartCard>
          </ChartGrid>

          <ChartCard
            title="Requests"
            note="Newest first"
            tabs={[
              { id: 'all', label: `All · ${nf.format(tracking.summary.requested)}` },
              { id: 'waiting', label: `Waiting · ${nf.format(tracking.summary.waiting)}` },
              { id: 'collecting', label: `Collecting · ${nf.format(tracking.summary.collecting)}` },
            ]}
            tab={filter}
            onTabChange={(t) => setFilter(t as StateFilter)}
            footer={
              tracking.truncated ? (
                <span>
                  Showing the newest {nf.format(tracking.requests.length)} of {nf.format(tracking.summary.requested)} —
                  the counts above cover all of them.
                </span>
              ) : undefined
            }
          >
            {shown.length === 0 ? (
              <p className="bd-empty">
                {filter === 'waiting' ? 'Nothing is waiting — every request has been collected.' : 'No request in this window.'}
              </p>
            ) : (
              <RequestTable rows={shown} />
            )}
          </ChartCard>
        </>
      )}
    </Dashboard>
  );
}

function RequestTable({ rows }: { rows: TrackingRequest[] }) {
  return (
    <div className="bd-tableWrap">
      <table className="bd-table">
        <caption className="sr-only">Tags queued for collection in this window</caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Asked from</th>
            <th scope="col">Requested</th>
            <th scope="col">State</th>
            <th scope="col" data-num="">
              Wait
            </th>
            <th scope="col" data-num="">
              Asks
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const family = FAMILIES.find((f) => f.id === familyOf(r.source));
            return (
              <tr key={r.tag}>
                <td>
                  <span className={styles.player}>
                    <strong>{r.name || r.tag}</strong>
                    {r.name && <span className={styles.tag}>{r.tag}</span>}
                  </span>
                </td>
                <td>
                  <span className={styles.source}>
                    <i style={{ background: family?.color }} aria-hidden="true" />
                    {sourceLabel(r.source)}
                  </span>
                </td>
                <td title={new Date(r.requestedAt).toLocaleString('en-GB')}>{ago(r.requestedAt)}</td>
                <td>
                  {r.state === 'collecting' ? (
                    <StatusPill tone="good">{r.alreadyTracked ? 'Already collected' : 'Collecting'}</StatusPill>
                  ) : (
                    <StatusPill tone="info">Waiting</StatusPill>
                  )}
                </td>
                <td data-num="">{r.alreadyTracked ? '—' : formatWait(r.waitSeconds)}</td>
                <td data-num="">{nf.format(r.hits)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
