import { FilePlus2, Inbox } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { AutoRefresh, type ConnectionStatus } from "@/components/dashboard/auto-refresh";
import { DataStateNotice } from "@/components/common/data-state-notice";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { IntegrationStatusCard } from "@/components/dashboard/integration-status-card";
import {
  AutomationActivityChart,
  JobIntakeChart,
  PortalOutcomeChart,
  PortalWorkloadChart,
  ProcessingTrendChart,
} from "@/components/dashboard/overview-charts";
import { OverviewKpis } from "@/components/dashboard/overview-kpis";
import { OverviewSkeleton } from "@/components/dashboard/overview-skeleton";
import { PipelineCard } from "@/components/dashboard/pipeline-card";
import { Button } from "@/components/ui/button";
import { missingAuthConfig } from "@/lib/auth/config";
import { requireUser } from "@/lib/auth/session";
import { getOverview } from "@/lib/data/overview";
import { isSnapshotEmpty } from "@/lib/metrics/overview";

export default function OverviewPage(props: PageProps<"/">) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Live operational view of job intake, portal routing and browser automation. All figures are read from the JobSync database."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/jobs/new">
              <FilePlus2 /> Create job
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function OverviewContent({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  // Request-time data: never prerendered (the figures and "now" are per request).
  await connection();
  const params = await searchParams;
  // Auth is verified here, next to the data, not only in proxy.ts.
  const auth = await requireUser();
  const result = await getOverview({
    preview: params.preview === "sample" ? "sample" : undefined,
    // The user's own client: Row Level Security scopes every figure.
    db: auth.supabase,
    missing: auth.kind === "dev_bypass" ? missingAuthConfig() : undefined,
  });
  const snapshot = result.kind === "ok" ? result.data : null;
  const empty = snapshot ? isSnapshotEmpty(snapshot) : false;
  const liveStatus: ConnectionStatus | null =
    result.kind === "ok"
      ? result.source === "database"
        ? "connected"
        : null
      : result.kind === "schema_missing"
        ? "schema_missing"
        : result.kind === "error"
          ? "error"
          : null;

  return (
    <>
      {liveStatus ? (
        <AutoRefresh status={liveStatus} generatedAt={snapshot?.generatedAt ?? new Date().toISOString()} />
      ) : null}
      <DataStateNotice result={result} />
      {snapshot && empty ? (
        <EmptyState
          icon={Inbox}
          title="No jobs received yet"
          description="The database is connected and empty. Jobs will appear once they arrive through the intake API or are created manually."
          action={
            <Button asChild size="sm">
              <Link href="/jobs/new">Create a job</Link>
            </Button>
          }
        />
      ) : null}

      <OverviewKpis snapshot={snapshot} />

      {snapshot ? (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <JobIntakeChart data={snapshot.intakeSeries} />
            <PortalOutcomeChart data={snapshot.portalOutcomes} />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <PortalWorkloadChart data={snapshot.portalWorkload} />
            <ProcessingTrendChart data={snapshot.processingTrend} />
            <AutomationActivityChart data={snapshot.automationActivity} />
          </div>
          <p className="text-muted-foreground text-xs">
            Charts cover the last {snapshot.windowDays} days (UTC). Generated{" "}
            {new Date(snapshot.generatedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC.
          </p>
        </>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <PipelineCard />
        <IntegrationStatusCard />
      </div>
    </>
  );
}
