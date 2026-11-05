"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CircleCheck,
  FilePlus2,
  Inbox,
  Pencil,
  Route,
  SearchX,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { JobFormState } from "@/app/(dashboard)/jobs/form-actions";
import { EmptyState } from "@/components/common/empty-state";
import { PermissionDenied } from "@/components/common/permission-denied";
import { useDemo } from "@/components/demo/demo-provider";
import { ConfirmAction, DemoNotice, TaskStatusBadge } from "@/components/demo/demo-ui";
import { TaskActions } from "@/components/demo/task-actions";
import { JobStatusBadge, PriorityBadge, SourceBadge } from "@/components/jobs/job-badges";
import {
  AttachmentsCard,
  AuditCard,
  ContactsCard,
  DestinationsCard,
  ExecutionsCard,
  JobInfoCard,
} from "@/components/jobs/job-detail-sections";
import { JobForm } from "@/components/jobs/job-form";
import { JobsFilters } from "@/components/jobs/jobs-filters";
import { JobsPagination, JobsTable } from "@/components/jobs/jobs-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { EMPTY_JOB_FORM, type JobFormValues } from "@/lib/jobs/form-types";
import { EngineError, assignDestinations, createManualJob, setJobArchived, updateJob } from "@/lib/demo/engine";
import { deleteFiles, getFile, putFile } from "@/lib/demo/persistence";
import { editableJob, formPortals, jobDetail, listJobs, portalName } from "@/lib/demo/selectors";
import { formatDateTime } from "@/lib/format";
import { validateAttachmentsInBrowser } from "@/lib/jobs/attachments-browser";
import { hasActiveFilters, jobsHref, parseJobsQuery } from "@/lib/jobs/query";
import { formDataToJobInput, jobFormSchema, toFieldErrors } from "@/lib/jobs/schema";
import { uuidV4 } from "@/lib/uuid";

/* ------------------------------------------------------------------ list */

