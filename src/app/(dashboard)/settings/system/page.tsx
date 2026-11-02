import type { Metadata } from "next";

import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "System Configuration" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="System Configuration"
      description="Automation safety and throughput settings."
      phase={5}
      capabilities={[
        "Execution mode (DRY_RUN default, LIVE requires authorisation)",
        "Maximum concurrency",
        "Retry limit and timeout",
        "Queue polling interval",
      ]}
    />
  );
}
