/**
 * Demo data layer engine: every mutation the UI can make, as pure functions
 * (state in → new state out). The rules mirror the database functions in
 * supabase/migrations (ingest_job, create_manual_job, update_job, RLS roles):
 * organisation-scoped duplicate detection, immutable provenance, edit locks,
 * one task per job and portal, submitted tasks are final, explicit routing
 * only. Portal executions are SIMULATED and always labelled so.
 */
import { can, isAppRole, type AppRole, type Permission } from "@/lib/auth/permissions";
import { isPortalSlug, type PortalSlug } from "@/lib/domain/portals";
import type { JobPriority, JobSourceType, JobStatus, TaskStatus } from "@/lib/domain/status";
import { backoffSeconds, deriveJobStatus } from "@/lib/jobs/status";
import { EXECUTION_STEPS, PORTAL_SPECS, SIMULATED_FAILURES } from "@/lib/portals/specs";
import { NO_ROUTE_REASON, routeJob } from "@/lib/routing/rules";
import { automationResultSchema, type AutomationResult, type AutomationTaskPayload } from "@/lib/automation/contract";
import { uuidV4 } from "@/lib/uuid";

import { between, pick, type Rng } from "./rng";
import type {
  DemoAssignment,
  DemoAttachment,
  DemoExecution,
  DemoIntegrationEvent,
  DemoJob,
  DemoPortal,
  DemoRoutingRule,
  DemoState,
  DemoTask,
  DemoUser,
  ExecutionStep,
  IntegrationSettings,
  SimulatedOutcome,
  SystemSettings,
} from "./types";

/* ------------------------------------------------------------------ errors */

export type EngineErrorCode =
  | "forbidden"
  | "not_found"
  | "unknown_portal"
  | "portal_disabled"
  | "stale"
  | "locked"
  | "ack_required"
  | "archived"
  | "already_in_state"
  | "invalid";

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/* ----------------------------------------------------------------- context */

export interface Ctx {
  now: Date;
  /** null for system actors (simulated worker, simulated intake). */
  actorId: string | null;
  actorType?: "user" | "system" | "integration" | "worker";
}

const iso = (d: Date) => d.toISOString();

/** Shallow working copy: arrays are copied, entities are replaced, never mutated. */
function draft(s: DemoState): DemoState {
  return {
    ...s,
    users: [...s.users],
    portals: [...s.portals],
    routing_rules: [...s.routing_rules],
    jobs: [...s.jobs],
    contacts: [...s.contacts],
    attachments: [...s.attachments],
    assignments: [...s.assignments],
    tasks: [...s.tasks],
    executions: [...s.executions],
    events: [...s.events],
    audit: [...s.audit],
    counters: { ...s.counters },
    settings: { ...s.settings, simulation: { ...s.settings.simulation } },
    integrations: structuredCloneSafe(s.integrations),
  };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function replace<T extends { id: string }>(list: T[], id: string, changes: Partial<T>): T {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new EngineError("not_found", "Record not found.");
  const next = { ...list[i], ...changes };
  list[i] = next;
  return next;
}

export function currentUser(s: DemoState) {
  return s.users.find((u) => u.id === s.current_user_id) ?? s.users[0];
}

function assertCan(s: DemoState, ctx: Ctx, permission: Permission) {
  if ((ctx.actorType ?? "user") !== "user") return;
  const user = s.users.find((u) => u.id === ctx.actorId);
  if (!user || !can(user.role, permission)) {
    throw new EngineError("forbidden", "Your role does not permit this action.");
  }
  if (!user.is_active) {
    throw new EngineError("forbidden", "This user account is deactivated.");
  }
}

function audit(
  s: DemoState,
  ctx: Ctx,
  action: string,
  entityType: string,
  entityId: string | null,
  changes: Record<string, unknown> | null,
) {
  s.counters.audit += 1;
  s.audit.push({
    id: s.counters.audit,
    actor_id: ctx.actorId,
    actor_type: ctx.actorType ?? (ctx.actorId ? "user" : "system"),
    action,
    entity_type: entityType,
    entity_id: entityId,
    changes,
    created_at: iso(ctx.now),
  });
}

function diff<T extends object>(before: T, after: T, keys: (keyof T)[]) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[String(k)] = { from: before[k], to: after[k] };
  }
  return out;
}

/* ------------------------------------------------------------------ portals */

function portalOrThrow(s: DemoState, slug: string): DemoPortal {
  const p = s.portals.find((x) => x.slug === slug);
  if (!p) throw new EngineError("unknown_portal", `Unknown destination portal: ${slug}.`);
  return p;
}

function resolveDestinations(s: DemoState, slugs: string[]): PortalSlug[] {
  const out: PortalSlug[] = [];
  for (const slug of slugs) {
    if (!isPortalSlug(slug)) throw new EngineError("unknown_portal", `Unknown destination portal: ${slug}.`);
    const p = portalOrThrow(s, slug);
    if (!p.is_enabled) throw new EngineError("portal_disabled", `Destination portal is disabled: ${p.name}.`);
    if (!out.includes(slug)) out.push(slug);
  }
  return out;
}

/* -------------------------------------------------------------- job status */

function jobTasks(s: DemoState, jobId: string) {
  return s.tasks.filter((t) => t.job_id === jobId);
}

/** Recompute the overall job status from its tasks; audit the change. */
export function refreshJobStatus(s: DemoState, ctx: Ctx, jobId: string): JobStatus {
  const job = s.jobs.find((j) => j.id === jobId);
  if (!job) return "received";
  const next = deriveJobStatus(jobTasks(s, jobId), job.status);
  if (next !== job.status) {
    const reviewReason =
      next === "requires_human_review"
        ? (job.review_reason ??
          (jobTasks(s, jobId).every((t) => t.status === "cancelled")
            ? "All destination submissions were cancelled."
            : "A portal submission needs human review."))
        : null;
    replace(s.jobs, jobId, { status: next, review_reason: reviewReason, updated_at: iso(ctx.now) });
    audit(s, ctx, "jobs.updated", "jobs", jobId, { status: { from: job.status, to: next } });
  }
  return next;
}

/* --------------------------------------------------------- destinations */

function addDestination(
  s: DemoState,
  ctx: Ctx,
  job: DemoJob,
  slug: PortalSlug,
  source: DemoAssignment["source"],
  reason: string,
  ruleId: string | null = null,
): boolean {
  if (s.assignments.some((a) => a.job_id === job.id && a.portal_slug === slug)) return false;
  const assignment: DemoAssignment = {
    id: uuidV4(),
    job_id: job.id,
    portal_slug: slug,
    source,
    routing_rule_id: ruleId,
    reason,
    assigned_by: ctx.actorType === "user" || !ctx.actorType ? ctx.actorId : null,
    created_at: iso(ctx.now),
  };
  s.assignments.push(assignment);
  audit(s, ctx, "job_portal_assignments.created", "job_portal_assignments", assignment.id, {
    job_id: job.id,
    portal: slug,
    source,
    reason,
  });
  const task: DemoTask = {
    id: uuidV4(),
    job_id: job.id,
    portal_slug: slug,
    assignment_id: assignment.id,
    status: "pending",
    execution_mode: "dry_run",
    idempotency_key: `${job.id}:${slug}`,
    attempt_count: 0,
    max_attempts: s.settings.retry_limit,
    next_attempt_at: null,
    locked_by: null,
    locked_at: null,
    started_at: null,
    completed_at: null,
    last_error: null,
    confirmation_reference: null,
    review_note: null,
    created_at: iso(ctx.now),
    updated_at: iso(ctx.now),
  };
  s.tasks.push(task);
  return true;
}

