"use client";

import { LoaderCircle, Lock, Paperclip, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { cloneElement, useActionState, useState, useSyncExternalStore } from "react";

import type { JobFormState } from "@/app/(dashboard)/jobs/form-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EditableJob, FormPortal, JobFormValues } from "@/lib/data/job-form";
import { JOB_PRIORITIES, JOB_PRIORITY_META } from "@/lib/domain/status";
import { formatBytes } from "@/lib/format";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "@/lib/jobs/attachments-limits";
import { cn } from "@/lib/utils";

const CATEGORY_SUGGESTIONS = [
  "AC Maintenance",
  "Electrical",
  "Plumbing",
  "Fire Safety",
  "Lift Maintenance",
  "Cleaning",
  "Security Systems",
  "General Repairs",
];

type Action = (state: JobFormState, form: FormData) => Promise<JobFormState>;

interface Props {
  mode: "create" | "edit";
  action: Action;
  initial: JobFormValues;
  portals: FormPortal[];
  job?: EditableJob;
  cancelHref: string;
}

const noopSubscribe = () => () => {};

/** RFC 4122 v4 UUID; falls back to getRandomValues where randomUUID is unavailable. */
function uuidV4(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function JobForm({ mode, action, initial, portals, job, cancelHref }: Props) {
  // One token per form instance: a double-click or retried request creates the
  // job once (enforced by a unique index). It is rendered only after hydration
  // so server renders stay deterministic.
  // Never generated during the server render (that would make it non-deterministic).
  const [token] = useState(() => (typeof window === "undefined" ? "" : uuidV4()));
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const submissionToken = mode === "create" && hydrated ? token : null;
  const [state, formAction, pending] = useActionState(action, { attempt: 0 });
  const v = state.values ?? initial;
  const err = state.fieldErrors ?? {};
  const locked = new Set(job?.lockedDestinations ?? []);
  const disabled = pending || Boolean(job?.processing) || (mode === "create" && !submissionToken);

  return (
    <form key={state.attempt} action={formAction} className="flex flex-col gap-5" noValidate>
      {mode === "create" ? <input type="hidden" name="submission_token" value={submissionToken ?? ""} /> : null}
      {job ? (
        <>
          <input type="hidden" name="job_id" value={job.id} />
          <input type="hidden" name="expected_updated_at" value={job.updated_at} />
        </>
      ) : null}

      {state.error ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{mode === "create" ? "The job was not created" : "Your changes were not saved"}</AlertTitle>
          <AlertDescription>
            <p>{state.error}</p>
            {state.attempt > 0 ? <p>Files must be selected again after an error.</p> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {job?.processing ? (
        <Alert variant="warning">
          <Lock />
          <AlertTitle>Editing is locked</AlertTitle>
          <AlertDescription>
            A portal submission for this job is in progress. Try again when it finishes.
          </AlertDescription>
        </Alert>
      ) : null}

      <fieldset disabled={disabled} className="grid gap-5 xl:grid-cols-3">
        <div className="flex flex-col gap-5 xl:col-span-2">
          <Section title="Customer and site">
            <Grid>
              <Field id="customer_name" label="Customer / company" required error={err.customer_name} wide>
                <Input
                  id="customer_name"
                  name="customer_name"
                  defaultValue={v.customer_name}
                  maxLength={200}
                  required
                />
              </Field>
              <Field id="service_address" label="Service address" required error={err.service_address} wide>
                <Input
                  id="service_address"
                  name="service_address"
                  defaultValue={v.service_address}
                  maxLength={500}
                  required
                />
              </Field>
              <Field id="contact_name" label="Contact person" error={err.contact_name}>
                <Input
                  id="contact_name"
                  name="contact_name"
                  defaultValue={v.contact_name}
                  maxLength={200}
                  autoComplete="off"
                />
              </Field>
              <Field id="contact_email" label="Contact email" error={err.contact_email}>
                <Input
                  id="contact_email"
                  name="contact_email"
                  type="email"
                  defaultValue={v.contact_email}
                  maxLength={254}
                />
              </Field>
              <Field id="contact_phone" label="Contact phone" error={err.contact_phone}>
                <Input
                  id="contact_phone"
                  name="contact_phone"
                  type="tel"
                  defaultValue={v.contact_phone}
                  maxLength={24}
                />
              </Field>
            </Grid>
          </Section>

          <Section title="Work order">
            <datalist id="category-options">
              {CATEGORY_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Grid>
              <Field id="category" label="Job category" required error={err.category}>
                <Input
                  id="category"
                  name="category"
                  list="category-options"
                  defaultValue={v.category}
                  maxLength={100}
                  required
                />
              </Field>
              <Field id="priority" label="Priority" error={err.priority}>
                <NativeSelect id="priority" name="priority" defaultValue={v.priority}>
                  {JOB_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {JOB_PRIORITY_META[p].label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="description" label="Job description" required error={err.description} wide>
                <Textarea
                  id="description"
                  name="description"
                  rows={4}
                  defaultValue={v.description}
                  maxLength={5000}
                  required
                />
              </Field>
              <Field id="instructions" label="Work instructions" error={err.instructions} wide>
                <Textarea
                  id="instructions"
                  name="instructions"
                  rows={3}
                  defaultValue={v.instructions}
                  maxLength={5000}
                />
              </Field>
              <Field id="scheduled_date" label="Scheduled date" error={err.scheduled_date}>
                <Input id="scheduled_date" name="scheduled_date" type="date" defaultValue={v.scheduled_date} />
              </Field>
              <Field id="scheduled_time" label="Scheduled time" error={err.scheduled_time}>
                <Input id="scheduled_time" name="scheduled_time" type="time" defaultValue={v.scheduled_time} />
              </Field>
              <Field id="technician" label="Assigned technician" error={err.technician} wide>
                <Input id="technician" name="technician" defaultValue={v.technician} maxLength={200} />
              </Field>
            </Grid>
          </Section>
        </div>

        <div className="flex flex-col gap-5">
          <Section
            title="Destination portals"
            description="Only the portals you tick receive this job, each as its own submission task. Leave all unticked to route it later."
          >
            <fieldset aria-describedby={err.destinations ? "destinations-error" : undefined}>
              <legend className="sr-only">Destination portals</legend>
              <ul className="flex flex-col gap-2">
                {portals.map((p) => {
                  const isLocked = locked.has(p.slug);
                  const checked = v.destinations.includes(p.slug);
                  return (
                    <li key={p.slug}>
                      <label
                        className={cn(
                          "hover:bg-accent/60 flex items-center gap-3 rounded-md border px-3 py-2 text-sm",
                          (!p.is_enabled || isLocked) && "opacity-80",
                        )}
                      >
                        <input
                          type="checkbox"
                          name="destinations"
                          value={p.slug}
                          defaultChecked={checked || isLocked}
                          disabled={isLocked || (!p.is_enabled && !checked)}
                          className="accent-primary size-4"
                        />
                        <span className="flex-1 font-medium">{p.name}</span>
                        {isLocked ? (
                          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                            <Lock className="size-3" aria-hidden /> Already attempted
                          </span>
                        ) : !p.is_enabled ? (
                          <span className="text-muted-foreground text-xs">Disabled</span>
                        ) : null}
                      </label>
                      {/* Disabled inputs are not submitted: keep locked destinations. */}
                      {isLocked ? <input type="hidden" name="destinations" value={p.slug} /> : null}
                    </li>
                  );
                })}
              </ul>
              {err.destinations ? (
                <p id="destinations-error" className="text-destructive mt-2 text-xs">
                  {err.destinations}
                </p>
              ) : null}
            </fieldset>
          </Section>

          <Section
            title="Attachments"
            description={`Up to ${MAX_ATTACHMENTS} files, ${MAX_ATTACHMENT_BYTES / 1048576} MB each, ${MAX_TOTAL_ATTACHMENT_BYTES / 1048576} MB in total. JPEG, PNG, WebP, HEIC, PDF or plain text. Stored privately.`}
          >
            {job && job.attachments.length > 0 ? (
              <ul className="mb-3 flex flex-col gap-1.5">
                {job.attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Paperclip className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{a.file_name}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">{formatBytes(a.size_bytes)}</span>
                    </span>
                    <label className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
                      <input type="checkbox" name="remove_attachment" value={a.id} className="accent-destructive" />
                      Remove
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            <Input
              id="attachments"
              name="attachments"
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              aria-invalid={err.attachments ? true : undefined}
              aria-describedby={err.attachments ? "attachments-error" : undefined}
              className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs"
            />
            {err.attachments ? (
              <p id="attachments-error" className="text-destructive mt-1.5 text-xs">
                {err.attachments}
              </p>
            ) : null}
          </Section>

          {job && job.submittedCount > 0 ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>
                Already received by {job.submittedCount} portal{job.submittedCount === 1 ? "" : "s"}
              </AlertTitle>
              <AlertDescription>
                <p>Edits are saved in JobSync only. They are not re-sent to portals that already have this job.</p>
                <label className="mt-1 flex items-start gap-2 font-medium">
                  <input type="checkbox" name="acknowledge_submitted" className="accent-primary mt-0.5 size-4" />I
                  understand these edits will not be re-sent
                </label>
                {err.acknowledge_submitted ? (
                  <p className="text-destructive text-xs">{err.acknowledge_submitted}</p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </fieldset>

      <div className="bg-background/90 sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <p className="text-muted-foreground mr-auto text-xs">
          {mode === "create"
            ? "The job is saved as Received or Ready. Nothing is submitted to a portal from this form."
            : "Saving never re-submits to a portal that already has this job."}
        </p>
        <Button asChild variant="ghost">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={disabled}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {pending ? "Saving…" : mode === "create" ? "Create job" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function Field({
  id,
  label,
  required,
  error,
  wide,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  wide?: boolean;
  children: React.ReactElement<{ "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", wide && "sm:col-span-2")}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      {error ? cloneElement(children, { "aria-invalid": true, "aria-describedby": `${id}-error` }) : children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
