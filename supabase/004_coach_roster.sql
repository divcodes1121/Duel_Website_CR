-- ============================================================================
-- 004 — COACH ROSTER: the coaching state, and nothing else
-- ============================================================================
--
-- Idempotent, like 001 and 002. Run it in the Supabase SQL editor AFTER 002;
-- re-running after an edit is safe. Then run 004_coach_roster_verify.sql,
-- which returns one row per check.
--
-- ── WHAT LIVES HERE, AND WHAT DOES NOT ─────────────────────────────────────
--
-- Only the state a COACH creates: who is on their roster, which decks each
-- player is comfortable with, the match plans they draw up, and what actually
-- happened. Every battle, deck, matchup and prediction stays where it already
-- is — the bot's database on the VPS, which this project only ever opens
-- `mode=ro`. Nothing here references it, copies it, or writes to it.
--
-- WHY NOT THE BOT'S `recommendation_events` / `recommendation_outcomes`. They
-- exist (4 rows / 0 rows, written by the bot's `!suggestion`), but they are the
-- bot's tables in the bot's file: writing to them would break the read-only
-- guarantee the whole analytics API is built on, and would mix an experimental
-- coaching workflow into the data the prediction engine is measured against.
-- A plan here keeps its own snapshot of what was recommended and why.
--
-- ── THE SECURITY MODEL ─────────────────────────────────────────────────────
--
-- Same as 001: the anon key is public, so every rule assumes a hostile caller
-- holding it. Two conditions on EVERY row, enforced by Row Level Security:
--
--   1. the caller is an admin — `effective_tier(auth.uid())`, the ONE
--      definition of a tier (it already puts the owner above admin); and
--   2. the row is theirs — `coach_id = auth.uid()`.
--
-- So a roster is PERSONAL: a second admin gets their own, empty. And a
-- non-admin — or someone whose admin role is removed later — reads nothing
-- and writes nothing, including rows they created while they were an admin.
--
-- RLS decides which ROWS. It cannot stop a child row POINTING at a parent the
-- caller cannot see — a foreign-key check runs without RLS — so every child
-- carries `coach_id` too, and references its parent by (id, coach_id). A deck
-- or a plan can therefore never be attached to another coach's player.

-- ── helpers ─────────────────────────────────────────────────────────────────

-- Is the caller an admin? One expression the policies share, so "who may
-- coach" cannot drift from "who is an admin" anywhere else in this schema.
-- `coalesce(..., 'free')`: an account with no profile row reads as free, the
-- convention 001's admin functions already use.
create or replace function public.coach_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.effective_tier(auth.uid()), 'free') = 'admin';
$$;

revoke all on function public.coach_is_admin() from public, anon;
grant execute on function public.coach_is_admin() to authenticated;