/** Apply routing rules to a job with no destinations. Never assigns "all portals". */
function applyRouting(s: DemoState, ctx: Ctx, job: DemoJob): string[] {
  const decisions = routeJob(job, s.routing_rules);
  for (const d of decisions) {
    const p = s.portals.find((x) => x.slug === d.portal_slug);
    if (!p?.is_enabled) continue;
    addDestination(s, ctx, job, d.portal_slug, "routing_rule", d.reason, d.rule_id);
  }
  const assigned = s.assignments.filter((a) => a.job_id === job.id).map((a) => a.portal_slug);
  if (assigned.length === 0) {
    replace(s.jobs, job.id, {
      status: "requires_human_review",
      review_reason: NO_ROUTE_REASON,
      updated_at: iso(ctx.now),
    });
    audit(s, ctx, "jobs.routing_unmatched", "jobs", job.id, { reason: NO_ROUTE_REASON });
  } else {
    replace(s.jobs, job.id, { review_reason: null });
    refreshJobStatus(s, ctx, job.id);
  }
  return assigned;
}

/* ------------------------------------------------------------------ ingest */

export interface JobFieldsInput {
  customer_name: string;
  service_address: string;
  category: string;
  priority: JobPriority;
  description: string;
  instructions: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  technician: string | null;
}

export interface IngestInput {
  job: JobFieldsInput & { source_type: JobSourceType; source: string; external_job_id: string | null };
  contact: { name: string; email: string | null; phone: string | null } | null;
  destinations: string[];
  attachments: Omit<DemoAttachment, "id" | "job_id" | "created_at" | "uploaded_by">[];
  assignmentReason: string;
  rawPayload: unknown;
  submissionToken: string | null;
  jobId?: string;
}

export type IngestResult =
  | {
      created: true;
      job_id: string;
      reference: string;
      status: JobStatus;
      destinations: string[];
      routing: "explicit" | "routing_rule" | "awaiting_routing" | "human_review";
    }
  | { created: false; job_id: string; reference: string; status: JobStatus; payload_matches: boolean };

/** The single ingestion path for manual and external jobs (mirrors public.ingest_job). */
export function ingestJob(state: DemoState, ctx: Ctx, input: IngestInput): { state: DemoState; result: IngestResult } {
  const destinations = resolveDestinations(state, input.destinations);
  const orgId = state.organisation.id;

  const existing = state.jobs.find(
    (j) =>
      j.organisation_id === orgId &&
      ((input.submissionToken && j.submission_token === input.submissionToken) ||
        (input.job.external_job_id &&
          j.source === input.job.source &&
          j.external_job_id === input.job.external_job_id)),
  );
  if (existing) {
    return {
      state,
      result: {
        created: false,
        job_id: existing.id,
        reference: existing.reference,
        status: existing.status,
        payload_matches: JSON.stringify(existing.raw_payload) === JSON.stringify(input.rawPayload),
      },
    };
  }

  const s = draft(state);
  s.counters.job_reference += 1;
  const now = iso(ctx.now);
  const job: DemoJob = {
    id: input.jobId ?? uuidV4(),
    reference: `JS-${String(s.counters.job_reference).padStart(6, "0")}`,
    organisation_id: orgId,
    source_type: input.job.source_type,
    source: input.job.source,
    external_job_id: input.job.external_job_id,
    customer_name: input.job.customer_name,
    service_address: input.job.service_address,
    category: input.job.category,
    priority: input.job.priority,
    description: input.job.description,
    instructions: input.job.instructions,
    scheduled_date: input.job.scheduled_date,
    scheduled_time: input.job.scheduled_time,
    technician: input.job.technician,
    status: destinations.length > 0 ? "ready" : "received",
    review_reason: null,
    received_at: now,
    archived_at: null,
    archived_by: null,
    created_by: ctx.actorType === "user" || !ctx.actorType ? ctx.actorId : null,
    raw_payload: input.rawPayload,
    submission_token: input.submissionToken,
    created_at: now,
    updated_at: now,
  };
  s.jobs.push(job);
  audit(s, ctx, "jobs.created", "jobs", job.id, {
    reference: job.reference,
    source_type: job.source_type,
    source: job.source,
    external_job_id: job.external_job_id,
    customer_name: job.customer_name,
  });

  if (input.contact?.name) {
    s.contacts.push({ id: uuidV4(), job_id: job.id, ...input.contact, is_primary: true, created_at: now });
  }
  for (const a of input.attachments) {
    s.attachments.push({ ...a, id: uuidV4(), job_id: job.id, uploaded_by: job.created_by, created_at: now });
  }

  let routing: Extract<IngestResult, { created: true }>["routing"] = "explicit";
  if (destinations.length > 0) {
    for (const slug of destinations) addDestination(s, ctx, job, slug, "explicit", input.assignmentReason);
  } else if (s.settings.auto_routing) {
    const assigned = applyRouting(s, ctx, job);
    routing = assigned.length > 0 ? "routing_rule" : "human_review";
  } else {
    routing = "awaiting_routing";
  }

  const final = s.jobs.find((j) => j.id === job.id)!;
  return {
    state: s,
    result: {
      created: true,
      job_id: job.id,
      reference: job.reference,
      status: final.status,
      destinations: s.assignments.filter((a) => a.job_id === job.id).map((a) => a.portal_slug),
      routing,
    },
  };
}

/** Create Job form (mirrors public.create_manual_job). */
export function createManualJob(
  state: DemoState,
  ctx: Ctx,
  input: Omit<IngestInput, "assignmentReason" | "rawPayload" | "job"> & { job: JobFieldsInput },
) {
  assertCan(state, ctx, "jobs.create");
  if (!input.submissionToken) throw new EngineError("invalid", "The form expired. Reload the page and try again.");
  return ingestJob(state, ctx, {
    ...input,
    job: { ...input.job, source_type: "manual", source: "manual", external_job_id: null },
    assignmentReason: "Selected on the Create Job form",
    rawPayload: null,
  });
}

/* -------------------------------------------------------------------- edit */

export interface UpdateJobInput {
  jobId: string;
  expectedUpdatedAt: string;
  fields: JobFieldsInput;
  /** undefined = unchanged, null = remove the primary contact. */
  contact: { name: string; email: string | null; phone: string | null } | null | undefined;
  addDestinations: string[];
  removeDestinations: string[];
  addAttachments: IngestInput["attachments"];
  removeAttachmentIds: string[];
  acknowledgeSubmitted: boolean;
}

const EDITABLE: (keyof JobFieldsInput)[] = [
  "customer_name",
  "service_address",
  "category",
  "priority",
  "description",
  "instructions",
  "scheduled_date",
  "scheduled_time",
  "technician",
];

