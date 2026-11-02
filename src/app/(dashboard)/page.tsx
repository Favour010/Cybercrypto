import { FilePlus2, Inbox } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

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
  const params = await searchParams;
  const result = await getOverview({ preview: params.preview === "sample" ? "sample" : undefined });
  const snapshot = result.kind === "ok" ? result.data : null;
  const empty = snapshot ? isSnapshotEmpty(snapshot) : false;

  return (
    <>
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
