-- JobSync · 0005 · Integration settings, integration events and audit logs

-- Per-organisation integration configuration. Non-secret values live in
-- `config`; secrets are encrypted by the server (AES-256-GCM, key from the
-- server environment) before storage and are never returned to browsers:
-- `secret_ciphertext` is not readable by the authenticated role (see 0006).
create table public.integration_settings (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  kind               text not null check (kind in ('supabase', 'n8n', 'intake', 'playwright', 'system', 'aroflo')),
  config             jsonb not null default '{}'::jsonb,
  secret_ciphertext  text,
  -- e.g. "••••3f9a" so admins can recognise a stored secret without seeing it.
  secret_hint        text check (secret_hint is null or length(secret_hint) <= 16),
  secret_updated_at  timestamptz,
  -- Connection tests are recorded, never assumed.
  last_test_at       timestamptz,
  last_test_status   text check (last_test_status in ('ok', 'failed')),
  last_test_message  text,
  updated_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint integration_settings_org_kind_key unique (organisation_id, kind),
  constraint integration_settings_test_consistency
    check ((last_test_at is null) = (last_test_status is null))
);

create trigger integration_settings_set_updated_at
  before update on public.integration_settings
  for each row execute function public.set_updated_at();

-- Every inbound/outbound integration message (intake API, n8n webhooks,
-- result callbacks), including rejected and duplicate ones.
create table public.integration_events (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid references public.organisations (id) on delete restrict,
  integration       text not null check (integration ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
  direction         text not null check (direction in ('inbound', 'outbound')),
  event_type        text not null,
  status            text not null check (status in ('received', 'accepted', 'duplicate', 'rejected', 'processed', 'failed')),
  http_status       integer check (http_status between 100 and 599),
  idempotency_key   text,
  request_id        text,
  job_id            uuid references public.jobs (id) on delete set null,
  payload           jsonb,
  error             text,
  created_at        timestamptz not null default now()
);

create index integration_events_org_created_idx on public.integration_events (organisation_id, created_at desc);
create index integration_events_idempotency_idx on public.integration_events (integration, idempotency_key)
  where idempotency_key is not null;
create index integration_events_job_idx on public.integration_events (job_id) where job_id is not null;

-- Append-only audit trail.
create table public.audit_logs (
  id               bigint generated always as identity primary key,
  organisation_id  uuid references public.organisations (id) on delete restrict,
  -- Not a foreign key: audit rows are immutable and must outlive the user.
  actor_id         uuid,
  actor_type       text not null check (actor_type in ('user', 'system', 'integration', 'worker')),
  action           text not null,
  entity_type      text not null,
  entity_id        uuid,
  changes          jsonb,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index audit_logs_org_created_idx on public.audit_logs (organisation_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create or replace function public.audit_logs_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_logs_no_update
  before update or delete on public.audit_logs
  for each row execute function public.audit_logs_append_only();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function public.audit_logs_append_only();

-- Generic row-change auditing. Runs as the table owner so it can write the
-- audit log regardless of the caller's RLS permissions. Secret columns and
-- derived columns are never copied into the log.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  excluded  text[] := array['secret_ciphertext', 'search_text', 'updated_at', 'raw_payload'];
  old_row   jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_row   jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  row_data  jsonb := coalesce(new_row, old_row);
  diff      jsonb := '{}'::jsonb;
  k         text;
  verb      text;
  actor     uuid := auth.uid();
  org       uuid;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(new_row) loop
      if not (k = any(excluded)) and (old_row -> k) is distinct from (new_row -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', old_row -> k, 'to', new_row -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then
      return new;
    end if;
    verb := 'updated';
    if tg_table_name = 'jobs' and diff ? 'archived_at' then
      verb := case when new_row ->> 'archived_at' is null then 'restored' else 'archived' end;
    end if;
  elsif tg_op = 'INSERT' then
    verb := 'created';
    diff := row_data - excluded;
  else
    verb := 'deleted';
    diff := row_data - excluded;
  end if;

  org := case
    when tg_table_name = 'organisations' then (row_data ->> 'id')::uuid
    else (row_data ->> 'organisation_id')::uuid
  end;

  insert into public.audit_logs (organisation_id, actor_id, actor_type, action, entity_type, entity_id, changes)
  values (
    org,
    actor,
    case when actor is null then 'system' else 'user' end,
    tg_table_name || '.' || verb,
    tg_table_name,
    (row_data ->> 'id')::uuid,
    diff
  );
  return coalesce(new, old);
end;
$$;

create trigger jobs_audit
  after insert or update or delete on public.jobs
  for each row execute function public.audit_row_change();
create trigger job_portal_assignments_audit
  after insert or update or delete on public.job_portal_assignments
  for each row execute function public.audit_row_change();
create trigger routing_rules_audit
  after insert or update or delete on public.routing_rules
  for each row execute function public.audit_row_change();
create trigger portals_audit
  after insert or update or delete on public.portals
  for each row execute function public.audit_row_change();
create trigger integration_settings_audit
  after insert or update or delete on public.integration_settings
  for each row execute function public.audit_row_change();
create trigger profiles_audit
  after update or delete on public.profiles
  for each row execute function public.audit_row_change();