/** Edit Job (mirrors public.update_job). Never re-queues a portal that has the job. */
export function updateJob(state: DemoState, ctx: Ctx, input: UpdateJobInput) {
  assertCan(state, ctx, "jobs.edit");
  const job = state.jobs.find((j) => j.id === input.jobId);
  if (!job) throw new EngineError("not_found", "Job not found.");
  if (job.archived_at) throw new EngineError("archived", "Archived jobs cannot be edited. Restore the job first.");
  if (job.updated_at !== input.expectedUpdatedAt) {
    throw new EngineError("stale", "This job was changed while you were editing. Reload the page and try again.");
  }
  const tasks = jobTasks(state, job.id);
  if (tasks.some((t) => t.status === "processing")) {
    throw new EngineError("locked", "A portal submission for this job is in progress, so it cannot be edited.");
  }
  const changes = diff(job as unknown as JobFieldsInput, input.fields, EDITABLE);
  const submitted = tasks.filter((t) => t.status === "submitted").length;
  if (submitted > 0 && Object.keys(changes).length > 0 && !input.acknowledgeSubmitted) {
    throw new EngineError(
      "ack_required",
      `${submitted} portal(s) already received this job. Confirm that your edits will not be re-sent.`,
    );
  }
  for (const slug of input.removeDestinations) {
    const t = tasks.find((x) => x.portal_slug === slug);
    if (t && (t.status !== "pending" || t.attempt_count > 0)) {
      throw new EngineError("locked", `The ${slug} submission has already been attempted and cannot be removed.`);
    }
  }
  const toAdd = resolveDestinations(state, input.addDestinations);

  const s = draft(state);
  const now = iso(ctx.now);
  if (Object.keys(changes).length > 0) {
    replace(s.jobs, job.id, { ...input.fields });
    audit(s, ctx, "jobs.updated", "jobs", job.id, changes);
  }

  if (input.contact !== undefined) {
    const primary = s.contacts.findIndex((c) => c.job_id === job.id && c.is_primary);
    if (input.contact === null || !input.contact.name) {
      if (primary >= 0) s.contacts.splice(primary, 1);
    } else if (primary >= 0) {
      s.contacts[primary] = { ...s.contacts[primary], ...input.contact };
    } else {
      s.contacts.push({ id: uuidV4(), job_id: job.id, ...input.contact, is_primary: true, created_at: now });
    }
  }

  for (const slug of input.removeDestinations) {
    const t = s.tasks.find((x) => x.job_id === job.id && x.portal_slug === slug);
    const a = s.assignments.find((x) => x.job_id === job.id && x.portal_slug === slug);
    if (t) s.tasks.splice(s.tasks.indexOf(t), 1);
    if (a) {
      s.assignments.splice(s.assignments.indexOf(a), 1);
      audit(s, ctx, "job_portal_assignments.deleted", "job_portal_assignments", a.id, { job_id: job.id, portal: slug });
    }
  }
  const current = s.jobs.find((j) => j.id === job.id)!;
  for (const slug of toAdd) {
    addDestination(s, ctx, current, slug, "manual_override", "Added by an operator when editing the job");
  }

  for (const a of input.addAttachments) {
    s.attachments.push({ ...a, id: uuidV4(), job_id: job.id, uploaded_by: ctx.actorId, created_at: now });
  }
  const removed = s.attachments.filter((a) => a.job_id === job.id && input.removeAttachmentIds.includes(a.id));
  s.attachments = s.attachments.filter((a) => !removed.includes(a));

  // Destinations changed: clear a "no route" review flag once portals are assigned.
  if (toAdd.length > 0 && current.status === "requires_human_review") replace(s.jobs, job.id, { review_reason: null });
  refreshJobStatus(s, ctx, job.id);
  replace(s.jobs, job.id, { updated_at: now === job.updated_at ? new Date(ctx.now.getTime() + 1).toISOString() : now });

  return {
    state: s,
    removedBlobKeys: removed.map((r) => r.blob_key).filter((k): k is string => Boolean(k)),
    alreadySubmitted: submitted,
  };
}

/* ----------------------------------------------------------------- archive */

export function setJobArchived(state: DemoState, ctx: Ctx, jobId: string, archive: boolean) {
  assertCan(state, ctx, "jobs.archive");
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) throw new EngineError("not_found", "Job not found.");
  if (Boolean(job.archived_at) === archive) {
    throw new EngineError("already_in_state", archive ? "This job is already archived." : "This job is not archived.");
  }
  if (archive && jobTasks(state, jobId).some((t) => t.status === "processing")) {
    throw new EngineError(
      "locked",
      "A portal submission for this job is in progress. Wait for it to finish before archiving.",
    );
  }
  const s = draft(state);
  replace(s.jobs, jobId, {
    archived_at: archive ? iso(ctx.now) : null,
    archived_by: archive ? ctx.actorId : null,
    updated_at: iso(ctx.now),
  });
  audit(s, ctx, archive ? "jobs.archived" : "jobs.restored", "jobs", jobId, null);
  return s;
}

/* ----------------------------------------------------------------- routing */

/** Route jobs that have no destinations yet (status received). */
export function runRouting(state: DemoState, ctx: Ctx, jobIds?: string[]) {
  assertCan(state, ctx, "jobs.edit");
  const s = draft(state);
  const targets = s.jobs.filter(
    (j) =>
      !j.archived_at &&
      (jobIds ? jobIds.includes(j.id) : j.status === "received") &&
      !s.assignments.some((a) => a.job_id === j.id),
  );
  let routed = 0;
  let review = 0;
  for (const job of targets) {
    const assigned = applyRouting(s, ctx, job);
    if (assigned.length > 0) routed++;
    else review++;
  }
  return { state: s, routed, review };
}

/** Human review resolution for an unrouted job: assign portals explicitly. */
export function assignDestinations(state: DemoState, ctx: Ctx, jobId: string, slugs: string[], note: string) {
  assertCan(state, ctx, "jobs.edit");
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) throw new EngineError("not_found", "Job not found.");
  if (job.archived_at) throw new EngineError("archived", "Restore the job before assigning portals.");
  const toAdd = resolveDestinations(state, slugs);
  if (toAdd.length === 0) throw new EngineError("invalid", "Choose at least one portal.");
  const s = draft(state);
  const reason = note.trim() ? `Assigned during human review: ${note.trim()}` : "Assigned during human review";
  for (const slug of toAdd) addDestination(s, ctx, job, slug, "manual_override", reason);
  replace(s.jobs, jobId, { review_reason: null, updated_at: iso(ctx.now) });
  // Re-derive from tasks (no-route review is cleared once portals exist).
  const j = s.jobs.find((x) => x.id === jobId)!;
  replace(s.jobs, jobId, {
    status: deriveJobStatus(jobTasks(s, jobId), j.status === "requires_human_review" ? "received" : j.status),
  });
  audit(s, ctx, "jobs.review_resolved", "jobs", jobId, { assigned: toAdd, note: note.trim() || null });
  return s;
}

export interface RuleInput {
  name: string;
  description: string;
  priority: number;
  is_active: boolean;
  match_customer: string | null;
  match_category: string | null;
  match_priority: JobPriority | null;
  match_location: string | null;
  portal_slug: PortalSlug;
}

