import { Search, X } from "lucide-react";
import Form from "next/form";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { PORTALS } from "@/lib/domain/portals";
import { JOB_PRIORITIES, JOB_PRIORITY_META, JOB_STATUSES, JOB_STATUS_META } from "@/lib/domain/status";
import { JOB_PAGE_SIZES, hasActiveFilters, type JobsQuery } from "@/lib/jobs/query";

/** GET form: filters live in the URL, so views are shareable and work without JS. */
export function JobsFilters({ query }: { query: JobsQuery }) {
  return (
    <Form action="/jobs" className="bg-card grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-12">
      <div className="sm:col-span-2 lg:col-span-4">
        <label htmlFor="q" className="text-muted-foreground mb-1 block text-xs font-medium">
          Search
        </label>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder="Reference, external ID, customer, address…"
            className="pl-9"
            maxLength={100}
          />
        </div>
      </div>
      <Filter label="Status" name="status" value={query.status} className="lg:col-span-2">
        <option value="">All statuses</option>
        {JOB_STATUSES.map((s) => (
          <option key={s} value={s}>
            {JOB_STATUS_META[s].label}
          </option>
        ))}
      </Filter>
      <Filter label="Portal" name="portal" value={query.portal} className="lg:col-span-2">
        <option value="">All portals</option>
        {PORTALS.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.name}
          </option>
        ))}
      </Filter>
      <Filter label="Priority" name="priority" value={query.priority} className="lg:col-span-2">
        <option value="">All priorities</option>
        {JOB_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {JOB_PRIORITY_META[p].label}
          </option>
        ))}
      </Filter>
      <Filter label="Source" name="source" value={query.source} className="lg:col-span-2">
        <option value="">All sources</option>
        <option value="external">External</option>
        <option value="manual">Manual</option>
      </Filter>
      <Filter label="Archive" name="archived" value={query.archived} className="lg:col-span-2">
        <option value="active">Active jobs</option>
        <option value="archived">Archived only</option>
        <option value="all">Active and archived</option>
      </Filter>
      <Filter label="Rows per page" name="size" value={String(query.size)} className="lg:col-span-2">
        {JOB_PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n} per page
          </option>
        ))}
      </Filter>
      {/* Keep the current sort when filters change. */}
      <input type="hidden" name="sort" value={query.sort} />
      <input type="hidden" name="dir" value={query.dir} />
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-8 lg:justify-end">
        {hasActiveFilters(query) ? (
          <Button asChild variant="ghost" size="sm">
            <Link href="/jobs">
              <X /> Clear filters
            </Link>
          </Button>
        ) : null}
        <Button type="submit" size="sm">
          Apply
        </Button>
      </div>
    </Form>
  );
}

function Filter({
  label,
  name,
  value,
  className,
  children,
}: {
  label: string;
  name: string;
  value: string | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={`f-${name}`} className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </label>
      <NativeSelect id={`f-${name}`} name={name} defaultValue={value ?? ""}>
        {children}
      </NativeSelect>
    </div>
  );
}
