/**
 * Read-only queries over the demo state. They return the SAME shapes as the
 * Supabase data layer (JobList, JobDetail, EditableJob, IncomingData,
 * OverviewSnapshot) so the existing UI components are reused unchanged.
 */
import type { IncomingData, IncomingView, IntakeEventRow } from "@/lib/data/incoming";
import type { EditableJob, FormPortal } from "@/lib/data/job-form";
import type { JobDetail, JobList, JobListRow } from "@/lib/data/jobs";
import { PORTALS, getPortal, type PortalSlug } from "@/lib/domain/portals";
import { AWAITING_JOB_STATUSES, type JobPriority, type TaskStatus } from "@/lib/domain/status";
import type { JobsQuery } from "@/lib/jobs/query";
import {
  OVERVIEW_WINDOW_DAYS,
  buildDayBuckets,
  computeOverview,
  utcDay,
  windowStart,
  type OverviewCounts,
  type OverviewSnapshot,
} from "@/lib/metrics/overview";
import { PORTAL_SPECS } from "@/lib/portals/specs";

import { finalSteps } from "./engine";
import type { DemoExecution, DemoJob, DemoState, DemoTask, ExecutionStep, SimulatedOutcome } from "./types";

const DAY = 86_400_000;
const PRIORITY_ORDER: Record<JobPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/** A person submitted on the portal and entered the reference (not automation). */
export const isManualSubmission = (t: DemoTask) => t.status === "submitted" && t.execution_mode === "live";

export function portalName(slug: string): string {
  return PORTALS.find((p) => p.slug === slug)?.name ?? slug;
}

function indexBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function searchText(j: DemoJob): string {
  return [j.reference, j.external_job_id ?? "", j.customer_name, j.service_address, j.category, j.technician ?? ""]
    .join(" ")
    .toLowerCase();
}

/* ------------------------------------------------------------------ jobs */

function toListRow(j: DemoJob, assignmentsByJob: Map<string, { portal_slug: PortalSlug }[]>): JobListRow {
  return {
    id: j.id,
    reference: j.reference,
    external_job_id: j.external_job_id,
    source: j.source,
    source_type: j.source_type,
    customer_name: j.customer_name,
    service_address: j.service_address,
    category: j.category,
    priority: j.priority,
    status: j.status,
    scheduled_date: j.scheduled_date,
    scheduled_time: j.scheduled_time,
    received_at: j.received_at,
    archived_at: j.archived_at,
    assignments: (assignmentsByJob.get(j.id) ?? []).map((a) => ({
      portal: { slug: a.portal_slug, name: portalName(a.portal_slug) },
    })),
  };
}

export function listJobs(s: DemoState, q: JobsQuery): JobList {
  const assignmentsByJob = indexBy(s.assignments, (a) => a.job_id);
  const term = q.q.toLowerCase();
  let rows = s.jobs.filter((j) => {
    if (q.archived === "active" && j.archived_at) return false;
    if (q.archived === "archived" && !j.archived_at) return false;
    if (q.status && j.status !== q.status) return false;
    if (q.source && j.source_type !== q.source) return false;
    if (q.priority && j.priority !== q.priority) return false;
    if (q.portal && !(assignmentsByJob.get(j.id) ?? []).some((a) => a.portal_slug === q.portal)) return false;
    if (term && !searchText(j).includes(term)) return false;
    return true;
  });
  const dir = q.dir === "asc" ? 1 : -1;
  const value = (j: DemoJob): string | number => {
    switch (q.sort) {
      case "priority":
        return PRIORITY_ORDER[j.priority];
      case "scheduled_date":
        return j.scheduled_date ?? "";
      case "customer_name":
        return j.customer_name.toLowerCase();
      case "reference":
        return j.reference;
      default:
        return j.received_at;
    }
  };
  rows = [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (q.sort === "scheduled_date") {
      if (!va && vb) return 1;
      if (va && !vb) return -1;
    }
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir || b.reference.localeCompare(a.reference);
  });
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / q.size));
  const from = (q.page - 1) * q.size;
  return {
    rows: rows.slice(from, from + q.size).map((j) => toListRow(j, assignmentsByJob)),
    total,
    page: q.page,
    pageSize: q.size,
    pageCount,
    outOfRange: total > 0 && from >= total,
  };
}

