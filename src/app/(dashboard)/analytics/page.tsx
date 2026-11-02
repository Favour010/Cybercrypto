import type { Metadata } from "next";

import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Analytics"
      description="Operational reporting from real database records."
      phase={7}
      capabilities={[
        "Jobs received per day",
        "Submissions and success rate per portal",
        "Failure rate and average retries",
        "Average execution time",
        "Human-review volume and daily workload",
        "Queue processing performance",
      ]}
    />
  );
}
