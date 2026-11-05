"use client";

import { Play, Send, Webhook } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { StatusBadge } from "@/components/common/status-badge";
import { useDemo } from "@/components/demo/demo-provider";
import { SimulatedBadge } from "@/components/demo/demo-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/auth/permissions";
import type { AutomationResult } from "@/lib/automation/contract";
import { processAutomationResult, startAttemptForExternalResult, type ResultOutcome } from "@/lib/demo/engine";
import { portalName } from "@/lib/demo/selectors";
import type { DemoExecution } from "@/lib/demo/types";
import { formatDateTime } from "@/lib/format";

type Template = "passed" | "retryable" | "review" | "fake_submission";

const TEMPLATES: { key: Template; label: string }[] = [
  { key: "passed", label: "Dry run passed" },
  { key: "retryable", label: "Retryable failure" },
  { key: "review", label: "Needs a person (CAPTCHA)" },
  { key: "fake_submission", label: "Invalid: dry run claims a submission" },
];

function template(exec: DemoExecution, kind: Template): AutomationResult {
  const base = {
    execution_id: exec.id,
    job_id: exec.job_id,
    portal: exec.portal_slug,
    execution_mode: exec.mode,
    attempt: exec.attempt,
    started_at: exec.started_at,
    completed_at: new Date(Math.max(Date.now(), Date.parse(exec.started_at))).toISOString(),
    screenshot_url: null,
    simulated: true,
  } as const;
  switch (kind) {
    case "passed":
      return { ...base, status: "dry_run_passed", confirmation_reference: null, error: null };
    case "retryable":
      return {
        ...base,
        status: "failed",
        confirmation_reference: null,
        error: { code: "PORTAL_TIMEOUT", message: "The portal did not respond in time.", retryable: true },
      };
    case "review":
      return {
        ...base,
        status: "needs_review",
        confirmation_reference: null,
        error: {
          code: "CAPTCHA_REQUIRED",
          message: "The portal showed a CAPTCHA. A person must continue.",
          retryable: false,
        },
      };
    case "fake_submission":
      return { ...base, status: "submitted", confirmation_reference: "FAKE-000001", error: null };
  }
}

/**
 * Posts worker results into the same processor the simulated worker uses, to
 * show how JobSync validates and applies them. Nothing leaves the browser.
 */
