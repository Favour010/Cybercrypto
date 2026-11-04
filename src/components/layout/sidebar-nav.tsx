"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_SECTIONS, findActiveNavItem } from "@/lib/config/navigation";
import { cn } from "@/lib/utils";

/** Highlights the current page. Needs the URL, so render it inside <Suspense>. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return <SidebarNavList activeHref={findActiveNavItem(pathname)?.href} onNavigate={onNavigate} />;
}

/** The navigation itself, without reading the URL (used as the Suspense fallback). */
export function SidebarNavList({ activeHref, onNavigate }: { activeHref?: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <div className="text-sidebar-muted px-3 pb-2 text-[11px] font-medium tracking-wider uppercase">
            {section.label}
          </div>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive = activeHref === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      "focus-visible:ring-sidebar-ring outline-none focus-visible:ring-2",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-primary font-medium shadow-[inset_2px_0_0_0_var(--sidebar-ring)]"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-primary",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        isActive ? "text-sidebar-primary" : "text-sidebar-muted group-hover:text-sidebar-primary",
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{item.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
