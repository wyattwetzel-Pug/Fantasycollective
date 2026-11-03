-- Season totals for past seasons (shown on player profiles as "Last 3 seasons").
create table player_seasons (
  player_id bigint not null references players (id) on delete cascade,
  season    int    not null,
  gp        int,
  stats     jsonb  not null default '{}',
  pts_ppr   numeric,
  pts_half  numeric,
  pts_std   numeric,
  primary key (player_id, season)
);

alter table player_seasons enable row level security;
create policy "read player seasons" on player_seasons for select using (true);
