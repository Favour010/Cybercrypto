import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  type LucideIcon,
  TriangleAlert,
} from "lucide-react";

import type { StatusTone } from "@/lib/domain/status";
import { cn } from "@/lib/utils";

/**
 * Status is never conveyed by colour alone: every badge carries an icon and a
 * text label (reserved status palette, see globals.css).
 */
const TONE: Record<StatusTone, { icon: LucideIcon; dot: string; className: string }> = {
  neutral: { icon: CircleDashed, dot: "text-status-neutral", className: "bg-muted text-foreground" },
  info: {
    icon: CircleDot,
    dot: "text-status-info",
    className: "bg-blue-50 text-blue-950 dark:bg-blue-500/10 dark:text-blue-100",
  },
  good: {
    icon: CircleCheck,
    dot: "text-status-good",
    className: "bg-green-50 text-green-950 dark:bg-green-500/10 dark:text-green-100",
  },
  warning: {
    icon: TriangleAlert,
    dot: "text-amber-600 dark:text-status-warning",
    className: "bg-amber-50 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100",
  },
  serious: {
    icon: CircleAlert,
    dot: "text-orange-600 dark:text-status-serious",
    className: "bg-orange-50 text-orange-950 dark:bg-orange-500/10 dark:text-orange-100",
  },
  critical: {
    icon: CircleX,
    dot: "text-status-critical",
    className: "bg-red-50 text-red-950 dark:bg-red-500/10 dark:text-red-100",
  },
};

export function StatusBadge({ tone, label, className }: { tone: StatusTone; label: string; className?: string }) {
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        t.className,
        className,
      )}
    >
      <Icon className={cn("size-3.5", t.dot)} aria-hidden />
      {label}
    </span>
  );
}
