"use client";

import { Check, Copy, KeyRound, LoaderCircle } from "lucide-react";
import { useActionState, useState } from "react";

import { createApiKeyAction, type CreateKeyState } from "@/app/(dashboard)/incoming/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateKeyForm() {
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createApiKeyAction, {});
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {state.createdKey ? (
        <Alert variant="info">
          <KeyRound />
          <AlertTitle>Key “{state.createdName}” created. Copy it now.</AlertTitle>
          <AlertDescription>
            <p>This is the only time the key is shown. JobSync stores only a hash of it.</p>
            <div className="mt-1 flex w-full items-center gap-2">
              <code className="bg-card min-w-0 flex-1 rounded border px-2 py-1 font-mono text-xs break-all select-all">
                {state.createdKey}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(state.createdKey!);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
        <div>
          <label htmlFor="key-name" className="text-muted-foreground mb-1 block text-xs font-medium">
            Name
          </label>
          <Input id="key-name" name="name" placeholder="AroFlo via n8n" maxLength={100} required />
        </div>
        <div>
          <label htmlFor="key-sources" className="text-muted-foreground mb-1 block text-xs font-medium">
            Allowed sources
          </label>
          <Input id="key-sources" name="sources" placeholder="aroflo" required />
        </div>
        <div>
          <label htmlFor="key-expiry" className="text-muted-foreground mb-1 block text-xs font-medium">
            Expires (days)
          </label>
          <Input id="key-expiry" name="expires_in_days" type="number" min={1} max={730} placeholder="Never" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
          Create key
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
