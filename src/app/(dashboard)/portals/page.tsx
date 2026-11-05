import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { SupabasePending } from "@/components/common/supabase-pending";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoPortals } from "@/components/demo/pages/demo-portals";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Portal Management" };

export default function PortalsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Portal Management"
        description="The five client portals, their connection and automation status, and the routing rules that decide which portal receives each job."
      />
      {isDemoMode() ? (
        <DemoReady>
          <DemoPortals />
        </DemoReady>
      ) : (
        <SupabasePending module="Portal Management" />
      )}
    </div>
  );
}
