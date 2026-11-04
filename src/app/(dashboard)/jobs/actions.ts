"use server";

import { refresh } from "next/cache";

import { authorize } from "@/lib/auth/session";
import { setJobArchived } from "@/lib/data/jobs";

export interface ArchiveState {
  error?: string;
}

/**
 * Archive or restore a job. Permission is checked here for a clear message and
 * enforced again by Row Level Security in the database. Archiving never
 * deletes data and never creates or repeats portal submissions.
 */
export async function toggleJobArchive(_prev: ArchiveState, formData: FormData): Promise<ArchiveState> {
  const id = String(formData.get("jobId") ?? "");
  const archive = formData.get("intent") === "archive";

  const result = await authorize("jobs.archive");
  if (!result.ok) return { error: result.message };
  if (!result.auth.supabase) return { error: "The database is not configured." };

  const outcome = await setJobArchived(result.auth.supabase, id, archive, result.auth.user.id);
  if (!outcome.ok) return { error: outcome.message };

  refresh();
  return {};
}
