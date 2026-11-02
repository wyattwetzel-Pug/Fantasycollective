-- Admin oversight: the admin always sits above contributors.
--
-- Already true from 0002: only the admin can invite, promote or remove
-- contributors, and nobody can change the admin flag through the app.
-- This migration adds the rest:
--   * the admin can see, unpublish or delete ANY contributor's list
--   * the admin can promote an existing viewer by email
-- Contributors can only ever touch their own lists.

create policy "admin reads all sets"   on ranking_sets for select using (is_admin());
create policy "admin updates all sets" on ranking_sets for update using (is_admin()) with check (is_admin());
create policy "admin deletes all sets" on ranking_sets for delete using (is_admin());
create policy "admin reads all rankings" on rankings   for select using (is_admin());

-- Promote someone who already has an account. Returns false when no account
-- with that email exists yet (the app then creates an invite instead).
create function promote_by_email(target_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  dn  text;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;

  select id into uid from auth.users where lower(email) = lower(target_email);
  if uid is null then
    return false;
  end if;

  update profiles set role = 'contributor' where id = uid returning display_name into dn;

  insert into contributors (profile_id, slug)
  values (uid, regexp_replace(lower(dn), '[^a-z0-9]+', '-', 'g') || '-' || left(uid::text, 4))
  on conflict (profile_id) do nothing;

  return true;
end $$;

revoke execute on function promote_by_email(text) from public;
grant  execute on function promote_by_email(text) to authenticated;