function validateRule(r: RuleInput) {
  if (!r.name.trim()) throw new EngineError("invalid", "Give the rule a name.");
  if (!r.match_customer && !r.match_category && !r.match_priority && !r.match_location) {
    throw new EngineError(
      "invalid",
      "A rule needs at least one condition. JobSync never routes every job to a portal.",
    );
  }
  if (!isPortalSlug(r.portal_slug)) throw new EngineError("unknown_portal", "Choose a destination portal.");
  if (!Number.isInteger(r.priority) || r.priority < 0 || r.priority > 10000) {
    throw new EngineError("invalid", "Priority must be a whole number between 0 and 10000.");
  }
}

export function saveRoutingRule(state: DemoState, ctx: Ctx, id: string | null, input: RuleInput) {
  assertCan(state, ctx, "routing_rules.manage");
  validateRule(input);
  const s = draft(state);
  const now = iso(ctx.now);
  if (id) {
    const before = s.routing_rules.find((r) => r.id === id);
    if (!before) throw new EngineError("not_found", "Rule not found.");
    const after = replace(s.routing_rules, id, { ...input, updated_at: now });
    audit(
      s,
      ctx,
      "routing_rules.updated",
      "routing_rules",
      id,
      diff(before, after, Object.keys(input) as (keyof DemoRoutingRule)[]),
    );
  } else {
    const rule: DemoRoutingRule = { ...input, id: uuidV4(), created_by: ctx.actorId, created_at: now, updated_at: now };
    s.routing_rules.push(rule);
    audit(s, ctx, "routing_rules.created", "routing_rules", rule.id, { ...input });
  }
  return s;
}

export function deleteRoutingRule(state: DemoState, ctx: Ctx, id: string) {
  assertCan(state, ctx, "routing_rules.manage");
  const rule = state.routing_rules.find((r) => r.id === id);
  if (!rule) throw new EngineError("not_found", "Rule not found.");
  const s = draft(state);
  s.routing_rules = s.routing_rules.filter((r) => r.id !== id);
  // Past decisions keep their recorded reason; the rule link is cleared.
  s.assignments = s.assignments.map((a) => (a.routing_rule_id === id ? { ...a, routing_rule_id: null } : a));
  audit(s, ctx, "routing_rules.deleted", "routing_rules", id, { name: rule.name });
  return s;
}

/* ------------------------------------------------------------------ portals */

export interface PortalInput {
  base_url: string;
  is_enabled: boolean;
  automation_enabled: boolean;
  notes: string;
  timeout_seconds: number;
}

export function updatePortal(state: DemoState, ctx: Ctx, slug: string, input: PortalInput) {
  assertCan(state, ctx, "portals.manage");
  const portal = portalOrThrow(state, slug);
  let url: URL;
  try {
    url = new URL(input.base_url);
  } catch {
    throw new EngineError("invalid", "Enter a valid portal URL.");
  }
  if (url.protocol !== "https:") throw new EngineError("invalid", "Portal URLs must use https.");
  if (input.timeout_seconds < 10 || input.timeout_seconds > 600) {
    throw new EngineError("invalid", "Timeout must be between 10 and 600 seconds.");
  }
  const s = draft(state);
  const urlChanged = input.base_url !== portal.base_url;
  const after = replace(s.portals, portal.id, {
    ...input,
    // A different URL has not been tested: never keep an old "ok".
    ...(urlChanged
      ? {
          connection_status: "untested" as const,
          last_connection_test_at: null,
          last_connection_error: null,
          last_connection_latency_ms: null,
          last_connection_http_status: null,
        }
      : {}),
    updated_at: iso(ctx.now),
  });
  audit(
    s,
    ctx,
    "portals.updated",
    "portals",
    portal.id,
    diff(portal, after, ["base_url", "is_enabled", "automation_enabled", "notes", "timeout_seconds"]),
  );
  return s;
}

/** Store the outcome of a REAL connection test (performed by /api/portals/test). */
export function recordConnectionTest(
  state: DemoState,
  ctx: Ctx,
  slug: string,
  result: { ok: boolean; http_status: number | null; latency_ms: number | null; message: string; tested_url: string },
) {
  assertCan(state, ctx, "portals.manage");
  const portal = portalOrThrow(state, slug);
  if (result.tested_url !== portal.base_url) {
    throw new EngineError("stale", "The portal URL changed while the test was running. Test again.");
  }
  const s = draft(state);
  replace(s.portals, portal.id, {
    connection_status: result.ok ? "ok" : "failed",
    last_connection_test_at: iso(ctx.now),
    last_connection_error: result.ok ? null : result.message,
    last_connection_latency_ms: result.latency_ms,
    last_connection_http_status: result.http_status,
  });
  audit(s, ctx, "portals.connection_tested", "portals", portal.id, {
    ok: result.ok,
    http_status: result.http_status,
    message: result.message,
  });
  return s;
}

/* -------------------------------------------------------------- task actions */

const RETRYABLE_FROM: TaskStatus[] = ["failed", "human_review", "retry_scheduled", "cancelled"];

export function retryTask(state: DemoState, ctx: Ctx, taskId: string) {
  assertCan(state, ctx, "queue.retry");
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new EngineError("not_found", "Task not found.");
  if (!RETRYABLE_FROM.includes(task.status)) {
    throw new EngineError(
      "locked",
      task.status === "submitted"
        ? "This portal already has the job. JobSync never submits it twice."
        : "Only failed, cancelled, scheduled or review tasks can be retried.",
    );
  }
  const job = state.jobs.find((j) => j.id === task.job_id);
  if (job?.archived_at) throw new EngineError("archived", "Restore the job before retrying.");
  const s = draft(state);
  replace(s.tasks, taskId, {
    status: "pending",
    next_attempt_at: null,
    // A manual retry grants one more attempt when the limit was reached.
    max_attempts: Math.max(task.max_attempts, task.attempt_count + 1),
    review_note: null,
    updated_at: iso(ctx.now),
  });
  audit(s, ctx, "submission_tasks.retry_requested", "submission_tasks", taskId, {
    portal: task.portal_slug,
    from: task.status,
  });
  if (job?.status === "requires_human_review") replace(s.jobs, job.id, { review_reason: null });
  refreshJobStatus(s, ctx, task.job_id);
  return s;
}

export function cancelTask(state: DemoState, ctx: Ctx, taskId: string, note: string) {
  assertCan(state, ctx, "queue.retry");
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new EngineError("not_found", "Task not found.");
  if (["submitted", "processing", "cancelled"].includes(task.status)) {
    throw new EngineError("locked", `A ${task.status} task cannot be cancelled.`);
  }
  const s = draft(state);
  replace(s.tasks, taskId, {
    status: "cancelled",
    next_attempt_at: null,
    review_note: note.trim() || null,
    updated_at: iso(ctx.now),
  });
  audit(s, ctx, "submission_tasks.cancelled", "submission_tasks", taskId, {
    portal: task.portal_slug,
    note: note.trim() || null,
  });
  refreshJobStatus(s, ctx, task.job_id);
  return s;
}

