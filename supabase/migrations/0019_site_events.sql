-- Site activity for the admin-only Site Stats page: page views, logins and sign-ups.
-- Nobody can read or write this from the browser; only the server (service role) touches it.
create table if not exists site_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind       text not null check (kind in ('view', 'login', 'signup')),
  path       text,
  user_id    uuid references profiles (id) on delete set null,
  visitor_id text
);

create index if not exists site_events_created_idx on site_events (created_at desc);
create index if not exists site_events_kind_idx on site_events (kind, created_at desc);

alter table site_events enable row level security;
-- No policies on purpose: with row level security on and no policy, only the service role gets in.
