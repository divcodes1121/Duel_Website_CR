import { useMemo, useState } from 'react';

import { useAdminStore } from '../../state/adminStore';
import { backupVerdict, botAgreementVerdict, retentionRunVerdict } from '../../state/consoleHealth';
import {
  bytesPerBattle,
  daysBetween,
  expirySchedule,
  firstDeletion,
  intakePerDay,
  isoDay,
  lastRun,
  latestPulled,
  latestVerified,
  longDay,
  monthLabel,
  projectAt,
  transactions,
  type BackupRecord,
  type Projection,
} from '../../state/dataLifecycle';
import { shortDay } from '../../state/trackingSources';
import { ago, bytes } from '../../utils/format';
import {
  BarRows,
  ChartCard,
  ChartGrid,
  Dashboard,
  DashTable,
  DashTabs,
  KeyMetricCard,
  MetricGrid,
  ReadoutList,
  StackedColumns,
  StatusPill,
  TrendChart,
  type Trend,
} from '../ui/bionis-dashboard';
import { ArchiveIcon, ClockIcon, DatabaseIcon, LayersIcon } from '../ui/dash-icons';
import styles from './ConsoleViews.module.css';

/**
 * THE DATA LIFECYCLE VIEW — what comes into the database, what the rolling
 * retention job takes out of it, and whether a copy of it exists off the box.
 *
 * THE RULE IT SHOWS: a battle is kept for the retention window (304 days = 10
 * months) counted from the day it was PLAYED, and is removed on the next day —
 * one battle-day at a time, oldest first, never a whole range at once
 * (`server/retention.py`). So every player keeps their own last ten months.
 *
 * EVERYTHING HERE IS THE LEDGER'S (`server/.data_ledger.db`), written by the two
 * jobs; the route never reads the 57 GB database. The one estimate on the
 * screen — the capacity at a full window — says it is one, and shows its
 * inputs.
 */

const nf = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

const WINDOWS = [
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: '365', label: '1 year' },
];

const MONTHS = (days: number) => `${Math.round(days / 30.4)} months`;

