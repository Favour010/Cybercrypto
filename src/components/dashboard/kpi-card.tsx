import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  icon: LucideIcon;
  /** Draws attention to tiles that need operator action. Icon + text, never colour alone. */
  emphasis?: "attention" | "critical";
}) {
  return (
    <Card className="gap-0 px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-muted-foreground text-xs font-medium">{label}</div>
        <div
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md",
            emphasis === "critical"
              ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
              : emphasis === "attention"
                ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </div>
      </div>
      <div className="mt-1.5 text-2xl leading-none sm:text-[26px] font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {hint ? <div className="text-muted-foreground mt-2 min-h-4 text-xs leading-snug">{hint}</div> : null}
    </Card>
  );
}
