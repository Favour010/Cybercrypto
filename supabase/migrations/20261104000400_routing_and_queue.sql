-- JobSync · 0004 · Routing rules, portal assignments, submission tasks, executions

-- Configurable routing. A rule matches when ALL of its non-null conditions
-- match; each matching rule assigns its portal. No rule ever means
-- "send to every portal": unmatched jobs go to human review (Phase 4).
create table public.routing_rules (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  name              text not null check (length(trim(name)) between 1 and 120),
  description       text,
  priority          integer not null default 100 check (priority between 0 and 10000),
  is_active         boolean not null default true,
  match_customer    text,
  match_category    text,
  match_priority    public.job_priority,
  match_location    text,
  portal_id         uuid not null references public.portals (id) on delete restrict,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint routing_rules_has_condition check (
    num_nonnulls(match_customer, match_category, match_priority, match_location) > 0
  )
);

create index routing_rules_org_active_idx on public.routing_rules (organisation_id, is_active, priority);

create trigger routing_rules_set_updated_at
  before update on public.routing_rules
  for each row execute function public.set_updated_at();

-- The routing decision for a job: which portals, how, and why.
create table public.job_portal_assignments (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  job_id            uuid not null,
  portal_id         uuid not null references public.portals (id) on delete restrict,
  source            public.assignment_source not null,
  routing_rule_id   uuid references public.routing_rules (id) on delete set null,
  reason            text not null check (length(trim(reason)) between 1 and 500),
  assigned_by       uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  foreign key (job_id, organisation_id) references public.jobs (id, organisation_id) on delete cascade,
  -- One assignment per job and portal.
  constraint job_portal_assignments_job_portal_key unique (job_id, portal_id)
);

create index job_portal_assignments_portal_idx on public.job_portal_assignments (portal_id);
create index job_portal_assignments_org_idx on public.job_portal_assignments (organisation_id);

-- One independent submission task per job→portal assignment.
create table public.submission_tasks (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null,
  job_id                  uuid not null,
  portal_id               uuid not null,
  -- Denormalised for fast per-portal reporting; kept consistent by the
  -- composite foreign key below and filled in by trigger.
  portal_slug             text not null,
  assignment_id           uuid not null unique references public.job_portal_assignments (id) on delete restrict,
  status                  public.task_status not null default 'pending',
  execution_mode          public.execution_mode not null default 'dry_run',
  -- Deterministic per job+portal: the worker passes it to the portal adapter
  -- so a retried attempt can never create a second submission.
  idempotency_key         text not null unique,
  attempt_count           integer not null default 0 check (attempt_count >= 0),
  max_attempts            integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at         timestamptz,
  locked_by               text,
  locked_at               timestamptz,
  started_at              timestamptz,
  completed_at            timestamptz,
  last_error              text,
  confirmation_reference  text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  foreign key (job_id, organisation_id) references public.jobs (id, organisation_id) on delete cascade,
  foreign key (portal_id, portal_slug) references public.portals (id, slug) on delete restrict,
  -- Duplicate portal submissions are impossible: one task per job and portal.
  constraint submission_tasks_job_portal_key unique (job_id, portal_id),
  constraint submission_tasks_attempts_within_limit check (attempt_count <= max_attempts),
  constraint submission_tasks_completed_has_time
    check (status not in ('submitted', 'failed') or completed_at is not null),
  -- A LIVE submission is only recorded as submitted with the portal's reference.
  constraint submission_tasks_live_submitted_has_reference
    check (status <> 'submitted' or execution_mode = 'dry_run' or confirmation_reference is not null)
);

create index submission_tasks_queue_idx on public.submission_tasks (status, next_attempt_at)
  where status in ('pending', 'retry_scheduled');
create index submission_tasks_org_created_idx on public.submission_tasks (organisation_id, created_at desc);
create index submission_tasks_portal_status_idx on public.submission_tasks (portal_slug, status);

create or replace function public.submission_tasks_fill_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organisation_id is null then
    select j.organisation_id into new.organisation_id from public.jobs j where j.id = new.job_id;
  end if;
  if new.portal_slug is null then
    select p.slug into new.portal_slug from public.portals p where p.id = new.portal_id;
  end if;
  if new.idempotency_key is null then
    new.idempotency_key := new.job_id::text || ':' || new.portal_slug;
  end if;
  return new;
end;
$$;

create trigger submission_tasks_fill_defaults
  before insert on public.submission_tasks
  for each row execute function public.submission_tasks_fill_defaults();

-- A task that reached "submitted" is final. Nothing — including a failure on
-- another portal for the same job — may reset it and cause a resubmission.
create or replace function public.submission_tasks_guard_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'submitted' and (
       new.status is distinct from old.status
    or new.execution_mode is distinct from old.execution_mode
    or new.confirmation_reference is distinct from old.confirmation_reference
  ) then
    raise exception 'submission task % is already submitted and cannot be changed', old.id
      using errcode = 'check_violation';
  end if;
  if new.job_id is distinct from old.job_id or new.portal_id is distinct from old.portal_id
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'job, portal and idempotency key of a submission task are immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger submission_tasks_guard_final
  before update on public.submission_tasks
  for each row execute function public.submission_tasks_guard_final();

create trigger submission_tasks_set_updated_at
  before update on public.submission_tasks
  for each row execute function public.set_updated_at();

-- One row per browser automation attempt.
create table public.automation_executions (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null,
  task_id                 uuid not null references public.submission_tasks (id) on delete cascade,
  job_id                  uuid not null,
  portal_id               uuid not null,
  portal_slug             text not null,
  attempt                 integer not null check (attempt >= 1),
  mode                    public.execution_mode not null,
  status                  public.execution_status not null default 'running',
  worker_id               text,
  started_at              timestamptz not null default now(),
  completed_at            timestamptz,
  duration_ms             bigint generated always as (
                            (extract(epoch from (completed_at - started_at)) * 1000)::bigint
                          ) stored,
  confirmation_reference  text,
  screenshot_path         text,
  error_code              text,
  error_message           text,
  steps                   jsonb not null default '[]'::jsonb,
  result                  jsonb,
  created_at              timestamptz not null default now(),
  foreign key (job_id, organisation_id) references public.jobs (id, organisation_id) on delete cascade,
  foreign key (portal_id, portal_slug) references public.portals (id, slug) on delete restrict,
  constraint automation_executions_task_attempt_key unique (task_id, attempt),
  constraint automation_executions_time_order check (completed_at is null or completed_at >= started_at),
  constraint automation_executions_running_open
    check ((status = 'running') = (completed_at is null))
);

create index automation_executions_org_started_idx on public.automation_executions (organisation_id, started_at desc);
create index automation_executions_running_idx on public.automation_executions (worker_id) where status = 'running';
create index automation_executions_task_idx on public.automation_executions (task_id);

-- Copy job/portal/organisation from the parent task so they cannot drift.
create or replace function public.automation_executions_fill_from_task()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select t.organisation_id, t.job_id, t.portal_id, t.portal_slug
    into new.organisation_id, new.job_id, new.portal_id, new.portal_slug
  from public.submission_tasks t
  where t.id = new.task_id;
  if not found then
    raise exception 'submission task % does not exist', new.task_id using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger automation_executions_fill_from_task
  before insert on public.automation_executions
  for each row execute function public.automation_executions_fill_from_task();
