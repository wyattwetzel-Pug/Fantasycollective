-- College prospects: the CFB Rankings tab on the Dynasty hub.
-- Anyone can read the list; only the admin can change it (from the Admin page).

create table prospects (
  id         bigint generated always as identity primary key,
  name       text not null,
  position   text not null,
  school     text not null,
  class_year text,
  draft_year int,
  note       text,
  rank       int not null,
  created_at timestamptz not null default now()
);
create index prospects_rank_idx on prospects (rank);

alter table prospects enable row level security;
create policy "prospects readable" on prospects for select using (true);
create policy "admin manages prospects" on prospects for all
  using (is_admin()) with check (is_admin());

-- Starter list, in rough order. Check it and fix it from the Admin page.
insert into prospects (name, position, school, class_year, draft_year, rank) values
  ('Jeremiah Smith',  'WR', 'Ohio State',     'Junior',    2027, 1),
  ('Arch Manning',    'QB', 'Texas',          'RS Junior', 2027, 2),
  ('Ryan Williams',   'WR', 'Alabama',        'Junior',    2027, 3),
  ('Dante Moore',     'QB', 'Oregon',         null,        2027, 4),
  ('Cam Coleman',     'WR', 'Texas',          'Junior',    2027, 5),
  ('Dakorien Moore',  'WR', 'Oregon',         'Junior',    2027, 6),
  ('LaNorris Sellers','QB', 'South Carolina', null,        2027, 7),
  ('Julian Sayin',    'QB', 'Ohio State',     null,        2027, 8),
  ('Kewan Lacy',      'RB', 'Ole Miss',       null,        2027, 9),
  ('Ahmad Hardy',     'RB', 'Missouri',       null,        2027, 10);
