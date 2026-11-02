import { connection, NextResponse } from "next/server";

import { getServerEnv, getSupabaseConfigState } from "@/lib/env";

/**
 * Liveness + configuration probe. Reports whether integrations are
 * *configured*; it never claims a connection that has not been tested.
 */
export async function GET() {
  await connection();
  const env = getServerEnv();
  const supabase = getSupabaseConfigState();
  return NextResponse.json({
    status: "ok",
    service: "jobsync",
    time: new Date().toISOString(),
    execution_mode: env.JOBSYNC_EXECUTION_MODE,
    live_submissions_allowed: env.JOBSYNC_ALLOW_LIVE_SUBMISSIONS,
    integrations: {
      supabase: supabase.configured ? "configured" : "not_configured",
    },
  });
}
