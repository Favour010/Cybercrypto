import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/common/page-header";
import { SupabasePending } from "@/components/common/supabase-pending";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoFailed } from "@/components/demo/pages/demo-automation";
import { Skeleton } from "@/components/ui/skeleton";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Failed Jobs" };

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Failed Jobs"
        description="Submissions and jobs that need a person: human review, failures that exhausted their retries, and scheduled retries."
      />
      {isDemoMode() ? (
        <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
          <DemoReady>
            <DemoFailed />
          </DemoReady>
        </Suspense>
      ) : (
        <SupabasePending module="Failed Jobs" />
      )}
    </div>
  );
}
