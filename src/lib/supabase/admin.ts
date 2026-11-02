import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";

let adminClient: SupabaseClient | undefined;

/**
 * Service-role client for trusted server code only (API routes, server
 * components, the queue). It bypasses Row Level Security, so it must never be
 * imported into client code — "server-only" enforces that at build time.
 *
 * Returns null when Supabase is not configured.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const env = getServerEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  adminClient ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "jobsync" } },
  });
  return adminClient;
}
