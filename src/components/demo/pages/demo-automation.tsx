"use client";

import {
  ArrowLeft,
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Inbox,
  Lock,
  MinusCircle,
  RotateCcw,
  Search,
} from "lucide-react";
import Link from "next/link";
import { notFound, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { useDemo } from "@/components/demo/demo-provider";
import { ConfirmAction, DemoNotice, SimulatedBadge, TaskStatusBadge } from "@/components/demo/demo-ui";
import { AssignPortals } from "@/components/demo/pages/demo-jobs";
import { TaskActions } from "@/components/demo/task-actions";
import { WorkerPanel } from "@/components/demo/worker-panel";
import { PriorityBadge } from "@/components/jobs/job-badges";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { buildTaskPayload, retryTask } from "@/lib/demo/engine";
import {
  attentionItems,
  blockedReason,
  executionRows,
  executionSteps,
  portalName,
  queueRows,
  QUEUE_STATUSES,
  taskCounts,
} from "@/lib/demo/selectors";
import type { DemoExecution, DemoState, ExecutionStep } from "@/lib/demo/types";
import { isPortalSlug, PORTALS } from "@/lib/domain/portals";
import { EXECUTION_STATUS_META, TASK_STATUS_META, type TaskStatus } from "@/lib/domain/status";
import { formatDateTime, formatDuration, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE = 50;

function useParamsState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in changes)) next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return { params, set };
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (total === 0) return null;
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground tabular-nums">
        Showing {formatNumber((page - 1) * PAGE + 1)}–{formatNumber(Math.min(page * PAGE, total))} of{" "}
        {formatNumber(total)}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground tabular-nums">
          Page {page} of {pages}
        </span>
        <Button
          variant="outline"
          size="icon"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ queue */

