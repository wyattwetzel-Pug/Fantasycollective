-- Run ONCE in the Supabase SQL editor, AFTER you have signed up on the site.
-- Makes the PugLover account the admin (and a contributor, so you can rank
-- too). The database allows only one admin.

update profiles
   set is_admin = true,
       role = 'contributor'
 where display_name = 'PugLover';

insert into contributors (profile_id, slug)
select p.id, 'wyatt'
  from profiles p
 where p.is_admin
on conflict (profile_id) do nothing;
