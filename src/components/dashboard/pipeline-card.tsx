import { ArrowRight } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STAGES = [
  { name: "Intake", detail: "API · n8n · manual" },
  { name: "Validate", detail: "Schema & idempotency" },
  { name: "Route", detail: "Rules & overrides" },
  { name: "Queue", detail: "1 task per portal" },
  { name: "Execute", detail: "Playwright adapters" },
  { name: "Confirm", detail: "Reference & screenshot" },
];

export function PipelineCard() {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Processing pipeline</CardTitle>
        <CardDescription>Every manual and external job follows the same path.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-wrap items-center gap-y-2">
          {STAGES.map((s, i) => (
            <li key={s.name} className="flex items-center">
              <div className="bg-muted/60 rounded-md border px-2.5 py-1.5">
                <div className="text-xs font-semibold">{s.name}</div>
                <div className="text-muted-foreground text-[11px]">{s.detail}</div>
              </div>
              {i < STAGES.length - 1 ? (
                <ArrowRight className="text-muted-foreground mx-1.5 size-3.5 shrink-0" aria-hidden />
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
