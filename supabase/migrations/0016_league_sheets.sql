-- A Google Sheet linked to a league (view-only, "anyone with the link"). Its tabs show on My Teams.
create table league_sheets (
  league_id  bigint primary key references leagues (id) on delete cascade,
  sheet_id   text   not null,
  url        text   not null,
  created_at timestamptz not null default now()
);

alter table league_sheets enable row level security;
create policy "own league sheets" on league_sheets for all
  using (exists (select 1 from leagues l where l.id = league_sheets.league_id and l.user_id = auth.uid()))
  with check (exists (select 1 from leagues l where l.id = league_sheets.league_id and l.user_id = auth.uid()));
