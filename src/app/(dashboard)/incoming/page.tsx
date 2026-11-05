import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { revokeApiKeyAction } from "@/app/(dashboard)/incoming/actions";
import { DataStateNotice } from "@/components/common/data-state-notice";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { CreateKeyForm } from "@/components/incoming/create-key-form";
import { ApiReferenceCard, IncomingList, IncomingTabs } from "@/components/incoming/incoming-sections";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { missingAuthConfig } from "@/lib/auth/config";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { getIncoming, listApiKeys, parseIncomingView } from "@/lib/data/incoming";
import { formatDateTime } from "@/lib/format";
import { maskApiKey } from "@/lib/intake/api-keys";
import { DemoReady } from "@/components/demo/demo-provider";
import { DemoIncoming } from "@/components/demo/pages/demo-incoming";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Incoming Jobs" };

export default function IncomingPage(props: PageProps<"/incoming">) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Incoming Jobs"
        description="Work orders arriving from external systems through the intake API, and every accepted, duplicate or rejected request."
      />
      <Suspense fallback={<Skeleton className="h-[560px] rounded-xl" />}>
        {isDemoMode() ? (
          <DemoReady>
            <DemoIncoming />
          </DemoReady>
        ) : (
          <IncomingContent searchParams={props.searchParams} />
        )}
      </Suspense>
    </div>
  );
}

async function IncomingContent({ searchParams }: { searchParams: PageProps<"/incoming">["searchParams"] }) {
  const params = await searchParams;
  const view = parseIncomingView(params.view);
  const page = Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);
  const auth = await requireUser();
  if (!auth.supabase) return <DataStateNotice result={{ kind: "not_configured", missing: missingAuthConfig() }} />;

  const eventsVisible = can(auth.user.role, "integration_events.read");
  const isAdmin = can(auth.user.role, "integrations.manage");
  const [result, keys] = await Promise.all([
    getIncoming(auth.supabase, { view, page, eventsVisible }),
    isAdmin ? listApiKeys(auth.supabase) : Promise.resolve(null),
  ]);
  if (result.kind !== "ok") return <DataStateNotice result={result} />;
  const data = result.data;

  return (
    <>
      <IncomingTabs data={data} view={view} />

      <IncomingList data={data} />

      <div className="grid gap-4 xl:grid-cols-2">
        {isAdmin && keys ? <ApiKeysCard keys={keys} /> : null}
        <ApiReferenceCard />
      </div>
    </>
  );
}

function ApiKeysCard({ keys }: { keys: Awaited<ReturnType<typeof listApiKeys>> }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Intake API keys</CardTitle>
        </div>
        <CardDescription>
          Each key submits jobs into this organisation, only for the source systems listed. Keys are stored as hashes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CreateKeyForm />
        {keys.kind !== "ok" ? (
          <DataStateNotice result={keys} />
        ) : keys.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No keys yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {keys.data.map((k) => {
              const expired = k.expires_at ? new Date(k.expires_at) <= new Date() : false;
              const state = k.revoked_at ? "Revoked" : expired ? "Expired" : "Active";
              return (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{k.name}</div>
                    <div className="text-muted-foreground font-mono text-xs">{maskApiKey(k.key_prefix)}</div>
                    <div className="text-muted-foreground text-xs">
                      Sources: {k.allowed_sources.join(", ")} · Last used{" "}
                      {k.last_used_at ? formatDateTime(k.last_used_at) : "never"}
                      {k.expires_at ? ` · Expires ${formatDateTime(k.expires_at)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={state === "Active" ? "good" : "neutral"} label={state} />
                    {state === "Active" ? (
                      <form action={revokeApiKeyAction}>
                        <input type="hidden" name="id" value={k.id} />
                        <Button type="submit" size="sm" variant="ghost">
                          Revoke
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
