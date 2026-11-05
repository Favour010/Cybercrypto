/**
 * Job detail sections shared by the Supabase page and the demo data layer page.
 * Moved unchanged from app/(dashboard)/jobs/[id]/page.tsx.
 */
import { FileText, History, Paperclip, Route, ShieldCheck, UserRound } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { JobDetail } from "@/lib/data/jobs";
import { getPortal, isPortalSlug } from "@/lib/domain/portals";
import { EXECUTION_MODE_META, EXECUTION_STATUS_META, TASK_STATUS_META } from "@/lib/domain/status";
import { formatBytes, formatDate, formatDateTime, formatDuration, formatTime } from "@/lib/format";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

export function JobInfoCard({ detail: { job } }: { detail: JobDetail }) {
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Work order</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label="Service address">{job.service_address}</Field>
          <Field label="Category">{job.category}</Field>
          <Field label="Scheduled">
            {formatDate(job.scheduled_date)} {formatTime(job.scheduled_time)}
          </Field>
          <Field label="Assigned technician">{job.technician ?? "—"}</Field>
          <Field label="External job ID">
            {job.external_job_id ? <span className="font-mono text-xs">{job.external_job_id}</span> : "—"}
          </Field>
          <Field label="Source system">{job.source}</Field>
          <Field label="Received">{formatDateTime(job.received_at)}</Field>
          <Field label="Last updated">{formatDateTime(job.updated_at)}</Field>
        </dl>
        <div>
          <div className="text-muted-foreground text-xs">Description</div>
          <p className="mt-1 text-sm whitespace-pre-line">{job.description}</p>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Work instructions</div>
          <p className="mt-1 text-sm whitespace-pre-line">{job.instructions || "—"}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function ContactsCard({ contacts }: { contacts: JobDetail["contacts"] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <UserRound className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Contacts</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {contacts.length === 0 ? (
          <p className="text-muted-foreground text-sm">No contact recorded.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {contacts.map((c) => (
              <li key={c.id} className="text-sm">
                <div className="font-medium">
                  {c.name}
                  {c.is_primary ? (
                    <span className="text-muted-foreground ml-2 text-xs font-normal">Primary</span>
                  ) : null}
                </div>
                {c.email ? <div className="text-muted-foreground break-all select-all">{c.email}</div> : null}
                {c.phone ? <div className="text-muted-foreground select-all">{c.phone}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function AttachmentsCard({ attachments }: { attachments: JobDetail["attachments"] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Paperclip className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Attachments</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {attachments.length === 0 ? (
          <p className="text-muted-foreground text-sm">No attachments.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                {a.download_url ? (
                  <a
                    href={a.download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary truncate hover:underline"
                  >
                    {a.file_name}
                  </a>
                ) : (
                  <span className="truncate">{a.file_name}</span>
                )}
                <span className="text-muted-foreground shrink-0 text-xs">{formatBytes(a.size_bytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export const ASSIGNMENT_SOURCE_LABEL = {
  explicit: "From source data",
  routing_rule: "Routing rule",
  manual_override: "Manual override",
} as const;

export function portalName(slug: string | undefined | null) {
  if (!slug) return "Unknown portal";
  return isPortalSlug(slug) ? getPortal(slug).name : slug;
}

export function DestinationsCard({ detail }: { detail: JobDetail }) {
  const tasksByPortal = new Map(detail.tasks.map((t) => [t.portal_slug as string, t]));
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Route className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Destinations and submissions</CardTitle>
        </div>
        <CardDescription>
          One independent submission task per assigned portal. Dry-run results are rehearsals, not portal submissions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {detail.assignments.length === 0 ? (
          <EmptyState
            icon={Route}
            title="No destinations assigned"
            description="Routing assigns portals from source data or configured rules (Phase 4). Jobs are never sent to every portal by default."
            className="py-8"
          />
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Portal</TableHead>
                  <TableHead>Routing decision</TableHead>
                  <TableHead>Task status</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead>Confirmation</TableHead>
                  <TableHead>Last error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.assignments.map((a) => {
                  const task = a.portal ? tasksByPortal.get(a.portal.slug) : undefined;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.portal?.name ?? "Unknown portal"}</TableCell>
                      <TableCell className="max-w-72 whitespace-normal">
                        <div className="text-xs font-medium">
                          {ASSIGNMENT_SOURCE_LABEL[a.source]}
                          {a.routing_rule ? ` · ${a.routing_rule.name}` : ""}
                        </div>
                        <div className="text-muted-foreground text-xs">{a.reason}</div>
                      </TableCell>
                      <TableCell>
                        {task ? (
                          <StatusBadge
                            tone={TASK_STATUS_META[task.status].tone}
                            label={
                              task.status === "submitted" && task.execution_mode === "dry_run"
                                ? "Dry run passed"
                                : TASK_STATUS_META[task.status].label
                            }
                          />
                        ) : (
                          <span className="text-muted-foreground text-xs">Not queued</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {task ? EXECUTION_MODE_META[task.execution_mode].label : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {task ? `${task.attempt_count} / ${task.max_attempts}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{task?.confirmation_reference ?? "—"}</TableCell>
                      <TableCell
                        className="text-muted-foreground max-w-64 truncate text-xs"
                        title={task?.last_error ?? ""}
                      >
                        {task?.last_error ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ExecutionsCard({ executions }: { executions: JobDetail["executions"] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <History className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Execution history</CardTitle>
        </div>
        <CardDescription>Each browser automation attempt, newest first (latest 50).</CardDescription>
      </CardHeader>
      <CardContent>
        {executions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No browser executions yet.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Portal</TableHead>
                  <TableHead className="text-right">Attempt</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Reference / error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs tabular-nums">{formatDateTime(e.started_at)}</TableCell>
                    <TableCell className="text-sm">{portalName(e.portal_slug)}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.attempt}</TableCell>
                    <TableCell className="text-xs">{EXECUTION_MODE_META[e.mode].label}</TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={EXECUTION_STATUS_META[e.status].tone}
                        label={EXECUTION_STATUS_META[e.status].label}
                      />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatDuration(e.duration_ms)}</TableCell>
                    <TableCell className="max-w-72 truncate text-xs" title={e.error_message ?? ""}>
                      {e.confirmation_reference ? (
                        <span className="font-mono">{e.confirmation_reference}</span>
                      ) : (
                        <span className="text-muted-foreground">{e.error_message ?? "—"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AuditCard({ audit }: { audit: JobDetail["audit"] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Audit trail</CardTitle>
        </div>
        <CardDescription>Recorded by the database for every change to this job.</CardDescription>
      </CardHeader>
      <CardContent>
        {audit === null ? (
          <p className="text-muted-foreground text-sm">The audit trail is visible to administrators only.</p>
        ) : audit.length === 0 ? (
          <p className="text-muted-foreground text-sm">No audit entries.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="text-muted-foreground text-xs tabular-nums">{formatDateTime(a.created_at)}</span>
                <span className="font-medium">{a.action.replace(/^jobs\./, "Job ")}</span>
                <span className="text-muted-foreground text-xs">
                  {a.actor_type === "user" ? `by user ${a.actor_id?.slice(0, 8)}…` : `by ${a.actor_type}`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading job">
      <Skeleton className="h-24 rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-72 rounded-xl xl:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
