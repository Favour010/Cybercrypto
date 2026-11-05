"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { useDemo } from "@/components/demo/demo-provider";
import { DemoNotice } from "@/components/demo/demo-ui";
import { WorkerPanel } from "@/components/demo/worker-panel";
import {
  AutomationActivityChart,
  JobIntakeChart,
  PortalOutcomeChart,
  PortalWorkloadChart,
  ProcessingTrendChart,
} from "@/components/dashboard/overview-charts";
import { OverviewKpis } from "@/components/dashboard/overview-kpis";
import { PipelineCard } from "@/components/dashboard/pipeline-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { overview } from "@/lib/demo/selectors";
import { formatNumber } from "@/lib/format";
import { isSnapshotEmpty } from "@/lib/metrics/overview";

export function DemoOverview() {
  const { state, now } = useDemo();
  // Recompute when data changes, or every 10 s for the time window.
  const bucket = Math.floor(now.getTime() / 10_000);
  const snapshot = useMemo(() => overview(state, new Date(bucket * 10_000)), [state, bucket]);
  const attention = state.jobs.filter((j) => !j.archived_at && j.status === "requires_human_review").length;

  return (
    <>
      <DemoNotice />
      {isSnapshotEmpty(snapshot) ? (
        <EmptyState
          icon={Inbox}
          title="No jobs yet"
          description="Create a job or simulate incoming jobs to see the dashboard fill in."
          action={
            <Button asChild size="sm">
              <Link href="/jobs/new">Create a job</Link>
            </Button>
          }
        />
      ) : null}
      <OverviewKpis snapshot={snapshot} />
      <div className="grid gap-4 xl:grid-cols-2">
        <JobIntakeChart data={snapshot.intakeSeries} />
        <PortalOutcomeChart data={snapshot.portalOutcomes} submittedLabel="Dry-run passed or submitted" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <PortalWorkloadChart data={snapshot.portalWorkload} />
        <ProcessingTrendChart data={snapshot.processingTrend} submittedLabel="Dry-run passed or submitted" />
        <AutomationActivityChart data={snapshot.automationActivity} />
      </div>
      <p className="text-muted-foreground text-xs">
        Charts cover the last {snapshot.windowDays} days (UTC). &ldquo;Live&rdquo; submissions here are ones a person
        completed on a portal and recorded with its reference; automated runs in the demo are dry runs.
      </p>
      <div className="grid gap-4 xl:grid-cols-3">
        <WorkerPanel compact />
        <PipelineCard />
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>Open items that a person should look at.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {[
                { label: "Jobs requiring human review", value: attention, href: "/failed" },
                { label: "Failed portal submissions", value: snapshot.counts.tasksFailed, href: "/failed?tab=failed" },
                { label: "Tasks waiting in the queue", value: snapshot.counts.tasksBacklog, href: "/queue" },
                {
                  label: "Jobs awaiting routing",
                  value: state.jobs.filter((j) => !j.archived_at && j.status === "received").length,
                  href: "/incoming?view=awaiting_routing",
                },
              ].map((r) => (
                <li key={r.label} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                  <Link href={r.href} className="hover:underline">
                    {r.label}
                  </Link>
                  <span className="font-semibold tabular-nums">{formatNumber(r.value)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
