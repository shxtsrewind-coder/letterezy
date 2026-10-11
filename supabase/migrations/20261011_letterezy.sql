-- Letterezy: daily leaderboard tables + RPCs.
-- Lives in the same Supabase project as the other bgameworld games, so one
-- account works across all of them. Same design as Sortezy: tables are
-- public-readable where needed and never directly writable — every write goes
-- through a SECURITY DEFINER function that takes the player's identity from
-- auth.uid(), not from anything the client sends.
--
-- One score per player per day: the first finish counts, since a replay of a
-- known bag could always do better.

create table if not exists public.letterezy_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player' check (char_length(display_name) between 1 and 20),
  created_at timestamptz not null default now()
);

create table if not exists public.letterezy_scores (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  puzzle_date date not null,
  -- Word points minus leftover letters plus any clean-bag bonus. Can be
  -- negative for a player who finishes straight away.
  score integer not null check (score between -400 and 2000),
  words integer not null check (words between 0 and 9),
  letters_used integer not null check (letters_used between 0 and 25),
  -- The day's three-star target, as worked out by the game.
  target integer not null check (target between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint letterezy_scores_player_date_key unique (player_id, puzzle_date)
);

create index if not exists letterezy_scores_date_score_idx
  on public.letterezy_scores (puzzle_date, score desc);

alter table public.letterezy_profiles enable row level security;
alter table public.letterezy_scores enable row level security;

drop policy if exists letterezy_profiles_select_own on public.letterezy_profiles;
create policy letterezy_profiles_select_own on public.letterezy_profiles
  for select using (id = (select auth.uid()));

drop policy if exists letterezy_scores_public_read on public.letterezy_scores;
create policy letterezy_scores_public_read on public.letterezy_scores
  for select using (true);

-- Sets (or changes) the caller's display name.
create or replace function public.letterezy_update_profile(p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if char_length(coalesce(trim(p_display_name), '')) < 1 or char_length(trim(p_display_name)) > 20 then
    raise exception 'invalid display_name';
  end if;

  insert into public.letterezy_profiles (id, display_name)
  values (auth.uid(), trim(p_display_name))
  on conflict (id) do update set display_name = excluded.display_name;
end;
$$;

-- Returns the caller's display name for this game. A signed-in (non-guest)
-- player with a name in another bgameworld game gets it copied over the first
-- time. The other games' profile tables are looked up only if they exist, so
-- this works whichever of their migrations have been run.
create or replace function public.letterezy_ensure_profile()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_table text;
begin
  if v_uid is null then
    return null;
  end if;

  select display_name into v_name from public.letterezy_profiles where id = v_uid;
  if v_name is not null or v_is_anon then
    return v_name;
  end if;

  foreach v_table in array array['mergezy_profiles', 'sortezy_profiles', 'wordezy_ladder_profiles', 'wordezy_scramble_profiles', 'wordezy_search_profiles', 'profiles'] loop
    exit when v_name is not null;
    if to_regclass('public.' || v_table) is not null then
      execute format('select display_name from public.%I where id = $1', v_table) into v_name using v_uid;
    end if;
  end loop;

  v_name := left(trim(coalesce(v_name, '')), 20);
  if v_name = '' then
    v_name := 'Player';
  end if;

  insert into public.letterezy_profiles (id, display_name)
  values (v_uid, v_name)
  on conflict (id) do nothing;
  return v_name;
end;
$$;

-- Records the caller's finished daily. The FIRST finish of the day is the one
-- that counts.
create or replace function public.submit_letterezy_score(p_puzzle_date date, p_score integer, p_words integer, p_letters_used integer, p_target integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_banned boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_score is null or p_score < -400 or p_score > 2000 then
    raise exception 'invalid score';
  end if;
  if p_words is null or p_words < 0 or p_words > 9 then
    raise exception 'invalid words';
  end if;
  if p_letters_used is null or p_letters_used < 0 or p_letters_used > 25 or p_letters_used < p_words * 3 then
    raise exception 'invalid letters_used';
  end if;
  if p_target is null or p_target < 1 or p_target > 2000 then
    raise exception 'invalid target';
  end if;
  -- Daily puzzles roll over at midnight UTC; allow one day either side for
  -- players finishing across the boundary, but never a far past/future date.
  if p_puzzle_date is null or abs(p_puzzle_date - (now() at time zone 'utc')::date) > 1 then
    raise exception 'invalid puzzle_date';
  end if;
  -- Accounts banned in the shared profiles table (When & Where / Wordezy).
  -- Looked up dynamically so this works in a project without that table.
  if to_regclass('public.profiles') is not null then
    execute 'select exists (select 1 from public.profiles where id = $1 and is_banned)' into v_banned using auth.uid();
    if v_banned then
      raise exception 'account suspended';
    end if;
  end if;

  select display_name into v_name from public.letterezy_profiles where id = auth.uid();
  if v_name is null then
    raise exception 'profile not set up';
  end if;

  insert into public.letterezy_scores (player_id, display_name, puzzle_date, score, words, letters_used, target)
  values (auth.uid(), v_name, p_puzzle_date, p_score, p_words, p_letters_used, p_target)
  on conflict (player_id, puzzle_date) do nothing;
end;
$$;

-- Highest score for one day; the earlier of two equal scores ranks higher.
create or replace function public.letterezy_daily_leaderboard(p_puzzle_date date, p_limit integer default 10)
returns table (player_id uuid, display_name text, score integer, words integer, letters_used integer)
language sql
stable
set search_path = public
as $$
  select s.player_id, s.display_name, s.score, s.words, s.letters_used
  from public.letterezy_scores s
  where s.puzzle_date = p_puzzle_date
  order by s.score desc, s.created_at asc
  limit greatest(1, least(p_limit, 100))
$$;

-- "312 players today · average 84 · best 141".
create or replace function public.letterezy_daily_stats(p_puzzle_date date)
returns table (players bigint, average numeric, best integer)
language sql
stable
set search_path = public
as $$
  select count(*), coalesce(round(avg(s.score)), 0), coalesce(max(s.score), 0)
  from public.letterezy_scores s
  where s.puzzle_date = p_puzzle_date
$$;

-- All-time standings: most days played, then most days at or over target.
create or replace function public.letterezy_alltime_leaderboard(p_limit integer default 10)
returns table (player_id uuid, display_name text, days bigint, three_stars bigint)
language sql
stable
set search_path = public
as $$
  select
    s.player_id,
    (array_agg(s.display_name order by s.created_at desc))[1] as display_name,
    count(*) as days,
    count(*) filter (where s.score >= s.target) as three_stars
  from public.letterezy_scores s
  group by s.player_id
  order by days desc, three_stars desc
  limit greatest(1, least(p_limit, 100))
$$;

-- Functions are executable by PUBLIC by default in Postgres; lock the
-- writers down to signed-in sessions (guests are signed in anonymously and
-- carry the "authenticated" role too) and leave the readers open.
revoke all on function public.letterezy_update_profile(text) from public, anon;
revoke all on function public.letterezy_ensure_profile() from public, anon;
revoke all on function public.submit_letterezy_score(date, integer, integer, integer, integer) from public, anon;
grant execute on function public.letterezy_update_profile(text) to authenticated;
grant execute on function public.letterezy_ensure_profile() to authenticated;
grant execute on function public.submit_letterezy_score(date, integer, integer, integer, integer) to authenticated;
grant execute on function public.letterezy_daily_leaderboard(date, integer) to anon, authenticated;
grant execute on function public.letterezy_daily_stats(date) to anon, authenticated;
grant execute on function public.letterezy_alltime_leaderboard(integer) to anon, authenticated;