export function LifecycleView() {
  const report = useAdminStore((s) => s.lifecycle);
  const days = useAdminStore((s) => s.lifecycleDays);
  const loading = useAdminStore((s) => s.lifecycleLoading);
  const error = useAdminStore((s) => s.lifecycleError);
  const loadLifecycle = useAdminStore((s) => s.loadLifecycle);
  const [flow, setFlow] = useState<'battles' | 'players'>('battles');

  const retentionDays = report?.settings?.retentionDays ?? report?.latest?.retention_days ?? 304;
  const today = new Date().toISOString().slice(0, 10);
  const latest = report?.latest ?? null;

  const rows = useMemo(() => (report ? transactions(report, days, today) : []), [report, days, today]);
  const schedule = useMemo(() => expirySchedule(latest?.forecast, retentionDays), [latest, retentionDays]);
  const intake = useMemo(() => (report ? intakePerDay(report) : null), [report]);
  const proj10 = projectAt(latest, intake, retentionDays);
  const alt = retentionDays === 365 ? 304 : 365;
  const projAlt = projectAt(latest, intake, alt);

  const first = firstDeletion(latest?.oldest_battle, retentionDays);
  const untilFirst = first ? daysBetween(today, first) : null;
  const verified = report ? latestVerified(report.backups) : null;
  const pulled = report ? latestPulled(report.backups) : null;
  const backup = backupVerdict(verified?.finished_at, pulled?.pulled_at);
  const retRun = report ? lastRun(report.runs, 'retention') : null;
  const runV = retentionRunVerdict(retRun);
  const botV = botAgreementVerdict(report?.settings);
  const lastPurge = report?.purges.length ? report.purges[report.purges.length - 1] : null;

  const storedTrend: Trend | undefined =
    report && report.snapshots.length > 1
      ? {
          values: report.snapshots.map((s) => s.battles_total ?? 0),
          labels: report.snapshots.map((s) => shortDay(s.date)),
          format: (v) => `${nf.format(v)} battles`,
          label: 'Battles stored',
        }
      : undefined;

  return (
    <Dashboard className={loading && report ? styles.busy : undefined}>
      <div className={styles.filterRow}>
        <DashTabs tabs={WINDOWS} value={String(days)} onChange={(id) => void loadLifecycle(Number(id))} label="Window" />
        {latest && (
          <span className={styles.asOf}>
            {loading ? 'Refreshing…' : `Database read ${ago(latest.taken_at)}`} · whole UTC days
          </span>
        )}
      </div>

      {error && (
        <p className="dk-banner" data-tone="bad">
          {error}
        </p>
      )}
      {runV && runV.tone === 'bad' && retRun && (
        <p className="dk-banner" data-tone="bad">
          {runV.label}: {String((retRun.detail.plan as { refused?: string } | undefined)?.refused ?? retRun.detail.message ?? retRun.status)}.
          Battles past the window are not being removed until this clears.
        </p>
      )}
      {!report && !error && <p className={styles.loading}>Reading the ledger…</p>}

      {report && (
        <>
          <MetricGrid>
            <KeyMetricCard
              label="Kept for"
              value={`${nf.format(retentionDays)} days`}
              note={`${MONTHS(retentionDays)} from the day each battle was played · ${report.settings?.maxDaysPerRun ?? 3} days at most per run`}
              icon={<ClockIcon />}
              tone="info"
              status={botV ?? undefined}
            />
            {lastPurge ? (
              <KeyMetricCard
                label={`Deleted · ${shortDay(lastPurge.run_date)}`}
                value={compact.format(report.purges.filter((p) => p.run_date === lastPurge.run_date).reduce((n, p) => n + p.battles, 0))}
                note={`battles from ${longDay(lastPurge.day)} · ${nf.format(lastPurge.tags)} players, ${nf.format(lastPurge.tags_gone)} with nothing newer`}
                icon={<LayersIcon />}
                tone="warn"
                status={runV ?? undefined}
              />
            ) : (
              <KeyMetricCard
                label="First deletion"
                value={first ? longDay(first) : '—'}
                note={
                  first && untilFirst != null
                    ? `in ${nf.format(untilFirst)} days · the battles of ${longDay(isoDay(latest?.oldest_battle))} go first`
                    : 'nothing is stored yet'
                }
                icon={<LayersIcon />}
                tone="info"
                status={runV ?? undefined}
              />
            )}
            <KeyMetricCard
              label="Battles stored"
              value={latest?.battles_total != null ? compact.format(latest.battles_total) : '—'}
              note={
                latest
                  ? `since ${longDay(isoDay(latest.oldest_battle))} · ${latest.tracked_players != null ? `${nf.format(latest.tracked_players)} players tracked` : ''}`
                  : undefined
              }
              icon={<DatabaseIcon />}
              tone="info"
              trend={storedTrend}
            />
            <KeyMetricCard
              label="Off-box backup"
              value={pulled?.pulled_at ? ago(pulled.pulled_at) : 'None yet'}
              note={
                verified
                  ? `newest copy ${ago(verified.finished_at)} · ${verified.zst_bytes ? bytes(verified.zst_bytes) : '—'} compressed`
                  : 'no verified copy on the VPS'
              }
              icon={<ArchiveIcon />}
              tone={backup.tone === 'good' ? 'good' : 'warn'}
              status={backup}
            />
          </MetricGrid>

          <ChartCard
            title="Data in and out"
            note={
              flow === 'battles'
                ? 'Battles written since the previous reading, and battles the retention job removed, per day'
                : 'Players whose oldest day was removed, and those left with nothing newer stored'
            }
            badge={`${nf.format(report.totals.battlesPurged)} deleted in all`}
            tabs={[
              { id: 'battles', label: 'Battles' },
              { id: 'players', label: 'Players affected' },
            ]}
            tab={flow}
            onTabChange={(t) => setFlow(t as 'battles' | 'players')}
            footer={
              report.totals.daysPurged === 0 ? (
                <span>
                  Nothing has been deleted yet{first ? ` — the first battle-day expires on ${longDay(first)}` : ''}. Until
                  then the deleted line stays at zero.
                </span>
              ) : undefined
            }
          >
            {(t) =>
              t === 'players' ? (
                <StackedColumns
                  data={rows}
                  series={[
                    { key: 'tagsGone', label: 'Nothing newer stored', color: 'var(--chart-3)' },
                    { key: 'tags', label: 'Players who lost a day', color: 'var(--chart-2)' },
                  ]}
                  xFormat={shortDay}
                  tipTitle={shortDay}
                  totalLabel="Players"
                  label="Players affected by retention per day"
                  height={240}
                  empty="No player lost a day in this window."
                />
              ) : (
                <TrendChart
                  /* Nothing measured yet — one reading has no intake to report
                     and nothing has been deleted — is said in words, not drawn
                     as a flat line at zero. */
                  data={rows.some((r) => r.added != null || r.deleted > 0) ? rows : []}
                  series={[
                    { key: 'added', label: 'Written', color: 'var(--chart-1)', kind: 'line', format: (v) => nf.format(v) },
                    { key: 'deleted', label: 'Deleted', color: 'var(--hue-red)', kind: 'line', format: (v) => nf.format(v) },
                  ]}
                  xFormat={shortDay}
                  tipTitle={shortDay}
                  yFormat={(v) => compact.format(v)}
                  height={240}
                  label="Battles written and deleted per day"
                  empty="Intake shows from the second daily reading (each one counts what arrived since the one before), and nothing has been deleted yet."
                />
              )
            }
          </ChartCard>

          <ChartGrid>
            <ChartCard
              title="What expires next"
              note="The oldest stored battle-days, on the date each one is removed"
              badge={first ? `from ${longDay(first)}` : undefined}
            >
              <StackedColumns
                data={schedule.map((r) => ({ x: r.x, battles: r.battles }))}
                series={[{ key: 'battles', label: 'Battles removed', color: 'var(--chart-1)' }]}
                xFormat={shortDay}
                tipTitle={(x) => {
                  const r = schedule.find((s) => s.x === x);
                  return r ? `${longDay(x)} — battles of ${longDay(r.day)}` : longDay(x);
                }}
                totalLabel="Battles"
                label="Battles due to be removed, by removal date"
                height={220}
                empty="Nothing is stored yet."
              />
            </ChartCard>

            <ChartCard title="Stored by month" note="Battles held for each month played — the oldest leave first">
              <BarRows
                bars={Object.entries(latest?.by_month ?? {})
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([m, n], i) => ({
                    label: monthLabel(m),
                    value: n,
                    display: compact.format(n),
                    detail: `${nf.format(n)} battles${i === 0 && first ? ` · first to go, from ${longDay(first)}` : ''}`,
                    tone: i === 0 ? ('warn' as const) : ('info' as const),
                  }))}
                empty="No battles stored."
              />
            </ChartCard>
          </ChartGrid>

          <ChartGrid>
            <ChartCard title="Capacity at a full window" note="An estimate: today’s intake and today’s bytes per battle">
              <ReadoutList
                rows={[
                  {
                    id: 'intake',
                    label: intake?.basis === 'readings' ? `Written per day (last ${intake.span} readings)` : 'Written per day (this month so far)',
                    value: intake ? nf.format(Math.round(intake.perDay)) : '—',
                  },
                  {
                    id: 'per',
                    label: 'Bytes per battle (raw payloads excluded)',
                    value: bytesPerBattle(latest) != null ? nf.format(Math.round(bytesPerBattle(latest)!)) : '—',
                  },
                  {
                    id: 'raw',
                    label: 'Raw payloads now (estimate)',
                    value: latest?.raw_bytes != null ? bytes(latest.raw_bytes) : '—',
                  },
                  projRow(proj10, true),
                  projRow(projAlt, false),
                  {
                    id: 'disk',
                    label: 'Volume',
                    value: latest?.disk_total ? `${bytes(latest.disk_total - (latest.disk_free ?? 0))} used of ${bytes(latest.disk_total)}` : '—',
                  },
                ]}
              />
              <p className={styles.small}>
                Intake scales with how many players are tracked, so this moves as tracking grows. The window is one
                setting (<code>CLASH_RETENTION_DAYS</code>, in both env files); lengthening it deletes nothing for the
                extra months, and shortening it drains at two extra days a run rather than all at once.
              </p>
            </ChartCard>

            <ChartCard title="Recent jobs" note="Retention, the ladder raw window and backups, newest first">
              <DashTable
                caption="Recent runs of the storage jobs"
                columns={[
                  { key: 'job', label: 'Job' },
                  { key: 'when', label: 'Finished' },
                  { key: 'status', label: 'Result' },
                ]}
                rows={report.runs.slice(0, 8).map((r) => ({
                  job: JOB_LABEL[r.job] ?? r.job,
                  when: <span title={r.finished_at}>{ago(r.finished_at)}</span>,
                  status: <StatusPill tone={runTone(r.status)}>{RUN_LABEL[r.status] ?? r.status}</StatusPill>,
                }))}
              />
            </ChartCard>
          </ChartGrid>

          <ChartCard
            title="Deletion log"
            note="One row per battle-day removed, newest first"
            badge={`${nf.format(report.totals.daysPurged)} days removed`}
          >
            {report.purges.length === 0 ? (
              <p className="bd-empty">
                Nothing has been deleted yet{first ? `. The battles of ${longDay(isoDay(latest?.oldest_battle))} are first, on ${longDay(first)}` : ''}.
              </p>
            ) : (
              <DashTable
                caption="Battle-days removed by the retention job"
                columns={[
                  { key: 'day', label: 'Battles of' },
                  { key: 'ran', label: 'Removed on' },
                  { key: 'battles', label: 'Battles', numeric: true },
                  { key: 'tags', label: 'Players', numeric: true },
                  { key: 'gone', label: 'Nothing newer', numeric: true },
                  { key: 'raw', label: 'Raw', numeric: true },
                  { key: 'secs', label: 'Took', numeric: true },
                ]}
                rows={[...report.purges].reverse().map((p) => ({
                  day: longDay(p.day),
                  ran: longDay(p.run_date),
                  battles: nf.format(p.battles),
                  tags: nf.format(p.tags),
                  gone: nf.format(p.tags_gone),
                  raw: nf.format(p.raw),
                  secs: `${Math.round(p.seconds)} s`,
                }))}
              />
            )}
          </ChartCard>

          <ChartCard title="Backups" note="Verified copies of the bot’s database; the PC pulls each one and confirms its hash">
            {report.backups.length === 0 ? (
              <p className="bd-empty">No backup has run yet.</p>
            ) : (
              <DashTable
                caption="Database backups"
                columns={[
                  { key: 'made', label: 'Made' },
                  { key: 'check', label: 'Check' },
                  { key: 'size', label: 'Size', numeric: true },
                  { key: 'offbox', label: 'Off the box' },
                  { key: 'state', label: 'State' },
                ]}
                rows={report.backups.map((b) => ({
                  made: <span title={b.name}>{ago(b.created_at)}</span>,
                  check: b.check_result ? `${b.check_kind ?? ''} ${b.check_result === 'ok' ? 'ok' : 'failed'}`.trim() : '—',
                  size: sizeOf(b),
                  offbox: b.pulled_at ? `${ago(b.pulled_at)}${b.pulled_host ? ` · ${b.pulled_host}` : ''}` : '—',
                  state: <StatusPill tone={STATE_TONE[b.status]}>{STATE_LABEL[b.status]}</StatusPill>,
                }))}
              />
            )}
          </ChartCard>
        </>
      )}
    </Dashboard>
  );
}

