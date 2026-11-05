import "server-only";

import { NextResponse } from "next/server";

import type { Permission } from "@/lib/auth/permissions";
import { authorize } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/data-mode";
import { MemoryRateLimiter } from "@/lib/intake/memory-rate-limit";

const limiter = new MemoryRateLimiter(10, 60_000);

/**
 * Shared checks for connection-test routes: per-IP rate limit, and in Supabase
 * mode an authorised user. (Demo mode has no server-side identity; the rate
 * limit and the URL guard still apply.)
 */
export async function guardTestRoute(request: Request, permission: Permission): Promise<NextResponse | null> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = limiter.consume(`test:${ip}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, message: "Too many tests. Wait a minute and try again." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }
  if (!isDemoMode()) {
    const auth = await authorize(permission);
    if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  }
  return null;
}
