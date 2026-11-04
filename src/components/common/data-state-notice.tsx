import { DatabaseZap, FlaskConical, ServerCrash, TableProperties } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { DataResult } from "@/lib/data/result";

/** Truthful banner for every non-production data state. */
export function DataStateNotice({ result }: { result: DataResult<unknown> }) {
  switch (result.kind) {
    case "not_configured":
      return (
        <Alert variant="warning">
          <DatabaseZap />
          <AlertTitle>Database not connected</AlertTitle>
          <AlertDescription>
            <p>
              Supabase credentials are not configured, so no data can be shown. Missing:{" "}
              {result.missing.map((m, i) => (
                <span key={m}>
                  {i > 0 ? ", " : ""}
                  <code className="font-mono text-xs">{m}</code>
                </span>
              ))}
              . See <code className="font-mono text-xs">.env.example</code> and the README setup guide.
            </p>
            <p>
              To preview the dashboard layout,{" "}
              <Link href="/?preview=sample" className="font-medium underline underline-offset-2">
                open the sample-data preview
              </Link>
              . It is clearly labelled and never written to a database.
            </p>
          </AlertDescription>
        </Alert>
      );
    case "schema_missing":
      return (
        <Alert variant="warning">
          <TableProperties />
          <AlertTitle>Database connected, schema not applied</AlertTitle>
          <AlertDescription>{result.detail}</AlertDescription>
        </Alert>
      );
    case "error":
      return (
        <Alert variant="destructive">
          <ServerCrash />
          <AlertTitle>Could not load data</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      );
    case "ok":
      if (result.source !== "sample") return null;
      return (
        <Alert variant="info">
          <FlaskConical />
          <AlertTitle>Sample data preview: not production statistics</AlertTitle>
          <AlertDescription>
            <p>
              These figures are generated in memory from a fixed seed to demonstrate the dashboard. Nothing here comes
              from or is written to the database.{" "}
              <Link href="/" className="font-medium underline underline-offset-2">
                Return to live data
              </Link>
              .
            </p>
          </AlertDescription>
        </Alert>
      );
  }
}
