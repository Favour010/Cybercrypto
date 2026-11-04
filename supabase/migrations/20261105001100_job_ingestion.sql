-- JobSync · 0011 · One ingestion path for manual and external jobs; job editing
--
-- Both entry points end in public.ingest_job(), which creates the job, its
-- contact, attachments, explicit destination assignments and one pending
-- submission task per destination in a single transaction.
--
-- Guarantees enforced here (not only in application code):
--   * duplicates are detected per organisation + source + external job ID
--     (and per form-submission token for manual jobs);
--   * a new job is "ready" when it has destinations, otherwise "received"
--     (awaiting routing) — never "submitted";
--   * destinations are only the portals explicitly listed — never "all";
--   * source-system provenance (source, external ID, original payload) is immutable.
--
-- Custom SQLSTATE codes raised by these functions (surfaced to the app):
--   JSU01 unknown portal          JSU02 portal disabled
--   JSU03 edit conflict (stale)   JSU04 locked by automation
--   JSU05 not permitted           JSU06 job not found
--   JSU07 needs acknowledgement   JSU08 job archived
--   JSU09 invalid attachment path

-- Guards against double-submitted forms / client retries.
alter table public.jobs add column submission_token uuid;
create unique index jobs_org_submission_token_idx
  on public.jobs (organisation_id, submission_token) where submission_token is not null;

-- Provenance is immutable once recorded.
create or replace function public.jobs_guard_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organisation_id is distinct from old.organisation_id
     or new.source_type is distinct from old.source_type
     or new.source is distinct from old.source
     or new.external_job_id is distinct from old.external_job_id
     or new.received_at is distinct from old.received_at
     or new.raw_payload is distinct from old.raw_payload
     or new.submission_token is distinct from old.submission_token then
    raise exception 'job provenance (organisation, source, external ID, original payload) cannot be changed'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger jobs_guard_provenance
  before update on public.jobs
  for each row execute function public.jobs_guard_provenance();

-- Operators may remove attachment files inside their organisation's folder.
create policy job_attachments_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'job-attachments'
    and (storage.foldername(name))[1] = public.current_organisation_id()::text
    and public.has_min_role('operator')
  );

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Resolve slugs to enabled portals; unknown or disabled portals are errors.
create or replace function public.resolve_destination_portals(p_slugs text[])
returns table (portal_id uuid, slug text)
language plpgsql
stable
set search_path = ''
as $$
declare
  s text;
  p record;
begin
  foreach s in array coalesce(p_slugs, '{}') loop
    select id, portals.slug as pslug, is_enabled into p from public.portals where portals.slug = s;
    if not found then
      raise exception 'unknown destination portal: %', s using errcode = 'JSU01';
    end if;
    if not p.is_enabled then
      raise exception 'destination portal is disabled: %', s using errcode = 'JSU02';
    end if;
    portal_id := p.id;
    slug := p.pslug;
    return next;
  end loop;
end;
$$;

