-- 005 — the Deck Arsenal's manual order (Coach Roster phase 3)
--
-- 004 ALREADY HOLDS THE ARSENAL. `coach_decks` has the cards (with an
-- order-free `deck_key` so one list cannot be added twice), the name, the
-- archetype, comfort 1–5, free-form tags, active/archived, the source
-- (manual / link / history / coach_assist / variant), `source_ref` and notes.
-- Nothing about the deck itself needs adding.
--
-- WHAT IS MISSING IS THE COACH'S OWN ORDER. Every other ordering this screen
-- could use answers a different question: comfort is how well they play it,
-- `updated_at` is when it was last edited, and a "Primary" tag marks one deck
-- rather than ranking the rest. A coach ranking an arsenal is making a
-- judgement no stored figure carries, so it needs a column of its own.
--
-- ONE STATEMENT, ADDITIVE, AND NOTHING ELSE MOVES.
--   • No policy change: "coach owns rows" is a table policy and already
--     covers every column, new ones included.
--   • No grant change: 004 grants select/insert/update/delete on the TABLE to
--     `authenticated`, and a table-level grant extends to columns added
--     later. (A column-level grant would NOT — that is the trap 001 hit and
--     004 records.)
--   • `not null default 0` so every existing row gets a defined position and
--     nothing has to be backfilled. Ties fall back to `created_at` in the
--     client's sort, so equal values are stable rather than arbitrary.
--   • No new index. An arsenal is a handful of decks per player and
--     `coach_decks_player_idx (player_id, status)` already finds them;
--     ordering ten rows costs nothing and an index that buys nothing is
--     still storage and still has to be maintained on every write.
--
-- Safe to run more than once.

alter table public.coach_decks
  add column if not exists sort_order integer not null default 0;

comment on column public.coach_decks.sort_order is
  'The coach''s own ranking within one player''s arsenal. Lower is higher up; '
  'ties break on created_at in the client. Not derived from comfort or tags.';
