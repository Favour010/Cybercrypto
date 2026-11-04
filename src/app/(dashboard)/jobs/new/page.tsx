import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { createJobAction } from "@/app/(dashboard)/jobs/form-actions";
import { DataStateNotice } from "@/components/common/data-state-notice";
import { PageHeader } from "@/components/common/page-header";
import { PermissionDenied } from "@/components/common/permission-denied";
import { JobForm } from "@/components/jobs/job-form";
import { Skeleton } from "@/components/ui/skeleton";
import { missingAuthConfig } from "@/lib/auth/config";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { EMPTY_JOB_FORM, getFormPortals } from "@/lib/data/job-form";
import { PORTALS } from "@/lib/domain/portals";

export const metadata: Metadata = { title: "Create job" };

export default function CreateJobPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Create Job"
        description="Enter a work order manually. It joins the same pipeline as jobs received from external systems and is labelled as Manual."
      />
      <Suspense fallback={<Skeleton className="h-[640px] rounded-xl" />}>
        <CreateJobContent />
      </Suspense>
    </div>
  );
}

async function CreateJobContent() {
  await connection();
  const auth = await requireUser();
  if (!can(auth.user.role, "jobs.create")) {
    return <PermissionDenied role={auth.user.role} needed="operator" what="Creating jobs" />;
  }
  if (!auth.supabase) {
    // No database: show the form for review, clearly marked as unable to save.
    return (
      <>
        <DataStateNotice result={{ kind: "not_configured", missing: missingAuthConfig() }} />
        <JobForm
          mode="create"
          action={createJobAction}
          initial={EMPTY_JOB_FORM}
          portals={PORTALS.map((p) => ({ slug: p.slug, name: p.name, is_enabled: true }))}
          cancelHref="/jobs"
        />
      </>
    );
  }

  const portals = await getFormPortals(auth.supabase);
  if (portals.kind !== "ok") return <DataStateNotice result={portals} />;

  return (
    <JobForm
      mode="create"
      action={createJobAction}
      initial={EMPTY_JOB_FORM}
      portals={portals.data}
      cancelHref="/jobs"
    />
  );
}
