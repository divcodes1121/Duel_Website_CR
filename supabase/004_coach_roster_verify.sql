-- ============================================================================
-- VERIFY 004 — run AFTER 004_coach_roster.sql, in the Supabase SQL editor
-- ============================================================================
--
-- IT RETURNS ROWS, one per check, for the reason 002's verify learned: the
-- dashboard's SQL editor does not display `raise notice`, so a check written
-- that way reports "Success. No rows returned" whether it proved anything or
-- not. Every row should start with OK. Anything else is a finding.
--
-- A REFUSAL ONLY COUNTS FOR THE RIGHT REASON. Each check names the error it
-- expects — row-level security, a check constraint, a duplicate key, a
-- foreign key, a missing grant — and anything else reads FAIL wrong reason.
-- Otherwise a refusal for an unrelated cause (the editor not being allowed to
-- switch role, say) would print OK while proving nothing.
--
-- IT WRITES NOTHING THAT SURVIVES. Every insert happens inside a sub-block
-- that ends by raising on purpose, which rolls the sub-block back; the results
-- are kept in local variables, which a rollback does not touch.
--
-- IT IMPERSONATES THREE CALLERS, because Row Level Security is the thing under
-- test and it only applies to the roles the site's requests actually run as:
--
--   anon           — a visitor holding the public key and no session;
--   non-admin      — `authenticated` with a random account id, which
--                    `effective_tier` reads as 'free' (no profile row);
--   the owner      — `authenticated` as you, whom 002 makes an admin.
--
-- `SET LOCAL ROLE` is why this function is SECURITY INVOKER, not DEFINER: a
-- definer function may not change role. It runs as the editor's `postgres`.
--
-- EVERY LITERAL APPENDED TO AN ARRAY CARRIES `::text`. `text[] || 'abc'`
-- resolves the bare literal as a second ARRAY, not as an element, and fails at
-- run time with "malformed array literal" — which is how the first version of
-- this file failed. A parser cannot see it; only type resolution does.

create or replace function public.coach_roster_check()
returns table (step text, result text)
language plpgsql
set search_path = public
as $$
declare
  steps   text[] := '{}';
  results text[] := '{}';
  owner   uuid;
  other   uuid;
  pid     uuid;
  plan    uuid;
  n       int;
  msg     text;
  deck8   text[] := array['hog-rider','musketeer','ice-spirit','skeletons',
                          'cannon','the-log','fireball','ice-golem'];
