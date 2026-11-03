-- Each story remembers which team feeds it appeared in, so a player's News tab can show team news too.
alter table news add column teams text[] not null default '{}';
create index news_teams_idx on news using gin (teams);
