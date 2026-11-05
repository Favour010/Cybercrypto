import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/common/page-header";
import { SupabasePending } from "@/components/common/supabase-pending";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoAnalytics } from "@/components/demo/pages/demo-analytics";
import { Skeleton } from "@/components/ui/skeleton";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Operational reporting: intake volume, portal performance, failure reasons, retries, timings and workload."
      />
      {isDemoMode() ? (
        <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
          <DemoReady>
            <DemoAnalytics />
          </DemoReady>
        </Suspense>
      ) : (
        <SupabasePending module="Analytics" />
      )}
    </div>
  );
}
