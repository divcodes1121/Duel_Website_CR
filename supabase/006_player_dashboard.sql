-- 006 — a roster player can see their own dashboard (Coach Roster phase 14)
--
-- WHAT IS MISSING. `coach_players` is admin-only AND `coach_id = auth.uid()`,
-- so a player cannot read it at all — they cannot even discover that they are
-- on a roster. Everything the dashboard needs is behind that policy.
--
-- ── WHY THIS IS NOT A TAG MATCH, WHICH IS THE OBVIOUS DESIGN ──────────────
--
-- `profiles.player_tag` already exists, so the tempting join is
-- `profiles.player_tag = coach_players.player_tag`. **It is spoofable.** That
-- column is written by the player through the ordinary profile update grant
-- (001 grants update on `player_tag` to the owner of the row), so ANY account
-- could type a roster player's tag into their own profile and be handed that
-- player's coaching data. Nothing else on the site cares what tag a profile
-- claims, so the column has never had to be trustworthy — and this would be
-- the first thing to trust it.
--
-- So the link is EXPLICIT AND THE COACH MAKES IT: `linked_user_id` on the
-- roster row, writable only by that row's coach. That is also the permission
-- model asked for in words — "only for the people I will give permission to"
-- — and it is the hook a later badge or scout grant hangs off.
--
-- ── WHAT A LINKED PLAYER MAY AND MAY NOT SEE ─────────────────────────────
--
-- MAY: that they are on a roster, the coach's display name for them, their own
-- tag, and the decks the coach has APPROVED for them (status 'active').
--
-- MAY NOT: `coach_players.notes`. Those are the coach's working notes ABOUT
-- the player, written in the expectation that the player is not reading them,
-- and handing them over silently would change what a coach can safely write.
-- The read function below does not select that column at all — this is not a
-- UI decision that a later screen could quietly reverse.
--
-- ── A COACH MAY BE ONE OF THEIR OWN PLAYERS ──────────────────────────────
--
-- Nothing special is needed for it: the coach adds themselves to the roster
-- like anybody else and links their OWN email, so `linked_user_id` is their
-- own id and `my_coach_players()` returns that row. Both roles are then true
-- of one account at once, which is the honest shape — an admin still gets the
-- coach panel, and their own player dashboard is one more thing they can open
-- from it rather than a different mode the app has to switch into.
--
-- Nothing here weakens an existing policy. Both reads are SECURITY DEFINER
-- functions with a pinned `search_path`, each filtered to `auth.uid()`, so the
-- table policies stay exactly as 004 wrote them.
--
-- Safe to run more than once.

-- ── 1. the link ───────────────────────────────────────────────────────────

alter table public.coach_players
  add column if not exists linked_user_id uuid references auth.users (id) on delete set null;

comment on column public.coach_players.linked_user_id is
  'The account this roster player signs in as, set by their coach. NOT derived '
  'from profiles.player_tag, which the player writes themselves and which is '
  'therefore not evidence of who they are.';

-- ON DELETE SET NULL, not CASCADE: an account being deleted must not delete
-- the coach's roster row, their arsenal, or their history. The link goes; the
-- player stays.

-- One account cannot be two players on one roster. Two different coaches may
-- each link the same account, which is correct — a player can have two
-- coaches — so this is scoped to the coach, not global.
create unique index if not exists coach_players_linked_uniq
  on public.coach_players (coach_id, linked_user_id)
  where linked_user_id is not null;

-- ── 2. the coach links an account, by email ──────────────────────────────

create or replace function public.coach_link_player(
  p_player_id uuid,
  p_email     text
) returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid;
begin
  -- The caller must own the roster row. `coach_id` is checked explicitly
  -- because a SECURITY DEFINER function runs past RLS.
  if not exists (
    select 1 from public.coach_players
    where id = p_player_id and coach_id = auth.uid()
  ) then
    raise exception 'that player is not on your roster';
  end if;

  select id into v_user from auth.users
   where lower(email) = lower(trim(p_email));

  if v_user is null then
    -- SAID PLAINLY, and it is not a leak: the caller already knows the address
    -- they typed, and the alternative is a coach staring at a link that
    -- silently did nothing.
    raise exception 'no account has signed up with that email yet';
  end if;

  update public.coach_players
     set linked_user_id = v_user, updated_at = now()
   where id = p_player_id and coach_id = auth.uid();

  return v_user;
end;
$$;

create or replace function public.coach_unlink_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.coach_players
    where id = p_player_id and coach_id = auth.uid()
  ) then
    raise exception 'that player is not on your roster';
  end if;
  update public.coach_players
     set linked_user_id = null, updated_at = now()
   where id = p_player_id and coach_id = auth.uid();
end;
$$;

-- ── 3. what the linked player may read ───────────────────────────────────

-- NOTE THE ABSENT COLUMN. `notes` is deliberately not selected; see the header.
create or replace function public.my_coach_players()
returns table (
  id           uuid,
  player_tag   text,
  display_name text,
  is_active    boolean,
  coach_name   text
)
language sql
stable
security definer
set search_path = public
as $$
  select cp.id, cp.player_tag, cp.display_name, cp.is_active,
         coalesce(pr.display_name, 'Your coach')
    from public.coach_players cp
    left join public.profiles pr on pr.id = cp.coach_id
   where cp.linked_user_id = auth.uid()
$$;

-- THE DECLARED TYPES ARE THE TABLE'S OWN, COLUMN FOR COLUMN. A `returns
-- table` signature is checked against the final select at CREATE time, and
-- Postgres will not widen for you: `cards` is `text[]` (004 line 138, with a
-- CHECK that needs an array), not jsonb, and `comfort` is `smallint`, not
-- integer. Both were guessed wrong here and the first run failed on the first
-- of them — "return type mismatch ... returns text[] instead of jsonb at
-- column 5". A grammar parser cannot catch this; only the real table can.
create or replace function public.my_coach_decks()
returns table (
  id          uuid,
  player_id   uuid,
  name        text,
  archetype   text,
  cards       text[],
  comfort     smallint,
  sort_order  integer
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.player_id, d.name, d.archetype, d.cards, d.comfort, d.sort_order
    from public.coach_decks d
    join public.coach_players cp on cp.id = d.player_id
   where cp.linked_user_id = auth.uid()
     and d.status = 'active'
$$;

-- ── 4. grants ────────────────────────────────────────────────────────────
--
-- `anon` gets nothing, as everywhere else in this schema. EXECUTE is revoked
-- from public first: a function is executable by public by default, and
-- granting to `authenticated` on its own would leave that default in place.

revoke execute on function public.coach_link_player(uuid, text) from public;
revoke execute on function public.coach_unlink_player(uuid) from public;
revoke execute on function public.my_coach_players() from public;
revoke execute on function public.my_coach_decks() from public;

grant execute on function public.coach_link_player(uuid, text) to authenticated;
grant execute on function public.coach_unlink_player(uuid) to authenticated;
grant execute on function public.my_coach_players() to authenticated;
grant execute on function public.my_coach_decks() to authenticated;
