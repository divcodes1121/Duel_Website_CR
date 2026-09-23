-- 007 — Coach is a flag on an account, set from the console
--
-- Coach Roster has been admin-only since phase 1, which conflated two
-- different things: "may administer this site" and "coaches players here".
-- They are not the same person, and the first is far more power than the
-- second needs. `is_coach` separates them.
--
-- DEFAULT FALSE FOR EVERYONE, INCLUDING EVERY EXISTING ACCOUNT. Nobody gains
-- anything by this migration running; access is only ever granted by an
-- explicit switch in the console.
--
-- ── IT IS NOT IN THE COLUMN GRANT, AND THAT IS THE WHOLE SECURITY OF IT ───
--
-- 001 grants `update` on profiles for exactly five columns — display_name,
-- country, player_tag, onboarded_at, updated_at — so `role` and
-- `trial_ends_at` are not writable over REST at all and `admin_set_role` is
-- the only door. `is_coach` joins that protected set by simply not being
-- added to the grant: a new column is not writable unless it is named. So the
-- function below is the only way to set it, and its guards are the whole
-- rule.
--
-- ── WHAT THE GUARDS ARE, AND HOW THEY DIFFER FROM `admin_set_role` ───────
--
-- `admin_set_role` refuses to let anyone change their OWN role, because an
-- admin demoting themselves by misclicking their own row cannot be undone
-- from inside the product. **That reasoning does not carry here.** Console
-- access is `effective_tier(...) = 'admin'`, which does not read `is_coach`
-- at all, so an admin who switches their own coach flag off can switch it
-- straight back on. Self-service is therefore safe, and it is also the only
-- way the owner can make themselves a coach.
--
-- The owner is still protected FROM OTHER ADMINS, as 002 established: an
-- admin may not reach into the owner's account. Ordered so that "it is my own
-- row" is tested first, or the owner would be locked out of their own switch.
--
-- Safe to run more than once.

alter table public.profiles
  add column if not exists is_coach boolean not null default false;

comment on column public.profiles.is_coach is
  'May use Coach Roster. Separate from role: coaching is not administering. '
  'Not in the profiles update grant, so admin_set_coach is the only door.';

create or replace function public.admin_set_coach(target uuid, value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.effective_tier(auth.uid()), 'free') <> 'admin' then
    raise exception 'not authorised';
  end if;

  -- YOUR OWN ROW FIRST. Unlike a role, this is recoverable — the console is
  -- reached through `effective_tier`, which never reads `is_coach` — so there
  -- is no reason to stop it, and it is how the owner grants themselves the
  -- roster.
  if target = auth.uid() then
    update public.profiles set is_coach = coalesce(value, false), updated_at = now()
     where id = target;
    return;
  end if;

  -- AN ADMIN MAY NOT REACH INTO THE OWNER'S ACCOUNT (002's rule).
  if public.is_owner(target) then
    raise exception 'the owner''s account cannot be modified';
  end if;

  if not exists (select 1 from public.profiles where id = target) then
    raise exception 'no such account';
  end if;

  update public.profiles set is_coach = coalesce(value, false), updated_at = now()
   where id = target;
end;
$$;

revoke all on function public.admin_set_coach(uuid, boolean) from public, anon;
grant execute on function public.admin_set_coach(uuid, boolean) to authenticated;

-- ── the console's list gains a column ────────────────────────────────────
--
-- DROPPED, NOT REPLACED. A `returns table` column IS part of the function's
-- return type, and `create or replace` cannot change a return type — 002
-- records hitting exactly this, and without the drop the migration fails on
-- its second run rather than its first.

drop function if exists public.admin_list_users();

create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  display_name text,
  country text,
  player_tag text,
  role text,
  tier text,
  trial_ends_at timestamptz,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  devices int,
  is_owner boolean,
  is_coach boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.effective_tier(auth.uid()), 'free') <> 'admin' then
    raise exception 'not authorised';
  end if;

  return query
    select p.id, u.email::text, p.display_name, p.country, p.player_tag,
           p.role, public.effective_tier(p.id), p.trial_ends_at, p.created_at,
           u.last_sign_in_at,
           (select count(*)::int from public.device_sessions d where d.user_id = p.id),
           public.is_owner(p.id),
           coalesce(p.is_coach, false)
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
