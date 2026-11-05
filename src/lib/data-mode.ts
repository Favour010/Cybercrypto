/**
 * Which data layer the app runs on.
 *
 *   demo      (default) Local demo data layer: realistic seeded data stored in
 *             the visitor's own browser (IndexedDB). No Supabase, no keys, no
 *             external services. Portal runs are simulated and labelled so.
 *   supabase  The Supabase-backed implementation (sign-in, RLS, real database).
 *
 * Set JOBSYNC_DATA_MODE=supabase once the Supabase project is migrated and
 * verified (docs/database.md). Read on the server only.
 */
export type DataMode = "demo" | "supabase";

export function getDataMode(env: NodeJS.ProcessEnv = process.env): DataMode {
  return env.JOBSYNC_DATA_MODE?.trim().toLowerCase() === "supabase" ? "supabase" : "demo";
}

export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return getDataMode(env) === "demo";
}
