import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/common/page-header";
import { SupabasePending } from "@/components/common/supabase-pending";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoIntegrations } from "@/components/demo/pages/demo-admin";
import { Skeleton } from "@/components/ui/skeleton";
import { isDemoMode } from "@/lib/data-mode";
import { readServerInfo } from "@/lib/server-info";

export const metadata: Metadata = { title: "Integration Settings" };

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integration Settings"
        description="Data source, external job intake, n8n webhooks and the Playwright controller. Tests make real requests and show truthful results."
      />
      {isDemoMode() ? (
        <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
          <WithServerInfo />
        </Suspense>
      ) : (
        <SupabasePending module="Integration Settings" />
      )}
    </div>
  );
}

/** Server facts are read at request time; only booleans reach the browser. */
async function WithServerInfo() {
  await connection();
  return (
    <DemoReady>
      <DemoIntegrations server={readServerInfo()} />
    </DemoReady>
  );
}
