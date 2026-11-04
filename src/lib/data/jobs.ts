import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { PortalSlug } from "@/lib/domain/portals";
import type {
  ExecutionMode,
  ExecutionStatus,
  JobPriority,
  JobSourceType,
  JobStatus,
  TaskStatus,
} from "@/lib/domain/status";
import { isMissingRelation, type DataResult } from "@/lib/data/result";
import { toLikePattern, type JobsQuery } from "@/lib/jobs/query";

/* ------------------------------------------------------------------ types */

interface PortalRef {
  slug: PortalSlug;
  name: string;
}

export interface JobListRow {
  id: string;
  reference: string;
  external_job_id: string | null;
  source: string;
  source_type: JobSourceType;
  customer_name: string;
  service_address: string;
  category: string;
  priority: JobPriority;
  status: JobStatus;
  scheduled_date: string | null;
  scheduled_time: string | null;
  received_at: string;
  archived_at: string | null;
  assignments: { portal: PortalRef | null }[];
}

export interface JobList {
  rows: JobListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** True when the requested page is past the last page. */
  outOfRange: boolean;
}

export interface JobDetail {
  job: JobListRow & {
    description: string;
    instructions: string | null;
    technician: string | null;
    created_at: string;
    updated_at: string;
    archived_by: string | null;
    created_by: string | null;
  };
  contacts: { id: string; name: string; email: string | null; phone: string | null; is_primary: boolean }[];
  attachments: {
    id: string;
    file_name: string;
    content_type: string;
    size_bytes: number | null;
    storage_bucket: string | null;
    storage_path: string | null;
    source_url: string | null;
    created_at: string;
    /** Short-lived signed URL for files in Supabase Storage (5 minutes). */
    download_url: string | null;
  }[];
  assignments: {
    id: string;
    source: "explicit" | "routing_rule" | "manual_override";
    reason: string;
    created_at: string;
    portal: PortalRef | null;
    routing_rule: { name: string } | null;
  }[];
  tasks: {
    id: string;
    portal_slug: PortalSlug;
    status: TaskStatus;
    execution_mode: ExecutionMode;
    attempt_count: number;
    max_attempts: number;
    next_attempt_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    last_error: string | null;
    confirmation_reference: string | null;
    created_at: string;
  }[];
  executions: {
    id: string;
    portal_slug: PortalSlug;
    attempt: number;
    mode: ExecutionMode;
    status: ExecutionStatus;
    worker_id: string | null;
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
    confirmation_reference: string | null;
    error_message: string | null;
  }[];
  /** null when the caller's role cannot read the audit log. */
  audit: { id: number; action: string; actor_id: string | null; actor_type: string; created_at: string }[] | null;
}

/* ------------------------------------------------------------- list jobs */

const LIST_COLUMNS = [
  "id",
  "reference",
  "external_job_id",
  "source",
  "source_type",
  "customer_name",
  "service_address",
  "category",
  "priority",
  "status",
  "scheduled_date",
  "scheduled_time",
  "received_at",
  "archived_at",
  "assignments:job_portal_assignments(portal:portals(slug, name))",
].join(", ");

type DbError = { code?: string; message: string };

function failure(scope: string, error: DbError): DataResult<never> {
  if (isMissingRelation(error)) {
    return {
      kind: "schema_missing",
      detail: "The JobSync tables were not found. Apply the SQL migrations in supabase/migrations.",
    };
  }
  console.error(`[${scope}] query failed`, error.code, error.message);
  return { kind: "error", message: "The jobs could not be loaded from Supabase. Check the server logs." };
}

