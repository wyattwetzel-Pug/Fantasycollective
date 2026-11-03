-- Daily snapshot of the consensus order, so the home page can show the biggest movers.
create table rank_history (
  snapshot_date    date   not null,
  format           text   not null,
  scoring          text   not null,
  qb_type          text   not null,
  player_id        bigint not null references players (id) on delete cascade,
  position         text   not null,
  position_in_list int    not null,
  primary key (snapshot_date, format, scoring, qb_type, player_id)
);
create index rank_history_lookup_idx on rank_history (format, scoring, qb_type, snapshot_date);

alter table rank_history enable row level security;
create policy "read rank history" on rank_history for select using (true);
