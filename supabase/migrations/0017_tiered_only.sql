-- Published rankings only count players a contributor has put in a tier. "Unsorted" players are left out.
create or replace view consensus_live as
select r.player_id,
       rs.format,
       rs.scoring,
       rs.qb_type,
       avg(r.rank)::numeric(8,2) as consensus_rank,
       count(*)                  as sources,
       (array['S','A','B','C','D','E','F','G','H','I','J','K','L','M','N'])[
         round(avg(array_position(array['S','A','B','C','D','E','F','G','H','I','J','K','L','M','N'], r.tier)))::int
       ]                         as tier
  from rankings r
  join ranking_sets rs on rs.id = r.set_id
 where rs.published
   and rs.updated_at > now() - interval '7 days'
   and not r.needs_ranking
   and r.tier is not null
 group by r.player_id, rs.format, rs.scoring, rs.qb_type;

-- Refreshing also drops players who are no longer in the live consensus (for groups that have one).
create or replace function refresh_consensus() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_contributor() then return; end if;

  insert into consensus_snapshots
         (player_id, format, scoring, qb_type, consensus_rank, sources, tier, computed_at)
  select player_id, format, scoring, qb_type, consensus_rank, sources, tier, now()
    from consensus_live
  on conflict (player_id, format, scoring, qb_type) do update
     set consensus_rank = excluded.consensus_rank,
         sources        = excluded.sources,
         tier           = excluded.tier,
         computed_at    = excluded.computed_at;

  delete from consensus_snapshots s
   where exists (select 1 from consensus_live l where l.format = s.format and l.scoring = s.scoring and l.qb_type = s.qb_type)
     and not exists (select 1 from consensus_live l where l.player_id = s.player_id and l.format = s.format and l.scoring = s.scoring and l.qb_type = s.qb_type);
end $$;

-- One-time cleanup so the change shows up right away.
delete from consensus_snapshots s
 where exists (select 1 from consensus_live l where l.format = s.format and l.scoring = s.scoring and l.qb_type = s.qb_type)
   and not exists (select 1 from consensus_live l where l.player_id = s.player_id and l.format = s.format and l.scoring = s.scoring and l.qb_type = s.qb_type);
