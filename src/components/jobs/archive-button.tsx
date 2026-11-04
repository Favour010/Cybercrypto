"use client";

import { Archive, ArchiveRestore, LoaderCircle } from "lucide-react";
import { useActionState } from "react";

import { toggleJobArchive, type ArchiveState } from "@/app/(dashboard)/jobs/actions";
import { Button } from "@/components/ui/button";

export function ArchiveButton({ jobId, archived }: { jobId: string; archived: boolean }) {
  const [state, action, pending] = useActionState<ArchiveState, FormData>(toggleJobArchive, {});
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="intent" value={archived ? "restore" : "archive"} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : archived ? <ArchiveRestore /> : <Archive />}
        {archived ? "Restore job" : "Archive job"}
      </Button>
      {state.error ? (
        <p role="alert" className="text-destructive max-w-xs text-right text-xs">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
