"use client";

import { Ban, CircleCheck, RotateCcw, UserRoundSearch } from "lucide-react";
import { useState } from "react";

import { useDemo } from "@/components/demo/demo-provider";
import { ConfirmAction } from "@/components/demo/demo-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { can } from "@/lib/auth/permissions";
import { cancelTask, markSubmittedManually, retryTask, sendTaskToReview } from "@/lib/demo/engine";
import { portalName } from "@/lib/demo/selectors";
import type { DemoTask } from "@/lib/demo/types";
import { PORTAL_SPECS } from "@/lib/portals/specs";

/** Actions on one portal submission task. Only what the task's state and the user's role allow. */
export function TaskActions({ task, reference }: { task: DemoTask; reference: string }) {
  const { user, run } = useDemo();
  const [ref, setRef] = useState("");
  if (!can(user.role, "queue.retry")) return null;
  const portal = portalName(task.portal_slug);
  const canRetry = ["failed", "human_review", "retry_scheduled", "cancelled"].includes(task.status);
  const canEscalate = ["pending", "retry_scheduled", "failed"].includes(task.status);
  const canCancel = ["pending", "retry_scheduled", "failed", "human_review"].includes(task.status);
  const canManual = ["human_review", "failed"].includes(task.status);
  if (!canRetry && !canEscalate && !canCancel && !canManual) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {canRetry ? (
        <ConfirmAction
          trigger={
            <Button size="sm" variant="outline">
              <RotateCcw aria-hidden /> Retry
            </Button>
          }
          title={`Retry the ${portal} submission?`}
          description={
            <p>
              {reference} goes back into the queue for {portal}.{" "}
              {task.attempt_count >= task.max_attempts ? "One extra attempt will be allowed. " : ""}
              Other portals for this job are not affected.
            </p>
          }
          confirmLabel="Retry now"
          onConfirm={() =>
            run((s, ctx) => retryTask(s, ctx, task.id), `${reference} → ${portal} queued for another attempt.`).ok
          }
        />
      ) : null}
      {canEscalate ? (
        <ConfirmAction
          trigger={
            <Button size="sm" variant="ghost">
              <UserRoundSearch aria-hidden /> Escalate
            </Button>
          }
          title="Send to human review?"
          description={
            <p>
              The {portal} submission for {reference} stops being retried automatically until someone resolves it.
            </p>
          }
          confirmLabel="Send to review"
          note={{
            label: "Why does this need a person?",
            required: true,
            placeholder: "e.g. Client asked us to hold this job",
          }}
          onConfirm={(note) =>
            run((s, ctx) => sendTaskToReview(s, ctx, task.id, note), `${reference} → ${portal} sent to human review.`)
              .ok
          }
        />
      ) : null}
      {canManual ? (
        <ConfirmAction
          trigger={
            <Button size="sm" variant="ghost">
              <CircleCheck aria-hidden /> Submitted manually
            </Button>
          }
          title={`Record a manual ${portal} submission`}
          description={
            <p>
              Use this only after a person has submitted {reference} on the {portal} portal themselves. Enter the
              reference the portal gave them. It is recorded as a manual submission, not as automation.
            </p>
          }
          extra={
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`ref-${task.id}`} className="text-sm font-medium">
                Portal confirmation reference <span className="text-destructive">*</span>
              </label>
              <Input
                id={`ref-${task.id}`}
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder={PORTAL_SPECS[task.portal_slug].referencePattern.replace(/#/g, "0")}
                maxLength={40}
              />
            </div>
          }
          note={{ label: "Note (optional)" }}
          confirmLabel="Record submission"
          onConfirm={(note) => {
            const ok = run(
              (s, ctx) => markSubmittedManually(s, ctx, task.id, ref, note),
              `${reference} → ${portal} recorded as submitted manually.`,
            ).ok;
            if (ok) setRef("");
            return ok;
          }}
        />
      ) : null}
      {canCancel ? (
        <ConfirmAction
          trigger={
            <Button size="sm" variant="ghost" className="text-destructive">
              <Ban aria-hidden /> Cancel
            </Button>
          }
          title={`Cancel the ${portal} submission?`}
          description={
            <p>
              {reference} will not be sent to {portal}. Other portals are not affected. You can retry it later.
            </p>
          }
          confirmLabel="Cancel submission"
          destructive
          note={{ label: "Reason (optional)" }}
          onConfirm={(note) =>
            run((s, ctx) => cancelTask(s, ctx, task.id, note), `${reference} → ${portal} cancelled.`).ok
          }
        />
      ) : null}
    </div>
  );
}
