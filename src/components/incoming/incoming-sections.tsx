/**
 * Incoming Jobs sections shared by the Supabase page and the demo data layer.
 * Moved unchanged from app/(dashboard)/incoming/page.tsx.
 */
import { ChevronLeft, ChevronRight, FileCode2, Inbox, ShieldX } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { JobStatusBadge, SourceBadge } from "@/components/jobs/job-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { IncomingData, IntakeEventRow } from "@/lib/data/incoming";
import type { StatusTone } from "@/lib/domain/status";
import { formatDateTime, formatNumber } from "@/lib/format";
import { INCOMING_VIEWS, INCOMING_VIEW_META, type IncomingView } from "@/lib/incoming/views";
import { cn } from "@/lib/utils";

export function IncomingTabs({ data, view }: { data: IncomingData; view: IncomingView }) {
  return (
    <>
      <nav aria-label="Incoming views" className="flex flex-wrap gap-2">
        {INCOMING_VIEWS.map((v) => {
          const active = v === view;
          const count = data.counts[v];
          return (
            <Link
              key={v}
              href={v === "new" ? "/incoming" : `/incoming?view=${v}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent",
              )}
            >
              {INCOMING_VIEW_META[v].label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  active ? "bg-white/20" : "bg-muted text-muted-foreground",
                )}
              >
                {count === null ? "—" : formatNumber(count)}
              </span>
            </Link>
          );
        })}
      </nav>
      <p className="text-muted-foreground -mt-2 text-sm">{INCOMING_VIEW_META[view].description}</p>
    </>
  );
}

export function IncomingList({ data }: { data: IncomingData }) {
  const kind = INCOMING_VIEW_META[data.view].kind;
  if (kind === "events" && !data.eventsVisible) {
    return (
      <EmptyState
        icon={ShieldX}
        title="Integration events are visible to operators and admins"
        description="Your role can see jobs, but not the raw intake requests."
      />
    );
  }
  if (data.total === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={kind === "jobs" ? "No jobs in this view" : "No requests in this view"}
        description={
          data.view === "new"
            ? "Nothing was received in the last 24 hours."
            : data.view === "awaiting_routing"
              ? "Every job has at least one destination portal."
              : "Requests appear here as soon as the intake API receives them."
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-card overflow-hidden rounded-xl border">
        {kind === "jobs" ? <JobsTable data={data} /> : <EventsTable events={data.events} />}
      </div>
      <Pager data={data} />
    </div>
  );
}

function JobsTable({ data }: { data: IncomingData }) {
  return (
    <Table>
      <TableHeader className="bg-muted/50">
        <TableRow>
          <TableHead>Job</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Received</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.jobs.map((j) => (
          <TableRow key={j.id}>
            <TableCell>
              <Link href={`/jobs/${j.id}`} className="text-primary font-medium hover:underline">
                {j.reference}
              </Link>
              <div className="mt-0.5 flex items-center gap-2">
                <SourceBadge sourceType={j.source_type} source={j.source} />
                {j.external_job_id ? (
                  <span className="text-muted-foreground font-mono text-[11px]">{j.external_job_id}</span>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="max-w-56 truncate">{j.customer_name}</TableCell>
            <TableCell className="text-sm">{j.category}</TableCell>
            <TableCell className="text-muted-foreground text-xs tabular-nums">
              {formatDateTime(j.received_at)}
            </TableCell>
            <TableCell>
              <JobStatusBadge status={j.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const EVENT_TONE: Record<IntakeEventRow["status"], { tone: StatusTone; label: string }> = {
  received: { tone: "neutral", label: "Received" },
  accepted: { tone: "good", label: "Accepted" },
  processed: { tone: "good", label: "Processed" },
  duplicate: { tone: "warning", label: "Duplicate" },
  rejected: { tone: "critical", label: "Rejected" },
  failed: { tone: "critical", label: "Import error" },
};

function payloadField(payload: unknown, key: string): string | null {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    return typeof v === "string" ? v : v == null ? null : JSON.stringify(v);
  }
  return null;
}

export function EventsTable({ events }: { events: IntakeEventRow[] }) {
  return (
    <ul className="divide-y">
      {events.map((e) => {
        const t = EVENT_TONE[e.status];
        const external = payloadField(e.payload, "external_job_id");
        const source = payloadField(e.payload, "source");
        const customer = payloadField(e.payload, "customer");
        const pretty = e.payload == null ? null : JSON.stringify(e.payload, null, 2);
        return (
          <li key={e.id}>
            <details className="group">
              <summary className="hover:bg-muted/40 grid cursor-pointer list-none grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[10rem_7rem_1fr_auto] [&::-webkit-details-marker]:hidden">
                <span className="text-muted-foreground text-xs tabular-nums">{formatDateTime(e.created_at)}</span>
                <span className="flex items-center gap-2">
                  <StatusBadge tone={t.tone} label={t.label} />
                  <span className="text-muted-foreground font-mono text-[11px]">{e.http_status ?? ""}</span>
                </span>
                <span className="col-span-2 min-w-0 text-sm sm:col-span-1">
                  {external ? (
                    <span className="font-mono text-xs">
                      {source ? `${source} · ` : ""}
                      {external}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">No external ID</span>
                  )}
                  {customer ? <span className="text-muted-foreground ml-2 truncate text-xs">{customer}</span> : null}
                  {e.error ? <span className="text-destructive block truncate text-xs">{e.error}</span> : null}
                </span>
                <span className="text-right text-xs">
                  {e.job_id && e.job ? (
                    <Link href={`/jobs/${e.job_id}`} className="text-primary font-medium hover:underline">
                      {e.job.reference}
                    </Link>
                  ) : null}
                </span>
              </summary>
              <div className="bg-muted/30 flex flex-col gap-2 px-4 pb-4 text-xs">
                <div className="text-muted-foreground pt-2">
                  Request ID <span className="text-foreground font-mono select-all">{e.request_id ?? "—"}</span>
                </div>
                {e.error ? <p className="text-destructive whitespace-pre-wrap">{e.error}</p> : null}
                {pretty ? (
                  <pre className="bg-card max-h-80 overflow-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed">
                    {pretty.length > 8000 ? `${pretty.slice(0, 8000)}\n…` : pretty}
                  </pre>
                ) : (
                  <p className="text-muted-foreground">No payload stored for this request.</p>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export function Pager({ data }: { data: IncomingData }) {
  if (data.pageCount <= 1) return null;
  const href = (p: number) =>
    `/incoming?${new URLSearchParams({ ...(data.view !== "new" ? { view: data.view } : {}), page: String(p) })}`;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-end gap-2 text-sm">
      <span className="text-muted-foreground tabular-nums">
        Page {data.page} of {data.pageCount}
      </span>
      {data.page > 1 ? (
        <Button asChild variant="outline" size="icon">
          <Link href={href(data.page - 1)} aria-label="Previous page">
            <ChevronLeft />
          </Link>
        </Button>
      ) : null}
      {data.page < data.pageCount ? (
        <Button asChild variant="outline" size="icon">
          <Link href={href(data.page + 1)} aria-label="Next page">
            <ChevronRight />
          </Link>
        </Button>
      ) : null}
    </nav>
  );
}

export function ApiReferenceCard() {
  const example = `curl -X POST "$JOBSYNC_URL/api/v1/jobs/intake" \\
  -H "Authorization: Bearer $JOBSYNC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "external_job_id": "ARO-2026-00125",
    "source": "aroflo",
    "customer": "Example Facilities Ltd",
    "contact": { "name": "John Smith", "email": "john@example.com" },
    "service_address": "Example Service Address",
    "category": "AC Maintenance",
    "priority": "High",
    "description": "Air conditioning unit requires inspection.",
    "scheduled_date": "2026-11-05",
    "scheduled_time": "10:00",
    "destinations": ["northstar", "bluepeak"]
  }'`;
  const codes: [string, string][] = [
    ["201", "Created. Job stored as ready (destinations given) or received (awaiting routing)."],
    ["200", "Duplicate. The same job was already received; nothing changed."],
    ["409", "Same external ID, different content. Not applied."],
    ["422", "Validation failed. See error.issues."],
    ["401 / 403", "Missing, invalid, revoked or out-of-scope key."],
    ["429", "Rate limited. Honour Retry-After."],
  ];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileCode2 className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Intake API</CardTitle>
        </div>
        <CardDescription>
          <code className="font-mono">POST /api/v1/jobs/intake</code>. Full reference: docs/intake-api.md
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <pre className="bg-muted/50 max-w-full overflow-x-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed">
          {example}
        </pre>
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          {codes.map(([c, d]) => (
            <div key={c} className="contents">
              <dt className="font-mono font-medium">{c}</dt>
              <dd className="text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
