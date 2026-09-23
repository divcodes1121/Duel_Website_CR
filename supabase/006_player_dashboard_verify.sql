-- 006 verify — run AFTER 006_player_dashboard.sql, in the Supabase SQL editor.
--
-- IT RETURNS ROWS, AND THAT IS NOT A STYLE CHOICE. That editor does not
-- display `raise notice`, so a verify written with notices prints "Success. No
-- rows returned" whether it proved anything or not — indistinguishable from a
-- script that did nothing. 002's first verify made exactly that mistake.
--
-- EVERY REFUSAL MUST FAIL FOR THE RIGHT REASON. "OK, it was refused" would
-- pass if the editor merely could not switch role, so each negative check
-- captures the message it actually got and compares it.
--
-- It creates two throwaway roster rows tagged `#2PYLQ0VERIF*`, proves the
-- rules against them, and deletes them. Nothing you already have is touched.
--
-- Read the LAST result grid: `passed` should be true on every row, and
-- `passed IS NULL` means a check could not run and says why in `why`.

begin;

create temp table _v (n int generated always as identity, phase text, check_ text, passed boolean, why text)
on commit drop;

-- ── 1. schema ────────────────────────────────────────────────────────────

insert into _v (phase, check_, passed, why)
select '1 schema', 'linked_user_id exists', count(*) = 1,
       'added by 006'
  from information_schema.columns
 where table_schema = 'public' and table_name = 'coach_players'
   and column_name = 'linked_user_id';

insert into _v (phase, check_, passed, why)
select '1 schema', 'it is nullable', bool_and(is_nullable = 'YES'),
       'an unlinked roster player is the normal case'
  from information_schema.columns
 where table_schema = 'public' and table_name = 'coach_players'
   and column_name = 'linked_user_id';

insert into _v (phase, check_, passed, why)
select '1 schema', 'the link is ON DELETE SET NULL', count(*) = 1,
       'deleting an account must not delete the coach''s roster row'
  from information_schema.referential_constraints rc
  join information_schema.key_column_usage k
    on k.constraint_name = rc.constraint_name and k.table_schema = 'public'
 where k.table_name = 'coach_players' and k.column_name = 'linked_user_id'
   and rc.delete_rule = 'SET NULL';

insert into _v (phase, check_, passed, why)
select '1 schema', 'one account cannot be two players on one roster', count(*) = 1,
       'partial unique index coach_players_linked_uniq'
  from pg_indexes
 where schemaname = 'public' and indexname = 'coach_players_linked_uniq';

-- ── 2. functions ─────────────────────────────────────────────────────────

insert into _v (phase, check_, passed, why)
select '2 functions', 'all four exist', count(*) = 4, ''
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('coach_link_player','coach_unlink_player','my_coach_players','my_coach_decks');

