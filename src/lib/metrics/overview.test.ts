import { describe, expect, it } from "vitest";

import {
  buildDayBuckets,
  computeAvgSubmissionMs,
  computeOverview,
  computeSuccessRate,
  countsFromRows,
  type OverviewExecutionRow,
  type OverviewJobRow,
  type OverviewTaskRow,
} from "@/lib/metrics/overview";
import { buildSampleOverviewDataset } from "@/lib/metrics/sample-dataset";

const NOW = new Date("2026-11-02T15:00:00Z");

const task = (over: Partial<OverviewTaskRow>): OverviewTaskRow => ({
  portal_slug: "northstar",
  status: "submitted",
  execution_mode: "live",
  created_at: "2026-11-02T10:00:00Z",
  completed_at: null,
  ...over,
});

const exec = (over: Partial<OverviewExecutionRow>): OverviewExecutionRow => ({
  status: "succeeded",
  mode: "live",
  worker_id: "w1",
  started_at: "2026-11-02T10:00:00Z",
  completed_at: "2026-11-02T10:00:30Z",
  ...over,
});

describe("buildDayBuckets", () => {
  it("returns N UTC days ending today, oldest first", () => {
    const days = buildDayBuckets(NOW, 3);
    expect(days.map((d) => d.date)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("computeSuccessRate", () => {
  it("returns null rather than a fabricated rate when nothing has finished", () => {
    expect(computeSuccessRate([task({ status: "pending" })])).toEqual({ value: null, mode: null, sampleSize: 0 });
  });

  it("prefers live results and ignores dry-run rehearsals when live exists", () => {
    const rate = computeSuccessRate([
      task({ status: "submitted" }),
      task({ status: "failed" }),
      task({ status: "submitted", execution_mode: "dry_run" }),
      task({ status: "submitted", execution_mode: "dry_run" }),
    ]);
    expect(rate).toEqual({ value: 0.5, mode: "live", sampleSize: 2 });
  });

  it("falls back to dry-run and labels it as such", () => {
    const rate = computeSuccessRate([
      task({ status: "submitted", execution_mode: "dry_run" }),
      task({ status: "human_review", execution_mode: "dry_run" }),
    ]);
    expect(rate.mode).toBe("dry_run");
    expect(rate.value).toBe(0.5);
  });

  it("excludes in-flight and cancelled tasks from the denominator", () => {
    const rate = computeSuccessRate([
      task({ status: "submitted" }),
      task({ status: "processing" }),
      task({ status: "retry_scheduled" }),
      task({ status: "cancelled" }),
    ]);
    expect(rate).toEqual({ value: 1, mode: "live", sampleSize: 1 });
  });
});

describe("computeAvgSubmissionMs", () => {
  it("averages successful executions only", () => {
    const avg = computeAvgSubmissionMs([
      exec({}), // 30s
      exec({ completed_at: "2026-11-02T10:01:30Z" }), // 90s
      exec({ status: "failed", completed_at: "2026-11-02T10:10:00Z" }),
      exec({ status: "running", completed_at: null }),
    ]);
    expect(avg).toEqual({ value: 60_000, mode: "live", sampleSize: 2 });
  });
});

describe("countsFromRows", () => {
  it("buckets job and task states the way the overview defines them", () => {
    const jobs: OverviewJobRow[] = [
      { status: "received", source_type: "external", received_at: "2026-11-02T01:00:00Z" },
      { status: "ready", source_type: "manual", received_at: "2026-11-02T01:00:00Z" },
      { status: "partially_submitted", source_type: "external", received_at: "2026-11-02T01:00:00Z" },
    ];
    const tasks = [task({ status: "pending" }), task({ status: "retry_scheduled" }), task({ status: "failed" })];
    const counts = countsFromRows(jobs, tasks);
    expect(counts.jobsTotal).toBe(3);
    expect(counts.jobsAwaiting).toBe(2);
    expect(counts.jobsPartial).toBe(1);
    expect(counts.tasksBacklog).toBe(2);
    expect(counts.tasksFailed).toBe(1);
  });
});

describe("computeOverview", () => {
  it("places rows into day buckets and ignores rows outside the window", () => {
    const jobs: OverviewJobRow[] = [
      { status: "submitted", source_type: "external", received_at: "2026-11-02T08:00:00Z" },
      { status: "failed", source_type: "manual", received_at: "2026-11-01T08:00:00Z" },
      { status: "submitted", source_type: "external", received_at: "2026-01-01T08:00:00Z" },
    ];
    const snap = computeOverview(
      countsFromRows(jobs, []),
      {
        jobs,
        tasks: [],
        executions: [],
        runningExecutions: [{ worker_id: "a" }, { worker_id: "a" }, { worker_id: null }],
      },
      NOW,
      7,
    );
    const today = snap.intakeSeries.at(-1)!;
    const yesterday = snap.intakeSeries.at(-2)!;
    expect(today).toMatchObject({ date: "2026-11-02", external: 1, manual: 0 });
    expect(yesterday).toMatchObject({ manual: 1 });
    expect(snap.processingTrend.at(-2)!.failed).toBe(1);
    expect(snap.intakeSeries.reduce((s, d) => s + d.external + d.manual, 0)).toBe(2);
    expect(snap.activeWorkers).toBe(1);
    expect(snap.portalWorkload).toHaveLength(5);
  });
});

describe("sample dataset", () => {
  it("is deterministic", () => {
    const a = buildSampleOverviewDataset(NOW);
    const b = buildSampleOverviewDataset(NOW);
    expect(a.counts).toEqual(b.counts);
  });

  it("stays near ~100 jobs per weekday and never exceeds 3 active workers", () => {
    const { counts, window } = buildSampleOverviewDataset(NOW);
    const snap = computeOverview(counts, window, NOW);
    expect(snap.activeWorkers).toBeLessThanOrEqual(3);
    const peak = Math.max(...snap.intakeSeries.map((d) => d.external + d.manual));
    expect(peak).toBeLessThanOrEqual(110);
    expect(window.jobs.every((j) => new Date(j.received_at) <= NOW)).toBe(true);
  });
});
