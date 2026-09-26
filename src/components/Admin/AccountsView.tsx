import { useMemo, useState } from 'react';

import { type AdminUser, useAdminStore } from '../../state/adminStore';
import { useAccountStore } from '../../state/accountStore';
import { cumulativeAccounts, signInBuckets } from '../../state/consoleHealth';
import { TIER_ADMIN_LABEL } from '../../state/tiers';
import { shortDay } from '../../state/trackingSources';
import { ago, until } from '../../utils/format';
import {
  ChartCard,
  ChartGrid,
  ColumnChart,
  Dashboard,
  KeyMetricCard,
  MetricGrid,
  SegmentBar,
  TrendChart,
  type Trend,
} from '../ui/bionis-dashboard';
import { Dropdown } from '../ui/dropdown-menu-14';
import { BadgeIcon, CoachIcon, ListIcon, TrendIcon } from '../Dashboard/icons';
import { UsersIcon } from '../ui/dash-icons';
import styles from './ConsoleViews.module.css';

/**
 * THE ACCOUNTS VIEW — who has signed up, what they can open, and the controls
 * that change it.
 *
 * WHAT IT DOES NOT CLAIM. "Users currently online" is not a number this can
 * honestly report: there is no socket, and a JWT is valid for an hour whether
 * or not its owner is looking at the page. What IS knowable is when each
 * account last signed in and how many device slots it holds, so that is what
 * is shown — and it is labelled as such rather than dressed up as presence.
 *
 * NOTHING HERE IS TRUSTED TO THE CLIENT. `admin_list_users`, `admin_set_role`,
 * `admin_set_coach` and `admin_end_trial` are security-definer functions that
 * check the CALLER first; the disabled states below say why a control is dead,
 * and the database is the rule underneath them.
 */

const nf = new Intl.NumberFormat();