export function sendTaskToReview(state: DemoState, ctx: Ctx, taskId: string, note: string) {
  assertCan(state, ctx, "queue.retry");
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new EngineError("not_found", "Task not found.");
  if (!["pending", "retry_scheduled", "failed"].includes(task.status)) {
    throw new EngineError("locked", `A ${task.status} task cannot be sent to review.`);
  }
  if (!note.trim()) throw new EngineError("invalid", "Explain why this needs a person.");
  const s = draft(state);
  replace(s.tasks, taskId, {
    status: "human_review",
    next_attempt_at: null,
    review_note: note.trim(),
    updated_at: iso(ctx.now),
  });
  audit(s, ctx, "submission_tasks.escalated", "submission_tasks", taskId, {
    portal: task.portal_slug,
    note: note.trim(),
  });
  refreshJobStatus(s, ctx, task.job_id);
  return s;
}

/**
 * A person submitted the work order on the portal themselves. Recorded as a
 * manual submission with the reference they entered — never as automation.
 */
export function markSubmittedManually(state: DemoState, ctx: Ctx, taskId: string, reference: string, note: string) {
  assertCan(state, ctx, "queue.retry");
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new EngineError("not_found", "Task not found.");
  if (!["human_review", "failed"].includes(task.status)) {
    throw new EngineError("locked", "Only review or failed tasks can be completed manually.");
  }
  const ref = reference.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-_/]{2,40}$/.test(ref)) {
    throw new EngineError("invalid", "Enter the portal's confirmation reference (3–40 letters, digits or - _ /).");
  }
  const s = draft(state);
  const by = currentUser(s);
  replace(s.tasks, taskId, {
    status: "submitted",
    execution_mode: "live",
    confirmation_reference: ref,
    completed_at: iso(ctx.now),
    last_error: null,
    review_note: `Submitted manually on the portal by ${by.full_name}${note.trim() ? `: ${note.trim()}` : ""}`,
    updated_at: iso(ctx.now),
  });
  audit(s, ctx, "submission_tasks.submitted_manually", "submission_tasks", taskId, {
    portal: task.portal_slug,
    confirmation_reference: ref,
  });
  refreshJobStatus(s, ctx, task.job_id);
  return s;
}

/* ------------------------------------------------------- simulated worker */

const PRIORITY_RANK: Record<JobPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function planOutcome(s: DemoState, rng: Rng): SimulatedOutcome {
  const r = rng();
  const { failure_rate, human_review_rate } = s.settings.simulation;
  if (r < human_review_rate) {
    const f = pick(
      rng,
      SIMULATED_FAILURES.filter((x) => !x.retryable),
    );
    return { kind: "human_review", code: f.code, message: f.message, failStep: f.step };
  }
  if (r < human_review_rate + failure_rate) {
    const f = pick(
      rng,
      SIMULATED_FAILURES.filter((x) => x.retryable),
    );
    return { kind: "retryable", code: f.code, message: f.message, failStep: f.step };
  }
  return { kind: "success" };
}

function freeWorkerId(s: DemoState): string {
  const busy = new Set(s.executions.filter((e) => e.status === "running").map((e) => e.worker_id));
  for (let i = 1; i <= s.settings.max_concurrency; i++) if (!busy.has(`sim-worker-${i}`)) return `sim-worker-${i}`;
  return `sim-worker-${s.settings.max_concurrency + 1}`;
}

/** Final step list for a finished simulated attempt. */
export function finalSteps(
  outcome: SimulatedOutcome,
  hasAttachments: boolean,
  portalSupportsAttachments: boolean,
  start: Date,
  end: Date,
): ExecutionStep[] {
  const span = end.getTime() - start.getTime();
  const failAt = outcome.kind === "success" ? -1 : EXECUTION_STEPS.findIndex((x) => x.key === outcome.failStep);
  return EXECUTION_STEPS.map((step, i) => {
    const at = new Date(start.getTime() + (span * (i + 1)) / EXECUTION_STEPS.length).toISOString();
    if (failAt >= 0 && i > failAt) return { key: step.key, label: step.label, status: "pending", at: null };
    if (failAt === i && outcome.kind !== "success") {
      return { key: step.key, label: step.label, status: "failed", at, detail: `${outcome.code}: ${outcome.message}` };
    }
    if (step.key === "attachments" && (!hasAttachments || !portalSupportsAttachments)) {
      return {
        key: step.key,
        label: step.label,
        status: "skipped",
        at,
        detail: !hasAttachments ? "No attachments on this job." : "This portal does not accept attachments.",
      };
    }
    if (step.key === "submit") {
      return {
        key: step.key,
        label: step.label,
        status: "skipped",
        at,
        detail: "Dry run: the final submit button was not clicked.",
      };
    }
    if (step.key === "confirm") {
      return {
        key: step.key,
        label: step.label,
        status: "skipped",
        at,
        detail: "Dry run: no portal reference exists.",
      };
    }
    return { key: step.key, label: step.label, status: "done", at, detail: "Simulated" };
  });
}

/* ------------------------------------------------- worker contract (results) */

/** The structured task a worker receives for one attempt (see src/lib/automation/contract.ts). */
export function buildTaskPayload(
  s: DemoState,
  exec: Pick<DemoExecution, "id" | "task_id" | "attempt" | "mode">,
): AutomationTaskPayload | null {
  const task = s.tasks.find((t) => t.id === exec.task_id);
  const job = task && s.jobs.find((j) => j.id === task.job_id);
  const portal = task && s.portals.find((p) => p.slug === task.portal_slug);
  if (!task || !job || !portal) return null;
  const contact = s.contacts.find((c) => c.job_id === job.id && c.is_primary) ?? null;
  return {
    execution_id: exec.id,
    task_id: task.id,
    idempotency_key: task.idempotency_key,
    execution_mode: exec.mode,
    portal: { slug: portal.slug, base_url: portal.base_url, timeout_seconds: portal.timeout_seconds },
    attempt: exec.attempt,
    job: {
      id: job.id,
      reference: job.reference,
      external_job_id: job.external_job_id,
      source: job.source,
      customer_name: job.customer_name,
      service_address: job.service_address,
      category: job.category,
      priority: job.priority,
      description: job.description,
      instructions: job.instructions,
      scheduled_date: job.scheduled_date,
      scheduled_time: job.scheduled_time,
      technician: job.technician,
      contact: contact ? { name: contact.name, email: contact.email, phone: contact.phone } : null,
    },
    attachments: s.attachments
      .filter((a) => a.job_id === job.id)
      .map((a) => ({
        id: a.id,
        file_name: a.file_name,
        content_type: a.content_type,
        size_bytes: a.size_bytes,
        location: a.blob_key ? ("browser_storage" as const) : ("url" as const),
      })),
  };
}