export async function listJobs(db: SupabaseClient, query: JobsQuery): Promise<DataResult<JobList>> {
  // Resolve the portal filter to an id; an unknown portal simply matches nothing.
  let portalId: string | null = null;
  if (query.portal) {
    const { data, error } = await db.from("portals").select("id").eq("slug", query.portal).maybeSingle();
    if (error) return failure("jobs.list", error);
    if (!data) return { kind: "ok", source: "database", data: emptyList(query, 0) };
    portalId = data.id as string;
  }

  // A second, inner-joined alias filters by portal while `assignments` still
  // returns every destination of each matching job.
  const columns = portalId ? `${LIST_COLUMNS}, portal_filter:job_portal_assignments!inner(portal_id)` : LIST_COLUMNS;

  const build = (head: boolean) => {
    let q = db.from("jobs").select(head ? "id" : columns, { count: "exact", head });
    if (portalId) q = q.eq("portal_filter.portal_id", portalId);
    if (query.q) q = q.ilike("search_text", toLikePattern(query.q));
    if (query.status) q = q.eq("status", query.status);
    if (query.source) q = q.eq("source_type", query.source);
    if (query.priority) q = q.eq("priority", query.priority);
    if (query.archived === "active") q = q.is("archived_at", null);
    if (query.archived === "archived") q = q.not("archived_at", "is", null);
    return q;
  };

  const from = (query.page - 1) * query.size;
  const { data, count, error } = await build(false)
    .order(query.sort, { ascending: query.dir === "asc", nullsFirst: false })
    .order("reference", { ascending: false })
    .range(from, from + query.size - 1);

  if (error) {
    // PostgREST answers a page beyond the end with "range not satisfiable".
    if (error.code === "PGRST103") {
      const head = await build(true);
      if (head.error) return failure("jobs.list", head.error);
      return { kind: "ok", source: "database", data: { ...emptyList(query, head.count ?? 0), outOfRange: true } };
    }
    return failure("jobs.list", error);
  }

  const total = count ?? 0;
  return {
    kind: "ok",
    source: "database",
    data: {
      rows: (data ?? []) as unknown as JobListRow[],
      total,
      page: query.page,
      pageSize: query.size,
      pageCount: Math.max(1, Math.ceil(total / query.size)),
      outOfRange: total > 0 && from >= total,
    },
  };
}

function emptyList(query: JobsQuery, total: number): JobList {
  return {
    rows: [],
    total,
    page: query.page,
    pageSize: query.size,
    pageCount: Math.max(1, Math.ceil(total / query.size)),
    outOfRange: false,
  };
}

/* ------------------------------------------------------------ job detail */

const DETAIL_COLUMNS = [
  "id",
  "reference",
  "external_job_id",
  "source",
  "source_type",
  "customer_name",
  "service_address",
  "category",
  "priority",
  "status",
  "description",
  "instructions",
  "scheduled_date",
  "scheduled_time",
  "technician",
  "received_at",
  "archived_at",
  "archived_by",
  "created_by",
  "created_at",
  "updated_at",
  "assignments:job_portal_assignments(portal:portals(slug, name))",
].join(", ");

export const jobIdSchema = z.uuid();

export async function getJobDetail(
  db: SupabaseClient,
  id: string,
  options: { includeAudit: boolean },
): Promise<DataResult<JobDetail | null>> {
  if (!jobIdSchema.safeParse(id).success) return { kind: "ok", source: "database", data: null };

  const job = await db.from("jobs").select(DETAIL_COLUMNS).eq("id", id).maybeSingle();
  if (job.error) return failure("jobs.detail", job.error);
  if (!job.data) return { kind: "ok", source: "database", data: null };

  const [contacts, attachments, assignments, tasks, executions, audit] = await Promise.all([
    db
      .from("job_contacts")
      .select("id, name, email, phone, is_primary")
      .eq("job_id", id)
      .order("is_primary", { ascending: false })
      .order("created_at"),
    db
      .from("job_attachments")
      .select("id, file_name, content_type, size_bytes, storage_bucket, storage_path, source_url, created_at")
      .eq("job_id", id)
      .order("created_at"),
    db
      .from("job_portal_assignments")
      .select("id, source, reason, created_at, portal:portals(slug, name), routing_rule:routing_rules(name)")
      .eq("job_id", id)
      .order("created_at"),
    db
      .from("submission_tasks")
      .select(
        "id, portal_slug, status, execution_mode, attempt_count, max_attempts, next_attempt_at, started_at, completed_at, last_error, confirmation_reference, created_at",
      )
      .eq("job_id", id)
      .order("portal_slug"),
    db
      .from("automation_executions")
      .select(
        "id, portal_slug, attempt, mode, status, worker_id, started_at, completed_at, duration_ms, confirmation_reference, error_message",
      )
      .eq("job_id", id)
      .order("started_at", { ascending: false })
      .limit(50),
    options.includeAudit
      ? db
          .from("audit_logs")
          .select("id, action, actor_id, actor_type, created_at")
          .eq("entity_type", "jobs")
          .eq("entity_id", id)
          .order("id", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: null, error: null }),
  ]);

  for (const r of [contacts, attachments, assignments, tasks, executions, audit]) {
    if (r.error) return failure("jobs.detail", r.error);
  }

  const attachmentRows = (attachments.data ?? []) as Omit<JobDetail["attachments"][number], "download_url">[];
  const signed = await signAttachmentUrls(db, attachmentRows);

  return {
    kind: "ok",
    source: "database",
    data: {
      job: job.data as unknown as JobDetail["job"],
      contacts: (contacts.data ?? []) as JobDetail["contacts"],
      attachments: attachmentRows.map((a) => ({ ...a, download_url: signed.get(a.id) ?? a.source_url })),
      assignments: (assignments.data ?? []) as unknown as JobDetail["assignments"],
      tasks: (tasks.data ?? []) as JobDetail["tasks"],
      executions: (executions.data ?? []) as JobDetail["executions"],
      audit: options.includeAudit ? ((audit.data ?? []) as NonNullable<JobDetail["audit"]>) : null,
    },
  };
}

