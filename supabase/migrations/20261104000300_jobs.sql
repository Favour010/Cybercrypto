-- JobSync · 0003 · Jobs, contacts and attachments

-- Supabase installs extensions into the "extensions" schema.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create sequence public.job_reference_seq;

create table public.jobs (
  id                uuid primary key default gen_random_uuid(),
  -- Human-readable internal JobSync ID shown in the UI, e.g. JS-000123.
  reference         text not null unique
                      default ('JS-' || lpad(nextval('public.job_reference_seq')::text, 6, '0')),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,

  -- Provenance. External jobs must carry the source system's ID.
  source_type       public.job_source_type not null,
  source            text not null check (source ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
  external_job_id   text check (external_job_id is null or length(trim(external_job_id)) between 1 and 120),

  customer_name     text not null check (length(trim(customer_name)) between 1 and 200),
  service_address   text not null check (length(trim(service_address)) between 1 and 500),
  category          text not null check (length(trim(category)) between 1 and 100),
  priority          public.job_priority not null default 'normal',
  description       text not null check (length(description) between 1 and 5000),
  instructions      text check (instructions is null or length(instructions) <= 5000),
  scheduled_date    date,
  scheduled_time    time,
  technician        text check (technician is null or length(technician) <= 200),

  status            public.job_status not null default 'received',
  received_at       timestamptz not null default now(),
  archived_at       timestamptz,
  archived_by       uuid references public.profiles (id) on delete set null,
  created_by        uuid references public.profiles (id) on delete set null,
  -- Original intake payload, retained for audit and re-validation.
  raw_payload       jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint jobs_external_requires_id
    check (source_type = 'manual' or external_job_id is not null),
  constraint jobs_archive_consistency
    check (archived_by is null or archived_at is not null),
  -- Duplicate external imports are impossible: one row per source + external ID.
  -- (NULL external IDs, i.e. manual jobs, are not constrained.)
  constraint jobs_source_external_job_id_key unique (source, external_job_id),
  -- Target for composite foreign keys that must agree on the organisation.
  constraint jobs_id_organisation_key unique (id, organisation_id)
);

-- Lower-cased text used by the Jobs search box (trigram indexed).
alter table public.jobs add column search_text text generated always as (
  lower(
    reference || ' ' || coalesce(external_job_id, '') || ' ' || customer_name || ' ' ||
    service_address || ' ' || category || ' ' || coalesce(technician, '')
  )
) stored;

create index jobs_org_received_idx on public.jobs (organisation_id, received_at desc);
create index jobs_org_status_active_idx on public.jobs (organisation_id, status) where archived_at is null;
create index jobs_org_scheduled_idx on public.jobs (organisation_id, scheduled_date);
create index jobs_search_trgm_idx on public.jobs using gin (search_text extensions.gin_trgm_ops);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create table public.job_contacts (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 200),
  email       text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone       text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,24}$'),
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index job_contacts_job_id_idx on public.job_contacts (job_id);
-- At most one primary contact per job.
create unique index job_contacts_one_primary_idx on public.job_contacts (job_id) where is_primary;

create trigger job_contacts_set_updated_at
  before update on public.job_contacts
  for each row execute function public.set_updated_at();

-- Files live in Supabase Storage (bucket "job-attachments"); rows hold the
-- reference. An externally hosted file may instead be referenced by URL.
create table public.job_attachments (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs (id) on delete cascade,
  file_name        text not null check (length(trim(file_name)) between 1 and 255),
  content_type     text not null,
  size_bytes       bigint check (size_bytes is null or size_bytes between 0 and 26214400),
  storage_bucket   text,
  storage_path     text,
  source_url       text check (source_url is null or source_url ~ '^https://'),
  checksum_sha256  text check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
  uploaded_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint job_attachments_has_location
    check ((storage_bucket is not null and storage_path is not null) or source_url is not null),
  constraint job_attachments_storage_unique unique (storage_bucket, storage_path)
);

create index job_attachments_job_id_idx on public.job_attachments (job_id);
