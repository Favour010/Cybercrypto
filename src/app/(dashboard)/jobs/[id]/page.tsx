import { Archive, ArrowLeft, CircleCheck, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataStateNotice } from "@/components/common/data-state-notice";
import { ArchiveButton } from "@/components/jobs/archive-button";
import { JobStatusBadge, PriorityBadge, SourceBadge } from "@/components/jobs/job-badges";
import {
  AttachmentsCard,
  AuditCard,
  ContactsCard,
  DestinationsCard,
  DetailSkeleton,
  ExecutionsCard,
  JobInfoCard,
} from "@/components/jobs/job-detail-sections";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { missingAuthConfig } from "@/lib/auth/config";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { getJobDetail } from "@/lib/data/jobs";
import { formatDateTime } from "@/lib/format";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoJobDetail } from "@/components/demo/pages/demo-jobs";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Job details" };

export default function JobDetailPage(props: PageProps<"/jobs/[id]">) {
  if (isDemoMode()) {
    return (
      <Suspense fallback={<DetailSkeleton />}>
        <DemoJobDetailRoute params={props.params} />
      </Suspense>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/jobs">
          <ArrowLeft /> All jobs
        </Link>
      </Button>
      <Suspense fallback={<DetailSkeleton />}>
        <JobDetailContent params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

const NOTICES: Record<string, { title: string; body: string }> = {
  created: {
    title: "Job created",
    body: "Saved as a manual job. It has not been submitted to any portal; assigned portals each have a pending submission task.",
  },
  duplicate: {
    title: "This form was already submitted",
    body: "The job below was created by your earlier submission. No second job was created.",
  },
  updated: { title: "Changes saved", body: "Nothing was re-sent to any portal." },
};

async function JobDetailContent({
  params,
  searchParams,
}: {
  params: PageProps<"/jobs/[id]">["params"];
  searchParams: PageProps<"/jobs/[id]">["searchParams"];
}) {
  const { id } = await params;
  const { notice: noticeKey } = await searchParams;
  const notice = typeof noticeKey === "string" ? NOTICES[noticeKey] : undefined;
  const auth = await requireUser();
  if (!auth.supabase) return <DataStateNotice result={{ kind: "not_configured", missing: missingAuthConfig() }} />;

  const result = await getJobDetail(auth.supabase, id, { includeAudit: can(auth.user.role, "audit_logs.read") });
  if (result.kind !== "ok") return <DataStateNotice result={result} />;
  if (!result.data) notFound();

  const detail = result.data;
  const { job } = detail;
  const canArchive = can(auth.user.role, "jobs.archive");
  const canEdit = can(auth.user.role, "jobs.edit") && !job.archived_at;

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-muted-foreground font-mono text-xs">{job.id}</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{job.reference}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{job.customer_name}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <JobStatusBadge status={job.status} />
            <PriorityBadge priority={job.priority} />
            <SourceBadge sourceType={job.source_type} source={job.source} />
          </div>
        </div>
        <div className="flex items-start gap-2">
          {canEdit ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/jobs/${job.id}/edit`}>
                <Pencil /> Edit job
              </Link>
            </Button>
          ) : null}
          {canArchive ? <ArchiveButton jobId={job.id} archived={Boolean(job.archived_at)} /> : null}
        </div>
      </div>

      {notice ? (
        <Alert variant="info">
          <CircleCheck />
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.body}</AlertDescription>
        </Alert>
      ) : null}

      {job.archived_at ? (
        <Alert>
          <Archive />
          <AlertTitle>Archived {formatDateTime(job.archived_at)}</AlertTitle>
          <AlertDescription>
            Archived jobs are kept in full but hidden from the default Jobs list and excluded from dashboard figures.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <JobInfoCard detail={detail} />
        <div className="flex flex-col gap-4">
          <ContactsCard contacts={detail.contacts} />
          <AttachmentsCard attachments={detail.attachments} />
        </div>
      </div>

      <DestinationsCard detail={detail} />
      <ExecutionsCard executions={detail.executions} />
      <AuditCard audit={detail.audit} />
    </>
  );
}

async function DemoJobDetailRoute({ params }: { params: PageProps<"/jobs/[id]">["params"] }) {
  const { id } = await params;
  return (
    <DemoReady>
      <DemoJobDetail jobId={id} />
    </DemoReady>
  );
}