/** The result the simulated worker reports for a finished attempt (same contract a real worker uses). */
export function simulatedResult(s: DemoState, exec: DemoExecution, end: Date): AutomationResult {
  const outcome = exec.plan!.outcome;
  const portal = s.portals.find((p) => p.slug === exec.portal_slug);
  const hasAttachments = s.attachments.some((a) => a.job_id === exec.job_id);
  return {
    execution_id: exec.id,
    job_id: exec.job_id,
    portal: exec.portal_slug,
    execution_mode: "dry_run",
    status: outcome.kind === "success" ? "dry_run_passed" : outcome.kind === "human_review" ? "needs_review" : "failed",
    attempt: exec.attempt,
    confirmation_reference: null,
    started_at: exec.started_at,
    completed_at: end.toISOString(),
    screenshot_url: null,
    error:
      outcome.kind === "success"
        ? null
        : { code: outcome.code, message: outcome.message, retryable: outcome.kind === "retryable" },
    steps: finalSteps(
      outcome,
      hasAttachments,
      PORTAL_SPECS[exec.portal_slug].supportsAttachments && Boolean(portal),
      new Date(exec.started_at),
      end,
    ),
    simulated: true,
  };
}

export type ResultOutcome =
  | { outcome: "applied"; task_status: TaskStatus; job_status: JobStatus }
  | { outcome: "duplicate"; message: string }
  | { outcome: "rejected"; reasons: string[] };

const RESULT_TO_EXECUTION: Record<AutomationResult["status"], DemoExecution["status"]> = {
  dry_run_passed: "succeeded",
  submitted: "succeeded",
  failed: "failed",
  needs_review: "failed",
};

/** Validate a worker result against the schema AND the execution it claims to finish. */
function checkResult(
  s: DemoState,
  input: unknown,
): { ok: true; result: AutomationResult; exec: DemoExecution } | { ok: false; reasons: string[]; duplicate?: boolean } {
  const parsed = automationResultSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, reasons: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  const r = parsed.data;
  const exec = s.executions.find((e) => e.id === r.execution_id);
  if (!exec) return { ok: false, reasons: [`execution_id: no execution ${r.execution_id} exists.`] };
  const reasons: string[] = [];
  if (exec.job_id !== r.job_id) reasons.push("job_id: does not match the execution.");
  if (exec.portal_slug !== r.portal) reasons.push(`portal: the execution is for ${exec.portal_slug}, not ${r.portal}.`);
  if (exec.attempt !== r.attempt) reasons.push(`attempt: the execution is attempt ${exec.attempt}, not ${r.attempt}.`);
  if (exec.mode !== r.execution_mode)
    reasons.push(`execution_mode: the execution ran as ${exec.mode}; a result cannot change that.`);
  if (Date.parse(r.started_at) !== Date.parse(exec.started_at))
    reasons.push("started_at: does not match the execution.");
  if (exec.simulated && !r.simulated)
    reasons.push("simulated: this execution ran in the demo; its result must be marked simulated.");
  if (reasons.length) return { ok: false, reasons };
  if (exec.status !== "running") {
    const same = exec.status === RESULT_TO_EXECUTION[r.status] && (exec.error_code ?? null) === (r.error?.code ?? null);
    return same
      ? { ok: false, reasons: ["This result was already applied. Nothing changed."], duplicate: true }
      : {
          ok: false,
          reasons: [`This execution already finished as ${exec.status}; a conflicting result is not applied.`],
        };
  }
  const task = s.tasks.find((t) => t.id === exec.task_id);
  if (task?.status === "submitted")
    return { ok: false, reasons: ["The portal task is already submitted; JobSync never applies a second submission."] };
  return { ok: true, result: r, exec };
}

/** Apply a validated result to its execution, task and job (mutates the draft). */
function applyResult(
  s: DemoState,
  exec: DemoExecution,
  r: AutomationResult,
): { task_status: TaskStatus; job_status: JobStatus } {
  const ctx: Ctx = { now: new Date(r.completed_at), actorId: null, actorType: "worker" };
  const end = new Date(r.completed_at);
  replace(s.executions, exec.id, {
    status: RESULT_TO_EXECUTION[r.status],
    completed_at: end.toISOString(),
    duration_ms: end.getTime() - new Date(exec.started_at).getTime(),
    confirmation_reference: r.confirmation_reference,
    screenshot_path: r.screenshot_url,
    error_code: r.error?.code ?? null,
    error_message: r.error?.message ?? null,
    steps: r.steps ?? exec.steps,
    plan: null,
  });
  const task = s.tasks.find((t) => t.id === exec.task_id);
  if (!task) return { task_status: "failed", job_status: "failed" };

  let status: TaskStatus;
  let next: string | null = null;
  let lastError: string | null = r.error ? `${r.error.code}: ${r.error.message}` : null;
  if (r.status === "dry_run_passed" || r.status === "submitted") {
    status = "submitted";
  } else if (r.status === "needs_review" || (r.error && !r.error.retryable)) {
    status = "human_review";
  } else if (task.attempt_count < task.max_attempts) {
    status = "retry_scheduled";
    next = new Date(
      end.getTime() + backoffSeconds(task.attempt_count, s.settings.backoff_base_seconds) * 1000,
    ).toISOString();
  } else {
    status = "failed";
    lastError = `${lastError} (retry limit of ${task.max_attempts} reached)`;
  }
  replace(s.tasks, task.id, {
    status,
    execution_mode: r.status === "submitted" ? "live" : task.execution_mode,
    confirmation_reference: r.status === "submitted" ? r.confirmation_reference : task.confirmation_reference,
    next_attempt_at: next,
    locked_by: null,
    locked_at: null,
    completed_at: status === "submitted" || status === "failed" ? end.toISOString() : null,
    last_error: lastError,
    updated_at: end.toISOString(),
  });
  const jobStatus = refreshJobStatus(s, ctx, task.job_id);

  const n8n = s.integrations.n8n;
  const eventType =
    status === "submitted"
      ? r.status === "submitted"
        ? "task.submitted"
        : "task.dry_run_passed"
      : status === "failed"
        ? "task.failed"
        : status === "human_review"
          ? "task.needs_review"
          : null;
  if (n8n.outbound_enabled && eventType && n8n.events.includes(eventType)) {
    const job = s.jobs.find((j) => j.id === task.job_id);
    s.events.push({
      id: uuidV4(),
      integration: "n8n",
      direction: "outbound",
      event_type: eventType,
      status: "not_sent",
      http_status: null,
      request_id: uuidV4(),
      idempotency_key: `${task.id}:${task.attempt_count}`,
      job_id: task.job_id,
      payload: {
        event: eventType,
        occurred_at: end.toISOString(),
        execution_id: exec.id,
        job_id: task.job_id,
        job_reference: job?.reference ?? null,
        external_job_id: job?.external_job_id ?? null,
        portal: task.portal_slug,
        task_status: status,
        attempt: task.attempt_count,
        execution_mode: r.execution_mode,
        confirmation_reference: r.confirmation_reference,
        error: r.error,
        simulated: r.simulated,
      },
      error: "Demo mode records outbound events but does not deliver them.",
      origin: "engine",
      created_at: end.toISOString(),
    });
  }
  return { task_status: status, job_status: jobStatus };
}

/**
 * The result-processing entry point for any worker: validate, check against
 * the execution, then apply. Idempotent: the same result twice is a no-op.
 */
