import type { ReactNode } from 'react';

import type { AnalyticsStatus, Collection, Health } from '../../state/adminStore';
import {
  battleVerdict,
  coverageVerdict,
  diskVerdict,
  pollFailureVerdict,
  rebuildVerdict,
  retentionVerdict,
  type Verdict,
} from '../../state/consoleHealth';
import { ago, bytes } from '../../utils/format';
import {
  ChartCard,
  ChartGrid,
  Dashboard,
  KeyMetricCard,
  MetricGrid,
  ReadoutList,
  ScoreDonut,
  SegmentBar,
  StatusPill,
} from '../ui/bionis-dashboard';
import {
  AlertIcon,
  ArchiveIcon,
  BoltIcon,
  ClockIcon,
  DatabaseIcon,
  LayersIcon,
  ServerIcon,
  UsersIcon,
} from '../ui/dash-icons';
import { CardsIcon, GlobeIcon, TargetIcon } from '../Dashboard/icons';
import styles from './ConsoleViews.module.css';

/**
 * THE CONSOLE'S OPERATIONAL SECTIONS — Collection, Storage, Rollup, and the
 * site itself — each a view of its own in the sidebar now.
 *
 * THESE WERE DELIBERATELY NOT RE-SKINNED ONCE, and the reason still holds:
 * they are what tells a dead collector from a healthy one writing into
 * reclaimed pages, and each figure carries reasoning a summary cannot. So
 * nothing was dropped in the move — every figure, every note and every
 * threshold is the one the old tiles showed (the thresholds now live in
 * `consoleHealth.ts`, shared with the sidebar's status dots). What changed is
 * the drawing: cards with a status word and icon, a gauge where the figure is
 * a proportion, a part-to-whole bar for the file's pages.
 */

const nf = new Intl.NumberFormat();

/** Contabo Cloud VPS 6 root volume, from `df -h /` on the box. */
export const VPS_DISK_BYTES = 387 * 1024 ** 3;

function NotReported({ what }: { what: string }) {
  return (
    <ChartCard title={what}>
      <p className="bd-empty">
        This analytics deployment does not report {what.toLowerCase()} yet — an older server does not send it, and the
        section fills in once it does.
      </p>
    </ChartCard>
  );
}

const pill = (v: Verdict | null) => (v ? { tone: v.tone, label: v.label } : undefined);

/* ── collection ─────────────────────────────────────────────────────────── */

/**
 * IS THE COLLECTION ALIVE. The question the console once could not answer:
 * "storage is stuck at 33.3 GB" was the symptom, and the honest reading — a
 * healthy bot writing into reclaimed pages — needed four figures none of
 * which were on the screen. The newest battle is the one that settles it: if
 * that is minutes old, data is arriving, whatever the file size is doing.
 */
export function CollectionView({ collection }: { collection: Collection | null }) {
  const c = collection?.ops?.collection;
  if (!c) {
    return (
      <Dashboard>
        <NotReported what="Collection figures" />
      </Dashboard>
    );
  }
  const newest = battleVerdict(c.newestBattle);
  const failures = pollFailureVerdict(c.pollFailurePct);
  return (
    <Dashboard>
      <MetricGrid>
        <KeyMetricCard
          label="Newest battle"
          value={c.newestBattle ? ago(c.newestBattle) : '—'}
          note={newest ? 'the bot polls every 2h' : 'nothing stored'}
          icon={<BoltIcon />}
          tone={newest?.tone ?? 'neutral'}
          status={pill(newest)}
        />
        <KeyMetricCard
          label="Last poll"
          value={c.lastPollAt ? ago(c.lastPollAt) : '—'}
          note={c.lastPollMs ? `took ${(c.lastPollMs / 60000).toFixed(1)} min` : c.lastPollAt ? 'completed' : 'not recorded'}
          icon={<ClockIcon />}
        />
        {/* A RATE BETWEEN THE LAST TWO POLLS, not a lifetime total — the
            stored counters are cumulative, so the raw pair says nothing about
            now. */}
        <KeyMetricCard
          label="Poll failures"
          value={c.pollFailurePct != null ? `${c.pollFailurePct.toFixed(2)}%` : '—'}
          note="of the last poll's API calls"
          icon={<AlertIcon />}
          tone={failures?.tone ?? 'neutral'}
          status={pill(failures)}
        />
        <KeyMetricCard
          label="Battles stored"
          value={nf.format(c.battles)}
          note={collection?.global?.days ? `over ${collection.global.days} days` : 'in the hot tier'}
          icon={<DatabaseIcon />}
          tone="info"
        />
      </MetricGrid>

      <ChartGrid>
        <ChartCard title="The roster" note="Who the bot polls, and how far back it has them">
          <ReadoutList
            rows={[
              { id: 'tracked', label: 'Tracked players', value: nf.format(c.trackedPlayers) },
              { id: 'oldest', label: 'Oldest battle held', value: c.oldestBattle ? c.oldestBattle.slice(0, 10) : '—' },
              { id: 'newest', label: 'Newest battle', value: c.newestBattle ? ago(c.newestBattle) : '—', tone: newest?.tone },
              {
                id: 'days',
                label: 'Days of battles stored',
                value: collection?.global?.days ? nf.format(collection.global.days) : '—',
              },
            ]}
          />
        </ChartCard>
        <ChartCard title="How to read this" note="What each figure can and cannot say">
          <p className={styles.explain}>
            The newest battle settles whether data is arriving: the bot polls every two hours, so a gap under three is an
            ordinary trough between passes, and past six a pass has been missed. Poll failures are the share of the last
            poll&rsquo;s API calls that failed — the CR API returns errors under load, so a small figure is normal and only a
            jump is worth reading. A database file whose size has not moved is not a stopped collector: see Storage.
          </p>
        </ChartCard>
      </ChartGrid>
    </Dashboard>
  );
}

