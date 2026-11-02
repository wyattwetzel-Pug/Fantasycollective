-- Fantasy Football Rankings: initial schema (Supabase / Postgres)
--
-- Rules this schema encodes:
--   1. Rankings belong to contributors only. Fans follow contributors.
--   2. One shared player pool. Every contributor ranks every player; a new
--      player is added to every list at the bottom, flagged needs_ranking.
--   3. Ball Knowers Consensus = plain average of contributor ranks, kept
--      separate by format / scoring / qb_type.
--   4. Any edit to a list counts as an update (trigger bumps updated_at).
--   5. A list not updated in 7 days stops counting toward the consensus but
--      is never deleted.
--   6. If every contributor is stale, the consensus shows the last known
--      values, flagged stale (consensus_snapshots).

-- ============================================================
-- Types
-- ============================================================
create type user_role      as enum ('user', 'contributor');
create type league_format  as enum ('redraft', 'dynasty');
create type scoring_type   as enum ('ppr', 'half', 'std');
create type qb_type        as enum ('1qb', 'superflex');
create type player_pos     as enum ('QB', 'RB', 'WR', 'TE', 'K', 'DEF');

-- ============================================================
-- People
-- ============================================================
create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url   text,
  role         user_role not null default 'user',
  created_at   timestamptz not null default now()
);

create table contributors (
  profile_id uuid primary key references profiles (id) on delete cascade,
  slug       text not null unique,
  bio        text,
  created_at timestamptz not null default now()
);

create table follows (
  user_id        uuid not null references profiles (id) on delete cascade,
  contributor_id uuid not null references contributors (profile_id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (user_id, contributor_id)
);

-- Create a profile row whenever someone signs up.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- True when the signed-in user has the contributor role.
create function is_contributor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'contributor');
$$;

