import "server-only";

import { z } from "zod";

import { DEFAULT_EXECUTION_MODE, EXECUTION_MODES } from "@/lib/domain/status";

/**
 * Server-side environment. Importing this module from a Client Component is a
 * build error (via "server-only"), so secrets can never reach the browser.
 *
 * Every integration is optional at boot: the app runs in a clearly labelled
 * "not configured" state rather than pretending a service is connected.
 */
const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalString.pipe(z.url().optional()),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  JOBSYNC_EXECUTION_MODE: z.enum(EXECUTION_MODES).default(DEFAULT_EXECUTION_MODE),
  /** LIVE mode is refused unless this is exactly "true". */
  JOBSYNC_ALLOW_LIVE_SUBMISSIONS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  JOBSYNC_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Report which variables are invalid, never their values.
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid JobSync server environment: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

export type IntegrationState = { configured: true } | { configured: false; missing: string[] };

/** Whether the server has what it needs to talk to Supabase. */
export function getSupabaseConfigState(): IntegrationState {
  const env = getServerEnv();
  const missing = [
    !env.NEXT_PUBLIC_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
    !env.SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter((v): v is string => Boolean(v));
  return missing.length === 0 ? { configured: true } : { configured: false, missing };
}
