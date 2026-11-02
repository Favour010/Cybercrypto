import { Brand } from "@/components/layout/brand";
import { SidebarNav } from "@/components/layout/sidebar-nav";

export function AppSidebar() {
  return (
    <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r lg:flex">
      <div className="border-sidebar-border flex h-16 items-center border-b px-5">
        <Brand />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-5">
        <SidebarNav />
      </div>
      <div className="border-sidebar-border text-sidebar-muted border-t px-5 py-4 text-[11px] leading-relaxed">
        Demo environment · simulated client portals
      </div>
    </aside>
  );
}
