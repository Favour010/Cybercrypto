import { Workflow } from "lucide-react";

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="bg-primary grid size-8 place-items-center rounded-lg text-white shadow-sm ring-1 ring-white/10">
        <Workflow className="size-4" aria-hidden />
      </div>
      <div className="leading-tight">
        <div className="text-sidebar-primary text-[15px] font-semibold tracking-tight">JobSync</div>
        <div className="text-sidebar-muted text-[11px]">Portal automation</div>
      </div>
    </div>
  );
}
