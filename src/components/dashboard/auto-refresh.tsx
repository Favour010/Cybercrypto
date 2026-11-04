"use client";

import { Pause, Play, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const DASHBOARD_REFRESH_SECONDS = 30;

export type ConnectionStatus = "connected" | "schema_missing" | "error";

const STATUS: Record<ConnectionStatus, { label: string; dot: string }> = {
  connected: { label: "Database query succeeded", dot: "bg-status-good" },
  schema_missing: { label: "Schema not applied", dot: "bg-status-warning" },
  error: { label: "Database query failed", dot: "bg-status-critical" },
};

/**
 * Re-runs the server-side dashboard query on an interval (router.refresh()).
 * The status shown is the outcome of the query that produced the current
 * render, so it is never more optimistic than the last real database read.
 * Polling pauses while the tab is hidden.
 */
export function AutoRefresh({ status, generatedAt }: { status: ConnectionStatus; generatedAt: string }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (paused) return;
    const tick = () => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    };
    const id = window.setInterval(tick, DASHBOARD_REFRESH_SECONDS * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [paused, router]);

  const time = new Date(generatedAt).toLocaleTimeString("en-GB", { timeZone: "UTC" });
  const s = STATUS[status];

  return (
    <div className="bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2 text-xs">
      <span className="flex items-center gap-2 font-medium" role="status" aria-live="polite">
        <span className={cn("size-2 rounded-full", s.dot)} aria-hidden />
        {s.label}
      </span>
      <span className="text-muted-foreground tabular-nums">Updated {time} UTC</span>
      <span className="text-muted-foreground">
        {paused ? "Auto-refresh paused" : `Auto-refresh every ${DASHBOARD_REFRESH_SECONDS}s`}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
          <RefreshCw className={cn(pending && "animate-spin")} aria-hidden />
          {pending ? "Refreshing…" : "Refresh now"}
        </Button>
      </div>
    </div>
  );
}
