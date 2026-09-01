-- ============================================================================
-- VERIFY THE DEVICE LIMIT — two devices per account, one desktop and one phone
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================
--
-- IT RETURNS ROWS, for the reason `002_owner_verify.sql` learned the hard way:
-- the dashboard's SQL editor does not display `raise notice`, so a check
-- written that way reports "Success. No rows returned", which is
-- indistinguishable from having done nothing.
--
-- WHAT IS ACTUALLY BEING PROVED, and it is not a count. `device_sessions` has
-- `primary key (user_id, kind)` and `kind` is checked against exactly
-- ('desktop','mobile'), so the table PHYSICALLY CANNOT hold a third row for one
-- account. That is why nothing in the app counts devices — counting races, and
-- two simultaneous logins would both read "one device" and both insert. The
-- limit is a property of the schema, and these steps demonstrate it rather than
-- asserting it.
--
-- IT WRITES AND THEN ROLLS BACK ITS OWN ROWS. The inserts go against a real
-- account (the owner's, which certainly exists) inside a sub-block whose work
-- is undone before the function returns — so a live device row belonging to a
-- real signed-in browser is never disturbed. Read step 0: if the owner already
-- holds device rows, the function refuses rather than touching them.

create or replace function public.device_limit_check()
returns table (step text, result text)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  existing int;
  n int;
  err text;
begin
  select id into uid from auth.users
   where lower(email) = lower(public.owner_email());

  if uid is null then
    step := '0 account';
    result := 'FAIL - no account matches ' || public.owner_email();
    return next;
    return;
  end if;

  -- REFUSE RATHER THAN CLOBBER. If this account has live device rows, the
  -- inserts below would evict a real browser mid-session.
  select count(*) into existing from public.device_sessions where user_id = uid;
  if existing > 0 then
    step := '0 account';
    result := 'SKIPPED - the test account holds ' || existing ||
              ' live device row(s); sign it out everywhere and re-run';
    return next;
    return;
  end if;

  step := '0 account'; result := 'ok, and it holds no device rows'; return next;

  -- The two legal kinds both insert.
  insert into public.device_sessions (user_id, kind, device_id)
  values (uid, 'desktop', 'verify-desktop-1');
  insert into public.device_sessions (user_id, kind, device_id)
  values (uid, 'mobile', 'verify-mobile-1');

  select count(*) into n from public.device_sessions where user_id = uid;
  step := '1 one desktop + one mobile';
  result := (case when n = 2 then 'PASS' else 'FAIL' end) || ' - ' || n || ' row(s)';
  return next;

  -- A SECOND DESKTOP CANNOT BE ADDED, only substituted. This is the limit.
  begin
    insert into public.device_sessions (user_id, kind, device_id)
    values (uid, 'desktop', 'verify-desktop-2');
    step := '2 a second desktop is refused';
    result := 'FAIL - a third row was accepted';
    return next;
  exception when unique_violation then
    step := '2 a second desktop is refused';
    result := 'PASS - unique_violation on (user_id, kind)';
    return next;
  end;

  -- What the app does instead: upsert, which REPLACES the holder. The previously
  -- signed-in desktop then discovers on its next heartbeat that the stored
  -- device_id is no longer its own, and signs itself out. No cron, no reaper.
  insert into public.device_sessions (user_id, kind, device_id, last_seen_at)
  values (uid, 'desktop', 'verify-desktop-2', now())
  on conflict (user_id, kind)
    do update set device_id = excluded.device_id, last_seen_at = excluded.last_seen_at;

  select count(*) into n from public.device_sessions where user_id = uid;
  step := '3 upsert replaces, never adds';
  result := (case when n = 2 then 'PASS' else 'FAIL' end) || ' - still ' || n || ' row(s)';
  return next;

  select count(*) into n from public.device_sessions
   where user_id = uid and kind = 'desktop' and device_id = 'verify-desktop-2';
  step := '4 the newer desktop holds the slot';
  result := (case when n = 1 then 'PASS' else 'FAIL' end) ||
            ' - the older device_id is gone, so that browser will sign itself out';
  return next;

  -- A THIRD KIND IS NOT A THIRD DEVICE: the check constraint is what makes the
  -- cap two rather than "however many kinds someone invents".
  begin
    insert into public.device_sessions (user_id, kind, device_id)
    values (uid, 'tablet', 'verify-tablet-1');
    step := '5 an invented kind is refused';
    result := 'FAIL - kind is not constrained';
    return next;
  exception when check_violation then
    step := '5 an invented kind is refused';
    result := 'PASS - check_violation on kind';
    return next;
  end;

  select count(*) into n from public.device_sessions where user_id = uid;
  step := '6 maximum devices for one account';
  result := (case when n = 2 then 'PASS' else 'FAIL' end) || ' - ' || n ||
            ', i.e. one per legal kind';
  return next;

  -- Clean up after ourselves, so the account is left exactly as it was found.
  delete from public.device_sessions
   where user_id = uid and device_id like 'verify-%';
  select count(*) into n from public.device_sessions where user_id = uid;
  step := '7 cleaned up';
  result := (case when n = 0 then 'PASS' else 'FAIL' end) || ' - ' || n || ' row(s) left';
  return next;

exception when others then
  err := sqlerrm;
  -- Never leave test rows behind, whatever went wrong above.
  delete from public.device_sessions
   where user_id = uid and device_id like 'verify-%';
  step := 'ERROR';
  result := err;
  return next;
end;
$$;

-- The declared shape of the limit, straight out of the catalogue rather than
-- out of a comment: the primary key, and the values `kind` may take.
select 'primary key' as step,
       string_agg(a.attname, ', ' order by k.ord) as result
  from pg_constraint c
  cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
 where c.conrelid = 'public.device_sessions'::regclass
   and c.contype = 'p'
union all
select 'kind constraint', pg_get_constraintdef(c.oid)
  from pg_constraint c
 where c.conrelid = 'public.device_sessions'::regclass
   and c.contype = 'c'
union all
select step, result from public.device_limit_check();
