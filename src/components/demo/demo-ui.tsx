"use client";

import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { DemoTask } from "@/lib/demo/types";
import { TASK_STATUS_META } from "@/lib/domain/status";
import { cn } from "@/lib/utils";

/** Standing notice on every demo page: where the data lives and what is simulated. */
export function DemoNotice({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
        className,
      )}
    >
      <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>
        {children ?? (
          <>
            <strong>Demo data layer.</strong> Sample data stored in this browser only. Portal runs are{" "}
            <strong>simulated dry runs</strong>: no portal is contacted and nothing is submitted.{" "}
            <Link href="/settings/system" className="underline underline-offset-2">
              Settings and reset
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

/** Task status, honest about simulation and manual completion. */
export function TaskStatusBadge({ task }: { task: Pick<DemoTask, "status" | "execution_mode"> }) {
  if (task.status === "submitted") {
    return task.execution_mode === "live" ? (
      <StatusBadge tone="good" label="Submitted manually" />
    ) : (
      <StatusBadge tone="good" label="Dry run passed" />
    );
  }
  const m = TASK_STATUS_META[task.status];
  return <StatusBadge tone={m.tone} label={m.label} />;
}

/** A button that asks for confirmation (and optionally a note) before acting. */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  destructive,
  note,
  extra,
  onConfirm,
  disabled,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Ask for a note; `required` makes it mandatory. */
  note?: { label: string; required?: boolean; placeholder?: string };
  extra?: React.ReactNode;
  onConfirm: (note: string) => boolean | void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const blocked = Boolean(note?.required && !text.trim());
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setText("");
      }}
    >
      <DialogTrigger asChild disabled={disabled}>
        {trigger}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        {extra}
        {note ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-note" className="text-sm font-medium">
              {note.label}
              {note.required ? <span className="text-destructive"> *</span> : null}
            </label>
            <textarea
              id="confirm-note"
              rows={3}
              value={text}
              maxLength={500}
              placeholder={note.placeholder}
              onChange={(e) => setText(e.target.value)}
              className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/40 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={blocked}
            onClick={() => {
              const result = onConfirm(text);
              if (result !== false) setOpen(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SimulatedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-900 uppercase dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      <FlaskConical className="size-3" aria-hidden />
      Simulated
    </span>
  );
}
