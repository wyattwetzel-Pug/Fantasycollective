-- Admin account + contributor invites
--
-- Roles after this migration:
--   admin        one account only (you). Can invite and remove contributors.
--                The admin also holds the contributor role so they can rank.
--   contributor  can build and publish ranking lists. Added by invite.
--   user         everyone else who signs up. View-only.

-- ============================================================
-- Admin flag (exactly one admin, enforced by the database)
-- ============================================================
alter table profiles add column is_admin boolean not null default false;

-- A unique index over only the true rows allows at most one admin.
create unique index only_one_admin on profiles (is_admin) where is_admin;

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_admin);
$$;

-- The admin flag can only be changed from the Supabase SQL editor, never
-- through the app. (In the SQL editor auth.uid() is null.)
create function guard_admin_flag() returns trigger
language plpgsql as $$
begin
  if new.is_admin is distinct from old.is_admin and auth.uid() is not null then
    raise exception 'is_admin can only be changed from the database console';
  end if;
  return new;
end $$;

create trigger profiles_guard_admin
  before update on profiles
  for each row execute function guard_admin_flag();

-- The admin can change anyone's role (promote or remove contributors).
create policy "admin manages profiles" on profiles for update
  using (is_admin()) with check (is_admin());

create policy "admin manages contributors" on contributors for all
  using (is_admin()) with check (is_admin());

-- ============================================================
-- Invites
-- ============================================================
create table invites (
  id          bigint generated always as identity primary key,
  email       text not null,
  invited_by  uuid not null references profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  accepted_at timestamptz
);
create index invites_email_idx on invites (lower(email));

alter table invites enable row level security;

create policy "admin manages invites" on invites for all
  using (is_admin()) with check (is_admin());

-- ============================================================
-- Sign-up: invited emails become contributors, everyone else a viewer
-- ============================================================
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv_id  bigint;
  dn      text := coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1));
begin
  select id into inv_id
    from invites
   where lower(email) = lower(new.email)
     and accepted_at is null
     and expires_at > now()
   order by created_at desc
   limit 1;

  insert into profiles (id, display_name, role)
  values (new.id, dn, case when inv_id is null then 'user'::user_role else 'contributor'::user_role end);

  if inv_id is not null then
    insert into contributors (profile_id, slug)
    values (new.id, regexp_replace(lower(dn), '[^a-z0-9]+', '-', 'g') || '-' || left(new.id::text, 4));

    update invites set accepted_at = now() where id = inv_id;
  end if;

  return new;
end $$;
