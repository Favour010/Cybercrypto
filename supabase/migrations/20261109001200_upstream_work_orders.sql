-- JobSync · 0012 · Upstream work orders and batches
--
-- Agreed flow:
--   upstream_work_orders (this file) → n8n → POST /api/v1/jobs/intake
--     → JobSync validation, deduplication, routing and queue → Playwright → portals
--
-- These tables are the central work-order store that n8n reads from. They are
-- deliberately separate from JobSync's own `jobs` table: n8n never writes to
-- `jobs` (or any other JobSync table). The intake API is the only way in, so
-- every work order passes the same validation, duplicate rules and routing as
-- any other source.
--
-- n8n connects as a dedicated database role, `jobsync_upstream_n8n`, that can
-- only read these two tables and call four functions:
--   upstream_enqueue_work_orders  add a batch of work orders (idempotent)
--   upstream_claim_work_orders    lease due records for delivery (SKIP LOCKED)
--   upstream_report_delivery      record the JobSync API response
-- and operators (service role / SQL editor) may call:
--   upstream_requeue_work_orders  send failed records round again
--
-- Retry safety: each record has a stable id and the same natural key JobSync
-- uses (organisation + source + external_job_id). A record whose delivery
-- outcome was lost is re-sent after its lease expires; JobSync answers
-- `200 duplicate` with the existing job, so a retry never creates a second job.
-- Additive only: no existing table, function or policy is changed.

create type public.upstream_delivery_status as enum ('pending', 'in_progress', 'delivered', 'failed');