/** Steps for an execution; seed history stores none, so derive them. */
export function executionSteps(s: DemoState, e: DemoExecution, now: Date = new Date()): ExecutionStep[] {
  if (e.status === "running") {
    const plannedEnd = e.plan ? new Date(e.plan.ends_at).getTime() : now.getTime();
    const begin = new Date(e.started_at).getTime();
    const progress = Math.min(0.95, Math.max(0, (now.getTime() - begin) / Math.max(1, plannedEnd - begin)));
    const doneCount = Math.floor(progress * e.steps.length);
    return e.steps.map((step, i) => ({
      ...step,
      status: i < doneCount ? "done" : "pending",
      at: i < doneCount ? new Date(begin + ((plannedEnd - begin) * (i + 1)) / e.steps.length).toISOString() : null,
      detail: i === doneCount ? "In progress (simulated)" : i < doneCount ? "Simulated" : undefined,
    }));
  }
  if (e.steps.length > 0 && e.steps.some((x) => x.status !== "pending")) return e.steps;
  const outcome: SimulatedOutcome =
    e.status === "succeeded"
      ? { kind: "success" }
      : {
          kind: "retryable",
          code: e.error_code ?? "UNKNOWN",
          message: e.error_message ?? "Unknown error",
          failStep: STEP_FOR_CODE[e.error_code ?? ""] ?? "populate",
        };
  const hasAttachments = s.attachments.some((a) => a.job_id === e.job_id);
  return finalSteps(
    outcome,
    hasAttachments,
    PORTAL_SPECS[e.portal_slug].supportsAttachments,
    new Date(e.started_at),
    new Date(e.completed_at ?? e.started_at),
  );
}

const STEP_FOR_CODE: Record<string, string> = {
  PORTAL_TIMEOUT: "open",
  PORTAL_UNAVAILABLE: "open",
  SELECTOR_NOT_FOUND: "populate",
  UPLOAD_FAILED: "attachments",
  SESSION_EXPIRED: "login",
  CAPTCHA_DETECTED: "login",
  MFA_REQUIRED: "login",
  PORTAL_VALIDATION_REJECTED: "validate",
};

export function relatedAudit(s: DemoState, jobId: string) {
  const taskIds = new Set(s.tasks.filter((t) => t.job_id === jobId).map((t) => t.id));
  return s.audit
    .filter(
      (a) =>
        a.entity_id === jobId ||
        (a.entity_id && taskIds.has(a.entity_id)) ||
        (a.changes && (a.changes as Record<string, unknown>).job_id === jobId),
    )
    .sort((a, b) => b.id - a.id);
}

export function jobDetail(s: DemoState, id: string, includeAudit: boolean): JobDetail | null {
  const j = s.jobs.find((x) => x.id === id);
  if (!j) return null;
  const assignmentsByJob = indexBy(s.assignments, (a) => a.job_id);
  const ruleName = new Map(s.routing_rules.map((r) => [r.id, r.name]));
  return {
    job: {
      ...toListRow(j, assignmentsByJob),
      description: j.description,
      instructions: j.instructions,
      technician: j.technician,
      created_at: j.created_at,
      updated_at: j.updated_at,
      archived_by: j.archived_by,
      created_by: j.created_by,
    },
    contacts: s.contacts.filter((c) => c.job_id === id).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
    attachments: s.attachments
      .filter((a) => a.job_id === id)
      .map((a) => ({
        id: a.id,
        file_name: a.file_name,
        content_type: a.content_type,
        size_bytes: a.size_bytes,
        storage_bucket: a.blob_key ? "browser" : null,
        storage_path: a.blob_key,
        source_url: a.source_url,
        created_at: a.created_at,
        download_url: a.source_url,
      })),
    assignments: (assignmentsByJob.get(id) ?? []).map((a) => ({
      id: a.id,
      source: a.source,
      reason: a.reason,
      created_at: a.created_at,
      portal: { slug: a.portal_slug, name: portalName(a.portal_slug) },
      routing_rule:
        a.routing_rule_id && ruleName.has(a.routing_rule_id) ? { name: ruleName.get(a.routing_rule_id)! } : null,
    })),
    tasks: s.tasks
      .filter((t) => t.job_id === id)
      .sort((a, b) => a.portal_slug.localeCompare(b.portal_slug))
      .map((t) => ({ ...t })),
    executions: s.executions
      .filter((e) => e.job_id === id)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 50)
      .map((e) => ({ ...e, error_message: e.error_message })),
    audit: includeAudit
      ? relatedAudit(s, id)
          .slice(0, 100)
          .map((a) => ({
            id: a.id,
            action: a.action,
            actor_id: a.actor_id,
            actor_type: a.actor_type,
            created_at: a.created_at,
          }))
      : null,
  };
}