function projRow(p: Projection | null, current: boolean) {
  return {
    id: `proj-${current ? 'now' : 'alt'}`,
    label: p ? `${MONTHS(p.retentionDays)}${current ? ' (set)' : ''}` : 'Projection',
    value: p ? `≈ ${bytes(p.totalBytes)}${p.diskPct != null ? ` · ${Math.round(p.diskPct)}% of disk` : ''}` : '—',
    tone: p?.diskPct != null ? (p.diskPct > 85 ? ('bad' as const) : p.diskPct > 70 ? ('warn' as const) : ('good' as const)) : undefined,
  };
}

function sizeOf(b: BackupRecord): string {
  if (!b.zst_bytes) return b.db_bytes ? bytes(b.db_bytes) : '—';
  return `${bytes(b.zst_bytes)}${b.db_bytes ? ` of ${bytes(b.db_bytes)}` : ''}`;
}

const JOB_LABEL: Record<string, string> = {
  retention: 'Retention',
  backup: 'Backup',
  ladder_raw: 'Ladder raw window',
};

const RUN_LABEL: Record<string, string> = {
  ok: 'Done',
  nothing_due: 'Nothing due',
  dry_run: 'Dry run',
  refused: 'Refused',
  error: 'Failed',
};

function runTone(s: string) {
  if (s === 'ok' || s === 'nothing_due') return 'good' as const;
  if (s === 'dry_run') return 'warn' as const;
  return 'bad' as const;
}

const STATE_LABEL: Record<BackupRecord['status'], string> = {
  running: 'Running',
  verified: 'Verified',
  failed: 'Failed',
  deleted: 'Rotated out',
};

const STATE_TONE: Record<BackupRecord['status'], 'good' | 'info' | 'bad' | 'neutral'> = {
  running: 'info',
  verified: 'good',
  failed: 'bad',
  deleted: 'neutral',
};
