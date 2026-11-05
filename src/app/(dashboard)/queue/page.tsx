import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/common/page-header";
import { SupabasePending } from "@/components/common/supabase-pending";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoQueue } from "@/components/demo/pages/demo-automation";
import { Skeleton } from "@/components/ui/skeleton";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Automation Queue" };

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Automation Queue"
        description="One independent submission task per job and portal. Controlled concurrency, per-portal locks, retries with exponential backoff and human review."
      />
      {isDemoMode() ? (
        <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
          <DemoReady>
            <DemoQueue />
          </DemoReady>
        </Suspense>
      ) : (
        <SupabasePending module="Automation Queue" />
      )}
    </div>
  );
}