-- Add an assignment and its pending submission task (idempotent per portal).
create or replace function public.add_job_destination(
  p_job_id uuid,
  p_organisation_id uuid,
  p_portal_id uuid,
  p_source public.assignment_source,
  p_reason text,
  p_actor uuid
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  assignment uuid;
begin
  insert into public.job_portal_assignments (organisation_id, job_id, portal_id, source, reason, assigned_by)
  values (p_organisation_id, p_job_id, p_portal_id, p_source, p_reason, p_actor)
  on conflict (job_id, portal_id) do nothing
  returning id into assignment;

  if assignment is null then
    return false;
  end if;

  insert into public.submission_tasks (job_id, portal_id, assignment_id)
  values (p_job_id, p_portal_id, assignment);
  return true;
end;
$$;

-- Pre-processing status follows destinations; later states belong to the queue.
create or replace function public.refresh_pre_processing_status(p_job_id uuid)
returns public.job_status
language plpgsql
set search_path = ''
as $$
declare
  current_status public.job_status;
  next_status public.job_status;
begin
  select status into current_status from public.jobs where id = p_job_id;
  if current_status not in ('received', 'ready') then
    return current_status;
  end if;
  next_status := case
    when exists (
      select 1 from public.submission_tasks
      where job_id = p_job_id and status in ('pending', 'retry_scheduled')
    ) then 'ready'::public.job_status
    else 'received'::public.job_status
  end;
  if next_status is distinct from current_status then
    update public.jobs set status = next_status where id = p_job_id;
  end if;
  return next_status;
end;
$$;

create or replace function public.insert_job_attachments(p_job_id uuid, p_attachments jsonb, p_actor uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.job_attachments
    (job_id, file_name, content_type, size_bytes, storage_bucket, storage_path, source_url, checksum_sha256, uploaded_by)
  select
    p_job_id,
    a ->> 'file_name',
    coalesce(a ->> 'content_type', 'application/octet-stream'),
    (a ->> 'size_bytes')::bigint,
    a ->> 'storage_bucket',
    a ->> 'storage_path',
    a ->> 'source_url',
    a ->> 'checksum_sha256',
    p_actor
  from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) a
$$;

-- ---------------------------------------------------------------------------
-- ingest_job: the single entry point (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.ingest_job(
  p_organisation_id    uuid,
  p_job                jsonb,
  p_contact            jsonb,
  p_destinations       text[],
  p_attachments        jsonb,
  p_assignment_reason  text,
  p_actor              uuid,
  p_raw_payload        jsonb,
  p_submission_token   uuid,
  p_job_id             uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id     uuid;
  existing   record;
  dest       record;
  added      text[] := '{}';
  status_out public.job_status;
begin
  -- Validate destinations before writing anything.
  perform 1 from public.resolve_destination_portals(p_destinations);

  insert into public.jobs (
    id, organisation_id, source_type, source, external_job_id,
    customer_name, service_address, category, priority, description, instructions,
    scheduled_date, scheduled_time, technician, status, raw_payload, created_by, submission_token
  )
  values (
    coalesce(p_job_id, gen_random_uuid()),
    p_organisation_id,
    (p_job ->> 'source_type')::public.job_source_type,
    p_job ->> 'source',
    nullif(p_job ->> 'external_job_id', ''),
    p_job ->> 'customer_name',
    p_job ->> 'service_address',
    p_job ->> 'category',
    coalesce((p_job ->> 'priority')::public.job_priority, 'normal'),
    p_job ->> 'description',
    nullif(p_job ->> 'instructions', ''),
    nullif(p_job ->> 'scheduled_date', '')::date,
    nullif(p_job ->> 'scheduled_time', '')::time,
    nullif(p_job ->> 'technician', ''),
    (case when cardinality(coalesce(p_destinations, '{}')) > 0 then 'ready' else 'received' end)::public.job_status,
    p_raw_payload,
    p_actor,
    p_submission_token
  )
  on conflict do nothing
  returning id into new_id;

  if new_id is null then
    -- Duplicate: report the existing job, change nothing.
    select j.id, j.reference, j.status, j.raw_payload, j.source_type into existing
    from public.jobs j
    where j.organisation_id = p_organisation_id
      and (
        (p_submission_token is not null and j.submission_token = p_submission_token)
        or (
          nullif(p_job ->> 'external_job_id', '') is not null
          and j.source = p_job ->> 'source'
          and j.external_job_id = p_job ->> 'external_job_id'
        )
      )
    limit 1;
    if not found then
      raise exception 'job could not be created' using errcode = 'unique_violation';
    end if;
    return jsonb_build_object(
      'created', false,
      'job_id', existing.id,
      'reference', existing.reference,
      'status', existing.status,
      'payload_matches', existing.raw_payload is not distinct from p_raw_payload
    );
  end if;

  if p_contact is not null and jsonb_typeof(p_contact) = 'object' and coalesce(p_contact ->> 'name', '') <> '' then
    insert into public.job_contacts (job_id, name, email, phone, is_primary)
    values (new_id, p_contact ->> 'name', nullif(p_contact ->> 'email', ''), nullif(p_contact ->> 'phone', ''), true);
  end if;

  perform public.insert_job_attachments(new_id, p_attachments, p_actor);

  for dest in select * from public.resolve_destination_portals(p_destinations) loop
    if public.add_job_destination(new_id, p_organisation_id, dest.portal_id, 'explicit', p_assignment_reason, p_actor) then
      added := added || dest.slug;
    end if;
  end loop;

  select j.status into status_out from public.jobs j where j.id = new_id;

  return jsonb_build_object(
    'created', true,
    'job_id', new_id,
    'reference', (select reference from public.jobs where id = new_id),
    'status', status_out,
    'destinations', to_jsonb(added)
  );
end;
$$;

revoke all on function public.ingest_job(uuid, jsonb, jsonb, text[], jsonb, text, uuid, jsonb, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ingest_job(uuid, jsonb, jsonb, text[], jsonb, text, uuid, jsonb, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- create_manual_job: Create Job form (signed-in operators)
-- ---------------------------------------------------------------------------
create or replace function public.create_manual_job(
  p_job               jsonb,
  p_contact           jsonb,
  p_destinations      text[],
  p_attachments       jsonb,
  p_submission_token  uuid,
  p_job_id            uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := public.current_organisation_id();
  a jsonb;
begin
  if org is null or not public.has_min_role('operator') then
    raise exception 'only operators and admins can create jobs' using errcode = 'JSU05';
  end if;
  if p_submission_token is null or p_job_id is null then
    raise exception 'submission token and job id are required' using errcode = 'invalid_parameter_value';
  end if;

  -- Uploaded files must sit in this organisation's folder for this job.
  for a in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    if a ->> 'storage_bucket' is distinct from 'job-attachments'
       or left(a ->> 'storage_path', 74) is distinct from (org::text || '/' || p_job_id::text || '/')
       or a ->> 'source_url' is not null then
      raise exception 'invalid attachment path' using errcode = 'JSU09';
    end if;
  end loop;

  -- The organisation, creator and provenance come from the session, not the client.
  return public.ingest_job(
    org,
    (p_job - 'source_type' - 'source' - 'external_job_id')
      || jsonb_build_object('source_type', 'manual', 'source', 'manual'),
    p_contact,
    p_destinations,
    p_attachments,
    'Selected on the Create Job form',
    auth.uid(),
    null,
    p_submission_token,
    p_job_id
  );
end;
$$;

revoke all on function public.create_manual_job(jsonb, jsonb, text[], jsonb, uuid, uuid) from public, anon;
grant execute on function public.create_manual_job(jsonb, jsonb, text[], jsonb, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- update_job: Edit Job form (signed-in operators)
-- ---------------------------------------------------------------------------
-- Editing never creates a second submission for a portal and never resets a
-- finished task. Rules:
--   * blocked while any portal submission is processing (JSU04);
--   * if any portal already has the job ("submitted"), content changes need
--     explicit acknowledgement (JSU07) and are NOT re-sent to that portal;
--   * a destination can be removed only if its task was never attempted;
--   * newly added destinations get one new pending task each;
--   * optimistic concurrency on jobs.updated_at (JSU03).
create or replace function public.update_job(
  p_job_id                 uuid,
  p_expected_updated_at    timestamptz,
  p_fields                 jsonb,
  p_contact                jsonb,
  p_add_destinations       text[],
  p_remove_destinations    text[],
  p_add_attachments        jsonb,
  p_remove_attachment_ids  uuid[],
  p_acknowledge_submitted  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org         uuid := public.current_organisation_id();
  actor       uuid := auth.uid();
  j           public.jobs%rowtype;
  dest        record;
  s           text;
  t           record;
  a           jsonb;
  submitted   integer;
  changed     boolean;
  removed     text[] := '{}';
  new_status  public.job_status;
  touched     timestamptz;
begin
  if org is null or not public.has_min_role('operator') then
    raise exception 'only operators and admins can edit jobs' using errcode = 'JSU05';
  end if;

  select * into j from public.jobs where id = p_job_id and organisation_id = org for update;
  if not found then
    raise exception 'job not found' using errcode = 'JSU06';
  end if;
  if j.archived_at is not null then
    raise exception 'archived jobs cannot be edited; restore it first' using errcode = 'JSU08';
  end if;
  if date_trunc('milliseconds', j.updated_at) is distinct from date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'this job was changed by someone else; reload and try again' using errcode = 'JSU03';
  end if;
  if exists (select 1 from public.submission_tasks where job_id = p_job_id and status = 'processing') then
    raise exception 'a portal submission for this job is in progress' using errcode = 'JSU04';
  end if;

  changed :=
       (p_fields ? 'customer_name' and p_fields ->> 'customer_name' is distinct from j.customer_name)
    or (p_fields ? 'service_address' and p_fields ->> 'service_address' is distinct from j.service_address)
    or (p_fields ? 'category' and p_fields ->> 'category' is distinct from j.category)
    or (p_fields ? 'priority' and (p_fields ->> 'priority')::public.job_priority is distinct from j.priority)
    or (p_fields ? 'description' and p_fields ->> 'description' is distinct from j.description)
    or (p_fields ? 'instructions' and nullif(p_fields ->> 'instructions', '') is distinct from j.instructions)
    or (p_fields ? 'scheduled_date' and nullif(p_fields ->> 'scheduled_date', '')::date is distinct from j.scheduled_date)
    or (p_fields ? 'scheduled_time' and nullif(p_fields ->> 'scheduled_time', '')::time is distinct from j.scheduled_time)
    or (p_fields ? 'technician' and nullif(p_fields ->> 'technician', '') is distinct from j.technician);

  select count(*) into submitted from public.submission_tasks where job_id = p_job_id and status = 'submitted';
  if submitted > 0 and changed and not coalesce(p_acknowledge_submitted, false) then
    raise exception '% portal(s) already received this job; confirm that edits will not be re-sent', submitted
      using errcode = 'JSU07';
  end if;

  if changed then
    update public.jobs set
      customer_name   = case when p_fields ? 'customer_name' then p_fields ->> 'customer_name' else customer_name end,
      service_address = case when p_fields ? 'service_address' then p_fields ->> 'service_address' else service_address end,
      category        = case when p_fields ? 'category' then p_fields ->> 'category' else category end,
      priority        = case when p_fields ? 'priority' then (p_fields ->> 'priority')::public.job_priority else priority end,
      description     = case when p_fields ? 'description' then p_fields ->> 'description' else description end,
      instructions    = case when p_fields ? 'instructions' then nullif(p_fields ->> 'instructions', '') else instructions end,
      scheduled_date  = case when p_fields ? 'scheduled_date' then nullif(p_fields ->> 'scheduled_date', '')::date else scheduled_date end,
      scheduled_time  = case when p_fields ? 'scheduled_time' then nullif(p_fields ->> 'scheduled_time', '')::time else scheduled_time end,
      technician      = case when p_fields ? 'technician' then nullif(p_fields ->> 'technician', '') else technician end
    where id = p_job_id;
  end if;

  -- Primary contact: object = upsert, JSON null = remove, SQL NULL = unchanged.
  if p_contact is not null then
    if jsonb_typeof(p_contact) = 'null' or coalesce(p_contact ->> 'name', '') = '' then
      delete from public.job_contacts where job_id = p_job_id and is_primary;
    elsif exists (select 1 from public.job_contacts where job_id = p_job_id and is_primary) then
      update public.job_contacts
      set name = p_contact ->> 'name', email = nullif(p_contact ->> 'email', ''), phone = nullif(p_contact ->> 'phone', '')
      where job_id = p_job_id and is_primary;
    else
      insert into public.job_contacts (job_id, name, email, phone, is_primary)
      values (p_job_id, p_contact ->> 'name', nullif(p_contact ->> 'email', ''), nullif(p_contact ->> 'phone', ''), true);
    end if;
  end if;

  -- Remove destinations that were never attempted.
  foreach s in array coalesce(p_remove_destinations, '{}') loop
    select st.id, st.status, st.attempt_count, st.assignment_id into t
    from public.submission_tasks st
    where st.job_id = p_job_id and st.portal_slug = s;
    if found then
      if t.status <> 'pending' or t.attempt_count > 0 then
        raise exception 'the % submission has already been attempted and cannot be removed', s using errcode = 'JSU04';
      end if;
      delete from public.submission_tasks where id = t.id;
      delete from public.job_portal_assignments where id = t.assignment_id;
    else
      delete from public.job_portal_assignments a2
      using public.portals p
      where a2.job_id = p_job_id and a2.portal_id = p.id and p.slug = s;
    end if;
  end loop;

  -- Add destinations (existing ones are left untouched: never a second task).
  for dest in select * from public.resolve_destination_portals(p_add_destinations) loop
    perform public.add_job_destination(
      p_job_id, org, dest.portal_id, 'manual_override', 'Added by an operator when editing the job', actor
    );
  end loop;

  -- Attachments.
  for a in select * from jsonb_array_elements(coalesce(p_add_attachments, '[]'::jsonb)) loop
    if a ->> 'storage_bucket' is distinct from 'job-attachments'
       or left(a ->> 'storage_path', 74) is distinct from (org::text || '/' || p_job_id::text || '/')
       or a ->> 'source_url' is not null then
      raise exception 'invalid attachment path' using errcode = 'JSU09';
    end if;
  end loop;
  perform public.insert_job_attachments(p_job_id, p_add_attachments, actor);

  with gone as (
    delete from public.job_attachments
    where job_id = p_job_id and id = any(coalesce(p_remove_attachment_ids, '{}'))
    returning storage_path
  )
  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}') into removed from gone;

  new_status := public.refresh_pre_processing_status(p_job_id);

  -- Any edit (including contacts, destinations, attachments) moves the version on.
  update public.jobs set updated_at = clock_timestamp() where id = p_job_id returning updated_at into touched;

  return jsonb_build_object(
    'job_id', p_job_id,
    'status', new_status,
    'updated_at', touched,
    'removed_storage_paths', to_jsonb(removed),
    'already_submitted_portals', submitted
  );
end;
$$;

revoke all on function public.update_job(uuid, timestamptz, jsonb, jsonb, text[], text[], jsonb, uuid[], boolean)
  from public, anon;
grant execute on function public.update_job(uuid, timestamptz, jsonb, jsonb, text[], text[], jsonb, uuid[], boolean)
  to authenticated, service_role;

-- Internal helpers are not callable through the API.
revoke all on function public.resolve_destination_portals(text[]) from public, anon, authenticated;
revoke all on function public.add_job_destination(uuid, uuid, uuid, public.assignment_source, text, uuid)
  from public, anon, authenticated;
revoke all on function public.refresh_pre_processing_status(uuid) from public, anon, authenticated;
revoke all on function public.insert_job_attachments(uuid, jsonb, uuid) from public, anon, authenticated;
