-- JobSync · 0001 · Enumerated types and shared helpers
-- Additive only. Enum values mirror src/lib/domain/status.ts — change both together.

create type public.job_status as enum (
  'received', 'validating', 'ready', 'processing',
  'partially_submitted', 'submitted', 'failed', 'requires_human_review'
);

create type public.task_status as enum (
  'pending', 'processing', 'submitted', 'failed', 'retry_scheduled', 'human_review', 'cancelled'
);

-- DRY_RUN is the default everywhere; LIVE must be explicitly authorised.
create type public.execution_mode as enum ('dry_run', 'live');

create type public.execution_status as enum ('running', 'succeeded', 'failed', 'cancelled');

create type public.job_source_type as enum ('external', 'manual');

create type public.job_priority as enum ('low', 'normal', 'high', 'urgent');

create type public.app_role as enum ('viewer', 'operator', 'admin');

-- How a portal destination was decided.
create type public.assignment_source as enum ('explicit', 'routing_rule', 'manual_override');

create type public.portal_connection_status as enum ('untested', 'ok', 'failed');

-- Keeps updated_at truthful on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
