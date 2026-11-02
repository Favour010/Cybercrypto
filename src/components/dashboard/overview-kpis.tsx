import {
  Activity,
  CheckCheck,
  CircleSlash,
  Clock,
  Cpu,
  Gauge,
  Hourglass,
  Inbox,
  Layers,
  ListX,
  SplitSquareHorizontal,
  UserRoundSearch,
} from "lucide-react";

import { KpiCard } from "@/components/dashboard/kpi-card";
import { EXECUTION_MODE_META } from "@/lib/domain/status";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import type { OverviewSnapshot, RateMetric } from "@/lib/metrics/overview";

function rateHint(metric: RateMetric, unit: string, windowDays: number) {
  if (metric.value === null) return `No finished ${unit} in the last ${windowDays} days`;
  const mode = metric.mode ? EXECUTION_MODE_META[metric.mode].label.toLowerCase() : "";
  return `${mode === "live" ? "Live" : "Dry-run"} · ${formatNumber(metric.sampleSize)} ${unit} · last ${windowDays}d${
    mode === "dry run" ? " (no live results yet)" : ""
  }`;
}

/** KPI grid. `snapshot` is null when there is no data source: tiles show "—", never 0. */
export function OverviewKpis({ snapshot }: { snapshot: OverviewSnapshot | null }) {
  const c = snapshot?.counts;
  const v = (n: number | undefined) => formatNumber(n ?? null);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="kpi-pipeline">
        <h2 id="kpi-pipeline" className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
          Job pipeline
        </h2>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            label="Total jobs received"
            value={v(c?.jobsTotal)}
            icon={Inbox}
            hint="All active (non-archived) jobs"
          />
          <KpiCard
            label="Awaiting processing"
            value={v(c?.jobsAwaiting)}
            icon={Hourglass}
            hint="Received, validating or ready"
          />
          <KpiCard
            label="Currently processing"
            value={v(c?.jobsProcessing)}
            icon={Activity}
            hint="At least one portal task running"
          />
          <KpiCard
            label="Successfully submitted"
            value={v(c?.jobsSubmitted)}
            icon={CheckCheck}
            hint={
              c
                ? `${formatNumber(c.tasksSubmittedLive)} live portal submissions · ${formatNumber(c.tasksSubmittedDryRun)} dry-run rehearsals`
                : "All assigned portals confirmed"
            }
          />
          <KpiCard
            label="Partially submitted"
            value={v(c?.jobsPartial)}
            icon={SplitSquareHorizontal}
            hint="Some portals confirmed, others not"
            emphasis={c && c.jobsPartial > 0 ? "attention" : undefined}
          />
          <KpiCard
            label="Requires human review"
            value={v(c?.jobsReview)}
            icon={UserRoundSearch}
            hint="Routing gaps, validation or portal issues"
            emphasis={c && c.jobsReview > 0 ? "attention" : undefined}
          />
          <KpiCard
            label="Failed jobs"
            value={v(c?.jobsFailed)}
            icon={CircleSlash}
            hint="No portal submission succeeded"
            emphasis={c && c.jobsFailed > 0 ? "critical" : undefined}
          />
          <KpiCard
            label="Success rate"
            value={formatPercent(snapshot?.successRate.value)}
            icon={Gauge}
            hint={snapshot ? rateHint(snapshot.successRate, "tasks", snapshot.windowDays) : "Finished portal tasks"}
          />
        </div>
      </section>

      <section aria-labelledby="kpi-engine">
        <h2 id="kpi-engine" className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
          Automation engine
        </h2>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            label="Failed submissions"
            value={v(c?.tasksFailed)}
            icon={ListX}
            hint="Portal tasks that exhausted retries"
            emphasis={c && c.tasksFailed > 0 ? "critical" : undefined}
          />
          <KpiCard
            label="Active browser workers"
            value={formatNumber(snapshot?.activeWorkers ?? null)}
            icon={Cpu}
            hint="Workers with a running execution"
          />
          <KpiCard
            label="Queue backlog"
            value={v(c?.tasksBacklog)}
            icon={Layers}
            hint="Pending or retry-scheduled tasks"
          />
          <KpiCard
            label="Average submission time"
            value={formatDuration(snapshot?.avgSubmissionMs.value)}
            icon={Clock}
            hint={
              snapshot ? rateHint(snapshot.avgSubmissionMs, "executions", snapshot.windowDays) : "Successful executions"
            }
          />
        </div>
      </section>
    </div>
  );
}
