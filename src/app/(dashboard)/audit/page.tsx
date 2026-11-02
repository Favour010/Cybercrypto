import type { Metadata } from "next";

import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Audit Logs" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Audit Logs"
      description="Immutable record of who changed what, and when."
      phase={7}
      capabilities={[
        "User and system actions",
        "Configuration and routing-rule changes",
        "Job edits, overrides and archives",
        "Secrets are never written to logs",
      ]}
    />
  );
}
