/**
 * Canonical lifecycle states. These mirror the Postgres enums created in the
 * Phase 2 migrations — change both together.
 */

/** Overall job status, derived from all of the job's portal submission tasks. */
export const JOB_STATUSES = [
  "received",
  "validating",
  "ready",
  "processing",
  "partially_submitted",
  "submitted",
  "failed",
  "requires_human_review",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Status of a single job → portal submission task. */
export const TASK_STATUSES = [
  "pending",
  "processing",
  "submitted",
  "failed",
  "retry_scheduled",
  "human_review",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * DRY_RUN is the default everywhere. LIVE requires explicit authorisation and
 * is the only mode that may perform a real portal submission.
 */
export const EXECUTION_MODES = ["dry_run", "live"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];
export const DEFAULT_EXECUTION_MODE: ExecutionMode = "dry_run";

export const JOB_SOURCE_TYPES = ["external", "manual"] as const;
export type JobSourceType = (typeof JOB_SOURCE_TYPES)[number];

/** Visual tone used by StatusBadge. Maps onto the reserved status palette. */
export type StatusTone = "neutral" | "info" | "good" | "warning" | "serious" | "critical";

export const JOB_STATUS_META: Record<JobStatus, { label: string; tone: StatusTone }> = {
  received: { label: "Received", tone: "neutral" },
  validating: { label: "Validating", tone: "info" },
  ready: { label: "Ready", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  partially_submitted: { label: "Partially Submitted", tone: "serious" },
  submitted: { label: "Submitted", tone: "good" },
  failed: { label: "Failed", tone: "critical" },
  requires_human_review: { label: "Requires Human Review", tone: "warning" },
};

export const TASK_STATUS_META: Record<TaskStatus, { label: string; tone: StatusTone }> = {
  pending: { label: "Pending", tone: "neutral" },
  processing: { label: "Processing", tone: "info" },
  submitted: { label: "Submitted", tone: "good" },
  failed: { label: "Failed", tone: "critical" },
  retry_scheduled: { label: "Retry Scheduled", tone: "serious" },
  human_review: { label: "Human Review", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const EXECUTION_MODE_META: Record<ExecutionMode, { label: string; description: string }> = {
  dry_run: {
    label: "Dry run",
    description: "Browser steps are rehearsed; the final submit is never clicked.",
  },
  live: {
    label: "Live",
    description: "Real submission to the destination portal. Requires explicit authorisation.",
  },
};

/** Job statuses that count as "awaiting processing" on the overview. */
export const AWAITING_JOB_STATUSES: readonly JobStatus[] = ["received", "validating", "ready"];
/** Task statuses that count towards the queue backlog. */
export const BACKLOG_TASK_STATUSES: readonly TaskStatus[] = ["pending", "retry_scheduled"];

/** Status of one browser automation attempt (an automation_executions row). */
export const EXECUTION_STATUSES = ["running", "succeeded", "failed", "cancelled"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
