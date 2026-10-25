-- 008 verify — run in the Supabase SQL editor AFTER 008.
--
-- RETURNS ROWS (the dashboard editor does not show notices). READ-ONLY: it
-- writes nothing. Every row should read ok = true.
--
-- RUN 008_coach_access.sql FIRST. If row 1 reads false, 008 has not been
-- applied; the other rows then read false too instead of stopping the script
-- (has_function_privilege throws on a function that does not exist, which is
-- why rows 6 and 7 look the function up with to_regprocedure first).

with pol as (
  select tablename, qual, with_check
    from pg_policies
   where schemaname = 'public'
     and policyname = 'coach owns rows'
     and tablename in ('coach_players', 'coach_decks', 'coach_match_plans',
                       'coach_plan_decks', 'coach_match_results')
),
fn as (
  select p.proname, pg_get_functiondef(p.oid) as body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('coach_may_coach', 'coach_is_admin')
)
select * from (
  select 1 as n,
         'coach_may_coach() exists' as check,
         exists (select 1 from fn where proname = 'coach_may_coach') as ok,
         '' as detail

  union all
  select 2,
         'all five roster tables have the policy',
         (select count(*) from pol) = 5,
         (select count(*)::text from pol)

  union all
  select 3,
         'every policy reads coach_may_coach, none coach_is_admin',
         coalesce((select bool_and(qual like '%coach_may_coach%' and with_check like '%coach_may_coach%'
                          and qual not like '%coach_is_admin%' and with_check not like '%coach_is_admin%')
            from pol), false),
         coalesce((select string_agg(tablename, ', ') from pol
                    where qual not like '%coach_may_coach%'), 'all moved')

  union all
  -- The admin test the analytics server uses for the console's screens must
  -- still be admin only.
  select 4,
         'coach_is_admin() is still admin only (does not read is_coach)',
         (select body not like '%is_coach%' and body like '%''admin''%'
            from fn where proname = 'coach_is_admin'),
         ''

  union all
  select 5,
         'coach_may_coach() requires Pro for the flag',
         coalesce((select body like '%''pro''%' and body like '%is_coach%'
            from fn where proname = 'coach_may_coach'), false),
         ''

  union all
  select 6,
         'anon cannot call coach_may_coach()',
         to_regprocedure('public.coach_may_coach()') is not null
           and not has_function_privilege('anon', to_regprocedure('public.coach_may_coach()'), 'execute'),
         ''

  union all
  select 7,
         'signed-in accounts can call coach_may_coach()',
         to_regprocedure('public.coach_may_coach()') is not null
           and has_function_privilege('authenticated', to_regprocedure('public.coach_may_coach()'), 'execute'),
         ''

  union all
  -- How many accounts the switch now actually opens the roster for.
  select 8,
         'Pro accounts with Coach = Yes (informational)',
         true,
         (select count(*)::text from public.profiles p
           where p.is_coach and public.effective_tier(p.id) = 'pro')
) t
order by n;
