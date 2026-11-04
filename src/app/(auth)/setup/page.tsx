import { CircleCheck, CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthConfig, missingAuthConfig } from "@/lib/auth/config";

export const metadata: Metadata = { title: "Setup required" };

export default function SetupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Connect JobSync to Supabase</CardTitle>
        <CardDescription>
          Every JobSync page requires a signed-in user, and sign-in needs a Supabase project. Nothing is shown until it
          is configured.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton className="h-40" />}>
          <SetupStatus />
        </Suspense>
      </CardContent>
    </Card>
  );
}

/** Shows variable NAMES only; values are never rendered. */
async function SetupStatus() {
  await connection();
  const missing = new Set(missingAuthConfig());
  const serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const rows = [
    { name: "NEXT_PUBLIC_SUPABASE_URL", ok: !missing.has("NEXT_PUBLIC_SUPABASE_URL"), note: "Project URL" },
    {
      name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ok: !missing.has("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      note: "Public anon key",
    },
    { name: "SUPABASE_SERVICE_ROLE_KEY", ok: serviceRole, note: "Server-only; needed from Phase 3 (intake, queue)" },
  ];
  return (
    <div className="flex flex-col gap-5 text-sm">
      <ul className="divide-y rounded-md border">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <code className="font-mono text-xs break-all">{r.name}</code>
              <div className="text-muted-foreground text-xs">{r.note}</div>
            </div>
            <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-xs">
              {r.ok ? <CircleCheck className="text-status-good size-3.5" /> : <CircleDashed className="size-3.5" />}
              {r.ok ? "Set" : "Missing"}
            </span>
          </li>
        ))}
      </ul>
      <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5">
        <li>
          Create a Supabase project and apply the migrations in{" "}
          <code className="font-mono text-xs">supabase/migrations</code>.
        </li>
        <li>
          Add the variables above to <code className="font-mono text-xs">.env.local</code> (or your host) and restart.
        </li>
        <li>Invite users from the Supabase dashboard and promote the first administrator.</li>
      </ol>
      <p className="text-muted-foreground text-xs">
        Full instructions: <code className="font-mono">docs/database.md</code>.{" "}
        {getAuthConfig() ? "Auth is configured; you can sign in." : null}
      </p>
    </div>
  );
}
