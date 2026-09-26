import { useMemo } from 'react';

import type { AdminUser, AnalyticsStatus, Collection, TrackingActivity } from '../../state/adminStore';
import { battleVerdict, cumulativeAccounts } from '../../state/consoleHealth';
import { FAMILIES, dailyStack, familyTotals, shortDay } from '../../state/trackingSources';
import { ago } from '../../utils/format';
import { BadgeIcon, CardsIcon, ListIcon, TargetIcon, TrendIcon } from '../Dashboard/icons';
import {
  BarRows,
  ChartCard,
  ChartGrid,
  Dashboard,
  DashHero,
  InsightCard,
  InsightGrid,
  KeyMetricCard,
  MetricGrid,
  ReadoutList,
  ScoreDonut,
  SegmentBar,
  StackedColumns,
  type Bar,
  type Trend,
} from '../ui/bionis-dashboard';
import { RadarIcon } from '../ui/dash-icons';

/**
 * THE CONSOLE'S OVERVIEW — the first view in the sidebar.
 *
 * WHAT IT IS FOR: "is anything wrong, and where?" at a glance. The
 * operational detail lives in the other sections now (Tracking, Collection,
 * Storage, Rollup, Site & domain, Accounts), each a view of its own, and every
 * card here that summarises one of them opens it.
 *
 * **NOTHING HERE IS COMPUTED THAT THE PAYLOADS DO NOT CARRY.** Every figure is
 * a field or a sum of fields; the growth line is the accounts' own
 * `created_at`, the additions chart is `tracking.activity()`'s `daily`. A card
 * whose data an older analytics deployment does not send is not drawn.
 */

const nf = new Intl.NumberFormat();

/** A whole-percent share for a tooltip; a dash when there is no total. */
const share = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—');

