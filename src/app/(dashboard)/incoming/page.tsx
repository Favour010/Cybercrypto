import type { Metadata } from "next";

import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Incoming Jobs" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Incoming Jobs"
      description="Work orders received from external systems before and after validation."
      phase={3}
      capabilities={[
        "Newly received and validated jobs",
        "Duplicate imports detected via source + external job ID",
        "Rejected payloads with validation errors",
        "Jobs awaiting routing",
        "Import error log per integration event",
      ]}
    />
  );
}
