import { ExecutionModeBadge } from "@/components/layout/execution-mode-badge";
import { MobileNav } from "@/components/layout/mobile-nav";
import { getServerEnv } from "@/lib/env";

export function Topbar() {
  const env = getServerEnv();
  return (
    <header className="bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-30 flex h-16 items-center gap-3 border-b px-4 backdrop-blur sm:px-6 lg:px-8">
      <MobileNav />
      <span className="font-semibold tracking-tight lg:hidden">JobSync</span>
      <div className="text-muted-foreground hidden text-sm sm:block">Operations control centre</div>
      <div className="ml-auto flex items-center gap-2">
        <ExecutionModeBadge mode={env.JOBSYNC_EXECUTION_MODE} liveAllowed={env.JOBSYNC_ALLOW_LIVE_SUBMISSIONS} />
      </div>
    </header>
  );
}
