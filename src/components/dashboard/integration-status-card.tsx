import { CircleCheck, CircleDashed } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseConfigState } from "@/lib/env";

/**
 * Configuration status only. "Configured" means the server has settings for a
 * service, not that it is connected. Real connection tests arrive with the
 * Integration Settings page (Phase 6).
 */
export function IntegrationStatusCard() {
  const supabase = getSupabaseConfigState();
  const items: { name: string; configured: boolean; note: string }[] = [
    {
      name: "Supabase database",
      configured: supabase.configured,
      note: supabase.configured ? "Credentials present (connection test: Phase 6)" : "Credentials not set",
    },
    { name: "External intake API", configured: false, note: "Endpoint delivered in Phase 3" },
    { name: "n8n workflows", configured: false, note: "Webhooks delivered in Phase 6" },
    { name: "Playwright controller", configured: false, note: "Worker delivered in Phase 5" },
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
