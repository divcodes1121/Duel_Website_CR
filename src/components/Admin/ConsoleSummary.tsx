import { useMemo } from 'react';

import type { AnalyticsStatus, Collection } from '../../state/adminStore';
import { ago } from '../../utils/format';
import { BadgeIcon, CardsIcon, ListIcon, TargetIcon, TrendIcon } from '../Dashboard/icons';
import {
  BarRows,
  ChartCard,
  ChartGrid,
  ColumnChart,
  Dashboard,
  DashboardHeader,
  DashHero,
  InsightCard,
  InsightGrid,
  KeyMetricCard,
  MetricGrid,
  ReadoutList,
  ScoreDonut,
  type Bar,
} from '../ui/bionis-dashboard';

/**
 * THE CONSOLE'S SUMMARY, on the bionis dashboard layout.
 *
 * WHAT THIS REPLACES: one flat row of `Stat` tiles mixing accounts with the
 * collection. The deep operational sections below it — Collection, Storage,
 * Rollup and the accounts table — are UNTOUCHED, deliberately. They are the
 * half that was built to tell a dead collector from a healthy one writing
 * into reclaimed pages, and each figure there carries reasoning a summary
 * cannot; re-skinning them would risk the one part of this screen somebody
 * relies on during an incident.
 *
 * **NOTHING HERE IS COMPUTED THAT THE PAYLOAD DOES NOT CARRY.** Every figure
 * is a field or a sum of fields; the three insight cards were chosen because
 * they are the summary-level facts NOT already stated below (accounts by
 * tier, the recruiter, and whether the card catalogue loaded — the field this
 * project's notes say to check after every deploy). A card whose data an
 * older analytics deployment does not send is not drawn at all.
 */

const nf = new Intl.NumberFormat();

/** The bot polls every two hours, so a gap under ~3h is an ordinary trough
 *  between passes, not a stall. Same threshold the Collection section uses. */
const STALE_MS = 3 * 60 * 60 * 1000;

export function ConsoleSummary({
  accounts,
  counts,
  collection,
  analytics,
}: {
  accounts: number;
  counts: { free: number; trial: number; pro: number; admin: number; devices: number; recent: number };
  collection: Collection | null;
  analytics: AnalyticsStatus | null;
}) {
  const ops = collection?.ops;
  const recruit = analytics?.recruit;
  const cardData = analytics?.cardData;

  const newest = ops?.collection?.newestBattle ?? null;
  const gap = newest ? Date.now() - Date.parse(newest) : null;
  const alive = gap !== null && gap < STALE_MS;

  const tiers: Bar[] = useMemo(
    () => [
      { label: 'Free', value: counts.free, tone: 'neutral' },
      { label: 'Member', value: counts.trial, tone: 'info' },
      { label: 'Pro', value: counts.pro, tone: 'good' },
      { label: 'Admin', value: counts.admin, tone: 'warn' },
    ],
    [counts],
  );

  /* Both bars are a share of the SAME real total — the recruiter's own
     ceiling — so they can be read against each other and against it. A
     per-bar maximum would make two different scales look like one. */
  const capacity: Bar[] = recruit
    ? [
        { label: 'Tracked', value: collection?.trackedPlayers ?? 0, tone: 'info', display: nf.format(collection?.trackedPlayers ?? 0) },
        { label: 'Queued', value: recruit.queued, tone: 'warn', display: nf.format(recruit.queued) },
      ]
    : [];

  return (
    <Dashboard>
      {/* level 2: the page already carries an <h2>Console</h2>, and an <h1>
          after it is a document-order fault, not a style preference. */}
      <DashboardHeader
        level={2}
        title="Overview"
        subtitle="Accounts and the collection. The operational detail is below, section by section."
      />

      <DashHero
        heading="Is the collection alive?"
        badge={newest ? (alive ? 'Battles arriving' : 'No battle in 3h') : 'Not reported'}
        badgeTone={newest ? (alive ? 'good' : 'warn') : 'neutral'}
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
            : `The newest stored battle is ${ago(newest)}. The bot polls every two hours, so this is past an ordinary trough — check the last poll below.`
          : 'This analytics deployment does not report operational metrics yet. The sections below are guarded and will fill in once it does.'}
      </DashHero>

      <MetricGrid>
        <KeyMetricCard label="Accounts" value={String(accounts)} note="signed up" icon={<ListIcon />} />
        <KeyMetricCard
          label="Paid or trialling"
          value={String(counts.pro + counts.trial)}
          delta={accounts > 0 ? `${Math.round(((counts.pro + counts.trial) / accounts) * 100)}% of accounts` : undefined}
          note="Pro is the only tier that opens Coach Assist"
          tone={counts.pro > 0 ? 'good' : 'neutral'}
          icon={<BadgeIcon />}
        />
        <KeyMetricCard
          label="Signed in today"
          value={String(counts.recent)}
          note="last sign-in, not presence"
          icon={<TrendIcon />}
        />
        {collection && (
          <KeyMetricCard
            label="Tracked players"
            value={nf.format(collection.trackedPlayers)}
            note={collection.global?.days ? `${collection.global.days} days of battles stored` : 'collected by the bot'}
            icon={<TargetIcon />}
          />
        )}
      </MetricGrid>

      <ChartGrid>
        <ChartCard title="Accounts by tier" note="Every account, counted once." badge={`${accounts} total`}>
          <ColumnChart bars={tiers} max={Math.max(1, accounts)} />
        </ChartCard>

        <ChartCard
          title="Collection capacity"
          note="Both bars are a share of the recruiter's ceiling, so they read against each other."
          badge={recruit ? (recruit.enabled ? 'Recruiter on' : 'Recruiter off') : 'Not reported'}
        >
          <BarRows
            bars={capacity}
            max={Math.max(1, recruit?.ceiling ?? 1)}
            empty="This analytics deployment does not report the recruiter yet."
          />
        </ChartCard>
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
            Check this after any deploy of <code>server/</code>. Without <code>src/data/</code> beside it every deck
            loses its elixir and its win condition, and nothing else says so.
          </p>
        </InsightCard>
      </InsightGrid>
    </Dashboard>
  );
}
