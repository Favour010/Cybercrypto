import { FilePlus2, Inbox, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataStateNotice } from "@/components/common/data-state-notice";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { JobsFilters } from "@/components/jobs/jobs-filters";
import { JobsPagination, JobsTable } from "@/components/jobs/jobs-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { missingAuthConfig } from "@/lib/auth/config";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { listJobs } from "@/lib/data/jobs";
import type { DataResult } from "@/lib/data/result";
import { hasActiveFilters, jobsHref, parseJobsQuery } from "@/lib/jobs/query";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoJobs } from "@/components/demo/pages/demo-jobs";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage(props: PageProps<"/jobs">) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Jobs"
        description="Every work order in JobSync, whether received from an external system or entered manually."
      />
      {isDemoMode() ? (
        <Suspense fallback={<JobsSkeleton />}>
          <DemoReady>
            <DemoJobs />
          </DemoReady>
        </Suspense>
      ) : (
        <Suspense fallback={<JobsSkeleton />}>
          <JobsContent searchParams={props.searchParams} />
        </Suspense>
      )}
    </div>
  );
}

async function JobsContent({ searchParams }: { searchParams: PageProps<"/jobs">["searchParams"] }) {
  const query = parseJobsQuery(await searchParams);
  const auth = await requireUser();

  if (!auth.supabase) {
    const result: DataResult<never> = { kind: "not_configured", missing: missingAuthConfig() };
    return (
      <>
        <DataStateNotice result={result} />
        <JobsFilters query={query} />
      </>
    );
  }

  const result = await listJobs(auth.supabase, query);
  if (result.kind !== "ok") {
    return (
      <>
        <DataStateNotice result={result} />
        <JobsFilters query={query} />
      </>
    );
  }

  const list = result.data;
  const filtered = hasActiveFilters(query);
  const canCreate = can(auth.user.role, "jobs.create");

  return (
    <>
      <JobsFilters query={query} />
      {list.outOfRange ? (
        <EmptyState
          icon={SearchX}
          title="That page does not exist"
          description={`There are ${list.total} matching jobs across ${list.pageCount} pages.`}
          action={
            <Button asChild size="sm" variant="outline">
              <Link href={jobsHref(query, { page: list.pageCount })}>Go to the last page</Link>
            </Button>
          }
        />
      ) : list.total === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="No jobs match these filters"
            description="Try a different search term or clear the filters."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/jobs">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="No jobs yet"
            description="Jobs appear here when they arrive through the intake API or are created manually."
            action={
              canCreate ? (
                <Button asChild size="sm">
                  <Link href="/jobs/new">
                    <FilePlus2 /> Create job
                  </Link>
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <JobsTable list={list} query={query} />
          <JobsPagination list={list} query={query} />
        </>
      )}
    </>
  );
}

function JobsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading jobs">
      <Skeleton className="h-36 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