-- ============================================================
-- Players and supporting data
-- ============================================================
create table players (
  id          bigint generated always as identity primary key,
  external_id text unique,                 -- Sleeper player id
  name        text not null,
  position    player_pos not null,
  nfl_team    text,
  age         int,
  status      text,
  is_rookie   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index players_position_idx on players (position);

create table adp (
  player_id bigint not null references players (id) on delete cascade,
  source    text not null,
  format    league_format not null,
  adp       numeric(5,2) not null,
  as_of     date not null default current_date,
  primary key (player_id, source, format, as_of)
);

create table projections (
  player_id bigint not null references players (id) on delete cascade,
  season    int not null,
  week      int not null,                  -- 0 = full season
  scoring   scoring_type not null,
  points    numeric(6,2) not null,
  primary key (player_id, season, week, scoring)
);

create table news (
  id           bigint generated always as identity primary key,
  player_id    bigint references players (id) on delete cascade,
  headline     text not null,
  body         text,
  published_at timestamptz not null default now()
);

-- ============================================================
-- Rankings (the core)
-- ============================================================
-- One live list per contributor per format / scoring / qb_type.
create table ranking_sets (
  id             bigint generated always as identity primary key,
  contributor_id uuid not null references contributors (profile_id) on delete cascade,
  format         league_format not null,
  scoring        scoring_type not null,
  qb_type        qb_type not null,
  published      boolean not null default false,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (contributor_id, format, scoring, qb_type)
);

create table rankings (
  set_id        bigint not null references ranking_sets (id) on delete cascade,
  player_id     bigint not null references players (id) on delete cascade,
  rank          int not null,
  tier          text,                      -- S, A, B, C, D, E, F
  note          text,
  needs_ranking boolean not null default false,
  primary key (set_id, player_id)
);
create index rankings_set_rank_idx on rankings (set_id, rank);

-- Rule 4: any edit to a list bumps the set's updated_at.
create function touch_ranking_set() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update ranking_sets
     set updated_at = now()
   where id = coalesce(new.set_id, old.set_id);
  return null;
end $$;

create trigger rankings_touch_set
  after insert or update or delete on rankings
  for each row execute function touch_ranking_set();

-- Rule 2: a new player is appended to every existing list, flagged.
create function add_player_to_all_sets() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into rankings (set_id, player_id, rank, needs_ranking)
  select rs.id,
         new.id,
         coalesce((select max(r.rank) from rankings r where r.set_id = rs.id), 0) + 1,
         true
    from ranking_sets rs;
  return new;
end $$;

create trigger players_add_to_sets
  after insert on players
  for each row execute function add_player_to_all_sets();

-- Rule 2: a new list starts with the whole player pool, all flagged.
create function seed_new_ranking_set() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into rankings (set_id, player_id, rank, needs_ranking)
  select new.id, p.id, row_number() over (order by p.id), true
    from players p;
  return new;
end $$;

create trigger ranking_sets_seed
  after insert on ranking_sets
  for each row execute function seed_new_ranking_set();

-- ============================================================
-- Ball Knowers Consensus
-- ============================================================
-- Live average over fresh (updated in the last 7 days), published lists,
-- counting only players the contributor has actually placed.
create view consensus_live as
select r.player_id,
       rs.format,
       rs.scoring,
       rs.qb_type,
       avg(r.rank)::numeric(8,2) as consensus_rank,
       count(*)                  as sources
  from rankings r
  join ranking_sets rs on rs.id = r.set_id
 where rs.published
   and rs.updated_at > now() - interval '7 days'
   and not r.needs_ranking
 group by r.player_id, rs.format, rs.scoring, rs.qb_type;

-- Rule 6: last known consensus, refreshed only while fresh sources exist.
create table consensus_snapshots (
  player_id      bigint not null references players (id) on delete cascade,
  format         league_format not null,
  scoring        scoring_type not null,
  qb_type        qb_type not null,
  consensus_rank numeric(8,2) not null,
  sources        int not null,
  computed_at    timestamptz not null default now(),
  primary key (player_id, format, scoring, qb_type)
);

-- The app calls this once each time a contributor saves a list:
--   await supabase.rpc('refresh_consensus')
-- Groups with no fresh sources are left alone, so their snapshot ages.
create function refresh_consensus() returns void
language sql security definer set search_path = public as $$
  insert into consensus_snapshots
         (player_id, format, scoring, qb_type, consensus_rank, sources, computed_at)
  select player_id, format, scoring, qb_type, consensus_rank, sources, now()
    from consensus_live
   where is_contributor()
  on conflict (player_id, format, scoring, qb_type) do update
     set consensus_rank = excluded.consensus_rank,
         sources        = excluded.sources,
         computed_at    = excluded.computed_at;
$$;

-- Only signed-in users can call it, and it does nothing for non-contributors.
revoke execute on function refresh_consensus() from public;
grant  execute on function refresh_consensus() to authenticated;

-- What the app reads: ordered consensus, flagged stale once the snapshot
-- is more than 7 days old (every contributor stale).
create view consensus_current as
select s.*,
       row_number() over (
         partition by s.format, s.scoring, s.qb_type
         order by s.consensus_rank
       )                                   as position_in_list,
       s.computed_at < now() - interval '7 days' as is_stale
  from consensus_snapshots s;

-- ============================================================
-- Tools: trade calculator, start/sit, mock drafts
-- ============================================================
create table trade_values (
  player_id bigint not null references players (id) on delete cascade,
  format    league_format not null,
  qb_type   qb_type not null,
  value     numeric(8,2) not null,
  as_of     date not null default current_date,
  primary key (player_id, format, qb_type, as_of)
);

create table pick_values (
  season  int not null,
  round   int not null,
  slot    text not null default 'mid',     -- early / mid / late
  format  league_format not null,
  value   numeric(8,2) not null,
  primary key (season, round, slot, format)
);

create table start_sit_calls (
  id             bigint generated always as identity primary key,
  contributor_id uuid not null references contributors (profile_id) on delete cascade,
  season         int not null,
  week           int not null,
  player_a       bigint not null references players (id),
  player_b       bigint not null references players (id),
  pick           bigint not null references players (id),
  reason         text,
  created_at     timestamptz not null default now()
);

create table mock_drafts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles (id) on delete cascade,
  settings   jsonb not null,               -- type, size, roster slots, pick slot
  picks      jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ============================================================
-- League sync
-- ============================================================
create table leagues (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null references profiles (id) on delete cascade,
  platform           text not null,        -- sleeper first; espn / yahoo later
  external_league_id text not null,
  name               text,
  scoring            scoring_type,
  qb_type            qb_type,
  format             league_format,
  roster_settings    jsonb,
  synced_at          timestamptz,
  unique (user_id, platform, external_league_id)
);

create table league_rosters (
  league_id  bigint not null references leagues (id) on delete cascade,
  team_name  text not null,
  is_mine    boolean not null default false,
  player_id  bigint not null references players (id),
  slot       text not null,                -- starter / bench / ir
  primary key (league_id, team_name, player_id)
);

-- ============================================================
-- Row-level security
-- ============================================================
alter table profiles            enable row level security;
alter table contributors        enable row level security;
alter table follows             enable row level security;
alter table players             enable row level security;
alter table adp                 enable row level security;
alter table projections         enable row level security;
alter table news                enable row level security;
alter table ranking_sets        enable row level security;
alter table rankings            enable row level security;
alter table consensus_snapshots enable row level security;
alter table trade_values        enable row level security;
alter table pick_values         enable row level security;
alter table start_sit_calls     enable row level security;
alter table mock_drafts         enable row level security;
alter table leagues             enable row level security;
alter table league_rosters      enable row level security;

-- Public read-only reference data (writes go through the service role only).
create policy "read players"     on players             for select using (true);
create policy "read adp"         on adp                 for select using (true);
create policy "read projections" on projections         for select using (true);
create policy "read news"        on news                for select using (true);
create policy "read consensus"   on consensus_snapshots for select using (true);
create policy "read trade vals"  on trade_values        for select using (true);
create policy "read pick vals"   on pick_values         for select using (true);

-- Profiles: anyone can read; you can edit yourself but not change your role.
create policy "read profiles" on profiles for select using (true);
create policy "update own profile" on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select p.role from profiles p where p.id = auth.uid()));

