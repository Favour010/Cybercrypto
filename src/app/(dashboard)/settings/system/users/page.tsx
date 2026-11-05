import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { SupabasePending } from "@/components/common/supabase-pending";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoUsers } from "@/components/demo/pages/demo-users";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Users & Roles" };

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Users & Roles" description="Who can use JobSync and what each role is allowed to do." />
      {isDemoMode() ? (
        <DemoReady>
          <DemoUsers />
        </DemoReady>
      ) : (
        <SupabasePending module="User management" />
      )}
    </div>
  );
}
