import { useEffect, useMemo, useState } from 'react';

import { useAdminStore } from '../../state/adminStore';
import { useAccountStore } from '../../state/accountStore';
import { useAccess } from '../../state/gate';
import { isSupabaseConfigured } from '../../state/supabase';
import {
  battleVerdict,
  consoleSection,
  coverageVerdict,
  diskVerdict,
  rebuildVerdict,
  retentionVerdict,
  siteVerdict,
  worst,
  type ConsoleSection,
} from '../../state/consoleHealth';
import { DashShell, ShellButton, type ShellGroup, type ShellItem } from '../ui/dash-shell';
import { DatabaseIcon, DiskIcon, GridIcon, LayersIcon, RadarIcon, RefreshIcon, UsersIcon } from '../ui/dash-icons';
import { CoachIcon, GlobeIcon, HomeIcon } from '../Dashboard/icons';
import { AccountsView } from './AccountsView';
import { CollectionView, RollupView, SiteView, StorageView, VPS_DISK_BYTES } from './ConsoleSections';
import { ConsoleSummary } from './ConsoleSummary';
import { TrackingView } from './TrackingView';
import styles from './AdminConsole.module.css';

/**
 * THE ADMIN CONSOLE — `#/admin`, one view per sidebar item.
 *
 * WHY A SIDEBAR (2026-09-26). The console was one long page: a summary, then
 * Collection, Storage, Rollup and Site & domain as rows of tiles, then a
 * collapsed accounts table — "plain", in the account holder's word, and a
 * health check meant scrolling past everything to reach the one section being
 * checked. It sits in the dashboard shell now (`ui/dash-shell.tsx`): a sidebar
 * that opens, minimises to an icon rail and closes, and every section is a
 * view of its own with its own URL (`#/admin/tracking`, `#/admin/storage`…),
 * so a refresh or a shared link lands where it was.
 *
 * THE SIDEBAR CARRIES THE VERDICTS. A section in trouble shows a dot beside
 * its name — Collection when the newest battle is late, Rollup when coverage
 * drifts, Site & domain when the card catalogue is missing — from the same
 * thresholds its cards use (`consoleHealth.ts`), so the two cannot disagree.
 * Only warnings and faults get a dot.
 *
 * TRACKING IS NEW: who was queued for collection, from which screen, and
 * whether the bot has picked them up (`TrackingView.tsx`, from the admin-gated
 * `/api/analytics/admin/tracking`).
 *
 * The console refuses non-admins itself, and the database refuses them again
 * underneath — hiding it is a courtesy, not the boundary.
 */

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

const HEAD: Record<ConsoleSection, { title: string; subtitle: string }> = {
  overview: { title: 'Overview', subtitle: 'Accounts, the collection and the tracking queue at a glance' },
  tracking: { title: 'Tracking', subtitle: 'Who was queued for collection, from where, and whether the bot has them' },
  collection: { title: 'Collection', subtitle: 'Whether battles are still arriving, and how the last poll went' },
  storage: { title: 'Storage', subtitle: 'The database file, its free pages and the volume it sits on' },
  rollup: { title: 'Rollup', subtitle: 'How far the aggregates have drifted behind the live table' },
  site: { title: 'Site & domain', subtitle: 'The deployment, the analytics API and what they can reach' },
  accounts: { title: 'Accounts', subtitle: 'Every account, its tier and the controls that change it' },
};

const HREF = (s: ConsoleSection) => (s === 'overview' ? '#/admin' : `#/admin/${s}`);