export function DemoQueue() {
  const { state, now } = useDemo();
  const { params, set } = useParamsState();
  const statusParam = params.get("status");
  const status =
    statusParam === "all"
      ? undefined
      : (QUEUE_STATUSES as string[]).includes(statusParam ?? "")
        ? (statusParam as TaskStatus)
        : "active";
  const portalParam = params.get("portal");
  const portal = portalParam && isPortalSlug(portalParam) ? portalParam : undefined;
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const rows = useMemo(() => queueRows(state, { status, portal, q }), [state, status, portal, q]);
  const counts = useMemo(() => taskCounts(state), [state]);
  const active = counts.pending + counts.processing + counts.retry_scheduled;

  return (
    <>
      <DemoNotice />
      <div className="grid gap-4 xl:grid-cols-3">
        <WorkerPanel />
        <PortalLanes state={state} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {[
            { key: "active", label: "Active", n: active },
            ...QUEUE_STATUSES.map((s) => ({
              key: s,
              label: s === "submitted" ? "Completed (dry run / manual)" : TASK_STATUS_META[s].label,
              n: counts[s],
            })),
            { key: "all", label: "All", n: state.tasks.length },
          ].map((c) => {
            const on = (status ?? "all") === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => set({ status: c.key === "active" ? null : c.key })}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
                  on ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent",
                )}
              >
                {c.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    on ? "bg-white/20" : "bg-muted text-muted-foreground",
                  )}
                >
                  {formatNumber(c.n)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-56 flex-1">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <label htmlFor="queue-q" className="sr-only">
              Search tasks
            </label>
            <Input
              id="queue-q"
              type="search"
              placeholder="Job reference, customer or external ID"
              defaultValue={q}
              className="pl-9"
              onKeyDown={(e) => e.key === "Enter" && set({ q: (e.target as HTMLInputElement).value })}
              onBlur={(e) => e.target.value !== q && set({ q: e.target.value })}
            />
          </div>
          <label htmlFor="queue-portal" className="sr-only">
            Portal
          </label>
          <NativeSelect
            id="queue-portal"
            className="w-44"
            value={portal ?? ""}
            onChange={(e) => set({ portal: e.target.value || null })}
          >
            <option value="">All portals</option>
            {PORTALS.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No tasks in this view"
          description={
            status === "active"
              ? "The queue is empty. New jobs with destinations add tasks here."
              : "Try another status or portal."
          }
        />
      ) : (
        <>
          <div className="bg-card overflow-hidden rounded-xl border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Portal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead>Next / worker</TableHead>
                  <TableHead>Last error</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice((page - 1) * PAGE, page * PAGE).map(({ task, job, running }) => {
                  const blocked = blockedReason(state, task, now);
                  return (
                    <TableRow key={task.id}>
                      <TableCell>
                        <Link href={`/jobs/${job.id}`} className="text-primary font-medium hover:underline">
                          {job.reference}
                        </Link>
                        <div className="text-muted-foreground max-w-44 truncate text-xs">{job.customer_name}</div>
                      </TableCell>
                      <TableCell>{portalName(task.portal_slug)}</TableCell>
                      <TableCell>
                        <TaskStatusBadge task={task} />
                      </TableCell>
                      <TableCell>
                        <PriorityBadge priority={job.priority} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {task.attempt_count} / {task.max_attempts}
                      </TableCell>
                      <TableCell className="text-xs">
                        {running ? (
                          <Link href={`/executions/${running.id}`} className="text-primary hover:underline">
                            {running.worker_id} · running
                          </Link>
                        ) : task.status === "retry_scheduled" && task.next_attempt_at ? (
                          <span className="tabular-nums">Retry {formatRelative(task.next_attempt_at, now)}</span>
                        ) : blocked && ["pending", "retry_scheduled"].includes(task.status) ? (
                          <span className="text-muted-foreground">{blocked}</span>
                        ) : task.completed_at ? (
                          <span className="text-muted-foreground">{formatRelative(task.completed_at, now)}</span>
                        ) : (
                          <span className="text-muted-foreground">Queued {formatRelative(task.created_at, now)}</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground max-w-56 truncate text-xs"
                        title={task.last_error ?? ""}
                      >
                        {task.last_error ?? task.review_note ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <TaskActions task={task} reference={job.reference} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pager page={page} total={rows.length} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
    </>
  );
}

function PortalLanes({ state }: { state: DemoState }) {
  return (
    <Card className="gap-3 xl:col-span-2">
      <CardHeader>
        <CardTitle>Per-portal lanes</CardTitle>
        <CardDescription>
          Each portal runs one attempt at a time (per-portal lock), so a slow portal never blocks the others.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {state.portals.map((p) => {
            const running = state.executions.find((e) => e.status === "running" && e.portal_slug === p.slug);
            const queued = state.tasks.filter(
              (t) => t.portal_slug === p.slug && (t.status === "pending" || t.status === "retry_scheduled"),
            ).length;
            return (
              <li key={p.slug} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/queue?portal=${p.slug}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  {running ? (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <Lock className="size-3" aria-hidden /> Locked
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">Free</span>
                  )}
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {queued} queued ·{" "}
                  {!p.is_enabled
                    ? "portal disabled"
                    : !p.automation_enabled
                      ? "automation paused"
                      : running
                        ? `running ${running.worker_id}`
                        : "idle"}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------- executions */

export function DemoExecutions() {
  const { state, now } = useDemo();
  const { params, set } = useParamsState();
  const portalParam = params.get("portal");
  const portal = portalParam && isPortalSlug(portalParam) ? portalParam : undefined;
  const statusParam = params.get("status") as DemoExecution["status"] | null;
  const status = statusParam && statusParam in EXECUTION_STATUS_META ? statusParam : undefined;
  const days = Number.parseInt(params.get("days") ?? "7", 10);
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const dayBucket = Math.floor(now.getTime() / 60_000);
  const rows = useMemo(
    () => executionRows(state, { portal, status, q, days: days > 0 ? days : undefined }, new Date(dayBucket * 60_000)),
    [state, portal, status, q, days, dayBucket],
  );

  return (
    <>
      <DemoNotice />
      <div className="bg-card grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <label htmlFor="ex-q" className="text-muted-foreground mb-1 block text-xs font-medium">
            Search
          </label>
          <Input
            id="ex-q"
            type="search"
            placeholder="Job, customer, error code, worker"
            defaultValue={q}
            onKeyDown={(e) => e.key === "Enter" && set({ q: (e.target as HTMLInputElement).value })}
            onBlur={(e) => e.target.value !== q && set({ q: e.target.value })}
          />
        </div>
        <SelectFilter
          id="ex-portal"
          label="Portal"
          value={portal ?? ""}
          onChange={(v) => set({ portal: v })}
          options={[["", "All portals"], ...PORTALS.map((p) => [p.slug, p.name] as [string, string])]}
        />
        <SelectFilter
          id="ex-status"
          label="Result"
          value={status ?? ""}
          onChange={(v) => set({ status: v })}
          options={[
            ["", "All results"],
            ["running", "Running"],
            ["succeeded", "Succeeded"],
            ["failed", "Failed"],
            ["cancelled", "Cancelled"],
          ]}
        />
        <SelectFilter
          id="ex-days"
          label="Period"
          value={String(days)}
          onChange={(v) => set({ days: v === "7" ? null : v })}
          options={[
            ["1", "Last 24 hours"],
            ["7", "Last 7 days"],
            ["14", "Last 14 days"],
            ["0", "All time"],
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No executions match"
          description="Start the worker on the Automation Queue page, or widen the filters."
        />
      ) : (
        <>
          <div className="bg-card overflow-hidden rounded-xl border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Portal</TableHead>
                  <TableHead className="text-right">Attempt</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice((page - 1) * PAGE, page * PAGE).map(({ execution: e, job }) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs tabular-nums">
                      <Link href={`/executions/${e.id}`} className="text-primary hover:underline">
                        {formatDateTime(e.started_at)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {job ? (
                        <Link href={`/jobs/${job.id}`} className="hover:underline">
                          {job.reference}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{portalName(e.portal_slug)}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.attempt}</TableCell>
                    <TableCell>
                      <span className="text-xs">Dry run</span> <SimulatedBadge />
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={EXECUTION_STATUS_META[e.status].tone}
                        label={EXECUTION_STATUS_META[e.status].label}
                      />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {e.status === "running"
                        ? formatDuration(now.getTime() - new Date(e.started_at).getTime())
                        : formatDuration(e.duration_ms)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{e.worker_id}</TableCell>
                    <TableCell
                      className="text-muted-foreground max-w-48 truncate font-mono text-xs"
                      title={e.error_message ?? ""}
                    >
                      {e.error_code ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={page} total={rows.length} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
    </>
  );
}

function SelectFilter({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string | null) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <label htmlFor={id} className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value || null)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

const STEP_ICON: Record<ExecutionStep["status"], { icon: typeof CircleCheck; className: string; label: string }> = {
  done: { icon: CircleCheck, className: "text-status-good", label: "Done" },
  skipped: { icon: MinusCircle, className: "text-muted-foreground", label: "Skipped" },
  failed: { icon: CircleX, className: "text-status-critical", label: "Failed" },
  pending: { icon: CircleDashed, className: "text-muted-foreground", label: "Not reached" },
};

export function DemoExecutionDetail({ id }: { id: string }) {
  const { state, now } = useDemo();
  const e = state.executions.find((x) => x.id === id);
  if (!e) notFound();
  const job = state.jobs.find((j) => j.id === e.job_id);
  const task = state.tasks.find((t) => t.id === e.task_id);
  const steps = executionSteps(state, e, now);
  const siblings = state.executions.filter((x) => x.task_id === e.task_id).sort((a, b) => a.attempt - b.attempt);

  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/executions">
          <ArrowLeft /> Execution history
        </Link>
      </Button>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-muted-foreground font-mono text-xs">{e.id}</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {portalName(e.portal_slug)} · attempt {e.attempt}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {job ? (
              <Link href={`/jobs/${job.id}`} className="text-primary hover:underline">
                {job.reference} · {job.customer_name}
              </Link>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={EXECUTION_STATUS_META[e.status].tone} label={EXECUTION_STATUS_META[e.status].label} />
          <span className="text-xs">Dry run</span>
          <SimulatedBadge />
        </div>
      </div>
      <DemoNotice>
        <strong>Simulated execution.</strong> No browser was opened and no portal was contacted. The timeline shows the
        steps the Playwright adapter for {portalName(e.portal_slug)} performs; in a dry run the final submit is never
        clicked.
      </DemoNotice>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="gap-3 xl:col-span-2">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            <CardDescription>
              {e.status === "running" ? "In progress" : `Finished ${formatDateTime(e.completed_at)}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="relative flex flex-col gap-4 border-l pl-6">
              {steps.map((s) => {
                const meta = STEP_ICON[s.status];
                const Icon = meta.icon;
                return (
                  <li key={s.key} className="relative">
                    <Icon
                      className={cn("bg-card absolute top-0.5 -left-[33px] size-4.5 rounded-full", meta.className)}
                      aria-hidden
                    />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{s.label}</span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {meta.label}
                        {s.at ? ` · ${new Date(s.at).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC` : ""}
                      </span>
                    </div>
                    {s.detail ? (
                      <p
                        className={cn(
                          "mt-0.5 text-xs",
                          s.status === "failed" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {s.detail}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[7.5rem_1fr] gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Worker</dt>
                <dd>{e.worker_id ?? "—"}</dd>
                <dt className="text-muted-foreground">Started</dt>
                <dd className="tabular-nums">{formatDateTime(e.started_at)}</dd>
                <dt className="text-muted-foreground">Duration</dt>
                <dd className="tabular-nums">
                  {e.status === "running"
                    ? `${formatDuration(now.getTime() - new Date(e.started_at).getTime())} so far`
                    : formatDuration(e.duration_ms)}
                </dd>
                <dt className="text-muted-foreground">Reference</dt>
                <dd>{e.confirmation_reference ?? "None (dry run)"}</dd>
                <dt className="text-muted-foreground">Error</dt>
                <dd className="break-words">{e.error_code ? `${e.error_code}: ${e.error_message}` : "—"}</dd>
                <dt className="text-muted-foreground">Task now</dt>
                <dd>{task ? <TaskStatusBadge task={task} /> : "—"}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card className="gap-3">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Camera className="text-muted-foreground size-4" aria-hidden />
                <CardTitle>Screenshot</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                No screenshot: this attempt was simulated, so no browser page existed to capture. Real Playwright runs
                store one screenshot per attempt.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>All attempts for this submission</CardTitle>
          <CardDescription>
            Idempotency key <code className="font-mono text-xs">{task?.idempotency_key}</code>: every attempt targets
            the same job and portal, so a retry can never create a second submission.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {siblings.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <Link href={`/executions/${x.id}`} className={cn("hover:underline", x.id === e.id && "font-semibold")}>
                  Attempt {x.attempt}
                </Link>
                <StatusBadge
                  tone={EXECUTION_STATUS_META[x.status].tone}
                  label={EXECUTION_STATUS_META[x.status].label}
                />
                <span className="text-muted-foreground text-xs tabular-nums">{formatDateTime(x.started_at)}</span>
                <span className="text-muted-foreground font-mono text-xs">{x.error_code ?? ""}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <TaskPayloadCard execution={e} />
    </div>
  );
}

/** The message a real worker would receive for this attempt (no secrets: credentials stay with the worker). */
function TaskPayloadCard({ execution }: { execution: DemoExecution }) {
  const { state } = useDemo();
  const payload = useMemo(() => buildTaskPayload(state, execution), [state, execution]);
  if (!payload) return null;
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Task payload</CardTitle>
        <CardDescription>
          What JobSync hands to the automation worker for this attempt. Portal credentials are never part of it: the
          worker reads them from its own secret store. Files are passed as references, not contents.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <details>
          <summary className="text-primary cursor-pointer text-sm">Show JSON</summary>
          <pre className="bg-muted/50 mt-2 max-h-96 overflow-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------------------- failed */

const FAILED_TABS = [
  { key: "review", label: "Human review" },
  { key: "failed", label: "Failed" },
  { key: "retrying", label: "Retry scheduled" },
] as const;

export function DemoFailed() {
  const { state, user, now, run } = useDemo();
  const { params, set } = useParamsState();
  const tab = FAILED_TABS.find((t) => t.key === params.get("tab"))?.key ?? "review";
  const items = useMemo(() => attentionItems(state), [state]);
  const counts = {
    review: items.review.length + items.unrouted.length,
    failed: items.failed.length,
    retrying: items.retrying.length,
  };
  const list = tab === "review" ? items.review : tab === "failed" ? items.failed : items.retrying;
  const canAct = can(user.role, "queue.retry");

  return (
    <>
      <DemoNotice />
      <nav aria-label="Failed job views" className="flex flex-wrap gap-2">
        {FAILED_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={t.key === tab}
            onClick={() => set({ tab: t.key === "review" ? null : t.key })}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm",
              t.key === tab ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent",
            )}
          >
            {t.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-xs tabular-nums",
                t.key === tab ? "bg-white/20" : "bg-muted text-muted-foreground",
              )}
            >
              {counts[t.key]}
            </span>
          </button>
        ))}
      </nav>

      {tab === "review" && items.unrouted.length > 0 ? (
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Jobs with no destination</CardTitle>
            <CardDescription>
              No routing rule matched these jobs. Choose their portals, or add a routing rule on Portal Management.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {items.unrouted.map((j) => (
                <li
                  key={j.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <Link href={`/jobs/${j.id}`} className="text-primary font-medium hover:underline">
                      {j.reference}
                    </Link>
                    <span className="text-muted-foreground ml-2 text-sm">
                      {j.customer_name} · {j.category} · {j.service_address}
                    </span>
                  </div>
                  {canAct ? <AssignPortals jobId={j.id} reference={j.reference} /> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>
            {tab === "review"
              ? "Submissions waiting for a person"
              : tab === "failed"
                ? "Failed submissions"
                : "Scheduled retries"}
          </CardTitle>
          <CardDescription>
            {tab === "review"
              ? "CAPTCHA, MFA and portal validation errors are never bypassed. Resolve by retrying, recording a manual submission, or cancelling."
              : tab === "failed"
                ? "These exhausted their retry limit. Retrying grants one more attempt; portals that already have the job are untouched."
                : "Transient failures waiting for their exponential backoff to elapse."}
          </CardDescription>
          {tab === "failed" && canAct && list.length > 0 ? (
            <CardAction>
              <ConfirmAction
                trigger={
                  <Button size="sm">
                    <RotateCcw aria-hidden /> Retry all ({list.length})
                  </Button>
                }
                title={`Retry ${list.length} failed submissions?`}
                description={
                  <p>Each gets one more attempt in the queue. Portals that already have their job are not affected.</p>
                }
                confirmLabel="Retry all"
                onConfirm={() =>
                  run(
                    (s, ctx) => list.reduce((acc, x) => retryTask(acc, ctx, x.task.id), s),
                    `${list.length} submissions queued for another attempt.`,
                  ).ok
                }
              />
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <EmptyState
              icon={CircleCheck}
              title="Nothing here"
              description="No submissions in this state."
              className="py-8"
            />
          ) : (
            <ul className="divide-y">
              {list.slice(0, 200).map(({ task, job }) => (
                <li
                  key={task.id}
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/jobs/${job.id}`} className="text-primary font-medium hover:underline">
                        {job.reference}
                      </Link>
                      <span className="text-sm">→ {portalName(task.portal_slug)}</span>
                      <TaskStatusBadge task={task} />
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {task.attempt_count}/{task.max_attempts} attempts
                        {task.status === "retry_scheduled" && task.next_attempt_at
                          ? ` · retry ${formatRelative(task.next_attempt_at, now)}`
                          : ` · ${formatRelative(task.updated_at, now)}`}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {job.customer_name} · {task.review_note ?? task.last_error ?? "—"}
                    </p>
                  </div>
                  <TaskActions task={task} reference={job.reference} />
                </li>
              ))}
            </ul>
          )}
          {list.length > 200 ? (
            <p className="text-muted-foreground mt-3 text-xs">
              Showing the first 200 of {list.length}. Use the Automation Queue filters for the rest.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
