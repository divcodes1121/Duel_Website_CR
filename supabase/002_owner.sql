-- ============================================================================
-- 002 — THE OWNER IS ABOVE ADMIN
-- ============================================================================
--
-- Idempotent, like 001. Run it in the Supabase SQL editor; re-running after an
-- edit is safe.
--
-- ── THE HOLE THIS CLOSES ──────────────────────────────────────────────────
--
-- `admin_set_role` in 001 refuses exactly one thing: changing your OWN role.
-- Every other row is fair game to any admin. So the moment a second admin
-- exists, that admin can call
--
--     select public.admin_set_role('<the owner>', 'free');
--
-- and the owner loses the console. There is no way back from inside the
-- product — the screen that could undo it is the screen they were just locked
-- out of — so recovery means the Supabase dashboard, which is the one place a
-- promoted admin does not have.
--
-- Promoting somebody was therefore an irreversible act of trust. It should not
-- be. An admin should be able to run the product without being able to take it.
--
-- ── WHY THE OWNER IS AN EMAIL, NOT A COLUMN OR A ROLE ─────────────────────
--
-- A `role = 'owner'` value or an `is_owner` column is data, and data is what
-- the admin functions edit. Any rule written in terms of a column has to be
-- defended against the same functions it is trying to constrain, and the first
-- mistake there hands over the thing being protected.
--
-- `auth.users.email` is not ours to edit. Nothing in this schema writes it, no
-- function here can reach it, and Supabase only changes it through a confirmed
-- flow the account holder completes themselves. A second admin cannot take the
-- owner's address either: changing an email to one already registered is
-- refused. So the identity is anchored outside the blast radius of every
-- function below.
--
-- The cost is honest: moving ownership means editing this file and re-running
-- it, in the dashboard. That is the correct amount of friction for the one
-- account that cannot be taken from the inside.

-- ── Who the owner is ────────────────────────────────────────────────────────

create or replace function public.owner_email()
returns text
language sql
immutable
as $$
  select 'singh.divyanshu1121@gmail.com'::text;
$$;

create or replace function public.is_owner(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- `lower()` on both sides: addresses are case-insensitive in practice and a
  -- capitalised sign-up must not read as a different person.
  select exists (
    select 1 from auth.users u
     where u.id = uid
       and lower(u.email) = lower(public.owner_email())
  );
$$;

revoke all on function public.is_owner(uuid) from public, anon;
grant execute on function public.is_owner(uuid) to authenticated;
revoke all on function public.owner_email() from public, anon;

-- ── The owner is always an admin ────────────────────────────────────────────
--
-- THE RECOVERY PROPERTY, and the reason this overrides rather than merely
-- guards. If the owner's `role` were ever set to something else — by a bug, by
-- a bad migration, by a hand-run UPDATE in the dashboard at 2am — every guard
-- below would still hold, but the owner would be locked out of the console and
-- unable to use it to put things back. Deriving the tier from the identity
-- instead of the column means the stored value can be wrong and the owner
-- still gets in.
--
-- Everything else about `effective_tier` is unchanged: this is 001's body with
-- one branch in front of it.
-- STILL `language sql`, and still the same shape as 001 — one branch in front
-- of the original CASE rather than a rewrite. An account with no profile row
-- returns null exactly as before: the inner scalar subquery yields null, which
-- is what the caller's `coalesce(..., 'free')` already expects.
create or replace function public.effective_tier(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_owner(uid) then 'admin'
    else (
      select case
        when p.role in ('pro', 'admin') then p.role
        when p.trial_ends_at is not null and p.trial_ends_at > now() then 'trial'
        else 'free'
      end
      from public.profiles p
      where p.id = uid
    )
  end;
$$;

grant execute on function public.effective_tier(uuid) to authenticated;

-- ── No admin function may touch the owner ───────────────────────────────────
--
-- Both of these are 001's bodies with one guard added. The guard is FIRST, so
-- it cannot be reached around by any later branch, and it is phrased as a
-- refusal rather than a silent no-op: an admin who tries this should be told,
-- not left believing it worked.

create or replace function public.admin_set_role(target uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.effective_tier(auth.uid()), 'free') <> 'admin' then
    raise exception 'not authorised';
  end if;
  if new_role not in ('free', 'pro', 'admin') then
    raise exception 'bad role';
  end if;

  -- THE OWNER'S ROLE IS NOT AN ADMIN'S TO SET. This is the whole point of the
  -- migration: without it, promoting somebody is handing them the ability to
  -- demote you, and the console is the only way back.
  if public.is_owner(target) then
    raise exception 'the owner''s role cannot be changed';
  end if;

  -- YOU CANNOT CHANGE YOUR OWN ROLE. (001's rule, unchanged.) It stops an
  -- admin demoting themselves by misclicking their own row, which is
  -- unrecoverable from inside the product, and stops a compromised session
  -- handing the role around and then dropping its own to look ordinary.
  if target = auth.uid() then
    raise exception 'cannot change your own role';
  end if;

  update public.profiles
     set role = new_role, updated_at = now()
   where id = target;
end;
$$;

create or replace function public.admin_end_trial(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.effective_tier(auth.uid()), 'free') <> 'admin' then
    raise exception 'not authorised';
  end if;

  -- The owner has no trial to end — `effective_tier` returns 'admin' from the
  -- identity — so this changes nothing about their access. It is refused
  -- anyway, because "the owner's row is not yours to write" is a simpler rule
  -- to keep true than a list of which writes happen to be harmless today.
  if public.is_owner(target) then
    raise exception 'the owner''s account cannot be modified';
  end if;

  -- now(), NOT null. Null reads as "never had a trial", which makes the person
  -- indistinguishable from a fresh account that has not started one -- and
  -- would let a later change hand them three more days.
  update public.profiles
     set trial_ends_at = now(), updated_at = now()
   where id = target;
end;
$$;

revoke all on function public.admin_set_role(uuid, text) from public, anon;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
revoke all on function public.admin_end_trial(uuid) from public, anon;
grant execute on function public.admin_end_trial(uuid) to authenticated;

-- ── The console needs to KNOW, so it can say so ─────────────────────────────
--
-- The list gains one column. A disabled control is a courtesy on top of the
-- rules above, never the rule itself — but a console that offers an action the
-- database will refuse is a console that teaches its operator to expect errors.
--
-- DROPPED FIRST, because `create or replace` cannot change a function's return
-- type — adding a column to a `returns table` is exactly that, and the replace
-- fails with "cannot change return type of existing function". The drop is
-- what makes this file re-runnable.
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
  is_owner boolean
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
           public.is_owner(p.id)
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
