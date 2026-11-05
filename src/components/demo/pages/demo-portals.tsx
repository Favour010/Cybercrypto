"use client";

import { ArrowLeft, ExternalLink, FlaskConical, LoaderCircle, Pencil, Plug, Plus, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useId, useMemo, useState } from "react";

import { StatusBadge } from "@/components/common/status-badge";
import { useDemo } from "@/components/demo/demo-provider";
import { ConfirmAction, DemoNotice, SimulatedBadge } from "@/components/demo/demo-ui";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/auth/permissions";
import {
  deleteRoutingRule,
  recordConnectionTest,
  saveRoutingRule,
  updatePortal,
  type RuleInput,
} from "@/lib/demo/engine";
import { portalStats } from "@/lib/demo/selectors";
import type { DemoPortal, DemoRoutingRule } from "@/lib/demo/types";
import { isPortalSlug, type PortalSlug } from "@/lib/domain/portals";
import { JOB_PRIORITIES, JOB_PRIORITY_META, type JobPriority, type StatusTone } from "@/lib/domain/status";
import { formatDateTime, formatPercent } from "@/lib/format";
import { PORTAL_SPECS } from "@/lib/portals/specs";
import { routeJob } from "@/lib/routing/rules";

const CONNECTION: Record<DemoPortal["connection_status"], { tone: StatusTone; label: string }> = {
  untested: { tone: "neutral", label: "Untested" },
  ok: { tone: "good", label: "Reachable" },
  failed: { tone: "critical", label: "Test failed" },
};

function automationState(p: DemoPortal): { tone: StatusTone; label: string } {
  if (!p.is_enabled) return { tone: "neutral", label: "Portal disabled" };
  if (!p.automation_enabled) return { tone: "warning", label: "Automation paused" };
  return { tone: "good", label: "Automation on (dry run)" };
}

/* ------------------------------------------------------------- overview */

export function DemoPortals() {
  const { state } = useDemo();
  return (
    <>
      <DemoNotice />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {state.portals.map((p) => (
          <PortalCard key={p.slug} portal={p} />
        ))}
      </div>
      <RoutingRules />
      <RuleTester />
    </>
  );
}