insert into _v (phase, check_, passed, why)
select '2 functions', p.proname || ': definer with pinned search_path',
       (p.prosecdef and p.proconfig is not null
        and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
       'a definer function without a pinned path is the classic escalation'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('coach_link_player','coach_unlink_player','my_coach_players','my_coach_decks');

-- THE ABSENT COLUMN IS THE POINT: a player must not be handed the coach's
-- private notes about them. Read off the function's real output columns.
insert into _v (phase, check_, passed, why)
select '2 functions', 'my_coach_players does NOT return notes',
       not bool_or(lower(coalesce(pa.parameter_name, '')) = 'notes'),
       'coach notes are written expecting the player is not reading them'
  from information_schema.routines r
  left join information_schema.parameters pa on pa.specific_name = r.specific_name
 where r.routine_schema = 'public' and r.routine_name = 'my_coach_players';

-- ── 3. grants ────────────────────────────────────────────────────────────

insert into _v (phase, check_, passed, why)
select '3 grants', 'anon cannot execute ' || p.proname,
       not has_function_privilege('anon', p.oid, 'EXECUTE'),
       'anon has no grant anywhere in this schema'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('coach_link_player','coach_unlink_player','my_coach_players','my_coach_decks');

insert into _v (phase, check_, passed, why)
select '3 grants', 'authenticated can execute ' || p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE'), ''
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('coach_link_player','coach_unlink_player','my_coach_players','my_coach_decks');

-- ── 4. behaviour ─────────────────────────────────────────────────────────

do $$
declare
  v_coach  uuid;
  v_other  uuid;
  v_mine   uuid;
  v_unlink uuid;
  v_n      int;
  v_msg    text;
begin
  select id into v_coach from auth.users order by created_at limit 1;
  select id into v_other from auth.users where id <> v_coach order by created_at limit 1;

  if v_coach is null then
    insert into _v (phase, check_, passed, why)
    values ('4 behaviour', 'behavioural checks', null, 'SKIPPED: no accounts exist');
    return;
  end if;

  insert into public.coach_players (coach_id, player_tag, display_name, notes)
       values (v_coach, '#2PYLQ0VERIFY', 'VERIFY linked', 'private note')
    returning id into v_mine;
  insert into public.coach_players (coach_id, player_tag, display_name)
       values (v_coach, '#2PYLQ0VERIFV', 'VERIFY unlinked')
    returning id into v_unlink;

  -- A COACH MAY BE ONE OF THEIR OWN PLAYERS: link the coach's own account.
  update public.coach_players set linked_user_id = v_coach where id = v_mine;

  -- Read as that account.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach)::text, true);

  select count(*) into v_n from public.my_coach_players() where player_tag = '#2PYLQ0VERIFY';
  insert into _v (phase, check_, passed, why)
  values ('4 behaviour', 'a linked player sees their own row', v_n = 1,
          'and a coach linked to themselves is the same path');

  select count(*) into v_n from public.my_coach_players() where player_tag = '#2PYLQ0VERIFV';
  insert into _v (phase, check_, passed, why)
  values ('4 behaviour', 'the UNLINKED sibling row stays invisible', v_n = 0,
          'linked_user_id is null on it, on the same roster');

  -- A different account must see none of it.
  if v_other is null then
    insert into _v (phase, check_, passed, why)
    values ('4 behaviour', 'another account sees none of it', null,
            'SKIPPED: only one account exists on this project');
  else
    perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
    select count(*) into v_n from public.my_coach_players() where player_tag like '#2PYLQ0VERIF%';
    insert into _v (phase, check_, passed, why)
    values ('4 behaviour', 'another account sees none of it', v_n = 0,
            'the function filters on auth.uid()');

    -- ...and cannot link a row on someone else's roster. THE REASON MATTERS:
    -- any error would otherwise "pass" this check.
    begin
      perform public.coach_link_player(v_mine, 'nobody@example.invalid');
      insert into _v (phase, check_, passed, why)
      values ('4 behaviour', 'linking another coach''s row is refused', false,
              'it returned instead of raising');
    exception when others then
      v_msg := sqlerrm;
      insert into _v (phase, check_, passed, why)
      values ('4 behaviour', 'linking another coach''s row is refused', v_msg like '%not on your roster%',
              'raised: ' || v_msg);
    end;
  end if;

  -- The owner linking an address nobody has signed up with is told so.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach)::text, true);
  begin
    perform public.coach_link_player(v_mine, 'definitely-nobody@example.invalid');
    insert into _v (phase, check_, passed, why)
    values ('4 behaviour', 'an unknown email is refused, by that reason', false,
            'it returned instead of raising');
  exception when others then
    v_msg := sqlerrm;
    insert into _v (phase, check_, passed, why)
    values ('4 behaviour', 'an unknown email is refused, by that reason',
            v_msg like '%no account%', 'raised: ' || v_msg);
  end;

  perform set_config('request.jwt.claims', null, true);
end $$;

-- ── 5. cleanup ───────────────────────────────────────────────────────────

delete from public.coach_players where player_tag like '#2PYLQ0VERIF%';

insert into _v (phase, check_, passed, why)
select '5 cleanup', 'every row this script made is gone', count(*) = 0,
       'nothing you already had was touched'
  from public.coach_players where player_tag like '#2PYLQ0VERIF%';

-- ── the result ───────────────────────────────────────────────────────────

select phase, check_ as "check", passed, why from _v order by n;

select count(*) filter (where passed) as passed,
       count(*) filter (where passed is false) as failed,
       count(*) filter (where passed is null) as skipped
  from _v;

commit;
