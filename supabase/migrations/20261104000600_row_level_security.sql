-- JobSync · 0006 · Row Level Security and role-based access
--
-- Roles (public.app_role, ordered): viewer < operator < admin
--   viewer   read jobs, queue, executions and dashboards in their organisation
--   operator + create/edit/archive jobs, contacts, attachments and assignments
--   admin    + portals, routing rules, users, integration settings, audit logs
--
-- Submission tasks, executions, integration events and integration secrets are
-- written only by trusted server code using the service role (bypasses RLS).
-- The anon role has no table access at all.

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so policies can read profiles without recursion.
-- ---------------------------------------------------------------------------
create or replace function public.current_organisation_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organisation_id from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.has_min_role(required public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() >= required, false)
$$;

-- True when the job exists in the caller's organisation.
create or replace function public.can_access_job(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.jobs j
    where j.id = target_job_id and j.organisation_id = public.current_organisation_id()
  )
$$;

revoke all on function public.current_organisation_id() from public, anon;
revoke all on function public.current_app_role() from public, anon;
revoke all on function public.has_min_role(public.app_role) from public, anon;
revoke all on function public.can_access_job(uuid) from public, anon;
grant execute on function public.current_organisation_id() to authenticated, service_role;
grant execute on function public.current_app_role() to authenticated, service_role;
grant execute on function public.has_min_role(public.app_role) to authenticated, service_role;
grant execute on function public.can_access_job(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere; remove anonymous access.
-- ---------------------------------------------------------------------------
alter table public.organisations           enable row level security;
alter table public.profiles                enable row level security;
alter table public.portals                 enable row level security;
alter table public.jobs                    enable row level security;
alter table public.job_contacts            enable row level security;
alter table public.job_attachments         enable row level security;
alter table public.routing_rules           enable row level security;
alter table public.job_portal_assignments  enable row level security;
alter table public.submission_tasks        enable row level security;
alter table public.automation_executions   enable row level security;
alter table public.integration_settings    enable row level security;
alter table public.integration_events      enable row level security;
alter table public.audit_logs              enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Integration secrets: the authenticated role may read every column except
-- the ciphertext, and may not write the table at all (server-only writes).
revoke all on public.integration_settings from authenticated;
grant select (
  id, organisation_id, kind, config, secret_hint, secret_updated_at,
  last_test_at, last_test_status, last_test_message, updated_by, created_at, updated_at
) on public.integration_settings to authenticated;

-- Audit logs and server-written tables are read-only for users.
revoke insert, update, delete on public.audit_logs from authenticated;
revoke insert, update, delete on public.submission_tasks from authenticated;
revoke insert, update, delete on public.automation_executions from authenticated;
revoke insert, update, delete on public.integration_events from authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
create policy organisations_select on public.organisations
  for select to authenticated
  using (id = public.current_organisation_id());

create policy organisations_update_admin on public.organisations
  for update to authenticated
  using (id = public.current_organisation_id() and public.has_min_role('admin'))
  with check (id = public.current_organisation_id());

create policy profiles_select on public.profiles
  for select to authenticated
  using (organisation_id = public.current_organisation_id());

-- Only admins change profiles (including roles), and only inside their organisation.
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (organisation_id = public.current_organisation_id() and public.has_min_role('admin'))
  with check (organisation_id = public.current_organisation_id());

create policy portals_select on public.portals
  for select to authenticated
  using (public.current_organisation_id() is not null);

create policy portals_write_admin on public.portals
  for all to authenticated
  using (public.has_min_role('admin'))
  with check (public.has_min_role('admin'));

create policy jobs_select on public.jobs
  for select to authenticated
  using (organisation_id = public.current_organisation_id());

create policy jobs_insert_operator on public.jobs
  for insert to authenticated
  with check (organisation_id = public.current_organisation_id() and public.has_min_role('operator'));

-- Jobs are archived, never deleted, so there is no DELETE policy.
create policy jobs_update_operator on public.jobs
  for update to authenticated
  using (organisation_id = public.current_organisation_id() and public.has_min_role('operator'))
  with check (organisation_id = public.current_organisation_id());

create policy job_contacts_select on public.job_contacts
  for select to authenticated
  using (public.can_access_job(job_id));

create policy job_contacts_write_operator on public.job_contacts
  for all to authenticated
  using (public.can_access_job(job_id) and public.has_min_role('operator'))
  with check (public.can_access_job(job_id) and public.has_min_role('operator'));

create policy job_attachments_select on public.job_attachments
  for select to authenticated
  using (public.can_access_job(job_id));

create policy job_attachments_write_operator on public.job_attachments
  for all to authenticated
  using (public.can_access_job(job_id) and public.has_min_role('operator'))
  with check (public.can_access_job(job_id) and public.has_min_role('operator'));

create policy routing_rules_select on public.routing_rules
  for select to authenticated
  using (organisation_id = public.current_organisation_id());

create policy routing_rules_write_admin on public.routing_rules
  for all to authenticated
  using (organisation_id = public.current_organisation_id() and public.has_min_role('admin'))
  with check (organisation_id = public.current_organisation_id() and public.has_min_role('admin'));

create policy job_portal_assignments_select on public.job_portal_assignments
  for select to authenticated
  using (organisation_id = public.current_organisation_id());

create policy job_portal_assignments_write_operator on public.job_portal_assignments
  for all to authenticated
  using (organisation_id = public.current_organisation_id() and public.has_min_role('operator'))
  with check (organisation_id = public.current_organisation_id() and public.has_min_role('operator'));

create policy submission_tasks_select on public.submission_tasks
  for select to authenticated
  using (organisation_id = public.current_organisation_id());

create policy automation_executions_select on public.automation_executions
  for select to authenticated
  using (organisation_id = public.current_organisation_id());

create policy integration_settings_select_admin on public.integration_settings
  for select to authenticated
  using (organisation_id = public.current_organisation_id() and public.has_min_role('admin'));

create policy integration_events_select_operator on public.integration_events
  for select to authenticated
  using (organisation_id = public.current_organisation_id() and public.has_min_role('operator'));

create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (organisation_id = public.current_organisation_id() and public.has_min_role('admin'));
