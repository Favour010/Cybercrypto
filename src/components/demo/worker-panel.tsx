"use client";

import { Cpu, Pause, Play } from "lucide-react";
import Link from "next/link";

import { useDemo } from "@/components/demo/demo-provider";
import { SimulatedBadge } from "@/components/demo/demo-ui";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { setWorkerRunning } from "@/lib/demo/engine";
import { portalName } from "@/lib/demo/selectors";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export function WorkerPanel({ compact = false }: { compact?: boolean }) {
  const { state, user, now, run } = useDemo();
  const running = state.executions.filter((e) => e.status === "running");
  const on = state.settings.worker_running;
  const allowed = can(user.role, "queue.retry");
  const jobRef = new Map(state.jobs.map((j) => [j.id, j.reference]));
  const slots = Array.from({ length: state.settings.max_concurrency }, (_, i) => running[i] ?? null);

  return (
    <Card className="gap-3">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Cpu className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Automation worker</CardTitle>
        </div>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <SimulatedBadge />
          <span>
            {on ? "Running" : "Paused"} · {state.settings.max_concurrency} slots · dry run only
          </span>
        </CardDescription>
        <CardAction>
          <Button
            size="sm"
            variant={on ? "outline" : "default"}
            disabled={!allowed}
            title={allowed ? undefined : "Operators and admins can start or pause the worker."}
            onClick={() =>
              run(
                (s, ctx) => setWorkerRunning(s, ctx, !on),
                on ? "Worker paused. Running attempts will finish." : "Worker started.",
              )
            }
          >
            {on ? <Pause aria-hidden /> : <Play aria-hidden />}
            {on ? "Pause worker" : "Start worker"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {slots.map((e, i) => {
          if (!e) {
            return (
              <div
                key={`idle-${i}`}
                className="text-muted-foreground flex items-center justify-between rounded-md border border-dashed px-3 py-2 text-xs"
              >
                <span>sim-worker-{i + 1}</span>
                <span>{on ? "Idle: waiting for a due task" : "Idle"}</span>
              </div>
            );
          }
          const start = new Date(e.started_at).getTime();
          const end = e.plan ? new Date(e.plan.ends_at).getTime() : start + 1;
          const pct = Math.min(100, Math.max(3, ((now.getTime() - start) / Math.max(1, end - start)) * 100));
          return (
            <div key={e.id} className="rounded-md border px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium">
                  {e.worker_id} · {portalName(e.portal_slug)}
                </span>
                <Link href={`/executions/${e.id}`} className="text-primary hover:underline">
                  {jobRef.get(e.job_id)} · attempt {e.attempt}
                </Link>
              </div>
              <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full" aria-hidden>
                <div
                  className={cn("bg-status-info h-full transition-[width] duration-700")}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-muted-foreground mt-1 text-[11px] tabular-nums">
                {formatDuration(now.getTime() - start)} elapsed
              </div>
            </div>
          );
        })}
        {!compact ? (
          <p className="text-muted-foreground text-xs">
            The worker claims due tasks in priority order, retries failures with exponential backoff and never repeats a
            portal that already has the job. CAPTCHA, MFA and portal validation errors go to a person.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
