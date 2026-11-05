import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/common/page-header";
import { SupabasePending } from "@/components/common/supabase-pending";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoAudit } from "@/components/demo/pages/demo-admin";
import { Skeleton } from "@/components/ui/skeleton";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Audit Logs" };

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit Logs"
        description="Every change to jobs, routing, portals, settings and submissions: who did what, and when."
      />
      {isDemoMode() ? (
        <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
          <DemoReady>
            <DemoAudit />
          </DemoReady>
        </Suspense>
      ) : (
        <SupabasePending module="Audit Logs" />
      )}
    </div>
  );
}
