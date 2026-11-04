-- JobSync · 0010 · Intake API keys and database-backed rate limiting

-- Machine credentials for POST /api/v1/jobs/intake. Each key belongs to one
-- organisation (which decides where jobs land — never the payload) and may
-- only submit jobs for its listed source systems. Only a SHA-256 hash of the
-- key is stored; the plaintext is shown once, at creation.
create table public.api_keys (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  name             text not null check (length(trim(name)) between 1 and 100),
  -- Public lookup part of the key: jsk_<prefix>_<secret>.
  key_prefix       text not null unique check (key_prefix ~ '^[a-z0-9]{10}$'),
  key_hash         text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  allowed_sources  text[] not null check (
                     cardinality(allowed_sources) between 1 and 20
                     and array_position(allowed_sources, null) is null
                   ),
  scopes           text[] not null default array['jobs:intake'],
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid references public.profiles (id) on delete set null,
  constraint api_keys_revocation_consistency check (revoked_by is null or revoked_at is not null)
);

create index api_keys_org_idx on public.api_keys (organisation_id, created_at desc);

alter table public.api_keys enable row level security;

-- Admins manage keys in their organisation. The hash column is never readable
-- through the API; the server verifies keys with the service role.
revoke all on public.api_keys from anon, authenticated;
grant select (
  id, organisation_id, name, key_prefix, allowed_sources, scopes, created_by,
  created_at, last_used_at, expires_at, revoked_at, revoked_by
) on public.api_keys to authenticated;
grant insert (organisation_id, name, key_prefix, key_hash, allowed_sources, scopes, created_by, expires_at)
  on public.api_keys to authenticated;
grant update (name, revoked_at, revoked_by) on public.api_keys to authenticated;
grant all on public.api_keys to service_role;

create policy api_keys_select_admin on public.api_keys
  for select to authenticated
  using (organisation_id = public.current_organisation_id() and public.has_min_role('admin'));

create policy api_keys_insert_admin on public.api_keys
  for insert to authenticated
  with check (
    organisation_id = public.current_organisation_id()
    and public.has_min_role('admin')
    and created_by = auth.uid()
  );

create policy api_keys_update_admin on public.api_keys
  for update to authenticated
  using (organisation_id = public.current_organisation_id() and public.has_min_role('admin'))
  with check (organisation_id = public.current_organisation_id());

-- Never copy key hashes into the audit log (adds key_hash to the exclusions;
-- otherwise identical to the 0005 definition).
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  excluded  text[] := array['secret_ciphertext', 'key_hash', 'search_text', 'updated_at', 'raw_payload'];
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
    elsif tg_table_name = 'api_keys' and diff ? 'revoked_at' and new_row ->> 'revoked_at' is not null then
      verb := 'revoked';
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

create trigger api_keys_audit
  after insert or update or delete on public.api_keys
  for each row execute function public.audit_row_change();

-- Fixed-window rate limiting shared by every server instance. One row per
-- bucket (e.g. "intake:key:<id>"), reset in place when its window rolls over,
-- so the table does not grow over time.
create table public.rate_limit_counters (
  bucket        text primary key check (length(bucket) <= 200),
  window_start  timestamptz not null,
  hits          integer not null check (hits >= 0)
);

alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from anon, authenticated;
grant all on public.rate_limit_counters to service_role;

create or replace function public.consume_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, hits integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n  integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.rate_limit_counters as c (bucket, window_start, hits)
  values (p_bucket, ws, 1)
  on conflict (bucket) do update
    set hits = case when c.window_start = excluded.window_start then c.hits + 1 else 1 end,
        window_start = excluded.window_start
  returning c.hits into n;

  return query select
    n <= p_limit,
    n,
    greatest(1, ceil(extract(epoch from (ws + make_interval(secs => p_window_seconds) - now())))::integer);
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
