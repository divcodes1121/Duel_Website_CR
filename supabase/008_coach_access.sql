-- 008 — The Coach switch opens the roster, for Pro accounts
--
-- Reported 2026-10-25: a Pro account switched to Coach = Yes in the console
-- opened Coach Roster and every save failed with "The database refused this:
-- Coach Roster is for administrators only."
--
-- WHY. 007 added `profiles.is_coach` and the app's gate reads it, but the
-- five roster tables' Row Level Security still asks `coach_is_admin()`, which
-- 004 defined as `effective_tier(auth.uid()) = 'admin'`. The flag opened the
-- screen and the database kept the rows shut.
--
-- THE FIX IS A NEW FUNCTION, NOT A WIDER `coach_is_admin()`. That function is
-- ALSO the analytics server's admin test (`server/admin_auth.verify`), which
-- guards the console's tracking view, the data lifecycle view and All Duels.
-- Widening it would hand those to every coach. So:
--
--   coach_is_admin()   unchanged — admin only, for admin screens
--   coach_may_coach()  NEW — admin, or Coach = Yes on a Pro account
--
-- WHY PRO TOO, NOT THE FLAG ALONE. Coach Roster is a Pro area
-- (`PRO_ONLY_SECTIONS` in `src/state/tiers.ts`); the screen already requires
-- Pro AND the flag. The database now asks exactly the same question, so the
-- screen and the rows cannot disagree. A coach whose Pro lapses keeps their
-- rows (nothing is deleted) and reaches them again on renewing.
--
-- `effective_tier` is 001/002's one definition of a tier (owner -> admin,
-- lapsed trial -> free), so nothing here re-decides what Pro means.
--
-- Safe to run more than once.

create or replace function public.coach_may_coach()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case coalesce(public.effective_tier(auth.uid()), 'free')
           when 'admin' then true
           when 'pro'   then coalesce(
             (select p.is_coach from public.profiles p where p.id = auth.uid()),
             false)
           else false
         end;
$$;

revoke all on function public.coach_may_coach() from public, anon;
grant execute on function public.coach_may_coach() to authenticated;

-- The five policies, as 004 wrote them, with the new test. Ownership
-- (`coach_id = auth.uid()`) is unchanged: a roster is still personal.

drop policy if exists "coach owns rows" on public.coach_players;
create policy "coach owns rows" on public.coach_players
  for all to authenticated
  using ((select public.coach_may_coach()) and coach_id = (select auth.uid()))
  with check ((select public.coach_may_coach()) and coach_id = (select auth.uid()));

drop policy if exists "coach owns rows" on public.coach_decks;
create policy "coach owns rows" on public.coach_decks
  for all to authenticated
  using ((select public.coach_may_coach()) and coach_id = (select auth.uid()))
  with check ((select public.coach_may_coach()) and coach_id = (select auth.uid()));

drop policy if exists "coach owns rows" on public.coach_match_plans;
create policy "coach owns rows" on public.coach_match_plans
  for all to authenticated
  using ((select public.coach_may_coach()) and coach_id = (select auth.uid()))
  with check ((select public.coach_may_coach()) and coach_id = (select auth.uid()));

drop policy if exists "coach owns rows" on public.coach_plan_decks;
create policy "coach owns rows" on public.coach_plan_decks
  for all to authenticated
  using ((select public.coach_may_coach()) and coach_id = (select auth.uid()))
  with check ((select public.coach_may_coach()) and coach_id = (select auth.uid()));

drop policy if exists "coach owns rows" on public.coach_match_results;
create policy "coach owns rows" on public.coach_match_results
  for all to authenticated
  using ((select public.coach_may_coach()) and coach_id = (select auth.uid()))
  with check ((select public.coach_may_coach()) and coach_id = (select auth.uid()));
