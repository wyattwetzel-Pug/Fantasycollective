-- News now comes from ESPN's public NFL feed: link out to the story and remember where it came from.
alter table news add column url text;
alter table news add column source text;
alter table news add column external_id text;
create index news_external_idx on news (external_id);