export function formPortals(s: DemoState): FormPortal[] {
  return s.portals.map((p) => ({ slug: p.slug, name: p.name, is_enabled: p.is_enabled }));
}

export function editableJob(s: DemoState, id: string): EditableJob | null {
  const j = s.jobs.find((x) => x.id === id);
  if (!j) return null;
  const contact = s.contacts.find((c) => c.job_id === id && c.is_primary);
  const tasks = s.tasks.filter((t) => t.job_id === id);
  return {
    id: j.id,
    reference: j.reference,
    source_type: j.source_type,
    source: j.source,
    external_job_id: j.external_job_id,
    archived: Boolean(j.archived_at),
    updated_at: j.updated_at,
    values: {
      customer_name: j.customer_name,
      service_address: j.service_address,
      category: j.category,
      priority: j.priority,
      description: j.description,
      instructions: j.instructions ?? "",
      scheduled_date: j.scheduled_date ?? "",
      scheduled_time: j.scheduled_time ? j.scheduled_time.slice(0, 5) : "",
      technician: j.technician ?? "",
      contact_name: contact?.name ?? "",
      contact_email: contact?.email ?? "",
      contact_phone: contact?.phone ?? "",
      destinations: s.assignments.filter((a) => a.job_id === id).map((a) => a.portal_slug),
    },
    lockedDestinations: tasks.filter((t) => t.status !== "pending" || t.attempt_count > 0).map((t) => t.portal_slug),
    submittedCount: tasks.filter((t) => t.status === "submitted").length,
    processing: tasks.some((t) => t.status === "processing"),
    attachments: s.attachments
      .filter((a) => a.job_id === id)
      .map((a) => ({ id: a.id, file_name: a.file_name, size_bytes: a.size_bytes })),
  };
}

/* -------------------------------------------------------------- overview */

export function overview(s: DemoState, now: Date): OverviewSnapshot {
  const active = s.jobs.filter((j) => !j.archived_at);
  const by = (st: string) => active.filter((j) => j.status === st).length;
  const counts: OverviewCounts = {
    jobsTotal: active.length,
    jobsAwaiting: active.filter((j) => AWAITING_JOB_STATUSES.includes(j.status)).length,
    jobsProcessing: by("processing"),
    jobsSubmitted: by("submitted"),
    jobsPartial: by("partially_submitted"),
    jobsFailed: by("failed"),
    jobsReview: by("requires_human_review"),
    tasksFailed: s.tasks.filter((t) => t.status === "failed").length,
    tasksBacklog: s.tasks.filter((t) => t.status === "pending" || t.status === "retry_scheduled").length,
    tasksSubmittedLive: s.tasks.filter(isManualSubmission).length,
    tasksSubmittedDryRun: s.tasks.filter((t) => t.status === "submitted" && t.execution_mode === "dry_run").length,
  };
  const since = windowStart(now, OVERVIEW_WINDOW_DAYS).toISOString();
  return computeOverview(
    counts,
    {
      jobs: s.jobs
        .filter((j) => j.received_at >= since)
        .map((j) => ({ status: j.status, source_type: j.source_type, received_at: j.received_at })),
      // Rates describe automation; tasks a person completed are counted above, not here.
      tasks: s.tasks
        .filter((t) => t.created_at >= since && !isManualSubmission(t))
        .map((t) => ({
          portal_slug: t.portal_slug,
          status: t.status,
          execution_mode: t.execution_mode,
          created_at: t.created_at,
          completed_at: t.completed_at,
        })),
      executions: s.executions
        .filter((e) => e.started_at >= since)
        .map((e) => ({
          status: e.status,
          mode: e.mode,
          worker_id: e.worker_id,
          started_at: e.started_at,
          completed_at: e.completed_at,
        })),
      runningExecutions: s.executions.filter((e) => e.status === "running").map((e) => ({ worker_id: e.worker_id })),
    },
    now,
  );
}

