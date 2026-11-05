import type { Metadata } from "next";
import { Suspense } from "react";

import { SupabasePending } from "@/components/common/supabase-pending";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoPortalDetail } from "@/components/demo/pages/demo-portals";
import { Skeleton } from "@/components/ui/skeleton";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Portal" };

export default function PortalDetailPage(props: PageProps<"/portals/[slug]">) {
  if (!isDemoMode()) return <SupabasePending module="Portal Management" />;
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <PortalRoute params={props.params} />
    </Suspense>
  );
}

async function PortalRoute({ params }: { params: PageProps<"/portals/[slug]">["params"] }) {
  const { slug } = await params;
  return (
    <DemoReady>
      <DemoPortalDetail slug={slug} />
    </DemoReady>
  );
}
