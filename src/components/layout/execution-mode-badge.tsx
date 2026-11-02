import { FlaskConical, Radio } from "lucide-react";

import type { ExecutionMode } from "@/lib/domain/status";
import { cn } from "@/lib/utils";

/** Always-visible reminder of whether automation can perform real submissions. */
export function ExecutionModeBadge({ mode, liveAllowed }: { mode: ExecutionMode; liveAllowed: boolean }) {
  const isLive = mode === "live" && liveAllowed;
  return (
    <span
      title={
        isLive
          ? "LIVE: automation may submit work orders to authorised portals."
          : "DRY RUN: browser steps are rehearsed and the final submit is never clicked."
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        isLive
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
          : "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100",
      )}
    >
      {isLive ? <Radio className="size-3.5" aria-hidden /> : <FlaskConical className="size-3.5" aria-hidden />}
      {isLive ? "Live mode" : "Dry-run mode"}
    </span>
  );
}
