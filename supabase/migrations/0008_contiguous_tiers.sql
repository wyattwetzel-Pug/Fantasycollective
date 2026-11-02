-- Consensus tiers that never go backwards down the list.
--
-- The consensus tier is the rounded average of the tiers contributors gave
-- each player, so a player ranked lower could land in a better tier than
-- someone above them (a B tier player, then an A further down). Now a player
-- can never be in a better tier than anyone ranked above them, and players
-- nobody tiered join the tier of the player above. Only the view changes;
-- the stored snapshots are untouched.

drop view consensus_current;
create view consensus_current as
select player_id, format, scoring, qb_type, consensus_rank, sources, computed_at,
       (array['S','A','B','C','D','E','F'])[
         max(array_position(array['S','A','B','C','D','E','F'], tier)) over (
           partition by format, scoring, qb_type
           order by consensus_rank, player_id
           rows between unbounded preceding and current row
         )
       ]                                          as tier,
       position_in_list,
       is_stale
  from (
    select s.*,
           row_number() over (
             partition by s.format, s.scoring, s.qb_type
             order by s.consensus_rank, s.player_id
           )                                          as position_in_list,
           s.computed_at < now() - interval '7 days' as is_stale
      from consensus_snapshots s
  ) ranked;

alter view consensus_current set (security_invoker = true);
