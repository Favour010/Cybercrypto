import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { jobIdSchema } from "@/lib/data/jobs";
import { isMissingRelation, type DataResult } from "@/lib/data/result";
import type { TaskStatus } from "@/lib/domain/status";
import type { EditableJob, FormPortal } from "@/lib/jobs/form-types";

export { EMPTY_JOB_FORM, type EditableJob, type FormPortal, type JobFormValues } from "@/lib/jobs/form-types";

function fail(error: { code?: string; message: string }): DataResult<never> {
  if (isMissingRelation(error)) {
    return { kind: "schema_missing", detail: "The JobSync tables were not found. Apply the SQL migrations." };
  }
  console.error("[job-form] query failed", error.code, error.message);
  return { kind: "error", message: "The form data could not be loaded. Check the server logs." };
}

export async function getFormPortals(db: SupabaseClient): Promise<DataResult<FormPortal[]>> {
  const { data, error } = await db.from("portals").select("slug, name, is_enabled").order("name");
  if (error) return fail(error);
  return { kind: "ok", source: "database", data: (data ?? []) as FormPortal[] };
}

export async function getEditableJob(db: SupabaseClient, id: string): Promise<DataResult<EditableJob | null>> {
  if (!jobIdSchema.safeParse(id).success) return { kind: "ok", source: "database", data: null };
  const [job, contact, tasks, assignments, attachments] = await Promise.all([
    db
      .from("jobs")
      .select(
        "id, reference, source_type, source, external_job_id, archived_at, updated_at, customer_name, service_address, category, priority, description, instructions, scheduled_date, scheduled_time, technician",
      )
      .eq("id", id)
      .maybeSingle(),
    db.from("job_contacts").select("name, email, phone").eq("job_id", id).eq("is_primary", true).maybeSingle(),
    db.from("submission_tasks").select("portal_slug, status, attempt_count").eq("job_id", id),
    db.from("job_portal_assignments").select("portal:portals(slug)").eq("job_id", id),
    db.from("job_attachments").select("id, file_name, size_bytes").eq("job_id", id).order("created_at"),
  ]);
  for (const r of [job, contact, tasks, assignments, attachments]) if (r.error) return fail(r.error);
  if (!job.data) return { kind: "ok", source: "database", data: null };

  const j = job.data;
  const taskRows = (tasks.data ?? []) as { portal_slug: string; status: TaskStatus; attempt_count: number }[];
  const destinations = ((assignments.data ?? []) as unknown as { portal: { slug: string } | null }[])
    .map((a) => a.portal?.slug)
    .filter((s): s is string => Boolean(s));

  return {
    kind: "ok",
    source: "database",
    data: {
      id: j.id,
      reference: j.reference,
      source_type: j.source_type,
      source: j.source,
      external_job_id: j.external_job_id,
      archived: Boolean(j.archived_at),
      updated_at: j.updated_at,
      values: {
        customer_name: j.customer_name,
        service_address: j.service_address,
        category: j.category,
        priority: j.priority,
        description: j.description,
        instructions: j.instructions ?? "",
        scheduled_date: j.scheduled_date ?? "",
        scheduled_time: j.scheduled_time ? String(j.scheduled_time).slice(0, 5) : "",
        technician: j.technician ?? "",
        contact_name: contact.data?.name ?? "",
        contact_email: contact.data?.email ?? "",
        contact_phone: contact.data?.phone ?? "",
        destinations,
      },
      lockedDestinations: taskRows
        .filter((t) => t.status !== "pending" || t.attempt_count > 0)
        .map((t) => t.portal_slug),
      submittedCount: taskRows.filter((t) => t.status === "submitted").length,
      processing: taskRows.some((t) => t.status === "processing"),
      attachments: (attachments.data ?? []) as EditableJob["attachments"],
    },
  };
}
