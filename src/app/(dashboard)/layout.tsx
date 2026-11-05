import { DemoProvider } from "@/components/demo/demo-provider";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { isDemoMode } from "@/lib/data-mode";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Demo data layer: the whole signed-in shell shares one browser-side store.
  const demo = isDemoMode();
  const shell = (
    <div className="flex min-h-svh">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
  return demo ? <DemoProvider>{shell}</DemoProvider> : shell;
}
