import type { Metadata } from "next";
import { Suspense } from "react";

import { SupabasePending } from "@/components/common/supabase-pending";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoExecutionDetail } from "@/components/demo/pages/demo-automation";
import { Skeleton } from "@/components/ui/skeleton";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Execution" };

export default function ExecutionPage(props: PageProps<"/executions/[id]">) {
  if (!isDemoMode()) return <SupabasePending module="Execution History" />;
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <ExecutionRoute params={props.params} />
    </Suspense>
  );
}

async function ExecutionRoute({ params }: { params: PageProps<"/executions/[id]">["params"] }) {
  const { id } = await params;
  return (
    <DemoReady>
      <DemoExecutionDetail id={id} />
    </DemoReady>
  );
}
