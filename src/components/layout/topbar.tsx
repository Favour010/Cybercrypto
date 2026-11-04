import { connection } from "next/server";
import { Suspense } from "react";

import { ExecutionModeBadge } from "@/components/layout/execution-mode-badge";
import { MobileNav } from "@/components/layout/mobile-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthState } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";

export function Topbar() {
  return (
    <header className="bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-30 flex h-16 items-center gap-3 border-b px-4 backdrop-blur sm:px-6 lg:px-8">
      <MobileNav />
      <span className="font-semibold tracking-tight lg:hidden">JobSync</span>
      <div className="text-muted-foreground hidden text-sm sm:block lg:block">Operations control centre</div>
      <div className="ml-auto flex items-center gap-2">
        <Suspense fallback={<Skeleton className="h-7 w-44 rounded-full" />}>
          <RuntimeStatus />
        </Suspense>
      </div>
    </header>
  );
}

/**
 * Read at request time (connection()), never baked in at build time: the
 * badge always reflects the server's current execution-mode configuration.
 */
async function RuntimeStatus() {
  await connection();
  const env = getServerEnv();
  const auth = await getAuthState();
  return (
    <>
      <ExecutionModeBadge mode={env.JOBSYNC_EXECUTION_MODE} liveAllowed={env.JOBSYNC_ALLOW_LIVE_SUBMISSIONS} />
      {auth.kind === "authenticated" || auth.kind === "dev_bypass" ? (
        <UserMenu
          name={auth.user.fullName ?? auth.user.email}
          email={auth.user.email}
          role={auth.user.role}
          organisation={auth.user.organisationName}
          devBypass={auth.kind === "dev_bypass"}
        />
      ) : null}
    </>
  );
}
