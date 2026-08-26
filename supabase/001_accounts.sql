-- Accounts, tiers, trials and device limits.
--
-- Run once in the Supabase SQL editor. It is idempotent, so re-running it after
-- an edit is safe.
--
-- WHY THIS IS ONE FILE AND NOT FOUR. Items 1 (three-day trial), 3 (Pro badge),
-- 5 (admin-created accounts) and 7 (one desktop + one mobile) are all the same
-- thing wearing different hats: per-user state that the browser must not be
-- able to forge. They share a table, so they share a migration.
--
-- THE SECURITY MODEL, stated once. `anon` is a PUBLIC key -- it ships in the
-- JavaScript bundle and anyone can read it out. Every rule below therefore
-- assumes the caller is hostile and holds that key. Row Level Security is what
-- makes that safe: a table with RLS on and no policy denies everything, and
-- each policy here grants the narrowest thing that works.

-- ---------------------------------------------------------------- profiles --

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  country       text,
  player_tag    text,

  -- 'free' | 'pro' | 'admin'. NOT a boolean: item 3 wants a Pro badge and
  -- item 4 wants an admin console, and those are three states, not two flags
  -- that can contradict each other.
  role          text not null default 'free'
                check (role in ('free', 'pro', 'admin')),

  -- Item 1. Set on signup by the trigger below. `trial_ends_at` is the whole
  -- mechanism: there is no scheduled job that "switches the account" -- the
  -- tier is DERIVED from this timestamp every time it is asked for, so it
  -- expires on its own, exactly on time, with nothing running.
  trial_ends_at timestamptz,

  -- Set when the three-step form is finished OR skipped. NOT inferred from
  -- the other columns: the signup trigger always fills display_name, and the
  -- player tag is legitimately skippable, so there is no combination of values
  -- that distinguishes "has not been asked" from "was asked and declined".
  onboarded_at  timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles add column if not exists onboarded_at timestamptz;

alter table public.profiles enable row level security;

-- A profile is readable and writable only by the person it belongs to.
-- `auth.uid()` is taken from the verified JWT, so it cannot be spoofed by a
-- client holding the anon key.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- NO INSERT POLICY, DELIBERATELY. Profiles are created by the trigger below,
-- which runs as the definer. A client that could insert its own row could
-- insert one with role = 'admin'.

-- COLUMN-LEVEL UPDATE, AND THIS IS NOT OPTIONAL.
--
-- The policy above says "you may update your own row", and `role` is a column
-- ON that row -- so with a plain table-level UPDATE grant, any signed-in user
-- could PATCH themselves to role = 'admin' with one request. That was not a
-- theory: it was tried against this project with a real account's token and it
-- WORKED, and it was only found because the check was run instead of assumed.
--
-- Leaving `role` out of the client's saveProfile() is NOT a fix. That stops our
-- code from doing it; the REST endpoint is public and anyone can call it with
-- their own token.
--
-- RLS decides WHICH ROWS may be written. Only a column grant decides WHICH
-- COLUMNS. An update touching `role` or `trial_ends_at` is now refused by
-- Postgres before any policy is consulted, so both move only through
-- admin_set_role(), which checks the caller.
revoke update on public.profiles from authenticated;
grant update (display_name, country, player_tag, onboarded_at, updated_at)
  on public.profiles to authenticated;

-- ------------------------------------------------------------------ tiers --

-- The tier a user actually has right now. One definition, used by the app, by
-- the policies below, and by the admin console -- so "is this person Pro"
-- cannot get three different answers.
create or replace function public.effective_tier(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.role in ('pro', 'admin') then p.role
    when p.trial_ends_at is not null and p.trial_ends_at > now() then 'trial'
    else 'free'
  end
  from public.profiles p
  where p.id = uid;
$$;

-- Item 1: a new account starts with three days of everything.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, trial_ends_at)
  values (
    new.id,
    -- Google sign-in supplies a name; email sign-up does not, so fall back to
    -- the part before the @ rather than leaving the greeting blank.
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    now() + interval '3 days'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- devices --

-- Item 7: one desktop and one mobile per account, and no more.
--
-- `unique (user_id, kind)` IS the whole enforcement. A second desktop login
-- upserts onto the same row with a new `device_id`, and the previously signed
-- in desktop discovers on its next heartbeat that the stored id is no longer
-- its own -- at which point it signs itself out. No cron, no reaper.
create table if not exists public.device_sessions (
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('desktop', 'mobile')),
  device_id   text not null,
  user_agent  text,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.device_sessions enable row level security;

drop policy if exists "read own devices" on public.device_sessions;
create policy "read own devices" on public.device_sessions
  for select using (auth.uid() = user_id);

drop policy if exists "claim own device" on public.device_sessions;
create policy "claim own device" on public.device_sessions
  for insert with check (auth.uid() = user_id);

drop policy if exists "refresh own device" on public.device_sessions;
create policy "refresh own device" on public.device_sessions
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "release own device" on public.device_sessions;
create policy "release own device" on public.device_sessions
  for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------------ admin --

-- Item 4 and 5 need a view across ALL users, which every policy above exists
-- to prevent. This is the one sanctioned exception: security definer, and it
-- checks the caller is an admin itself rather than trusting the client to only
-- call it when appropriate.
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
  devices int
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
           (select count(*)::int from public.device_sessions d where d.user_id = p.id)
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

-- Item 5: an admin changing someone's tier from the console.
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
  update public.profiles
     set role = new_role, updated_at = now()
   where id = target;
end;
$$;

-- Only signed-in callers may even attempt these; the definer body then decides.
-- Ending someone's trial on the spot. Separate from admin_set_role because it
-- is not a role change: a lapsed trial user is still `free`, and conflating the
-- two would mean "end the trial" had to guess what role to leave them on.
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
  -- now(), NOT null. Null reads as "never had a trial", which makes the person
  -- indistinguishable from a fresh account that has not started one -- and
  -- would let a later change hand them three more days.
  update public.profiles
     set trial_ends_at = now(), updated_at = now()
   where id = target;
end;
$$;

revoke all on function public.admin_end_trial(uuid) from public, anon;
grant execute on function public.admin_end_trial(uuid) to authenticated;

revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_set_role(uuid, text) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.effective_tier(uuid) to authenticated;
