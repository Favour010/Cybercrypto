import type { Metadata } from "next";

import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Automation Queue" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Automation Queue"
      description="One independent submission task per job and portal."
      phase={5}
      capabilities={[
        "Pending, Processing, Submitted, Failed, Retry Scheduled, Human Review, Cancelled",
        "Controlled concurrency (default 3 browser workers)",
        "Retry limits with exponential backoff",
        "Per-portal execution locks",
        "Idempotency keys preventing duplicate job/portal submissions",
        "A successful portal is never retried because another portal failed",
      ]}
    />
  );
}
