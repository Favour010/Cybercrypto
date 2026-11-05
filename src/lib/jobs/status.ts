/**
 * Overall job status derived from all of the job's portal submission tasks.
 * Pure; used by the demo engine and intended for the Supabase result
 * processor (Phase 6) so both apply exactly the same rule.
 */
import type { JobStatus, TaskStatus } from "@/lib/domain/status";

export interface TaskLike {
  status: TaskStatus;
  attempt_count: number;
}

export function deriveJobStatus(tasks: TaskLike[], current: JobStatus): JobStatus {
  if (tasks.length === 0) {
    // No destinations: awaiting routing, or already flagged for a person.
    return current === "requires_human_review" ? current : "received";
  }
  const active = tasks.filter((t) => t.status !== "cancelled");
  if (active.length === 0) return "requires_human_review";
  if (active.some((t) => t.status === "processing")) return "processing";
  if (active.some((t) => t.status === "human_review")) return "requires_human_review";
  if (active.every((t) => t.status === "submitted")) return "submitted";
  if (active.some((t) => t.status === "pending" || t.status === "retry_scheduled")) {
    const started = active.some((t) => t.attempt_count > 0 || t.status === "submitted");
    return started ? "processing" : "ready";
  }
  // Only submitted and failed remain.
  return active.some((t) => t.status === "submitted") ? "partially_submitted" : "failed";
}

/** Exponential backoff: base, 2×base, 4×base … capped at one hour. */
export function backoffSeconds(attempt: number, baseSeconds: number): number {
  return Math.min(3600, baseSeconds * 2 ** Math.max(0, attempt - 1));
}