function PortalCard({ portal }: { portal: DemoPortal }) {
  const { state } = useDemo();
  const stats = useMemo(() => portalStats(state, portal.slug), [state, portal.slug]);
  const conn = CONNECTION[portal.connection_status];
  const auto = automationState(portal);
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-base">{portal.name}</CardTitle>
        <CardDescription className="truncate">{portal.base_url}</CardDescription>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href={`/portals/${portal.slug}`}>Manage</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={conn.tone} label={conn.label} />
          <StatusBadge tone={auto.tone} label={auto.label} />
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Tasks", stats.tasks],
            ["Success", formatPercent(stats.successRate, 0)],
            ["Open", stats.open],
          ].map(([k, v]) => (
            <div key={String(k)} className="bg-muted/50 rounded-md py-2">
              <dt className="text-muted-foreground text-[11px]">{k}</dt>
              <dd className="font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground text-xs">
          {stats.failed} failed · {stats.review} in review · last successful run{" "}
          {stats.lastSuccess ? formatDateTime(stats.lastSuccess.completed_at) : "never"} <SimulatedBadge />
        </p>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------- routing rules */

function conditions(
  r: Pick<DemoRoutingRule, "match_customer" | "match_category" | "match_priority" | "match_location">,
): string {
  return (
    [
      r.match_category && `category is "${r.match_category}"`,
      r.match_customer && `customer contains "${r.match_customer}"`,
      r.match_location && `address contains "${r.match_location}"`,
      r.match_priority && `priority is ${r.match_priority}`,
    ]
      .filter(Boolean)
      .join(" and ") || "—"
  );
}

const EMPTY_RULE: RuleInput = {
  name: "",
  description: "",
  priority: 100,
  is_active: true,
  match_customer: null,
  match_category: null,
  match_priority: null,
  match_location: null,
  portal_slug: "northstar",
};

function RoutingRules({ portal }: { portal?: PortalSlug }) {
  const { state, user, run } = useDemo();
  const [editing, setEditing] = useState<{ id: string | null; input: RuleInput } | null>(null);
  const isAdmin = can(user.role, "routing_rules.manage");
  const rules = [...state.routing_rules]
    .filter((r) => !portal || r.portal_slug === portal)
    .sort((a, b) => a.priority - b.priority);
  const portalName = (slug: string) => state.portals.find((p) => p.slug === slug)?.name ?? slug;

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>{portal ? "Routing rules for this portal" : "Routing rules"}</CardTitle>
        <CardDescription>
          Jobs that arrive without explicit destinations are routed by these rules, lowest priority number first. A rule
          matches when all its conditions match. No match means human review, never &ldquo;all portals&rdquo;.
        </CardDescription>
        {isAdmin ? (
          <CardAction>
            <Button
              size="sm"
              onClick={() => setEditing({ id: null, input: { ...EMPTY_RULE, portal_slug: portal ?? "northstar" } })}
            >
              <Plus aria-hidden /> Add rule
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <p className="text-muted-foreground text-sm">No rules yet.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Order</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Conditions</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">{r.priority}</TableCell>
                    <TableCell className="max-w-56 whitespace-normal">
                      <div className="font-medium">{r.name}</div>
                      {r.description ? <div className="text-muted-foreground text-xs">{r.description}</div> : null}
                    </TableCell>
                    <TableCell className="max-w-72 text-xs whitespace-normal">{conditions(r)}</TableCell>
                    <TableCell>{portalName(r.portal_slug)}</TableCell>
                    <TableCell>
                      <StatusBadge tone={r.is_active ? "good" : "neutral"} label={r.is_active ? "Active" : "Paused"} />
                    </TableCell>
                    {isAdmin ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing({ id: r.id, input: { ...r } })}
                            aria-label={`Edit ${r.name}`}
                          >
                            <Pencil aria-hidden />
                          </Button>
                          <ConfirmAction
                            trigger={
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                aria-label={`Delete ${r.name}`}
                              >
                                <Trash2 aria-hidden />
                              </Button>
                            }
                            title={`Delete "${r.name}"?`}
                            description={
                              <p>
                                Future jobs will no longer match this rule. Past routing decisions keep their recorded
                                reason.
                              </p>
                            }
                            confirmLabel="Delete rule"
                            destructive
                            onConfirm={() =>
                              run((s, ctx) => deleteRoutingRule(s, ctx, r.id), `Rule "${r.name}" deleted.`).ok
                            }
                          />
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {editing ? <RuleDialog key={editing.id ?? "new"} editing={editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function RuleDialog({ editing, onClose }: { editing: { id: string | null; input: RuleInput }; onClose: () => void }) {
  const { run, state } = useDemo();
  const [r, setR] = useState<RuleInput>(editing.input);
  const set = <K extends keyof RuleInput>(k: K, v: RuleInput[K]) => setR((x) => ({ ...x, [k]: v }));
  const text = (v: string) => (v.trim() ? v.trim() : null);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing.id ? "Edit routing rule" : "New routing rule"}</DialogTitle>
          <DialogDescription>Set at least one condition. All set conditions must match.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="rule-name" label="Name" wide>
            <Input id="rule-name" value={r.name} maxLength={120} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field id="rule-category" label="Category is">
            <Input
              id="rule-category"
              value={r.match_category ?? ""}
              placeholder="e.g. Fire Safety"
              onChange={(e) => set("match_category", text(e.target.value))}
            />
          </Field>
          <Field id="rule-customer" label="Customer contains">
            <Input
              id="rule-customer"
              value={r.match_customer ?? ""}
              placeholder="e.g. Kingsbridge"
              onChange={(e) => set("match_customer", text(e.target.value))}
            />
          </Field>
          <Field id="rule-location" label="Address contains">
            <Input
              id="rule-location"
              value={r.match_location ?? ""}
              placeholder="e.g. Manchester"
              onChange={(e) => set("match_location", text(e.target.value))}
            />
          </Field>
          <Field id="rule-priority-match" label="Priority is">
            <NativeSelect
              id="rule-priority-match"
              value={r.match_priority ?? ""}
              onChange={(e) => set("match_priority", (e.target.value || null) as JobPriority | null)}
            >
              <option value="">Any priority</option>
              {JOB_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {JOB_PRIORITY_META[p].label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rule-portal" label="Destination portal">
            <NativeSelect
              id="rule-portal"
              value={r.portal_slug}
              onChange={(e) => isPortalSlug(e.target.value) && set("portal_slug", e.target.value)}
            >
              {state.portals.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rule-order" label="Order (lower runs first)">
            <Input
              id="rule-order"
              type="number"
              min={0}
              max={10000}
              value={r.priority}
              onChange={(e) => set("priority", Number.parseInt(e.target.value, 10))}
            />
          </Field>
          <Field id="rule-desc" label="Description" wide>
            <Textarea
              id="rule-desc"
              rows={2}
              value={r.description}
              maxLength={500}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={r.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
            />
            Active
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (
                run((s, ctx) => saveRoutingRule(s, ctx, editing.id, r), editing.id ? "Rule saved." : "Rule added.").ok
              )
                onClose();
            }}
          >
            Save rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  wide,
  children,
}: {
  id: string;
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={id} className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function RuleTester() {
  const { state } = useDemo();
  const [job, setJob] = useState({
    customer_name: "Kingsbridge Medical Centre",
    category: "Fire Safety",
    priority: "normal" as JobPriority,
    service_address: "4 Station Approach, Manchester",
  });
  const decisions = useMemo(() => routeJob(job, state.routing_rules), [job, state.routing_rules]);
  return (
    <Card className="gap-3">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wand2 className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Rule tester</CardTitle>
        </div>
        <CardDescription>
          See where a job would be routed by the active rules, and why. Nothing is saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="t-customer" label="Customer">
            <Input
              id="t-customer"
              value={job.customer_name}
              onChange={(e) => setJob({ ...job, customer_name: e.target.value })}
            />
          </Field>
          <Field id="t-category" label="Category">
            <Input
              id="t-category"
              value={job.category}
              onChange={(e) => setJob({ ...job, category: e.target.value })}
            />
          </Field>
          <Field id="t-address" label="Service address">
            <Input
              id="t-address"
              value={job.service_address}
              onChange={(e) => setJob({ ...job, service_address: e.target.value })}
            />
          </Field>
          <Field id="t-priority" label="Priority">
            <NativeSelect
              id="t-priority"
              value={job.priority}
              onChange={(e) => setJob({ ...job, priority: e.target.value as JobPriority })}
            >
              {JOB_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {JOB_PRIORITY_META[p].label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div aria-live="polite">
          {decisions.length === 0 ? (
            <p className="text-sm">
              <StatusBadge tone="warning" label="Human review" /> No active rule matches, so this job would wait for a
              person to assign portals.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {decisions.map((d) => (
                <li key={d.portal_slug} className="rounded-md border px-3 py-2 text-sm">
                  <div className="font-medium">{state.portals.find((p) => p.slug === d.portal_slug)?.name}</div>
                  <div className="text-muted-foreground text-xs">{d.reason}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------------------- detail */

interface TestResponse {
  ok: boolean;
  http_status: number | null;
  latency_ms: number | null;
  message: string;
  tested_url?: string;
}

export function DemoPortalDetail({ slug }: { slug: string }) {
  const { state, user, run, notify } = useDemo();
  const portal = isPortalSlug(slug) ? state.portals.find((p) => p.slug === slug) : undefined;
  const stats = useMemo(() => (portal ? portalStats(state, portal.slug) : null), [state, portal]);
  const [form, setForm] = useState(() =>
    portal
      ? {
          base_url: portal.base_url,
          is_enabled: portal.is_enabled,
          automation_enabled: portal.automation_enabled,
          notes: portal.notes,
          timeout_seconds: portal.timeout_seconds,
        }
      : null,
  );
  const [testing, setTesting] = useState(false);
  // Unique per instance: Next.js keeps visited portal pages mounted (hidden).
  const uid = useId();
  if (!portal || !stats || !form) notFound();
  const isAdmin = can(user.role, "portals.manage");
  const spec = PORTAL_SPECS[portal.slug];
  const conn = CONNECTION[portal.connection_status];
  const dirty =
    form.base_url !== portal.base_url ||
    form.is_enabled !== portal.is_enabled ||
    form.automation_enabled !== portal.automation_enabled ||
    form.notes !== portal.notes ||
    form.timeout_seconds !== portal.timeout_seconds;

  async function testConnection() {
    setTesting(true);
    try {
      const res = await fetch("/api/portals/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: portal!.base_url }),
      });
      const body = (await res.json()) as TestResponse;
      run(
        (s, ctx) =>
          recordConnectionTest(s, ctx, portal!.slug, {
            ok: body.ok,
            http_status: body.http_status ?? null,
            latency_ms: body.latency_ms ?? null,
            message: body.message,
            tested_url: portal!.base_url,
          }),
        body.ok ? `${portal!.name}: ${body.message}` : undefined,
      );
      if (!body.ok) notify(`${portal!.name}: ${body.message}`, "error");
    } catch {
      notify("The connection test could not run. Check your network and try again.", "error");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/portals">
          <ArrowLeft /> All portals
        </Link>
      </Button>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{portal.name}</h1>
          <a
            href={portal.base_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary mt-1 inline-flex items-center gap-1 text-sm hover:underline"
          >
            {portal.base_url} <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={conn.tone} label={conn.label} />
          <StatusBadge tone={automationState(portal).tone} label={automationState(portal).label} />
          <span className="text-muted-foreground inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs">
            <FlaskConical className="size-3" aria-hidden /> Simulated demonstration portal
          </span>
        </div>
      </div>
      <DemoNotice />

      <div className="grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="gap-3">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Plug className="text-muted-foreground size-4" aria-hidden />
              <CardTitle>Connection</CardTitle>
            </div>
            <CardDescription>
              A real HTTPS request from the JobSync server to the portal URL. Saving a URL never marks it reachable.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <StatusBadge tone={conn.tone} label={conn.label} />
              </dd>
              <dt className="text-muted-foreground">Last test</dt>
              <dd>
                {portal.last_connection_test_at ? formatDateTime(portal.last_connection_test_at) : "Never tested"}
              </dd>
              <dt className="text-muted-foreground">Result</dt>
              <dd className="break-words">
                {portal.connection_status === "untested"
                  ? "—"
                  : portal.connection_status === "ok"
                    ? `HTTP ${portal.last_connection_http_status} in ${portal.last_connection_latency_ms} ms`
                    : portal.last_connection_error}
              </dd>
            </dl>
            <Button
              size="sm"
              className="w-fit"
              onClick={testConnection}
              disabled={!isAdmin || testing || dirty}
              title={dirty ? "Save the configuration first." : !isAdmin ? "Admins can test portals." : undefined}
            >
              {testing ? <LoaderCircle className="animate-spin" aria-hidden /> : <Plug aria-hidden />}
              {testing ? "Testing…" : "Test connection"}
            </Button>
          </CardContent>
        </Card>

        <Card className="gap-3 xl:col-span-2">
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>
              {isAdmin ? "Changes are recorded in the audit log." : "Only admins can change portal configuration."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <fieldset disabled={!isAdmin} className="grid gap-3 sm:grid-cols-2">
              <Field id={`${uid}-p-url`} label="Portal URL (https)" wide>
                <Input
                  id={`${uid}-p-url`}
                  value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                />
              </Field>
              <Field id={`${uid}-p-timeout`} label="Run timeout (seconds)">
                <Input
                  id={`${uid}-p-timeout`}
                  type="number"
                  min={10}
                  max={600}
                  value={form.timeout_seconds}
                  onChange={(e) => setForm({ ...form, timeout_seconds: Number.parseInt(e.target.value, 10) })}
                />
              </Field>
              <div className="flex flex-col justify-end gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={form.is_enabled}
                    onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })}
                  />
                  Portal enabled (can be chosen as a destination)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={form.automation_enabled}
                    onChange={(e) => setForm({ ...form, automation_enabled: e.target.checked })}
                  />
                  Automation enabled (worker may run tasks)
                </label>
              </div>
              <Field id={`${uid}-p-notes`} label="Notes" wide>
                <Textarea
                  id={`${uid}-p-notes`}
                  rows={2}
                  value={form.notes}
                  maxLength={500}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
              <div className="flex gap-2 sm:col-span-2">
                <Button
                  size="sm"
                  disabled={!dirty}
                  onClick={() =>
                    run((s, ctx) => updatePortal(s, ctx, portal.slug, form), `${portal.name} configuration saved.`)
                  }
                >
                  Save configuration
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!dirty}
                  onClick={() =>
                    setForm({
                      base_url: portal.base_url,
                      is_enabled: portal.is_enabled,
                      automation_enabled: portal.automation_enabled,
                      notes: portal.notes,
                      timeout_seconds: portal.timeout_seconds,
                    })
                  }
                >
                  Discard changes
                </Button>
              </div>
            </fieldset>
            <p className="text-muted-foreground mt-3 text-xs">
              Portal credentials are never stored in JobSync&apos;s browser data. With Supabase connected they are kept
              server-side and are never shown after saving.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Submission statistics</CardTitle>
            <CardDescription>All time, from simulated dry runs and recorded manual submissions.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[
                ["Submission tasks", stats.tasks],
                ["Success rate (automation)", formatPercent(stats.successRate)],
                ["Dry runs passed", stats.dryRunPassed],
                ["Submitted manually", stats.manual],
                ["Open (queued or retrying)", stats.open],
                ["Failed", stats.failed],
                ["In human review", stats.review],
                ["Last successful run", stats.lastSuccess ? formatDateTime(stats.lastSuccess.completed_at) : "Never"],
              ].map(([k, v]) => (
                <div key={String(k)} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card className="gap-3 xl:col-span-2">
          <CardHeader>
            <CardTitle>Work-order form mapping</CardTitle>
            <CardDescription>
              How JobSync fields map to this portal&apos;s form ({spec.formPath}). Attachments:{" "}
              {spec.supportsAttachments ? `up to ${spec.maxAttachmentMb} MB` : "not accepted"} · reference format{" "}
              {spec.referencePattern}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>JobSync field</TableHead>
                    <TableHead>Portal label</TableHead>
                    <TableHead>Required</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spec.fields.map((f) => (
                    <TableRow key={f.field}>
                      <TableCell className="font-mono text-xs">{f.field}</TableCell>
                      <TableCell>{f.portalLabel}</TableCell>
                      <TableCell>{f.required ? "Yes" : "No"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Recent failures</CardTitle>
          <CardDescription>The latest failed attempts for this portal.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.recentFailures.length === 0 ? (
            <p className="text-muted-foreground text-sm">No failed attempts.</p>
          ) : (
            <ul className="divide-y text-sm">
              {stats.recentFailures.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <Link href={`/executions/${e.id}`} className="text-primary font-mono text-xs hover:underline">
                    {e.error_code}
                  </Link>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{e.error_message}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">{formatDateTime(e.started_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <RoutingRules portal={portal.slug} />
    </div>
  );
}
