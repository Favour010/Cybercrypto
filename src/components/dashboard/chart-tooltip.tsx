"use client";

import type { TooltipContentProps } from "recharts";

/** Tooltip in text tokens; the swatch carries identity, text stays in ink colours. */
export function ChartTooltip({
  active,
  payload,
  label,
  showTotal,
}: Partial<TooltipContentProps<number, string>> & { showTotal?: boolean }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum, p) => sum + (typeof p.value === "number" ? p.value : 0), 0);
  return (
    <div className="bg-popover text-popover-foreground min-w-40 rounded-lg border px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 font-medium">{label}</div>
      <ul className="flex flex-col gap-1">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <span className="size-2 rounded-[2px]" style={{ background: p.color }} aria-hidden />
              {p.name}
            </span>
            <span className="font-medium tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
      {showTotal && payload.length > 1 ? (
        <div className="mt-1.5 flex justify-between border-t pt-1.5">
          <span className="text-muted-foreground">Total</span>
          <span className="font-medium tabular-nums">{total}</span>
        </div>
      ) : null}
    </div>
  );
}
