import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingRelation, type DataResult } from "@/lib/data/result";
import type { JobSourceType, JobStatus } from "@/lib/domain/status";

export const INCOMING_VIEWS = ["new", "accepted", "duplicate", "rejected", "failed", "awaiting_routing"] as const;
export type IncomingView = (typeof INCOMING_VIEWS)[number];

export const INCOMING_VIEW_META: Record<IncomingView, { label: string; description: string; kind: "jobs" | "events" }> =
  {
    new: { label: "Newly received", description: "Jobs received in the last 24 hours, from any source.", kind: "jobs" },
    accepted: {
      label: "Validated",
      description: "Intake requests that passed validation and created a job.",
      kind: "events",
    },
    duplicate: {
      label: "Duplicates",
      description: "Repeat imports of an external job already received. Nothing was changed.",
      kind: "events",
    },
    rejected: {
      label: "Rejected",
      description: "Requests refused for authentication, validation or source rules.",
      kind: "events",
    },
    failed: {
      label: "Import errors",
      description: "Requests that could not be stored because of a server error.",
      kind: "events",
    },
    awaiting_routing: {
      label: "Awaiting routing",
      description: "Jobs with no destination portal yet. Routing rules arrive in Phase 4.",
      kind: "jobs",
    },
  };

export const INCOMING_PAGE_SIZE = 25;
const DAY_MS = 86_400_000;

export interface IntakeEventRow {
  id: string;
  created_at: string;
  status: "received" | "accepted" | "duplicate" | "rejected" | "processed" | "failed";
  http_status: number | null;
  request_id: string | null;
  idempotency_key: string | null;
  error: string | null;
  job_id: string | null;
  payload: unknown;
  job: { reference: string } | null;
}

export interface IncomingJobRow {
  id: string;
  reference: string;
  source_type: JobSourceType;
  source: string;
  external_job_id: string | null;
  customer_name: string;
  category: string;
  status: JobStatus;
  received_at: string;
}

export interface IncomingData {
  view: IncomingView;
  counts: Record<IncomingView, number | null>;
  /** False when the caller's role cannot read integration events. */
  eventsVisible: boolean;
  events: IntakeEventRow[];
  jobs: IncomingJobRow[];
  total: number;
  page: number;
  pageCount: number;
}

type DbError = { code?: string; message: string };

function fail(error: DbError): DataResult<never> {
  if (isMissingRelation(error)) {
    return { kind: "schema_missing", detail: "The JobSync tables were not found. Apply the SQL migrations." };
  }
  console.error("[incoming] query failed", error.code, error.message);
  return { kind: "error", message: "Incoming jobs could not be loaded. Check the server logs." };
}

export function parseIncomingView(v: unknown): IncomingView {
  return typeof v === "string" && (INCOMING_VIEWS as readonly string[]).includes(v) ? (v as IncomingView) : "new";
}

export async function getIncoming(
  db: SupabaseClient,
  options: { view: IncomingView; page: number; eventsVisible: boolean; now?: Date },
): Promise<DataResult<IncomingData>> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const { view, eventsVisible } = options;

  const newJobs = (head: boolean) =>
    db
      .from("jobs")
      .select(head ? "id" : JOB_COLUMNS, { count: "exact", head })
      .gte("received_at", since)
      .is("archived_at", null);
  const awaiting = (head: boolean) =>
    db
      .from("jobs")
      .select(head ? "id" : JOB_COLUMNS, { count: "exact", head })
      .eq("status", "received")
      .is("archived_at", null);
  const events = (status: string, head: boolean) =>
    db
      .from("integration_events")
      .select(head ? "id" : EVENT_COLUMNS, { count: "exact", head })
      .eq("integration", "intake")
      .eq("direction", "inbound")
      .eq("status", status);

  // Counts for every tab.
  const countQueries = await Promise.all([
    newJobs(true),
    awaiting(true),
    ...(eventsVisible ? (["accepted", "duplicate", "rejected", "failed"] as const).map((s) => events(s, true)) : []),
  ]);
  for (const r of countQueries) if (r.error) return fail(r.error);
  const [cNew, cAwaiting, cAccepted, cDuplicate, cRejected, cFailed] = countQueries.map((r) => r.count ?? 0);
  const counts: Record<IncomingView, number | null> = {
    new: cNew,
    awaiting_routing: cAwaiting,
    accepted: eventsVisible ? cAccepted : null,
    duplicate: eventsVisible ? cDuplicate : null,
    rejected: eventsVisible ? cRejected : null,
    failed: eventsVisible ? cFailed : null,
  };

  const from = (Math.max(1, options.page) - 1) * INCOMING_PAGE_SIZE;
  const to = from + INCOMING_PAGE_SIZE - 1;
  const base: IncomingData = {
    view,
    counts,
    eventsVisible,
    events: [],
    jobs: [],
    total: 0,
    page: Math.max(1, options.page),
    pageCount: 1,
  };

  if (INCOMING_VIEW_META[view].kind === "jobs") {
    const q = view === "new" ? newJobs(false) : awaiting(false);
    const { data, error, count } = await q.order("received_at", { ascending: view !== "new" }).range(from, to);
    if (error && error.code !== "PGRST103") return fail(error);
    const total = count ?? counts[view] ?? 0;
    return {
      kind: "ok",
      source: "database",
      data: {
        ...base,
        jobs: (data ?? []) as unknown as IncomingJobRow[],
        total,
        pageCount: Math.max(1, Math.ceil(total / INCOMING_PAGE_SIZE)),
      },
    };
  }

  if (!eventsVisible) return { kind: "ok", source: "database", data: base };

  const { data, error, count } = await events(view, false).order("created_at", { ascending: false }).range(from, to);
  if (error && error.code !== "PGRST103") return fail(error);
  const total = count ?? counts[view] ?? 0;
  return {
    kind: "ok",
    source: "database",
    data: {
      ...base,
      events: (data ?? []) as unknown as IntakeEventRow[],
      total,
      pageCount: Math.max(1, Math.ceil(total / INCOMING_PAGE_SIZE)),
    },
  };
}

const JOB_COLUMNS = "id, reference, source_type, source, external_job_id, customer_name, category, status, received_at";
const EVENT_COLUMNS =
  "id, created_at, status, http_status, request_id, idempotency_key, error, job_id, payload, job:jobs(reference)";

/* --------------------------------------------------------------- API keys */

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  allowed_sources: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

/** Admin only (RLS). The hash column is not readable by any user. */
export async function listApiKeys(db: SupabaseClient): Promise<DataResult<ApiKeyRow[]>> {
  const { data, error } = await db
    .from("api_keys")
    .select("id, name, key_prefix, allowed_sources, created_at, last_used_at, expires_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) return fail(error);
  return { kind: "ok", source: "database", data: (data ?? []) as ApiKeyRow[] };
}