/* ── storage ────────────────────────────────────────────────────────────── */

/**
 * THE FILE, SPLIT. A single "33.3 GB" cannot distinguish a collector that has
 * died from one re-using pages a large delete freed earlier — the number sits
 * still in both cases. The split makes the second legible: a wide free part
 * IS the explanation for a size that has not moved. The free part is space
 * already charged to this file, not spare capacity like the disk's remainder.
 */
export function StorageView({ collection, analytics }: { collection: Collection | null; analytics: AnalyticsStatus | null }) {
  const s = collection?.ops?.storage;
  const r = collection?.ops?.retention;
  const hot = analytics?.hot;
  if (!s && !hot?.available) {
    return (
      <Dashboard>
        <NotReported what="Storage figures" />
      </Dashboard>
    );
  }
  const disk = hot?.available ? diskVerdict(hot.sizeBytes, VPS_DISK_BYTES) : null;
  const diskPct = hot?.available ? Math.min(100, (hot.sizeBytes / VPS_DISK_BYTES) * 100) : 0;
  const retention = retentionVerdict(r?.daysUntilFirstDelete);
  return (
    <Dashboard>
      {s && (
        <ChartCard title="Inside battles.db" note="Pages holding data, and free pages SQLite will write into first" badge={bytes(s.fileBytes)}>
          <SegmentBar
            label="Inside battles.db"
            segments={[
              { key: 'live', label: 'Holding data', value: s.liveBytes, color: 'var(--chart-1)', display: bytes(s.liveBytes) },
              {
                key: 'free',
                label: 'Free pages',
                value: s.freeBytes,
                color: 'var(--chart-3)',
                display: bytes(s.freeBytes),
                detail: `${nf.format(s.freePages)} pages SQLite writes into before the file grows`,
              },
            ]}
          />
          <p className={styles.explain} style={{ marginTop: '0.9rem' }}>
            {s.freeBytes > 0
              ? 'SQLite never shrinks a file. Pages freed by a delete go on a freelist and are written into before the file grows again — so a size that has not moved is not the same as a collection that has stopped.'
              : 'No free pages: every new battle extends the file.'}
          </p>
        </ChartCard>
      )}

      <ChartGrid>
        {hot?.available && (
          <ChartCard title="The volume" note="battles.db on the Contabo volume" badge={disk?.label}>
            <ScoreDonut
              value={hot.sizeBytes}
              max={VPS_DISK_BYTES}
              display={`${diskPct.toFixed(1)}%`}
              tone={disk?.tone === 'good' ? 'info' : (disk?.tone ?? 'info')}
              caption={`${bytes(hot.sizeBytes)} of the volume’s ${bytes(VPS_DISK_BYTES)}. There is still no backup of this database.`}
            />
          </ChartCard>
        )}
        <ChartCard title="The file" note="Pages, free space and the retention window">
          <ReadoutList
            rows={[
              ...(s
                ? [
                    { id: 'file', label: 'File on disk', value: bytes(s.fileBytes) },
                    { id: 'pages', label: 'Pages', value: `${nf.format(s.pageCount)} × ${bytes(s.pageSize)}` },
                    {
                      id: 'free',
                      label: 'Reclaimable',
                      value: `${bytes(s.freeBytes)} · ${nf.format(s.freePages)} pages`,
                      tone: s.freeBytes > s.liveBytes / 3 ? ('warn' as const) : undefined,
                    },
                  ]
                : []),
              ...(r
                ? [
                    {
                      id: 'ret',
                      label: 'Retention',
                      value: r.days ? `${r.days} days` : 'unknown',
                    },
                    {
                      id: 'runway',
                      label: 'First deletion',
                      /* BLANK UNLESS THE SERVICE HAS BEEN TOLD THE WINDOW. The
                         bot owns `CLASH_RETENTION_DAYS`; printing a number from
                         memory here would be the one unmeasured figure on a
                         screen whose value is being trusted. */
                      value: r.days
                        ? r.daysUntilFirstDelete != null
                          ? `in ${nf.format(r.daysUntilFirstDelete)} days`
                          : (r.boundary ?? '—')
                        : 'set CLASH_RETENTION_DAYS',
                      tone: retention?.tone === 'warn' ? ('warn' as const) : undefined,
                    },
                  ]
                : []),
            ]}
          />
        </ChartCard>
      </ChartGrid>
    </Dashboard>
  );
}

