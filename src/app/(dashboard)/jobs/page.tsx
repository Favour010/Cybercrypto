import type { Metadata } from "next";

import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Jobs" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Jobs"
      description="Every work order in JobSync, whatever its source."
      phase={2}
      capabilities={[
        "Search, filter, sort and paginate all jobs",
        "Job detail view with contacts, attachments and destinations",
        "Edit with duplicate-submission protection (submitted portals are locked)",
        "Archive instead of delete",
        "Per-portal submission history",
        "Manual vs External source labelling",
      ]}
    />
  );
}
