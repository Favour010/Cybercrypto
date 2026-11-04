"use server";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { authorize } from "@/lib/auth/session";
import type { JobFormValues } from "@/lib/data/job-form";
import {
  ATTACHMENT_BUCKET,
  attachmentPath,
  validateAttachments,
  type ValidatedAttachment,
} from "@/lib/jobs/attachments";
import { jobDbErrorMessage } from "@/lib/jobs/errors";
import { formDataToJobInput, jobFormSchema, toFieldErrors } from "@/lib/jobs/schema";

export interface JobFormState {
  /** Incremented on every failed attempt so the form re-mounts with `values`. */
  attempt: number;
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: JobFormValues;
}

function echoValues(form: FormData): JobFormValues {
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

type Uploaded = { file: ValidatedAttachment; path: string };

/** Upload with the user's session: Storage RLS checks the organisation folder and role. */
async function uploadAll(db: SupabaseClient, org: string, jobId: string, files: ValidatedAttachment[]) {
  const done: Uploaded[] = [];
  for (const file of files) {
    const path = attachmentPath(org, jobId, file.fileName);
    const { error } = await db.storage.from(ATTACHMENT_BUCKET).upload(path, file.bytes, {
      contentType: file.contentType,
      upsert: false,
    });
    if (error) {
      await removeObjects(
        db,
        done.map((d) => d.path),
      );
      console.error("[jobs] attachment upload failed", error.message);
      return { ok: false as const, error: `"${file.fileName}" could not be uploaded. No changes were saved.` };
    }
    done.push({ file, path });
  }
  return { ok: true as const, uploaded: done };
}

async function removeObjects(db: SupabaseClient, paths: string[]) {
  if (paths.length === 0) return;
  const { error } = await db.storage.from(ATTACHMENT_BUCKET).remove(paths);
  if (error) console.error("[jobs] could not remove attachment objects", paths.length, error.message);
}

const attachmentRows = (uploaded: Uploaded[]) =>
  uploaded.map(({ file, path }) => ({
    file_name: file.fileName,
    content_type: file.contentType,
    size_bytes: file.sizeBytes,
    storage_bucket: ATTACHMENT_BUCKET,
    storage_path: path,
    checksum_sha256: file.sha256,
  }));

const uuid = z.uuid();

/* --------------------------------------------------------------- create */

export async function createJobAction(prev: JobFormState, form: FormData): Promise<JobFormState> {
  const attempt = prev.attempt + 1;
  const values = echoValues(form);

  const auth = await authorize("jobs.create");
  if (!auth.ok) return { attempt, values, error: auth.message };

  const parsed = jobFormSchema.safeParse(formDataToJobInput(form));
  if (!parsed.success) {
    return { attempt, values, fieldErrors: toFieldErrors(parsed.error), error: "Check the highlighted fields." };
  }
  const token = uuid.safeParse(form.get("submission_token"));
  if (!token.success) return { attempt, values, error: "The form expired. Reload the page and try again." };

  const files = await validateAttachments(form.getAll("attachments"));
  if (!files.ok) return { attempt, values, fieldErrors: { attachments: files.error }, error: files.error };

  // Everything is validated before any storage or database work.
  const db = auth.auth.supabase;
  if (!db) return { attempt, values, error: "The database is not configured, so the job cannot be saved." };

  const jobId = randomUUID();
  const org = auth.auth.user.organisationId;
  const upload = await uploadAll(db, org, jobId, files.files);
  if (!upload.ok) return { attempt, values, error: upload.error };

  const { contact, destinations, ...fields } = parsed.data;
  const { data, error } = await db.rpc("create_manual_job", {
    p_job: fields,
    p_contact: contact,
    p_destinations: destinations,
    p_attachments: attachmentRows(upload.uploaded),
    p_submission_token: token.data,
    p_job_id: jobId,
  });

  if (error) {
    await removeObjects(
      db,
      upload.uploaded.map((u) => u.path),
    );
    console.error("[jobs] create_manual_job failed", error.code, error.message);
    return { attempt, values, error: jobDbErrorMessage(error.code) };
  }

  const result = data as { created: boolean; job_id: string };
  if (!result.created) {
    // Double-submitted form: the job already exists; discard this attempt's files.
    await removeObjects(
      db,
      upload.uploaded.map((u) => u.path),
    );
    redirect(`/jobs/${result.job_id}?notice=duplicate`);
  }
  redirect(`/jobs/${result.job_id}?notice=created`);
}

/* ----------------------------------------------------------------- edit */

export async function updateJobAction(prev: JobFormState, form: FormData): Promise<JobFormState> {
  const attempt = prev.attempt + 1;
  const values = echoValues(form);

  const auth = await authorize("jobs.edit");
  if (!auth.ok) return { attempt, values, error: auth.message };
  const db = auth.auth.supabase;
  if (!db) return { attempt, values, error: "The database is not configured." };

  const jobId = uuid.safeParse(form.get("job_id"));
  const expected = z.iso.datetime({ offset: true }).safeParse(form.get("expected_updated_at"));
  if (!jobId.success || !expected.success) return { attempt, values, error: "The form is invalid. Reload the page." };

  const parsed = jobFormSchema.safeParse(formDataToJobInput(form));
  if (!parsed.success) {
    return { attempt, values, fieldErrors: toFieldErrors(parsed.error), error: "Check the highlighted fields." };
  }

  // Work out destination changes against what is stored now.
  const current = await db.from("job_portal_assignments").select("portal:portals(slug)").eq("job_id", jobId.data);
  if (current.error) return { attempt, values, error: jobDbErrorMessage(undefined) };
  const before = new Set(
    ((current.data ?? []) as unknown as { portal: { slug: string } | null }[])
      .map((a) => a.portal?.slug)
      .filter(Boolean),
  );
  const after = new Set<string>(parsed.data.destinations);
  const add = [...after].filter((s) => !before.has(s));
  const remove = [...before].filter((s): s is string => Boolean(s) && !after.has(s as string));

  const removeAttachmentIds = form
    .getAll("remove_attachment")
    .map((v) => uuid.safeParse(v))
    .filter((r) => r.success)
    .map((r) => r.data as string);

  const files = await validateAttachments(form.getAll("attachments"));
  if (!files.ok) return { attempt, values, fieldErrors: { attachments: files.error }, error: files.error };
  const upload = await uploadAll(db, auth.auth.user.organisationId, jobId.data, files.files);
  if (!upload.ok) return { attempt, values, error: upload.error };

  const { contact, destinations: _d, ...fields } = parsed.data;
  void _d;
  const { data, error } = await db.rpc("update_job", {
    p_job_id: jobId.data,
    p_expected_updated_at: expected.data,
    p_fields: fields,
    // null contact in the form means "remove the primary contact".
    p_contact: contact ?? { name: "" },
    p_add_destinations: add,
    p_remove_destinations: remove,
    p_add_attachments: attachmentRows(upload.uploaded),
    p_remove_attachment_ids: removeAttachmentIds,
    p_acknowledge_submitted: form.get("acknowledge_submitted") === "on",
  });

  if (error) {
    await removeObjects(
      db,
      upload.uploaded.map((u) => u.path),
    );
    console.error("[jobs] update_job failed", error.code, error.message);
    return {
      attempt,
      values,
      error: jobDbErrorMessage(error.code),
      fieldErrors: error.code === "JSU07" ? { acknowledge_submitted: jobDbErrorMessage("JSU07") } : undefined,
    };
  }

  await removeObjects(db, (data as { removed_storage_paths: string[] }).removed_storage_paths ?? []);
  refresh();
  redirect(`/jobs/${jobId.data}?notice=updated`);
}
