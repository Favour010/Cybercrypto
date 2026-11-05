import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/common/page-header";
import { SupabasePending } from "@/components/common/supabase-pending";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoExecutions } from "@/components/demo/pages/demo-automation";
import { Skeleton } from "@/components/ui/skeleton";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Execution History" };

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Execution History"
        description="Every browser automation attempt, with its step timeline, result, duration and error."
      />
      {isDemoMode() ? (
        <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
          <DemoReady>
            <DemoExecutions />
          </DemoReady>
        </Suspense>
      ) : (
        <SupabasePending module="Execution History" />
      )}
    </div>
  );
}
