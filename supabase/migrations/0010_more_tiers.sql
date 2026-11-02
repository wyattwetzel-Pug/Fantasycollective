-- Tiers now run S, A, B ... N (15 tiers). The consensus tier is the rounded average of the tiers
-- contributors gave a player, so it needs the longer list too.

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
 group by r.player_id, rs.format, rs.scoring, rs.qb_type;
