-- ============================================================================
-- VERIFY 002 — run AFTER 002_owner.sql, in the Supabase SQL editor
-- ============================================================================
--
-- IT RETURNS ROWS, AND THAT IS THE POINT. The first version of this file used
-- `raise notice`, which the Supabase dashboard's SQL editor does not display —
-- so it ran, proved the guards, and reported "Success. No rows returned",
-- which is indistinguishable from having done nothing. A check whose output
-- the operator cannot see is not a check.
--
-- It writes nothing: every admin call below is expected to RAISE, and the
-- raise is caught inside a sub-block rather than committed.
--
-- WHY IT IMPERSONATES THE OWNER. `admin_set_role` checks the CALLER is an admin
-- before it checks anything about the target, and in the SQL editor
-- `auth.uid()` is null — so a bare call refuses with 'not authorised' and
-- proves nothing about the owner guard. `request.jwt.claims` is what
-- `auth.uid()` reads. The owner is a safe stand-in for a hostile second admin
-- because the owner guard sits BEFORE the self-check in the function, so
-- reaching it proves the guard fires for any admin caller.

create or replace function public.owner_guard_check()
returns table (step text, result text)
language plpgsql
security definer
set search_path = public
as $$
declare
  oid uuid;
begin
  select id into oid from auth.users
   where lower(email) = lower(public.owner_email());

  if oid is null then
    step := '0 owner lookup';
    result := 'FAIL — no account matches ' || public.owner_email();
    return next;
    return;
  end if;

  step := '1 owner email';      result := public.owner_email();            return next;
  step := '2 is_owner()';       result := public.is_owner(oid)::text;      return next;
  step := '3 effective_tier()'; result := public.effective_tier(oid);      return next;

  perform set_config('request.jwt.claims', json_build_object('sub', oid)::text, true);

  begin
    perform public.admin_set_role(oid, 'free');
    step := '4 admin_set_role'; result := 'PROBLEM — was NOT refused';
  exception when others then
    step := '4 admin_set_role'; result := 'OK refused — ' || sqlerrm;
  end;
  return next;

  begin
    perform public.admin_end_trial(oid);
    step := '5 admin_end_trial'; result := 'PROBLEM — was NOT refused';
  exception when others then
    step := '5 admin_end_trial'; result := 'OK refused — ' || sqlerrm;
  end;
  return next;
end;
$$;

select * from public.owner_guard_check() order by step;

drop function public.owner_guard_check();

-- Every account, owner first. Exactly one row should read is_owner = true, and
-- that row's effective_tier must be admin whatever its stored role says.
select u.email,
       p.role                      as stored_role,
       public.effective_tier(p.id) as effective_tier,
       public.is_owner(p.id)       as is_owner
  from public.profiles p
  join auth.users u on u.id = p.id
 order by public.is_owner(p.id) desc, p.created_at;
