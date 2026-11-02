import type { Metadata } from "next";

import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Portal Management" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Portal Management"
      description="The five simulated client portals and their automation health."
      phase={4}
      capabilities={[
        "Northstar, BluePeak, Greenfield, Apex and MetroCare pages",
        "Portal URL and configuration controls",
        "Connection status from real recorded tests only",
        "Submission counts, success rate and recent failures",
        "Routing rules: customer, location, category, priority",
        "Manual destination override and human-review fallback",
      ]}
    />
  );
}
