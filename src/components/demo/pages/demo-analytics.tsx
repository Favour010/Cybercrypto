"use client";

import {
  Activity,
  Clock,
  Download,
  Gauge,
  Hourglass,
  Inbox,
  Layers,
  ListX,
  RotateCcw,
  Timer,
  UserRoundSearch,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useDemo } from "@/components/demo/demo-provider";
import { DemoNotice } from "@/components/demo/demo-ui";
import { ChartFrame } from "@/components/dashboard/chart-frame";
import { ChartTooltip } from "@/components/dashboard/chart-tooltip";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { JobIntakeChart } from "@/components/dashboard/overview-charts";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHART_CHROME, SERIES, STATUS_COLOR } from "@/lib/charts/palette";
import { analytics } from "@/lib/demo/selectors";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const RANGES = [7, 14, 21] as const;
const axis = {
  stroke: CHART_CHROME.axis,
  tick: { fill: CHART_CHROME.axis, fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;
const grid = { stroke: CHART_CHROME.grid, vertical: false } as const;
const gap = { stroke: CHART_CHROME.surface, strokeWidth: 2 } as const;
const cursor = { fill: "var(--muted)", opacity: 0.6 } as const;

export function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((v) => (v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)))
        .join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DemoAnalytics() {
  const { state, now } = useDemo();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const range = RANGES.find((r) => String(r) === params.get("days")) ?? 14;
  const minute = Math.floor(now.getTime() / 60_000);
  const a = useMemo(() => analytics(state, range, new Date(minute * 60_000)), [state, range, minute]);
  const t = a.totals;

  return (
    <>
      <DemoNotice>
        <strong>Realistic sample data.</strong> Figures are calculated from the demo data in this browser (seed history
        plus anything you create). Automated portal runs are simulated dry runs; &ldquo;manual&rdquo; submissions were
        recorded by a person.
      </DemoNotice>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Reporting period">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={r === range}
            onClick={() => router.replace(r === 14 ? pathname : `${pathname}?days=${r}`, { scroll: false })}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              r === range ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent",
            )}
          >
            Last {r} days
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <KpiCard
          label="Jobs received"
          value={formatNumber(t.jobs)}
          icon={Inbox}
          hint={`${formatNumber(Math.round(t.jobs / range))} per day on average`}
        />
        <KpiCard
          label="Portal submissions"
          value={formatNumber(t.tasks)}
          icon={Layers}
          hint="Job→portal tasks created"
        />
        <KpiCard
          label="Success rate"
          value={formatPercent(t.successRate)}
          icon={Gauge}
          hint="Finished automated tasks (dry run)"
        />
        <KpiCard
          label="Attempt failure rate"
          value={formatPercent(t.failureRate)}
          icon={ListX}
          hint={`${formatNumber(t.executions)} attempts`}
          emphasis={t.failureRate && t.failureRate > 0.2 ? "attention" : undefined}
        />
        <KpiCard
          label="Human review"
          value={formatNumber(t.humanReview)}
          icon={UserRoundSearch}
          hint="Tasks waiting for a person"
          emphasis={t.humanReview > 0 ? "attention" : undefined}
        />
        <KpiCard
          label="Avg execution time"
          value={formatDuration(t.avgDurationMs)}
          icon={Timer}
          hint="Successful attempts"
        />
        <KpiCard
          label="Avg attempts"
          value={t.avgAttempts ? t.avgAttempts.toFixed(2) : "—"}
          icon={RotateCcw}
          hint="Per finished task"
        />
        <KpiCard label="Retries" value={formatNumber(t.retries)} icon={Activity} hint="Attempts after the first" />
        <KpiCard
          label="Avg queue wait"
          value={formatDuration(t.avgWaitMs)}
          icon={Hourglass}
          hint="Task created → first attempt"
        />
        <KpiCard
          label="Avg time to complete"
          value={formatDuration(t.avgCompletionMs)}
          icon={Clock}
          hint="Task created → finished"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <JobIntakeChart data={a.daily} />
        <ChartFrame
          title="Automation attempts per day"
          description="Simulated browser attempts, by result"
          legend={[
            { label: "Succeeded", color: STATUS_COLOR.good },
            { label: "Failed", color: STATUS_COLOR.critical },
          ]}
          table={{
            columns: [
              { key: "label", label: "Day" },
              { key: "ok", label: "Succeeded", numeric: true },
              { key: "failedExecutions", label: "Failed", numeric: true },
            ],
            rows: a.daily.map((d) => ({ ...d, ok: d.executions - d.failedExecutions })),
          }}
          empty={
            a.daily.every((d) => d.executions === 0) ? (
              <p className="text-muted-foreground text-sm">No attempts in this period.</p>
            ) : undefined
          }
        >
          <ResponsiveContainer>
            <BarChart
              data={a.daily.map((d) => ({ ...d, ok: d.executions - d.failedExecutions }))}
              margin={{ top: 4, right: 4, bottom: 0, left: -16 }}
              barCategoryGap="22%"
            >
              <CartesianGrid {...grid} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
              <YAxis {...axis} allowDecimals={false} width={44} />
              <Tooltip cursor={cursor} content={<ChartTooltip showTotal />} />
              <Bar dataKey="ok" name="Succeeded" stackId="a" fill={STATUS_COLOR.good} {...gap} />
              <Bar
                dataKey="failedExecutions"
                name="Failed"
                stackId="a"
                fill={STATUS_COLOR.critical}
                radius={[4, 4, 0, 0]}
                {...gap}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartFrame
          title="Success rate by portal"
          description="Finished automated tasks that passed"
          table={{
            columns: [
              { key: "name", label: "Portal" },
              { key: "rate", label: "Success rate", numeric: true },
            ],
            rows: a.portals.map((p) => ({ name: p.name, rate: formatPercent(p.successRate) })),
          }}
        >
          <ResponsiveContainer>
            <BarChart
              data={a.portals.map((p) => ({
                name: p.name,
                rate: p.successRate === null ? 0 : Math.round(p.successRate * 1000) / 10,
              }))}
              margin={{ top: 16, right: 4, bottom: 0, left: -8 }}
              barCategoryGap="34%"
            >
              <CartesianGrid {...grid} />
              <XAxis dataKey="name" {...axis} />
              <YAxis {...axis} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} unit="%" width={58} />
              <Tooltip cursor={cursor} content={<ChartTooltip />} />
              <Bar
                dataKey="rate"
                name="Success rate (%)"
                fill={SERIES[1]}
                radius={[4, 4, 0, 0]}
                label={{
                  position: "top",
                  fill: "var(--muted-foreground)",
                  fontSize: 11,
                  formatter: (v: unknown) => `${v}%`,
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
        <ChartFrame
          title="Failure reasons"
          description="Failed attempts by error code"
          table={{
            columns: [
              { key: "code", label: "Error code" },
              { key: "count", label: "Attempts", numeric: true },
            ],
            rows: a.failureReasons,
          }}
          empty={
            a.failureReasons.length === 0 ? (
              <p className="text-muted-foreground text-sm">No failed attempts in this period.</p>
            ) : undefined
          }
        >
          <ResponsiveContainer>
            <BarChart
              data={a.failureReasons}
              layout="vertical"
              margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
              barCategoryGap="28%"
            >
              <CartesianGrid stroke={CHART_CHROME.grid} horizontal={false} vertical />
              <XAxis type="number" {...axis} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="code"
                {...axis}
                width={170}
                tick={{ fill: CHART_CHROME.axis, fontSize: 10 }}
              />
              <Tooltip cursor={cursor} content={<ChartTooltip />} />
              <Bar dataKey="count" name="Attempts" fill={SERIES[2]} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
        <ChartFrame
          title="Average daily workload"
          description="Jobs received per weekday (average)"
          table={{
            columns: [
              { key: "label", label: "Weekday" },
              { key: "jobs", label: "Jobs", numeric: true },
            ],
            rows: a.weekday,
          }}
        >
          <ResponsiveContainer>
            <BarChart data={a.weekday} margin={{ top: 16, right: 4, bottom: 0, left: -16 }} barCategoryGap="30%">
              <CartesianGrid {...grid} />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} allowDecimals={false} width={44} />
              <Tooltip cursor={cursor} content={<ChartTooltip />} />
              <Bar
                dataKey="jobs"
                name="Jobs per day"
                fill={SERIES[1]}
                radius={[4, 4, 0, 0]}
                label={{ position: "top", fill: "var(--muted-foreground)", fontSize: 11 }}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Portal performance</CardTitle>
          <CardDescription>
            Last {range} days. Success rate covers automated tasks; manual submissions are counted separately.
          </CardDescription>
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadCsv(`jobsync-portal-performance-${range}d.csv`, [
                  [
                    "portal",
                    "tasks",
                    "dry_run_passed",
                    "submitted_manually",
                    "failed",
                    "human_review",
                    "open",
                    "success_rate",
                    "avg_duration_ms",
                    "avg_attempts",
                  ],
                  ...a.portals.map((p) => [
                    p.name,
                    p.tasks,
                    p.dryRunPassed,
                    p.manual,
                    p.failed,
                    p.review,
                    p.open,
                    p.successRate === null ? null : Number(p.successRate.toFixed(4)),
                    p.avgDurationMs === null ? null : Math.round(p.avgDurationMs),
                    p.avgAttempts === null ? null : Number(p.avgAttempts.toFixed(2)),
                  ]),
                ])
              }
            >
              <Download aria-hidden /> Export CSV
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Portal</TableHead>
                  <TableHead className="text-right">Tasks</TableHead>
                  <TableHead className="text-right">Dry runs passed</TableHead>
                  <TableHead className="text-right">Manual</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                  <TableHead className="text-right">Avg time</TableHead>
                  <TableHead className="text-right">Avg attempts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.portals.map((p) => (
                  <TableRow key={p.slug}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    {[p.tasks, p.dryRunPassed, p.manual, p.failed, p.review, p.open].map((v, i) => (
                      <TableCell key={i} className="text-right tabular-nums">
                        {formatNumber(v)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">{formatPercent(p.successRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatDuration(p.avgDurationMs)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.avgAttempts ? p.avgAttempts.toFixed(2) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