export function ResultSimulator() {
  const { state, user, runWith, notify } = useDemo();
  const base = useId();
  const allowed = can(user.role, "integrations.manage");
  const running = useMemo(
    () =>
      state.executions
        .filter((e) => e.status === "running" && e.plan === null)
        .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [state.executions],
  );
  const recent = useMemo(
    () =>
      state.executions
        .filter((e) => e.worker_id === "result-simulator" && e.status !== "running")
        .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
        .slice(0, 5),
    [state.executions],
  );
  const waiting = useMemo(() => {
    const locked = new Set(state.executions.filter((e) => e.status === "running").map((e) => e.portal_slug));
    const refs = new Map(state.jobs.filter((j) => !j.archived_at).map((j) => [j.id, j.reference]));
    return state.tasks
      .filter((t) => (t.status === "pending" || t.status === "retry_scheduled") && refs.has(t.job_id))
      .filter((t) => !locked.has(t.portal_slug))
      .slice(0, 50)
      .map((t) => ({ id: t.id, label: `${refs.get(t.job_id)} → ${portalName(t.portal_slug)}` }));
  }, [state.executions, state.jobs, state.tasks]);
  const reference = (jobId: string) => state.jobs.find((j) => j.id === jobId)?.reference ?? "—";

  const [taskId, setTaskId] = useState("");
  const [execId, setExecId] = useState("");
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<ResultOutcome | null>(null);
  const selected = running.find((e) => e.id === execId) ?? recent.find((e) => e.id === execId) ?? null;

  function start() {
    const r = runWith((s, ctx) => {
      const out = startAttemptForExternalResult(s, ctx, taskId || waiting[0]?.id);
      return { state: out.state, value: out.execution };
    });
    if (!r.ok) return notify(r.error, "error");
    setExecId(r.value.id);
    setText(JSON.stringify(template(r.value, "passed"), null, 2));
    setOutcome(null);
    notify(`Attempt ${r.value.attempt} started; it waits for a result.`);
  }

  function send() {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return notify("This is not valid JSON.", "error");
    }
    const r = runWith((s) => {
      const out = processAutomationResult(s, payload, new Date(), "simulator");
      return { state: out.state, value: out.outcome };
    });
    if (r.ok) setOutcome(r.value);
    else notify(r.error, "error");
  }

  return (
    <Card className="gap-3">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Webhook className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Worker result simulator</CardTitle>
          <SimulatedBadge />
        </div>
        <CardDescription>
          A real Playwright worker reports each attempt back to JobSync. Here you can post such a result yourself and
          see how it is checked and applied. Nothing is sent over the network and no portal is contacted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!allowed ? (
          <p className="text-muted-foreground text-sm">Only admins can use the result simulator.</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${base}-task`} className="text-muted-foreground text-xs font-medium">
                1. Start an attempt that waits for a result
              </label>
              <div className="flex flex-wrap gap-2">
                <NativeSelect
                  id={`${base}-task`}
                  className="min-w-0 flex-1"
                  value={taskId}
                  onChange={(e) => setTaskId(e.target.value)}
                  disabled={waiting.length === 0}
                >
                  {waiting.length === 0 ? <option value="">No queued task on a free portal</option> : null}
                  {waiting.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
                <Button size="sm" variant="outline" onClick={start} disabled={waiting.length === 0}>
                  <Play aria-hidden /> Start attempt
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${base}-exec`} className="text-muted-foreground text-xs font-medium">
                2. Choose the attempt and a result
              </label>
              <NativeSelect
                id={`${base}-exec`}
                value={execId}
                onChange={(e) => {
                  setExecId(e.target.value);
                  const ex = [...running, ...recent].find((x) => x.id === e.target.value);
                  if (ex) setText(JSON.stringify(template(ex, "passed"), null, 2));
                  setOutcome(null);
                }}
              >
                <option value="">Select an attempt…</option>
                {running.length ? (
                  <optgroup label="Waiting for a result">
                    {running.map((e) => (
                      <option key={e.id} value={e.id}>
                        {reference(e.job_id)} → {portalName(e.portal_slug)} · attempt {e.attempt}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {recent.length ? (
                  <optgroup label="Already finished (try a duplicate)">
                    {recent.map((e) => (
                      <option key={e.id} value={e.id}>
                        {reference(e.job_id)} → {portalName(e.portal_slug)} · {e.status}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </NativeSelect>
              {selected ? (
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATES.map((t) => (
                    <Button
                      key={t.key}
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setText(JSON.stringify(template(selected, t.key), null, 2));
                        setOutcome(null);
                      }}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${base}-json`} className="text-muted-foreground text-xs font-medium">
                3. Result payload (AutomationResult JSON)
              </label>
              <Textarea
                id={`${base}-json`}
                rows={10}
                spellCheck={false}
                className="font-mono text-xs"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Select an attempt to prefill a result."
              />
              <div>
                <Button size="sm" onClick={send} disabled={!text.trim()}>
                  <Send aria-hidden /> Post result
                </Button>
              </div>
            </div>
            {outcome ? <OutcomeView outcome={outcome} /> : null}
          </>
        )}
        <WorkerResultLog />
      </CardContent>
    </Card>
  );
}

/** Demo executions are always dry runs, so "submitted" here means the rehearsal passed. */
function dryRunLabel(status: string) {
  if (status === "submitted") return "dry run passed";
  if (status === "partially_submitted") return "partially passed (dry run)";
  return status.replaceAll("_", " ");
}

function OutcomeView({ outcome }: { outcome: ResultOutcome }) {
  if (outcome.outcome === "applied")
    return (
      <div role="status" className="rounded-md border p-3 text-sm">
        <div className="text-status-good font-medium">Applied</div>
        <p className="text-muted-foreground mt-1">
          Task is now <strong>{dryRunLabel(outcome.task_status)}</strong>; job is{" "}
          <strong>{dryRunLabel(outcome.job_status)}</strong>.
        </p>
      </div>
    );
  if (outcome.outcome === "duplicate")
    return (
      <div role="status" className="rounded-md border p-3 text-sm">
        <div className="font-medium text-amber-600">Duplicate — ignored</div>
        <p className="text-muted-foreground mt-1">{outcome.message}</p>
      </div>
    );
  return (
    <div role="alert" className="border-destructive/40 rounded-md border p-3 text-sm">
      <div className="text-destructive font-medium">Rejected — nothing changed</div>
      <ul className="text-muted-foreground mt-1 list-disc pl-5">
        {outcome.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

function WorkerResultLog() {
  const { state } = useDemo();
  const log = state.events
    .filter((e) => e.integration === "worker")
    .slice(-6)
    .reverse();
  if (log.length === 0) return null;
  const tone = { accepted: "good", duplicate: "warning", rejected: "critical" } as const;
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-xs font-medium">Recent posted results</div>
      <ul className="divide-y rounded-md border text-sm">
        {log.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
            <StatusBadge
              tone={tone[e.status as keyof typeof tone] ?? "neutral"}
              label={e.status.charAt(0).toUpperCase() + e.status.slice(1)}
            />
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{e.error ?? "Applied"}</span>
            <span className="text-muted-foreground text-xs tabular-nums">{formatDateTime(e.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
