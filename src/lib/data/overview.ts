import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AWAITING_JOB_STATUSES, BACKLOG_TASK_STATUSES } from "@/lib/domain/status";
import { OVERVIEW_QUERY_CONTRACT as C } from "@/lib/data/overview-contract";
import {
  OVERVIEW_WINDOW_DAYS,
  computeOverview,
  windowStart,
  type OverviewCounts,
  type OverviewExecutionRow,
  type OverviewJobRow,
  type OverviewSnapshot,
  type OverviewTaskRow,
} from "@/lib/metrics/overview";
import { buildSampleOverviewDataset } from "@/lib/metrics/sample-dataset";
import { isMissingRelation, type DataResult } from "@/lib/data/result";

class QueryError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** A filterable PostgREST select builder. */
type SelectQuery = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

async function count(db: SupabaseClient, table: string, apply?: (q: SelectQuery) => SelectQuery): Promise<number> {
  let query = db.from(table).select("*", { count: "exact", head: true });
  if (apply) query = apply(query);
  const { count: n, error } = await query;
  if (error) throw new QueryError(error.message, error.code);
  return n ?? 0;
}

/** Page through a windowed select (PostgREST caps responses at 1000 rows). */
async function selectAll<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  timeColumn: string,
  since: string,
  maxRows = 20_000,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .gte(timeColumn, since)
      .order(timeColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new QueryError(error.message, error.code);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function loadFromDatabase(db: SupabaseClient, now: Date): Promise<OverviewSnapshot> {
  const since = windowStart(now, OVERVIEW_WINDOW_DAYS).toISOString();
  const activeJobs = (q: SelectQuery) => q.is(C.jobs.activeFilterColumn, null);

  const [
    jobsTotal,
    jobsAwaiting,
    jobsProcessing,
    jobsSubmitted,
    jobsPartial,
    jobsFailed,
    jobsReview,
    tasksFailed,
    tasksBacklog,
    tasksSubmittedLive,
    tasksSubmittedDryRun,
  ] = await Promise.all([
    count(db, "jobs", activeJobs),
    count(db, "jobs", (q) => activeJobs(q).in("status", [...AWAITING_JOB_STATUSES])),
    count(db, "jobs", (q) => activeJobs(q).eq("status", "processing")),
    count(db, "jobs", (q) => activeJobs(q).eq("status", "submitted")),
    count(db, "jobs", (q) => activeJobs(q).eq("status", "partially_submitted")),
    count(db, "jobs", (q) => activeJobs(q).eq("status", "failed")),
    count(db, "jobs", (q) => activeJobs(q).eq("status", "requires_human_review")),
    count(db, "submission_tasks", (q) => q.eq("status", "failed")),
    count(db, "submission_tasks", (q) => q.in("status", [...BACKLOG_TASK_STATUSES])),
    count(db, "submission_tasks", (q) => q.eq("status", "submitted").eq("execution_mode", "live")),
    count(db, "submission_tasks", (q) => q.eq("status", "submitted").eq("execution_mode", "dry_run")),
  ]);

  const counts: OverviewCounts = {
    jobsTotal,
    jobsAwaiting,
    jobsProcessing,
    jobsSubmitted,
    jobsPartial,
    jobsFailed,
    jobsReview,
    tasksFailed,
    tasksBacklog,
    tasksSubmittedLive,
    tasksSubmittedDryRun,
  };

  const [jobs, tasks, executions, running] = await Promise.all([
    selectAll<OverviewJobRow>(db, C.jobs.table, C.jobs.columns, C.jobs.timeColumn, since),
    selectAll<OverviewTaskRow>(
      db,
      C.submissionTasks.table,
      C.submissionTasks.columns,
      C.submissionTasks.timeColumn,
      since,
    ),
    selectAll<OverviewExecutionRow>(
      db,
      C.automationExecutions.table,
      C.automationExecutions.columns,
      C.automationExecutions.timeColumn,
      since,
    ),
    db.from(C.automationExecutions.table).select("worker_id").eq("status", "running").limit(1000),
  ]);
  if (running.error) throw new QueryError(running.error.message, running.error.code);

  return computeOverview(counts, { jobs, tasks, executions, runningExecutions: running.data ?? [] }, now);
}

/**
 * Overview figures for the signed-in user's organisation.
 *
 * `db` is the user's session client, so every count is filtered by Row Level
 * Security; the service-role client is deliberately not used here. A null
 * client means Supabase is not configured and is reported as such.
 */
export async function getOverview(options: {
  preview?: "sample";
  db: SupabaseClient | null;
  missing?: string[];
}): Promise<DataResult<OverviewSnapshot>> {
  const now = new Date();

  if (options.preview === "sample") {
    const { counts, window } = buildSampleOverviewDataset(now);
    return { kind: "ok", source: "sample", data: computeOverview(counts, window, now) };
  }

  const { db } = options;
  if (!db) {
    return {
      kind: "not_configured",
      missing: options.missing?.length
        ? options.missing
        : ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    };
  }

  try {
    return { kind: "ok", source: "database", data: await loadFromDatabase(db, now) };
  } catch (err) {
    if (err instanceof QueryError && isMissingRelation(err)) {
      return {
        kind: "schema_missing",
        detail: "The JobSync tables were not found. Apply the SQL migrations in supabase/migrations.",
      };
    }
    console.error("[overview] database read failed", err instanceof Error ? err.message : err);
    return { kind: "error", message: "The dashboard could not read from Supabase. Check the server logs." };
  }
}
