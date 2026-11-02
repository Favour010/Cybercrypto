import type { Metadata } from "next";

import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Integration Settings" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Integration Settings"
      description="Configure and test external services. Secrets are stored server-side and never displayed after saving."
      phase={6}
      capabilities={[
        "Supabase project URL and real connection test",
        "n8n webhook URL, shared secret and test webhook",
        "External intake endpoint, authentication and documentation",
        "Playwright controller endpoint and worker status test",
        "Truthful test results only",
      ]}
    />
  );
}
