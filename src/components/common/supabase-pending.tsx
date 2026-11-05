import { DatabaseZap } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Shown only when JOBSYNC_DATA_MODE=supabase for modules whose server-side
 * (Supabase) implementation has not been built yet. Honest by design: the
 * module is fully functional on the demo data layer.
 */
export function SupabasePending({ module }: { module: string }) {
  return (
    <Alert variant="warning">
      <DatabaseZap />
      <AlertTitle>{module} is not connected to Supabase yet</AlertTitle>
      <AlertDescription>
        <p>
          This module is fully implemented on the demo data layer. Its Supabase backend (queries, server actions and any
          worker integration) has not been built, so nothing is shown in Supabase mode rather than unverified data.
        </p>
        <p>
          To use it now, run with <code className="font-mono text-xs">JOBSYNC_DATA_MODE=demo</code> (the default).
        </p>
      </AlertDescription>
    </Alert>
  );
}
