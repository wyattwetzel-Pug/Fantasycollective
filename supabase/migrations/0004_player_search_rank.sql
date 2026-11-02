-- New lists start in Sleeper's popularity order instead of random order.
-- search_rank comes from the Sleeper players feed (lower = more popular).

alter table players add column search_rank int;

create or replace function seed_new_ranking_set() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into rankings (set_id, player_id, rank, needs_ranking)
  select new.id,
         p.id,
         row_number() over (order by coalesce(p.search_rank, 999999), p.id),
         true
    from players p;
  return new;
end $$;
