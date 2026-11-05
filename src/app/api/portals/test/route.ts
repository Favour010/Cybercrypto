import { NextResponse } from "next/server";
import { z } from "zod";

import { assertSafeUrl, probe, UnsafeUrlError } from "@/lib/net/safe-fetch";
import { guardTestRoute } from "@/lib/net/test-route-guard";

/**
 * Real connection test for a portal URL. Only hosts in the allow-list can be
 * tested (default: the simulated demo portal host), so this cannot be used to
 * make the server fetch arbitrary addresses.
 */
const ALLOWED_HOSTS = (process.env.JOBSYNC_PORTAL_TEST_HOSTS ?? "jobsync-portal-tracker.lovable.app")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const bodySchema = z.object({ url: z.string().max(2000) });

export async function POST(request: Request) {
  const blocked = await guardTestRoute(request, "portals.manage");
  if (blocked) return blocked;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Send { url }." }, { status: 400 });

  let url: URL;
  try {
    url = await assertSafeUrl(parsed.data.url, ALLOWED_HOSTS);
  } catch (err) {
    // A host that does not resolve is a test result, not a bad request.
    if (err instanceof UnsafeUrlError && err.kind === "unreachable") {
      return NextResponse.json(
        {
          ok: false,
          http_status: null,
          latency_ms: null,
          message: err.message,
          tested_url: parsed.data.url,
          tested_at: new Date().toISOString(),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (err instanceof UnsafeUrlError)
      return NextResponse.json(
        { ok: false, http_status: null, latency_ms: null, message: err.message, tested_url: parsed.data.url },
        { status: 422 },
      );
    throw err;
  }
  const result = await probe(url, { method: "GET", timeoutMs: 10_000 });
  return NextResponse.json(
    { ...result, tested_url: parsed.data.url, tested_at: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
