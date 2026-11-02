-- Tiers for the consensus: the average of the tiers contributors assigned
-- (S=1 ... F=7), rounded to the nearest tier. Players nobody tiered get none.

alter table consensus_snapshots add column tier text;

-- Appends the tier column to the live consensus.
create or replace view consensus_live as
select r.player_id,
       rs.format,
       rs.scoring,
       rs.qb_type,
       avg(r.rank)::numeric(8,2) as consensus_rank,
       count(*)                  as sources,
       (array['S','A','B','C','D','E','F'])[
         round(avg(array_position(array['S','A','B','C','D','E','F'], r.tier)))::int
       ]                         as tier
  from rankings r
  join ranking_sets rs on rs.id = r.set_id
 where rs.published
   and rs.updated_at > now() - interval '7 days'
   and not r.needs_ranking
 group by r.player_id, rs.format, rs.scoring, rs.qb_type;

create or replace function refresh_consensus() returns void
language sql security definer set search_path = public as $$
  insert into consensus_snapshots
         (player_id, format, scoring, qb_type, consensus_rank, sources, tier, computed_at)
  select player_id, format, scoring, qb_type, consensus_rank, sources, tier, now()
    from consensus_live
   where is_contributor()
  on conflict (player_id, format, scoring, qb_type) do update
     set consensus_rank = excluded.consensus_rank,
         sources        = excluded.sources,
         tier           = excluded.tier,
         computed_at    = excluded.computed_at;
$$;

-- Recreated so the view picks up the new tier column.
drop view consensus_current;
create view consensus_current as
select s.*,
       row_number() over (
         partition by s.format, s.scoring, s.qb_type
         order by s.consensus_rank
       )                                          as position_in_list,
       s.computed_at < now() - interval '7 days' as is_stale
  from consensus_snapshots s;

alter view consensus_current set (security_invoker = true);
