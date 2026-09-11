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
  /** The one account no admin may touch — see `supabase/002_owner.sql`.
   *  Optional because a database still on 001 does not send it, and a console
   *  that crashes against an un-migrated schema is worse than one that shows a
   *  control the server will refuse. */
  is_owner?: boolean;
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
  /**
   * Whether the service could read its CARD REFERENCE DATA, which is a
   * different question from whether the database opened — and the console
   * needs both, because the day this was false every screen still answered
   * 200 with confident, wrong numbers. Optional: an older deployment does not
   * report it.
   */
  cardData?: { loaded: boolean; count: number; error: string | null };
  /**
   * The tag recruiter, which enrols players nobody searched for. Counts only,
   * never tags — and it rides on `/status` because "enabled but has never
   * completed a run" is invisible from every other angle. Optional for the
   * same reason `cardData` is: an older deployment does not report it.
   */
  recruit?: {
    enabled: boolean;
    opponents: boolean;
    lastRunAt: string | null;
    runs: number;
    lastAdded: number;
    queued: number;
    ceiling: number;
  };
}

/**
 * OPERATIONAL METRICS, from the same authenticated coverage route.
 *
 * WHY EACH GROUP IS HERE. The console used to report the database as ONE
 * number -- the file's size -- and a file whose size has not moved for two days
 * is either a dead collector or a healthy one writing into pages a large delete
 * freed earlier. Those two are indistinguishable from a single figure, and
 * telling them apart took an SSH session. Each group below is a question that
 * could not be answered from this screen:
 *
 *   collection  is anything still arriving, and how did the last poll go
 *   storage     of the bytes on disk, how many hold data and how many are free
 *   aggregates  how far the rollup has drifted behind the live table
 *   retention   how long before the window starts deleting anything
 *
 * EVERY FIELD IS NULLABLE, and that is not defensive typing -- the server
 * degrades group by group on purpose, so a missing table costs its own figures
 * and nothing else. A console read during an incident is exactly when a table
 * might be missing.
 */
export interface Ops {
  collection: {
    newestBattle: string | null;
    oldestBattle: string | null;
    battles: number;
    trackedPlayers: number;
    lastPollAt: string | null;
    lastPollMs: number | null;
    pollFailurePct: number | null;
  } | null;
  storage: {
    fileBytes: number;
    pageSize: number;
    pageCount: number;
    freePages: number;
    freeBytes: number;
    liveBytes: number;
  } | null;
  aggregates: {
    watermark: string | null;
    lastRebuild: string | null;
    statsBattles: number;
    pairGames: number;
    coveragePct: number | null;
  } | null;
  retention: {
    /** null when this service has not been told the bot's window. The console
     *  then says so rather than printing a number nobody measured. */
    days: number | null;
    boundary: string | null;
    daysUntilFirstDelete: number | null;
  } | null;
}

/** What the bot is collecting, from the authenticated coverage route. */
export interface Collection {
  trackedPlayers: number;
  global: { start: string | null; end: string | null; days: number } | null;
  /** Optional: an older deployment of the analytics API does not report it,
   *  and the console must still render against one that does not. */
  ops?: Ops;
}

interface AdminState {
  users: AdminUser[];
  health: Health | null;
  analytics: AnalyticsStatus | null;
  analyticsMs: number | null;
  collection: Collection | null;
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
  collection: null,
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });

    /* All three in parallel and none allowed to sink the others: the users
       table, the deployment's config and the VPS's storage are three
       independent things, and a console that shows nothing because one of them
       is down is worse than one that shows two thirds and says so. */
    const [users, health, analytics, collection] = await Promise.allSettled([
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
      /* How many players the bot is collecting. A FOURTH independent source,
         and like the other three it may fail without taking the console with
         it — the tracked count is context, not a health signal. It comes from
         `coverage` rather than `status` because `status` answers without a key
         and a population figure is not something to publish to anyone who
         curls it. */
      (async () => {
        const base = import.meta.env.VITE_ANALYTICS_BASE ?? '';
        const res = await fetch(`${base}/api/analytics/coverage`);
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as Collection;
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
    if (collection.status === 'fulfilled') next.collection = collection.value;

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
