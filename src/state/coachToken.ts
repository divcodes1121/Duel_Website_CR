import { supabase } from './supabase';

/**
 * The signed-in user's Supabase access token, for the admin-only analytics
 * routes (`X-Coach-Token`).
 *
 * ONE COPY, because two would drift. `PlayerWorkspace` and `ScoutTab` both
 * call the admin intel route, and a second hand-rolled `getSession()` in the
 * second caller is how one of them ends up sending a stale token after a
 * refresh, or none at all in a checkout with no Supabase.
 *
 * Null is a legitimate answer — a local checkout has no Supabase at all — and
 * the callers word the refusal the server sends back rather than guessing
 * here.
 */
export async function coachToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
