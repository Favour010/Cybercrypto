/**
 * Validation shared by every way a job enters JobSync: the external intake API
 * and the Create/Edit Job forms. Pure and unit-tested. Values are trimmed and
 * stripped of control characters; nothing is trusted from the caller.
 */
import { z } from "zod";

import { PORTAL_SLUGS, isPortalSlug, type PortalSlug } from "@/lib/domain/portals";
import { JOB_PRIORITIES, type JobPriority } from "@/lib/domain/status";

/* ------------------------------------------------------------ primitives */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Remove control characters; single-line fields also collapse whitespace. */
export function cleanText(value: string, multiline = false): string {
  const stripped = value.replace(CONTROL_CHARS, "").replace(/\r\n?/g, "\n");
  return multiline
    ? stripped
        .split("\n")
        .map((l) => l.trimEnd())
        .join("\n")
        .trim()
    : stripped.replace(/\s+/g, " ").trim();
}

const text = (label: string, max: number, opts: { multiline?: boolean } = {}) =>
  z
    .string({ error: `${label} is required.` })
    .transform((v) => cleanText(v, opts.multiline))
    .pipe(z.string().min(1, `${label} is required.`).max(max, `${label} must be at most ${max} characters.`));

const optionalText = (label: string, max: number, opts: { multiline?: boolean } = {}) =>
  z
    .string()
    .nullish()
    .transform((v) => (v == null ? "" : cleanText(v, opts.multiline)))
    .pipe(z.string().max(max, `${label} must be at most ${max} characters.`))
    .transform((v) => (v === "" ? null : v));

const PRIORITY_ALIASES: Record<string, JobPriority> = {
  low: "low",
  normal: "normal",
  medium: "normal",
  standard: "normal",
  high: "high",
  urgent: "urgent",
  critical: "urgent",
  emergency: "urgent",
};

export const prioritySchema = z
  .string()
  .nullish()
  .transform((v, ctx): JobPriority => {
    if (v == null || v.trim() === "") return "normal";
    const p = PRIORITY_ALIASES[v.trim().toLowerCase()];
    if (!p) {
      ctx.addIssue({ code: "custom", message: `Priority must be one of: ${JOB_PRIORITIES.join(", ")}.` });
      return z.NEVER;
    }
    return p;
  });

/** YYYY-MM-DD that is a real calendar date. */
export const dateSchema = z
  .string()
  .nullish()
  .transform((v, ctx) => {
    const s = (v ?? "").trim();
    if (s === "") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!m || !d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
      ctx.addIssue({ code: "custom", message: "Scheduled date must be a valid date (YYYY-MM-DD)." });
      return z.NEVER;
    }
    if (+m[1] < 2000 || +m[1] > 2100) {
      ctx.addIssue({ code: "custom", message: "Scheduled date is out of range." });
      return z.NEVER;
    }
    return s;
  });

/** HH:MM or HH:MM:SS, 24-hour. Normalised to HH:MM:SS. */
export const timeSchema = z
  .string()
  .nullish()
  .transform((v, ctx) => {
    const s = (v ?? "").trim();
    if (s === "") return null;
    const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(s);
    if (!m) {
      ctx.addIssue({ code: "custom", message: "Scheduled time must be HH:MM (24-hour)." });
      return z.NEVER;
    }
    return `${m[1]}:${m[2]}:${m[3] ?? "00"}`;
  });

const emailSchema = z
  .string()
  .nullish()
  .transform((v) => (v ?? "").trim().toLowerCase())
  .pipe(z.union([z.literal(""), z.email("Contact email must be a valid email address.").max(254)]))
  .transform((v) => (v === "" ? null : v));

const phoneSchema = z
  .string()
  .nullish()
  .transform((v) => cleanText(v ?? ""))
  .pipe(
    z.union([
      z.literal(""),
      z.string().regex(/^\+?[0-9 ()-]{6,24}$/, "Contact phone may contain digits, spaces, + ( ) and - only."),
    ]),
  )
  .transform((v) => (v === "" ? null : v));