-- ---------------------------------------------------------------------------
-- Batches
-- ---------------------------------------------------------------------------
create table public.upstream_batches (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  -- Caller-chosen, stable batch name, e.g. "aroflo-2026-11-09-0001". Re-sending
  -- the same reference adds to (or re-confirms) the same batch.
  batch_reference    text not null check (batch_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  source             text not null check (source ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
  label              text check (label is null or length(label) <= 200),
  -- Maintained by trigger from upstream_work_orders; never written directly.
  total_count        integer not null default 0,
  pending_count      integer not null default 0,
  in_progress_count  integer not null default 0,
  delivered_count    integer not null default 0,
  failed_count       integer not null default 0,
  status             text generated always as (
                       case
                         when total_count = 0 then 'empty'
                         when pending_count + in_progress_count > 0 then 'open'
                         when failed_count > 0 then 'completed_with_failures'
                         else 'completed'
                       end
                     ) stored,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint upstream_batches_org_reference_key unique (organisation_id, batch_reference),
  -- Target for the work-order foreign key: a record's organisation and source
  -- must be its batch's.
  constraint upstream_batches_id_org_source_key unique (id, organisation_id, source),
  constraint upstream_batches_counts_non_negative
    check (least(total_count, pending_count, in_progress_count, delivered_count, failed_count) >= 0),
  constraint upstream_batches_counts_add_up
    check (total_count = pending_count + in_progress_count + delivered_count + failed_count),
  -- Batches are meant to hold about 100 records; 1000 is a hard ceiling.
  constraint upstream_batches_max_size check (total_count <= 1000)
);

create index upstream_batches_org_created_idx on public.upstream_batches (organisation_id, created_at desc);

create trigger upstream_batches_set_updated_at
  before update on public.upstream_batches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Work orders
-- ---------------------------------------------------------------------------
create table public.upstream_work_orders (
  -- Stable unique identifier of the upstream record.
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  batch_id          uuid not null,
  source            text not null,
  -- The source system's job ID. With organisation and source it is the same
  -- natural key JobSync deduplicates on.
  external_job_id   text not null check (
                      length(external_job_id) between 1 and 120
                      and external_job_id = btrim(external_job_id)
                      and external_job_id !~ '[[:cntrl:]]'
                    ),
  -- Exactly the JSON body sent to POST /api/v1/jobs/intake. JobSync validates
  -- it; this table only guarantees it carries the record's own key.
  payload           jsonb not null check (
                      jsonb_typeof(payload) = 'object'
                      -- The intake API accepts bodies up to 1 MiB.
                      and octet_length(payload::text) <= 1048576
                      and payload ->> 'source' = source
                      and payload ->> 'external_job_id' = external_job_id
                    ),
  delivery_status   public.upstream_delivery_status not null default 'pending',
  attempt_count     integer not null default 0 check (attempt_count >= 0),
  max_attempts      integer not null default 5 check (max_attempts between 1 and 20),
  next_attempt_at   timestamptz not null default now(),
  -- Lease held by one n8n execution while it delivers the record.
  claim_token       uuid,
  claimed_by        text check (claimed_by is null or length(claimed_by) between 1 and 100),
  claimed_at        timestamptz,
  lease_expires_at  timestamptz,
  -- Outcome reported from the JobSync API response.
  delivered_at      timestamptz,
  jobsync_job_id    uuid references public.jobs (id) on delete set null,
  jobsync_reference text,
  last_http_status  integer check (last_http_status is null or last_http_status between 100 and 599),
  last_error_code   text check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  last_error        text check (last_error is null or length(last_error) <= 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (batch_id, organisation_id, source)
    references public.upstream_batches (id, organisation_id, source) on delete restrict,
  -- One upstream record per organisation + source + external job ID.
  constraint upstream_work_orders_org_source_external_key unique (organisation_id, source, external_job_id),
  constraint upstream_work_orders_attempts_within_limit check (attempt_count <= max_attempts),
  constraint upstream_work_orders_lease_consistency check (
    (delivery_status = 'in_progress') =
    (claim_token is not null and claimed_at is not null and lease_expires_at is not null)
  ),
  constraint upstream_work_orders_delivered_consistency check (
    delivery_status <> 'delivered' or (delivered_at is not null and jobsync_reference is not null)
  ),
  constraint upstream_work_orders_failed_has_reason check (
    delivery_status <> 'failed' or last_error_code is not null
  )
);

create index upstream_work_orders_due_idx on public.upstream_work_orders (next_attempt_at, created_at)
  where delivery_status = 'pending';
create index upstream_work_orders_lease_idx on public.upstream_work_orders (lease_expires_at)
  where delivery_status = 'in_progress';
create index upstream_work_orders_batch_status_idx on public.upstream_work_orders (batch_id, delivery_status);
create index upstream_work_orders_jobsync_job_idx on public.upstream_work_orders (jobsync_job_id)
  where jobsync_job_id is not null;

create trigger upstream_work_orders_set_updated_at
  before update on public.upstream_work_orders
  for each row execute function public.set_updated_at();

-- Identity is immutable; a delivered record is final; the payload can only be
-- corrected while the record is not being (or has not been) delivered.
create or replace function public.upstream_work_orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.organisation_id is distinct from old.organisation_id
     or new.batch_id is distinct from old.batch_id
     or new.source is distinct from old.source
     or new.external_job_id is distinct from old.external_job_id then
    raise exception 'the identity of upstream work order % is immutable', old.id
      using errcode = 'check_violation';
  end if;
  if old.delivery_status = 'delivered' and (
       new.delivery_status <> 'delivered'
    or new.payload is distinct from old.payload
    or new.delivered_at is distinct from old.delivered_at
    or new.jobsync_reference is distinct from old.jobsync_reference
    -- The only allowed change: the job link cleared by ON DELETE SET NULL.
    or (new.jobsync_job_id is distinct from old.jobsync_job_id and new.jobsync_job_id is not null)
  ) then
    raise exception 'upstream work order % was delivered to JobSync and cannot be changed', old.id
      using errcode = 'check_violation';
  end if;
  if new.payload is distinct from old.payload and old.delivery_status not in ('pending', 'failed') then
    raise exception 'the payload of upstream work order % cannot change while it is being delivered', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger upstream_work_orders_guard
  before update on public.upstream_work_orders
  for each row execute function public.upstream_work_orders_guard();

-- Batch counters: applied as deltas, so concurrent updates add up correctly
-- (each UPDATE re-reads the latest batch row under its row lock).
create or replace function public.upstream_work_orders_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d_total int := 0;
  d_pending int := 0;
  d_in_progress int := 0;
  d_delivered int := 0;
  d_failed int := 0;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    case old.delivery_status
      when 'pending' then d_pending := d_pending - 1;
      when 'in_progress' then d_in_progress := d_in_progress - 1;
      when 'delivered' then d_delivered := d_delivered - 1;
      when 'failed' then d_failed := d_failed - 1;
    end case;
    if tg_op = 'DELETE' then d_total := -1; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    case new.delivery_status
      when 'pending' then d_pending := d_pending + 1;
      when 'in_progress' then d_in_progress := d_in_progress + 1;
      when 'delivered' then d_delivered := d_delivered + 1;
      when 'failed' then d_failed := d_failed + 1;
    end case;
    if tg_op = 'INSERT' then d_total := 1; end if;
  end if;

  update public.upstream_batches b
     set total_count       = b.total_count + d_total,
         pending_count     = b.pending_count + d_pending,
         in_progress_count = b.in_progress_count + d_in_progress,
         delivered_count   = b.delivered_count + d_delivered,
         failed_count      = b.failed_count + d_failed,
         completed_at      = case
                               when b.total_count + d_total > 0
                                and (b.pending_count + d_pending) + (b.in_progress_count + d_in_progress) = 0
                               then coalesce(b.completed_at, now())
                               else null
                             end
   where b.id = coalesce(new.batch_id, old.batch_id);
  return null;
end;
$$;

create trigger upstream_work_orders_count_insert
  after insert on public.upstream_work_orders
  for each row execute function public.upstream_work_orders_count();

create trigger upstream_work_orders_count_update
  after update of delivery_status on public.upstream_work_orders
  for each row when (old.delivery_status is distinct from new.delivery_status)
  execute function public.upstream_work_orders_count();

create trigger upstream_work_orders_count_delete
  after delete on public.upstream_work_orders
  for each row execute function public.upstream_work_orders_count();

-- ---------------------------------------------------------------------------
-- n8n database role (no login; a login role is granted membership later)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'jobsync_upstream_n8n') then
    create role jobsync_upstream_n8n nologin nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
exception
  when duplicate_object or unique_violation then null; -- created concurrently by another session
end
$$;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Normalise an API error code (e.g. "validation_failed") to UPPER_SNAKE_CASE.
create or replace function public.upstream_error_code(raw text, fallback text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when upper(regexp_replace(coalesce(raw, ''), '[^A-Za-z0-9_]', '_', 'g')) ~ '^[A-Z][A-Z0-9_]{2,60}$'
      then upper(regexp_replace(raw, '[^A-Za-z0-9_]', '_', 'g'))
    else fallback
  end
$$;

-- Add up to 500 work orders to a batch, creating the batch if needed.
-- Idempotent: a record whose organisation + source + external_job_id already
-- exists is not inserted again; it is reported as a duplicate (same payload)
-- or a conflict (different payload, nothing changed).
create or replace function public.upstream_enqueue_work_orders(
  p_batch_reference  text,
  p_source           text,
  p_work_orders      jsonb,
  p_label            text default null,
  p_organisation_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org         uuid := p_organisation_id;
  src         text := lower(btrim(coalesce(p_source, '')));
  batch       public.upstream_batches%rowtype;
  item        jsonb;
  ext         text;
  body        jsonb;
  new_id      uuid;
  existing    public.upstream_work_orders%rowtype;
  n           int := 0;
  inserted    int := 0;
  duplicates  jsonb := '[]'::jsonb;
  conflicts   jsonb := '[]'::jsonb;
begin
  if org is null then
    select o.id into org from public.organisations o where o.slug = 'default';
  end if;
  if org is null or not exists (select 1 from public.organisations o where o.id = org) then
    raise exception 'unknown organisation' using errcode = 'foreign_key_violation';
  end if;
  if jsonb_typeof(p_work_orders) is distinct from 'array'
     or jsonb_array_length(p_work_orders) not between 1 and 500 then
    raise exception 'p_work_orders must be a JSON array of 1 to 500 work orders' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.upstream_batches (organisation_id, batch_reference, source, label)
  values (org, p_batch_reference, src, p_label)
  on conflict (organisation_id, batch_reference) do nothing;

  select * into batch from public.upstream_batches b
   where b.organisation_id = org and b.batch_reference = p_batch_reference
   for update;
  if batch.source <> src then
    raise exception 'batch % belongs to source "%", not "%"', p_batch_reference, batch.source, src
      using errcode = 'invalid_parameter_value';
  end if;

  for item in select value from jsonb_array_elements(p_work_orders) loop
    n := n + 1;
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'work order % is not a JSON object', n using errcode = 'invalid_parameter_value';
    end if;
    ext := btrim(coalesce(item ->> 'external_job_id', ''));
    if length(ext) not between 1 and 120 or ext ~ '[[:cntrl:]]' then
      raise exception 'work order % needs an external_job_id of 1 to 120 characters', n
        using errcode = 'invalid_parameter_value';
    end if;
    if item ? 'source' and lower(btrim(item ->> 'source')) <> src then
      raise exception 'work order % has source "%", but the batch is for "%"', n, item ->> 'source', src
        using errcode = 'invalid_parameter_value';
    end if;
    body := item || jsonb_build_object('source', src, 'external_job_id', ext);

    insert into public.upstream_work_orders (organisation_id, batch_id, source, external_job_id, payload)
    values (org, batch.id, src, ext, body)
    on conflict (organisation_id, source, external_job_id) do nothing
    returning id into new_id;

    if new_id is not null then
      inserted := inserted + 1;
    else
      select * into existing from public.upstream_work_orders w
       where w.organisation_id = org and w.source = src and w.external_job_id = ext;
      if existing.payload = body then
        duplicates := duplicates || jsonb_build_object(
          'external_job_id', ext, 'work_order_id', existing.id, 'batch_id', existing.batch_id,
          'delivery_status', existing.delivery_status);
      else
        conflicts := conflicts || jsonb_build_object(
          'external_job_id', ext, 'work_order_id', existing.id, 'batch_id', existing.batch_id,
          'delivery_status', existing.delivery_status,
          'message', 'A work order with this source and external_job_id already exists with different content. Nothing was changed.');
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'batch_id', batch.id,
    'batch_reference', batch.batch_reference,
    'received', n,
    'inserted', inserted,
    'duplicates', duplicates,
    'conflicts', conflicts
  );
end;
$$;

-- Lease up to p_limit due work orders to one n8n execution. A record is due
-- when it is pending and its retry time has come, or when a previous lease
-- expired without a reported outcome. Concurrent callers never receive the
-- same record (FOR UPDATE SKIP LOCKED). Each claim counts as one attempt.
create or replace function public.upstream_claim_work_orders(
  p_worker         text,
  p_limit          integer default 10,
  p_lease_seconds  integer default 300,
  p_batch_id       uuid default null
)
returns table (
  work_order_id    uuid,
  claim_token      uuid,
  organisation_id  uuid,
  batch_id         uuid,
  source           text,
  external_job_id  text,
  attempt          integer,
  payload          jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_worker is null or length(btrim(p_worker)) not between 1 and 100 then
    raise exception 'p_worker must be 1 to 100 characters' using errcode = 'invalid_parameter_value';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'p_limit must be between 1 and 100' using errcode = 'invalid_parameter_value';
  end if;
  if p_lease_seconds not between 30 and 3600 then
    raise exception 'p_lease_seconds must be between 30 and 3600' using errcode = 'invalid_parameter_value';
  end if;

  -- Expired leases with no attempts left: stop here, a person decides.
  update public.upstream_work_orders w
     set delivery_status = 'failed',
         claim_token = null, claimed_by = null, claimed_at = null, lease_expires_at = null,
         last_error_code = 'LEASE_EXPIRED',
         last_error = 'No delivery result was reported before the claim expired, and the attempt limit is reached. '
                   || 'Requeue to try again: if JobSync already received it, it answers 200 duplicate.'
   where w.delivery_status = 'in_progress'
     and w.lease_expires_at < now()
     and w.attempt_count >= w.max_attempts
     and (p_batch_id is null or w.batch_id = p_batch_id);

  -- Pending records whose attempt limit was lowered below the attempts used.
  update public.upstream_work_orders w
     set delivery_status = 'failed',
         last_error_code = 'ATTEMPTS_EXHAUSTED',
         last_error = coalesce(w.last_error, 'The attempt limit is reached.')
   where w.delivery_status = 'pending'
     and w.attempt_count >= w.max_attempts
     and (p_batch_id is null or w.batch_id = p_batch_id);

  return query
  with picked as (
    select w.id
      from public.upstream_work_orders w
     where (p_batch_id is null or w.batch_id = p_batch_id)
       and w.attempt_count < w.max_attempts
       and (
             (w.delivery_status = 'pending' and w.next_attempt_at <= now())
          or (w.delivery_status = 'in_progress' and w.lease_expires_at < now())
       )
     order by w.next_attempt_at, w.created_at
     limit p_limit
     for update skip locked
  )
  update public.upstream_work_orders w
     set delivery_status  = 'in_progress',
         attempt_count    = w.attempt_count + 1,
         claim_token      = gen_random_uuid(),
         claimed_by       = btrim(p_worker),
         claimed_at       = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from picked
   where w.id = picked.id
  returning w.id, w.claim_token, w.organisation_id, w.batch_id, w.source, w.external_job_id,
            w.attempt_count, w.payload;
end;
$$;

-- Record the JobSync API response for a claimed work order.
--   201 created / 200 duplicate (with the job) → delivered
--   408, 425, 429, 5xx, or no response (p_http_status null) → retried with backoff
--   any other status (400, 401, 403, 409, 413, 415, 422, …) → failed, needs a person
-- Idempotent: reporting again for a delivered record changes nothing; a report
-- from an expired or superseded claim is ignored.
create or replace function public.upstream_report_delivery(
  p_work_order_id        uuid,
  p_claim_token          uuid,
  p_http_status          integer,
  p_response             jsonb default null,
  p_error_message        text default null,
  p_retry_after_seconds  integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w          public.upstream_work_orders%rowtype;
  job_text   text := p_response ->> 'job_id';
  job_ref    text;
  job_id     uuid;
  err_code   text;
  err_text   text;
  wait_s     integer;
begin
  if p_http_status is not null and p_http_status not between 100 and 599 then
    raise exception 'p_http_status must be an HTTP status code or null' using errcode = 'invalid_parameter_value';
  end if;

  select * into w from public.upstream_work_orders x where x.id = p_work_order_id for update;
  if not found then
    raise exception 'upstream work order % not found', p_work_order_id using errcode = 'no_data_found';
  end if;

  if w.delivery_status = 'delivered' then
    return jsonb_build_object('outcome', 'already_delivered', 'delivery_status', w.delivery_status,
                              'jobsync_job_id', w.jobsync_job_id, 'jobsync_reference', w.jobsync_reference);
  end if;
  if w.delivery_status <> 'in_progress' or w.claim_token is distinct from p_claim_token then
    return jsonb_build_object('outcome', 'stale_claim', 'delivery_status', w.delivery_status,
                              'message', 'This claim is no longer current. Nothing was changed.');
  end if;

  if job_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    job_id := job_text::uuid;
    -- Only trust a job that really is this record's job in JobSync.
    select j.reference into job_ref from public.jobs j
     where j.id = job_id and j.organisation_id = w.organisation_id
       and j.source = w.source and j.external_job_id = w.external_job_id;
    if job_ref is null then job_id := null; end if;
  end if;

  -- Delivered.
  if p_http_status in (200, 201) and job_id is not null then
    update public.upstream_work_orders x
       set delivery_status = 'delivered', delivered_at = now(),
           jobsync_job_id = job_id, jobsync_reference = job_ref, last_http_status = p_http_status,
           last_error_code = null, last_error = null,
           claim_token = null, claimed_by = null, claimed_at = null, lease_expires_at = null
     where x.id = w.id;
    return jsonb_build_object('outcome', 'delivered', 'delivery_status', 'delivered',
                              'jobsync_job_id', job_id, 'jobsync_reference', job_ref);
  end if;

  err_text := left(coalesce(nullif(p_error_message, ''), p_response #>> '{error,message}',
                            case when p_http_status is null then 'No response from the JobSync API.' end,
                            'JobSync API returned HTTP ' || p_http_status || '.'), 2000);
  err_code := case
    when p_http_status in (200, 201) then 'JOBSYNC_RESPONSE_MISMATCH'
    when p_http_status is null then 'NO_RESPONSE'
    else public.upstream_error_code(p_response #>> '{error,code}', 'HTTP_' || p_http_status)
  end;
  if p_http_status in (200, 201) then
    err_text := 'The API accepted the request but its job is not this record''s job in JobSync '
             || '(check that n8n uses the API key of the same organisation).';
  end if;

  -- Transient: try again later, if attempts remain.
  if (p_http_status is null or p_http_status in (408, 425, 429) or p_http_status >= 500)
     and w.attempt_count < w.max_attempts then
    wait_s := least(3600, greatest(30 * (2 ^ (w.attempt_count - 1))::int, coalesce(p_retry_after_seconds, 0)));
    update public.upstream_work_orders x
       set delivery_status = 'pending', next_attempt_at = now() + make_interval(secs => wait_s),
           last_http_status = p_http_status, last_error_code = err_code, last_error = err_text,
           claim_token = null, claimed_by = null, claimed_at = null, lease_expires_at = null
     where x.id = w.id;
    return jsonb_build_object('outcome', 'retry_scheduled', 'delivery_status', 'pending',
                              'retry_in_seconds', wait_s, 'attempt', w.attempt_count, 'max_attempts', w.max_attempts);
  end if;

  -- Permanent (or out of attempts): a person must look at it.
  update public.upstream_work_orders x
     set delivery_status = 'failed', last_http_status = p_http_status,
         last_error_code = err_code, last_error = err_text,
         -- A 409 means JobSync holds a different version of this job: keep the link.
         jobsync_job_id = case when p_http_status = 409 then job_id else x.jobsync_job_id end,
         jobsync_reference = case when p_http_status = 409 then job_ref else x.jobsync_reference end,
         claim_token = null, claimed_by = null, claimed_at = null, lease_expires_at = null
   where x.id = w.id;
  return jsonb_build_object('outcome', 'failed', 'delivery_status', 'failed',
                            'error_code', err_code, 'error', err_text);
end;
$$;

-- Operator action: put failed work orders back in the queue with fresh
-- attempts. Pass a batch, a list of ids, or both. Returns how many moved.
create or replace function public.upstream_requeue_work_orders(
  p_batch_id        uuid default null,
  p_work_order_ids  uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved int;
  batch_org uuid;
begin
  if p_batch_id is null and p_work_order_ids is null then
    raise exception 'pass a batch id or a list of work order ids' using errcode = 'invalid_parameter_value';
  end if;
  update public.upstream_work_orders w
     set delivery_status = 'pending', attempt_count = 0, next_attempt_at = now()
   where w.delivery_status = 'failed'
     and (p_batch_id is null or w.batch_id = p_batch_id)
     and (p_work_order_ids is null or w.id = any(p_work_order_ids));
  get diagnostics moved = row_count;
  if moved > 0 then
    select w.organisation_id into batch_org from public.upstream_work_orders w
     where (p_batch_id is null or w.batch_id = p_batch_id)
       and (p_work_order_ids is null or w.id = any(p_work_order_ids))
     limit 1;
    insert into public.audit_logs (organisation_id, actor_id, actor_type, action, entity_type, entity_id, changes)
    values (batch_org, auth.uid(), case when auth.uid() is null then 'system' else 'user' end,
            'upstream_work_orders.requeued', 'upstream_batch', p_batch_id,
            jsonb_build_object('requeued', moved, 'work_order_ids', to_jsonb(p_work_order_ids)));
  end if;
  return moved;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------
alter table public.upstream_batches enable row level security;
alter table public.upstream_work_orders enable row level security;

-- Supabase grants new tables and functions to anon/authenticated by default:
-- take that back explicitly.
revoke all on public.upstream_batches, public.upstream_work_orders from public, anon, authenticated;
grant all on public.upstream_batches, public.upstream_work_orders to service_role;

-- JobSync staff may see the upstream queue of their own organisation (read-only).
grant select on public.upstream_batches, public.upstream_work_orders to authenticated;
create policy upstream_batches_select on public.upstream_batches
  for select to authenticated
  using (organisation_id = public.current_organisation_id() and public.has_min_role('viewer'));
create policy upstream_work_orders_select on public.upstream_work_orders
  for select to authenticated
  using (organisation_id = public.current_organisation_id() and public.has_min_role('viewer'));

-- n8n: read the two upstream tables; every change goes through the functions.
-- It has no privilege at all on JobSync's own tables.
grant usage on schema public to jobsync_upstream_n8n;
grant select on public.upstream_batches, public.upstream_work_orders to jobsync_upstream_n8n;
create policy upstream_batches_select_n8n on public.upstream_batches
  for select to jobsync_upstream_n8n using (true);
create policy upstream_work_orders_select_n8n on public.upstream_work_orders
  for select to jobsync_upstream_n8n using (true);

revoke all on function public.upstream_error_code(text, text) from public, anon, authenticated;
revoke all on function public.upstream_work_orders_guard() from public, anon, authenticated;
revoke all on function public.upstream_work_orders_count() from public, anon, authenticated;

revoke all on function public.upstream_enqueue_work_orders(text, text, jsonb, text, uuid)
  from public, anon, authenticated;
revoke all on function public.upstream_claim_work_orders(text, integer, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.upstream_report_delivery(uuid, uuid, integer, jsonb, text, integer)
  from public, anon, authenticated;
revoke all on function public.upstream_requeue_work_orders(uuid, uuid[])
  from public, anon, authenticated;

grant execute on function public.upstream_enqueue_work_orders(text, text, jsonb, text, uuid)
  to jobsync_upstream_n8n, service_role;
grant execute on function public.upstream_claim_work_orders(text, integer, integer, uuid)
  to jobsync_upstream_n8n, service_role;
grant execute on function public.upstream_report_delivery(uuid, uuid, integer, jsonb, text, integer)
  to jobsync_upstream_n8n, service_role;
grant execute on function public.upstream_requeue_work_orders(uuid, uuid[]) to service_role;
