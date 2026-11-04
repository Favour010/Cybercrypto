/**
 * Public auth configuration. Deliberately free of "server-only" so proxy.ts
 * can use it. It reads only non-secret values: the Supabase URL and anon key
 * are designed to be public; the service-role key is never read here.
 */
export interface AuthConfig {
  url: string;
  anonKey: string;
}

export function getAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

export function missingAuthConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    !env.NEXT_PUBLIC_SUPABASE_URL?.trim() && "NEXT_PUBLIC_SUPABASE_URL",
    !env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter((v): v is string => Boolean(v));
}

/**
 * Local-development escape hatch for working on the UI without a Supabase
 * project. It is honoured ONLY when all of these hold:
 *   - NODE_ENV is "development" (never in `next build` / `next start`),
 *   - JOBSYNC_DEV_AUTH_BYPASS is exactly "true",
 *   - Supabase auth is NOT configured (a real project always requires login).
 */
export function isDevAuthBypassActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "development" && env.JOBSYNC_DEV_AUTH_BYPASS === "true" && getAuthConfig(env) === null;
}
