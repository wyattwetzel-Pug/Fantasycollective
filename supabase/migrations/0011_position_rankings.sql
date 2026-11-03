-- Separate rankings per position (QB, RB, WR, TE, K, DEF, FLEX) inside each list.
-- A position list has its own order and its own tiers. Overall stays in "rankings".

create table position_rankings (
  set_id    bigint not null references ranking_sets (id) on delete cascade,
  scope     text   not null check (scope in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX')),
  player_id bigint not null references players (id) on delete cascade,
  rank      int    not null,
  tier      text,
  primary key (set_id, scope, player_id)
);
create index position_rankings_idx on position_rankings (set_id, scope, rank);

alter table position_rankings enable row level security;

create policy "read position rankings of visible sets" on position_rankings for select
  using (exists (select 1 from ranking_sets rs
                  where rs.id = position_rankings.set_id
                    and (rs.published or rs.contributor_id = auth.uid())));
create policy "contributors manage own position rankings" on position_rankings for all
  using (exists (select 1 from ranking_sets rs
                  where rs.id = position_rankings.set_id and rs.contributor_id = auth.uid() and is_contributor()))
  with check (exists (select 1 from ranking_sets rs
                  where rs.id = position_rankings.set_id and rs.contributor_id = auth.uid() and is_contributor()));
