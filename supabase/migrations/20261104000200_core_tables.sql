-- JobSync · 0002 · Organisations, user profiles and destination portals

create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 200),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger organisations_set_updated_at
  before update on public.organisations
  for each row execute function public.set_updated_at();

-- One profile per Supabase Auth user. Role defaults to the least privilege.
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  email            text not null,
  full_name        text,
  role             public.app_role not null default 'viewer',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index profiles_organisation_id_idx on public.profiles (organisation_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- The client portals work orders are submitted to. Portals are shared
-- configuration; a saved URL never implies the portal is connected —
-- connection_status only changes after a recorded connection test.
create table public.portals (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name                     text not null,
  base_url                 text not null check (base_url ~ '^https://'),
  environment              text not null default 'demo' check (environment in ('demo', 'production')),
  is_enabled               boolean not null default true,
  automation_enabled       boolean not null default false,
  connection_status        public.portal_connection_status not null default 'untested',
  last_connection_test_at  timestamptz,
  last_connection_error    text,
  config                   jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- Target for composite references that carry the slug alongside the id.
  unique (id, slug)
);

create trigger portals_set_updated_at
  before update on public.portals
  for each row execute function public.set_updated_at();

-- Slugs are referenced by submission tasks and by the worker's adapter
-- registry, so they are immutable once created.
create or replace function public.prevent_portal_slug_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'portal slug is immutable (% -> %)', old.slug, new.slug
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger portals_slug_immutable
  before update of slug on public.portals
  for each row execute function public.prevent_portal_slug_change();

-- Seed data: the default organisation and the five SIMULATED demo portals.
-- ON CONFLICT DO NOTHING never overwrites rows that already exist.
insert into public.organisations (name, slug)
values ('Default organisation', 'default')
on conflict (slug) do nothing;

insert into public.portals (slug, name, base_url, environment) values
  ('northstar',  'Northstar',  'https://jobsync-portal-tracker.lovable.app/portal/northstar',  'demo'),
  ('bluepeak',   'BluePeak',   'https://jobsync-portal-tracker.lovable.app/portal/bluepeak',   'demo'),
  ('greenfield', 'Greenfield', 'https://jobsync-portal-tracker.lovable.app/portal/greenfield', 'demo'),
  ('apex',       'Apex',       'https://jobsync-portal-tracker.lovable.app/portal/apex',       'demo'),
  ('metrocare',  'MetroCare',  'https://jobsync-portal-tracker.lovable.app/portal/metrocare',  'demo')
on conflict (slug) do nothing;
