-- ADP (average draft position) per league setup and season.
-- Replaces the empty first draft of the table with one that also records
-- scoring, QB format, season and the spread of picks.

drop table adp;

create table adp (
  player_id     bigint not null references players (id) on delete cascade,
  source        text not null,
  season        int not null,
  format        league_format not null,
  scoring       scoring_type not null,
  qb_type       qb_type not null,
  adp           numeric(6,1) not null,
  high          int,
  low           int,
  stdev         numeric(5,1),
  times_drafted int,
  teams         int not null default 12,
  as_of         date,
  primary key (player_id, source, season, format, scoring, qb_type)
);
create index adp_lookup_idx on adp (season, format, scoring, qb_type, adp);

alter table adp enable row level security;
create policy "read adp" on adp for select using (true);
