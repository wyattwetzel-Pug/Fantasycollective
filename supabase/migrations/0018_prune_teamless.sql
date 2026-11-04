-- Removes players who are on no NFL team and who nothing depends on: nobody has put them in a tier, they are
-- on no synced roster, and they have no stats. Safe to run more than once. When one of them signs with a team,
-- the daily sync adds him back, unsorted, at the bottom of every list.

delete from players p
 where p.nfl_team is null
   and p.position <> 'DEF'
   and not exists (select 1 from rankings r where r.player_id = p.id and r.tier is not null)
   and not exists (select 1 from position_rankings r where r.player_id = p.id and r.tier is not null)
   and not exists (select 1 from league_rosters l where l.player_id = p.id)
   and not exists (select 1 from player_stats s where s.player_id = p.id);
