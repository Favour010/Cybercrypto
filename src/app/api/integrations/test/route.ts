import { NextResponse } from "next/server";
import { z } from "zod";

import { assertSafeUrl, probe, UnsafeUrlError } from "@/lib/net/safe-fetch";
import { guardTestRoute } from "@/lib/net/test-route-guard";

/**
 * Real connection test for an integration endpoint (n8n webhook or Playwright
 * controller). Sends a fixed, clearly labelled test payload — never job data.
 */
const bodySchema = z.object({
  kind: z.enum(["webhook", "controller"]),
  url: z.string().max(2000),
});

export async function POST(request: Request) {
  const blocked = await guardTestRoute(request, "integrations.manage");
  if (blocked) return blocked;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Send { kind, url }." }, { status: 400 });

  let url: URL;
  try {
    url = await assertSafeUrl(parsed.data.url);
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
        { ok: false, http_status: null, latency_ms: null, message: err.message },
        { status: 422 },
      );
    throw err;
  }
  const result =
    parsed.data.kind === "webhook"
      ? await probe(url, {
          method: "POST",
          body: JSON.stringify({
            event: "jobsync.connection_test",
            test: true,
            sent_at: new Date().toISOString(),
            note: "Test request from JobSync Integration Settings. Contains no job data.",
          }),
          timeoutMs: 8_000,
        })
      : await probe(url, { method: "GET", timeoutMs: 8_000 });
  return NextResponse.json(
    { ...result, tested_at: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
