import "server-only";

import type { ServerInfo } from "@/components/demo/pages/demo-admin";
import { getDataMode } from "@/lib/data-mode";
import { getServerEnv } from "@/lib/env";

/** Configuration facts safe to show in the UI: presence only, never values. */
export function readServerInfo(): ServerInfo {
  const env = getServerEnv();
  return {
    dataMode: getDataMode(),
    supabaseUrlSet: Boolean(env.NEXT_PUBLIC_SUPABASE_URL),
    anonKeySet: Boolean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    serviceRoleSet: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    envExecutionMode: env.JOBSYNC_EXECUTION_MODE,
    liveAllowedByEnv: env.JOBSYNC_ALLOW_LIVE_SUBMISSIONS,
  };
}
