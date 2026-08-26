import { create } from 'zustand';

import { supabase } from './supabase';

/**
 * The admin console's data: every account, and the deployment's own health.
 *
 * NOTHING HERE IS TRUSTED TO THE CLIENT. `admin_list_users()` and
 * `admin_set_role()` are security-definer functions that check the CALLER is an
 * admin before doing anything — so hiding this screen is a courtesy to
 * non-admins, not the security boundary. A free user who typed the route would
 * get an empty table and a "not authorised" error, which is the correct answer
 * rather than a leak.
 */

export interface AdminUser {
  id: string;
  email: string | null;
  display_name: string | null;
  country: string | null;
  player_tag: string | null;
  role: 'free' | 'pro' | 'admin';
  tier: 'free' | 'trial' | 'pro' | 'admin';
  trial_ends_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  devices: number;
}

export interface Health {
  ok: boolean;
  time: string;
  region: string | null;
  env: string;
  commit: string | null;
  configured: Record<string, boolean>;
}

/** What the analytics API on the VPS reports about its own storage. */
export interface AnalyticsStatus {
  hot: { available: boolean; sizeBytes: number };
  archive: { available: boolean; sizeBytes: number };
}

interface AdminState {
  users: AdminUser[];
  health: Health | null;
  analytics: AnalyticsStatus | null;
  analyticsMs: number | null;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  setRole: (id: string, role: AdminUser['role']) => Promise<string | null>;
  endTrial: (id: string) => Promise<string | null>;
}

export const useAdminStore = create<AdminState>()((set, get) => ({
  users: [],
  health: null,
  analytics: null,
  analyticsMs: null,
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });

    /* All three in parallel and none allowed to sink the others: the users
       table, the deployment's config and the VPS's storage are three
       independent things, and a console that shows nothing because one of them
       is down is worse than one that shows two thirds and says so. */
    const [users, health, analytics] = await Promise.allSettled([
      supabase
        ? supabase.rpc('admin_list_users')
        : Promise.reject(new Error('not configured')),
      fetch('/api/health').then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      (async () => {
        const base = import.meta.env.VITE_ANALYTICS_BASE ?? '';
        const t0 = performance.now();
        const res = await fetch(`${base}/api/analytics/status`);
        const body = await res.json();
        return { body, ms: Math.round(performance.now() - t0) };
      })(),
    ]);

    const next: Partial<AdminState> = { loading: false };

    if (users.status === 'fulfilled' && !users.value.error) {
      next.users = (users.value.data ?? []) as AdminUser[];
    } else {
      const e = users.status === 'rejected' ? users.reason : users.value.error;
      next.error = e?.message ?? 'Could not load accounts.';
    }

    if (health.status === 'fulfilled') next.health = health.value as Health;
    if (analytics.status === 'fulfilled') {
      next.analytics = analytics.value.body as AnalyticsStatus;
      next.analyticsMs = analytics.value.ms;
    }

    set(next);
  },

  /** Item: end someone's trial now. Not a role change — see the SQL. */
  async endTrial(id) {
    if (!supabase) return 'Not configured.';
    const { error } = await supabase.rpc('admin_end_trial', { target: id });
    if (error) return error.message;
    await get().load();
    return null;
  },

  async setRole(id, role) {
    if (!supabase) return 'Not configured.';
    const { error } = await supabase.rpc('admin_set_role', { target: id, new_role: role });
    if (error) return error.message;
    /* Re-read rather than patching locally. `role` and `tier` are not the same
       thing — promoting someone to pro also ends their trial's relevance — and
       the database is the only place that knows the derived answer. */
    await get().load();
    return null;
  },
}));

/** Bytes as something a person can read. */
export function bytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'kB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** "3 minutes ago", "2 days ago", or "never". */
export function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
