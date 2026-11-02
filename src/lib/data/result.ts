/**
 * Result envelope for every dashboard read. Pages render each state
 * explicitly, so "no database" can never be confused with "zero jobs".
 */
export type DataResult<T> =
  | { kind: "not_configured"; missing: string[] }
  | { kind: "schema_missing"; detail: string }
  | { kind: "error"; message: string }
  | { kind: "ok"; source: "database" | "sample"; data: T };

/** PostgREST / Postgres codes meaning "the table or function does not exist". */
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205", "PGRST202"]);

export function isMissingRelation(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_RELATION_CODES.has(error.code));
}