export function AccountsView() {
  const users = useAdminStore((s) => s.users);
  const loading = useAdminStore((s) => s.loading);
  const setRole = useAdminStore((s) => s.setRole);
  const setCoach = useAdminStore((s) => s.setCoach);
  const endTrial = useAdminStore((s) => s.endTrial);
  /* YOUR OWN ROW IS READ-ONLY for role: `admin_set_role` refuses
     `target = auth.uid()` outright, so this only spares you being told no. */
  const meId = useAccountStore((s) => s.userId);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const today = new Date().toISOString().slice(0, 10);
  const growth = useMemo(() => cumulativeAccounts(users.map((u) => u.created_at), today), [users, today]);
  const buckets = useMemo(() => signInBuckets(users), [users]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.email, u.display_name, u.player_tag, u.country, u.role]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    );
  }, [users, query]);

  const growthTrend: Trend | undefined =
    growth.length > 1
      ? {
          values: growth.map((g) => g.total),
          labels: growth.map((g) => shortDay(g.x)),
          format: (v) => `${nf.format(v)} accounts`,
          label: 'Accounts over time',
        }
      : undefined;

  async function changeCoach(u: AdminUser, value: boolean) {
    setBusyId(u.id);
    const err = await setCoach(u.id, value);
    setBusyId(null);
    if (err) alert(err);
  }

  async function change(u: AdminUser, value: string) {
    setBusyId(u.id);
    const err = value === '__end_trial' ? await endTrial(u.id) : await setRole(u.id, value as AdminUser['role']);
    setBusyId(null);
    if (err) alert(err);
  }

  return (
    <Dashboard>
      <MetricGrid>
        <KeyMetricCard
          label="Accounts"
          value={nf.format(users.length)}
          note={`${nf.format(counts.devices)} device slots held`}
          icon={<ListIcon />}
          tone="info"
          trend={growthTrend}
        />
        <KeyMetricCard
          label="Paid or trialling"
          value={nf.format(counts.pro + counts.trial)}
          delta={users.length > 0 ? `${Math.round(((counts.pro + counts.trial) / users.length) * 100)}% of accounts` : undefined}
          deltaTone="neutral"
          note={`${counts.pro} Pro · ${counts.trial} Member`}
          icon={<BadgeIcon />}
          tone={counts.pro > 0 ? 'good' : 'neutral'}
        />
        <KeyMetricCard
          label="Signed in today"
          value={nf.format(counts.recent)}
          note="last sign-in, not presence"
          icon={<TrendIcon />}
        />
        <KeyMetricCard label="Admins" value={nf.format(counts.admin)} note="may open this console" icon={<UsersIcon />} />
      </MetricGrid>

      <ChartGrid>
        <ChartCard title="Accounts over time" note="The running total, by the day each account was made" badge={`${nf.format(users.length)} total`}>
          <TrendChart
            data={growth}
            series={[{ key: 'total', label: 'Accounts', color: 'var(--chart-1)', format: (v) => nf.format(v) }]}
            curve="stepAfter"
            xFormat={shortDay}
            tipTitle={shortDay}
            tipLines={(row) => (Number(row.joined) > 0 ? [`${row.joined} joined this day`] : undefined)}
            height={220}
            label="Accounts over time"
            empty="No accounts yet."
          />
        </ChartCard>

        <ChartCard title="By tier" note="Every account, counted once" badge={`${nf.format(users.length)} accounts`}>
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

      <ChartCard title="Last sign-in" note="Accounts by how recently they last signed in — a sign-in is not presence">
        <ColumnChart
          bars={buckets.map((b) => ({
            label: b.label,
            value: b.count,
            tone: b.key === 'never' ? 'neutral' : 'info',
            detail: `${b.count} of ${users.length} account${users.length === 1 ? '' : 's'}`,
          }))}
          max={Math.max(1, ...buckets.map((b) => b.count))}
          height={200}
        />
      </ChartCard>

      <ChartCard title="Every account" note="Role, coach access and trials are changed here">
        <div className={styles.searchRow}>
          <input
            className={styles.search}
            value={query}
            placeholder="Filter by email, name, tag or country…"
            aria-label="Filter accounts"
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* The filter hides rows, so say how many. A typo and an account
              that does not exist look identical otherwise. */}
          <span className={styles.count}>
            {query.trim() && shown.length !== users.length
              ? `${shown.length} of ${users.length}`
              : `${users.length} account${users.length === 1 ? '' : 's'}`}
          </span>
        </div>

        <div className="bd-tableWrap">
          <table className="bd-table">
            <caption className="sr-only">Every account on the site</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Tier</th>
                <th scope="col">Country</th>
                <th scope="col">Player tag</th>
                <th scope="col">Last sign-in</th>
                <th scope="col" data-num="">
                  Devices
                </th>
                <th scope="col">Access</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id}>
                  <td className={styles.name}>
                    {u.display_name ?? '—'}
                    {u.id === meId && <span className={styles.you}>you</span>}
                    {/* THE OWNER IS MARKED, not just protected — an admin who
                        sees one row they cannot edit, and no reason why, will
                        assume the console is broken. */}
                    {u.is_owner && (
                      <span
                        className={styles.you}
                        data-owner=""
                        title="The owner. No admin can change this account's role or end its trial — the database refuses it, so promoting somebody can never cost you the console."
                      >
                        owner
                      </span>
                    )}
                  </td>
                  <td className={styles.email}>{u.email ?? '—'}</td>
                  <td>
                    <span className={styles.tier} data-tier={u.tier}>
                      {TIER_ADMIN_LABEL[u.tier] ?? u.tier}
                    </span>
                    {u.tier === 'trial' && u.trial_ends_at && <span className={styles.sub}>ends {until(u.trial_ends_at)}</span>}
                  </td>
                  <td>{u.country ?? '—'}</td>
                  <td className={styles.mono}>{u.player_tag ?? '—'}</td>
                  <td>{ago(u.last_sign_in_at)}</td>
                  <td data-num="">{u.devices}</td>
                  <td>
                    <div className={styles.access}>
                      <Dropdown
                        className={styles.roleSelect}
                        size="sm"
                        align="end"
                        caption="Role"
                        icon={<BadgeIcon />}
                        heading="Role"
                        subheading={u.email ?? undefined}
                        value={u.role}
                        disabled={busyId === u.id || u.id === meId || !!u.is_owner}
                        onChange={(v) => void change(u, v)}
                        title={
                          u.is_owner
                            ? "The owner's role cannot be changed by anyone, including another owner session. Moving it means editing supabase/002_owner.sql and re-running it in the dashboard"
                            : u.id === meId
                              ? 'You cannot change your own role — the database refuses it, so a misclick cannot lock you out of this console'
                              : 'Grant paid Pro, make an admin, or drop back to free'
                        }
                        options={[
                          { value: 'free', label: 'Free', description: 'The free areas only' },
                          { value: 'pro', label: 'Pro — paid', description: 'Every area, Coach Assist included' },
                          { value: 'admin', label: 'Admin', description: 'Everything, plus this console' },
                        ]}
                      />

                      {/* COACH IS NOT A ROLE, SO IT IS NOT IN THE ROLE LIST —
                          an account can be a coach on any tier. Your own row IS
                          allowed here: the console is reached through
                          `effective_tier`, which never reads `is_coach`, so
                          switching your own off is recoverable. */}
                      <Dropdown
                        className={styles.roleSelect}
                        size="sm"
                        align="end"
                        caption="Coach"
                        icon={<CoachIcon />}
                        heading="Coach Roster"
                        subheading={u.email ?? undefined}
                        value={u.is_coach ? 'yes' : 'no'}
                        disabled={busyId === u.id || (!!u.is_owner && u.id !== meId)}
                        onChange={(v) => void changeCoach(u, v === 'yes')}
                        title={
                          u.is_owner && u.id !== meId
                            ? "The owner's account cannot be modified by another admin"
                            : 'Whether this account may open Coach Roster and keep a roster of players'
                        }
                        options={[
                          { value: 'no', label: 'No', description: 'No access to Coach Roster' },
                          { value: 'yes', label: 'Yes', description: 'May keep a roster and coach players' },
                        ]}
                      />

                      {/* ENDING A TRIAL IS AN ACTION, SO IT IS A BUTTON — and
                          always enabled, because ending an ended trial is a
                          harmless no-op. */}
                      <button
                        type="button"
                        className={styles.endTrial}
                        disabled={busyId === u.id || u.id === meId || !!u.is_owner}
                        onClick={() => void change(u, '__end_trial')}
                        title={
                          u.is_owner
                            ? "The owner's account cannot be modified from here"
                            : u.tier === 'trial'
                              ? 'End this trial now — they drop to their role immediately'
                              : 'No trial running. This stamps the trial as spent so a later role change cannot hand them another one'
                        }
                      >
                        End trial
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className={styles.empty}>
                    {loading ? 'Loading…' : users.length ? 'Nothing matches that.' : 'No accounts yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </Dashboard>
  );
}
