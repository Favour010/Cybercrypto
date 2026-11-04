import { Globe, PenLine } from "lucide-react";

import { StatusBadge } from "@/components/common/status-badge";
import { getPortal, isPortalSlug } from "@/lib/domain/portals";
import {
  JOB_PRIORITY_META,
  JOB_STATUS_META,
  type JobPriority,
  type JobSourceType,
  type JobStatus,
} from "@/lib/domain/status";

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const m = JOB_STATUS_META[status];
  return <StatusBadge tone={m.tone} label={m.label} />;
}

export function PriorityBadge({ priority }: { priority: JobPriority }) {
  const m = JOB_PRIORITY_META[priority];
  return <StatusBadge tone={m.tone} label={m.label} />;
}

/** Manual vs External is always labelled, with the source system name. */
export function SourceBadge({ sourceType, source }: { sourceType: JobSourceType; source: string }) {
  const Icon = sourceType === "external" ? Globe : PenLine;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs whitespace-nowrap">
      <Icon className="size-3.5" aria-hidden />
      {sourceType === "external" ? `External · ${source}` : "Manual"}
    </span>
  );
}

export function PortalChips({ slugs }: { slugs: string[] }) {
  if (slugs.length === 0) return <span className="text-muted-foreground text-xs">Not routed</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {slugs.map((slug) => (
        <span
          key={slug}
          className="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 text-[11px] font-medium"
        >
          {isPortalSlug(slug) ? getPortal(slug).name : slug}
        </span>
      ))}
    </div>
  );
}
