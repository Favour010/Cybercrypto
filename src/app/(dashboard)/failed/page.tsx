import type { Metadata } from "next";

import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Failed Jobs" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Failed Jobs"
      description="Tasks that need operator attention."
      phase={5}
      capabilities={[
        "Failed and human-review tasks with last error",
        "Safe manual retry of a single portal task",
        "Escalation and resolution notes",
        "Cancel tasks that should not be retried",
      ]}
    />
  );
}