create policy "read contributors" on contributors for select using (true);
create policy "edit own contributor page" on contributors for all
  using (profile_id = auth.uid() and is_contributor())
  with check (profile_id = auth.uid() and is_contributor());

create policy "manage own follows" on follows for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Rankings: everyone reads published lists; only the owning contributor writes.
create policy "read published or own sets" on ranking_sets for select
  using (published or contributor_id = auth.uid());
create policy "contributors manage own sets" on ranking_sets for all
  using (contributor_id = auth.uid() and is_contributor())
  with check (contributor_id = auth.uid() and is_contributor());

create policy "read rankings of visible sets" on rankings for select
  using (exists (select 1 from ranking_sets rs
                  where rs.id = rankings.set_id
                    and (rs.published or rs.contributor_id = auth.uid())));
create policy "contributors manage own rankings" on rankings for all
  using (exists (select 1 from ranking_sets rs
                  where rs.id = rankings.set_id and rs.contributor_id = auth.uid() and is_contributor()))
  with check (exists (select 1 from ranking_sets rs
                  where rs.id = rankings.set_id and rs.contributor_id = auth.uid() and is_contributor()));

create policy "read start/sit calls" on start_sit_calls for select using (true);
create policy "contributors manage own calls" on start_sit_calls for all
  using (contributor_id = auth.uid() and is_contributor())
  with check (contributor_id = auth.uid() and is_contributor());

-- Private to the owner.
create policy "own mock drafts" on mock_drafts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own leagues" on leagues for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own league rosters" on league_rosters for all
  using (exists (select 1 from leagues l where l.id = league_rosters.league_id and l.user_id = auth.uid()))
  with check (exists (select 1 from leagues l where l.id = league_rosters.league_id and l.user_id = auth.uid()));

-- Views run with the caller's rights so RLS on the base tables still applies.
alter view consensus_live    set (security_invoker = true);
alter view consensus_current set (security_invoker = true);