-- A deck is eight distinct card keys, in the form the catalogue uses
-- ('hog-rider', 'mini-pekka'). Whether each key is a REAL card is checked by
-- the app against the catalogue it ships with; the database refuses what can
-- never be a deck.
create or replace function public.coach_valid_deck(cards text[])
returns boolean
language sql
immutable
as $$
  -- COALESCE, because a CHECK treats NULL as a pass: a null card makes the
  -- pattern test null, and without this an array holding one would be let in.
  select coalesce(
    cards is not null
      and array_length(cards, 1) = 8
      and (select count(distinct c) from unnest(cards) c) = 8
      and (select bool_and(c is not null and c ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
             from unnest(cards) c),
    false);
$$;

-- A deck's identity, independent of card order, so the same eight cards are
-- one deck in an arsenal however they were entered.
create or replace function public.coach_deck_key(cards text[])
returns text
language sql
immutable
as $$
  select array_to_string(array(select c from unnest(cards) c order by c), ',');
$$;

create or replace function public.coach_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── coach_players — the roster ─────────────────────────────────────────────

create table if not exists public.coach_players (
  id            uuid primary key default gen_random_uuid(),
  coach_id      uuid not null default auth.uid()
                references auth.users (id) on delete cascade,

  -- '#' + 5–12 of the 14-symbol Supercell alphabet: exactly the rule
  -- `clash_data.normalize_tag` and `squadParse.ts` apply, so a tag this table
  -- accepts is one the analytics API will also accept.
  player_tag    text not null
                check (player_tag ~ '^#[0289PYLQGRJCUV]{5,12}$'),
  display_name  text check (char_length(display_name) <= 40),
  notes         text check (char_length(notes) <= 4000),

  -- ARCHIVED, NOT DELETED, once a player has history. Plans and results
  -- reference the player with ON DELETE RESTRICT, so a player with recorded
  -- outcomes cannot be deleted by accident — the app archives them instead,
  -- and a player with no history can still be removed outright.
  is_active     boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (coach_id, player_tag),
  -- The target of every child's composite foreign key; see the header.
  unique (id, coach_id)
);

-- ── coach_decks — each player's Deck Arsenal ───────────────────────────────

create table if not exists public.coach_decks (
  id            uuid primary key default gen_random_uuid(),
  coach_id      uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  player_id     uuid not null,

  cards         text[] not null check (public.coach_valid_deck(cards)),
  deck_key      text generated always as (public.coach_deck_key(cards)) stored,

  name          text check (char_length(name) <= 60),
  archetype     text check (char_length(archetype) <= 40),
  -- 1–5 stars, or not rated.
  comfort       smallint check (comfort between 1 and 5),
  -- Free-form labels: Primary, Backup, Anti-Beatdown, Tournament… Kept as
  -- data rather than as columns, because the list is the coach's to grow.
  tags          text[] not null default '{}'
                check (cardinality(tags) <= 12),
  status        text not null default 'active'
                check (status in ('active', 'archived')),

  -- Where the deck came from, so "the coach chose this" and "the engine
  -- suggested this" are never confused later.
  source        text not null default 'manual'
                check (source in ('manual', 'link', 'history', 'coach_assist', 'variant')),
  -- What it came from: a battle, a recommendation, the deck it varies.
  source_ref    jsonb check (octet_length(source_ref::text) <= 8192),
  notes         text check (char_length(notes) <= 4000),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (player_id, deck_key),
  unique (id, coach_id),
  foreign key (player_id, coach_id)
    references public.coach_players (id, coach_id) on delete cascade
);

-- ── coach_match_plans — one preparation against one opponent ───────────────

create table if not exists public.coach_match_plans (
  id              uuid primary key default gen_random_uuid(),
  coach_id        uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,
  player_id       uuid not null,

  opponent_tag    text not null
                  check (opponent_tag ~ '^#[0289PYLQGRJCUV]{5,12}$'),
  opponent_name   text check (char_length(opponent_name) <= 60),

  -- THE RECOMMENDATION MEMORY. Everything the screen showed when the plan
  -- was drawn up — each candidate deck, its source (coach_assist / arsenal /
  -- manual / variant), its evidence, and the engine and window that produced
  -- it — frozen as it was. The engines move on; this is what "why did
  -- Deckkies recommend this?" is answered from later.
  recommendations jsonb not null default '[]'::jsonb
                  check (jsonb_typeof(recommendations) = 'array'
                         and octet_length(recommendations::text) <= 262144),
  engine          jsonb check (octet_length(engine::text) <= 8192),
  generated_at    timestamptz,

  status          text not null default 'draft'
                  check (status in ('draft', 'confirmed', 'closed')),
  confirmed_at    timestamptz,
  notes           text check (char_length(notes) <= 4000),

  -- Marks a plan made while trying the tool out, so any later analysis of
  -- recommendation → outcome can leave it out. Real coaching is the default.
  test_mode       boolean not null default false,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (id, coach_id),
  foreign key (player_id, coach_id)
    references public.coach_players (id, coach_id) on delete restrict
);

-- ── coach_plan_decks — Primary / Backup / Alternative ─────────────────────

create table if not exists public.coach_plan_decks (
  id            uuid primary key default gen_random_uuid(),
  coach_id      uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  plan_id       uuid not null,

  slot          text not null check (slot in ('primary', 'backup', 'alternative')),
  cards         text[] not null check (public.coach_valid_deck(cards)),
  -- THE COACH'S CHOICE, labelled with where it came from. `manual` is the
  -- override the engines never produced; it is the distinction the whole
  -- feedback loop rests on.
  source        text not null
                check (source in ('coach_assist', 'arsenal', 'manual', 'variant')),
  source_ref    jsonb check (octet_length(source_ref::text) <= 8192),
  name          text check (char_length(name) <= 60),

  created_at    timestamptz not null default now(),

  unique (plan_id, slot),
  foreign key (plan_id, coach_id)
    references public.coach_match_plans (id, coach_id) on delete cascade
);

-- ── coach_match_results — what actually happened ───────────────────────────

create table if not exists public.coach_match_results (
  id               uuid primary key default gen_random_uuid(),
  coach_id         uuid not null default auth.uid()
                   references auth.users (id) on delete cascade,
  player_id        uuid not null,
  -- Null for a result logged without a plan. With one, this is the link that
  -- makes recommendation → decision → deck played → result one chain.
  plan_id          uuid,

  opponent_tag     text not null
                   check (opponent_tag ~ '^#[0289PYLQGRJCUV]{5,12}$'),
  deck_played      text[] not null check (public.coach_valid_deck(deck_played)),
  -- Which planned deck it was, or 'other' when the player went off-plan.
  played_slot      text check (played_slot in ('primary', 'backup', 'alternative', 'other')),
  result           text not null check (result in ('win', 'loss', 'draw')),
  player_crowns    smallint check (player_crowns between 0 and 3),
  opponent_crowns  smallint check (opponent_crowns between 0 and 3),
  notes            text check (char_length(notes) <= 4000),

  played_at        timestamptz not null default now(),
  test_mode        boolean not null default false,
  created_at       timestamptz not null default now(),

  foreign key (player_id, coach_id)
    references public.coach_players (id, coach_id) on delete restrict,
  -- MATCH SIMPLE (the default): a null plan_id is simply not checked.
  foreign key (plan_id, coach_id)
    references public.coach_match_plans (id, coach_id) on delete restrict
);

-- ── indexes — every list the screen asks for ───────────────────────────────

create index if not exists coach_players_coach_idx
  on public.coach_players (coach_id, is_active);
create index if not exists coach_decks_player_idx
  on public.coach_decks (player_id, status);
create index if not exists coach_plans_player_idx
  on public.coach_match_plans (player_id, created_at desc);
create index if not exists coach_plans_opponent_idx
  on public.coach_match_plans (coach_id, opponent_tag);
create index if not exists coach_plan_decks_plan_idx
  on public.coach_plan_decks (plan_id);
create index if not exists coach_results_player_idx
  on public.coach_match_results (player_id, played_at desc);
create index if not exists coach_results_plan_idx
  on public.coach_match_results (plan_id);

-- ── updated_at ──────────────────────────────────────────────────────────────

drop trigger if exists coach_players_touch on public.coach_players;
create trigger coach_players_touch before update on public.coach_players
  for each row execute function public.coach_touch();

drop trigger if exists coach_decks_touch on public.coach_decks;
create trigger coach_decks_touch before update on public.coach_decks
  for each row execute function public.coach_touch();

drop trigger if exists coach_match_plans_touch on public.coach_match_plans;
create trigger coach_match_plans_touch before update on public.coach_match_plans
  for each row execute function public.coach_touch();

-- ── row level security ─────────────────────────────────────────────────────
--
-- One policy per table, for every command: admin, and yours. `(select …)`
-- around both calls lets Postgres evaluate them once per statement instead of
-- once per row.

alter table public.coach_players       enable row level security;
alter table public.coach_decks         enable row level security;
alter table public.coach_match_plans   enable row level security;
alter table public.coach_plan_decks    enable row level security;
alter table public.coach_match_results enable row level security;

drop policy if exists "coach owns rows" on public.coach_players;
create policy "coach owns rows" on public.coach_players
  for all to authenticated
  using ((select public.coach_is_admin()) and coach_id = (select auth.uid()))
  with check ((select public.coach_is_admin()) and coach_id = (select auth.uid()));

drop policy if exists "coach owns rows" on public.coach_decks;
create policy "coach owns rows" on public.coach_decks
  for all to authenticated
  using ((select public.coach_is_admin()) and coach_id = (select auth.uid()))
  with check ((select public.coach_is_admin()) and coach_id = (select auth.uid()));

drop policy if exists "coach owns rows" on public.coach_match_plans;
create policy "coach owns rows" on public.coach_match_plans
  for all to authenticated
  using ((select public.coach_is_admin()) and coach_id = (select auth.uid()))
  with check ((select public.coach_is_admin()) and coach_id = (select auth.uid()));

drop policy if exists "coach owns rows" on public.coach_plan_decks;
create policy "coach owns rows" on public.coach_plan_decks
  for all to authenticated
  using ((select public.coach_is_admin()) and coach_id = (select auth.uid()))
  with check ((select public.coach_is_admin()) and coach_id = (select auth.uid()));

drop policy if exists "coach owns rows" on public.coach_match_results;
create policy "coach owns rows" on public.coach_match_results
  for all to authenticated
  using ((select public.coach_is_admin()) and coach_id = (select auth.uid()))
  with check ((select public.coach_is_admin()) and coach_id = (select auth.uid()));

-- ── grants ──────────────────────────────────────────────────────────────────
--
-- Supabase grants new public tables to `anon` by default. RLS would still
-- deny every row, but an anonymous caller has no business reaching these
-- tables at all, so the grant is taken away rather than relied on.

revoke all on public.coach_players,
              public.coach_decks,
              public.coach_match_plans,
              public.coach_plan_decks,
              public.coach_match_results
  from public, anon;

grant select, insert, update, delete on public.coach_players,
                                        public.coach_decks,
                                        public.coach_match_plans,
                                        public.coach_plan_decks,
                                        public.coach_match_results
  to authenticated;

-- A coach cannot re-home a row to another account: every policy's WITH CHECK
-- requires `coach_id = auth.uid()`, so the only value an update can write
-- there is the caller's own. (A column-level REVOKE would not add anything:
-- it does not subtract from the table-level grant above — 001 had to revoke
-- the table grant and re-grant column by column for exactly that reason.)
