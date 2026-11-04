-- JobSync · 0009 · Scope external job uniqueness to the organisation
--
-- Before: unique (source, external_job_id)            — global
-- After:  unique (organisation_id, source, external_job_id)
--
-- Different organisations may legitimately receive the same external job ID
-- from the same source system (e.g. two customers of one AroFlo tenant). Within
-- one organisation the behaviour is unchanged: a source + external ID pair can
-- be imported only once.
--
-- Data safety: no rows are modified. The new constraint is added first; it is
-- strictly weaker than the old one, so every existing row already satisfies
-- it. Only then is the old constraint removed (dropping a constraint removes
-- no data). Supabase runs each migration file in a single transaction, so the
-- table is never left without duplicate protection.

alter table public.jobs
  add constraint jobs_org_source_external_job_id_key
  unique (organisation_id, source, external_job_id);

alter table public.jobs
  drop constraint jobs_source_external_job_id_key;

comment on constraint jobs_org_source_external_job_id_key on public.jobs is
  'One import per organisation + source system + external job ID. NULL external IDs (manual jobs) are not constrained.';