/** Signed URLs are created with the user's session, so Storage RLS applies. */
async function signAttachmentUrls(
  db: SupabaseClient,
  rows: { id: string; storage_bucket: string | null; storage_path: string | null }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const byBucket = new Map<string, { id: string; path: string }[]>();
  for (const r of rows) {
    if (!r.storage_bucket || !r.storage_path) continue;
    byBucket.set(r.storage_bucket, [...(byBucket.get(r.storage_bucket) ?? []), { id: r.id, path: r.storage_path }]);
  }
  for (const [bucket, items] of byBucket) {
    const { data, error } = await db.storage.from(bucket).createSignedUrls(
      items.map((i) => i.path),
      300,
    );
    if (error || !data) continue; // No link rather than a broken one.
    data.forEach((d, i) => {
      if (d.signedUrl) result.set(items[i].id, d.signedUrl);
    });
  }
  return result;
}

/* --------------------------------------------------------- archive/restore */

export type ArchiveOutcome =
  { ok: true } | { ok: false; reason: "not_found" | "already_in_state" | "processing" | "error"; message: string };

/**
 * Archive (or restore) a job. Archiving never deletes anything and never
 * creates submissions. A job with a portal submission in progress cannot be
 * archived, so a running browser execution is never orphaned.
 */
export async function setJobArchived(
  db: SupabaseClient,
  id: string,
  archive: boolean,
  actorId: string,
): Promise<ArchiveOutcome> {
  if (!jobIdSchema.safeParse(id).success) return { ok: false, reason: "not_found", message: "Job not found." };

  if (archive) {
    const running = await db
      .from("submission_tasks")
      .select("id", { count: "exact", head: true })
      .eq("job_id", id)
      .eq("status", "processing");
    if (running.error) return logged("jobs.archive", running.error);
    if ((running.count ?? 0) > 0) {
      return {
        ok: false,
        reason: "processing",
        message: "A portal submission for this job is in progress. Wait for it to finish before archiving.",
      };
    }
  }

  const update = archive
    ? { archived_at: new Date().toISOString(), archived_by: actorId }
    : { archived_at: null, archived_by: null };

  let q = db.from("jobs").update(update).eq("id", id);
  q = archive ? q.is("archived_at", null) : q.not("archived_at", "is", null);
  const { data, error } = await q.select("id");
  if (error) return logged("jobs.archive", error);

  if (!data || data.length === 0) {
    // Distinguish "not visible/permitted" from "already archived/restored".
    const exists = await db.from("jobs").select("id").eq("id", id).maybeSingle();
    if (exists.data) {
      return {
        ok: false,
        reason: "already_in_state",
        message: archive ? "This job is already archived." : "This job is not archived.",
      };
    }
    return { ok: false, reason: "not_found", message: "Job not found." };
  }
  return { ok: true };
}

function logged(scope: string, error: DbError): ArchiveOutcome {
  console.error(`[${scope}] failed`, error.code, error.message);
  return { ok: false, reason: "error", message: "The change could not be saved. Check the server logs." };
}
