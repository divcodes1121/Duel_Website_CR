-- ============================================================================
-- VERIFY 002 — run this AFTER 002_owner.sql, in the same SQL editor
-- ============================================================================
--
-- Read-only. It writes nothing: every call below is expected to RAISE, and a
-- raise inside the nested block is caught and reported rather than committed.
--
-- WHY IT IMPERSONATES THE OWNER. `admin_set_role` checks the CALLER is an
-- admin before it checks anything about the target, and in the SQL editor
-- `auth.uid()` is null — so a bare call refuses with 'not authorised' and
-- proves nothing about the owner guard. Setting `request.jwt.claims` is what
-- `auth.uid()` reads, so this runs as the owner, who IS an admin and therefore
-- gets past the first check to the one being tested.
--
-- The owner is a safe stand-in for a hostile second admin here: the owner guard
-- sits BEFORE the self-check in the function, so reaching it proves the guard
-- fires for any admin caller, not just for this one.

do $$
declare
  oid uuid;
begin
  select id into oid
    from auth.users
   where lower(email) = lower(public.owner_email());

  if oid is null then
    raise notice '--- FAIL: no account matches owner_email() = %', public.owner_email();
    raise notice '    Nothing is protected. Check the address in 002_owner.sql.';
    return;
  end if;

  raise notice '--- owner: %  (%)', public.owner_email(), oid;
  raise notice '--- is_owner()      : %', public.is_owner(oid);
  raise notice '--- effective_tier(): %   <- must be admin', public.effective_tier(oid);

  -- Become the owner, so the caller passes the admin check.
  perform set_config('request.jwt.claims', json_build_object('sub', oid)::text, true);

  begin
    perform public.admin_set_role(oid, 'free');
    raise notice '--- PROBLEM: admin_set_role was NOT refused. The hole is open.';
  exception when others then
    raise notice '--- OK  admin_set_role refused: %', sqlerrm;
  end;

  begin
    perform public.admin_end_trial(oid);
    raise notice '--- PROBLEM: admin_end_trial was NOT refused.';
  exception when others then
    raise notice '--- OK  admin_end_trial refused: %', sqlerrm;
  end;
end $$;

-- Every account, and which one is the owner. `is_owner` should be true for
-- exactly one row, and that row's tier should read admin whatever its stored
-- role says.
select u.email,
       p.role                       as stored_role,
       public.effective_tier(p.id)  as effective_tier,
       public.is_owner(p.id)        as is_owner
  from public.profiles p
  join auth.users u on u.id = p.id
 order by public.is_owner(p.id) desc, p.created_at;
