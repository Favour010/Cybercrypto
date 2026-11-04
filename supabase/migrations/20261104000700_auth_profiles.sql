-- JobSync · 0007 · Create a profile for every new Supabase Auth user
--
-- New users always start as "viewer". The organisation comes from
-- app_metadata.organisation_slug, which only the service role can set
-- (user_metadata is user-editable and is deliberately NOT trusted).
-- Promote the first administrator with the SQL in docs/database.md.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_id uuid;
begin
  select o.id into org_id
  from public.organisations o
  where o.slug = coalesce(new.raw_app_meta_data ->> 'organisation_slug', 'default');

  if org_id is null then
    select o.id into org_id from public.organisations o where o.slug = 'default';
  end if;

  insert into public.profiles (id, organisation_id, email, full_name, role)
  values (
    new.id,
    org_id,
    coalesce(new.email, ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    'viewer'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Profiles for users that existed before this migration (additive backfill).
insert into public.profiles (id, organisation_id, email, role)
select u.id, o.id, coalesce(u.email, ''), 'viewer'
from auth.users u
cross join lateral (select id from public.organisations where slug = 'default') o
on conflict (id) do nothing;