/** Explicit destination portals: known slugs only, de-duplicated, never "all". */
export const destinationsSchema = z
  .array(z.unknown())
  .nullish()
  .transform((v, ctx): PortalSlug[] => {
    const out: PortalSlug[] = [];
    for (const raw of v ?? []) {
      const slug = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (!isPortalSlug(slug)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown destination portal "${String(raw)}". Valid portals: ${PORTAL_SLUGS.join(", ")}.`,
        });
        continue;
      }
      if (!out.includes(slug)) out.push(slug);
    }
    return out;
  });

/* ------------------------------------------------------------ job fields */

export const jobFieldsSchema = z.object({
  customer_name: text("Customer", 200),
  service_address: text("Service address", 500),
  category: text("Job category", 100),
  priority: prioritySchema,
  description: text("Job description", 5000, { multiline: true }),
  instructions: optionalText("Work instructions", 5000, { multiline: true }),
  scheduled_date: dateSchema,
  scheduled_time: timeSchema,
  technician: optionalText("Technician", 200),
});
export type JobFields = z.output<typeof jobFieldsSchema>;

export const contactSchema = z
  .object({
    name: optionalText("Contact name", 200),
    email: emailSchema,
    phone: phoneSchema,
  })
  .superRefine((c, ctx) => {
    if (!c.name && (c.email || c.phone)) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "Contact name is required when email or phone is given.",
      });
    }
  })
  .transform((c) => (c.name ? { name: c.name, email: c.email, phone: c.phone } : null));
export type JobContact = NonNullable<z.output<typeof contactSchema>>;

/* ---------------------------------------------------------- intake payload */

export const SOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,40}$/;

const intakeAttachmentSchema = z.object({
  file_name: text("Attachment file name", 255),
  url: z
    .string()
    .trim()
    .url("Attachment url must be a valid URL.")
    .refine((u) => u.startsWith("https://"), "Attachment url must use https.")
    .refine((u) => u.length <= 2000, "Attachment url is too long."),
  content_type: z
    .string()
    .trim()
    .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i, "Attachment content_type must be a MIME type.")
    .optional(),
  size_bytes: z.number().int().min(0).max(26_214_400).optional(),
});

/** Known top-level fields of the intake payload; anything else is reported as ignored. */
export const INTAKE_FIELDS = [
  "external_job_id",
  "source",
  "customer",
  "contact",
  "service_address",
  "category",
  "priority",
  "description",
  "instructions",
  "scheduled_date",
  "scheduled_time",
  "technician",
  "destinations",
  "attachments",
] as const;

export const intakePayloadSchema = z.object({
  external_job_id: text("external_job_id", 120),
  source: z
    .string({ error: "source is required." })
    .trim()
    .toLowerCase()
    .regex(SOURCE_PATTERN, "source must be 2-41 lowercase letters, digits, '-' or '_' (e.g. \"aroflo\")."),
  customer: text("customer", 200),
  contact: z
    .object({}, { error: "contact must be an object." })
    .passthrough()
    .nullish()
    .transform((c) => c ?? {})
    .pipe(contactSchema),
  service_address: text("service_address", 500),
  category: text("category", 100),
  priority: prioritySchema,
  description: text("description", 5000, { multiline: true }),
  instructions: optionalText("instructions", 5000, { multiline: true }),
  scheduled_date: dateSchema,
  scheduled_time: timeSchema,
  technician: optionalText("technician", 200),
  destinations: destinationsSchema,
  attachments: z
    .array(intakeAttachmentSchema)
    .nullish()
    .transform((a) => a ?? [])
    .refine((a) => a.length <= 20, "At most 20 attachments per job."),
});
export type IntakePayload = z.output<typeof intakePayloadSchema>;

export interface ValidationIssue {
  path: string;
  message: string;
}

export function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message }));
}

/** Map a validated intake payload onto the fields ingest_job() expects. */
export function intakeToJobRecord(p: IntakePayload): JobFields & {
  source_type: "external";
  source: string;
  external_job_id: string;
} {
  return {
    source_type: "external",
    source: p.source,
    external_job_id: p.external_job_id,
    customer_name: p.customer,
    service_address: p.service_address,
    category: p.category,
    priority: p.priority,
    description: p.description,
    instructions: p.instructions,
    scheduled_date: p.scheduled_date,
    scheduled_time: p.scheduled_time,
    technician: p.technician,
  };
}

/* ------------------------------------------------------------ form input */

/** Parse the Create/Edit Job form. Field names match the job record. */
export const jobFormSchema = z.object({
  ...jobFieldsSchema.shape,
  contact: contactSchema,
  destinations: destinationsSchema,
});
export type JobFormInput = z.output<typeof jobFormSchema>;

export function formDataToJobInput(form: FormData): unknown {
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  return {
    customer_name: get("customer_name"),
    service_address: get("service_address"),
    category: get("category"),
    priority: get("priority"),
    description: get("description"),
    instructions: get("instructions"),
    scheduled_date: get("scheduled_date"),
    scheduled_time: get("scheduled_time"),
    technician: get("technician"),
    contact: { name: get("contact_name"), email: get("contact_email"), phone: get("contact_phone") },
    destinations: form.getAll("destinations").filter((v): v is string => typeof v === "string"),
  };
}

/** Flatten zod issues to form field names (contact.name → contact_name). */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join("_") || "form";
    out[key] ??= issue.message;
  }
  return out;
}
