"use client";

import {
  ChevronRight,
  Database,
  Download,
  FileCode2,
  FlaskConical,
  LoaderCircle,
  Plug,
  RotateCcw,
  Save,
  Search,
  Server,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { PermissionDenied } from "@/components/common/permission-denied";
import { StatusBadge } from "@/components/common/status-badge";
import { useDemo } from "@/components/demo/demo-provider";
import { ConfirmAction, DemoNotice, SimulatedBadge } from "@/components/demo/demo-ui";
import { downloadCsv } from "@/components/demo/pages/demo-analytics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { can } from "@/lib/auth/permissions";
import { updateIntegrations, updateSettings } from "@/lib/demo/engine";
import { auditRows } from "@/lib/demo/selectors";
import type { ConnectionTestResult, SystemSettings } from "@/lib/demo/types";
import { formatDateTime, formatNumber } from "@/lib/format";

export interface ServerInfo {
  dataMode: "demo" | "supabase";
  supabaseUrlSet: boolean;
  anonKeySet: boolean;
  serviceRoleSet: boolean;
  envExecutionMode: string;
  liveAllowedByEnv: boolean;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Present({ ok, yes = "Set", no = "Not set" }: { ok: boolean; yes?: string; no?: string }) {
  return <StatusBadge tone={ok ? "good" : "neutral"} label={ok ? yes : no} />;
}

function TestResult({ result }: { result: ConnectionTestResult | null }) {
  if (!result) return <span className="text-muted-foreground">Never tested</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusBadge tone={result.ok ? "good" : "critical"} label={result.ok ? "Passed" : "Failed"} />
      <span className="text-muted-foreground text-xs">
        {result.message} · {formatDateTime(result.at)}
      </span>
    </span>
  );
}

async function runRemoteTest(kind: "webhook" | "controller", url: string): Promise<ConnectionTestResult> {
  try {
    const res = await fetch("/api/integrations/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, url }),
    });
    const body = await res.json();
    return {
      ok: Boolean(body.ok),
      at: new Date().toISOString(),
      http_status: body.http_status ?? null,
      latency_ms: body.latency_ms ?? null,
      message: String(body.message ?? `HTTP ${res.status}`),
    };
  } catch {
    return {
      ok: false,
      at: new Date().toISOString(),
      http_status: null,
      latency_ms: null,
      message: "The test could not run (network error).",
    };
  }
}

/* ------------------------------------------------------- integrations */

const N8N_EVENTS = [
  { key: "task.dry_run_passed", label: "Portal dry run passed" },
  { key: "task.failed", label: "Portal submission failed" },
  { key: "task.needs_review", label: "Submission needs human review" },
] as const;

