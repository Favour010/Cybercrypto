import { Workflow } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="bg-primary grid size-9 place-items-center rounded-lg text-white shadow-sm">
          <Workflow className="size-4.5" aria-hidden />
        </div>
        <div className="leading-tight">
          <div className="text-base font-semibold tracking-tight">JobSync</div>
          <div className="text-muted-foreground text-xs">Portal automation</div>
        </div>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
