import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { JobStatusBadge, PortalChips, PriorityBadge, SourceBadge } from "@/components/jobs/job-badges";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { JobList } from "@/lib/data/jobs";
import { formatDate, formatDateTime, formatNumber, formatTime } from "@/lib/format";
import { jobsHref, type JobSortField, type JobsQuery } from "@/lib/jobs/query";
import { cn } from "@/lib/utils";

function SortHeader({ query, field, label }: { query: JobsQuery; field: JobSortField; label: string }) {
  const active = query.sort === field;
  const nextDir = active && query.dir === "desc" ? "asc" : "desc";
  const Icon = !active ? ArrowUpDown : query.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Link
      href={jobsHref(query, { sort: field, dir: nextDir, page: 1 })}
      className={cn("hover:text-foreground inline-flex items-center gap-1", active && "text-foreground")}
      aria-label={`Sort by ${label}${active ? `, currently ${query.dir === "asc" ? "ascending" : "descending"}` : ""}`}
    >
      {label}
      <Icon className="size-3" aria-hidden />
    </Link>
  );
}

export function JobsTable({ list, query }: { list: JobList; query: JobsQuery }) {
  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>
              <SortHeader query={query} field="reference" label="Job" />
            </TableHead>
            <TableHead>
              <SortHeader query={query} field="customer_name" label="Customer" />
            </TableHead>
            <TableHead>Category</TableHead>
            <TableHead>
              <SortHeader query={query} field="priority" label="Priority" />
            </TableHead>
            <TableHead>Destinations</TableHead>
            <TableHead>
              <SortHeader query={query} field="scheduled_date" label="Scheduled" />
            </TableHead>
            <TableHead>
              <SortHeader query={query} field="received_at" label="Received" />
            </TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.rows.map((job) => (
            <TableRow key={job.id} className={cn(job.archived_at && "opacity-70")}>
              <TableCell>
                <Link href={`/jobs/${job.id}`} className="text-primary font-medium hover:underline">
                  {job.reference}
                </Link>
                <div className="mt-0.5 flex items-center gap-2">
                  <SourceBadge sourceType={job.source_type} source={job.source} />
                  {job.external_job_id ? (
                    <span className="text-muted-foreground font-mono text-[11px]">{job.external_job_id}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="max-w-56 whitespace-normal">
                <div className="truncate font-medium">{job.customer_name}</div>
                <div className="text-muted-foreground truncate text-xs">{job.service_address}</div>
              </TableCell>
              <TableCell className="text-sm">{job.category}</TableCell>
              <TableCell>
                <PriorityBadge priority={job.priority} />
              </TableCell>
              <TableCell className="whitespace-normal">
                <PortalChips
                  slugs={job.assignments
                    .map((a) => a.portal?.slug)
                    .filter((s): s is NonNullable<typeof s> => Boolean(s))}
                />
              </TableCell>
              <TableCell className="text-sm tabular-nums">
                {formatDate(job.scheduled_date)}
                {job.scheduled_time ? (
                  <span className="text-muted-foreground"> {formatTime(job.scheduled_time)}</span>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs tabular-nums">
                {formatDateTime(job.received_at)}
              </TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-1">
                  <JobStatusBadge status={job.status} dryRun={job.dry_run} />
                  {job.archived_at ? <span className="text-muted-foreground text-[11px]">Archived</span> : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function JobsPagination({ list, query }: { list: JobList; query: JobsQuery }) {
  const first = list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1;
  const last = Math.min(list.page * list.pageSize, list.total);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground tabular-nums">
        {list.total === 0
          ? "No jobs"
          : `Showing ${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(list.total)} jobs`}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground tabular-nums">
          Page {list.page} of {list.pageCount}
        </span>
        <PageLink query={query} page={list.page - 1} disabled={list.page <= 1} label="Previous page">
          <ChevronLeft />
        </PageLink>
        <PageLink query={query} page={list.page + 1} disabled={list.page >= list.pageCount} label="Next page">
          <ChevronRight />
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  query,
  page,
  disabled,
  label,
  children,
}: {
  query: JobsQuery;
  page: number;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="icon" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="icon">
      <Link href={jobsHref(query, { page })} aria-label={label}>
        {children}
      </Link>
    </Button>
  );
}