/* ── the rollup ─────────────────────────────────────────────────────────── */

/**
 * WHAT THIS CATCHES, and it caught it on the live database the day it was
 * written: the watermark advances to NOW after every poll and folds only the
 * window it just passed, so any row ARRIVING with an older timestamp — every
 * backfill, every battle retried after a sync error — is never folded. The
 * coverage figure shows the drift; the last full rebuild says whether the
 * repair has run.
 */
export function RollupView({ collection }: { collection: Collection | null }) {
  const a = collection?.ops?.aggregates;
  if (!a) {
    return (
      <Dashboard>
        <NotReported what="Rollup figures" />
      </Dashboard>
    );
  }
  const coverage = coverageVerdict(a.coveragePct);
  const rebuild = rebuildVerdict(a.lastRebuild);
  return (
    <Dashboard>
      <ChartGrid>
        <ChartCard title="Aggregate coverage" note="Stored battles folded into the rollup" badge={coverage?.label}>
          {a.coveragePct != null ? (
            <ScoreDonut
              value={a.coveragePct}
              max={100}
              display={`${a.coveragePct.toFixed(1)}%`}
              tone={coverage?.tone === 'good' ? 'good' : (coverage?.tone ?? 'info')}
              caption="of stored battles are folded into player_stats_agg. Incremental folds drift; a full rebuild corrects them."
            />
          ) : (
            <p className="bd-empty">Not reported by this deployment.</p>
          )}
        </ChartCard>
        <ChartCard title="The repair clock" note="When the rollup last caught up" badge={rebuild.label}>
          <ReadoutList
            rows={[
              { id: 'wm', label: 'Watermark', value: a.watermark ? ago(a.watermark) : '—' },
              {
                id: 'rb',
                label: 'Last full rebuild',
                value: a.lastRebuild ? ago(a.lastRebuild) : 'never',
                tone: rebuild.tone === 'good' ? undefined : rebuild.tone,
              },
            ]}
          />
          <p className={styles.explain} style={{ marginTop: '0.9rem' }}>
            The watermark advances after every poll. If the last rebuild is weeks old the coverage figure keeps falling —
            knowing which of the two to read is the point of showing both.
          </p>
        </ChartCard>
      </ChartGrid>
      <MetricGrid>
        <KeyMetricCard label="Folded battles" value={nf.format(a.statsBattles)} note="player_stats_agg" icon={<LayersIcon />} tone="info" />
        {/* NOT a ratio against stored battles: this table dedups a battle seen
            from both sides when both players are tracked, so the two are not
            the same denominator. */}
        <KeyMetricCard label="Matchup games" value={nf.format(a.pairGames)} note="pair_matchup_agg · mirror-deduped" icon={<TargetIcon />} />
        <KeyMetricCard
          label="Coverage"
          value={a.coveragePct != null ? `${a.coveragePct.toFixed(1)}%` : '—'}
          note="of stored battles are folded in"
          icon={<DatabaseIcon />}
          tone={coverage?.tone ?? 'neutral'}
          status={pill(coverage)}
        />
        <KeyMetricCard
          label="Last full rebuild"
          value={a.lastRebuild ? ago(a.lastRebuild) : 'never'}
          note="repairs rollup drift"
          icon={<ClockIcon />}
          tone={rebuild.tone}
          status={pill(rebuild)}
        />
      </MetricGrid>
    </Dashboard>
  );
}

/* ── the site, the API and the domain ───────────────────────────────────── */

