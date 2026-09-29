-- Chain Reaction: Evolved — internal metrics.
--
-- Run after 0001_player_data.sql.
--
-- Privacy stance: one row per (player, device, day) holding counters only. No IP address, no
-- location, no device model, no per-match detail — enough to answer "how many people played and
-- for how long", and nothing more. Collecting this still counts as analytics: it must be listed
-- in the Play Console Data safety form and in your privacy policy before release.

create table if not exists public.player_activity (
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- Per install, so the same player on a phone and a tablet is one user but two rows. Lets a
  -- device re-upload its own day idempotently without clobbering the other device's total.
  device_id  uuid not null,
  day        date not null,
  active_ms  bigint  not null default 0,
  sessions   integer not null default 0,
  matches    integer not null default 0,
  puzzles_solved integer not null default 0,
  platform   text,
  app_version text,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id, day),
  -- A day cannot contain more than a day of play; rejects a corrupt or tampered upload.
  constraint player_activity_ms_sane check (active_ms between 0 and 86400000)
);

create index if not exists player_activity_day_idx on public.player_activity (day);

alter table public.player_activity enable row level security;

-- A player may only write their own rows, and may not read anyone's — not even their own,
-- since nothing in the game displays this. Aggregates are read through the metrics schema below.
create policy "insert own activity" on public.player_activity for insert
  with check (auth.uid() = user_id);
create policy "update own activity" on public.player_activity for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Explicit grants, since "Automatically expose new tables" is off. Note the missing SELECT:
-- the game only ever writes here, so no client can read activity back — not even its own.
grant insert, update on public.player_activity to authenticated;


-- ---------------------------------------------------------------- internal dashboard
--
-- These views live outside `public`, which is the only schema Supabase exposes over the API.
-- That keeps them unreachable from the game and from the anon key: they are readable from the
-- SQL editor and by the service_role only. Do not move them into `public`.

create schema if not exists metrics;

-- Only the service_role may read these, and that key never leaves your machine: the dashboard
-- is generated locally by `npm run dashboard`. Neither `anon` nor `authenticated` is granted
-- anything here, so the views are unreachable from the game even if its key leaks.
--
-- SETUP: for the dashboard to read these, add `metrics` to Project Settings → Data API →
-- Exposed schemas. Exposing a schema only lets PostgREST route to it; the grants below still
-- decide who may read, and the game's roles are granted nothing. Verified: with the schema
-- unexposed, even the service_role gets "Invalid schema: metrics".
grant usage on schema metrics to service_role;
alter default privileges in schema metrics grant select on tables to service_role;

-- Headline numbers. Active = had any foreground time that day.
create or replace view metrics.overview as
select
  (select count(*) from public.player_data)                                      as total_players,
  (select count(distinct user_id) from public.player_activity
     where day = current_date)                                                   as dau,
  (select count(distinct user_id) from public.player_activity
     where day > current_date - 7)                                               as wau,
  (select count(distinct user_id) from public.player_activity
     where day > current_date - 30)                                              as mau,
  (select coalesce(sum(active_ms), 0) / 3600000.0 from public.player_activity)   as total_hours,
  (select coalesce(sum(matches), 0) from public.player_activity)                 as total_matches;

-- One row per day, for charting trends.
create or replace view metrics.daily as
select
  day,
  count(distinct user_id)                        as active_players,
  sum(sessions)                                  as sessions,
  sum(matches)                                   as matches,
  round(sum(active_ms) / 3600000.0, 2)           as active_hours,
  -- Average minutes per active player that day: the number that tells you whether people are
  -- really playing or just opening the app.
  round(sum(active_ms) / 60000.0 / nullif(count(distinct user_id), 0), 1) as minutes_per_player
from public.player_activity
group by day
order by day desc;

-- New players per day, and how many came back at all afterwards.
create or replace view metrics.retention as
with first_seen as (
  select user_id, min(day) as cohort_day from public.player_activity group by user_id
)
select
  f.cohort_day,
  count(*)                                                           as new_players,
  count(*) filter (where a.returned_on_day_1)                        as returned_next_day,
  count(*) filter (where a.returned_within_7)                        as returned_within_7d,
  round(100.0 * count(*) filter (where a.returned_on_day_1) / nullif(count(*), 0), 1)
                                                                     as day_1_retention_pct
from first_seen f
join lateral (
  select
    bool_or(pa.day = f.cohort_day + 1)                      as returned_on_day_1,
    bool_or(pa.day between f.cohort_day + 1 and f.cohort_day + 7) as returned_within_7
  from public.player_activity pa
  where pa.user_id = f.user_id
) a on true
group by f.cohort_day
order by f.cohort_day desc;

-- Where players are on the difficulty curve, from the synced progress blobs.
create or replace view metrics.progression as
select
  count(*)                                                                   as players,
  round(avg((profile -> 'xp')::numeric), 0)                                  as avg_xp,
  round(avg(jsonb_array_length(coalesce(profile -> 'recent', '[]'::jsonb))), 1) as avg_recent_len,
  round(avg((select count(*) from jsonb_object_keys(puzzles))), 1)           as avg_puzzles_solved,
  count(*) filter (where (select count(*) from jsonb_object_keys(puzzles)) = 0)
                                                                             as never_solved_a_puzzle
from public.player_data;

-- Which modes people actually play, summed from the synced profile stats.
create or replace view metrics.mode_split as
select
  mode,
  sum(games)::bigint as games,
  sum(wins)::bigint  as wins
from public.player_data,
  lateral (values
    ('classic',   coalesce((profile #>> '{stats,classic,games}')::int, 0),
                  coalesce((profile #>> '{stats,classic,wins}')::int, 0)),
    ('abilities', coalesce((profile #>> '{stats,abilities,games}')::int, 0),
                  coalesce((profile #>> '{stats,abilities,wins}')::int, 0)),
    ('arena',     coalesce((profile #>> '{stats,arena,games}')::int, 0),
                  coalesce((profile #>> '{stats,arena,wins}')::int, 0))
  ) as t(mode, games, wins)
group by mode;

-- Explicit, in case default privileges did not apply to the views above.
grant select on all tables in schema metrics to service_role;
