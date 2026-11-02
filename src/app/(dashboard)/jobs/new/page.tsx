import type { Metadata } from "next";

import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Create Job" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Create Job"
      description="Manual fallback and testing entry point. Uses the same pipeline as external intake."
      phase={3}
      capabilities={[
        "Customer, contact and service address details",
        "Category, priority and scheduling",
        "Technician assignment and instructions",
        "Attachment upload to Supabase Storage with file validation",
        "Select one or more destination portals",
        "Created jobs start as Received, never as Submitted",
      ]}
    />
  );
}