/* -------------------------------------------------------------- incoming */

const INCOMING_PAGE = 25;

export function incoming(
  s: DemoState,
  view: IncomingView,
  page: number,
  eventsVisible: boolean,
  now: Date,
): IncomingData {
  const since = new Date(now.getTime() - DAY).toISOString();
  const assigned = new Set(s.assignments.map((a) => a.job_id));
  const newJobs = s.jobs
    .filter((j) => !j.archived_at && j.received_at >= since)
    .sort((a, b) => b.received_at.localeCompare(a.received_at));
  const awaiting = s.jobs
    .filter((j) => !j.archived_at && j.status === "received" && !assigned.has(j.id))
    .sort((a, b) => a.received_at.localeCompare(b.received_at));
  const intake = s.events.filter((e) => e.integration === "intake" && e.direction === "inbound");
  const ev = (st: string) =>
    intake.filter((e) => e.status === st).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const refById = new Map(s.jobs.map((j) => [j.id, j.reference]));
  const counts = {
    new: newJobs.length,
    awaiting_routing: awaiting.length,
    accepted: eventsVisible ? ev("accepted").length : null,
    duplicate: eventsVisible ? ev("duplicate").length : null,
    rejected: eventsVisible ? ev("rejected").length : null,
    failed: eventsVisible ? ev("failed").length : null,
  };
  const p = Math.max(1, page);
  const slice = <T>(list: T[]) => list.slice((p - 1) * INCOMING_PAGE, p * INCOMING_PAGE);
  const base = {
    view,
    counts,
    eventsVisible,
    events: [] as IntakeEventRow[],
    jobs: [] as IncomingData["jobs"],
    total: 0,
    page: p,
    pageCount: 1,
  };
  if (view === "new" || view === "awaiting_routing") {
    const list = view === "new" ? newJobs : awaiting;
    return {
      ...base,
      jobs: slice(list).map((j) => ({
        id: j.id,
        reference: j.reference,
        source_type: j.source_type,
        source: j.source,
        external_job_id: j.external_job_id,
        customer_name: j.customer_name,
        category: j.category,
        status: j.status,
        received_at: j.received_at,
      })),
      total: list.length,
      pageCount: Math.max(1, Math.ceil(list.length / INCOMING_PAGE)),
    };
  }
  if (!eventsVisible) return base;
  const list = ev(view);
  return {
    ...base,
    events: slice(list).map((e) => ({
      id: e.id,
      created_at: e.created_at,
      status: e.status === "not_sent" ? "failed" : e.status,
      http_status: e.http_status,
      request_id: e.request_id,
      idempotency_key: e.idempotency_key,
      error: e.error,
      job_id: e.job_id,
      payload: e.payload,
      job: e.job_id && refById.has(e.job_id) ? { reference: refById.get(e.job_id)! } : null,
    })),
    total: list.length,
    pageCount: Math.max(1, Math.ceil(list.length / INCOMING_PAGE)),
  };
}

/* ----------------------------------------------------------------- queue */

export interface QueueRow {
  task: DemoTask;
  job: Pick<DemoJob, "id" | "reference" | "customer_name" | "priority" | "category" | "archived_at">;
  running: DemoExecution | null;
}

export const QUEUE_STATUSES: TaskStatus[] = [
  "pending",
  "processing",
  "retry_scheduled",
  "submitted",
  "failed",
  "human_review",
  "cancelled",
];

