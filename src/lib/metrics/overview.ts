/**
 * Pure overview-metric computation. No I/O: the same functions are fed by the
 * Supabase data layer and by the clearly labelled sample preview, so the
 * dashboard has a single, testable definition of every number it shows.
 */
import { PORTALS, type PortalSlug } from "@/lib/domain/portals";
import {
  AWAITING_JOB_STATUSES,
  BACKLOG_TASK_STATUSES,
  type ExecutionMode,
  type ExecutionStatus,
  type JobSourceType,
  type JobStatus,
  type TaskStatus,
} from "@/lib/domain/status";

export const OVERVIEW_WINDOW_DAYS = 14;

export interface OverviewJobRow {
  status: JobStatus;
  source_type: JobSourceType;
  received_at: string;
}

export interface OverviewTaskRow {
  portal_slug: PortalSlug;
  status: TaskStatus;
  execution_mode: ExecutionMode;
  created_at: string;
  completed_at: string | null;
}

export interface OverviewExecutionRow {
  status: ExecutionStatus;
  mode: ExecutionMode;
  worker_id: string | null;
  started_at: string;
  completed_at: string | null;
}

/** All-time counters. Supplied by COUNT queries in production. */
export interface OverviewCounts {
  jobsTotal: number;
  jobsAwaiting: number;
  jobsProcessing: number;
  jobsSubmitted: number;
  jobsPartial: number;
  jobsFailed: number;
  jobsReview: number;
  tasksFailed: number;
  tasksBacklog: number;
  tasksSubmittedLive: number;
  tasksSubmittedDryRun: number;
}

/** Rows inside the reporting window, used for rates and time series. */
export interface OverviewWindow {
  jobs: OverviewJobRow[];
  tasks: OverviewTaskRow[];
  executions: OverviewExecutionRow[];
  /** Executions currently in the "running" state (any age). */
  runningExecutions: Pick<OverviewExecutionRow, "worker_id">[];
}

export interface RateMetric {
  /** null when there is nothing to measure — never a made-up 0% / 100%. */
  value: number | null;
  /** Which execution mode the figure describes. Live is preferred when present. */
  mode: ExecutionMode | null;
  sampleSize: number;
}

export interface DayPoint {
  date: string; // YYYY-MM-DD (UTC)
  label: string; // e.g. "Nov 2"
}

export interface OverviewSnapshot {
  generatedAt: string;
  windowDays: number;
  counts: OverviewCounts;
  activeWorkers: number;
  successRate: RateMetric;
  avgSubmissionMs: RateMetric;
  intakeSeries: (DayPoint & { external: number; manual: number })[];
  portalOutcomes: { portal: PortalSlug; name: string; submitted: number; failed: number; humanReview: number }[];
  portalWorkload: { portal: PortalSlug; name: string; tasks: number }[];
  processingTrend: (DayPoint & { submitted: number; partial: number; failed: number; review: number })[];
  automationActivity: (DayPoint & { live: number; dryRun: number })[];
}

const DAY_MS = 86_400_000;

export function utcDay(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toISOString().slice(0, 10);
}

/** The window's day buckets, oldest first, ending today (UTC). */
export function buildDayBuckets(now: Date, days: number): DayPoint[] {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(todayStart - (days - 1 - i) * DAY_MS);
    return {
      date: utcDay(d),
      label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
    };
  });
}

export function windowStart(now: Date, days: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * DAY_MS);
}

/** Derive all-time counters from raw rows (used by the sample preview and tests). */
export function countsFromRows(jobs: OverviewJobRow[], tasks: OverviewTaskRow[]): OverviewCounts {
  const jobsWith = (s: JobStatus) => jobs.filter((j) => j.status === s).length;
  return {
    jobsTotal: jobs.length,
    jobsAwaiting: jobs.filter((j) => AWAITING_JOB_STATUSES.includes(j.status)).length,
    jobsProcessing: jobsWith("processing"),
    jobsSubmitted: jobsWith("submitted"),
    jobsPartial: jobsWith("partially_submitted"),
    jobsFailed: jobsWith("failed"),
    jobsReview: jobsWith("requires_human_review"),
    tasksFailed: tasks.filter((t) => t.status === "failed").length,
    tasksBacklog: tasks.filter((t) => BACKLOG_TASK_STATUSES.includes(t.status)).length,
    tasksSubmittedLive: tasks.filter((t) => t.status === "submitted" && t.execution_mode === "live").length,
    tasksSubmittedDryRun: tasks.filter((t) => t.status === "submitted" && t.execution_mode === "dry_run").length,
  };
}

