import { NextResponse } from "next/server";

import { handleIntakeRequest } from "@/lib/intake/handler";
import { MemoryRateLimiter } from "@/lib/intake/memory-rate-limit";
import { createSupabaseIntakeDeps } from "@/lib/intake/supabase-deps";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * External job intake. Machine-to-machine: authenticated by API key (see
 * src/lib/intake/handler.ts), not by browser session, so proxy.ts lets it
 * through. Documentation: docs/intake-api.md.
 */

// Per-instance first filter: 60 requests/minute per client IP.
const ipLimiter = new MemoryRateLimiter(60, 60_000);

export async function POST(request: Request) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      {
        status: "error",
        error: {
          code: "not_configured",
          message: "The intake API is not configured on this server (Supabase service role missing).",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return handleIntakeRequest(request, createSupabaseIntakeDeps(admin), { ipLimiter });
}