export function processAutomationResult(state: DemoState, input: unknown, now: Date, origin: "worker" | "simulator") {
  const check = checkResult(state, input);
  const s = draft(state);
  const log = (status: DemoIntegrationEvent["status"], error: string | null) => {
    if (origin === "worker") return;
    const r = input as Partial<AutomationResult> | null;
    s.events.push({
      id: uuidV4(),
      integration: "worker",
      direction: "inbound",
      event_type: "automation.result",
      status,
      http_status: status === "accepted" ? 200 : status === "duplicate" ? 200 : 422,
      request_id: uuidV4(),
      idempotency_key: typeof r?.execution_id === "string" ? `${r.execution_id}:${r.attempt ?? "?"}` : null,
      job_id: typeof r?.job_id === "string" && s.jobs.some((j) => j.id === r.job_id) ? r.job_id : null,
      payload: input,
      error,
      origin: "simulator",
      created_at: now.toISOString(),
    });
  };
  if (!check.ok) {
    log(check.duplicate ? "duplicate" : "rejected", check.reasons.join(" "));
    const outcome: ResultOutcome = check.duplicate
      ? { outcome: "duplicate", message: check.reasons[0] }
      : { outcome: "rejected", reasons: check.reasons };
    return { state: origin === "worker" ? state : s, outcome };
  }
  const applied = applyResult(
    s,
    s.executions.find((e) => e.id === check.exec.id)!,
    check.result,
  );
  log("accepted", null);
  return { state: s, outcome: { outcome: "applied", ...applied } as ResultOutcome };
}

/** The simulated worker finishing an attempt: it reports through the same processor. */
function finishExecution(s: DemoState, exec: DemoExecution, now: Date) {
  const end = new Date(Math.min(now.getTime(), new Date(exec.plan!.ends_at).getTime()));
  const check = checkResult(s, simulatedResult(s, exec, end));
  if (check.ok)
    applyResult(
      s,
      s.executions.find((e) => e.id === exec.id)!,
      check.result,
    );
}

export interface TickSummary {
  started: number;
  finished: number;
}

/**
 * One scheduler tick of the simulated worker: finish attempts whose time is
 * up, then claim due tasks up to the concurrency limit, at most one running
 * attempt per portal (per-portal lock). Urgent jobs first.
 */
export function workerTick(state: DemoState, now: Date, rng: Rng): { state: DemoState; summary: TickSummary } {
  const due = state.executions.filter((e) => e.status === "running" && e.plan && new Date(e.plan.ends_at) <= now);
  const s = draft(state);
  for (const e of due)
    finishExecution(
      s,
      s.executions.find((x) => x.id === e.id)!,
      now,
    );

  let started = 0;
  if (s.settings.worker_running) {
    const running = s.executions.filter((e) => e.status === "running");
    let capacity = s.settings.max_concurrency - running.length;
    const locked = new Set<string>(running.map((e) => e.portal_slug));
    const portalBySlug = new Map(s.portals.map((p) => [p.slug, p]));
    const jobById = new Map(s.jobs.map((j) => [j.id, j]));
    const candidates = s.tasks
      .filter((t) => {
        if (t.status !== "pending" && t.status !== "retry_scheduled") return false;
        if (t.next_attempt_at && new Date(t.next_attempt_at) > now) return false;
        const p = portalBySlug.get(t.portal_slug);
        const j = jobById.get(t.job_id);
        return Boolean(p?.is_enabled && p.automation_enabled && j && !j.archived_at);
      })
      .sort(
        (a, b) =>
          PRIORITY_RANK[jobById.get(a.job_id)!.priority] - PRIORITY_RANK[jobById.get(b.job_id)!.priority] ||
          a.created_at.localeCompare(b.created_at),
      );

    for (const t of candidates) {
      if (capacity <= 0) break;
      if (locked.has(t.portal_slug)) continue;
      const spec = PORTAL_SPECS[t.portal_slug];
      const seconds = between(rng, spec.typicalSeconds[0], spec.typicalSeconds[1]) * s.settings.simulation.speed;
      const ms = Math.max(800, Math.min(seconds * 1000, s.settings.execution_timeout_seconds * 1000));
      const attempt = t.attempt_count + 1;
      const workerId = freeWorkerId(s);
      const exec: DemoExecution = {
        id: uuidV4(),
        task_id: t.id,
        job_id: t.job_id,
        portal_slug: t.portal_slug,
        attempt,
        mode: "dry_run",
        status: "running",
        worker_id: workerId,
        started_at: now.toISOString(),
        completed_at: null,
        duration_ms: null,
        confirmation_reference: null,
        screenshot_path: null,
        error_code: null,
        error_message: null,
        steps: EXECUTION_STEPS.map((x) => ({ key: x.key, label: x.label, status: "pending" as const, at: null })),
        simulated: true,
        plan: { outcome: planOutcome(s, rng), ends_at: new Date(now.getTime() + ms).toISOString() },
      };
      s.executions.push(exec);
      replace(s.tasks, t.id, {
        status: "processing",
        attempt_count: attempt,
        started_at: t.started_at ?? now.toISOString(),
        locked_by: workerId,
        locked_at: now.toISOString(),
        next_attempt_at: null,
        updated_at: now.toISOString(),
      });
      refreshJobStatus(s, { now, actorId: null, actorType: "worker" }, t.job_id);
      locked.add(t.portal_slug);
      capacity--;
      started++;
    }
  }
  if (due.length === 0 && started === 0) return { state, summary: { started: 0, finished: 0 } };
  return { state: s, summary: { started, finished: due.length } };
}

/**
 * Starts an attempt that waits for a result posted from outside (the result
 * simulator on Integration Settings, later a real worker). It has no
 * simulation plan, so the in-browser worker never finishes it by itself.
 */
export function startAttemptForExternalResult(state: DemoState, ctx: Ctx, taskId: string) {
  assertCan(state, ctx, "integrations.manage");
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) throw new EngineError("not_found", "Task not found.");
  if (t.status !== "pending" && t.status !== "retry_scheduled")
    throw new EngineError("already_in_state", "Only pending or retry-scheduled tasks can start an attempt.");
  const job = state.jobs.find((j) => j.id === t.job_id);
  if (!job || job.archived_at) throw new EngineError("archived", "The job is archived.");
  const portal = portalOrThrow(state, t.portal_slug);
  if (!portal.is_enabled) throw new EngineError("portal_disabled", `${portal.name} is disabled.`);
  if (state.executions.some((e) => e.status === "running" && e.portal_slug === t.portal_slug))
    throw new EngineError("locked", `${portal.name} already has an attempt running (one at a time per portal).`);
  const s = draft(state);
  const now = iso(ctx.now);
  const attempt = t.attempt_count + 1;
  const exec: DemoExecution = {
    id: uuidV4(),
    task_id: t.id,
    job_id: t.job_id,
    portal_slug: t.portal_slug,
    attempt,
    mode: "dry_run",
    status: "running",
    worker_id: "result-simulator",
    started_at: now,
    completed_at: null,
    duration_ms: null,
    confirmation_reference: null,
    screenshot_path: null,
    error_code: null,
    error_message: null,
    steps: EXECUTION_STEPS.map((x) => ({ key: x.key, label: x.label, status: "pending" as const, at: null })),
    simulated: true,
    plan: null,
  };
  s.executions.push(exec);
  replace(s.tasks, t.id, {
    status: "processing",
    attempt_count: attempt,
    started_at: t.started_at ?? now,
    locked_by: exec.worker_id,
    locked_at: now,
    next_attempt_at: null,
    updated_at: now,
  });
  refreshJobStatus(s, ctx, t.job_id);
  audit(s, ctx, "execution.started_for_external_result", "portal_task", t.id, { attempt, portal: t.portal_slug });
  return { state: s, execution: exec };
}