const TERMINAL_OUTCOMES: readonly TaskStatus[] = ["submitted", "failed", "human_review"];

/**
 * Share of finished tasks that succeeded. Live results are reported when any
 * exist; dry-run rehearsals are only used when there are no live results, and
 * the metric says so — rehearsals are never presented as real submissions.
 */
export function computeSuccessRate(tasks: OverviewTaskRow[]): RateMetric {
  for (const mode of ["live", "dry_run"] as const) {
    const finished = tasks.filter((t) => t.execution_mode === mode && TERMINAL_OUTCOMES.includes(t.status));
    if (finished.length > 0) {
      const ok = finished.filter((t) => t.status === "submitted").length;
      return { value: ok / finished.length, mode, sampleSize: finished.length };
    }
  }
  return { value: null, mode: null, sampleSize: 0 };
}

/** Mean duration of successful executions, live preferred over dry-run. */
export function computeAvgSubmissionMs(executions: OverviewExecutionRow[]): RateMetric {
  for (const mode of ["live", "dry_run"] as const) {
    const durations = executions
      .filter((e) => e.mode === mode && e.status === "succeeded" && e.completed_at)
      .map((e) => new Date(e.completed_at!).getTime() - new Date(e.started_at).getTime())
      .filter((ms) => Number.isFinite(ms) && ms >= 0);
    if (durations.length > 0) {
      return { value: durations.reduce((a, b) => a + b, 0) / durations.length, mode, sampleSize: durations.length };
    }
  }
  return { value: null, mode: null, sampleSize: 0 };
}

export function computeOverview(
  counts: OverviewCounts,
  win: OverviewWindow,
  now: Date,
  windowDays = OVERVIEW_WINDOW_DAYS,
): OverviewSnapshot {
  const days = buildDayBuckets(now, windowDays);
  const index = new Map(days.map((d, i) => [d.date, i]));

  const intakeSeries = days.map((d) => ({ ...d, external: 0, manual: 0 }));
  for (const job of win.jobs) {
    const i = index.get(utcDay(job.received_at));
    if (i !== undefined) intakeSeries[i][job.source_type] += 1;
  }

  const processingTrend = days.map((d) => ({ ...d, submitted: 0, partial: 0, failed: 0, review: 0 }));
  for (const job of win.jobs) {
    const i = index.get(utcDay(job.received_at));
    if (i === undefined) continue;
    if (job.status === "submitted") processingTrend[i].submitted += 1;
    else if (job.status === "partially_submitted") processingTrend[i].partial += 1;
    else if (job.status === "failed") processingTrend[i].failed += 1;
    else if (job.status === "requires_human_review") processingTrend[i].review += 1;
  }

  const automationActivity = days.map((d) => ({ ...d, live: 0, dryRun: 0 }));
  for (const exec of win.executions) {
    const i = index.get(utcDay(exec.started_at));
    if (i === undefined) continue;
    if (exec.mode === "live") automationActivity[i].live += 1;
    else automationActivity[i].dryRun += 1;
  }

  const portalOutcomes = PORTALS.map((p) => {
    const tasks = win.tasks.filter((t) => t.portal_slug === p.slug);
    return {
      portal: p.slug,
      name: p.name,
      submitted: tasks.filter((t) => t.status === "submitted").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      humanReview: tasks.filter((t) => t.status === "human_review").length,
    };
  });

  const portalWorkload = PORTALS.map((p) => ({
    portal: p.slug,
    name: p.name,
    tasks: win.tasks.filter((t) => t.portal_slug === p.slug).length,
  }));

  const activeWorkers = new Set(win.runningExecutions.map((e) => e.worker_id).filter((id): id is string => Boolean(id)))
    .size;

  return {
    generatedAt: now.toISOString(),
    windowDays,
    counts,
    activeWorkers,
    successRate: computeSuccessRate(win.tasks),
    avgSubmissionMs: computeAvgSubmissionMs(win.executions),
    intakeSeries,
    portalOutcomes,
    portalWorkload,
    processingTrend,
    automationActivity,
  };
}

export function isSnapshotEmpty(s: OverviewSnapshot): boolean {
  return s.counts.jobsTotal === 0;
}