begin
  -- ── 0. the schema is there, with RLS on ───────────────────────────────────
  select count(*) into n
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relrowsecurity
     and c.relname in ('coach_players','coach_decks','coach_match_plans',
                       'coach_plan_decks','coach_match_results');
  steps := steps || '00 five tables, RLS on'::text;
  results := results || (case when n = 5 then 'OK 5 of 5'
                              else 'FAIL only ' || n || ' of 5 have RLS on' end);

  select id into owner from auth.users
   where lower(email) = lower(public.owner_email());
  steps := steps || '01 owner account'::text;
  if owner is null then
    results := results || ('FAIL no account matches ' || public.owner_email());
    return query select * from unnest(steps, results);
    return;
  end if;
  results := results || ('OK tier = ' || public.effective_tier(owner));

  -- ── 1. anon cannot reach the tables at all ────────────────────────────────
  begin
    execute 'set local role anon';
    perform count(*) from public.coach_players;
    msg := 'FAIL anon could read coach_players';
    execute 'reset role';
  exception when others then
    -- THE REASON MUST BE THE TABLE. If the editor could not even switch to
    -- `anon`, the error would be about the role, and "refused" would be a
    -- pass that proved nothing.
    msg := (case when sqlerrm ilike '%permission denied for table coach_players%' then 'OK refused — ' else 'FAIL wrong reason — ' end) || sqlerrm;
  end;
  steps := steps || '10 anon: read roster'::text;  results := results || msg;

  -- ── 2. a signed-in NON-admin sees nothing and writes nothing ─────────────
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    begin
      insert into public.coach_players (player_tag) values ('#2PYLQ0');
      msg := 'FAIL a non-admin inserted a roster row';
    exception when others then
      msg := (case when sqlerrm ilike '%row-level security%' then 'OK refused — ' else 'FAIL wrong reason — ' end) || sqlerrm;
    end;
    execute 'reset role';
  end;
  steps := steps || '20 non-admin: add player'::text;  results := results || msg;

  -- ── 3. the owner, end to end — and every row rolled back ─────────────────
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      json_build_object('sub', owner, 'role', 'authenticated')::text, true);

    insert into public.coach_players (player_tag, display_name)
      values ('#2PYLQ0', 'Verify') returning id into pid;
    select count(*) into n from public.coach_players where id = pid;
    steps := steps || '30 owner: add + read player'::text;
    results := results || (case when n = 1 then 'OK' else 'FAIL not readable back' end);

    begin
      insert into public.coach_players (player_tag) values ('#abc');
      msg := 'FAIL a malformed tag was accepted';
    exception when others then msg := (case when sqlerrm ilike '%check constraint%' then 'OK refused — ' else 'FAIL wrong reason — ' end) || sqlerrm; end;
    steps := steps || '31 owner: malformed tag'::text;  results := results || msg;

    begin
      insert into public.coach_players (player_tag, coach_id)
        values ('#2PYLQ2', gen_random_uuid());
      msg := 'FAIL a row was filed under another account';
    exception when others then msg := (case when sqlerrm ilike '%row-level security%' then 'OK refused — ' else 'FAIL wrong reason — ' end) || sqlerrm; end;
    steps := steps || '32 owner: row for another coach'::text;  results := results || msg;

    begin
      insert into public.coach_decks (player_id, cards) values (pid, deck8[1:7]);
      msg := 'FAIL a 7-card deck was accepted';
    exception when others then msg := (case when sqlerrm ilike '%check constraint%' then 'OK refused — ' else 'FAIL wrong reason — ' end) || sqlerrm; end;
    steps := steps || '33 owner: 7-card deck'::text;  results := results || msg;

    begin
      insert into public.coach_decks (player_id, cards)
        values (pid, deck8[1:7] || array['hog-rider']);
      msg := 'FAIL a deck with a repeated card was accepted';
    exception when others then msg := (case when sqlerrm ilike '%check constraint%' then 'OK refused — ' else 'FAIL wrong reason — ' end) || sqlerrm; end;
    steps := steps || '34 owner: repeated card'::text;  results := results || msg;

    insert into public.coach_decks (player_id, cards, name, comfort, tags)
      values (pid, deck8, 'Hog 2.6', 5, array['Primary']);
    steps := steps || '35 owner: valid deck'::text;  results := results || 'OK'::text;

    begin
      insert into public.coach_decks (player_id, cards)
        values (pid, array(select c from unnest(deck8) c order by c desc));
      msg := 'FAIL the same deck in another order was stored twice';
    exception when others then msg := (case when sqlerrm ilike '%duplicate key%' then 'OK refused — ' else 'FAIL wrong reason — ' end) || sqlerrm; end;
    steps := steps || '36 owner: same deck reordered'::text;  results := results || msg;

    insert into public.coach_match_plans (player_id, opponent_tag, recommendations)
      values (pid, '#Y022GRCJQ', '[{"source":"manual"}]'::jsonb) returning id into plan;
    insert into public.coach_plan_decks (plan_id, slot, cards, source)
      values (plan, 'primary', deck8, 'manual');
    insert into public.coach_match_results (player_id, plan_id, opponent_tag,
                                            deck_played, played_slot, result)
      values (pid, plan, '#Y022GRCJQ', deck8, 'primary', 'win');
    steps := steps || '37 owner: plan → deck → result chain'::text;  results := results || 'OK'::text;

    begin
      delete from public.coach_players where id = pid;
      msg := 'FAIL a player with a recorded result was deleted';
    exception when others then msg := (case when sqlerrm ilike '%foreign key%' then 'OK refused — ' else 'FAIL wrong reason — ' end) || sqlerrm; end;
    steps := steps || '38 owner: delete player with history'::text;  results := results || msg;

    raise exception 'roll back the verification rows';
  exception
    when others then
      if sqlerrm <> 'roll back the verification rows' then
        steps := steps || '3x owner block'::text;
        results := results || ('FAIL stopped early — ' || sqlerrm);
      end if;
  end;

  -- ── 4. a child cannot point at ANOTHER coach's player ────────────────────
  -- Needs a second real account, because coach_id references auth.users. That
  -- account's player is inserted as postgres (the table owner, so RLS does not
  -- apply), then the OWNER tries to hang a deck off it — which only the
  -- composite (player_id, coach_id) foreign key can stop, since a foreign-key
  -- check runs without RLS. Rolled back like the rest.
  select id into other from auth.users where id <> owner limit 1;
  if other is null then
    steps := steps || '40 cross-coach link'::text;
    results := results || 'SKIPPED — no second account to test against'::text;
  else
    begin
      insert into public.coach_players (player_tag, coach_id)
        values ('#2PYLQ8', other) returning id into pid;
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims',
        json_build_object('sub', owner, 'role', 'authenticated')::text, true);
      begin
        insert into public.coach_decks (player_id, cards) values (pid, deck8);
        msg := 'FAIL a deck was attached to another coach''s player';
      exception when others then msg := (case when sqlerrm ilike '%foreign key%' then 'OK refused — ' else 'FAIL wrong reason — ' end) || sqlerrm; end;
      select count(*) into n from public.coach_players where id = pid;
      if n <> 0 then msg := msg || ' | FAIL the other coach''s player was visible'; end if;
      raise exception 'roll back the verification rows';
    exception
      when others then
        if sqlerrm <> 'roll back the verification rows' then
          msg := 'FAIL stopped early — ' || sqlerrm;
        end if;
    end;
    steps := steps || '40 cross-coach link'::text;  results := results || msg;
  end if;

  return query select * from unnest(steps, results);
end;
$$;

select * from public.coach_roster_check() order by step;

drop function public.coach_roster_check();