export function DemoIntegrations({ server }: { server: ServerInfo }) {
  const { state, user, run, notify } = useDemo();
  const isAdmin = can(user.role, "integrations.manage");
  const n8n = state.integrations.n8n;
  const [webhook, setWebhook] = useState(n8n.webhook_url);
  const [events, setEvents] = useState<string[]>(n8n.events);
  const [enabled, setEnabled] = useState(n8n.outbound_enabled);
  const [secret, setSecret] = useState("");
  const [controller, setController] = useState(state.integrations.playwright.controller_url);
  const [testing, setTesting] = useState<"webhook" | "controller" | null>(null);
  const outbound = state.events
    .filter((e) => e.integration === "n8n")
    .slice(-8)
    .reverse();
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  function validUrl(u: string) {
    if (!u) return true;
    try {
      return new URL(u).protocol === "https:";
    } catch {
      return false;
    }
  }

  function saveN8n() {
    if (!validUrl(webhook)) return notify("The webhook URL must be a valid https URL.", "error");
    if (enabled && !webhook) return notify("Add a webhook URL before enabling outbound events.", "error");
    run(
      (s, ctx) =>
        updateIntegrations(
          s,
          ctx,
          (i) => ({
            ...i,
            n8n: {
              ...i.n8n,
              webhook_url: webhook,
              events,
              outbound_enabled: enabled,
              // The secret itself is never stored in the browser: only that one exists and its last 4 characters.
              ...(secret ? { secret_configured: true, secret_hint: `••••${secret.slice(-4)}` } : {}),
            },
          }),
          "integration_settings.n8n_updated",
        ),
      "n8n settings saved.",
    );
    setSecret("");
  }

  async function test(kind: "webhook" | "controller") {
    const url = kind === "webhook" ? n8n.webhook_url : state.integrations.playwright.controller_url;
    if (!url) return notify("Save a URL first.", "error");
    setTesting(kind);
    const result = await runRemoteTest(kind, url);
    setTesting(null);
    run((s, ctx) =>
      updateIntegrations(
        s,
        ctx,
        (i) =>
          kind === "webhook"
            ? { ...i, n8n: { ...i.n8n, last_test: result } }
            : { ...i, playwright: { ...i.playwright, last_test: result } },
        kind === "webhook" ? "integration_settings.n8n_tested" : "integration_settings.playwright_tested",
      ),
    );
    notify(result.message, result.ok ? "good" : "error");
  }

  return (
    <>
      <DemoNotice />
      {!isAdmin ? (
        <Alert>
          <FlaskConical />
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>
            Only admins can change integration settings. Switch the demo user to Ada Admin to edit.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="gap-3">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="text-muted-foreground size-4" aria-hidden />
              <CardTitle>Data source</CardTitle>
            </div>
            <CardDescription>
              Where JobSync reads and writes its data. Reported from the server; values are never shown.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[11rem_1fr] gap-y-2 text-sm">
              <Row label="Active data layer">
                <StatusBadge tone="info" label={server.dataMode === "demo" ? "Demo (this browser)" : "Supabase"} />
              </Row>
              <Row label="Supabase URL">
                <Present ok={server.supabaseUrlSet} />
              </Row>
              <Row label="Anon / publishable key">
                <Present ok={server.anonKeySet} />
              </Row>
              <Row label="Service-role key">
                <Present ok={server.serviceRoleSet} yes="Set (server only)" />
              </Row>
              <Row label="Connection">
                <span className="text-muted-foreground">
                  Not used in demo mode. Tested after migrations are applied and JOBSYNC_DATA_MODE=supabase.
                </span>
              </Row>
            </dl>
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileCode2 className="text-muted-foreground size-4" aria-hidden />
              <CardTitle>External job intake</CardTitle>
            </div>
            <CardDescription>
              How AroFlo (through n8n or any HTTPS client) sends work orders to JobSync.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <Row label="Endpoint">
                <code className="font-mono text-xs select-all">POST {origin}/api/v1/jobs/intake</code>
              </Row>
              <Row label="Authentication">
                Per-organisation API key (Bearer), hashed at rest, limited to named sources
              </Row>
              <Row label="Limits">JSON ≤ 1 MiB · 60 req/min per IP · 120 req/min per key</Row>
              <Row label="In demo mode">
                The endpoint answers <code className="font-mono text-xs">503 demo_mode</code>, because demo data lives
                in each browser. Use the{" "}
                <Link href="/incoming" className="text-primary hover:underline">
                  intake simulator
                </Link>
                , which applies the same validation and duplicate rules.
              </Row>
              <Row label="AroFlo">
                Not connected directly. Requires authorised credentials and an approved integration method.
              </Row>
            </dl>
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Webhook className="text-muted-foreground size-4" aria-hidden />
              <CardTitle>n8n outbound events</CardTitle>
            </div>
            <CardDescription>
              Notify an n8n workflow when portal submissions finish. The test sends a fixed sample payload, never job
              data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <fieldset disabled={!isAdmin} className="flex flex-col gap-3">
              <div>
                <label htmlFor="n8n-url" className="text-muted-foreground mb-1 block text-xs font-medium">
                  Webhook URL (https)
                </label>
                <Input
                  id="n8n-url"
                  value={webhook}
                  placeholder="https://n8n.example.com/webhook/jobsync"
                  onChange={(e) => setWebhook(e.target.value.trim())}
                  aria-invalid={!validUrl(webhook) || undefined}
                />
              </div>
              <div>
                <label htmlFor="n8n-secret" className="text-muted-foreground mb-1 block text-xs font-medium">
                  Shared secret {n8n.secret_configured ? `(configured: ${n8n.secret_hint})` : ""}
                </label>
                <Input
                  id="n8n-secret"
                  type="password"
                  autoComplete="new-password"
                  value={secret}
                  placeholder={
                    n8n.secret_configured ? "Leave blank to keep the current secret" : "Used to sign outbound requests"
                  }
                  onChange={(e) => setSecret(e.target.value)}
                />
                <p className="text-muted-foreground mt-1 text-xs">
                  Never displayed after saving. In demo mode the secret itself is not stored, only that one was set;
                  with Supabase it is encrypted server-side.
                </p>
              </div>
              <fieldset>
                <legend className="text-muted-foreground mb-1 text-xs font-medium">Events</legend>
                <div className="flex flex-col gap-1.5 text-sm">
                  {N8N_EVENTS.map((ev) => (
                    <label key={ev.key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="accent-primary size-4"
                        checked={events.includes(ev.key)}
                        onChange={(e) =>
                          setEvents((x) => (e.target.checked ? [...x, ev.key] : x.filter((k) => k !== ev.key)))
                        }
                      />
                      {ev.label} <code className="text-muted-foreground font-mono text-[11px]">{ev.key}</code>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Record outbound events
              </label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={saveN8n}>
                  <Save aria-hidden /> Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => test("webhook")}
                  disabled={testing !== null || !n8n.webhook_url}
                >
                  {testing === "webhook" ? <LoaderCircle className="animate-spin" aria-hidden /> : <Plug aria-hidden />}{" "}
                  Send test request
                </Button>
              </div>
            </fieldset>
            <div className="mt-3 text-sm">
              Last test: <TestResult result={n8n.last_test} />
            </div>
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Server className="text-muted-foreground size-4" aria-hidden />
              <CardTitle>Playwright controller</CardTitle>
            </div>
            <CardDescription>The browser automation worker that performs portal submissions.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <Row label="Worker in use">
                <span className="inline-flex items-center gap-2">
                  Simulated in-browser worker <SimulatedBadge />
                </span>
              </Row>
              <Row label="State">
                {state.settings.worker_running ? "Running" : "Paused"} · {state.settings.max_concurrency} slots
              </Row>
              <Row label="Real worker">Not built yet. The controller endpoint below is saved for when it exists.</Row>
            </dl>
            <fieldset disabled={!isAdmin} className="flex flex-col gap-2">
              <label htmlFor="pw-url" className="text-muted-foreground text-xs font-medium">
                Controller health URL (https)
              </label>
              <Input
                id="pw-url"
                value={controller}
                placeholder="https://worker.example.com/health"
                onChange={(e) => setController(e.target.value.trim())}
                aria-invalid={!validUrl(controller) || undefined}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    if (!validUrl(controller)) return notify("The controller URL must be a valid https URL.", "error");
                    run(
                      (s, ctx) =>
                        updateIntegrations(
                          s,
                          ctx,
                          (i) => ({ ...i, playwright: { ...i.playwright, controller_url: controller } }),
                          "integration_settings.playwright_updated",
                        ),
                      "Controller URL saved.",
                    );
                  }}
                >
                  <Save aria-hidden /> Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => test("controller")}
                  disabled={testing !== null || !state.integrations.playwright.controller_url}
                >
                  {testing === "controller" ? (
                    <LoaderCircle className="animate-spin" aria-hidden />
                  ) : (
                    <Plug aria-hidden />
                  )}{" "}
                  Test connection
                </Button>
              </div>
            </fieldset>
            <div className="text-sm">
              Last test: <TestResult result={state.integrations.playwright.last_test} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Outbound event log</CardTitle>
          <CardDescription>Events recorded for n8n. In demo mode they are recorded but not delivered.</CardDescription>
        </CardHeader>
        <CardContent>
          {outbound.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No outbound events yet. Enable outbound events and run the worker to record some.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {outbound.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <code className="font-mono text-xs">{e.event_type}</code>
                  <StatusBadge tone="neutral" label="Not sent (demo)" />
                  <span className="text-muted-foreground text-xs tabular-nums">{formatDateTime(e.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/* -------------------------------------------------------------- audit */

const PAGE = 50;

export function DemoAudit() {
  const { state, user, now } = useDemo();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in changes)) next.delete("page");
    router.replace(next.toString() ? `${pathname}?${next}` : pathname, { scroll: false });
  };
  const entity = params.get("entity") ?? "";
  const actor = params.get("actor") ?? "";
  const q = params.get("q") ?? "";
  const days = Number.parseInt(params.get("days") ?? "0", 10);
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const minute = Math.floor(now.getTime() / 60_000);
  const rows = useMemo(
    () =>
      auditRows(
        state,
        { entity: entity || undefined, actor: actor || undefined, q, days: days || undefined },
        new Date(minute * 60_000),
      ),
    [state, entity, actor, q, days, minute],
  );
  const entities = useMemo(() => [...new Set(state.audit.map((a) => a.entity_type))].sort(), [state.audit]);
  const userName = new Map(state.users.map((u) => [u.id, u.full_name]));
  const jobRef = new Map(state.jobs.map((j) => [j.id, j.reference]));
  if (!can(user.role, "audit_logs.read"))
    return <PermissionDenied role={user.role} needed="admin" what="Reading the audit log" />;

  const actorLabel = (id: string | null, type: string) =>
    id
      ? (userName.get(id) ?? "Unknown user")
      : type === "worker"
        ? "Automation worker"
        : type === "integration"
          ? "Intake integration"
          : "System";
  const entityLink = (type: string, id: string | null) => {
    if (!id) return null;
    if (type === "jobs")
      return (
        <Link href={`/jobs/${id}`} className="text-primary hover:underline">
          {jobRef.get(id) ?? id.slice(0, 8)}
        </Link>
      );
    if (type === "portals") {
      const p = state.portals.find((x) => x.id === id);
      return p ? (
        <Link href={`/portals/${p.slug}`} className="text-primary hover:underline">
          {p.name}
        </Link>
      ) : null;
    }
    return <span className="text-muted-foreground font-mono text-[11px]">{id.slice(0, 8)}…</span>;
  };

  return (
    <>
      <DemoNotice />
      <div className="bg-card grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2">
          <label htmlFor="audit-q" className="text-muted-foreground mb-1 block text-xs font-medium">
            Search
          </label>
          <Search className="text-muted-foreground pointer-events-none absolute bottom-2.5 left-3 size-4" aria-hidden />
          <Input
            id="audit-q"
            type="search"
            className="pl-9"
            placeholder="Action, record ID or changed value"
            defaultValue={q}
            onKeyDown={(e) => e.key === "Enter" && set({ q: (e.target as HTMLInputElement).value })}
            onBlur={(e) => e.target.value !== q && set({ q: e.target.value })}
          />
        </div>
        <Filter
          id="audit-entity"
          label="Record type"
          value={entity}
          onChange={(v) => set({ entity: v })}
          options={[["", "All records"], ...entities.map((e) => [e, e.replace(/_/g, " ")] as [string, string])]}
        />
        <Filter
          id="audit-actor"
          label="Actor"
          value={actor}
          onChange={(v) => set({ actor: v })}
          options={[
            ["", "Everyone"],
            ...state.users.map((u) => [u.id, u.full_name] as [string, string]),
            ["system", "System, worker and integrations"],
          ]}
        />
        <Filter
          id="audit-days"
          label="Period"
          value={String(days)}
          onChange={(v) => set({ days: v === "0" ? null : v })}
          options={[
            ["0", "All time"],
            ["1", "Last 24 hours"],
            ["7", "Last 7 days"],
            ["30", "Last 30 days"],
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm tabular-nums">{formatNumber(rows.length)} entries</p>
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv("jobsync-audit-log.csv", [
              ["id", "created_at", "actor", "actor_type", "action", "entity_type", "entity_id", "changes"],
              ...rows.map((a) => [
                a.id,
                a.created_at,
                actorLabel(a.actor_id, a.actor_type),
                a.actor_type,
                a.action,
                a.entity_type,
                a.entity_id,
                a.changes ? JSON.stringify(a.changes) : null,
              ]),
            ])
          }
        >
          <Download aria-hidden /> Export CSV
        </Button>
      </div>
      <div className="bg-card overflow-hidden rounded-xl border">
        {rows.length === 0 ? (
          <p className="text-muted-foreground p-6 text-center text-sm">No audit entries match these filters.</p>
        ) : (
          <ul className="divide-y">
            {rows.slice((page - 1) * PAGE, page * PAGE).map((a) => (
              <li key={a.id}>
                <details className="group">
                  <summary className="hover:bg-muted/40 grid cursor-pointer list-none grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm sm:grid-cols-[11rem_10rem_1fr_auto] [&::-webkit-details-marker]:hidden">
                    <span className="text-muted-foreground text-xs tabular-nums">{formatDateTime(a.created_at)}</span>
                    <span className="truncate text-xs">{actorLabel(a.actor_id, a.actor_type)}</span>
                    <span className="col-span-2 min-w-0 sm:col-span-1">
                      <code className="font-mono text-xs">{a.action}</code> {entityLink(a.entity_type, a.entity_id)}
                    </span>
                    <ChevronRight
                      className="text-muted-foreground hidden size-4 transition-transform group-open:rotate-90 sm:block"
                      aria-hidden
                    />
                  </summary>
                  <div className="bg-muted/30 px-4 pb-3 text-xs">
                    {a.changes && Object.keys(a.changes).length > 0 ? (
                      <pre className="bg-card max-h-64 overflow-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed">
                        {JSON.stringify(a.changes, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-muted-foreground pt-2">No field changes recorded for this action.</p>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
      {rows.length > PAGE ? (
        <nav aria-label="Pagination" className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground tabular-nums">
            Page {page} of {Math.ceil(rows.length / PAGE)}
          </span>
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= Math.ceil(rows.length / PAGE)}
            onClick={() => set({ page: String(page + 1) })}
          >
            Next
          </Button>
        </nav>
      ) : null}
      <p className="text-muted-foreground text-xs">
        Entries are append-only: the log cannot be edited or deleted from the application.
      </p>
    </>
  );
}

function Filter({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string | null) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <label htmlFor={id} className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value || null)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/* ------------------------------------------------------------- system */

type SettingsForm = Omit<SystemSettings, "execution_mode" | "worker_running"> & {
  failurePct: number;
  reviewPct: number;
};

function toForm(s: SystemSettings): SettingsForm {
  return {
    ...s,
    failurePct: Math.round(s.simulation.failure_rate * 100),
    reviewPct: Math.round(s.simulation.human_review_rate * 100),
  };
}

export function DemoSystem({ server }: { server: ServerInfo }) {
  const { state, user, run, reset, persistence } = useDemo();
  const [form, setForm] = useState<SettingsForm>(() => toForm(state.settings));
  const isAdmin = can(user.role, "system.configure");
  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v === "" ? Number.NaN : Number(v));

  function save() {
    run(
      (s, ctx) =>
        updateSettings(s, ctx, {
          max_concurrency: form.max_concurrency,
          retry_limit: form.retry_limit,
          backoff_base_seconds: form.backoff_base_seconds,
          execution_timeout_seconds: form.execution_timeout_seconds,
          polling_interval_seconds: form.polling_interval_seconds,
          auto_routing: form.auto_routing,
          worker_running: s.settings.worker_running,
          simulation: {
            failure_rate: form.failurePct / 100,
            human_review_rate: form.reviewPct / 100,
            speed: form.simulation.speed,
          },
        }),
      "System configuration saved.",
    );
  }

  function exportJson() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `jobsync-demo-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const field = (
    id: keyof SettingsForm,
    label: string,
    hint: string,
    attrs: { min: number; max: number; step?: number },
  ) => (
    <div>
      <label htmlFor={`sys-${id}`} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={`sys-${id}`}
        type="number"
        className="mt-1"
        {...attrs}
        value={Number.isNaN(form[id] as number) ? "" : (form[id] as number)}
        onChange={(e) => set(id, num(e.target.value) as never)}
      />
      <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
    </div>
  );

  return (
    <>
      <DemoNotice />
      {!isAdmin ? (
        <Alert>
          <FlaskConical />
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>Only admins can change system configuration.</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="gap-4 xl:col-span-2">
          <CardHeader>
            <CardTitle>Automation</CardTitle>
            <CardDescription>
              How the queue runs. Changes apply immediately and are recorded in the audit log.
            </CardDescription>
            {isAdmin ? (
              <CardAction>
                <Button size="sm" onClick={save}>
                  <Save aria-hidden /> Save configuration
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            <fieldset disabled={!isAdmin} className="flex flex-col gap-5">
              <fieldset>
                <legend className="text-sm font-medium">Execution mode</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="border-primary bg-primary/5 flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                    <input type="radio" name="mode" checked readOnly className="accent-primary mt-1" />
                    <span>
                      <span className="block font-medium">Dry run</span>
                      <span className="text-muted-foreground text-xs">
                        Every browser step except the final submit. The default.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-not-allowed items-start gap-2 rounded-md border px-3 py-2 text-sm opacity-70">
                    <input type="radio" name="mode" disabled className="mt-1" />
                    <span>
                      <span className="block font-medium">Live</span>
                      <span className="text-muted-foreground text-xs">
                        Unavailable: requires JOBSYNC_ALLOW_LIVE_SUBMISSIONS on the server, authorised portal access and
                        the real Playwright worker (not built). The demo never submits.
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {field("max_concurrency", "Browser workers", "Parallel attempts (1–10). Default 3.", {
                  min: 1,
                  max: 10,
                })}
                {field(
                  "retry_limit",
                  "Retry limit",
                  "Attempts per portal before it fails (1–10). Applies to new tasks.",
                  { min: 1, max: 10 },
                )}
                {field("backoff_base_seconds", "Backoff base (s)", "Wait before retry 1; doubles each time (5–3600).", {
                  min: 5,
                  max: 3600,
                })}
                {field("execution_timeout_seconds", "Attempt timeout (s)", "Maximum time for one attempt (10–900).", {
                  min: 10,
                  max: 900,
                })}
                {field(
                  "polling_interval_seconds",
                  "Queue polling (s)",
                  "How often the worker looks for due tasks (1–60).",
                  { min: 1, max: 60 },
                )}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary mt-0.5 size-4"
                  checked={form.auto_routing}
                  onChange={(e) => set("auto_routing", e.target.checked)}
                />
                <span>
                  <span className="font-medium">Route new jobs automatically</span>
                  <span className="text-muted-foreground block text-xs">
                    Jobs without destinations are matched against routing rules on arrival. When off they wait in
                    &ldquo;Awaiting routing&rdquo;.
                  </span>
                </span>
              </label>
              <fieldset className="rounded-md border p-4">
                <legend className="px-1 text-sm font-medium">
                  Simulation <SimulatedBadge />
                </legend>
                <div className="grid gap-4 sm:grid-cols-3">
                  {field(
                    "failurePct",
                    "Transient failure rate (%)",
                    "Timeouts, 503s, missing fields: retried (0–90).",
                    { min: 0, max: 90 },
                  )}
                  {field(
                    "reviewPct",
                    "Human review rate (%)",
                    "CAPTCHA, MFA, portal rejection: sent to a person (0–50).",
                    { min: 0, max: 50 },
                  )}
                  <div>
                    <label htmlFor="sys-speed" className="text-sm font-medium">
                      Simulation speed
                    </label>
                    <NativeSelect
                      id="sys-speed"
                      className="mt-1"
                      value={String(form.simulation.speed)}
                      onChange={(e) => set("simulation", { ...form.simulation, speed: Number(e.target.value) })}
                    >
                      <option value="0.03">Very fast (≈1–2 s per attempt)</option>
                      <option value="0.1">Fast (≈3–7 s per attempt)</option>
                      <option value="0.5">Slow (≈15–35 s per attempt)</option>
                      <option value="1">Realistic (≈20–70 s per attempt)</option>
                    </NativeSelect>
                    <p className="text-muted-foreground mt-1 text-xs">Only affects simulated attempts.</p>
                  </div>
                </div>
              </fieldset>
            </fieldset>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Environment</CardTitle>
              <CardDescription>Read from the server at request time.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
                <Row label="Data layer">{server.dataMode === "demo" ? "Demo (browser)" : "Supabase"}</Row>
                <Row label="Execution mode env">
                  <code className="font-mono text-xs">{server.envExecutionMode}</code>
                </Row>
                <Row label="Live submissions">{server.liveAllowedByEnv ? "Allowed by environment" : "Not allowed"}</Row>
              </dl>
            </CardContent>
          </Card>
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Demo data</CardTitle>
              <CardDescription>
                {persistence === "indexeddb"
                  ? "Saved in this browser (IndexedDB). Other people and devices do not see it."
                  : "This browser blocks storage: changes last until you close the tab."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                {[
                  ["Jobs", state.jobs.length],
                  ["Submission tasks", state.tasks.length],
                  ["Executions", state.executions.length],
                  ["Intake events", state.events.length],
                  ["Audit entries", state.audit.length],
                ].map(([k, v]) => (
                  <div key={String(k)} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right tabular-nums">{formatNumber(v as number)}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={exportJson}>
                  <Download aria-hidden /> Export JSON
                </Button>
                {isAdmin ? (
                  <ConfirmAction
                    trigger={
                      <Button size="sm" variant="outline" className="text-destructive">
                        <RotateCcw aria-hidden /> Reset demo data
                      </Button>
                    }
                    title="Reset all demo data?"
                    description={
                      <p>
                        Every job, task, execution, setting and audit entry in this browser is replaced with a fresh
                        sample. Uploaded files are deleted. This cannot be undone.
                      </p>
                    }
                    confirmLabel="Reset demo data"
                    destructive
                    onConfirm={() => {
                      void reset().then(() => window.location.reload());
                    }}
                  />
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
