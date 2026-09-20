-- 005 verify — run in the Supabase SQL editor AFTER 005.
--
-- IT RETURNS ROWS, never `raise notice`: the dashboard editor does not show
-- notices, so a notice-based script reports "Success. No rows returned" and
-- that is indistinguishable from having checked nothing. (002 learned this.)
--
-- READ-ONLY. It writes nothing and creates nothing, so it is safe to run on
-- the live database at any time, with or without arsenal rows present.
-- Every row should read ok = true.

with col as (
  select data_type, is_nullable, column_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'coach_decks'
     and column_name  = 'sort_order'
),
grants as (
  select grantee, privilege_type
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'coach_decks'
)
select * from (
  select 1 as n,
         'sort_order exists on coach_decks' as check,
         (select count(*) from col) = 1 as ok,
         coalesce((select data_type from col), 'MISSING') as detail

  union all
  select 2,
         'it is an integer, NOT NULL, default 0',
         (select data_type = 'integer' and is_nullable = 'NO'
                 and column_default like '0%' from col),
         coalesce((select is_nullable || ' / ' || coalesce(column_default, 'no default')
                     from col), 'MISSING')

  union all
  -- Every existing deck must have a defined position. `not null default 0`
  -- gives that without a backfill; this proves it rather than assuming it.
  select 3,
         'every stored deck has a position',
         not exists (select 1 from public.coach_decks where sort_order is null),
         (select count(*)::text || ' arsenal rows visible to you' from public.coach_decks)

  union all
  select 4,
         'RLS is still enabled on coach_decks',
         (select relrowsecurity from pg_class where oid = 'public.coach_decks'::regclass),
         'row level security'

  union all
  select 5,
         'the "coach owns rows" policy still stands',
         exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'coach_decks'
                    and policyname = 'coach owns rows'),
         coalesce((select string_agg(policyname, ', ') from pg_policies
                    where schemaname = 'public' and tablename = 'coach_decks'), 'NONE')

  union all
  -- The point of checking this: a table-level grant covers a column added
  -- later, a column-level one does not. If UPDATE were column-listed, the
  -- new column would be silently unwritable over REST.
  select 6,
         'authenticated can still update the table (so the new column too)',
         exists (select 1 from grants
                  where grantee = 'authenticated' and privilege_type = 'UPDATE'),
         coalesce((select string_agg(distinct privilege_type, ', ')
                     from grants where grantee = 'authenticated'), 'NONE')

  union all
  select 7,
         'anon still has no grant at all',
         not exists (select 1 from grants where grantee = 'anon'),
         coalesce((select string_agg(distinct privilege_type, ', ')
                     from grants where grantee = 'anon'), 'none (correct)')

  union all
  -- 004's guards are what keep a malformed deck out; 005 must not have
  -- disturbed them.
  select 8,
         'the 8-distinct-card check still guards the cards column',
         public.coach_valid_deck(array['a','b','c','d','e','f','g','h'])
           and not public.coach_valid_deck(array['a','b','c','d','e','f','g'])
           and not public.coach_valid_deck(array['a','a','c','d','e','f','g','h'])
           and not public.coach_valid_deck(array['a','b','c','d','e','f','g',null]),
         'eight distinct, lower-case keys only'

  union all
  select 9,
         'the deck key is order-free, so one list cannot be added twice',
         public.coach_deck_key(array['knight','archers','giant','musketeer','fireball','zap','skeletons','cannon'])
         = public.coach_deck_key(array['zap','cannon','skeletons','fireball','musketeer','giant','archers','knight']),
         public.coach_deck_key(array['giant','knight','archers','musketeer','fireball','zap','skeletons','cannon'])
) rows
order by n;
