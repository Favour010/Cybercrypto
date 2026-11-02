/**
 * Deterministic SAMPLE dataset for previewing the overview without a database.
 *
 * This is illustration only: it is generated in memory, is never written to
 * Supabase, and every screen that renders it shows a "Sample data" banner.
 * It must never be used as a source of production statistics.
 */
import { PORTAL_SLUGS, type PortalSlug } from "@/lib/domain/portals";
import type { ExecutionMode, JobStatus, TaskStatus } from "@/lib/domain/status";
import {
  OVERVIEW_WINDOW_DAYS,
  type OverviewExecutionRow,
  type OverviewJobRow,
  type OverviewTaskRow,
  countsFromRows,
  windowStart,
  type OverviewCounts,
  type OverviewWindow,
} from "@/lib/metrics/overview";

/** Small seeded PRNG (mulberry32) so the preview is stable between renders. */
function createRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Relative share of routed work per portal in the preview. */
const PORTAL_WEIGHT: Record<PortalSlug, number> = {
  northstar: 0.32,
  bluepeak: 0.24,
  greenfield: 0.18,
  apex: 0.15,
  metrocare: 0.11,
};

function pickPortals(rng: () => number): PortalSlug[] {
  const count = rng() < 0.7 ? 1 : rng() < 0.85 ? 2 : 3;
  const chosen = new Set<PortalSlug>();
  while (chosen.size < count) {
    let r = rng();
    for (const slug of PORTAL_SLUGS) {
      r -= PORTAL_WEIGHT[slug];
      if (r <= 0) {
        chosen.add(slug);
        break;
      }
    }
    if (r > 0) chosen.add("northstar");
  }
  return [...chosen];
}

function deriveJobStatus(taskStatuses: TaskStatus[]): JobStatus {
  if (taskStatuses.some((s) => s === "pending" || s === "retry_scheduled")) return "ready";
  if (taskStatuses.some((s) => s === "processing")) return "processing";
  if (taskStatuses.some((s) => s === "human_review")) return "requires_human_review";
  const ok = taskStatuses.filter((s) => s === "submitted").length;
  if (ok === taskStatuses.length) return "submitted";
  if (ok > 0) return "partially_submitted";
  return "failed";
}

export function buildSampleOverviewDataset(now: Date): { counts: OverviewCounts; window: OverviewWindow } {
  const rng = createRng(20261102);
  const start = windowStart(now, OVERVIEW_WINDOW_DAYS).getTime();
  const jobs: OverviewJobRow[] = [];
  const tasks: OverviewTaskRow[] = [];
  const executions: OverviewExecutionRow[] = [];
  const runningExecutions: { worker_id: string | null }[] = [];

  for (let day = 0; day < OVERVIEW_WINDOW_DAYS; day++) {
    const isToday = day === OVERVIEW_WINDOW_DAYS - 1;
    const weekday = new Date(start + day * 86_400_000).getUTCDay();
    const base = weekday === 0 || weekday === 6 ? 38 : 92;
    const jobCount = Math.round(base + (rng() - 0.5) * 24) - (isToday ? 55 : 0);
    // Sample history starts in dry-run and moves to live for the final week.
    const mode: ExecutionMode = day >= OVERVIEW_WINDOW_DAYS - 7 ? "live" : "dry_run";

    for (let n = 0; n < jobCount; n++) {
      const receivedMs = start + day * 86_400_000 + Math.floor(rng() * 86_400_000 * (isToday ? 0.5 : 1));
      const received = new Date(Math.min(receivedMs, now.getTime() - 60_000));
      const statuses: TaskStatus[] = [];

      for (const portal of pickPortals(rng)) {
        const r = rng();
        let status: TaskStatus;
        if (isToday && r < 0.22) status = "pending";
        else if (isToday && r < 0.27) status = "processing";
        else if (r < 0.885) status = "submitted";
        else if (r < 0.935) status = "failed";
        else if (r < 0.965) status = "retry_scheduled";
        else status = "human_review";
        statuses.push(status);

        const created = new Date(received.getTime() + 5_000);
        const attempts = status === "failed" ? 3 : status === "retry_scheduled" ? 2 : status === "pending" ? 0 : 1;
        let completedAt: string | null = null;
        for (let a = 0; a < attempts; a++) {
          const startedAt = new Date(created.getTime() + 60_000 * (a * 4 + 1) + Math.floor(rng() * 120_000));
          const running = status === "processing" && a === attempts - 1;
          const succeeded = status === "submitted" && a === attempts - 1;
          const durationMs = 24_000 + Math.floor(rng() * 38_000);
          const completed = running ? null : new Date(startedAt.getTime() + durationMs).toISOString();
          executions.push({
            status: running ? "running" : succeeded ? "succeeded" : "failed",
            mode,
            worker_id: `worker-${(n % 3) + 1}`,
            started_at: startedAt.toISOString(),
            completed_at: completed,
          });
          if (running) runningExecutions.push({ worker_id: `worker-${(n % 3) + 1}` });
          completedAt = completed;
        }
        tasks.push({
          portal_slug: portal,
          status,
          execution_mode: mode,
          created_at: created.toISOString(),
          completed_at: status === "submitted" || status === "failed" ? completedAt : null,
        });
      }
      jobs.push({
        status: deriveJobStatus(statuses),
        source_type: rng() < 0.88 ? "external" : "manual",
        received_at: received.toISOString(),
      });
    }
  }

  // Never show more concurrently running workers than the default concurrency.
  const capped = runningExecutions.slice(0, 3);
  return { counts: countsFromRows(jobs, tasks), window: { jobs, tasks, executions, runningExecutions: capped } };
}
