"use client";

import { BarChart3, Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface LegendItem {
  label: string;
  color: string;
}

export interface TableSpec {
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: readonly object[];
}

/**
 * Card wrapper shared by every overview chart: title, legend (always present
 * for two or more series, so identity never relies on colour alone) and an
 * accessible table view of exactly the plotted numbers.
 */
export function ChartFrame({
  title,
  description,
  legend,
  table,
  empty,
  children,
  className,
}: {
  title: string;
  description?: string;
  legend?: LegendItem[];
  table: TableSpec;
  /** Rendered instead of the chart when there is nothing to plot. */
  empty?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");

  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {!empty ? (
          <CardAction>
            <div className="bg-muted inline-flex rounded-md p-0.5" role="group" aria-label={`${title} view`}>
              {(["chart", "table"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={cn(
                    "focus-visible:ring-ring/50 grid size-7 place-items-center rounded-[5px] outline-none focus-visible:ring-2",
                    view === v ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                  title={v === "chart" ? "Chart view" : "Table view"}
                >
                  {v === "chart" ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
                  <span className="sr-only">{v === "chart" ? "Chart view" : "Table view"}</span>
                </button>
              ))}
            </div>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {empty ? (
          empty
        ) : view === "chart" ? (
          <>
            {legend && legend.length > 1 ? (
              <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
                {legend.map((l) => (
                  <li key={l.label} className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <span className="size-2.5 rounded-[3px]" style={{ background: l.color }} aria-hidden />
                    {l.label}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="h-64 w-full">{children}</div>
          </>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader className="bg-muted/60 sticky top-0">
                <TableRow>
                  {table.columns.map((c) => (
                    <TableHead key={c.key} className={c.numeric ? "text-right" : undefined}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.map((r, i) => (
                  <TableRow key={i}>
                    {table.columns.map((c) => (
                      <TableCell key={c.key} className={c.numeric ? "text-right tabular-nums" : undefined}>
                        {String((r as Record<string, unknown>)[c.key] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
