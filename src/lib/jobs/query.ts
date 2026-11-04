/**
 * Parsing and normalisation of the Jobs list URL (search, filters, sort,
 * pagination). Pure and unit-tested: everything reaching the database is
 * validated against allow-lists here first.
 */
import { z } from "zod";

import { PORTAL_SLUGS } from "@/lib/domain/portals";
import { JOB_PRIORITIES, JOB_SOURCE_TYPES, JOB_STATUSES } from "@/lib/domain/status";

export const JOB_SORT_FIELDS = ["received_at", "scheduled_date", "customer_name", "reference", "priority"] as const;
export type JobSortField = (typeof JOB_SORT_FIELDS)[number];

export const JOB_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** Unknown or malformed values fall back to defaults instead of erroring. */
function oneOf<T extends readonly string[]>(values: T) {
  return z
    .string()
    .optional()
    .transform((v) => (v && (values as readonly string[]).includes(v) ? (v as T[number]) : undefined));
}

const schema = z.object({
  q: z
    .string()
    .optional()
    .transform((v) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, 100)),
  status: oneOf(JOB_STATUSES),
  source: oneOf(JOB_SOURCE_TYPES),
  priority: oneOf(JOB_PRIORITIES),
  portal: oneOf(PORTAL_SLUGS),
  archived: z
    .string()
    .optional()
    .transform((v) => (v === "archived" || v === "all" ? v : "active")),
  sort: oneOf(JOB_SORT_FIELDS).transform((v) => v ?? "received_at"),
  dir: z
    .string()
    .optional()
    .transform((v) => (v === "asc" ? "asc" : "desc")),
  page: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number.parseInt(v ?? "", 10);
      return Number.isFinite(n) && n >= 1 && n <= 100_000 ? n : 1;
    }),
  size: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number.parseInt(v ?? "", 10);
      return (JOB_PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
    }),
});

export type JobsQuery = z.output<typeof schema>;

type RawParams = Record<string, string | string[] | undefined>;

export function parseJobsQuery(params: RawParams): JobsQuery {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(params)) flat[k] = Array.isArray(v) ? v[0] : v;
  return schema.parse(flat);
}

/**
 * Escape LIKE wildcards so user input is matched literally. The value is sent
 * as a bound parameter by PostgREST; this only neutralises % _ and \.
 */
export function toLikePattern(term: string): string {
  return `%${term.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Build a Jobs URL from a query, omitting defaults so links stay short. */
export function jobsHref(query: JobsQuery, overrides: Partial<JobsQuery> = {}): string {
  const q = { ...query, ...overrides };
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.status) p.set("status", q.status);
  if (q.source) p.set("source", q.source);
  if (q.priority) p.set("priority", q.priority);
  if (q.portal) p.set("portal", q.portal);
  if (q.archived !== "active") p.set("archived", q.archived);
  if (q.sort !== "received_at") p.set("sort", q.sort);
  if (q.dir !== "desc") p.set("dir", q.dir);
  if (q.size !== DEFAULT_PAGE_SIZE) p.set("size", String(q.size));
  if (q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `/jobs?${s}` : "/jobs";
}

export function hasActiveFilters(q: JobsQuery): boolean {
  return Boolean(q.q || q.status || q.source || q.priority || q.portal || q.archived !== "active");
}