export function queueRows(
  s: DemoState,
  filter: { status?: TaskStatus | "active"; portal?: PortalSlug; q?: string },
): QueueRow[] {
  const jobById = new Map(s.jobs.map((j) => [j.id, j]));
  const running = new Map(s.executions.filter((e) => e.status === "running").map((e) => [e.task_id, e]));
  const term = filter.q?.trim().toLowerCase() ?? "";
  const ACTIVE: TaskStatus[] = ["pending", "processing", "retry_scheduled"];
  return s.tasks
    .filter((t) => {
      if (filter.status === "active" ? !ACTIVE.includes(t.status) : filter.status && t.status !== filter.status)
        return false;
      if (filter.portal && t.portal_slug !== filter.portal) return false;
      if (term) {
        const j = jobById.get(t.job_id);
        if (!j || !`${j.reference} ${j.customer_name} ${j.external_job_id ?? ""}`.toLowerCase().includes(term))
          return false;
      }
      return true;
    })
    .map((t) => {
      const j = jobById.get(t.job_id)!;
      return {
        task: t,
        job: {
          id: j.id,
          reference: j.reference,
          customer_name: j.customer_name,
          priority: j.priority,
          category: j.category,
          archived_at: j.archived_at,
        },
        running: running.get(t.id) ?? null,
      };
    })
    .sort((a, b) => {
      const order = (r: QueueRow) =>
        r.task.status === "processing"
          ? 0
          : r.task.status === "pending"
            ? 1
            : r.task.status === "retry_scheduled"
              ? 2
              : 3;
      return (
        order(a) - order(b) ||
        PRIORITY_ORDER[b.job.priority] - PRIORITY_ORDER[a.job.priority] ||
        a.task.created_at.localeCompare(b.task.created_at) *
          (["pending", "processing", "retry_scheduled"].includes(a.task.status) ? 1 : -1)
      );
    });
}

export function taskCounts(s: DemoState): Record<TaskStatus, number> {
  const out = Object.fromEntries(QUEUE_STATUSES.map((x) => [x, 0])) as Record<TaskStatus, number>;
  for (const t of s.tasks) out[t.status] += 1;
  return out;
}

/** Why a due task is not being picked up, if anything blocks it. */
export function blockedReason(s: DemoState, t: DemoTask, now: Date): string | null {
  const p = s.portals.find((x) => x.slug === t.portal_slug);
  const j = s.jobs.find((x) => x.id === t.job_id);
  if (j?.archived_at) return "Job is archived";
  if (!p?.is_enabled) return "Portal disabled";
  if (!p.automation_enabled) return "Portal automation paused";
  if (t.next_attempt_at && new Date(t.next_attempt_at) > now) return null;
  if (!s.settings.worker_running) return "Worker paused";
  return null;
}

/* ------------------------------------------------------------ executions */

export interface ExecutionFilter {
  portal?: PortalSlug;
  status?: DemoExecution["status"];
  q?: string;
  days?: number;
}

export function executionRows(s: DemoState, f: ExecutionFilter, now: Date) {
  const jobById = new Map(s.jobs.map((j) => [j.id, j]));
  const since = f.days ? new Date(now.getTime() - f.days * DAY).toISOString() : "";
  const term = f.q?.trim().toLowerCase() ?? "";
  return s.executions
    .filter((e) => {
      if (f.portal && e.portal_slug !== f.portal) return false;
      if (f.status && e.status !== f.status) return false;
      if (since && e.started_at < since) return false;
      if (term) {
        const j = jobById.get(e.job_id);
        if (
          !`${j?.reference ?? ""} ${j?.customer_name ?? ""} ${e.error_code ?? ""} ${e.worker_id ?? ""}`
            .toLowerCase()
            .includes(term)
        )
          return false;
      }
      return true;
    })
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .map((e) => ({ execution: e, job: jobById.get(e.job_id) ?? null }));
}

/* ---------------------------------------------------------------- failed */

export function attentionItems(s: DemoState) {
  const jobById = new Map(s.jobs.map((j) => [j.id, j]));
  const withJob = (t: DemoTask) => ({ task: t, job: jobById.get(t.job_id)! });
  const assigned = new Set(s.assignments.map((a) => a.job_id));
  return {
    failed: s.tasks
      .filter((t) => t.status === "failed")
      .map(withJob)
      .filter((x) => !x.job.archived_at)
      .sort((a, b) => (b.task.completed_at ?? "").localeCompare(a.task.completed_at ?? "")),
    review: s.tasks
      .filter((t) => t.status === "human_review")
      .map(withJob)
      .filter((x) => !x.job.archived_at)
      .sort((a, b) => b.task.updated_at.localeCompare(a.task.updated_at)),
    retrying: s.tasks
      .filter((t) => t.status === "retry_scheduled")
      .map(withJob)
      .filter((x) => !x.job.archived_at)
      .sort((a, b) => (a.task.next_attempt_at ?? "").localeCompare(b.task.next_attempt_at ?? "")),
    unrouted: s.jobs
      .filter((j) => !j.archived_at && j.status === "requires_human_review" && !assigned.has(j.id))
      .sort((a, b) => b.received_at.localeCompare(a.received_at)),
  };
}

