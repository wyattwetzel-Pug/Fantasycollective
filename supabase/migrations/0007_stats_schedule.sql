-- Schedule and weekly player stats, loaded from Sleeper by the site's sync job.
-- (Projections already have a table: projections.)

create table games (
  season    int not null,
  game_id   text not null,
  week      int not null,
  home      text not null,
  away      text not null,
  game_date date,
  status    text,
  primary key (season, game_id)
);
create index games_week_idx on games (season, week);

-- One row per player per week they played. stats holds Sleeper's full stat line;
-- the three pts_* columns are the fantasy points for each scoring format.
-- Team defenses are stored too (a DEF player), including fan_pts_allow_<pos>.
create table player_stats (
  player_id bigint not null references players (id) on delete cascade,
  season    int not null,
  week      int not null,
  stats     jsonb not null,
  pts_ppr   numeric(6,2),
  pts_half  numeric(6,2),
  pts_std   numeric(6,2),
  primary key (player_id, season, week)
);
create index player_stats_player_idx on player_stats (player_id, season);

alter table games        enable row level security;
alter table player_stats enable row level security;

create policy "read games"        on games        for select using (true);
create policy "read player stats" on player_stats for select using (true);
-- Writes come only from the sync job, which uses the service role key.