/* ------------------------------------------------------- settings & users */

export function updateSettings(state: DemoState, ctx: Ctx, input: Omit<SystemSettings, "execution_mode">) {
  assertCan(state, ctx, "system.configure");
  const n = input;
  const bad = (cond: boolean, msg: string) => {
    if (cond) throw new EngineError("invalid", msg);
  };
  bad(
    !Number.isInteger(n.max_concurrency) || n.max_concurrency < 1 || n.max_concurrency > 10,
    "Concurrency must be 1–10 browser workers.",
  );
  bad(
    !Number.isInteger(n.retry_limit) || n.retry_limit < 1 || n.retry_limit > 10,
    "Retry limit must be 1–10 attempts.",
  );
  bad(n.backoff_base_seconds < 5 || n.backoff_base_seconds > 3600, "Backoff base must be 5–3600 seconds.");
  bad(n.execution_timeout_seconds < 10 || n.execution_timeout_seconds > 900, "Timeout must be 10–900 seconds.");
  bad(n.polling_interval_seconds < 1 || n.polling_interval_seconds > 60, "Polling interval must be 1–60 seconds.");
  bad(n.simulation.failure_rate < 0 || n.simulation.failure_rate > 0.9, "Simulated failure rate must be 0–90%.");
  bad(
    n.simulation.human_review_rate < 0 || n.simulation.human_review_rate > 0.5,
    "Simulated review rate must be 0–50%.",
  );
  bad(n.simulation.speed < 0.01 || n.simulation.speed > 2, "Simulation speed must be between 0.01 and 2.");
  const s = draft(state);
  const before = s.settings;
  s.settings = { ...input, execution_mode: "dry_run", simulation: { ...input.simulation } };
  audit(
    s,
    ctx,
    "system_settings.updated",
    "system_settings",
    null,
    diff(before, s.settings, Object.keys(input) as (keyof SystemSettings)[]),
  );
  return s;
}

/** Start/stop the simulated worker (operators and admins). */
export function setWorkerRunning(state: DemoState, ctx: Ctx, running: boolean) {
  assertCan(state, ctx, "queue.retry");
  if (state.settings.worker_running === running) return state;
  const s = draft(state);
  s.settings.worker_running = running;
  audit(s, ctx, running ? "worker.started" : "worker.paused", "system_settings", null, null);
  return s;
}

export function updateIntegrations(
  state: DemoState,
  ctx: Ctx,
  patch: (i: IntegrationSettings) => IntegrationSettings,
  action: string,
) {
  assertCan(state, ctx, "integrations.manage");
  const s = draft(state);
  const before = s.integrations;
  s.integrations = patch(structuredCloneSafe(before));
  audit(s, ctx, action, "integration_settings", null, {
    n8n_outbound_enabled: s.integrations.n8n.outbound_enabled,
    n8n_webhook_url: s.integrations.n8n.webhook_url || null,
    playwright_controller_url: s.integrations.playwright.controller_url || null,
  });
  return s;
}

export function switchUser(state: DemoState, userId: string) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) throw new EngineError("not_found", "Unknown demo user.");
  if (!user.is_active)
    throw new EngineError("forbidden", `${user.full_name} is deactivated. Reactivate the account first.`);
  return { ...state, current_user_id: userId };
}

/* ------------------------------------------------------------------ users */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface UserInput {
  email: string;
  full_name: string;
  role: AppRole;
}

function validateUser(s: DemoState, input: UserInput, selfId: string | null) {
  const reasons: string[] = [];
  const email = input.email.trim().toLowerCase();
  const name = input.full_name.trim();
  if (name.length < 2 || name.length > 120) reasons.push("Name must be 2–120 characters.");
  if (!EMAIL_RE.test(email) || email.length > 254) reasons.push("Enter a valid email address.");
  if (!isAppRole(input.role)) reasons.push("Choose a role.");
  if (s.users.some((u) => u.id !== selfId && u.email.toLowerCase() === email))
    reasons.push("Another user already has this email address.");
  if (reasons.length) throw new EngineError("invalid", reasons.join(" "));
  return { email, full_name: name, role: input.role };
}

const activeAdmins = (s: DemoState) => s.users.filter((u) => u.is_active && u.role === "admin");

/**
 * Adds a user to the demo organisation. In the demo nobody receives an email:
 * the user exists locally and can be switched to from the user menu.
 */
export function addUser(state: DemoState, ctx: Ctx, input: UserInput) {
  assertCan(state, ctx, "users.manage");
  const fields = validateUser(state, input, null);
  const s = draft(state);
  const user: DemoUser = { id: uuidV4(), ...fields, is_active: true, created_at: iso(ctx.now) };
  s.users.push(user);
  audit(s, ctx, "user.created", "user", user.id, { email: user.email, role: user.role });
  return s;
}

/** Edits a user's name, email and role. Admins cannot demote themselves or the last active admin. */
export function updateUser(state: DemoState, ctx: Ctx, userId: string, input: UserInput) {
  assertCan(state, ctx, "users.manage");
  const before = state.users.find((u) => u.id === userId);
  if (!before) throw new EngineError("not_found", "User not found.");
  const fields = validateUser(state, input, userId);
  if (before.role === "admin" && fields.role !== "admin") {
    if (userId === ctx.actorId) throw new EngineError("invalid", "You cannot remove your own admin role.");
    if (before.is_active && activeAdmins(state).length <= 1)
      throw new EngineError("invalid", "The organisation must keep at least one active admin.");
  }
  const s = draft(state);
  const after = replace(s.users, userId, fields);
  const changes = diff(before, after, ["email", "full_name", "role"]);
  if (Object.keys(changes).length === 0) return state;
  audit(s, ctx, before.role !== after.role ? "user.role_changed" : "user.updated", "user", userId, changes);
  return s;
}

/** Deactivates or reactivates a user. History stays attributed to them. */
export function setUserActive(state: DemoState, ctx: Ctx, userId: string, active: boolean) {
  assertCan(state, ctx, "users.manage");
  const before = state.users.find((u) => u.id === userId);
  if (!before) throw new EngineError("not_found", "User not found.");
  if (before.is_active === active) return state;
  if (!active) {
    if (userId === ctx.actorId) throw new EngineError("invalid", "You cannot deactivate your own account.");
    if (before.role === "admin" && activeAdmins(state).length <= 1)
      throw new EngineError("invalid", "The organisation must keep at least one active admin.");
  }
  const s = draft(state);
  replace(s.users, userId, { is_active: active });
  audit(s, ctx, active ? "user.reactivated" : "user.deactivated", "user", userId, {
    is_active: { from: !active, to: active },
  });
  return s;
}