/* ------------------------------------------------------------- analytics */

export interface PortalAnalytics {
  slug: PortalSlug;
  name: string;
  tasks: number;
  dryRunPassed: number;
  manual: number;
  failed: number;
  review: number;
  open: number;
  successRate: number | null;
  avgDurationMs: number | null;
  avgAttempts: number | null;
}

export interface Analytics {
  days: number;
  daily: {
    date: string;
    label: string;
    received: number;
    external: number;
    manual: number;
    executions: number;
    failedExecutions: number;
    review: number;
  }[];
  portals: PortalAnalytics[];
  failureReasons: { code: string; count: number }[];
  totals: {
    jobs: number;
    tasks: number;
    executions: number;
    successRate: number | null;
    failureRate: number | null;
    avgDurationMs: number | null;
    avgAttempts: number | null;
    humanReview: number;
    avgWaitMs: number | null;
    avgCompletionMs: number | null;
    retries: number;
  };
  weekday: { label: string; jobs: number }[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function analytics(s: DemoState, days: number, now: Date): Analytics {
  const since = windowStart(now, days).toISOString();
  const jobs = s.jobs.filter((j) => j.received_at >= since);
  const tasks = s.tasks.filter((t) => t.created_at >= since);
  const execs = s.executions.filter((e) => e.started_at >= since);
  const buckets = buildDayBuckets(now, days);
  const index = new Map(buckets.map((b, i) => [b.date, i]));
  const daily = buckets.map((b) => ({
    ...b,
    received: 0,
    external: 0,
    manual: 0,
    executions: 0,
    failedExecutions: 0,
    review: 0,
  }));
  for (const j of jobs) {
    const i = index.get(utcDay(j.received_at));
    if (i === undefined) continue;
    daily[i].received++;
    daily[i][j.source_type]++;
  }
  for (const e of execs) {
    const i = index.get(utcDay(e.started_at));
    if (i === undefined) continue;
    daily[i].executions++;
    if (e.status === "failed") daily[i].failedExecutions++;
  }
  for (const t of tasks) {
    if (t.status !== "human_review") continue;
    const i = index.get(utcDay(t.updated_at));
    if (i !== undefined) daily[i].review++;
  }

  const finished = (ts: DemoTask[]) =>
    ts.filter((t) => ["submitted", "failed", "human_review"].includes(t.status) && !isManualSubmission(t));
  const portals: PortalAnalytics[] = PORTALS.map((p) => {
    const pt = tasks.filter((t) => t.portal_slug === p.slug);
    const fin = finished(pt);
    const ok = fin.filter((t) => t.status === "submitted").length;
    return {
      slug: p.slug,
      name: p.name,
      tasks: pt.length,
      dryRunPassed: pt.filter((t) => t.status === "submitted" && t.execution_mode === "dry_run").length,
      manual: pt.filter(isManualSubmission).length,
      failed: pt.filter((t) => t.status === "failed").length,
      review: pt.filter((t) => t.status === "human_review").length,
      open: pt.filter((t) => ["pending", "processing", "retry_scheduled"].includes(t.status)).length,
      successRate: fin.length ? ok / fin.length : null,
      avgDurationMs: mean(
        execs
          .filter((e) => e.portal_slug === p.slug && e.status === "succeeded" && e.duration_ms !== null)
          .map((e) => e.duration_ms!),
      ),
      avgAttempts: mean(fin.map((t) => t.attempt_count).filter((n) => n > 0)),
    };
  });

  const codes = new Map<string, number>();
  for (const e of execs)
    if (e.status === "failed" && e.error_code) codes.set(e.error_code, (codes.get(e.error_code) ?? 0) + 1);
  const firstStart = new Map<string, number>();
  for (const e of execs) {
    const t = new Date(e.started_at).getTime();
    if (!firstStart.has(e.task_id) || t < firstStart.get(e.task_id)!) firstStart.set(e.task_id, t);
  }
  const fin = finished(tasks);
  const ok = fin.filter((t) => t.status === "submitted").length;
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdayCounts = weekdayNames.map(() => ({ jobs: 0, days: new Set<string>() }));
  for (const j of jobs) {
    const d = new Date(j.received_at);
    weekdayCounts[d.getUTCDay()].jobs++;
    weekdayCounts[d.getUTCDay()].days.add(utcDay(d));
  }

  return {
    days,
    daily,
    portals,
    failureReasons: [...codes.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    totals: {
      jobs: jobs.length,
      tasks: tasks.length,
      executions: execs.length,
      successRate: fin.length ? ok / fin.length : null,
      failureRate: execs.filter((e) => e.status !== "running").length
        ? execs.filter((e) => e.status === "failed").length / execs.filter((e) => e.status !== "running").length
        : null,
      avgDurationMs: mean(
        execs.filter((e) => e.status === "succeeded" && e.duration_ms !== null).map((e) => e.duration_ms!),
      ),
      avgAttempts: mean(fin.map((t) => t.attempt_count).filter((n) => n > 0)),
      humanReview: tasks.filter((t) => t.status === "human_review").length,
      avgWaitMs: mean(
        tasks.filter((t) => firstStart.has(t.id)).map((t) => firstStart.get(t.id)! - new Date(t.created_at).getTime()),
      ),
      avgCompletionMs: mean(
        tasks
          .filter((t) => t.completed_at && !isManualSubmission(t))
          .map((t) => new Date(t.completed_at!).getTime() - new Date(t.created_at).getTime()),
      ),
      retries: execs.filter((e) => e.attempt > 1).length,
    },
    weekday: [1, 2, 3, 4, 5, 6, 0].map((d) => ({
      label: weekdayNames[d],
      jobs: weekdayCounts[d].days.size ? Math.round(weekdayCounts[d].jobs / weekdayCounts[d].days.size) : 0,
    })),
  };
}

/* ----------------------------------------------------------------- audit */

export interface AuditFilter {
  entity?: string;
  actor?: string;
  q?: string;
  days?: number;
}

export function auditRows(s: DemoState, f: AuditFilter, now: Date) {
  const since = f.days ? new Date(now.getTime() - f.days * DAY).toISOString() : "";
  const term = f.q?.trim().toLowerCase() ?? "";
  return s.audit
    .filter((a) => {
      if (f.entity && a.entity_type !== f.entity) return false;
      if (f.actor === "system" ? a.actor_id !== null : f.actor ? a.actor_id !== f.actor : false) return false;
      if (since && a.created_at < since) return false;
      if (term && !`${a.action} ${a.entity_id ?? ""} ${JSON.stringify(a.changes ?? {})}`.toLowerCase().includes(term))
        return false;
      return true;
    })
    .sort((a, b) => b.id - a.id);
}

export function portalStats(s: DemoState, slug: PortalSlug) {
  const tasks = s.tasks.filter((t) => t.portal_slug === slug);
  const fin = tasks.filter((t) => ["submitted", "failed", "human_review"].includes(t.status) && !isManualSubmission(t));
  const execs = s.executions.filter((e) => e.portal_slug === slug);
  const lastOk =
    execs.filter((e) => e.status === "succeeded").sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null;
  return {
    tasks: tasks.length,
    dryRunPassed: tasks.filter((t) => t.status === "submitted" && t.execution_mode === "dry_run").length,
    manual: tasks.filter(isManualSubmission).length,
    open: tasks.filter((t) => ["pending", "processing", "retry_scheduled"].includes(t.status)).length,
    failed: tasks.filter((t) => t.status === "failed").length,
    review: tasks.filter((t) => t.status === "human_review").length,
    successRate: fin.length ? fin.filter((t) => t.status === "submitted").length / fin.length : null,
    lastSuccess: lastOk,
    recentFailures: execs
      .filter((e) => e.status === "failed")
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 8),
    running: execs.find((e) => e.status === "running") ?? null,
  };
}

export { getPortal };
