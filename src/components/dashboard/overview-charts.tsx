"use client";

import { BarChart3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyState } from "@/components/common/empty-state";
import { ChartFrame } from "@/components/dashboard/chart-frame";
import { ChartTooltip } from "@/components/dashboard/chart-tooltip";
import { CHART_CHROME, SERIES, STATUS_COLOR } from "@/lib/charts/palette";
import type { OverviewSnapshot } from "@/lib/metrics/overview";

/* Shared chart chrome: recessive grid/axes, thin marks, 2px surface gaps. */
const axisProps = {
  stroke: CHART_CHROME.axis,
  tick: { fill: CHART_CHROME.axis, fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;
const gridProps = { stroke: CHART_CHROME.grid, strokeDasharray: "0", vertical: false } as const;
const barGap = { stroke: CHART_CHROME.surface, strokeWidth: 2 } as const;
const cursor = { fill: "var(--muted)", opacity: 0.6 } as const;
const END_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
const END_RADIUS_H: [number, number, number, number] = [0, 4, 4, 0];

function NoData({ message }: { message: string }) {
  return <EmptyState icon={BarChart3} title="No data yet" description={message} className="h-64 py-6" />;
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}

export function JobIntakeChart({ data }: { data: OverviewSnapshot["intakeSeries"] }) {
  const hasData = sum(data.map((d) => d.external + d.manual)) > 0;
  return (
    <ChartFrame
      title="Job intake"
      description="Jobs received per day, by source (UTC)"
      legend={[
        { label: "External intake", color: SERIES[1] },
        { label: "Manual entry", color: SERIES[2] },
      ]}
      table={{
        columns: [
          { key: "label", label: "Day" },
          { key: "external", label: "External", numeric: true },
          { key: "manual", label: "Manual", numeric: true },
        ],
        rows: data,
      }}
      empty={
        hasData ? undefined : <NoData message="Jobs appear here once they arrive through intake or manual entry." />
      }
    >
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }} barCategoryGap="22%">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...axisProps} allowDecimals={false} width={44} />
          <Tooltip cursor={cursor} content={<ChartTooltip showTotal />} />
          <Bar dataKey="external" name="External intake" stackId="a" fill={SERIES[1]} {...barGap} />
          <Bar dataKey="manual" name="Manual entry" stackId="a" fill={SERIES[2]} radius={END_RADIUS} {...barGap} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** `submittedLabel` lets the demo say "dry run passed" instead of claiming real submissions. */
export function PortalOutcomeChart({
  data,
  submittedLabel = "Submitted",
}: {
  data: OverviewSnapshot["portalOutcomes"];
  submittedLabel?: string;
}) {
  const hasData = sum(data.map((d) => d.submitted + d.failed + d.humanReview)) > 0;
  return (
    <ChartFrame
      title="Submission outcomes by portal"
      description="Finished portal tasks in the window"
      legend={[
        { label: submittedLabel, color: STATUS_COLOR.good },
        { label: "Human review", color: STATUS_COLOR.warning },
        { label: "Failed", color: STATUS_COLOR.critical },
      ]}
      table={{
        columns: [
          { key: "name", label: "Portal" },
          { key: "submitted", label: submittedLabel, numeric: true },
          { key: "humanReview", label: "Human review", numeric: true },
          { key: "failed", label: "Failed", numeric: true },
        ],
        rows: data,
      }}
      empty={hasData ? undefined : <NoData message="Outcomes appear once portal submission tasks finish." />}
    >
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid {...gridProps} horizontal={false} vertical />
          <XAxis type="number" {...axisProps} allowDecimals={false} />
          <YAxis type="category" dataKey="name" {...axisProps} width={84} />
          <Tooltip cursor={cursor} content={<ChartTooltip showTotal />} />
          {/* Order good → warning → critical keeps red away from green (CVD-safe). */}
          <Bar dataKey="submitted" name={submittedLabel} stackId="o" fill={STATUS_COLOR.good} {...barGap} />
          <Bar dataKey="humanReview" name="Human review" stackId="o" fill={STATUS_COLOR.warning} {...barGap} />
          <Bar
            dataKey="failed"
            name="Failed"
            stackId="o"
            fill={STATUS_COLOR.critical}
            radius={END_RADIUS_H}
            {...barGap}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function PortalWorkloadChart({ data }: { data: OverviewSnapshot["portalWorkload"] }) {
  const hasData = sum(data.map((d) => d.tasks)) > 0;
  return (
    <ChartFrame
      title="Workload by destination portal"
      description="Submission tasks created in the window"
      table={{
        columns: [
          { key: "name", label: "Portal" },
          { key: "tasks", label: "Tasks", numeric: true },
        ],
        rows: data,
      }}
      empty={hasData ? undefined : <NoData message="Each job→portal assignment becomes a task counted here." />}
    >
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 16, right: 4, bottom: 0, left: -16 }} barCategoryGap="34%">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="name" {...axisProps} />
          <YAxis {...axisProps} allowDecimals={false} width={44} />
          <Tooltip cursor={cursor} content={<ChartTooltip />} />
          <Bar
            dataKey="tasks"
            name="Tasks"
            fill={SERIES[1]}
            radius={END_RADIUS}
            label={{ position: "top", fill: "var(--muted-foreground)", fontSize: 11 }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function ProcessingTrendChart({
  data,
  submittedLabel = "Submitted",
}: {
  data: OverviewSnapshot["processingTrend"];
  submittedLabel?: string;
}) {
  const hasData = sum(data.map((d) => d.submitted + d.partial + d.failed + d.review)) > 0;
  const lineProps = {
    type: "monotone",
    strokeWidth: 2,
    dot: false,
    activeDot: { r: 4, strokeWidth: 2, stroke: CHART_CHROME.surface },
  } as const;
  return (
    <ChartFrame
      title="Job processing trend"
      description="Final job outcome, by day received"
      legend={[
        { label: submittedLabel, color: STATUS_COLOR.good },
        { label: "Human review", color: STATUS_COLOR.warning },
        { label: "Failed", color: STATUS_COLOR.critical },
        { label: "Partially submitted", color: STATUS_COLOR.serious },
      ]}
      table={{
        columns: [
          { key: "label", label: "Day" },
          { key: "submitted", label: submittedLabel, numeric: true },
          { key: "review", label: "Human review", numeric: true },
          { key: "failed", label: "Failed", numeric: true },
          { key: "partial", label: "Partial", numeric: true },
        ],
        rows: data,
      }}
      empty={hasData ? undefined : <NoData message="Trends appear once jobs reach a final status." />}
    >
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...axisProps} allowDecimals={false} width={44} />
          <Tooltip cursor={{ stroke: CHART_CHROME.axis, strokeDasharray: "3 3" }} content={<ChartTooltip />} />
          <Line dataKey="submitted" name={submittedLabel} stroke={STATUS_COLOR.good} {...lineProps} />
          <Line dataKey="review" name="Human review" stroke={STATUS_COLOR.warning} {...lineProps} />
          <Line dataKey="failed" name="Failed" stroke={STATUS_COLOR.critical} {...lineProps} />
          <Line dataKey="partial" name="Partially submitted" stroke={STATUS_COLOR.serious} {...lineProps} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function AutomationActivityChart({ data }: { data: OverviewSnapshot["automationActivity"] }) {
  const hasData = sum(data.map((d) => d.live + d.dryRun)) > 0;
  return (
    <ChartFrame
      title="Daily automation activity"
      description="Browser executions started per day, by execution mode"
      legend={[
        { label: "Live", color: SERIES[1] },
        { label: "Dry run", color: SERIES[2] },
      ]}
      table={{
        columns: [
          { key: "label", label: "Day" },
          { key: "live", label: "Live", numeric: true },
          { key: "dryRun", label: "Dry run", numeric: true },
        ],
        rows: data,
      }}
      empty={
        hasData ? undefined : <NoData message="Each Playwright execution attempt is counted here, split by mode." />
      }
    >
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }} barCategoryGap="22%">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...axisProps} allowDecimals={false} width={44} />
          <Tooltip cursor={cursor} content={<ChartTooltip showTotal />} />
          <Bar dataKey="live" name="Live" stackId="m" fill={SERIES[1]} {...barGap} />
          <Bar dataKey="dryRun" name="Dry run" stackId="m" fill={SERIES[2]} radius={END_RADIUS} {...barGap} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
