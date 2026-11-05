import { Archive, ArrowLeft, Globe } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { updateJobAction } from "@/app/(dashboard)/jobs/form-actions";
import { DataStateNotice } from "@/components/common/data-state-notice";
import { PermissionDenied } from "@/components/common/permission-denied";
import { JobForm } from "@/components/jobs/job-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { missingAuthConfig } from "@/lib/auth/config";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { getEditableJob, getFormPortals } from "@/lib/data/job-form";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoEditJob } from "@/components/demo/pages/demo-jobs";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Edit job" };

export default function EditJobPage(props: PageProps<"/jobs/[id]/edit">) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<Skeleton className="h-[640px] rounded-xl" />}>
        {isDemoMode() ? <DemoEditRoute params={props.params} /> : <EditJobContent params={props.params} />}
      </Suspense>
    </div>
  );
}

async function EditJobContent({ params }: { params: PageProps<"/jobs/[id]/edit">["params"] }) {
  const { id } = await params;
  const auth = await requireUser();
  if (!can(auth.user.role, "jobs.edit")) {
    return <PermissionDenied role={auth.user.role} needed="operator" what="Editing jobs" />;
  }
  if (!auth.supabase) return <DataStateNotice result={{ kind: "not_configured", missing: missingAuthConfig() }} />;

  const [job, portals] = await Promise.all([getEditableJob(auth.supabase, id), getFormPortals(auth.supabase)]);
  if (job.kind !== "ok") return <DataStateNotice result={job} />;
  if (portals.kind !== "ok") return <DataStateNotice result={portals} />;
  if (!job.data) notFound();
  const j = job.data;

  return (
    <>
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="w-fit">
          <Link href={`/jobs/${j.id}`}>
            <ArrowLeft /> Back to {j.reference}
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Edit {j.reference}</h1>
          <p className="text-muted-foreground mt-1 inline-flex items-center gap-1.5 text-sm">
            <Globe className="size-3.5" aria-hidden />
            {j.source_type === "external"
              ? `External job from ${j.source} · ${j.external_job_id}. The source and external ID cannot be changed.`
              : "Manual job"}
          </p>
        </div>
      </div>
      {j.archived ? (
        <Alert>
          <Archive />
          <AlertTitle>This job is archived</AlertTitle>
          <AlertDescription>Restore it from the job page before editing.</AlertDescription>
        </Alert>
      ) : (
        <JobForm
          mode="edit"
          action={updateJobAction}
          initial={j.values}
          portals={portals.data}
          job={j}
          cancelHref={`/jobs/${j.id}`}
        />
      )}
    </>
  );
}

async function DemoEditRoute({ params }: { params: PageProps<"/jobs/[id]/edit">["params"] }) {
  const { id } = await params;
  return (
    <DemoReady>
      <DemoEditJob jobId={id} />
    </DemoReady>
  );
}