function Service({
  icon,
  name,
  note,
  value,
  verdict,
}: {
  icon: ReactNode;
  name: string;
  note: ReactNode;
  value: ReactNode;
  verdict: Verdict | null;
}) {
  return (
    <li className={styles.service}>
      <span className={styles.serviceIcon}>{icon}</span>
      <span className={styles.serviceText}>
        <span className={styles.serviceName}>{name}</span>
        <span className={styles.serviceNote}>{note}</span>
      </span>
      <span className={styles.serviceValue}>
        {value}
        {verdict && <StatusPill tone={verdict.tone}>{verdict.label}</StatusPill>}
      </span>
    </li>
  );
}

export function SiteView({
  health,
  analytics,
  analyticsMs,
}: {
  health: Health | null;
  analytics: AnalyticsStatus | null;
  analyticsMs: number | null;
}) {
  const entries = health ? Object.entries(health.configured) : [];
  const missing = entries.filter(([, v]) => !v).map(([k]) => k);
  const pretty = (k: string) => k.replace(/([A-Z])/g, ' $1').toLowerCase();
  const recruit = analytics?.recruit;
  return (
    <Dashboard>
      <ChartCard title="Services" note="What this deployment can reach, and whether it answers">
        <ul className={styles.services}>
          <Service
            icon={<ServerIcon />}
            name="Deployment"
            note={health ? `${health.env} · ${health.region ?? '?'}` : 'the site’s own health route did not answer'}
            value={health?.commit ?? '—'}
            verdict={health ? { tone: 'good', label: 'Up' } : { tone: 'bad', label: 'Unreachable' }}
          />
          <Service
            icon={<DatabaseIcon />}
            name="Analytics API"
            note={analytics?.hot.available ? 'api.deckkies.com · database attached' : 'no database attached'}
            value={analytics ? `${analyticsMs ?? '—'} ms` : 'down'}
            verdict={analytics?.hot.available ? { tone: 'good', label: 'Answering' } : { tone: 'bad', label: 'Down' }}
          />
          {/* A DATABASE THAT OPENS IS NOT A SERVICE THAT CAN ANSWER. The card
              reference files went missing on a deploy and every screen kept
              answering 200 with wrong numbers, with nothing reporting a fault.
              This row is the fault. */}
          {analytics?.cardData && (
            <Service
              icon={<CardsIcon />}
              name="Card data"
              note={analytics.cardData.loaded ? 'win conditions, spells, elixir' : (analytics.cardData.error ?? 'not loaded')}
              value={analytics.cardData.loaded ? `${analytics.cardData.count} cards` : 'MISSING'}
              verdict={analytics.cardData.loaded ? { tone: 'good', label: 'Loaded' } : { tone: 'bad', label: 'Missing' }}
            />
          )}
          {/* THE RECRUITER, which enrols players nobody searched for.
              "Enabled but has never completed a run" looks exactly like
              "working" from every other angle. */}
          {recruit && (
            <Service
              icon={<UsersIcon />}
              name="Recruiter"
              note={
                recruit.enabled
                  ? recruit.lastRunAt
                    ? `last run ${ago(recruit.lastRunAt)} · ${nf.format(recruit.queued)} queued · ${nf.format(recruit.lastAdded)} added`
                    : 'enabled, and has never completed a run'
                  : 'CLASH_RECRUIT=off'
              }
              value={recruit.enabled ? `${nf.format(recruit.runs)} runs` : 'off'}
              verdict={
                !recruit.enabled ? null : recruit.lastRunAt ? { tone: 'good', label: 'Running' } : { tone: 'warn', label: 'No run yet' }
              }
            />
          )}
          {/* ONE ROW, NOT SEVEN SAYING "set". The point of a signal is the one
              that is NOT fine, so this names what is missing. */}
          {health && (
            <Service
              icon={<GlobeIcon />}
              name="Integrations"
              note={missing.length ? `missing: ${missing.map(pretty).join(', ')}` : 'all configured'}
              value={`${entries.length - missing.length} / ${entries.length}`}
              verdict={missing.length ? { tone: 'warn', label: 'Missing' } : { tone: 'good', label: 'All set' }}
            />
          )}
          {analytics?.archive && (
            <Service
              icon={<ArchiveIcon />}
              name="Archive tier"
              note={analytics.archive.available ? 'the cold tier is attached' : 'not attached on this host — by design, the archive was never migrated'}
              value={analytics.archive.available ? bytes(analytics.archive.sizeBytes) : '—'}
              verdict={null}
            />
          )}
        </ul>
      </ChartCard>
    </Dashboard>
  );
}
