/**
 * Contract between JobSync and a browser-automation worker.
 *
 * The simulated in-browser worker uses this contract today; the Playwright
 * worker (not yet built) is meant to implement the same two messages:
 *
 *   JobSync ──AutomationTaskPayload──▶ worker      (one portal, one attempt)
 *   JobSync ◀──AutomationResult─────── worker      (validated before it is applied)
 *
 * The result shape follows the original JobSync specification (section 12).
 */
import { z } from "zod";

import { PORTAL_SLUGS } from "@/lib/domain/portals";

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a UUID.");

/* ------------------------------------------------------------------- task */

export interface AutomationTaskPayload {
  execution_id: string;
  task_id: string;
  /** Same for every attempt of a job+portal: the adapter must use it to avoid a second submission. */
  idempotency_key: string;
  execution_mode: "dry_run" | "live";
  portal: { slug: (typeof PORTAL_SLUGS)[number]; base_url: string; timeout_seconds: number };
  attempt: number;
  job: {
    id: string;
    reference: string;
    external_job_id: string | null;
    source: string;
    customer_name: string;
    service_address: string;
    category: string;
    priority: string;
    description: string;
    instructions: string | null;
    scheduled_date: string | null;
    scheduled_time: string | null;
    technician: string | null;
    contact: { name: string; email: string | null; phone: string | null } | null;
  };
  /** References only: the worker downloads files itself (never through this message). */
  attachments: {
    id: string;
    file_name: string;
    content_type: string;
    size_bytes: number | null;
    location: "browser_storage" | "url" | "supabase_storage";
  }[];
}

/* ----------------------------------------------------------------- result */

export const RESULT_STATUSES = ["dry_run_passed", "submitted", "failed", "needs_review"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

const stepSchema = z.object({
  key: z.string().max(40),
  label: z.string().max(80),
  status: z.enum(["done", "skipped", "failed", "pending"]),
  at: z.string().datetime().nullable(),
  detail: z.string().max(500).optional(),
});

export const automationResultSchema = z
  .object({
    execution_id: id,
    job_id: id,
    portal: z.enum(PORTAL_SLUGS),
    execution_mode: z.enum(["dry_run", "live"]),
    status: z.enum(RESULT_STATUSES),
    attempt: z.number().int().min(1).max(20),
    confirmation_reference: z.string().trim().min(3).max(60).nullable(),
    started_at: z.string().datetime({ offset: true }),
    completed_at: z.string().datetime({ offset: true }),
    screenshot_url: z.string().max(2000).nullable(),
    error: z
      .object({
        code: z.string().regex(/^[A-Z][A-Z0-9_]{2,60}$/, "Error codes are UPPER_SNAKE_CASE."),
        message: z.string().min(1).max(1000),
        retryable: z.boolean(),
      })
      .nullable(),
    steps: z.array(stepSchema).max(30).optional(),
    /** True when no real browser/portal was involved. */
    simulated: z.boolean(),
  })
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (Date.parse(r.completed_at) < Date.parse(r.started_at))
      issue("completed_at", "completed_at is before started_at.");
    if ((r.status === "failed" || r.status === "needs_review") && !r.error)
      issue("error", `A ${r.status} result must include an error.`);
    if ((r.status === "dry_run_passed" || r.status === "submitted") && r.error)
      issue("error", "A successful result must not include an error.");
    if (r.status === "dry_run_passed") {
      if (r.execution_mode !== "dry_run")
        issue("execution_mode", "Only a dry-run execution can report dry_run_passed.");
      if (r.confirmation_reference) issue("confirmation_reference", "A dry run never produces a portal reference.");
    }
    if (r.status === "submitted") {
      if (r.execution_mode !== "live") issue("status", "A dry-run execution can never report a real submission.");
      if (!r.confirmation_reference)
        issue("confirmation_reference", "A real submission must include the portal's confirmation reference.");
      if (r.simulated) issue("simulated", "A simulated run cannot be a real submission.");
    }
  });

export type AutomationResult = z.output<typeof automationResultSchema>;