export function ConsoleSummary({
  users,
  counts,
  collection,
  analytics,
  tracking,
  onOpen,
}: {
  users: AdminUser[];
  counts: { free: number; trial: number; pro: number; admin: number; devices: number; recent: number };
  collection: Collection | null;
  analytics: AnalyticsStatus | null;
  tracking: TrackingActivity | null;
  /** Opens one of the console's sections — the cards that summarise one. */
  onOpen: (section: 'tracking' | 'collection' | 'accounts') => void;
}) {
  const accounts = users.length;
  const ops = collection?.ops;
  const recruit = analytics?.recruit;
  const cardData = analytics?.cardData;

  const newest = ops?.collection?.newestBattle ?? null;
  const verdict = battleVerdict(newest);
  const alive = verdict?.tone === 'good';

  const today = new Date().toISOString().slice(0, 10);
  const growth = useMemo(() => cumulativeAccounts(users.map((u) => u.created_at), today), [users, today]);
  const growthTrend: Trend | undefined =
    growth.length > 1
      ? {
          values: growth.map((g) => g.total),
          labels: growth.map((g) => shortDay(g.x)),
          format: (v) => `${nf.format(v)} accounts`,
          label: 'Accounts over time',
        }
      : undefined;

  /* The last fortnight of additions — the Tracking view has the full window
     and its range tabs. */
  const added = useMemo(() => {
    if (!tracking) return [];
    const rows = dailyStack(tracking.daily, tracking.days, tracking.generatedAt.slice(0, 10));
    return rows.slice(-14);
  }, [tracking]);
  const addedTotals = useMemo(() => familyTotals(added), [added]);
  const addedSeries = FAMILIES.filter((f) => addedTotals[f.id] > 0).map((f) => ({ key: f.id, label: f.label, color: f.color }));
  const addedSum = Object.values(addedTotals).reduce((n, v) => n + v, 0);

  /* Both bars are a share of the SAME real total — the recruiter's own
     ceiling — so they read against each other and against it. */
  const capacity: Bar[] = recruit
    ? [
        {
          label: 'Tracked',
          value: collection?.trackedPlayers ?? 0,
          tone: 'info',
          display: nf.format(collection?.trackedPlayers ?? 0),
          detail: `${share(collection?.trackedPlayers ?? 0, recruit.ceiling)} of the ${nf.format(recruit.ceiling)} ceiling`,
        },
        {
          label: 'Queued',
          value: recruit.queued,
          tone: 'warn',
          display: nf.format(recruit.queued),
          detail: `${share(recruit.queued, recruit.ceiling)} of the ceiling — counted as spent before it enrols`,
        },
      ]
    : [];

  /* The recruiter counts a queued tag as spent (`recruit.enqueue`), so the
     room left is the ceiling less BOTH. */
  const room = recruit && collection ? Math.max(0, recruit.ceiling - collection.trackedPlayers - recruit.queued) : null;

  return (
    <Dashboard>
      <DashHero
        heading="Is the collection alive?"
        badge={newest ? (alive ? 'Battles arriving' : 'No battle in 3h') : 'Not reported'}
        badgeTone={newest ? (alive ? 'good' : 'warn') : 'neutral'}
        stats={
          recruit && collection
            ? [
                { label: 'Ceiling', value: nf.format(recruit.ceiling) },
                { label: 'Room left', value: nf.format(room ?? 0), tone: room === 0 ? 'warn' : 'neutral' },
                {
                  label: 'Days stored',
                  value: collection.global?.days ? nf.format(collection.global.days) : '—',
                },
              ]
            : undefined
        }
        figure={
          recruit && collection ? (
            <ScoreDonut
              value={collection.trackedPlayers}
              max={Math.max(1, recruit.ceiling)}
              display={nf.format(collection.trackedPlayers)}
              tone={collection.trackedPlayers >= recruit.ceiling ? 'warn' : 'info'}
              caption={`Tracked players against the recruiter's ceiling of ${nf.format(recruit.ceiling)}. Each one costs roughly 32 MB a year of retention, and there is still no database backup.`}
            />
          ) : undefined
        }
      >
        {newest
          ? alive
            ? `The newest stored battle arrived ${ago(newest)}. Whatever the file size is doing, data is landing.`
            : `The newest stored battle is ${ago(newest)}. The bot polls every two hours, so this is past an ordinary trough — check Collection.`
          : 'This analytics deployment does not report operational metrics yet. The sections fill in once it does.'}
      </DashHero>

      <MetricGrid>
        <KeyMetricCard
          label="Accounts"
          value={nf.format(accounts)}
          note="signed up"
          icon={<ListIcon />}
          tone="info"
          trend={growthTrend}
          onClick={() => onOpen('accounts')}
          actionLabel={`${accounts} accounts — open Accounts`}
        />
        <KeyMetricCard
          label="Paid or trialling"
          value={nf.format(counts.pro + counts.trial)}
          delta={accounts > 0 ? `${Math.round(((counts.pro + counts.trial) / accounts) * 100)}% of accounts` : undefined}
          deltaTone="neutral"
          note="Pro is the only tier that opens Coach Assist"
          tone={counts.pro > 0 ? 'good' : 'neutral'}
          icon={<BadgeIcon />}
        />
        <KeyMetricCard label="Signed in today" value={nf.format(counts.recent)} note="last sign-in, not presence" icon={<TrendIcon />} />
        {tracking ? (
          <KeyMetricCard
            label="Waiting to be tracked"
            value={nf.format(tracking.queue.waiting)}
            note={`${nf.format(tracking.summary.added24h)} added in the last 24 h`}
            icon={<RadarIcon />}
            tone={tracking.queue.waiting > 0 ? 'info' : 'good'}
            onClick={() => onOpen('tracking')}
            actionLabel="Open the tracking queue"
          />
        ) : (
          collection && (
            <KeyMetricCard
              label="Tracked players"
              value={nf.format(collection.trackedPlayers)}
              note={collection.global?.days ? `${collection.global.days} days of battles stored` : 'collected by the bot'}
              icon={<TargetIcon />}
              onClick={() => onOpen('collection')}
              actionLabel="Open Collection"
            />
          )
        )}
      </MetricGrid>

      <ChartGrid>
        <ChartCard
          title="Players added to tracking"
          note="The last 14 days, by where each player was asked for"
          badge={tracking ? `${nf.format(addedSum)} in 14 days` : 'Not reported'}
        >
          {tracking ? (
            <StackedColumns
              data={added}
              series={addedSeries}
              xFormat={shortDay}
              tipTitle={shortDay}
              totalLabel="Added"
              label="Players added to tracking per day"
              height={230}
              empty="The bot added nobody in the last 14 days."
            />
          ) : (
            <p className="bd-empty">The tracking read did not answer — see Tracking for why.</p>
          )}
        </ChartCard>

        <ChartCard title="Accounts by tier" note="Every account, counted once" badge={`${nf.format(accounts)} total`}>
          <SegmentBar
            label="Accounts by tier"
            segments={[
              { key: 'free', label: 'Free', value: counts.free, color: 'var(--chart-other)' },
              { key: 'trial', label: 'Member (trial)', value: counts.trial, color: 'var(--chart-1)', detail: 'The trial — every area but Coach Assist' },
              { key: 'pro', label: 'Pro', value: counts.pro, color: 'var(--chart-2)', detail: 'Paid — full access' },
              { key: 'admin', label: 'Admin', value: counts.admin, color: 'var(--chart-3)', detail: 'Everything, plus this console' },
            ]}
            empty="No accounts yet."
          />
        </ChartCard>
      </ChartGrid>

      <ChartGrid>
        <ChartCard
          title="Collection capacity"
          note="Both bars are a share of the recruiter's ceiling, so they read against each other"
          badge={recruit ? (recruit.enabled ? 'Recruiter on' : 'Recruiter off') : 'Not reported'}
        >
          <BarRows
            bars={capacity}
            max={Math.max(1, recruit?.ceiling ?? 1)}
            empty="This analytics deployment does not report the recruiter yet."
          />
        </ChartCard>

        <InsightCard
          title="Recruiting"
          icon={<TargetIcon />}
          tone={recruit?.enabled ? 'good' : 'neutral'}
          badge={recruit?.opponents ? 'Both sources' : 'Leaderboard only'}
        >
          {recruit ? (
            <ReadoutList
              rows={[
                { id: 'on', label: 'Leaderboard loop', value: recruit.enabled ? 'on' : 'off', tone: recruit.enabled ? 'good' : 'neutral' },
                { id: 'opp', label: 'Opponent harvest', value: recruit.opponents ? 'on' : 'off', tone: recruit.opponents ? 'warn' : 'neutral' },
                { id: 'queued', label: 'Queued to enrol', value: nf.format(recruit.queued) },
                { id: 'added', label: 'Added last run', value: nf.format(recruit.lastAdded) },
                { id: 'run', label: 'Last run', value: recruit.lastRunAt ? ago(recruit.lastRunAt) : 'never' },
              ]}
            />
          ) : (
            <p className="bd-empty">This analytics deployment does not report the recruiter yet.</p>
          )}
        </InsightCard>
      </ChartGrid>

      <InsightGrid>
        <InsightCard title="Accounts" icon={<ListIcon />} tone="info" badge={`${counts.devices} device slots`}>
          <ReadoutList
            rows={[
              { id: 'free', label: 'Free', value: String(counts.free) },
              { id: 'member', label: 'Member — no Coach Assist', value: String(counts.trial), tone: 'info' },
              { id: 'pro', label: 'Pro — full access', value: String(counts.pro), tone: 'good' },
              { id: 'admin', label: 'Admin', value: String(counts.admin) },
              { id: 'devices', label: 'Device slots held', value: String(counts.devices) },
            ]}
          />
        </InsightCard>

        {/* THE FIELD TO CHECK AFTER EVERY DEPLOY. `server/` needs
            `../src/data/` beside it; when it is missing, every card resolves
            to elixir 0 and no win condition, and the failure used to be
            silent. */}
        <InsightCard
          title="Card catalogue"
          icon={<CardsIcon />}
          tone={cardData ? (cardData.loaded ? 'good' : 'bad') : 'neutral'}
          badge={cardData ? (cardData.loaded ? 'Loaded' : 'MISSING') : 'Not reported'}
        >
          {cardData ? (
            <ReadoutList
              rows={[
                {
                  id: 'loaded',
                  label: 'Catalogue',
                  value: cardData.loaded ? `${cardData.count} cards` : 'not loaded',
                  tone: cardData.loaded ? 'good' : 'bad',
                },
                { id: 'err', label: 'Error', value: cardData.error ?? 'none' },
              ]}
            />
          ) : (
            <p className="bd-empty">This analytics deployment does not report the card catalogue yet.</p>
          )}
          <p className="bd-rowNote">
            Check this after any deploy of <code>server/</code>. Without <code>src/data/</code> beside it every deck loses its
            elixir and its win condition, and nothing else says so.
          </p>
        </InsightCard>
      </InsightGrid>
    </Dashboard>
  );
}
