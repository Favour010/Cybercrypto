import { Construction } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Honest placeholder for a module scheduled in a later phase. It describes the
 * planned capability and never renders fake data or non-functional controls.
 */
export function PhasePlaceholder({
  title,
  description,
  phase,
  capabilities,
}: {
  title: string;
  description: string;
  phase: number;
  capabilities: string[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Construction className="text-muted-foreground size-4" aria-hidden />
            <CardTitle>Not yet implemented</CardTitle>
            <Badge variant="secondary">Phase {phase}</Badge>
          </div>
          <CardDescription>
            This module is part of the build plan and will be delivered in Phase {phase}. No data or controls are shown
            until the backing logic exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Planned scope</div>
          <ul className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
            {capabilities.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="bg-primary/60 mt-2 size-1.5 shrink-0 rounded-full" aria-hidden />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