export function AdminConsole() {
  const access = useAccess();
  /* WAIT FOR THE ACCOUNT BEFORE JUDGING IT. `ready` turns true as soon as the
     session is read — before the profile arrives — and the tier defaults to
     free until it does, so an admin was told "not your console" for a beat on
     every load. The roster had the same flash and the same fix. */
  const accountReady = useAccountStore((s) => s.ready);
  const userId = useAccountStore((s) => s.userId);
  const profile = useAccountStore((s) => s.profile);
  const resolved = !isSupabaseConfigured || (accountReady && (!userId || profile !== null));

  const { users, health, analytics, analyticsMs, collection, tracking, loading, error, load } = useAdminStore();
  const section = consoleSection(useHash());

  useEffect(() => {
    if (access === 'admin') void load();
  }, [access, load]);

  const counts = useMemo(() => {
    const c = { free: 0, trial: 0, pro: 0, admin: 0, devices: 0, recent: 0 };
    const dayAgo = Date.now() - 86_400_000;
    for (const u of users) {
      c[u.tier] += 1;
      c.devices += u.devices;
      if (u.last_sign_in_at && Date.parse(u.last_sign_in_at) > dayAgo) c.recent += 1;
    }
    return c;
  }, [users]);

  if (!resolved) {
    return (
      <section className={styles.denied}>
        <p>Checking your account…</p>
      </section>
    );
  }

  if (access !== 'admin') {
    return (
      <section className={styles.denied}>
        <h2>Not your console</h2>
        <p>
          This screen is for administrators. Hiding it is a courtesy — the data behind it is refused by the database
          itself, so there is nothing here to find.
        </p>
        <a className={styles.back} href="#/">
          Back to Deckkies
        </a>
      </section>
    );
  }

  const ops = collection?.ops;
  const hot = analytics?.hot;
  const dots = {
    collection: worst(battleVerdict(ops?.collection?.newestBattle)),
    storage: worst(
      hot?.available ? diskVerdict(hot.sizeBytes, VPS_DISK_BYTES) : null,
      retentionVerdict(ops?.retention?.daysUntilFirstDelete),
    ),
    rollup: ops?.aggregates ? worst(coverageVerdict(ops.aggregates.coveragePct), rebuildVerdict(ops.aggregates.lastRebuild)) : null,
    site: worst(siteVerdict(health, analytics)),
  };

  const item = (id: ConsoleSection, icon: JSX.Element, extra: Partial<ShellItem> = {}): ShellItem => ({
    id,
    label: HEAD[id].title,
    icon,
    href: HREF(id),
    current: section === id,
    ...extra,
  });

  const groups: ShellGroup[] = [
    {
      id: 'console',
      label: 'Console',
      items: [
        item('overview', <GridIcon />),
        item('tracking', <RadarIcon />, {
          badge: tracking && tracking.queue.waiting > 0 ? tracking.queue.waiting : undefined,
        }),
        item('collection', <DatabaseIcon />, { status: dots.collection ?? undefined }),
        item('storage', <DiskIcon />, { status: dots.storage ?? undefined }),
        item('rollup', <LayersIcon />, { status: dots.rollup ?? undefined }),
        item('site', <GlobeIcon size={18} />, { status: dots.site ?? undefined }),
        item('accounts', <UsersIcon />, { badge: users.length || undefined }),
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      items: [
        { id: 'coach', label: 'Coach Roster', icon: <CoachIcon size={18} />, href: '#/admin/coach' },
        { id: 'home', label: 'Back to Deckkies', icon: <HomeIcon size={18} />, href: '#/' },
      ],
    },
  ];

  const open = (s: 'tracking' | 'collection' | 'accounts') => {
    window.location.hash = HREF(s);
  };

  return (
    <DashShell
      id="console"
      product="Console"
      title={HEAD[section].title}
      subtitle={HEAD[section].subtitle}
      groups={groups}
      actions={
        <ShellButton icon={<RefreshIcon />} onClick={() => void load()} disabled={loading} busy={loading} title="Read everything again">
          {loading ? 'Refreshing…' : 'Refresh'}
        </ShellButton>
      }
      banner={
        error ? (
          <p className="dk-banner" data-tone="bad">
            {error}
          </p>
        ) : undefined
      }
    >
      {section === 'overview' && (
        <ConsoleSummary users={users} counts={counts} collection={collection} analytics={analytics} tracking={tracking} onOpen={open} />
      )}
      {section === 'tracking' && <TrackingView />}
      {section === 'collection' && <CollectionView collection={collection} />}
      {section === 'storage' && <StorageView collection={collection} analytics={analytics} />}
      {section === 'rollup' && <RollupView collection={collection} />}
      {section === 'site' && <SiteView health={health} analytics={analytics} analyticsMs={analyticsMs} />}
      {section === 'accounts' && <AccountsView />}
    </DashShell>
  );
}

export default AdminConsole;
