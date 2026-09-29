-- Chain Reaction: Evolved — Phase 1 (cloud backup of a single player's own progress).
--
-- Run this once in the Supabase SQL editor. It creates one row per player holding the same
-- blobs the app already keeps in localStorage, so the device stays the source of truth and
-- works exactly as before when offline or when no backend is configured.
--
-- Deliberately NOT stored here:
--   * settings — chain speed, haptics, volume are per-device preferences, not progress.
--   * a per-match log — not needed until leaderboards exist. See src/game/sync/merge.ts.

create table if not exists public.player_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- PlayerProfile, PuzzleProgress and ChallengeState, shapes owned by the client and
  -- re-validated on read by the sanitizers in src/game/{profile,puzzles,challenges}.ts.
  profile    jsonb       not null default '{}'::jsonb,
  puzzles    jsonb       not null default '{}'::jsonb,
  challenges jsonb       not null default '{}'::jsonb,
  -- Bumped on every write so a device can detect that someone else wrote first and re-merge.
  version    integer     not null default 1,
  updated_at timestamptz not null default now()
);

-- Guardrail, not a security boundary: the client computes these totals, so this only catches
-- a corrupt blob or an obvious tamper. Real validation needs a server that replays the moves.
alter table public.player_data
  add constraint player_data_profile_is_object
  check (jsonb_typeof(profile) = 'object');

alter table public.player_data enable row level security;

-- A player can only ever see and write their own row. There is no policy granting access to
-- anyone else's, so cross-account reads are impossible even if the anon key leaks (it is
-- public by design and ships in the client bundle).
create policy "read own row"   on public.player_data for select using (auth.uid() = user_id);
create policy "insert own row" on public.player_data for insert with check (auth.uid() = user_id);
create policy "update own row" on public.player_data for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- No delete policy: a player removes their data by deleting the account, which cascades.

-- Privileges are granted explicitly because the project has "Automatically expose new tables"
-- turned off. RLS decides which ROWS a caller sees; these grants decide whether the table is
-- reachable at all, and both must allow it.
--
-- Nothing is granted to `anon`: every request comes from a signed-in user, and a Supabase
-- anonymous user still carries the `authenticated` role. So an unauthenticated caller holding
-- the public anon key can reach nothing here.
grant usage on schema public to authenticated;
grant select, insert, update on public.player_data to authenticated;

-- Keep updated_at and version honest regardless of what the client sends.
create or replace function public.touch_player_data()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

create trigger player_data_touch
  before update on public.player_data
  for each row execute function public.touch_player_data();
