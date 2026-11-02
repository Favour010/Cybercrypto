import type { Metadata } from "next";

import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Execution History" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Execution History"
      description="Every browser automation attempt, step by step."
      phase={7}
      capabilities={[
        "Timeline: received → validated → routed → queued → browser → submitted",
        "Portal, attempt count and status per execution",
        "Error messages and troubleshooting screenshots",
        "Captured portal confirmation references",
        "Dry-run vs live execution clearly distinguished",
      ]}
    />
  );
}
