import { useEffect, useMemo, useState } from 'react';

import { type AdminUser, useAdminStore } from '../../state/adminStore';
import { ago, bytes, until } from '../../utils/format';
import { useAccess } from '../../state/gate';
import { ThemeToggle } from '../Theme/ThemeToggle';
import styles from './AdminConsole.module.css';

/** Contabo Cloud VPS 6 root volume, from `df -h /` on the box. */
const VPS_DISK_BYTES = 387 * 1024 ** 3;

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className={styles.stat} data-tone={tone}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      {note && <span className={styles.statNote}>{note}</span>}
    </div>
  );
}

/** A capacity bar. Colour is a FUNCTION of the fill, so it cannot disagree. */
function Meter({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const tone = pct > 90 ? 'bad' : pct > 75 ? 'warn' : 'good';
  return (
    <div className={styles.meter}>
      <div className={styles.meterHead}>
        <span>{label}</span>
        <span className={styles.meterFigure}>
          {bytes(used)} / {bytes(total)} · {pct.toFixed(1)}%
        </span>
      </div>
      <div className={styles.meterTrack}>
        <div className={styles.meterFill} data-tone={tone} style={{ scale: `${pct / 100} 1` }} />
      </div>
    </div>
  );
}

/**
 * Items 4, 5 and 6: every account, their tier, and what the deployment can reach.
 *
 * ONE SCREEN, because they are one question — "what is going on" — and splitting
 * it into three would mean checking three places to answer it.
 *
 * WHAT IT DOES NOT CLAIM. "Users currently online" is not a number this can
 * honestly report: there is no socket, and a JWT is valid for an hour whether
 * or not its owner is looking at the page. What IS knowable is when each
 * account last signed in and how many device slots it holds, so that is what is
 * shown — and it is labelled as such rather than dressed up as presence.
 */
export function AdminConsole() {
  const access = useAccess();
  const { users, health, analytics, analyticsMs, loading, error, load, setRole, endTrial } =
    useAdminStore();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (access === 'admin') void load();
  }, [access, load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.email, u.display_name, u.player_tag, u.country, u.role]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    );
  }, [users, query]);

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

  if (access !== 'admin') {
    return (
      <section className={styles.denied}>
        <h2>Not your console</h2>
        <p>
          This screen is for administrators. Hiding it is a courtesy — the data
          behind it is refused by the database itself, so there is nothing here
          to find.
        </p>
      </section>
    );
  }

  async function change(u: AdminUser, value: string) {
    setBusyId(u.id);
    const err =
      value === '__end_trial'
        ? await endTrial(u.id)
        : await setRole(u.id, value as AdminUser['role']);
    setBusyId(null);
    if (err) alert(err);
  }

  return (
    <section className={styles.wrap}>
      <header className={styles.head}>
        {/* A WAY BACK. The console is its own route outside the Dashboard, so
            it inherits none of the app's navigation — without this the only
            exit is the browser's back button, and there is none at all for
            someone who arrived by typing the URL. */}
        <a className={styles.back} href="#/">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Home
        </a>

        <h2 className={styles.title}>Console</h2>

        <div className={styles.headActions}>
          {/* Every colour here is already a token, so the console follows the
              theme — but the control to CHANGE it lives in the Dashboard header
              this route does not render. */}
          <ThemeToggle size="1.8rem" />
          <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {/* --- accounts ------------------------------------------------------ */}
      <div className={styles.stats}>
        <Stat label="Accounts" value={String(users.length)} />
        <Stat label="On trial" value={String(counts.trial)} tone="good" />
        <Stat label="Pro" value={String(counts.pro)} tone="good" />
        <Stat label="Free" value={String(counts.free)} />
        <Stat
          label="Signed in today"
          value={String(counts.recent)}
          note="last sign-in, not presence"
        />
        <Stat label="Device slots held" value={String(counts.devices)} note="max 2 per account" />
      </div>

      {/* --- what this deployment can reach -------------------------------- */}
      <h3 className={styles.section}>Health</h3>
      <div className={styles.stats}>
        <Stat
          label="Deployment"
          value={health?.commit ?? '—'}
          note={health ? `${health.env} · ${health.region ?? '?'}` : 'unreachable'}
          tone={health ? 'good' : 'bad'}
        />
        <Stat
          label="Analytics API"
          value={analytics ? `${analyticsMs} ms` : 'down'}
          note={analytics?.hot.available ? 'database attached' : 'no database'}
          tone={analytics?.hot.available ? 'good' : 'bad'}
        />
        {/* A DATABASE THAT OPENS IS NOT A SERVICE THAT CAN ANSWER. The card
            reference files went missing on the VPS deploy and every analytics
            screen kept returning 200 — Win Conditions and Spells showed 0, the
            Cards board was blank, and every deck name went generic — with
            nothing anywhere reporting a fault. This tile is the fault. */}
        {analytics?.cardData && (
          <Stat
            label="Card data"
            value={analytics.cardData.loaded ? `${analytics.cardData.count} cards` : 'MISSING'}
            note={
              analytics.cardData.loaded
                ? 'win cons, spells, elixir'
                : (analytics.cardData.error ?? 'not loaded')
            }
            tone={analytics.cardData.loaded ? 'good' : 'bad'}
          />
        )}
        {health &&
          Object.entries(health.configured).map(([k, v]) => (
            <Stat
              key={k}
              label={k.replace(/([A-Z])/g, ' $1').toLowerCase()}
              value={v ? 'set' : 'not set'}
              tone={v ? 'good' : 'warn'}
            />
          ))}
      </div>

      {/* --- storage -------------------------------------------------------- */}
      {analytics?.hot.available && (
        <>
          <h3 className={styles.section}>Storage</h3>
          <Meter
            used={analytics.hot.sizeBytes}
            total={VPS_DISK_BYTES}
            label="battles.db on the Contabo volume"
          />
          <p className={styles.hint}>
            Retention is capped at 304 days (10 months), so this plateaus rather
            than growing forever — but the window is only about a quarter full,
            so today's figure is not the steady state. Measured on 2026-08-26:
            7.24M battles over 86 days at ~1.4&nbsp;KB each, ~158k battles/day,
            which projects to roughly 105&nbsp;GB once the full window is held.
            That assumes the tracked-player count stays where it is — battle
            volume scales with it, and so does everything here.
          </p>
        </>
      )}

      {/* --- the accounts themselves --------------------------------------- */}
      <h3 className={styles.section}>Accounts</h3>
      <div className={styles.searchRow}>
        <input
          className={styles.search}
          value={query}
          placeholder="Filter by email, name, tag or country…"
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* The filter hides rows, so say how many. Without this a typo in the
            box and an account that genuinely does not exist look identical. */}
        <span className={styles.count}>
          {query.trim() && shown.length !== users.length
            ? `${shown.length} of ${users.length}`
            : `${users.length} account${users.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Tier</th>
              <th>Country</th>
              <th>Player tag</th>
              <th>Last sign-in</th>
              <th>Devices</th>
              <th>Set role</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id}>
                <td className={styles.name}>{u.display_name ?? '—'}</td>
                <td className={styles.email}>{u.email ?? '—'}</td>
                <td>
                  <span className={styles.tier} data-tier={u.tier}>
                    {u.tier}
                  </span>
                  {u.tier === 'trial' && u.trial_ends_at && (
                    <span className={styles.sub}>ends {until(u.trial_ends_at)}</span>
                  )}
                </td>
                <td>{u.country ?? '—'}</td>
                <td className={styles.mono}>{u.player_tag ?? '—'}</td>
                <td>{ago(u.last_sign_in_at)}</td>
                <td>{u.devices}</td>
                <td>
                  <select
                    className={styles.roleSelect}
                    value={u.role}
                    disabled={busyId === u.id}
                    onChange={(e) => void change(u, e.target.value)}
                  >
                    <option value="free">free</option>
                    <option value="pro">pro</option>
                    <option value="admin">admin</option>
                    {/* An ACTION in a list of states, which is a compromise:
                        it is where you already are when you want it. Disabled
                        unless there is a trial to end, so it never looks like a
                        fourth role someone could be left on. */}
                    <option value="__end_trial" disabled={u.tier !== 'trial'}>
                      end trial now
                    </option>
                  </select>
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

      <p className={styles.hint}>
        Changing a role takes effect on that account's next profile read — a
        sign-in, or a refresh. There is no way to create a password from here:
        people sign themselves up, and you promote them. Handing out passwords
        would mean storing one somewhere you could read it back.
      </p>
    </section>
  );
}