export function DemoJobs() {
  const { state, user } = useDemo();
  const params = useSearchParams();
  const query = useMemo(() => parseJobsQuery(Object.fromEntries(params.entries())), [params]);
  const list = useMemo(() => listJobs(state, query), [state, query]);
  const filtered = hasActiveFilters(query);

  return (
    <>
      <DemoNotice />
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
            description="Jobs appear here when they arrive through intake or are created manually."
            action={
              can(user.role, "jobs.create") ? (
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

/* ----------------------------------------------------------------- detail */

const NOTICES: Record<string, { title: string; body: string }> = {
  created: {
    title: "Job created",
    body: "It has not been submitted anywhere. Each assigned portal has a pending task in the automation queue (simulated dry runs in the demo).",
  },
  duplicate: {
    title: "This form was already submitted",
    body: "The job below was created by your earlier submission. No second job was created.",
  },
  updated: { title: "Changes saved", body: "Nothing was re-sent to any portal." },
};

export function DemoJobDetail({ jobId }: { jobId: string }) {
  const { state, user, run } = useDemo();
  const params = useSearchParams();
  const notice = NOTICES[params.get("notice") ?? ""];
  const detail = useMemo(() => jobDetail(state, jobId, can(user.role, "audit_logs.read")), [state, jobId, user.role]);
  const blobKeys = useMemo(
    () => state.attachments.filter((a) => a.job_id === jobId && a.blob_key).map((a) => [a.id, a.blob_key!] as const),
    [state.attachments, jobId],
  );
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const urls: Record<string, string> = {};
      for (const [id, key] of blobKeys) {
        const blob = await getFile(key);
        if (blob) {
          urls[id] = URL.createObjectURL(blob);
          created.push(urls[id]);
        }
      }
      if (!cancelled) setBlobUrls(urls);
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [blobKeys]);

  if (!detail) notFound();
  const job = state.jobs.find((j) => j.id === jobId)!;
  const tasks = state.tasks
    .filter((t) => t.job_id === jobId)
    .sort((a, b) => a.portal_slug.localeCompare(b.portal_slug));
  const archived = Boolean(job.archived_at);
  const canEdit = can(user.role, "jobs.edit") && !archived;
  const canArchive = can(user.role, "jobs.archive");
  const unrouted = job.status === "requires_human_review" && tasks.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/jobs">
          <ArrowLeft /> All jobs
        </Link>
      </Button>
      <DemoNotice />
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
          {canArchive ? (
            <ConfirmAction
              trigger={
                <Button variant="outline" size="sm">
                  {archived ? <ArchiveRestore /> : <Archive />}
                  {archived ? "Restore job" : "Archive job"}
                </Button>
              }
              title={archived ? `Restore ${job.reference}?` : `Archive ${job.reference}?`}
              description={
                archived ? (
                  <p>The job returns to the active Jobs list and dashboard figures.</p>
                ) : (
                  <p>
                    The job is kept in full but hidden from the default list and dashboards. Queued tasks pause while it
                    is archived.
                  </p>
                )
              }
              confirmLabel={archived ? "Restore" : "Archive"}
              onConfirm={() =>
                run(
                  (s, ctx) => setJobArchived(s, ctx, job.id, !archived),
                  archived ? `${job.reference} restored.` : `${job.reference} archived.`,
                ).ok
              }
            />
          ) : null}
        </div>
      </div>

      {notice ? (
        <Alert variant="info">
          <CircleCheck />
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.body}</AlertDescription>
        </Alert>
      ) : null}
      {archived ? (
        <Alert>
          <Archive />
          <AlertTitle>Archived {formatDateTime(job.archived_at)}</AlertTitle>
          <AlertDescription>
            Archived jobs are kept in full but excluded from the default list, dashboards and the queue.
          </AlertDescription>
        </Alert>
      ) : null}
      {job.status === "requires_human_review" ? (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Needs human review</AlertTitle>
          <AlertDescription>
            <p>{job.review_reason ?? "A portal submission needs a person."}</p>
            {unrouted && can(user.role, "jobs.edit") && !archived ? (
              <AssignPortals jobId={job.id} reference={job.reference} />
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <JobInfoCard detail={detail} />
        <div className="flex flex-col gap-4">
          <ContactsCard contacts={detail.contacts} />
          <AttachmentsCard
            attachments={detail.attachments.map((a) => ({ ...a, download_url: blobUrls[a.id] ?? a.download_url }))}
          />
        </div>
      </div>

      <DestinationsCard detail={detail} />

      {tasks.length > 0 ? (
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Submission actions</CardTitle>
            <CardDescription>
              Act on one portal at a time. A portal that already has this job is never submitted to again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-24 font-medium">{portalName(t.portal_slug)}</span>
                    <TaskStatusBadge task={t} />
                    {t.review_note ? (
                      <span className="text-muted-foreground truncate text-xs">{t.review_note}</span>
                    ) : null}
                  </div>
                  <TaskActions task={t} reference={job.reference} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <ExecutionsCard executions={detail.executions} />
      <AuditCard audit={detail.audit} />
    </div>
  );
}

/** Human review for an unrouted job: choose its destination portals. */
export function AssignPortals({ jobId, reference }: { jobId: string; reference: string }) {
  const { state, run } = useDemo();
  const [chosen, setChosen] = useState<string[]>([]);
  return (
    <ConfirmAction
      trigger={
        <Button size="sm" className="mt-2 w-fit">
          <Route aria-hidden /> Assign portals
        </Button>
      }
      title={`Assign destination portals for ${reference}`}
      description={<p>Only the portals you tick receive this job. Each gets its own pending submission task.</p>}
      extra={
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Destination portals</legend>
          {state.portals.map((p) => (
            <label
              key={p.slug}
              className="hover:bg-accent/60 flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                className="accent-primary size-4"
                disabled={!p.is_enabled}
                checked={chosen.includes(p.slug)}
                onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.slug] : c.filter((x) => x !== p.slug)))}
              />
              <span className="flex-1 font-medium">{p.name}</span>
              {!p.is_enabled ? <span className="text-muted-foreground text-xs">Disabled</span> : null}
            </label>
          ))}
        </fieldset>
      }
      note={{ label: "Note (optional)", placeholder: "e.g. Contract confirmed with the client" }}
      confirmLabel="Assign"
      onConfirm={(note) => {
        if (chosen.length === 0) {
          run(() => {
            throw new EngineError("invalid", "Choose at least one portal.");
          });
          return false;
        }
        const ok = run(
          (s, ctx) => assignDestinations(s, ctx, jobId, chosen, note),
          `${reference} assigned to ${chosen.map(portalName).join(", ")}.`,
        ).ok;
        if (ok) setChosen([]);
        return ok;
      }}
    />
  );
}

/* ----------------------------------------------------------- create / edit */

export function DemoCreateJob() {
  const { state, user, runWith } = useDemo();
  const router = useRouter();
  if (!can(user.role, "jobs.create"))
    return <PermissionDenied role={user.role} needed="operator" what="Creating jobs" />;

  async function action(prev: JobFormState, form: FormData): Promise<JobFormState> {
    const attempt = prev.attempt + 1;
    const values = formValues(form);
    const parsed = jobFormSchema.safeParse(formDataToJobInput(form));
    if (!parsed.success)
      return { attempt, values, fieldErrors: toFieldErrors(parsed.error), error: "Check the highlighted fields." };
    const token = String(form.get("submission_token") ?? "");
    if (!token) return { attempt, values, error: "The form expired. Reload the page and try again." };
    const files = await validateAttachmentsInBrowser(form.getAll("attachments"));
    if (!files.ok) return { attempt, values, fieldErrors: { attachments: files.error }, error: files.error };

    const jobId = uuidV4();
    const stored = files.files.map((f) => ({ ...f, key: `${jobId}/${uuidV4().slice(0, 8)}-${f.fileName}` }));
    for (const f of stored) await putFile(f.key, f.blob);
    const { contact, destinations, ...fields } = parsed.data;
    const result = runWith((s, ctx) => {
      const out = createManualJob(s, ctx, {
        job: fields,
        contact,
        destinations,
        attachments: stored.map((f) => ({
          file_name: f.fileName,
          content_type: f.contentType,
          size_bytes: f.sizeBytes,
          blob_key: f.key,
          source_url: null,
          checksum_sha256: f.sha256,
        })),
        submissionToken: token,
        jobId,
      });
      return { state: out.state, value: out.result };
    });
    if (!result.ok) {
      await deleteFiles(stored.map((f) => f.key));
      return { attempt, values, error: result.error };
    }
    if (!result.value.created) {
      await deleteFiles(stored.map((f) => f.key));
      router.push(`/jobs/${result.value.job_id}?notice=duplicate`);
      return { attempt, values };
    }
    router.push(`/jobs/${result.value.job_id}?notice=created`);
    return { attempt, values };
  }

  return (
    <>
      <DemoNotice />
      <JobForm mode="create" action={action} initial={EMPTY_JOB_FORM} portals={formPortals(state)} cancelHref="/jobs" />
    </>
  );
}

export function DemoEditJob({ jobId }: { jobId: string }) {
  const { state, user, runWith } = useDemo();
  const router = useRouter();
  const job = useMemo(() => editableJob(state, jobId), [state, jobId]);
  if (!can(user.role, "jobs.edit")) return <PermissionDenied role={user.role} needed="operator" what="Editing jobs" />;
  if (!job) notFound();

  async function action(prev: JobFormState, form: FormData): Promise<JobFormState> {
    const attempt = prev.attempt + 1;
    const values = formValues(form);
    const parsed = jobFormSchema.safeParse(formDataToJobInput(form));
    if (!parsed.success)
      return { attempt, values, fieldErrors: toFieldErrors(parsed.error), error: "Check the highlighted fields." };
    const files = await validateAttachmentsInBrowser(form.getAll("attachments"));
    if (!files.ok) return { attempt, values, fieldErrors: { attachments: files.error }, error: files.error };
    const stored = files.files.map((f) => ({ ...f, key: `${jobId}/${uuidV4().slice(0, 8)}-${f.fileName}` }));
    for (const f of stored) await putFile(f.key, f.blob);

    const before = new Set(job!.values.destinations);
    const after = new Set<string>(parsed.data.destinations);
    const { contact, destinations: _d, ...fields } = parsed.data;
    void _d;
    const result = runWith((s, ctx) => {
      const out = updateJob(s, ctx, {
        jobId,
        expectedUpdatedAt: String(form.get("expected_updated_at") ?? ""),
        fields,
        contact,
        addDestinations: [...after].filter((x) => !before.has(x)),
        removeDestinations: [...before].filter((x) => !after.has(x)),
        addAttachments: stored.map((f) => ({
          file_name: f.fileName,
          content_type: f.contentType,
          size_bytes: f.sizeBytes,
          blob_key: f.key,
          source_url: null,
          checksum_sha256: f.sha256,
        })),
        removeAttachmentIds: form.getAll("remove_attachment").map(String),
        acknowledgeSubmitted: form.get("acknowledge_submitted") === "on",
      });
      return { state: out.state, value: out.removedBlobKeys };
    });
    if (!result.ok) {
      await deleteFiles(stored.map((f) => f.key));
      return {
        attempt,
        values,
        error: result.error,
        fieldErrors: /Confirm that your edits/.test(result.error) ? { acknowledge_submitted: result.error } : undefined,
      };
    }
    await deleteFiles(result.value);
    router.push(`/jobs/${jobId}?notice=updated`);
    return { attempt, values };
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="w-fit">
          <Link href={`/jobs/${job.id}`}>
            <ArrowLeft /> Back to {job.reference}
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Edit {job.reference}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {job.source_type === "external"
              ? `External job from ${job.source} · ${job.external_job_id}. The source and external ID cannot be changed.`
              : "Manual job"}
          </p>
        </div>
      </div>
      <DemoNotice />
      {job.archived ? (
        <Alert>
          <Archive />
          <AlertTitle>This job is archived</AlertTitle>
          <AlertDescription>Restore it from the job page before editing.</AlertDescription>
        </Alert>
      ) : (
        <JobForm
          key={job.updated_at}
          mode="edit"
          action={action}
          initial={job.values}
          portals={formPortals(state)}
          job={job}
          cancelHref={`/jobs/${job.id}`}
        />
      )}
    </>
  );
}

function formValues(form: FormData) {
  const s = (k: string) => (typeof form.get(k) === "string" ? String(form.get(k)) : "");
  return {
    customer_name: s("customer_name"),
    service_address: s("service_address"),
    category: s("category"),
    priority: (s("priority") || "normal") as JobFormValues["priority"],
    description: s("description"),
    instructions: s("instructions"),
    scheduled_date: s("scheduled_date"),
    scheduled_time: s("scheduled_time"),
    technician: s("technician"),
    contact_name: s("contact_name"),
    contact_email: s("contact_email"),
    contact_phone: s("contact_phone"),
    destinations: form.getAll("destinations").filter((v): v is string => typeof v === "string"),
  };
}
