import { CircleCheck, CircleDashed } from "lucide-react";
import { connection } from "next/server";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthConfig } from "@/lib/auth/config";
import { getSupabaseConfigState } from "@/lib/env";

/**
 * Configuration status only, read at request time. "Configured" means the
 * server has settings for a service, not that it is connected. The dashboard's
 * own query result (shown above the KPIs) is the live database check; real
 * connection tests for other services arrive with Integration Settings (Phase 6).
 */
export async function IntegrationStatusCard() {
  await connection();
  const auth = getAuthConfig() !== null;
  const serviceRole = getSupabaseConfigState().configured;
  const items: { name: string; configured: boolean; note: string }[] = [
    {
      name: "Supabase (signed-in access)",
      configured: auth,
      note: auth ? "URL and anon key present; live status shown above" : "URL or anon key not set",
    },
    {
      name: "Supabase service role",
      configured: serviceRole,
      note: serviceRole ? "Server-only key present (used from Phase 3)" : "Not set; needed for intake and the queue",
    },
    {
      name: "External intake API",
      configured: serviceRole,
      note: serviceRole ? "POST /api/v1/jobs/intake enabled (API keys on Incoming Jobs)" : "Needs the service-role key",
    },
    {
      name: "n8n workflows",
      configured: false,
      note: "Outbound settings available in demo mode; server delivery not built",
    },
    { name: "Playwright controller", configured: false, note: "Real worker not built; demo mode simulates runs" },
  ];

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Integration status</CardTitle>
        <CardDescription>
          Configuration presence only. No service is reported as connected without a test.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((i) => (
            <li key={i.name} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="font-medium">{i.name}</div>
                <div className="text-muted-foreground truncate text-xs">{i.note}</div>
              </div>
              <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-xs">
                {i.configured ? (
                  <CircleCheck className="text-status-good size-3.5" aria-hidden />
                ) : (
                  <CircleDashed className="size-3.5" aria-hidden />
                )}
                {i.configured ? "Configured" : "Not configured"}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
